import Link from 'next/link'

import { AdminFilterBar } from '@/components/admin/filter-bar'
import { AdminPagination } from '@/components/admin/pagination'
import { AdminEmpty, AdminPageHeader, AdminTableShell } from '@/components/admin/states'
import { parsePagination } from '@/lib/admin/pagination'
import { listUsers } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function AdminUsersPage({
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
  const search = raw.get('search') || undefined
  const role = raw.get('role') || undefined

  const result = await listUsers({ ...pagination, search, role })

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description="分页列出用户，可按 email / name 搜索。"
        total={result.total}
      />

      <AdminFilterBar
        action="/admin/users"
        fields={[
          { name: 'search', placeholder: 'Search email / name', value: search },
          {
            name: 'role',
            placeholder: 'Role',
            value: role,
            type: 'select',
            options: [
              { value: 'user', label: 'user' },
              { value: 'admin', label: 'admin' },
            ],
          },
        ]}
      />

      {result.items.length === 0 ? (
        <AdminEmpty message="No users found." />
      ) : (
        <AdminTableShell>
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Credits</th>
              <th className="px-3 py-2 font-medium">Created</th>
              <th className="px-3 py-2 font-medium">Last sign-in</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {result.items.map((user) => (
              <tr key={user.id} className="border-t">
                <td className="px-3 py-2">
                  <div>{user.email}</div>
                  <div className="text-muted-foreground text-xs">{user.id}</div>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {user.role ?? 'user'}
                  </span>
                </td>
                <td className="px-3 py-2">{user.credits ?? 0}</td>
                <td className="px-3 py-2">
                  {new Date(user.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {user.last_signin_at
                    ? new Date(user.last_signin_at).toLocaleString()
                    : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="underline underline-offset-4"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </AdminTableShell>
      )}

      <AdminPagination
        basePath="/admin/users"
        page={result.page}
        totalPages={result.totalPages}
        searchParams={{ search, role }}
      />
    </div>
  )
}
