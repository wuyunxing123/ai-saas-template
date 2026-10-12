# ADMIN.md — Admin 基础设施

> Phase 6.5 产物。第一版 Admin Console：最小但可用。

---

## 1. Admin Architecture

```
                    Auth (NextAuth)
                          ↓
                       user.id
                          ↓
                    getAdminContext()          ← 唯一权限边界
                          ↓
                  users.role === 'admin'
                          ↓
        ┌─────────────────┴─────────────────┐
        ↓                                   ↓
  Admin API (/api/admin/*)          Admin Pages (/admin/*)
        ↓                                   ↓
   AdminService                      AdminService（Server Query Service）
        ↓                                   ↓
  ┌─────┴─────┬──────────┬──────────┐      │
  ↓           ↓          ↓          ↓      │
UserRepo  OrderRepo  CreditRepo  AuditRepo ←┘
  └───────────┴──────────┴──────────┘
                 ↓
              Database
```

**边界规则**：
- Admin 页面**不直接**访问数据库（无 `supabase.from` / `prisma.` / `createAdminClient`）
- Admin API 统一经过 `withAdmin()` 包装
- 敏感操作（积分调整）走 Domain 层原子 RPC，不自己算余额

---

## 2. Authentication

沿用 NextAuth（Phase 6 已注入 `session.user.id`）。

- 未登录访问 `/admin/*` → `redirect('/auth/signin?callbackUrl=/admin')`
- 未登录访问 `/api/admin/*` → **401**
- 已登录但非 admin → 页面渲染 403 / API 返回 **403**

---

## 3. Authorization

唯一入口：`src/lib/admin/authorization.ts`

```ts
const auth = await getAdminContext()
// { ok: true, user } | { ok: false, status: 401 | 403, error }

// 或在 Server Component 中抛异常
const admin = await requireAdmin()
```

**权限唯一依据**：server-side 查询的 `users.role === 'admin'`。

**绝不使用**：`request.body.role` / `request.body.userId` / 客户端 `isAdmin`。

---

## 4. Role

`users.role VARCHAR DEFAULT 'user' CHECK (role IN ('user','admin'))`（迁移 0007）。

- 只有 `user` / `admin` 两个值
- 不实现 super_admin / operator / support / analyst
- 不实现 RBAC / permission matrix

---

## 5. Admin routes

### 页面

| 路径 | 说明 |
|---|---|
| `/admin` | Overview（简单计数） |
| `/admin/users` | 用户列表（搜索 / 分页） |
| `/admin/users/[id]` | 用户详情 + 积分发放 |
| `/admin/orders` | 订单列表（状态 / 渠道过滤） |
| `/admin/orders/[id]` | 订单详情 |
| `/admin/credits` | 积分流水（只读，可按用户 email 搜索） |
| `/admin/subscriptions` | 订阅列表（只读，可按用户 email 搜索） |
| `/admin/ai-tasks` | AI 任务列表（只读） |
| `/admin/audit-logs` | Admin 操作审计日志（只读） |

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/me` | 当前 Admin 身份 |
| GET | `/api/admin/users` | 用户列表 |
| GET | `/api/admin/users/[id]` | 用户详情聚合 |
| POST | `/api/admin/users/[id]/credits` | 发放积分（唯一写操作） |
| GET | `/api/admin/orders` | 订单列表 |
| GET | `/api/admin/orders/[id]` | 订单详情 |
| GET | `/api/admin/credits` | 流水列表 |
| GET | `/api/admin/subscriptions` | 订阅列表 |
| GET | `/api/admin/subscriptions/[id]` | 订阅详情 |
| GET | `/api/admin/ai-tasks` | AI 任务列表 |
| GET | `/api/admin/ai-tasks/[id]` | AI 任务详情 |
| GET | `/api/admin/audit-logs` | 审计日志列表 |
| GET/POST | `/api/admin/maintenance` | 旧路由（已迁移到 role 鉴权） |
| GET/POST | `/api/admin/payment-config` | 旧路由（已迁移到 role 鉴权） |

---

## 6. Users

- 列表：email / role / credits / created_at / last_sign_in
- 搜索：email 或 name（`ilike` 包含匹配）
- 分页：默认 20 / page，最大 100
- 详情：Basic Info + Credits + Orders + Subscriptions + AI Tasks + Audit Logs

---

## 7. Orders

复用 Phase 4 的 `orders` 表（**不** reintroduce `payment_orders`）。

- 列表字段：order number / user / amount / status / provider / provider session id / created / paid
- 过滤：status、provider
- **搜索**：`search` 参数匹配 `customer_email` 或 `order_number`（`ilike` 模糊）
- 详情：完整字段 + 关联用户 + 关联积分流水
- **只读**。不实现 checkout / webhook / fulfillment。

---

## 8. Credits

### 查询

`/admin/credits` 列出全部流水，支持：

- `search` —— 按**用户 email / name** 模糊搜索
  （流水表无 email 列 → 先 `resolveUserIdsBySearch()` 再 `user_id IN (...)`）
- `type` —— 按流水类型过滤

### 调整（唯一的 Admin 写操作）

```
POST /api/admin/users/[id]/credits
Body: { "amount": 100, "reason": "Customer support compensation" }
```

流程：

```
withAdmin（requireAdmin）
   ↓
输入校验（amount 为正整数、≤ MAX_ADMIN_CREDIT_ADJUSTMENT、reason 必填）
   ↓
确认目标用户存在（userRepo.findById）
   ↓
credit.grantCredits()  ← 原子 RPC grant_credits()
   ↓
auditRepo.create()     ← 审计日志
```

**硬性规则**：
- ✅ 必须走 `credit.grantCredits()`（原子 RPC）
- ❌ 禁止 `UPDATE users SET credits = credits + n`
- ❌ 禁止使用非原子的 `credit.adjustBalance()`
- ❌ 禁止 Admin API 自己计算 balance

`MAX_ADMIN_CREDIT_ADJUSTMENT = 1_000_000`（`src/lib/admin/service.ts`）。

---

## 9. Subscriptions

复用 Phase 4 的 `subscriptions` 表。

- 列表：user / plan / status / cycle / provider / provider sub id / period end / created
- 过滤：status、provider
- **搜索**：`search` 参数按**用户 email/name** 过滤
  （订阅表无 email 列 → 先 `resolveUserIdsBySearch()` 拿 user id 列表，
  再 `user_id IN (...)`；上限 `MAX_SEARCH_USERS = 200`；空结果显式短路）
- **只读**。不做手动续费 / 取消 / 修改。

---

## 10. AI Tasks

复用 `ai_tasks` 表（Phase 3 建立，Phase 6.5 首次接线只读查询）。

- 列表：user / model / provider / status / provider task id / credits / created / completed
- 过滤：provider、model、status
- **只读**。不重跑 / 取消 / retry（属 Workflow 阶段）。

---

## 11. Audit log

表：`admin_audit_logs`（迁移 0008）

**查看入口**：`/admin/audit-logs`（只读，分页），API 为 `GET /api/admin/audit-logs`。
用户详情页 `/admin/users/[id]` 也会展示该用户相关的最近 20 条。

| 列 | 说明 |
|---|---|
| `admin_user_id` | 操作者 |
| `action` | 操作类型（当前仅 `credit_grant`） |
| `target_user_id` | 目标用户 |
| `target_type` / `target_id` | 目标对象（可选） |
| `amount` | 数值变更 |
| `reason` | 操作原因 |
| `metadata` | 附加信息（**不放敏感数据**） |
| `created_at` | 时间 |

**不记录**：password / session token / access token / secret / 完整 request body。

---

## 12. Security rules

1. 权限判断只用 server-side `users.role`
2. 目标用户来自 URL 路径，不信任客户端 email
3. 操作者身份来自 session，不信任 body
4. Admin 页面不直接访问数据库
5. `SUPABASE_SERVICE_ROLE_KEY` 仅 server-side，绝不暴露为 `NEXT_PUBLIC_*`
6. 所有列表强制分页，禁止一次查全表
7. Credit 变动必须原子 + 有审计

---

## 13. 如何增加 Admin

### 方式 A：环境变量 bootstrap（推荐）

在 `.env.local` 中设置：

```
ADMIN_EMAILS=admin@example.com,another@example.com
```

该用户**首次访问 `/admin` 或 `/api/admin/*`** 时，`users.role` 会自动被提升为 `admin`。
之后权限判断只看 `role`，不再看 `ADMIN_EMAILS`。

### 方式 B：直接改数据库

```sql
UPDATE public.users SET role = 'admin' WHERE email = 'someone@example.com';
```

### 不做的事

本阶段**不提供**「Admin UI 修改其他用户 role」功能 —— 涉及权限提升与审计边界，
留到后续版本。

---

## 14. ADMIN_EMAILS bootstrap 机制

```
ADMIN_EMAILS (env)
      ↓  首次访问 Admin 时命中白名单
users.role = 'admin'      ← 一次性提升，写入数据库
      ↓
getAdminContext() 只读 users.role
      ↓
Admin API / Page
```

**定位**：legacy / bootstrap 机制，**不是**最终权限判断。

移除 `ADMIN_EMAILS` 后，已有 admin 仍可正常访问（因为 role 已写入数据库）。

---

## 15. 后续可扩展方向

记录在 `docs/PHASE_6_5_FOLLOWUPS.md`，主要包括：

- Admin 用户角色管理 UI（需审计 + 权限提升保护）
- Admin 审计日志独立页面
- 退款 / 订阅管理的 Domain Service
- Dashboard 图表（需明确需求）
- Admin Settings（System Configuration）
- 更细的角色（如 support / analyst）
