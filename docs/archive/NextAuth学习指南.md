# 🚀 NextAuth 从零到精通学习指南

## 🎯 为什么要学 NextAuth？

### **现实场景对比**

**场景：你有一个网站，10个页面需要登录才能访问**

#### **用 Supabase Auth（痛苦）**：
```javascript
// 😫 每个页面都要写这些代码（复制粘贴10次）
const [user, setUser] = useState(null)
const [loading, setLoading] = useState(true)

useEffect(() => {
  checkUser()
}, [])

const checkUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // 😫 手动记录用户想去的页面
    localStorage.setItem('redirectTo', window.location.pathname)
    router.push('/login')
  } else {
    setUser(user)
  }
  setLoading(false)
}

if (loading) return <div>Loading...</div>  // 😫 每次都闪烁
if (!user) return null
```

#### **用 NextAuth（爽）**：
```javascript
// 🎉 一行代码搞定（写一次，用10次）
const { data: session } = useSession({ required: true })
// 自动检查登录、自动跳转、自动回来、无闪烁
```

## 📚 第1课：NextAuth 核心概念

### **NextAuth 是什么？**
- 🏠 **不是服务** - 是一个代码库，安装在你的项目里
- 🤖 **自动化管家** - 自动处理登录、登出、会话管理
- 🔌 **插件系统** - 支持各种登录方式（Google、GitHub、邮箱等）

### **核心文件结构**
```
src/
├── app/
│   ├── api/auth/[...nextauth]/route.ts  ← NextAuth 配置文件
│   └── login/page.tsx                   ← 登录页面
├── components/
│   └── LoginButton.tsx                  ← 登录按钮组件
└── middleware.ts                        ← 页面保护中间件
```

## 📚 第2课：基础配置（10分钟搞定）

### **步骤1：安装 NextAuth**
```bash
npm install next-auth
```

### **步骤2：创建配置文件**
```typescript
// src/app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"

const handler = NextAuth({
  providers: [
    // 邮箱密码登录
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // 这里连接你的 Supabase
        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        })
        
        if (data.user) {
          return { id: data.user.id, email: data.user.email }
        }
        return null
      }
    })
  ],
  pages: {
    signIn: '/login',  // 自定义登录页面
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      // 🎉 自动跳转逻辑 - 登录后回到原页面
      return url.startsWith(baseUrl) ? url : baseUrl
    }
  }
})

export { handler as GET, handler as POST }
```

### **步骤3：创建登录页面**
```typescript
// src/app/login/page.tsx
"use client"
import { signIn } from "next-auth/react"
import { useState } from "react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const handleLogin = async () => {
    await signIn("credentials", { email, password })
    // 🎉 登录成功后自动跳转到用户想去的页面
  }

  return (
    <div>
      <input 
        type="email" 
        value={email} 
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email" 
      />
      <input 
        type="password" 
        value={password} 
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password" 
      />
      <button onClick={handleLogin}>Login</button>
    </div>
  )
}
```

## 📚 第3课：页面保护（1行代码）

### **保护单个页面**
```typescript
// src/app/dashboard/page.tsx
"use client"
import { useSession } from "next-auth/react"

export default function DashboardPage() {
  const { data: session } = useSession({ required: true })
  // 🎉 就这一行！自动检查登录状态
  // 未登录 → 自动跳转到 /login
  // 登录后 → 自动跳回这个页面

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session?.user?.email}</p>
    </div>
  )
}
```

### **保护多个页面（中间件）**
```typescript
// middleware.ts
import { withAuth } from "next-auth/middleware"

export default withAuth({
  pages: {
    signIn: "/login",
  },
})

export const config = {
  // 🎉 这些路径都需要登录
  matcher: ["/dashboard/:path*", "/profile/:path*", "/settings/:path*"]
}
```

## 📚 第4课：实际使用场景

### **场景1：用户信息显示**
```typescript
// 任何组件中都可以获取用户信息
import { useSession } from "next-auth/react"

function UserProfile() {
  const { data: session, status } = useSession()

  if (status === "loading") return <p>Loading...</p>
  if (status === "unauthenticated") return <p>Not logged in</p>

  return <p>Welcome {session.user.email}!</p>
}
```

### **场景2：登录/登出按钮**
```typescript
import { useSession, signIn, signOut } from "next-auth/react"

function LoginButton() {
  const { data: session } = useSession()

  if (session) {
    return (
      <button onClick={() => signOut()}>
        Sign out {session.user.email}
      </button>
    )
  }
  return <button onClick={() => signIn()}>Sign in</button>
}
```

### **场景3：API 路由保护**
```typescript
// src/app/api/protected/route.ts
import { getServerSession } from "next-auth"

export async function GET() {
  const session = await getServerSession()
  
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  
  return Response.json({ message: "Protected data" })
}
```

## 🎯 第5课：高级功能

### **添加 Google 登录**
```typescript
// 在 NextAuth 配置中添加
import GoogleProvider from "next-auth/providers/google"

providers: [
  GoogleProvider({
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  }),
  // ... 其他登录方式
]
```

### **自定义登录后逻辑**
```typescript
callbacks: {
  async signIn({ user, account }) {
    // 🎉 登录成功后自动执行
    console.log(`${user.email} logged in via ${account.provider}`)
    
    // 可以在这里：
    // - 更新用户最后登录时间
    // - 记录登录日志
    // - 检查用户权限
    // - 发送欢迎邮件
    
    return true
  },
  
  async redirect({ url, baseUrl }) {
    // 🎉 自定义跳转逻辑
    if (url.startsWith("/admin")) {
      return baseUrl + "/admin/dashboard"
    }
    return url.startsWith(baseUrl) ? url : baseUrl
  }
}
```

## 🏆 学习成果检验

### **学会 NextAuth 后，你能做到**：

1. ✅ **1行代码保护页面** - `useSession({ required: true })`
2. ✅ **自动跳转** - 登录后自动回到原页面
3. ✅ **无闪烁体验** - 不会出现 loading 闪烁
4. ✅ **统一会话管理** - 所有页面共享登录状态
5. ✅ **多种登录方式** - 邮箱、Google、GitHub 等
6. ✅ **API 保护** - 保护后端接口
7. ✅ **自定义逻辑** - 登录前后执行自定义代码

### **对比学习成本**：

| 方案 | 学习时间 | 代码量 | 维护成本 |
|------|----------|--------|----------|
| **Supabase Auth** | 1小时 | 多（重复） | 高 |
| **NextAuth** | 2小时 | 少（复用） | 低 |

**结论**：多花1小时学习，节省无数小时维护！

## 🎯 下一步行动

1. **先理解概念** - 看完这个指南
2. **动手实践** - 在项目中配置 NextAuth
3. **逐步替换** - 把现有的 Supabase Auth 页面逐个替换
4. **享受便利** - 体验1行代码保护页面的爽感

**NextAuth 确实是 Next.js 项目的必经之路！** 🚀 