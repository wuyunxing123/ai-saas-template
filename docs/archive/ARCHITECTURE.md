# ARCHITECTURE.md — 项目架构分析（**Phase 1 历史快照**）

> ## ⚠️ 历史文档 · 不反映当前架构
>
> **本文是 2026-09-23（Phase 1）的只读分析快照，请勿当作现状阅读。**
>
> 它描述的项目已经在 Phase 2 ~ 9.6 被彻底重构。文中至少以下内容**已失效**：
>
> - §0「阅读前必须知道的 5 个事实」#2 描述的 `src/lib/database.ts`（伪 Prisma 适配器）
>   **已于 Phase 9.1 删除**，且 `npm run audit:architecture` 会阻止它复活
> - §0 #3 声称 `creditTransaction` / `subscription` / `paymentConfig` 是纯 mock
>   —— **早已修复**（Phase 3 / 4，现为真实表 + Repository）
> - 文中提到的 `src/lib/payment/`、`src/lib/payment-security.ts`、`src/lib/image-generation/`、
>   `src/lib/flux-kontext.ts`、`src/lib/services/{order,pricing,r2-storage}.ts`
>   —— **全部已删除**（Phase 8 / 9.1 / 9.2 / 9.3）
> - 附录 A 的缺陷清单 B-1 ~ B-21 的**当前状态**见
>   [`PROJECT_STATUS.md` §7](./PROJECT_STATUS.md)，不是本文
>
> **想了解当前真实架构，请读 [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md)。**
>
> 本文保留的唯一价值是回溯「当时为什么那样决策」。按 Phase 9.7 规格，
> 历史文档保留但必须明确标记为 historical —— 这就是那个标记。
> 本文内容**不做逐行修正**（规格禁止为文档清理而大规模重写历史快照）。

---

> 本文档为 **只读分析**，不包含任何代码修改。
> 分析对象：`flux-kontext-template`（仓库根目录 `D:\test\AI\my-project\flux-kontext-template`）
> 分析时间：2026-09-23
> 目标：为重构为通用 `my-ai-saas-template` 提供事实基础。

---

## 0. 阅读前必须知道的 5 个事实

在展开细节之前，先记住这 5 条，否则后面很容易误判：

| # | 事实 | 影响 |
|---|---|---|
| 1 | 源码根目录是 **`src/`**，不是 `app/` `lib/` `components/` 直接在根 | 所有路径都要带 `src/` 前缀 |
| 2 | `src/lib/database.ts` 导出的 **`prisma` 不是 Prisma**，是手写的 Supabase 适配器 | 不要去找 `schema.prisma` |
| 3 | 该适配器里 **`creditTransaction` / `subscription` / `paymentConfig` 三个模型是纯 mock**（返回假数据，不落库） | 积分流水、订阅实际上**没有持久化** |
| 4 | 订单表存在 **两张并行且不一致的表**：`orders`（适配器用）与 `payment_orders`（SQL 与部分路由用） | 支付链路天然断裂，webhook 幂等不可靠 |
| 5 | 项目**没有 `supabase/` 目录**，没有 migration；建表 SQL 只有 `scripts/setup-database.sql` 一份 | 无法做版本化 schema 演进 |

---

## 1. 当前项目架构

### 1.1 技术栈

| 层 | 技术 | 版本/说明 |
|---|---|---|
| 框架 | Next.js App Router | `^16.3.4`（注意：v16 已将 `middleware.ts` 改名为 `proxy.ts`） |
| UI | React 19 + Tailwind CSS 3 + shadcn/ui 风格组件 + Radix + framer-motion | `src/components/ui/*` |
| 语言 | TypeScript 5.8（strict） | `npm run lint` = `eslint . && tsc --noEmit` |
| 认证 | NextAuth v4 + Supabase Auth（credentials 模式） | `src/lib/auth.ts` |
| 数据库 | Supabase PostgreSQL + 自写适配器 | `src/lib/database.ts` |
| AI Provider | fal / KIE / WaveSpeed / AtlasCloud | `src/lib/image-generation/providers/*` |
| 支付 | Stripe + Creem | `src/lib/payment/*` |
| 存储 | Cloudflare R2（S3 兼容 SDK） | `src/lib/services/r2-storage.ts` |
| 风控 | Cloudflare Turnstile + 自研内容安全 | `src/lib/content-safety/*` |
| 部署 | Vercel（`vercel.json`） | |

### 1.2 分层现状（实际）

```
┌───────────────────────────────────────────────────────────────┐
│  Presentation   src/app/**/page.tsx + src/components/**       │
│                 (22 个语言页面 + generate/pricing/dashboard)  │
├───────────────────────────────────────────────────────────────┤
│  API Routes     src/app/api/**/route.ts  (18 个路由)          │
│                 ⚠️ 路由里混了：鉴权 + 积分 + 风控 + AI + 存储  │
├───────────────────────────────────────────────────────────────┤
│  Service        src/lib/flux-kontext.ts         (AI 门面)     │
│                 src/lib/services/credits.ts     (积分)        │
│                 src/lib/payment.ts              (支付编排)    │
│                 src/lib/services/r2-storage.ts  (存储)        │
├───────────────────────────────────────────────────────────────┤
│  Provider       src/lib/image-generation/providers/*  (4 家)  │
│                 src/lib/payment/{stripe,creem}.ts             │
│                 src/lib/services/r2-storage.ts (直接是 R2)    │
├───────────────────────────────────────────────────────────────┤
│  Data Access    src/lib/database.ts (伪 Prisma) + 直接 supabase│
│                 ⚠️ 两种访问方式并存，且部分模型是 mock         │
└───────────────────────────────────────────────────────────────┘
```

### 1.3 架构层面的核心问题（概览）

1. **路由即业务**：`/api/flux-kontext/route.ts` 单文件 804 行，把鉴权、积分扣减、Turnstile、内容安全、Provider 调用、结果校验、R2 转存、退款全部塞在一起。
2. **AI 抽象半成品**：已经有 `FluxKontextProvider` 接口和 4 个 provider 实现，但类型名、action 名、配置读取都硬绑 Flux Kontext 语义。
3. **积分有两套价格表**：`src/lib/flux-kontext-request.ts:18` 与 `src/lib/services/credits.ts:214` 各写了一份 `action → credits` 的 switch。
4. **数据访问双轨**：`prisma.*` 适配器 与 `createAdminClient().from(...)` 直连并存，表名还不一致。
5. **配置三处真相**：`src/lib/config/payment.ts`（硬编码）、`.env`（`NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER`）、`prisma.paymentConfig.findFirst()`（mock，返回 `creem`）。

---

## 2. 当前目录结构

```
flux-kontext-template/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 首页
│   │   ├── layout.tsx / globals.css
│   │   ├── ClientBody.tsx
│   │   ├── generate/page.tsx           # ⭐ 生成器主页面
│   │   ├── pricing/page.tsx            # 定价 / 支付入口
│   │   ├── dashboard/page.tsx
│   │   ├── auth/{signin,signup}/page.tsx
│   │   ├── resources/{,api}/page.tsx   # API 文档页
│   │   ├── {privacy,terms,refund}/page.tsx
│   │   ├── {ar,bn,de,es,fr,hi,it,ja,ko,nl,pl,pt,ru,tr,zh}/page.tsx   # 16 个本地化首页
│   │   ├── robots.ts / sitemap.ts / not-found.tsx
│   │   ├── llms.txt/route.ts / llms-full.txt/route.ts   # LLM 友好输出
│   │   └── api/                        # 18 个路由（见 §2.1）
│   ├── components/
│   │   ├── FluxKontextGenerator.tsx     # ⚠️ 1955 行巨型客户端组件
│   │   ├── flux-kontext/                # 生成器子模块（6 个文件）
│   │   │   ├── generator-config-card.tsx
│   │   │   ├── generator-workspace-card.tsx
│   │   │   ├── generated-images-section.tsx
│   │   │   ├── generator-error-banner.tsx
│   │   │   ├── generator-marketing-sections.tsx
│   │   │   ├── model-config.ts          # action 映射 + 模型元数据
│   │   │   ├── prompt-enhancer.ts
│   │   │   └── types.ts
│   │   ├── {Navigation,Footer,Logo,LanguageSwitcher}.tsx
│   │   ├── {HomeContent,HomeContentSimple,PricingContent,ResourcesContent}.tsx
│   │   ├── {SignInContent,SignUpContent,ApiDocumentation}.tsx
│   │   ├── {CreditDisplay,UpgradePrompt,SmartImagePreview}.tsx
│   │   ├── {StandardTurnstile,GoogleOneTap,GoogleOneTapTrigger}.tsx
│   │   ├── {FAQ,KeyFeatures,HowToSteps,StructuredData,TwitterShowcase,Analytics}.tsx
│   │   ├── providers/SessionProvider.tsx
│   │   └── ui/                          # 8 个基础 UI 组件
│   ├── lib/
│   │   ├── flux-kontext.ts              # AI 门面（FluxKontextService）
│   │   ├── flux-kontext-request.ts      # 请求工具 + 积分表 + Turnstile
│   │   ├── fal-client.ts                # fal SDK 封装
│   │   ├── database.ts                  # ⚠️ 伪 Prisma 适配器（含 mock）
│   │   ├── auth.ts / auth-supabase.ts   # NextAuth 配置
│   │   ├── payment.ts                   # 支付编排 + handlePaymentSuccess
│   │   ├── payment-security.ts          # 价格校验 / 防重 / 限流
│   │   ├── stripe-client.ts
│   │   ├── user-tiers.ts                # 用户分层 + 定价方案（含未使用逻辑）
│   │   ├── site-config.ts               # 站点配置（默认 "Flux Kontext"）
│   │   ├── image-generation/
│   │   │   ├── types.ts                 # ⚠️ FluxKontext* 命名污染
│   │   │   ├── utils.ts
│   │   │   └── providers/{index,fal,kie,wavespeed,atlascloud}-provider.ts
│   │   ├── payment/{router,stripe,creem}.ts
│   │   ├── config/payment.ts            # ⚠️ 硬编码支付配置
│   │   ├── services/
│   │   │   ├── credits.ts               # 积分服务
│   │   │   ├── r2-storage.ts            # R2 存储（直接实现，无抽象）
│   │   │   ├── order.ts                 # 订单 CRUD（走伪 Prisma）
│   │   │   ├── user.ts                  # 用户 CRUD
│   │   │   ├── payment-config.ts / payment-database.ts
│   │   │   ├── pricing.ts / affiliate.ts
│   │   ├── content-safety/{index,safe-mode}.ts
│   │   ├── content/{home,generator,pricing,auth,common,seo}.json + index.ts + locale.ts
│   │   ├── i18n/home-config.ts
│   │   ├── seo/{llms,metadata-generator}.ts
│   │   ├── types/{order,payment,pricing,user}.ts
│   │   ├── supabase/{client,server}.ts
│   │   └── utils/{hash,ip,response,time}.ts + utils.ts
│   ├── hooks/                            # 空目录
│   ├── types/{next-auth.d.ts,supabase.ts}
│   └── proxy.ts                          # Next.js 16 的 middleware（原名）
├── scripts/                              # 10 个脚本 + setup-database.sql
├── docs/                                 # 52 个 md（含大量中文教程）
├── public/                               # 10 png + ico + svg
├── env.example                           # 环境变量模板（约 90 个变量）
├── vercel.json / next.config.js / tailwind.config.ts / biome.json / eslint.config.mjs
├── AGENTS.md / CHANGELOG.md / CONTRIBUTING.md / SECURITY.md / PAYMENT_SECURITY_GUIDE.md
└── package.json  (name: "nextjs-shadcn")
```

### 2.1 API 路由清单（18 个）

| 路由 | 职责 | 耦合度 |
|---|---|---|
| `api/flux-kontext/route.ts` | POST 生成 + PUT 上传 | 🔴 极高，804 行 |
| `api/upload/route.ts` | 通用文件上传到 R2 | 🟢 低 |
| `api/verify-turnstile/route.ts` | 人机验证 | 🟢 低 |
| `api/user/credits/route.ts` | 查积分 + 交易记录 | 🟡 中（内含自动建号逻辑） |
| `api/user/credits/consume/route.ts` | 扣积分（独立入口） | 🟡 中（与主链路重复） |
| `api/user/ensure/route.ts` | 保证用户存在 | 🟡 中（与 auth signIn 重复） |
| `api/auth/[...nextauth]/route.ts` | NextAuth handler | 🟢 低 |
| `api/auth/register/route.ts` | 邮箱注册 | 🔴 **已损坏**（见 §9.6） |
| `api/payments/create-checkout/route.ts` | Creem 下单 | 🟡 中 |
| `api/payment/create-session/route.ts` | 通用下单（走 `lib/payment.ts`） | 🟡 中（与上面重复） |
| `api/webhooks/payments/route.ts` | 通用 webhook（stripe/paypal 是 TODO） | 🟡 中 |
| `api/webhooks/stripe/route.ts` | Stripe webhook（真实实现） | 🟢 低 |
| `api/admin/maintenance/route.ts` | 维护模式 | 🟡 中 |
| `api/admin/payment-config/route.ts` | 支付配置读写 | 🟡 中（操作 mock） |
| `api/debug/*`（9 个） | 调试 | 🔴 建议删除 |

---

## 3. AI 图片生成调用链（完整链路）

### 3.1 链路图

```
[1] 用户点击 Generate
     │
     ▼
[2] src/app/generate/page.tsx:35
     └─ <FluxKontextGenerator />
     │
     ▼
[3] src/components/FluxKontextGenerator.tsx  (1955 行, "use client")
     ├─ useSession()  ← next-auth/react（前端直接依赖 Auth）
     ├─ getActionForModel(model, hasImages, isMultiImage)
     │    └─ src/components/flux-kontext/model-config.ts:13
     ├─ getEnhancedPrompt()  ← prompt-enhancer.ts
     └─ fetch("/api/flux-kontext", { method: POST, body: {...} })
          ├─ L259 / L779 / L1057  （三处重复的 fetch 逻辑）
          └─ 上传图片: fetch("/api/flux-kontext", { method: PUT })  或  /api/upload
     │
     ▼
[4] src/app/api/flux-kontext/route.ts  POST  (804 行)
     │
     ├─ 4.1  request.json() → 校验 action + prompt
     ├─ 4.2  getServerSession(authOptions)               ← 鉴权
     │        └─ 未登录 → 401
     ├─ 4.3  prisma.user.findUnique({ where:{ email } })  ← 取用户
     ├─ 4.4  内容安全（可选）checkPromptSafety()          ← lib/content-safety/safe-mode.ts
     ├─ 4.5  getRequiredCredits(action)                  ← lib/flux-kontext-request.ts:18
     │        ⚠️ 硬编码价格表 #1
     ├─ 4.6  checkUserCredits(user.id, requiredCredits)  ← lib/services/credits.ts:36
     ├─ 4.7  Turnstile 验证（可选）verifyTurnstileToken() ← lib/flux-kontext-request.ts:50
     ├─ 4.8  consumeCreditsForImageGeneration()          ← lib/services/credits.ts:208
     │        ⚠️ 硬编码价格表 #2（与 4.5 重复）
     │        └─ consumeUserCredits() → prisma.user.update({credits:{decrement}})
     │           → prisma.creditTransaction.create()  ❌ MOCK，不落库
     ├─ 4.9  isFluxKontextAction(body.action)
     ├─ 4.10 FluxKontextService.getProviderName()        ← 读 IMAGE_GENERATION_PROVIDER
     ├─ 4.11 FluxKontextService.generateAction(action, input)
     ├─ 4.12 结果校验（多字段名兜底：images / data.images / output / outputs / result）
     ├─ 4.13 URL 有效性校验 + 过滤无效图
     ├─ 4.14 生成结果内容安全（可选）checkImageSafety()
     ├─ 4.15 R2 转存（可选，串行 + 每张间隔 2 秒）
     │        └─ FluxKontextService.saveGeneratedImageToR2() → r2Storage.uploadFromUrl()
     ├─ 4.16 返回 { success, provider, data, credits_remaining, safety_check }
     └─ 4.17 失败分支：prisma.user.update({ credits:{ increment } })  ← 退款
     │
     ▼
[5] src/lib/flux-kontext.ts:40  FluxKontextService.generateAction()
     └─ getImageGenerationProvider()  ← src/lib/image-generation/providers/index.ts:19
          └─ providerRegistry[providerName]  ← 4 个 provider 单例
     │
     ▼
[6] src/lib/image-generation/providers/fal-provider.ts:122
     ├─ FAL_ACTIONS[action] → { endpoint, buildInput }
     └─ subscribeToFal(endpoint, { input, logs, onQueueUpdate })
          └─ src/lib/fal-client.ts → @fal-ai/client → https://fal.ai
     │
     ▼
[7] 第三方 AI API：fal.ai
     ├─ fal-ai/flux-pro/kontext
     ├─ fal-ai/flux-pro/kontext/max
     ├─ fal-ai/flux-pro/kontext/multi
     ├─ fal-ai/flux-pro/v1.1
     ├─ fal-ai/flux/schnell  /  fal-ai/flux/dev  /  fal-ai/flux-general
     └─ （kie / wavespeed / atlascloud 为任务式接口，走 submitTask + getTaskResult）
     │
     ▼
[8] 返回结果归一化
     └─ normalizeGenerationResult(provider, payload)  ← lib/image-generation/utils.ts:127
          → { images[], prompt, seed, timings, has_nsfw_concepts, provider, raw }
     │
     ▼
[9] 是否保存图片？
     ├─ 仅当 NEXT_PUBLIC_ENABLE_R2 === "true" 且 R2_* 齐全
     ├─ 串行转存，每张之间 sleep 2 秒（route.ts:561-564）
     ├─ 返回对象同时带 url（fal）/ r2_url / fal_url / storage 字段
     └─ ❌ 不写入数据库（generations 表从未被写入）
     │
     ▼
[10] 是否扣 Credit？
     ├─ ✅ 在生成【之前】扣（route.ts:209）
     ├─ ✅ 失败时退还（route.ts:656，直接 increment，不走 CreditService）
     └─ ❌ 扣减流水不落库（creditTransaction 是 mock）
```

### 3.2 关键文件与行号索引

| 环节 | 文件 | 关键行 |
|---|---|---|
| 页面入口 | `src/app/generate/page.tsx` | 35 |
| 生成器组件 | `src/components/FluxKontextGenerator.tsx` | 259 / 779 / 1057（fetch） |
| API 入口 | `src/app/api/flux-kontext/route.ts` | 16（POST）/ 748（PUT） |
| 积分价格表 #1 | `src/lib/flux-kontext-request.ts` | 18-39 |
| 积分价格表 #2 | `src/lib/services/credits.ts` | 214-244 |
| AI 门面 | `src/lib/flux-kontext.ts` | 40-51 |
| Provider 注册表 | `src/lib/image-generation/providers/index.ts` | 11-23 |
| fal 实现 | `src/lib/image-generation/providers/fal-provider.ts` | 31-116（端点表）/ 122 |
| 结果归一化 | `src/lib/image-generation/utils.ts` | 127-146 |
| R2 转存 | `src/lib/services/r2-storage.ts` | 280-374 |
| 退款 | `src/app/api/flux-kontext/route.ts` | 654-663 |

### 3.3 已实现但**未被使用**的能力（值得注意）

- `FluxKontextService.submitToQueue()` / `checkQueueStatus()` / `getQueueResult()` / `verifyWebhook()` —— 异步任务能力已写好，但**没有任何 API 路由调用**。
- `r2Storage.uploadMultipleFromUrls()` —— 未被调用（route 里自己写了 for 循环）。
- `r2Storage.getFileUrl()` —— 未被调用，且 URL 格式与 `uploadFile` 不一致。
- `generations` 表 —— SQL 建了，代码从未写入。
- `lib/user-tiers.ts` 的 `getCurrentUserType()` —— 读 `localStorage` 判断付费状态，无任何写入方。
- `lib/payment/router.ts` 的 `selectPaymentProvider()` —— 未被任何路由调用（路由走 `lib/config/payment.ts` 或直连）。
- `lib/payment.ts` 的 `createPaymentSession()` —— 只被 `/api/payment/create-session` 调用，而前端调用的是 `/api/payments/create-checkout`。

---

## 4. Auth 调用链

```
用户点击登录
   │
   ▼
src/components/Navigation.tsx → /auth/signin
   │
   ▼
src/components/SignInContent.tsx → signIn(provider)  ← next-auth/react
   │
   ▼
src/app/api/auth/[...nextauth]/route.ts
   │
   ▼
src/lib/auth.ts  authOptions
   ├─ providers（条件注册）
   │   ├─ GoogleProvider      ← NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true + GOOGLE_ID/SECRET
   │   ├─ GitHubProvider      ← NEXT_PUBLIC_AUTH_GITHUB_ENABLED=true + AUTH_GITHUB_ID/SECRET
   │   └─ CredentialsProvider ← NEXT_PUBLIC_AUTH_CREDENTIALS_ENABLED=true
   │        └─ supabase.auth.signInWithPassword()（生产）
   │        └─ test@example.com / password（开发硬编码后门）
   ├─ callbacks.signIn()      ← src/lib/auth.ts:213
   │   ├─ createAdminClient()  ← 直连 Supabase（不用适配器）
   │   ├─ 查 users by email
   │   ├─ 不存在 → insert users（credits: 100）
   │   │            + insert credit_transactions(type: 'gift')  ⚠️ 违反 CHECK 约束
   │   └─ 存在 → 更新 last_signin_at / signin_count
   ├─ callbacks.redirect()    → 默认 /generate
   ├─ callbacks.session()     → 原样返回（❗未注入 user.id）
   └─ callbacks.jwt()         → token.user = user
   │
   ▼
消费端（全部重新查库）
   ├─ getServerSession(authOptions) → session.user.email
   └─ 再用 email 去 users 表查 id      ← 因为 session 里没有 id
```

### 4.1 Auth 的关键问题

| 问题 | 位置 | 说明 |
|---|---|---|
| session 不含 `user.id` | `src/lib/auth.ts:351` | 导致每个 API 都要多一次 `users` 查询 |
| 用户创建逻辑重复 4 份 | `auth.ts:213`、`api/user/credits/route.ts:33`、`api/user/ensure/route.ts`、`api/auth/register/route.ts` | 四处各写一遍建号 + 送积分 |
| `credit_transactions.type='gift'` 违反 DB 约束 | `auth.ts:285` | SQL 的 CHECK 只允许 `purchase/usage/refund/bonus` |
| 开发环境硬编码后门账号 | `auth.ts:87-95` | `test@example.com` / `password` |
| `detectUserLocation()` 是死代码 | `auth.ts:366` | 永远返回 `"US"` |
| 注册接口已损坏 | `api/auth/register/route.ts:42` | 见 §9.6 |

---

## 5. Credit 调用链

### 5.1 现状

积分余额存在 **`users.credits`（INTEGER）** 单列，没有独立的 `credit_account` 表。

```
┌─ 写入方（共 6 处，全部绕过统一服务）───────────────────────────┐
│                                                                 │
│ 1. src/lib/services/credits.ts                                  │
│      consumeUserCredits()      → prisma.user.update(decrement)  │
│                                → prisma.creditTransaction.create ❌ mock
│      grantUserCredits()        → prisma.user.update(increment)  │
│                                → prisma.creditTransaction.create ❌ mock
│                                                                 │
│ 2. src/app/api/flux-kontext/route.ts:209                        │
│      consumeCreditsForImageGeneration() → 复用 #1                │
│    src/app/api/flux-kontext/route.ts:656                        │
│      退款 → prisma.user.update({credits:{increment}})  ⚠️ 直写   │
│                                                                 │
│ 3. src/lib/auth.ts:279                                          │
│      注册送 100 → supabase.from('credit_transactions').insert()  │
│                                                                 │
│ 4. src/app/api/user/credits/route.ts:78                         │
│      自动建号送 100 → supabase.from('credit_transactions').insert│
│                                                                 │
│ 5. src/app/api/user/credits/consume/route.ts:66                 │
│      独立扣积分入口 → supabase.from('users').update()            │
│      → supabase.from('credit_transactions').insert()            │
│                                                                 │
│ 6. src/lib/payment.ts:447 / src/lib/payment/creem.ts:425        │
│      购买积分 → prisma.user.update(increment)                    │
│                → prisma.creditTransaction.create ❌ mock         │
└─────────────────────────────────────────────────────────────────┘

┌─ 读取方 ────────────────────────────────────────────────────────┐
│ src/lib/services/credits.ts:36   checkUserCredits()              │
│ src/app/api/user/credits/route.ts:24                             │
│ src/components/CreditDisplay.tsx → /api/user/credits             │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 价格表（两份，内容相同但重复）

| action | credits |
|---|---|
| `text-to-image-pro` / `edit-image-pro` / `edit-multi-image-pro` | 15 |
| `text-to-image-max` / `edit-image-max` | 30 |
| `edit-multi-image-max` | 45 |
| `text-to-image-schnell` | 8 |
| `text-to-image-dev` | 12 |
| `text-to-image-realism` / `text-to-image-anime` | 20 |
| 默认 | 15 |

### 5.3 Credit 的关键问题

| 问题 | 影响 |
|---|---|
| **流水不落库**（`creditTransaction` 是 mock） | 无法审计、无法对账、无法幂等 |
| 价格表两份硬编码 | 改价要改两个文件，容易漏 |
| 扣减非原子 | `checkUserCredits` → `update` 之间无事务，并发下可超扣 |
| 退款不走服务层 | 失败退款是裸 `increment`，无流水、无幂等标记 |
| 无幂等键 | 重试会重复扣 / 重复退 |
| `getUserCreditHistory()` 是 stub | 永远返回 `[]` |
| 扣减在 AI 调用**之前** | 设计合理，但失败退款依赖 try/catch，超时（55s `Promise.race`）时**不会退款**（见 §9.3） |

---

## 6. Payment 调用链

### 6.1 两条并行的下单链路

```
【链路 A】前端实际使用的（Creem 专用）
src/components/PricingContent.tsx:95
   └─ POST /api/payments/create-checkout
        └─ src/app/api/payments/create-checkout/route.ts
             ├─ getServerSession()
             ├─ supabase.from('users').select()      ← 直连
             ├─ performSecurityChecks()              ← lib/payment-security.ts
             │    ├─ validatePrice()      （STANDARD_PRICING 硬编码）
             │    ├─ checkDuplicateOrder()  → payment_orders
             │    └─ checkPaymentRateLimit()
             ├─ supabase.from('payment_orders').insert()   ← 表 A
             ├─ createCreemCheckout()                ← lib/payment/creem.ts:101
             └─ supabase.from('payment_orders').update({ creemCheckoutId: ... })
                  ⚠️ camelCase 列名，DB 是 creem_checkout_id → 静默失效

【链路 B】备用/半废弃的（Stripe + Creem 通用）
POST /api/payment/create-session
   └─ src/lib/payment.ts:54  createPaymentSession()
        ├─ determinePaymentProvider()   ← 读 lib/config/payment.ts 硬编码
        ├─ createPaymentOrder() → prisma.paymentOrder.create()
        │                         ⚠️ 表 B：orders（不是 payment_orders）
        ├─ createStripeSession()  → lib/payment/stripe.ts
        └─ createCreemSession()   → lib/payment/creem.ts
```

### 6.2 Webhook 链路

```
【Stripe】
POST /api/webhooks/stripe
   └─ src/app/api/webhooks/stripe/route.ts
        ├─ stripe.webhooks.constructEvent()  ✅ 真实签名校验
        ├─ checkout.session.completed
        │    └─ handlePaymentSuccess("stripe", session.id)
        │         └─ lib/payment.ts:330 handleStripeSuccess()
        │              ├─ 查订单 prisma.paymentOrder.findUnique()  ⚠️ 表 B
        │              ├─ order.status !== 'pending' → 直接返回（幂等靠状态）
        │              ├─ 更新 status='completed'
        │              └─ processOrderCompletion()
        │                   ├─ prisma.user.update(credits increment)
        │                   ├─ prisma.creditTransaction.create()  ❌ mock
        │                   ├─ prisma.subscription.*               ❌ mock
        │                   └─ processAffiliateForOrder()
        ├─ invoice.payment_succeeded  → 只 console.log（未处理）
        └─ customer.subscription.deleted → 只 console.log（未处理）

【Creem】
POST /api/webhooks/payments
   └─ src/app/api/webhooks/payments/route.ts
        ├─ detectPaymentProvider()   ← 靠 header / body 猜
        ├─ case 'creem'  → handleCreemWebhook()
        │    └─ lib/payment/creem.ts:212
        │         ├─ HMAC-SHA256 签名校验  ✅
        │         ├─ checkout.completed → handleCheckoutCompleted()
        │         │    ├─ 查订单 prisma.paymentOrder.findFirst()  ⚠️ 表 B
        │         │    ├─ 完整性校验：status / amount / user / product / hash  ✅ 做得不错
        │         │    ├─ 更新 status='completed'
        │         │    └─ creditPack → 发积分（user.update + mock 流水）
        │         │        subscription → mock 订阅
        │         ├─ checkout.failed / cancelled → 更新状态
        │         └─ subscription.created/updated/cancelled → mock
        ├─ case 'stripe' → TODO 空实现
        └─ case 'paypal' → TODO 空实现
```

### 6.3 Payment 的关键问题

| 问题 | 严重度 | 说明 |
|---|---|---|
| **订单表双轨**（`orders` vs `payment_orders`） | 🔴 致命 | 下单写 `payment_orders`，webhook 读 `orders` → **支付成功后查不到订单，积分发不出去** |
| `creemCheckoutId` camelCase 列名 | 🔴 高 | 下单后写不回 checkout id → webhook 靠 `payment_orders` 找不到订单 |
| 积分/订阅流水是 mock | 🔴 高 | 无法审计、无法幂等 |
| 两套下单入口 | 🟡 中 | `/api/payments/create-checkout` 与 `/api/payment/create-session` 职责重叠 |
| 配置三处真相 | 🟡 中 | `config/payment.ts` 硬编码 `DEFAULT_PROVIDER: "creem"`；env 写 `stripe`；mock 返回 `creem` |
| `payment_configs` 表 + mock | 🟡 中 | 为「一行配置」建表，过度设计 |
| webhook 无事件级幂等 | 🟡 中 | 仅靠订单状态判断，重放同事件在状态未更新前会重复处理 |
| 通用 webhook 靠猜 provider | 🟡 中 | header 缺失时默认 `creem`，可能误路由 |
| Stripe webhook 有两条路径 | 🟡 中 | `/api/webhooks/stripe`（真）与 `/api/webhooks/payments` case stripe（TODO），行为不一致 |
| `PAYMENT_SECURITY_GUIDE.md` 与实际不一致 | 🟢 低 | 文档未随代码更新 |

---

## 7. Storage 调用链

```
┌─ 调用方 ───────────────────────────────────────────────────────┐
│ 1. POST /api/upload                     → r2Storage.uploadFile()        │
│ 2. PUT  /api/flux-kontext               → FluxKontextService.uploadFile()│
│      └─ provider.uploadFile() (fal storage) → 失败则 r2Storage.uploadFile│
│ 3. POST /api/flux-kontext（生成后转存） → saveGeneratedImageToR2()        │
│      └─ r2Storage.uploadFromUrl()                                        │
│ 4. （未使用）r2Storage.uploadMultipleFromUrls()                          │
│ 5. （未使用）r2Storage.getFileUrl()                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        src/lib/services/r2-storage.ts  class R2StorageService
        ├─ S3Client (endpoint: https://{accountId}.r2.cloudflarestorage.com)
        ├─ ConcurrencyQueue  (maxConcurrency = 1, 间隔 1.5s)
        ├─ withRetry()       (429 指数退避，最多 3 次)
        ├─ detectImageContentType()  (magic bytes 嗅探)
        ├─ validateImageBuffer()
        ├─ verifyR2UrlAccessibility()  (HEAD 自检)
        └─ 导出单例 r2Storage
```

### 7.1 Storage 的关键问题

| 问题 | 说明 |
|---|---|
| **无抽象层** | 业务代码直接 `import { r2Storage }`，换 S3 要改所有调用点 |
| **public URL 生成有两套且不一致** | `uploadFile` → `https://{bucket}.{accountId}.r2.cloudflarestorage.com/{key}`（这是 S3 API 端点，**默认不可公开读**）；`getFileUrl` → `https://pub-{accountId}.r2.dev/{key}` |
| **`R2_PUBLIC_URL` / `R2_CUSTOM_DOMAIN` 声明了但从未使用** | `env.example:82-83` 有，代码里搜不到 |
| Flux 品牌硬编码在存储层 | `r2-storage.ts:245` 文件名前缀 `flux-kontext-`；`User-Agent: FluxKontext/1.0`（多处） |
| 硬编码 2 秒 sleep 做限流 | `route.ts:563`，应在存储层统一 |
| 无 `delete()` | 接口要求 `upload/delete/getUrl` 三件套，当前缺 `delete` |
| 文件类型白名单分散 | `api/upload/route.ts` 与 `api/flux-kontext` PUT 各写一份 |

---

## 8. Database 结构

### 8.1 建表 SQL（唯一来源：`scripts/setup-database.sql`）

| 表 | 用途 | 代码是否真实读写 |
|---|---|---|
| `users` | 用户 + 积分余额（`credits` 列） | ✅ 真实 |
| `payment_orders` | 订单 | ⚠️ 部分路由真实读写；适配器读的是 `orders` |
| `credit_transactions` | 积分流水 | ⚠️ 直连 Supabase 的地方真实；适配器是 mock |
| `subscriptions` | 订阅 | ❌ 只有 mock |
| `payment_configs` | 支付配置（单行） | ❌ 只有 mock |
| `generations` | 生成历史 | ❌ 从未写入 |
| `orders` | — | ⚠️ **SQL 里根本没建这张表**，但适配器在查它 |

### 8.2 `users` 表字段

```
id (uuid PK) · email (unique) · name · image · credits (int, default 100)
location · last_signin_at · signin_count · signin_type · signin_provider
signin_openid · signin_ip · preferred_currency · preferred_payment_provider
created_at · updated_at
```

> ❗ 没有 `password` 列，但 `api/auth/register/route.ts:42` 在写 `password`。
> ❗ `signin_*` 六个字段是第三方登录 SDK 的遗留字段，通用模板中价值很低。

### 8.3 `credit_transactions` 表约束

```sql
type VARCHAR NOT NULL CHECK (type IN ('purchase', 'usage', 'refund', 'bonus'))
```

> ❗ 代码里实际写入过 `type='gift'`（`auth.ts:285`、`api/user/credits/route.ts:84`）→ **CHECK 约束会拒绝插入**。
> 目标设计需要 `REGISTER_BONUS / PURCHASE / GENERATION / REFUND / ADMIN_ADJUSTMENT`。

### 8.4 RLS 策略

已为 `users` / `payment_orders` / `credit_transactions` / `subscriptions` / `generations` 开启 RLS 并写了「用户只能看自己数据」策略。

> ⚠️ 但服务端全部使用 **service_role key**（`createAdminClient()`），service_role 会**绕过 RLS**。所以 RLS 在当前架构下实际不起作用，只是安全兜底。

### 8.5 数据访问双轨（必须统一）

| 方式 | 文件 | 用到的表 |
|---|---|---|
| 伪 Prisma 适配器 | `src/lib/database.ts` | `users`、`orders`(8 处) |
| 直连 Supabase | 13 个文件 | `users`(29)、`credit_transactions`(6)、`payment_orders`(5) |

统计：`users` 29 次、`orders` 8 次、`credit_transactions` 6 次、`payment_orders` 5 次。

---

## 9. 当前 Flux-Kontext 专属代码

### 9.1 命名空间级耦合（60 个文件提及 flux）

**🔴 必须重命名/迁移（核心层）**

| 文件 | 耦合形式 |
|---|---|
| `src/app/api/flux-kontext/route.ts` | 路由路径本身 |
| `src/lib/flux-kontext.ts` | `class FluxKontextService` |
| `src/lib/flux-kontext-request.ts` | `[flux-kontext]` 日志前缀 + 积分表 |
| `src/lib/image-generation/types.ts` | `FLUX_KONTEXT_ACTIONS`、`FluxKontextAction`、`FluxKontextProvider`、`FluxKontextResult`、`FluxKontextGenerationRequest` … 全套类型名 |
| `src/lib/image-generation/utils.ts` | `isFluxKontextAction()`、`aspectRatioToFalImageSize()` |
| `src/components/FluxKontextGenerator.tsx` | 组件名 + 1955 行 |
| `src/components/flux-kontext/*`（8 文件） | 目录名 + `FluxKontextAction` 类型 |
| `src/proxy.ts:49-70` | `/api/v1/text-to-image/pro` 等 API 表面 |

**🟡 需要改造（Provider 层，可保留价值但要去品牌化）**

| 文件 | 耦合形式 |
|---|---|
| `src/lib/image-generation/providers/fal-provider.ts` | `FAL_ENDPOINTS` 全为 flux 端点（可保留，属于模型配置） |
| `.../kie-provider.ts` / `.../wavespeed-provider.ts` / `.../atlascloud-provider.ts` | 同上 |
| `src/lib/fal-client.ts` | fal 专用（合理，属 provider 实现） |
| `src/lib/payment/creem.ts:288` | `FluxKontext/1.0` UA |
| `src/lib/services/r2-storage.ts:245` | 文件名前缀 `flux-kontext-` + UA |
| `src/lib/payment/creem.ts` | `CREEM_PRODUCT_IDS` 硬编码产品 |
| `src/app/api/payments/create-checkout/route.ts:219` | `product_name: "Flux Kontext ..."` |

**🟡 品牌文案/SEO 耦合（22 个页面 + 8 个组件 + 6 个 JSON）**

| 类别 | 文件 |
|---|---|
| 本地化页面 | `src/app/{ar,bn,de,es,fr,hi,it,ja,ko,nl,pl,pt,ru,tr,zh}/page.tsx` |
| 核心页面 | `page.tsx`、`generate/page.tsx`、`pricing/page.tsx`、`dashboard/page.tsx`、`layout.tsx`、`privacy`、`terms`、`refund`、`resources/*` |
| 组件 | `Logo.tsx`、`HomeContent.tsx`、`KeyFeatures.tsx`、`FAQ.tsx`、`StructuredData.tsx`、`UpgradePrompt.tsx`、`ResourcesContent.tsx`、`ApiDocumentation.tsx` |
| 内容 | `src/lib/content/*.json`（6 个）、`src/lib/i18n/home-config.ts` |
| SEO | `src/lib/seo/metadata-generator.ts`、`llms.ts` |
| 配置 | `src/lib/site-config.ts:88`（默认 `"Flux Kontext"`） |
| 工程 | `package.json` name `nextjs-shadcn`、`env.example` 标题 |

### 9.2 建议保留为 Provider/Model 层的部分

以下**不应删除**，只需去品牌化后放进 `ai/providers/` 或模型配置：

- `FAL_ENDPOINTS` 端点表 → 改为 `models` 配置（`flux-pro/kontext` 只是其中一个 model id）
- `kie-provider.ts` / `wavespeed-provider.ts` / `atlascloud-provider.ts` → 通用 Provider 实现
- `fal-client.ts` → fal Provider 的私有实现细节

---

## 10. 当前可以直接复用的通用代码

### 10.1 高价值、低改造量（推荐直接搬进 `lib/`）

| 模块 | 文件 | 复用价值 |
|---|---|---|
| Provider 接口雏形 | `src/lib/image-generation/types.ts` | 已有 `generate / uploadFile / submitTask / getTaskResult / verifyWebhook` 五件套 |
| Provider 注册表 | `src/lib/image-generation/providers/index.ts` | 注册表模式已成型 |
| 结果归一化 | `src/lib/image-generation/utils.ts` | `normalizeGenerationResult` / `firstNonEmptyImageList` 多字段兜底很实用 |
| 4 个 Provider 实现 | `providers/{fal,kie,wavespeed,atlascloud}-provider.ts` | 约 1200 行真实可用的第三方对接代码 |
| R2 存储 | `src/lib/services/r2-storage.ts` | 467 行，含并发队列/重试/magic bytes 嗅探/HEAD 自检 |
| Supabase 客户端 | `src/lib/supabase/{client,server}.ts` | `createClient` / `createAdminClient` 干净 |
| NextAuth 配置 | `src/lib/auth.ts` | Cookie 安全配置、多 provider 条件注册 |
| 支付 Provider | `src/lib/payment/{stripe,creem}.ts` | Stripe/Creem 真实对接 + Creem webhook 完整性校验做得很好 |
| 支付风控 | `src/lib/payment-security.ts` | 价格校验/防重单/限流，556 行 |
| Turnstile | `src/components/StandardTurnstile.tsx` + `verifyTurnstileToken()` | 529 行组件 + 带重试的服务端校验 |
| 内容安全 | `src/lib/content-safety/*` | 多 provider 内容审核 |
| 基础 UI | `src/components/ui/*` | 8 个 shadcn 组件 |
| 布局组件 | `Navigation` / `Footer` / `Logo` / `LanguageSwitcher` | 只需换文案 |
| 积分展示 | `CreditDisplay.tsx` / `UpgradePrompt.tsx` | 只需换接口路径 |
| i18n 骨架 | `src/lib/content/*` + `locale.ts` | 16 语言，结构完整 |
| SEO 骨架 | `src/lib/seo/*` + `sitemap.ts` + `robots.ts` + `llms*.txt` | 多语言 canonical 策略完整 |
| 工具函数 | `src/lib/utils/{hash,ip,response,time}.ts` | 通用 |
| 脚本 | `scripts/{kill-ports,check-config,check-supabase,quick-setup}.js` | 通用开发体验 |
| Next.js 16 proxy | `src/proxy.ts` | 安全头 + 限流 + API 重写，价值高 |

### 10.2 需要重构后才可复用

| 模块 | 原因 |
|---|---|
| `src/lib/database.ts` | 需要去掉 mock，统一表名，拆成 repository |
| `src/lib/services/credits.ts` | 需要加幂等、退款、去重价格表 |
| `src/lib/payment.ts` | 需要统一订单表 + 走 CreditService |
| `src/app/api/flux-kontext/route.ts` | 需要把编排逻辑下沉到 Workflow |
| `src/components/FluxKontextGenerator.tsx` | 1955 行，需拆分 + 去业务名 |

---

## 11. 当前设计中存在的业务耦合

按耦合类型归类：

### 11.1 AI 能力耦合（最严重）

1. **类型名 = 业务名**：`FluxKontextAction`、`FluxKontextProvider`、`FluxKontextResult` —— Provider 层接口被产品名污染。
2. **action 即业务动作**：`text-to-image-pro` / `edit-multi-image-max` 等 10 个 action 是「Flux Kontext 产品功能」，不是「模型能力」。换成视频产品时这套 action 完全不可用。
3. **provider 选择 = 全局单例**：`getConfiguredImageProvider()` 读一个全局 env `IMAGE_GENERATION_PROVIDER`，无法「图片用 fal、视频用 kie」。
4. **同步阻塞为主**：主链路只走 `generate()`（同步 subscribe），`submitTask` 异步能力未接线。

### 11.2 积分耦合

5. **价格表写在 AI 请求工具里**：`flux-kontext-request.ts` 本该是纯工具，却持有业务定价。
6. **价格表两份**：`flux-kontext-request.ts:18` + `services/credits.ts:214`。
7. **扣减逻辑在路由里**：AI 路由直接调 `consumeCreditsForImageGeneration(userId, prompt, action)`，prompt 和 action 被塞进积分服务。
8. **退款逻辑在路由里**：`route.ts:656` 裸写 `increment`。

### 11.3 支付耦合

9. **`product_name` 硬编码品牌**：`"Flux Kontext Subscription"`。
10. **`CREEM_PRODUCT_IDS` 硬编码**：产品 ID 写死在代码。
11. **`STANDARD_PRICING` 硬编码**：`payment-security.ts` 里维护价格表。
12. **配置三处真相**（见 §6.3）。

### 11.4 存储耦合

13. **业务层直接 `import { r2Storage }`**：无 `StorageService` 中间层。
14. **文件名前缀 `flux-kontext-`** 写死在存储实现里。
15. **限流 sleep 写在路由**（2 秒），不在存储层。

### 11.5 认证耦合

16. **session 不带 `user.id`** → 业务层被迫 `prisma.user.findUnique({where:{email}})`。
17. **建号逻辑重复 4 份**，且都直接操作 Supabase。
18. **AI Workflow 直接依赖 `getServerSession(authOptions)`**（`route.ts:45`）。

### 11.6 数据库耦合

19. **伪 Prisma 适配器泄漏 Prisma 语义**（`where` / `orderBy` / `take`），业务层误以为在用 ORM。
20. **表名双轨** `orders` / `payment_orders`。
21. **mock 冒充真实实现**：`creditTransaction` / `subscription` / `paymentConfig` 返回假数据但签名像真的，是最大的隐蔽陷阱。

### 11.7 前端耦合

22. **1955 行单组件** `FluxKontextGenerator.tsx`，含 3 处重复 fetch 逻辑。
23. **前端直接 `useSession()`**（next-auth/react），UI 层绑定认证实现。
24. **`user-tiers.ts` 读 `localStorage('user-session')`** 判断付费状态，但没有任何代码写入该 key → 永远判定为 ANONYMOUS。

### 11.8 工程耦合

25. **9 个 debug 路由**混在生产路由目录（靠 env 关闭）。
26. **`docs/` 52 个文件**，大量中文教程，与代码同步性无保障。
27. **`env.example` 90 个变量**，含大量未使用项（`SEGMIND_API_KEY`、`RUNWAY_API_KEY`、`SMTP_*`、`GOOGLE_CLOUD_VISION_API_KEY`、`API4AI_API_KEY`、`AZURE_CONTENT_SAFETY_*`、`IPAPI_KEY` 等）。

---

## 12. 建议删除的代码

> 原则：删之前先确认无引用；每一项都给出理由。

### 12.1 直接删除（死代码 / 损坏代码 / 调试代码）

| 目标 | 理由 | 验证方式 |
|---|---|---|
| `src/app/api/debug/**`（9 个路由） | 调试用，`proxy.ts` 已按 env 屏蔽；模板不需要 | 全局搜 `/api/debug` 确认无前端引用 |
| `src/app/api/auth/register/route.ts` | 写 `password` 列（不存在）+ `prisma.user.create` 缺 id → 必然失败；邮箱注册走 Supabase Auth 即可 | 搜 `auth/register` 前端引用 |
| `src/lib/auth.ts:366 detectUserLocation()` | 死函数，永远返回 `"US"` | 搜函数名 |
| `src/lib/auth.ts:87-95` 开发后门账号 | 硬编码 `test@example.com/password` | — |
| `src/lib/user-tiers.ts:217 getCurrentUserType()` | 读永不存在的 localStorage key | 搜函数名 |
| `src/lib/user-tiers.ts:184 pricingPlans` | 与 `pricing.ts` / `content/pricing.json` 重复 | 搜 `pricingPlans` |
| `src/lib/database.ts` 中 `paymentConfig` 模型 | 返回 mock，且 `payment_configs` 表本身就是过度设计 | 搜 `prisma.paymentConfig` |
| `src/lib/database.ts:587 groupBy()` / `603 aggregate()` | 返回**伪造的统计数字**（`_count: 120`、`_sum: 15750`） | 搜调用点（应为 0） |
| `src/lib/services/credits.ts:189 getUserCreditHistory()` | stub，永远返回 `[]` | 搜调用点 |
| `src/lib/payment/router.ts` | 未被调用；且含 `HK`/`TW` 作为独立国家/地区的路由规则（合规问题） | 搜 `selectPaymentProvider` |
| `src/app/api/payment/create-session/route.ts` + `lib/payment.ts:54 createPaymentSession` | 与 `/api/payments/create-checkout` 重复；且走错表 | 确认前端只用 create-checkout |
| `src/lib/services/payment-database.ts` | 与 `database.ts` / `payment-config.ts` 职责重叠 | 搜引用 |
| `src/lib/services/affiliate.ts` | 推荐系统，模板不需要（且被 payment 流程强依赖，需一并处理） | 搜 `affiliate` |
| `src/lib/services/order.ts` 中的 `getOrderCountByDate` / `markExpiredOrders` / `cleanupExpiredOrders` / `getPaidOrders*` | 后台统计功能，模板不需要 | 搜引用 |
| `src/lib/tasks/order-cleanup.ts` | 依赖上面的清理函数 | 搜引用 |
| `src/lib/content-safety/index.ts`（581 行） | 与 `safe-mode.ts`（376 行）重复，且实际只用了 safe-mode | 搜 `content-safety` 引用 |
| `src/lib/services/pricing.ts`（363 行） | 需确认是否与 `content/pricing.json` 重复 | 搜引用 |
| `env.example` 未使用变量 | `SEGMIND_*`、`RUNWAY_*`、`SMTP_*`、`GOOGLE_CLOUD_VISION_API_KEY`、`API4AI_API_KEY`、`AZURE_CONTENT_SAFETY_*`、`GOOGLE_SITE_VERIFICATION`、`NEXT_PUBLIC_CUSTOM_ANALYTICS_*`、`IPAPI_KEY` | 逐个 grep |
| `docs/` 中纯教程类 md | 约 30 个「小白/学习指南」类文件与模板无关 | 人工确认 |
| `public/` 中的演示图（10 png） | 换品牌后失效 | — |

### 12.2 需要谨慎处理（先改后删）

| 目标 | 说明 |
|---|---|
| `src/lib/config/payment.ts` | 删除前需把 `DEFAULT_PROVIDER` 等迁到 `config/app.ts` |
| `src/lib/payment-security.ts` 的 `STANDARD_PRICING` | 迁到 `config/pricing.ts` 后再删 |
| `payment_configs` 表 | 迁配置到 `config/` 后再从 SQL 移除 |
| `users` 表的 `signin_*` 6 个字段 | 通用模板价值低，但删除涉及建号逻辑，需一起改 |
| `subscriptions` 表 | 当前只有 mock，但目标架构需要；建议**保留表 + 真实实现**而非删除 |

---

## 13. 建议重构的代码

| 目标 | 现状 | 重构方向 | 优先级 |
|---|---|---|---|
| `src/app/api/flux-kontext/route.ts` | 804 行，职责全包 | 拆为：`app/api/ai/[workflow]/route.ts`（薄入口） + `lib/workflows/image.ts`（编排） | P0 |
| `src/lib/image-generation/types.ts` | `FluxKontext*` 命名 | → `lib/ai/types.ts`，通用 `GenerateRequest/GenerateResult/AIProvider` | P0 |
| `src/lib/image-generation/providers/*` | FluxKontext 接口 | → `lib/ai/providers/*`，实现通用接口；fal 端点表 → model 配置 | P0 |
| `src/lib/flux-kontext.ts` | `FluxKontextService` 静态类 | → `lib/ai/service.ts` 的 `AIService`（按 modality 解析 provider） | P0 |
| `src/lib/services/credits.ts` | 函数式 + 双价格表 + 无幂等 | → `lib/credit/service.ts` 的 `CreditService`（getBalance/consume/refund/add + idempotencyKey） | P0 |
| `src/lib/database.ts` | 伪 Prisma + mock | → `lib/db/repositories/*`（users / credits / orders / generations），去掉 mock | P0 |
| `src/lib/payment.ts` + `lib/payment/creem.ts` | 订单表双轨 + mock 流水 | → `lib/billing/service.ts` + `lib/billing/providers/{stripe,creem}.ts` | P1 |
| `src/lib/services/r2-storage.ts` | 无抽象 | → `lib/storage/service.ts` + `lib/storage/providers/r2.ts` | P1 |
| `src/lib/auth.ts` | session 无 id + 建号重复 | → session 注入 `user.id`；建号收敛到 `lib/auth/user-sync.ts` | P1 |
| `src/components/FluxKontextGenerator.tsx` | 1955 行 | → 拆为 `components/generator/` 下的状态 hook + 3~4 个子组件 | P2 |
| `src/lib/flux-kontext-request.ts` | 工具 + 价格表 + Turnstile 混合 | 价格表 → `config/credits.ts`；Turnstile → `lib/security/turnstile.ts` | P1 |
| `src/lib/site-config.ts` | 品牌默认值 | 保留结构，默认值改为读 `config/app.ts` | P2 |
| `src/proxy.ts` | `/api/v1/text-to-image/*` 重写 | → 通用 `/api/v1/ai/:workflow` 重写 | P2 |
| `env.example` | 90 个变量无分组 | 按 `core / ai / auth / db / billing / storage / security / optional` 重写 | P2 |
| `scripts/setup-database.sql` | 单文件 + 表名不一致 | → `supabase/migrations/*.sql` 版本化 | P1 |

---

## 14. 建议新增的抽象

> 原则：**只加真正需要的**。以下每一项都标注了「是否已有第二个实现」——只有单一实现且无替换需求的，**不引入接口**。

### 14.1 必须新增（有真实替换需求）

| 抽象 | 位置 | 为什么需要 |
|---|---|---|
| `AIProvider` 接口 | `src/lib/ai/types.ts` | ✅ 已有 4 个实现（fal/kie/wavespeed/atlascloud），抽象收益明确 |
| `AIService` | `src/lib/ai/service.ts` | 业务层唯一 AI 入口，按 `modality` + `provider` 解析实现 |
| `AIWorkflow` 接口 | `src/lib/workflows/types.ts` | 需求明确要求「不同产品复用底层」；至少 2 个实现（Image / Text demo） |
| `CreditService` | `src/lib/credit/service.ts` | 6 处写入方需要收敛；需要幂等 + 退款 |
| `PaymentProvider` 接口 | `src/lib/billing/types.ts` | ✅ 已有 2 个实现（stripe/creem） |
| `BillingService` | `src/lib/billing/service.ts` | 统一 checkout / webhook / refund，与 AI 解耦 |
| `StorageProvider` 接口 | `src/lib/storage/types.ts` | ⚠️ 当前只有 R2 一个实现。**但**需求明确要求「以后换 S3 不影响业务」→ 引入接口，**不引入工厂**，`StorageService` 直接持有 provider |

### 14.2 建议新增（数据层）

| 抽象 | 位置 | 说明 |
|---|---|---|
| `getCurrentUser()` | `src/lib/auth/session.ts` | 统一入口，返回 `{ userId, email }`，业务层不再碰 NextAuth |
| Repository 层 | `src/lib/db/repositories/{users,credits,orders,generations}.ts` | 替代伪 Prisma + 散落的直连 |
| `GenerationTaskRepository` | 同上 | 支撑异步任务 + 幂等 + 退款溯源 |

### 14.3 明确**不要**引入（避免过度设计）

| 不要做 | 理由 |
|---|---|
| `ProviderFactory` / `ProviderRegistry` 双层工厂 | 现有 `providerRegistry` 对象字面量已足够 |
| `Strategy` 模式包装 Credit 计算 | 一个 `config/credits.ts` 查表就够 |
| 事件总线 / EventEmitter | 个人开发模板不需要 |
| `PaymentProviderFactory` | 2 个实现，直接 switch 即可 |
| 多租户 / Organization 表 | 当前不需要 |
| 通用 `plugin` 系统 | 当前不需要 |
| `credit_account` 表（余额独立成表） | ⚠️ **决策点**，见 `REFACTOR_DECISIONS.md` D-3 |
| 抽象 `AnalyticsService` | 当前只有埋点标签，无替换需求 |
| 抽象 `EmailService` | 当前 SMTP 完全未实现 |

---

## 15. 最终 my-ai-saas-template 架构

### 15.1 目标分层

```
                    my-ai-saas-template
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
      Auth                  AI               Billing
        │                   │                   │
    Supabase        ┌───────┴───────┐        Stripe / Creem
                    │               │
              AIProvider        AIWorkflow
                    │               │
          ┌─────────┼─────────┐     │
          │         │         │     │
         Fal       KIE      Other  │
                                    │
        ┌───────────────────────────┘
        │
   Credit ── Storage ── Database ── Config
   (外围，全部低耦合)
```

### 15.2 目标目录

```
src/
├── app/
│   ├── api/
│   │   ├── ai/[workflow]/route.ts        # ⭐ 唯一 AI 执行入口
│   │   ├── credits/route.ts              # 余额 + 流水
│   │   ├── billing/create-checkout/route.ts
│   │   ├── webhooks/[provider]/route.ts  # 统一 webhook（幂等）
│   │   ├── upload/route.ts
│   │   └── auth/[...nextauth]/route.ts
│   ├── generate/page.tsx
│   ├── pricing/page.tsx
│   └── ...（页面）
├── components/
│   ├── generator/                        # 原 flux-kontext/
│   │   ├── Generator.tsx                 # 主组件（拆分后 < 400 行）
│   │   ├── use-generator.ts              # 状态 hook
│   │   ├── config-card.tsx
│   │   ├── workspace-card.tsx
│   │   ├── result-section.tsx
│   │   └── types.ts
│   ├── billing/ · credit/ · ui/ · layout/
├── lib/
│   ├── ai/
│   │   ├── types.ts                      # AIProvider / GenerateRequest / GenerateResult
│   │   ├── service.ts                    # AIService
│   │   ├── models.ts                     # model 目录（原 FAL_ENDPOINTS）
│   │   └── providers/
│   │       ├── index.ts  fal.ts  kie.ts  wavespeed.ts  atlascloud.ts
│   ├── workflows/
│   │   ├── types.ts                      # AIWorkflow
│   │   ├── registry.ts
│   │   ├── image.ts                      # ImageWorkflow
│   │   └── text.ts                       # ExampleTextWorkflow（Demo）
│   ├── auth/
│   │   ├── options.ts                    # NextAuth options
│   │   ├── session.ts                    # getCurrentUser()
│   │   └── user-sync.ts                  # 建号 + 注册赠积分（唯一实现）
│   ├── billing/
│   │   ├── types.ts  service.ts
│   │   └── providers/{index,stripe,creem}.ts
│   ├── credit/
│   │   ├── types.ts  service.ts          # CreditService
│   ├── storage/
│   │   ├── types.ts  service.ts
│   │   └── providers/{index,r2}.ts
│   ├── db/
│   │   ├── client.ts
│   │   └── repositories/{users,credits,orders,generations}.ts
│   ├── security/{turnstile.ts,content-safety.ts,rate-limit.ts}
│   ├── i18n/ · seo/ · utils/ · content/
├── config/
│   ├── app.ts        # 名称/描述/域名/支持邮箱
│   ├── credits.ts    # ⭐ 唯一积分价格表
│   ├── pricing.ts    # 套餐与积分包
│   ├── providers.ts  # 启用的 AI provider + 默认 model
│   └── features.ts   # feature flags（turnstile / content safety / r2 / billing）
├── proxy.ts
└── supabase/
    └── migrations/
        ├── 0001_init.sql
        └── ...
docs/
├── ARCHITECTURE.md · REFACTOR_PLAN.md · REFACTOR_DECISIONS.md
├── GETTING_STARTED.md
└── ADD_NEW_WORKFLOW.md
```

### 15.3 目标数据模型

```
users                 id, email, name, image, credits, created_at, updated_at
                      （去掉 signin_* 六个遗留字段；credits 作为余额缓存，见 D-3）

credit_transactions   id, user_id, amount, type, status,
                      reference_id, idempotency_key UNIQUE,
                      description, metadata, created_at
                      type ∈ {REGISTER_BONUS, PURCHASE, GENERATION,
                              REFUND, ADMIN_ADJUSTMENT}
                      status ∈ {PENDING, COMPLETED, FAILED}

orders                id, user_id, order_number UNIQUE, amount, currency, status,
                      payment_provider, product_type, product_id, product_name,
                      customer_email, provider_session_id, provider_payment_id,
                      provider_refs JSONB, paid_at, metadata, created_at, updated_at
                      ⭐ 统一 orders 与 payment_orders，只保留一张

subscriptions         id, user_id, plan_id, status, billing_cycle,
                      current_period_start, current_period_end,
                      payment_provider, provider_subscription_id, created_at, updated_at

generation_tasks      id, user_id, workflow_id, provider, model, status,
                      provider_task_id, prompt, input JSONB, output JSONB,
                      credits_used, credit_transaction_id, error,
                      idempotency_key UNIQUE, created_at, updated_at

webhook_events        id, provider, event_id UNIQUE, payload JSONB, processed_at
                      ⭐ 新增，用于 webhook 幂等
```

**明确不新增**：`credit_account`（见 D-3）、`payment_configs`（删除）、`affiliate_*`、`api_keys`、`organizations`、`teams`。

### 15.4 目标调用链（重构后）

```
用户点击 Generate
   │
   ▼
components/generator/Generator.tsx
   └─ POST /api/ai/image        ← workflow id 在 URL 里
        │
        ▼
app/api/ai/[workflow]/route.ts   ← 只做：鉴权 + 参数校验 + 调用 workflow
        │
        ├─ getCurrentUser()                       ← lib/auth/session.ts
        │
        ▼
lib/workflows/image.ts  ImageWorkflow.run(ctx, input)
        │
        ├─ 1. requiredCredits = config/credits.ts[workflowId]
        ├─ 2. CreditService.consume({ userId, amount, idempotencyKey })
        ├─ 3. AIService.generate({ provider, model, prompt, images, params })
        │        └─ lib/ai/providers/fal.ts → fal.ai
        ├─ 4. StorageService.upload()             ← 可选
        ├─ 5. GenerationTaskRepository.complete()
        └─ 6. 失败 → CreditService.refund({ referenceId })  ← 幂等
        │
        ▼
返回 { taskId, images, creditsRemaining }
```

### 15.5 复用验证（目标验收）

| | 产品 A：AI 图片 | 产品 B：AI 文案 |
|---|---|---|
| Workflow | `workflows/image.ts` | `workflows/text.ts` |
| AI Provider | `fal` | 任意文本 provider |
| 改动的核心代码 | 只改 `workflows/` + `config/` | 只改 `workflows/` + `config/` |
| Auth / Credit / Billing / DB / Storage | **完全复用，零改动** | **完全复用，零改动** |

---

## 附录 A：Phase 1 发现的缺陷清单（供重构时顺手修复）

> ⚠️ **本表是 Phase 1（2026-09-23）的历史快照，不代表当前状态。**
> 多数缺陷已在 Phase 2 ~ 6.5 修复。
> **当前缺陷状态请看 [`docs/PROJECT_STATUS.md`](./PROJECT_STATUS.md) 的「缺陷状态表」。**

| ID | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| B-1 | 订单表双轨：写 `payment_orders`，读 `orders` | `database.ts:362` vs `create-checkout:208` | 🔴 支付后查不到订单 |
| B-2 | `creemCheckoutId` camelCase 写库 | `create-checkout:293` | 🔴 checkout id 丢失 |
| B-3 | `creditTransaction` 是 mock，流水不落库 | `database.ts:675` | 🔴 无法审计/幂等 |
| B-4 | `subscription` 是 mock | `database.ts:718` | 🔴 订阅不持久化 |
| B-5 | `groupBy`/`aggregate` 返回伪造统计 | `database.ts:587/603` | 🔴 若被后台使用会展示假数据 |
| B-6 | `type='gift'` 违反 CHECK 约束 | `auth.ts:285`、`user/credits:84` | 🔴 赠积分流水插入失败 |
| B-7 | `register` 写不存在的 `password` 列 | `auth/register:42` | 🔴 邮箱注册必然失败 |
| B-8 | R2 public URL 用 S3 API 端点 | `r2-storage.ts:266/361` | 🔴 图片可能无法公开访问 |
| B-9 | `R2_PUBLIC_URL` / `R2_CUSTOM_DOMAIN` 未使用 | 全项目 | 🟡 配置无效 |
| B-10 | 55s 超时后不退款 | `route.ts:23-27 / 700` | 🟡 用户积分损失 |
| B-11 | 积分扣减非原子 | `credits.ts:77-93` | 🟡 并发可超扣 |
| B-12 | 价格表两份 | `flux-kontext-request:18`、`credits.ts:214` | 🟡 改价易漏 |
| B-13 | `session` 不含 `user.id` | `auth.ts:351` | 🟡 每请求多一次查库 |
| B-14 | 支付配置三处真相 | `config/payment.ts` / env / mock | 🟡 行为不可预测 |
| B-15 | `/api/payment/create-session` 与 `/api/payments/create-checkout` 重复 | 两个路由 | 🟡 维护成本 |
| B-16 | 生成历史从不落库 | `generations` 表 | 🟡 无历史功能 |
| B-17 | `router.ts` 把 HK/TW 当独立国家 | `payment/router.ts:44` | 🟡 合规风险 |
| B-18 | 前端 3 处重复 fetch 逻辑 | `FluxKontextGenerator.tsx` 259/779/1057 | 🟡 维护成本 |
| B-19 | `package.json` name 仍是 `nextjs-shadcn` | `package.json:2` | 🟢 观感 |
| B-20 | 开发环境硬编码后门账号 | `auth.ts:87` | 🟡 安全隐患 |
| B-21 | 限流器计数器**全局共享**，但窗口按路径区分（`/api/` 10 次/60s，`/api/auth/` 5 次/300s）。一旦 `/api/` 请求把计数推到 10，后续 `/api/auth/` 请求会因阈值更低而立刻 429，且必须等满 300 秒才重置 → 正常使用中登录接口会被误伤 | `src/proxy.ts:6-23 / 130-136` | 🟡 可用性（Phase 2 测试时实测复现） |

> B-21 由 Phase 2 的 HTTP 冒烟测试实测发现。复现方式：
> 先打 9 次 `/api/*` 请求，再请求 `/api/auth/csrf` → 立刻 429；等待 62 秒后重试仍 429（因为 auth 窗口是 300 秒）。

---

## 附录 B：本报告的证据范围

- 已完整阅读：`README.md`、`package.json`、`env.example`、`next.config.js`、`scripts/setup-database.sql`、`src/proxy.ts`、全部 18 个 API 路由的关键逻辑、`src/lib/` 下 30+ 个核心文件、`src/components/FluxKontextGenerator.tsx` 的结构与调用点。
- 采用 grep 统计而非全量阅读：22 个 locale 页面、`docs/` 52 个文件、`content/*.json`。
- 未执行：`npm run lint`、`npm run build`（Phase 1 要求只分析；建议在 Phase 2 开始前先跑一次基线）。
- Git 状态：分支 `master`，工作区干净（`git status --short` 无输出）。

---

*Phase 1 结束。下一步见 `docs/REFACTOR_PLAN.md`。*
