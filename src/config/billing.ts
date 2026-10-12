/**
 * Billing 查询与金额机制（Phase 9.8.2-C 起为**通用机制，不含套餐数据**）
 *
 * 原则（见 docs/BILLING.md）：
 *
 *   1. 前端只能传 `packageId`。价格、积分数量、货币一律由服务端查出，
 *      客户端传来的 price / credits / amount 一律忽略。
 *   2. 金额使用**整数最小单位**（美分），禁止浮点。
 *      `19.99 * 100` 在 JS 里可能得到 1998.9999999999998，这类误差在账务上不可接受。
 *   3. 套餐是**产品数据**：清单在 `src/lib/products/<id>/billing.ts`，
 *      经 `bindProductConfig()` 绑定。本文件只保留形状与查询机制，
 *      新增第二个产品不需要改这里。
 *   4. 未绑定产品配置 / 未知 packageId 一律抛错，绝不回退到某个默认套餐 ——
 *      静默回退会把一个错误的 packageId 变成一次真实的错误下单。
 *
 * 与旧实现的关系：
 *   原先定价散落在 4 处（`payment-security.STANDARD_PRICING`、
 *   `payment/creem.CREEM_PRODUCT_IDS`、`services/pricing.ts`、`user-tiers.pricingPlans`），
 *   Phase 4 统一到本文件的字面量；Phase 9.8.2-C 把字面量再下沉到产品目录，
 *   本文件改为读绑定的配置。接口（`getBillingPackage` 等）保持不变。
 */

import { getProductConfig } from '@/config/product'

/** 产品大类。刻意只有两种 —— 当前业务只有这两种交付形态。 */
export type BillingProductType = 'credit_pack' | 'subscription'

export type BillingCycle = 'monthly' | 'yearly'

export type BillingCurrency = 'USD'

export interface BillingPackage {
  /** 包 id，前端传给 checkout 的值。例如 `plus_monthly`。 */
  id: string
  /**
   * 业务产品 id，与 `orders.product_id` 对齐。
   * 保留它是为了兼容现有 UI 与数据库里已有的 `product_id` 值。
   */
  productId: string
  type: BillingProductType
  /** 展示名（英文，UI 层可覆盖）。 */
  name: string
  currency: BillingCurrency
  /** **整数最小单位**（美分）。$4.90 → 490。 */
  priceMinor: number
  /** credit_pack：一次性发放；subscription：每期发放。 */
  credits: number
  billingCycle?: BillingCycle
  /** subscription 专用：与 `subscriptions.plan_id` 对齐。 */
  planId?: string
  /**
   * 各**支付渠道**的商品 id（例如 creem 的 `FluxKontext-Pro-Monthly`）。
   *
   * 与上面的 `id` / `productId` 是两件事：那两个是内部稳定标识符，客户端只允许传它们；
   * 渠道商品 id 属于服务端到渠道的映射，客户端不得发送。
   * 没有映射的渠道会用服务端金额动态创建价格。
   */
  providerProductIds?: Record<string, string>
}

/** 按包 id 取定义。不存在则抛错（不静默回退 —— 静默回退会让错误的 packageId 变成一次真实下单）。 */
export function getBillingPackage(packageId: string): BillingPackage {
  const packages = getProductConfig().billingPackages
  const found = packages[packageId]

  if (!found) {
    throw new Error(
      `Unknown billing package "${packageId}" for product "${getProductConfig().productId}". ` +
        `Available: ${Object.keys(packages).join(', ')}`
    )
  }

  return found
}

/**
 * 按「产品 id + 周期」查找包。
 *
 * 这是给旧的 checkout 调用方（只传 productId + billingCycle）用的兼容入口。
 */
export function findBillingPackage(
  productId: string,
  billingCycle?: BillingCycle
): BillingPackage | null {
  const candidates = Object.values(getProductConfig().billingPackages).filter(
    (pkg) => pkg.productId === productId
  )

  if (candidates.length === 0) {
    return null
  }

  // 积分包没有周期概念
  const creditPack = candidates.find((pkg) => pkg.type === 'credit_pack')

  if (creditPack) {
    return creditPack
  }

  if (billingCycle) {
    return candidates.find((pkg) => pkg.billingCycle === billingCycle) ?? null
  }

  return candidates[0]
}

/** 列出所有可售套餐（可按类型过滤）。 */
export function listBillingPackages(type?: BillingProductType): BillingPackage[] {
  const all = Object.values(getProductConfig().billingPackages)
  return type ? all.filter((pkg) => pkg.type === type) : all
}

/** 取某渠道的产品 id；没有映射时返回 null（由调用方用服务端金额动态创建）。 */
export function getProviderProductId(
  pkg: BillingPackage,
  provider: string
): string | null {
  return pkg.providerProductIds?.[provider] ?? null
}

/**
 * 免费档。
 *
 * 取代原先的 `FREE_PLAN` 常量：数据在产品目录里，这里只是查询入口。
 * `welcomeCredits` 是全项目唯一的「注册赠送积分」数字。
 */
export function getFreePlan() {
  return getProductConfig().freePlan
}

// ─────────────────────────────────────────────────────────────────────
// 金额工具（全部基于整数最小单位，不出现浮点乘法）
// ─────────────────────────────────────────────────────────────────────

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW'])

/** 最小单位 → 展示用字符串。`490, 'USD'` → `"$4.90"`。 */
export function formatPriceMinor(
  priceMinor: number,
  currency: BillingCurrency = 'USD'
): string {
  const symbol = currency === 'USD' ? '$' : ''

  if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
    return `${symbol}${priceMinor}`
  }

  // 用整数除法与取模，避免 toFixed 背后的浮点误差
  const major = Math.trunc(priceMinor / 100)
  const minor = Math.abs(priceMinor % 100)

  return `${symbol}${major}.${String(minor).padStart(2, '0')}`
}

/**
 * 展示金额（美元字符串或数字）→ 最小单位。
 *
 * 只用于把**旧代码里的字面量**迁移过来，不要在请求路径上调用它 ——
 * 请求路径必须直接用 `priceMinor`。
 */
export function toMinorUnits(majorAmount: number): number {
  // 先转成字符串再解析，规避 19.99 * 100 = 1998.9999999999998
  const [whole, fraction = ''] = String(majorAmount).split('.')
  const padded = fraction.padEnd(2, '0').slice(0, 2)

  return Number(whole) * 100 + Number(padded) * (whole.startsWith('-') ? -1 : 1)
}
