/**
 * POST /api/admin/ai-tasks/poll — 批量轮询进行中的任务（规格 §16）
 *
 * 这是 Polling 的**兜底入口**，不是主路径。
 * 主路径是用户查询单个任务时的懒轮询（`GET /api/ai/tasks/:id`）。
 *
 * 存在的理由：
 *   如果某个任务创建后用户再也没来查过（关了页面），
 *   它就永远停在 processing —— 直到有人触发一次批量轮询。
 *   将来接 Vercel Cron / 外部调度器时，就是打这个接口。
 *
 * ⚠️ 本阶段**不引入** Redis Queue / BullMQ / 独立 Worker（规格 §32）。
 *
 * 权限：Admin（`withAdmin`）。
 */

import '@/app/product-runtime'
import { NextResponse, type NextRequest } from 'next/server'

import { withAdmin } from '@/lib/admin/api'
import { WorkflowService } from '@/lib/workflow/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withAdmin(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const rawLimit = Number.parseInt(searchParams.get('limit') || '', 10)

  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50

  try {
    const result = await WorkflowService.pollRunningTasks(limit)

    return NextResponse.json({
      ok: true,
      ...result,
      hint: 'Batch polling fallback. Primary path is lazy poll on GET /api/ai/tasks/:id',
    })
  } catch (error) {
    console.error('[api/admin/ai-tasks/poll] failed:', error)

    return NextResponse.json({ error: 'Polling failed' }, { status: 500 })
  }
})
