/**
 * Credit Repository
 *
 * 只做数据操作。**不负责**积分规则：
 *   · 不决定一次生成该扣多少（那是产品模型目录的 `credits` 字段）
 *   · 不编排「扣积分 → 调 AI → 失败退款」（那是未来的 CreditService / Workflow）
 *   · 不做权限判断
 *
 * 余额位置说明
 * ------------
 * 当前余额存放在 `users.credits` 单列，而不是独立的 `credit_accounts` 表。
 *
 * 为什么不建 credit_accounts（见 docs/DATABASE.md 的决策记录）：
 *   1. 移动余额需要改动 29 处调用点，属于业务逻辑改造，被 Phase 3 明确禁止；
 *   2. 若现在建表但没人写入，它会立刻与 users.credits 不一致 —— 比不建更危险；
 *   3. 用户约束「不要为了架构完整创建没有实际使用的 abstraction」。
 *   因此本文件把余额读写**集中在一处**，将来要迁移到 credit_accounts，
 *   只需改这一个文件。
 *
 * 已知限制（记录在案）
 * --------------------
 * `adjustBalance` 是「读 → 算 → 写」，**不是原子的**，高并发下可能超扣。
 *
 * ⚠️ 因此它**不能用于消费积分**。消费必须走 `consumeCredits()`（数据库 RPC，
 * 原子 + 幂等，见 supabase/migrations/0005_atomic_credit_operations.sql）。
 * `adjustBalance` 只保留给 grant / refund / 管理调整等非消费路径，
 * 以及伪 Prisma 适配器的 `credits.increment` / `credits.decrement` 兼容调用。
 * 这些路径的原子化不在 Phase 3.5 范围内（用户约束 §12）。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type {
  CreditTransactionRow,
  CreditTransactionStatus,
  CreditTransactionType,
} from '@/lib/db/types'

/**
 * Repository 的输入参数统一**镜像数据库列名**（snake_case）。
 *
 * 这是本层唯一的命名规则：Repository 是数据访问的薄封装，
 * 不做 camelCase ↔ snake_case 映射（如需映射，由调用方的 Domain Service 负责）。
 * 规则单一 → 不会出现两种写法混用。
 */
export interface CreateTransactionInput {
  user_id: string
  /** 正数=入账，负数=出账。 */
  amount: number
  type: CreditTransactionType
  status?: CreditTransactionStatus
  description?: string
  balance_before?: number | null
  balance_after?: number | null
  /**
   * 业务引用类型。与 reference_id 一起构成幂等键。
   * 建议取值：ai_generation / order / registration / admin。
   */
  reference_type?: string
  /** 业务引用 id，例如 AI 任务的 taskId、订单号。 */
  reference_id?: string
  /**
   * 请求级幂等键。同一用户 + 同一键只会写入一条流水。
   *
   * 注意：积分**扣减**请用 `consumeCredits()`（走 RPC，原子 + 幂等）。
   * 本函数是给 grant / refund / 管理调整等非消费路径用的，
   * 它只保证「重复插入同键会被拒绝并返回已有记录」，不保证余额变动原子。
   */
  idempotency_key?: string
  order_id?: string
  metadata?: Record<string, unknown>
}

/**
 * 原子扣减积分。
 *
 * 这是**唯一**允许用于消费积分的入口。
 * 内部调用数据库函数 `consume_credits`（见
 * `supabase/migrations/0005_atomic_credit_operations.sql`），
 * 由 Postgres 在一个事务内完成：
 *
 *   幂等检查 → 余额检查 → 原子扣减 → 写流水
 *
 * 为什么不能像以前那样在 TypeScript 里「读 → 判断 → 写」：
 *   余额 100，请求 A 与 B 同时扣 80，两者都会读到 100 并判断「够扣」，
 *   最终余额变成 -60。这个竞态无法在应用层靠加锁解决（多实例部署时锁不共享），
 *   必须由数据库的行级锁保证。
 *
 * ⚠️ 不要用 `adjustBalance` 做消费 —— 它是「读 → 算 → 写」，仍有竞态，
 * 只保留给 grant / refund / 管理调整等**非消费**路径（见用户约束 §12）。
 */
export type ConsumeCreditsStatus =
  | 'ok'
  | 'insufficient'
  | 'duplicate'
  | 'invalid_amount'
  | 'user_not_found'

export interface ConsumeCreditsInput {
  user_id: string
  /** 必须 > 0。传 <= 0 会被数据库拒绝（防止用负数反向加积分）。 */
  amount: number
  /**
   * 请求级幂等键。
   *
   * 同一用户 + 同一键只会成功扣减一次：重试 / 前端重复提交 / 网络重放
   * 都会命中 'duplicate' 而不是重复扣费。
   * 不传则不启用幂等（每次调用都是一次新的扣减）。
   */
  idempotency_key?: string
  /** 流水类型，默认 'consume'。 */
  type?: string
  description?: string
  /** 业务溯源：引用类型，例如 ai_generation / order。 */
  reference_type?: string
  /** 业务溯源：引用 id，例如 AI 任务的 taskId、订单号。 */
  reference_id?: string
  metadata?: Record<string, unknown>
}

export interface ConsumeCreditsResult {
  status: ConsumeCreditsStatus
  /** 操作后的余额。失败时返回当前余额（未变化）。 */
  balance: number
  /** 成功或幂等命中时的流水 id。 */
  transactionId: string | null
  /** 是否为幂等命中（本次没有实际扣减）。 */
  idempotent: boolean
}

export async function consumeCredits(
  input: ConsumeCreditsInput
): Promise<ConsumeCreditsResult> {
  const { data, error } = await getDb().rpc('consume_credits', {
    p_user_id: input.user_id,
    p_amount: input.amount,
    p_idempotency_key: input.idempotency_key ?? null,
    p_type: input.type ?? 'consume',
    p_description: input.description ?? null,
    p_reference_type: input.reference_type ?? null,
    p_reference_id: input.reference_id ?? null,
    p_metadata: input.metadata ?? null,
  })

  if (error) {
    throw new Error(`credit.consumeCredits failed: ${error.message}`)
  }

  // RETURNS TABLE 在 PostgREST 下返回数组；兼容单对象的情况
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        status: ConsumeCreditsStatus
        balance: number | null
        transaction_id: string | null
        idempotent: boolean | null
      }
    | null
    | undefined

  if (!row) {
    throw new Error('credit.consumeCredits returned no row')
  }

  return {
    status: row.status,
    balance: row.balance ?? 0,
    transactionId: row.transaction_id ?? null,
    idempotent: row.idempotent ?? false,
  }
}

/**
 * 原子发放积分。
 *
 * 与 `consumeCredits` 对称：走数据库函数 `grant_credits`
 * （见 `supabase/migrations/0006_billing_closed_loop.sql`），
 * 在一条 SQL 事务内完成「幂等检查 + 加余额 + 写流水」。
 *
 * 幂等键由调用方按**订单维度**构造，例如 `credit_grant:<order_id>`。
 * 同一订单重复调用只会发一次积分 —— 这正是「Webhook 重复发送不会重复发积分」的保证。
 *
 * 注意与 `adjustBalance` 的区别：
 *   · `grantCredits` 原子 + 幂等，**用于订单交付**
 *   · `adjustBalance` 非原子，仅用于无订单场景的零星调整
 */
export type GrantCreditsStatus = 'ok' | 'duplicate' | 'invalid_amount' | 'user_not_found'

export interface GrantCreditsInput {
  user_id: string
  /** 必须 > 0。 */
  amount: number
  /**
   * 幂等键。**订单交付场景必须传**，建议格式 `credit_grant:<order_id>`。
   * 不传则不启用幂等（每次调用都会真实发放）。
   */
  idempotency_key?: string
  /** 流水类型，默认 'purchase'。 */
  type?: string
  description?: string
  reference_type?: string
  reference_id?: string
  /** 关联订单，用于对账与退款追溯。 */
  order_id?: string
  metadata?: Record<string, unknown>
}

export interface GrantCreditsResult {
  status: GrantCreditsStatus
  /** 操作后的余额。 */
  balance: number
  /** 成功或幂等命中时的流水 id。 */
  transactionId: string | null
  /** 是否为幂等命中（本次没有实际发放）。 */
  idempotent: boolean
}

export async function grantCredits(
  input: GrantCreditsInput
): Promise<GrantCreditsResult> {
  const { data, error } = await getDb().rpc('grant_credits', {
    p_user_id: input.user_id,
    p_amount: input.amount,
    p_idempotency_key: input.idempotency_key ?? null,
    p_type: input.type ?? 'purchase',
    p_description: input.description ?? null,
    p_reference_type: input.reference_type ?? null,
    p_reference_id: input.reference_id ?? null,
    p_order_id: input.order_id ?? null,
    p_metadata: input.metadata ?? null,
  })

  if (error) {
    throw new Error(`credit.grantCredits failed: ${error.message}`)
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        status: GrantCreditsStatus
        balance: number | null
        transaction_id: string | null
        idempotent: boolean | null
      }
    | null
    | undefined

  if (!row) {
    throw new Error('credit.grantCredits returned no row')
  }

  return {
    status: row.status,
    balance: row.balance ?? 0,
    transactionId: row.transaction_id ?? null,
    idempotent: row.idempotent ?? false,
  }
}

/**
 * 读当前余额。 */
export async function getBalance(userId: string): Promise<number> {
  const { data, error } = await getDb()
    .from(TABLES.users)
    .select('credits')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(`credit.getBalance failed: ${error.message}`)
  }

  return (data as { credits: number | null } | null)?.credits ?? 0
}

/**
 * 调整余额并返回变动前后的值。
 *
 * 余额下限为 0（与旧实现的 `Math.max(0, ...)` 行为保持一致）。
 */
export async function adjustBalance(
  userId: string,
  delta: number
): Promise<{ before: number; after: number }> {
  const before = await getBalance(userId)
  const after = Math.max(0, before + delta)

  const { error } = await getDb()
    .from(TABLES.users)
    .update({ credits: after })
    .eq('id', userId)

  if (error) {
    throw new Error(`credit.adjustBalance failed: ${error.message}`)
  }

  return { before, after }
}

/**
 * 创建一条积分流水。
 *
 * 幂等：如果 `(user_id, reference_type, reference_id, type)` 已存在，
 * 直接返回已存在的那条，而不是抛错。这样「请求重试 / webhook 重放 /
 * 前端重复提交」都不会产生重复流水。
 *
 * 幂等依赖 `uniq_credit_transactions_reference` 部分唯一索引
 * （见 supabase/migrations/0001_credit_model.sql）。
 */
export async function createTransaction(
  input: CreateTransactionInput
): Promise<CreditTransactionRow> {
  const payload: Record<string, unknown> = {
    user_id: input.user_id,
    amount: input.amount,
    type: input.type,
    status: input.status ?? 'COMPLETED',
  }

  // 只写入真正传了的字段
  for (const key of [
    'description',
    'balance_before',
    'balance_after',
    'reference_type',
    'reference_id',
    'idempotency_key',
    'order_id',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) {
      payload[key] = input[key]
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.creditTransactions)
    .insert(payload)
    .select()
    .single()

  if (error) {
    // 23505 = unique_violation → 幂等命中，返回已有记录
    if (error.code === '23505') {
      const existing = input.idempotency_key
        ? await findByIdempotencyKey(input.user_id, input.idempotency_key)
        : input.reference_type && input.reference_id
          ? await findByReference(
              input.user_id,
              input.reference_type,
              input.reference_id,
              input.type
            )
          : null

      if (existing) {
        return existing
      }
    }

    throw new Error(`credit.createTransaction failed: ${error.message}`)
  }

  return data as CreditTransactionRow
}

/** 按请求级幂等键查流水。 */
export async function findByIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<CreditTransactionRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.creditTransactions)
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`credit.findByIdempotencyKey failed: ${error.message}`)
  }

  return (data as CreditTransactionRow | null) ?? null
}

/** 按业务引用查流水（幂等查询）。 */
export async function findByReference(
  userId: string,
  referenceType: string,
  referenceId: string,
  type?: CreditTransactionType
): Promise<CreditTransactionRow | null> {
  let query = getDb()
    .from(TABLES.creditTransactions)
    .select('*')
    .eq('user_id', userId)
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)

  if (type) {
    query = query.eq('type', type)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    throw new Error(`credit.findByReference failed: ${error.message}`)
  }

  return (data as CreditTransactionRow | null) ?? null
}

/** 列出某个用户的流水（按时间倒序）。 */
export async function listTransactions(
  userId: string,
  limit = 10
): Promise<CreditTransactionRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.creditTransactions)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(`credit.listTransactions failed: ${error.message}`)
  }

  return (data as CreditTransactionRow[] | null) ?? []
}

/**
 * 分页列出流水（Admin 查询用）。
 *
 * 始终按 `created_at DESC` 排序。
 */
export async function listAll(options: {
  limit?: number
  offset?: number
  userId?: string
  /** 只取这些用户的流水（`user_id IN (...)`）。空数组返回空结果。 */
  userIds?: string[]
  type?: CreditTransactionType
} = {}): Promise<CreditTransactionRow[]> {
  if (options.userIds && options.userIds.length === 0) {
    return []
  }

  let query = getDb()
    .from(TABLES.creditTransactions)
    .select('*')
    .order('created_at', { ascending: false })

  if (options.userId) query = query.eq('user_id', options.userId)
  if (options.userIds?.length) query = query.in('user_id', options.userIds)
  if (options.type) query = query.eq('type', options.type)

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`credit.listAll failed: ${error.message}`)
  }

  return (data as CreditTransactionRow[] | null) ?? []
}

/** 统计符合条件的流水数（Admin 查询用）。 */
export async function countTransactions(options: {
  userId?: string
  userIds?: string[]
  type?: CreditTransactionType
} = {}): Promise<number> {
  if (options.userIds && options.userIds.length === 0) {
    return 0
  }

  let query = getDb()
    .from(TABLES.creditTransactions)
    .select('*', { count: 'exact', head: true })

  if (options.userId) query = query.eq('user_id', options.userId)
  if (options.userIds?.length) query = query.in('user_id', options.userIds)
  if (options.type) query = query.eq('type', options.type)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`credit.countTransactions failed: ${error.message}`)
  }

  return total ?? 0
}

/** 列出某笔订单关联的流水。 */
export async function listByOrderId(
  orderId: string
): Promise<CreditTransactionRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.creditTransactions)
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`credit.listByOrderId failed: ${error.message}`)
  }

  return (data as CreditTransactionRow[] | null) ?? []
}
