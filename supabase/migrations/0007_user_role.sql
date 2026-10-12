-- -----------------------------------------------------------------------------
-- 0007：添加 user.role 字段，为 Admin 做准备
-- -----------------------------------------------------------------------------

-- 1. 添加 role 列（默认 user）
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'user';

-- 2. 确保已有数据的 role 不为空
UPDATE public.users
  SET role = 'user'
  WHERE role IS NULL;

-- 3. 简单约束：只允许 user / admin
-- 注意：如果未来需要更多角色，先 drop 再重建约束
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_users_role'
    AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT chk_users_role
      CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.role IS
  '用户角色：user（普通用户）/ admin（管理员）。Phase 6.5 Admin 的前置字段。';
