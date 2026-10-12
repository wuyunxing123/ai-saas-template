-- -----------------------------------------------------------------------------
-- 0008：Admin 操作审计日志
--
-- 记录「谁 对谁 做了什么 为什么 什么时候」。
-- 不记录密码 / token / secret / 完整 request body。
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 操作者（admin 用户）
  admin_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- 操作类型，例如 credit_grant / role_change
  action VARCHAR NOT NULL,
  -- 操作目标用户
  target_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- 目标对象类型与 id（可选，例如 order / subscription）
  target_type VARCHAR,
  target_id VARCHAR,
  -- 数值型变更（如积分数量）
  amount INTEGER,
  -- 操作原因（必填于 credit 调整）
  reason TEXT,
  -- 附加信息（不要放敏感数据）
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.admin_audit_logs IS
  'Admin 敏感操作审计日志。记录 谁/对谁/做了什么/为什么/什么时候。';

COMMENT ON COLUMN public.admin_audit_logs.action IS
  '操作类型：credit_grant / role_change 等。';

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
  ON public.admin_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_user
  ON public.admin_audit_logs (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target_user
  ON public.admin_audit_logs (target_user_id, created_at DESC);
