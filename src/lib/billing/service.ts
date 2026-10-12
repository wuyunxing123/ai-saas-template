/**
 * BillingService —— Billing 的编排核心
 *
 * 边界（用户约束 §9 / §17）：
 *
 *   PaymentProvider  只做「创建支付 / 验证回调 / 解析事件」
 *   BillingService   做「订单生命周期 + 编排」
 *   Fulfillment      做「按商品交付」
 *
 *   Provider ≠ Billing ≠ Credit ≠ Subscription
 *
 * 本文件是唯一允许：
 *   · 创建订单
 *   · 变更订单状态
 *   · 决定何时调用交付
 * 的地方。
 *
 * 价格真相（用户约束 §10 / §21）
 * ------------------------------
 * 本服务**从不读取**调用方传来的价格 / 积分数量。
 * 只接受 `packageId`（或旧的 `productId` + `billingCycle`），金额与积分从**已绑定的
 * 产品套餐表**查出（数据在 `src/lib/products/<id>/billing.ts`，查询机制在 `src/config/billing.ts`）。
 */

import {
  findBillingPackage,
  getBillingPackage,
  formatPriceMinor,
  type BillingPackage,
} from '@/config/billing'
import { fulfillOrder } from '@/lib/billing/fulfillment'
import {
  getPaymentProvider,
  resolveDefaultPaymentProvider,
} from '@/lib/billing/providers'
import type {
  CheckoutResult,
  HeadersLike,
  NormalizedPaymentEvent,
  WebhookHandleResult,
} from '@/lib/billing/types'
import * as orderRepo from '@/lib/db/repositories/order'
import * as webhookEventRepo from '@/lib/db/repositories/webhook-event'
import type { OrderRow } from '@/lib/db/types'
import { generateOrderNo } from '@/lib/utils/hash'

/** 未显式传幂等键时，用「同一用户 + 同一套餐 + 同一时间桶」兜底防重复点击。 */
const CHECKOUT_IDEMPOTENCY_WINDOW_MS = 60_000

export interface CreateCheckoutRequest {
  userId: string
  email: string
  /** 新接口使用：billing package id，例如 `creator` / `pro_monthly`。 */
  packageId?: string
  /** 兼容旧接口：业务产品 id + 周期。 */
  productId?: string
  billingCycle?: 'monthly' | 'yearly'
  /** 幂等键。推荐由客户端生成并复用（例如放在表单的 hidden field 里）。 */
  idempotencyKey?: string
  /** 指定支付渠道；不传则按默认策略解析。 */
  providerName?: string
  customerName?: string
  successUrl?: string
  cancelUrl?: string
}

export interface CheckoutUrls {
  successUrl: string
  cancelUrl: string
}

/** 解析套餐。**这是服务端价格的唯一入口。** */
function resolveRequestedPackage(request: CreateCheckoutRequest): BillingPackage {
  if (request.packageId) {
    return getBillingPackage(request.packageId)
  }

  if (request.productId) {
    const found = findBillingPackage(request.productId, request.billingCycle)

    if (!found) {
      throw new Error(
        `Unknown product "${request.productId}"` +
          (request.billingCycle ? ` with cycle "${request.billingCycle}"` : '')
      )
    }

    return found
  }

  throw new Error('Either packageId or productId is required')
}

function resolveCheckoutIdempotencyKey(
  request: CreateCheckoutRequest,
  pkg: BillingPackage
): string {
  if (request.idempotencyKey) {
    return request.idempotencyKey
  }

  const bucket = Math.floor(Date.now() / CHECKOUT_IDEMPOTENCY_WINDOW_MS)

  return `auto:${request.userId}:${pkg.id}:${bucket}`
}

function resolveUrls(request: CreateCheckoutRequest): CheckoutUrls {
  const base =
    process.env.NEXT_PUBLIC_WEB_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    'http://localhost:3000'

  return {
    successUrl: request.successUrl ?? `${base}/payment/success`,
    cancelUrl:
      request.cancelUrl ??
      process.env.NEXT_PUBLIC_PAY_CANCEL_URL ??
      `${base}/pricing`,
  }
}

/**
 * 创建 checkout。
 *
 * 流程：解析套餐（服务端价格）→ 幂等检查 → 建 pending 订单 →
 *       调用渠道创建支付 → 回写会话 id 与 checkout URL。
 */
export async function createCheckout(
  request: CreateCheckoutRequest
): Promise<CheckoutResult> {
  if (!request.userId) {
    throw new Error('userId is required')
  }

  // ── 1. 服务端解析套餐（忽略任何客户端传来的价格 / 积分） ─────────────
  const pkg = resolveRequestedPackage(request)

  if (pkg.priceMinor <= 0) {
    throw new Error(
      `Package "${pkg.id}" is free and cannot be purchased through checkout`
    )
  }

  const provider = request.providerName
    ? getPaymentProvider(request.providerName)
    : resolveDefaultPaymentProvider()

  if (!provider.isConfigured()) {
    throw new Error(`Payment provider "${provider.name}" is not configured`)
  }

  const idempotencyKey = resolveCheckoutIdempotencyKey(request, pkg)
  const urls = resolveUrls(request)

  // ── 2. 幂等：同一键已存在订单时复用 ─────────────────────────────────
  const existing = await orderRepo.findByIdempotencyKey(
    request.userId,
    idempotencyKey
  )

  if (existing) {
    if (existing.status === 'paid' || existing.status === 'completed') {
      throw new Error(
        `Order ${existing.order_number} is already paid — refusing to create a duplicate checkout`
      )
    }

    const storedUrl = readStoredCheckoutUrl(existing)

    if (storedUrl) {
      return toCheckoutResult(existing, pkg, provider.name, storedUrl, true)
    }

    // 上一次尝试在拿到 checkout URL 之前失败了：同一个订单再开一次渠道会话，
    // 保持「1 个幂等键 ↔ 1 张订单」不被破坏。
    const session = await provider.createCheckout({
      orderId: existing.id,
      orderNumber: existing.order_number,
      userId: request.userId,
      email: request.email,
      pkg,
      amountMinor: pkg.priceMinor,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
      customerName: request.customerName,
    })

    const updated = await orderRepo.update(existing.id, {
      provider_session_id: session.sessionId,
      metadata: withCheckoutUrl(existing.metadata, session.checkoutUrl),
    })

    return toCheckoutResult(updated, pkg, provider.name, session.checkoutUrl, true)
  }

  // ── 3. 创建 pending 订单 ───────────────────────────────────────────
  const orderNumber = generateOrderNo()

  const order = await orderRepo.create({
    user_id: request.userId,
    order_number: orderNumber,
    // DECIMAL 展示字段由整数金额派生，保证两者不会漂移
    amount: pkg.priceMinor / 100,
    amount_minor: pkg.priceMinor,
    currency: pkg.currency,
    status: 'pending',
    payment_provider: provider.name,
    product_type: pkg.type,
    product_id: pkg.productId,
    product_name: pkg.name,
    customer_email: request.email,
    package_id: pkg.id,
    idempotency_key: idempotencyKey,
    metadata: {
      billingCycle: pkg.billingCycle ?? 'one_time',
      expectedCredits: pkg.credits,
      displayPrice: formatPriceMinor(pkg.priceMinor, pkg.currency),
    },
  })

  // ── 4. 调用渠道创建支付 ────────────────────────────────────────────
  const session = await provider.createCheckout({
    orderId: order.id,
    orderNumber: order.order_number,
    userId: request.userId,
    email: request.email,
    pkg,
    amountMinor: pkg.priceMinor,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    customerName: request.customerName,
  })

  // ── 5. 回写渠道会话 id 与 checkout URL ─────────────────────────────
  const updated = await orderRepo.update(order.id, {
    provider_session_id: session.sessionId,
    metadata: withCheckoutUrl(order.metadata, session.checkoutUrl),
  })

  return toCheckoutResult(updated, pkg, provider.name, session.checkoutUrl, false)
}

/**
 * 处理支付渠道回调。
 *
 * 幂等三层：
 *   1. `webhook_events` 唯一约束 —— 抢占 (provider, event_id)
 *   2. `markPaidIfPending` —— 条件更新，只有第一个请求能推进状态
 *   3. `credit_grant:<order_id>` —— 积分发放自身的幂等键
 */
export async function handleWebhook(
  providerName: string,
  rawBody: string,
  headers: HeadersLike
): Promise<WebhookHandleResult> {
  const provider = getPaymentProvider(providerName)

  // ── 1. 验签 ───────────────────────────────────────────────────────
  const verification = await provider.verifyWebhook(rawBody, headers)

  if (!verification.valid) {
    console.warn(
      `🚫 Webhook rejected (${providerName}): ${verification.reason ?? 'invalid signature'}`
    )

    return {
      ok: false,
      duplicate: false,
      provider: providerName,
      eventId: '',
      eventType: 'ignored',
      error: `Webhook verification failed: ${verification.reason ?? 'invalid signature'}`,
    }
  }

  // ── 2. 解析事件 ───────────────────────────────────────────────────
  let event: NormalizedPaymentEvent

  try {
    event = await provider.parseWebhookEvent(rawBody, headers)
  } catch (error) {
    return {
      ok: false,
      duplicate: false,
      provider: providerName,
      eventId: '',
      eventType: 'ignored',
      error: `Failed to parse webhook payload: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    }
  }

  if (event.type === 'ignored') {
    // 验签通过但与本系统无关 —— 返回成功，避免渠道反复重试
    return {
      ok: true,
      duplicate: false,
      provider: providerName,
      eventId: event.eventId,
      eventType: 'ignored',
      note: `Event type "${event.rawType}" is not handled`,
    }
  }

  // ── 3. 定位订单 ───────────────────────────────────────────────────
  const order = event.sessionId
    ? await orderRepo.findByProviderSession(event.sessionId)
    : null

  // ── 4. 抢占事件（数据库级幂等） ────────────────────────────────────
  const claim = await webhookEventRepo.claim({
    provider: providerName,
    eventId: event.eventId,
    eventType: event.rawType,
    orderId: order?.id ?? null,
    payload: event.raw as Record<string, unknown>,
  })

  if (!claim.claimed) {
    console.log(
      `ℹ️ Duplicate webhook ignored: ${providerName}/${event.eventId} (${event.rawType})`
    )

    return {
      ok: true,
      duplicate: true,
      provider: providerName,
      eventId: event.eventId,
      eventType: event.type,
      orderId: order?.id,
      note: 'Event already processed',
    }
  }

  if (!order) {
    console.warn(
      `⚠️ Webhook ${providerName}/${event.eventId}: no order found for session ${event.sessionId ?? 'n/a'}`
    )

    return {
      ok: true,
      duplicate: false,
      provider: providerName,
      eventId: event.eventId,
      eventType: event.type,
      note: `No order found for session ${event.sessionId ?? 'n/a'}`,
    }
  }

  // ── 5. 按事件类型推进订单 ─────────────────────────────────────────
  try {
    return await applyEvent(event, order)
  } catch (error) {
    console.error(`❌ Webhook handling failed for order ${order.order_number}:`, error)

    return {
      ok: false,
      duplicate: false,
      provider: providerName,
      eventId: event.eventId,
      eventType: event.type,
      orderId: order.id,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

async function applyEvent(
  event: NormalizedPaymentEvent,
  order: OrderRow
): Promise<WebhookHandleResult> {
  const base = {
    duplicate: false,
    provider: event.provider,
    eventId: event.eventId,
    eventType: event.type,
    orderId: order.id,
  }

  switch (event.type) {
    case 'payment_succeeded': {
      // 条件更新：只有第一个请求能把订单从 pending 推到 paid
      const paidOrder = await orderRepo.markPaidIfPending(order.id)

      if (!paidOrder) {
        return {
          ...base,
          ok: true,
          note: `Order ${order.order_number} is already in status "${order.status}" — fulfillment skipped`,
        }
      }

      const fulfillment = await fulfillOrder(paidOrder)

      console.log(
        `✅ Order ${paidOrder.order_number} paid and fulfilled` +
          (fulfillment.skipped ? ' (fulfillment skipped)' : '')
      )

      return {
        ...base,
        ok: true,
        fulfilled: fulfillment.fulfilled,
        note: fulfillment.reason,
      }
    }

    case 'payment_failed': {
      const updated = await orderRepo.updateStatusIfPending(order.id, 'failed')

      return {
        ...base,
        ok: true,
        note: updated
          ? `Order ${order.order_number} marked failed`
          : `Order ${order.order_number} is "${order.status}" — not changed`,
      }
    }

    case 'payment_cancelled': {
      const updated = await orderRepo.updateStatusIfPending(order.id, 'cancelled')

      return {
        ...base,
        ok: true,
        note: updated
          ? `Order ${order.order_number} marked cancelled`
          : `Order ${order.order_number} is "${order.status}" — not changed`,
      }
    }

    case 'refunded': {
      // Phase 4 只记录状态，不做积分扣回（用户约束 §22）
      await orderRepo.update(order.id, { status: 'refunded' })

      console.log(
        `↩️ Order ${order.order_number} marked refunded. ` +
          'Credit clawback is NOT implemented in Phase 4.'
      )

      return {
        ...base,
        ok: true,
        note: 'Order marked refunded. Credit clawback is out of scope for Phase 4.',
      }
    }

    default:
      return { ...base, ok: true, note: 'Unhandled event type' }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 查询（用户只能看自己的订单 —— 用户约束 §19）
// ─────────────────────────────────────────────────────────────────────

/**
 * 列出当前用户的订单。
 *
 * 注意：查询强制带 `user_id` 条件，调用方无法通过传参绕过。
 */
export async function listOrders(
  userId: string,
  options: { limit?: number; skip?: number } = {}
): Promise<OrderRow[]> {
  return orderRepo.listByUser(userId, {
    limit: options.limit ?? 20,
    skip: options.skip,
  })
}

/**
 * 取单个订单。
 *
 * 权限在数据层强制：查的是 `(id, user_id)` 组合，
 * 别人的订单会直接查不到 —— 不依赖调用方做判断。
 */
export async function getOrder(
  userId: string,
  orderId: string
): Promise<OrderRow | null> {
  const order = await orderRepo.findById(orderId)

  if (!order || order.user_id !== userId) {
    return null
  }

  return order
}

// ─────────────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────────────

function readStoredCheckoutUrl(order: OrderRow): string | null {
  const url = order.metadata?.checkoutUrl

  return typeof url === 'string' && url.length > 0 ? url : null
}

function withCheckoutUrl(
  metadata: Record<string, unknown> | null,
  checkoutUrl: string
): Record<string, unknown> {
  return { ...(metadata ?? {}), checkoutUrl }
}

function toCheckoutResult(
  order: OrderRow,
  pkg: BillingPackage,
  providerName: string,
  checkoutUrl: string,
  reused: boolean
): CheckoutResult {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    checkoutUrl,
    sessionId: order.provider_session_id ?? '',
    provider: providerName,
    amountMinor: order.amount_minor ?? pkg.priceMinor,
    currency: order.currency ?? pkg.currency,
    credits: pkg.credits,
    reused,
  }
}

/** 供 API 层复用的门面。 */
export const BillingService = {
  createCheckout,
  handleWebhook,
  listOrders,
  getOrder,
}
