import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { getUserDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/users/[id] — 用户详情聚合。 */
export const GET = withAdmin(async (_request: NextRequest, { params }) => {
  const detail = await getUserDetail(params.id)

  return NextResponse.json(detail)
})
