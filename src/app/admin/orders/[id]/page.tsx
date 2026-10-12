import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { AdminError } from '@/lib/admin/errors'
import { getOrderDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let detail
  try {
    detail = await getOrderDetail(id)
  } catch (error) {
    if (error instanceof AdminError && error.status === 404) {
      notFound()
    }
    throw error
  }

  const { order, user, creditTransactions } = detail

  const rows: [string, string][] = [
    ['Order number', order.order_number],
    ['Status', order.status],
    ['Amount', `${order.amount} ${order.currency ?? ''}`],
    ['Provider', order.payment_provider],
    ['Provider session', order.provider_session_id || '—'],
    ['Provider payment', order.provider_payment_id || '—'],
    ['Product', `${order.product_type} · ${order.product_name}`],
    ['Package ID', order.package_id || '—'],
    ['Customer email', order.customer_email],
    ['Fulfilled at', order.fulfilled_at ? new Date(order.fulfilled_at).toLocaleString() : '—'],
    ['Paid at', order.paid_at ? new Date(order.paid_at).toLocaleString() : '—'],
    ['Created', new Date(order.created_at).toLocaleString()],
  ]

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/orders"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Back to orders
        </Link>
        <AdminPageHeader title={order.order_number} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Order</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b py-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">User</h2>
        {user ? (
          <div className="text-sm">
            <Link
              href={`/admin/users/${user.id}`}
              className="underline underline-offset-4"
            >
              {user.email}
            </Link>
            <span className="text-muted-foreground ml-2 text-xs">{user.id}</span>
          </div>
        ) : (
          <AdminEmpty message="No user linked to this order." />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Credit Transactions{' '}
          <span className="text-muted-foreground">({creditTransactions.length})</span>
        </h2>
        {creditTransactions.length === 0 ? (
          <AdminEmpty message="No credit transactions linked to this order." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Balance after</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {creditTransactions.map((tx) => (
                <tr key={tx.id} className="border-t">
                  <td className="px-3 py-2">{tx.type}</td>
                  <td className="px-3 py-2">{tx.amount}</td>
                  <td className="px-3 py-2">{tx.balance_after ?? '—'}</td>
                  <td className="px-3 py-2">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </section>
    </div>
  )
}
