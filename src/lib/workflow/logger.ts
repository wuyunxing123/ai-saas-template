/**
 * Task 生命周期结构化日志（规格 §30）
 *
 * 要求：
 *   · 事件名固定：`task.created` / `task.submitted` / `task.started` /
 *     `task.completed` / `task.failed` / `task.retrying` / `task.webhook.received`
 *   · 每条必含 taskId / userId / provider / model
 *   · **绝不记录** prompt / token / API key
 *
 * 为什么单独一个文件：
 *   日志规范要能被 verify 脚本静态检查（断言源码里没有 console.log(prompt)），
 *   集中在一处更容易保证。
 */

import type { TaskLogContext, TaskLogEvent } from '@/lib/workflow/types'

/** 会被剔除的敏感字段名。 */
const REDACTED_KEYS = new Set([
  'prompt',
  'apiKey',
  'api_key',
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'rawBody',
])

/**
 * 清洗日志上下文：剔除敏感字段。
 *
 * 这是硬保险 —— 即使调用方手滑把 prompt 传进来，也不会落盘。
 */
function sanitize(context: TaskLogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(context)) {
    if (REDACTED_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''))) {
      continue
    }
    out[key] = value
  }

  return out
}

export function logTaskEvent(
  event: TaskLogEvent,
  context: TaskLogContext
): void {
  const safe = sanitize(context)

  // 结构化的单行输出，便于日志系统采集
  console.log(
    `[workflow] ${event} ${JSON.stringify({
      taskId: safe.taskId,
      userId: safe.userId ?? null,
      provider: safe.provider ?? null,
      model: safe.model ?? null,
      ...safe,
    })}`
  )
}

/** 记录错误（用于 catch 块）。只写 message，不写整个 error 对象。 */
export function logTaskError(
  event: TaskLogEvent,
  context: TaskLogContext,
  error: unknown
): void {
  const safe = sanitize(context)

  console.error(
    `[workflow] ${event} ${JSON.stringify({
      taskId: safe.taskId,
      userId: safe.userId ?? null,
      provider: safe.provider ?? null,
      model: safe.model ?? null,
      ...safe,
      error: error instanceof Error ? error.message : String(error),
    })}`
  )
}
