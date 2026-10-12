/**
 * POST /api/billing/webhook/[provider]
 *
 * 统一的支付回调入口。`provider` 为注册表里的渠道名（`creem` / `stripe`）。
 *
 * 流程：
 *   Provider → 验签 → 解析事件 → 定位订单 → 抢占事件（幂等）→ 推进订单 → 交付
 *
 * 幂等三层（见 docs/BILLING.md）：
 *   1. `webhook_events` 唯一约束 `(provider, event_id)`
 *   2. `markPaidIfPending` 条件更新
 *   3. 积分发放的 `credit_grant:<order_id>` 幂等键
 *
 * ⚠️ 必须用 `request.text()` 读原始 body —— 签名是对原始字节计算的，
 * 先 `json()` 再重新序列化会导致验签失败。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'
import { hasPaymentProvider, listPaymentProviderNames } from '@/lib/billing/providers'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params

  // 未知渠道属于**客户端**错误（URL 写错）→ 400，不是 500。
  // 放在这里判断而不是让 BillingService 抛错，是为了避免把 4xx 报成 5xx
  // 让渠道误以为服务端故障而不断重试。
  if (!hasPaymentProvider(provider)) {
    return NextResponse.json(
      {
        received: false,
        error: `Unknown payment provider "${provider}". Registered: ${listPaymentProviderNames().join(', ')}`,
      },
      { status: 400 }
    )
  }

  let rawBody: string

  try {
    rawBody = await request.text()
  } catch (error) {
    console.error(`❌ Webhook body read failed (${provider}):`, error)

    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 })
  }

  try {
    const result = await BillingService.handleWebhook(provider, rawBody, request.headers)

    // 验签失败：400（不是 500 —— 这是调用方的问题，重试也没用）
    if (!result.ok) {
      return NextResponse.json(
        { received: false, provider, error: result.error },
        { status: 400 }
      )
    }

    // 处理失败（例如交付抛错）：500，让渠道按自己的策略重试
    if (result.error) {
      return NextResponse.json(
        { received: false, provider, error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      received: true,
      provider: result.provider,
      eventId: result.eventId,
      eventType: result.eventType,
      orderId: result.orderId,
      duplicate: result.duplicate,
      fulfilled: result.fulfilled ?? false,
      note: result.note,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'

    console.error(`❌ Webhook handling failed (${provider}):`, message)

    return NextResponse.json({ received: false, provider, error: message }, { status: 500 })
  }
}

/** GET 用于人工确认端点存活。 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params

  return NextResponse.json({
    message: 'Billing webhook endpoint is alive',
    provider,
    timestamp: new Date().toISOString(),
  })
}
