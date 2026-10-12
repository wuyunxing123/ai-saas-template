import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { getSubscriptionDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/subscriptions/[id] — 订阅详情（含用户）。 */
export const GET = withAdmin(async (_request: NextRequest, { params }) => {
  const detail = await getSubscriptionDetail(params.id)

  return NextResponse.json(detail)
})
