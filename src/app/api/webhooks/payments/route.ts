/**
 * POST /api/webhooks/payments —— **兼容适配器**
 *
 * Phase 1 的「通用 Webhook」入口：靠请求头 / body 形状**猜**支付渠道。
 * Phase 4 之后不再自己处理事件，而是识别渠道后委托给
 * `BillingService.handleWebhook`，与 `/api/billing/webhook/[provider]` 同链路。
 *
 * 新部署建议直接使用带渠道名的路径（`/api/billing/webhook/creem` 等），
 * 因为「猜渠道」在 header 缺失时会误判 —— 这也是保留本文件仅为兼容的原因。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'
import { listPaymentProviderNames } from '@/lib/billing/providers'
import { readHeader } from '@/lib/billing/headers'

export async function POST(request: NextRequest) {
  let rawBody: string

  try {
    rawBody = await request.text()
  } catch (error) {
    console.error('❌ Webhook body read failed:', error)
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 })
  }

  const provider = detectProvider(request, rawBody)

  // 识别不出渠道 → 400（客户端/配置问题），不要报 500 让渠道一直重试
  if (!provider) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Cannot detect payment provider from request headers. ' +
          'Use /api/billing/webhook/[provider] instead.',
        registeredProviders: listPaymentProviderNames(),
      },
      { status: 400 }
    )
  }

  const result = await BillingService.handleWebhook(provider, rawBody, request.headers)

  if (!result.ok) {
    return NextResponse.json(
      { success: false, provider, error: result.error },
      { status: 400 }
    )
  }

  if (result.error) {
    return NextResponse.json(
      { success: false, provider, error: result.error },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    provider: result.provider,
    eventId: result.eventId,
    eventType: result.eventType,
    orderId: result.orderId,
    duplicate: result.duplicate,
    fulfilled: result.fulfilled ?? false,
    note: result.note,
  })
}

/**
 * 识别支付渠道。
 *
 * 只靠**明确的签名头**判断 —— 不再像旧实现那样「解析 body 猜特征」，
 * 因为那种做法在 header 缺失时会把 Stripe 事件误判成 Creem。
 * 都识别不出时返回空字符串，由 `BillingService` 抛出明确错误。
 */
function detectProvider(request: NextRequest, _rawBody: string): string {
  const headers = request.headers

  if (readHeader(headers, 'stripe-signature')) {
    return 'stripe'
  }

  if (
    readHeader(headers, 'x-creem-signature') ??
    readHeader(headers, 'x-signature')
  ) {
    return 'creem'
  }

  console.warn(
    '⚠️ /api/webhooks/payments: cannot detect provider from headers. ' +
      `Registered: ${listPaymentProviderNames().join(', ')}. ` +
      'Use /api/billing/webhook/[provider] instead.'
  )

  return ''
}

/** GET 用于人工确认端点存活。 */
export async function GET() {
  return NextResponse.json({
    message: 'Billing webhook endpoint is alive',
    timestamp: new Date().toISOString(),
    endpoint: '/api/webhooks/payments',
    registeredProviders: listPaymentProviderNames(),
    preferredEndpoint: '/api/billing/webhook/[provider]',
  })
}
