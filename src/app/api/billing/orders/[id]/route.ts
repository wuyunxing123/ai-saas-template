/**
 * GET /api/billing/orders/[id]
 *
 * 取单个订单。
 *
 * 权限（用户约束 §19）：`BillingService.getOrder(userId, orderId)` 在数据层
 * 比对 `order.user_id`，别人的订单一律返回 404（而不是 403 —— 不泄露订单是否存在）。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'
import { getBillingUser } from '@/lib/billing/session'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getBillingUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { id } = await context.params
    const order = await BillingService.getOrder(user.id, id)

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json({
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        amount: order.amount,
        amountMinor: order.amount_minor,
        currency: order.currency,
        paymentProvider: order.payment_provider,
        productType: order.product_type,
        productId: order.product_id,
        productName: order.product_name,
        packageId: order.package_id,
        paidAt: order.paid_at,
        fulfilledAt: order.fulfilled_at,
        createdAt: order.created_at,
      },
    })
  } catch (error) {
    console.error('❌ /api/billing/orders/[id] failed:', error)

    return NextResponse.json({ error: 'Failed to load order' }, { status: 500 })
  }
}
