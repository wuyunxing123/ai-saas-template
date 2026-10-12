import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listOrders } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/orders — 分页 + 状态/渠道过滤 + email/订单号搜索。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listOrders({
    ...pagination,
    status: searchParams.get('status') || undefined,
    provider: searchParams.get('provider') || undefined,
    search: searchParams.get('search') || undefined,
  })

  return NextResponse.json(result)
})
