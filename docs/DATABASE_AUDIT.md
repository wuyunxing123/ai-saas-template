# DATABASE_AUDIT.md — 数据库现状审计（Phase 3）

> 只读审计。所有结论均以**当前代码实际内容**为准重新核对，未沿用 Phase 1 结论。
> 审计时间：2026-09-23 ｜ 基线 commit：`2` ｜ tag：`phase-3-before-database-refactor`

---

## 0. 审计方法

执行的搜索与追踪（全部在 `src/` 内实际执行）：

| 模式 | 命中 |
|---|---|
| `createClient` / `createServerClient` / `createAdminClient` / `@supabase/` | 42 处 |
| `.from('...')` | **51 处**（12 个文件） |
| `.rpc(` | 1 处 |
| `prisma` / `drizzle` / `typeorm` / `sequelize` / `knex` / `pg` | **0 处（无 ORM）** |
| `*.sql` 文件 | 1 个（`scripts/setup-database.sql`） |
| `migrations/` `supabase/` `sql/` `src/server/` 目录 | **均不存在** |

按文件统计 `.from()` 命中：

```
src/app/api/debug/*              7 处   （调试路由）
src/app/api/payments/create-checkout  4 处
src/app/api/user/credits         4 处
src/app/api/user/credits/consume 4 处
src/app/api/user/ensure          3 处
src/lib/auth.ts                  4 处
src/lib/database.ts             15 处   （伪 Prisma 适配器）
src/lib/payment-security.ts      3 处
```

按表统计：

| 表 | 出现次数 | 备注 |
|---|---|---|
| `users` | 29 | |
| `orders` | 8 | **全部在 `database.ts` 适配器内** |
| `credit_transactions` | 6 | |
| `payment_orders` | 5 | `create-checkout` ×3、`payment-security` ×2 |
| `generations` | **0** | 从未被读写 |
| `payment_configs` | **0** | 从未被读写 |

---

## 1. 当前数据库架构

```
Supabase PostgreSQL（托管）
    │
    ├── Auth:  Supabase Auth（仅 credentials 模式用 signInWithPassword）
    │          + NextAuth v4（session / cookie / provider 编排）
    │
    └── 业务数据: 6 张表（全部由 scripts/setup-database.sql 手工创建）

访问层（当前 3 套并存）
    ├── ① src/lib/supabase/server.ts
    │      createClient()      ← cookie + anon key（服务端组件用）
    │      createAdminClient() ← service_role（绕过 RLS）
    ├── ② src/lib/supabase/client.ts
    │      createClient()      ← 浏览器端，且导出一个 supabase 单例
    └── ③ 直接 new @supabase/supabase-js
           src/lib/auth.ts:99            ← service_role，用于密码登录
           src/components/SignUpContent.tsx:50 ← 浏览器端，直连
           src/app/api/debug/simple-test/route.ts:34 ← 内联 createServerClient

数据访问方式（当前 3 套并存）
    ├── A. 伪 Prisma 适配器  src/lib/database.ts（793 行，导出 `prisma`）
    │      真实实现：user、paymentOrder
    │      Mock：creditTransaction、subscription、paymentConfig
    ├── B. 各路由直接 createAdminClient().from(...)  ← 51 处中的 36 处
    └── C. 未使用的 services（order.ts 等）
```

---

## 2. 当前数据库表

来源：`scripts/setup-database.sql`（唯一 schema 定义，未版本化）

| # | 表 | 建表行 | 用途 |
|---|---|---|---|
| 1 | `users` | :8 | 用户 + 积分余额（`credits` 列）+ 7 个第三方登录遗留字段 |
| 2 | `payment_orders` | :28 | 订单（含 provider 专属列） |
| 3 | `credit_transactions` | :51 | 积分流水 |
| 4 | `subscriptions` | :64 | 订阅 |
| 5 | `payment_configs` | :80 | 支付开关配置（单行） |
| 6 | `generations` | :93 | 图像生成历史 |

**代码里出现但 SQL 中不存在的表**：`orders`（8 处引用，全部在 `database.ts`）。

### 2.1 RLS

已为 5 张表开启 RLS 并写了「用户只能看自己数据」策略。
但服务端**全部使用 service_role key**（`createAdminClient`），service_role **绕过 RLS**。
→ RLS 在当前架构下不起作用，只是安全兜底。

### 2.2 触发器

5 张表各有 `update_updated_at` 触发器（自动维护 `updated_at`）。
注意：`generations` 表**没有** `updated_at` 列，也没有触发器。

---

## 3. 当前数据访问方式

### 3.1 方式 A：伪 Prisma 适配器（`src/lib/database.ts`）

导出一个名为 `prisma` 的对象，但**不是 Prisma**。按模型分：

| 模型 | 状态 | 证据 |
|---|---|---|
| `user` | ✅ 真实实现 | `from('users')` 读写 |
| `paymentOrder` | ⚠️ 真实实现但**表名错误** | `from('orders')`，该表不存在 |
| `creditTransaction` | ❌ **Mock** | `findMany()` → `return []`；`create()` → `Math.random()` |
| `subscription` | ❌ **Mock** | `findFirst()` 返回硬编码 `pro-plan`；`create()` → `Math.random()` |
| `paymentConfig` | ❌ **Mock** | `findFirst()` 返回硬编码对象 |
| `paymentOrder.groupBy` | ❌ **伪造数据** | 返回写死的 `_count: { id: 120 }` |
| `paymentOrder.aggregate` | ❌ **伪造数据** | 返回写死的 `_sum: { amount: 15750 }` |

### 3.2 方式 B：路由直连 Supabase

36 处 `.from()` 分散在 11 个路由/库文件中，业务代码直接拼查询。
典型重复：**「按 email 查用户」这一件事在 7 个文件里各写了一遍**
（`database.ts`、`auth.ts`、`user/credits`、`user/credits/consume`、`user/ensure`、`create-checkout`、`payment-security`）。

### 3.3 方式 C：未使用的 service 层

| 文件 | 行数 | 外部引用 |
|---|---|---|
| `src/lib/services/order.ts` | 426 | **0 处（完全死代码）** |
| `src/lib/services/pricing.ts` | 363 | 2 处 |
| `src/lib/services/payment-database.ts` | 265 | 3 处 |
| `src/lib/services/payment-config.ts` | 272 | 1 处（admin 路由） |
| `src/lib/services/affiliate.ts` | 163 | 1 处 |
| `src/lib/tasks/order-cleanup.ts` | — | 1 处 |

`services/order.ts` 走的是伪 Prisma 的 `paymentOrder`，而该模型查的是不存在的 `orders` 表 →
即使被调用也必然失败。它实际上是**为另一个模板写的、从未接线的代码**。

---

## 4. 每张核心表的用途

| 表 | 领域 | 谁创建 | 谁查询 | 谁更新 |
|---|---|---|---|---|
| `users` | 身份 + 余额 | `auth.ts:266`（OAuth 首次登录）、`user/ensure`、`user/credits`（自动建号） | 7 个文件 | `auth.ts:308`（登录计数）、`database.ts:256` |
| `payment_orders` | 订单 | `create-checkout:208` | `payment-security:287/326` | `create-checkout:272/291` |
| `credit_transactions` | 积分流水 | `auth.ts:280`、`user/credits:79`、`user/credits/consume:100` | `user/credits:155` | — |
| `subscriptions` | 订阅 | 仅 mock | 仅 mock | 仅 mock |
| `payment_configs` | 支付开关 | 从未 | 从未 | 从未 |
| `generations` | 生成历史 | 从未 | 从未 | 从未 |
| `orders` | — | 仅 `database.ts`（不存在） | 仅 `database.ts` | 仅 `database.ts` |

---

## 5. 哪些是真正持久化

✅ **真实落库**：
- `users`（含 `credits` 余额）—— 唯一一个读写都真实的表
- `payment_orders` —— 写入真实（`create-checkout`），但**没有任何代码读取它来做业务**（只有 `payment-security` 读它做风控）
- `credit_transactions` —— **部分真实**：3 处直连写入是真实的；但走 `prisma.creditTransaction.create()` 的 2 处是 mock

❌ **不持久化**：
- `subscriptions` —— 全部经 mock，写不进库
- `payment_configs` —— 全部经 mock
- `credit_transactions` 经由伪 Prisma 的写入（`payment.ts:457`、`creem.ts:441`）
- 生成历史 —— 没有任何代码写入 `generations`

---

## 6. 哪些仍然是 Mock / Memory / Config

| 位置 | 形式 | 影响 |
|---|---|---|
| `database.ts:616-673` `paymentConfig` | Mock 对象 | 支付开关读的是假数据；真实开关在 `src/lib/config/payment.ts`（硬编码）+ env，共三处真相 |
| `database.ts:675-716` `creditTransaction` | Mock | 购买积分、订阅发放的流水不落库 |
| `database.ts:718-787` `subscription` | Mock | 订阅永远无法持久化；`findFirst` 在特定条件下凭空返回 `pro-plan` |
| `database.ts:587-612` `groupBy`/`aggregate` | 伪造统计 | 若被后台使用会展示假数字 |
| `src/lib/config/payment.ts` | 硬编码常量 | `DEFAULT_PROVIDER: "creem"` 与 env 的 `stripe` 冲突 |
| `src/lib/user-tiers.ts:184 pricingPlans` | 硬编码 | 与 `content/pricing.json`、`payment-security.STANDARD_PRICING` 三处重复 |
| `src/lib/payment-security.ts` `STANDARD_PRICING` | 硬编码 | 价格校验的真相 |
| `src/app/api/debug/*`（9 个路由） | 内存/调试 | 含 `rpc('exec_sql')` —— **可执行任意 SQL，安全风险** |

---

## 7. 哪些表重复

**`orders` 与 `payment_orders` 是同一业务概念的两套名字。**

证据：

1. `database.ts` 的 `PaymentOrder` 接口字段与 `payment_orders` 的列**一一对应**：
   `userId↔user_id`、`orderNumber↔order_number`、`paymentProvider↔payment_provider`、
   `productType↔product_type`、`stripeSessionId↔stripe_session_id`、`creemCheckoutId↔creem_checkout_id` …
2. 两者都表示「用户为某个产品下的一笔订单」，都有 `status` / `amount` / `currency` / `paid_at`。
3. `orders` 在 SQL 中根本不存在 → 它只是**适配器里写错的表名**，不是另一个业务概念。

**结论**：不是「业务订单 vs 支付渠道交易」，而是**同一个概念被写成了两个名字**。

---

## 8. 哪些表职责重叠

| 表 | 重叠对象 | 说明 |
|---|---|---|
| `payment_orders` | `orders` | 见 §7 |
| `payment_configs` | `src/lib/config/payment.ts` + env | 三处支付开关配置，职责重叠 |
| `generations` | 无（但无替代） | 表建了却没有任何代码使用 |

---

## 9. 哪些地方直接操作数据库

### 9.1 高风险（业务路由里直接拼 SQL 语义）

| 文件 | `.from()` 数 | 问题 |
|---|---|---|
| `src/app/api/user/credits/route.ts` | 4 | 含自动建号 + 赠积分 + 查流水 |
| `src/app/api/user/credits/consume/route.ts` | 4 | 与主链路重复的独立扣积分入口 |
| `src/app/api/user/ensure/route.ts` | 3 | 与 `auth.ts` 重复的建号逻辑 |
| `src/app/api/payments/create-checkout/route.ts` | 4 | 下单 + 改单 |
| `src/lib/payment-security.ts` | 3 | 风控查询 |
| `src/lib/auth.ts` | 4 | 登录时建号 + 赠积分 |

### 9.2 「按 email 查用户」重复 7 次

同一个查询 `from('users').select('*').eq('email', X).single()` 出现在：
`database.ts:102/157`、`auth.ts:236`、`user/credits:25`、`user/credits/consume:39`、
`user/ensure:26`、`create-checkout:51`、`payment-security:513`。

### 9.3 危险的调试能力

`src/app/api/debug/database-check/route.ts:145` 调用 `supabase.rpc('exec_sql', ...)`。
即使 `ENABLE_DEBUG_ROUTES=false` 会屏蔽，这条路径依然存在，且依赖数据库端存在一个可执行任意 SQL 的函数。

---

## 10. 哪些地方存在重复 SQL / 查询逻辑

| 重复项 | 出现位置 | 次数 |
|---|---|---|
| 按 email 查用户 | 见 §9.2 | 7 |
| 建号 + 送 100 积分 + 写 `type='gift'` 流水 | `auth.ts:246-293`、`user/credits:39-90`、`user/ensure:65-96` | 3 |
| 扣积分（读余额 → 判断 → update → 写流水） | `services/credits.ts:70`、`user/credits/consume:66` | 2 |
| 订单号生成 | `create-checkout:204`、`services/order.ts` | 2 |
| 积分价格表 | `flux-kontext-request.ts:18`、`services/credits.ts:214` | 2 |

---

## 11. 当前是否存在 migration

**不存在。**

- 没有 `supabase/` 目录
- 没有 `migrations/` 目录
- 没有 `sql/` 目录
- 唯一的 schema 定义是 `scripts/setup-database.sql`

---

## 12. 当前 migration 是否可靠

`scripts/setup-database.sql` 作为「migration」的可靠性评估：

| 检查项 | 结果 |
|---|---|
| 幂等（可重复执行） | ⚠️ 部分。`CREATE TABLE IF NOT EXISTS` 幂等，但 `CREATE TRIGGER` **不幂等** —— 第二次执行会报 `trigger already exists`；`CREATE POLICY` 同样不幂等 |
| 版本化 | ❌ 单文件，无版本号，无法知道线上处于哪个版本 |
| 回滚 | ❌ 无 |
| 可重建新环境 | ⚠️ 首次可，重跑不可 |
| schema drift 检测 | ❌ 无 |
| 与代码一致 | ❌ **不一致**：SQL 有 `payment_orders`，代码（适配器）用 `orders`；SQL 的 `credit_transactions.type` CHECK 不允许代码实际写入的 `'gift'`；SQL 的 `users` 有 `image` 而 `src/types/supabase.ts` 写的是 `avatar` |
| 与 TS 类型一致 | ❌ `src/types/supabase.ts` 是手写的、与 SQL 三处不一致，且**全项目 0 引用（死代码）** |

### 12.1 字段级不一致清单

| 不一致 | SQL | 代码 |
|---|---|---|
| 订单表名 | `payment_orders` | `orders`（`database.ts`） |
| 订单 metadata 列 | `metadata` | `payment_details`（`database.ts:429/464`） |
| 订单必填列 | `product_id` / `product_name` / `customer_email` NOT NULL | 适配器 `create()` 完全不写这三列 |
| 积分类型 | CHECK 允许 `purchase/usage/refund/bonus` | 代码写入 `'gift'`（`auth.ts:285`、`user/credits:84`） |
| 用户头像列 | `image` | `avatar`（`src/types/supabase.ts`） |
| 生成历史 | 表存在 | 无任何代码读写 |
| 支付配置 | 表存在 | 无任何代码读写；真实配置在 `config/payment.ts` + env |

---

## 13. 当前数据库访问是否存在两套甚至多套方式

**是，存在 3 套客户端创建方式 + 3 套数据访问方式**（见 §1）。

其中最危险的是「两套订单真相」：`create-checkout` 写 `payment_orders`，
而 webhook 处理链（`payment.ts:344`、`creem.ts:293`）通过适配器读 `orders`。
→ **用户支付成功后，系统找不到订单，积分与订阅都发不出去。**

---

## 14. 对未来 Credit / Payment / Subscription / AI Task 的影响

| 领域 | 当前阻碍 | Phase 3 需要提供 |
|---|---|---|
| **Credit** | 流水不落库（mock）；无幂等键；`type` CHECK 拒绝 `gift`；余额只有 `users.credits` 一列，无 `balance_before/after`，无法对账 | 可靠持久化的流水表 + 幂等约束 + 余额变更可追溯 |
| **Payment** | 订单表双轨；provider 专属列写死；`payment_configs` 是假配置 | 统一订单表 + provider 引用通用化 + 明确配置分层 |
| **Subscription** | 完全 mock，无法持久化 | 正式表 + Repository（本阶段不实现支付逻辑） |
| **AI Task** | 无任何承载（`generations` 从未使用）；Phase 2 的 `AIService` 已有 `taskId` 概念但无处落库 | 最小可用的 `ai_tasks` 表 + Repository |
| **Storage（§16）** | **没有任何数据库字段保存 R2 URL / object key**。`r2_url` 只存在于 API 响应；主 `url` 用的是 fal 的**临时链接**，等于把外部临时 URL 当永久资源 | 本阶段只记录发现，不做 StorageService |

---

## 15. 审计结论摘要

必须由 Phase 3 解决的（按严重度）：

| # | 问题 | 严重度 |
|---|---|---|
| A-1 | 订单表双轨 → 支付成功但订单查不到 | 🔴 |
| A-2 | `credit_transactions` 流水经伪 Prisma 时不落库 | 🔴 |
| A-3 | `subscriptions` 完全 mock，无法持久化 | 🔴 |
| A-4 | 无 migration 体系，schema 无法演进/回滚 | 🔴 |
| A-5 | `credit_transactions.type` CHECK 与代码写入值冲突 | 🔴 |
| A-6 | 适配器写 `payment_details` 列（不存在）+ 漏写 NOT NULL 列 | 🔴 |
| A-7 | 3 套客户端 + 3 套访问方式 | 🟡 |
| A-8 | 「按 email 查用户」重复 7 次 | 🟡 |
| A-9 | `payment_configs` 假配置 + 支付开关三处真相 | 🟡 |
| A-10 | `src/types/supabase.ts` 与 schema 三处不一致且 0 引用 | 🟡 |
| A-11 | `generations` 表存在但无代码使用 | 🟡 |
| A-12 | `services/order.ts` 426 行死代码 | 🟢 |
| A-13 | 无任何存储元数据字段，把临时 provider URL 当永久资源 | 🟡 |
| A-14 | debug 路由暴露 `exec_sql`（任意 SQL 执行） | 🔴 安全 |

Phase 3 **不做**的（按用户约束）：Workflow、StorageService、Payment Provider 重构、
支付 SDK 接入、AIProvider 重写、Flux 兼容层删除、Landing/SEO/i18n/UI 重构、引入 ORM。

---

*审计结束。设计决策与迁移方案见 `docs/DATABASE.md`。*
