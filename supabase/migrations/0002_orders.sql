-- =============================================================================
-- 0002_orders.sql — 统一订单模型（orders 成为唯一订单表）
-- =============================================================================
-- 解决的问题（见 docs/DATABASE_AUDIT.md §7）：
--   A-1  订单表双轨：create-checkout 写 payment_orders，而 webhook 处理链
--        通过伪 Prisma 适配器读 orders —— 而 orders 在 SQL 中根本不存在。
--        结果：用户支付成功后系统找不到订单，积分与订阅都发不出去。
--   A-6  适配器写 payment_details 列（不存在），且漏写三个 NOT NULL 列。
--
-- 结论：orders 与 payment_orders 是**同一个业务概念的两个名字**，不是
--       「业务订单 vs 支付渠道交易」。证据见审计报告 §7。
--       因此统一为 orders。
--
-- 关于 Order 与 Payment Transaction 的关系：
--   Order            = 用户为某个产品下的一笔订单（业务概念，本表）
--   Payment Transaction = 支付渠道的一次资金流水（渠道概念）
--   当前业务是一对一（一次下单 → 一次支付），且代码里没有任何地方需要
--   单独记录渠道流水，因此**不单独建表**（避免为架构完整而建无人使用的表）。
--   渠道侧标识通过 provider_session_id / provider_payment_id / provider_refs 承载。
--   将来出现「一次订单多次支付（重试/部分支付/退款流水）」时再拆表。
--
-- 迁移策略（遵循 ADD → BACKFILL → MIGRATE → VERIFY → DEPRECATE）：
--   1. 建 orders（通用 provider 引用列）
--   2. 从 payment_orders 回填
--   3. 把 credit_transactions 的订单引用补到 orders
--   4. payment_orders 保留但标记废弃（不 DROP，避免丢失历史数据）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 建 orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  order_number VARCHAR UNIQUE NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR NOT NULL DEFAULT 'pending',
  payment_provider VARCHAR NOT NULL,
  product_type VARCHAR NOT NULL,
  product_id VARCHAR NOT NULL,
  product_name VARCHAR NOT NULL,
  customer_email VARCHAR NOT NULL,
  -- 通用化：不再把某个支付平台的名字写进列名
  provider_session_id VARCHAR,
  provider_payment_id VARCHAR,
  -- provider 专属字段统一放这里，避免每接一家支付就加列
  provider_refs JSONB,
  paid_at TIMESTAMP WITH TIME ZONE,
  -- 订单失效时间。原代码（services/order.ts、payment-database.getExpiredOrders）
  -- 已经在用 expiredAt，但 schema 里从来没有这一列 —— 补上，让订单清理功能真正可用。
  expired_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.orders IS
  '产品业务订单（唯一订单表）。由 payment_orders 迁移而来。';
COMMENT ON COLUMN public.orders.provider_session_id IS
  '支付渠道会话 id。原 stripe_session_id / creem_checkout_id。';
COMMENT ON COLUMN public.orders.provider_payment_id IS
  '支付渠道流水 id。原 stripe_payment_intent_id / creem_payment_id。';
COMMENT ON COLUMN public.orders.provider_refs IS
  '渠道专属原始字段（JSONB），用于保留各支付平台的扩展信息。';

-- 状态词表：显式约束，避免出现拼写不一致的状态值
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'pending', 'created', 'completed', 'failed',
    'refunded', 'cancelled', 'expired'
  ));

-- -----------------------------------------------------------------------------
-- 2. 从 payment_orders 回填
-- -----------------------------------------------------------------------------
-- 使用 jsonb_strip_nulls 只保留真正有值的渠道字段。
-- ON CONFLICT (id) DO NOTHING 让本语句可重复执行。
INSERT INTO public.orders (
  id, user_id, order_number, amount, currency, status, payment_provider,
  product_type, product_id, product_name, customer_email,
  provider_session_id, provider_payment_id, provider_refs,
  paid_at, metadata, created_at, updated_at
)
SELECT
  id,
  user_id,
  order_number,
  amount,
  currency,
  status,
  payment_provider,
  product_type,
  product_id,
  product_name,
  customer_email,
  COALESCE(stripe_session_id, creem_checkout_id),
  COALESCE(stripe_payment_intent_id, creem_payment_id),
  jsonb_strip_nulls(jsonb_build_object(
    'stripe_session_id', stripe_session_id,
    'stripe_payment_intent_id', stripe_payment_intent_id,
    'creem_checkout_id', creem_checkout_id,
    'creem_payment_id', creem_payment_id
  )),
  paid_at,
  metadata,
  created_at,
  updated_at
FROM public.payment_orders
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. credit_transactions 的订单引用指向 orders
-- -----------------------------------------------------------------------------
ALTER TABLE public.credit_transactions
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.credit_transactions.order_id IS
  '关联的业务订单。取代已废弃的 payment_order_id。';

UPDATE public.credit_transactions
SET order_id = payment_order_id
WHERE order_id IS NULL AND payment_order_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 4. payment_orders 标记废弃（保留数据，不再写入）
-- -----------------------------------------------------------------------------
COMMENT ON TABLE public.payment_orders IS
  'DEPRECATED：已由 public.orders 取代。保留仅为历史数据与回滚，不要新增写入。';

-- -----------------------------------------------------------------------------
-- 5. 索引与触发器
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_provider_session ON public.orders(provider_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_order_id ON public.credit_transactions(order_id);

DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 6. RLS（与既有表保持一致：用户只能看自己的订单）
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT USING (auth.uid()::text = user_id::text);
