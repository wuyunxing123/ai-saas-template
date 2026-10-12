/**
 * Billing 路由的当前用户解析
 *
 * ⚠️ 这**不是**对 Auth 的重构（用户约束 §26 禁止重构 Auth）。
 * 只是把「取 session → 查用户」收敛一处，避免三个 Billing 路由各写一遍。
 * 它不改变任何认证行为。
 *
 * F-1：身份来源已从 email 改为**优先 session.user.id**，
 * 统一委托给 `src/lib/auth-session.ts`（email 仅作老 session 兜底）。
 */

import { getCurrentUser } from '@/lib/auth-session'

export interface BillingUser {
  id: string
  email: string
  name: string | null
}

/**
 * 取当前登录用户。未登录或用户不存在时返回 null，
 * 由调用方决定返回 401 还是 404。
 */
export async function getBillingUser(): Promise<BillingUser | null> {
  const user = await getCurrentUser()

  if (!user) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  }
}
