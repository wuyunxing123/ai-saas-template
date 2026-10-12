# Phase 9.2 Audit — Payment Legacy Cluster → Billing

> 只读审计（写于改造前）。目标：确认真实支付链路，把仍在用的能力收口到 Billing，
> 删除已无消费者的遗留代码。配套：`PHASE_9_2_FOLLOWUPS.md`。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| **真实 webhook 入口** | `/api/billing/webhook/[provider]`、`/api/webhooks/stripe`、`/api/webhooks/payments` —— **全部调用 `BillingService`** |
| Legacy `lib/payment/*` webhook handler | **0 个路由消费**（已被 Billing 取代） |
| Legacy `createStripeCheckout` / `createCreemCheckout` | **仍被 `billing/providers/*` 使用**（唯一活的 legacy 能力） |
| Billing 覆盖度 | ✅ 验签 / 事件解析 / 订单定位 / 幂等 / 交付 全部自足 |
| 可删除文件 | **17 个**（约 3757 行 + 3 路由） |
| 需迁移后再删 | `lib/payment/{stripe,creem}.ts` 的 checkout 函数 |
| **发现 1 个真实缺陷** | Stripe checkout 金额 **100× 放大**（见 §5） |

**核心结论**：Billing 层已在 Phase 4 完整接管支付链路。Legacy Payment Cluster 是**死代码**，
唯一仍被使用的能力是「创建 checkout」的两个函数——本阶段把它们内联进 Billing Provider，
然后整体删除。

---

## 1. Payment Architecture Before

```
                    ┌─────────────────────────────────────────┐
API routes ────────►│ BillingService (lib/billing/*)          │  ✅ 活
                    └───────────────┬─────────────────────────┘
                                    │ createCheckout
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ billing/providers/{stripe,creem}.ts     │
                    └───────────────┬─────────────────────────┘
                                    │ import
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ lib/payment/{stripe,creem}.ts (LEGACY)  │  ⚠️ 仅 checkout 活
                    │  ├ createStripeCheckout / createCreem…  │  ← 唯一活的能力
                    │  └ handleStripeWebhook / handleCreem…   │  ← 死（无路由消费）
                    └─────────────────────────────────────────┘

    另有一整片死代码（0 消费者）：
      lib/payment.ts            （512）  createPaymentSession + webhook 处理
      lib/payment-security.ts   （536）  价格校验 / 风控（仅被 payment.ts 用）
      lib/services/affiliate.ts （160）  推荐奖励（全 TODO，affiliateRecord 表不存在）
      lib/services/pricing.ts   （363）  仅被 payment.ts 用
      lib/services/payment-config.ts (270) 仅被 admin/payment-config 用
      lib/services/payment-database.ts (261) 仅被 admin/maintenance + order-cleanup 用
      lib/config/payment.ts     （162）  仅被上面两者用
      lib/tasks/order-cleanup.ts（113）  仅被 admin/maintenance 用
      lib/utils/response.ts     （170）  仅被 2 个 legacy admin 路由用
      lib/payment/amount.ts     （40）   仅被 payment/{stripe,creem}.ts 用
```

---

## 2. Webhook Routing（真实入口 —— 逐条确认）

### 2.1 Stripe

| 项 | 结论 |
|---|---|
| 实际入口 | `/api/webhooks/stripe`（44 行）+ `/api/billing/webhook/[provider]`（102 行） |
| 最终 handler | `BillingService.handleWebhook('stripe', rawBody, headers)` |
| 验签 | `StripeProvider.verifyWebhook()` → `stripe.webhooks.constructEvent`（`billing/providers/stripe.ts:77`） |
| 事件解析 | `StripeProvider.parseWebhookEvent()`（`:105`，`checkout.session.completed` → `payment_succeeded` 等） |
| 是否已进入 Billing | ✅ **是** |
| Legacy `handleStripeWebhook` | ❌ **无路由消费** |

### 2.2 Creem

| 项 | 结论 |
|---|---|
| 实际入口 | `/api/webhooks/payments`（111 行）+ `/api/billing/webhook/[provider]` |
| 最终 handler | `BillingService.handleWebhook('creem', …)` |
| 验签 | `CreemProvider.verifyWebhook()` → HMAC-SHA256 恒定时间比较（`billing/providers/creem.ts:86`） |
| 事件解析 | `CreemProvider.parseWebhookEvent()`（`:115`，`checkout.completed` → `payment_succeeded` 等） |
| 是否已进入 Billing | ✅ **是** |
| Legacy `handleCreemWebhook` | ❌ **无路由消费** |

### 2.3 Billing 覆盖度核对（规格 §8 / §9）

| 能力 | Billing 实现 |
|---|---|
| signature verification | ✅ Provider.verifyWebhook |
| event parsing | ✅ Provider.parseWebhookEvent |
| order lookup | ✅ `BillingService.handleWebhook` → `orderRepo.findByProviderSession`（`service.ts:308`） |
| idempotency | ✅ `webhookEventRepo.claim`（`:312`）+ `markPaidIfPending` + `credit_grant:<order_id>` 三层 |
| order paid | ✅ `orderRepo.markPaidIfPending`（`:384`） |
| credit grant | ✅ `fulfillOrder` → `creditRepo.grantCredits`（`fulfillment.ts:146`） |
| subscription activation | ✅ `fulfillOrder` → `activateSubscription`（`fulfillment.ts:189`） |

**结论**：Billing 已完整覆盖 legacy webhook 的全部能力。

---

## 3. Legacy 消费关系（谁调用谁）

```
admin/maintenance ──► order-cleanup ──► payment-database ──► (orderRepo)
                 └──► payment-database
admin/payment-config ──► payment-config ──► config/payment
lib/payment.ts ──► payment-security, services/pricing, services/payment-database,
                   services/affiliate, config/payment, stripe-client
lib/payment/{stripe,creem}.ts ──► payment/amount, types/payment, stripe-client
```

所有链路**终点都是死代码**（无外部消费者）。唯一例外：`billing/providers/*` → `payment/{stripe,creem}.ts`。

---

## 4. 删除清单（已逐项确认 0 消费者）

### A. 直接删除（0 消费者）
| 文件 | 行数 | 依据 |
|---|---|---|
| `src/lib/payment.ts` | 512 | 0 静态引用；仅被自己动态 import 的子模块引用 |
| `src/lib/payment-security.ts` | 536 | 仅被死的 `payment.ts` 引用 |
| `src/lib/services/affiliate.ts` | 160 | 仅被死的 `payment.ts` 动态引用；`affiliateRecord` 表不存在 |
| `src/lib/services/pricing.ts` | 363 | 仅被死的 `payment.ts` 引用 |
| `src/lib/services/payment-config.ts` | 270 | 仅被 `admin/payment-config` 引用 |
| `src/lib/services/payment-database.ts` | 261 | 仅被 `admin/maintenance` + `order-cleanup` 引用 |
| `src/lib/config/payment.ts` | 162 | 仅被上面两者引用 |
| `src/lib/tasks/order-cleanup.ts` | 113 | 仅被 `admin/maintenance` 引用；`vercel.json` 无 crons |
| `src/lib/utils/response.ts` | 170 | 仅被 2 个 legacy admin 路由引用 |
| `src/app/api/admin/maintenance/route.ts` | — | 0 消费者 |
| `src/app/api/admin/payment-config/route.ts` | — | 0 消费者 |
| `src/app/api/debug/users/route.ts` | 52 | 开发调试路由（`proxy.ts` 已守卫，但规格 §12 要求优先删除） |

### B. 迁移后删除
| 文件 | 处理 |
|---|---|
| `src/lib/payment/stripe.ts`（485） | 把 `createStripeCheckout` 内联进 `billing/providers/stripe.ts` → 删 |
| `src/lib/payment/creem.ts`（685） | 把 `createCreemCheckout` 内联进 `billing/providers/creem.ts` → 删 |
| `src/lib/payment/amount.ts`（40） | 内联后无消费者 → 删 |
| `src/lib/types/payment.ts` | 内联后无消费者 → 删 |

### C. 保留
| 文件 | 原因 |
|---|---|
| `src/lib/stripe-client.ts` | `billing/providers/stripe.ts` 仍使用 |
| `src/lib/user-tiers.ts` | Flux UI 使用（产品定价展示，非 legacy payment） |
| `src/lib/billing/*` | 目标架构 |

---

## 5. ⚠️ 发现的真实缺陷：Stripe 金额 100× 放大

**位置**：`src/lib/billing/providers/stripe.ts:45-49`（当前代码）

```ts
const result = await createStripeCheckout({
  amount: params.amountMinor,   // ← 已是「最小单位」（美分），如 490
  ...
})
```

而 `createStripeCheckout` 内部：
```ts
const formattedAmount = formatAmountForProvider(amount, currency); // Math.round(490 * 100) = 49000
```

`formatAmountForProvider` 的契约是「标准金额 → 最小单位」（`19.99 → 1999`）。
因此实际传给 Stripe 的 `unit_amount = 49000`，即 **$490.00 而非 $4.90 —— 放大 100 倍**。

对照：Creem Provider 传的是 `params.amountMinor / 100`（标准金额），**没有这个 bug**。

**处理**：内联 checkout 时按正确语义实现（`unit_amount = amountMinor`，不再二次换算）。
**风险**：Stripe 若非默认渠道则线上未暴露；修复是**纠正**而非行为回退。
**NOT VERIFIED**：无法在无真实 Stripe 环境确认线上是否已受影响。

---

## 6. 目标架构（After）

```
API / Webhook
    ↓
BillingService            (lib/billing/service.ts)
    ↓
PaymentProvider           (lib/billing/providers/{stripe,creem}.ts)   ← checkout 内联，自包含
    ↓
OrderRepository           (lib/db/repositories/order.ts)
    ↓
CreditService / SubscriptionRepository   (fulfillment.ts)
```

**禁止**：`API → lib/payment.ts` / `payment/stripe.ts` / `payment/creem.ts` / generic payment database。

---

## 7. NOT VERIFIED（需真实环境）

- **支付 E2E**：Stripe / Creem 真实 webhook → 订单 → 交付 → 积分 → 订阅。
  本机无真实支付凭据与 Supabase staging。
- **线上 webhook URL 注册**：`/api/billing/webhook/[provider]` vs `/api/webhooks/stripe`
  哪个在支付平台后台注册为回调 —— **需查部署配置 / 支付平台 Dashboard**。
  代码无法确定；两个入口都指向 `BillingService`，因此**两者都保留**，不修改任何 webhook URL。
- **Stripe 100× 金额 bug 是否已影响线上** —— 需查 Stripe Dashboard 历史订单金额。
