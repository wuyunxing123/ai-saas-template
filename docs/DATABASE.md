# DATABASE.md — 数据库设计说明

> **基准 Phase 3 · 2026-09-29 复核修正至 Phase 9.6 状态**
> 审计发现见 [`docs/DATABASE_AUDIT.md`](./DATABASE_AUDIT.md)（Phase 1 快照），
> 迁移文件见 [`supabase/migrations/`](../supabase/migrations)，
> 校验方式见 [`MOTHER_TEMPLATE.md` §7](./MOTHER_TEMPLATE.md)。

> ## ⚠️ 阅读本文须知
>
> 本文主体写于 Phase 3，当时项目里还有一个「伪 Prisma 适配器」`src/lib/database.ts`。
> **它已在 Phase 9.1 被删除**，`npm run audit:architecture` 会阻止它复活。
> 文中凡是提到「适配器 / 兼容层 / camelCase 映射」的段落都属历史，已在下方逐处标注。
>
> **当前真实分层**（唯一正确版本）：
>
> ```
> API Route / Service  →  src/lib/db/repositories/*  →  getDb()  →  Supabase PostgreSQL
> ```
>
> Phase 3 之后的重要变化：
>
> | 变化 | 阶段 |
> |---|---|
> | 删除 `src/lib/database.ts`（伪 Prisma，约 700 行），9 处调用迁到 Repository | 9.1 |
> | 删除 `src/lib/services/{order,pricing,r2-storage,payment-config,payment-database}.ts` | 9.1~9.3 |
> | `ai_tasks` **已接线**（不再是「建了没用」），并新增 retry / settlement 列（迁移 `0009`） | 7 |
> | 新增 2 个 Repository：`webhook-event.ts`、`admin-audit-log.ts` | 4 / 6.5 |
> | 积分定价收敛：9.x 曾收敛到 `src/config/credits.ts`；**9.8.2-C 起该文件已删除**，成本是产品模型目录的 `credits` 字段 | 3.5 / 9.x / 9.8.2-C |
> | `users.role` 列（`0007`）、`admin_audit_logs` 表（`0008`） | 6 / 6.5 |
> | debug 路由（含 `debug/database-check` 的 `rpc('exec_sql')`）**已全部删除** | 9.3 |
> | 迁移校验双轨：`migrations:static`（sqlglot）+ `migrations:real`（PGlite 跑两遍） | 9.6 |

---

## 1. 数据库整体架构

```
Supabase PostgreSQL
        │
        │  访问层
        ▼
src/lib/db/client.ts          ← 唯一客户端入口（getDb / isDatabaseConfigured / TABLES）
        │                        内部包装 src/lib/supabase/server.ts 的 createAdminClient()
        │                        （service_role，server-only）
        ▼
src/lib/db/repositories/      ← 只做数据操作（7 个）
  ├── user.ts
  ├── credit.ts               ← consume_credits / grant_credits RPC 的调用方
  ├── order.ts
  ├── subscription.ts
  ├── ai-task.ts              ← 含 transitionStatus()（状态机迁移的第二道强制点）
  ├── webhook-event.ts        ← claim()：webhook 事件级幂等
  └── admin-audit-log.ts
        │
        ▼
src/lib/db/types.ts           ← 与 schema 一一对应的手写行类型
```

> **~~兼容层 `src/lib/database.ts`~~ 已于 Phase 9.1 删除。**
> 业务代码统一 `API → Service → Repository`。

### 1.1 ~~为什么保留 `src/lib/database.ts`~~（历史，已失效）

**Phase 3 当时的理由**：明确禁止重构业务逻辑，直接删掉伪 Prisma 适配器会迫使
30+ 处业务调用点同时改写；所以选择「保留适配器 + 修好数据层」。

**最终结果**：Phase 9.1 删除了它，并把 9 处调用点迁到 Repository。
（当初估计的「30+ 处」实际只有 9 处 —— 因为 Phase 8/9 的其他清理已经消化了大部分。）

> **不允许复活**：`npm run audit:architecture` 会检查
> ① `src/lib/database.ts` 文件不存在 ② 没有任何文件 import `@/lib/database`。
> 违反则 `npm run verify` 第 3 步直接 FAIL。

### 1.2 命名约定

| 层 | 约定 | 例子 |
|---|---|---|
| 数据库列 | snake_case | `provider_session_id` |
| Repository 输入参数 | snake_case，镜像列名 | `{ user_id, reference_type }` |
| Repository 返回值 | snake_case 行类型 | `OrderRow` |
| 业务代码 | 直接用 Repository 的 snake_case 行类型 | — |
| ~~适配器对外（旧业务代码）~~ | ~~camelCase~~ | **已随 `database.ts` 一起消失**（Phase 9.1） |

> 规则单一：**Repository 不做命名映射**。适配层删除后，全链路只有 snake_case 一种写法。

---

## 2. 核心表说明

| 表 | 用途 | 状态 |
|---|---|---|
| `users` | 用户资料 + **积分余额（`credits` 列）** | ✅ 活跃 |
| `credit_transactions` | 积分流水（含幂等键与余额快照） | ✅ 活跃 |
| `orders` | **唯一订单表** | ✅ 活跃（0002 新建） |
| `subscriptions` | 订阅 | ✅ 活跃（0003 通用化 provider 引用） |
| `ai_tasks` | AI 生成任务 | ✅ 活跃（`0004` 建表，`0009` 扩展 retry/settlement 列，**Phase 7 已接线**，见 §6.4） |
| `payment_orders` | 旧订单表 | ⚠️ **DEPRECATED**（数据已迁到 `orders`） |
| `generations` | 旧生成历史表 | ⚠️ **DEPRECATED**（数据已迁到 `ai_tasks`） |
| `payment_configs` | 旧支付配置表 | ⚠️ **DEPRECATED**（配置改由 env / config 提供） |

### 2.1 `users`

```
id · email · name · image · credits
location · last_signin_at · signin_count
signin_type · signin_provider · signin_openid · signin_ip
preferred_currency · preferred_payment_provider
created_at · updated_at
```

`signin_*` 等 6 个字段是第三方登录 SDK 的遗留字段，通用模板价值低。
本阶段**不删除**（删除需要同步改 4 处建号逻辑，属于业务改造），已记录为后续清理项。

### 2.2 `credit_transactions`

```
id · user_id · amount · type · status
balance_before · balance_after
reference_type · reference_id · order_id
payment_order_id (deprecated) · description · metadata
created_at · updated_at
```

关键约束：

- `type` 同时允许旧词表与目标词表（见 §5）
- `status ∈ {PENDING, COMPLETED, FAILED}`
- **幂等唯一索引**：`UNIQUE(user_id, reference_type, reference_id, type) WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL`

### 2.3 `orders`

```
id · user_id · order_number · amount · currency · status
payment_provider · product_type · product_id · product_name · customer_email
provider_session_id · provider_payment_id · provider_refs
paid_at · expired_at · metadata
created_at · updated_at
```

- `status ∈ {pending, created, completed, failed, refunded, cancelled, expired}`
- `provider_session_id` 取代 `stripe_session_id` / `creem_checkout_id`
- `provider_payment_id` 取代 `stripe_payment_intent_id` / `creem_payment_id`
- `provider_refs JSONB` 存放渠道专属原始字段 → 接第三家支付不用改表

### 2.4 `subscriptions`

```
id · user_id · plan_id · status · billing_cycle
current_period_start · current_period_end · payment_provider
provider_subscription_id · provider_refs
stripe_subscription_id (deprecated) · creem_subscription_id (deprecated)
created_at · updated_at
```

### 2.5 `ai_tasks`

```
id · user_id · model · provider · status · prompt
input_metadata · output_metadata
provider_task_id · idempotency_key
credit_transaction_id · credits_used
error_code · error_message
created_at · updated_at · completed_at
```

- `status ∈ {pending, processing, completed, failed, cancelled}`，与 AI Core 的 `AITaskState` 对齐
- 幂等唯一索引：`UNIQUE(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
- `credit_transaction_id` 让「失败退款」可以追溯到原扣费流水

---

## 3. 表之间关系

```
users
 ├─1:N─ credit_transactions      (user_id)
 ├─1:N─ orders                   (user_id)
 ├─1:N─ subscriptions            (user_id)
 └─1:N─ ai_tasks                 (user_id)

orders
 └─1:N─ credit_transactions      (order_id)     购买积分的流水指向订单

ai_tasks
 └─N:1─ credit_transactions      (credit_transaction_id)   任务指向它的扣费流水
```

- 所有子表对 `users` 都是 `ON DELETE CASCADE`
- `credit_transactions.order_id` 是 `ON DELETE SET NULL`（订单删除不应连带删掉财务流水）
- `ai_tasks.credit_transaction_id` 是 `ON DELETE SET NULL`

### 3.1 RLS

所有表都开启了 RLS 并写了「用户只能看自己数据」的策略。
但服务端统一使用 service_role key（`createAdminClient`），**service_role 会绕过 RLS**，
因此 RLS 在当前架构下只是安全兜底，不是访问控制手段。
真正的访问控制靠 Repository 方法本身（例如 `listByUser(userId)` 强制带 user_id 条件）。

---

## 4. Order 与 Payment 的关系

### 4.1 结论

> **Order ≠ Payment Transaction**，但当前业务不需要拆成两张表。

| 概念 | 含义 | 当前承载 |
|---|---|---|
| **Order** | 用户为某个产品下的一笔订单（业务概念） | `orders` 表 |
| **Payment Transaction** | 支付渠道的一次资金流水（渠道概念） | `orders.provider_session_id` / `provider_payment_id` / `provider_refs` |

### 4.2 为什么 `orders` 与 `payment_orders` 合并了

审计确认二者是**同一业务概念的两个名字**，而不是「业务订单 vs 渠道交易」：

1. 适配器的 `PaymentOrder` 接口字段与 `payment_orders` 的列一一对应
2. 两者都表示「用户为某个产品下的一笔订单」，都有 `status` / `amount` / `currency` / `paid_at`
3. `orders` 在 SQL 中**根本不存在** —— 它只是适配器里写错的表名

因此统一为 `orders`，`payment_orders` 保留为 DEPRECATED 表（不 DROP，保留历史数据与回滚能力）。

### 4.3 为什么暂不单独建 `payment_transactions`

当前是严格一对一（一次下单 → 一次支付），代码里没有任何地方需要单独记录渠道流水。
按用户约束「不要为了架构完整创建没有实际使用的表」，**不建**。

**触发拆表的条件**（将来出现任一情况时再拆）：

- 一次订单需要多次支付（重试、部分支付）
- 需要记录退款流水（退款是独立于订单的资金事件）
- 需要对接同一渠道的多种支付方式并分别对账

---

## 5. Credit 模型

### 5.1 五个概念分别落在哪里

| # | 概念 | 落在哪里 | 说明 |
|---|---|---|---|
| 1 | **Credit Pricing Config** | 产品的模型目录 `src/lib/products/<id>/catalogue.ts` 的 `credits` 字段（9.8.2-C 起；旧位置 `src/config/credits.ts` 已删除） | 「模型 A = 15 积分」这类定价 —— **不进数据库**，也不在 Core |
| 2 | **User Credit Balance** | `users.credits` 列 | 当前余额 |
| 3 | **Credit Transaction** | `credit_transactions` 表 | 每一次变动一行 |
| 4 | **Credit Consumption** | `credit_transactions` 中 `type='consume'`（旧：`usage`）的行 | 不单独建表 |
| 5 | **Credit Refund** | `credit_transactions` 中 `type='refund'` 的行 | 不单独建表 |

### 5.2 为什么余额仍在 `users.credits`，没有独立 `credit_accounts` 表

这是 Phase 3 的一个**明确决策**，理由是：

1. **移动余额 = 业务逻辑改造**。29 处代码读写 `users.credits`，改它们属于 Phase 3 禁止的范围。
2. **现在建 `credit_accounts` 会更危险**。它会被回填一次，但没有任何代码写入它，
   于是每做一次生成就与 `users.credits` 偏离一点 —— 一张立刻开始说谎的表，
   比没有这张表更糟。
3. **用户约束明确反对过度设计**：「不要为了架构完整创建没有实际使用的 abstraction」。

**补救措施**：余额的读写被**集中在 `src/lib/db/repositories/credit.ts` 一个文件里**
（`getBalance` / `adjustBalance`）。将来要迁移到 `credit_accounts`，只需改这一个文件，
调用方无感。

迁移方案（留给 Credit 阶段）：

```sql
CREATE TABLE public.credit_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.credit_accounts (user_id, balance)
SELECT id, COALESCE(credits, 0) FROM public.users
ON CONFLICT (user_id) DO NOTHING;
-- 之后把 credit.ts 的 getBalance/adjustBalance 指向本表，
-- 并把 users.credits 标记废弃，最后再删列。
```

### 5.3 type 词表

| 词表 | 取值 | 状态 |
|---|---|---|
| 旧（deprecated） | `purchase` · `usage` · `refund` · `bonus` · `gift` | 运行中的代码仍在写 |
| 目标 | `grant` · `purchase` · `consume` · `refund` · `expire` · `adjustment` | 新代码使用 |

CHECK 约束**同时允许两套**。原因：如果现在就把 CHECK 收窄成目标词表，
`auth.ts`（写 `gift`）和 `user/credits/consume`（写 `usage`）会立刻插入失败 —— 等于
在没有迁移写入方的情况下改字段含义，违反迁移安全要求。

收敛步骤（留给 Credit 阶段）：把 3 处写入方切到目标词表 → 回填历史数据 → 收窄 CHECK。

### 5.4 幂等

有**两套**幂等约束，职责不同，都保留：

| 约束 | 列 | 用途 |
|---|---|---|
| `uniq_credit_transactions_idempotency` | `(user_id, idempotency_key)` WHERE `idempotency_key IS NOT NULL` | **请求级去重** —— 由 `consume_credits()` 使用 |
| `uniq_credit_transactions_reference` | `(user_id, reference_type, reference_id, type)` WHERE 两者非空 | **业务级去重** —— 由 grant / refund / purchase 路径使用 |

覆盖的场景：

| 场景 | 幂等键 |
|---|---|
| AI 任务扣费 | `idempotency_key = <taskId 或前端生成的稳定键>` |
| 购买积分 | `reference_type='order'`, `reference_id=<orderNumber>` |
| 注册赠送 | `reference_type='registration'`, `reference_id='welcome_bonus'` |

两者都是**部分唯一索引**：`idempotency_key` / `reference_id` 为 NULL 的流水
（历史数据与未传引用的普通流水）不受约束，多个 NULL 之间不互相冲突。

`CreditRepository.createTransaction()` 在遇到唯一冲突（Postgres `23505`）时
**返回已存在的那条记录**而不是抛错。

> ⚠️ 但**积分扣减不走 createTransaction** —— 它走 `consumeCredits()`
> （见 §5.5），幂等由 RPC 内部的 `ON CONFLICT DO NOTHING` 抢占实现。

### 5.5 原子扣减（D-3，Phase 3.5 解决）

```
CreditService.consumeUserCredits()
        ↓
CreditRepository.consumeCredits()
        ↓
supabase.rpc('consume_credits', ...)
        ↓
PostgreSQL 函数（单事务）
```

`consume_credits(p_user_id, p_amount, p_idempotency_key, p_type, p_description, p_reference_type, p_reference_id, p_metadata)`
在一个 PL/pgSQL 函数体内完成：

1. `amount <= 0` → `invalid_amount`（防止用负数反向加积分）
2. 用户不存在 → `user_not_found`（**必须在写流水之前检查**，
   否则幂等占位 INSERT 会先撞上 `credit_transactions.user_id` 外键约束抛异常）
3. 幂等检查：`INSERT ... ON CONFLICT DO NOTHING` 抢占幂等键
4. 原子扣减：
   ```sql
   UPDATE users SET credits = COALESCE(credits,0) - p_amount
   WHERE id = p_user_id AND COALESCE(credits,0) >= p_amount
   RETURNING credits
   ```
   余额条件写在 `WHERE` 里，由数据库一次性完成「检查 + 扣减」。
5. 写入 / 补全 `credit_transactions`（含 `balance_before` / `balance_after`）

返回 `status ∈ {ok, insufficient, duplicate, invalid_amount, user_not_found}`。

**为什么必须在数据库层**：余额 100 时两个请求各扣 80，
应用层的「读 → 判断 → 写」会让两者都读到 100 并判断「够扣」，最终余额变成 -60。
应用层加锁在多实例部署下也不成立。

**事务性**：余额更新与流水写入在同一个函数体内，即同一事务 ——
不会出现「扣了钱没记账」或「记了账没扣钱」。

**失败不占用幂等键**：余额不足时会把抢占的占位流水删掉，
否则用户充值后用同一个键重试会一直拿到 `duplicate`。

> ⚠️ `adjustBalance()` **不是原子的**（读 → 算 → 写），
> 只保留给 grant / refund / 管理调整路径（用户约束 §12）。
> **消费积分必须走 `consumeCredits()`。**

---

## 6. AI Task 模型

### 6.1 为什么需要它

Phase 2 的 `AIService` 已经产生 `taskId` 概念（异步 Provider 提交后返回 task id），
但没有任何地方能落库。没有任务记录就无法做到：

- **失败退款可追溯**：退款要知道是哪个任务失败 → `credit_transaction_id`
- **幂等**：同一任务不重复扣积分 → `idempotency_key`
- **历史查询**：`listByUser`

### 6.2 状态映射

| `ai_tasks.status` | AI Core `AITaskState` | 说明 |
|---|---|---|
| `pending` | `queued` | 已创建，未提交给 Provider |
| `processing` | `processing` | 已提交，等待结果 |
| `completed` | `completed` | 成功 |
| `failed` | `failed` | 失败 |
| `cancelled` | — | 用户取消（AI Core 无此态） |

### 6.3 原始响应怎么存

**不**把 Provider 的原始响应摊成核心字段。约定：

- `input_metadata`：`{ inputImages: [...], parameters: {...} }`
- `output_metadata`：`{ assets: [{ url, width, height }] }`
- 调试需要的完整响应放在 `metadata` / `output_metadata` 的嵌套字段里

### 6.4 当前接线状态（2026-09-29 复核）

✅ **已接线**（Phase 7）。

- Repository：`src/lib/db/repositories/ai-task.ts`
- 编排方：`src/lib/workflow/service.ts` 的 `WorkflowService`
  （`createTask()` 第 ⑤ 步 `taskRepo.create(status:'pending')`，
  第 ⑥ 步扣积分后回写 `credit_transaction_id` / `credits_used`）
- 状态迁移：`taskRepo.transitionStatus()` 是状态机的**第二道强制点**
  （第一道是 `state-machine.ts` 的 `assertTransition()`），
  它自动写 `started_at` / `completed_at`，`from === to` 时短路返回 `changed: false`
- 迁移 `0009_workflow_task_engine.sql` 增加了 retry / settlement 列：
  `retry_count`、`max_retries`、`next_retry_at`、`credits_used`、`credits_refunded`
  （CHECK `credits_refunded <= credits_used`）、`refund_transaction_id`

> ⚠️ 已知落差：`next_retry_at` 会写入（指数退避 `min(5000 * 2^n, 60000)`），
> 但 `findRetryableTasks()` **零调用方**，`failTask()` 会立即重试而不等待退避。
> 记录于 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。

---

## 7. Subscription 模型

### 7.1 当前状态

表结构完整（`0000` 建立，`0003` 通用化 provider 引用列）。
**代码侧原先完全走 mock**（`create()` 返回 `Math.random()` 生成的假 id），
Phase 3 已通过 `SubscriptionRepository` 换成真实持久化。

### 7.2 明确不做的部分

按用户约束 §11，本阶段**只解决数据结构 + migration + data access**，因此不实现：

- 订阅续费 / 到期处理
- 升降级的 proration 计算
- 按周期重置积分
- 任何支付渠道 SDK 调用

### 7.3 与订单的关系

```
orders            → 一次支付行为（业务订单）
subscriptions     → 支付成功后的持续状态（订阅关系）
```

`orders.product_type = 'subscription'` 时，支付成功会创建/更新一条 `subscriptions` 记录，
通过 `provider_subscription_id` 与渠道侧关联。
两者**不是**同一张表能表达的东西，因此分开。

---

## 8. Repository 层职责

### 8.1 只做数据操作

| ✅ Repository 负责 | ❌ Repository 不负责 |
|---|---|
| 查询 / 新增 / 更新 / 删除 | 扣多少积分（= 产品模型目录的 `credits`，9.8.2-C 起 Core 无成本表） |
| 事务相关的数据操作 | 退款规则 |
| 过滤 / 排序 / 分页 | 支付业务规则（属于 `src/lib/billing/`） |
| 唯一冲突等数据层错误的处理 | AI Provider 调用 |
| | 用户权限判断 |
| | HTTP Request / Response |

**反例**（明确不要写）：

```ts
// ❌ 这是 Service / Workflow 的职责，不是 Repository 的
creditRepository.consumeCreditsAndCallAI()
```

**正例**：

```ts
creditRepository.getBalance(userId)
creditRepository.createTransaction({ ... })
creditRepository.findByReference(userId, 'ai_generation', taskId, 'consume')
```

### 8.2 现有 Repository 的方法清单

| Repository | 方法 |
|---|---|
| `user.ts` | `findById` `findByEmail` `create` `update` `touchSignin` `remove` |
| `credit.ts` | **`consumeCredits`（RPC，原子+幂等）** `getBalance` `adjustBalance` `createTransaction` `findByIdempotencyKey` `findByReference` `listTransactions` `listByOrderId` |
| `order.ts` | `create` `findById` `findByOrderNumber` `findByProviderSession` `findByProviderPayment` `update` `listByUser` `listAll` `listExpiredPending` `count` `countByProvider` `providerStats` `sumAmount` `updateManyStatus` `remove` |
| `subscription.ts` | `findActiveByUser` `findById` `findByProviderSubscription` `create` `update` `listByUser` |
| `ai-task.ts` | `create` `findById` `findByProviderTaskId` `findByIdempotencyKey` `updateStatus` `fail` `listByUser` |

> 消费积分**只能**用 `credit.consumeCredits()`。
> `credit.adjustBalance()` 是非原子的，仅限 grant / refund / 管理调整。

### 8.3 已知限制（记录在案）

| 限制 | 说明 |
|---|---|
| `credit.adjustBalance` 非原子 | 「读 → 算 → 写」之间没有事务保护。**消费路径已由 `consumeCredits()` 解决（Phase 3.5）**；grant / refund / 管理调整仍走这里，属于 Credit 收敛阶段的范围 |
| 真实并行并发未验证 | 迁移与 `consume_credits()` 已在真实 PostgreSQL（PGlite 18.3）上验证，但 PGlite 是单后端单连接，无法复现真正的并行执行。并发保证依赖 Postgres 行级锁语义，需在有 Supabase 实例时补做并行验证 |
| ~~`ai_tasks` 尚未接线~~ | ✅ **已解决**（Phase 7），见 §6.4 |
| `users.signin_*` 6 个遗留字段 | 删除需要同步改 4 处建号逻辑 |
| `order.listAll` 的分页是 offset 式 | 数据量大时应改为游标分页 |
| ~~积分定价仍分散在 3 处~~ | ✅ **已解决（9.8.2-C 定稿）**：成本是**产品模型目录**这条记录上的 `credits` 字段，UI 展示与 `WorkflowService` 实扣读同一个值；~~`src/config/credits.ts` 是唯一真相~~ 该文件已删除，因为它的键全是 `flux-*`（产品数据）。产品侧 `products/flux-kontext/credits.ts` 只做 action → 模型的翻译 |
| **业务代码绕过 Repository** | ⚠️ **新发现（Phase 9.7）**：`src/app/api/user/credits/route.ts` 与 `src/app/api/user/ensure/route.ts` 直接 `createAdminClient()` + `.from('users')` / `.from('credit_transactions')`，违反 §8.1。见 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) |
| `next_retry_at` 写了没人读 | ⚠️ `findRetryableTasks()` 零调用方，见 §6.4 |

---

## 9. Migration 方式

完整操作说明见 [`supabase/README.md`](../supabase/README.md)；
门禁与命令全貌见 [`MOTHER_TEMPLATE.md` §7 / §8](./MOTHER_TEMPLATE.md)。要点：

1. **编号 SQL 文件 + 手工在 Supabase SQL Editor 执行**，不引入 Supabase CLI / ORM，
   **本仓库没有自动迁移流水线**
2. 命名规则：**4 位连续序号 `NNNN_name.sql`，不留空洞**；新增 = 新增一个文件，
   **绝不修改已有文件**
3. 每个文件**必须可重复执行**（`IF NOT EXISTS` / `OR REPLACE` / `IF EXISTS`）。
   这不是约定，是**被测试强制**的 —— `migrations:real` 会把每个文件跑两遍
4. 迁移安全顺序：**ADD → BACKFILL → MIGRATE → VERIFY → DEPRECATE**，优先保留旧表而非 `DROP`
5. 约束优先写进数据库（CHECK / UNIQUE INDEX），不要只靠应用层校验
6. 涉及钱的逻辑优先做成 **Postgres 函数（RPC）**，让原子性由数据库保证
7. **禁止**在没有迁移的情况下直接改线上 schema

### 9.1 当前迁移链（0000 ~ 0009，共 10 个）

| 文件 | 作用 |
|---|---|
| `0000_baseline.sql` | schema 基线快照（可重复执行版）。含后来被废弃的 `payment_orders` / `payment_configs` / `generations`（见附录 L-15） |
| `0001_credit_model.sql` | 积分流水模型（列补齐 / 词表放宽 / 幂等约束 / 回填） |
| `0002_orders.sql` | 订单统一（`orders` 取代 `payment_orders`） |
| `0003_subscriptions.sql` | 订阅 provider 引用通用化 + `payment_configs` 废弃 |
| `0004_ai_tasks.sql` | AI 任务表（取代 `generations`），含 `status` CHECK 约束 |
| `0005_atomic_credit_operations.sql` | ⭐ `consume_credits()` 原子扣减 RPC + `uniq_credit_transactions_idempotency` |
| `0006_billing_closed_loop.sql` | `webhook_events` 表 + `grant_credits()` RPC（商业闭环） |
| `0007_user_role.sql` | `users.role`（`user` / `admin`） |
| `0008_admin_audit_logs.sql` | `admin_audit_logs` 表 |
| `0009_workflow_task_engine.sql` | `ai_tasks` 扩展：retry（`retry_count` / `max_retries` / `next_retry_at`）与结算列（`credits_used` / `credits_refunded` + CHECK / `refund_transaction_id`） |

### 9.2 两层验证

```bash
npm run migrations:static    # = node scripts/verify-all.mjs --only=migrations:static
npm run migrations:real      # = node scripts/verify-all.mjs --only=migrations:real

# 等价直接调用：
PYTHON=<带 sqlglot 的解释器> python supabase/scripts/validate_migrations.py
node supabase/scripts/verify_migrations.mjs
```

| | `migrations:static` | `migrations:real` |
|---|---|---|
| 实现 | `supabase/scripts/validate_migrations.py`（531 行） | `supabase/scripts/verify_migrations.mjs`（1130 行） |
| 依赖 | **Python + `sqlglot`**（`supabase/scripts/requirements.txt`，只有 `sqlglot>=25.0`） | **`@electric-sql/pglite`**（devDependency `^0.5.8`，仅测试用，不进生产包） |
| 手段 | sqlglot 解析（postgres 方言）+ 内置 Schema 模拟器 | **PGlite = WASM 里的真实 PostgreSQL，内存态** |
| 检查 | ① 可解析性 ② 依赖顺序（ALTER / INDEX / POLICY 的目标须先创建）③ FK REFERENCES 目标存在 ④ UNIQUE / 唯一索引的列存在 ⑤ CREATE INDEX 的表与列存在 ⑥ 幂等守卫覆盖率统计 | ① 按序执行全部迁移 ② **完整重跑一遍**（幂等）③ Schema 断言（表 / 列 / 唯一索引 / RPC）④ 积分原子消费（并发 race、二次扣减影响 0 行、断言函数体含 `WHERE credits >= p_amount`）⑤ Billing 闭环 ⑥ Admin ⑦ Workflow（重复 `idempotency_key`、只退一次） |
| 缺依赖时 | **SKIP**（不算通过） | **FAIL，退出码 2**（明确「不伪装成通过」） |
| 局限 | `CREATE POLICY` / RLS 退化为通用 Command，**不校验**；无类型与数据校验 | **单后端单连接**，真并行未被验证（脚本内有此诚实声明，见附录 L-22） |

平台特例处理：`validate_migrations.py` 允许 `auth.users` / `auth.uid()` 与
`uuid-ossp` / `pgcrypto` 扩展；`verify_migrations.mjs` 会剥离 `CREATE EXTENSION "uuid-ossp"`
并把 `auth.uid()` 桩成返回 NULL。

**PGlite 的用途**：让「迁移能否真实执行、是否幂等、RPC 行为是否正确」在
**没有数据库、没有密钥**的情况下被自动验证。它是主门禁，静态校验是补充。

> **`.venv` 是本地环境，不入库**（`.gitignore` 里有 `/.venv/`），
> 每个人 clone 后自建一次：
> ```bash
> python -m venv .venv
> .venv/Scripts/pip install -r supabase/scripts/requirements.txt   # Windows
> .venv/bin/pip install -r supabase/scripts/requirements.txt       # macOS / Linux
> npm run verify
> ```
> 建好之后 `migrations:static` 会被**自动探测并执行**，无需设 `PYTHON`。
> 没建 venv 且系统 Python 里没有 `sqlglot` 时该步 SKIP，
> `npm run verify` 仍返回 0（带「覆盖率不完整」告警）；加 `--strict` 才判失败。
>
> `verify-all.mjs` 的 Python 探测顺序：`$PYTHON` → `.venv/Scripts/python.exe` →
> `.venv/bin/python` → `python3` → `python`。
>
> ⚠️ Windows 注意：`validate_migrations.py` 已在入口把 stdout/stderr 重设为 UTF-8。
> 控制台默认 cp936/GBK 打印 ✅ / 中文会抛 `UnicodeEncodeError`，
> 表现是「校验全过、脚本却退出 1」。若在别的脚本里遇到同样现象，同样处理。
>
> 断言数量由运行时计数（Phase 9.6 记录为 198 项），**以实际输出为准**，不要在文档里硬写。

---

## 10. 新增数据库表的规范

新增一张表时，按顺序完成：

1. **写迁移文件** `supabase/migrations/00NN_<主题>.sql`
   - 文件头写明：解决什么问题、关联的审计编号、是否可回滚
   - 表名带 `public.` 前缀
   - 必须补：`updated_at` 触发器、必要索引、RLS 策略
2. **补行类型** `src/lib/db/types.ts`
   - 可空列显式标 `| null`
3. **加表名常量** `src/lib/db/client.ts` 的 `TABLES`
4. **写 Repository** `src/lib/db/repositories/<domain>.ts`
   - 只做数据操作，不含业务规则
   - 输入参数镜像列名（snake_case）
5. **跑校验** `python supabase/scripts/validate_migrations.py`
6. **跑回归** `npm run lint && npm run build`
7. **更新本文档** 的 §2 表清单

### 10.1 判断「该不该建这张表」

建表之前先问三个问题：

1. **有真实调用方吗？** 没有就**不要建**（`payment_configs` 就是反例：建了但从未被读写）
2. **能用现有表表达吗？** 能就不要建（`payment_transactions` 暂不建，见 §4.3）
3. **属于哪一层？**
   - Secret / API Key → 环境变量，**永不入库**
   - 渠道开关 / 映射 → 代码配置
   - 业务状态 / 流水 → 数据库

### 10.2 什么情况下允许拆表

只有当**两个概念的生命周期或基数不同**时才拆。例如：

- 订单（1）与支付流水（N）→ 基数不同 → 拆
- 用户（1）与积分余额（1）→ 基数相同、生命周期相同 → 可以不拆（当前选择）

---

## 附：Phase 3 未解决的问题 —— **2026-09-29 复核状态**

> 这是 Phase 3 当时留下的清单，**保留作为历史记录**。
> 「状态」列是复核结果；多数已在后续阶段关闭。
> 原表里 `L-21` 曾**重复出现两次且内容互相矛盾**（一处说 `src/config/credits.ts` 尚未创建，
> 而它其实早已创建），现已合并为一行。

| ID | 问题 | 状态 | 说明 / 建议处理阶段 |
|---|---|---|---|
| L-10 | `users.credits` 与目标模型 `credit_accounts` 的差距 | ✅ 不再处理 | 已由 D-2 正式决定**保留 `users.credits`**；不存在 `credit_accounts` 表，这是有意设计 |
| L-11 | `credit.adjustBalance` 非原子 | 🟡 部分 | **消费路径已在 Phase 3.5 用 `consume_credits` RPC 解决**；grant / refund 也已有 `grant_credits` RPC。`adjustBalance` 仅剩 Admin 手工调整在用，**禁止用于消费路径** |
| L-12 | `credit_transactions.type` 存在两套词表 | 🟡 仍未收窄 | 现在收窄会让运行中的写入立刻失败 → Credit 收敛阶段 |
| L-13 | `ai_tasks` 表已建但未接线 | ✅ **已解决** | Phase 7 接线，`0009` 扩展列，见 §6.4 |
| L-14 | `users.signin_*` 等 6 个遗留字段未删 | ❌ 仍存在 | `0000_baseline.sql:36-38` 等仍在建这些列；删除需同步改 4 处建号逻辑。PROJECT_STATUS 记为 F-2b「不建议做」 |
| L-15 | 三张 DEPRECATED 表未删除 | ❌ 仍存在 | `payment_orders` / `payment_configs` / `generations` 仍由 `0000_baseline.sql` 创建（第 51 / 109 / 124 行），从未 DROP。迁移安全要求优先 DEPRECATE → 稳定后清理 |
| L-16 | `src/lib/database.ts` 适配器仍在 | ✅ **已解决** | **Phase 9.1 删除**（约 700 行），9 处调用迁到 Repository；`audit:architecture` 阻止复活 |
| L-17 | `src/lib/services/order.ts`（426 行）仍是死代码 | ✅ **已解决** | 死代码清理中删除（连同 `types/order.ts`、`services/r2-storage.ts`、`utils/ip.ts`） |
| L-18 | 没有任何数据库字段保存 R2 URL / object key | 🟡 部分 | Phase 7 后 `ai_tasks.output_metadata` 保存归一化 assets（`src/lib/workflow/result.ts` 的 `TaskAsset` 带 `key`）；**是否完整落 object key 需核对实际写入**，未在本文断言 |
| L-19 | `debug/database-check` 暴露 `rpc('exec_sql')` | ✅ **已解决** | Phase 9.3 删除全部 debug 路由；`src/app/debug/` 不存在。`src/proxy.ts` 另有 `/api/debug/*` 默认 404 的兜底（需 `ENABLE_DEBUG_ROUTES=true` 且非 production 才放行） |
| L-20 | 3 套 Supabase 客户端创建方式 | ❌ 仍存在 | `src/lib/supabase/client.ts` 的 `createClient()` + 模块级 `supabase` 常量、`server.ts` 的 `createClient()` 与 `createAdminClient()`。服务端数据访问已收敛到 `db/client.ts`，浏览器端未收敛 |
| L-21 | 积分定价分散在 3 处 | ✅ **已解决** | 两阶段：Phase 9.x 收敛到 `src/config/credits.ts`（`CREDIT_COSTS` / `getCreditCost()` / `hasCreditCost()`）；**Phase 9.8.2-C 把它整体删除**，成本搬到产品的 `catalogue.ts`（Core 里的表键全是 `flux-*`，本属产品数据）。`flux-kontext-request.ts` 已删除，产品侧改为 `products/flux-kontext/credits.ts` 读目录；`services/credits.ts` 只剩余额检查/消费两个薄函数，且 `requiredCredits` **无默认值** |
| L-22 | 真实并行并发未验证 | ❌ 仍存在 | `migrations:real` 用 PGlite（WASM 里的真实 PostgreSQL）验证，但**单后端单连接**，无法复现真正并行。并发保证依赖 Postgres 行级锁语义与条件 UPDATE，需在有真实 Supabase 实例时补做并行验证。`verify_migrations.mjs` 内部有此诚实声明 |
| **L-23** | **业务代码绕过 Repository** | ⚠️ **新发现（Phase 9.7）** | `src/app/api/user/credits/route.ts` 与 `src/app/api/user/ensure/route.ts` 直接 `createAdminClient()` + `.from('users')` / `.from('credit_transactions')`，违反 §8.1。当前无守卫覆盖 → 见 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) |
| **L-24** | **`next_retry_at` 写了没人读** | ⚠️ **新发现（Phase 9.7）** | `findRetryableTasks()` 零调用方，`failTask()` 立即重试不等待退避，且无 cron 兜底 → 见 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) |

**汇总**：✅ 6 项已解决 · 🟡 3 项部分 · ❌ 4 项仍存在 · ⚠️ 2 项新发现
