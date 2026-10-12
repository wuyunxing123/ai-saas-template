/**
 * Admin Audit Log Repository
 *
 * 只做 `admin_audit_logs` 表的数据操作。
 * 不负责：谁有权限、写什么内容。
 *
 * 安全：不要往 metadata 里放 password / token / secret / 完整 request body。
 */

import { TABLES, getDb } from '@/lib/db/client'
import type { AdminAuditLogRow } from '@/lib/db/types'

export interface CreateAuditLogInput {
  admin_user_id: string
  action: string
  target_user_id?: string | null
  target_type?: string | null
  target_id?: string | null
  amount?: number | null
  reason?: string | null
  metadata?: Record<string, unknown> | null
}

export async function create(
  input: CreateAuditLogInput
): Promise<AdminAuditLogRow> {
  const payload: Record<string, unknown> = {
    admin_user_id: input.admin_user_id,
    action: input.action,
  }

  for (const key of [
    'target_user_id',
    'target_type',
    'target_id',
    'amount',
    'reason',
    'metadata',
  ] as const) {
    if (input[key] !== undefined) {
      payload[key] = input[key]
    }
  }

  const { data, error } = await getDb()
    .from(TABLES.adminAuditLogs)
    .insert(payload)
    .select()
    .single()

  if (error) {
    throw new Error(`adminAuditLog.create failed: ${error.message}`)
  }

  return data as AdminAuditLogRow
}

export async function list(options: {
  limit?: number
  offset?: number
  adminUserId?: string
  targetUserId?: string
} = {}): Promise<AdminAuditLogRow[]> {
  let query = getDb()
    .from(TABLES.adminAuditLogs)
    .select('*')
    .order('created_at', { ascending: false })

  if (options.adminUserId) query = query.eq('admin_user_id', options.adminUserId)
  if (options.targetUserId) query = query.eq('target_user_id', options.targetUserId)

  const limit = options.limit ?? 20

  if (options.offset) {
    query = query.range(options.offset, options.offset + limit - 1)
  } else {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`adminAuditLog.list failed: ${error.message}`)
  }

  return (data as AdminAuditLogRow[] | null) ?? []
}

export async function count(options: {
  adminUserId?: string
  targetUserId?: string
} = {}): Promise<number> {
  let query = getDb()
    .from(TABLES.adminAuditLogs)
    .select('*', { count: 'exact', head: true })

  if (options.adminUserId) query = query.eq('admin_user_id', options.adminUserId)
  if (options.targetUserId) query = query.eq('target_user_id', options.targetUserId)

  const { count: total, error } = await query

  if (error) {
    throw new Error(`adminAuditLog.count failed: ${error.message}`)
  }

  return total ?? 0
}
