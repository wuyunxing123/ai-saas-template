/**
 * 当前登录用户解析 —— 所有「从 session 取用户」的统一入口。
 *
 * 为什么需要它（F-1）
 * ------------------
 * Phase 6 之前，session 里没有 `user.id`（缺陷 B-13），所以全项目有 10+ 处
 * 各自写「取 session → 按 email 查用户」。Phase 6 把 `user.id` 注入 session 后，
 * 这些地方应该改用**主键**查询：
 *
 *   · `id` 是稳定主键；`email` 只是用户属性（理论上可变更）
 *   · 权限判断（Admin）、积分归属、订单归属都应以 id 为准
 *
 * 为什么不直接删掉 email 分支
 * ---------------------------
 * Phase 6 之前签发的 JWT 里没有 `user.id`，`session.user.id` 会是空字符串。
 * 若只认 id，这些用户会突然 404。因此保留 **email 兜底**：
 * 老 session 仍能工作，新 session 一律走 id。等所有老 session 自然过期后，
 * 可以删掉兜底分支（见 docs/PHASE_6_FOLLOWUPS.md F-1）。
 *
 * 边界：本文件**不**做认证判断（那是 `getAdminContext()` 的职责），
 * 只回答「当前 session 对应哪个业务用户」。
 */

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import * as userRepo from '@/lib/db/repositories/user'
import type { UserRow } from '@/lib/db/types'

export interface SessionIdentity {
  /** 来自 session 的用户 id（Phase 6 起可用）。老 session 为空字符串。 */
  id: string
  email: string
  name?: string | null
  image?: string | null
}

/** 取原始 session 身份信息（不查库）。未登录返回 null。 */
export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  if (!email) {
    return null
  }

  return {
    id: session.user.id ?? '',
    email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  }
}

/**
 * 取当前登录用户的完整业务记录。
 *
 * 优先用 `session.user.id`（主键）；缺失时退回 email（兼容 Phase 6 前的 session）。
 * 未登录或用户不存在时返回 null，由调用方决定返回 401 还是 404。
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const identity = await getSessionIdentity()

  if (!identity) {
    return null
  }

  if (identity.id) {
    const byId = await userRepo.findById(identity.id)
    if (byId) {
      return byId
    }
    // id 存在但查不到 —— 可能用户已被删除；再给 email 一次机会
  }

  return userRepo.findByEmail(identity.email)
}

/** 当前用户 id（便捷方法）。未登录或用户不存在时返回 null。 */
export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser()
  return user?.id ?? null
}
