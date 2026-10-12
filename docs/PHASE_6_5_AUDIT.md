# Phase 6.5 Audit — Admin Foundation

> 生成时间：2026-09-25 · 基于 Phase 6 完成后的代码现状。

---

## 1. 当前 Admin authorization

**不存在统一的 `requireAdmin()`。**

仅有两个 Admin API，各自内联判断：

| 文件 | 判断方式 |
|---|---|
| `src/app/api/admin/maintenance/route.ts` | `process.env.ADMIN_EMAILS?.split(',').includes(session.user.email)` |
| `src/app/api/admin/payment-config/route.ts` | 同上 |

问题：
- 通过 email 而非 `users.role` 判断
- 每个路由重复实现
- 失败返回 `respAuthErr`（401），而不是区分 401 / 403

---

## 2. 当前 role 结构

Phase 6 已添加：

- `users.role VARCHAR DEFAULT 'user'` + `CHECK (role IN ('user','admin'))`（迁移 0007）
- `UserRow.role` / `database.ts User.role`
- `next-auth.d.ts` 的 Session/JWT 含 `role?`

**但 `role` 从未被读取用于授权** —— 是「有字段没接线」的状态。

---

## 3. 当前 Admin API

只有两个，且都属于旧功能（维护任务 / 支付配置），本阶段不改其业务逻辑，仅迁移到 `requireAdmin()`。

---

## 4. 当前 User Repository

`src/lib/db/repositories/user.ts`：

- `findById` / `findByEmail` / `create` / `update` / `touchSignin` / `remove`
- **缺失**：`listAll`（分页 + 搜索）、`count`

---

## 5. 当前 Order Repository

`src/lib/db/repositories/order.ts`：

- `listAll(options)` ✅ 支持 `limit` / `skip` / `statuses` / `createdAfter`
- `count(options)` ✅
- `findById` ✅

**可直接复用**，无需新增查询方法。

---

## 6. 当前 Credit Service / Repository

`src/lib/db/repositories/credit.ts`：

- `grantCredits()` ✅ **原子 RPC `grant_credits()`**
- `getBalance` / `listTransactions(userId, limit)` / `createTransaction`
- `adjustBalance()` ⚠️ 非原子，**不得用于 Admin 调整**

`src/lib/services/credits.ts`：

- `grantUserCredits()` ⚠️ 走 `prisma.user.update({ increment })` + `creditTransaction.create`，**非原子**
- Admin 调整必须用 **Repository 的 `grantCredits()`**（原子 RPC），不用 `grantUserCredits()`

---

## 7. 当前 Subscription Repository

`src/lib/db/repositories/subscription.ts`：

- `findById` / `findActiveByUser` / `listByUser` / `create` / `update`
- **缺失**：`listAll`（分页 + 状态过滤）、`count`

---

## 8. 当前 AI Task 数据来源

`src/lib/db/repositories/ai-task.ts` + `ai_tasks` 表（迁移 0004）：

- 表结构：`id / user_id / model / provider / status / prompt / input_metadata / output_metadata / provider_task_id / idempotency_key / credit_transaction_id / credits_used / error_code / error_message / created_at / updated_at / completed_at`
- 已有 `create` / `findById` / `listByUser` / `updateStatus`
- **缺失**：`listAll`（分页 + provider/model/status 过滤）、`count`

**结论**：AI task persistence 已存在，Admin 只需新增只读查询方法，**不需要新建表**。

---

## 9. 当前 Admin 页面

**不存在。** `src/app/admin/` 目录不存在。

---

## 10. 可以复用的已有能力

| 能力 | 位置 |
|---|---|
| Order 分页查询 + count | `order.listAll` / `order.count` |
| Credit 原子发放 | `credit.grantCredits()`（RPC） |
| Credit 流水查询 | `credit.listTransactions` |
| User 按 id/email 查 | `user.findById` / `findByEmail` |
| AI Task 按 id 查 | `aiTask.findById` |
| 统一响应格式 | `src/lib/utils/response.ts` |
| DB 客户端（service role，server-only） | `src/lib/db/client.ts` |
| Session + role | `src/lib/auth.ts` + `next-auth.d.ts` |

---

## 11. 不应该重复实现的能力

- ❌ 不新建 Admin 身份表（`admins` / `admin_users`）→ 用 `users.role`
- ❌ 不重新实现订单/支付/webhook/fulfillment → 复用 Phase 4
- ❌ 不重新实现 credit 扣减/发放 → 复用 `credit.grantCredits()` RPC
- ❌ 不自己解析 cookie / JWT → 用 `getServerSession`
- ❌ 不在 Admin 页面直接访问数据库 → 只调用 Admin API / Server Query Service
- ❌ 不实现 RBAC / permission matrix / organization / team
- ❌ 不实现 Dashboard 大屏 / 图表

---

## 12. 本阶段架构决定

1. **Authorization**：新增 `src/lib/admin/authorization.ts` 的 `requireAdmin()`，
   以 `users.role === 'admin'` 为唯一依据。
2. **ADMIN_EMAILS**：降级为 bootstrap 白名单 —— 管理员访问 Admin 时，
   若 email 命中白名单则自动把 `users.role` 提升为 `admin`，之后一律走 role 判断。
3. **Audit**：新增 `admin_audit_logs` 表 + Repository（迁移 0008）。
4. **Admin Service**：新增 `src/lib/admin/service.ts`，负责授权后的查询聚合与
   credit 调整编排（校验 → `credit.grantCredits()` → audit）。
5. **分页**：统一 20 / page，`page` query 参数，`created_at DESC`。
