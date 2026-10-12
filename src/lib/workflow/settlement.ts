/**
 * Task 的积分生命周期（规格 §18 / §19）
 *
 * 选型：**创建任务时 consume，失败 / 超时 refund**。
 *
 * 为什么不是 reserve → settle
 * ---------------------------
 * 现有 credit 模型（Phase 3.5）只有原子 `consume_credits()` 与 `grant_credits()`，
 * 没有「预留」状态。规格也说「不要重新发明 credit 系统」。
 * 引入 reserve 需要新的 RPC + 新的流水类型，收益却只是让记账更"好看"。
 * 因此沿用 consume 语义：扣费与退款都用**已有的原子 RPC**。
 *
 * 幂等怎么保证
 * ------------
 * 1. 扣费：`idempotency_key = task:<taskId>:charge`
 *    —— 同一个任务重复扣费时，RPC 返回 `duplicate`，余额不变。
 * 2. 退款：`idempotency_key = task:<taskId>:refund`
 *    —— webhook 重复触发 / 失败与超时同时发生时，只退一次。
 * 3. 额外一层应用级守卫：任务行上的 `credits_refunded > 0` 时直接跳过退款。
 *    （双重保险 —— RPC 幂等是数据库层保证，这里是避免无谓的往返）
 */

import { consumeCredits, grantCredits } from '@/lib/db/repositories/credit'
import { logTaskError, logTaskEvent } from '@/lib/workflow/logger'
import type { TaskLogContext } from '@/lib/workflow/types'

export interface ChargeResult {
  transactionId: string | null
  balance: number
  /** true 表示命中幂等，未实际扣费。 */
  idempotent: boolean
}

export interface RefundResult {
  transactionId: string | null
  balance: number
  /** true 表示命中幂等或已退过，未实际退款。 */
  idempotent: boolean
}

/** 扣费幂等键。 */
export function chargeKey(taskId: string): string {
  return `task:${taskId}:charge`
}

/** 退款幂等键。 */
export function refundKey(taskId: string): string {
  return `task:${taskId}:refund`
}

/**
 * 扣取任务积分。
 *
 * @throws 余额不足时返回 status='insufficient'（不是抛错），调用方需自行判断。
 */
export async function chargeTask(params: {
  taskId: string
  userId: string
  amount: number
  model: string
  log?: TaskLogContext
}): Promise<
  | { ok: true; result: ChargeResult }
  | { ok: false; reason: 'insufficient' | 'error'; balance?: number; message: string }
> {
  const result = await consumeCredits({
    user_id: params.userId,
    amount: params.amount,
    type: 'usage',
    description: `AI generation - ${params.model}`,
    idempotency_key: chargeKey(params.taskId),
    reference_type: 'ai_task',
    reference_id: params.taskId,
    metadata: { model: params.model, entrypoint: 'workflow' },
  })

  if (result.status === 'ok') {
    return {
      ok: true,
      result: {
        transactionId: result.transactionId ?? null,
        balance: result.balance,
        idempotent: false,
      },
    }
  }

  if (result.status === 'duplicate') {
    // 已经扣过了 —— 不应该发生（幂等键含 taskId），但不该因此失败
    return {
      ok: true,
      result: {
        transactionId: result.transactionId ?? null,
        balance: result.balance,
        idempotent: true,
      },
    }
  }

  if (result.status === 'insufficient') {
    return {
      ok: false,
      reason: 'insufficient',
      balance: result.balance,
      message: `Insufficient credits: need ${params.amount}, balance ${result.balance}`,
    }
  }

  return {
    ok: false,
    reason: 'error',
    message: `Credit deduction failed: ${result.status}`,
  }
}

/**
 * 退还任务积分。
 *
 * 幂等三重保证：
 *   1. 调用方传入 `alreadyRefunded`（来自任务行的 credits_refunded > 0）
 *   2. 固定 `idempotency_key = task:<taskId>:refund`
 *   3. RPC 自身的唯一索引
 */
export async function refundTask(params: {
  taskId: string
  userId: string
  amount: number
  reason: string
  alreadyRefunded?: boolean
  log?: TaskLogContext
}): Promise<RefundResult | null> {
  if (params.amount <= 0) {
    return null
  }

  if (params.alreadyRefunded) {
    return { transactionId: null, balance: 0, idempotent: true }
  }

  const result = await grantCredits({
    user_id: params.userId,
    amount: params.amount,
    type: 'refund',
    description: `Refund for failed AI task (${params.reason})`,
    idempotency_key: refundKey(params.taskId),
    reference_type: 'ai_task_refund',
    reference_id: params.taskId,
    metadata: { reason: params.reason, entrypoint: 'workflow' },
  })

  if (result.status !== 'ok' && result.status !== 'duplicate') {
    // 退款失败必须大声说 —— 用户已经付了积分却没拿到结果
    logTaskError('task.failed', params.log ?? { taskId: params.taskId }, {
      message: `Refund failed: ${result.status}`,
    })
    return null
  }

  if (params.log) {
    logTaskEvent('task.refunded', params.log)
  }

  return {
    transactionId: result.transactionId ?? null,
    balance: result.balance,
    idempotent: result.idempotent ?? result.status === 'duplicate',
  }
}
