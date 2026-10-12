# PRODUCT_GUIDE.md — 如何新增第二个 Product

> 更新时间：2026-10-10 · 对齐 **Phase 9.8.2-D**
>
> **母版正式名称：`ai-saas-template`**（本文说的「母版」就是它）。
> 名字住在 `package.json` / `package-lock.json` / `README.md` / `public/manifest.json` /
> `.env.example` 默认值 / `src/lib/site-config.ts` 回落值里；**它是母版身份，不是产品品牌**
> —— 产品品牌走 `NEXT_PUBLIC_PROJECT_NAME`，见 §4.5。
>
> **仓库里目前只有 Flux 一个产品** —— 母版的能力不是靠本文宣称：§7 是隔离删除实验（删掉产品后
> 母版是否完整），§7.4 是**真实的第二产品**（Product B fixture：装上非 Flux 产品、Flux 全删，
> `npm run verify` + `next build` 的实测结果）。
>
> 前置阅读：[`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md) §2（架构）、§5（Product 职责与边界）。
> 当前产品的实现细节见 [`FLUX_PRODUCT.md`](./FLUX_PRODUCT.md)。

---

## 1. 核心原则

### 1.1 产品放在哪

```
src/lib/products/<your-product>/       ← 产品业务逻辑 + 产品配置（服务端）
src/app/api/<your-product>/            ← 产品 API 薄入口
src/app/<your-page>/                   ← 产品页面
src/components/<your-product>/         ← 产品组件
src/app/product-runtime.ts             ← 唯一的「绑定当前产品」接缝
```

`src/lib/products/` 之外**不得**出现产品业务逻辑。

⚠️ **接缝只绑一个产品**：`bindProductConfig()` 允许同 id 重复绑定（`next dev` 热更新需要），
但一个进程里出现**第二个不同 id** 会直接抛错。同一部署只服务一个产品，这是设计约束，
不是待修的 bug。

### 1.2 唯一正确的依赖方向

```
Product
  ↓
Core Service        （WorkflowService / AIService / BillingService / StorageService / CreditService）
  ↓
Infrastructure      （AIProvider / PaymentProvider / StorageProvider / Repository）
```

**不是这样**：

```
Product
  ↓
Supabase  ✗
Provider  ✗
R2 SDK    ✗
Payment SDK ✗
```

判断标准很简单：**产品代码里出现 `@supabase/*`、`@aws-sdk/*`、`stripe`、
或 `@/lib/ai/providers/fal` 这类 import，就是错的。**

实测：当前 `src/lib/products/flux-kontext/**` 里这些 import **一个都没有**。
它依赖的 Core 说明符由守卫逐条打印（`npm run verify:product-boundary` 的 §B，
现为 21 个），落在 `@/config/{product,billing}`、`@/lib/ai/*`、`@/lib/services/credits`、
`@/lib/storage/service`、`@/lib/workflow/*` 这几处 —— 全是机制，没有别的产品。

**这就是新产品应该长的样子。**

---

## 2. 产品应该做什么 / 不应该做什么

### 2.1 应该做

| 职责 | 说明 | Flux 的对应实现 |
|---|---|---|
| **产品配置包** | 把下面五项拼成一个 `ProductConfig` 交给 Core 绑定；**缺项在绑定时就抛错** | `config.ts`（`FLUX_PRODUCT_CONFIG`） |
| **模型目录** | 哪些模型存在：`id` / `label` / `requiredInputImages` / `defaultProvider` / `providers` / 积分成本 | `catalogue.ts`（Core 的 `getModel()` 只读绑定后的这份表） |
| **积分成本表** | 模型 id → 扣多少积分。Core **没有**默认值可回落 | `credits.ts` + `catalogue.ts` 的 `credits` 字段 |
| **Provider 模型映射** | 产品模型 id → 各家真实模型名 / 端点 / LoRA / 是否支持异步 | `provider-data.ts`、`providers.ts` |
| **产品能力** | 档位可用的模型、可用宽高比等。**Core 不再写死 `pro` / `max`** | `capabilities.ts` |
| **套餐与支付渠道商品 id** | 内部 `packageId` / `productId` ⇄ 渠道商品 id 两套标识符，渠道 id 只在服务端用 | `billing.ts`（形状与查询机制在 Core `src/config/billing.ts`） |
| **产品业务规则** | 哪些操作合法、参数取值范围、前置条件 | `types.ts` 的 `FLUX_KONTEXT_ACTIONS`、参数类型 |
| **产品词表 / action 映射** | 产品语义 → Core 模型 id | `actions.ts` 的 `ACTION_TO_MODEL` / `actionToModelId()` |
| **产品 Service** | 把产品请求翻译成 Core 调用，编排结果 | `service.ts` 的 `FluxKontextService` |
| **产品文案** | UI 字符串、FAQ、特性介绍 | `content/*.json` |
| **产品 SEO 数据** | 页面标题、描述、关键词、结构化数据 | `content/seo.json` |
| **产品页面与组件** | 生成器 UI、落地页 | `src/components/FluxKontextGenerator.tsx`、`src/components/flux-kontext/` |
| **产品 API 薄入口** | auth + 安全校验 → Service，**不写业务** | `src/app/api/flux-kontext/route.ts` |
| **产品专属错误** | 带产品语义的错误码 | `FluxProductError`（`INVALID_ACTION` / `GENERATION_FAILED`） |

### 2.2 不应该做

| 禁止 | 原因 | 正确做法 |
|---|---|---|
| 直接调用 AI Provider | Provider 是 Core 的适配层 | `AIService` / `WorkflowService` |
| 直接操作 R2 / S3 | 存储是 Core 抽象 | `StorageService` |
| 直接建 Supabase 客户端 / 写 SQL | 数据访问是 Repository 的职责 | `src/lib/db/repositories/*`（且通常由 Workflow/Billing 内部调用，产品**根本不需要**碰） |
| 自己实现积分原子扣减 | 只有 `consume_credits` RPC 是原子+幂等的 | `WorkflowService.createTask()`（内部自动扣/退） |
| 自己实现 Billing | 价格只有一个真相 | `BillingService` + 产品自己的 `billing.ts`（经 Core `src/config/billing.ts` 查询） |
| 自己实现 Auth | 身份只从 session 来 | `getCurrentUser()` |
| 从请求体读 `price`/`amount`/`credits`/`userId` | 安全边界 | 服务端配置 + session |
| 自己实现内容安全 / Turnstile | 已有 Core 能力 | `src/lib/content-safety/safe-mode.ts`、`src/lib/utils/request.ts` |
| 自己实现任务日志 | 已有脱敏逻辑 | `src/lib/workflow/logger.ts` |
| **修改 Core 来适配自身业务** | 破坏母模板可复用性 | 见 [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) §2.4 |
| import 另一个 Product | Product → Product 被守卫禁止 | 无例外 |

---

## 3. 目录布局

以 `example-product` 为例（**这是文档示例，不要真的创建**）：

```
src/lib/products/example-product/
├── index.ts          barrel；文件头写明依赖方向规则
│                     只导出对外 API，不导出内部实现
├── config.ts         ★ 产品配置包：把模型 / Provider / 套餐 / 免费档拼成
│                     `ProductConfig`，交给接缝绑定。这里只做拼装，不放数值
├── catalogue.ts      ★ 模型目录：id / label / requiredInputImages / defaultProvider /
│                     providers / credits —— Core 的 `getModel()` 读的就是这份
├── provider-data.ts  ★ 产品模型 id ⇄ 各家真实模型名 / 端点 / LoRA 的映射
├── providers.ts      ★ 本产品使用的 Provider 实例（复用 Core 的厂商引擎）
├── billing.ts        ★ 套餐表（内部 packageId + 渠道商品 id）与免费档
├── capabilities.ts   ★ 档位能力：哪些模型 / 宽高比对哪个 tier 可用
├── vocabulary.ts     ★ 产品自己声明的识别词汇（品牌名 / 端点前缀 / 厂商枚举）。
│                     `verify-product-config.ts` 用它扫 Core —— 词表来自**被验证的产品**，
│                     而不是脚本里写死的上一个产品的字面量。每个词必须在产品自己的源码里
│                     真的出现（否则判为「凑数」），所以它同时是「产品数据的自述清单」
├── layout-debt.json  ★ 住在共享目录（`src/components/**`）但属于本产品的文件清单。
│                     `verify-product-boundary.mjs` 与 `audit-dead-files.mjs` 共用这一份，
│                     清单**只能缩小**；新产品应当留 `[]`（把 UI 放在自己名下就不必填）
├── service.ts        ExampleProductService —— 编排 Core，产品业务规则的唯一落点
├── actions.ts        ACTION_TO_MODEL / isKnownAction / actionToModelId
│                     ⚠️ 命名沿用 Flux 的约定：这**不是** Next.js server actions，
│                        不要加 'use server'
├── credits.ts        getRequiredCredits(action) —— 成本数字住在 catalogue，
│                     这里只做 action → model → cost 的翻译
├── types.ts          产品的 action 联合类型、请求/结果类型、参数枚举
└── content/
    ├── index.ts      导出各 JSON + 类型
    ├── home.json     落地页文案
    ├── generator.json 生成器 UI 文案
    ├── pricing.json  定价页文案
    └── seo.json      SEO 数据（标题/描述/关键词/结构化数据）
    ⚠️ `ProductContent` 只要求 `{ home, pricing, seo }` 三件 —— `generator.json`
       只有做产品自己的生成器 UI 时才需要。
    ⚠️ 数组的**条数由产品决定**：`features.items` / `howTo.steps` / `pricing.plans`
       想给几条就给几条。9.8.2-D 之前 `KeyFeatures` / `HowToSteps` 按下标写死 6 条 /
       4 步，第二个产品给得少就在 SSR 直接抛错 —— 现在它们遍历文案，装饰图标按位置
       循环取用。**共享组件不得假设产品内容的长度**（这条已由 Product B 的 build 实测）。
```

★ 标记的六件是 Phase 9.8.2-C 从 Core 搬出来的 —— 换产品时**只动这些**，
Core 的机制文件一行都不用改。

绑定动作在 `src/app/product-runtime.ts`，整个文件只有两行实质代码：

```ts
bindProductConfig(EXAMPLE_PRODUCT_CONFIG)   // 换产品 = 改这一行的 import
```

`bindProductConfig()` 在**赋值之前**跑 `validateProductConfig()`：模型 ⇄ Provider 映射、
积分成本、套餐完整性（订阅要有 planId + 周期、积分包反之、渠道商品 id 非空）任何一项缺失，
进程启动即失败，不会等到某个用户请求才炸。未绑定时 `getProductConfig()` 同样抛错 —— 没有
「回退到默认模型 / 默认价格」这条路。

`service.ts` 的推荐形状（照 Flux 的实际结构）：

```ts
export class ExampleProductError extends Error {
  constructor(public code: 'INVALID_ACTION' | 'GENERATION_FAILED', message: string) { … }
}

export class ExampleProductService {
  static isValidAction(a: string): boolean
  static async generate(params): Promise<Outcome>
  static toLegacyResult(task: AITask): …      // 仅当需要兼容旧响应格式
  static async uploadFile(file, userId?): Promise<string>
}
```

⚠️ 产品 Service 里**没有** `getProviderName()` —— Provider 选择是 Core 的职责
（`AIService.resolveProvider()`，见 §5.5）。在产品层再实现一次就等于造第二个真相。

`generate()` 的正确流程：

```
校验 action（非法 → ExampleProductError('INVALID_ACTION')）
  → actionToModelId(action)
  → 归一化输入图片
  → WorkflowService.createTask({ userId, model, provider, prompt, inputImages,
                                 parameters, waitForResult: true })
  → task.status !== 'completed' → throw
  → checkUserCredits(userId, 0) 取余额
  → return { task, creditsRemaining, provider }
```

注意：**积分扣减、Provider 派发、结果落 R2、失败退款全部在 `createTask()` 内部完成**。
产品层一行都不用写。

---

## 4. 完整改动清单

新增一个产品需要动的地方。**这张表是按当前代码实测出来的，不是理想状态。**

**第 0 步（复制母版本身）**：母版就是 `ai-saas-template` 这套代码 —— 以它为新起点时，
克隆后把远端换成你自己的仓库，`cp .env.example .env.local` 填最小必需变量，然后
`npm ci && npm run verify`。整条门禁只需 Node + 一次 `npm ci`：`migrations:real` 跑在 PGlite 上
（不要求外部数据库），唯一可能 SKIP 的是 `migrations:static`（要本地 Python + sqlglot 的 `.venv`，
缺则判 SKIP 不算通过，见 `PROJECT_STATUS.md`）。此时**唯一在场的产品是 Flux**，它会一直绿；
你的产品按 §4.1 建目录、按 §4.2 改两行装配点、按 §4.5 设自己的品牌，
最后按 §6 把 Flux 换掉（或直接删掉，见 §7）。

### 4.1 必须新建

| # | 路径 | 内容 |
|---|---|---|
| 1 | `src/lib/products/example-product/**` | 见 §3（六件 ★ 配置 + 两件 ★ 登记 + service/actions/content） |
| 2 | `scripts/verify-example-product.ts` | 产品**自己**的回归脚本，头部写 `// @product-scope example-product`（产品不在场时门禁判 SKIP，不判 PASS）。共享脚本里没有你产品的数字，所以这一步不能省 —— 否则你的价目表 / 成本表无人核对 |
| 3 | `src/app/<page>/page.tsx` | 产品页面（**首行 `import '@/app/product-runtime'`**：闭包里读得到产品配置就必须绑接缝，守卫逐个入口核） |
| 4 | `src/components/example-product/**` | 产品 UI（放在产品目录名下，别学 Flux 住在 `src/components/` 根 —— 那样必须逐条登记进 `layout-debt.json`，而清单**只能缩小**） |
| 5 | `src/app/api/example-product/route.ts` | **可选**：只有需要产品专属请求 / 响应形状（legacy 字段名、action 词汇、同步返回）时才建。通用入口 `POST /api/ai/image` 已经会按已绑定产品解析模型 / 成本 / modality / 输入图数量，**新产品不必写路由文件**；异步用 `/api/ai/tasks` |

### 4.2 必须修改（只有两处装配点）

| # | 路径 | 改什么 | 说明 |
|---|---|---|---|
| 6 | `src/app/product-runtime.ts` | 把 `FLUX_KONTEXT_PRODUCT` 换成你的 `ProductConfig` | **换产品 = 改这一行** |
| 7 | `src/app/product-content.ts` | 把内容 import 换成你产品的 `content` 模块 | 一个文件、一行（9.8.2-A） |
| 8 | `.env.example` | 新增产品需要的变量（放 `[PRODUCT]` 段） | `npm run audit:env` A 段会 FAIL |

新增的**服务端入口**（route / page / layout / 验证脚本）只要闭包里会读到产品配置，
就必须静态 import 接缝，否则 `npm run verify:product-seam` 会指出「该 bundle 里
`getProductConfig()` 会抛错」。确实打算跑在**未绑定**状态的文件（如探针脚本）
用 `@seam deliberate-unbound` 标记，守卫会把标记连同文件一起打印出来。

### 4.2b 过去必须改、现在**不需要**改的 Core 文件

| 原先要求 | 现状 |
|---|---|
| 在 `src/lib/ai/models.ts` 的 `MODELS` 里注册模型 | ❌ 不再需要：模型目录住在产品的 `catalogue.ts`，`models.ts` 只剩查询机制 |
| 在 `src/config/credits.ts` 的 `CREDIT_COSTS` 里加成本 | ❌ 该文件**已删除**：成本是模型的字段，住在产品目录 |
| 在 `src/config/billing.ts` 的 `BILLING_PACKAGES` 里加套餐 | ❌ 套餐表住在产品的 `billing.ts`；Core 只留 `BillingPackage` 形状与查询 |
| 在 `src/lib/user-tiers.ts` 里加档位/模型/宽高比 | ❌ 该文件已改名为 `src/lib/products/flux-kontext/tiers.ts`；能力表在 `capabilities.ts` |
| 更新 `scripts/verify-ai-core.ts` 的 Provider 注册表硬断言 | ❌ 不再需要（9.8.2-D）：它读的是**已绑定**的产品，脚本里没有产品字面量；你的产品数字写在自己的 `scripts/verify-<your-product>.ts`（见 §4.1 第 2 行与 §5.2） |
| 在 `scripts/audit-dead-files.mjs` 的白名单里登记你的产品 UI | ❌ 不再需要（9.8.2-D）：白名单只留模板可选能力，产品 UI 的保留登记住在你的 `layout-debt.json` |
| 改 `src/components/KeyFeatures.tsx` / `HowToSteps.tsx` 来适配你的文案条数 | ❌ 不再需要（9.8.2-D）：它们改为遍历文案，条目数量由产品的 JSON 决定 |

### 4.3 视需要修改

| # | 路径 | 情况 |
|---|---|---|
| 9 | `src/app/sitemap.ts` / `src/app/robots.ts` | 产品页面要进 SEO 就得加（当前**硬编码路由列表，无产品注册表**） |
| 10 | `src/proxy.ts` | **换产品时不需要改**（Phase 9.8.2-B 起）：它只做通用 `/api/v1/<rest>` → `/api/<rest>` 前缀剥离，不含产品词表。你的产品要暴露 `/api/v1/your-product/...` 这类公共路径时，**新建自己的** `src/app/api/<your-product>/[[...path]]/route.ts` 即可，别回到 proxy 里加清单 |
| 11 | `vercel.json` `rewrites` | **换产品时不需要改**：同应用改写已清空（`rewrites: []`），产品路由一律走 Next 自己的路由文件 |
| 12 | `.env.local` 的 `NEXT_PUBLIC_PROJECT_NAME` | **换品牌时改这个，别改母版名**。默认值是母版身份 `ai-saas-template`（见 §4.5）；Logo / SEO / 结构化数据全部读它，代码零硬编码 |
| 13 | 16 个 `src/app/<locale>/page.tsx` | **只有当新产品要取代 Flux 成为首页主体时**。每个文件内联了一份 Flux 字典 |

### 4.4 不需要改

- `src/components/Navigation.tsx` —— 实测**不含任何 Flux 引用**，链接是通用的
  （`/`、`/generate`、`/pricing`、`/resources`、`/resources/api`），标签来自 Core `common.json`
- `src/lib/workflow/**`、`src/lib/billing/**`、`src/lib/storage/**`、`src/lib/db/**`、
  `src/lib/admin/**` —— 这些是产品无关的，**改它们说明你的设计有问题**

### 4.5 母版名字 vs 产品品牌（正式改名后必读）

母版正式名称 = **`ai-saas-template`**。它只是**身份**，不是营销名，出现的全部位置：

| 位置 | 字段 | 性质 |
|---|---|---|
| `package.json` / `package-lock.json` | `name` | npm 身份；两处必须一致，否则 `npm ci` 判为不同步。`scripts/verify-auth.ts` 只断言它不再是 `nextjs-shadcn`，不钉住具体值 |
| `README.md` | H1 标题 | 仓库门面 |
| `public/manifest.json` | `name` / `short_name` | PWA 元数据默认值（母版自己的 `public/manifest.json` 未被 `metadata.manifest` 接线，因此改名无运行时副作用；产品若要真正上线 PWA，自己接线并写自己的名字） |
| `.env.example` | `NEXT_PUBLIC_PROJECT_NAME` 默认值 + 段首注释 | 「未设品牌时回落到母版」 |
| `src/lib/site-config.ts` | `projectName` 回落值 | 与上一行保持一致，是品牌 SSOT 的兜底 |

**产品品牌不在上面这张表里。** 真实品牌由 `NEXT_PUBLIC_PROJECT_NAME` 提供，
`siteConfig.projectName` 是唯一的读取点，下游消费者（`src/app/layout.tsx` 的 title template、
`Logo.tsx`、`StructuredData.tsx`、`seo/llms.ts`、`seo/metadata-generator.ts`）**都不硬编码名字**。
所以 Product B 换品牌 = 改一个环境变量，**不需要动 Core**。

**有意保留的旧标识（不是漏改）**：

| 保留项 | 原因 |
|---|---|
| `CharlieLZ/flux-kontext-template`：`LICENSE` 版权行、`.github/ISSUE_TEMPLATE/config.yml` 的安全报告 URL、`docs/archive/**` 里的原始资料 | **上游来源与版权归属**。这是唯一真实存在的远端；改名不改写来源，伪造一个新 URL 会让文档失效 |
| `flux-kontext` / `Flux Kontext` / `FLUX`：`src/lib/products/flux-kontext/**`、`src/components/FluxKontextGenerator.tsx`、`src/app/api/flux-kontext/`、模型 id（`black-forest-labs/flux-*`）、`docs/FLUX_PRODUCT.md` | **示例产品自己的名字**与厂商真实模型 id，属于产品层 / 外部事实 |
| 第三方依赖名：`@fal-ai/client`、`@supabase/*`、`stripe`、`creem`、`next` … | 依赖身份，改了装不上 |
| `docs/archive/**`、`docs/REFACTOR_PLAN.md`、`docs/PROJECT_STATUS.md` 里的历史行（如 B-19「Phase 6 改 `ai-saas-template`」） | **历史记录**。归档 README 已经声明这批文档来自 `flux-kontext-template` 时期，改写历史等于伪造证据 |
| 磁盘目录名（本地工作区路径，本仓库副本叫 `ai-saas-template`） | 本地工作区路径，不在仓库内容里；改名会切断工具链（Qoder / `.venv` / `.next` 都以此为根） |

**规则**：以后凡是看到「旧名」出现在**新代码**里，先问它是身份、品牌、上游归属还是产品事实 ——
只有第一项该改。共享脚本层依旧**不允许**出现产品字面量（`scripts/**` 没有词表扫描，
这条靠 review 兜，见 `PROJECT_STATUS.md` §10.1）。

---

## 5. 已知障碍（必读）

**9.8.2-D 之后，「装一个产品」= 产品目录 + 两行装配点，共享脚本与共享组件都不再要求你
改 Core。** 5.1 / 5.2 / 5.3 / 5.5 已解除（保留结论供判断边界用）；真实剩余的是
「没有产品注册表」（§5.1 末，**这是选择不是遗漏**）与 §5.4 的文案 / i18n 重复、品牌串残留。
历史记录见 [`MOTHER_TEMPLATE.md` §5.4](./MOTHER_TEMPLATE.md) 与
[`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。

### 5.1 组件不再直接 import 产品 —— **已由 Phase 9.8.2 解除**

本节原先记录的是「8 个共享组件**直接** import Flux 内容，删产品则 build 断链」。
**该障碍已在 Phase 9.8.2 第一切片（内容间接层）中消除。** 现状：

```
$ grep -rn "@/lib/products" src/components/
src/components/flux-kontext/{generator-config-card,generator-workspace-card,model-config}  ← 产品自己的 UI
src/components/FluxKontextGenerator.tsx  src/components/UpgradePrompt.tsx                  ← 同上（住在共享目录是排版债务）

$ grep -rn "@/lib/products" src/ | 排除 src/lib/products/ 自身
src/app/product-runtime.ts       ← 配置接缝：唯一 bindProductConfig() 的地方
src/app/product-content.ts       ← 内容装配点
src/app/api/flux-kontext/route.ts← 产品自己的 API 路由
src/components/…                 ← 上面那 5 个产品 UI
src/config/product.ts、src/lib/content/*.ts 里只是**注释**提到该路径（写明「不得 import」）
```

`FAQ` / `Footer` / `HomeContent` / `HomeContentSimple` / `HowToSteps` / `KeyFeatures` /
`PricingContent` / `TwitterShowcase` 这 8 个**共享**组件仍然只接受
`src/lib/content/contracts.ts` 声明的**内容形状**（产品无关的 interface），
实际文案由页面从装配点注入。
换产品的首页 / 定价 / 页脚文案 = 只改 `src/app/product-content.ts` 那一行 import；
`ProductContent` 的类型标注就是契约校验，产品 JSON 形状不符时 `tsc --noEmit` 直接失败。

⚠️ 9.8.2-C 把 `src/lib/user-tiers.ts` 搬成 `src/lib/products/flux-kontext/tiers.ts` 之后，
上面第一组命中数从 **0 变成 5** —— 不是新障碍，而是那 5 个文件本来就是产品 UI，
过去 import 的是一个「住在 Core 的产品模块」（更糟）。守卫现在按「路径或文案点名产品」
把它们归为产品代码，并要求它们逐条出现在 `KNOWN_LAYOUT_DEBT`（只能缩小）里。

**仍未解决的部分**：不存在「产品列表」的注册表 —— 两个装配点各自指向**单个当前产品**，
不是多产品并存；`bindProductConfig()` 明确拒绝在同进程绑定第二个不同 id。
要在同一部署里同时跑两个产品，仍需新的一层间接
（见 [`PHASE_9_8_1_AUDIT.md`](./PHASE_9_8_1_AUDIT.md) F9.8-D）。

### 5.2 验证脚本依赖产品 —— **已由 Phase 9.8.2-D 解除**

原先 `scripts/verify-ai-core.ts` 与 `scripts/verify-billing.ts` 里钉着 Flux 的模型 id、
action 成本、Provider 注册表和 `content/pricing.json` 路径，换产品就得编辑这些**共享**脚本 ——
等于把产品数据放回了母版侧。现在的分工：

| 脚本 | 现在读什么 |
|---|---|
| `verify-ai-core.ts` | **已绑定**的产品：模型 id / 成本 / 输入图数量 / Provider 注册表全部从 `getProductConfig()` 派生 |
| `verify-billing.ts` | 同上，套餐标识符契约与「文案 ⇄ 金额」一致性走内容装配点，检查的是**那个产品**的文案 |
| `verify-product-config.ts` | 枚举 `src/lib/products/*/config.ts`，词表由**被验证的产品自己**声明（`vocabulary.ts` + bundle 派生），不再是脚本里写死的 Flux 词表 |
| `verify-product-seam.mjs` / `verify-product-boundary.mjs` / `audit-architecture.mjs` | 按形状与目录判断，不含产品词 |
| `audit-dead-files.mjs` | 「无引用但保留」的白名单只允许**模板可选能力**（`src/components/ui/**`、`src/lib/ai/providers/**`）+ 母版替代方案；产品 UI 的登记改由各产品的 `layout-debt.json` 提供（与边界守卫**同一份**清单） |
| `verify-flux-kontext.ts` | **Flux 专属回归**：那些只有 Flux 才有的数字（价目表、`pro`/`max` 成本、渠道商品 id、tier 限额）逐条搬到这里。它头部带 `// @product-scope flux-kontext` |

共享脚本的**代码**里现在没有产品字面量（两处例外都不是耦合：解释这次拆分的注释、
`audit-architecture.mjs` 里那条「历史产品耦合路径不得复活」的 `@/lib/flux-kontext*` 规则）。

**`@product-scope` 协议**：脚本头部声明 `// @product-scope <id>` 后，`scripts/verify-all.mjs`
在 `src/lib/products/<id>/` 不存在时判 **SKIP（绝不 PASS）**。所以「产品专属测试」既不会被
误当成母版能力，也不会因为换产品而假装通过 —— 新产品应当**建立自己的**同名脚本并声明自己的 scope。

后果：**换产品时共享脚本一行都不用改**，只需要把你的专属断言写进
`scripts/verify-<your-product>.ts` + `@product-scope <your-product>`。
`tsconfig.json` 排除 `scripts/**`（所以 `npm run lint` 测不到脚本层耦合）这一点没变，
但现在没有任何共享脚本再指向某个产品目录。

### 5.3 Core 配置里含产品语义 —— **已由 Phase 9.8.2-C 解除**

原先的四行「Core 携带产品数据」全部搬到产品目录：

| 位置 | 问题 | 现状 |
|---|---|---|
| ~~`src/lib/ai/models.ts` `MODELS`：10 个条目全是 `flux-*`~~ | 产品模型住在 Core | **已搬**：数据在 `products/flux-kontext/catalogue.ts`，`models.ts` 只剩读绑定包的查询与校验 |
| ~~`src/config/credits.ts` `CREDIT_COSTS`：键全是 `flux-*` 模型 id~~ | 产品成本住在 Core | **已搬并删除该文件**：成本是产品模型的 `credits` 字段 |
| ~~`src/config/billing.ts`：`providerProductIds.creem` 含 `'FluxKontext-Plus-Monthly'`~~ | 产品套餐与渠道商品 id 住在 Core | **已搬**：`products/flux-kontext/billing.ts`；Core 只留 `BillingPackage` 形状 + 查询 |
| ~~`src/lib/user-tiers.ts`：Flux 专属模型列表与宽高比~~ | 产品能力住在 Core | **已搬**：`products/flux-kontext/tiers.ts` + `capabilities.ts`；Core 不再认识 `pro` / `max` |
| ~~`src/proxy.ts:79-100` 硬编码 4 个 Flux action 的重写~~ | **已消解（Phase 9.8.2-B）** | 只剩通用 `/api/v1/<rest>` → `/api/<rest>`；legacy 路径挪到 `src/app/api/flux/[[...path]]/route.ts`（产品自己的文件，只有一行再导出） |
| ~~`vercel.json` `rewrites` 硬编码 `/api/v1/flux/*`~~ | **已消解（Phase 9.8.2-B）** | `rewrites: []`。**旧误述更正**：两层形状其实并不矛盾 —— proxy 用 `pathname.includes('/text-to-image/pro')` 匹配，所以带不带 `/flux/` 段**都会**命中同一分支；真正的问题是它把**任意** `/api/v1/*` 都吞进 Flux（F9.8-A），现已消失 |

这一项原先「不在 `verify-product-boundary` 覆盖范围内，所以守卫依然 PASS」的盲区
已经补上：扫描范围改成**按排除法**（`src/` 除 products 与 app 全部算 Core），
并由 `scripts/verify-product-config.ts` 用**从产品配置包派生的词表**扫 Core ——
同时种一个假违规做正对照，确保「0 命中」是有信息的结论而不是没看。

### 5.4 文案与 i18n 的重复

- ~~英文首页字典存在**两份**：`products/flux-kontext/home-config.ts` 的 `EN_DICTIONARY`
  与 `products/flux-kontext/content/home.json`~~
  **已消除（Phase 9.8.2）**：`home-config.ts` 已删除，`content/home.json` 是唯一英文首页来源
- 再**内联 16 份**：每个 `src/app/<locale>/page.tsx` 各写一份字典
- ~~`getDictionary(locale)` **忽略入参，恒返回 `EN_DICTIONARY`**~~
  **随文件删除一并消失（Phase 9.8.2）**；语言页现在直接传 `dictionary` prop
  （形状由 Core 的 `HomeDictionary` 契约约束）
- 产品 `content/*.json` **只有英文**，尽管 Core 有 16 locale 的机制
- `src/components/flux-kontext/types.ts` **重复定义**了 `FluxKontextAction` 联合类型
  （与 `src/lib/products/flux-kontext/types.ts` 里的那份并存）

### 5.5 Provider 选择逻辑在产品层 —— **已由 Phase 9.8.2-C 解除**

原先 `FluxKontextService.getProviderName()` 自己读 `process.env.AI_PROVIDER` /
`IMAGE_GENERATION_PROVIDER` 并用 `listAIProviderNames()` 校验，第二个产品要重写一遍。
该方法**已删除**，产品层不再做 Provider 选择：

```
request.provider（显式）→ AI_PROVIDER / IMAGE_GENERATION_PROVIDER（须支持该模型）
                        → 模型自己的 defaultProvider（来自产品目录）
```

这条优先级链只有 Core 的 `AIService.resolveProvider()` 一份实现
（`src/lib/ai/service.ts`），产品层通过 `WorkflowService` 间接使用。
「显式指定但不支持该模型」仍然**抛错**而不是静默换一家。

---

## 6. 换掉 Flux（而不是新增）

如果目标是「用这个母模板做我自己的产品，Flux 不要了」：

1. 先按 §4 建好新产品，确认它能跑通完整链路（生成 → 扣积分 → 落存储 → 展示）
2. 把 `src/app/product-runtime.ts` 与 `src/app/product-content.ts` 的两行 import
   换成你产品的配置包与内容模块（**各一个文件、各一行**）
3. ~~处理 §5.3：把 `MODELS` / `CREDIT_COSTS` / `billing.ts` 换成你的~~
   **9.8.2-C 后不需要**：模型、成本、Provider 映射、套餐、能力全部住在你自己的产品目录里，
   Core 没有第二份要同步的表
4. 删 `src/app/api/flux/[[...path]]/route.ts`（Flux 的 legacy 兼容层）。
   `src/proxy.ts` 与 `vercel.json` **不用动** —— 它们已经不认识任何产品（9.8.2-B）
5. 删 `src/lib/products/flux-kontext/`、`src/app/api/flux-kontext/`、
   `src/components/FluxKontextGenerator.tsx`、`src/components/UpgradePrompt.tsx`、
   `src/components/flux-kontext/`、`src/app/{generate,pricing,resources}/`、`src/app/page.tsx`
   （后两组是 Flux 的公开入口；`npm run verify:product-boundary` 的债务清单会逐条列出它们）
6. ~~改 `scripts/verify-ai-core.ts` 与 `scripts/verify-billing.ts` 里的产品引用（§5.2）~~
   **9.8.2-D 后不需要**：共享脚本读的是已绑定的产品。要保住你产品的数字，
   新建 `scripts/verify-<your-product>.ts` 并在头部声明 `// @product-scope <your-product>`
   （Flux 的数字已经全部住在 `scripts/verify-flux-kontext.ts`，可以照它抄结构）
7. 改 16 个 locale 页面（或先砍到只留默认语言）
8. 全文搜 `flux` / `Flux` / `FLUX` 清理残留品牌串
   （已知散落在 signin / signup / dashboard / resources / privacy / terms / refund /
   `ApiDocumentation` / `StructuredData` / `UpgradePrompt` 等处）
9. `npm run verify` 必须全绿
10. `npm run audit:dead-files` 会告诉你哪些文件已经没人引用了 —— 按它的输出删，
    别凭感觉删

> **顺序很重要**：先让新产品跑通，再删旧的。反过来会有一段时间什么都跑不了。

---

## 7. 删除实验：母版到底能不能脱离 Flux 跑

目标：**删掉 Flux 的产品面**，看母版（Core 机制 + 共享 UI + 非产品路由）是否仍能
类型检查、lint、跑架构守卫。必须在**独立副本**里做，主工作区一行都不动。

```bash
# 0) 先提交要验证的代码（worktree 只能从某个 commit 建）
git worktree add --detach .experiment/delete HEAD
robocopy node_modules .experiment/delete/node_modules /E /MT:16   # 真实复制，不能用符号链接

# 1) 基线：证明这套环境本身可信
cd .experiment/delete && npx tsc --noEmit && npx eslint .        # 期望 exit 0

# 2) 第一遍：只删「产品数据 + 装配」，保留所有入口
rm -rf src/lib/products src/app/product-runtime.ts src/app/product-content.ts
npx tsc --noEmit                                                  # 期望：错误**只**出现在产品消费者

# 3) 第二遍：把产品面（路由 / 页面 / 组件）一并删掉
rm -rf src/app/api/flux-kontext src/app/api/flux src/app/generate src/app/pricing \
       src/app/resources src/app/page.tsx src/components/flux-kontext \
       src/components/FluxKontextGenerator.tsx src/components/UpgradePrompt.tsx
npx tsc --noEmit && npx eslint .                                 # 期望 exit 0
node scripts/audit-architecture.mjs                             # 期望 PASS
node scripts/verify-product-boundary.mjs                        # 期望 PASS，且打印「§B 不适用」

# 4) 清理：先 remove worktree，再删自己建的 scratch 目录，顺序反了会留下悬挂元数据
cd ../.. && git worktree remove --force .experiment/delete && rmdir .experiment
```

**判据**：`tsc --noEmit`（`npm run lint` 的后半）与 `eslint .` 是「Core 能否编译」的判据。
**9.8.2-D 起 `npm run verify` 也可以用于该实验了**：Flux 专属断言已搬进
`scripts/verify-flux-kontext.ts`（`@product-scope`），产品目录不在场时那一步判 **SKIP**
而不是 FAIL，其余各步照常判绿 —— 但**只看 lint 不够**，还要看 §7.4 那种「装得上第二个产品」
的正向证据。删除实验证明的是「不依赖」，装新产品证明的才是「可复用」。

### 7.1 9.8.2-C 的实测结果（基准提交 `9.8.2-C`，独立 worktree + 依赖真实复制）

| 步骤 | 结果 |
|---|---|
| 基线（未删任何东西） | `tsc --noEmit` **exit 0**、`eslint .` **exit 0** —— 环境可信 |
| 第一遍（删 `src/lib/products/` + 两个装配点） | `tsc` **18 条错误**，全部落在产品消费者：`api/flux-kontext/route.ts` 7、5 个内容装配页面各 1、5 个产品 UI 文件 6。**Core 机制（`src/lib` 非 products、`src/config`、`src/proxy.ts`）零报错** |
| 第二遍（再删产品路由 / 页面 / 组件） | `tsc --noEmit` **exit 0**、`eslint .` **exit 0** |
| `audit-architecture.mjs`（第二遍后） | **PASS**（10 个基础设施目录、51 个文件，无反向依赖） |
| `verify-product-boundary.mjs`（第二遍后） | **PASS**，104 个 Core 文件 0 处指向产品层；§B 与债务清单打印「产品目录为空：不适用」 |
| `verify-product-seam.mjs`（第二遍后） | **FAIL by design，32 条**：`src/config/billing.ts` 与 `src/lib/ai/models.ts` 这些 Core 读取点还在，但接缝已被删，任何能到达读取点的入口都报「该 bundle 里 `getProductConfig()` 会抛错」 |

最后一条是这个架构**想要的**结果：母版在没有产品的状态下**不会**拿着默认模型或默认价格
继续跑，而是在装配期就报错。它同时也是「复制母版后的正确顺序」的强制 ——
先放产品 + 接缝，再谈启动。

`scripts/**` 不在 `tsc` 范围内（`tsconfig.json` 排除了它），所以 lint 测不到 §5.2 的脚本耦合；
那部分只有 `npm run verify` 会暴露，而它正是本节禁止用于删除实验的原因。

**边界**：9.8.2-C 当时认为 worktree 里跑不了 `next build`，因此那轮实验**不含** build 证据。
**该结论已在 9.8.2-D 更正**：`node_modules` 用 `robocopy /E /MT:16` 真实复制（不是符号链接）后，
worktree 内的 `next build` 可以正常跑通 —— §7.4 的 Product B 构建证据就是在那里产生的。
主工作区的 `npm run verify`（含 build，19/19）另单独证明当前提交可构建。

### 7.2 历史记录

9.8.2-B-Gate 曾在基准提交 `9.8.2-B` 做过同一实验，当时**只**删产品目录，`tsc` 报
8 条错误（`api/flux-kontext/route.ts` 7 + `product-content.ts` 1），结论是
「组件与 Core 零报错，但产品面删不干净」。9.8.2-C 的两遍实验把问题从
「Core 是否干净」推进到「产品面**整体**删除后母版是否完整可编译」，
并新增了接缝守卫作为「未绑定必失败」的正向证据。

### 7.3 换产品时应当**保持绿色**的一步

`npm run verify` 里的 `scripts/verify-api-routing.ts` 钉住 `/api/v1` 路由链、
兼容路由的 handler 复用，以及「`src/proxy.ts` 源码里产品词命中数 = 0」。
**它与具体产品无关**，换产品时应当原样通过 —— 如果你的产品需要 legacy 公共路径，
加 `src/app/api/<your-product>/[[...path]]/route.ts`，别往 proxy 里塞清单。

---

### 7.4 Product B 实测：母版能不能装第二个产品（9.8.2-D）

删除实验只证明「Core 不依赖 Flux」。**可复用的正向证据是：装一个新产品，让它跑通全部门禁。**
做法：在独立 worktree（基准提交 `9.8.2-D`，依赖真实复制）里删掉 Flux 的全部产品面，
装进一个最小的新产品 `aurora-portrait`：

| B 自己声明的东西 | 内容 |
|---|---|
| 模型目录 | 4 个模型：`aurora-portrait`(9 积分) / `-hd`(24) / `aurora-restyle`(14，需要 1 张输入图) / `aurora-compose`(33，需要多张) |
| Provider 映射 | 只接 **fal + wavespeed** 两家（Flux 接四家），各自的端点 / 尺寸映射表住在 `provider-data.ts`；`aurora-restyle` 的 `defaultProvider` 是 wavespeed —— 解析仍走 Core 的 `AIService.resolveProvider()` |
| 积分成本 / 套餐 | `aurora_pack_small` 5.90/800、`aurora_pack_large` 29.00/5000、`studio_monthly` 14.90、`studio_yearly` 149.00（渠道商品 id 用 creem，与 Flux 的 stripe/creem 组合不同）；免费档 `aurora_free` 送 45 积分 |
| 能力表 | 自己的 4 个宽高比 → fal `image_size` 映射 |
| 内容装配 | `content/{home,pricing,seo}.json`（features / steps 条数与 Flux 不同，见 §3 的长度警告）；`generator.json` **没有**——B 不做产品专属生成器 UI |
| 登记 | `vocabulary.ts`（品牌词 + 端点前缀，全部在自己源码里出现）、`layout-debt.json` = `[]`（UI 不住在共享目录） |
| 装配点 | 只有两行：`product-runtime.ts` 换 bundle import、`product-content.ts` 换内容 import |
| 入口 | 没有写任何 API 路由文件 —— 生成走通用 `POST /api/ai/image`，异步走 `/api/ai/tasks`；页面 `<generate>` 直接用 `listModels()` + `CreditDisplay` |

**结果**（全部为该 worktree 内的真实退出码）：

| 检查 | 结果 |
|---|---|
| `npm run lint`（`eslint .` + `tsc --noEmit`） | **exit 0** |
| `npm run verify` | **17 通过 · 0 失败 · 1 跳过，exit 0**（18 步：Flux 专属那步随产品目录一并消失） |
| `verify-ai-core` / `verify-billing` / `verify-product-config` / `verify-workflow` | 全部 **PASS**，且断言的是 **B 的**模型 / 成本 / 套餐 / 文案（脚本里没有 B 的字面量，它们读绑定包） |
| `verify:product-seam` / `verify:product-boundary` / `audit:architecture` / `audit:dead-files` / `audit:unused-exports` | **PASS**（`layout-debt.json = []` 时边界守卫仍核得出「产品 UI 不在共享目录」） |
| `migrations:real`（PGlite 内存真库） | **PASS** |
| `migrations:static` | worktree 里没有 `.venv` → 首轮 **SKIP**；用 `PYTHON=<主工作区>/.venv/Scripts/python.exe` 单独重跑 **PASS**（SQL 文件与产品无关） |
| `next build` | **PASS** —— 44 个静态页生成，路由表里有 `/api/ai/image`、`/api/ai/tasks`、`/api/ai/tasks/[id]`、`/generate` |
| `@product-scope` 协议本身 | 把 `scripts/verify-flux-kontext.ts` 放回 B 的 `scripts/`（而产品目录仍缺）→ 该步 **SKIP**，脚本一行未跑，`exit 0`。证明「产品不在场」不会伪装成 PASS |

**B 反过来暴露并修掉的三个真实缺陷**（都不是「为了跑绿而改判据」）：

1. **Core 没有按模型契约校验输入图**。`requiredInputImages` 只是声明；fal / wavespeed 的请求构造
   按「这次带了几张图」分支，缺图时把「必须带图」的模型**静默降级成文生图**——结果不对、积分照扣。
   现在 `AIService.generate()` / `submitTask()` 在**分发之前**统一调
   `requireContractInputImages()`（`src/lib/ai/utils.ts`），四家引擎行为与产品声明一致。
   分类也一并修正：这类违反契约的请求归 `INVALID_REQUEST`（不可重试），
   不再当 `INTERNAL_ERROR` 重提交三次（`src/lib/workflow/errors.ts`），
   Flux 的产品路由把它映射成 **400** 而不是 500。
2. **共享组件假设了产品文案的条数**。`KeyFeatures` / `HowToSteps` 按 `items[5]` / `steps[3]`
   写死，B 给的条数少 → `next build` 的 SSR 直接抛 `Cannot read properties of undefined`。
   改为遍历文案、图标按位置循环取用（Flux 的 6/4 条渲染结果不变）。
3. **`audit-dead-files.mjs` 的白名单里硬写着 Flux 的产品 UI**（`UpgradePrompt.tsx`）。
   换产品后那是条指向不存在文件的僵尸登记。现在白名单只留模板可选能力（按形状：
   `src/components/ui/**`、`src/lib/ai/providers/**`）+ 母版替代方案，产品 UI 的保留
   登记由各产品的 `layout-debt.json` 提供 —— 与 `verify-product-boundary.mjs` 同一份清单。

**仍然不属于母版复用阻塞项**（记录，不在本轮处理）：16 个 locale 页面内联 Flux 字典、
`ApiDocumentation.tsx` 里的 Flux 营销文案（它不 import 产品，所以边界守卫无从判定）、
不存在产品注册表（§5.1 末，刻意选择）。

## 8. 相关文档

| 文档 | 内容 |
|---|---|
| [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md) | 架构、Core 职责、边界规则、验证体系 |
| [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) | 动手前后的硬性约束 |
| [`FLUX_PRODUCT.md`](./FLUX_PRODUCT.md) | 当前产品的实际实现（§10 有一段早期的「加第二个产品」说明，以本文为准） |
| [`AI_CORE.md`](./AI_CORE.md) | 如何新增 AI Provider |
| [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) | §5 各障碍的完整记录与建议阶段 |
