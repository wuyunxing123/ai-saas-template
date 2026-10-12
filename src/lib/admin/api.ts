/**
 * Admin API 包装器。
 *
 * 统一处理：
 *   1. requireAdmin（401 / 403）
 *   2. AdminError → 对应 HTTP 状态
 *   3. 未预期异常 → 500（生产环境不泄漏细节）
 */

import { NextResponse, type NextRequest } from 'next/server'

import { getAdminContext } from './authorization'
import { AdminError } from './errors'
import type { UserRow } from '@/lib/db/types'

export type AdminHandler = (
  request: NextRequest,
  context: { admin: UserRow; params: Record<string, string> }
) => Promise<NextResponse>

export function withAdmin(handler: AdminHandler) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    try {
      const auth = await getAdminContext()

      if (!auth.ok) {
        return NextResponse.json(
          { error: auth.error },
          { status: auth.status }
        )
      }

      const params = routeContext?.params ? await routeContext.params : {}

      return await handler(request, { admin: auth.user, params })
    } catch (error) {
      if (error instanceof AdminError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status }
        )
      }

      console.error('[admin api] unexpected error:', error)

      return NextResponse.json(
        {
          error:
            process.env.NODE_ENV === 'development' && error instanceof Error
              ? error.message
              : 'Internal server error',
        },
        { status: 500 }
      )
    }
  }
}
