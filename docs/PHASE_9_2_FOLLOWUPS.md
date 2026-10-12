# Phase 9.2 Follow-ups

> Phase 9.2 完成「Legacy Payment Cluster → Billing 收口」。本文件记录已完成与未处理事项。
> 配套：`PHASE_9_2_AUDIT.md`（改造前审计）。

---

## 1. Payment Architecture Before

```
API routes ──► BillingService ──► billing/providers/{stripe,creem}
                                        │
                                        ▼
                                  lib/payment/{stripe,creem}.ts   ← legacy（checkout 活 / webhook 死）
                                  + 一片 0 消费者的死代码（~2500 行）
```

## 2. Payment Architecture After

```
API / Webhook ──► BillingService ──► billing/providers/{stripe,creem}   ← 自包含
                        │                        │
                        ▼                        ▼
                 OrderRepository         Stripe / Creem API
                        │
                        ▼
        CreditRepository（fulfillment）/ SubscriptionRepository
```

## 3. Webhook Routing（实际入口）

### Stripe
| 项 | 值 |
|---|---|
| 实际入口 | `/api/webhooks/stripe`、`/api/billing/webhook/[provider]` |
| 最终 handler | `BillingService.handleWebhook('stripe', …)` |
| 是否已进入 Billing | ✅ 是 |

### Creem
| 项 | 值 |
|---|---|
| 实际入口 | `/api/webhooks/payments`、`/api/billing/webhook/[provider]` |
| 最终 handler | `BillingService.handleWebhook('creem', …)` |
| 是否已进入 Billing | ✅ 是 |

> **两个入口都保留**，未修改任何 webhook URL（见 F9.2-1）。

## 4. Deleted Files（18 个，src 231 → 213）

| 文件 | 行数 | 原因 |
|---|---|---|
| `src/lib/payment.ts` | 512 | 0 消费者 |
| `src/lib/payment-security.ts` | 536 | 仅被死的 payment.ts 用 |
| `src/lib/payment/stripe.ts` | 485 | checkout 已内联进 billing；webhook 无路由消费 |
| `src/lib/payment/creem.ts` | 685 | 同上 |
| `src/lib/payment/amount.ts` | 40 | 内联后无消费者 |
| `src/lib/services/affiliate.ts` | 160 | 仅被死的 payment.ts 用；表不存在 |
| `src/lib/services/pricing.ts` | 363 | 仅被死的 payment.ts 用 |
| `src/lib/services/payment-config.ts` | 270 | 仅被已删的 admin 路由用 |
| `src/lib/services/payment-database.ts` | 261 | 仅被已删的 admin 路由 + order-cleanup 用 |
| `src/lib/config/payment.ts` | 162 | 仅被上面两者用 |
| `src/lib/tasks/order-cleanup.ts` | 113 | 仅被已删的 admin/maintenance 用；无 cron |
| `src/lib/utils/response.ts` | 170 | 仅被 2 个已删 legacy admin 路由用 |
| `src/lib/utils/time.ts` | 19 | 消费者已删 |
| `src/lib/types/payment.ts` | — | 消费者已删 |
| `src/lib/types/pricing.ts` | 53 | 消费者已删 |
| `src/app/api/admin/maintenance/route.ts` | — | 0 消费者 |
| `src/app/api/admin/payment-config/route.ts` | — | 0 消费者 |
| `src/app/api/debug/users/route.ts` | 52 | 开发调试路由（规格 §12 优先删除） |

**目录清理**：`src/lib/payment/`、`src/lib/tasks/`、`src/lib/types/`、
`src/app/api/admin/{maintenance,payment-config}/`、`src/app/api/debug/users/`。

## 5. Migrated Files

| 文件 | 变更 |
|---|---|
| `src/lib/billing/providers/stripe.ts` | **内联** `createStripeCheckout` → 自包含 `createStripeSession()`；**修正 100× 金额 bug** |
| `src/lib/billing/providers/creem.ts` | **内联** `createCreemCheckout` → 自包含 `createCreemSession()` |
| `src/lib/billing/providers/index.ts` | 更新命名说明注释 |
| `src/lib/db/repositories/order.ts` | 更新「不校验价格」的归属说明（payment-security → Billing） |
| `scripts/verify-auth.ts` | 第 4 节改用现存 admin 路由 |
| `scripts/audit-unused-exports.mjs` | 更新示例注释 |

## 6. Tests

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npm run lint` | ✅ 0 错误 0 警告 |
| `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` | ✅ 全部路由生成（含 billing/webhook、webhooks/*） |
| `verify-workflow` / `ai-core` / `billing` / `storage` / `auth` / `admin` | ✅ 42 / ✅ / 78 / 20 / 28 / 45 |
| `verify_migrations.mjs` | ✅ 198/198 |
| `validate_migrations.py` | ✅ 通过 |
| `audit:dead-files` | ✅ 无新增 |
| `audit:architecture` | ✅ 10 目录 / 51 文件，无反向依赖 |

> `verify-admin` 47 → 45：脚本按 `src/app/api/admin/**/route.ts` **动态计数**，删除 2 个路由属预期。

---

## 7. Remaining（F9.2-X）

### F9.2-1 线上 webhook URL 注册位置未知
- **文件**：`src/app/api/billing/webhook/[provider]/route.ts`、`src/app/api/webhooks/{stripe,payments}/route.ts`
- **问题**：无法从代码判断支付平台后台实际注册的是哪个 URL。
- **原因**：部署配置 / 支付平台 Dashboard 不在仓库内。
- **风险**：中 —— 若误删某个入口会导致回调失效。**故三个入口全部保留。**
- **需要真实环境验证**：✅ 是（查 Stripe / Creem Dashboard 的 webhook endpoint 配置）
- **推荐阶段**：上线前运维核对

### F9.2-2 Stripe 100× 金额 bug 是否已影响线上
- **文件**：`src/lib/billing/providers/stripe.ts`（已修复）
- **问题**：迁移前 `unit_amount` 经二次换算被放大 100 倍（$4.90 → $490.00）。本次已修正。
- **原因**：`amountMinor`（最小单位）被传入按「标准单位」设计的 `formatAmountForProvider`。
- **风险**：高（若线上已跑过 Stripe）—— 需查历史订单金额，必要时退款。
- **需要真实环境验证**：✅ 是（Stripe Dashboard 历史订单）
- **推荐阶段**：**上线前必须核对**

### F9.2-3 支付 E2E 未验证
- **问题**：`Webhook → Order → Fulfillment → Credit → Subscription` 全链路未在真实环境跑通。
- **原因**：本机无真实 Stripe / Creem 凭据与 Supabase staging。
- **风险**：中
- **需要真实环境验证**：✅ 是
- **推荐阶段**：上线前回归

### F9.2-4 其余 8 个 debug 路由仍存在
- **文件**：`src/app/api/debug/{database,database-check,database-connection,database-status,env,oauth,simple-test,user-test}/route.ts`
- **问题**：开发调试路由；规格 §12 只点名 `debug/users`（已删）。
- **原因**：本阶段范围限定 Payment Legacy Cluster。
- **风险**：低 —— `src/proxy.ts` 已用 `ENABLE_DEBUG_ROUTES=true && NODE_ENV !== 'production'` 守卫，生产返回 404。
- **需要真实环境验证**：否
- **推荐阶段**：Phase 9.3 / 模板清理

### F9.2-5 定价定义仍有两处
- **文件**：`src/config/billing.ts`（服务端真相）vs `src/lib/user-tiers.ts`（UI 展示）
- **问题**：`user-tiers.ts` 的 `pricingPlans` 仍含价格，被 Flux UI 使用。
- **原因**：UI 展示层，改动会触及前端（本阶段禁止 UI 重构）。
- **风险**：低（仅展示，不参与扣款）；但两处可能漂移。
- **需要真实环境验证**：否
- **推荐阶段**：Phase 9.3（让 UI 从 `config/billing.ts` 派生）

### F9.2-6 Creem 渠道产品名与后台强耦合
- **文件**：`src/config/billing.ts` 的 `providerProductIds.creem`
- **问题**：值（如 `'FluxKontext-Plus-Monthly'`）必须与 Creem 后台产品名逐字一致，改后台需同步改代码。
- **原因**：Creem 的扣款金额由后台产品决定（与 Stripe 不同）。
- **风险**：中（不一致会导致 checkout 失败或金额错）
- **需要真实环境验证**：✅ 是
- **推荐阶段**：上线前核对 Creem 后台

### F9.2-7 i18n / SEO 的 Flux 文案（承接 Phase 8 F8-3）
- **文件**：`src/lib/content/*.json`、`src/lib/seo/metadata-generator.ts`
- **风险**：低
- **推荐阶段**：Phase 9.3

### F9.2-8 推荐（Affiliate）系统从未实现
- **问题**：`services/affiliate.ts` 已删（全 TODO、表不存在）。若将来需要推荐奖励，需**从零设计**（表 + Repository + 触发点）。
- **风险**：低（当前无功能损失）
- **推荐阶段**：产品决策后

### F9.2-9 过期订单无自动清理
- **问题**：删除 `order-cleanup.ts` 后，无定时任务清理 `expired` 订单。
- **原因**：该模块从未接入 cron（`vercel.json` 无 `crons`），删除**无功能回归**。
- **风险**：低
- **推荐阶段**：若需要，Phase 9.3 用 `orderRepo.listExpiredPending()` + cron 重新实现

---

## 8. 架构验证

```
API / Webhook → BillingService → PaymentProvider → OrderRepository → Supabase   ✅
BillingService → Fulfillment → CreditRepository（原子 RPC）/ SubscriptionRepository ✅
```
**禁止项**（`API → lib/payment.ts` / `payment/stripe.ts` / `payment/creem.ts` / generic payment database）
→ 已全部消除；`lib/payment/` 目录不存在。

## 9. NOT VERIFIED

- **NOT VERIFIED — requires real payment provider webhook environment**：
  支付 E2E（F9.2-3）、线上 webhook 注册（F9.2-1）、Stripe 金额 bug 线上影响（F9.2-2）、
  Creem 后台产品名一致性（F9.2-6）。
- 代码链路**静态确认成立**（`Webhook → Order → Fulfillment → Credit → Subscription`）。
