/**
 * Order Fulfillment Service
 *
 * 职责：**根据订单的商品执行交付**。
 *
 *   credit_pack   → 发放积分
 *   subscription  → 开通/续期订阅 + 发放本期积分
 *   其他          → 明确失败（不要静默跳过，否则会出现「付了钱什么都没拿到」）
 *
 * 边界（用户约束 §13）：
 *   Webhook **不直接**写 `users.credits`。
 *   交付统一经过这里 —— 这是全项目唯一调用 `grantCredits` 的地方。
 *
 * 幂等（两层，缺一不可）
 * ----------------------
 *   第 1 层：`BillingService` 用 `order.markPaidIfPending()` 保证只有一个请求
 *            能把订单从 pending 推到 paid；推不动的那个直接跳过交付。
 *   第 2 层：积分发放用 `credit_grant:<order_id>` 作为幂等键 ——
 *            即使第 1 层被绕过，同一订单也只会发一次积分。
 *   订阅侧：用订单的 provider session id 作为订阅的渠道 id，
 *            重复调用只会更新周期，不会创建第二条订阅。
 */

import { getBillingPackage, findBillingPackage, type BillingPackage } from '@/config/billing'
import * as creditRepo from '@/lib/db/repositories/credit'
import * as subscriptionRepo from '@/lib/db/repositories/subscription'
import type { OrderRow } from '@/lib/db/types'

export interface FulfillmentResult {
  /** 本次是否真的执行了交付。 */
  fulfilled: boolean
  /** 是否因为「已交付过」而跳过。 */
  skipped: boolean
  reason?: string
  creditsGranted?: number
  creditTransactionId?: string | null
  subscriptionId?: string
}

/**
 * 执行订单交付。
 *
 * 调用方必须已经确认订单处于 `paid` 状态（通常由 `markPaidIfPending` 返回的行保证）。
 */
export async function fulfillOrder(order: OrderRow): Promise<FulfillmentResult> {
  // ── 0. 已交付过 → 跳过（幂等第 1 层之外的兜底） ──────────────────────
  if (order.fulfilled_at) {
    return {
      fulfilled: false,
      skipped: true,
      reason: `Order ${order.order_number} was already fulfilled at ${order.fulfilled_at}`,
    }
  }

  if (!order.user_id) {
    throw new Error(
      `Order ${order.order_number} has no user_id — cannot fulfill`
    )
  }

  const pkg = resolvePackage(order)

  switch (pkg.type) {
    case 'credit_pack': {
      const granted = await grantOrderCredits(order, pkg)

      await orderRepoMarkFulfilled(order.id)

      return {
        fulfilled: true,
        skipped: false,
        creditsGranted: pkg.credits,
        creditTransactionId: granted,
      }
    }

    case 'subscription': {
      const granted = await grantOrderCredits(order, pkg)
      const subscriptionId = await activateSubscription(order, pkg)

      await orderRepoMarkFulfilled(order.id)

      return {
        fulfilled: true,
        skipped: false,
        creditsGranted: pkg.credits,
        creditTransactionId: granted,
        subscriptionId,
      }
    }

    default: {
      // 不静默跳过 —— 「付了钱但没有任何交付」必须显式暴露
      const exhaustive: never = pkg.type
      throw new Error(
        `Unsupported product type "${exhaustive}" for order ${order.order_number}`
      )
    }
  }
}

/**
 * 解析订单对应的套餐。
 *
 * 优先用 `order.package_id`（下单时记录的快照）；
 * 老订单没有该字段时按 `product_id` 回退查找。
 */
export function resolvePackage(order: OrderRow): BillingPackage {
  if (order.package_id) {
    try {
      return getBillingPackage(order.package_id)
    } catch {
      // package_id 指向的套餐可能已下架 —— 回退到按 product_id 查找
    }
  }

  const cycle =
    (order.metadata?.billingCycle as 'monthly' | 'yearly' | undefined) ?? undefined

  const fallback = findBillingPackage(order.product_id, cycle)

  if (!fallback) {
    throw new Error(
      `Cannot resolve billing package for order ${order.order_number} ` +
        `(package_id=${order.package_id ?? 'null'}, product_id=${order.product_id})`
    )
  }

  return fallback
}

/**
 * 发放订单积分。返回流水 id。
 *
 * 幂等键固定为 `credit_grant:<order_id>` —— 同一订单无论被调用多少次，
 * 都只会成功发放一次。
 */
async function grantOrderCredits(
  order: OrderRow,
  pkg: BillingPackage
): Promise<string | null> {
  if (pkg.credits <= 0) {
    return null
  }

  const result = await creditRepo.grantCredits({
    user_id: order.user_id as string,
    amount: pkg.credits,
    idempotency_key: creditGrantKey(order.id),
    type: 'purchase',
    description: `Order ${order.order_number} · ${pkg.name}`,
    reference_type: 'order',
    reference_id: order.order_number,
    order_id: order.id,
    metadata: {
      packageId: pkg.id,
      provider: order.payment_provider,
      amountMinor: order.amount,
      currency: order.currency,
    },
  })

  if (result.status !== 'ok' && result.status !== 'duplicate') {
    throw new Error(
      `Credit grant failed for order ${order.order_number}: ${result.status}`
    )
  }

  if (result.idempotent) {
    console.log(
      `ℹ️ Credits already granted for order ${order.order_number} (idempotent hit)`
    )
  }

  return result.transactionId
}

/** 订单的积分发放幂等键。格式固定，便于排查。 */
export function creditGrantKey(orderId: string): string {
  return `credit_grant:${orderId}`
}

/**
 * 开通或续期订阅。
 *
 * 幂等：以订单的渠道会话 id 作为订阅的 `provider_subscription_id` 去查，
 * 已存在则只更新周期，不会创建第二条订阅。
 */
async function activateSubscription(
  order: OrderRow,
  pkg: BillingPackage
): Promise<string> {
  const userId = order.user_id as string
  const now = new Date()
  const periodStart = now.toISOString()
  const periodEnd = computePeriodEnd(now, pkg.billingCycle ?? 'monthly').toISOString()
  const planId = pkg.planId ?? pkg.productId

  const existing = order.provider_session_id
    ? await subscriptionRepo.findByProviderSubscription(order.provider_session_id)
    : null

  if (existing) {
    const updated = await subscriptionRepo.update(existing.id, {
      plan_id: planId,
      status: 'active',
      billing_cycle: pkg.billingCycle ?? 'monthly',
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })

    return updated.id
  }

  const created = await subscriptionRepo.create({
    user_id: userId,
    plan_id: planId,
    payment_provider: order.payment_provider,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    status: 'active',
    billing_cycle: pkg.billingCycle ?? 'monthly',
    provider_subscription_id: order.provider_session_id,
    provider_refs: { orderId: order.id, orderNumber: order.order_number },
  })

  return created.id
}

/** 按周期推算本期结束时间。只做基础周期，不做 proration（用户约束 §16）。 */
export function computePeriodEnd(
  start: Date,
  cycle: 'monthly' | 'yearly'
): Date {
  const end = new Date(start)

  if (cycle === 'yearly') {
    end.setUTCFullYear(end.getUTCFullYear() + 1)
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1)
  }

  return end
}

/** 单独抽出以便测试替换；避免 fulfillment 直接依赖 order repository 的全部能力。 */
async function orderRepoMarkFulfilled(orderId: string): Promise<void> {
  const { markFulfilled } = await import('@/lib/db/repositories/order')
  await markFulfilled(orderId)
}
