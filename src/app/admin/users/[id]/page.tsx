import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CreditGrantForm } from '@/components/admin/credit-grant-form'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { AdminError } from '@/lib/admin/errors'
import { getUserDetail } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let detail
  try {
    detail = await getUserDetail(id)
  } catch (error) {
    if (error instanceof AdminError && error.status === 404) {
      notFound()
    }
    throw error
  }

  const { user, credits, orders, subscriptions, aiTasks, creditTransactions, auditLogs } =
    detail

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link
          href="/admin/users"
          className="text-muted-foreground text-sm underline underline-offset-4"
        >
          ← Back to users
        </Link>
        <AdminPageHeader title={user.email} description={`User ID: ${user.id}`} />
      </div>

      {/* Basic info */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Basic Info</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">Role</dt>
            <dd>{user.role ?? 'user'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Name</dt>
            <dd>{user.name || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Credits</dt>
            <dd>{credits}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Created</dt>
            <dd>{new Date(user.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Last sign-in</dt>
            <dd>
              {user.last_signin_at
                ? new Date(user.last_signin_at).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Sign-in provider</dt>
            <dd>{user.signin_provider || '—'}</dd>
          </div>
        </dl>
      </section>

      {/* Credit adjustment */}
      <section>
        <h2 className="mb-1 text-sm font-semibold">Grant Credits</h2>
        <p className="text-muted-foreground mb-3 text-xs">
          经过 Credit 原子 RPC（grant_credits）发放，并写入审计日志。
        </p>
        <CreditGrantForm userId={user.id} />
      </section>

      {/* Orders */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Orders <span className="text-muted-foreground">({orders.length})</span>
        </h2>
        {orders.length === 0 ? (
          <AdminEmpty message="No orders found." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="underline underline-offset-4"
                    >
                      {order.order_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {order.amount} {order.currency ?? ''}
                  </td>
                  <td className="px-3 py-2">{order.status}</td>
                  <td className="px-3 py-2">{order.payment_provider}</td>
                  <td className="px-3 py-2">
                    {new Date(order.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </section>

      {/* Subscriptions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Subscriptions{' '}
          <span className="text-muted-foreground">({subscriptions.length})</span>
        </h2>
        {subscriptions.length === 0 ? (
          <AdminEmpty message="No subscriptions found." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Period end</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id} className="border-t">
                  <td className="px-3 py-2">{sub.plan_id}</td>
                  <td className="px-3 py-2">{sub.status}</td>
                  <td className="px-3 py-2">{sub.payment_provider}</td>
                  <td className="px-3 py-2">
                    {sub.current_period_end
                      ? new Date(sub.current_period_end).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </section>

      {/* Credit transactions */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Credit Transactions{' '}
          <span className="text-muted-foreground">
            (latest {creditTransactions.length})
          </span>
        </h2>
        {creditTransactions.length === 0 ? (
          <AdminEmpty message="No credit transactions found." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Balance after</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {creditTransactions.map((tx) => (
                <tr key={tx.id} className="border-t">
                  <td className="px-3 py-2">{tx.type}</td>
                  <td className="px-3 py-2">{tx.amount}</td>
                  <td className="px-3 py-2">{tx.balance_after ?? '—'}</td>
                  <td className="px-3 py-2">{tx.description || '—'}</td>
                  <td className="px-3 py-2">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </section>

      {/* AI tasks */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          AI Tasks <span className="text-muted-foreground">({aiTasks.length})</span>
        </h2>
        {aiTasks.length === 0 ? (
          <AdminEmpty message="No AI tasks found." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {aiTasks.map((task) => (
                <tr key={task.id} className="border-t">
                  <td className="px-3 py-2">{task.model}</td>
                  <td className="px-3 py-2">{task.provider}</td>
                  <td className="px-3 py-2">{task.status}</td>
                  <td className="px-3 py-2">
                    {new Date(task.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </AdminTableShell>
        )}
      </section>

      {/* Audit logs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Admin Actions{' '}
          <span className="text-muted-foreground">({auditLogs.length})</span>
        </h2>
        {auditLogs.length === 0 ? (
          <AdminEmpty message="No admin actions recorded for this user." />
        ) : (
          <AdminTableShell>
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Admin</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="px-3 py-2">{log.action}</td>
                  <td className="px-3 py-2">{log.amount ?? '—'}</td>
                  <td className="px-3 py-2">{log.reason || '—'}</td>
                  <td className="px-3 py-2">{log.admin_user_id ?? '—'}</td>
                  <td className="px-3 py-2">
                    {new Date(log.created_at).toLocaleString()}
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
