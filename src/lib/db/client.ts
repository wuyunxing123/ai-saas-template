/**
 * Database Client — 数据访问层的唯一入口
 *
 * 这一层只做一件事：**提供 Supabase 客户端**。
 * 所有 Repository 都从这里拿客户端，业务代码不直接创建客户端。
 *
 * 为什么需要它：
 *   审计发现项目里有 3 套客户端创建方式（ssr server / ssr browser / 直接 new supabase-js）。
 *   这里收敛服务端数据访问用的那一套，浏览器端与 Auth 专用的客户端保持原样不动
 *   （属于后续阶段的范围）。
 */

import { createAdminClient } from '@/lib/supabase/server'

/** 配置错误。消息里带具体原因，避免出现难以排查的 "TypeError: fetch failed"。 */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseConfigError'
  }
}

const PLACEHOLDER_PATTERNS = [
  /your-project-id/i,
  /your_supabase/i,
  /your-domain/i,
  /example\.com/i,
]

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * 检查数据库配置是否可用。
 * 返回 `null` 表示可用；否则返回人类可读的原因。
 */
export function getDatabaseConfigIssue(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()

  if (!url) {
    return 'NEXT_PUBLIC_SUPABASE_URL is not set'
  }

  if (looksLikePlaceholder(url)) {
    return `NEXT_PUBLIC_SUPABASE_URL looks like a placeholder (${url})`
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!serviceKey) {
    return 'SUPABASE_SERVICE_ROLE_KEY is not set'
  }

  if (looksLikePlaceholder(serviceKey)) {
    return 'SUPABASE_SERVICE_ROLE_KEY looks like a placeholder'
  }

  return null
}

/** 数据库是否已正确配置。 */
export function isDatabaseConfigured(): boolean {
  return getDatabaseConfigIssue() === null
}

/**
 * 取服务端数据库客户端（service_role，绕过 RLS）。
 *
 * 所有 Repository 的唯一客户端来源。
 * 配置缺失时抛出带原因的错误，而不是让底层 fetch 抛一个没有上下文的失败。
 */
export function getDb() {
  const issue = getDatabaseConfigIssue()

  if (issue) {
    throw new DatabaseConfigError(
      `Database is not configured: ${issue}. ` +
        'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.'
    )
  }

  return createAdminClient()
}

/** 表名常量：集中定义，避免各处硬编码字符串拼错。 */
export const TABLES = {
  users: 'users',
  creditTransactions: 'credit_transactions',
  orders: 'orders',
  subscriptions: 'subscriptions',
  aiTasks: 'ai_tasks',
  webhookEvents: 'webhook_events',
  adminAuditLogs: 'admin_audit_logs',
  // 已废弃，仅保留用于兼容读取
  legacyPaymentOrders: 'payment_orders',
  legacyGenerations: 'generations',
} as const
