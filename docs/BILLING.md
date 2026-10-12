# BILLING.md — Billing 系统设计说明（Phase 4）

> Phase 4 产物。数据层细节见 [`DATABASE.md`](./DATABASE.md)，决策记录见 [`REFACTOR_DECISIONS.md`](./REFACTOR_DECISIONS.md)。

---

## 1. Billing 架构

```
用户选择套餐（只传 packageId）
        │
        ▼
POST /api/billing/checkout
        │
        ▼
┌─────────────────────────────────────────────┐
│  BillingService.createCheckout              │
│   1. 解析套餐（服务端价格）                  │
│   2. checkout 幂等检查                       │
│   3. 创建 pending order                      │
│   4. provider.createCheckout()               │
│   5. 回写 provider_session_id + checkoutUrl  │
└─────────────────────────────────────────────┘
        │
        ▼
   PaymentProvider（creem / stripe）
        │
        ▼
   渠道 API → 用户支付
        │
        ▼
POST /api/billing/webhook/[provider]
        │
        ▼
┌─────────────────────────────────────────────┐
│  BillingService.handleWebhook               │
│   1. provider.verifyWebhook()   验签          │
│   2. provider.parseWebhookEvent() 归一化      │
│   3. 按 sessionId 定位 order                  │
│   4. webhook_events 抢占（幂等第 1 层）        │
│   5. markPaidIfPending（幂等第 2 层）          │
│   6. fulfillOrder()                           │
└─────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────┐
│  OrderFulfillmentService                    │
│   credit_pack  → grantCredits（RPC）          │
│   subscription → grantCredits + 开通订阅      │
│   （幂等第 3 层：credit_grant:<order_id>）     │
└─────────────────────────────────────────────┘
        │
        ▼
  users.credits + credit_transactions
```

### 1.1 四者边界（核心原则）

```
Payment 是支付事实。      → PaymentProvider（渠道层）
Order   是业务订单。      → orders 表 + BillingService
CreditTransaction 是账务事实。 → credit_transactions 表 + Credit Repository
Subscription 是订阅状态。 → subscriptions 表 + Subscription Repository
```

| 层 | 位置 | 可以 | **不可以** |
|---|---|---|---|
| **PaymentProvider** | `src/lib/billing/providers/` | 创建支付、验证回调、解析事件 | 改订单、发积分、改订阅、碰 users、写流水 |
| **BillingService** | `src/lib/billing/service.ts` | 创建订单、变更订单状态、决定何时交付 | 直接写 `users.credits`、解析渠道原始报文 |
| **Fulfillment** | `src/lib/billing/fulfillment.ts` | 按商品交付（发积分 / 开订阅） | 变更订单支付状态、验证回调 |
| **Credit Repository** | `src/lib/db/repositories/credit.ts` | 原子发放 / 扣减、写流水 | 判断业务规则 |

一句话：**Webhook 不直接写 `users.credits`** —— 交付统一经过 `Fulfillment`。

---

## 2. Product / Package

### 2.1 位置与理由

**数据**：`src/lib/products/flux-kontext/billing.ts`（产品的套餐表）。
**机制**：`src/config/billing.ts`（`getBillingPackage` / `findBillingPackage` /
`listBillingPackages` / `getProviderProductId` / `getFreePlan` / `formatPriceMinor` /
`toMinorUnits`），它只读**已绑定的** `getProductConfig().billingPackages`。
两边都是**静态 TypeScript 配置，不是数据库表**。

理由（用户约束 §5：不要为了抽象而创建过度复杂的数据库模型）：

- 产品套餐是**发布时确定**的，不需要后台动态改价
- 放进数据库会引入「配置表 + 缓存 + 迁移」的额外复杂度
- 接口（`getBillingPackage` / `findBillingPackage`）保持不变，
  将来真的需要运营后台改价时，把实现换成数据库读取即可，调用方无感
- 未知 `packageId` / `productId` **抛错**，不返回默认套餐（9.8.2-C 起 Core 里已无套餐数据可回退）

### 2.2 当前可售套餐

| packageId | 类型 | 价格 | 积分 | 周期 |
|---|---|---|---|---|
| `starter` | credit_pack | $4.90 | 600 | — |
| `creator` | credit_pack | $15.00 | 4000 | — |
| `business` | credit_pack | $60.00 | 18000 | — |
| `plus_monthly` | subscription | $9.90 | 1900 | monthly |
| `plus_yearly` | subscription | $99.00 | 24000 | yearly |
| `pro_monthly` | subscription | $29.90 | 8900 | monthly |
| `pro_yearly` | subscription | $299.00 | 120000 | yearly |

免费套餐 `basic`（0 元 / **注册赠送 100 积分**）**不在**可售列表里，不经过 checkout。
它的 `welcomeCredits` 是全项目唯一的「注册赠送积分」数字
（`src/lib/auth.ts`、`api/user/credits`、`api/user/ensure` 都调 `getFreePlan().welcomeCredits`），
**免费档没有周期性发放** —— 周期额度只存在于付费套餐里。

> 上表数据在 `src/lib/products/flux-kontext/billing.ts`；
> 「渠道商品 id」列（`providerProductIds.creem`）也在同一份数据里，**永不出现在请求体或客户端**。

### 2.3 与旧定价的关系（2026-09-29 复核）

Phase 4 之前定价散落在 4 处且互相不一致。**现已收敛完毕**：

| 旧位置 | 当前状态 |
|---|---|
| ~~`src/lib/payment-security.ts` 的 `STANDARD_PRICING`~~ | ✅ **已删除**（Phase 9.2） |
| ~~`src/lib/payment/creem.ts` 的 `CREEM_PRODUCT_IDS`~~ | ✅ **已删除**（Phase 9.2，整个 `src/lib/payment/` 目录不存在）；渠道产品映射现在是**套餐数据里的** `providerProductIds`（`products/flux-kontext/billing.ts`），读取入口 `getProviderProductId()` |
| ~~`src/lib/services/pricing.ts`~~ | ✅ **已删除**；定价页展示数据来自产品套餐表与产品文案 `products/flux-kontext/content/pricing.json` |
| ~~`src/lib/user-tiers.ts` 的 `pricingPlans`~~ | ✅ **已随文件搬走**（9.8.2-C：`src/lib/user-tiers.ts` → `src/lib/products/flux-kontext/tiers.ts:231`）。它仍只被 `src/components/UpgradePrompt.tsx` 引用，而后者在 `audit-dead-files.mjs` 的 `KNOWN_UNUSED_BUT_KEPT` 白名单里 → 那条**死代码链本身没被本轮清理**（规格：不清理无关死代码），但它已不在 Core |

价格与积分的**唯一来源**是已绑定的产品套餐表；`npm run verify` 的 `verify-billing.ts` 步骤
（`scripts/verify-billing.ts`）会静态校验「价格只从服务端配置来、整数最小单位、
checkout 路由不从请求体读 price/amount/credits」。

---

## 3. Order 生命周期

```
                    ┌──────────┐
                    │ pending  │  ← createCheckout 创建
                    └────┬─────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   ┌─────────┐     ┌─────────┐     ┌───────────┐
   │  paid   │     │ failed  │     │ cancelled │
   └────┬────┘     └─────────┘     └───────────┘
        │          （渠道拒付）      （用户取消）
        │
        ├──► fulfilled_at 写入（交付完成）
        │
        ▼
   ┌──────────┐
   │ refunded │  ← Phase 4 只记录状态，不做积分扣回
   └──────────┘

   expired ← 待支付超时（由订单清理任务处理，不属 Phase 4）
```

### 3.1 状态词表

| 状态 | 含义 | 新代码使用 |
|---|---|---|
| `pending` | 已创建订单，等待支付 | ✅ |
| `paid` | 支付成功 | ✅ |
| `failed` | 渠道拒付 / 支付失败 | ✅ |
| `cancelled` | 用户取消 | ✅ |
| `refunded` | 已退款 | ✅ |
| `expired` | 待支付超时 | ✅ |
| `created` | 旧写法，语义等同 pending | ⚠️ 仅历史数据 |
| `completed` | 旧写法，语义等同 paid | ⚠️ 仅历史数据 |

迁移 0006 已把历史数据回填：`completed → paid`、`created → pending`。
旧值仍保留在 CHECK 约束里以兼容历史数据（用户约束 §6「先兼容并统一语义」）。

### 3.2 `paid` 与 `fulfilled_at` 是两件事

- `status = 'paid'` = **钱收到了**
- `fulfilled_at` 非空 = **东西给出去了**

两者分开记录的原因：交付可能失败（例如数据库临时不可用）。
`status='paid' AND fulfilled_at IS NULL` 就是「已付款未交付」，
可以据此重试交付（已建部分索引 `idx_orders_paid_unfulfilled`）。

---

## 4. PaymentProvider

### 4.1 接口

`src/lib/billing/types.ts`

```ts
interface PaymentProvider {
  readonly name: string
  isConfigured(): boolean
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession>
  verifyWebhook(rawBody, headers): Promise<WebhookVerification>
  parseWebhookEvent(rawBody, headers): Promise<NormalizedPaymentEvent>
}
```

只有三个方法 —— 没有为了「未来可能有 10 个渠道」而堆砌接口（用户约束 §8）。

### 4.2 现有实现

| Provider | 位置 | 说明 |
|---|---|---|
| `creem` | `providers/creem.ts` | `class CreemProvider`，**自包含**（checkout 已内联，`createCreemSession`）；HMAC-SHA256 验签；`isConfigured()` 需 `CREEM_API_URL` + `CREEM_API_KEY` |
| `stripe` | `providers/stripe.ts` | `class StripeProvider`，**自包含**；`stripe.webhooks.constructEvent` 验签；`isConfigured()` 走 `isStripeAvailable()` |

注册表在 `providers/index.ts`（`getPaymentProvider(name)` / `resolveDefaultPaymentProvider()`），
业务层只通过它访问。

> ⚠️ 历史说明：Phase 9.2 之前这两个 provider 是**薄壳**，真正的 checkout 逻辑在
> `src/lib/payment/{creem,stripe}.ts`（`createCreemCheckout` / `createStripeCheckout`）。
> **那一层已整体删除**，逻辑内联进 provider。不要再去找 `src/lib/payment/`。

`PaymentProvider` 接口（`billing/types.ts:93`）只有 5 个成员：
`readonly name`、`isConfigured()`、`createCheckout(params)`、
`verifyWebhook(rawBody, headers)`、`parseWebhookEvent(rawBody, headers)`。

### 4.3 ⚠️ 价格真相的渠道差异（重要）

| 渠道 | 扣款金额由谁决定 | 含义 |
|---|---|---|
| **Stripe** | **我们**（用服务端 `priceMinor` 动态创建 `price_data`） | 配置即真相，不存在漂移 |
| **Creem** | **Creem 后台的产品价格** | 我们传的 `original_amount` 只进 metadata；**产品套餐表**（`products/flux-kontext/billing.ts` 的 `priceMinor` + `providerProductIds.creem`）必须与 Creem 后台**手工保持一致** |

这是 Creem 的机制限制，不是设计选择。接入 Creem 时务必核对后台价格。

---

## 5. Webhook

### 5.1 端点

| 端点 | 状态 |
|---|---|
| `POST /api/billing/webhook/[provider]` | ✅ **推荐**（渠道名显式） |
| `POST /api/webhooks/stripe` | ⚠️ 兼容适配器，委托给上者 |
| `POST /api/webhooks/payments` | ⚠️ 兼容适配器，靠 header 识别渠道后委托 |

旧的两个入口不再自己处理事件 —— 全项目只有一套 Webhook 实现。

### 5.2 必须用原始 body 验签

```ts
const rawBody = await request.text()   // ✅
const body = await request.json()      // ❌ 签名是对原始字节算的
```

### 5.3 处理流程

```
验签失败        → 400（调用方问题，重试也没用）
事件与本系统无关 → 200（避免渠道反复重试）
找不到订单      → 200 + note（重试也找不到，不该让渠道一直重试）
处理成功        → 200
处理抛错        → 500（让渠道按自己的策略重试）
```

---

## 6. Fulfillment

`src/lib/billing/fulfillment.ts` 的 `fulfillOrder(order)`：

| 商品类型 | 交付动作 |
|---|---|
| `credit_pack` | `grantCredits()` 发放积分 |
| `subscription` | `grantCredits()` 发放本期积分 + 开通/续期订阅 |
| 其他 | **抛错**（不静默跳过 —— 否则会出现「付了钱什么都没拿到」） |

### 6.1 订阅交付

只实现基础生命周期（用户约束 §16）：

- 状态：`active` / `cancelled` / `expired`
- 字段：`current_period_start` / `current_period_end`
- 周期计算：`monthly` +1 月，`yearly` +1 年（UTC）

**明确不实现**：自动续费、proration、升降级、复杂 billing cycle。

### 6.2 订阅交付的幂等

以订单的 `provider_session_id` 作为订阅的 `provider_subscription_id` 去查：
已存在则只更新周期，不会创建第二条订阅。

---

## 7. Credit Grant

### 7.1 与 consume 的区别

| | consume（Phase 3.5） | grant（Phase 4） |
|---|---|---|
| 场景 | 用户消费积分 | 用户付钱获得积分 |
| RPC | `consume_credits()` | `grant_credits()` |
| 余额检查 | 有（不足则 `insufficient`） | 无（发放不存在余额不足） |
| 幂等键 | 请求级 `idempotency_key` | 订单级 `credit_grant:<order_id>` |
| 原子性 | 单 PL/pgSQL 函数体 | 单 PL/pgSQL 函数体 |

两者都**没有**在 TypeScript 里做「读 → 算 → 写」。

### 7.2 原子性

`grant_credits()` 在一个 PL/pgSQL 函数体内完成：

1. `amount <= 0` → `invalid_amount`
2. 用户不存在 → `user_not_found`（**必须在写流水之前检查**，
   否则幂等占位 INSERT 会先撞 `credit_transactions.user_id` 外键约束）
3. 幂等占位：`INSERT ... ON CONFLICT DO NOTHING`
4. `UPDATE users SET credits = credits + n WHERE id = ... RETURNING credits`
5. 补全流水（含 `balance_before` / `balance_after`）

余额增加与流水写入在同一个函数体内 = 同一事务 ——
不会出现「加了积分没记账」或「记了账没加积分」。

### 7.3 流水记录

```
user_id · amount = +N · type = 'purchase'
balance_before · balance_after
reference_type = 'order' · reference_id = <order_number>
order_id = <order.id>
idempotency_key = 'credit_grant:<order_id>'
```

---

## 8. Subscription

| 项 | Phase 4 做到什么 |
|---|---|
| 持久化 | ✅ 真实写入 `subscriptions`（Phase 3 已从 mock 换掉） |
| 开通 | ✅ 支付成功后创建 `active` 订阅 |
| 续期（同订单重复交付） | ✅ 更新周期，不创建第二条 |
| 状态 | ✅ `active` / `cancelled` / `expired` |
| 渠道订阅 id | ✅ `provider_subscription_id` |
| 自动续费 | ❌ 未实现 |
| proration | ❌ 未实现 |
| 升降级 | ❌ 未实现 |
| 按周期自动发放积分 | ❌ 未实现（只在支付成功时发一期） |

---

## 9. 幂等

### 9.1 三层防线

| # | 机制 | 位置 | 防的是什么 |
|---|---|---|---|
| 1 | `webhook_events` 唯一约束 `(provider, event_id)` | 数据库 | 渠道重复发送同一事件 |
| 2 | `markPaidIfPending` 条件更新 | 数据库 | 并发 Webhook 同时把订单推进到 paid |
| 3 | `credit_grant:<order_id>` 幂等键 | 数据库 | 同一订单重复发放积分 |

**为什么不能只靠 `if (order.status === 'paid')`**：
两个并发 Webhook 可能同时读到 `status='pending'`，然后都执行交付 → 积分发两次。
第 2 层把判断写进 `WHERE` 子句，由数据库仲裁；第 1、3 层用唯一约束兜底。

### 9.2 checkout 幂等

`orders.idempotency_key` + 部分唯一索引 `(user_id, idempotency_key)`。

- 客户端传 `idempotencyKey` → 用它（推荐）
- 不传 → 用 `auto:<userId>:<packageId>:<60 秒时间桶>` 兜底，防止重复点击 Pay

同一幂等键已存在订单时：
- 已支付 → 抛错，拒绝创建重复 checkout
- 待支付且有 checkoutUrl → 返回原订单（`reused: true`）
- 待支付但无 checkoutUrl（上次开单失败）→ 同一订单重开渠道会话

---

## 10. Refund 限制（Phase 4 deferred）

用户约束 §22：只保留基础 refund 状态，不实现复杂退款系统。

| 项 | 状态 |
|---|---|
| `paid → refunded` 状态流转 | ✅ 支持（`charge.refunded` / 退款类事件） |
| 部分退款 | ❌ 未实现 |
| 退款后扣回积分 | ❌ **未实现** |
| 退款金额校验 | ❌ 未实现 |
| 退款流水记录 | ❌ 未实现（只在订单状态上体现） |

**为什么不自动扣回积分**：退款后用户可能已经消费了积分。
「扣回多少、余额不足怎么办、是否允许负余额」是业务决策，
当前项目没有明确的退款业务规则，因此**不自行设计**（用户约束 §22）。
需要时再定规则实现。

---

## 11. API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/billing/checkout` | 创建支付会话。body: `{ packageId }` **或** `{ productId, billingCycle? }`，外加可选 `providerName` / `idempotencyKey`。其余字段（含 `price` / `amount` / `credits`）**一律不读** |
| `GET` | `/api/billing/checkout` | 列出可售套餐（服务端真相；**不含** `providerProductIds`，渠道商品 id 不下发客户端）。定价页当前展示的是产品文案 `pricing.json`，两者由 `verify-billing.ts` §8 逐条核对一致 |
| `GET` | `/api/billing/orders` | 列出**自己**的订单（`?limit=&skip=`） |
| `GET` | `/api/billing/orders/[id]` | 取单个订单（只能取自己的） |
| `POST` | `/api/billing/webhook/[provider]` | 支付回调 |

### 11.1 兼容入口的处置（2026-10-10 复核）

| 路径 | 状态 |
|---|---|
| ~~`POST /api/payments/create-checkout`~~ | ✅ **已于 Phase 9.8.2-C 删除**（`src/app/api/payments/` 不存在）。定价页 `src/components/PricingContent.tsx:75` 现在 `fetch('/api/billing/checkout', { body: JSON.stringify({ packageId }) })`，由 `verify-billing.ts` 钉住 |
| ~~`POST /api/payment/create-session`~~ | ✅ **已于 Phase 9.3 删除**（Shipany 遗留，确认无调用方）。`src/app/api/payment/` 现在是**空目录**（git 不跟踪空目录，属本地残留 = 例外 E-10） |
| `POST /api/webhooks/stripe` | 仍存在 → 委托 `BillingService` |
| `POST /api/webhooks/payments` | 仍存在 → 识别渠道后委托 `BillingService` |

**标识符契约**（B 段，9.8.2-C 定稿）：

| 标识符 | 谁生成 | 出现在哪 | 谁解析 |
|---|---|---|---|
| `packageId`（`starter` / `plus_monthly` / …） | 产品套餐表 | **客户端 → 服务端**（稳定内部 id） | `getBillingPackage()` |
| `productId` + `billingCycle` | 产品套餐表 | 客户端 → 服务端（等价入口） | `findBillingPackage()` |
| `providerProductIds.creem`（`FluxKontext-Plus-Monthly`） | 产品套餐表 | **只在服务端与渠道侧**，绝不出现在请求体 | `getProviderProductId()` |
| `order.id` / `session_id` | 服务端 | 订单表 + webhook 匹配 | `orderRepo.findByProviderSession()` |

两条 webhook 入口（`/api/billing/webhook/[provider]` 与 legacy `/api/webhooks/*`）
都走同一套「验签 → 归一化事件 → 按 session 找单 → 幂等 claim → 履约」流程，
**本轮没有切换 API**，只把「价格与渠道商品 id 的来源」统一到了套餐表。

### 11.2 权限

用户只能访问自己的订单。权限在**数据层**强制，不依赖调用方判断：

```ts
getOrder(userId, orderId)  // 比对 order.user_id，不属于自己则返回 null → 404
listOrders(userId)         // 查询强制带 user_id 条件
```

返回 404 而不是 403 —— 不泄露「订单是否存在」。

### 11.3 迁移计划

`/api/payment/create-session` ✅ 已删除（Phase 9.3）。
`/api/payments/create-checkout` ✅ 已删除（Phase 9.8.2-C，前端 `PricingContent.tsx` 切到
`/api/billing/checkout` 之后适配器一并删除）。

**剩下 2 个兼容适配器要等渠道后台改 webhook 端点才能删**：
`/api/webhooks/stripe` 与 `/api/webhooks/payments` 取决于渠道后台配的是哪个 URL ——
删除前必须先在 Stripe / Creem 后台把 webhook 端点改到 `/api/billing/webhook/[provider]`，
否则会静默丢事件。**这一步需要真实渠道后台权限，本轮未做、也无法在本地验证。**

---

## 12. 金额处理

**统一使用整数最小单位（美分）**（用户约束 §20）。

```ts
// ❌ 禁止
const total = 19.99 * 100        // 1998.9999999999998

// ✅ 正确
const totalMinor = 1999          // 直接存整数
formatPriceMinor(1999)           // "$19.99"（用整数除法与取模）
```

| 字段 | 类型 | 用途 |
|---|---|---|
| `orders.amount_minor` | INTEGER | **权威金额**，新代码只读写它 |
| `orders.amount` | DECIMAL(10,2) | 展示用，由 `amount_minor` 派生，旧代码读取 |

两者由同一整数源派生，不会漂移。**产品套餐表**（`src/lib/products/<id>/billing.ts`）的 `priceMinor` 是唯一源头，经 `src/config/billing.ts` 的查询机制读出。

---

## 13. 验证

```bash
# 数据层：迁移 + Credit + Billing 闭环（真实 PostgreSQL via PGlite）
node supabase/scripts/verify_migrations.mjs        # 147 项检查

# 配置层：套餐 / 金额 / 架构守卫（不需要数据库）
node scripts/run-ts.mjs scripts/verify-billing.ts  # 51 项检查

# 迁移静态校验
python supabase/scripts/validate_migrations.py

# 项目级
npm run lint && npm run build
```

### 13.1 已覆盖的验收项

| 用户要求 | 覆盖位置 |
|---|---|
| 创建 checkout → pending order | B1 |
| 支付成功 → order = paid | B2 |
| 重复 Webhook → 订单只 paid 一次 | B3 + B4 |
| 重复 Webhook → 积分只加一次 | B6 |
| 购买积分 → 余额增加 + 流水 | B5 |
| 并发 Webhook → 只发一次积分 | B7 |
| 用户 A 不能读 B 的订单 | B9 |
| 客户端篡改 price/credits | 配置层测试 §7（架构守卫） |
| checkout 幂等 | B8 |
| 金额无浮点误差 | B10 + 配置层 §4 |
| 订单状态约束 | B11 |

### 13.2 未覆盖 / 未验证的部分

| 项 | 原因 |
|---|---|
| **真实渠道端到端**（Creem / Stripe 沙箱下单） | 本机无有效 API Key |
| **真实并行并发** | PGlite 单后端单连接，无法复现并行（见 `DATABASE.md` L-22） |
| **`BillingService` 的运行时行为** | 它依赖 Supabase 客户端，本机 Supabase 是占位地址；已验证的是它依赖的数据库层保证 |
| Webhook 验签的实际密钥 | 无有效 secret |

---

## 14. Phase 4 deferred（明确未做，用户约束 §26）

| 项 | 说明 |
|---|---|
| 自动续费 | 需定时任务 + 渠道订阅事件处理 |
| proration / 升降级 | 需明确的计价规则 |
| 优惠券 / 折扣 | — |
| 复杂退款（部分退款、积分扣回） | 需业务规则（见 §10） |
| 发票 / 税务 | — |
| 后台管理系统 | 管理员能力保持现状，不新增 |
| ~~定价配置收敛~~ | ✅ **已完成**（Phase 9.2 收敛，9.8.2-C 落位）：`payment-security.ts`、`services/pricing.ts`、整个 `src/lib/payment/` 均已删除；`user-tiers.pricingPlans` 随文件搬进 `products/flux-kontext/tiers.ts`。真相 = 产品套餐表，机制 = `src/config/billing.ts`（见 §2.3） |
| ~~前端切换到 `/api/billing/*`~~ | ✅ **已完成**（Phase 9.8.2-C）：`PricingContent.tsx` 调 `/api/billing/checkout` 且只发 `{ packageId }`，legacy `/api/payments/create-checkout` 已删除（见 §11.1） |
| ~~`lib/payment.ts` / `lib/payment/creem.ts` 的重复逻辑~~ | ✅ **已完成**（Phase 9.2）：旧文件全部删除，checkout 逻辑内联进 `billing/providers/{stripe,creem}.ts`，各自自包含 |
