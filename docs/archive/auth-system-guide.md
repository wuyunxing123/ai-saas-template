# 🔐 认证系统配置指南

## 🎯 当前架构：NextAuth.js + Supabase

项目采用**双重认证架构**：
- **NextAuth.js**：处理登录流程、会话管理、第三方OAuth
- **Supabase**：存储用户数据、Credits管理、使用记录

## 🚀 快速配置

### 1. Supabase配置

#### 创建Supabase项目
1. 访问 [supabase.com](https://supabase.com)
2. 创建新项目
3. 获取项目URL和API密钥

#### 数据库初始化
```sql
-- 运行 supabase-schema.sql 中的SQL脚本
-- 或手动创建表结构

-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR UNIQUE NOT NULL,
  name VARCHAR,
  image VARCHAR,
  credits INTEGER DEFAULT 100,
  tier VARCHAR DEFAULT 'free',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 生成记录表
CREATE TABLE generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  prompt TEXT,
  model VARCHAR,
  credits_used INTEGER,
  image_urls TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);

-- API密钥表
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  key_hash VARCHAR NOT NULL,
  name VARCHAR,
  last_used TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);
```

### 2. NextAuth.js配置

#### 环境变量配置
```bash
# NextAuth 基础配置
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-super-secret-key-here"

# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"

# Google OAuth (可选)
AUTH_GOOGLE_ID="your-google-client-id"
AUTH_GOOGLE_SECRET="your-google-client-secret"

# GitHub OAuth (可选)
AUTH_GITHUB_ID="your-github-client-id"
AUTH_GITHUB_SECRET="your-github-client-secret"
```

#### NextAuth配置文件
```typescript
// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        // 实现邮箱密码登录逻辑
        // 这里可以集成bcrypt进行密码验证
        return null
      }
    })
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // 用户登录时，同步到Supabase
      const { data, error } = await supabase
        .from('users')
        .upsert({
          email: user.email,
          name: user.name,
          image: user.image,
        })
        .select()
      
      return true
    },
    async session({ session, token }) {
      // 从Supabase获取用户完整信息
      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('email', session.user?.email)
        .single()
      
      if (userData) {
        session.user.id = userData.id
        session.user.credits = userData.credits
        session.user.tier = userData.tier
      }
      
      return session
    }
  }
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

## 🎮 使用模式分析

### 模式1：完全免登录（当前）
```typescript
// 优点：用户体验好，无门槛
// 缺点：无法防刷，成本不可控

// 当前实现
export function FluxKontextGenerator() {
  // 直接调用API，无需登录
  const generateImage = async () => {
    const response = await fetch('/api/flux-kontext', {
      method: 'POST',
      body: JSON.stringify({ prompt, action: 'text-to-image-pro' })
    })
  }
}
```

### 模式2：登录后使用（推荐）
```typescript
// 优点：可控成本，用户管理，防刷
// 缺点：增加使用门槛

import { useSession } from 'next-auth/react'

export function FluxKontextGenerator() {
  const { data: session, status } = useSession()
  
  if (status === 'loading') return <div>Loading...</div>
  if (!session) return <LoginPrompt />
  
  const generateImage = async () => {
    // 检查Credits
    if (session.user.credits < 16) {
      return alert('Credits不足，请充值')
    }
    
    const response = await fetch('/api/flux-kontext', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ prompt, action: 'text-to-image-pro' })
    })
  }
}
```

### 模式3：混合模式（灵活）
```typescript
// 免费用户：每日限额 + IP限制
// 登录用户：Credits系统
// 付费用户：更高限额

export function FluxKontextGenerator() {
  const { data: session } = useSession()
  
  const generateImage = async () => {
    if (!session) {
      // 免费用户限制
      const dailyUsage = localStorage.getItem('daily_usage')
      if (dailyUsage && parseInt(dailyUsage) >= 3) {
        return <LoginPrompt message="免费用户每日限制3次，登录获得更多" />
      }
    }
    
    // 继续生成逻辑...
  }
}
```

## 🛡️ 防刷策略

### 1. IP限制（基础防护）
```typescript
// middleware.ts 中实现
const rateLimitMap = new Map<string, { count: number; lastReset: number }>()

function rateLimit(ip: string, limit: number = 10, windowMs: number = 60000): boolean {
  const now = Date.now()
  const windowStart = now - windowMs
  
  const record = rateLimitMap.get(ip)
  
  if (!record || record.lastReset < windowStart) {
    rateLimitMap.set(ip, { count: 1, lastReset: now })
    return true
  }
  
  if (record.count >= limit) {
    return false
  }
  
  record.count++
  return true
}
```

### 2. Turnstile人机验证
```typescript
// 已集成Cloudflare Turnstile
// 每次生成都需要通过人机验证
// 有效防止机器人刷量
```

### 3. Credits系统
```typescript
// 用户注册送100 Credits
// Pro模型消耗16 Credits
// Max模型消耗32 Credits
// 用完需要充值或等待每日重置
```

## 📊 推荐配置方案

### 🎯 方案A：渐进式收费（推荐）

```typescript
// 1. 免费体验：每日3次，无需登录
// 2. 注册用户：100 Credits，支持充值
// 3. 付费用户：更高限额，API访问

const USAGE_LIMITS = {
  anonymous: { daily: 3, requires_turnstile: true },
  free_user: { credits: 100, daily_reset: 10 },
  pro_user: { credits: 1000, api_access: true },
  enterprise: { unlimited: true, priority_queue: true }
}
```

### 🎯 方案B：完全免费（高风险）

```typescript
// 只依赖Turnstile + IP限制
// 适合初期推广，但成本不可控
// 需要密切监控使用量

const RATE_LIMITS = {
  per_ip: { requests: 10, window: '1h' },
  per_session: { requests: 5, window: '1h' },
  global: { requests: 1000, window: '1h' }
}
```

### 🎯 方案C：强制登录（最安全）

```typescript
// 所有功能都需要登录
// 完全基于Credits系统
// 最好的成本控制

const AUTH_REQUIRED = {
  generate: true,
  edit: true,
  api_access: true,
  download: false // 下载可以免费
}
```

## 🔧 实施建议

### 阶段1：当前状态优化
1. **保持免登录**，但加强防护
2. **启用Turnstile**，防止机器人
3. **IP限制**：每IP每小时最多10次
4. **添加登录入口**，为后续收费做准备

### 阶段2：引入Credits系统
1. **免费用户**：每日3次免费生成
2. **注册用户**：赠送100 Credits
3. **显示Credits消耗**，培养用户习惯
4. **充值功能**：Stripe/支付宝集成

### 阶段3：API商业化
1. **API密钥系统**：付费用户可申请
2. **使用统计**：详细的API调用记录
3. **分层定价**：个人版/企业版
4. **技术支持**：付费用户优先

## 💡 最佳实践

### 用户体验
- ✅ **渐进式引导**：先体验，再注册，最后付费
- ✅ **透明定价**：清楚显示Credits消耗
- ✅ **多种登录**：Google/GitHub/邮箱
- ✅ **记住选择**：保存用户偏好设置

### 安全防护
- ✅ **多层防护**：Turnstile + IP限制 + Credits
- ✅ **监控告警**：异常使用量及时通知
- ✅ **数据备份**：定期备份用户数据
- ✅ **隐私保护**：遵循GDPR等法规

### 成本控制
- ✅ **实时监控**：API调用量和成本
- ✅ **预算告警**：超出预算自动暂停
- ✅ **用户分层**：不同用户不同限制
- ✅ **缓存策略**：相同请求返回缓存结果

## 🚀 快速部署

```bash
# 1. 配置环境变量
cp env.example .env.local
# 编辑 .env.local，填入Supabase和OAuth配置

# 2. 初始化数据库
npm run setup:supabase

# 3. 启动开发服务器
npm run dev

# 4. 测试认证功能
# 访问 /api/auth/signin 测试登录
# 访问 /generate 测试生成功能
```

这样的配置既保证了用户体验，又能有效控制成本和防止滥用。你觉得哪种方案最适合你的需求？ 