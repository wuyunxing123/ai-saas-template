import Link from 'next/link'

import { AdminFilterBar } from '@/components/admin/filter-bar'
import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listOrders } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function AdminOrdersPage({
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

  const result = await listOrders({ ...pagination, status, provider, search })

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        description="来自 orders 表（Phase 4 统一后的唯一订单表）。只读。"
        total={result.total}
      />

      <AdminFilterBar
        action="/admin/orders"
        fields={[
          {
            name: 'search',
            placeholder: 'Search email / order no.',
            value: search,
          },
          {
            name: 'status',
            placeholder: 'Status',
            value: status,
            type: 'select',
            options: [
              { value: 'pending', label: 'pending' },
              { value: 'paid', label: 'paid' },
              { value: 'failed', label: 'failed' },
              { value: 'cancelled', label: 'cancelled' },
              { value: 'refunded', label: 'refunded' },
              { value: 'expired', label: 'expired' },
            ],
          },
          { name: 'provider', placeholder: 'Provider (creem/stripe)', value: provider },
        ]}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No orders found." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Paid</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((order) => (
              <tr key={order.id} className="border-t">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="underline underline-offset-4"
                  >
                    {order.order_number}
                  </Link>
                </td>
                <td className="px-3 py-2">{order.customer_email}</td>
                <td className="px-3 py-2">
                  {order.amount} {order.currency ?? ''}
                </td>
                <td className="px-3 py-2">{order.status}</td>
                <td className="px-3 py-2">{order.payment_provider}</td>
                <td className="text-muted-foreground max-w-[160px] truncate px-3 py-2 text-xs">
                  {order.provider_session_id || '—'}
                </td>
                <td className="px-3 py-2">
                  {new Date(order.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {order.paid_at ? new Date(order.paid_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/orders"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ search, status, provider }}
      />
    </div>
  )
}
