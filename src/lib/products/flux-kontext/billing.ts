/**
 * Flux Kontext 的套餐与渠道商品映射（Phase 9.8.2-C）
 *
 * 这份清单原先在 `src/config/billing.ts`（Core）里，包括 7 个套餐和 creem 商品 id ——
 * 那是「当前这个产品卖什么」，属于产品数据。Core 现在只提供形状
 * （`BillingPackage`）与查询机制（`getBillingPackage` / `listBillingPackages`）。
 *
 * 两类标识符刻意分开：
 *   · `id` / `productId`：**内部稳定标识符**，客户端只允许发送这些值。
 *   · `providerProductIds`：**支付渠道商品 id**（creem 侧的 `FluxKontext-Pro-Monthly`），
 *     只由服务端在调用渠道时使用，客户端不得发送，也不进任何前端内容。
 *
 * 绑定后由 `validateProductConfig()` 检查完整性（订阅必须有 planId + 周期，
 * 积分包反之，渠道商品 id 不得为空串）。
 */

import type { BillingPackage } from '@/config/billing'

/**
 * 所有可售套餐。
 *
 * 积分包沿用原有 id（starter / creator / business）以兼容现有 UI 与渠道映射；
 * 订阅包按「产品 + 周期」拆成独立 id，避免调用方还要单独传 billingCycle。
 */
export const FLUX_BILLING_PACKAGES: Record<string, BillingPackage> = {
  // ── 积分包（一次性） ──────────────────────────────────────────────
  starter: {
    id: 'starter',
    productId: 'starter',
    type: 'credit_pack',
    name: 'Starter Pack',
    currency: 'USD',
    priceMinor: 490, // $4.90
    credits: 600,
    providerProductIds: { creem: 'Starter Pack' },
  },
  creator: {
    id: 'creator',
    productId: 'creator',
    type: 'credit_pack',
    name: 'Creator Pack',
    currency: 'USD',
    priceMinor: 1500, // $15.00
    credits: 4000,
    providerProductIds: { creem: 'Creator Pack' },
  },
  business: {
    id: 'business',
    productId: 'business',
    type: 'credit_pack',
    name: 'Business Pack',
    currency: 'USD',
    priceMinor: 6000, // $60.00
    credits: 18000,
    providerProductIds: { creem: 'Business Pack' },
  },

  // ── 订阅（按期） ─────────────────────────────────────────────────
  plus_monthly: {
    id: 'plus_monthly',
    productId: 'plus',
    type: 'subscription',
    name: 'Plus · Monthly',
    currency: 'USD',
    priceMinor: 990, // $9.90
    credits: 1900,
    billingCycle: 'monthly',
    planId: 'plus',
    providerProductIds: { creem: 'FluxKontext-Plus-Monthly' },
  },
  plus_yearly: {
    id: 'plus_yearly',
    productId: 'plus',
    type: 'subscription',
    name: 'Plus · Yearly',
    currency: 'USD',
    priceMinor: 9900, // $99.00
    credits: 24000,
    billingCycle: 'yearly',
    planId: 'plus',
    providerProductIds: { creem: 'FluxKontext-Plus-Yearly' },
  },
  pro_monthly: {
    id: 'pro_monthly',
    productId: 'pro',
    type: 'subscription',
    name: 'Pro · Monthly',
    currency: 'USD',
    priceMinor: 2990, // $29.90
    credits: 8900,
    billingCycle: 'monthly',
    planId: 'pro',
    providerProductIds: { creem: 'FluxKontext-Pro-Monthly' },
  },
  pro_yearly: {
    id: 'pro_yearly',
    productId: 'pro',
    type: 'subscription',
    name: 'Pro · Yearly',
    currency: 'USD',
    priceMinor: 29900, // $299.00
    credits: 120000,
    billingCycle: 'yearly',
    planId: 'pro',
    providerProductIds: { creem: 'FluxKontext-Pro-Yearly' },
  },
}

/**
 * 免费档：不经过 checkout，只用于注册赠送与展示。
 *
 * `welcomeCredits = 100` 与 `src/lib/auth.ts` 的实际发放值同源（原先两处各自写死，
 * 一处 100、一处 10，定价页文案又写「10 credits per month」—— 三处互相矛盾）。
 * 免费档**没有**周期性发放；周期额度只存在于付费套餐里。
 */
export const FLUX_FREE_PLAN = {
  id: 'basic',
  name: 'Basic',
  currency: 'USD' as const,
  priceMinor: 0,
  welcomeCredits: 100,
}
