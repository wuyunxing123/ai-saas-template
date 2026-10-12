# Phase 9.4 Follow-ups

> Phase 9.4 完成「i18n / SEO 产品化」。本文件记录未处理事项。配套：`PHASE_9_4_AUDIT.md`。

---

## 1. 已完成

### Core / Product 内容分离

| 位置 | 内容 | 归属 |
|---|---|---|
| `src/lib/content/locale.ts` | i18n **机制**（16 语言 / 语言名 / 旗帜 / 路由前缀 / 方向 / 字体） | ✅ Core |
| `src/lib/content/{common,auth}.json` + `index.ts` | 通用文案（按钮 / 导航 / 表单 / 认证 / 错误） | ✅ Core |
| `src/lib/products/flux-kontext/content/{home,generator,pricing,seo}.json` + `index.ts` | 产品文案 | ✅ Product |
| `src/lib/products/flux-kontext/home-config.ts` | 首页多语言字典（`HomeDictionary`） | ✅ Product |

### 消除的重复与死代码
- `lib/i18n/home-config.ts` 曾**重复定义整套 locale 机制**（`SUPPORTED_LOCALES` /
  `LOCALE_NAMES` / `LOCALE_FLAGS` / `DEFAULT_LOCALE`）→ 已收敛到 Core 的 `locale.ts`，产品文件只留文案。
- 删除死导出：`getContent` / `getText` / `getTextArray` / `moduleStats`（0 消费者）。

### 迁移的消费者（7 个）
`components/{FAQ,Footer,KeyFeatures,TwitterShowcase}.tsx`（整包改指产品模块）+
`components/{HomeContent,HowToSteps,PricingContent}.tsx`（拆分为「通用 + 产品」两处导入）+
`components/HomeContentSimple.tsx`（`HomeDictionary` 类型改指产品模块）。

### 未受影响的 Core
`lib/seo/{metadata-generator,llms}.ts`、`app/{robots,sitemap}.ts`、`components/{Navigation,SignInContent,LanguageSwitcher,not-found}` —— 只依赖 `locale` 机制或通用文案，**无需改动**。

---

## 2. Remaining

### F9.4-1 `content/pricing.json` 的展示价未从 billing 派生
- **文件**：`src/lib/products/flux-kontext/content/pricing.json`（`plans[].monthlyPrice` / `creditPacks[].price`）
- **问题**：定价页展示价来自 JSON，与 `src/config/billing.ts`（扣款真相）是两处。
- **原因**：改动会触及 `PricingContent.tsx` 的渲染逻辑（本阶段只做 import 迁移）。
- **风险**：中（展示价 ≠ 实扣价会引起投诉）
- **推荐阶段**：Phase 9.5 / 后续（让定价页从 `listBillingPackages()` 派生）

### F9.4-2 15 个语言页内联字典重复产品文案
- **文件**：`src/app/{ar,bn,de,es,fr,hi,it,ja,ko,nl,pl,pt,ru,tr,zh}/page.tsx`
- **问题**：每页内联一份 `xxDictionary`（hero/features/faq/cta/footer 全文），共 15 份重复。
- **原因**：属内容重组（非 import 迁移），改动量大。
- **风险**：低（文案重复，不影响运行）
- **推荐阶段**：后续（抽到 `products/flux-kontext/content/locales/<locale>.json`）

### F9.4-3 `content/home.json` 与 `home-config.ts` 语义重叠
- **文件**：`products/flux-kontext/content/home.json`（hero/features/howTo/faq/footer/twitterShowcase）
  与 `products/flux-kontext/home-config.ts`（`HomeDictionary` hero/features/faq/cta/footer）
- **问题**：两者都在描述首页，结构不同、文案略有差异；`EN_DICTIONARY` 目前无人直接使用
  （仅 `getDictionary()` 导出，且 `getDictionary` 0 消费者）。
- **原因**：历史遗留（两套首页体系：`HomeContent` vs `HomeContentSimple`）。
- **风险**：低
- **推荐阶段**：后续（确认 `HomeContentSimple` 路线是否保留后合并）

### F9.4-4 `lib/seo/llms.ts` 的模板描述文案
- **文件**：`src/lib/seo/llms.ts`
- **问题**：含通用模板描述（"multilingual AI image-generation web template …"），偏产品定位。
- **原因**：`llms.txt` 是模板级产物，描述可视为通用。
- **风险**：低
- **推荐阶段**：可选（若换产品需改，可抽到产品 SEO 配置）

### F9.4-5 多语言动态加载仍未实现
- **文件**：`src/lib/content/locale.ts`（原 `getContent()` 的 TODO）
- **问题**：目前所有语言都回退英语；`getContent()` 已随死代码删除。
- **原因**：本阶段只做产品化分离，不做 i18n 能力扩展。
- **风险**：低（现状与改前一致）
- **推荐阶段**：后续（若真需要多语言，实现按 locale 动态加载产品字典）

### F9.4-6 页面级 SEO 文案仍含产品名
- **文件**：`src/app/*/page.tsx`（20+ 页，含 15 个语言页）
- **问题**：页面级 `metadata` 的 title/description 硬编码产品名。
- **原因**：承接 Phase 9.3 F9.3-2；属内容迁移。
- **风险**：低（SEO 文案）
- **推荐阶段**：Phase 9.5 / 后续

---

## 3. 验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` / `npm run lint` | ✅ 0 错误 0 警告 |
| `npm run build` | ✅ 全部路由生成（含 16 个语言页） |
| `verify-workflow` / `ai-core` / `billing` / `storage` / `auth` / `admin` | ✅ 42 / ✅ / 78 / 20 / 28 / 45 |
| `verify:product-boundary` | ✅ Core → Product = 0 |
| `audit:architecture` / `audit:dead-files` | ✅ / ✅ |
| `verify_migrations.mjs` / `validate_migrations.py` | ✅ 198 / ✅ |

**未改数据库 schema**（§21 要求）。

## 4. 架构确认

```
Product content ──► Core i18n（locale 机制）        ✅
UI ──► Core 通用文案 + Product 文案                  ✅
Core（lib/seo / lib/content）──► Product             ❌ 0
```
