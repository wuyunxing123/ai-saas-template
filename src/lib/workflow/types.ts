/**
 * Workflow 领域模型
 *
 * 分层（规格 §7）：
 *
 *   API  →  WorkflowService  →  AITaskRepository  →  DB
 *
 * 业务层（API / UI / Admin）只依赖这里的 `AITask`，
 * **不直接接触 `AiTaskRow`（Supabase 行类型）**。
 * 这样将来换存储或调整列名时，改动被限制在 Repository 与 mapper 内。
 *
 * 命名：领域对象用 camelCase（`userId` / `providerTaskId`）；
 * 与数据库交互时由 mapper 转成 snake_case。
 */

import type { AIModality, AIProviderName } from '@/lib/ai/types'
import type { TaskAsset, TaskAssetType } from '@/lib/workflow/result'
import type { TaskStatus } from '@/lib/workflow/state-machine'
import type { TaskErrorCode } from '@/lib/workflow/errors'

export type { TaskStatus, TaskAsset, TaskAssetType, TaskErrorCode }

/** 任务的输入信息。 */
export interface TaskInput {
  prompt?: string
  inputImages?: string[]
  parameters?: Record<string, unknown>
}

/** 任务的错误详情。 */
export interface TaskErrorDetail {
  code: TaskErrorCode | string
  /** 内部可读的详细原因（不应对外泄漏）。 */
  message: string
  retryable: boolean
}

/** AI Task 领域对象。 */
export interface AITask {
  id: string
  userId: string | null
  model: string
  provider: AIProviderName
  status: TaskStatus
  modality: AIModality

  prompt: string | null
  input: TaskInput

  /** Provider 侧的异步任务 id；同步 Provider 为 null。 */
  providerTaskId: string | null
  idempotencyKey: string | null

  result: TaskAsset[] | null
  error: TaskErrorDetail | null

  /** 已扣除的积分。 */
  creditsUsed: number | null
  /** 已退还的积分。 */
  creditsRefunded: number
  /** 扣费流水 id（用于退款追溯）。 */
  creditTransactionId: string | null
  /** 退款流水 id。 */
  refundTransactionId: string | null

  retryCount: number
  maxRetries: number
  nextRetryAt: string | null

  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

/** 创建任务的入参。 */
export interface CreateTaskInput {
  userId: string
  model: string
  /** 不传时按「env 偏好 → 模型默认 Provider」解析。 */
  provider?: AIProviderName
  prompt?: string
  inputImages?: string[]
  parameters?: Record<string, unknown>
  /** 幂等键；同一用户 + 同一键不会建出第二条任务。 */
  idempotencyKey?: string
  /** 覆盖默认重试上限（默认 3）。 */
  maxRetries?: number
  /**
   * 是否等待 Provider 完成（同步模式）。
   *
   * 默认 false —— 规格 §13：不要阻塞 HTTP 请求等 Provider。
   * 为 true 时用于同步 Provider 或兼容旧链路。
   */
  waitForResult?: boolean
}

/** 创建任务的结果。 */
export interface CreateTaskResult {
  task: AITask
  /** true 表示命中幂等键返回了既有任务，而非新建。 */
  deduplicated: boolean
}

/** 结构化日志事件名（规格 §30）。 */
export type TaskLogEvent =
  | 'task.created'
  | 'task.submitted'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.retrying'
  | 'task.webhook.received'
  | 'task.webhook.duplicate'
  | 'task.refunded'

/** 日志上下文：只含可安全记录的字段，不含 prompt / token / API key。 */
export interface TaskLogContext {
  taskId: string
  userId?: string | null
  provider?: string
  model?: string
  status?: TaskStatus
  [key: string]: unknown
}
