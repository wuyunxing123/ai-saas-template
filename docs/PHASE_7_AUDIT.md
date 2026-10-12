# PHASE_7_AUDIT.md — Workflow / Async Task Engine 架构审计

> 审计时间：2026-09-25
> checkpoint：`phase-7-before-workflow` → `文档对账`（工作区干净）
> 目的：在动手之前把现状摸清楚。**本文件只描述现状，不做重构决策。**

---

## 结论速览

Phase 7 **不是从零建** —— 基础设施大部分已经存在，缺的是**接线与编排层**。

| 能力 | 是否已存在 | 位置 | 备注 |
|---|---|---|---|
| `ai_tasks` 表 | ✅ 存在 | 迁移 `0004_ai_tasks.sql` | 含 RLS、索引、状态 CHECK、幂等唯一索引 |
| `AITaskRepository` | ✅ 存在 | `src/lib/db/repositories/ai-task.ts` | 已有 create / findById / findByProviderTaskId / findByIdempotencyKey / updateStatus / fail / listAll / count / listByUser |
| Provider 异步接口 | ✅ 存在 | `src/lib/ai/types.ts` | `submitTask?` / `getTaskResult?` / `verifyWebhook?` |
| 4 个 Provider 的 submitTask/getTaskResult | ✅ 均已实现 | `src/lib/ai/providers/*` | fal / kie / wavespeed / atlascloud |
| `AIService.submitTask/getTaskResult/verifyWebhook` | ✅ 存在 | `src/lib/ai/service.ts` | 可直接复用 |
| Admin AI Task 查看 | ✅ 存在 | `/admin/ai-tasks` + `/api/admin/ai-tasks` | 走 `AdminService.listAiTasks()` |
| Auth 取 user.id | ✅ 存在 | `src/lib/auth-session.ts` | `getCurrentUser()`，id 优先 |
| Credit 原子 RPC | ✅ 存在 | 迁移 0005 / 0006 | `consume_credits()` / `grant_credits()` |
| StorageService | ✅ 存在 | `src/lib/storage/service.ts` | `uploadFromUrl()` 已用于转存 |
| **任务接口层（Service）** | ❌ **缺** | — | 无 `WorkflowService` / `AITaskService` |
| **状态机（受控转换）** | ❌ **缺** | — | Repository 只有 `updateStatus()`，无合法性校验 |
| **任务写入 ai_tasks** | ❌ **缺** | — | **全项目零写入**，表是空的 |
| **POST /api/ai/tasks** | ❌ **缺** | — | 只有 `/api/ai/image`（同步阻塞） |
| **AI webhook 路由** | ❌ **缺** | — | 只有 billing webhook |
| **Polling 服务** | ❌ **缺** | — | 无 |
| **Task 级 Retry** | ❌ **缺** | — | 无 |
| **用户任务中心 UI** | ❌ **缺** | — | 无 |

---

## 1. 当前 `AIService.generate()` 的完整调用链

以 `POST /api/ai/image` 为例（`src/app/api/ai/image/route.ts`）：

```
POST /api/ai/image
  ↓
① parseImageRequest()        校验 model / prompt / inputImages / parameters
  ↓                          （model 非法 → 400；modality 不匹配 → 400）
② getSessionIdentity()       未登录 → 401
  ↓
③ getCurrentUser()           用户不存在 → 404
  ↓
④ verifyTurnstileIfEnabled() human check（可选，已登录默认放行）
  ↓
⑤ checkUserCredits()         余额不足 → 402
  ↓
⑥ consumeUserCredits()       ★ 原子扣费（RPC consume_credits）
  ↓                          chargeReferenceId = `ai_image_${ts}_${userId.slice(0,8)}`
⑦ AIService.generate()
     ↓ resolveProvider()     request.provider → AI_PROVIDER env → model.defaultProvider
     ↓ provider.generate()   fal / kie / wavespeed / atlascloud
  ↓
⑧ persistToStorage()         StorageService.uploadFromUrl(url, { userId, namespace: 'generated' })
  ↓
⑨ 返回 { success, data, credits_remaining, duration }
```

**失败路径**：`catch` → `grantCredits()` 退款
（`idempotency_key = ${chargeReferenceId}_refund`）。

**关键观察**：

- 步骤 ⑦ `AIService.generate()` 是**阻塞**的 —— `maxDuration = 60`（Vercel 上限）。
  对 `kie` / `atlascloud` 这类 Provider，`generate()` 内部是
  **submitTask + 循环轮询**（见 `kie.ts:57-61`、`atlascloud.ts:86-90`），
  所以整个 HTTP 请求要等到生成完成。
- **全程没有写 `ai_tasks`** —— 没有任务记录，就无法：
  查历史、追溯失败退款、按 provider_task_id 接收 webhook。

旧链路 `POST /api/flux-kontext` 结构类似，但用 `action`（产品动作）
而非 `model`，且多一层 `FluxKontextService` 兼容层。

---

## 2. 当前 AIProvider 是否支持同步 / 异步 / webhook 校验

`src/lib/ai/types.ts` 的 `AIProvider` 接口：

```ts
interface AIProvider {
  readonly name: AIProviderName
  readonly modality: AIModality
  readonly models: readonly string[]

  generate(request): Promise<GenerateResult>        // 必需
  uploadFile?(file): Promise<string>                // 可选
  submitTask?(request): Promise<AITaskHandle>       // 可选
  getTaskResult?(taskId, model): Promise<AITaskResult>  // 可选
  verifyWebhook?(rawBody, headers): Promise<boolean>    // 可选
}
```

实际实现矩阵：

| Provider | generate | uploadFile | submitTask | getTaskResult | verifyWebhook |
|---|---|---|---|---|---|
| `fal` | ✅ | ✅ | ✅ | ✅ | ❌ **未实现** |
| `kie` | ✅（= submit + 内部轮询） | ❌ | ✅ | ✅ | ✅ |
| `wavespeed` | ✅ | ❌ | ✅ | ✅ | ✅ |
| `atlascloud` | ✅（= submit + 内部轮询） | ❌ | ✅ | ✅ | ❌ **未实现** |

**结论**：异步能力**接口已有、实现已有**，`AIService` 已封装
`submitTask` / `getTaskResult` / `verifyWebhook`。
按规格 §10，**直接复用，不重新发明第二套抽象**。

**缺口**：`fal` 与 `atlascloud` 无 `verifyWebhook`。
按规格 §28 —— 不伪造签名校验，明确记录 `verification unavailable`。

---

## 3. 当前 Provider 是否已经存在异步 API

**是。** `AIService` 已有：

- `submitTask(request)` → `AITaskHandle { provider, taskId, raw }`
- `getTaskResult(taskId, model, providerName?)` → `AITaskResult`
- `verifyWebhook(providerName, rawBody, headers)` → `boolean`

其中 `AIService.verifyWebhook()` 在 Provider 未实现时**返回 `false`**（不是抛错），
这点在 Phase 7 设计 webhook 时要明确区分「校验失败」与「该 Provider 不支持校验」。

---

## 4. 当前 `GenerateResult` 是否足以表达异步任务

基本够用，但语义分散：

```ts
interface GenerateResult {
  assets: GeneratedAsset[]
  provider: AIProviderName
  model: string
  taskId?: string        // 异步任务的 task id；同步生成为 undefined
  seed?: number
  raw?: unknown
}

type AITaskState = 'queued' | 'processing' | 'completed' | 'failed'

interface AITaskHandle { provider; taskId; raw? }
interface AITaskResult {
  provider; taskId
  state: AITaskState
  result?: GenerateResult   // 仅 completed
  error?: string            // 仅 failed
  raw?: unknown
}
```

**够用的地方**：`taskId` + `AITaskState` + `AITaskResult` 三件套已能表达异步生命周期。

**不足的地方**：
- `AITaskState` 用 `queued/processing/completed/failed`，
  而 `ai_tasks.status` 用 `pending/processing/completed/failed/cancelled`
  —— **词表不一致**，需要一个映射层（Repository 注释里已经写了映射关系）。
- 没有「统一 Task Result」结构。规格 §20 要求
  `{ assets: [{ type, url, mimeType }], metadata }`，
  目前只有 `GeneratedAsset[]`（含 `url` / `width` / `height` / `contentType`）。
  缺 `type`（image/video/audio）与 `mimeType` 的显式字段，
  未来接视频 Provider 时无法区分。**Phase 7 需要在 Result 归一化时补上。**

---

## 5. 当前数据库是否已经有 AI task / generation 表

**有 `ai_tasks`**（迁移 `0004_ai_tasks.sql`），字段：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → users | ON DELETE CASCADE |
| `model` | VARCHAR NOT NULL | |
| `provider` | VARCHAR NOT NULL | |
| `status` | VARCHAR DEFAULT 'pending' | CHECK: pending/processing/completed/failed/cancelled |
| `prompt` | TEXT | |
| `input_metadata` | JSONB | 例如 `{ inputImages, parameters }` |
| `output_metadata` | JSONB | 例如 `{ assets: [...] }` |
| `provider_task_id` | VARCHAR | |
| `idempotency_key` | VARCHAR | |
| `credit_transaction_id` | UUID FK → credit_transactions | 用于失败退款追溯 |
| `credits_used` | INTEGER | |
| `error_code` / `error_message` | VARCHAR / TEXT | |
| `created_at` / `updated_at` / `completed_at` | TIMESTAMPTZ | |

索引：
- `idx_ai_tasks_user_created` (user_id, created_at DESC)
- `idx_ai_tasks_status`
- `idx_ai_tasks_provider_task` (provider, provider_task_id)
- `idx_ai_tasks_credit_transaction`
- `uniq_ai_tasks_idempotency` **UNIQUE (user_id, idempotency_key) WHERE NOT NULL**

RLS：已开启；策略「Users can view own ai tasks」（SELECT）、
「Users can insert own ai tasks」（INSERT）。**无 UPDATE 策略** ——
服务端写入走 service_role，符合规格 §27。

另有 `generations` 表，已被 0004 标记 **DEPRECATED**（仅回填，不再写入）。

**⚠️ 关键事实**：`ai_tasks` **全项目零写入** —— 只有
`src/lib/db/repositories/ai-task.ts` 自身引用它。
所以 `/admin/ai-tasks` 目前永远是空列表。

**相对规格 §5 缺失的字段**：
- `retry_count`（规格 §17 要求）
- `started_at`（规格 §5 建议）
- `credits_refunded`（规格 §18 要求能追溯是否已退款）

> 注：规格建议 `credits_reserved` / `credits_charged` 两列。
> 当前只有 `credits_used` 一列。由于现有 credit 模型是
> **创建即扣费（consume）** 而非 reserve→settle，
> 是否真的需要 reserve 列取决于 §18 的选型 —— 见下文第 6 问与后续设计。

---

## 6. 当前 credit 扣减发生在哪里

**两处**，都是「生成前一次性扣满」：

| 路由 | 位置 | 函数 | 幂等键 |
|---|---|---|---|
| `POST /api/ai/image` | route.ts:105-118 | `consumeUserCredits()` | `referenceId` = `ai_image_${ts}_${uid8}` |
| `POST /api/flux-kontext` | route.ts ~210 | `consumeCreditsForImageGeneration()` | `image_gen_${Date.now()}` |

两者最终都走 `credit.consumeCredits()` → 原子 RPC `consume_credits()`（迁移 0005）。

**选型判断（规格 §18）**：
当前是 **「创建任务时扣费（consume）」**，不是 reserve→settle。
规格说「不要重新发明 credit 系统」，并推荐 consume 在前、失败 refund。
**因此 Phase 7 沿用现有 consume 语义**，不引入 reserve 列 ——
这样 `credits_used` 一直是「已扣」，失败时用 refund 冲回，
`credit_transaction_id` 保留原扣费流水用于追溯。

需要新增的是：**退款也要能被追溯**（见第 7 问）。

---

## 7. 当前失败退款发生在哪里

| 路由 | 位置 | 实现 | 幂等 |
|---|---|---|---|
| `POST /api/ai/image` | catch 块 | `grantCredits()` | `idempotency_key = ${chargeReferenceId}_refund` ✅ |
| `POST /api/flux-kontext` | `refundCreditsOnce()` | `grantCredits()` | `refundContext.idempotencyKey`（请求级唯一）✅ |

两处都已是**原子 RPC + 幂等键**（B-10 修复后的成果）。

**缺口**：
- 失败退款**没有回写 `ai_tasks`** —— 因为本来就没有任务记录。
- 没有 `credits_refunded` 字段，无法从任务行直接看出「已退款」。
- 「Provider submit 成功但后续 task 失败」这条路径**目前不存在**
  （因为当前是同步阻塞调用），Phase 7 引入异步后**必须**能覆盖它 ——
  这正是规格 §18 特别强调的场景。

---

## 8. 当前 Storage 保存生成结果发生在哪里

`POST /api/ai/image` 的 `persistToStorage()`（route.ts:359-385）：

```ts
StorageService.uploadFromUrl(asset.url, {
  userId,
  namespace: 'generated',
  metadata: { prompt: prompt.substring(0, 500) },
})
// → { ...asset, url: stored.url, sourceUrl: asset.url, key: stored.key }
```

- 只在 `StorageService.isConfigured()` 为真时执行
- 单个 asset 失败 → 保留 Provider 原始 URL（降级，不整体失败）

`StorageService` 提供：`upload()` / `uploadFromUrl()` / `uploadFile()` / `getUrl()` / `delete()` / `isConfigured()`。

**符合要求**：规格 §21 要求 Workflow → StorageService → StorageProvider → R2，
禁止 Workflow 直接调 SDK。现有 `uploadFromUrl()` 可直接复用。

---

## 9. 当前 Auth 如何取得 user.id

`src/lib/auth-session.ts`（F-1 后的统一入口）：

```ts
getSessionIdentity()  // 不查库，返回 { id, email, name, image }
getCurrentUser()      // userRepo.findById(session.user.id)，id 为空时退回 findByEmail(email)
getCurrentUserId()
```

`session.user.id` 由 Phase 6 注入（D-17）。email 兜底是为了兼容
Phase 6 之前签发的 JWT（那时没有 `user.id`）。

**Phase 7 的 API 一律用 `getCurrentUser()`，绝不相信客户端传的 userId**（规格 §12/§14）。

---

## 10. 当前 Admin 是否已经能够查看 AI Task

**能，但列表是空的。**

- 页面：`/admin/ai-tasks`（`src/app/admin/ai-tasks/page.tsx`）
- API：`GET /api/admin/ai-tasks` 与 `GET /api/admin/ai-tasks/[id]`
- 服务：`AdminService.listAiTasks()` → `aiTaskRepo.listAll()` / `count()`
- 过滤：provider / model / status + 分页

因为 `ai_tasks` 从未写入，这些页面目前显示空。
**Phase 7 只要开始写 `ai_tasks`，Admin 立刻就有数据**（规格 §23：不重新设计 Admin）。

---

## 11. 当前是否已有 webhook route

**支付有，AI 没有。**

| 路由 | 状态 |
|---|---|
| `POST /api/billing/webhook/[provider]` | ✅ Phase 4 新建（新链路） |
| `POST /api/webhooks/payments` | 遗留（Phase 4 委托给 BillingService） |
| `POST /api/webhooks/stripe` | 遗留 |
| **`POST /api/webhooks/ai/[provider]`** | ❌ **不存在 —— Phase 7 需新建** |

可复用的幂等模式：`src/lib/db/repositories/webhook-event.ts` 的 `claim()` ——
插入 `webhook_events(provider, event_id)`，撞唯一约束（23505）即视为已处理，
返回 `{ claimed: false }`。这正是规格 §15 要求的幂等语义。

---

## 12. 当前是否已有 polling / retry 逻辑

**任务级：完全没有。**

- 无 `TaskPollingService`
- 无 `pollTask()` / `pollRunningTasks()`
- 无 `retry_count` / `last_error` / 重试上限
- 唯一的 retry 是 `src/lib/flux-kontext-request.ts:64` 的
  **Turnstile HTTP 请求重试**（`maxRetries = 3`，5xx 退避），与任务无关

**Provider 内部有轮询**（但不暴露给业务层）：
- `kie.ts:57-61` — `generate()` = submitTask + `getTaskResult()` 循环
- `atlascloud.ts:86-90` — 同上

这正是规格 §13 要解决的问题：业务层目前只能「等 Provider 完成」，
无法「提交后立刻返回 taskId」。

---

## 边界约束（来自前序阶段，Phase 7 必须遵守）

| 约束 | 来源 |
|---|---|
| 业务层禁止直接 import `@/lib/ai/providers/*` | Phase 2 |
| `src/lib/ai/` 内不得出现产品名（模型 id 字符串除外） | Phase 2 |
| Repository 输入参数镜像列名（snake_case） | Phase 3 |
| 消费积分只能用 `credit.consumeCredits()`（原子 RPC） | Phase 3.5 |
| 退款必须走 `grantCredits()` + `idempotency_key` | B-10 / 修复批次 |
| 积分成本唯一真相 `src/config/credits.ts` | B-12 |
| Workflow 禁止直接调 S3 / R2 SDK，必须过 StorageService | Phase 5 |
| Admin 页面禁止直接访问数据库 | Phase 6.5 |
| **不要删除 `FluxKontextService` / `/api/flux-kontext`** | 规格 §25（Phase 8 才解耦） |
| 禁止引入 Temporal / Kafka / BullMQ / Redis Queue 等 | 规格 §32 |

---

## 审计后确定的 Phase 7 工作范围

1. **新建 `src/lib/workflow/`** —— Task domain model + 状态机 + WorkflowService
2. **扩展 `ai_tasks` 表**（新迁移 `0009`）—— 加 `retry_count` / `started_at` / `credits_refunded`
3. **扩展 `AITaskRepository`** —— 加 `transitionStatus()`（带合法性校验）、`findByUserId()`、`findRunningTasks()`、`findRetryableTasks()`、`update()`
4. **新建 `POST /api/ai/tasks`** —— 创建任务，异步 Provider 立即返回
5. **新建 `GET /api/ai/tasks` 与 `GET /api/ai/tasks/:id`** —— 强制按 `session.user.id` 收窄
6. **新建 `POST /api/webhooks/ai/[provider]`** —— 签名校验 + 幂等 + 状态推进
7. **新建 `TaskPollingService`** —— `pollTask()` / `pollRunningTasks()`
8. **Result 归一化** —— 统一 `{ assets: [{ type, url, mimeType, ... }], metadata }`
9. **Credit 生命周期** —— 成功不额外扣、失败/超时 refund（幂等）
10. **接线 Admin** —— 现有 `/admin/ai-tasks` 自动获得数据
11. **用户任务中心 UI** —— 最小列表 + 详情
12. **结构化日志** —— `task.created` / `task.submitted` / … 不含 prompt / token
13. **验证脚本 + 文档** —— `verify-workflow.ts`、`docs/WORKFLOW.md`、`docs/PHASE_7_FOLLOWUPS.md`

**不做**：Flux 解耦、重写 Provider、重写 Storage/Billing/Credit、引入消息队列。
