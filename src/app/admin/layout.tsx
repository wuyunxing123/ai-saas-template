import Link from 'next/link'
import '@/app/product-runtime'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { getAdminContext } from '@/lib/admin/authorization'

export const dynamic = 'force-dynamic'

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/credits', label: 'Credits' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/ai-tasks', label: 'AI Tasks' },
  { href: '/admin/audit-logs', label: 'Audit Logs' },
]

/**
 * Admin Layout — 所有 /admin/* 的统一权限边界。
 *
 * 未登录 → 跳转登录页；已登录但非 admin → 显示 403。
 * 权限判断统一走 getAdminContext()（users.role === 'admin'）。
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const auth = await getAdminContext()

  if (!auth.ok) {
    if (auth.status === 401) {
      redirect('/auth/signin?callbackUrl=/admin')
    }

    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">403 · Admin access required</h1>
        <p className="text-muted-foreground text-sm">
          当前账号没有管理员权限。如需开通，请联系站点管理员。
        </p>
        <Link
          href="/"
          className="text-primary text-sm underline underline-offset-4"
        >
          返回首页
        </Link>
      </main>
    )
  }

  const admin = auth.user

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">Admin Console</span>
            <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {admin.role}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{admin.email}</span>
            <Link href="/" className="underline underline-offset-4">
              返回站点
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-6 py-8">
        <nav className="w-48 shrink-0">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="hover:bg-muted block rounded-md px-3 py-2 text-sm"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
