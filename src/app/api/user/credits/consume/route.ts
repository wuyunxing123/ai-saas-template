import { NextRequest, NextResponse } from 'next/server'

import '@/app/product-runtime'
import { getCurrentUser, getSessionIdentity } from '@/lib/auth-session'
import { checkUserCredits, consumeUserCredits } from '@/lib/services/credits'

/**
 * 用户积分消耗 / 查询 API
 *
 * ⚠️ 已收敛到统一的 Credit 领域服务
 * ---------------------------------
 * 本路由原先自己实现「读余额 → 判断 → UPDATE → 插流水」——
 * 这是**非原子**的（缺陷 B-11 的模式），并发下会超扣，
 * 且绕过了 Phase 3.5 建立的原子 RPC。
 *
 * 现在：
 *   POST → `consumeUserCredits()` → 数据库原子函数 `consume_credits()`
 *   GET  → `checkUserCredits()`
 * 响应结构保持不变，调用方无需改动。
 *
 * F-1：身份来自 `session.user.id`（主键），email 仅作老 session 兜底。
 */

// 🔥 消耗用户积分API
export async function POST(request: NextRequest) {
  try {
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json({ error: '用户未登录' }, { status: 401 })
    }

    const body = await request.json()
    const {
      amount = 2, // 默认消耗2积分
      action = 'image_generation', // 操作类型
      description = 'AI图像生成',
      metadata = {},
      idempotencyKey,
    } = body

    // 验证积分数量
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json(
        { error: '积分消耗数量必须为大于 0 的整数' },
        { status: 400 }
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: '用户信息不存在' }, { status: 404 })
    }

    const creditsBefore = user.credits ?? 0

    // 🔄 原子扣减（数据库 RPC，含幂等与余额保护）
    const result = await consumeUserCredits({
      userId: user.id,
      amount,
      type: 'usage',
      description,
      referenceId: `${action}_${Date.now()}`,
      idempotencyKey,
      metadata: {
        action,
        ...metadata,
      },
    })

    if (!result.success) {
      // 余额不足是客户端可修复的错误，返回 400；其余按 500 处理
      const isInsufficient = /不足/.test(result.error ?? '')
      const creditsAfter = result.user?.creditsAfter ?? creditsBefore

      if (isInsufficient) {
        return NextResponse.json(
          {
            error: '积分余额不足',
            currentCredits: creditsAfter,
            requiredCredits: amount,
            shortfall: Math.max(0, amount - creditsAfter),
          },
          { status: 400 }
        )
      }

      return NextResponse.json(
        { error: result.error || '积分扣除失败' },
        { status: 500 }
      )
    }

    const creditsAfter = result.user?.creditsAfter ?? creditsBefore

    return NextResponse.json({
      success: true,
      message: `成功消耗${amount}积分`,
      transaction: {
        id: result.transaction?.id ?? null,
        amount,
        description,
        createdAt: result.transaction?.created_at ?? new Date().toISOString(),
      },
      user: {
        id: user.id,
        email: user.email,
        creditsBeforeConsumption: creditsBefore,
        creditsAfterConsumption: creditsAfter,
        creditsConsumed: amount,
      },
    })
  } catch (error) {
    console.error('积分消耗失败:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// 🔥 检查积分余额API
export async function GET(request: NextRequest) {
  try {
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json({ error: '用户未登录' }, { status: 401 })
    }

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const requiredCredits = parseInt(searchParams.get('required') || '2', 10)

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: '用户信息不存在' }, { status: 404 })
    }

    const check = await checkUserCredits(user.id, requiredCredits)

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        credits: check.currentCredits,
      },
      check: {
        requiredCredits,
        hasEnoughCredits: check.hasEnoughCredits,
        shortfall: check.shortfall,
      },
    })
  } catch (error) {
    console.error('积分检查失败:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
