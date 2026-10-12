-- =============================================================================
-- 0009_workflow_task_engine.sql — 为 ai_tasks 补上 Workflow 引擎所需字段
-- =============================================================================
-- 背景（见 docs/PHASE_7_AUDIT.md）：
--   0004 建了 ai_tasks，但**全项目零写入** —— 它只是数据承载，没有编排层。
--   Phase 7 要建立 Workflow / Async Task Engine，需要补三类字段：
--
--   1. 重试语义（规格 §17）
--        retry_count      已重试次数
--        max_retries      本任务允许的上限（默认 3）
--        next_retry_at    下次可重试时间（最小退避语义，不做复杂指数退避）
--
--   2. 生命周期时间戳（规格 §5）
--        started_at       提交给 Provider 的时刻
--        （completed_at 已有）
--
--   3. 结算追溯（规格 §18）
--        credits_refunded 已退款积分。
--                         与 credits_used 配合，可直接从任务行看出
--                         「扣了多少 / 退了多少」，不必回溯流水表。
--        refund_transaction_id  退款流水，用于审计
--
-- 为什么不加 reserve 列
-- --------------------
-- 规格 §5 建议 credits_reserved / credits_charged。
-- 但当前 credit 模型是「创建任务时 consume，失败时 refund」（见 PHASE_7_AUDIT §6），
-- 并没有 reserve → settle 的两阶段语义。
-- 引入 reserve 列会制造一列永远等于 credits_used 的冗余数据，
-- 反而误导。因此只保留 credits_used + credits_refunded。
--
-- 幂等性
-- ------
-- 本迁移可重复执行（全部 IF NOT EXISTS / DROP IF EXISTS）。
-- =============================================================================

-- ── 1. 新增列 ────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3;

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS credits_refunded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.ai_tasks
  ADD COLUMN IF NOT EXISTS refund_transaction_id UUID
    REFERENCES public.credit_transactions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_tasks.retry_count IS
  '已重试次数。达到 max_retries 后不再重试，任务终态为 failed。';
COMMENT ON COLUMN public.ai_tasks.max_retries IS
  '本任务允许的重试上限（默认 3）。仅对可重试错误生效（provider 5xx / timeout）。';
COMMENT ON COLUMN public.ai_tasks.next_retry_at IS
  '下次可重试时间。NULL 表示当前不可重试或无需重试。';
COMMENT ON COLUMN public.ai_tasks.started_at IS
  '提交给 Provider 的时刻。与 created_at（建任务）区分开。';
COMMENT ON COLUMN public.ai_tasks.credits_refunded IS
  '已退还的积分数。与 credits_used 配合可判断结算状态。';
COMMENT ON COLUMN public.ai_tasks.refund_transaction_id IS
  '对应的退款流水，用于审计。与 credit_transaction_id（扣费流水）配对。';

-- ── 2. 约束 ──────────────────────────────────────────────────────────────────

-- 重试次数不得为负，也不得超过上限
ALTER TABLE public.ai_tasks
  DROP CONSTRAINT IF EXISTS ai_tasks_retry_count_check;

ALTER TABLE public.ai_tasks
  ADD CONSTRAINT ai_tasks_retry_count_check
  CHECK (retry_count >= 0 AND retry_count <= max_retries);

-- 退款不能为负，也不能超过已扣
ALTER TABLE public.ai_tasks
  DROP CONSTRAINT IF EXISTS ai_tasks_credits_refunded_check;

ALTER TABLE public.ai_tasks
  ADD CONSTRAINT ai_tasks_credits_refunded_check
  CHECK (
    credits_refunded >= 0
    AND (credits_used IS NULL OR credits_refunded <= credits_used)
  );

-- ── 3. 轮询 / 重试所需的索引 ──────────────────────────────────────────────────

-- 找出需要轮询的进行中任务
CREATE INDEX IF NOT EXISTS idx_ai_tasks_polling
  ON public.ai_tasks(status, created_at)
  WHERE status = 'processing';

-- 找出到期可重试的任务
CREATE INDEX IF NOT EXISTS idx_ai_tasks_retry
  ON public.ai_tasks(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
-- 0004 已开启 RLS 并建了 SELECT / INSERT 策略。
-- 这里**不新增 UPDATE 策略**：
--   普通用户没有取消任务的入口（Phase 7 不做取消 UI），
--   所有状态推进都由服务端用 service_role 执行。
-- 这样正好满足规格 §27「普通用户只能访问自己的 task」且不关闭 RLS。
--
-- 若将来开放取消功能，再补：
--   CREATE POLICY "Users can cancel own ai tasks" ON public.ai_tasks
--     FOR UPDATE USING (auth.uid()::text = user_id::text)
--     WITH CHECK (status = 'cancelled');
