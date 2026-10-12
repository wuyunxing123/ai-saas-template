import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listAiTasks } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/ai-tasks — 分页 + provider/model/status 过滤。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listAiTasks({
    ...pagination,
    provider: searchParams.get('provider') || undefined,
    model: searchParams.get('model') || undefined,
    status: searchParams.get('status') || undefined,
  })

  return NextResponse.json(result)
})
