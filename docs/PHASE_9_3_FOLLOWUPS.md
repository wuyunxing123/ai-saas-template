# Phase 9.3 Follow-ups

> Phase 9.3 完成「产品化与残留清理」。本文件记录未处理事项。配套：`PHASE_9_3_AUDIT.md`。

---

## 1. Product Boundary（已完成）

```
src/lib/products/flux-kontext/    ← 唯一允许出现 Flux 语义的地方
    service.ts / actions.ts / credits.ts / types.ts / index.ts

Core（禁止 Flux 语义）
    ai/ workflow/ storage/ db/ billing/ admin/ services/ auth/ content-safety/ seo/ utils/ content/ i18n/ config/
```

| 方向 | 结果 |
|---|---|
| Product → Core | ✅ 允许（依赖：workflow / ai / storage / services / config） |
| **Core → Product** | ✅ **0**（`audit:architecture` + `verify:product-boundary` 双重守卫） |
| Product → Product | ✅ 0 |

## 2. Content

| 解耦内容 | 位置 | 状态 |
|---|---|---|
| 品牌名（Logo / SEO / 标题） | `site-config.ts`（env `NEXT_PUBLIC_PROJECT_NAME`） | ✅ 已解耦 |
| SEO 站名 / 社交句柄 | `metadata-generator.ts` → `siteConfig` | ✅ 已解耦 |
| 根 metadata（title/authors/creator） | `app/layout.tsx` → `siteConfig` | ✅ 已解耦 |
| PWA 名称 | `public/manifest.json` | ✅ 已通用化 |
| 产品文案（首页 / 生成器 / 定价 / FAQ …） | `content/*.json`、`i18n/home-config.ts` | ⬜ 见 F9.3-1 ~ F9.3-4 |

## 3. Pricing

**Single Source of Truth = `src/config/billing.ts`**（`priceMinor`，整数最小单位）。

| 位置 | 状态 |
|---|---|
| `config/billing.ts` | ✅ SSOT（服务端扣款依据） |
| `user-tiers.pricingPlans` | ✅ 本阶段改为从 SSOT 派生 |
| `content/pricing.json`（定价页展示） | ⬜ 仍独立，见 F9.3-5 |

**支付金额**始终由服务端 `BillingService.createCheckout` 决定，客户端无法传入金额。

## 4. SEO

✅ 已去除 Core 中的 Flux 硬编码（`metadata-generator` / `layout` / `Logo` / `manifest`）。
⬜ 20+ 页面的 `page.tsx` 与 `content/seo.json` 仍含 Flux 文案（见 F9.3-2）。
metadata API / sitemap / robots **行为未变**。

## 5. Environment

✅ 新建 `.env.example`（分组：CORE / STORAGE / BILLING / PRODUCT / OPTIONAL），无真实密钥。
✅ 代码中 `process.env.FLUX_*` = **0**。

## 6. Debug Routes

✅ 删除全部 8 个（`database` / `database-check` / `database-connection` / `database-status` /
`env` / `oauth` / `simple-test` / `user-test`），0 消费者，仅 `proxy.ts` 守卫。
⬜ `proxy.ts` 的 `/api/debug/` 守卫现已无对应路由（见 F9.3-7）。

---

## 7. Remaining

### F9.3-1 `content/*.json` 的产品文案未抽出
- **文件**：`src/lib/content/{home,generator,pricing,seo}.json`
- **问题**：含 Flux 产品名 / 模型名 / 功能描述。
- **原因**：UI 通过 `@/lib/content` 的命名空间直接消费，迁移会波及 20+ 页面与多个组件。
- **风险**：低（仅文案）；但换产品需逐处改 JSON。
- **推荐阶段**：Phase 9.4（可考虑 `products/<name>/content.ts` + 通用 content 回退）

### F9.3-2 `app/*/page.tsx`（20+ 页）的 Flux SEO 文案
- **文件**：`src/app/{page,generate/page,pricing/page,zh/page,...}.tsx`
- **问题**：页面级 `metadata` 硬编码 Flux 标题 / 描述 / 关键词。
- **原因**：属内容迁移（§16 不做大规模 UI 改动）。
- **风险**：低（SEO 文案）
- **推荐阶段**：Phase 9.4

### F9.3-3 `i18n/home-config.ts` 的 Flux 文案
- **文件**：`src/lib/i18n/home-config.ts`
- **问题**：首页多语言文案含 "Flux Kontext AI"。
- **风险**：低
- **推荐阶段**：Phase 9.4

### F9.3-4 共享组件内的 Flux 文案
- **文件**：`components/{HomeContent,KeyFeatures,FAQ,StructuredData,ApiDocumentation,ResourcesContent,UpgradePrompt}.tsx`
- **问题**：文案与结构化数据含 Flux。
- **风险**：低
- **推荐阶段**：Phase 9.4

### F9.3-5 `content/pricing.json` 展示价 vs billing config
- **文件**：`src/lib/content/pricing.json`
- **问题**：定价页展示价来自 JSON，与 `config/billing.ts` 可能漂移（展示 ≠ 扣款）。
- **原因**：改动会触及 `PricingContent.tsx`（UI）。
- **风险**：中（用户看到的价与实扣不符会引起投诉）
- **推荐阶段**：Phase 9.4（让定价页从 `listBillingPackages()` 派生）

### F9.3-6 `config/billing.ts` 的 Creem 产品名（外部依赖）
- **文件**：`src/config/billing.ts`（`providerProductIds.creem`）
- **问题**：值如 `FluxKontext-Plus-Monthly` 必须与 Creem 后台**逐字一致**。
- **原因**：Creem 扣款金额由后台产品决定；改代码不改后台会失败。
- **风险**：中
- **需要真实环境验证**：✅ 是
- **推荐阶段**：上线前核对（换产品时同步改 Creem 后台）

### F9.3-7 `proxy.ts` 的 debug 守卫已无对应路由
- **文件**：`src/proxy.ts`（`/api/debug/` 分支）
- **问题**：debug 路由已全删，守卫成为 no-op。
- **原因**：保留可作未来调试路由的防线。
- **风险**：无
- **推荐阶段**：可选清理（保留亦合理）

### F9.3-8 `user-tiers.ts` 的死导出
- **文件**：`src/lib/user-tiers.ts`
- **问题**：`getCurrentUserType` / `freeUserLimits` / `registeredUserLimits` / `premiumUserLimits`
  对外 0 引用（其中后三者被 `getUserLimits` 内部使用，属过度导出）。
- **风险**：低
- **推荐阶段**：可选（改 `export` 为内部常量）

### F9.3-9 双 checkout 入口
- **文件**：`src/app/api/payments/create-checkout/route.ts`（UI 在用）与 `src/app/api/billing/checkout/route.ts`（规范入口）
- **问题**：两条路径都委托 `BillingService`，功能等价，但命名不统一。
- **原因**：`PricingContent.tsx` 仍 fetch 旧路径（改前端属 UI 变更）。
- **风险**：低
- **推荐阶段**：Phase 9.4（前端切 `/api/billing/checkout` 后删旧路由）

### F9.3-10 可疑 / 待核 env 变量
- **文件**：`.env.local` / `.env.example`
- **问题**：`NEXT_PUBLIC_ENABLE_R2`（记忆记载已废弃）、`NEXT_PUBLIC_DEMO_{IMAGES,VIDEOS}_URL`、
  `IPAPI_KEY`、`API4AI_API_KEY`、`GOOGLE_CLOUD_VISION_API_KEY`、`AZURE_CONTENT_SAFETY_*` 等
  用途/有效性未逐项核实。
- **风险**：低（未使用的变量不影响运行）
- **推荐阶段**：Phase 9.4（逐项核实后清理）

---

## 8. NOT VERIFIED

- **NOT VERIFIED — requires real environment**：F9.3-6（Creem 后台产品名一致性）；
  支付 / AI 真实链路（承接 Phase 9.2 F9.2-1 ~ F9.2-3）。
- 本阶段改动均为**品牌/配置/删除**，无运行时逻辑变更；`build` + 全部静态验证通过。
