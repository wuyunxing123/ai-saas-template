-- =============================================================================
-- 0005_atomic_credit_operations.sql — 积分原子扣减（RPC）
-- =============================================================================
-- 解决的问题（决策 D-3，见 docs/REFACTOR_DECISIONS.md）：
--
--   原实现（src/lib/services/credits.ts:consumeUserCredits）是典型的
--   read-check-write 竞态：
--
--     读取余额 → 判断是否足够 → 扣减余额 → 写流水
--
--   余额 100，请求 A 与 B 同时扣 80：
--     A 读到 100，判断够 → B 也读到 100，判断够
--     → 两次扣减都成功 → 余额变成 -60（或 0，取决于钳位）
--
-- 本迁移把「检查 + 扣减 + 写流水」下沉到数据库，用一条 SQL 完成：
--
--     UPDATE users SET credits = credits - amount
--     WHERE id = user_id AND credits >= amount
--     RETURNING credits
--
--   Postgres 的行级锁会在并发时串行化这两个 UPDATE：
--   第二个事务必须等第一个提交，之后**重新求值** WHERE 条件，
--   因此余额不足的那个自然匹配不到行 → 扣减失败。这是数据库层面的保证，
--   不依赖 TypeScript 里的任何判断。
--
-- 本文件只做两件事：
--   1. credit_transactions 增加 idempotency_key 列与唯一约束
--   2. 创建 consume_credits() 函数
--
-- 明确不做（用户约束 §12）：
--   · 不重构 refund / grant / adjustment
--   · 不创建 credit_accounts
--   · 不改变现有 transaction 的语义字段
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 幂等键
-- -----------------------------------------------------------------------------
-- 当前 credit_transactions 已有基于「业务引用」的幂等约束：
--   uniq_credit_transactions_reference (user_id, reference_type, reference_id, type)
-- 但它的语义是「同一业务引用只记一次账」，需要调用方提供 reference_type/reference_id。
--
-- 原子扣减需要一个更直接的「请求级」幂等键（用户重试 / 前端重复提交 / 网络重放），
-- 因此新增 idempotency_key 列与其唯一约束。两者职责不同，**都保留**：
--   · idempotency_key              → 请求级去重（consume_credits 使用）
--   · reference_type/reference_id  → 业务溯源 + 业务级去重（grant/refund/purchase 使用）
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR;

COMMENT ON COLUMN public.credit_transactions.idempotency_key IS
  '请求级幂等键。同一用户 + 同一键只允许一条流水。由 consume_credits() 使用。';

-- 部分唯一索引：允许 idempotency_key 为 NULL（未传幂等键的历史与普通流水），
-- 且多个 NULL 之间不互相冲突。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_transactions_idempotency
  ON public.credit_transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. 原子扣减函数
-- -----------------------------------------------------------------------------
-- 返回一行结果，调用方通过 status 区分四种情况：
--   ok             成功扣减
--   insufficient   余额不足（未扣减，未产生流水）
--   duplicate      幂等命中（未重复扣减，返回已有流水）
--   invalid_amount amount <= 0（防止用负数反向加积分）
--   user_not_found 用户不存在
--
-- 关于事务性：PL/pgSQL 函数体在调用语句所属的事务内执行。
-- 余额更新与流水写入要么都成功、要么都回滚，不会出现「扣了钱没记账」
-- 或「记了账没扣钱」。
--
-- 关于安全：使用默认的 SECURITY INVOKER（不以定义者权限运行）。
-- 服务端统一用 service_role 调用，会绕过 RLS；若被 anon 调用，
-- 会因为 credit_transactions 没有 INSERT 策略而失败（fail closed）。
CREATE OR REPLACE FUNCTION public.consume_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_idempotency_key TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'consume',
  p_description TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
)
RETURNS TABLE (
  status TEXT,
  balance INTEGER,
  transaction_id UUID,
  idempotent BOOLEAN
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_balance_after  INTEGER;
  v_balance_before INTEGER;
  v_tx_id          UUID;
  v_existing_id    UUID;
BEGIN
  -- ── 1. amount 必须为正整数 ──────────────────────────────────────────
  -- 不允许 consume(-100) 这种「反向加积分」的用法。
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT COALESCE(credits, 0) INTO v_balance_after
    FROM users WHERE id = p_user_id;

    RETURN QUERY SELECT 'invalid_amount'::TEXT, COALESCE(v_balance_after, 0), NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- ── 2. 用户必须存在 ─────────────────────────────────────────────────
  -- 必须在写入任何流水**之前**检查。
  -- 否则幂等键占位 INSERT 会先撞上 credit_transactions.user_id 的外键约束，
  -- 抛出一个数据库异常，而不是干净地返回 user_not_found。
  SELECT COALESCE(credits, 0) INTO v_balance_before
  FROM users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'user_not_found'::TEXT, 0, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- ── 3. 幂等：先占位 ─────────────────────────────────────────────────
  -- 先插入一条 PENDING 流水来「抢占」幂等键。
  -- 用 ON CONFLICT DO NOTHING 让并发下的第二个请求拿不到 id。
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO credit_transactions (
      user_id, amount, type, status,
      description, reference_type, reference_id, idempotency_key, metadata
    ) VALUES (
      p_user_id, -p_amount, p_type, 'PENDING',
      p_description, p_reference_type, p_reference_id, p_idempotency_key, p_metadata
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_tx_id;

    -- 没拿到 id 说明该幂等键已存在 → 直接返回已有结果，不做任何扣减
    IF v_tx_id IS NULL THEN
      SELECT ct.id INTO v_existing_id
      FROM credit_transactions ct
      WHERE ct.user_id = p_user_id
        AND ct.idempotency_key = p_idempotency_key
      LIMIT 1;

      SELECT COALESCE(credits, 0) INTO v_balance_after
      FROM users WHERE id = p_user_id;

      RETURN QUERY SELECT 'duplicate'::TEXT, COALESCE(v_balance_after, 0), v_existing_id, TRUE;
      RETURN;
    END IF;
  END IF;

  -- ── 4. 原子检查 + 扣减 ──────────────────────────────────────────────
  -- 关键：余额条件写在 WHERE 里，由数据库一次性完成检查与扣减。
  UPDATE users
  SET credits = COALESCE(credits, 0) - p_amount
  WHERE id = p_user_id
    AND COALESCE(credits, 0) >= p_amount
  RETURNING credits INTO v_balance_after;

  IF NOT FOUND THEN
    -- 扣减失败：把第 3 步占的位释放掉，否则同一个幂等键会被永久占用，
    -- 用户「充值后重试」会一直拿到 duplicate。
    IF v_tx_id IS NOT NULL THEN
      DELETE FROM credit_transactions WHERE id = v_tx_id;
    END IF;

    -- 用户在第 2 步已确认存在，这里只需取回当前余额
    SELECT COALESCE(credits, 0) INTO v_balance_before
    FROM users WHERE id = p_user_id;

    RETURN QUERY SELECT 'insufficient'::TEXT, v_balance_before, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- 用「扣减后余额 + 本次扣减量」反推扣减前余额，
  -- 而不是复用第 2 步读到的值：READ COMMITTED 下两步之间余额可能被其它事务改动，
  -- 反推能保证 balance_before / balance_after 这对快照在流水里始终自洽。
  v_balance_before := v_balance_after + p_amount;

  -- ── 5. 补全流水 ────────────────────────────────────────────────────
  IF v_tx_id IS NULL THEN
    -- 没有幂等键的路径：扣减成功后才写流水
    INSERT INTO credit_transactions (
      user_id, amount, type, status,
      description, balance_before, balance_after,
      reference_type, reference_id, metadata
    ) VALUES (
      p_user_id, -p_amount, p_type, 'COMPLETED',
      p_description, v_balance_before, v_balance_after,
      p_reference_type, p_reference_id, p_metadata
    )
    RETURNING id INTO v_tx_id;
  ELSE
    -- 有幂等键的路径：把第 3 步的 PENDING 占位补成完整流水
    UPDATE credit_transactions
    SET status = 'COMPLETED',
        balance_before = v_balance_before,
        balance_after = v_balance_after
    WHERE id = v_tx_id;
  END IF;

  RETURN QUERY SELECT 'ok'::TEXT, v_balance_after, v_tx_id, FALSE;
END;
$$;

COMMENT ON FUNCTION public.consume_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) IS
  '原子扣减积分：幂等检查 + 余额检查 + 扣减 + 写流水，全部在一条 SQL 事务内完成。返回 status ∈ {ok, insufficient, duplicate, invalid_amount, user_not_found}。';
