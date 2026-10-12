/**
 * POST /api/webhooks/stripe —— **兼容适配器**
 *
 * Phase 4 之后不再自己处理事件，而是委托给 `BillingService.handleWebhook`，
 * 与 `/api/billing/webhook/stripe` 走同一条链路（验签 → 幂等 → 交付）。
 *
 * 保留原因：Stripe 后台配置的回调地址可能仍指向这里。
 * 新部署建议直接使用 `/api/billing/webhook/stripe`。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'

export async function POST(request: NextRequest) {
  let rawBody: string

  try {
    rawBody = await request.text()
  } catch (error) {
    console.error('❌ Stripe webhook body read failed:', error)
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 })
  }

  const result = await BillingService.handleWebhook('stripe', rawBody, request.headers)

  if (!result.ok) {
    return NextResponse.json({ received: false, error: result.error }, { status: 400 })
  }

  if (result.error) {
    return NextResponse.json({ received: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    received: true,
    duplicate: result.duplicate,
    eventId: result.eventId,
    eventType: result.eventType,
    orderId: result.orderId,
    fulfilled: result.fulfilled ?? false,
    note: result.note,
  })
}
