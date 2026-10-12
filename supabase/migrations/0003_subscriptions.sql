-- =============================================================================
-- 0003_subscriptions.sql — 订阅持久化收敛 + payment_configs 废弃
-- =============================================================================
-- 解决的问题（见 docs/DATABASE_AUDIT.md）：
--   A-3  subscriptions 在代码里完全走 mock，写不进库（由 Repository 侧修复）
--   A-9  payment_configs 表从未被代码读写；真实支付开关散落在
--        src/lib/config/payment.ts（硬编码）+ 环境变量 + 伪 Prisma 的 mock 对象，共三处真相
--
-- 本文件只做结构层的事：
--   1. subscriptions 的 provider 引用列通用化（与 orders 保持一致的做法）
--   2. payment_configs 标记废弃，并说明配置应归属哪一层
--
-- 明确不做（用户约束 §11 / §12 / §25）：
--   · 不实现任何 Stripe / Creem / LemonSqueezy 订阅逻辑
--   · 不接入新的支付 SDK
--   · 不重构 Payment Provider
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. subscriptions：provider 引用通用化
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider_subscription_id VARCHAR,
  ADD COLUMN IF NOT EXISTS provider_refs JSONB;

COMMENT ON COLUMN public.subscriptions.provider_subscription_id IS
  '支付渠道订阅 id。原 stripe_subscription_id / creem_subscription_id。';
COMMENT ON COLUMN public.subscriptions.provider_refs IS
  '渠道专属订阅字段（JSONB）。';

-- 回填：两个旧列里只有一个是有效的
UPDATE public.subscriptions
SET provider_subscription_id = COALESCE(stripe_subscription_id, creem_subscription_id)
WHERE provider_subscription_id IS NULL;

UPDATE public.subscriptions
SET provider_refs = jsonb_strip_nulls(jsonb_build_object(
  'stripe_subscription_id', stripe_subscription_id,
  'creem_subscription_id', creem_subscription_id
))
WHERE provider_refs IS NULL
  AND (stripe_subscription_id IS NOT NULL OR creem_subscription_id IS NOT NULL);

COMMENT ON COLUMN public.subscriptions.stripe_subscription_id IS
  'DEPRECATED：改用 provider_subscription_id。';
COMMENT ON COLUMN public.subscriptions.creem_subscription_id IS
  'DEPRECATED：改用 provider_subscription_id。';

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_provider_sub
  ON public.subscriptions(provider_subscription_id);

-- -----------------------------------------------------------------------------
-- 2. payment_configs：标记废弃
-- -----------------------------------------------------------------------------
-- 配置分层原则（本阶段确立，供后续阶段遵守）：
--   Secret / API Key        → 环境变量（永不入库）
--   支付渠道开关 / 映射      → 代码配置（src/config/*.ts 或 env）
--   产品套餐与价格           → 配置 + 代码常量（本阶段仍为 src/lib/config/payment.ts
--                             与 payment-security 的 STANDARD_PRICING，收敛见后续阶段）
--   订单状态                → 数据库（orders.status）
--
-- 结论：payment_configs 这种「一行配置表」对个人开发模板是多余的，
--       且当前代码从未读写它。按迁移安全要求（优先 DEPRECATE 而非 DROP），
--       本阶段保留表并标记废弃，待配置收敛完成后由后续迁移删除。
COMMENT ON TABLE public.payment_configs IS
  'DEPRECATED：支付开关应属于环境变量 / 代码配置，不属于数据库。当前无任何代码读写本表。';
