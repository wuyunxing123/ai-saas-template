import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listUsers } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/users — 分页 + 搜索用户。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listUsers({
    ...pagination,
    search: searchParams.get('search') || undefined,
    role: searchParams.get('role') || undefined,
  })

  return NextResponse.json(result)
})
