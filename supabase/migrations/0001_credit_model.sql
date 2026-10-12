-- =============================================================================
-- 0001_credit_model.sql — 把 credit_transactions 提升为可靠的积分流水
-- =============================================================================
-- 解决的问题（见 docs/DATABASE_AUDIT.md）：
--   A-2  流水经伪 Prisma 时不落库        → 由代码侧修复（Repository），本文件只负责表结构
--   A-5  type CHECK 与代码实际写入值冲突 → 本文件放宽并补齐类型词表
--        现状：CHECK 只允许 purchase/usage/refund/bonus，
--              但 auth.ts 与 user/credits 实际写入 'gift' → 插入被拒
--
-- 本文件做四件事：
--   1. 补齐列：status / balance_before / balance_after / reference_type / metadata
--   2. 放宽并补齐 type 词表（同时保留旧值与目标值，保证运行中的代码不被破坏）
--   3. 建立幂等约束（部分唯一索引）
--   4. 回填 reference_type 并补充索引
--
-- 设计说明（为什么用 reference_type + reference_id 而不是新增 idempotency_key 列）：
--   「同一个业务任务不能重复扣积分」本质是「业务引用唯一」，
--   用 (user_id, reference_type, reference_id, type) 表达最直接，不需要额外维护一个键。
--   部分唯一索引带 WHERE 条件，因此 reference_type / reference_id 为 NULL 的历史数据
--   与尚未传引用的旧写入路径都不会被误伤。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 补齐列
-- -----------------------------------------------------------------------------
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS balance_before INTEGER,
  ADD COLUMN IF NOT EXISTS balance_after INTEGER,
  ADD COLUMN IF NOT EXISTS reference_type VARCHAR,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

COMMENT ON COLUMN public.credit_transactions.status IS
  'PENDING / COMPLETED / FAILED。默认 COMPLETED，兼容未传状态的历史写入。';
COMMENT ON COLUMN public.credit_transactions.balance_before IS
  '变动前余额。用于对账；历史数据为 NULL。';
COMMENT ON COLUMN public.credit_transactions.balance_after IS
  '变动后余额。用于对账；历史数据为 NULL。';
COMMENT ON COLUMN public.credit_transactions.reference_type IS
  '业务引用类型，例如 ai_generation / order / registration。与 reference_id 一起构成幂等键。';
COMMENT ON COLUMN public.credit_transactions.reference_id IS
  '业务引用 id，例如 AI 任务的 task_id、订单号。与 reference_type 一起构成幂等键。';

-- -----------------------------------------------------------------------------
-- 2. type 词表
-- -----------------------------------------------------------------------------
-- 旧值（保留，运行中的代码仍在写）：purchase / usage / refund / bonus / gift
-- 目标值（新代码使用）：grant / purchase / consume / refund / expire / adjustment
--
-- 映射关系（供 Credit 阶段收敛使用）：
--   usage / gift / bonus  → consume / grant / grant
--
-- 这里刻意同时允许两套，避免「改了 CHECK 导致线上写入立刻失败」。
-- 等所有写入方都切到目标词表后，再用一个后续迁移把 CHECK 收窄。
ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_type_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_type_check
  CHECK (type IN (
    -- 旧词表（deprecated，保留兼容）
    'purchase', 'usage', 'refund', 'bonus', 'gift',
    -- 目标词表
    'grant', 'consume', 'expire', 'adjustment'
  ));

ALTER TABLE public.credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_status_check;

ALTER TABLE public.credit_transactions
  ADD CONSTRAINT credit_transactions_status_check
  CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));

-- -----------------------------------------------------------------------------
-- 3. 幂等约束
-- -----------------------------------------------------------------------------
-- 同一个用户 + 同一个业务引用 + 同一种类型，只能有一条流水。
-- 例如：AI 任务 task_id=abc 的扣费流水只能存在一条，
--       请求重试 / Webhook 重放 / 前端重复提交都不会重复扣积分。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_credit_transactions_reference
  ON public.credit_transactions (user_id, reference_type, reference_id, type)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. 回填 reference_type + 索引
-- -----------------------------------------------------------------------------
-- 历史数据的 reference_id 有两种来源：
--   'welcome_bonus'                  → 注册赠送
--   '<action>_<timestamp>' / 其他     → 归入 legacy，不做语义猜测
UPDATE public.credit_transactions
SET reference_type = 'registration'
WHERE reference_type IS NULL AND reference_id = 'welcome_bonus';

UPDATE public.credit_transactions
SET reference_type = 'legacy'
WHERE reference_type IS NULL AND reference_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON public.credit_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference
  ON public.credit_transactions (reference_type, reference_id);
