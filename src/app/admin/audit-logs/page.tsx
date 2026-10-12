import Link from 'next/link'

import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listAuditLogs } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Admin 操作审计日志。
 *
 * 只读。记录「谁 / 对谁 / 做了什么 / 为什么 / 什么时候」，
 * **不含** password / token / secret / 完整 request body。
 */
export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams

  const raw = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const v = first(value)
    if (v) raw.set(key, v)
  }

  const pagination = parsePagination(raw)

  const result = await listAuditLogs({ ...pagination })

  return (
    <div>
      <AdminPageHeader
        title="Audit Logs"
        description="Admin 敏感操作记录（谁 / 对谁 / 做了什么 / 为什么 / 什么时候）。只读。"
        total={result.total}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No admin actions recorded yet." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Admin</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((log) => (
              <tr key={log.id} className="border-t">
                <td className="px-3 py-2">
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {log.action}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {log.admin_user_id ? (
                    <Link
                      href={`/admin/users/${log.admin_user_id}`}
                      className="underline underline-offset-4"
                    >
                      {log.admin_user_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">
                  {log.target_user_id ? (
                    <Link
                      href={`/admin/users/${log.target_user_id}`}
                      className="underline underline-offset-4"
                    >
                      {log.target_user_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">{log.amount ?? '—'}</td>
                <td className="px-3 py-2">{log.reason || '—'}</td>
                <td className="px-3 py-2">
                  {new Date(log.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/audit-logs"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{}}
      />
    </div>
  )
}
