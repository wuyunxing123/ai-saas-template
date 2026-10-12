# Flux Kontext —— 第一个产品模块

> Phase 8 交付文档。Flux 从「系统核心」降级为「Mother Template 之上的一个产品」。
> 配套：`PHASE_8_AUDIT.md`（改造前审计）、`PHASE_8_FOLLOWUPS.md`、`WORKFLOW.md`、
> `REFACTOR_DECISIONS.md`（D-43 ~ D-50）。

---

## 1. Flux 的职责

Flux Kontext 是**产品层（product / business layer）**，只负责「Flux 这个产品」的语义：

**负责**
- Flux 专属请求解析与校验（`action` 词表）
- Flux 专属参数（`aspect_ratio` / `guidance_scale` / `safety_tolerance` / `output_format` / `seed` …）
- Flux 专属 UI（`FluxKontextGenerator.tsx` + `components/flux-kontext/*`）
- `action → model` 映射（产品词表 → AI Core 词表）
- Flux 价格计算（action → 需要多少积分）
- Flux 兼容 API（`/api/flux-kontext` 的响应格式）
- Flux 产品策略（内容安全、Turnstile 人机校验）
- **（9.8.2-C 起）Flux 的产品数据**：模型目录、每个模型的积分成本、Provider 的
  模型 id / 端点 / LoRA 映射、套餐与支付渠道商品 id、档位与能力（可用模型 / 宽高比）、
  产品文案 —— 全部在 `src/lib/products/flux-kontext/`，Core 只提供形状与查询机制

**不负责**（这些是基础设施的职责，Flux 只能调用）
- 积分账本操作（扣费 / 退款）
- R2 / S3 SDK 直连
- 支付 / 结算
- 用户认证实现
- Provider **调用机制** / Task 状态机 / Workflow 编排 / Storage 抽象
  （⚠️ 9.8.2-C 起本行收窄：**数据**归产品，**机制**归 Core ——
   模型目录、每个模型的积分、Provider 的模型 id 与端点映射、套餐与渠道商品 id、
   档位与能力都是 Flux 的数据，住在 `src/lib/products/flux-kontext/`；
   Flux 不实现的是「怎么调 fal / 怎么扣积分 / 怎么编排重试」这套机制）

> 一句话：**Flux 只能调用基础设施，不能反过来让基础设施知道 Flux。**

---

## 2. Flux API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/flux-kontext` | 生成（兼容旧链路，**同步返回**结果） |
| PUT | `/api/flux-kontext` | 输入图片上传（返回 `{ success, url }`） |

`POST` 的 handler 现在**很薄**（规格 §12）：

```
Auth（session.user.id）
  ↓
Flux 产品策略：参数校验 / 内容安全 / Turnstile / 余额预检
  ↓
FluxKontextService.generate()          ← 产品层
  ↓
WorkflowService.createTask({ waitForResult: true })
  ↓
Flux 兼容响应 { success, provider, data:{images}, credits_remaining, safety_check }
```

**已移出 route**：Provider 选择、积分扣减/退款、R2 转存、结果归一化、Task 状态机。

---

## 3. Flux UI

`src/components/FluxKontextGenerator.tsx`（1955 行）+ `src/components/flux-kontext/*`（9 文件）。

- **只通过 HTTP 调用 `/api/flux-kontext`**，不直连任何基础设施（Phase 8 审计确认）。
- 因此 UI **未做任何修改**（规格 §11 / §2：不重写 UI）。
- 读取的字段保持兼容：`data.images[].url` / `.r2_url` / `.fal_url`。

---

## 4. Flux Service

`src/lib/products/flux-kontext/`：

| 文件 | 职责 |
|---|---|
| `service.ts` | `FluxKontextService` —— 产品服务（调 WorkflowService） |
| `actions.ts` | `ACTION_TO_MODEL` + `actionToModelId` + `isFluxKontextAction` |
| `types.ts` | `FluxKontext*` 领域类型 |
| `credits.ts` | `getRequiredCredits(action)` —— Flux 价格计算（读模型目录的 `credits`） |
| `catalogue.ts` ★ | **模型目录 + 每个模型的积分成本**（9.8.2-C 从 Core 的 `ai/models.ts` / `config/credits.ts` 搬来；纯数据，客户端可直接 import 显示成本） |
| `provider-data.ts` / `providers.ts` ★ | Flux 可用的 Provider 实例与其**模型 id / 端点 / LoRA 映射**（数据；调用机制仍在 `src/lib/ai/providers/*`） |
| `billing.ts` ★ | 7 个付费套餐 + 免费档，含**支付渠道商品 id** |
| `tiers.ts` / `capabilities.ts` ★ | 档位与产品能力（可用模型、宽高比）—— 原 Core 的 `src/lib/user-tiers.ts` |
| `config.ts` ★ | 把上面四块拼成 `ProductConfig`，交给 `src/app/product-runtime.ts` 绑定 |
| `content/` | 产品文案（`pricing.json`、`seo.json` 等，经 `src/app/product-content.ts` 装配） |
| `index.ts` | 模块入口 |

★ = Phase 9.8.2-C 新增/迁入。**换产品时这些文件整体替换，Core 不动。**

关键方法：

```ts
FluxKontextService.generate(params)   // 生成 → WorkflowService（同步路径）
FluxKontextService.toLegacyResult(task) // AITask → Flux 兼容结果
FluxKontextService.uploadFile(file, userId) // 输入上传
FluxKontextService.isValidAction(action)
```

> ⚠️ 原先的 `FluxKontextService.getProviderName()` **已删除**（Phase 9.8.2-C）：
> 它在产品层读 `AI_PROVIDER` 并在认不出时硬回退到 `'fal'`，等于把 Provider 选择实现了两遍。
> 现在产品**不指定 Provider**，由 Core 的 `AIService.resolveProvider()` 按
> 「`request.provider`（必须在 `model.providers` 内，否则抛错）→ `AI_PROVIDER` /
> `IMAGE_GENERATION_PROVIDER` → `model.defaultProvider`」解析；env 值非法时打一次 warn
> 后落到该模型的 `defaultProvider`（与 9.8.2-C 之前一致，未改行为）。

---

## 5. Workflow 如何调用

```ts
const { task } = await WorkflowService.createTask({
  userId,
  model,                 // action → model（产品层已翻译）
                         // 不传 provider：由 Core 解析（见 §4 的说明）
  prompt,
  inputImages,           // image_url / image_urls → 统一 inputImages
  parameters,            // Flux 参数 → 通用 parameters
  waitForResult: true,   // 同步：保持「一次请求拿到结果」的前端体验
})
```

- `waitForResult: true` 走 Phase 7 的**同步路径**：内部完成
  「建 ai_task → 扣积分 → 提交 Provider → 归一化 → 落 Storage → 结算」，失败自动退款。
- 若未来 Flux 要改异步（长视频等），只需去掉 `waitForResult`，前端改为轮询
  `GET /api/ai/tasks/:id`（Task Center 已具备）。

---

## 6. Model 如何选择

`ACTION_TO_MODEL`（`actions.ts`）是唯一转换表：

| Flux action | model id |
|---|---|
| `text-to-image-pro` | `flux-kontext-pro` |
| `text-to-image-max` | `flux-kontext-max` |
| `text-to-image-schnell` | `flux-schnell` |
| `text-to-image-dev` | `flux-dev` |
| `text-to-image-realism` | `flux-realism` |
| `text-to-image-anime` | `flux-anime` |
| `edit-image-pro` | `flux-kontext-pro-edit` |
| `edit-image-max` | `flux-kontext-max-edit` |
| `edit-multi-image-pro` | `flux-kontext-pro-multi` |
| `edit-multi-image-max` | `flux-kontext-max-multi` |

模型本身定义在 `src/lib/ai/models.ts`（**AI Core 的配置数据**，与产品无关）；
Provider 的 `model → endpoint` 映射在 `src/lib/ai/providers/*`（Provider 内部知识）。
AI Core **不知道 Flux**。

---

## 7. Credit 如何计算

- **价格计算属产品层**：`products/flux-kontext/credits.ts` 的 `getRequiredCredits(action)`。
- 价格真相是产品模型目录的 **`credits`** 字段（`products/flux-kontext/catalogue.ts`）。
  ~~旧写法：`src/config/credits.ts` 的 `CREDIT_COSTS`，产品层只做适配~~ —— 那份 Core 里的表
  键全是 `flux-*`，本来就是产品数据，**9.8.2-C 已随文件删除搬进目录**。
  UI 展示与 `WorkflowService` 实扣读同一个字段，「两处价格靠人工一致」从结构上消失。
  未知 action / 未登记成本**抛错**，不再回退到 15 积分。
- **账本操作属基础设施**：真正的扣费 / 退款由 `WorkflowService` → `settlement.ts`
  → 原子 RPC（`consume_credits` / `grant_credits`）完成，Flux **不碰** `users.credits`。
- 失败 / 超时自动退款（幂等键 `task:<id>:refund`），Flux 无需自己写退款逻辑。

---

## 8. Storage 如何保存

- Flux **不直接**调 R2 / S3。
- 生成结果的落盘由 `WorkflowService` → `workflow/storage.ts` → `StorageService` 完成
  （object key 规范 `generated/{userId}/…`，Phase 5 定义）。
- Flux 只在响应里把「Provider 原始 URL」与「Storage URL」都暴露给前端（`url` / `fal_url` / `r2_url`），保持旧行为。
- Flux 的**输入**上传（`PUT /api/flux-kontext`）走 `StorageService.uploadFile`（`uploads/` namespace），
  这属于产品层的输入处理，方向仍是 Flux → 基础设施。

---

## 9. Flux 与 Mother Template 的依赖方向

```
                    ┌──────────────────────────┐
                    │  Flux Product            │
                    │  products/flux-kontext/* │
                    └────────────┬─────────────┘
                                 │  只能向下调用
                                 ▼
                    ┌──────────────────────────┐
                    │  WorkflowService         │
                    └────────────┬─────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
   AI Core                  Credit                   Storage
   (AIService)              (settlement)             (StorageService)
        ▼
   AIProvider (fal/kie/wavespeed/atlascloud)
```

**铁律（规格 §25 / §26）**：

| 方向 | 允许？ |
|---|---|
| Flux → AI / Workflow / Credit / Storage / Auth / Billing / Admin / DB | ✅ |
| AI / Workflow / Credit / Storage / Billing / Auth / Admin / DB → Flux | ❌ **禁止** |

由 `scripts/audit-architecture.mjs`（`npm run audit:architecture`）静态守卫，违反即退出码 1。

---

## 10. 如何未来加入第二个 AI Product

**不要改核心基础设施。** 新增一个产品只需：

```
src/lib/products/product-b/
  service.ts     # 把 Product B 输入翻译成通用 CreateTaskInput
  types.ts
app/api/product-b/route.ts        # Auth → ProductBService → WorkflowService
components/product-b/*            # 自有 UI（只调自己的 API）
```

```ts
// products/product-b/service.ts
import { WorkflowService } from '@/lib/workflow/service'

const { task } = await WorkflowService.createTask({
  userId, model: 'some-model', prompt, inputImages, parameters,
  waitForResult: false,   // 异步：返回 taskId，前端轮询 GET /api/ai/tasks/:id
})
```

**需要改的**：
- 在 `src/lib/ai/models.ts` 注册新模型（配置数据）
- 若用新 Provider，实现 `AIProvider` 并在 `providers/index.ts` 注册

**不需要改的**：WorkflowService / AIService / StorageService / CreditService /
Billing / Auth / Admin / DB schema。

> Flux 就是「第一个产品」的样板。它的边界一旦成立，第二个产品只是复制这个形状。
