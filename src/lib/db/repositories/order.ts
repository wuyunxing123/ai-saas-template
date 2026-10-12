/**
 * Order Repository
 *
 * 只做 `orders` 表的数据操作。**不负责**支付业务规则：
 *   · 不校验价格（那是 Billing 层的职责）
 *   · 不调用支付渠道 SDK
 *   · 不决定订单状态该怎么流转
 *
 * 表统一说明
 * ----------
 * 审计发现 `orders`（代码用）与 `payment_orders`（SQL 有）是同一业务概念的两个名字，
 * 且 webhook 链读的是不存在的 `orders` → 支付成功后找不到订单。
 * 本阶段统一为 `orders`（迁移见 supabase/migrations/0002_orders.sql），
 * `payment_orders` 标记废弃。
 *
 * provider 引用列
 * ---------------
 * 原 `stripe_session_id` / `creem_checkout_id` 已通用化为 `provider_session_id`，
 * 原 `stripe_payment_intent_id` / `creem_payment_id` → `provider_payment_id`，
 * 渠道专属字段进 `provider_refs`。这样接入第三家支付时不需要改表结构。
 *
 * 命名规则：输入参数镜像数据库列名（snake_case），见 credit.ts 的说明。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type { OrderRow, OrderStatus } from '@/lib/db/types'

export interface CreateOrderInput {
  user_id: string
  order_number: string
  amount: number
  payment_provider: string
  product_type: string
  product_id?: string
  product_name?: string
  customer_email?: string
  currency?: string
  status?: OrderStatus
  /** 精确金额（整数最小单位）。新代码应传它，`amount` 会由它派生。 */
  amount_minor?: number | null
  provider_session_id?: string | null
  provider_payment_id?: string | null
  provider_refs?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  /** 订单失效时间（ISO 字符串）。 */
  expired_at?: string | null
  /** 交付完成时间（ISO 字符串）。 */
  fulfilled_at?: string | null
  /** 下单使用的 billing package id。 */
  package_id?: string | null
  /** checkout 幂等键。 */
  idempotency_key?: string | null
}

export interface UpdateOrderInput {
  status?: OrderStatus
  provider_session_id?: string | null
  provider_payment_id?: string | null
  provider_refs?: Record<string, unknown> | null
  paid_at?: string | null
  expired_at?: string | null
  fulfilled_at?: string | null
  package_id?: string | null
  metadata?: Record<string, unknown> | null
}

/** 创建订单。 */
export async function create(input: CreateOrderInput): Promise<OrderRow> {
  const payload: Record<string, unknown> = {
    user_id: input.user_id,
    order_number: input.order_number,
    amount: input.amount,
    payment_provider: input.payment_provider,
    product_type: input.product_type,
    // 这三列在数据库里是 NOT NULL，但部分调用方不传，这里给空串兜底
    product_id: input.product_id ?? '',
    product_name: input.product_name ?? '',
    customer_email: input.customer_email ?? '',
    currency: input.currency ?? 'USD',
    status: input.status ?? 'pending',
  }

  for (const key of [
    'provider_session_id',
    'provider_payment_id',
    'provider_refs',
    'metadata',
    'expired_at',
    'fulfilled_at',
    'package_id',
    'idempotency_key',
    'amount_minor',
  ] as const) {
    if (input[key] !== undefined) {
      payload[key] = input[key]
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.orders)
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`order.create failed: ${error.message}`)
  }

  return data as OrderRow
}

/** 按 id 查订单。 */
export async function findById(id: string): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`order.findById failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/** 按订单号查订单。 */
export async function findByOrderNumber(
  orderNumber: string
): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('order_number', orderNumber)
    .maybeSingle()

  if (error) {
    throw new Error(`order.findByOrderNumber failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/** 按 checkout 幂等键查订单（防重复点击 Pay 创建多张订单）。 */
export async function findByIdempotencyKey(
  userId: string,
  idempotencyKey: string
): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`order.findByIdempotencyKey failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/**
 * 把订单标记为已支付 —— **仅当它当前仍是待支付状态**。
 *
 * 这是 Webhook 幂等的第二道防线（第一道是 `webhook_events` 的唯一约束）：
 * 条件写在 WHERE 里，由数据库一次性完成判断与更新。
 * 并发下只有一个请求能把订单从 pending 推到 paid，另一个拿到 0 行 → 跳过交付。
 *
 * 返回 null 表示订单不存在或已经不是待支付状态。
 */
export async function markPaidIfPending(id: string): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['pending', 'created'])
    .select()
    .maybeSingle()

  if (error) {
    throw new Error(`order.markPaidIfPending failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/**
 * 把订单推进到某个**终态** —— 仅当它当前仍是待支付状态。
 *
 * 用于 `failed` / `cancelled` 这类由回调驱动的状态变更。
 * 条件写在 WHERE 里，避免把已经 paid 的订单改回 failed。
 *
 * 返回 null 表示订单不存在或已不在待支付状态。
 */
export async function updateStatusIfPending(
  id: string,
  status: OrderStatus
): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .update({ status })
    .eq('id', id)
    .in('status', ['pending', 'created'])
    .select()
    .maybeSingle()

  if (error) {
    throw new Error(`order.updateStatusIfPending failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/** 标记交付完成。 */
export async function markFulfilled(id: string): Promise<OrderRow> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .update({ fulfilled_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`order.markFulfilled failed: ${error.message}`)
  }

  return data as OrderRow
}

/**
 * 按支付渠道会话 id 查订单（webhook 回调的主要入口）。 */
export async function findByProviderSession(
  sessionId: string
): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('provider_session_id', sessionId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`order.findByProviderSession failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/** 按支付渠道流水 id 查订单。 */
export async function findByProviderPayment(
  paymentId: string
): Promise<OrderRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('provider_payment_id', paymentId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`order.findByProviderPayment failed: ${error.message}`)
  }

  return (data as OrderRow | null) ?? null
}

/** 更新订单。 */
export async function update(
  id: string,
  patch: UpdateOrderInput
): Promise<OrderRow> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  )

  if (Object.keys(payload).length === 0) {
    const existing = await findById(id)

    if (!existing) {
      throw new Error(`order.update: order ${id} not found`)
    }

    return existing
  }

  const { data, error } = await getDb()
    .from(TABLES.orders)
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`order.update failed: ${error.message}`)
  }

  return data as OrderRow
}

/** 列出某个用户的订单。 */
export async function listByUser(
  userId: string,
  options: { limit?: number; statuses?: OrderStatus[]; skip?: number } = {}
): Promise<OrderRow[]> {
  let query = getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (options.statuses?.length) {
    query = query.in('status', options.statuses)
  }

  const limit = options.limit ?? 50

  if (options.skip) {
    query = query.range(options.skip, options.skip + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`order.listByUser failed: ${error.message}`)
  }

  return (data as OrderRow[] | null) ?? []
}

/**
 * 通用订单查询条件。
 *
 * 刻意保持「数据操作」语义（过滤/排序/分页），不包含任何业务判断：
 * 例如「多少分钟内同金额同产品算重复订单」属于 Billing 层的规则，
 * 由调用方决定阈值后传进来。
 */
export interface OrderQuery {
  where?: Partial<
    Pick<
      OrderRow,
      'user_id' | 'status' | 'payment_provider' | 'product_id' | 'order_number'
    >
  >
  /** 状态多选，等价于 SQL 的 IN。 */
  statuses?: OrderStatus[]
  /** 精确匹配金额。 */
  amountEquals?: number
  /** 只取创建时间晚于该时刻的订单（ISO 字符串）。 */
  createdAfter?: string
  /**
   * 模糊搜索：匹配 `customer_email` 或 `order_number`（大小写不敏感）。
   * 供 Admin 订单列表使用。
   */
  search?: string
  limit?: number
  skip?: number
  ascending?: boolean
}

function applyOrderFilters(query: any, options: OrderQuery) {
  for (const [key, value] of Object.entries(options.where ?? {})) {
    if (value !== undefined) {
      query = query.eq(key, value)
    }
  }

  if (options.search?.trim()) {
    const term = options.search.trim()
    query = query.or(`customer_email.ilike.%${term}%,order_number.ilike.%${term}%`)
  }

  if (options.statuses?.length) {
    query = query.in('status', options.statuses)
  }

  if (options.amountEquals !== undefined) {
    query = query.eq('amount', options.amountEquals)
  }

  if (options.createdAfter) {
    query = query.gte('created_at', options.createdAfter)
  }

  return query
}

/**
 * 按条件列出订单。
 *
 * 供 `prisma.paymentOrder.findMany({ where })` 与支付风控查询使用。
 */
export async function listAll(options: OrderQuery = {}): Promise<OrderRow[]> {
  let query = getDb()
    .from(TABLES.orders)
    .select('*')
    .order('created_at', { ascending: options.ascending ?? false })

  query = applyOrderFilters(query, options)

  const limit = options.limit ?? 50

  if (options.skip) {
    query = query.range(options.skip, options.skip + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`order.listAll failed: ${error.message}`)
  }

  return (data as OrderRow[] | null) ?? []
}

/** 统计符合条件的订单数。 */
export async function count(options: OrderQuery = {}): Promise<number> {
  let query = getDb()
    .from(TABLES.orders)
    .select('*', { count: 'exact', head: true })

  query = applyOrderFilters(query, options)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`order.count failed: ${error.message}`)
  }

  return total ?? 0
}

/**
 * 按支付渠道统计订单数。
 *
 * 取代原先伪 Prisma 适配器里返回**伪造数字**的 `groupBy`
 * （旧实现写死 `_count: { id: 120 }`，见 docs/DATABASE_AUDIT.md A-5 相邻项）。
 */
export async function countByProvider(): Promise<Record<string, number>> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('payment_provider')

  if (error) {
    throw new Error(`order.countByProvider failed: ${error.message}`)
  }

  const result: Record<string, number> = {}

  for (const row of (data as { payment_provider: string }[] | null) ?? []) {
    const provider = row.payment_provider
    result[provider] = (result[provider] ?? 0) + 1
  }

  return result
}

/**
 * 汇总订单金额。
 *
 * 取代原先返回**伪造数字**的 `aggregate`（旧实现写死 `_sum: { amount: 15750 }`）。
 */
export async function sumAmount(
  where: Partial<Pick<OrderRow, 'user_id' | 'status'>> = {}
): Promise<number> {
  let query = getDb().from(TABLES.orders).select('amount')

  for (const [key, value] of Object.entries(where)) {
    if (value !== undefined) {
      query = query.eq(key, value)
    }
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`order.sumAmount failed: ${error.message}`)
  }

  return ((data as { amount: number | string }[] | null) ?? []).reduce(
    (total, row) => total + Number(row.amount),
    0
  )
}

/** 批量更新订单状态。 */
export async function updateManyStatus(
  ids: string[],
  status: OrderStatus
): Promise<number> {
  if (ids.length === 0) {
    return 0
  }

  const { data, error } = await getDb()
    .from(TABLES.orders)
    .update({ status })
    .in('id', ids)
    .select('id')

  if (error) {
    throw new Error(`order.updateManyStatus failed: ${error.message}`)
  }

  return ((data as { id: string }[] | null) ?? []).length
}

/**
 * 列出已过期待支付订单。
 *
 * 供订单清理任务使用（原实现依赖 `expiredAt` 条件，但该列此前并不存在于 schema 中，
 * 条件被静默忽略 → 会把所有 pending 订单都当成过期。补上列后这里才是真正的过滤）。
 */
export async function listExpiredPending(
  now: Date = new Date()
): Promise<OrderRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.orders)
    .select('*')
    .eq('status', 'pending')
    .lt('expired_at', now.toISOString())
    .order('expired_at', { ascending: true })

  if (error) {
    throw new Error(`order.listExpiredPending failed: ${error.message}`)
  }

  return (data as OrderRow[] | null) ?? []
}

/**
 * 按支付渠道聚合统计（笔数 + 最近一次时间）。
 *
 * 取代原先伪 Prisma 适配器里返回**伪造数字**的 `groupBy`。
 */
export async function providerStats(
  since: string,
  statuses: OrderStatus[]
): Promise<Array<{ provider: string; count: number; lastUsed: string | null }>> {
  let query = getDb()
    .from(TABLES.orders)
    .select('payment_provider, created_at')
    .gte('created_at', since)

  if (statuses.length) {
    query = query.in('status', statuses)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`order.providerStats failed: ${error.message}`)
  }

  const grouped = new Map<string, { count: number; lastUsed: string | null }>()

  for (const row of (data as { payment_provider: string; created_at: string }[] | null) ??
    []) {
    const current = grouped.get(row.payment_provider) ?? {
      count: 0,
      lastUsed: null,
    }

    current.count += 1

    if (!current.lastUsed || row.created_at > current.lastUsed) {
      current.lastUsed = row.created_at
    }

    grouped.set(row.payment_provider, current)
  }

  return [...grouped.entries()].map(([provider, value]) => ({
    provider,
    count: value.count,
    lastUsed: value.lastUsed,
  }))
}

/** 删除订单。 */
export async function remove(id: string): Promise<void> {
  const { error } = await getDb().from(TABLES.orders).delete().eq('id', id)

  if (error) {
    throw new Error(`order.remove failed: ${error.message}`)
  }
}
