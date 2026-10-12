/**
 * Creem Payment Provider
 *
 * 只做三件事：创建支付会话 / 验证回调签名 / 把回调解析成统一事件。
 * 不碰订单、不碰积分、不碰订阅。
 *
 * Phase 9.2：**checkout 逻辑已内联**（原先委托 `@/lib/payment/creem`）。
 * 渠道产品 id 由 `getProviderProductId(pkg, 'creem')` 解析（配置里已定义），
 * 不再经过旧的硬编码映射表。
 *
 * ⚠️ 关于价格的一个重要事实
 * -------------------------
 * Creem 的扣款金额由 **Creem 后台配置的产品价格** 决定，
 * 我们在 `POST /checkouts` 里传的 `original_amount` 只是 metadata，不参与扣款。
 *
 * 因此对 Creem 而言，权威价格在 Creem 后台，`src/config/billing.ts` 的
 * `priceMinor` 必须与后台保持一致（用于展示与下单前校验）。
 * Stripe 则不同：我们用服务端金额动态创建 price_data，价格完全由我们控制。
 * 这个差异已记录在 docs/BILLING.md 的「价格真相」一节。
 */

import crypto from 'node:crypto'

import { getProviderProductId } from '@/config/billing'
import { readHeader } from '@/lib/billing/headers'
import type {
  CheckoutSession,
  CreateCheckoutParams,
  HeadersLike,
  NormalizedEventType,
  NormalizedPaymentEvent,
  PaymentProvider,
  WebhookVerification,
} from '@/lib/billing/types'

/** Creem 事件名 → 统一事件类型。未列出的视为 ignored。 */
const CREEM_EVENT_MAP: Record<string, NormalizedEventType> = {
  'checkout.completed': 'payment_succeeded',
  'checkout.failed': 'payment_failed',
  'checkout.cancelled': 'payment_cancelled',
}

export class CreemProvider implements PaymentProvider {
  readonly name = 'creem'

  isConfigured(): boolean {
    return Boolean(process.env.CREEM_API_URL && process.env.CREEM_API_KEY)
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    const { pkg } = params

    // 优先用配置里的渠道产品 id；没有则由业务 productId 兜底
    const providerProductId =
      getProviderProductId(pkg, this.name) ?? pkg.productId

    const session = await createCreemSession(params, providerProductId)

    if (!session.checkout_url) {
      throw new Error('Creem did not return a checkout URL')
    }

    return {
      sessionId: session.id,
      checkoutUrl: session.checkout_url,
      providerOrderId: session.id,
      raw: session,
    }
  }

  async verifyWebhook(
    rawBody: string,
    headers: HeadersLike
  ): Promise<WebhookVerification> {
    const secret = process.env.CREEM_WEBHOOK_SECRET

    if (!secret) {
      return { valid: false, reason: 'CREEM_WEBHOOK_SECRET is not configured' }
    }

    const signature =
      readHeader(headers, 'x-creem-signature') ??
      readHeader(headers, 'x-signature') ??
      readHeader(headers, 'signature')

    if (!signature) {
      return { valid: false, reason: 'missing signature header' }
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')

    return timingSafeCompare(expected, signature)
      ? { valid: true }
      : { valid: false, reason: 'signature mismatch' }
  }

  async parseWebhookEvent(
    rawBody: string,
    _headers: HeadersLike
  ): Promise<NormalizedPaymentEvent> {
    const event = JSON.parse(rawBody) as {
      id?: string
      type?: string
      data?: {
        id?: string
        amount?: number
        currency?: string
        metadata?: Record<string, unknown>
      }
    }

    const rawType = event.type ?? 'unknown'
    const sessionId = event.data?.id
    const type = CREEM_EVENT_MAP[rawType] ?? 'ignored'

    return {
      provider: this.name,
      // Creem 的事件 id 可能缺失，用「会话 + 类型」兜底合成，
      // 保证同一会话的同一类事件仍能被去重。
      eventId: event.id ?? `${sessionId ?? 'unknown'}:${rawType}`,
      type,
      rawType,
      sessionId,
      paymentId: sessionId,
      amountMinor:
        typeof event.data?.amount === 'number'
          ? Math.round(event.data.amount * 100)
          : undefined,
      currency: event.data?.currency,
      raw: event,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Checkout（Phase 9.2 内联自 `lib/payment/creem.ts`）
// ─────────────────────────────────────────────────────────────────────

interface CreemCheckoutResponse {
  id: string
  checkout_url: string
  status: string
  amount: number
  currency: string
  created_at: string
}

/**
 * 调用 Creem `POST /checkouts` 创建支付会话。
 *
 * 注意：`original_amount` 只写进 metadata，**不参与扣款**（金额由 Creem 后台决定）。
 */
async function createCreemSession(
  params: CreateCheckoutParams,
  providerProductId: string
): Promise<CreemCheckoutResponse> {
  const apiUrl = process.env.CREEM_API_URL
  const apiKey = process.env.CREEM_API_KEY

  if (!apiUrl || !apiKey) {
    throw new Error(
      'CREEM API configuration missing: check CREEM_API_URL and CREEM_API_KEY'
    )
  }

  const { pkg } = params

  const requestBody = {
    product_id: providerProductId,
    customer: {
      email: params.email,
      ...(params.customerName ? { name: params.customerName } : {}),
    },
    metadata: {
      user_id: params.userId,
      product_type: pkg.type,
      product_id: pkg.productId,
      product_name: pkg.name,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      packageId: pkg.id,
      billingCycle: pkg.billingCycle ?? 'one_time',
      expectedCredits: pkg.credits,
      // 仅用于记录，不参与扣款
      original_amount: params.amountMinor,
      original_currency: pkg.currency,
    },
    success_url: params.successUrl,
    request_id: crypto.randomUUID(),
    units: 1,
  }

  const response = await fetch(`${apiUrl}/checkouts`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      message?: string
    }
    throw new Error(errorData.message || `CREEM API error: ${response.status}`)
  }

  return (await response.json()) as CreemCheckoutResponse
}

/** 恒定时间比较，避免时序侧信道。长度不同直接判否。 */
function timingSafeCompare(expected: string, actual: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)

  if (a.length !== b.length) {
    return false
  }

  return crypto.timingSafeEqual(a, b)
}
