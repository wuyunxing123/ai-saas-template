import Link from 'next/link'

import { AdminFilterBar } from '@/components/admin/filter-bar'
import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listCreditTransactions } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function AdminCreditsPage({
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
  const type = raw.get('type') || undefined
  const search = raw.get('search') || undefined

  const result = await listCreditTransactions({ ...pagination, type, search })

  return (
    <div>
      <AdminPageHeader
        title="Credit Transactions"
        description="只读流水。调整积分请在用户详情页操作（走原子 RPC + 审计）。"
        total={result.total}
      />

      <AdminFilterBar
        action="/admin/credits"
        fields={[
          { name: 'search', placeholder: 'Search user email', value: search },
          {
            name: 'type',
            placeholder: 'Type',
            value: type,
            type: 'select',
            options: [
              { value: 'purchase', label: 'purchase' },
              { value: 'grant', label: 'grant' },
              { value: 'consume', label: 'consume' },
              { value: 'usage', label: 'usage' },
              { value: 'refund', label: 'refund' },
              { value: 'bonus', label: 'bonus' },
              { value: 'adjustment', label: 'adjustment' },
              { value: 'expire', label: 'expire' },
            ],
          },
        ]}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No credit transactions found." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Balance after</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((tx) => (
              <tr key={tx.id} className="border-t">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/users/${tx.user_id}`}
                    className="underline underline-offset-4"
                  >
                    {tx.user_id.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-3 py-2">{tx.type}</td>
                <td className="px-3 py-2">{tx.amount}</td>
                <td className="px-3 py-2">{tx.balance_after ?? '—'}</td>
                <td className="px-3 py-2">{tx.description || '—'}</td>
                <td className="text-muted-foreground px-3 py-2 text-xs">
                  {tx.reference_type ? `${tx.reference_type}:${tx.reference_id ?? ''}` : '—'}
                </td>
                <td className="px-3 py-2">
                  {new Date(tx.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/credits"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ search, type }}
      />
    </div>
  )
}
