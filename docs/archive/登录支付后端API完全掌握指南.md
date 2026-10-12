# 🔐 登录支付后端API完全掌握指南

## 🎯 学习目标
彻底掌握当前项目的登录认证和支付系统，学会如何调整、优化和扩展后端API功能。

---

## 📊 系统架构总览

### 🏗️ **认证系统架构**
```
用户登录流程:
浏览器 → NextAuth → Google OAuth → 回调处理 → JWT生成 → 会话创建 → 数据库存储
```

### 💳 **支付系统架构**
```
支付流程:
用户选择套餐 → 创建支付会话 → 跳转支付页面 → 支付完成 → Webhook通知 → 更新数据库 → 发送确认
```

---

## 🔐 认证系统深度解析

### 📁 **认证相关文件结构**
```
src/
├── lib/
│   └── auth.ts                    # NextAuth主配置
├── app/
│   ├── api/
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts       # NextAuth API路由
│   ├── auth/
│   │   ├── signin/page.tsx        # 登录页面
│   │   ├── signup/page.tsx        # 注册页面
│   │   └── callback/page.tsx      # OAuth回调页面
│   └── middleware.ts              # 路由中间件
```

### 🔧 **NextAuth配置详解**

#### 1️⃣ **基础配置 (src/lib/auth.ts)**
```typescript
import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"

export const authOptions: NextAuthOptions = {
  // 数据库适配器 - 自动处理用户数据存储
  adapter: PrismaAdapter(prisma),
  
  // 认证提供商配置
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",           // 强制显示授权页面
          access_type: "offline",      // 获取刷新令牌
          response_type: "code"        // 授权码模式
        }
      }
    }),
    
    // 可以添加更多提供商
    // GitHubProvider({...}),
    // DiscordProvider({...}),
  ],
  
  // 会话配置
  session: {
    strategy: "jwt",                 // 使用JWT而不是数据库会话
    maxAge: 30 * 24 * 60 * 60,      // 30天过期
  },
  
  // JWT配置
  jwt: {
    maxAge: 30 * 24 * 60 * 60,      // 30天过期
  },
  
  // 回调函数 - 自定义认证逻辑
  callbacks: {
    // JWT回调 - 每次创建JWT时调用
    async jwt({ token, user, account, profile }) {
      // 首次登录时，user对象存在
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        token.image = user.image
        
        // 记录登录信息
        await recordLoginActivity({
          userId: user.id,
          provider: account?.provider || 'unknown',
          ip: getClientIP(),
          userAgent: getUserAgent()
        })
      }
      
      return token
    },
    
    // 会话回调 - 每次获取会话时调用
    async session({ session, token }) {
      // 将JWT中的信息添加到会话
      if (token) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.image = token.image as string
      }
      
      return session
    },
    
    // 登录回调 - 控制是否允许登录
    async signIn({ user, account, profile, email, credentials }) {
      try {
        // 检查用户是否被禁用
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! }
        })
        
        if (existingUser?.status === 'BANNED') {
          return false  // 拒绝登录
        }
        
        // 更新用户最后登录时间
        if (existingUser) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { lastLoginAt: new Date() }
          })
        }
        
        return true  // 允许登录
      } catch (error) {
        console.error('SignIn callback error:', error)
        return false
      }
    },
    
    // 重定向回调 - 控制登录后跳转
    async redirect({ url, baseUrl }) {
      // 如果是相对URL，使用baseUrl
      if (url.startsWith("/")) return `${baseUrl}${url}`
      
      // 如果是同域名URL，直接返回
      if (new URL(url).origin === baseUrl) return url
      
      // 否则跳转到首页
      return baseUrl
    }
  },
  
  // 自定义页面
  pages: {
    signIn: '/auth/signin',          // 自定义登录页面
    signUp: '/auth/signup',          // 自定义注册页面
    error: '/auth/error',            // 自定义错误页面
  },
  
  // 事件处理
  events: {
    async signIn({ user, account, profile, isNewUser }) {
      console.log(`User ${user.email} signed in with ${account?.provider}`)
      
      // 新用户欢迎邮件
      if (isNewUser) {
        await sendWelcomeEmail(user.email!)
      }
    },
    
    async signOut({ session, token }) {
      console.log(`User ${session?.user?.email} signed out`)
    }
  },
  
  // 调试模式
  debug: process.env.NODE_ENV === 'development',
}
```

#### 2️⃣ **API路由配置 (src/app/api/auth/[...nextauth]/route.ts)**
```typescript
import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"

// 创建NextAuth处理器
const handler = NextAuth(authOptions)

// 导出GET和POST处理器
export { handler as GET, handler as POST }
```

#### 3️⃣ **中间件配置 (src/middleware.ts)**
```typescript
import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    // 检查用户角色和权限
    const token = req.nextauth.token
    const { pathname } = req.nextUrl
    
    // 管理员页面权限检查
    if (pathname.startsWith('/admin')) {
      if (token?.role !== 'ADMIN') {
        return NextResponse.redirect(new URL('/unauthorized', req.url))
      }
    }
    
    // VIP功能权限检查
    if (pathname.startsWith('/vip')) {
      if (token?.subscription !== 'PRO') {
        return NextResponse.redirect(new URL('/pricing', req.url))
      }
    }
    
    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // 定义需要认证的路径
        const protectedPaths = ['/dashboard', '/profile', '/admin', '/vip']
        const { pathname } = req.nextUrl
        
        // 检查是否需要认证
        const needsAuth = protectedPaths.some(path => 
          pathname.startsWith(path)
        )
        
        // 如果需要认证但没有token，返回false
        if (needsAuth && !token) {
          return false
        }
        
        return true
      }
    }
  }
)

// 配置中间件匹配路径
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/admin/:path*',
    '/vip/:path*'
  ]
}
```

### 🔧 **如何调整认证系统**

#### 📝 **添加新的OAuth提供商**
```typescript
// 1. 安装提供商包
npm install next-auth-providers

// 2. 在auth.ts中添加配置
import GitHubProvider from "next-auth/providers/github"
import DiscordProvider from "next-auth/providers/discord"

providers: [
  GoogleProvider({...}),
  
  // 添加GitHub登录
  GitHubProvider({
    clientId: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  }),
  
  // 添加Discord登录
  DiscordProvider({
    clientId: process.env.DISCORD_CLIENT_ID!,
    clientSecret: process.env.DISCORD_CLIENT_SECRET!,
  }),
]

// 3. 添加环境变量
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
```

#### 📝 **添加邮箱密码登录**
```typescript
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"

providers: [
  // 其他提供商...
  
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" }
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        return null
      }
      
      // 查找用户
      const user = await prisma.user.findUnique({
        where: { email: credentials.email }
      })
      
      if (!user || !user.hashedPassword) {
        return null
      }
      
      // 验证密码
      const isValid = await bcrypt.compare(
        credentials.password,
        user.hashedPassword
      )
      
      if (!isValid) {
        return null
      }
      
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      }
    }
  })
]
```

#### 📝 **添加用户角色和权限**
```typescript
// 1. 更新数据库模型
model User {
  id       String   @id @default(cuid())
  email    String   @unique
  name     String?
  image    String?
  role     UserRole @default(USER)     // 添加角色字段
  status   UserStatus @default(ACTIVE) // 添加状态字段
  // ...其他字段
}

enum UserRole {
  USER
  ADMIN
  MODERATOR
}

enum UserStatus {
  ACTIVE
  BANNED
  PENDING
}

// 2. 更新JWT回调
async jwt({ token, user }) {
  if (user) {
    // 获取用户完整信息
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id }
    })
    
    token.role = fullUser?.role
    token.status = fullUser?.status
  }
  return token
}

// 3. 更新会话回调
async session({ session, token }) {
  session.user.role = token.role
  session.user.status = token.status
  return session
}
```

---

## 💳 支付系统深度解析

### 📁 **支付相关文件结构**
```
src/
├── lib/
│   ├── config/
│   │   └── payment.ts             # 支付配置
│   ├── payment/
│   │   ├── stripe.ts              # Stripe集成
│   │   ├── creem.ts               # Creem集成
│   │   └── webhook-handlers.ts    # Webhook处理
│   └── services/
│       └── payment-database.ts    # 支付数据库操作
├── app/
│   ├── api/
│   │   ├── payment/
│   │   │   ├── create-session/route.ts    # 创建支付会话
│   │   │   ├── verify-payment/route.ts    # 验证支付状态
│   │   │   └── cancel-subscription/route.ts # 取消订阅
│   │   └── webhooks/
│   │       ├── stripe/route.ts            # Stripe Webhook
│   │       └── creem/route.ts             # Creem Webhook
│   └── pricing/page.tsx           # 定价页面
```

### 🔧 **支付配置详解**

#### 1️⃣ **支付配置 (src/lib/config/payment.ts)**
```typescript
// 支付系统配置
export const PAYMENT_CONFIG = {
  // 提供商开关
  STRIPE_ENABLED: true,
  CREEM_ENABLED: true,
  
  // 默认提供商
  DEFAULT_PROVIDER: "creem" as "stripe" | "creem",
  
  // 系统维护
  MAINTENANCE_MODE: false,
  
  // 支付配置
  STRIPE_CONFIG: {
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    apiVersion: '2023-10-16' as const,
  },
  
  CREEM_CONFIG: {
    apiUrl: process.env.CREEM_API_URL!,
    apiKey: process.env.CREEM_API_KEY!,
    webhookSecret: process.env.CREEM_WEBHOOK_SECRET!,
  },
  
  // 定价方案
  PRICING_PLANS: {
    basic: {
      id: 'basic',
      name: 'Basic',
      credits: 4000,
      monthlyPrice: 29990,  // 分为单位
      yearlyPrice: 26990,
      features: ['720p分辨率', '最长5秒视频', '标准处理速度']
    },
    plus: {
      id: 'plus',
      name: 'Plus',
      credits: 7500,
      monthlyPrice: 49990,
      yearlyPrice: 44990,
      features: ['1080p分辨率', '最长8秒视频', '优先处理', '商用授权']
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      credits: 16000,
      monthlyPrice: 99990,
      yearlyPrice: 89990,
      features: ['4K分辨率', '最长15秒视频', '最高优先级', 'API访问']
    }
  }
}

// 获取活跃的支付提供商
export function getActivePaymentProvider(): "stripe" | "creem" | null {
  const config = PAYMENT_CONFIG
  
  if (config.MAINTENANCE_MODE) {
    return null
  }
  
  // 检查环境变量是否配置
  const stripeReady = config.STRIPE_ENABLED && 
    config.STRIPE_CONFIG.publishableKey && 
    config.STRIPE_CONFIG.secretKey
    
  const creemReady = config.CREEM_ENABLED && 
    config.CREEM_CONFIG.apiUrl && 
    config.CREEM_CONFIG.apiKey
  
  // 返回默认提供商
  if (config.DEFAULT_PROVIDER === "stripe" && stripeReady) {
    return "stripe"
  }
  
  if (config.DEFAULT_PROVIDER === "creem" && creemReady) {
    return "creem"
  }
  
  // 备选方案
  if (stripeReady) return "stripe"
  if (creemReady) return "creem"
  
  return null
}

// 获取定价方案
export function getPricingPlan(planId: string) {
  return PAYMENT_CONFIG.PRICING_PLANS[planId as keyof typeof PAYMENT_CONFIG.PRICING_PLANS]
}

// 计算价格
export function calculatePrice(planId: string, billingCycle: 'monthly' | 'yearly') {
  const plan = getPricingPlan(planId)
  if (!plan) return null
  
  return billingCycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice
}
```

#### 2️⃣ **Stripe集成 (src/lib/payment/stripe.ts)**
```typescript
import Stripe from 'stripe'
import { PAYMENT_CONFIG } from '@/lib/config/payment'

// 初始化Stripe客户端
const stripe = new Stripe(PAYMENT_CONFIG.STRIPE_CONFIG.secretKey, {
  apiVersion: PAYMENT_CONFIG.STRIPE_CONFIG.apiVersion,
})

// 创建Stripe支付会话
export async function createStripeSession({
  userId,
  planId,
  billingCycle,
  successUrl,
  cancelUrl
}: {
  userId: string
  planId: string
  billingCycle: 'monthly' | 'yearly'
  successUrl: string
  cancelUrl: string
}) {
  try {
    // 获取定价信息
    const plan = getPricingPlan(planId)
    if (!plan) {
      throw new Error('Invalid plan ID')
    }
    
    const price = calculatePrice(planId, billingCycle)
    if (!price) {
      throw new Error('Invalid pricing')
    }
    
    // 获取或创建Stripe客户
    const customer = await getOrCreateStripeCustomer(userId)
    
    // 创建支付会话
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'cny',
            product_data: {
              name: `${plan.name} Plan`,
              description: `${plan.credits} credits per ${billingCycle === 'monthly' ? 'month' : 'year'}`,
            },
            unit_amount: price,
            recurring: {
              interval: billingCycle === 'monthly' ? 'month' : 'year',
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId,
        planId,
        billingCycle,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    })
    
    // 记录支付会话
    await recordPaymentSession({
      userId,
      provider: 'stripe',
      sessionId: session.id,
      planId,
      billingCycle,
      amount: price,
      status: 'pending'
    })
    
    return session.url!
    
  } catch (error) {
    console.error('Stripe session creation failed:', error)
    throw new Error('Failed to create payment session')
  }
}

// 获取或创建Stripe客户
async function getOrCreateStripeCustomer(userId: string) {
  // 查找现有客户
  const user = await prisma.user.findUnique({
    where: { id: userId }
  })
  
  if (!user) {
    throw new Error('User not found')
  }
  
  // 如果已有Stripe客户ID，直接返回
  if (user.stripeCustomerId) {
    return await stripe.customers.retrieve(user.stripeCustomerId)
  }
  
  // 创建新的Stripe客户
  const customer = await stripe.customers.create({
    email: user.email!,
    name: user.name || undefined,
    metadata: {
      userId: user.id,
    },
  })
  
  // 保存客户ID到数据库
  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id }
  })
  
  return customer
}

// 处理Stripe Webhook
export async function handleStripeWebhook(
  body: string,
  signature: string
) {
  try {
    // 验证Webhook签名
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      PAYMENT_CONFIG.STRIPE_CONFIG.webhookSecret
    )
    
    console.log(`Stripe webhook received: ${event.type}`)
    
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object)
        break
        
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object)
        break
        
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break
        
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object)
        break
        
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
    
    return { received: true }
    
  } catch (error) {
    console.error('Stripe webhook error:', error)
    throw error
  }
}

// 处理支付成功
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const { userId, planId, billingCycle } = session.metadata!
  
  // 更新订阅状态
  await createOrUpdateSubscription({
    userId,
    stripeSubscriptionId: session.subscription as string,
    planId,
    billingCycle,
    status: 'active'
  })
  
  // 添加积分
  const plan = getPricingPlan(planId)
  if (plan) {
    await addUserCredits(userId, plan.credits)
  }
  
  // 发送确认邮件
  await sendPaymentConfirmationEmail(userId, planId)
}
```

#### 3️⃣ **创建支付会话API (src/app/api/payment/create-session/route.ts)**
```typescript
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getActivePaymentProvider, getPricingPlan } from '@/lib/config/payment'
import { createStripeSession } from '@/lib/payment/stripe'
import { createCreemSession } from '@/lib/payment/creem'

export async function POST(request: NextRequest) {
  try {
    // 1. 用户认证检查
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // 2. 解析请求数据
    const body = await request.json()
    const { planId, billingCycle } = body
    
    // 3. 数据验证
    if (!planId || !billingCycle) {
      return Response.json(
        { error: 'Missing required fields: planId, billingCycle' },
        { status: 400 }
      )
    }
    
    if (!['monthly', 'yearly'].includes(billingCycle)) {
      return Response.json(
        { error: 'Invalid billing cycle' },
        { status: 400 }
      )
    }
    
    // 4. 验证定价方案
    const plan = getPricingPlan(planId)
    if (!plan) {
      return Response.json(
        { error: 'Invalid plan ID' },
        { status: 400 }
      )
    }
    
    // 5. 检查支付系统状态
    const provider = getActivePaymentProvider()
    if (!provider) {
      return Response.json(
        { error: 'Payment system is under maintenance' },
        { status: 503 }
      )
    }
    
    // 6. 生成回调URL
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    const successUrl = `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${baseUrl}/pricing?canceled=true`
    
    // 7. 创建支付会话
    let checkoutUrl: string
    
    if (provider === 'stripe') {
      checkoutUrl = await createStripeSession({
        userId: session.user.id,
        planId,
        billingCycle,
        successUrl,
        cancelUrl
      })
    } else {
      checkoutUrl = await createCreemSession({
        userId: session.user.id,
        planId,
        billingCycle,
        successUrl,
        cancelUrl
      })
    }
    
    // 8. 记录支付尝试
    await recordPaymentAttempt({
      userId: session.user.id,
      provider,
      planId,
      billingCycle,
      amount: calculatePrice(planId, billingCycle),
      ip: getClientIP(request),
      userAgent: request.headers.get('user-agent')
    })
    
    // 9. 返回成功响应
    return Response.json({
      success: true,
      checkoutUrl,
      provider,
      planId,
      billingCycle
    })
    
  } catch (error) {
    console.error('Payment session creation failed:', error)
    
    // 记录错误
    await recordPaymentError({
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    })
    
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// 获取客户端IP地址
function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const real = request.headers.get('x-real-ip')
  const remote = request.headers.get('remote-addr')
  
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  return real || remote || 'unknown'
}
```

### 🔧 **如何调整支付系统**

#### 📝 **添加新的支付提供商**
```typescript
// 1. 在配置中添加新提供商
export const PAYMENT_CONFIG = {
  // 现有配置...
  
  PAYPAL_ENABLED: true,
  PAYPAL_CONFIG: {
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox'
  }
}

// 2. 创建PayPal集成文件
// src/lib/payment/paypal.ts
import { PayPalApi } from '@paypal/checkout-server-sdk'

export async function createPayPalSession({
  userId,
  planId,
  billingCycle,
  successUrl,
  cancelUrl
}) {
  // PayPal集成逻辑
}

// 3. 更新支付会话创建逻辑
if (provider === 'paypal') {
  checkoutUrl = await createPayPalSession({
    userId: session.user.id,
    planId,
    billingCycle,
    successUrl,
    cancelUrl
  })
}
```

#### 📝 **添加优惠券系统**
```typescript
// 1. 数据库模型
model Coupon {
  id          String   @id @default(cuid())
  code        String   @unique
  discount    Int      // 折扣百分比
  validFrom   DateTime
  validUntil  DateTime
  maxUses     Int?
  usedCount   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
}

model CouponUsage {
  id       String @id @default(cuid())
  couponId String
  userId   String
  orderId  String
  usedAt   DateTime @default(now())
  
  coupon   Coupon @relation(fields: [couponId], references: [id])
  user     User   @relation(fields: [userId], references: [id])
}

// 2. 优惠券验证API
// src/app/api/payment/validate-coupon/route.ts
export async function POST(request: NextRequest) {
  const { code, planId, billingCycle } = await request.json()
  
  const coupon = await prisma.coupon.findUnique({
    where: { code }
  })
  
  if (!coupon || !coupon.isActive) {
    return Response.json({ valid: false, error: 'Invalid coupon' })
  }
  
  if (new Date() > coupon.validUntil) {
    return Response.json({ valid: false, error: 'Coupon expired' })
  }
  
  if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
    return Response.json({ valid: false, error: 'Coupon usage limit reached' })
  }
  
  const originalPrice = calculatePrice(planId, billingCycle)
  const discountedPrice = Math.round(originalPrice * (100 - coupon.discount) / 100)
  
  return Response.json({
    valid: true,
    discount: coupon.discount,
    originalPrice,
    discountedPrice
  })
}

// 3. 在支付会话中应用优惠券
if (couponCode) {
  const couponValidation = await validateCoupon(couponCode, planId, billingCycle)
  if (couponValidation.valid) {
    price = couponValidation.discountedPrice
    metadata.couponCode = couponCode
  }
}
```

#### 📝 **添加退款功能**
```typescript
// src/app/api/payment/refund/route.ts
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { subscriptionId, reason } = await request.json()
    
    // 查找订阅
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { user: true }
    })
    
    if (!subscription || subscription.userId !== session.user.id) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 })
    }
    
    // 检查退款政策（例如：7天内可退款）
    const daysSinceCreated = Math.floor(
      (Date.now() - subscription.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    )
    
    if (daysSinceCreated > 7) {
      return Response.json({ 
        error: 'Refund period has expired' 
      }, { status: 400 })
    }
    
    // 执行退款
    let refundResult
    if (subscription.stripeSubscriptionId) {
      refundResult = await processStripeRefund(subscription.stripeSubscriptionId)
    } else if (subscription.creemSubscriptionId) {
      refundResult = await processCreemRefund(subscription.creemSubscriptionId)
    }
    
    // 更新订阅状态
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { 
        status: 'refunded',
        refundReason: reason,
        refundedAt: new Date()
      }
    })
    
    // 扣除积分
    await deductUserCredits(session.user.id, subscription.credits)
    
    return Response.json({ success: true, refundResult })
    
  } catch (error) {
    console.error('Refund failed:', error)
    return Response.json({ error: 'Refund failed' }, { status: 500 })
  }
}
```

---

## 🎯 实战练习项目

### 🔰 **练习1: 添加微信登录**
```typescript
// 目标: 集成微信OAuth登录
// 步骤:
1. 注册微信开放平台应用
2. 安装微信登录提供商
3. 配置NextAuth
4. 测试登录流程
5. 处理用户信息同步
```

### 🔧 **练习2: 实现积分充值**
```typescript
// 目标: 创建单独的积分充值功能
// 步骤:
1. 设计积分充值套餐
2. 创建充值API接口
3. 集成支付流程
4. 实现积分到账
5. 添加充值记录
```

### 🚀 **练习3: 构建管理员面板**
```typescript
// 目标: 创建支付和用户管理后台
// 步骤:
1. 设计管理员权限系统
2. 创建用户管理界面
3. 实现支付数据统计
4. 添加退款处理功能
5. 构建实时监控面板
```

---

## 🎉 总结

通过这个完整的指南，你现在应该能够：

### ✅ **认证系统掌握**
- 理解NextAuth的工作原理
- 配置多种OAuth提供商
- 实现自定义认证逻辑
- 处理用户权限和角色

### ✅ **支付系统掌握**
- 理解双支付系统架构
- 配置Stripe和Creem集成
- 处理支付回调和Webhook
- 实现订阅和积分管理

### ✅ **API开发掌握**
- 设计RESTful API接口
- 实现完整的错误处理
- 添加数据验证和安全检查
- 优化API性能和可靠性

记住：**掌握这些技能需要大量的实践和调试。不要害怕出错，每个错误都是学习的机会！** 🚀 