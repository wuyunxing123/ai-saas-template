import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listCreditTransactions } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/credits — 分页流水查询（可按用户 email 搜索）。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listCreditTransactions({
    ...pagination,
    userId: searchParams.get('userId') || undefined,
    type: searchParams.get('type') || undefined,
    search: searchParams.get('search') || undefined,
  })

  return NextResponse.json(result)
})
