-- =============================================================================
-- 0006_billing_closed_loop.sql — Billing 闭环所需的数据基础
-- =============================================================================
-- 解决的问题（Phase 4）：
--   1. orders.status 缺少「已支付」这个一等状态（原实现用 'completed'，
--      与「订单完成」语义混淆，且与 Webhook 幂等判断绑得太紧）
--   2. checkout 创建订单没有幂等保护 → 用户重复点击 Pay 会创建多张订单
--   3. Webhook 幂等只靠 `if (order.status === 'paid')`，并发下仍有竞态
--   4. 缺少「已发放（fulfillment）」标记，无法区分「已付款」与「已交付」
--   5. 缺少原子且幂等的**发放**积分能力（Phase 3.5 只解决了消费）
--
-- 本文件做四件事：
--   1. orders：补齐 paid 状态、checkout 幂等键、fulfillment 标记、package 溯源
--   2. 新建 webhook_events：用数据库唯一约束保证 Webhook 幂等
--   3. 新建 grant_credits()：原子 + 幂等的积分发放（与 consume_credits 对称）
--   4. 回填历史状态
--
-- 明确不做（用户约束 §26）：
--   · 不实现自动续费 / proration / 优惠券 / 复杂退款 / 发票 / 税务 / 后台管理
--   · 不删除任何旧字段（旧状态值保留在 CHECK 里以兼容历史数据）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. orders：状态词表
-- -----------------------------------------------------------------------------
-- 目标词表：pending → paid → (refunded)，异常：failed / cancelled / expired
-- 兼容保留：created（≈ pending）、completed（≈ paid）—— 历史数据可能有
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    -- 目标词表
    'pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired',
    -- 兼容保留（deprecated）
    'created', 'completed'
  ));

-- 回填：'completed' 是「支付成功」的旧写法，统一成 'paid'
UPDATE public.orders SET status = 'paid' WHERE status = 'completed';
-- 回填：'created' 表示「已创建 checkout 会话但未支付」，语义等同 pending
UPDATE public.orders SET status = 'pending' WHERE status = 'created';

COMMENT ON COLUMN public.orders.status IS
  'pending / paid / failed / cancelled / refunded / expired。兼容保留 created(≈pending) 与 completed(≈paid) 供历史数据读取，新代码请用目标词表。';

-- -----------------------------------------------------------------------------
-- 2. orders：checkout 幂等键
-- -----------------------------------------------------------------------------
-- 用户重复点击 Pay 时，同一幂等键只允许一张订单。
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR;

COMMENT ON COLUMN public.orders.idempotency_key IS
  'checkout 幂等键。同一用户 + 同一键只允许一张订单，防止重复点击创建多张订单。';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_idempotency
  ON public.orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. orders：fulfillment、package 溯源、精确金额
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS package_id VARCHAR,
  ADD COLUMN IF NOT EXISTS amount_minor INTEGER;

COMMENT ON COLUMN public.orders.fulfilled_at IS
  '交付完成时间。paid 但 fulfilled_at 为空 = 已付款未交付（需要重试 fulfillment）。';
COMMENT ON COLUMN public.orders.package_id IS
  '下单时使用的 billing package id（见 src/config/billing.ts），用于价格溯源。';
COMMENT ON COLUMN public.orders.amount_minor IS
  '精确金额（整数最小单位，美分）。**新代码的权威金额字段**。amount(DECIMAL) 保留供旧代码与展示读取，两者由同一整数源派生，不存在浮点误差。';

-- 回填：从已有的 DECIMAL 金额换算成最小单位（四舍五入到分）
UPDATE public.orders
SET amount_minor = ROUND(amount * 100)::INTEGER
WHERE amount_minor IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_paid_unfulfilled
  ON public.orders (status, fulfilled_at)
  WHERE status = 'paid' AND fulfilled_at IS NULL;

-- -----------------------------------------------------------------------------
-- 4. webhook_events：用唯一约束保证 Webhook 幂等
-- -----------------------------------------------------------------------------
-- 为什么不能只靠 `if (order.status === 'paid')`：
--   两个并发 Webhook 可能同时读到 status='pending'，然后都执行发放 → 重复发积分。
--   正确做法是让数据库来仲裁：先 INSERT 抢占 (provider, event_id)，
--   抢不到的那个直接认定为重复事件。
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider VARCHAR NOT NULL,
  event_id VARCHAR NOT NULL,
  event_type VARCHAR,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.webhook_events IS
  'Webhook 事件去重表。唯一约束 (provider, event_id) 是 Webhook 幂等的依据。';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_webhook_events_provider_event
  ON public.webhook_events (provider, event_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_order_id
  ON public.webhook_events (order_id);

-- 仅服务端使用（service_role 绕过 RLS）；开启 RLS 且不建策略 = 匿名访问被拒
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 5. grant_credits()：原子 + 幂等的积分发放
-- -----------------------------------------------------------------------------
-- 与 consume_credits() 结构对称，但方向相反：
--   · 发放不存在「余额不足」，因此没有 insufficient 分支
--   · 幂等键由调用方用订单维度构造，例如 'credit_grant:<order_id>'
--
-- 返回值 status ∈ {ok, duplicate, invalid_amount, user_not_found}
--
-- 为什么必须原子：余额增加与流水写入必须在同一事务，
-- 否则可能出现「加了积分没记账」或「记了账没加积分」。
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_idempotency_key TEXT DEFAULT NULL,
  p_type TEXT DEFAULT 'purchase',
  p_description TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_order_id UUID DEFAULT NULL,
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
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT COALESCE(credits, 0) INTO v_balance_after
    FROM users WHERE id = p_user_id;

    RETURN QUERY SELECT 'invalid_amount'::TEXT, COALESCE(v_balance_after, 0), NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- ── 2. 用户必须存在 ─────────────────────────────────────────────────
  -- 与 consume_credits 同样的理由：必须在写流水之前检查，
  -- 否则幂等占位 INSERT 会先撞上 credit_transactions.user_id 外键约束。
  SELECT COALESCE(credits, 0) INTO v_balance_before
  FROM users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'user_not_found'::TEXT, 0, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- ── 3. 幂等：先占位 ─────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO credit_transactions (
      user_id, amount, type, status, description,
      reference_type, reference_id, idempotency_key, order_id, metadata
    ) VALUES (
      p_user_id, p_amount, p_type, 'PENDING', p_description,
      p_reference_type, p_reference_id, p_idempotency_key, p_order_id, p_metadata
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_tx_id;

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

  -- ── 4. 原子加余额 ──────────────────────────────────────────────────
  UPDATE users
  SET credits = COALESCE(credits, 0) + p_amount
  WHERE id = p_user_id
  RETURNING credits INTO v_balance_after;

  IF NOT FOUND THEN
    -- 第 2 步已确认存在，走到这里说明用户在两步之间被删除了
    IF v_tx_id IS NOT NULL THEN
      DELETE FROM credit_transactions WHERE id = v_tx_id;
    END IF;

    RETURN QUERY SELECT 'user_not_found'::TEXT, 0, NULL::UUID, FALSE;
    RETURN;
  END IF;

  -- 用「加后余额 - 本次发放量」反推加前余额，保证快照自洽
  v_balance_before := v_balance_after - p_amount;

  -- ── 5. 补全流水 ────────────────────────────────────────────────────
  IF v_tx_id IS NULL THEN
    INSERT INTO credit_transactions (
      user_id, amount, type, status, description,
      balance_before, balance_after,
      reference_type, reference_id, order_id, metadata
    ) VALUES (
      p_user_id, p_amount, p_type, 'COMPLETED', p_description,
      v_balance_before, v_balance_after,
      p_reference_type, p_reference_id, p_order_id, p_metadata
    )
    RETURNING id INTO v_tx_id;
  ELSE
    UPDATE credit_transactions
    SET status = 'COMPLETED',
        balance_before = v_balance_before,
        balance_after = v_balance_after
    WHERE id = v_tx_id;
  END IF;

  RETURN QUERY SELECT 'ok'::TEXT, v_balance_after, v_tx_id, FALSE;
END;
$$;

COMMENT ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, JSONB) IS
  '原子发放积分：幂等检查 + 加余额 + 写流水，全部在一条 SQL 事务内完成。返回 status ∈ {ok, duplicate, invalid_amount, user_not_found}。';
