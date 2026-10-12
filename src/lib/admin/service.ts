/**
 * Admin Service — Admin 查询聚合 + 敏感操作编排
 *
 * 职责边界：
 *   ✅ 授权后的分页查询（复用现有 Repository）
 *   ✅ Credit 调整编排（校验 → Credit 原子 RPC → Audit）
 *   ❌ 不自己实现鉴权（那是 authorization.ts）
 *   ❌ 不自己 UPDATE users.credits（必须走 credit.grantCredits() 原子 RPC）
 *   ❌ 不重新实现 Billing / Credit / Storage 领域逻辑
 */

import * as userRepo from '@/lib/db/repositories/user'
import * as orderRepo from '@/lib/db/repositories/order'
import * as creditRepo from '@/lib/db/repositories/credit'
import * as subscriptionRepo from '@/lib/db/repositories/subscription'
import * as aiTaskRepo from '@/lib/db/repositories/ai-task'
import * as auditRepo from '@/lib/db/repositories/admin-audit-log'

import { AdminError } from './errors'
import { toPaginated, type Paginated, type PaginationParams } from './pagination'

import type {
  AiTaskRow,
  AiTaskStatus,
  CreditTransactionRow,
  CreditTransactionType,
  OrderRow,
  OrderStatus,
  SubscriptionRow,
  SubscriptionStatus,
  UserRow,
} from '@/lib/db/types'

/** Admin credit 调整上限（防止误操作写入超大数值）。 */
export const MAX_ADMIN_CREDIT_ADJUSTMENT = 1_000_000

/**
 * 按 email/name 搜索时最多解析多少个用户。
 *
 * 订阅表没有 email 列，只能先查 users 拿到 id 列表再过滤
 * （`user_id IN (...)`）。这个上限防止搜索结果过大导致查询退化。
 */
const MAX_SEARCH_USERS = 200

/** 按 email / name 搜索用户 id（供订阅等无 email 列的表使用）。 */
async function resolveUserIdsBySearch(search: string): Promise<string[]> {
  const users = await userRepo.listAll({ search, limit: MAX_SEARCH_USERS })
  return users.map((u) => u.id)
}

// ─────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────

export async function listUsers(
  params: PaginationParams & { search?: string; role?: string }
): Promise<Paginated<UserRow>> {
  const [items, total] = await Promise.all([
    userRepo.listAll({
      limit: params.pageSize,
      offset: params.offset,
      search: params.search,
      role: params.role,
    }),
    userRepo.count({ search: params.search, role: params.role }),
  ])

  return toPaginated(items, total, params)
}

export interface UserDetail {
  user: UserRow
  credits: number
  orders: OrderRow[]
  subscriptions: SubscriptionRow[]
  aiTasks: AiTaskRow[]
  creditTransactions: CreditTransactionRow[]
  auditLogs: Awaited<ReturnType<typeof auditRepo.list>>
}

export async function getUserDetail(id: string): Promise<UserDetail> {
  const user = await userRepo.findById(id)

  if (!user) {
    throw new AdminError('User not found', 404, 'NOT_FOUND')
  }

  const [credits, orders, subscriptions, aiTasks, creditTransactions, auditLogs] =
    await Promise.all([
      creditRepo.getBalance(id),
      orderRepo.listByUser(id),
      subscriptionRepo.listByUser(id),
      aiTaskRepo.listByUser(id, { limit: 20 }),
      creditRepo.listTransactions(id, 20),
      auditRepo.list({ targetUserId: id, limit: 20 }),
    ])

  return {
    user,
    credits,
    orders,
    subscriptions,
    aiTasks,
    creditTransactions,
    auditLogs,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────

export async function listOrders(
  params: PaginationParams & { status?: string; provider?: string; search?: string }
): Promise<Paginated<OrderRow>> {
  const statuses = params.status
    ? [params.status as OrderStatus]
    : undefined
  const where = params.provider ? { payment_provider: params.provider } : undefined

  const [items, total] = await Promise.all([
    orderRepo.listAll({
      limit: params.pageSize,
      skip: params.offset,
      statuses,
      where,
      search: params.search,
    }),
    orderRepo.count({ statuses, where, search: params.search }),
  ])

  return toPaginated(items, total, params)
}

export async function getOrderDetail(id: string): Promise<{
  order: OrderRow
  user: UserRow | null
  creditTransactions: CreditTransactionRow[]
}> {
  const order = await orderRepo.findById(id)

  if (!order) {
    throw new AdminError('Order not found', 404, 'NOT_FOUND')
  }

  const [user, creditTransactions] = await Promise.all([
    order.user_id ? userRepo.findById(order.user_id) : Promise.resolve(null),
    creditRepo.listByOrderId(id),
  ])

  return { order, user, creditTransactions }
}

// ─────────────────────────────────────────────────────────────────────
// Credits
// ─────────────────────────────────────────────────────────────────────

export async function listCreditTransactions(
  params: PaginationParams & { userId?: string; type?: string; search?: string }
): Promise<Paginated<CreditTransactionRow>> {
  const type = params.type as CreditTransactionType | undefined

  // 流水表没有 email 列：按 email/name 搜索时先解析 user id 列表
  const userIds = params.search?.trim()
    ? await resolveUserIdsBySearch(params.search.trim())
    : undefined

  const [items, total] = await Promise.all([
    creditRepo.listAll({
      limit: params.pageSize,
      offset: params.offset,
      userId: params.userId,
      userIds,
      type,
    }),
    creditRepo.countTransactions({ userId: params.userId, userIds, type }),
  ])

  return toPaginated(items, total, params)
}

export interface GrantCreditsParams {
  adminUserId: string
  targetUserId: string
  amount: number
  reason: string
}

export interface GrantCreditsOutcome {
  balance: number
  transactionId: string | null
  idempotent: boolean
}

/**
 * Admin 给用户发放积分。
 *
 * 必须经过 Credit 的**原子 RPC**（`credit.grantCredits()` → `grant_credits()`），
 * 而不是 `UPDATE users SET credits = credits + n`。
 *
 * 流程：校验 → 确认目标用户存在 → 原子发放 → 写审计日志。
 */
export async function grantCredits(
  params: GrantCreditsParams
): Promise<GrantCreditsOutcome> {
  const { adminUserId, targetUserId, amount, reason } = params

  // ── 输入校验 ─────────────────────────────────────────────────────
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new AdminError('amount must be a positive integer', 400, 'INVALID_AMOUNT')
  }

  if (amount > MAX_ADMIN_CREDIT_ADJUSTMENT) {
    throw new AdminError(
      `amount exceeds the maximum allowed (${MAX_ADMIN_CREDIT_ADJUSTMENT})`,
      400,
      'AMOUNT_TOO_LARGE'
    )
  }

  if (!reason || !reason.trim()) {
    throw new AdminError('reason is required', 400, 'MISSING_REASON')
  }

  // ── 目标用户必须存在（不信任客户端传的 email） ───────────────────
  const target = await userRepo.findById(targetUserId)

  if (!target) {
    throw new AdminError('Target user not found', 404, 'NOT_FOUND')
  }

  // ── 原子发放（RPC：grant_credits） ───────────────────────────────
  const result = await creditRepo.grantCredits({
    user_id: targetUserId,
    amount,
    type: 'adjustment',
    description: reason.trim(),
    reference_type: 'admin_adjustment',
    reference_id: `admin_${adminUserId}_${Date.now()}`,
    metadata: {
      admin_user_id: adminUserId,
      source: 'admin_console',
    },
  })

  if (result.status !== 'ok' && result.status !== 'duplicate') {
    throw new AdminError(
      `Credit grant failed: ${result.status}`,
      500,
      'GRANT_FAILED'
    )
  }

  // ── 审计 ─────────────────────────────────────────────────────────
  try {
    await auditRepo.create({
      admin_user_id: adminUserId,
      action: 'credit_grant',
      target_user_id: targetUserId,
      target_type: 'user',
      target_id: targetUserId,
      amount,
      reason: reason.trim(),
      metadata: {
        transaction_id: result.transactionId,
        balance_after: result.balance,
      },
    })
  } catch (error) {
    // 审计失败不应回滚已经成功的积分发放（发放本身已原子提交）。
    console.error('[admin] failed to write audit log:', error)
  }

  return {
    balance: result.balance,
    transactionId: result.transactionId,
    idempotent: result.idempotent,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────

export async function listSubscriptions(
  params: PaginationParams & { status?: string; provider?: string; search?: string }
): Promise<Paginated<SubscriptionRow>> {
  const status = params.status as SubscriptionStatus | undefined

  // 订阅表没有 email 列：先按 email/name 解析出 user id 列表再过滤
  const userIds = params.search?.trim()
    ? await resolveUserIdsBySearch(params.search.trim())
    : undefined

  const [items, total] = await Promise.all([
    subscriptionRepo.listAll({
      limit: params.pageSize,
      offset: params.offset,
      status,
      provider: params.provider,
      userIds,
    }),
    subscriptionRepo.count({ status, provider: params.provider, userIds }),
  ])

  return toPaginated(items, total, params)
}

export async function getSubscriptionDetail(id: string): Promise<{
  subscription: SubscriptionRow
  user: UserRow | null
}> {
  const subscription = await subscriptionRepo.findById(id)

  if (!subscription) {
    throw new AdminError('Subscription not found', 404, 'NOT_FOUND')
  }

  const user = subscription.user_id
    ? await userRepo.findById(subscription.user_id)
    : null

  return { subscription, user }
}

// ─────────────────────────────────────────────────────────────────────
// AI Tasks
// ─────────────────────────────────────────────────────────────────────

export async function listAiTasks(
  params: PaginationParams & {
    provider?: string
    model?: string
    status?: string
  }
): Promise<Paginated<AiTaskRow>> {
  const status = params.status as AiTaskStatus | undefined

  const [items, total] = await Promise.all([
    aiTaskRepo.listAll({
      limit: params.pageSize,
      offset: params.offset,
      provider: params.provider,
      model: params.model,
      status,
    }),
    aiTaskRepo.count({
      provider: params.provider,
      model: params.model,
      status,
    }),
  ])

  return toPaginated(items, total, params)
}

export async function getAiTaskDetail(id: string): Promise<{
  task: AiTaskRow
  user: UserRow | null
}> {
  const task = await aiTaskRepo.findById(id)

  if (!task) {
    throw new AdminError('AI task not found', 404, 'NOT_FOUND')
  }

  const user = task.user_id ? await userRepo.findById(task.user_id) : null

  return { task, user }
}

// ─────────────────────────────────────────────────────────────────────
// Audit logs
// ─────────────────────────────────────────────────────────────────────

export async function listAuditLogs(
  params: PaginationParams & { adminUserId?: string; targetUserId?: string }
) {
  const [items, total] = await Promise.all([
    auditRepo.list({
      limit: params.pageSize,
      offset: params.offset,
      adminUserId: params.adminUserId,
      targetUserId: params.targetUserId,
    }),
    auditRepo.count({
      adminUserId: params.adminUserId,
      targetUserId: params.targetUserId,
    }),
  ])

  return toPaginated(items, total, params)
}
