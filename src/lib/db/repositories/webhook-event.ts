/**
 * Webhook Event Repository
 *
 * 只做数据操作。**不负责**判断「这个事件该不该发积分」——
 * 那是 BillingService / Fulfillment 的职责。
 *
 * 幂等原理
 * --------
 * `webhook_events` 上有唯一约束 `(provider, event_id)`。
 * 处理回调时先 `claim()` 抢占这条记录：
 *
 *   抢到   → 这是第一次见到该事件，继续处理
 *   抢不到 → 该事件已处理过，直接返回 duplicate
 *
 * 为什么不能只靠 `if (order.status === 'paid')`：
 *   两个并发 Webhook 可能同时读到 status='pending'，
 *   然后都执行交付 → 积分发两次。唯一约束由数据库仲裁，没有这个竞态。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type { WebhookEventRow } from '@/lib/db/types'

export interface ClaimWebhookEventInput {
  provider: string
  eventId: string
  eventType?: string
  orderId?: string | null
  payload?: Record<string, unknown> | null
}

export interface ClaimResult {
  /** true = 首次见到该事件（本次由我处理）；false = 重复事件。 */
  claimed: boolean
  row: WebhookEventRow | null
}

/**
 * 抢占一条 Webhook 事件记录。
 *
 * 返回 `claimed: false` 表示该 `(provider, event_id)` 已存在 —— 重复事件。
 */
export async function claim(
  input: ClaimWebhookEventInput
): Promise<ClaimResult> {
  const { data, error } = await getDb()
    .from(TABLES.webhookEvents)
    .insert({
      provider: input.provider,
      event_id: input.eventId,
      event_type: input.eventType ?? null,
      order_id: input.orderId ?? null,
      payload: input.payload ?? null,
    })
    .select()
    .maybeSingle()

  if (error) {
    // 23505 = unique_violation → 该事件已处理过
    if (error.code === '23505') {
      const existing = await findByEventId(input.provider, input.eventId)

      return { claimed: false, row: existing }
    }

    throw new Error(`webhookEvent.claim failed: ${error.message}`)
  }

  return { claimed: true, row: (data as WebhookEventRow | null) ?? null }
}

/** 按渠道 + 事件 id 查记录。 */
export async function findByEventId(
  provider: string,
  eventId: string
): Promise<WebhookEventRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.webhookEvents)
    .select('*')
    .eq('provider', provider)
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`webhookEvent.findByEventId failed: ${error.message}`)
  }

  return (data as WebhookEventRow | null) ?? null
}

/** 列出某订单关联的所有 Webhook 事件（排查用）。 */
export async function listByOrderId(
  orderId: string
): Promise<WebhookEventRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.webhookEvents)
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`webhookEvent.listByOrderId failed: ${error.message}`)
  }

  return (data as WebhookEventRow[] | null) ?? []
}
