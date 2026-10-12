import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { getAiTaskDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/** GET /api/admin/ai-tasks/[id] — AI 任务详情（含用户）。 */
export const GET = withAdmin(async (_request: NextRequest, { params }) => {
  const detail = await getAiTaskDetail(params.id)

  return NextResponse.json(detail)
})
