import { NextRequest, NextResponse } from 'next/server'
import '@/app/product-runtime'
import { createAdminClient } from '@/lib/supabase/server'
import { getSessionIdentity } from '@/lib/auth-session'
import { getFreePlan } from '@/config/billing'

// 🔥 获取用户积分信息
export async function GET(request: NextRequest) {
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

    console.log('🔍 开始获取用户积分:', identity.email)

    // 🔍 直接使用Supabase获取用户信息
    const supabase = createAdminClient()

    let userQuery = supabase.from('users').select('*')
    userQuery = identity.id
      ? userQuery.eq('id', identity.id)
      : userQuery.eq('email', identity.email)

    const { data: user, error: userError } = await userQuery.limit(1).single()

    if (userError) {
      if (userError.code === 'PGRST116') { // No rows found
        console.log('❌ 用户信息不存在，尝试自动创建:', identity.email)

        // 🔧 自动创建用户（容错机制）
        try {
          const { getUuid } = await import('@/lib/utils/hash')

          const newUserData = {
            id: identity.id || getUuid(),
            email: identity.email,
            name: identity.name || identity.email,
            image: identity.image || '',
            credits: getFreePlan().welcomeCredits, // 🎁 新用户赠送（数字来自产品免费档配置）
            signin_type: 'oauth',
            signin_provider: 'google',
            signin_openid: '',
            last_signin_at: new Date().toISOString(),
            signin_count: 1,
            location: 'US',
            preferred_currency: 'USD',
            preferred_payment_provider: 'creem'
          }

          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert(newUserData)
            .select()
            .single()

          if (createError) {
            console.error('🚨 自动创建用户失败:', createError)
            return NextResponse.json(
              { 
                error: '用户信息不存在且创建失败',
                details: createError.message,
                suggestion: '请重新登录或联系技术支持'
              },
              { status: 404 }
            )
          }

          console.log('🎉 用户自动创建成功:', newUser.email)

          // 🎁 创建积分赠送记录（B-6：用 bonus 而非 gift）
          try {
            await supabase
              .from('credit_transactions')
              .insert({
                id: getUuid(),
                user_id: newUser.id,
                amount: getFreePlan().welcomeCredits,
                type: 'bonus',
                description: '新用户注册赠送积分',
                reference_id: 'welcome_bonus'
              })
          } catch (creditError) {
            console.error('⚠️ 积分记录创建失败:', creditError)
          }

          // 🔍 获取新用户的积分交易记录
          const { data: creditTransactions } = await supabase
            .from('credit_transactions')
            .select('*')
            .eq('user_id', newUser.id)
            .order('created_at', { ascending: false })
            .limit(10)

          return NextResponse.json({
            success: true,
            user: {
              id: newUser.id,
              email: newUser.email,
              name: newUser.name,
              credits: newUser.credits || 0,
              memberSince: newUser.created_at
            },
            creditTransactions: creditTransactions || [],
            activeSubscription: null,
            summary: {
              totalCredits: newUser.credits || 0,
              hasActiveSubscription: false,
              subscriptionPlan: null,
              subscriptionExpiry: null
            },
            message: '用户自动创建成功'
          })

        } catch (autoCreateError) {
          console.error('🚨 自动创建用户异常:', autoCreateError)
          return NextResponse.json(
            { 
              error: '用户信息不存在',
              details: '自动创建用户失败',
              suggestion: '请重新登录或联系技术支持'
            },
            { status: 404 }
          )
        }
      } else {
        console.error('🚨 查询用户失败:', userError)
        return NextResponse.json(
          { 
            error: '查询用户失败',
            details: userError.message
          },
          { status: 500 }
        )
      }
    }

    if (!user) {
      console.log('❌ 用户信息不存在:', identity.email)
      return NextResponse.json(
        { error: '用户信息不存在' },
        { status: 404 }
      )
    }

    console.log('✅ 用户信息获取成功:', user.email, '积分:', user.credits)

    // 🔍 获取用户的积分交易记录（最近10条）
    const { data: creditTransactions } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    // 🔍 获取用户的活跃订阅（模拟数据）
    const activeSubscription = null // 暂时返回null，后续可以实现

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits || 0,
        memberSince: user.created_at
      },
      creditTransactions: creditTransactions || [],
      activeSubscription,
      summary: {
        totalCredits: user.credits || 0,
        hasActiveSubscription: !!activeSubscription,
        subscriptionPlan: null,
        subscriptionExpiry: null
      }
    })

  } catch (error) {
    console.error('❌ 获取用户积分信息失败:', error)
    return NextResponse.json(
      { 
        error: '服务器内部错误',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    )
  }
} 