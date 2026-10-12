import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listSubscriptions } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/subscriptions — 分页 + 状态过滤 + 用户 email 搜索。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listSubscriptions({
    ...pagination,
    status: searchParams.get('status') || undefined,
    provider: searchParams.get('provider') || undefined,
    search: searchParams.get('search') || undefined,
  })

  return NextResponse.json(result)
})
