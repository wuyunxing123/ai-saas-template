import { NextRequest, NextResponse } from 'next/server'
import * as userRepo from '@/lib/db/repositories/user'

/**
 * POST /api/auth/register
 *
 * ⚠️ 关于密码（B-7 修复说明）
 * ---------------------------
 * 密码由 **Supabase Auth** 管理（见 `src/lib/auth.ts` 的 CredentialsProvider →
 * `supabase.auth.signInWithPassword`）。
 * 业务 `users` 表**没有** `password` 列，也不应该存密码。
 *
 * 修复前：本路由对密码做 bcrypt 哈希后写入 `users.password`。
 *   由于 `users` 表无该列（且伪 Prisma 适配器会静默丢弃未知字段），
 *   密码实际上从未被保存 —— 用该密码永远无法登录。
 *   同时 `bcrypt` 全项目仅此一处使用，属于无意义依赖。
 *
 * 修复后：不再处理密码，只创建业务用户档案。
 *   正式注册请走 Supabase Auth（前端 `/auth/signup` 页面）。
 */
export async function POST(request: NextRequest) {
  try {
    const { email, name } = await request.json()

    // 验证输入
    if (!email) {
      return NextResponse.json({ error: '邮箱是必需的' }, { status: 400 })
    }

    // 检查用户是否已存在
    const existingUser = await userRepo.findByEmail(email)

    if (existingUser) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 })
    }

    // 创建业务用户档案（不含密码 —— 密码由 Supabase Auth 负责）
    const user = await userRepo.create({
      email,
      name,
    })

    return NextResponse.json({
      message: '用户注册成功',
      user,
    })
  } catch (error: unknown) {
    console.error('Registration error:', error)
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Registration failed',
      },
      { status: 500 }
    )
  }
}

// 支持的HTTP方法
export async function GET() {
  return NextResponse.json({
    message: '用户注册API - 使用POST方法创建业务用户档案',
    note: '密码由 Supabase Auth 管理，本接口不处理密码',
    requiredFields: ['email'],
    optionalFields: ['name'],
  })
}