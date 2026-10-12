/**
 * GET /api/billing/orders
 *
 * 列出**当前用户自己**的订单。
 *
 * 权限（用户约束 §19）：查询强制带 user_id 条件，调用方无法通过参数查看他人订单。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { BillingService } from '@/lib/billing/service'
import { getBillingUser } from '@/lib/billing/session'

export async function GET(request: NextRequest) {
  try {
    const user = await getBillingUser()

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') ?? 20) || 20, 100)
    const skip = Number(searchParams.get('skip') ?? 0) || 0

    const orders = await BillingService.listOrders(user.id, { limit, skip })

    return NextResponse.json({
      orders: orders.map(toPublicOrder),
      limit,
      skip,
    })
  } catch (error) {
    console.error('❌ /api/billing/orders failed:', error)

    return NextResponse.json({ error: 'Failed to list orders' }, { status: 500 })
  }
}

/** 只暴露前端需要的字段，避免把 provider_refs / 内部 metadata 整包吐出去。 */
function toPublicOrder(order: {
  id: string
  order_number: string
  status: string
  amount: number
  amount_minor: number | null
  currency: string | null
  payment_provider: string
  product_type: string
  product_id: string
  product_name: string
  package_id: string | null
  paid_at: string | null
  fulfilled_at: string | null
  created_at: string
}) {
  return {
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
  }
}
