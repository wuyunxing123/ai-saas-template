-- =============================================================================
-- 0004_ai_tasks.sql — AI 生成任务的持久化承载
-- =============================================================================
-- 解决的问题（见 docs/DATABASE_AUDIT.md）：
--   A-11  generations 表存在但从未被任何代码读写
--        且字段不足：没有 provider / status / provider_task_id / 错误信息
--
-- 为什么需要 ai_tasks：
--   Phase 2 的 AIService 已经产生 taskId 概念（异步 Provider 提交后返回 task id），
--   但没有任何地方能把它落库。没有任务记录就无法做到：
--     · 失败退款可追溯（退款要知道是哪个任务失败）
--     · 幂等（同一任务不重复扣积分）
--     · 历史查询
--
-- 迁移策略：建 ai_tasks → 回填 generations → generations 标记废弃
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  -- 用哪个模型 / 哪家 Provider（对应 src/lib/ai/models.ts 与 AIProvider.name）
  model VARCHAR NOT NULL,
  provider VARCHAR NOT NULL,
  -- 任务状态：刻意保持简单，与 AI Core 的 AITaskState 对齐
  status VARCHAR NOT NULL DEFAULT 'pending',
  prompt TEXT,
  -- 输入 / 输出用 JSONB，避免把各家 Provider 的原始响应摊成核心字段
  input_metadata JSONB,
  output_metadata JSONB,
  -- 异步 Provider 返回的 task id（KIE / WaveSpeed / AtlasCloud / fal queue）
  provider_task_id VARCHAR,
  -- 幂等键：同一用户 + 同一键只允许一条任务
  idempotency_key VARCHAR,
  -- 关联的扣费流水，用于失败退款追溯
  credit_transaction_id UUID REFERENCES public.credit_transactions(id) ON DELETE SET NULL,
  credits_used INTEGER,
  error_code VARCHAR,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE public.ai_tasks IS
  'AI 生成任务记录。取代已废弃的 generations。';
COMMENT ON COLUMN public.ai_tasks.status IS
  'pending / processing / completed / failed / cancelled，与 AI Core 的 AITaskState 对齐。';
COMMENT ON COLUMN public.ai_tasks.output_metadata IS
  '生成结果元数据，例如 { "assets": [{ "url": "...", "width": 1024 }] }。';
COMMENT ON COLUMN public.ai_tasks.input_metadata IS
  '输入元数据，例如 { "inputImages": [...], "parameters": {...} }。';
COMMENT ON COLUMN public.ai_tasks.credit_transaction_id IS
  '本次任务对应的扣费流水。失败退款时据此定位原扣费记录。';
COMMENT ON COLUMN public.ai_tasks.idempotency_key IS
  '幂等键。前端重复提交 / 请求重试时复用同一个键，避免重复建任务与重复扣费。';

ALTER TABLE public.ai_tasks
  DROP CONSTRAINT IF EXISTS ai_tasks_status_check;

ALTER TABLE public.ai_tasks
  ADD CONSTRAINT ai_tasks_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled'));

-- -----------------------------------------------------------------------------
-- 回填 generations
-- -----------------------------------------------------------------------------
-- generations 有：id / user_id / prompt / model / credits_used / image_urls / settings / created_at
-- 它没有 provider，也没有 status —— 回填时标记为 'unknown' / 'completed'。
INSERT INTO public.ai_tasks (
  id, user_id, model, provider, status, prompt,
  input_metadata, output_metadata, credits_used,
  created_at, updated_at, completed_at
)
SELECT
  id,
  user_id,
  model,
  'unknown',
  'completed',
  prompt,
  settings,
  jsonb_strip_nulls(jsonb_build_object('image_urls', image_urls)),
  credits_used,
  created_at,
  created_at,
  created_at
FROM public.generations
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.generations IS
  'DEPRECATED：已由 public.ai_tasks 取代。保留仅为历史数据与回滚，不要新增写入。';

-- -----------------------------------------------------------------------------
-- 索引与触发器
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ai_tasks_user_created
  ON public.ai_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON public.ai_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_provider_task
  ON public.ai_tasks(provider, provider_task_id);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_credit_transaction
  ON public.ai_tasks(credit_transaction_id);

-- 幂等：同一用户 + 同一幂等键只允许一条任务
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_tasks_idempotency
  ON public.ai_tasks(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS update_ai_tasks_updated_at ON public.ai_tasks;
CREATE TRIGGER update_ai_tasks_updated_at
  BEFORE UPDATE ON public.ai_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.ai_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai tasks" ON public.ai_tasks;
CREATE POLICY "Users can view own ai tasks" ON public.ai_tasks
  FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can insert own ai tasks" ON public.ai_tasks;
CREATE POLICY "Users can insert own ai tasks" ON public.ai_tasks
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
