# AI_CORE.md — AI Core 说明

> Phase 2 产物。描述 `src/lib/ai/` 这一层的设计意图、边界与扩展方式。

---

## 1. 它解决什么问题

重构前，AI 能力长这样：

```
API 路由  ──►  FluxKontextService  ──►  fal / kie / wavespeed / atlascloud
               （以产品命名）            （被业务直接调用）
```

三个问题：

| 问题 | 表现 |
|---|---|
| **产品名污染架构** | 核心类型叫 `FluxKontextAction` / `FluxKontextProvider` / `FluxKontextResult`，`action` 是 `text-to-image-pro` 这类产品动作 |
| **业务层能碰到厂商** | 任何地方都能 `import { fal } from '@fal-ai/client'`，换厂商要全局搜索替换 |
| **加模型要改核心类型** | `action` 是联合字面量，新增一个模型要改 `types.ts` |

重构后：

```
业务层（API 路由 / Workflow）
        │
        ▼
   AIService            ← 业务层唯一入口
        │
        ▼
   AIProvider           ← 可插拔契约
        │
   ┌────┼────┬──────────┐
   ▼    ▼    ▼          ▼
  fal  kie  wavespeed  atlascloud
```

AI Core 只描述一件事：

> **调用一个 AI 模型完成一次生成**

它不描述「调用 Flux Kontext 做一次图生图」。

---

## 2. 分层与职责

| 层 | 位置 | 职责 | 不该做的事 |
|---|---|---|---|
| **类型契约** | `ai/types.ts` | 定义 `GenerateRequest` / `GenerateResult` / `AIProvider` | 出现任何产品名、厂商名、业务动作名 |
| **模型目录（查询机制）** | `ai/models.ts` | 回答「有哪些模型、这个模型存不存在」——只查绑定后的配置 | 携带任何模型清单、价格、厂商名 |
| **服务入口** | `ai/service.ts` | 解析 Provider、调用、返回统一结果 | 出现任何具体厂商逻辑 |
| **注册表** | `ai/providers/index.ts` | 名称 → 实例（实例来自**已绑定的产品配置**，9.8.2-C 起无字面量注册表） | 被业务层绕过 `AIService` 直接使用 |
| **Provider 实现** | `ai/providers/*.ts` | 把统一请求翻译成某个厂商的 HTTP 调用，再把响应归一化 | 反向依赖业务层 |
| **归一化** | `ai/normalize.ts` | 把任意响应形状压成 `GenerateResult` | 包含厂商特有分支 |
| **工具** | `ai/utils.ts` | 被两个以上 Provider 共用的纯函数 | 放只有一个 Provider 用的东西 |

---

## 3. AIService

`src/lib/ai/service.ts`

```ts
AIService.generate(request)        // 执行一次生成
AIService.submitTask(request)      // 提交异步任务
AIService.getTaskResult(taskId, model, provider?)  // 查询异步任务
AIService.verifyWebhook(provider, rawBody, headers)
AIService.uploadFile(file, provider?)
AIService.resolveProvider(request) // 只解析不执行，便于调试
```

### 3.1 Provider 解析规则

```
1. request.provider 有值
     └─ 该 Provider 必须支持 request.model，否则抛错
        （不会静默换成别家 —— 静默回退会掩盖配置错误）

2. 环境变量 AI_PROVIDER 或 IMAGE_GENERATION_PROVIDER 有值
     └─ 该 Provider 支持 request.model 时生效，否则忽略

3. 回落到 model 自身的 defaultProvider
```

`IMAGE_GENERATION_PROVIDER` 是**旧变量名**，保留是为了不破坏现有部署。
新项目请用 `AI_PROVIDER`。

### 3.2 为什么业务层只能用它

因为「换 Provider 不改业务代码」这条要求，只有在业务层**看不见 Provider** 时才成立。

```ts
// ✅ 允许
import { AIService } from '@/lib/ai/service'
const result = await AIService.generate({ model: 'flux-kontext-pro', prompt })

// ❌ 禁止
import { FalProvider } from '@/lib/ai/providers/fal'
import { fal } from '@fal-ai/client'
```

---

## 4. AIProvider

`src/lib/ai/types.ts`

```ts
interface AIProvider {
  readonly name: string                 // 'fal' | 'kie' | ...
  readonly modality: AIModality         // 'image' | 'video' | 'audio' | 'text'
  readonly models: readonly string[]    // 本 Provider 支持哪些模型

  generate(request: GenerateRequest): Promise<GenerateResult>   // 必需

  uploadFile?(file: File): Promise<string>                      // 可选
  submitTask?(request): Promise<AITaskHandle>                   // 可选
  getTaskResult?(taskId, model): Promise<AITaskResult>          // 可选
  verifyWebhook?(rawBody, headers): Promise<boolean>            // 可选
}
```

设计取舍：

- **只有 `generate` 是必需的**。`atlascloud` 没有文件存储、`fal` 没有 webhook 校验，强制实现会逼出空方法。
- **`modality` 是单值**。一个 Provider 通常只擅长一类能力；将来要跨能力，再拆成多个实例即可。
- **`name` 是 `string` 而非联合字面量**。加一家 Provider 不应该需要改核心类型。

### 4.1 现有实现

| Provider | 模型数 | 同步/异步 | 上传 | webhook 校验 |
|---|---|---|---|---|
| `fal` | 10 | 同步 `subscribe` + 队列 | ✅ | — |
| `kie` | 4 | 异步（提交 + 轮询） | — | ✅ HMAC-SHA256 |
| `wavespeed` | 6 | 同步优先，失败转轮询 | — | ✅ HMAC-SHA256 |
| `atlascloud` | 8 | 异步（提交 + 轮询） | — | — |

---

## 5. Provider Registry

`src/lib/ai/providers/index.ts`

```ts
getAIProvider(name)        // 取实例，未注册则抛错
listAIProviderNames()      // 名称列表
listAIProviders()          // 实例列表
hasAIProvider(name)        // 是否已注册
```

**没有注册表字面量**（9.8.2-C 起）。`src/lib/ai/providers/index.ts` 只查
`getProductConfig().providers` —— 实例由产品侧用 Core 的引擎类构造后绑定。
业务层拿到实例也没用 —— 它应该只调 `AIService`。这层查询存在的意义是让 `AIService`
有地方取实现，同时让「接了哪几家厂商」成为**产品数据**。

---

## 6. GenerateRequest

```ts
interface GenerateRequest {
  model: string                              // 必需，见 ai/models.ts
  provider?: AIProviderName                  // 可选，指定执行方
  prompt?: string
  inputImages?: string[]                     // 图生图 / 多图编辑 / 视频首帧
  parameters?: Record<string, unknown>       // 模型参数
  idempotencyKey?: string
  webhookUrl?: string
}
```

### 6.1 为什么 `parameters` 是 `Record<string, unknown>`

因为参数空间由第三方 API 决定，且各模型差异很大：

| 参数 | fal | kie | atlascloud |
|---|---|---|---|
| `image_size` | ✅ | — | — |
| `aspect_ratio` | — | ✅ | ✅ |
| `safety_tolerance` | 字符串 | 字符串 | 数字 |
| `num_inference_steps` | ✅（仅 schnell） | — | — |

如果在核心类型里穷举，每接一个模型都要改 `types.ts`。
现在的做法是：**核心只声明「有哪些参数」，Provider 负责映射与转换**。

### 6.2 `action` 去哪了

旧的 10 个 `action` 被拆成两个维度：

```
action: 'edit-image-pro'
   ↓
model: 'flux-kontext-pro-edit'  +  inputImages: ['https://...']
   ↑                                ↑
   用哪个模型                        有几张输入图
```

因为 `text-to-image-pro` 和 `edit-image-pro` 用的是**同一个模型**，区别只是有没有输入图。
拆开之后，模型数量从「10 个 action」变成「10 个 model」，但语义清晰得多，而且新增模型不需要改类型。

旧的 `action` 词表现在在**产品层**：`src/lib/products/flux-kontext/actions.ts` 的
`ACTION_TO_MODEL` / `actionToModelId()`。

> ⚠️ 历史说明：Phase 8 之前它位于兼容层 `src/lib/flux-kontext.ts`，**该文件已删除**。
> action → model 的映射属于产品语义，因此归 Product，不在 Core。

---

## 7. GenerateResult

```ts
interface GenerateResult {
  assets: GeneratedAsset[]     // { url, width?, height?, contentType?, fileSize?, ... }
  provider: AIProviderName     // 实际执行方
  model: string                // 实际使用的模型
  taskId?: string              // 异步任务的 id
  seed?: number
  raw?: unknown                // Provider 原始响应，仅用于调试
}
```

`GeneratedAsset` 带索引签名 `[key: string]: unknown`，因此 Provider 返回的额外字段
（如 fal 的 `content_type`）会被完整保留，不会在归一化时丢失。

### 7.1 归一化

`ai/normalize.ts` 的 `normalizeGenerateResult()` 按顺序尝试这些字段名：

```
images → data.images → output → outputs → result
```

取到第一个非空列表后，把字符串 URL、`{ url }` 对象都统一成 `GeneratedAsset`。
**找不到任何资源时抛错**，而不是返回空结果让上游猜。

---

## 8. Workflow 与 Provider 的区别

这是整个架构里最容易混淆的一点。

| | AIProvider | AIWorkflow |
|---|---|---|
| **回答的问题** | 「怎么调这个模型」 | 「这个产品要做什么」 |
| **例子** | `fal.generate()`、`kie.submitTask()` | 「生图前检查积分、生图后存 R2、失败退款」 |
| **知道积分吗** | 不知道 | 知道（`estimateCredits()`） |
| **知道用户吗** | 不知道 | 知道（`run(ctx, input)`） |
| **知道数据库吗** | 不知道 | 知道（记录任务） |
| **会调用谁** | 第三方 AI API | `AIService` + `CreditService` + `StorageService` |
| **是否已实现** | ✅ Phase 2 | ✅ Phase 7（`src/lib/workflow/`） |

调用关系：

```
Workflow  负责「业务编排」
   │
   ├─ CreditService.consume()      扣积分
   ├─ AIService.generate()         调模型   ──►  Provider  ──►  第三方 API
   ├─ StorageService.upload()      存文件
   └─ CreditService.refund()       失败退款

Provider  负责「怎么调模型」，对业务一无所知
```

一句话记忆：

> **Provider 是「怎么调」，Workflow 是「做什么」。**
> 同一个 Provider 可以被任意多个 Workflow 复用；
> 同一个 Workflow 可以换任意多个 Provider。

编排逻辑**已经下沉完成**（Phase 7），落在 `src/lib/workflow/`：

```
API Route（薄入口）
  → WorkflowService.createTask()      src/lib/workflow/service.ts
       ① getModel()  ② AIService.resolveProvider()  ③ 幂等检查
       ④ checkUserCredits() 余额预检  ⑤ taskRepo.create(status:'pending')
       ⑥ chargeTask() 扣积分          ⑦ AIService.generate() / submitTask()
  → 结果经 persistResult() → StorageService 落 R2
  → 失败走 failTask() → refundTask() 退款
```

> ⚠️ 历史说明：早期计划把它放进 `src/lib/workflows/image.ts`（复数 `workflows`、按 modality 分文件）。
> **实际落地路径是 `src/lib/workflow/`（单数），且不按 modality 拆分** —— 它是一个通用的
> 任务引擎（状态机 + 结算 + webhook + polling + retry），不是「图像工作流」。
> 细节见 [`WORKFLOW.md`](./WORKFLOW.md)。

**注意积分扣减的时机**：在 `createTask()` 第 ⑥ 步、任务还是 `pending` 时就扣，
**不是**完成时才扣；失败才退。幂等键 `task:<taskId>:charge` / `task:<taskId>:refund`。

---

## 9. 模型目录

**形状**在 Core（`src/lib/ai/types.ts` 的 `ModelDefinition`），**查询机制**在
`src/lib/ai/models.ts`（`getModel` / `listModels` / `isModelSupportedBy`），
**数据**在**产品目录**（Flux：`src/lib/products/flux-kontext/catalogue.ts`），
经 `bindProductConfig()` 绑定。9.8.2-C 之前这张表写在 Core 里，那是「Core 携带产品数据」。

```ts
interface ModelDefinition {
  id: string
  modality: AIModality
  label: string
  requiredInputImages: 0 | 1 | 'many'   // 决定是文本生图还是图生图
  defaultProvider: AIProviderName
  providers: AIProviderName[]           // 支持该模型的 Provider
  credits: number                       // 该模型一次生成扣多少积分（**唯一价格真相**）
}
```

> `credits` 直接写在产品的模型目录里，是**唯一**的积分成本真相：
> UI 展示、`getRequiredCredits()`、`WorkflowService` 实扣读的都是同一个字段。
> ~~旧写法：`src/config/credits.ts` 的 `getCreditCost(id)`~~ —— 那份 Core 表键全是 `flux-*`，
> 已随 9.8.2-C 删除。未登记的模型 id 一律**抛错**，不回退。

> **`requiredInputImages` 是契约，不只是展示用的标注**（9.8.2-D）：
> `AIService.generate()` / `submitTask()` 在**分发到任何厂商之前**调用
> `requireContractInputImages(model, request)`（`src/lib/ai/utils.ts`），
> 按 `0 / 1 / 'many'` 校验请求带了几张图。
> 为什么放在统一入口而不是各家 Provider 里：fal / wavespeed 的请求构造是按
> 「这次带了几张图」分支的，缺图时它们**不会报错**，而是把「必须带图的编辑模型」
> 静默降级成一次文生图 —— 而积分照扣。行为不该由「哪家引擎恰好检查了」决定。
> 该错误在异步链里被分类为 `INVALID_REQUEST`（**不可重试**），不会浪费三次重提交；
> 通用同步路由 `/api/ai/image` 本就有自己的前置校验（扣积分**之前** → 400），
> Flux 的 legacy 路由本轮起也把 `INVALID_REQUEST` 映射为 400，
> 不再把「你没带图」报成 500。

当前 10 个模型（**Flux 产品的数据**，不是 Core 的）：

| model | 输入图 | Provider |
|---|---|---|
| `flux-kontext-pro` | 0 | fal, kie, wavespeed, atlascloud |
| `flux-kontext-pro-edit` | 1 | fal, kie, wavespeed, atlascloud |
| `flux-kontext-pro-multi` | many | fal, wavespeed, atlascloud |
| `flux-kontext-max` | 0 | fal, kie, wavespeed, atlascloud |
| `flux-kontext-max-edit` | 1 | fal, kie, wavespeed, atlascloud |
| `flux-kontext-max-multi` | many | fal, wavespeed, atlascloud |
| `flux-schnell` | 0 | fal, atlascloud |
| `flux-dev` | 0 | fal, atlascloud |
| `flux-realism` | 0 | fal |
| `flux-anime` | 0 | fal |

> **关于 flux-kontext**：它在这里只是**一个模型**，和将来的 `gpt-4o`、`sora-2` 是同级配置数据。
> 「Flux 是模型」，不是「Flux 是架构」。

---

## 10. 扩展指南

### 10.1 新增一个 Provider

#### 职责边界（先读这个，比步骤重要）

Provider **只能**负责：

| 允许 | 具体含义 |
|---|---|
| Provider API 调用 | 该厂商的 HTTP/SDK 调用、endpoint 映射 |
| Authentication | 读自己的 `*_API_KEY`，加正确的 header |
| Request mapping | 把通用 `GenerateRequest` 翻译成厂商入参 |
| Response normalization | 把厂商返回翻译成 `GenerateResult`（用 `normalize.ts`） |
| Webhook verification | 实现可选的 `verifyWebhook()`，验签逻辑完全自包含 |
| Provider-specific polling | 自己实现轮询循环（**没有**通用轮询工具） |

Provider **不允许知道**：

- ❌ Flux / 任何 Product（不得 import `@/lib/products/*`）
- ❌ Credit 业务规则（不得 import `@/lib/services/credits`、任何积分常量）
- ❌ Billing / 订单 / 支付
- ❌ User / session / UI
- ❌ 数据库（不得 import `@/lib/db/*`）

这条由 `npm run verify:product-boundary` 与 `npm run audit:architecture` 守卫
（前者 9.8.2-C 起按**排除法**认定 Core：`src/` 除 `src/lib/products/**` 与 `src/app/**`，
`lib/ai` 自然在内）。

> ~~唯一的既有例外：`src/lib/ai/models.ts` 会 `import { getCreditCost } from '@/config/credits'`
> 来填每个模型的 `credits`。~~ **已消解（Phase 9.8.2-C）**：`src/config/credits.ts` 删除，
> `models.ts` 只剩查询机制，模型与它的 `credits` 一起住在产品目录的 `catalogue.ts`。
> 现在 **`src/lib/ai/**` 对产品与积分的 import 数为 0**，
> 而「Provider 引擎文件必须零积分知识」依旧成立（`catalogue.ts` 是纯数据，不含逻辑）。

#### 标准步骤

```
1. 新建 src/lib/ai/providers/<name>.ts

   export class XxxProvider implements AIProvider {
     readonly name = 'xxx'
     readonly modality = 'image'                 // 'image' | 'video' | 'audio' | 'text'
     readonly models = ['flux-kontext-pro', …]   // 本 Provider 支持的 model id

     async generate(request: GenerateRequest): Promise<GenerateResult> { … }

     // 以下全部可选，按需实现：
     async submitTask?(request): Promise<AITaskHandle>       // 异步厂商必须实现
     async getTaskResult?(taskId, model): Promise<AITaskResult>
     async verifyWebhook?(rawBody, headers): Promise<boolean>
     async uploadFile?(file: File): Promise<string>
   }

   实现要点：
   - **厂商映射表（model id → 厂商模型名 / endpoint / LoRA）由调用方注入**：
     引擎暴露一个 `*ModelConfig` 形状（见 `kie.ts` / `wavespeed.ts` / `atlascloud.ts` / `fal.ts`），
     产品侧在 `src/lib/products/<id>/provider-data.ts` 里填表。
     ~~旧写法：映射表写死在 provider 文件里~~ —— 那是产品数据住在 Core（9.8.2-C 搬走）。
     遇到不支持的 model 抛 `"<Name> does not support model \"x\""`
   - **部署参数（`*_API_BASE_URL` / `*_POLL_*`）在函数内读 env，不在模块顶层读**。
     ⚠️ 9.8.2-C 的硬性要求：接缝被每个路由静态 import，模块顶层读 env 会把值
     按「谁先被加载」冻结下来。`verify-ai-core.ts` 仍然先设 env 再动态 import，
     两种写法在测试里都能过，但**只有请求时读取在生产环境里正确**
     （`*_API_KEY` 目前仍在模块顶层读 —— 它是进程级凭据，不随请求变化）
   - 用 ai/utils.ts 的现成工具：pruneUndefined / requireSingleImage /
     requireMultipleImages / **requireContractInputImages** / readParam* / getHeader / sleep
     （`requireContractInputImages(model, request)` 是 Core 的统一入口校验：
     按 `model.requiredInputImages` 决定要不要单图 / 多图，见 §9）
   - 用 normalize.ts 的 normalizeGenerateResult() 做响应归一化，
     不要自己手写 assets 提取
   - 轮询循环自己写（照 kie.ts / wavespeed.ts / atlascloud.ts 的
     `while (Date.now() - startedAt < TIMEOUT)` 模式），共享的只有 sleep()

2. 在**产品目录**里构造实例：`src/lib/products/<id>/provider-data.ts` 填映射表，
   `providers.ts` 里 `new XxxProvider(FLUX_XXX_CONFIG)` 加进 `FLUX_PROVIDERS`。
   Core 的 `src/lib/ai/providers/index.ts` **没有注册表字面量了**，
   它只查绑定后的配置（`getAIProvider` / `listAIProviders` / `listAIProviderNames` / `hasAIProvider`）。

3. 在产品的 `catalogue.ts` 里给相关模型的 `providers` 数组补上 'xxx'
   （模型必须已在该产品的目录里，`credits` 也写同一条记录里 ——
     `bindProductConfig()` 的 `validateProductConfig()` 会在**装配时**检查
     模型 ⇄ Provider 双向映射、缺失成本与空 Provider，任何一项不成立直接抛错）

4. 在 .env.example 的 [CORE] AI Provider 段加 XXX_API_KEY（及可选的
   XXX_API_BASE_URL / XXX_WEBHOOK_SECRET / XXX_POLL_*）
   —— 不加会让 npm run audit:env 的 A 段 FAIL

5. scripts/verify-ai-core.ts —— 9.8.2-D 起**不需要为「跑绿」而改**
   - 它零产品字面量：形状检查遍历 `listAIProviderNames()`，mock 管线的模型 / 成本 /
     Provider 全部从**已绑定的 bundle** 派生
   - mock 只覆盖 base URL 可配的引擎（`atlascloud` / `kie` / `wavespeed`）。
     新厂商**不在**这份引擎能力清单里就没有 mock 覆盖 —— 但门禁不会因此莫名变红；
     只有当产品一个可 mock 的引擎都没用到时，B 段才 **FAIL 并点名原因**
   - 要真正覆盖新引擎：给它加 mock 形状（应答按方法区分，不认产品路径）
   - 产品自己的精确断言（价目数字、渠道商品 id、tier 限额）**不要**写进这里，
     写在 `scripts/verify-<your-product>.ts` 并在头部声明 `// @product-scope <id>`
```

业务代码**一行都不用改**（第 2、3 步改产品目录；第 5 步只是可选的覆盖增强）。

#### 现有 4 家实现的差异（新增时可对照）

| | fal | kie | wavespeed | atlascloud |
|---|---|---|---|---|
| 鉴权 env | `FAL_KEY` | `KIE_API_KEY`（Bearer） | `WAVESPEED_API_KEY`（**同时**发 `Authorization: Bearer` 与 `x-api-key`） | `ATLASCLOUD_API_KEY`（Bearer） |
| `generate()` 策略 | 走 `@/lib/fal-client` 的队列订阅 | 提交 + 轮询 | 先试 `enable_sync_mode: true`，失败再轮询 | 提交 + 轮询 |
| 轮询参数 | fal 队列语义（`IN_QUEUE`/`IN_PROGRESS`/`COMPLETED`/`FAILED`） | `KIE_POLL_INTERVAL_MS`=2000 / `KIE_POLL_TIMEOUT_MS`=50000 | `WAVESPEED_POLL_*`（同默认值） | `ATLASCLOUD_POLL_*` |
| `verifyWebhook` | ❌ 无 | ✅ HMAC-SHA256 **base64** over `${taskId}.${timestamp}`，密钥 `KIE_WEBHOOK_SIGNING_SECRET`，header `x-kie-signature` / `x-kie-timestamp`（或 `x-signature` / `x-timestamp`），`timingSafeEqual` | ✅ Svix 风格：header `webhook-id` / `webhook-timestamp` / `webhook-signature`，HMAC-SHA256 **hex** over `${id}.${ts}.${rawBody}`，密钥 `WAVESPEED_WEBHOOK_SECRET`（自动剥 `whsec_` 前缀），±300s 重放窗口，支持多签名 | ❌ 无 |
| `uploadFile` | ✅ `uploadToFalStorage` | ❌ | ❌ | ❌ |
| 模型数 | 10 | 4（无 `*-multi`） | 6 | 8 |
| 怪癖 | `flux-schnell` 强制 `num_inference_steps: 4`；text-to-image 用 `image_size` 枚举（`aspectRatioToFalImageSize`）；解包 `data` 信封；LoRA 表用于 flux-realism/anime | 入参**同时发 snake_case 与 camelCase** 两种拼写 | `data.outputs` 是 `string[]`，映射成 `{url}` | 状态靠启发式推断（`outputs` 非空 ⇒ `completed`）；发 `enable_base64_output: false`（要 URL 不要 base64）；`safety_tolerance` 字符串→数字；kontext-pro/max 映射到网关名 `black-forest-labs/flux-2-flex|pro` |

> 无 webhook 的 provider（fal / atlascloud）在 `POST /api/webhooks/ai/[provider]` 上：
> 配了密钥但验签失败 → **401**；无验签能力 → **501**。

### 10.2 新增一个模型

9.8.2-C 之后这一步**完全在产品目录里完成，Core 零改动**：

```
1. 在产品的 catalogue.ts 里加一条 ModelDefinition
   （id / modality / label / description? / requiredInputImages /
     defaultProvider / providers / **credits**）
   —— 积分成本就是这条记录上的一个字段，没有第二处要登记
2. 在相关 Provider 的**产品侧映射表**里加一行
   （src/lib/products/<id>/provider-data.ts 的 FLUX_XXX_CONFIG，
     不是 provider 引擎文件本身）
3. 若产品要暴露它：改产品的 action 映射
   （Flux 是 src/lib/products/flux-kontext/actions.ts 的 ACTION_TO_MODEL）
   与 UI 侧选项（src/components/flux-kontext/model-config.ts）
4. npm run verify —— 缺成本 / 缺 Provider 映射 / 模型与 Provider 双向不一致，
   会在 bindProductConfig() 的 validateProductConfig() 里**装配时失败**；
   scripts/verify-product-config.ts 另有 11 个违规样例证明这些断言真的会红
```

> 旧写法要改 3 个 Core 文件（`config/credits.ts` + `ai/models.ts` + provider 引擎里的
> endpoint 表）。那三处现在都是产品数据。

### 10.3 切换 Provider

```
方式一：请求级     { "model": "flux-kontext-pro", "provider": "kie" }
                  → provider 必须在该模型的 providers 数组里，否则抛
                    `Provider "kie" does not support model "…"`
方式二：环境变量   AI_PROVIDER=kie   （旧名 IMAGE_GENERATION_PROVIDER 仍兼容）
                  → 只对「支持该模型」的情况生效；非法值会打一次 console.warn
                    并列出已注册 provider，然后回落到模型的 defaultProvider
方式三：改默认值   改**产品模型目录**里该模型的 defaultProvider
                  （Flux：src/lib/products/flux-kontext/catalogue.ts；9.8.2-C 起 Core 没有这张表）
```

**没有故障转移链，没有静默 fallback。** 解析失败就抛错 —— 这是有意的，
免得「用户以为在用 A，实际跑在 B 上」。

---

## 11. 目录结构

```
src/lib/ai/
├── types.ts                 # 通用类型契约（AIProvider / GenerateRequest / GenerateResult）
├── models.ts                # 模型目录
├── service.ts               # AIService（业务层唯一入口）
├── normalize.ts             # 结果归一化
├── utils.ts                 # 跨 Provider 共用工具
└── providers/
    ├── index.ts             # 注册表（getAIProvider）
    ├── fal.ts               # 10 个模型
    ├── kie.ts               # 4 个模型
    ├── wavespeed.ts         # 6 个模型
    └── atlascloud.ts        # 8 个模型
```

`src/lib/fal-client.ts` 仍是 fal 的 SDK 封装（`@fal-ai/client` 的唯一引入点），
它是 `fal.ts` 的实现细节，不属于 AI Core 的抽象层。

---

## 12. 如何验证

```bash
# 1. 静态契约 + 完整管线（用本地 mock provider，不需要任何真实 Key）
node scripts/run-ts.mjs scripts/verify-ai-core.ts

# 2. HTTP 层契约测试（需要刚重启的 dev server）
npm run dev
SMOKE_SECTION=contract node scripts/smoke-ai-core.mjs

# 3. HTTP 层端到端（需要真实 Supabase + FAL_KEY）
node scripts/smoke-ai-core.mjs
```

`verify-ai-core.ts` 会启动一个本地 mock server，把 `kie` / `wavespeed` / `atlascloud`
指向它，从而真实走完：

```
AIService.generate
  → resolveProvider
  → Provider.buildInput
  → HTTP POST
  → 任务轮询
  → normalizeGenerateResult
  → GenerateResult
```

并断言结果形状、`assets` 可达性、以及「同一模型换 3 家 Provider 业务代码零改动」。
它还有一条**防假绿**断言（B8）：确认 mock server 真的收到了请求，
而不是因为异常被吞掉而「看起来通过」。

> ⚠️ **分清三类验证，不要混淆**：
> - 上面第 1 项（`verify-ai-core.ts`）是**进程内 + 本地 mock HTTP**，
>   在 `npm run verify` 的 19 步之内，**不需要任何真实凭据**。
>   它**不是**生产 E2E。
> - 第 2、3 项（`smoke-ai-core.mjs`）才是真实 HTTP，**需要运行中的 dev server**，
>   第 3 项还需真实 Supabase + 真实 `FAL_KEY`。
>   它们**不在** `npm run verify` 里，凭据缺失时明确打印 SKIPPED（不假装通过）。
>
> 完整区分见 [`MOTHER_TEMPLATE.md` §8.3](./MOTHER_TEMPLATE.md)。
> 跑 smoke 前**必须重启 dev server** —— `src/proxy.ts` 的限流计数器是内存态。

---

## 13. 本阶段的已知边界

| 项 | 状态（2026-09-29 复核） |
|---|---|
| `fal` 无法被 mock（`@fal-ai/client` 的 base URL 不可配） | **仍存在**。`verify-ai-core.ts` 的真实 fal 调用（C 段）只在 `FAL_KEY` 已设且非占位符时执行，否则打印跳过、不判失败；mock 管线（B 段）覆盖 kie / wavespeed / atlascloud（它们的 `*_API_BASE_URL` 可配） |
| 编排逻辑仍在路由里 | ✅ **已解决**（Phase 7）：下沉到 `src/lib/workflow/`，见 §8 |
| `credits` 放在模型定义里 | ✅ **已解决（9.8.2-C 定稿）**：`credits` 是**产品模型目录**（`products/<id>/catalogue.ts`）这条记录上的字段，UI 展示与实扣同源；Core 不再有第二份成本表，`src/config/credits.ts` 已删除 |
| 兼容层 `FluxKontextService` 仍在，待删除 | ✅ **已解决**（Phase 8），但结论与当初设想不同：它**没有被删**，而是**迁到产品层** `src/lib/products/flux-kontext/service.ts`，成为 Flux 产品的正式 Service（不再是「兼容层」）。旧路径 `src/lib/flux-kontext.ts` 已删除 |
| `@fal-ai/client` 仍通过 `src/lib/fal-client.ts` 引入 | **仍存在**。`src/lib/fal-client.ts` 保留为 SDK 封装（`submitFalQueue` / `getFalQueueStatus` / `getFalQueueResult` / `uploadToFalStorage`），由 `src/lib/ai/providers/fal.ts` 使用 |
| 旧 `IMAGE_GENERATION_PROVIDER` 的「非法值警告」丢失 | ✅ **已解决，且原描述有误**：`src/lib/ai/service.ts:168-178` 对非法值会打一次 `console.warn`（并列出已注册的 provider），然后回落到各模型的 `defaultProvider`。**不是静默返回 `fal`** |
| 新增 Provider 必须同步改验证脚本 | ⚠️ **约束（仍在，但已换成显式失败）**：`scripts/verify-ai-core.ts` 的 mock 管线只认「base URL 可配、可以用原生 fetch 打桩」的三家引擎（`atlascloud` / `kie` / `wavespeed`），这是**引擎能力**清单而不是产品数据。新厂商不在里面就没有 mock 覆盖；脚本会**逐家取交集**，交集为空时直接 **FAIL 并打印原因**（「已注册的 Provider 里没有一个能被本脚本 mock —— B 段等于没跑」），不会静默跳过。**9.8.2-D 已解除的根因**：该脚本原先自身 import 产品目录（= 剩余切片 2(d)），现在它只读**已绑定的 bundle**，零产品字面量 —— 换产品后它照跑，证明的是「这个产品接上了通用 AI 机制」 |
