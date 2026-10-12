/**
 * 积分服务层（遗留但仍在用）。
 *
 * Phase 8 变更
 * ------------
 * 1. **移除 Flux 依赖**：原先 `import { getRequiredCredits } from '@/lib/flux-kontext-request'`，
 *    只被 `consumeCreditsForImageGeneration()` 使用 —— 那是个 Flux 专用函数。
 *    Flux 已改为经 `WorkflowService` 结算，该函数连同反向依赖一起删除。
 * 2. 删除 3 个全项目 0 引用的死导出：`grantUserCredits` / `grantWelcomeCredits` /
 *    `getUserCreditHistory`。
 *
 * 现在本文件只保留通用能力：`checkUserCredits` / `consumeUserCredits`。
 *
 * 真正的账本操作（原子 + 幂等）在 `src/lib/db/repositories/credit.ts`。
 */

import * as creditRepo from '@/lib/db/repositories/credit'
import * as userRepo from '@/lib/db/repositories/user'

// 🔥 积分操作类型
export type CreditTransactionType = 'purchase' | 'usage' | 'gift' | 'refund' | 'bonus'

// 🔥 积分操作接口
export interface CreditOperation {
  userId: string
  amount: number
  type: CreditTransactionType
  description: string
  referenceId?: string
  /**
   * 请求级幂等键。
   *
   * 同一个键只会成功扣减一次：重试 / 前端重复提交 / 网络重放都会命中幂等
   * 而不是重复扣费。不传则不启用幂等。
   *
   * 未提供时会退化为使用 `referenceId`（若它有稳定的业务语义，
   * 例如订单号、AI 任务的 taskId，就能起到幂等作用；
   * 若是 `xxx_<timestamp>` 这种每次不同的值，则不会去重）。
   */
  idempotencyKey?: string
  metadata?: any
}

// 🔥 积分检查结果
export interface CreditCheckResult {
  hasEnoughCredits: boolean
  currentCredits: number
  requiredCredits: number
  shortfall: number
}

// 🔥 积分操作结果
export interface CreditOperationResult {
  success: boolean
  transaction?: any
  user?: any
  error?: string
}

/**
 * 检查用户积分余额
 *
 * `requiredCredits` 没有默认值：一次生成扣多少属于**产品**的定价数据，
 * Core 猜一个数字会让漏传变成静默的错误扣费。调用方必须显式传入
 * （从模型目录或产品成本表取），漏传在编译期就失败。
 */
export async function checkUserCredits(
  userId: string,
  requiredCredits: number
): Promise<CreditCheckResult> {
  try {
    const user = await userRepo.findById(userId)

    const currentCredits = user?.credits || 0
    const hasEnoughCredits = currentCredits >= requiredCredits
    const shortfall = hasEnoughCredits ? 0 : requiredCredits - currentCredits

    return {
      hasEnoughCredits,
      currentCredits,
      requiredCredits,
      shortfall,
    }
  } catch (error) {
    console.error('积分检查失败:', error)
    return {
      hasEnoughCredits: false,
      currentCredits: 0,
      requiredCredits,
      shortfall: requiredCredits,
    }
  }
}

/**
 * 消耗用户积分
 *
 * ⚠️ Phase 3.5 变更：不再在 TypeScript 里「读余额 → 判断 → 扣减」。
 *
 * 旧实现是典型的 read-check-write 竞态：余额 100 时两个请求各扣 80，
 * 两者都会读到 100 并判断「够扣」，最终余额变成 -60。
 *
 * 现在整个操作下沉到数据库函数 `consume_credits`，由 Postgres 在一个事务内完成：
 *   幂等检查 → 余额检查 → 原子扣减 → 写流水
 *
 * 本函数只负责：参数校验 → 调用 Repository → 把数据库状态码翻译成业务结果。
 * 不自己模拟事务，不自己重复判断余额，不自己写流水。
 *
 * @see supabase/migrations/0005_atomic_credit_operations.sql
 */
export async function consumeUserCredits(
  operation: CreditOperation
): Promise<CreditOperationResult> {
  const { userId, amount, type, description, referenceId, idempotencyKey, metadata } =
    operation

  // 参数校验放在最前，避免无意义的数据库往返
  if (!userId) {
    return { success: false, error: '缺少 userId' }
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return { success: false, error: `扣减数量必须是正整数，收到: ${amount}` }
  }

  try {
    const result = await creditRepo.consumeCredits({
      user_id: userId,
      amount,
      idempotency_key: idempotencyKey ?? referenceId,
      type,
      description,
      reference_type: 'credit_operation',
      reference_id: referenceId,
      metadata: metadata
        ? { ...metadata, originalAmount: amount }
        : { originalAmount: amount },
    })

    switch (result.status) {
      case 'ok':
        return {
          success: true,
          transaction: { id: result.transactionId },
          user: {
            id: userId,
            creditsAfter: result.balance,
            creditsConsumed: amount,
          },
        }

      case 'duplicate':
        // 幂等命中：这次请求没有实际扣减，但业务上等价于成功
        // （同一个幂等键对应的那次扣减已经完成）。
        return {
          success: true,
          transaction: { id: result.transactionId, idempotent: true },
          user: {
            id: userId,
            creditsAfter: result.balance,
            creditsConsumed: 0,
          },
        }

      case 'insufficient':
        return {
          success: false,
          error: `积分余额不足，当前余额: ${result.balance}，需要: ${amount}`,
        }

      case 'invalid_amount':
        return { success: false, error: `扣减数量非法: ${amount}` }

      case 'user_not_found':
        return { success: false, error: '用户不存在' }

      default:
        return { success: false, error: `未知的扣减结果: ${result.status}` }
    }
  } catch (error) {
    console.error('积分消耗失败:', error)
    return {
      success: false,
      error: '积分消耗操作失败',
    }
  }
}
