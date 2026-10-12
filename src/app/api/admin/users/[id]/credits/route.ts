import { NextResponse, type NextRequest } from 'next/server'

import '@/app/product-runtime'
import { withAdmin } from '@/lib/admin/api'
import { AdminError } from '@/lib/admin/errors'
import { grantCredits } from '@/lib/admin/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/users/[id]/credits
 *
 * Body: { amount: number, reason: string }
 *
 * 目标用户来自 URL 路径（server-side 校验存在性），不信任客户端传来的 email。
 * 积分变动走 Credit 原子 RPC，并写审计日志。
 */
export const POST = withAdmin(async (request: NextRequest, { admin, params }) => {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    throw new AdminError('Invalid JSON body', 400, 'INVALID_AMOUNT')
  }

  const payload = (body ?? {}) as Record<string, unknown>
  const amount = Number(payload.amount)
  const reason = typeof payload.reason === 'string' ? payload.reason : ''

  const outcome = await grantCredits({
    adminUserId: admin.id,
    targetUserId: params.id,
    amount,
    reason,
  })

  return NextResponse.json({
    ok: true,
    balance: outcome.balance,
    transactionId: outcome.transactionId,
    idempotent: outcome.idempotent,
  })
})
