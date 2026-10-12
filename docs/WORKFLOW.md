# Workflow / Async Task Engine

> Phase 7 交付文档。配套：`PHASE_7_AUDIT.md`（改造前审计）、`PHASE_7_FOLLOWUPS.md`（未决事项）、
> `REFACTOR_DECISIONS.md`（D-34 ~ D-42）。

本阶段在现有 **AI Core**（Phase 2）之上，建立统一的 **持久化 AI Task + 状态机 +
Provider 异步任务生命周期**。目标不是 Workflow Engine，而是一套最小可扩展的基础设施，
让「提交一个 AI 任务 → 异步完成 → 落 Storage → 结算积分」成为一等公民。

---

## 1. 架构

```
User
  │  POST /api/ai/tasks   (auth + 校验 + 不阻塞)
  ▼
API 层 (app/api/ai/tasks, app/api/webhooks/ai/[provider])
  │
  ▼
WorkflowService  (src/lib/workflow/service.ts)   ← 唯一编排者
  ├─ AITaskRepository   (src/lib/db/repositories/ai-task.ts)  ← 只管 DB
  ├─ AIService          (src/lib/ai/service.ts)             → AIProvider（同步/异步）
  ├─ settlement.ts      (src/lib/workflow/settlement.ts)   → credit RPC（原子+幂等）
  ├─ storage.ts         (src/lib/workflow/storage.ts)      → StorageService（不碰 R2 SDK）
  └─ state-machine.ts   (src/lib/workflow/state-machine.ts)← 集中管理状态转换
  │
  ▼
ai_tasks 表 (supabase/migrations/0004 + 0009)
```

分层铁律（规格 §7 / §22 / §21）：

- **业务层**只依赖领域对象 `AITask`（`src/lib/workflow/types.ts`），不直接接触 `AiTaskRow`。
- **Repository** 只做数据操作，不调 Provider、不扣积分、不决定状态能不能改。
- **状态推进**只走 `transitionStatus()`，禁止任何地方 `UPDATE status = ...`。
- **Workflow** 依赖 `AIService`，但 `AIProvider` 不反向依赖 Workflow。
- **Workflow** 经 `StorageService` 落盘，绝不直接调 S3 / R2 SDK。

---

## 2. AITask 生命周期

```
            createTask()
                │
                ▼
   ┌──────────────────────────┐
   │        pending            │  (已建行 + 已扣积分，尚未提交 Provider)
   └──────────────────────────┘
                │ submitTask()
                ▼
   ┌──────────────────────────┐
   │      processing           │  (已提交 Provider，拿到 provider_task_id)
   └──────────────────────────┘
        │              │
   webhook/poll    (可重试错误)
   成功             retry_count < max
        │              │
        ▼              ▼
   completed      processing (retry) ── 耗尽重试 ──▶ failed
        │
        │ (失败 / 超时)
        ▼
      failed  ─── refundTask() ──▶ 退款（幂等键 task:<id>:refund）
```

同步 Provider（`waitForResult:true`）会在 `createTask()` 内走完
`pending → processing → completed`，请求返回即带结果，不依赖 webhook/polling。

---

## 3. 状态机（src/lib/workflow/state-machine.ts）

状态词表（与 `ai_tasks.status` 的 CHECK 约束**完全一致**，不另建第二套）：

| 状态 | 语义 | 规格别名 |
|---|---|---|
| `pending` | 已建行、已扣积分，待提交 | CREATED |
| `processing` | 已提交 Provider，等待结果 | RUNNING |
| `completed` | 成功，结果已落 Storage | COMPLETED |
| `failed` | 终态失败（已退款） | FAILED |
| `cancelled` | 已取消（保留位，本期无取消入口） | CANCELLED |

合法转换（其余一律抛 `InvalidTaskTransitionError`）：

```
pending    → processing, failed, cancelled
processing → processing (重试), completed, failed, cancelled
completed  → (无)
failed     → (无)
cancelled  → (无)
```

- `processing → processing` 是**显式允许**的重试语义（任务仍在活跃态，只是 `retry_count+1` 后重提交）。
- `transitionStatus()` 对「已是目标状态」的请求**幂等短路**（返回 `changed:false`），这是
  webhook 重复触发的核心保障。
- 终态自动写 `completed_at`；提交 Provider 自动写 `started_at`。

测试：`scripts/verify-workflow.ts`「状态机」段（合法 + 非法转换全覆盖）。

---

## 4. Provider 集成（src/lib/ai）

Phase 7 **不重新设计 AI Core**。直接复用既有 `AIProvider` 接口：

- `generate()` —— 同步生成，直接返回 `GenerateResult`
- `submitTask()` —— 异步提交，返回 `{ taskId }`
- `getTaskResult()` —— 按 provider task id 回查结果
- `verifyWebhook()` —— 验签（fal / atlascloud 未实现；kie / wavespeed 已实现）

`WorkflowService` 的选择：

| Provider 类型 | 提交 | 结果回收 |
|---|---|---|
| 同步（有 `generate`） | `waitForResult` 路径走 `generate()` | 直接拿到 |
| 异步（有 `submitTask`） | `submitTask()` 拿 `provider_task_id` | webhook 或 polling 回查 `getTaskResult()` |

业务层不感知差异 —— 都收敛成 `AITask`。

---

## 5. Webhook（app/api/webhooks/ai/[provider]）

通用路由，步骤（规格 §15）：

1. 按 `provider` 找到 `AIService.verifyWebhook` 验签。
2. **验签失败** → `401`；**该 Provider 无验签能力** → `501`（不伪造通过，见 D-38）。
3. `parseWebhookPayload()` 尽力解析 `taskId` + `state`（覆盖 kie/wavespeed/fal 常见字段名；
   解析不出即 `400` 不猜）。
4. `findByProviderTaskId(provider, providerTaskId)` 定位任务。
5. 已是终态 → 返回 `{ duplicate:true }`，**不重复处理**。
6. `completed` → 回查 `getTaskResult()` → `handleProviderResult()`；`failed` → `failTask()`。

幂等见 §10。

---

## 6. Polling（src/lib/workflow/service.ts）

不做独立 worker / 消息队列（规格 §32 禁止清单）。两处 lazy 触发：

- **用户查询**：`GET /api/ai/tasks/:id` 仅当任务 `status === 'processing'` **且**有
  `providerTaskId` 时，服务端顺带 `pollTask()` 一次。
  ⚠️ **`pending` 不触发轮询**（此时还没有厂商任务 id，无从查起）。
- **Admin 兜底**：`POST /api/admin/ai-tasks/poll` 批量扫描 `processing` 且有 `provider_task_id` 的任务，
  调 `pollRunningTasks()`。

`pollTask()` 查 `AIService.getTaskResult()` → 按 `state` 推进（`completed/failed/queued`）。
未来要真正后台调度，只需新增一个进程定时调 `pollRunningTasks()`，架构不变。

---

## 7. Retry（规格 §17）

最小重试语义，无指数退避系统：

- 可重试错误（`PROVIDER_TIMEOUT` / `PROVIDER_UNAVAILABLE` / `PROVIDER_RATE_LIMITED` /
  `PROVIDER_TASK_FAILED` / `STORAGE_PERSIST_FAILED` / `INTERNAL_ERROR` 等，见 `errors.ts`
  的 `NON_RETRYABLE` 补集）。
- 不可重试错误（参数错误 `INVALID_REQUEST` / `UNKNOWN_MODEL` / `UNSUPPORTED_MODEL` /
  认证 `PROVIDER_AUTH_FAILED` / 余额 `INSUFFICIENT_CREDITS` / 内容 `CONTENT_REJECTED`）。
- 默认 `max_retries = 3`（`DEFAULT_MAX_RETRIES`）。可重试且 `retry_count < max_retries`
  → 写 `next_retry_at` 并立即重提交（`processing → processing`）。
- 耗尽 → 终态 `failed` + 退款。
- `CREDIT_DEDUCTION_FAILED` **不在** `NON_RETRYABLE` 里（即默认算可重试），
  但扣费失败那条路径会绕过 `failTask()` 直接把行置为 `failed` 并抛出，所以不会真的重试。

> 注意：当前重试在失败处理内**同步**重提交，瞬时错误会在一次调用内烧完全部重试次数。
> 需要「退避后异步重试」时应接入 §6 的 polling / 独立调度器（本期未做，见 `PHASE_7_FOLLOWUPS.md`）。

> ⚠️ **2026-09-29 复核补充**：退避时间 `min(5000 * 2^n, 60000)` 只写进 `next_retry_at`，
> **没有任何代码等待它**。`taskRepo.findRetryableTasks()` 是**零调用方**的死方法，
> `vercel.json` 也没有 `crons`。所以「退避后自动重试」目前**不存在**，
> 只有上面说的同步立即重提交 + 两条惰性推进路径（webhook / 用户查询 / Admin 手动 poll）。
> 记录于 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。

---

## 8. Credit 生命周期（规格 §18，见 D-36）

| 时机 | 动作 | 幂等键 |
|---|---|---|
| 创建任务 | `consumeCredits(amount, task:<id>:charge)` | `task:<id>:charge` |
| 失败 / 超时 | `grantCredits(refund, task:<id>:refund)` | `task:<id>:refund` |
| 提交成功 | 结算完成，不额外动作 | — |

- 扣费与退款都走 **Phase 3.5 的原子 RPC**（`consume_credits` / `grant_credits`），
  同一幂等键重复调用只产生一条流水、余额只变一次。
- `ai_tasks.credits_refunded` 有 CHECK 约束 `credits_refunded <= credits_used`，
  防止退款超过已扣。
- Provider 提交成功但后续 task 失败 → 仍能退款（键分离，互不干扰）。

测试：迁移 `verify_migrations.mjs`「W2 / W4」+ 既有 A8 / B6（退款幂等）。

---

## 9. Storage 生命周期（规格 §21）

`handleProviderResult()` → `persistResult()`（`src/lib/workflow/storage.ts`）：

1. `normalizeTaskResult()` 把 Provider 原始响应归一化成统一 `TaskAsset[]`
   （带 `type: image|video|audio|text`，业务层据此选 `<img>/<video>`）。
2. `StorageService.saveGeneratedAsset()` 把结果转存到自有 Storage（R2），
   生成 object key（遵循 Phase 5 规范 `{namespace}/{userId}/{resourceId?}/{ts}-{rand}.{ext}`）。
3. 转存后的 URL + key 写回 `ai_tasks.output_metadata`。

Provider 原始 URL 保留在 `result.raw`（调试用），业务层只看统一结构。**Workflow 不直接碰 R2 SDK**。

---

## 10. 幂等性（规格 §19）

| 维度 | 保障 |
|---|---|
| 任务创建 | `(user_id, idempotency_key)` 唯一索引 + `on conflict do nothing` |
| 状态推进 | `transitionStatus()` 对同状态幂等短路（webhook 重复不重复落结果） |
| Webhook | 终态返回 `{ duplicate:true }`；`webhook_events` 唯一索引 `(provider, event_id)` 抢占 |
| 扣费 | `consume_credits(idempotency_key)` 同键只扣一次 |
| 退款 | `grant_credits(idempotency_key)` 同键只退一次 |

重复 webhook 的端到端保证（规格 §31 验收）：第一次 `PROCESSING→COMPLETED` 写结果；
第二次命中终态短路，**不重复写结果、不重复扣费、不重复退款**。

> ⚠️ **扣费不在完成时发生。** 积分是在 `createTask()` 第 ⑥ 步、任务还是 `pending` 时就扣掉的
> （`chargeTask()`，幂等键 `task:<taskId>:charge`）。完成时只做状态迁移与结果落库；
> 失败时走 `refundTask()`（幂等键 `task:<taskId>:refund`，并由行上的 `credits_refunded` 二次守卫）。
> 本文 §8 的表格是对的，早期版本的 §10 曾写成「完成时扣费」，已修正。

测试：`verify-workflow.ts`（状态机/结果）+ `verify_migrations.mjs`「W2/W4」+ A8/B6。

---

## 11. API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/ai/tasks` | 创建任务（auth + 校验 model/input，默认异步返回 taskId） |
| GET | `/api/ai/tasks` | 列出**当前用户**任务（分页 + status 过滤，强制 user_id 收窄） |
| GET | `/api/ai/tasks/:id` | 任务详情（归属校验，看不到别人的） |
| POST | `/api/webhooks/ai/:provider` | 通用 Provider webhook（验签 + 幂等） |
| POST | `/api/admin/ai-tasks/poll` | Admin 批量轮询兜底（`withAdmin`，来自 `src/lib/admin/api.ts`；内部 `pollRunningTasks(limit=50, cap 100)`） |

创建请求体：

```json
{ "model": "...", "prompt": "...", "inputImages": [], "parameters": {}, "waitForResult": false }
```

- 拒绝客户端传 `userId`（`400`）。
- 响应不暴露 `provider_task_id` / 完整 `parameters`（防探测 + 防敏感参数泄漏）。
- 错误对外只给 `code` + 收敛文案（`errors.ts` 的 `toPublic()`），不透 Provider/DB 细节。

---

## 12. 安全（规格 §27 / §28）

- **用户 Task API**：`getCurrentUser()` 强校验，无 session → `401`。
- **Admin API**：`withAdmin()` 强校验 `users.role === 'admin'`。
- **Webhook**：不信任普通 user auth，走 `verifyWebhook()` 签名校验；无验签能力返回 501。
- **RLS**：`ai_tasks` 已有 RLS（0004），普通用户只能访问自己的行；
  所有状态推进由服务端 service_role 执行，本期不开放用户取消入口，故不新增 UPDATE 策略。
- **用户隔离**：`getTask/listUserTasks` 强制 `user_id`，枚举别人 id 返回 `null`（404）。

---

## 13. 未来演进

- **独立 Worker / 调度器**：抽出进程定时调 `pollRunningTasks()`（架构已就绪，见 §6）。
- **视频 / 音频 Provider**：新增 `AIProvider` 实现即可，业务层靠 `TaskResult.assets[].type`
  区分渲染，无需改 Workflow（D-37 已预留）。
- **取消**：开放用户取消时补一条 RLS UPDATE 策略（迁移 0009 注释已写好）。
- **完整 Dashboard**：Phase 6.5 明确不做（D-28）。
- **Flux 业务解耦**：**Phase 8 已完成** —— `flux-bridge.ts` 已删除，`/api/flux-kontext`
  改由 `FluxKontextService`（产品层）调用 `WorkflowService.createTask({ waitForResult: true })`。
  Flux 现在是 `src/lib/products/flux-kontext/` 下的一个产品，基础设施不再反向依赖它。
  详见 `FLUX_PRODUCT.md` / `PHASE_8_AUDIT.md`。

## 14. 产品层接入 Workflow 的标准形状（Phase 8 确立）

```
Product（products/<name>/service.ts）
  │  产品输入 → CreateTaskInput（model / inputImages / parameters）
  ▼
WorkflowService.createTask({ ..., waitForResult })
  ├─ true  → 同步：阻塞到结果（适合 Flux 这类"一次请求拿结果"的产品）
  └─ false → 异步：返回 taskId，客户端轮询 GET /api/ai/tasks/:id
  ▼
AITask（基础设施统一承载；产品层只读 AITask，不碰 DB / Provider / Storage SDK）
```

新增产品**不需要**修改 Workflow / AI Core / Credit / Storage 任何核心代码（见 `FLUX_PRODUCT.md` §10）。

详见 `PHASE_7_FOLLOWUPS.md` / `PHASE_8_FOLLOWUPS.md`。
