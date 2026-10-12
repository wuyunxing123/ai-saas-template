/**
 * Stripe Payment Provider
 *
 * 与 Creem 的差异（重要）：
 *   Stripe 使用**服务端金额**动态创建 price_data，因此扣款金额完全由
 *   `src/config/billing.ts` 的 `priceMinor` 控制 —— 不存在「后台价格与配置不一致」的问题。
 *   Creem 则相反，扣款金额由 Creem 后台产品决定。
 *
 * Phase 9.2：**checkout 逻辑已内联**（原先委托 `@/lib/payment/stripe`）。
 * 本 Provider 现在完全自包含：创建支付会话 / 验证回调 / 解析事件。
 *
 * 金额单位（⚠️ 曾经的 bug）
 * ------------------------
 * `pkg.priceMinor` 与 `params.amountMinor` **已经是渠道最小单位（美分）**，
 * 因此直接作为 `unit_amount`，**不得**再乘 100。
 * （旧实现经 `formatAmountForProvider` 二次换算，导致 Stripe 金额放大 100 倍；
 *  见 docs/PHASE_9_2_AUDIT.md §5。）
 */

import type Stripe from 'stripe'

import { getStripeClient, isStripeAvailable } from '@/lib/stripe-client'
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

const STRIPE_EVENT_MAP: Record<string, NormalizedEventType> = {
  'checkout.session.completed': 'payment_succeeded',
  'checkout.session.async_payment_succeeded': 'payment_succeeded',
  'checkout.session.expired': 'payment_cancelled',
  'payment_intent.payment_failed': 'payment_failed',
  'charge.refunded': 'refunded',
}

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe'

  isConfigured(): boolean {
    return isStripeAvailable()
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    const session = await createStripeSession(params)

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL')
    }

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      raw: session,
    }
  }

  async verifyWebhook(
    rawBody: string,
    headers: HeadersLike
  ): Promise<WebhookVerification> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET

    if (!secret) {
      return { valid: false, reason: 'STRIPE_WEBHOOK_SECRET is not configured' }
    }

    const signature = readHeader(headers, 'stripe-signature')

    if (!signature) {
      return { valid: false, reason: 'missing stripe-signature header' }
    }

    try {
      // constructEvent 会校验签名并顺带解析；解析结果在 parseWebhookEvent 里再用一次
      getStripeClient().webhooks.constructEvent(rawBody, signature, secret)
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : 'signature verification failed',
      }
    }
  }

  async parseWebhookEvent(
    rawBody: string,
    _headers: HeadersLike
  ): Promise<NormalizedPaymentEvent> {
    const event = JSON.parse(rawBody) as Stripe.Event
    const rawType = event.type ?? 'unknown'
    const type = STRIPE_EVENT_MAP[rawType] ?? 'ignored'

    const object = event.data?.object as
      | (Stripe.Checkout.Session & { payment_intent?: string | Stripe.PaymentIntent })
      | undefined

    const sessionId =
      typeof object?.id === 'string' && rawType.startsWith('checkout.')
        ? object.id
        : undefined

    const paymentId =
      typeof object?.payment_intent === 'string'
        ? object.payment_intent
        : (object?.payment_intent?.id ?? undefined)

    const subscriptionId =
      typeof (object as { subscription?: unknown } | undefined)?.subscription === 'string'
        ? ((object as { subscription: string }).subscription)
        : undefined

    return {
      provider: this.name,
      // Stripe 的 event.id 是稳定且唯一的，直接用它做幂等键
      eventId: event.id ?? `${sessionId ?? 'unknown'}:${rawType}`,
      type,
      rawType,
      sessionId,
      paymentId,
      amountMinor:
        typeof object?.amount_total === 'number' ? object.amount_total : undefined,
      currency: object?.currency?.toUpperCase(),
      providerSubscriptionId: subscriptionId,
      raw: event,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Checkout（Phase 9.2 内联自 `lib/payment/stripe.ts`）
// ─────────────────────────────────────────────────────────────────────

/** 按货币挑选可用的支付方式。 */
function getPaymentMethodsForCurrency(
  currency: string
): Stripe.Checkout.SessionCreateParams.PaymentMethodType[] {
  const base: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = ['card']

  switch (currency.toUpperCase()) {
    case 'CNY':
      return [...base, 'wechat_pay', 'alipay']
    case 'USD':
    case 'EUR':
    case 'GBP':
      return [...base, 'link']
    default:
      return base
  }
}

/**
 * 创建 Stripe Checkout 会话。
 *
 * `params.amountMinor` 已是渠道最小单位（美分），直接作为 `unit_amount`。
 */
async function createStripeSession(
  params: CreateCheckoutParams
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient()
  const { pkg } = params
  const isSubscription = pkg.type === 'subscription'

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    payment_method_types: getPaymentMethodsForCurrency(pkg.currency),
    line_items: [
      {
        price_data: {
          currency: pkg.currency.toLowerCase(),
          product_data: {
            name: pkg.name,
            description: `${params.orderNumber} · ${pkg.credits} credits`,
          },
          // 已是最小单位，不再二次换算
          unit_amount: params.amountMinor,
          ...(isSubscription
            ? { recurring: { interval: pkg.billingCycle === 'yearly' ? 'year' : 'month' } }
            : {}),
        },
        quantity: 1,
      },
    ],
    mode: isSubscription ? 'subscription' : 'payment',
    customer_email: params.email,
    metadata: {
      userId: params.userId,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      productType: pkg.type,
      productId: pkg.productId,
      packageId: pkg.id,
      billingCycle: pkg.billingCycle ?? 'one_time',
      expectedCredits: pkg.credits,
      ...(params.customerName ? { customerName: params.customerName } : {}),
    },
    success_url: `${params.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
  }

  // 为中国用户补充本地支付方式（与 payment_method_types 并存）
  if (pkg.currency.toUpperCase() === 'CNY') {
    sessionParams.payment_method_options = {
      wechat_pay: { client: 'web' },
      alipay: {},
    }
  }

  return stripe.checkout.sessions.create(sessionParams)
}
