# Phase 6 Auth Audit

> 生成时间：2026-09-24 · 基于当前代码现状，非理想设计。

---

## 1. Auth 实现位置

| 文件 | 作用 |
|---|---|
| `src/lib/auth.ts` | NextAuth 配置（providers / callbacks / cookies） |
| `src/lib/services/user.ts` | User CRUD（通过 prisma 适配器） |
| `src/lib/db/repositories/user.ts` | 底层 User Repository |
| `src/types/next-auth.d.ts` | Session / JWT / User 类型扩展 |
| `src/lib/types/user.ts` | 业务层 User 接口（较旧，与 DB 类型不一致） |

---

## 2. 注册流程

**OAuth (Google/GitHub)**
1. 用户点击登录 → NextAuth 处理 OAuth 回调
2. `signIn callback` 查询 users 表（按 email）
3. 不存在 → `INSERT` 新用户（100 积分）+ `credit_transactions` 记录
4. 存在 → 更新 `last_signin_at` / `signin_count`

**Credentials (Email/Password)**
1. 用户提交 email + password
2. `authorize()` → Supabase Auth `signInWithPassword`
3. 验证通过 → 返回 `{ id, email, name }`
4. `signIn callback` 同样会创建/更新 users 表记录

**问题**：新用户注册时写 `credit_transactions.type = 'gift'`，违反 CHECK 约束（只允许 purchase/usage/refund/bonus）。→ **Bug B-6**

---

## 3. 登录流程

- OAuth → NextAuth 标准流程
- Credentials → Supabase Auth `signInWithPassword`
- **开发环境 backdoor**（B-20）：`test@example.com` / `password`，仅在 `NODE_ENV === 'development'` 时生效

---

## 4. Session 获取流程

```
API Route → getServerSession(authOptions) → session.user.email
```

**关键问题**：
- `session callback` 直接 `return session`，**没有注入 `user.id`**
- `jwt callback` 把 user 存入 token，但 session 里没有提取
- 大量 API 路由通过 `session.user.email` 查询用户 → 需要二次查询
- `next-auth.d.ts` 声明了 `session.user.id` 和 `session.user.uuid`，但实际 session 中不存在

---

## 5. User 数据结构

### 数据库（`users` 表）

| 列 | 说明 |
|---|---|
| `id` | UUID PRIMARY KEY |
| `email` | UNIQUE |
| `name` | 显示名 |
| `image` | 头像 URL |
| `credits` | 积分余额 |
| `signin_type` | oauth / credentials |
| `signin_provider` | google / github / credentials |
| `signin_openid` | providerAccountId |
| `signin_ip` | 登录 IP |
| `signin_count` | 登录次数 |
| `last_signin_at` | 最后登录时间 |
| `location` | 地理位置 |
| `preferred_currency` | 偏好货币 |
| `preferred_payment_provider` | 偏好支付渠道 |

### 缺失字段

- **无 `password`** — 密码由 Supabase Auth 管理，users 表不存（正确）
- **无 `role`** — 没有用户角色区分
- **无 `email_verified_at`** — 依赖 Supabase Auth 的 `email_confirmed_at`

---

## 6. User ID 获取

当前模式：
```ts
const session = await getServerSession(authOptions)
const user = await prisma.user.findUnique({ where: { email: session.user.email } })
// user.id 才是真正的 UUID
```

问题：
- 每个 API 都多一次 DB 查询
- email 不是稳定主键（理论上可变更）

---

## 7. Role 当前处理

**当前完全没有 role 机制。**

Admin 判断方式（`src/app/api/admin/*`）：
```ts
const adminEmails = process.env.ADMIN_EMAILS?.split(',') || []
if (!adminEmails.includes(session.user.email)) { ... }
```

- 通过环境变量硬编码邮箱列表
- 无数据库层面的 role 字段
- 无权限矩阵

---

## 8. 已发现 Bug

| ID | 问题 | 位置 | 严重度 |
|---|---|---|---|
| B-6 | `credit_transactions.type='gift'` 违反 CHECK | `src/lib/auth.ts:285` | 🔴 高 |
| B-20 | 开发环境 backdoor 账户 | `src/lib/auth.ts:87-95` | 🟡 中（仅 dev） |
| — | Session 未注入 user.id | `src/lib/auth.ts:351-353` | 🟡 中 |
| — | API 普遍通过 email 而非 id 查用户 | 多处 | 🟡 中 |
| — | 无 role 字段 | — | 🟡 中（阻塞 Admin） |
| — | admin 通过 env 硬编码邮箱 | `src/app/api/admin/*` | 🟡 中 |

---

## 9. 与后续 Admin 的兼容性

当前状态：**不兼容**

Admin 需要：
- 可靠的 `user.id` 传递
- `role` 字段（至少 `user` / `admin`）
- 不依赖 email 作为权限判断依据

---

## 10. 不应在本阶段处理

- 不删除 `signin_*` 字段（仍被 auth.ts / user-test / ensure 路由使用）
- 不大规模重构所有 API 的 email → id 查询
- 不删除 Flux 业务路由（Phase 8）
- 不实现完整 RBAC
- 不删除 OAuth Provider（Google/GitHub）
- 不重新设计 Auth 架构
