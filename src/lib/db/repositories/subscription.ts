/**
 * Subscription Repository
 *
 * 只做 `subscriptions` 表的数据操作。**不负责**：
 *   · 订阅续费 / 到期计算 / 升降级 proration（属于后续阶段）
 *   · 调用任何支付渠道 SDK
 *
 * 背景：审计发现 `subscriptions` 表虽然存在，但代码侧完全走伪 Prisma 的 mock
 * （`create()` 返回 `Math.random()` 生成的假 id，写不进库）。
 * 本 Repository 提供真实持久化能力，替换掉那些 mock。
 * 表结构本身的通用化见 supabase/migrations/0003_subscriptions.sql。
 *
 * 命名规则：输入参数镜像数据库列名（snake_case），见 credit.ts 的说明。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type {
  BillingCycle,
  SubscriptionRow,
  SubscriptionStatus,
} from '@/lib/db/types'

export interface CreateSubscriptionInput {
  user_id: string
  plan_id: string
  payment_provider: string
  current_period_start: string
  current_period_end: string
  status?: SubscriptionStatus
  billing_cycle?: BillingCycle
  provider_subscription_id?: string | null
  provider_refs?: Record<string, unknown> | null
}

export interface UpdateSubscriptionInput {
  plan_id?: string
  status?: SubscriptionStatus
  billing_cycle?: BillingCycle
  current_period_start?: string
  current_period_end?: string
  provider_subscription_id?: string | null
  provider_refs?: Record<string, unknown> | null
}

/** 查用户当前生效的订阅。 */
export async function findActiveByUser(
  userId: string
): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`subscription.findActiveByUser failed: ${error.message}`)
  }

  return (data as SubscriptionRow | null) ?? null
}

/** 按 id 查订阅。 */
export async function findById(id: string): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`subscription.findById failed: ${error.message}`)
  }

  return (data as SubscriptionRow | null) ?? null
}

/** 按支付渠道订阅 id 查订阅。 */
export async function findByProviderSubscription(
  providerSubscriptionId: string
): Promise<SubscriptionRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .select('*')
    .eq('provider_subscription_id', providerSubscriptionId)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(
      `subscription.findByProviderSubscription failed: ${error.message}`
    )
  }

  return (data as SubscriptionRow | null) ?? null
}

/** 创建订阅。 */
export async function create(
  input: CreateSubscriptionInput
): Promise<SubscriptionRow> {
  const payload: Record<string, unknown> = {
    user_id: input.user_id,
    plan_id: input.plan_id,
    payment_provider: input.payment_provider,
    current_period_start: input.current_period_start,
    current_period_end: input.current_period_end,
    status: input.status ?? 'active',
    billing_cycle: input.billing_cycle ?? 'monthly',
  }

  for (const key of ['provider_subscription_id', 'provider_refs'] as const) {
    if (input[key] !== undefined) {
      payload[key] = input[key]
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`subscription.create failed: ${error.message}`)
  }

  return data as SubscriptionRow
}

/** 更新订阅。 */
export async function update(
  id: string,
  patch: UpdateSubscriptionInput
): Promise<SubscriptionRow> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  )

  if (Object.keys(payload).length === 0) {
    const existing = await findById(id)

    if (!existing) {
      throw new Error(`subscription.update: subscription ${id} not found`)
    }

    return existing
  }

  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`subscription.update failed: ${error.message}`)
  }

  return data as SubscriptionRow
}

/**
 * 分页列出订阅（Admin 查询用）。
 *
 * 始终按 `created_at DESC` 排序。
 */
export async function listAll(options: {
  limit?: number
  offset?: number
  status?: SubscriptionStatus
  provider?: string
  /**
   * 只取这些用户的订阅（等价于 SQL 的 `user_id IN (...)`）。
   *
   * 用于「按 email 搜索订阅」：订阅表本身没有 email 列，
   * 调用方先按 email 查出 user id 列表，再传进来。
   * 传空数组表示「无匹配用户」，应返回空结果。
   */
  userIds?: string[]
} = {}): Promise<SubscriptionRow[]> {
  // 显式传了空数组 = 没有匹配用户 → 直接短路，避免退化成「查全部」
  if (options.userIds && options.userIds.length === 0) {
    return []
  }

  let query = getDb()
    .from(TABLES.subscriptions)
    .select('*')
    .order('created_at', { ascending: false })

  if (options.status) query = query.eq('status', options.status)
  if (options.provider) query = query.eq('payment_provider', options.provider)
  if (options.userIds?.length) query = query.in('user_id', options.userIds)

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`subscription.listAll failed: ${error.message}`)
  }

  return (data as SubscriptionRow[] | null) ?? []
}

/** 统计符合条件的订阅数（Admin 查询用）。 */
export async function count(options: {
  status?: SubscriptionStatus
  provider?: string
  userIds?: string[]
} = {}): Promise<number> {
  if (options.userIds && options.userIds.length === 0) {
    return 0
  }

  let query = getDb()
    .from(TABLES.subscriptions)
    .select('*', { count: 'exact', head: true })

  if (options.status) query = query.eq('status', options.status)
  if (options.provider) query = query.eq('payment_provider', options.provider)
  if (options.userIds?.length) query = query.in('user_id', options.userIds)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`subscription.count failed: ${error.message}`)
  }

  return total ?? 0
}

/** 列出用户的全部订阅。 */
export async function listByUser(userId: string): Promise<SubscriptionRow[]> {
  const { data, error } = await getDb()
    .from(TABLES.subscriptions)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`subscription.listByUser failed: ${error.message}`)
  }

  return (data as SubscriptionRow[] | null) ?? []
}
