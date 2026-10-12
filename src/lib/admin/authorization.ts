/**
 * Admin Authorization — 唯一的 Admin 权限边界
 *
 * 规则：
 *   未登录           → 401
 *   已登录但非 admin → 403
 *   已登录且 admin   → 放行
 *
 * 权限唯一依据：`users.role === 'admin'`（server-side 查询）。
 * 绝不使用 request.body.role / request.body.userId / 客户端传入的 isAdmin。
 *
 * ADMIN_EMAILS 仅作为 **bootstrap 白名单**：
 *   命中白名单的用户首次访问 Admin 时，自动把 users.role 提升为 'admin'。
 *   之后所有权限判断只看 role。
 */

import { getCurrentUser, getSessionIdentity } from '@/lib/auth-session'
import * as userRepo from '@/lib/db/repositories/user'
import type { UserRow } from '@/lib/db/types'

export type AdminAuthFailure = {
  ok: false
  status: 401 | 403
  error: string
}

export type AdminAuthSuccess = {
  ok: true
  user: UserRow
}

export type AdminAuthResult = AdminAuthSuccess | AdminAuthFailure

/** 环境变量白名单（bootstrap 用）。 */
function getBootstrapEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * 解析当前请求的 Admin 身份。
 *
 * 返回 `{ ok: false, status }` 而不是抛异常，方便 API 路由区分 401 / 403。
 *
 * 身份来源：`session.user.id` 优先（F-1），email 仅作老 session 兜底。
 */
export async function getAdminContext(): Promise<AdminAuthResult> {
  const identity = await getSessionIdentity()

  if (!identity) {
    return { ok: false, status: 401, error: 'Authentication required' }
  }

  let user: UserRow | null = null

  try {
    user = await getCurrentUser()
  } catch (error) {
    console.error('[admin] failed to load user:', error)
    return { ok: false, status: 403, error: 'Unable to verify admin identity' }
  }

  if (!user) {
    return { ok: false, status: 403, error: 'Admin access required' }
  }

  // ── bootstrap：白名单用户自动提升为 admin ────────────────────────
  if (user.role !== 'admin' && getBootstrapEmails().includes(identity.email.toLowerCase())) {
    try {
      user = await userRepo.update(user.id, { role: 'admin' })
      console.log(`[admin] bootstrapped admin role for ${identity.email}`)
    } catch (error) {
      console.error('[admin] failed to bootstrap admin role:', error)
    }
  }

  if (user.role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin access required' }
  }

  return { ok: true, user }
}

/**
 * 断言当前请求是 Admin。失败时抛 `AdminAuthError`。
 *
 * 适用于 Server Component / Server Action（无法直接返回 Response 的场景）。
 */
export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403
  ) {
    super(message)
    this.name = 'AdminAuthError'
  }
}

export async function requireAdmin(): Promise<UserRow> {
  const result = await getAdminContext()

  if (!result.ok) {
    throw new AdminAuthError(result.error, result.status)
  }

  return result.user
}

/** 当前用户是否为 Admin（不抛异常，用于条件渲染）。 */
export async function isAdmin(): Promise<boolean> {
  const result = await getAdminContext()
  return result.ok
}
