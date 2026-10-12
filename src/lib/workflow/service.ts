/**
 * WorkflowService —— AI Task 生命周期编排（规格 §9）
 *
 * 分层：
 *
 *   API  →  WorkflowService  →  AITaskRepository  →  DB
 *                            →  AIService         →  AIProvider
 *                            →  settlement.ts     →  Credit RPC
 *                            →  storage.ts        →  StorageService
 *
 * 刻意只建**一个** Service（规格 §9：「不要同时创建两个职责高度重复的 Service」）。
 * 状态推进 / 积分结算 / 结果落盘各自拆在独立文件里，避免这里变成 1000 行。
 *
 * 不做的边界：
 *   · 不直接调用 Provider SDK（走 AIService）
 *   · 不直接改数据库状态（走 Repository 的 transitionStatus）
 *   · 不直接调 S3 / R2（走 storage.ts → StorageService）
 */

import * as taskRepo from '@/lib/db/repositories/ai-task'
import type { AiTaskRow, AiTaskStatus } from '@/lib/db/types'
import { AIService } from '@/lib/ai/service'
import { getModel } from '@/lib/ai/models'
import type { AITaskHandle, AITaskResult } from '@/lib/ai/types'
import { checkUserCredits } from '@/lib/services/credits'
import { TaskError, toTaskError } from '@/lib/workflow/errors'
import { logTaskError, logTaskEvent } from '@/lib/workflow/logger'
import { normalizeTaskResult } from '@/lib/workflow/result'
import { chargeTask, refundTask } from '@/lib/workflow/settlement'
import { isTerminal } from '@/lib/workflow/state-machine'
import { persistResult } from '@/lib/workflow/storage'
import { parseWebhookPayload } from '@/lib/workflow/webhook-payload'
import type {
  AITask,
  CreateTaskInput,
  CreateTaskResult,
  TaskLogContext,
} from '@/lib/workflow/types'

/** 默认重试上限（规格 §17）。 */
export const DEFAULT_MAX_RETRIES = 3

/** 最小退避：第 n 次重试前等待 `min(5s * 2^n, 60s)`。不做复杂指数退避系统。 */
function nextRetryDelayMs(retryCount: number): number {
  return Math.min(5_000 * 2 ** retryCount, 60_000)
}

function logContextFor(row: AiTaskRow): TaskLogContext {
  return {
    taskId: row.id,
    userId: row.user_id,
    provider: row.provider,
    model: row.model,
  }
}

// ─────────────────────────────────────────────────────────────────────
// 创建任务
// ─────────────────────────────────────────────────────────────────────

/**
 * 创建一个 AI 任务：校验 → 建行 → 扣积分 → 提交 Provider。
 *
 * **默认不等待 Provider 完成**（规格 §13）—— 异步 Provider 提交后立即返回，
 * 客户端再轮询 `GET /api/ai/tasks/:id`。
 *
 * @throws TaskError —— INVALID_REQUEST / UNKNOWN_MODEL / UNSUPPORTED_MODEL /
 *                     INSUFFICIENT_CREDITS / CREDIT_DEDUCTION_FAILED
 */
export async function createTask(
  input: CreateTaskInput
): Promise<CreateTaskResult> {
  // ── 1. 校验模型 ────────────────────────────────────────────────────
  let model

  try {
    model = getModel(input.model)
  } catch {
    throw new TaskError('UNKNOWN_MODEL', `Unknown model "${input.model}"`)
  }

  // ── 2. 解析 Provider（不支持该模型时会抛错，不静默换家） ────────────
  let providerName: string

  try {
    providerName = AIService.resolveProvider({
      model: model.id,
      provider: input.provider,
    }).name
  } catch (error) {
    throw new TaskError('UNSUPPORTED_MODEL', (error as Error).message, {
      cause: error,
    })
  }

  // ── 3. 幂等：同一用户 + 同一键只建一条 ──────────────────────────────
  if (input.idempotencyKey) {
    const existing = await taskRepo.findByIdempotencyKey(
      input.userId,
      input.idempotencyKey
    )

    if (existing) {
      logTaskEvent('task.created', {
        ...logContextFor(existing),
        deduplicated: true,
      })
      return { task: toTask(existing), deduplicated: true }
    }
  }

  // ── 4. 余额检查（在创建任务行之前，避免留下无意义的失败记录） ────────
  const creditCheck = await checkUserCredits(input.userId, model.credits)

  if (!creditCheck.hasEnoughCredits) {
    throw new TaskError(
      'INSUFFICIENT_CREDITS',
      `Requires ${model.credits} credits, balance ${creditCheck.currentCredits}`
    )
  }

  // ── 5. 建任务行（pending） ──────────────────────────────────────────
  const row = await taskRepo.create({
    user_id: input.userId,
    model: model.id,
    provider: providerName,
    prompt: input.prompt,
    status: 'pending',
    input_metadata: {
      ...(input.inputImages?.length ? { inputImages: input.inputImages } : {}),
      ...(input.parameters ? { parameters: input.parameters } : {}),
    },
    idempotency_key: input.idempotencyKey ?? null,
    max_retries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
  })

  logTaskEvent('task.created', logContextFor(row))

  // ── 6. 扣积分（原子 RPC + 幂等） ────────────────────────────────────
  const charged = await chargeTask({
    taskId: row.id,
    userId: input.userId,
    amount: model.credits,
    model: model.id,
    log: logContextFor(row),
  })

  if (!charged.ok) {
    const code = charged.reason === 'insufficient' ? 'INSUFFICIENT_CREDITS' : 'CREDIT_DEDUCTION_FAILED'

    // 扣费失败 → 任务直接终态 failed，无需退款（没扣成功）
    await taskRepo.transitionStatus(row.id, 'failed', {
      error_code: code,
      error_message: charged.message,
    })

    throw new TaskError(code, charged.message)
  }

  const chargedRow = await taskRepo.update(row.id, {
    credit_transaction_id: charged.result.transactionId,
    credits_used: model.credits,
  })

  // ── 7. 提交 Provider ────────────────────────────────────────────────
  if (input.waitForResult) {
    // 同步路径：阻塞直到拿到结果（供同步 Provider / 旧链路兼容）
    return {
      task: await runSynchronously(chargedRow, input, model.modality),
      deduplicated: false,
    }
  }

  return { task: await submitTask(chargedRow.id), deduplicated: false }
}

/** 同步执行（阻塞）。仅当调用方显式 `waitForResult: true`。 */
async function runSynchronously(
  row: AiTaskRow,
  input: CreateTaskInput,
  modality: ReturnType<typeof getModel>['modality']
): Promise<AITask> {
  await taskRepo.transitionStatus(row.id, 'processing')

  try {
    const result = await AIService.generate({
      model: row.model,
      provider: row.provider,
      prompt: input.prompt,
      inputImages: input.inputImages,
      parameters: input.parameters,
    })

    return await completeTask(row.id, result, modality)
  } catch (error) {
    return await failTask(row.id, toTaskError(error))
  }
}

/**
 * 把任务提交给 Provider（异步路径）。
 *
 * 提交成功即返回，**不等待生成完成**。
 */
export async function submitTask(taskId: string): Promise<AITask> {
  const row = await taskRepo.findById(taskId)

  if (!row) {
    throw new TaskError('INVALID_REQUEST', `Task ${taskId} not found`)
  }

  if (isTerminal(row.status)) {
    // 已经是终态 —— 不重复提交
    return toTask(row)
  }

  const { row: processing } = await taskRepo.transitionStatus(row.id, 'processing')
  const input = (processing.input_metadata ?? {}) as {
    inputImages?: string[]
    parameters?: Record<string, unknown>
  }

  try {
    const handle: AITaskHandle = await AIService.submitTask({
      model: processing.model,
      provider: processing.provider,
      prompt: processing.prompt ?? '',
      inputImages: input.inputImages,
      parameters: input.parameters,
    })

    const updated = await taskRepo.update(processing.id, {
      provider_task_id: handle.taskId,
    })

    logTaskEvent('task.submitted', {
      ...logContextFor(updated),
      providerTaskId: handle.taskId,
    })

    return toTask(updated)
  } catch (error) {
    return await failTask(processing.id, toTaskError(error))
  }
}

// ─────────────────────────────────────────────────────────────────────
// 结果 / 失败处理
// ─────────────────────────────────────────────────────────────────────

/** 处理 Provider 成功结果：归一化 → 落 Storage → 推进 completed。 */
export async function handleProviderResult(
  taskId: string,
  result: Awaited<ReturnType<typeof AIService.generate>>
): Promise<AITask> {
  let model

  try {
    model = getModel(result.model)
  } catch {
    model = null
  }

  return completeTask(taskId, result, model?.modality ?? 'image')
}

async function completeTask(
  taskId: string,
  result: Awaited<ReturnType<typeof AIService.generate>>,
  modality: ReturnType<typeof getModel>['modality']
): Promise<AITask> {
  const row = await taskRepo.findById(taskId)

  if (!row) {
    throw new TaskError('INVALID_REQUEST', `Task ${taskId} not found`)
  }

  // 幂等：已完成的任务不重复处理（webhook 重复触发的核心保障）
  if (row.status === 'completed') {
    return toTask(row)
  }

  const normalized = normalizeTaskResult(result, modality)

  const withStorage = await persistResult({
    result: normalized,
    userId: row.user_id ?? '',
    prompt: row.prompt,
    log: logContextFor(row),
  })

  const { row: completed } = await taskRepo.transitionStatus(taskId, 'completed', {
    output_metadata: {
      assets: withStorage.assets,
      provider: withStorage.provider,
      model: withStorage.model,
      modality: withStorage.modality,
      ...(withStorage.metadata ? { metadata: withStorage.metadata } : {}),
    },
    error_code: null,
    error_message: null,
  })

  logTaskEvent('task.completed', {
    ...logContextFor(completed),
    assetCount: withStorage.assets.length,
  })

  return toTask(completed)
}

/**
 * 处理 Provider 失败：可重试且未用尽 → 排期重试；否则 → failed + 退款。
 *
 * 规格 §17：参数错误 / 认证错误不重试；5xx / timeout 可重试。
 */
export async function handleProviderFailure(
  taskId: string,
  error: TaskError
): Promise<AITask> {
  return failTask(taskId, error)
}

async function failTask(taskId: string, error: TaskError): Promise<AITask> {
  const row = await taskRepo.findById(taskId)

  if (!row) {
    throw new TaskError('INVALID_REQUEST', `Task ${taskId} not found`)
  }

  // 幂等：终态不再处理
  if (isTerminal(row.status)) {
    return toTask(row)
  }

  const retryCount = row.retry_count ?? 0
  const maxRetries = row.max_retries ?? DEFAULT_MAX_RETRIES

  // ── 重试分支 ────────────────────────────────────────────────────
  if (error.retryable && retryCount < maxRetries) {
    await taskRepo.update(taskId, {
      retry_count: retryCount + 1,
      next_retry_at: new Date(
        Date.now() + nextRetryDelayMs(retryCount)
      ).toISOString(),
      error_code: error.code,
      error_message: error.message,
    })

    logTaskEvent('task.retrying', {
      ...logContextFor(row),
      retryCount: retryCount + 1,
      maxRetries,
      code: error.code,
    })

    // 立即重提交（processing → processing 是显式允许的"重试"转换）
    return submitTask(taskId)
  }

  // ── 终态 failed + 退款 ───────────────────────────────────────────
  const { row: failed } = await taskRepo.transitionStatus(taskId, 'failed', {
    error_code: error.code,
    error_message: error.message,
  })

  logTaskError('task.failed', { ...logContextFor(failed), code: error.code }, error)

  if (failed.user_id && (failed.credits_used ?? 0) > 0) {
    const refund = await refundTask({
      taskId: failed.id,
      userId: failed.user_id,
      amount: failed.credits_used ?? 0,
      reason: error.code,
      alreadyRefunded: (failed.credits_refunded ?? 0) > 0,
      log: logContextFor(failed),
    })

    if (refund && !refund.idempotent) {
      await taskRepo.update(failed.id, {
        credits_refunded: failed.credits_used ?? 0,
        refund_transaction_id: refund.transactionId,
      })
    }
  }

  return toTask(await reload(failed.id))
}

// ─────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────

export interface WebhookOutcome {
  status: number
  body: Record<string, unknown>
}

/**
 * 处理 Provider webhook（规格 §15）。
 *
 * 步骤：找 provider → 验签 → 解析 payload → 定位 task → 幂等 → 推进状态。
 *
 * 幂等保证：
 *   · 任务已是 completed/failed → 直接返回 200，不再处理
 *   · 退款用固定幂等键 `task:<id>:refund`
 */
export async function handleWebhook(params: {
  provider: string
  rawBody: string
  headers: Headers | Record<string, string | undefined>
}): Promise<WebhookOutcome> {
  // ── 1. 验签 ────────────────────────────────────────────────────────
  let verified = false
  let verificationAvailable = true

  try {
    verified = await AIService.verifyWebhook(
      params.provider,
      params.rawBody,
      params.headers
    )
  } catch (error) {
    logTaskError('task.webhook.received', { taskId: 'unknown' }, error)
    return { status: 500, body: { error: 'Webhook verification error' } }
  }

  if (!verified) {
    // 规格 §28：Provider 没有签名校验能力时**不伪造**通过，
    // 但要明确区分「校验失败」与「该 Provider 不支持校验」。
    const hasSecret = hasWebhookSecret(params.provider)
    verificationAvailable = hasSecret

    if (hasSecret) {
      return { status: 401, body: { error: 'Invalid webhook signature' } }
    }

    return {
      status: 501,
      body: {
        error: 'Webhook signature verification unavailable for this provider',
        provider: params.provider,
        hint: 'Configure the provider webhook secret, or poll task status instead',
      },
    }
  }

  // ── 2. 解析 payload ────────────────────────────────────────────────
  const parsed = parseWebhookPayload(params.rawBody)

  if (!parsed) {
    return {
      status: 400,
      body: {
        error: 'Unrecognized webhook payload: cannot determine taskId or state',
        hint: 'Provider payload shape not supported yet; see docs/PHASE_7_FOLLOWUPS.md',
      },
    }
  }

  // ── 3. 定位任务 ────────────────────────────────────────────────────
  const row = await taskRepo.findByProviderTaskId(
    params.provider,
    parsed.providerTaskId
  )

  if (!row) {
    return { status: 404, body: { error: 'Task not found for provider task id' } }
  }

  logTaskEvent('task.webhook.received', {
    ...logContextFor(row),
    state: parsed.state,
  })

  // ── 4. 幂等 ────────────────────────────────────────────────────────
  if (isTerminal(row.status)) {
    logTaskEvent('task.webhook.duplicate', logContextFor(row))
    return { status: 200, body: { ok: true, taskId: row.id, duplicate: true } }
  }

  // ── 5. 推进状态 ────────────────────────────────────────────────────
  if (parsed.state === 'completed') {
    // webhook 只带状态，结果需要回查 Provider
    const taskResult = await AIService.getTaskResult(
      parsed.providerTaskId,
      row.model,
      row.provider
    )

    const task = await handleProviderResult(row.id, toGenerateResult(taskResult, row))

    return { status: 200, body: { ok: true, taskId: task.id, status: task.status } }
  }

  const task = await failTask(
    row.id,
    new TaskError('PROVIDER_TASK_FAILED', parsed.error ?? 'Provider reported failure')
  )

  return { status: 200, body: { ok: true, taskId: task.id, status: task.status } }
}

/** 把 `AITaskResult` 转成 `GenerateResult`（webhook 路径复用完成逻辑）。 */
function toGenerateResult(
  taskResult: AITaskResult,
  row: AiTaskRow
): Awaited<ReturnType<typeof AIService.generate>> {
  if (taskResult.result) {
    return taskResult.result
  }

  throw new TaskError(
    'PROVIDER_TASK_FAILED',
    taskResult.error ?? 'Provider reported completed but returned no result'
  )
}

/** 判断该 Provider 是否配置了 webhook 密钥（用于区分"不支持"与"校验失败"）。 */
function hasWebhookSecret(provider: string): boolean {
  switch (provider) {
    case 'kie':
      return !!process.env.KIE_WEBHOOK_SIGNING_SECRET?.trim()
    case 'wavespeed':
      return !!process.env.WAVESPEED_WEBHOOK_SECRET?.trim()
    default:
      // fal / atlascloud 未实现 verifyWebhook
      return false
  }
}

// ─────────────────────────────────────────────────────────────────────
// Polling（规格 §16）
// ─────────────────────────────────────────────────────────────────────

/** 轮询单个任务：查 Provider → 推进状态。 */
export async function pollTask(taskId: string): Promise<AITask | null> {
  const row = await taskRepo.findById(taskId)

  if (!row || !row.provider_task_id) {
    return row ? toTask(row) : null
  }

  if (isTerminal(row.status)) {
    return toTask(row)
  }

  try {
    const taskResult = await AIService.getTaskResult(
      row.provider_task_id,
      row.model,
      row.provider
    )

    return await applyProviderState(row.id, taskResult)
  } catch (error) {
    return await failTask(row.id, toTaskError(error))
  }
}

async function applyProviderState(
  taskId: string,
  taskResult: AITaskResult
): Promise<AITask> {
  switch (taskResult.state) {
    case 'completed': {
      const row = await taskRepo.findById(taskId)
      if (!row) throw new TaskError('INVALID_REQUEST', `Task ${taskId} not found`)
      return handleProviderResult(taskId, toGenerateResult(taskResult, row))
    }

    case 'failed':
      return failTask(
        taskId,
        new TaskError('PROVIDER_TASK_FAILED', taskResult.error ?? 'Provider task failed')
      )

    default:
      // queued / processing —— 保持现状
      const row = await taskRepo.findById(taskId)
      return row ? toTask(row) : (null as unknown as AITask)
  }
}

/** 批量轮询所有进行中的任务。 */
export async function pollRunningTasks(
  limit = 50
): Promise<{ polled: number; completed: number; failed: number }> {
  const rows = await taskRepo.findRunningTasks(limit)

  let completed = 0
  let failed = 0

  for (const row of rows) {
    try {
      const task = await pollTask(row.id)

      if (task?.status === 'completed') completed += 1
      else if (task?.status === 'failed') failed += 1
    } catch (error) {
      logTaskError('task.failed', logContextFor(row), error)
      failed += 1
    }
  }

  return { polled: rows.length, completed, failed }
}

// ─────────────────────────────────────────────────────────────────────
// 查询
// ─────────────────────────────────────────────────────────────────────

/**
 * 按 id 取任务。
 *
 * `userId` 非空时会校验归属 —— **普通用户查询必须传**，
 * 否则可以通过枚举 id 看到别人的任务（规格 §14）。
 */
export async function getTask(
  taskId: string,
  options: { userId?: string } = {}
): Promise<AITask | null> {
  const row = await taskRepo.findById(taskId)

  if (!row) return null

  if (options.userId && row.user_id !== options.userId) {
    return null
  }

  return toTask(row)
}

/** 列出当前用户的任务（强制按 user_id 收窄）。 */
export async function listUserTasks(
  userId: string,
  options: { limit?: number; offset?: number; status?: AiTaskStatus } = {}
): Promise<{ items: AITask[]; total: number }> {
  const [rows, total] = await Promise.all([
    taskRepo.listByUser(userId, options),
    taskRepo.countByUser(userId, { status: options.status }),
  ])

  return { items: rows.map(toTask), total }
}

// ─────────────────────────────────────────────────────────────────────
// 映射
// ─────────────────────────────────────────────────────────────────────

/** 行 → 领域对象，并补上模型模态。 */
function toTask(row: AiTaskRow): AITask {
  const task = taskRepo.toDomain(row)

  try {
    task.modality = getModel(row.model).modality
  } catch {
    // 模型已下线时用表里的信息兜底
  }

  return task
}

async function reload(id: string): Promise<AiTaskRow> {
  const row = await taskRepo.findById(id)

  if (!row) {
    throw new TaskError('INVALID_REQUEST', `Task ${id} not found`)
  }

  return row
}

export const WorkflowService = {
  createTask,
  submitTask,
  handleProviderResult,
  handleProviderFailure,
  handleWebhook,
  pollTask,
  pollRunningTasks,
  getTask,
  listUserTasks,
}
