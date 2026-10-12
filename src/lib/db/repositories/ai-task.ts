/**
 * AI Task Repository
 *
 * 只做 `ai_tasks` 表的数据操作。**不负责**：
 *   · 调用 AI Provider（那是 `AIService` 的职责）
 *   · 扣积分 / 退款（那是 CreditService / Workflow 的职责）
 *   · 决定状态能不能改（那是 `workflow/state-machine.ts` 的职责）
 *
 * 状态说明：与 AI Core 的 `AITaskState`（`src/lib/ai/types.ts`）语义对齐，
 * 另加 `cancelled`。映射关系：
 *   AITaskState.queued      → 'pending'
 *   AITaskState.processing  → 'processing'
 *   AITaskState.completed   → 'completed'
 *   AITaskState.failed      → 'failed'
 *
 * Phase 7 接线情况
 * ----------------
 * 本 Repository 在 Phase 3 建好但**从未被写入**（见 docs/PHASE_7_AUDIT.md）。
 * Phase 7 起由 `WorkflowService` 写入，并新增：
 *   · `transitionStatus()` —— 带状态机校验的状态推进（唯一允许改状态的入口）
 *   · `findRunningTasks()` / `findRetryableTasks()` —— 供 Polling 使用
 *   · `toDomain()` —— 行 → 领域对象，避免业务层依赖 row 类型
 *
 * 命名规则：输入参数镜像数据库列名（snake_case），见 credit.ts 的说明。
 */

import { assertTransition, isTerminal } from '@/lib/workflow/state-machine'
import { TABLES, getDb } from '@/lib/db/client'
import type { AiTaskRow, AiTaskStatus } from '@/lib/db/types'
import type { AITask, TaskInput } from '@/lib/workflow/types'

export interface CreateAiTaskInput {
  user_id: string
  model: string
  provider: string
  prompt?: string
  status?: AiTaskStatus
  input_metadata?: Record<string, unknown> | null
  output_metadata?: Record<string, unknown> | null
  provider_task_id?: string | null
  idempotency_key?: string | null
  credit_transaction_id?: string | null
  credits_used?: number | null
  max_retries?: number
}

export interface CompleteAiTaskInput {
  output_metadata?: Record<string, unknown> | null
  credits_used?: number | null
  credit_transaction_id?: string | null
  provider_task_id?: string | null
}

export interface FailAiTaskInput {
  error_code?: string
  error_message?: string
}

/** 通用更新入参（镜像列名）。 */
export interface UpdateAiTaskInput {
  status?: AiTaskStatus
  prompt?: string | null
  input_metadata?: Record<string, unknown> | null
  output_metadata?: Record<string, unknown> | null
  provider_task_id?: string | null
  credit_transaction_id?: string | null
  credits_used?: number | null
  credits_refunded?: number
  refund_transaction_id?: string | null
  error_code?: string | null
  error_message?: string | null
  retry_count?: number
  max_retries?: number
  next_retry_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

// ─────────────────────────────────────────────────────────────────────
// 行 → 领域对象
// ─────────────────────────────────────────────────────────────────────

/**
 * 把数据库行转成领域对象 `AITask`。
 *
 * 业务层（API / UI / Admin）应依赖 `AITask` 而不是 `AiTaskRow`，
 * 这样列名调整不会波及业务代码。
 */
export function toDomain(row: AiTaskRow): AITask {
  const input = (row.input_metadata ?? {}) as TaskInput
  const output = row.output_metadata as Record<string, unknown> | null

  return {
    id: row.id,
    userId: row.user_id,
    model: row.model,
    provider: row.provider,
    status: row.status,
    // 模态不在表里，调用方按需用 getModel(id).modality 覆盖
    modality: 'image',
    prompt: row.prompt,
    input,
    providerTaskId: row.provider_task_id,
    idempotencyKey: row.idempotency_key,
    result: Array.isArray(output?.assets)
      ? (output!.assets as AITask['result'])
      : null,
    error: row.error_code
      ? {
          code: row.error_code,
          message: row.error_message ?? '',
          // 是否可重试由 errors.ts 决定；这里只做保守还原
          retryable: false,
        }
      : null,
    creditsUsed: row.credits_used,
    creditsRefunded: row.credits_refunded ?? 0,
    creditTransactionId: row.credit_transaction_id,
    refundTransactionId: row.refund_transaction_id,
    retryCount: row.retry_count ?? 0,
    maxRetries: row.max_retries ?? 3,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

/** 创建任务。 */
export async function create(input: CreateAiTaskInput): Promise<AiTaskRow> {
  const payload: Record<string, unknown> = {
    user_id: input.user_id,
    model: input.model,
    provider: input.provider,
    status: input.status ?? 'pending',
  }

  for (const key of [
    'prompt',
    'input_metadata',
    'output_metadata',
    'provider_task_id',
    'idempotency_key',
    'credit_transaction_id',
    'credits_used',
  ] as const) {
    if (input[key] !== undefined) {
      payload[key] = input[key]
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`aiTask.create failed: ${error.message}`)
  }

  return data as AiTaskRow
}

/** 按 id 查任务。 */
export async function findById(id: string): Promise<AiTaskRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`aiTask.findById failed: ${error.message}`)
  }

  return (data as AiTaskRow | null) ?? null
}

/** 按 Provider 的 task id 查任务（异步回调时用）。 */
export async function findByProviderTaskId(
  provider: string,
  providerTaskId: string
): Promise<AiTaskRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('provider', provider)
    .eq('provider_task_id', providerTaskId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`aiTask.findByProviderTaskId failed: ${error.message}`)
  }

  return (data as AiTaskRow | null) ?? null
}

/** 按幂等键查任务，避免前端重复提交建出多条任务。 */
export async function findByIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<AiTaskRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`aiTask.findByIdempotencyKey failed: ${error.message}`)
  }

  return (data as AiTaskRow | null) ?? null
}

/** 直接更新若干列。**仅供 Workflow 内部使用**，不含状态机校验。 */
export async function update(
  id: string,
  patch: UpdateAiTaskInput
): Promise<AiTaskRow> {
  const payload: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      payload[key] = value
    }
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('aiTask.update called with an empty patch')
  }

  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`aiTask.update failed: ${error.message}`)
  }

  return data as AiTaskRow
}

/**
 * 状态推进 —— **唯一允许修改 `status` 的入口**。
 *
 * 与旧的 `updateStatus()` 的区别：
 *   1. 先读当前状态，交给 `assertTransition()` 校验合法性；
 *      非法转换（如 completed → processing）直接抛错，不会落库。
 *   2. 幂等：目标状态等于当前状态时直接返回（webhook 重复触发的核心保障）。
 *   3. 终态自动写 `completed_at`。
 *
 * @returns row —— 转换后的行；以及 `changed`（false 表示幂等命中，未实际修改）
 */
export async function transitionStatus(
  id: string,
  to: AiTaskStatus,
  patch: Omit<UpdateAiTaskInput, 'status'> = {}
): Promise<{ row: AiTaskRow; changed: boolean }> {
  const current = await findById(id)

  if (!current) {
    throw new Error(`aiTask.transitionStatus: task ${id} not found`)
  }

  const from = current.status

  // 幂等短路：已经是目标状态
  if (from === to) {
    return { row: current, changed: false }
  }

  // 非法转换 → 抛错（例如 completed → processing）
  assertTransition(from, to)

  const payload: Record<string, unknown> = { status: to }

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      payload[key] = value
    }
  }

  // 提交给 Provider 的时刻
  if (to === 'processing' && !current.started_at && !payload.started_at) {
    payload.started_at = new Date().toISOString()
  }

  // 终态写完成时间
  if (isTerminal(to) && !payload.completed_at) {
    payload.completed_at = new Date().toISOString()
  }

  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`aiTask.transitionStatus failed: ${error.message}`)
  }

  return { row: data as AiTaskRow, changed: true }
}

/** 标记任务失败（内部走 `transitionStatus`，同样是受控的）。 */
export async function fail(
  id: string,
  input: FailAiTaskInput
): Promise<AiTaskRow> {
  const { row } = await transitionStatus(id, 'failed', {
    error_code: input.error_code ?? null,
    error_message: input.error_message ?? null,
  })

  return row
}

/**
 * 分页列出任务（Admin 查询用）。
 *
 * 始终按 `created_at DESC` 排序。
 */
export async function listAll(options: {
  limit?: number
  offset?: number
  provider?: string
  model?: string
  status?: AiTaskStatus
} = {}): Promise<AiTaskRow[]> {
  let query = getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .order('created_at', { ascending: false })

  if (options.provider) query = query.eq('provider', options.provider)
  if (options.model) query = query.eq('model', options.model)
  if (options.status) query = query.eq('status', options.status)

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`aiTask.listAll failed: ${error.message}`)
  }

  return (data as AiTaskRow[] | null) ?? []
}

/** 统计符合条件的任务数（Admin 查询用）。 */
export async function count(options: {
  provider?: string
  model?: string
  status?: AiTaskStatus
} = {}): Promise<number> {
  let query = getDb()
    .from(TABLES.aiTasks)
    .select('*', { count: 'exact', head: true })

  if (options.provider) query = query.eq('provider', options.provider)
  if (options.model) query = query.eq('model', options.model)
  if (options.status) query = query.eq('status', options.status)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`aiTask.count failed: ${error.message}`)
  }

  return total ?? 0
}

/** 列出用户的任务（带分页与状态过滤）。 */
export async function listByUser(
  userId: string,
  options: { limit?: number; offset?: number; status?: AiTaskStatus } = {}
): Promise<AiTaskRow[]> {
  let query = getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (options.status) query = query.eq('status', options.status)

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`aiTask.listByUser failed: ${error.message}`)
  }

  return (data as AiTaskRow[] | null) ?? []
}

/** 统计用户的任务数（与 `listByUser` 同过滤条件）。 */
export async function countByUser(
  userId: string,
  options: { status?: AiTaskStatus } = {}
): Promise<number> {
  let query = getDb()
    .from(TABLES.aiTasks)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (options.status) query = query.eq('status', options.status)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`aiTask.countByUser failed: ${error.message}`)
  }

  return total ?? 0
}

/**
 * 列出进行中的任务（Polling 用）。
 *
 * 只取 `processing` —— `pending` 表示尚未提交给 Provider，
 * 还没有 `provider_task_id`，轮不了。
 */
export async function findRunningTasks(limit = 50): Promise<AiTaskRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('status', 'processing')
    .not('provider_task_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`aiTask.findRunningTasks failed: ${error.message}`)
  }

  return (data as AiTaskRow[] | null) ?? []
}

/**
 * 列出到期可重试的任务（Polling 用）。
 *
 * 条件：仍在 `processing`、`next_retry_at` 已到期、且未用尽重试次数。
 */
export async function findRetryableTasks(limit = 50): Promise<AiTaskRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.aiTasks)
    .select('*')
    .eq('status', 'processing')
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`aiTask.findRetryableTasks failed: ${error.message}`)
  }

  const rows = (data as AiTaskRow[] | null) ?? []

  // 重试次数用尽的过滤掉（SQL 里不好表达「列 <= 列」之外的语义）
  return rows.filter((row) => (row.retry_count ?? 0) < (row.max_retries ?? 3))
}
