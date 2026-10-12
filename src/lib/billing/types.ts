/**
 * Billing 类型契约
 *
 * 边界（见 docs/BILLING.md）：
 *
 *   PaymentProvider  只负责「创建支付 / 验证回调 / 解析事件」
 *   BillingService   负责「订单生命周期 + 编排」
 *   Fulfillment      负责「按商品交付（发积分 / 开订阅）」
 *
 *   Provider ≠ Billing ≠ Credit ≠ Subscription
 *
 * Provider **不**碰订单状态、不碰积分、不碰订阅、不碰 users ——
 * 它只把渠道的支付事实翻译成统一事件。
 */

import type { BillingPackage } from '@/config/billing'

export type HeadersLike = Headers | Record<string, string | undefined>

// ─────────────────────────────────────────────────────────────────────
// Checkout
// ─────────────────────────────────────────────────────────────────────

export interface CreateCheckoutParams {
  /** 内部订单 id，会写进渠道 metadata，便于回调时定位。 */
  orderId: string
  orderNumber: string
  userId: string
  email: string
  /** 服务端解析出来的套餐（价格真相）。 */
  pkg: BillingPackage
  /** 最小货币单位（美分）。 */
  amountMinor: number
  successUrl: string
  cancelUrl: string
  customerName?: string
}

export interface CheckoutSession {
  /** 渠道会话 id —— webhook 靠它定位订单。 */
  sessionId: string
  checkoutUrl: string
  /** 渠道侧订单 id（可选）。 */
  providerOrderId?: string
  raw?: unknown
}

// ─────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────

export interface WebhookVerification {
  valid: boolean
  reason?: string
}

/**
 * 归一化后的支付事件类型。
 *
 * 只有这几种 —— 渠道各自的事件名差异由 Provider 消化掉。
 * `ignored` 表示「验签通过但与本系统无关」，调用方应直接返回成功以免渠道重试。
 */
export type NormalizedEventType =
  | 'payment_succeeded'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'refunded'
  | 'ignored'

export interface NormalizedPaymentEvent {
  provider: string
  /** 渠道事件的唯一 id，Webhook 幂等依据。缺失时由 Provider 用 sessionId+type 兜底合成。 */
  eventId: string
  type: NormalizedEventType
  /** 渠道原始事件名，仅用于日志。 */
  rawType: string
  /** 渠道会话 id → 用于定位内部订单。 */
  sessionId?: string
  /** 渠道支付/流水 id。 */
  paymentId?: string
  /** 事件声明的金额（最小单位）。仅用于核对，不作为定价依据。 */
  amountMinor?: number
  currency?: string
  /** 渠道订阅 id（订阅类事件）。 */
  providerSubscriptionId?: string
  raw: unknown
}

// ─────────────────────────────────────────────────────────────────────
// Provider 契约
// ─────────────────────────────────────────────────────────────────────

export interface PaymentProvider {
  readonly name: string

  /** 配置是否完整（缺 key 时应明确返回 false，而不是在调用时抛错）。 */
  isConfigured(): boolean

  /** 创建支付会话。 */
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession>

  /** 验证回调签名。 */
  verifyWebhook(rawBody: string, headers: HeadersLike): Promise<WebhookVerification>

  /** 解析回调为统一事件。调用方应先 `verifyWebhook`。 */
  parseWebhookEvent(
    rawBody: string,
    headers: HeadersLike
  ): Promise<NormalizedPaymentEvent>
}

// ─────────────────────────────────────────────────────────────────────
// Billing 结果类型
// ─────────────────────────────────────────────────────────────────────

export interface CheckoutResult {
  orderId: string
  orderNumber: string
  checkoutUrl: string
  sessionId: string
  provider: string
  amountMinor: number
  currency: string
  credits: number
  /** 幂等命中：返回的是已存在的订单，未新建。 */
  reused: boolean
}

export interface WebhookHandleResult {
  ok: boolean
  /** 该事件此前已处理过。 */
  duplicate: boolean
  provider: string
  eventId: string
  eventType: NormalizedEventType
  orderId?: string
  /** 本次是否真的执行了交付。 */
  fulfilled?: boolean
  /** 交付结果说明（幂等命中 / 未找到订单 等）。 */
  note?: string
  error?: string
}
