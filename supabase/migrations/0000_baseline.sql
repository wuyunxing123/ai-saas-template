-- =============================================================================
-- 0000_baseline.sql — 当前 schema 快照（BASELINE）
-- =============================================================================
-- 作用：把「Phase 3 之前线上数据库的实际状态」固化成可重复执行的版本化文件。
--
-- 来源：scripts/setup-database.sql（原先唯一且不可重复执行的建表脚本）。
--
-- 本文件刻意保留当前的全部设计（包括已知缺陷），因为它的职责是「描述现状」，
-- 而不是「修正现状」。修正由 0001 之后的迁移负责。
--
-- 已知且被刻意保留的问题：
--   · payment_orders 表（0002 会统一为 orders）
--   · credit_transactions.type CHECK 不允许 'gift'（0001 修正）
--   · generations 表无人使用（0004 会被 ai_tasks 取代）
--   · payment_configs 表无人使用（0003 会标记废弃）
--
-- 与 setup-database.sql 的差异：全部改为幂等
--   · CREATE TRIGGER  → DROP TRIGGER IF EXISTS + CREATE TRIGGER
--   · CREATE POLICY   → DROP POLICY IF EXISTS + CREATE POLICY
--   · INSERT ... ON CONFLICT 保持不变
--   这样本文件可以重复执行而不报错。
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  name VARCHAR,
  image VARCHAR,
  credits INTEGER DEFAULT 100,
  location VARCHAR,
  last_signin_at TIMESTAMP WITH TIME ZONE,
  signin_count INTEGER DEFAULT 0,
  signin_type VARCHAR,
  signin_provider VARCHAR,
  signin_openid VARCHAR,
  signin_ip VARCHAR,
  preferred_currency VARCHAR DEFAULT 'USD',
  preferred_payment_provider VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- payment_orders（0002 会被 orders 取代）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_orders (
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
  stripe_session_id VARCHAR,
  stripe_payment_intent_id VARCHAR,
  creem_checkout_id VARCHAR,
  creem_payment_id VARCHAR,
  paid_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- credit_transactions（0001 会扩展为完整模型）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type VARCHAR NOT NULL CHECK (type IN ('purchase', 'usage', 'refund', 'bonus')),
  description TEXT,
  payment_order_id UUID REFERENCES public.payment_orders(id),
  reference_id VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- subscriptions（0003 会通用化 provider 引用列）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'cancelled')),
  billing_cycle VARCHAR NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  payment_provider VARCHAR NOT NULL,
  stripe_subscription_id VARCHAR,
  creem_subscription_id VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- payment_configs（0003 会标记废弃：配置应属于 env / config）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_enabled BOOLEAN DEFAULT false,
  creem_enabled BOOLEAN DEFAULT false,
  default_provider VARCHAR DEFAULT 'stripe',
  maintenance_mode BOOLEAN DEFAULT false,
  last_updated_by VARCHAR NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- generations（0004 会由 ai_tasks 取代）
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  model VARCHAR NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 1,
  image_urls TEXT[],
  settings JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 索引
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON public.payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON public.payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON public.credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_generations_user_id ON public.generations(user_id);

-- -----------------------------------------------------------------------------
-- updated_at 自动维护
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON public.payment_orders;
CREATE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_credit_transactions_updated_at ON public.credit_transactions;
CREATE TRIGGER update_credit_transactions_updated_at
  BEFORE UPDATE ON public.credit_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_configs_updated_at ON public.payment_configs;
CREATE TRIGGER update_payment_configs_updated_at
  BEFORE UPDATE ON public.payment_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 种子数据
-- -----------------------------------------------------------------------------
INSERT INTO public.payment_configs (
  stripe_enabled,
  creem_enabled,
  default_provider,
  maintenance_mode,
  last_updated_by,
  notes
) VALUES (
  true,
  false,
  'stripe',
  false,
  'system',
  'Initial payment configuration'
) ON CONFLICT DO NOTHING;

INSERT INTO public.users (email, name, credits, signin_provider, signin_type)
VALUES ('test@example.com', 'Test User', 1000, 'credentials', 'test')
ON CONFLICT (email) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own data" ON public.users;
CREATE POLICY "Users can view own data" ON public.users
  FOR SELECT USING (auth.uid()::text = id::text);

DROP POLICY IF EXISTS "Users can update own data" ON public.users;
CREATE POLICY "Users can update own data" ON public.users
  FOR UPDATE USING (auth.uid()::text = id::text);

DROP POLICY IF EXISTS "Users can view own orders" ON public.payment_orders;
CREATE POLICY "Users can view own orders" ON public.payment_orders
  FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can view own transactions" ON public.credit_transactions;
CREATE POLICY "Users can view own transactions" ON public.credit_transactions
  FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can view own generations" ON public.generations;
CREATE POLICY "Users can view own generations" ON public.generations
  FOR SELECT USING (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "Users can insert own generations" ON public.generations;
CREATE POLICY "Users can insert own generations" ON public.generations
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);
