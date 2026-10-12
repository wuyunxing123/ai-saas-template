import Link from 'next/link'

import { AdminPageHeader } from '@/components/admin/states'
import * as userRepo from '@/lib/db/repositories/user'
import * as orderRepo from '@/lib/db/repositories/order'
import * as subscriptionRepo from '@/lib/db/repositories/subscription'
import * as aiTaskRepo from '@/lib/db/repositories/ai-task'
import * as creditRepo from '@/lib/db/repositories/credit'

export const dynamic = 'force-dynamic'

/**
 * Admin Overview — 只做简单计数，复用现有 Repository。
 * 明确不做图表 / 趋势 / BI（见 PHASE_6_5_FOLLOWUPS.md）。
 */
export default async function AdminOverviewPage() {
  const [users, orders, subscriptions, aiTasks, creditTx] = await Promise.all([
    userRepo.count(),
    orderRepo.count(),
    subscriptionRepo.count(),
    aiTaskRepo.count(),
    creditRepo.countTransactions(),
  ])

  const cards = [
    { label: 'Users', value: users, href: '/admin/users' },
    { label: 'Orders', value: orders, href: '/admin/orders' },
    { label: 'Subscriptions', value: subscriptions, href: '/admin/subscriptions' },
    { label: 'AI Tasks', value: aiTasks, href: '/admin/ai-tasks' },
    { label: 'Credit Transactions', value: creditTx, href: '/admin/credits' },
  ]

  return (
    <div>
      <AdminPageHeader
        title="Overview"
        description="基础计数。图表 / 趋势分析不在本阶段范围内。"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="hover:bg-muted/50 rounded-md border p-4"
          >
            <div className="text-muted-foreground text-xs">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold">{card.value}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
