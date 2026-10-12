/**
 * GET /api/ai/tasks/:id — 查询单个任务（规格 §14）
 *
 * 安全（规格 §14 明确要求）：
 *   「绝对不能让普通用户查询其他 user 的 task」
 *
 * 实现方式：`WorkflowService.getTask(id, { userId })` 内部校验归属。
 * 不属于自己的任务返回 **404 而不是 403** ——
 * 403 会泄露「这个 id 存在但属于别人」的信息。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser } from '@/lib/auth-session'
import { WorkflowService } from '@/lib/workflow/service'
import type { AITask } from '@/lib/workflow/types'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { id } = await params

  try {
    // ── 懒轮询（规格 §16）─────────────────────────────────────────────
    // 项目没有 worker / cron，因此采用「用户查询时顺带问一次 Provider」的方式，
    // 不引入 Redis Queue / BullMQ / 独立 Worker（规格 §32 明令禁止）。
    // 只有 processing 且有 provider_task_id 时才轮询，pending 阶段轮不了。
    let task = await WorkflowService.getTask(id, { userId: user.id })

    if (task && task.status === 'processing' && task.providerTaskId) {
      try {
        task = (await WorkflowService.pollTask(id)) ?? task
      } catch (error) {
        // 轮询失败不该让查询失败 —— 返回库里的状态即可
        console.error(`[api/ai/tasks/${id}] poll failed:`, error)
      }
    }

    if (!task) {
      // 不存在**或**不属于当前用户 —— 一律 404
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return NextResponse.json({ task: toPublicTask(task) })
  } catch (error) {
    console.error(`[api/ai/tasks/${id}] get failed:`, error)

    return NextResponse.json({ error: 'Failed to load task' }, { status: 500 })
  }
}

/**
 * 任务的安全对外表示。
 *
 * 不输出 providerTaskId（Provider 内部 id）与完整 input.parameters。
 */
function toPublicTask(task: AITask) {
  return {
    id: task.id,
    status: task.status,
    model: task.model,
    provider: task.provider,
    modality: task.modality,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    creditsUsed: task.creditsUsed,
    creditsRefunded: task.creditsRefunded,
    retryCount: task.retryCount,
    ...(task.result ? { assets: task.result } : {}),
    ...(task.error
      ? { error: { code: task.error.code, retryable: task.error.retryable } }
      : {}),
  }
}
