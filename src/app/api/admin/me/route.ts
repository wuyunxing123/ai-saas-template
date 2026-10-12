import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'

export const dynamic = 'force-dynamic'

/** GET /api/admin/me — 返回当前 Admin 身份（用于前端确认权限）。 */
export const GET = withAdmin(async (_request: NextRequest, { admin }) => {
  return NextResponse.json({
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  })
})
