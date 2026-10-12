/**
 * POST /api/webhooks/ai/[provider] — AI Provider 的统一回调入口（规格 §15）
 *
 * 流程：
 *   Provider → 找 provider → **验签** → 解析 payload → 定位 task
 *            → 幂等判断 → 推进状态 → 落 Storage / 退款
 *
 * 为什么不用 `request.json()`
 * ---------------------------
 * 与支付回调同理：签名是对**原始字节**计算的，先 json() 再重新序列化会验签失败。
 * 因此一律 `await request.text()`。
 *
 * 幂等（规格 §19）
 * ---------------
 * 同一个 webhook 触发两次：
 *   RUNNING → COMPLETED  （第一次）
 *   COMPLETED → COMPLETED（第二次：短路返回 200，标注 duplicate）
 * 不会重复扣积分、不会重复退款、不会重复生成结果。
 *
 * 安全（规格 §28）
 * ---------------
 * 回调**不走**普通 user auth —— 它只能靠签名。
 * Provider 未实现签名校验时返回 **501**（明确"unavailable"），
 * 而不是伪造通过。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { hasAIProvider, listAIProviderNames } from '@/lib/ai/providers'
import { WorkflowService } from '@/lib/workflow/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider } = await context.params

  // 未知 Provider 是客户端（URL）错误 → 400，别让 Provider 以为服务端故障而重试
  if (!hasAIProvider(provider)) {
    return NextResponse.json(
      {
        received: false,
        error: `Unknown AI provider "${provider}". Registered: ${listAIProviderNames().join(', ')}`,
      },
      { status: 400 }
    )
  }

  // ⚠️ 必须用原始 body 验签
  let rawBody: string

  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 })
  }

  try {
    const outcome = await WorkflowService.handleWebhook({
      provider,
      rawBody,
      headers: request.headers,
    })

    return NextResponse.json(outcome.body, { status: outcome.status })
  } catch (error) {
    // 内部错误必须回 5xx —— 让 Provider 有机会重试
    console.error(`[api/webhooks/ai/${provider}] failed:`, error)

    return NextResponse.json(
      { received: false, error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
