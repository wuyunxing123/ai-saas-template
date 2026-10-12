import Link from 'next/link'

import { AdminFilterBar } from '@/components/admin/filter-bar'
import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listAiTasks } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function AdminAiTasksPage({
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
  const provider = raw.get('provider') || undefined
  const model = raw.get('model') || undefined
  const status = raw.get('status') || undefined

  const result = await listAiTasks({ ...pagination, provider, model, status })

  return (
    <div>
      <AdminPageHeader
        title="AI Tasks"
        description="只读。重跑 / 取消 provider 任务属于后续 Workflow 阶段。"
        total={result.total}
      />

      <AdminFilterBar
        action="/admin/ai-tasks"
        fields={[
          { name: 'provider', placeholder: 'Provider', value: provider },
          { name: 'model', placeholder: 'Model', value: model },
          {
            name: 'status',
            placeholder: 'Status',
            value: status,
            type: 'select',
            options: [
              { value: 'pending', label: 'pending' },
              { value: 'processing', label: 'processing' },
              { value: 'completed', label: 'completed' },
              { value: 'failed', label: 'failed' },
              { value: 'cancelled', label: 'cancelled' },
            ],
          },
        ]}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No AI tasks found." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Provider task ID</th>
              <th className="px-3 py-2 font-medium">Credits</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Completed</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((task) => (
              <tr key={task.id} className="border-t">
                <td className="px-3 py-2">
                  {task.user_id ? (
                    <Link
                      href={`/admin/users/${task.user_id}`}
                      className="underline underline-offset-4"
                    >
                      {task.user_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">{task.model}</td>
                <td className="px-3 py-2">{task.provider}</td>
                <td className="px-3 py-2">{task.status}</td>
                <td className="text-muted-foreground max-w-[160px] truncate px-3 py-2 text-xs">
                  {task.provider_task_id || '—'}
                </td>
                <td className="px-3 py-2">{task.credits_used ?? '—'}</td>
                <td className="px-3 py-2">
                  {new Date(task.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {task.completed_at
                    ? new Date(task.completed_at).toLocaleString()
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/ai-tasks"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ provider, model, status }}
      />
    </div>
  )
}
