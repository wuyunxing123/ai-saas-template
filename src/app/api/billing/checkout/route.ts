/**
 * POST /api/billing/checkout
 *
 * 创建支付会话。
 *
 * 请求体（新接口）：
 *   { "packageId": "creator", "providerName": "creem", "idempotencyKey": "..." }
 *
 * 请求体（兼容旧调用方）：
 *   { "productId": "creator", "billingCycle": "monthly" }
 *
 * ⚠️ **服务器忽略请求体里的 price / amount / credits**（用户约束 §21）。
 * 前端只能传 packageId（或 productId + billingCycle）；金额、积分与支付渠道商品 id
 * 一律由服务端从**已绑定的产品套餐表**读出（数据在 `src/lib/products/<id>/billing.ts`，
 * 查询机制在 `src/config/billing.ts`）。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'
import { getBillingUser } from '@/lib/billing/session'
import { listBillingPackages } from '@/config/billing'

export async function POST(request: NextRequest) {
  try {
    const user = await getBillingUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = (await request.json()) as Record<string, unknown>

    // 刻意只读取这几个字段 —— 任何 price / amount / credits 都被忽略
    const result = await BillingService.createCheckout({
      userId: user.id,
      email: user.email,
      customerName: user.name ?? undefined,
      packageId: typeof body.packageId === 'string' ? body.packageId : undefined,
      productId: typeof body.productId === 'string' ? body.productId : undefined,
      billingCycle:
        body.billingCycle === 'monthly' || body.billingCycle === 'yearly'
          ? body.billingCycle
          : undefined,
      idempotencyKey:
        typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      providerName:
        typeof body.providerName === 'string' ? body.providerName : undefined,
    })

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
      provider: result.provider,
      amountMinor: result.amountMinor,
      currency: result.currency,
      credits: result.credits,
      reused: result.reused,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Checkout failed'

    console.error('❌ /api/billing/checkout failed:', message)

    // 套餐不存在 / 已支付 / 渠道未配置 都属于客户端可修正的问题 → 400
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/** GET 列出可售套餐（方便前端渲染价格，避免前端硬编码）。 */
export async function GET() {
  return NextResponse.json({
    packages: listBillingPackages().map((pkg) => ({
      id: pkg.id,
      productId: pkg.productId,
      type: pkg.type,
      name: pkg.name,
      currency: pkg.currency,
      priceMinor: pkg.priceMinor,
      credits: pkg.credits,
      billingCycle: pkg.billingCycle ?? null,
    })),
  })
}
