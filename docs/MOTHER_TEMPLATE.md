# Mother Template — 项目入口文档

> 更新时间：2026-10-10 · 对齐 **Phase 9.8.2-D**
> **这是接手本项目时应该第一个读的文档。**
>
> 事实来源：**当前代码**。历史文档（`docs/archive/ARCHITECTURE.md`、`docs/archive/`）只用于回溯「当时为什么那样做」，
> 与本文冲突时以本文与代码为准。
> 主题细节见 [`docs/README.md`](./README.md) 索引。

---

## 1. What is this

### 1.1 一句话

这是一个**可复用的 AI SaaS 母模板（Mother Template）**：认证、积分、支付、异步任务、存储、Admin、
i18n/SEO 基础设施都已抽象成 **Core**；具体产品放在 **Product Layer**。

**母版正式名称 = `ai-saas-template`**（npm 包名 / README 标题 / PWA 元数据 / 环境变量默认值统一）。
品牌名是另一件事：产品用 `NEXT_PUBLIC_PROJECT_NAME` 提供，Core 只读 `siteConfig.projectName`。
上游来源与许可归属（`LICENSE` 里保留上游作者的版权行）、Flux Kontext 这个示例产品的名字
**都不随改名变化** —— 逐条保留理由见 [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) §4.5。

当前仓库里只有一个产品：**Flux Kontext**（AI 图像生成/编辑）。

> **关键认知：Flux Kontext 只是 Product Layer，不是这个模板的身份。**
> Core 不依赖 Flux，这条规则由脚本守卫（`npm run verify:product-boundary`），不是口头约定。
> 换掉 `src/lib/products/flux-kontext/` 之后，Core 应当仍然完整可用 —— 这正是 Phase 9.8 要验证的事。

### 1.2 技术栈（实测版本）

| 项 | 值 |
|---|---|
| 框架 | **Next.js `^16.3.4`**，App Router |
| UI | React `^19.2.8` + Tailwind + shadcn 风格组件（`src/components/ui/`） |
| 语言 | TypeScript `^5.8.3`，`tsconfig.json` `strict: true` |
| 运行时 | Node `>=20.9.0`（`package.json` `engines`） |
| 数据库 | **Supabase PostgreSQL**（`@supabase/supabase-js ^2.105.1`） |
| ORM | **无。没有 Prisma，没有 `schema.prisma`。** 数据访问走手写 Repository 层 |
| 认证 | **NextAuth `^4.24.15`**（v4，不是 v5）+ Supabase Auth |
| 支付 | Stripe `^17.5.0`、Creem（纯 HTTP，无 SDK） |
| 对象存储 | Cloudflare R2（`@aws-sdk/client-s3 ^3.1041.0`） |
| AI Provider | fal / kie / wavespeed / atlascloud |
| 格式化 | Biome（`npm run format`，**手动**，不是门禁） |
| 测试框架 | **无 vitest / jest / playwright**。测试能力由自建 `scripts/verify-*.ts` harness 提供 |
| CI | **不在 GitHub 上跑**。门禁是本地 `npm run verify`（见 §8） |

### 1.3 ⚠️ 这不是你训练数据里的那个 Next.js

Next 16 有破坏性变更。最直接影响本项目的一条：

> **本仓库没有 `middleware.ts`。边缘层入口是 `src/proxy.ts`，导出 `proxy(request)`。**

写任何框架相关代码前，先读 `node_modules/next/dist/docs/`（根目录 `AGENTS.md` 有此要求）。
不要凭记忆假设 API、约定或文件结构。

### 1.4 这个模板**没有**什么

不要假设存在下列能力，它们**当前都没有**：

Kubernetes · Worker 集群 · 消息队列 · Temporal · 自动扩缩容 · 独立可观测性平台（APM/Tracing）·
分布式限流（限流是**单实例内存态**，见 §10.6）· 定时任务调度器（`vercel.json` 无 `crons`）·
覆盖率报告 · 浏览器 E2E 自动化。

---

## 2. Architecture

### 2.1 分层

```
┌─────────────────────────────────────────────────────────────────┐
│  Edge        src/proxy.ts（安全头 / HTTPS 跳转 / 限流 / 重写）     │
├─────────────────────────────────────────────────────────────────┤
│  Web / API   src/app/**  页面 + Route Handler（薄入口）           │
├─────────────────────────────────────────────────────────────────┤
│  Product     src/lib/products/<product>/                        │
│              产品业务规则 / 参数 / 文案 / SEO / 积分成本            │
│                        │  只能单向向下依赖                        │
├────────────────────────┼────────────────────────────────────────┤
│  Core        Service / Workflow 编排层                           │
│              WorkflowService · BillingService · StorageService   │
│              AIService · AdminService · CreditService            │
├─────────────────────────────────────────────────────────────────┤
│  Core        Provider 抽象层                                     │
│              AIProvider · PaymentProvider · StorageProvider      │
│              fal/kie/wavespeed/atlascloud · stripe/creem · r2    │
├─────────────────────────────────────────────────────────────────┤
│  Core        Repository 层  src/lib/db/repositories/*            │
├─────────────────────────────────────────────────────────────────┤
│  Infra       Supabase PostgreSQL · Cloudflare R2 · 第三方 AI API  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Core 模块地图

```
src/
├── config/                      ⭐ 服务端配置唯一真相（纯静态，0 处 process.env）
│   ├── billing.ts               套餐与价格（整数最小单位）
│   └── credits.ts               模型 → 积分成本
│
├── proxy.ts                     边缘层（Next 16 的 middleware 等价物）
│
├── app/                         页面 + API Route Handler
│   ├── api/ai/**                Core：通用 AI 任务 API
│   ├── api/billing/**           Core：下单 / 订单 / 支付 webhook
│   ├── api/webhooks/**          Core：webhook 入口
│   ├── api/user/**              Core：用户与积分
│   ├── api/admin/**             Core：Admin API（13 个）
│   ├── api/auth/**              Core：NextAuth
│   ├── api/upload               Core：上传
│   ├── api/verify-turnstile     Core：人机验证
│   ├── api/flux-kontext         ⚠️ Product：唯一的产品专属路由
│   ├── admin/**                 Admin 控制台页面（9 个）
│   ├── tasks/**, generate/**, pricing/**, dashboard/**, resources/**
│   ├── auth/signin, auth/signup, privacy, terms, refund
│   ├── <16 个 locale>/page.tsx  本地化首页
│   ├── sitemap.ts, robots.ts, llms.txt/, llms-full.txt/
│   └── layout.tsx, not-found.tsx
│
└── lib/
    ├── ai/                      ⭐ AI Core
    ├── workflow/                ⭐ 异步任务引擎
    ├── db/                      ⭐ Repository 层
    ├── billing/                 ⭐ 订单 + 支付 Provider + 履约
    ├── storage/                 ⭐ 对象存储抽象
    ├── admin/                   ⭐ Admin 授权 + 编排
    ├── services/credits.ts      ⭐ 积分领域服务（薄）
    ├── content/                 ⭐ i18n 机制 + 共享文案
    ├── content-safety/          ⭐ 内容安全（SafeMode）
    ├── seo/                     ⭐ SEO / llms.txt 生成机制
    ├── supabase/                ⭐ 客户端工厂（browser / server / admin）
    ├── utils/                   ⭐ hash / request 工具
    ├── auth.ts, auth-session.ts, auth-supabase.ts   ⭐ 认证
    ├── site-config.ts           ⭐ 站点品牌与 URL 派生
    ├── fal-client.ts            fal 队列 SDK 封装（被 ai/providers/fal.ts 使用）
    ├── stripe-client.ts         Stripe SDK 懒加载单例
    ├── utils.ts                 cn()
    └── products/
        └── flux-kontext/        🔶 Product Layer（唯一产品：模型目录 / 成本 /
                                  Provider 映射 / 档位 / 套餐 / 能力 / 文案）
```

### 2.3 依赖方向

```
Product  →  Core Service  →  Provider / Repository  →  Infra
```

**允许**：`Product → Core`

**禁止**：
- `Core → Product`（守卫：`verify:product-boundary` + `audit:architecture`）
- `Product → Product`（守卫：`verify:product-boundary` 的跨产品检查）
- `Product → Supabase / R2 SDK / 支付 SDK / 具体 AI Provider`（见 §5.2）
- `业务层 → Repository 以外的数据访问`（见 §7.4）

守卫认定的 **Core**（`scripts/verify-product-boundary.mjs`，Phase 9.8.2-C 起为**排除法**）：
`src/` 下除 `src/lib/products/**`（产品层）与 `src/app/**`（app 装配层）之外的**每一个**
`.ts`/`.tsx` —— 所以 `src/proxy.ts`、`src/lib/site-config.ts` 这类散落根文件**也在覆盖范围内**
（旧版手写 `CORE_DIRS` 白名单漏掉了它们，那才是 9.8.1 审计说的盲区）。

> 产品 UI 住在共享组件目录时（路径**或**文案点名了产品），守卫把它归为产品代码并计入
> `KNOWN_LAYOUT_DEBT`（当前 5 条，清单**只能缩小**）；一个不提任何产品名的通用模块 import
> 产品目录才是真正的反向依赖，直接失败。`vercel.json` 是部署配置、不是代码，由
> `scripts/verify-api-routing.ts` 覆盖。剩余已知例外见 §5.4。

---

## 3. Request Flow

### 3.1 AI 生成请求（同步等待结果）

以 Flux Kontext 为例，`POST /api/flux-kontext`：

```
Client
  → src/app/api/flux-kontext/route.ts        薄入口：auth + Turnstile + 参数校验
  → FluxKontextService.generate()            Product：action → modelId、参数归一化
  → WorkflowService.createTask()             Core：见下方 7 步
  → AIService.generate()                     Core：解析 provider → 派发
  → FalProvider / KieProvider / ...          Provider：厂商 API + 响应归一化
  → StorageService.saveGeneratedAsset()      Core：落 R2（未配置则保留厂商 URL）
  → TaskResult → 前端
```

`WorkflowService.createTask()` 的**真实执行顺序**（`src/lib/workflow/service.ts:70-175`）：

| # | 步骤 | 失败时 |
|---|---|---|
| 1 | `getModel(input.model)` 查模型目录 | `TaskError('UNKNOWN_MODEL')` |
| 2 | `AIService.resolveProvider({model, provider})` | `UNSUPPORTED_MODEL` |
| 3 | **幂等检查** `taskRepo.findByIdempotencyKey(userId, key)` | 命中 → 直接返回 `{task, deduplicated: true}` |
| 4 | **余额预检** `checkUserCredits(userId, model.credits)` | `INSUFFICIENT_CREDITS`（HTTP 402） |
| 5 | `taskRepo.create({status: 'pending', max_retries})` | — |
| 6 | **`chargeTask()` 扣积分**（是扣减，不是预授权） | 行直接置 `failed` 并抛出 |
| 7 | 派发：`waitForResult: true` → `processing` → `AIService.generate()` → `completeTask()`；否则 `submitTask()` 存 `provider_task_id` 后立即返回 | 失败 → `failTask()` → **退款** |

> **积分在创建时（`pending`）就扣，不是完成时扣。** 失败才退。这一点旧文档写错过。

### 3.2 异步任务：Webhook 与 Polling

**没有 worker，没有队列，没有 cron。** 两条惰性触发路径：

```
(A) Webhook
POST /api/webhooks/ai/[provider]
  → WorkflowService.handleWebhook({provider, rawBody, headers})
  → AIService.verifyWebhook()           各 Provider 自己验签
  → parseWebhookPayload()               解析失败返回 null → 400（不猜）
  → taskRepo.findByProviderTaskId()     找不到 → 404
  → 已终态 → {duplicate: true} 短路
  → completed → 重新 AIService.getTaskResult() → handleProviderResult()

(B) Polling
GET  /api/ai/tasks/[id]        仅当 status === 'processing' 且有 providerTaskId 时轮询一次
                               （'pending' 不触发轮询）
POST /api/admin/ai-tasks/poll  Admin 手动批量推进，pollRunningTasks(limit=50, cap 100)
```

验签实现：
- **kie** — HMAC-SHA256(base64) over `${taskId}.${timestamp}`，密钥 `KIE_WEBHOOK_SIGNING_SECRET`
- **wavespeed** — Svix 风格，HMAC-SHA256(hex) over `${webhookId}.${timestamp}.${rawBody}`，
  ±300s 重放窗口，密钥 `WAVESPEED_WEBHOOK_SECRET`
- **fal / atlascloud** — 无 webhook。路由在「配了密钥但验签失败」时返回 401，
  「无验签能力」时返回 501

**Retry**：`DEFAULT_MAX_RETRIES = 3`，指数退避 `min(5000 * 2^n, 60000)` 写入 `next_retry_at`。
不可重试错误码集合 `NON_RETRYABLE`：`INVALID_REQUEST`、`UNKNOWN_MODEL`、`UNSUPPORTED_MODEL`、
`PROVIDER_AUTH_FAILED`、`INSUFFICIENT_CREDITS`、`PROVIDER_NO_ASYNC_SUPPORT`、`CONTENT_REJECTED`。

> ⚠️ 已知实现落差：`failTask()` 会**立即**调用 `submitTask()`，退避时间只写库不等待；
> `taskRepo.findRetryableTasks()` **零调用方**，`next_retry_at` 目前无人消费。
> 记录于 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)，本阶段未修改。

### 3.3 商业闭环

```
User 选套餐
  → POST /api/billing/checkout          （唯一入口；legacy /api/payments/create-checkout 已于 9.8.2-C 删除）
  → getBillingUser()
  → BillingService.createCheckout()
      · resolveRequestedPackage()       客户端只发内部 packageId（或 productId + billingCycle），
                                        价格从**已绑定的产品套餐表**读出
                                        （数据 src/lib/products/<id>/billing.ts，
                                         查询机制 src/config/billing.ts），
                                        请求体里的 price/amount/credits 一律不读
      · getPaymentProvider() / resolveDefaultPaymentProvider()
      · 幂等键：客户端传，否则 auto:<userId>:<pkgId>:<60s 时间桶>
      · orderRepo.create({status:'pending', amount_minor, amount: priceMinor/100})
      · provider.createCheckout()       → checkoutUrl
  → 用户在渠道侧付款
  → POST /api/billing/webhook/[provider]
  → BillingService.handleWebhook()
      · provider.verifyWebhook()        Stripe: constructEvent；Creem: HMAC-SHA256 timingSafeEqual
      · provider.parseWebhookEvent()    → NormalizedPaymentEvent
      · orderRepo.findByProviderSession()
      · webhookEventRepo.claim()        唯一 (provider, event_id)；23505 → 重复事件
      · payment_succeeded → orderRepo.markPaidIfPending() → fulfillOrder()
      · payment_failed / cancelled → updateStatusIfPending()
      · refunded → 只改状态，**不回收积分**
  → fulfillOrder()
      · credit_pack  → creditRepo.grantCredits(key: credit_grant:<order_id>) → markFulfilled()
      · subscription → 同样发放 + activateSubscription()
                       （按 provider_subscription_id 幂等；周期 +1 月/年；**不按天折算**）
```

**金额单位规则（Phase 9.2 修过 100× bug，务必遵守）**：

- 全链路用**整数最小单位** `priceMinor`（美分），禁止浮点。
- Stripe：`unit_amount: params.amountMinor` **直接赋值，不再 ×100**。
- `orders.amount`（DECIMAL）是派生展示值 = `priceMinor / 100`。
- Creem：**忽略**我们传的金额（`original_amount` 仅元数据），权威价格以 Creem 后台产品为准。

**幂等三层**：`webhook_events`（事件级）→ `orders.idempotency_key`（下单级）→
`credit_transactions` 唯一索引（流水级）。

---

## 4. Core responsibilities

每个模块按 **What / Why / Where / How / Boundary** 描述。深度细节见对应主题文档。

### 4.1 AI

- **What**：厂商无关的 AI 生成抽象。
- **Why**：4 家厂商的请求格式、鉴权、异步语义、返回结构完全不同；业务不该感知。
- **Where**：`src/lib/ai/`（`types.ts` 契约 · `models.ts` 目录 · `service.ts` 编排 ·
  `normalize.ts` 归一化 · `utils.ts` 辅助 · `providers/*` 实现）
- **How**：`AIService`（**对象字面量，不是 class**）暴露
  `generate / submitTask / getTaskResult / verifyWebhook / uploadFile / resolveProvider`。
  `AIProvider` 接口只有 `generate()` 是必需的，`uploadFile / submitTask / getTaskResult /
  verifyWebhook` 全部可选。
  Provider 选择优先级：显式 `request.provider`（必须在 `model.providers` 内，否则抛错）
  → 环境变量 `AI_PROVIDER` / 旧名 `IMAGE_GENERATION_PROVIDER` → `model.defaultProvider`。
  **没有静默 fallback，没有故障转移链。**
  `generate / submitTask` 在**派发之前**用 `requireContractInputImages(model, request)`
  校验 `requiredInputImages`（9.8.2-D）：这条契约原先只是声明，fal / wavespeed 的请求构造
  按「带了几张图」分支，缺图时不报错而是把必须带图的模型降级成文生图 —— 结果不对、积分照扣。
  校验放在统一入口，行为就不再由「哪家引擎恰好检查了」决定。
- **Boundary**：
  - `AIService` **不做** 鉴权、积分、计费、数据库、错误码映射 —— 那些是 Workflow 层的职责。
  - Provider **不得知道** Flux、Product、积分业务规则、Billing、UI。
  - 业务层禁止直接 import `@/lib/ai/providers/*`，只能走 `AIService`。
  - ⚠️ ~~例外（有意为之）：`src/lib/ai/models.ts` 从 `@/config/credits` 读每个模型的 `credits`，
    所以**模型目录携带价格数据**（是配置数据，不是计费逻辑）。~~
    **已消解（Phase 9.8.2-C）**：`src/config/credits.ts` 已删除，`models.ts` 只剩**查询机制**
    （`getModel` / `listModels` / `isModelSupportedBy` 全部读 `getProductConfig().models`），
    模型清单与每个模型的积分成本住在 `src/lib/products/flux-kontext/catalogue.ts`。
    未命中模型 id 依旧**抛错**，不回退。
- **深度**：[`AI_CORE.md`](./AI_CORE.md) —— 含「如何新增 Provider」完整步骤。

### 4.2 Workflow

- **What**：AI 异步任务的生命周期编排。
- **Why**：把「扣积分 → 派发 → 收结果 → 落存储 → 结算/退款 → 重试」这套状态机从产品和路由里抽出来，
  只实现一次。
- **Where**：`src/lib/workflow/`（`service.ts` 684 行 · `state-machine.ts` · `settlement.ts` ·
  `result.ts` · `storage.ts` · `errors.ts` · `logger.ts` · `webhook-payload.ts` · `types.ts`）
- **How**：`WorkflowService`（同样是对象字面量）暴露
  `createTask / submitTask / handleProviderResult / handleProviderFailure / handleWebhook /
  pollTask / pollRunningTasks / getTask / listUserTasks`。
  状态机：`pending | processing | completed | failed | cancelled`，
  终态 = `completed / failed / cancelled`；
  合法迁移 `pending → processing|failed|cancelled`、`processing → processing|completed|failed|cancelled`
  （`processing → processing` 就是重试）。
  迁移在**两处**强制：`assertTransition()` 与 `taskRepo.transitionStatus()`
  （后者自动写 `started_at` / `completed_at`，`from === to` 时短路返回 `changed: false`）。
  结果落库经 `persistResult()` → `StorageService.saveGeneratedAsset()`；
  存储失败则回退保留厂商 URL，**不让任务因此失败**。
  日志 `logTaskEvent` / `logTaskError` 使用固定事件名，并对 prompt / apiKey / token / secret 脱敏。
- **Boundary**：Workflow 可以调 `AIService`、`StorageService`、Credit 与 Repository；
  **不得** import 任何 `@/lib/products/*`；不得自己实现厂商 HTTP 调用。
- **深度**：[`WORKFLOW.md`](./WORKFLOW.md)。

### 4.3 Credit

- **What**：积分余额、流水与原子扣减/发放。
- **Why**：钱相关的操作必须原子且幂等，否则并发下会重复扣或重复发。
- **Where**：
  - 价格真相：产品的模型目录 `src/lib/products/<id>/catalogue.ts` 的 **`credits`** 字段
    （UI 展示与 `WorkflowService` 扣减读同一个值）；action → 模型 id 的映射与
    `getRequiredCredits()` 也在产品层（`products/<id>/credits.ts`），未登记 action
    或未登记成本一律**抛错**，不再回退到某个默认价格
  - 账本：`src/lib/db/repositories/credit.ts`
  - 薄领域服务：`src/lib/services/credits.ts`（只有 `checkUserCredits` / `consumeUserCredits`）
  - 任务侧封装：`src/lib/workflow/settlement.ts`（`chargeTask` / `refundTask`）
- **How**：**原子性由 Postgres RPC 保证，不是应用层事务。**
  `getDb().rpc('consume_credits', …)` → `supabase/migrations/0005_atomic_credit_operations.sql`：
  1. 先 `INSERT … ON CONFLICT DO NOTHING RETURNING id` 占位 `(user_id, idempotency_key)`
     （唯一索引 `uniq_credit_transactions_idempotency`）；拿不到 id → 返回 `'duplicate'`；
  2. 再用**单条条件语句**完成「检查 + 扣减」：
     `UPDATE users SET credits = COALESCE(credits,0) - p_amount WHERE id = p_user_id
     AND COALESCE(credits,0) >= p_amount RETURNING credits`；
     `NOT FOUND` → 返回 `'insufficient'` 并删除占位行。
  3. `balance_before` 由 `balance_after + p_amount` 反推（READ COMMITTED 下先读后写不安全）。

  返回状态：`ok | insufficient | duplicate | invalid_amount | user_not_found`。
  `grant_credits`（迁移 0006）对称。
  幂等键约定：任务侧 `task:<taskId>:charge` / `task:<taskId>:refund`；
  订单侧 `credit_grant:<order_id>`。
- **Boundary**：
  - 余额存在 **`users.credits`** 列上 —— **没有 `credit_accounts` 表**，这是有意设计。
  - 消费只能用 `consumeCredits()`，发放/退款只能用 `grantCredits()`。
  - `adjustBalance()` **非原子**，禁止用于消费路径（仅 Admin 手工调整）。
  - 产品层只能提供「这个 action 要多少积分」，**不得自己实现扣减**。
- **深度**：[`DATABASE.md`](./DATABASE.md)。

### 4.4 Billing

- **What**：订单、支付渠道适配、webhook、履约。
- **Why**：把「多渠道 + 幂等 + 履约」收敛成一条闭环，价格只有一个真相。
- **Where**：`src/lib/billing/`（`service.ts` · `fulfillment.ts` · `session.ts` · `headers.ts` ·
  `types.ts` · `providers/{index,stripe,creem}.ts`）；**机制**在 `src/config/billing.ts`，
  **套餐数据**（含支付渠道商品 id）在产品目录 `src/lib/products/<id>/billing.ts`。
- **How**：`PaymentProvider` 接口（`billing/types.ts:93`）5 个成员：
  `readonly name`、`isConfigured()`、`createCheckout(params)`、`verifyWebhook(rawBody, headers)`、
  `parseWebhookEvent(rawBody, headers)`。
  两个实现：`StripeProvider`（`isStripeAvailable()`）、`CreemProvider`（需 `CREEM_API_URL` + `CREEM_API_KEY`）。
  Phase 9.2 之后**每个 provider 自包含**，不再有共享的 legacy checkout 文件。
  `src/config/billing.ts` 只剩**查询机制**：`getBillingPackage / findBillingPackage /
  listBillingPackages / getProviderProductId / getFreePlan / formatPriceMinor / toMinorUnits`
  全部读**已绑定的** `getProductConfig().billingPackages` 与 `.freePlan`
  （Flux 当前 7 个付费套餐 `starter` `creator` `business` `plus_monthly` `plus_yearly`
  `pro_monthly` `pro_yearly` + 1 个免费档 `basic`）。数据不在 Core，未知 id **抛错**。
- **Boundary**：
  - 价格**只能**由服务端从已绑定的产品套餐表解析；checkout 路由**永不**从请求体读
    price / amount / credits（`scripts/verify-billing.ts` 静态守卫这一点）。
    客户端只发**稳定内部标识符** `packageId`（或 `productId` + `billingCycle`），
    支付渠道商品 id 由服务端 `getProviderProductId()` 读出，**绝不出现在请求体或客户端**。
  - 业务层禁止直接 import 支付渠道 SDK；Stripe SDK 只在 `src/lib/stripe-client.ts` 懒加载。
  - 产品层不得自己实现 Billing。
- **深度**：[`BILLING.md`](./BILLING.md)。

### 4.5 Storage

- **What**：统一对象存储抽象。
- **Why**：业务不该知道 R2 / S3 SDK 的存在，将来换存储只动一个 provider。
- **Where**：`src/lib/storage/`（`service.ts` · `types.ts` · `keys.ts` · `errors.ts` ·
  `providers/{index,r2}.ts`）
- **How**：`StorageService → StorageProvider → R2StorageProvider`。
  Object Key 规范：`{namespace}/{userId}/{resourceId?}/{timestamp}-{random}.{ext}`，
  `namespace ∈ {uploads, generated, temporary}`；
  `buildObjectKey / sanitizeFilename / generateFilename / validateKey` 负责构造与防目录穿越。
  **Storage 是可选的**：未配置 R2 时，生成结果只保留 Provider 原始 URL，功能不中断。
- **Boundary**：全仓库**唯一**允许 import `@aws-sdk/client-s3` 的文件是
  `src/lib/storage/providers/r2.ts`（`scripts/verify-storage.ts` 守卫）。
  产品层不得直接操作 R2。

### 4.6 DB / Repository

- **What**：Postgres 访问层。
- **Why**：把 SQL/表结构知识关在一层里；业务代码面对的是实体函数，不是表。
- **Where**：`src/lib/db/`（`client.ts` · `types.ts` · `repositories/*`）
- **How**：
  - `client.ts` → `getDb()` 包装 `createAdminClient()`（`src/lib/supabase/server.ts`，
    **service_role，server-only**）；另有 `isDatabaseConfigured()`、`getDatabaseConfigIssue()`、
    `DatabaseConfigError`、`TABLES`。
  - `types.ts` 是**手写行类型**（`UserRow` `CreditTransactionRow` `OrderRow` `SubscriptionRow`
    `AiTaskRow` `WebhookEventRow` `AdminAuditLogRow` + 各状态联合类型），与 migrations 一一对应。
  - 7 个 Repository：`user` `credit` `order` `subscription` `ai-task` `webhook-event`
    `admin-audit-log`。函数参数镜像列名（snake_case）。
- **Boundary**：
  - **业务代码不得绕过 Repository 直接操作数据库。**
  - ~~`src/lib/database.ts`（伪 Prisma 适配器）~~ **已于 Phase 9.1 删除，不允许复活**；
    `npm run audit:architecture` 会检查该文件不存在、且无人 import `@/lib/database`。
  - ⚠️ 当前有 **2 个路由违反此规则**，见 §5.4。
- **深度**：[`DATABASE.md`](./DATABASE.md)。

### 4.7 Auth

- **What**：登录、会话、以及「session → 业务用户」的唯一入口。
- **Where**：`src/lib/auth.ts`（NextAuth `authOptions`、`providerMap`）、
  `src/lib/auth-session.ts`（`getSessionIdentity` / `getCurrentUser` / `getCurrentUserId`）、
  `src/lib/auth-supabase.ts`（Supabase 侧注册/登录/登出/状态订阅）、
  `src/types/next-auth.d.ts`（session 类型增强）、`src/app/api/auth/**`。
- **How**：NextAuth v4。Session 已注入 `user.id`（Phase 6）。
  `getCurrentUser()` **优先用 `session.user.id`（主键）**，email 仅作老 session 兜底。
  凭据登录由 `NEXT_PUBLIC_AUTH_CREDENTIALS_ENABLED` 控制；GitHub / Google OAuth 各自有开关。
  开发环境后门账号受 `NODE_ENV` 保护（`scripts/verify-auth.ts` 守卫）。
- **Boundary**：
  - 权限判断只认 **`users.role`**（迁移 0007），**不认 email 后缀、不认请求体里的 userId**。
  - `ADMIN_EMAILS` 只是 bootstrap 白名单，不是运行时权限来源。
  - 产品层不得自己实现 Auth。
  - `users` 表**没有 `password` 列**，任何写 password 的代码都是错的。

### 4.8 Admin

- **What**：Admin 授权边界、控制台编排、审计日志、分页约定。
- **Where**：`src/lib/admin/`（`api.ts` 的 `withAdmin` · `authorization.ts` 的
  `requireAdmin` / `isAdmin` / `getAdminContext` · `service.ts` · `pagination.ts` · `errors.ts`）；
  页面 `src/app/admin/**`（9 个），API `src/app/api/admin/**`（13 个），
  组件 `src/components/admin/**`；审计表 `admin_audit_logs`（迁移 0008）。
- **How**：所有 `/api/admin/*` 路由都必须包在 **`withAdmin`**（来自 `src/lib/admin/api.ts`）里。
  `AdminService` 提供 `listUsers / getUserDetail / listOrders / grantCredits / listSubscriptions /
  listAiTasks / listAuditLogs`，并有 `MAX_ADMIN_CREDIT_ADJUSTMENT` 上限。
  分页统一 `parsePagination` / `toPaginated`。
- **Boundary**：Admin 页面**不得**直接访问数据库；积分调整必须走原子 RPC；
  service_role key 不得出现在客户端代码。以上均由 `scripts/verify-admin.ts` 静态守卫。

### 4.9 i18n / Content

- **What**：多语言**机制**（不含产品文案）。
- **Where**：`src/lib/content/locale.ts`（机制）+ `src/lib/content/{index.ts,auth.json,common.json}`
  （跨产品共享文案）。
- **How**：`SUPPORTED_LOCALES`（16 个）、`DEFAULT_LOCALE = 'en'`、`LOCALE_NAMES`、`LOCALE_FLAGS`、
  `isSupportedLocale`、`getLocaleFromPathname`、`getLocalizedPath`、`removeLocaleFromPathname`、
  `getTextDirection`（RTL 支持）、`getFontFamily`。
  本地化首页是 **16 个独立的 `src/app/<locale>/page.tsx`**，各自内联字典。
- **Boundary**：`locale.ts` 是**纯机制**，Phase 9.4 之后不含任何产品文案；
  产品文案在 `src/lib/products/<product>/content/`。
- ⚠️ 已知落差：产品的 `content/*.json` 目前**只有英文**，
  即「16 locale 的机制」与「单语言的产品内容」并存。见 §5.4。
  （原先 `home-config.ts` 里 `getDictionary(locale)` 忽略入参、恒返回 `EN_DICTIONARY` 的重复
  已随 Phase 9.8.2 删除该文件而消失；语言页现在各自内联字典并传 `dictionary` prop。）

### 4.10 SEO

- **What**：多语言 metadata、sitemap、`llms.txt` 生成机制。
- **Where**：`src/lib/seo/metadata-generator.ts`（`generateMultilingualMetadata`、
  `generateMultilingualSitemap`、`generateLocalizedHomeMetadata`、`PAGE_CONFIGS`）、
  `src/lib/seo/llms.ts`（`buildLlmsText` / `buildLlmsFullText`）；
  路由 `src/app/sitemap.ts`、`robots.ts`、`llms.txt/`、`llms-full.txt/`。
- **Boundary**：机制在 Core，**页面标题/关键词等文案在各页面文件与产品 `content/seo.json`**。
- ⚠️ 已知缺陷：`sitemap.ts:14` 与 `robots.ts:22` 都列了 `/features`，
  但 `src/app/features/` **不存在** → 对外暴露 404。见 §5.4。

### 4.11 Config

- **What**：服务端**配置机制**的唯一真相（形状 + 校验 + 查询），不是产品数据的存放处。
- **Where**：`src/config/product.ts`（`ProductConfig` 形状、`bindProductConfig()`、
  `getProductConfig()`、`validateProductConfig()`）、`src/config/billing.ts`（套餐查询机制）；
  站点品牌与 URL 在 `src/lib/site-config.ts`。**价格 / 积分成本 / 套餐 / Provider 映射的
  数据**在产品目录（`catalogue.ts` / `billing.ts` / `providers.ts`）。
- **How**：`src/config/` 是**纯静态**的 —— 该目录下 `process.env` 读取数为 **0**。
  产品配置在**每个服务端入口**的 `src/app/product-runtime.ts` 里绑定一次；未绑定就抛错。
  `siteConfig` 提供 `projectName / siteUrl / apiBaseUrl / assetBaseUrl / supportEmail /
  githubRepoUrl / twitterHandle / socialLinks`，并有 `withSiteUrl / withApiUrl / withAssetUrl /
  mailtoSupport / replaceSiteTokens` 派生函数；未显式配置时从站点地址派生。
- **Boundary**：Core 不得携带某个产品的价格、模型清单或套餐 id；产品数据**只能**住在
  `src/lib/products/<id>/`，由 Core 的机制读出。详见 §6。

### 4.12 Edge（proxy）

- **What**：安全头、HTTPS 跳转、限流、版本前缀剥离、debug 路由开关。
- **Where**：`src/proxy.ts`，`config.matcher = ['/api/:path*']`。
- **How**：
  - `/api/debug/*` 默认 404，除非 `ENABLE_DEBUG_ROUTES=true` **且**非 production。
  - production 下 `x-forwarded-proto: http` → 301 到 https（localhost 例外）。
  - 安全头：`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、
    `X-XSS-Protection`、`Strict-Transport-Security`（1 年 + includeSubDomains）、完整 CSP。
  - 内存限流，按 `${ip}:${bucket}` 独立计数：`api` 10 次/60s、`auth` 5 次/300s、`payment` 3 次/600s。
  - `/api/v1/<rest>` → `/api/<rest>`：**通用版本前缀剥离**，保留查询参数，不含任何产品判断。
    产品自己的公共路径由**产品作用域的路由文件**承接（Flux：
    `src/app/api/flux/[[...path]]/route.ts`），而不是在 Edge 层列产品清单。
- **Boundary**：✅ **`proxy.ts` 已不含产品语义**（Phase 9.8.2-B 消解了例外 E-1；
  源码里 `flux` / `text-to-image` / `edit-image` 命中数为 0，由
  `scripts/verify-api-routing.ts` 守着）。自 9.8.2-C 起它**也落在排除法 Core 集合内**，
  所以反向 import 产品目录会被 `verify-product-boundary.mjs` 拦下。⚠️ 遗留：v1 分支提前
  `return NextResponse.rewrite(...)`，因此
  `/api/v1/*` **既不进限流桶也不带安全头**（本轮新记 **F9.8.2B-1**，改前即如此，
  本阶段刻意未修，见 PROJECT_STATUS §10.1）。

---

## 5. Product responsibilities 与 Core / Product 边界

### 5.1 Product 可以包含

- 产品业务规则（例如「哪些 action 合法」「参数取值范围」）
- 产品参数与 action 词表（`types.ts` / `actions.ts`）
- 产品页面与组件（`src/app/<page>`、`src/components/<product>/`）
- 产品文案（`content/*.json`）
- 产品 SEO 数据（`content/seo.json`）
- 产品专属 Service（编排 Core，不重造 Core）
- 产品专属 actions / 适配函数
- 产品专属 API 路由（薄入口）
- **（9.8.2-C 起）产品数据本体**：模型目录与**每个模型的积分成本**（`catalogue.ts`）、
  Provider 的模型 id / 端点 / LoRA **映射表**（`provider-data.ts`）与实例装配（`providers.ts`）、
  套餐与**支付渠道商品 id**（`billing.ts`）、档位与**产品能力**（`tiers.ts` / `capabilities.ts`，
  可用模型与宽高比）、拼装出的 `ProductConfig`（`config.ts`）
  —— Core 只提供这些数据的**形状、校验与查询机制**，不再持有任何一份数值。
- **（9.8.2-D 起）产品自己的登记**：`vocabulary.ts`（该产品的识别词汇，供
  `verify-product-config.ts` 扫 Core —— 词表来自被验证的产品，不再由守卫写死）、
  `layout-debt.json`（住在共享目录但属于本产品的文件清单，`verify-product-boundary.mjs`
  与 `audit-dead-files.mjs` 共用这一份），以及 `scripts/verify-<product>.ts`
  头部那行 `// @product-scope <product-id>`（产品专属回归的归属声明）。

**当前唯一产品的实际布局**（`src/lib/products/flux-kontext/`）：

```
config.ts         FLUX_KONTEXT_PRODUCT：把下面四块拼成 ProductConfig 交给接缝绑定
catalogue.ts      10 个模型 + 每个模型的 credits（唯一价格真相；纯数据，客户端可 import）
provider-data.ts  各厂商的「产品模型 → 厂商模型名 / endpoint / LoRA」映射表
providers.ts      用 Core 的引擎类 + 上面的映射表构造 FLUX_PROVIDERS（服务端专用）
billing.ts        7 个付费套餐 + FLUX_FREE_PLAN（含 providerProductIds 渠道商品 id）
tiers.ts          档位（UserType）与限制：modelsAllowed、图片数、features、
                  getUpgradeSuggestion 与 pricingPlans（原 Core 的 src/lib/user-tiers.ts）
capabilities.ts   产品的宽高比词表（13 项 + 校验 + 默认 fal 尺寸）—— Core 不写死 pro / max
service.ts        FluxKontextService（class，静态方法）+ FluxProductError
actions.ts        ACTION_TO_MODEL / isKnownAction / isFluxKontextAction / actionToModelId
                  ⚠️ 不是 Next.js server actions，没有 'use server'
credits.ts        getRequiredCredits(action) → 读 catalogue 的 credits（未登记即抛错）
types.ts          FLUX_KONTEXT_ACTIONS、参数与结果类型
content/          index.ts + home.json / generator.json / pricing.json / seo.json
index.ts          barrel；文件头写明依赖方向规则

（Phase 9.8.2：`home-config.ts` 已删除 —— 它的 `HomeDictionary` 形状上移到 Core 的
 `src/lib/content/contracts.ts`，`EN_DICTIONARY` 是 `content/home.json` 的重复副本、0 消费者。）
```

它的外部面：`src/app/api/flux-kontext/route.ts`（唯一产品路由）、
**`src/app/product-content.ts`（唯一内容装配点，Phase 9.8.2 起）**、
`src/components/FluxKontextGenerator.tsx`、`src/components/flux-kontext/*`、
`src/app/generate/page.tsx` + 定价/法务等页面里的产品文案。

`FluxKontextService.generate()` 的实际 Core 依赖（**这就是正确姿势**）：

```ts
import { listAIProviderNames } from '@/lib/ai/providers'
import { AIService }            from '@/lib/ai/service'
import { checkUserCredits }     from '@/lib/services/credits'
import { StorageService }       from '@/lib/storage/service'
import { WorkflowService }      from '@/lib/workflow/service'
import type { AITask, TaskAsset } from '@/lib/workflow/types'
```

### 5.2 Product 禁止

| 禁止 | 正确做法 |
|---|---|
| 直接操作 AI Provider（`@/lib/ai/providers/*`） | 走 `AIService` / `WorkflowService` |
| 直接操作 R2 / S3 SDK | 走 `StorageService` |
| 直接创建 Supabase 客户端 / 写 SQL | 走 `src/lib/db/repositories/*` |
| 自己实现积分原子扣减 | 走 `WorkflowService`（内部 `consume_credits` RPC） |
| 自己实现 Billing / 读请求体里的价格 | 走 `BillingService`；价格由服务端从**产品套餐表**（`src/lib/products/<id>/billing.ts`，经 `src/config/billing.ts` 的查询机制）解析 |
| 自己实现 Auth / 从请求体读 userId 当身份 | 走 `getCurrentUser()` / `withAdmin` |
| **修改 Core 来适配自身业务** | 在 Product 层解决；确实需要 Core 能力时，先抽象成通用能力再改 Core |
| import 另一个 Product | 无例外 |

> **实测结论（Phase 9.7 审计）**：`src/lib/products/**` 里
> **没有** `@supabase/*`、R2/S3 SDK、支付 SDK、厂商 provider 的 import。
> **9.8.2-C 复核**：Core → Product 的 import 数为 **0**，且产品目录的 `process.env`
> 读取数从 2 → **0**（`AI_PROVIDER` / `IMAGE_GENERATION_PROVIDER` 的选择逻辑归
> `src/lib/ai/service.ts`；各厂商 base URL 与轮询时序在 `src/lib/ai/providers/*.ts`
> **请求时**读取，不在模块加载时冻结）。

### 5.3 哪些代码允许 / 禁止依赖 Product

| 层 | 允许依赖 Product？ |
|---|---|
| `src/lib/products/<self>/` | ✅ 自身 |
| `src/lib/products/<other>/` | ❌ 禁止（Product → Product） |
| `src/` 下除 `src/lib/products/**`、`src/app/**` 之外的全部 `.ts`/`.tsx`（含 `src/lib/*` 根文件、`src/proxy.ts`、`src/components/**`、`src/config`） | ❌ **禁止**（9.8.2-C 起为排除法覆盖，守卫 `verify-product-boundary.mjs`） |
| `src/app/**`（路由 / 页面 / 装配点 `product-runtime.ts`、`product-content.ts`） | ✅ 允许（守卫把它当**装配层**，不算 Core）。约束由 `verify-product-seam.mjs` 承担：每个服务端入口的闭包里必须有接缝；客户端组件可以 import 产品的**纯数据**（`catalogue.ts` 的 `credits`、`content/*`），**不得**触达服务端配置（`@/config/product`、`providers.ts`） |
| `vercel.json` | ⚠️ 不是代码，不受 import 守卫覆盖；由 `scripts/verify-api-routing.ts` 兜底 |

### 5.4 已知边界例外（诚实记录，本阶段未修改）

这些是 Phase 9.7 审计发现的**真实耦合**。按规格要求「发现架构问题只记录、不扩大范围解决」，
当时全部原样保留，详见 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。
**现状（2026-10-10）**：E-1 / E-2 由 Phase 9.8.2-B 消解；**E-3 / E-4 / E-5 由 9.8.2-C 消解**
（模型清单与积分成本搬进 `products/flux-kontext/catalogue.ts`，套餐与渠道商品 id 搬进
`products/flux-kontext/billing.ts`，`user-tiers.ts` 搬进 `products/flux-kontext/tiers.ts`）。
E-7 的组件层部分由 2(a) 消解、装配部分由 2(c) 消解（**产品注册表本身仍不存在**，这是选择）。
仍在的：**E-6**（2 个路由绕过 Repository）、**E-8**（`/features` 404）、**E-9**
（`next_retry_at` 无人消费）、**E-10**（本地空目录 `src/app/api/payment/`）。

| # | 事实 | 为什么守卫没抓到 |
|---|---|---|
| E-1 | ~~`src/proxy.ts:79-100` 硬编码 Flux 的 4 个 action，重写 `/api/v1/*` → `/api/flux-kontext`~~ **已消解（Phase 9.8.2-B）**：改为通用 `/api/v1/<rest>` → `/api/<rest>` 前缀剥离，proxy 里产品词命中数为 0；legacy 路径移到产品自己的 `src/app/api/flux/[[...path]]/route.ts` | 以前 `proxy.ts` 在 `src/` 根、不在手写 CORE_DIRS 里；9.8.2-C 起排除法把它纳入了 import 守卫，产品词回归另有 `scripts/verify-api-routing.ts` 兜底 |
| E-2 | ~~`vercel.json` `rewrites` 同样硬编码 `/api/v1/flux/*` → `/api/flux-kontext?action=…`；且路径与 proxy.ts **不一致**（一个带 `/flux/`，一个不带）~~ **已消解（Phase 9.8.2-B）**：5 条同应用 rewrite 全部删除，`rewrites: []`。**顺带更正一处旧误述**：两层的路径形状**并不矛盾** —— proxy 用的是 `pathname.includes('/text-to-image/pro')`，所以 `/api/v1/flux/text-to-image/pro`（带 `/flux/`）与 `/api/v1/text-to-image/pro`（不带）**都会**命中同一个分支；「不一致」的说法来自只读了 `vercel.json` 的字面 source | 部署配置，import 守卫不看它 —— 现在由 `scripts/verify-api-routing.ts` 的 C 段钉住（`rewrites: []`、Flux rewrite 数 = 0） |
| E-3 | ~~`src/lib/ai/models.ts` 的 `MODELS` 与 `src/config/credits.ts` 的 `CREDIT_COSTS` **只含 flux-\* 模型 id**~~ **已消解（Phase 9.8.2-C）**：`src/config/credits.ts` 删除，`models.ts` 只剩查询机制，模型目录 + `credits` 字段搬到 `src/lib/products/flux-kontext/catalogue.ts` | 属「Core 携带产品目录数据」，旧守卫只查 import —— 现在由 `verify-product-config.ts` 的**派生词表扫描**（词汇来自被绑定的产品，不是写死清单）+ 排除法 import 守卫兜底 |
| E-4 | ~~`src/config/billing.ts` 的 `providerProductIds.creem` 含品牌串（如 `'FluxKontext-Plus-Monthly'`）~~ **已消解（Phase 9.8.2-C）**：7 个付费套餐 + 免费档连同渠道商品 id 搬到 `products/flux-kontext/billing.ts`；`src/config/billing.ts` 只剩读绑定配置的查询函数 | 同上 |
| E-5 | ~~`src/lib/user-tiers.ts` 含 Flux 专属模型/宽高比列表~~ **已消解（Phase 9.8.2-C）**：搬到 `src/lib/products/flux-kontext/tiers.ts` + `capabilities.ts`，Core 不再写死 `pro` / `max` | 以前不在 CORE_DIRS；现在排除法覆盖它原来的位置，且该文件已不在 Core |
| E-6 | `src/app/api/user/credits/route.ts` 与 `src/app/api/user/ensure/route.ts` 直接 `createAdminClient()` + `.from('users')` / `.from('credit_transactions')`，**绕过 Repository** | 无守卫；违反 §4.6 与 PROJECT_STATUS §3 的成文规则 |
| E-7 | **不存在产品注册表**。~~8+ 个组件（`FAQ` `Footer` `HomeContent` `HowToSteps` `KeyFeatures` `PricingContent` `TwitterShowcase` 等）直接 import `@/lib/products/flux-kontext/content`~~ **组件层已由 2(a) 消解**（改 props 驱动 + `src/app/product-content.ts` 装配）；**绑定层由 2(c) 消解**（`src/app/product-runtime.ts` 一行 import）。当前 `src/components/**` → `@/lib/products` 的 **5** 处 import 全部来自**产品自己的 UI**（见 `KNOWN_LAYOUT_DEBT`），不是共享组件 | 注册表缺位不是守卫漏洞而是**选择**；接缝可达性由 `verify-product-seam.mjs` 钉住 |
| E-8 | `sitemap.ts` / `robots.ts` 列了不存在的 `/features` | 无守卫 |
| E-9 | `src/lib/workflow` 的 `next_retry_at` / `findRetryableTasks()` 写了但无人消费 | 无守卫 |
| E-10 | `src/app/api/payment/` 是**空目录**（git 不跟踪空目录，本地残留） | 无守卫 |

> **重要（2026-10-10 更新）**：E-1 ~ E-5 与 E-7 的耦合面已经**不再是 import 方向问题**，
> 剩余 E-6 / E-8 / E-9 / E-10 也**都不会被 `npm run verify` 抓到** ——
> 守卫 PASS 只证明架构约束成立，不证明这些业务缺陷被修好。
>
> 「删掉 `products/flux-kontext/` 后 **Core** 仍可编译」这一 Phase 9.8 目标
> **已在 9.8.2-C 用独立 worktree 实测成立**（整面删除后 `tsc --noEmit` 与 `eslint` 均
> exit 0，见 [`PRODUCT_GUIDE.md` §7](./PRODUCT_GUIDE.md)）。
> **脚本层也已在 9.8.2-D 去产品化**：共用 `verify-*.ts` 不再 import 产品，只有 Flux 才成立的
> 断言搬进 `scripts/verify-flux-kontext.ts` 并声明 `// @product-scope flux-kontext`，
> 产品目录不在时该步 **SKIP（绝不 PASS）**。反方向的证明同样做了：装一个非 Flux 产品
> （Product B fixture）后 `npm run verify` 与 `next build` 全绿，**Core 一行没改**
> （除三处真正的母版缺陷，见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)）。
> 所以现在的准确说法是：**Core 干净 + 脚本层按归属分区 + 可复用性有正向实测**，
> 但「`npm run verify` 在删掉产品后全绿」这句仍然**不成立**，也**不该**成立 ——
> 产品少一个，它自己的测试就少一步，那步必须是 SKIP 而不是 PASS。
>
> ⚠️ 另注：曾有一条与上述例外**无关**的门禁失败 —— `verify-ai-core.ts` 在断言全过之后
> 于退出阶段崩溃（`process.exit()` + 残留 socket，Node 24 / Windows）。
> 已于 2026-09-29 的独立修复批次修掉；随后 `migrations:static` 也在 2026-09-30 补齐
> （本机建 `.venv` + 修校验脚本的 Windows UTF-8 输出），当时 `npm run verify` 为
> **15 通过 · 0 失败 · 0 跳过**；现在是 **19 步**，见 §8.2。详见
> [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) **F9.7-16（已修复）** 与 **§7.7**。

---

## 6. Configuration / Environment

### 6.1 依赖方向

```
Environment (.env.local / 平台环境变量)
    ↓  process.env（分散读取，无中央 helper）
Config      (src/config/*.ts 纯静态 · src/lib/site-config.ts 品牌/URL)
    ↓
Service     (Core：AIService / BillingService / WorkflowService / StorageService …)
    ↓
Product     (src/lib/products/*：只读少量产品相关开关)
```

**实测**：env 访问**没有**统一收口。直接 `process.env.*` 读取数 ——
`src/lib` 93 处、`src/components` 55 处、`scripts/` 31 处、`src/app` 5 处、**`src/config` 0 处**。
唯一的「集中点」是 `src/lib/site-config.ts`（品牌与 URL 派生）和各领域模块自身。
一致性靠 `npm run audit:env` 守卫，而不是靠架构。

### 6.2 `.env.example` 的 5 个分组

`.env.example`（仓库根目录）是**唯一**的示例文件，共 **83 个变量**（47 个未注释 + 36 个注释掉）。
旧 `env.example` 已在 Phase 9.6 删除，不要再创建。分组头部原文：

```
#   [CORE]      运行必需（数据库 / 认证 / AI Provider）
#   [STORAGE]   对象存储（可选；未配置时生成结果只保留 Provider 原始 URL）
#   [BILLING]   支付渠道（至少配置一个）
#   [PRODUCT]   产品 / 品牌信息（换产品时只改这一段）
#   [OPTIONAL]  人机验证 / 内容安全 / 分析 / 调试
```

> **换产品时，理想情况只需改 `[PRODUCT]` 段** —— 但见 §5.4 E-3/E-4/E-7，
> 目前品牌语义还漏在 Core 配置里。

### 6.3 Secret vs `NEXT_PUBLIC_*`

| 类别 | 规则 | 例子 |
|---|---|---|
| `NEXT_PUBLIC_*` | **会进客户端 bundle**，等同公开。只放「可以被浏览器知道」的东西 | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_PROJECT_NAME`、各功能开关、`NEXT_PUBLIC_TURNSTILE_SITE_KEY` |
| 服务端 Secret | **绝不加 `NEXT_PUBLIC_` 前缀**，绝不出现在 `src/components/**` | `SUPABASE_SERVICE_ROLE_KEY`、`NEXTAUTH_SECRET`、`FAL_KEY`、`KIE_API_KEY`、`KIE_WEBHOOK_SIGNING_SECRET`、`WAVESPEED_API_KEY`、`WAVESPEED_WEBHOOK_SECRET`、`ATLASCLOUD_API_KEY`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`STRIPE_PRIVATE_KEY`、`STRIPE_WEBHOOK_SECRET`、`CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`TURNSTILE_SECRET_KEY`、OAuth `*_SECRET` |
| 服务端非密 | 服务端读但不敏感 | `NEXTAUTH_URL`、`AI_PROVIDER`、`*_API_BASE_URL`、`CREEM_API_URL`、`ADMIN_EMAILS`、`ENABLE_VERBOSE_LOGS`、`ENABLE_DEBUG_ROUTES` |

⚠️ `STRIPE_PUBLIC_KEY` **没有** `NEXT_PUBLIC_` 前缀（服务端读取后下发），这是有意的，别「修正」它。

**不能进 Core 代码的配置**：价格 / 套餐 / 渠道商品 id（→ `src/lib/products/<id>/billing.ts`）、
积分成本与模型清单（→ `src/lib/products/<id>/catalogue.ts`）、Provider 映射与端点
（→ `providers.ts` / `provider-data.ts`）、档位与能力（→ `tiers.ts` / `capabilities.ts`）；
Core 的 `src/config/` 只留**形状 + 校验 + 查询机制**。
站点品牌/域名（→ `NEXT_PUBLIC_*` + `site-config.ts`）、任何密钥照旧不进代码。
`src/config/` 下 `process.env` 读取数必须是 0。

### 6.4 缺失时的行为

| 变量 | 缺失后果 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` | **很可能 build 就失败**（App Router 页面预渲染；`src/lib/supabase/client.ts` 用了非空断言） |
| `SUPABASE_SERVICE_ROLE_KEY` | 运行时抛 `DatabaseConfigError` / `Missing required Supabase environment variable` |
| `FAL_KEY` 等 Provider key | 运行时该 Provider 调用失败；`verify-ai-core.ts` 的真实调用段**自动跳过** |
| `R2_*` | Storage 未配置 → 生成结果只留厂商 URL，**功能不中断** |
| `STRIPE_*` / `CREEM_*` | `isConfigured()` 为 false，该渠道不可用（至少配一个） |
| `NEXTAUTH_SECRET` | NextAuth 框架层报错 |

### 6.5 已废弃 / 未使用变量怎么处理

- **发现代码里读了 `.env.example` 没声明的变量** → `audit:env` **A 段 FAIL**，必须补声明。
- **发现 `.env.example` 声明了但代码没用的变量** → **B 段只 WARN，不失败**。
  处理原则：确认无部署依赖后删除，或保留并注明用途。
- 当前已知 2 个 B 段告警：`DATABASE_URL`（注释状态；迁移/脚本/排错可用，应用不依赖）、
  `NEXT_PUBLIC_ENABLE_CREEM`（**全仓库无代码读取**，且其注释仍指向已退役的 `npm run check`）。
- **工具开关白名单**：`scripts/` 下工具的命令行开关不算「应用环境变量」，
  列在 `scripts/audit-env.mjs` 的 `TOOLING_VARS`：`PYTHON`、`PGLITE_MODULES`、
  `VERIFY_SKIP_BUILD`、`VERIFY_SKIP_MIGRATIONS`、`VERIFY_ONLY`。
  另有 `KNOWN_INDIRECT`（框架读取）：`NODE_ENV`、`NEXTAUTH_SECRET/URL/COOKIE_DOMAIN`、`VERCEL*`、
  `NEXT_RUNTIME`、`PORT`。
  **新增脚本开关时必须同步 `TOOLING_VARS`**，否则 A 段会误报。

### 6.6 命令

```bash
npm run setup:env     # cp .env.example .env.local && npm run audit:env
npm run audit:env     # 一致性检查（A 段失败 / B 段告警）
```

---

## 7. Database / Migration

### 7.1 位置与编号规则

```
supabase/migrations/
├── 0000_baseline.sql                    users / credit_transactions 等基线
├── 0001_credit_model.sql
├── 0002_orders.sql                      唯一订单表（payment_orders 已废弃）
├── 0003_subscriptions.sql
├── 0004_ai_tasks.sql                    含 status CHECK 约束
├── 0005_atomic_credit_operations.sql    consume_credits() RPC ⭐
├── 0006_billing_closed_loop.sql         webhook_events + grant_credits() RPC
├── 0007_user_role.sql                   users.role
├── 0008_admin_audit_logs.sql
└── 0009_workflow_task_engine.sql        retry / settlement 列
```

规则：**4 位连续序号 `NNNN_name.sql`，不留空洞**。当前 0000~0009 共 10 个文件。

另有 `supabase/scripts/validate_migrations.py`（静态校验）、
`supabase/scripts/verify_migrations.mjs`（真实执行校验）、
`supabase/scripts/requirements.txt`（只有 `sqlglot>=25.0`）。

### 7.2 SQL migration 原则

- **必须可重复执行**：全部使用 `IF NOT EXISTS` / `OR REPLACE` / `IF EXISTS` 守卫。
  这不是约定，是**被测试强制**的 —— `migrations:real` 会把每个文件**跑两遍**。
- 新增迁移 = 新增一个 `00NN_*.sql`，**不改已有文件**。
- 约束优先写进数据库（CHECK / UNIQUE INDEX），不要只靠应用层校验。
  例：`uniq_credit_transactions_idempotency`、`uniq_orders_idempotency`、
  `uniq_ai_tasks_idempotency`、`ai_tasks.credits_refunded <= credits_used` 的 CHECK。
- 涉及钱的逻辑优先做成 **Postgres 函数（RPC）**，让原子性由数据库保证（见 §4.3）。

### 7.3 两种迁移校验

| | `npm run migrations:static` | `npm run migrations:real` |
|---|---|---|
| 实现 | `supabase/scripts/validate_migrations.py`（531 行） | `supabase/scripts/verify_migrations.mjs`（1130 行） |
| 依赖 | **Python + `sqlglot`** | **`@electric-sql/pglite`**（devDependency `^0.5.8`） |
| 手段 | sqlglot 解析（postgres 方言）+ 内置 Schema 模拟器 | **PGlite = WASM 里的真实 PostgreSQL，内存态** |
| 检查 | ① 可解析性 ② 依赖顺序（ALTER/INDEX/POLICY 的目标须先创建）③ FK REFERENCES 目标存在 ④ UNIQUE/唯一索引的列存在 ⑤ CREATE INDEX 的表与列存在 ⑥ 幂等守卫覆盖率统计 | ① 按序执行全部迁移 ② **完整重跑一遍**（幂等）③ Schema 断言（表/列/唯一索引/RPC）④ 积分原子消费（并发 race、二次扣减影响 0 行、断言函数体含 `WHERE credits >= p_amount`）⑤ Billing 闭环 ⑥ Admin ⑦ Workflow（重复 idempotency_key、只退一次） |
| 缺依赖时 | **SKIP**（不算通过） | **FAIL，退出码 2**（明确「不伪装成通过」） |
| 局限 | `CREATE POLICY` / RLS 退化为通用 Command，**不校验**；无类型与数据校验 | PGlite 单连接，**真并行未被验证**（脚本内有此诚实声明） |

**PGlite 的用途**：让「迁移能否真实执行、是否幂等、RPC 行为是否正确」在**没有数据库、没有密钥**的
情况下被自动验证。它是主门禁；静态校验是补充（多做列级约束检查）。

平台特例处理：`validate_migrations.py` 允许 `auth.users` / `auth.uid()` 与
`uuid-ossp` / `pgcrypto` 扩展；`verify_migrations.mjs` 会剥离 `CREATE EXTENSION "uuid-ossp"`
并把 `auth.uid()` 桩成返回 NULL。

### 7.4 Repository 与 DB 的边界

```
API Route / Service  →  src/lib/db/repositories/*  →  getDb()（src/lib/db/client.ts）
                                                        ↓
                                              createAdminClient()（service_role, server-only）
                                                        ↓
                                                  Supabase PostgreSQL
```

- 业务代码**不得**直接创建 Supabase 客户端、不得直接 `.from('…')`。
- 浏览器侧只能用 `src/lib/supabase/client.ts`（anon key），且只用于 Auth。
- ~~`src/lib/database.ts`~~（伪 Prisma 适配器，约 700 行）**已于 Phase 9.1 删除**。
  **不允许重新出现**：`npm run audit:architecture` 会检查该文件不存在，
  且没有任何文件 import `@/lib/database`。
- ⚠️ 当前 2 处违反见 §5.4 E-6。

---

## 8. Testing / Verification

### 8.1 一条命令

```bash
npm run verify        # ⭐ 本地 CI 门禁（别名 npm run ci）
npm run verify:fast   # = --skip-build --skip-migrations，快速迭代
```

实现：`scripts/verify-all.mjs`（292 行）。**顺序执行、聚合报告、不 fail-fast**。
`scripts/verify-*.ts` 是**自动发现**的（`readdirSync` + `verify-*.ts` 过滤 + 排序），
新增验证脚本无需改 `verify-all.mjs`。

`.ts` 脚本的执行方式：`scripts/run-ts.mjs` 用 **jiti**（Next.js 的传递依赖）加载，
配 `@` → `src` 别名。不是 tsx，也不是 `node --experimental-*`。
原因：`tsconfig.json` **排除了 `scripts/**`**，而这些脚本要 import `@/lib/...`。

脚本内读源码一律用 `scripts/source-scan.ts`（`readSource()` / `grepSource()`，纯 Node），
**不要用 `execSync('cat …')` / `execSync('grep -rn …')`** —— 那是 Unix 工具，
纯 Windows 上不存在（`门禁 spawn 修复` 已把 15 处全部替换）。
同理 `verify-all.mjs` 用**异步 `spawn`**，不用 `spawnSync`。

脚本收尾用 **`process.exitCode = …` 让 Node 自然退出**，不要用 `process.exit()`：
若仍有 libuv handle 处于关闭中（典型是 undici keep-alive socket），
`process.exit()` 在 Node 24 / Windows 会命中 libuv 断言并把退出码变成 `0xC0000409`
（F9.7-16）。相应地，**异常路径也必须 teardown**，否则监听中的 server 会让进程挂死。

### 8.2 19 步

| # | 步骤 | 命令 | 性质 |
|---|---|---|---|
| 1 | `lint` | `eslint . && tsc --noEmit` | 门禁 |
| 2 | `audit:dead-files` | `node scripts/audit-dead-files.mjs` | 门禁（**9.8.2-D**：产品 UI 的保留登记改由各产品的 `layout-debt.json` 提供） |
| 3 | `audit:architecture` | `node scripts/audit-architecture.mjs` | 门禁 |
| 4 | `audit:env` | `node scripts/audit-env.mjs` | 门禁 |
| 5 | `verify:product-boundary` | `node scripts/verify-product-boundary.mjs` | 门禁（**9.8.2-C 重写为排除法**） |
| 6 | `verify:product-seam` | `node scripts/verify-product-seam.mjs` | 门禁（**9.8.2-C 新增**：每个服务端入口的闭包含接缝 + `--self-test`） |
| 7 | `audit:unused-exports` | `node scripts/audit-unused-exports.mjs` | **INFO**（脚本恒 exit 0） |
| 8 | `verify-admin.ts` | `node scripts/run-ts.mjs …` | 门禁 |
| 9 | `verify-ai-core.ts` | 同上 | 门禁（**9.8.2-D**：只断言 Core 机制，产品数字改由第 13 步负责） |
| 10 | `verify-api-routing.ts` | 同上 | 门禁（**9.8.2-B 新增**：`/api/v1` 路由链 + 产品兼容层契约） |
| 11 | `verify-auth.ts` | 同上 | 门禁 |
| 12 | `verify-billing.ts` | 同上 | 门禁（**9.8.2-D**：套餐标识符契约 + 文案/金额一致性改读**已绑定产品**的内容） |
| 13 | `verify-flux-kontext.ts` | 同上 | 门禁 · **产品专属**（`@product-scope flux-kontext`：产品目录不在则 **SKIP**，绝不 PASS） |
| 14 | `verify-product-config.ts` | 同上 | 门禁（**9.8.2-C 新增**：套餐/模型/成本/Provider 完整性 + 11 个违规样例 + 未绑定探针 + 派生词表扫 Core） |
| 15 | `verify-storage.ts` | 同上 | 门禁 |
| 16 | `verify-workflow.ts` | 同上 | 门禁（含**输入图契约**的分类断言：缺图 → `INVALID_REQUEST` 且不可重试） |
| 17 | `migrations:static` | `"<python>" supabase/scripts/validate_migrations.py` | 门禁 · **可 SKIP** |
| 18 | `migrations:real` | `node supabase/scripts/verify_migrations.mjs` | 门禁 · **可 SKIP** |
| 19 | `build` | `npm run build` | 门禁 · **可 SKIP** |

第 13 步是**产品自己的回归**，它的存在使步数随产品而变：把 Flux 整个换成第二个产品后，
这一步换成新产品的同名脚本，其余 18 步一行不改仍然全绿（见
[`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md) 的 Product B 实测）。

**开关与环境变量**

| | 作用 |
|---|---|
| `--skip-build` / `VERIFY_SKIP_BUILD=1` | 第 19 步 SKIP |
| `--skip-migrations` / `VERIFY_SKIP_MIGRATIONS=1` | 第 17、18 步 SKIP |
| `--strict` | **任何 SKIP 都判失败**，退出码 1（"覆盖率不完整"） |
| `--only=<kw>` / `VERIFY_ONLY` | 只跑步骤名**包含**该子串的项 |
| `PYTHON=<path>` | 指定带 `sqlglot` 的解释器 |
| `PGLITE_MODULES=<dir>` | 额外的 PGlite 模块搜索目录 |

`PYTHON` 未设时的探测顺序：`$PYTHON` → `.venv/Scripts/python.exe` → `.venv/bin/python` →
`python3` → `python`，每个都用 `"<bin>" -c "import sqlglot"` 试。
**`.venv/` 不入库**（`.gitignore` 已忽略），每人 clone 后自建一次
`python -m venv .venv` + `pip install -r supabase/scripts/requirements.txt`，
建好即自动探测、无需 `PYTHON=`。完整步骤见 [`DATABASE.md` §9.2](./DATABASE.md)。

**退出码**：任一 FAIL → 1；有 SKIP 且 `--strict` → 1；有 SKIP 无 strict → 0（带告警）；全 PASS → 0。
FAIL 时会打印该步 stdout+stderr 的**最后 12 行**与退出码。
报告只给**每步耗时**，不给总墙钟时间。

> ⚠️ **不对称**：`migrations:real` **不探测** PGlite。模块缺失时 `verify_migrations.mjs`
> 直接退出码 2 → 记为 **FAIL，不是 SKIP**。

### 8.3 五类验证必须分清

这是本文档最重要的一节。**不要把静态契约检查说成生产 E2E。**

| 类别 | 是什么 | 需要真实环境？ | 在 `verify` 里？ |
|---|---|---|---|
| **Automated verification** | 8 个产品无关的 `scripts/verify-*.ts` + 1 个产品专属（第 13 步，带 `@product-scope`）：源码静态扫描 + **进程内纯逻辑**断言。`verify-ai-core.ts` 会起一个 **127.0.0.1 本地 mock HTTP server** 跑完整管线（解析 → 构造请求 → 轮询 → 归一化 → 校验 `GenerateResult` 形状），并有防假绿断言（B8：确认 mock 真的收到了请求） | ❌ 不需要 DB / 密钥 / 网络 | ✅ |
| **Migration verification** | `migrations:static`（sqlglot 解析）+ `migrations:real`（PGlite 内存真库，跑两遍 + RPC 行为断言） | ❌ 不需要真实数据库 | ✅（static 可 SKIP） |
| **Build verification** | `next build` 全路由生成 | ❌（但可能需要 Supabase 的 `NEXT_PUBLIC_*`，见 §6.4） | ✅ |
| **HTTP smoke test** | `npm run smoke:ai`（`scripts/smoke-ai-core.mjs`）打真实 HTTP：`/api/ai/image`、`/api/flux-kontext` | ✅ **需要运行中的 dev server**；`e2e` 段还需真实登录 + 真实 Supabase + 真实 `FAL_KEY` | ❌ **不在** |
| **Real external provider test** | `verify-ai-core.ts` 的 **C 段**：真实调用 fal.ai | 仅当 `FAL_KEY` 已设且不是 `your_fal_api_key_here`；否则**打印跳过、不判失败** | ⚠️ 条件性 |

**必须保持的事实（Phase 9.6 结论，不得美化）**：

> 真实 dev server + 真实 Supabase + 真实 Provider 凭据的 **HTTP E2E 尚未纳入默认 `verify`**。
> 本机 `.env.local` 的 `FAL_KEY` 与 `NEXT_PUBLIC_SUPABASE_URL` 都是占位符，跑不通。
> 契约层由 `verify-ai-core.ts` 静态 + mock 覆盖，**HTTP 层无自动化覆盖**。

`smoke:ai` 的段选择：`SMOKE_SECTION=e2e`（默认）/ `contract` / `billing` / `all`（不建议）。
其它环境变量：`SMOKE_BASE_URL`（默认 `http://localhost:3000`）、`SMOKE_EMAIL`、`SMOKE_PASSWORD`、
`SMOKE_MODEL`、`SMOKE_TARGET`、`SMOKE_RATE_WAIT_MS`（默认 62000）、`SMOKE_MAX_RETRIES`（默认 3）。
需要 `NEXT_PUBLIC_AUTH_CREDENTIALS_ENABLED=true`。凭据缺失时**明确打印 SKIPPED，不假装通过**。

> **跑 HTTP 测试前必须重启 dev server** —— `src/proxy.ts` 的限流计数器是内存态
> （`/api/` 10 次/60s、`/api/auth/` 5 次/300s），不重启会撞 429。

### 8.4 守卫脚本的判定规则（9.8.2-C 后：5 个 `.mjs` 守卫 + 1 个产品配置验证）

| 脚本 | FAIL 条件 | 白名单机制 |
|---|---|---|
| `audit-dead-files.mjs` | `src/**` 下有 `.ts/.tsx` 从未被 import（解析 `@/` 与相对路径，补全扩展名/index） | 三段，**没有一段写产品名**：`FRAMEWORK_ENTRY`（page/layout/route/loading/error/not-found/template/sitemap/robots/manifest/**proxy**/instrumentation/icon 等）、`.d.ts`、`TEMPLATE_CAPABILITY`（按形状：`src/components/ui/**` 的 shadcn 原语、`src/lib/ai/providers/**` 的厂商引擎 —— 接哪几家是产品的选择，不是死代码）、`KNOWN_UNUSED_BUT_KEPT`（母版替代方案，逐个带理由），加上各产品在 `layout-debt.json` 里登记的自己的 UI（9.8.2-D 起；原先这里硬写 Flux 文件名的条目已删） |
| `audit-architecture.mjs` | ① 基础设施目录 import 了 Flux 产品说明符（含 `@/lib/products/flux-kontext`、`@/lib/flux-kontext`、`@/lib/image-generation`）② `src/lib/database.ts` 存在，或有人 import `@/lib/database` | `ALLOWLIST` Set —— **当前为空**。注释会被剥离以避免误报。⚠️ 它是**写死 Flux 字样**的历史守卫（换产品时会失效或空转），真正的方向与数据检查由下面两个脚本承担 |
| `audit-env.mjs` | **A 段**：代码用了但 `.env.example` 未声明且不在白名单 | `KNOWN_INDIRECT` + `TOOLING_VARS`（见 §6.5）。**B 段（声明未用）只 WARN** |
| `verify-product-boundary.mjs` | ① **排除法 Core 集合**（`src/` 除 `src/lib/products/**` 与 `src/app/**`）里任一文件 import `@/lib/products/*` ② 跨产品 import ③ 新出现的未登记「产品 UI 住在共享组件目录」④ 已登记的债务失效却没删 | `KNOWN_LAYOUT_DEBT` —— 按**路径或文案是否点名产品**分类，**只能缩小**，新增要写理由。产品目录为空时债务检查打印「不适用」而非误报清单过期（`9.8.2-C`）。**不证明**可复制性：见脚本 §C 的自我声明 |
| `verify-product-seam.mjs` | ① 某个**服务端入口**（`src/app/api/**`、页面、`src/lib/**` 的服务端消费者）的 import 闭包里没有 `src/app/product-runtime.ts` ② 客户端组件触达服务端配置（`@/config/product`、产品 `providers.ts`） | 无白名单。`--self-test` 用 4 个 fixture 证明**违规输入会失败**（含「接缝被删」的正对照）。空产品树下按设计 **FAIL**（32 ❌）—— 那正是「没有静默回退」的证据，不是缺陷 |
| `verify-product-config.ts`（门禁步骤） | ① 产品目录枚举不出合法 `ProductConfig` ② 模型 ⇄ Provider 映射、积分、套餐完整性校验失败 ③ 绑定配置里出现 Core 未预注册的 Provider ④ Core 目录命中**从被绑定产品派生**的产品词汇 ⑤ 未绑定探针不抛错 ⑥ `models.ts` / `config/billing.ts` / `providers/index.ts` 里重新出现内联表或成本数字 | 内置 **11 个违规样例** + **正对照**：故意把产品词写进临时 Core 文件必须被抓到。词汇主体来自产品自己 —— bundle 派生（模型 id / 套餐 id / 渠道商品 id）+ `src/lib/products/<id>/vocabulary.ts` 声明（endpoint 前缀、action 名等不在 bundle 里的字面量），**脚本里没有写死的产品词**（`FLUX_KONTEXT_ACTIONS` 那种）。反证两条：词汇表若非空集合、每个声明词必须真的用在自己源码里（凑数的词会被点出来）。⚠️ 扫描范围是 **12 个 Core 目录**；`src/proxy.ts` 与 `src/lib/*.ts` 根文件不在其中（产品词由 `verify-api-routing.ts` 钉为 0），`scripts/**` 也不在其中 —— 它由 9.8.2-D 的 `@product-scope` 协议按**归属**处理，不是靠词表扫描 |

`audit-unused-exports.mjs` 是**信息性工具，恒 exit 0**，头部注释明确「不作为 CI 守卫」。
当前约 209 个未使用导出，多数是合理的 API 面。

### 8.5 其它质量相关事实

- **无 husky / lint-staged / git hooks**（`.git/hooks` 只有 sample）。
- `eslint.config.mjs`（flat）：基于 `eslint-config-next/core-web-vitals` + `/typescript`；
  **忽略 `.next`、`node_modules`、`out`、`coverage`、`scripts/**`、`docs/**`**；
  关闭了相当多规则（`no-unused-vars`、`no-explicit-any`、`ban-ts-comment`、`prefer-const`、
  `jsx-a11y/alt-text` 及若干 react-hooks 规则），`react-hooks/exhaustive-deps` 降为 warn。
  **没有自定义 ESLint 规则 —— 自定义约束全部实现在 audit 脚本里。**
- `tsconfig.json`：`strict: true`、`noEmit`、`moduleResolution: bundler`、`skipLibCheck: true`、
  paths `@/* → ./src/*`、**exclude `scripts/**/*`**。
- 无 `.editorconfig`。Biome 配置 `biome.json`（v1.9.4，spaces，organizeImports，作用域仅 `src/**`）。
- `scripts/check-image-optimization.js`（`npm run check:image`）**保留**：
  它是 sharp 可用性冒烟测试，内存内把 `public/logo.png` resize 到 64×64，**不写文件**。

### 8.6 CI 策略

**本仓库不在 GitHub 上跑 CI。** `.github/workflows/` 只有 `codeql.yml` 与 `dependency-review.yml`，
两者都是 `on: workflow_dispatch`（手动），且 action 已 SHA 固定。文件里的原文注释：

```
# Manual trigger only (workflow_dispatch) — Charlie's policy: all CI runs locally, not on GitHub.
# Public repo: Actions minutes are free, so this is policy consistency, not cost savings.
```

所以门禁**靠贡献者本地执行**，`CONTRIBUTING.md` 与 `.github/pull_request_template.md` 已同步。
若策略变更，把 `npm run verify` 包进一个 `ci.yml`（push + PR 触发）即可，脚本已就绪。

---

## 9. Development Workflow

### 9.1 推荐顺序

1. 读本文档（`docs/MOTHER_TEMPLATE.md`）
2. 读相关主题文档（`AI_CORE` / `WORKFLOW` / `BILLING` / `DATABASE` / `STORAGE` / `ADMIN` / `FLUX_PRODUCT`）
   —— 注意 `docs/archive/ARCHITECTURE.md` 是 **Phase 1 历史快照，不要当现状读**
3. **判断需求属于 Core 还是 Product**（这一步决定后面全部）
4. 找到对应的 Service / Repository（先搜现有实现，别新建第二套）
5. 改代码
6. 跑**针对性**验证：`node scripts/run-ts.mjs scripts/verify-<module>.ts`
7. 跑 `npm run verify`
8. 跑 `npm run build`（`verify` 已含，除非用了 `--skip-build`）
9. 检查架构与产品边界：`npm run audit:architecture` + `npm run verify:product-boundary`
10. 更新必要文档（行为/接口/env 变了就必须更新）
11. `git diff` 自查

Coding Agent 另见 [`AGENT_GUIDE.md`](./AGENT_GUIDE.md)。

### 9.2 硬性禁止

> **禁止为了一个 Product 需求直接修改 Core。**

如果确实需要 Core 提供新能力，正确顺序是：
① 把它设计成**产品无关**的通用能力（不含任何产品名/品牌/产品参数语义）→
② 在 Core 实现并加守卫/验证 →
③ Product 再消费它。

其它禁止事项见 [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) §「Before coding」。

### 9.3 提交约定

Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:`。
每个阶段收尾必须 `npm run lint` + `npm run build` 通过，并回写 `docs/REFACTOR_PLAN.md`。
阶段开始前打 tag（如 `phase-9.7-before-docs`）。

---

## 10. Deployment / Operations

**只描述当前真实能力。**

### 10.1 平台

`vercel.json` 存在 → 目标平台是 **Vercel**：

| 配置 | 值 |
|---|---|
| `framework` | `nextjs` |
| `buildCommand` / `outputDirectory` | `npm run build` / `.next` |
| `regions` | `hkg1`、`sin1`、`sfo1`（多区域） |
| `functions` | `src/app/api/**/*.ts` → **`maxDuration: 60`**（秒） |
| `headers` | `/api/(.*)` 开放 CORS：`Access-Control-Allow-Origin: *`，方法 GET/POST/PUT/DELETE/OPTIONS |
| `rewrites` | **`[]`（Phase 9.8.2-B 起）** —— 原有 4 条 Flux rewrite 与 1 条 `/api/v1/(.*)` → `/api/$1` 全部删除。同应用改写只保留 `src/proxy.ts` 一层，结果不再依赖 Vercel 与 Next 之间的优先级 |
| `redirects` | 全局 HTTP→HTTPS 301；`www.` → apex 301；`/docs` `/api-docs` `/documentation` → `/resources/api`；`/free` → `/resources` |
| `env` / `build.env` | `NODE_ENV=production` / `NEXT_TELEMETRY_DISABLED=1` |
| `crons` | **无** |

⚠️ `Access-Control-Allow-Origin: *` 覆盖全部 `/api/*`，包括需要凭据的端点。
这是现状，不是建议；改动前需评估既有集成。

⚠️ **`vercel.json` 在本地 `next dev` / `next start` 下完全不生效**（只有 `next.config.js` 与
`src/proxy.ts` 生效）。因此本地测得的 API 路由行为**不能**当作 Vercel 上的行为；
Phase 9.8.2-B 删除 5 条 rewrite 后，两层不再需要做同一件事，但**Vercel Preview 上的实际
路由优先级仍未实证** —— 该项目至今没有在真实 Vercel 部署上验证过 `/api/v1/*`。

⚠️ 对外 API 文档（`src/components/ApiDocumentation.tsx`）承诺
`Authorization: Bearer <API_KEY>`，而 `/api/flux-kontext` 只读 session（不读 `Authorization`）。
这处**文档与实现的缺口自 Phase 9.7 起一直在**，9.8.2-B 明确未动（见 PROJECT_STATUS §10.1 缺口 ②）。

`next.config.js` 另有 `allowedDevOrigins`（局域网开发）、`/api/v0/:path*` → `/api/v1/:path*`
（编译产物里是 **308**，注释写的 301 与实测不符）、`/login`→`/auth/signin`、
`/register`→`/auth/signup`（307）、`/old-pricing`→`/pricing`、`/old-generate`→`/generate`（301）等重定向。

### 10.2 必需 / 可选环境

| | 变量 |
|---|---|
| **必需（不配就跑不起来 / build 失败）** | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXTAUTH_SECRET`、`NEXTAUTH_URL`、`NEXT_PUBLIC_SITE_URL`，以及**至少一个** AI Provider key（默认 `fal` → `FAL_KEY`） |
| **必需（用到该功能才需要）** | 支付：`STRIPE_PRIVATE_KEY` + `STRIPE_WEBHOOK_SECRET` **或** `CREEM_API_URL` + `CREEM_API_KEY` + `CREEM_WEBHOOK_SECRET`；OAuth：`GOOGLE_ID/SECRET`、`AUTH_GITHUB_ID/SECRET` |
| **可选** | `R2_*`（不配则生成结果只留厂商 URL）、`TURNSTILE_*`、`OPENAI_API_KEY`（不配则用内置规则做 prompt 安全检查）、`NEXT_PUBLIC_*_ANALYTICS_*`、`ADMIN_EMAILS`、`AI_PROVIDER`、各 `*_API_BASE_URL`、轮询调参变量、`ENABLE_VERBOSE_LOGS`、`ENABLE_DEBUG_ROUTES`、`DATABASE_URL`（仅迁移/脚本/排错） |

完整清单与注释以 `.env.example`（83 变量）为准。

### 10.3 生产 Secret 管理

- 全部走平台环境变量（Vercel Project Settings），**不进仓库**。
- `.env.local` 已被 `.gitignore` 排除；`.env.example` 是**唯一**入库的示例，只放占位符。
- service_role key 只能在服务端使用（`src/lib/supabase/server.ts` → `src/lib/db/client.ts`）。
  `scripts/verify-admin.ts` 会静态检查它没有出现在客户端代码里。
- 轮换 webhook 密钥时注意：Stripe 用 `STRIPE_WEBHOOK_SECRET`，Creem 用 `CREEM_WEBHOOK_SECRET`，
  kie 用 `KIE_WEBHOOK_SIGNING_SECRET`，wavespeed 用 `WAVESPEED_WEBHOOK_SECRET`。

### 10.4 Migration 上线

- 迁移文件在 `supabase/migrations/`，**本仓库不含自动迁移流水线**。
- 上生产前本地必须过：`npm run migrations:real`（PGlite 跑两遍）+ `npm run migrations:static`。
- 实际应用到 Supabase 的方式：**手动执行 SQL**（Supabase SQL Editor / CLI）。
  `DATABASE_URL` 仅用于这类脚本与排错，应用运行时不依赖它。
- 迁移必须幂等（§7.2），这样重放安全。

### 10.5 Webhook 端点清单

| 端点 | 来源 | 验签 |
|---|---|---|
| `POST /api/billing/webhook/[provider]` | Stripe / Creem | `provider.verifyWebhook()` |
| `POST /api/webhooks/stripe` | Stripe | `constructEvent` |
| `POST /api/webhooks/payments` | 支付（旧入口） | 同上路径 |
| `POST /api/webhooks/ai/[provider]` | kie / wavespeed | `AIProvider.verifyWebhook()`；fal/atlascloud 无验签能力 → 501 |

部署后必须在各渠道后台配置这些 URL，并回填对应 secret。
所有 webhook 处理都经 `webhook_events` 表 claim，**重复投递安全**。

### 10.6 运行时注意事项

- **限流是单实例内存态**（`src/proxy.ts` 的 `rateLimitMap`）。多实例/多区域部署下
  **各实例独立计数**，源码注释本身就写着「生产环境请换成 Redis 等共享后端」。
  当前 `regions` 配了 3 个 → 实际有效阈值约为配置值的 3 倍。
- **没有后台 worker**：异步任务只能靠 ① 厂商 webhook ② 用户打开 `GET /api/ai/tasks/[id]`
  ③ Admin 手动 `POST /api/admin/ai-tasks/poll` 推进。**没有定时兜底**，
  用户不再访问且无 webhook 的任务会停在 `processing`。
- `maxDuration: 60` 意味着同步等待结果的生成必须在 60s 内完成；
  更长的应走异步（`waitForResult: false`）+ webhook/polling。
- 退款只改订单状态，**不回收已发放积分**（§3.3）。

### 10.7 观测

只有 `src/lib/workflow/logger.ts` 的结构化任务日志（固定事件名 + 敏感字段脱敏）
与可选的 `ENABLE_VERBOSE_LOGS`。**没有** APM / tracing / 指标平台 / 告警。
分析类只有可选的第三方脚本注入（GA / Clarity / Plausible / OpenPanel，均 `NEXT_PUBLIC_*` 开关）。

---

## 11. 新开发者 / Agent 的阅读顺序

```
1. README.md                    怎么把项目跑起来
2. docs/MOTHER_TEMPLATE.md      本文 —— 这套模板内部是怎么回事、边界在哪
3. docs/AGENT_GUIDE.md          如果是 Coding Agent：动手前后必须遵守什么
4. docs/PROJECT_STATUS.md       做到哪个阶段了、命令速查、缺陷状态
5. 判断需求属于 Core 还是 Product
   ├─ Product → docs/PRODUCT_GUIDE.md + docs/FLUX_PRODUCT.md
   └─ Core    → 对应主题文档：
                AI_CORE / WORKFLOW / BILLING / DATABASE / STORAGE / ADMIN
6. docs/REFACTOR_DECISIONS.md   想知道「为什么这样设计」
7. docs/PHASE_9_*_FOLLOWUPS.md  想知道「哪些是已知遗留、不要重复踩」
```

**不要读**：`docs/archive/**`（55 个文件，含 Phase 1 的 `ARCHITECTURE.md`），
除非你在做历史回溯。它们的路径多数已失效。

---

## 12. 快速自检

在宣称「我理解了这个模板」之前，确认你能回答：

- [ ] Core 与 Product 的分界在**磁盘上**是哪里？（`src/lib/products/` 内外）
- [ ] 为什么积分在任务 `pending` 时就扣、而不是完成时扣？失败怎么办？
- [ ] `consume_credits()` 怎么保证原子 + 幂等？为什么不用应用层事务？
- [ ] 价格有几个真相？分别在哪？为什么 checkout 不能读请求体里的金额？
      （**一个**：产品套餐表的 `priceMinor`；机制在 `src/config/billing.ts`。积分成本同理只有一个：模型目录的 `credits`）
- [ ] 全仓库哪个文件允许 import `@aws-sdk/client-s3`？
- [ ] 加第 5 个 AI Provider 要改哪几个文件？（提示：Core 只加**引擎类**，映射表与实例装配在**产品目录**，还要改一个**测试脚本**）
- [ ] `npm run verify` 的 19 步里，哪一步是 INFO 不判定？哪两步会 SKIP？哪一步缺依赖会 FAIL 而不是 SKIP？
      哪一步的**步数本身**会随产品消失而变少，它缺席时为什么不算「覆盖率不完整」？
- [ ] 新的服务端路由忘了 `import '@/app/product-runtime'` 会怎样？（**首个触碰产品配置的请求抛错**，不是回退到默认模型；`verify:product-seam` 在门禁里就把这种入口点名出来）
- [ ] 想让新产品带上自己的 `/api/v1/...` 公共路径，应该新建哪个文件、**不该**改哪个文件？（提示：`src/app/api/<product>/[[...path]]/route.ts`；别碰 `src/proxy.ts` 和 `vercel.json`）
- [ ] 本仓库的边缘层文件叫什么？为什么不叫 `middleware.ts`？
- [ ] 为什么 GitHub 上没有 CI？门禁在哪？
- [ ] `verify-ai-core.ts` 是生产 HTTP E2E 吗？（**不是**）

---

## 13. 相关文档

| 文档 | 内容 |
|---|---|
| [`docs/README.md`](./README.md) | 全部文档索引 |
| [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) | Coding Agent 开发约束 |
| [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) | 如何新增第二个 Product |
| [`AI_CORE.md`](./AI_CORE.md) | AI Core 与 Provider 扩展指南 |
| [`WORKFLOW.md`](./WORKFLOW.md) | 任务引擎细节 |
| [`BILLING.md`](./BILLING.md) | 支付闭环细节 |
| [`DATABASE.md`](./DATABASE.md) | 表结构与 Repository 规范 |
| [`STORAGE.md`](./STORAGE.md) | 存储抽象细节 |
| [`ADMIN.md`](./ADMIN.md) | Admin 边界细节 |
| [`FLUX_PRODUCT.md`](./FLUX_PRODUCT.md) | 当前产品的职责与实现 |
| [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) | 阶段时间线、命令速查、缺陷状态 |
| [`REFACTOR_DECISIONS.md`](./REFACTOR_DECISIONS.md) | 架构决策记录 |
| [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) | 本阶段遗留与发现的架构问题 |
