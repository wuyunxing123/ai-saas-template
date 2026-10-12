import Link from 'next/link'

import { AdminFilterBar } from '@/components/admin/filter-bar'
import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listSubscriptions } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function AdminSubscriptionsPage({
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
  const status = raw.get('status') || undefined
  const provider = raw.get('provider') || undefined
  const search = raw.get('search') || undefined

  const result = await listSubscriptions({ ...pagination, status, provider, search })

  return (
    <div>
      <AdminPageHeader
        title="Subscriptions"
        description="只读。手动续费 / 取消 / 修改订阅不在本阶段范围内。"
        total={result.total}
      />

      <AdminFilterBar
        action="/admin/subscriptions"
        fields={[
          { name: 'search', placeholder: 'Search user email', value: search },
          {
            name: 'status',
            placeholder: 'Status',
            value: status,
            type: 'select',
            options: [
              { value: 'active', label: 'active' },
              { value: 'inactive', label: 'inactive' },
              { value: 'cancelled', label: 'cancelled' },
            ],
          },
          { name: 'provider', placeholder: 'Provider', value: provider },
        ]}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No subscriptions found." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cycle</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Provider sub ID</th>
              <th className="px-3 py-2 font-medium">Period end</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((sub) => (
              <tr key={sub.id} className="border-t">
                <td className="px-3 py-2">
                  {sub.user_id ? (
                    <Link
                      href={`/admin/users/${sub.user_id}`}
                      className="underline underline-offset-4"
                    >
                      {sub.user_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">{sub.plan_id}</td>
                <td className="px-3 py-2">{sub.status}</td>
                <td className="px-3 py-2">{sub.billing_cycle}</td>
                <td className="px-3 py-2">{sub.payment_provider}</td>
                <td className="text-muted-foreground max-w-[160px] truncate px-3 py-2 text-xs">
                  {sub.provider_subscription_id || '—'}
                </td>
                <td className="px-3 py-2">
                  {sub.current_period_end
                    ? new Date(sub.current_period_end).toLocaleString()
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  {new Date(sub.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/subscriptions"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ search, status, provider }}
      />
    </div>
  )
}
