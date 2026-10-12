/**
 * AI Task API（规格 §12 ~ §14）
 *
 *   POST /api/ai/tasks     创建任务
 *   GET  /api/ai/tasks     列出**当前用户**的任务
 *
 * 安全：
 *   · 必须登录（401）
 *   · user_id **只**来自 `session.user.id`，绝不相信客户端传入（规格 §12/§14）
 *   · GET 列表强制按 user_id 收窄，不能枚举别人的任务
 *   · 响应不暴露 provider 内部敏感信息
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { getModel } from '@/lib/ai/models'
import { getCurrentUser } from '@/lib/auth-session'
import { parsePagination } from '@/lib/admin/pagination'
import { toTaskError } from '@/lib/workflow/errors'
import { WorkflowService } from '@/lib/workflow/service'
import type { AiTaskStatus } from '@/lib/db/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** 允许客户端指定的 provider 白名单校验（通过 resolveProvider 内部完成）。 */
export async function POST(request: NextRequest) {
  // ── 1. 鉴权 ────────────────────────────────────────────────────────
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to start creating.' },
      { status: 401 }
    )
  }

  let body: Record<string, unknown>

  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 2. 参数校验 ────────────────────────────────────────────────────
  // 规格 §12 明确：不允许客户端传 userId
  if ('userId' in body || 'user_id' in body) {
    return NextResponse.json(
      { error: 'userId must not be supplied by the client' },
      { status: 400 }
    )
  }

  const modelId = typeof body.model === 'string' ? body.model.trim() : ''

  if (!modelId) {
    return NextResponse.json(
      { error: 'Missing required field: model' },
      { status: 400 }
    )
  }

  try {
    getModel(modelId)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : `Unknown model "${modelId}"`,
      },
      { status: 400 }
    )
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

  if (!prompt) {
    return NextResponse.json(
      { error: 'Missing required field: prompt' },
      { status: 400 }
    )
  }

  const inputImages = parseInputImages(body.inputImages)

  if (inputImages === null) {
    return NextResponse.json(
      { error: 'inputImages must be an array of URL strings' },
      { status: 400 }
    )
  }

  // ── 3. 创建任务 ────────────────────────────────────────────────────
  try {
    const { task, deduplicated } = await WorkflowService.createTask({
      userId: user.id,
      model: modelId,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      prompt,
      inputImages: inputImages.length ? inputImages : undefined,
      parameters:
        body.parameters && typeof body.parameters === 'object'
          ? (body.parameters as Record<string, unknown>)
          : undefined,
      idempotencyKey:
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim()
          : undefined,
      // 默认异步：不阻塞等待 Provider（规格 §13）
      waitForResult: body.waitForResult === true,
    })

    return NextResponse.json(
      {
        task: {
          id: task.id,
          status: task.status,
          model: task.model,
          provider: task.provider,
          modality: task.modality,
          createdAt: task.createdAt,
          creditsUsed: task.creditsUsed,
          ...(task.error ? { error: task.error } : {}),
        },
        deduplicated,
      },
      { status: deduplicated ? 200 : 201 }
    )
  } catch (error) {
    const taskError = toTaskError(error)

    const status =
      taskError.code === 'INSUFFICIENT_CREDITS' ? 402 : taskError.code === 'UNKNOWN_MODEL' || taskError.code === 'UNSUPPORTED_MODEL' ? 400 : 500

    console.error('[api/ai/tasks] create failed:', {
      code: taskError.code,
      message: taskError.message,
      userId: user.id,
    })

    return NextResponse.json(
      {
        error: 'Task creation failed',
        // 对外只给固定的 code + 通用提示，不透出 provider / DB 细节
        code: taskError.code,
        message: taskError.toPublic().message,
      },
      { status }
    )
  }
}

/** 列出当前用户的任务。 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const { pageSize, offset, page } = parsePagination(searchParams)

  const rawStatus = searchParams.get('status')
  const status = isTaskStatus(rawStatus) ? rawStatus : undefined

  try {
    const { items, total } = await WorkflowService.listUserTasks(user.id, {
      limit: pageSize,
      offset,
      status,
    })

    return NextResponse.json({
      items: items.map(toPublicTask),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (error) {
    console.error('[api/ai/tasks] list failed:', error)

    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────────────────────────────

/** @returns null 表示格式非法 */
function parseInputImages(value: unknown): string[] | null {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) return null

  if (!value.every((v) => typeof v === 'string' && v.startsWith('http'))) {
    return null
  }

  return value as string[]
}

function isTaskStatus(value: string | null): value is AiTaskStatus {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

/**
 * 任务的安全对外表示。
 *
 * 刻意**不**输出 providerTaskId（Provider 内部 id，无业务价值且可能用于探测）、
 * 也不输出完整的 input.parameters（可能含敏感自定义参数）。
 */
function toPublicTask(task: Awaited<ReturnType<typeof WorkflowService.getTask>>) {
  if (!task) return null

  return {
    id: task.id,
    status: task.status,
    model: task.model,
    provider: task.provider,
    modality: task.modality,
    createdAt: task.createdAt,
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

