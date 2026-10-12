# Phase 8 Audit — Flux Business Decoupling

> 只读审计（写于改造前）。目标：摸清 Flux 与 Mother Template 基础设施的耦合点，
> 定义边界，再决定迁移与删除。配套：`FLUX_PRODUCT.md`（改造后）、`PHASE_8_FOLLOWUPS.md`。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| Flux 代码总量 | 14 个源文件（API 1 + UI 10 + lib 5），约 4900 行 |
| **基础设施 → Flux 反向依赖** | **3 处**（必须消除）：`services/credits.ts`、`api/ai/image/route.ts`、`workflow/flux-bridge.ts` |
| Flux 专属环境变量 | **0**（代码里无 `FLUX_*` / `FLUX_KONTEXT_*`） |
| Flux 专属 DB 列 | **0**（`ai_tasks.input_metadata.fluxAction` 是 JSON key，非列） |
| Flux 专属 i18n / SEO | 有产品文案（`content/*.json`、`seo/metadata-generator.ts`），属产品层，**不迁移**（避免破坏 UI） |
| Flux UI 是否直连基础设施 | **否**（只 `fetch('/api/flux-kontext')`） |
| AI Core 是否有 Flux 业务分支 | **否**（模型 id 属配置数据；Provider 的 `model → endpoint` 映射属 Provider 内部知识） |

**核心结论**：Flux 的问题不在「扩散」，而在**入口臃肿**——`/api/flux-kontext/route.ts`（892 行）
把 auth / 内容安全 / 积分 / 存储 / Provider 调用 / 状态收尾全塞在一个 handler 里，
且通过 `flux-bridge.ts` 与 Workflow 半接线。本阶段把这坨业务逻辑收敛进
`src/lib/products/flux-kontext/`，并让它走 `WorkflowService`。

---

## 1. Flux 文件清单

### API
| 文件 | 行数 | 职责 |
|---|---|---|
| `src/app/api/flux-kontext/route.ts` | 892 | POST 生成 + PUT 上传（**单体，本阶段拆分**） |

### UI（Flux 专属，**不重写**）
| 文件 | 行数 |
|---|---|
| `src/components/FluxKontextGenerator.tsx` | 1955 |
| `src/components/flux-kontext/*`（9 个） | 1770 |

### lib（Flux 业务）
| 文件 | 行数 | 说明 |
|---|---|---|
| `src/lib/flux-kontext.ts` | 346 | `FluxKontextService` 兼容层（调 `AIService`，非 Workflow） |
| `src/lib/flux-kontext-request.ts` | 176 | `getRequiredCredits` + **通用工具**（IP / Turnstile / verboseLog） |
| `src/lib/flux-kontext-actions.ts` | 37 | `ACTION_TO_MODEL` 映射 |
| `src/lib/image-generation/types.ts` | 132 | `FluxKontext*` 类型 |
| `src/lib/image-generation/utils.ts` | 24 | `isFluxKontextAction` |
| `src/lib/workflow/flux-bridge.ts` | 102 | Phase 7 审计桥接（**删除**） |

---

## 2. 依赖图

### 2.1 谁依赖 Flux

```
app/api/flux-kontext/route.ts ──► flux-kontext.ts, flux-kontext-actions.ts,
                                  flux-kontext-request.ts, image-generation/utils.ts,
                                  workflow/flux-bridge.ts
app/api/ai/image/route.ts ──────► flux-kontext-request.ts   ⚠️ 反向依赖
lib/services/credits.ts ────────► flux-kontext-request.ts   ⚠️ 反向依赖
lib/workflow/flux-bridge.ts ────► db/repositories/ai-task.ts, workflow/logger.ts
components/FluxKontextGenerator.tsx ──► fetch('/api/flux-kontext')  （仅 HTTP，无 import）
```

### 2.2 Flux 依赖谁（方向正确：Flux → 基础设施）

```
flux-kontext.ts ──► ai/service.ts, ai/providers, ai/normalize, storage/service
flux-kontext-request.ts ──► config/credits, flux-kontext-actions
flux-bridge.ts ──► db/repositories/ai-task
```

### 2.3 反向依赖（基础设施 → Flux）—— 必须全部消除

| # | 位置 | 依赖内容 | 违反的边界 |
|---|---|---|---|
| **R1** | `lib/services/credits.ts:3` | `import { getRequiredCredits } from '@/lib/flux-kontext-request'` | Credit → Flux |
| **R2** | `app/api/ai/image/route.ts:20-24` | `import { getClientIpFromHeaders, verifyTurnstileToken, verboseLog } from '@/lib/flux-kontext-request'` | 通用 AI API → Flux |
| **R3** | `lib/workflow/flux-bridge.ts` | 整个文件是 Workflow 层内的 Flux 桥接 | Workflow → Flux |

> R1 的实际使用点在 `consumeCreditsForImageGeneration()`——一个 Flux 专用函数，
> 迁移到 WorkflowService 后即无消费者，可整函数删除 → R1 消失。
> R2 的三个符号其实都是**通用工具**（与 Flux 无关），只是恰好放在了 Flux 文件里 → 迁到通用位置。

---

## 3. 逐项检查（规格 §4 的 20 项）

| # | 对象 | 结论 |
|---|---|---|
| 1 | Flux API | `route.ts` 单体 892 行；auth/安全/积分/存储/Provider 全内联 → **拆分** |
| 2 | Flux UI | 干净，只走 HTTP；**不动** |
| 3 | FluxKontextService | 存在但是「兼容层」：直接调 `AIService`，绕过 Workflow → **重新定位为产品层，改调 WorkflowService** |
| 4 | FluxKontextGenerator | 只 fetch API；**不动** |
| 5 | `flux-kontext.ts` | 见 #3 |
| 6 | `flux-bridge.ts` | Phase 7 审计桥接，仅被 flux route 引用 → **删除** |
| 7 | AIService | 无 Flux 引用 ✅（Flux 单向依赖它） |
| 8 | WorkflowService | 除 `flux-bridge` 外无 Flux 引用 ✅ |
| 9 | AITask | 无 Flux 引用 ✅ |
| 10 | CreditService | `services/credits.ts` 反向依赖（R1）→ **修** |
| 11 | StorageService | 无 Flux 引用 ✅ |
| 12 | Billing | 无 Flux 引用 ✅（`billing/providers/*` 依赖的是 `lib/payment/*`，那是 payment 遗留，非 Flux） |
| 13 | Auth | 无 Flux 引用 ✅ |
| 14 | Admin | 无 Flux 引用 ✅ |
| 15 | Model registry | 只有 `flux-kontext-*` **模型定义**（配置数据），无 `if model === flux` 业务分支 ✅ |
| 16 | Provider registry | 只有 `model → endpoint` 映射（Provider 内部知识）✅；`fal.ts:162` 的 `request.model === 'flux-schnell'` 是 **model 级**参数微调，非 product 级 ✅ |
| 17 | DB Flux 专属字段 | **无**（`input_metadata.fluxAction` 是 JSON key）✅ |
| 18 | 环境变量 | **无 `FLUX_*`** ✅ |
| 19 | i18n Flux 内容 | `content/{generator,home,pricing,seo}.json` 有产品文案 → 属产品层，**不迁移**，记 follow-up |
| 20 | SEO/metadata | `seo/metadata-generator.ts` 有 Flux 文案 → 同上 |

---

## 4. 发现分级

### P0（本阶段必须修）
- **R1 / R2 / R3** 三处反向依赖。
- `/api/flux-kontext` 单体化：业务逻辑未收敛到产品模块，且**未走 Workflow**（积分/存储各自为政）。

### P1（本阶段处理）
- `flux-bridge.ts` 删除。
- `flux-kontext-request.ts` 里混入的通用工具（`getClientIpFromHeaders` / `verifyTurnstileToken` / `verboseLog`）拆出。
- `services/credits.ts` 的 `consumeCreditsForImageGeneration`（Flux 专用）删除。
- `services/credits.ts` 的死导出：`grantUserCredits` / `grantWelcomeCredits` / `getUserCreditHistory`（全项目 0 引用）。

### P2（记入 follow-ups，不在本阶段做）
- 遗留支付簇：`lib/database.ts`（伪 Prisma，9 处引用）、`lib/payment/*`、`lib/payment-security.ts`、`lib/services/payment-database.ts`、`lib/utils/response.ts`（2 个 Phase 4 遗留 admin 路由）。
- i18n / SEO 的 Flux 文案产品化。
- `lib/services/affiliate.ts`（依赖 `lib/database`）。

---

## 5. 目标边界

```
src/lib/
├── ai/            ← 基础设施（不 import Flux）
├── workflow/      ← 基础设施（不 import Flux；删 flux-bridge）
├── storage/       ← 基础设施
├── db/            ← 基础设施
├── billing/       ← 基础设施
├── admin/         ← 基础设施
├── utils/request.ts ← 通用工具（IP / Turnstile），从 Flux 模块拆出
├── services/      ← 遗留服务层（修掉 Flux 依赖；其余记 follow-up）
└── products/
    └── flux-kontext/   ← Flux 业务（唯一允许 import Flux 语义的地方）
        ├── service.ts    FluxKontextService（产品层，调 WorkflowService）
        ├── actions.ts    ACTION_TO_MODEL
        ├── types.ts      FluxKontext* 类型
        └── credits.ts    getRequiredCredits（Flux 价格 → 模型成本）
```

依赖方向：

```
Flux Product ──► WorkflowService ──► AI Core / Credit / Storage
                                        （基础设施全部不知道 Flux）
```

---

## 6. 迁移后 Flux 流程

```
POST /api/flux-kontext
  │  auth + 内容安全 + Turnstile（Flux 产品策略，留在产品层）
  ▼
FluxKontextService.generate()
  │  action → model；构造 Flux parameters
  ▼
WorkflowService.createTask({ model, provider, prompt, inputImages, parameters, waitForResult: true })
  │  建 ai_task → 扣积分 → 提交 Provider → 归一化 → 落 Storage → 结算
  ▼
AITask（completed / failed；失败自动退款）
  │
  ▼
FluxKontextService 映射回旧响应 { success, data:{images}, credits_remaining }
```

**关键点**：用 `waitForResult: true` 走 Phase 7 已有的**同步路径**，
既让 Flux 进入 AITask 基础设施，又**保持前端同步响应不变**（规格 §24：不破坏 UX）。

---

## 7. 第二个产品设计验证（规格 §29）

假设未来增加 **Product B**（例如「视频生成」）。它**只需**：

```
src/lib/products/product-b/
  service.ts      # 把 Product B 的输入翻译成通用 CreateTaskInput
  types.ts
app/api/product-b/route.ts   # Auth → ProductBService → WorkflowService
components/product-b/*       # 自有 UI
```

调用**已有**基础设施：

```ts
import { WorkflowService } from '@/lib/workflow/service'

const { task } = await WorkflowService.createTask({
  userId, model: 'some-video-model', prompt,
  inputImages, parameters,
  waitForResult: false,          // 视频走异步：返回 taskId，前端轮询
})
```

**无需修改**：WorkflowService / AIService / StorageService / CreditService / Billing / Auth / Admin
（前提：新模型在 `ai/models.ts` 注册 + 对应 Provider 实现 `AIProvider`）。

若 Product B 需要「自有价格」→ 在 `products/product-b/credits.ts` 里算，
再传给 `WorkflowService`（价格计算属产品，账本操作属基础设施 —— 见规格 §17）。

**验证结论**：当前架构在 Phase 7 之后已经支持「多产品共享基础设施」，
Phase 8 只需把 Flux 这个**第一个产品**真正落到 `products/` 下，即可证明该边界成立。

---

## 8. 迁移计划（执行顺序）

1. **拆通用工具**：`getClientIpFromHeaders` / `verifyTurnstileToken` / `verboseLog` → `src/lib/utils/request.ts`；更新 `api/ai/image` 与 flux route 的 import。（消 R2）
2. **建产品模块**：`src/lib/products/flux-kontext/{service,actions,types,credits}.ts`，把 Flux 业务搬进去，`FluxKontextService` 改调 `WorkflowService`。
3. **瘦身 route**：`/api/flux-kontext` → Auth → 安全 → `FluxKontextService.generate()` → 响应。
4. **删 bridge**：`flux-bridge.ts`（迁移后无引用）。
5. **修 R1**：`services/credits.ts` 删 `consumeCreditsForImageGeneration`（+ 死导出）。
6. **旧文件处理**：`lib/flux-kontext.ts` / `flux-kontext-actions.ts` / `flux-kontext-request.ts` / `lib/image-generation/*` 变为转发或删除（逐文件 grep 绝对 + 相对引用）。
7. **架构守卫脚本** + 全量验证 + 文档。

> 清理原则（规格 §30）：删除必须满足「无引用 / 无历史数据依赖 / 无兼容 API 依赖 / 已有新路径 / 测试通过」，
> 否则记入 `PHASE_8_FOLLOWUPS.md`。
