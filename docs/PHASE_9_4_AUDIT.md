# Phase 9.4 Audit — i18n / SEO Productization

> 只读审计（写于改造前）。目标：**Core 提供通用 i18n / SEO 能力；Product 提供自己的文案与 SEO 内容**。
> 依赖方向：`Product → Core i18n/SEO infrastructure`（**不是** `Core → Flux 文案`）。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| **Core 是否含 Flux 文案** | ⚠️ **是** —— `lib/content/*.json` 混装「通用文案」与「Flux 产品文案」 |
| `lib/seo/*` 是否依赖产品文案 | ✅ **否**（只依赖 `locale.ts` 机制；前次扫描的 home/pricing 是路由路径误报） |
| 需迁移的产品文案 | `home.json` / `generator.json` / `pricing.json` / `seo.json` + `lib/i18n/home-config.ts` |
| 保留在 Core 的通用文案 | `common.json` / `auth.json` |
| 受影响消费者 | `@/lib/content` 共 **16 个**（其中 11 个用到产品文案） |
| 死导出 | `getContent` / `getText` / `getTextArray` / `moduleStats`（0 消费者） |
| 迁移性质 | **import 路径调整**（不改 UI 结构 / 不改渲染逻辑） |

---

## 1. 现状结构

```
src/lib/content/
├── locale.ts        204 行  ⚠️ MIXED：i18n 机制（16 语言）+ 聚合全部 6 个 JSON
├── index.ts         124 行  ⚠️ MIXED：re-export 6 个 JSON + getText/getTextArray（死）+ 类型
├── home.json        131 行  ← PRODUCT（hero/features/howTo/faq/footer.brand）
├── generator.json    91 行  ← PRODUCT（生成器文案 / 模型 pro·max / 参数说明）
├── pricing.json     143 行  ← PRODUCT（套餐 / 积分包 / Creem 产品 id / FAQ）
├── seo.json          57 行  ← PRODUCT（meta/og/twitter/structuredData）
├── common.json       96 行  ← GENERIC（按钮 / 导航 / 表单）
└── auth.json         44 行  ← GENERIC（登录 / 注册 / 错误）

src/lib/i18n/
└── home-config.ts   203 行  ← PRODUCT（首页多语言文案 HomeDictionary）
```

**根因**：`lib/content/` 把「通用 UI 文案」与「Flux 产品文案」装在同一目录，
且 `locale.ts` 的 `defaultContentMap` 把两者聚合在一起 —— 于是 Core 目录里出现了产品文案。

---

## 2. 分类（A/B/C）

### A. Generic Template Content（保留在 Core）
- `common.json`：buttons / navigation / forms / 通用错误
- `auth.json`：signIn / signUp / errors（**不含** upgrade.* 定价文案）
- `locale.ts` 的机制部分：`SUPPORTED_LOCALES` / `LOCALE_NAMES` / `LOCALE_FLAGS` /
  `isSupportedLocale` / `getLocaleFromPathname` / `getLocalizedPath` / `getTextDirection` / `getFontFamily`

### B. Flux Product Content（迁到 Product）
- `home.json`：hero / features / howTo / faq / **footer.brand.name**
- `generator.json`：产品生成器文案、模型名（pro/max）
- `pricing.json`：套餐 / 积分包 / **Creem 产品 id** / 定价 FAQ
- `seo.json`：meta / openGraph / twitter / structuredData（含产品名）
- `lib/i18n/home-config.ts`：首页多语言文案

### C. UI Structure（**不动**）
组件与页面的渲染逻辑、`app/*/page.tsx` 结构、`locale.ts` 的路由/语言工具 —— 保持原样。

---

## 3. 消费者清单（16 个）

| 消费者 | 用到模块 | 分类 | 处置 |
|---|---|---|---|
| `app/not-found.tsx` | common | Generic | 不变 |
| `components/SignInContent.tsx` | auth, common | Generic | 不变 |
| `components/LanguageSwitcher.tsx` | — | Generic | 不变 |
| `app/api/flux-kontext/route.ts` | auth | Generic | 不变（产品 API 用通用错误文案） |
| `app/robots.ts` | auth, **pricing** | Mixed | 拆：auth←Core，pricing←Product |
| `app/sitemap.ts` | **pricing** | Product | 改指 Product |
| `components/FAQ.tsx` | **home** | Product | 改指 Product |
| `components/KeyFeatures.tsx` | **home** | Product | 改指 Product |
| `components/TwitterShowcase.tsx` | **twitterShowcase** | Product | 改指 Product |
| `components/Footer.tsx` | **footer** | Product | 改指 Product |
| `components/HomeContent.tsx` | common, **home/pricing/seo** | Mixed | 拆 |
| `components/HowToSteps.tsx` | common, **home** | Mixed | 拆 |
| `components/Navigation.tsx` | auth, common, **home/pricing** | Mixed | 拆 |
| `components/PricingContent.tsx` | auth, common, **pricing** | Mixed | 拆 |
| `lib/seo/llms.ts` | locale（机制） | ✅ Core | 不变 |
| `lib/seo/metadata-generator.ts` | locale（机制） | ✅ Core | 不变 |

**i18n 消费者**：`components/HomeContentSimple.tsx`（`HomeDictionary` 类型）+ 15 个语言页
（`app/{ar,bn,de,es,fr,hi,it,ja,ko,nl,pl,pt,ru,tr,zh}/page.tsx` 使用 `HomeContentSimple`）。

---

## 4. 目标结构

```
Core（通用能力）
src/lib/i18n/
├── locale.ts            i18n 机制（16 语言，无产品文案）
└── index.ts             （可选）机制再导出
src/lib/content/
├── common.json          GENERIC
├── auth.json            GENERIC
└── index.ts             GENERIC 导出（common / auth）

Product（Flux 文案）
src/lib/products/flux-kontext/
├── content/
│   ├── home.json
│   ├── generator.json
│   ├── pricing.json
│   ├── seo.json
│   └── index.ts         产品文案导出
└── home-config.ts       首页多语言文案（原 lib/i18n/home-config.ts）
```

依赖方向：

```
Product content ──► Core i18n（locale 机制 / 类型）
UI（app/ + components/）──► Core 通用文案 + Product 文案
Core（lib/seo、lib/content）──► 不依赖 Product
```

---

## 5. 迁移计划（供确认）

1. 新建 `src/lib/products/flux-kontext/content/`，移入 4 个产品 JSON + `index.ts`
2. 移入 `src/lib/products/flux-kontext/home-config.ts`（原 `lib/i18n/home-config.ts`）
3. 瘦身 `src/lib/content/locale.ts`：移除产品 JSON 聚合，只留机制
4. 瘦身 `src/lib/content/index.ts`：只导出 `common` / `auth`；**删除死导出**
   `getContent` / `getText` / `getTextArray` / `moduleStats`
5. 更新 11 个消费者的 import（纯路径调整，不改渲染逻辑）
6. 更新 15 个语言页 + `HomeContentSimple.tsx` 的 `HomeDictionary` 引用
7. 校验：`lint` / `build` / 全部 `verify-*` / `audit:architecture` / `verify:product-boundary`

**风险**：中（触及 11 个 UI 文件 + 15 个语言页，但**仅改 import 路径**）。
**回滚**：tag `phase-9.4-before-i18n-seo`。

---

## 6. 需确认的问题

1. **是否保留 `lib/content` 这个目录名？** 目标结构里 Core 通用文案仍在 `lib/content/`（`lib/i18n/locale.ts` 提供机制）。
   若希望 i18n 机制也并入 `lib/content/`（不新建 `lib/i18n/`），可调整。
2. **`pricing.json` 的价格数值**（`plans[].monthlyPrice` / `creditPacks[].price`）与
   `config/billing.ts` 仍是两处 —— 属 Phase 9.3 F9.3-5，本阶段是否一并派生？
3. **`footer.brand.name`** 属产品品牌 —— 迁移时是否改为读取 `siteConfig.projectName`？
4. **`lib/i18n/home-config.ts` 与 `content/locale.ts` 的 locale 机制重复** —— 已确认（见 §8）。

---

## 8. ⚠️ 发现的重复：两套 locale 定义

`src/lib/i18n/home-config.ts` **重复定义了整套 i18n 机制**：

| 符号 | `lib/content/locale.ts` | `lib/i18n/home-config.ts` |
|---|---|---|
| `SUPPORTED_LOCALES` | ✅ | ⚠️ **重复定义** |
| `LOCALE_NAMES` | ✅ | ⚠️ **重复定义** |
| `LOCALE_FLAGS` | ✅ | ⚠️ **重复定义** |
| `DEFAULT_LOCALE` | ✅ | ⚠️ **重复定义** |
| `SupportedLocale` | ✅ | ⚠️ **重复定义** |
| 产品文案 | — | `HomeDictionary` + `EN_DICTIONARY` + `getDictionary()` |

- `home-config.ts` 的 `HomeDictionary` 内容与 `content/home.json` 的 hero/features/faq **语义重叠**
  （两处都在描述首页，但结构不同、文案略有差异）。
- 消费者：`HomeContentSimple.tsx`（仅 `HomeDictionary` 类型）+ 15 个语言页。

**结论**：本阶段应把 locale 机制**收敛为一处**（Core 的 `locale.ts`），
`home-config.ts` 只保留产品文案（或直接并入 `content/home.json`）。**需你确认合并方向。**

---

## 7. 明确不做（本阶段边界）

- 不重写 i18n 机制（不做真正的多语言动态加载）
- 不改 `app/*/page.tsx` 的页面结构与 SEO 行为
- 不重写 SEO 生成器（`metadata-generator` / `llms` 行为不变）
- 不动数据库 schema
