# Phase 9.3 Audit — Productization & Residual Cleanup

> 只读审计（写于改造前）。目标：让 Core Infrastructure 彻底不含 Flux 产品语义，
> 使模板可「复制 → 换 Product Layer → 得到 Product B」。配套：`PHASE_9_3_FOLLOWUPS.md`。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| **Core → Flux 反向依赖** | ✅ **0**（Phase 8 已消除，由 `audit:architecture` 守卫） |
| Flux → Core 依赖 | ✅ 单向（`products/flux-kontext` → Workflow / AI / Credit / Storage） |
| Flux 关键词命中 | 665 处，分布见 §7（多数属**配置数据**或**产品层**，合规） |
| 需产品化解耦 | **品牌/SEO 硬编码**（`site-config` / `metadata-generator` / `layout` / `Logo` / `manifest`） |
| 需删除 | `/api/payment/create-session`（0 消费者）+ 8 个 debug 路由 |
| 需收敛 | `user-tiers.pricingPlans` 与 billing config 的价格重复 |
| 无 `migration` | 本阶段不动 schema |

---

## 1. Product Boundary

### Product（Flux 专属 —— 允许存在，且是唯一允许出现 Flux 语义的地方）
```
src/lib/products/flux-kontext/    service.ts / actions.ts / credits.ts / types.ts / index.ts
src/components/flux-kontext/      9 个组件
src/components/FluxKontextGenerator.tsx
src/app/api/flux-kontext/route.ts
```

### Core（基础设施 —— 禁止出现 Flux 语义）
```
src/lib/ai/          AIService / AIProvider / models / providers
src/lib/workflow/    WorkflowService / state-machine / settlement / storage
src/lib/storage/     StorageService / R2Provider
src/lib/db/          client / types / repositories
src/lib/billing/     BillingService / providers / fulfillment
src/lib/admin/       AdminService / authorization
src/lib/auth*        auth-session / auth
src/lib/services/    credits（通用）
```

### App / Branding（介于两者之间 —— 需 env 驱动，不得硬编码产品名）
```
src/lib/site-config.ts        品牌 SSOT（env: NEXT_PUBLIC_PROJECT_NAME）
src/lib/seo/                  metadata-generator
src/app/layout.tsx            根 metadata
src/components/Logo.tsx       共享 UI
public/manifest.json          PWA 元数据
```

### Content（文案 —— 多数为产品文案）
```
src/lib/content/{home,generator,pricing,seo,auth,common}.json
src/lib/i18n/home-config.ts
```

---

## 2. Flux Dependencies

### Flux → Core（✅ 允许，单向）
```
products/flux-kontext/service.ts → workflow/service.ts (WorkflowService)
                                 → ai/providers (listAIProviderNames)
                                 → ai/service (AIService.uploadFile)
                                 → storage/service (StorageService)
                                 → services/credits (checkUserCredits)
```

### Core → Flux（❌ 必须 0）
**当前 0。** `npm run audit:architecture` 覆盖 10 个基础设施目录，无违规。

---

## 3. Content 分类

| 文件 | 分类 | 处置 |
|---|---|---|
| `content/common.json` | **Generic**（导航 / 按钮 / 表单） | 保留 |
| `content/auth.json` | **Generic**（登录 / 注册） | 保留 |
| `content/home.json` | 混合（通用布局 + Flux 文案） | 保留，记 follow-up |
| `content/generator.json` | **Flux Product**（生成器文案） | 保留，记 follow-up |
| `content/pricing.json` | **Flux Product**（定价文案 + **价格数值**） | 保留，记 follow-up（价格需从 billing 派生） |
| `content/seo.json` | **Flux Product**（SEO 文案） | 保留，记 follow-up |
| `i18n/home-config.ts` | **Flux Product**（首页文案） | 保留，记 follow-up |

> **本阶段不迁移 content JSON**（§5 允许保持兼容）：UI 强依赖 `@/lib/content` 的
> `home` / `generator` / `pricing` / `seo` 命名空间，迁移会波及 20+ 页面。

---

## 4. Pricing

| 位置 | 角色 | 状态 |
|---|---|---|
| `src/config/billing.ts` | **服务端价格真相**（`priceMinor`，整数最小单位） | ✅ SSOT |
| `src/lib/content/pricing.json` | 定价页展示价格（`plans[].monthlyPrice`） | ⚠️ **独立数值**，与 SSOT 可能漂移 |
| `src/lib/user-tiers.ts` `pricingPlans` | UI 展示（仅被 `UpgradePrompt.tsx` 用） | ⚠️ **独立数值**（$29/$290），本阶段改为从 SSOT 派生 |

**结论**：`config/billing.ts` 是唯一 SSOT；另外两处展示值需派生（本阶段做 user-tiers，pricing.json 记 follow-up）。
**支付金额**始终来自服务端（`BillingService.createCheckout` → `pkg.priceMinor`），客户端无法决定金额。

---

## 5. SEO

| 位置 | 硬编码 | 处置 |
|---|---|---|
| `seo/metadata-generator.ts:102` | `siteName: 'Flux Kontext'` | **改为 `siteConfig.projectName`** |
| `seo/metadata-generator.ts:115-116` | `creator/site: '@fluxkontext'` | **改为 env 驱动**（`NEXT_PUBLIC_X_URL` 派生或占位） |
| `app/layout.tsx:24-44` | title/description/authors/creator/publisher | **改为 `siteConfig.projectName`** |
| `app/*/page.tsx`（20+ 页） | title/description 含 Flux 文案 | 记 follow-up（内容迁移） |
| `content/seo.json` | Flux SEO 文案 | 记 follow-up |
| `components/StructuredData.tsx` | 结构化数据含 Flux | 记 follow-up |

> §9：不重写 SEO 系统，只消除 Core 硬编码。metadata API / sitemap / robots 行为不变。

---

## 6. Environment 分类

| 类别 | 变量 |
|---|---|
| **Core** | `SUPABASE_*`、`DATABASE_URL`、`NEXTAUTH_*`、`AI_PROVIDER`、`IMAGE_GENERATION_PROVIDER`、`KIE_*`、`ATLASCLOUD_*`、`FAL_KEY`、`R2_*` |
| **Billing** | `STRIPE_*`、`CREEM_*`、`NEXT_PUBLIC_ENABLE_{STRIPE,CREEM}`、`NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER` |
| **Product** | `NEXT_PUBLIC_PROJECT_NAME`、`NEXT_PUBLIC_SITE_URL`、`NEXT_PUBLIC_WEB_URL`、`NEXT_PUBLIC_SUPPORT_EMAIL`、`NEXT_PUBLIC_*_URL`（社交） |
| **Optional** | analytics（`NEXT_PUBLIC_{GOOGLE_ANALYTICS_ID,CLARITY_PROJECT_ID,PLAUSIBLE_DOMAIN,OPENPANEL_CLIENT_ID,CUSTOM_ANALYTICS_*}`）、`ENABLE_DEBUG_ROUTES`、`ENABLE_VERBOSE_LOGS` |
| **可疑 / 待核** | `NEXT_PUBLIC_ENABLE_R2`（记忆记载已废弃）、`NEXT_PUBLIC_DEMO_{IMAGES,VIDEOS}_URL`、`IPAPI_KEY`、`API4AI_API_KEY`、`GOOGLE_CLOUD_VISION_API_KEY`、`AZURE_CONTENT_SAFETY_*` |

**代码中的 Flux 专属 env**：**0**（无 `process.env.FLUX_*`）。✅
**`.env.example` 不存在** → 本阶段创建（§12）。

---

## 7. 残留搜索分类（665 处命中）

| 分类 | 位置 | 处置 |
|---|---|---|
| **配置数据（合规）** | `ai/models.ts`（模型 id `flux-kontext-pro`）、`ai/providers/*`（model→endpoint）、`ai/types.ts` | 保留（Phase 7/8 已判定） |
| **产品层（合规）** | `products/flux-kontext/*`、`components/flux-kontext/*`、`api/flux-kontext/*` | 保留 |
| **品牌硬编码（需修）** | `site-config.ts`、`seo/metadata-generator.ts`、`app/layout.tsx`、`components/Logo.tsx`、`public/manifest.json` | **本阶段修** |
| **内容文案（follow-up）** | `content/*.json`、`i18n/home-config.ts`、`app/*/page.tsx`、`components/{HomeContent,KeyFeatures,FAQ,StructuredData,ApiDocumentation,ResourcesContent,UpgradePrompt}.tsx` | 记 follow-up |
| **外部依赖（不可改）** | `config/billing.ts` 的 Creem 产品名（`FluxKontext-Plus-Monthly`） | 保留（必须与 Creem 后台一致） |
| **遗留（删）** | `api/payment/create-session`（Shipany 遗留，0 消费者） | **删除** |

**ShipAny 命中**：仅 `api/payment/create-session/route.ts` 的注释 → 随该文件删除。

---

## 8. Debug Routes

| 路由 | 消费者 | 处置 |
|---|---|---|
| `api/debug/{database,database-check,database-connection,database-status,env,oauth,simple-test,user-test}` | **0**（仅 `proxy.ts` 守卫） | **删除**（§13） |

`proxy.ts` 已用 `ENABLE_DEBUG_ROUTES === 'true' && NODE_ENV !== 'production'` 守卫，
生产返回 404 —— 但无消费者，故删除。

---

## 9. 本阶段执行清单

1. `site-config.ts`：`projectName` 默认值改为通用名（env 覆盖保留）
2. `seo/metadata-generator.ts`：去 Flux 硬编码 → `siteConfig`
3. `app/layout.tsx`：去 Flux 硬编码 → `siteConfig`
4. `components/Logo.tsx`：去 Flux 硬编码 → `siteConfig.projectName`
5. `public/manifest.json`：改为通用
6. `user-tiers.ts` `pricingPlans`：从 `config/billing.ts` 派生
7. 删除 `api/payment/create-session`
8. 删除 8 个 debug 路由
9. 新建 `.env.example`
10. 新建 `scripts/verify-product-boundary.mjs`
11. 文档

## 10. 明确不做（记 follow-up）
content JSON 迁移、20+ 页面 SEO 文案、i18n home-config、StructuredData、
`content/pricing.json` 展示价派生、Creem 产品名（外部依赖）。
