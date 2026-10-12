/**
 * 统一的 Task Error 模型（规格 §29）
 *
 * 目标：
 *   · 内部：区分「可重试」与「不可重试」，驱动 §17 的重试语义
 *   · 外部：只暴露 `code` + 用户可读 message，绝不泄漏
 *          数据库错误 / fetch 错误 / provider 原始响应 / API key
 *
 * 用法：
 *   throw new TaskError('PROVIDER_TIMEOUT', 'Generation timed out', { retryable: true })
 */

export type TaskErrorCode =
  // ── 不可重试 ───────────────────────────────────────────────
  | 'INVALID_REQUEST'      // 参数校验失败
  | 'UNKNOWN_MODEL'        // 模型 id 未注册
  | 'UNSUPPORTED_MODEL'    // Provider 不支持该模型
  | 'PROVIDER_AUTH_FAILED' // API key 无效 / 401 / 403
  | 'INSUFFICIENT_CREDITS' // 余额不足
  | 'CREDIT_DEDUCTION_FAILED'
  | 'PROVIDER_NO_ASYNC_SUPPORT' // Provider 未实现 submitTask
  | 'CONTENT_REJECTED'     // 内容安全拒绝
  // ── 可重试 ─────────────────────────────────────────────────
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE' // 5xx
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TASK_FAILED' // provider 侧任务失败（可能是瞬时）
  | 'STORAGE_PERSIST_FAILED'
  | 'INTERNAL_ERROR'

/** 不可重试的错误码集合。其余默认可重试。 */
const NON_RETRYABLE: ReadonlySet<TaskErrorCode> = new Set<TaskErrorCode>([
  'INVALID_REQUEST',
  'UNKNOWN_MODEL',
  'UNSUPPORTED_MODEL',
  'PROVIDER_AUTH_FAILED',
  'INSUFFICIENT_CREDITS',
  'PROVIDER_NO_ASYNC_SUPPORT',
  'CONTENT_REJECTED',
])

export class TaskError extends Error {
  readonly name = 'TaskError' as const

  constructor(
    readonly code: TaskErrorCode,
    message: string,
    options: {
      /** 显式覆盖默认可重试判断。 */
      retryable?: boolean
      /** 仅供日志，不会出现在 API 响应里。 */
      cause?: unknown
    } = {}
  ) {
    super(message)
    this.retryable = options.retryable ?? !NON_RETRYABLE.has(code)
    this.cause = options.cause
  }

  /** 是否值得重试。 */
  readonly retryable: boolean
  /** 原始错误（仅内部使用）。 */
  readonly cause?: unknown

  /** 可以安全返回给客户端的形状。 */
  toPublic(): { code: TaskErrorCode; message: string; retryable: boolean } {
    return {
      code: this.code,
      // 对外统一收敛成不含内部细节的提示
      message: PUBLIC_MESSAGES[this.code] ?? 'Generation failed',
      retryable: this.retryable,
    }
  }
}

/**
 * 面向用户的提示文案。
 *
 * 内部 message（可能含 provider 细节）只写日志，
 * 客户端永远只看到这里的固定文案。
 */
const PUBLIC_MESSAGES: Partial<Record<TaskErrorCode, string>> = {
  INVALID_REQUEST: 'Invalid request parameters',
  UNKNOWN_MODEL: 'Unknown model',
  UNSUPPORTED_MODEL: 'This model is not supported by the selected provider',
  PROVIDER_AUTH_FAILED: 'AI provider authentication failed',
  INSUFFICIENT_CREDITS: 'Insufficient credits',
  CREDIT_DEDUCTION_FAILED: 'Failed to deduct credits',
  PROVIDER_NO_ASYNC_SUPPORT: 'Selected provider does not support async tasks',
  CONTENT_REJECTED: 'Content was rejected by the safety filter',
  PROVIDER_TIMEOUT: 'Generation timed out, please retry',
  PROVIDER_UNAVAILABLE: 'AI provider is temporarily unavailable',
  PROVIDER_RATE_LIMITED: 'Rate limited by the AI provider',
  PROVIDER_TASK_FAILED: 'Generation failed',
  STORAGE_PERSIST_FAILED: 'Failed to store the generated result',
  INTERNAL_ERROR: 'Generation failed',
}

/**
 * 把任意抛出的东西归一成 `TaskError`。
 *
 * 这是「不要把数据库错误 / fetch 错误直接暴露给用户」的收口点。
 */
export function toTaskError(error: unknown): TaskError {
  if (error instanceof TaskError) {
    return error
  }

  const message = error instanceof Error ? error.message : String(error)

  // 违反模型的输入图契约（`src/lib/ai/utils.ts` 的 require*Image）：请求本身的问题，
  // 重提交多少次结果都一样。不分类就会落进可重试的 INTERNAL_ERROR，被重试三次才终态失败。
  if (/requires (?:exactly|at least) .*input image/i.test(message)) {
    return new TaskError('INVALID_REQUEST', message, { cause: error })
  }

  // 按消息特征粗分类；无法识别的一律按可重试的 INTERNAL_ERROR 处理，
  // 但**绝不能**把原始 message 透出去。
  if (/not support model|does not support model/i.test(message)) {
    return new TaskError('UNSUPPORTED_MODEL', message, { cause: error })
  }

  if (/401|403|unauthorized|forbidden|invalid api key/i.test(message)) {
    return new TaskError('PROVIDER_AUTH_FAILED', message, { cause: error })
  }

  if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
    return new TaskError('PROVIDER_TIMEOUT', message, { cause: error })
  }

  if (/rate limit|429/i.test(message)) {
    return new TaskError('PROVIDER_RATE_LIMITED', message, { cause: error })
  }

  if (/5\d\d|unavailable|ECONNRESET|ENOTFOUND/i.test(message)) {
    return new TaskError('PROVIDER_UNAVAILABLE', message, { cause: error })
  }

  if (/does not support async|does not support task polling/i.test(message)) {
    return new TaskError('PROVIDER_NO_ASYNC_SUPPORT', message, { cause: error })
  }

  return new TaskError('INTERNAL_ERROR', message, { cause: error })
}
