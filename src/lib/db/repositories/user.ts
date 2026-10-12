/**
 * User Repository
 *
 * 只做 `users` 表的数据操作。
 * 不负责：鉴权、送积分规则、用户分层、权限判断。
 *
 * 注意：积分余额的读写不在这里，在 `credit.ts`
 * （余额存在 `users.credits` 列上，但语义属于 Credit 领域，集中在一处更不容易出错）。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type { UserRow } from '@/lib/db/types'

export interface CreateUserInput {
  id?: string
  email: string
  name?: string | null
  image?: string | null
  credits?: number
  location?: string | null
  signin_type?: string | null
  signin_provider?: string | null
  signin_openid?: string | null
  signin_ip?: string | null
  last_signin_at?: string | null
  signin_count?: number
  preferred_currency?: string | null
  preferred_payment_provider?: string | null
}

export interface UpdateUserInput {
  name?: string | null
  image?: string | null
  location?: string | null
  signin_type?: string | null
  signin_provider?: string | null
  signin_openid?: string | null
  signin_ip?: string | null
  last_signin_at?: string | null
  signin_count?: number
  preferred_currency?: string | null
  preferred_payment_provider?: string | null
  /** 用户角色：user / admin。仅 Admin bootstrap 与授权流程可写。 */
  role?: string | null
}

/** 按 id 查用户。 */
export async function findById(id: string): Promise<UserRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.users)
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`user.findById failed: ${error.message}`)
  }

  return (data as UserRow | null) ?? null
}

/** 按 email 查用户。 */
export async function findByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await getDb()
    .from(TABLES.users)
    .select('*')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw new Error(`user.findByEmail failed: ${error.message}`)
  }

  return (data as UserRow | null) ?? null
}

/** 创建用户。 */
export async function create(input: CreateUserInput): Promise<UserRow> {
  const payload: Record<string, unknown> = {
    email: input.email,
    credits: input.credits ?? 0,
  }

  // 只写入真正传了的字段，避免把 undefined 覆盖成 null
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && key !== 'email' && key !== 'credits') {
      payload[key] = value
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.users)
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`user.create failed: ${error.message}`)
  }

  return data as UserRow
}

/** 更新用户资料字段（不含 credits）。 */
export async function update(
  id: string,
  patch: UpdateUserInput
): Promise<UserRow> {
  const payload = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  )

  if (Object.keys(payload).length === 0) {
    const existing = await findById(id)

    if (!existing) {
      throw new Error(`user.update: user ${id} not found`)
    }

    return existing
  }

  const { data, error } = await getDb()
    .from(TABLES.users)
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    throw new Error(`user.update failed: ${error.message}`)
  }

  return data as UserRow
}

/** 记录一次登录：更新最后登录时间并把登录次数 +1。 */
export async function touchSignin(id: string): Promise<void> {
  const { data, error } = await getDb()
    .from(TABLES.users)
    .select('signin_count')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(`user.touchSignin failed: ${error.message}`)
  }

  const nextCount = ((data as { signin_count: number | null } | null)?.signin_count ?? 0) + 1

  const { error: updateError } = await getDb()
    .from(TABLES.users)
    .update({ last_signin_at: new Date().toISOString(), signin_count: nextCount })
    .eq('id', id)

  if (updateError) {
    throw new Error(`user.touchSignin failed: ${updateError.message}`)
  }
}

/**
 * 分页列出用户（Admin 查询用）。
 *
 * `search` 匹配 email 或 name（大小写不敏感的包含匹配）。
 * 始终按 `created_at DESC` 排序。
 */
export async function listAll(options: {
  limit?: number
  offset?: number
  search?: string
  role?: string
} = {}): Promise<UserRow[]> {
  let query = getDb()
    .from(TABLES.users)
    .select('*')
    .order('created_at', { ascending: false })

  if (options.role) {
    query = query.eq('role', options.role)
  }

  if (options.search) {
    const term = options.search.trim()
    if (term) {
      // Supabase 的 or() 支持 ilike 组合匹配
      query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`)
    }
  }

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`user.listAll failed: ${error.message}`)
  }

  return (data as UserRow[] | null) ?? []
}

/** 统计符合条件的用户数（Admin 查询用）。 */
export async function count(options: {
  search?: string
  role?: string
} = {}): Promise<number> {
  let query = getDb()
    .from(TABLES.users)
    .select('*', { count: 'exact', head: true })

  if (options.role) {
    query = query.eq('role', options.role)
  }

  if (options.search) {
    const term = options.search.trim()
    if (term) {
      query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`)
    }
  }

  const { count: total, error } = await query

  if (error) {
    throw new Error(`user.count failed: ${error.message}`)
  }

  return total ?? 0
}

/** 删除用户。 */
export async function remove(id: string): Promise<void> {
  const { error } = await getDb().from(TABLES.users).delete().eq('id', id)

  if (error) {
    throw new Error(`user.remove failed: ${error.message}`)
  }
}
