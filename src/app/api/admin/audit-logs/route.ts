import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { parsePagination } from '@/lib/admin/pagination'
import { listAuditLogs } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/audit-logs — 分页查询 Admin 操作审计日志。 */
export const GET = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const pagination = parsePagination(searchParams)

  const result = await listAuditLogs({
    ...pagination,
    adminUserId: searchParams.get('adminUserId') || undefined,
    targetUserId: searchParams.get('targetUserId') || undefined,
  })

  return NextResponse.json(result)
})
