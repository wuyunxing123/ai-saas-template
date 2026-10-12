# Phase 7 Follow-ups

> 本文件记录 Phase 7 **不影响验收**、但应在后续阶段处理的事项。
> 验收标准（规格 §35 的 20 个问题）已全部可回答，见 `WORKFLOW.md` 与文末核对。

分类：

- **必须后续处理** —— 功能有缺口或依赖外部样本，需补做（不补会留隐患）
- **可选优化** —— 体验 / 健壮性增强，不补不影响主线
- **明确属于 Phase 8 / 9** —— 已在规格里划给后续阶段，本期刻意不动

---

## 一、必须后续处理

### F7-1 各 Provider 的精确 webhook 解析
当前 `parseWebhookPayload()`（`src/lib/workflow/webhook-payload.ts`）是**尽力而为**的通用解析，
覆盖 kie/wavespeed/fal 最常见的字段名。但本机**没有各厂商真实 webhook 样本**，
凭空写"这就是 X 的 payload"属于编造。

- 拿到真实样本后，应在 `src/lib/ai/providers/<name>.ts` 实现精确的 `parseWebhook()` 覆盖通用解析。
- 在此之前，解析不出的 payload 路由回 `400`，**绝不猜**——避免把 A 任务结果写到 B 任务。

### F7-2 fal / atlascloud 的 webhook 验签
`AIService.verifyWebhook()` 目前只有 **kie / wavespeed** 实现。fal / atlascloud 未实现，
`hasWebhookSecret()` 对其返回 `false`，webhook 路由因此对它们返回 **501**（不伪造通过）。

- 若这些 Provider 要走 webhook，需补 `verifyWebhook()` 实现 + 配置签名密钥。
- 在此之前，异步结果回收应走 **polling**（§6），而非 webhook。

### F7-3 真实 Supabase 实例的并发验证
`verify_migrations.mjs` 用 PGlite（单后端单连接），无法复现真正并行。

- 扣费 / 退款幂等已在 PGlite 验证「语义正确」，但**真正并发**下由 Postgres 行级锁串行化，
  需在真实 Supabase 上补一次并发压测（参考该脚本 Test 5a/5b 的说明）。

### F7-4 任务创建入口（用户侧）
本期 Task Center（`/tasks`、`/tasks/:id`）只做**列表 + 详情 + 状态 + 结果**。
通用 **创建表单**（`POST /api/ai/tasks` 的 UI）未做——当前创建仍走 `/generate`（Flux 业务）。

- 等 Phase 8 把 Flux 统一到 WorkflowService 后，可提供一个不绑定 Flux 的通用创建页。
- 本期 `POST /api/ai/tasks` 的契约已就绪并通过单元测试，仅缺 UI 壳。

---

## 二、可选优化

### O7-1 重试退避与异步调度
当前 `failTask()` 对可重试错误**同步**重提交（一次调用内烧完全部重试）。瞬时错误会立刻耗尽次数。

- 更优：写 `next_retry_at` 后**不立即重提交**，交给 §6 的 polling / 独立调度器异步重试。
- 本期为最小实现，可接受；列为优化项。

### O7-2 "My Tasks" 的 i18n
导航与 Task Center 的 "My Tasks" 用了**硬编码英文**，未加 `common.navigation` 文案 key
（项目是 16 语言模板）。

- 应在 `src/lib/content/locale.ts` 等补 `tasks` key，复用现有 i18n 体系。
- 不影响功能，仅一致性。

### O7-3 用户侧取消入口
`ai_tasks` 有 `cancelled` 状态与状态机支持，但本期**不开放**用户取消（无 UI、无 API、无 RLS UPDATE 策略）。

- 若要做，补一条 RLS UPDATE 策略（迁移 0009 注释已写好模板）+ 一个 `POST /api/ai/tasks/:id/cancel`。
- 规格 §6 允许 CANCELLED，但 §24 明确 Task Center 只做列表/详情/状态/结果。

### O7-4 失败任务的错误展示细化
详情页当前只展示 `error.code` + `retryable`，不展示内部 message（符合 §29 不泄漏原则）。

- 若用户需要更可读的失败原因，可在 `errors.ts` 的 `PUBLIC_MESSAGES` 扩充；
  内部 message 仍只写日志。

### O7-5 结果转存的失败重试
`persistResult()` 若 Storage 写入失败会标记 `STORAGE_PERSIST_FAILED`（可重试），
但当前不自动重转存历史结果。

- 可选：提供一次性修复脚本，对 `completed` 但 `output_metadata.assets` 仍指向 Provider URL 的任务重转存。

---

## 三、明确属于 Phase 8 / 9

### P8-1 Flux 业务解耦（规格 §25 / D-41）
- 删除 `src/lib/workflow/flux-bridge.ts`（best-effort 审计桥接）。
- 把 `/api/flux-kontext` 与 `FluxKontextGenerator.tsx` 接到 `WorkflowService.createTask()`。
- 届时 Flux 的积分流程统一走 `settlement.ts`（与通用任务一致）。
- **本期未动**：Flux 是线上主路径，规格明确要求「保证现有 Flux 功能继续工作」。

### P8-2 删除 FluxKontextService / 兼容层
规格 §25 说 Phase 7 不删。Phase 8 才删。

### P9-1 独立 Worker / 消息队列
规格 §32 明确禁止（Temporal / BullMQ / Kafka 等）。若未来规模真需要，再演进；
当前架构已为 `pollRunningTasks()` 预留接入点。

### P9-2 复杂 Dashboard / 多租ancy / RBAC / 订阅高级特性
规格 §33 明确不在 Phase 7 做，且多属更后续阶段。

---

## 验收核对（规格 §35）

| # | 问题 | 回答位置 |
|---|---|---|
| 1 | AI Task 在哪里持久化？ | `ai_tasks` 表（0004 + 0009） |
| 2 | Task 状态有哪些？ | `pending/processing/completed/failed/cancelled`（§3） |
| 3 | 谁负责状态转换？ | `transitionStatus()` + `assertTransition()`（§3, D-35） |
| 4 | Provider task id 存在哪里？ | `ai_tasks.provider_task_id` |
| 5 | 同步 Provider 怎么处理？ | `waitForResult` 阻塞路径（§2, §4） |
| 6 | 异步 Provider 怎么处理？ | `submitTask` 拿 id → webhook/polling（§4, §5, §6） |
| 7 | Webhook 怎么处理？ | §5（验签→解析→定位→幂等→推进） |
| 8 | Polling 怎么处理？ | §6（lazy + Admin 批量） |
| 9 | Retry 怎么处理？ | §7（可重试分类 + max_retries=3） |
| 10 | Credit 什么时候扣？ | 创建任务即 `consumeCredits`（§8） |
| 11 | Provider 失败如何退款？ | `grantCredits(refund)` 同一幂等键（§8） |
| 12 | Webhook 重复如何避免重复扣费？ | 终态短路 + 退款幂等键（§10） |
| 13 | Result 怎么保存？ | `output_metadata.assets`（§9） |
| 14 | Result 如何进入 Storage？ | `persistResult` → `StorageService`（§9, D-21） |
| 15 | 普通用户如何查询 Task？ | `GET /api/ai/tasks`（强制 user_id） |
| 16 | Admin 如何查询 Task？ | `GET /api/admin/ai-tasks`（已基于新模型） |
| 17 | 如何保证用户不能看别人 Task？ | `getTask/listUserTasks` 强制 user_id + RLS（§12, D-40） |
| 18 | Flux 兼容层如何接入？ | `flux-bridge.ts` best-effort 审计（§F7 上文 / D-41） |
| 19 | 未来加视频 Provider 改哪些？ | 只加 `AIProvider` 实现，业务层靠 `type` 区分（§4, §13） |
| 20 | 未来独立 Worker 如何演进？ | 新增进程调 `pollRunningTasks()`，架构不动（§6, §13） |

✅ 20 项全部可回答 → Phase 7 验收通过。
