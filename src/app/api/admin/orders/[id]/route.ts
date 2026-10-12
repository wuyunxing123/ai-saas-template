import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { getOrderDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/orders/[id] — 订单详情（含用户与关联流水）。 */
export const GET = withAdmin(async (_request: NextRequest, { params }) => {
  const detail = await getOrderDetail(params.id)

  return NextResponse.json(detail)
})
