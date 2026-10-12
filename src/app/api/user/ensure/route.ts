import { NextRequest, NextResponse } from 'next/server'
import '@/app/product-runtime'
import { createAdminClient } from '@/lib/supabase/server'
import { getSessionIdentity } from '@/lib/auth-session'
import { getFreePlan } from '@/config/billing'

// 🔧 确保用户存在API - 如果用户不存在则自动创建
export async function POST(request: NextRequest) {
  try {
    // 🔐 验证用户身份（F-1：优先 session.user.id，email 仅作老 session 兜底）
    const identity = await getSessionIdentity()
    if (!identity) {
      console.log('❌ 用户未登录')
      return NextResponse.json(
        { error: '用户未登录' },
        { status: 401 }
      )
    }

    console.log('🔍 确保用户存在:', identity.email)

    const supabase = createAdminClient()

    // 首先尝试查找用户（优先主键 id）
    try {
      let findQuery = supabase.from('users').select('*')
      findQuery = identity.id
        ? findQuery.eq('id', identity.id)
        : findQuery.eq('email', identity.email)

      const { data: existingUser, error: findError } = await findQuery
        .limit(1)
        .single()

      if (!findError && existingUser) {
        console.log('✅ 用户已存在:', existingUser.email)
        return NextResponse.json({
          success: true,
          message: '用户已存在',
          user: {
            id: existingUser.id,
            email: existingUser.email,
            name: existingUser.name,
            credits: existingUser.credits || 0
          },
          action: 'found'
        })
      }

      // 如果用户不存在，尝试创建
      if (findError?.message?.includes('does not exist')) {
        console.log('❌ 用户表不存在，无法创建用户')
        return NextResponse.json({
          success: false,
          error: '数据库表不存在',
          message: '请先执行数据库初始化脚本',
          recommendation: '按顺序执行 supabase/migrations/ 下的迁移（见 docs/DATABASE.md）'
        }, { status: 500 })
      }

      // 用户不存在，创建新用户
      console.log('🔧 创建新用户:', identity.email)

      const newUserData = {
        ...(identity.id ? { id: identity.id } : {}),
        email: identity.email,
        name: identity.name || null,
        image: identity.image || null,
        credits: getFreePlan().welcomeCredits, // 注册赠送（数字来自产品免费档配置）
        signin_provider: 'nextauth',
        signin_type: 'oauth',
        signin_count: 1,
        last_signin_at: new Date().toISOString()
      }

      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert(newUserData)
        .select()
        .single()

      if (createError) {
        console.error('🚨 创建用户失败:', createError)
        return NextResponse.json({
          success: false,
          error: '创建用户失败',
          details: createError.message
        }, { status: 500 })
      }

      console.log('✅ 用户创建成功:', newUser.email)
      
      return NextResponse.json({
        success: true,
        message: '用户创建成功',
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          credits: newUser.credits || 0
        },
        action: 'created'
      })

    } catch (error) {
      console.error('🚨 数据库操作失败:', error)
      
      // 如果是表不存在的错误，提供明确的指导
      if (error instanceof Error && error.message.includes('does not exist')) {
        return NextResponse.json({
          success: false,
          error: '数据库表不存在',
          message: '数据库尚未初始化',
          recommendation: '按顺序执行 supabase/migrations/ 下的迁移（见 docs/DATABASE.md）',
          debugInfo: {
            error: error.message,
            userEmail: identity.email
          }
        }, { status: 500 })
      }

      return NextResponse.json({
        success: false,
        error: '数据库操作失败',
        details: error instanceof Error ? error.message : '未知错误'
      }, { status: 500 })
    }

  } catch (error) {
    console.error('❌ 确保用户存在失败:', error)
    return NextResponse.json(
      { 
        success: false,
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    )
  }
}

// 🔍 检查用户状态
export async function GET(request: NextRequest) {
  try {
    // F-1：优先 session.user.id，email 仅作老 session 兜底
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json(
        { error: '用户未登录' },
        { status: 401 }
      )
    }

    const supabase = createAdminClient()

    try {
      let userQuery = supabase.from('users').select('*')
      userQuery = identity.id
        ? userQuery.eq('id', identity.id)
        : userQuery.eq('email', identity.email)

      const { data: user, error } = await userQuery.limit(1).single()

      if (error) {
        if (error.message.includes('does not exist')) {
          return NextResponse.json({
            success: false,
            exists: false,
            error: '数据库表不存在',
            recommendation: '请执行数据库初始化'
          })
        }
        
        return NextResponse.json({
          success: false,
          exists: false,
          error: '用户不存在',
          canCreate: true
        })
      }

      return NextResponse.json({
        success: true,
        exists: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          credits: user.credits || 0
        }
      })

    } catch (error) {
      return NextResponse.json({
        success: false,
        error: '数据库查询失败',
        details: error instanceof Error ? error.message : '未知错误'
      }, { status: 500 })
    }

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: '服务器错误',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 })
  }
} 