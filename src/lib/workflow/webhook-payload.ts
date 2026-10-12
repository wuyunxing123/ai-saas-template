/**
 * Provider webhook payload 的通用解析（规格 §15 步骤 3-4）
 *
 * ⚠️ 这是**尽力而为（best-effort）**的通用解析，不是各厂商的精确实现。
 *
 * 为什么不放进 `ai/providers/`
 * ----------------------------
 * 按 Phase 2 约定，厂商细节属于 Provider 内部实现。但 Phase 7 的边界是
 * 「不重新设计 AI Core」（规格 §10），而且**本机没有各厂商真实 webhook 样本**，
 * 凭空写出"这就是 KIE 的 payload 格式"属于编造。
 *
 * 因此这里的策略是：
 *   1. 覆盖各厂商 webhook 最常见的字段名（taskId / data.taskId / id / requestId…）
 *   2. 解析不出来就返回 null，路由回 400 —— **绝不猜**，
 *      猜错会导致把 A 任务的结果写到 B 任务上
 *   3. 将来拿到真实样本后，可在 `ai/providers/<name>.ts` 里实现精确的
 *      `parseWebhook?()` 覆盖这里（见 PHASE_7_FOLLOWUPS.md）
 */

export interface ParsedWebhookPayload {
  providerTaskId: string
  state: 'completed' | 'failed'
  /** 失败时的错误信息。 */
  error?: string
}

/** 候选的 task id 字段路径。 */
const TASK_ID_PATHS: readonly (string[])[] = [
  ['taskId'],
  ['task_id'],
  ['id'],
  ['requestId'],
  ['request_id'],
  ['jobId'],
  ['data', 'taskId'],
  ['data', 'task_id'],
  ['data', 'id'],
  ['data', 'requestId'],
  ['data', 'request_id'],
  ['result', 'taskId'],
  ['result', 'id'],
]

/** 候选的状态字段路径。 */
const STATE_PATHS: readonly (string[])[] = [
  ['state'],
  ['status'],
  ['data', 'state'],
  ['data', 'status'],
  ['result', 'state'],
  ['result', 'status'],
]

/** 表示「成功」的状态取值。 */
const SUCCESS_VALUES = new Set([
  'completed',
  'complete',
  'success',
  'successful',
  'succeeded',
  'done',
  'finished',
  'COMPLETED',
  'SUCCESS',
])

/** 表示「失败」的状态取值。 */
const FAILURE_VALUES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'FAILED',
  'ERROR',
])

function readPath(obj: unknown, path: readonly string[]): unknown {
  let current: unknown = obj

  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/** 从 payload 里取第一个非空字符串值。 */
function firstString(obj: unknown, paths: readonly (string[])[]): string | null {
  for (const path of paths) {
    const value = readPath(obj, path)

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}

/**
 * 解析 webhook payload。
 *
 * @returns 解析结果；无法可靠识别时返回 `null`（调用方应回 400，不要猜）
 */
export function parseWebhookPayload(rawBody: string): ParsedWebhookPayload | null {
  let payload: unknown

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return null
  }

  const providerTaskId = firstString(payload, TASK_ID_PATHS)

  if (!providerTaskId) {
    return null
  }

  const rawState = firstString(payload, STATE_PATHS)
  const normalized = rawState?.toLowerCase()

  let state: 'completed' | 'failed' | null = null

  if (normalized && SUCCESS_VALUES.has(rawState!)) {
    state = 'completed'
  } else if (normalized && FAILURE_VALUES.has(rawState!)) {
    state = 'failed'
  } else {
    // 没有明确状态字段时，用错误字段是否存在来判断
    const errorMessage =
      firstString(payload, [
        ['error'],
        ['errorMessage'],
        ['error_message'],
        ['data', 'error'],
        ['data', 'errorMessage'],
        ['failMsg'],
        ['failCode'],
      ]) ?? null

    if (errorMessage) {
      state = 'failed'
    }
  }

  if (!state) {
    return null
  }

  return {
    providerTaskId,
    state,
    ...(state === 'failed'
      ? {
          error:
            firstString(payload, [
              ['error'],
              ['errorMessage'],
              ['error_message'],
              ['message'],
              ['data', 'error'],
            ]) ?? 'Provider reported failure',
        }
      : {}),
  }
}
