# Phase 8 Follow-ups

> Phase 8 完成后**不影响验收**、但应后续处理的事项。
> 清理原则（规格 §30）：删除必须满足「无引用 / 无历史数据依赖 / 无兼容 API 依赖 /
> 已有新路径 / 测试通过」，否则记在这里。

---

## 一、必须后续处理

### F8-1 遗留支付簇（非 Flux，但阻碍"模板干净"）
Phase 8 未动的支付遗留代码：

| 文件 | 行数 | 引用数 | 说明 |
|---|---|---|---|
| `src/lib/database.ts` | 683 | 9 | **伪 Prisma 适配器**，Phase 3 的过渡产物 |
| `src/lib/payment.ts` | — | — | 旧支付聚合 |
| `src/lib/payment/{stripe,creem}.ts` | — | — | 被 `billing/providers/*` 复用 `createXCheckout` |
| `src/lib/payment-security.ts` | — | — | 仅被 `lib/payment.ts` 用 |
| `src/lib/services/payment-database.ts` | — | — | 仅被 `lib/payment.ts` / `order-cleanup` 用 |

**为什么没删**：`billing/providers/*`（基础设施）依赖 `lib/payment/{stripe,creem}` 的
`createXCheckout`，删除需先迁移 billing 到 `billing/providers` 自包含的 SDK 调用。
这属于 **Phase 9** 的「模板清理」，不属于 Flux 解耦范围。

### F8-2 Phase 4 遗留 admin 路由 + `lib/utils/response.ts`
- `src/app/api/admin/maintenance/route.ts`
- `src/app/api/admin/payment-config/route.ts`
- 二者是 `src/lib/utils/response.ts`（15 个导出中 13 个未使用）**唯一**的消费者。

**为什么没删**：删除路由属于功能删减，需确认无人依赖；`utils/response.ts` 随路由一起消失才干净。

### F8-3 i18n / SEO 中的 Flux 文案未产品化
`src/lib/content/{generator,home,pricing,seo}.json` 与 `src/lib/seo/metadata-generator.ts`
含 Flux 产品文案。

**为什么没迁移**：这些文案被 UI 直接消费，迁移会改动 UI 渲染路径（违反「不重写 UI」）。
若要彻底产品化，应把文案拆到 `products/flux-kontext/content/`，并让 UI 从产品模块取。

### F8-4 HTTP 端到端验证未在本机执行
`scripts/smoke-ai-core.mjs` 的 B5 段验证 `/api/flux-kontext` 真实生成
（需真实 Supabase + `FAL_KEY`）。本机是占位符，无法执行。

**需要**：在有真实凭据的环境跑一次，确认 Flux 主流程（§24 的 12 项兼容性）端到端正常。

### F8-5 Provider 精确 webhook 解析
承接 Phase 7 F7-1。`parseWebhookPayload` 仍是 best-effort。

---

## 二、可选优化

### O8-1 `services/credits.ts` 仍依赖 `lib/database.ts`
`checkUserCredits()` 用 `prisma.user.findUnique`（伪 Prisma）。可改为直接读
`db/repositories/user.ts`，从而摆脱 `lib/database.ts`。属 F8-1 的前置步骤。

### O8-2 `lib/services/affiliate.ts` 依赖 `lib/database.ts`
同上，属 F8-1 范围。

### O8-3 Flux UI 目录产品化（形式）
可把 `src/components/FluxKontextGenerator.tsx` 与 `src/components/flux-kontext/*`
移到 `src/components/products/flux-kontext/`，让 UI 与 lib 的产品边界对称。

**为什么没做**：规格 §5 明确「不要为了目录形式机械搬迁」；且移动 1955 行组件的
import 路径风险大于收益。当前 UI 已满足「不直连基础设施」的实质要求。

### O8-4 Task Center "My Tasks" 的 i18n
承接 Phase 7 O7-2。硬编码英文，应补 `common.navigation` key。

### O8-5 Flux 超时后的结算行为（说明，非缺陷）
Phase 8 后，若请求在 55s 超时，Flux 路由返回 504，但**不再自己退款** ——
任务在后台由 `WorkflowService` 继续，成功则扣费、失败则自动退款。

- 这是**改进**（旧实现会在后台仍成功时也退款，导致"白送"）。
- 但用户看到 504 后若立即重试，可能产生两条任务。建议：超时响应里引导用户去 `/tasks` 查看。

---

## 三、明确属于 Phase 9

### P9-1 删除 `lib/database.ts`（伪 Prisma 适配器）
迁移 9 处引用到真实 Repository 后删除。这是模板「去 Flux 遗留」的收尾。

### P9-2 清理 payment 簇
`lib/payment*` / `lib/services/payment-database.ts` / `lib/payment-security.ts`
→ 收敛进 `billing/`。

### P9-3 独立 Worker / 队列
承接 Phase 7 P9-1。当前架构已为 `pollRunningTasks()` 预留接入点。

### P9-4 第二个产品
按 `FLUX_PRODUCT.md` §10 的模板，新增 `products/<name>/`，验证边界可复制。

---

## 验收核对（规格 §31 的 20 问）

| # | 问题 | 答案 |
|---|---|---|
| 1 | Flux 属于哪个业务层？ | 产品层 `src/lib/products/flux-kontext/` |
| 2 | Flux 如何调用 Workflow？ | `FluxKontextService.generate()` → `WorkflowService.createTask()`（§5） |
| 3 | Workflow 是否知道 Flux？ | **否** |
| 4 | AI Core 是否知道 Flux？ | **否** |
| 5 | Storage 是否知道 Flux？ | **否** |
| 6 | Credit 是否知道 Flux？ | **否** |
| 7 | Billing 是否知道 Flux？ | **否** |
| 8 | Auth 是否知道 Flux？ | **否** |
| 9 | Flux API 与通用 AI API 的关系？ | 二者都落到同一 Task 基础设施；`/api/ai/tasks` 不知道 Flux（§2） |
| 10 | Flux 模型定义在哪里？ | `ai/models.ts`（配置数据，非业务） |
| 11 | Flux-specific 参数在哪里处理？ | `products/flux-kontext/service.ts` 的 `buildParameters()` |
| 12 | Flux 结果如何进入 Storage？ | `WorkflowService.persistResult()` → `StorageService`（§8） |
| 13 | Flux 失败如何退款？ | `WorkflowService.failTask()` → `settlement.refundTask()`（§7） |
| 14 | Flux Task 如何进入 Admin？ | 与所有任务一样落在 `ai_tasks`，`/admin/ai-tasks` 可见 |
| 15 | Flux Task 如何进入用户 Task Center？ | 同上，`/tasks` 可见 |
| 16 | 加 Product B 要改哪些核心基础设施？ | **不改**（只需注册模型 + 可选 Provider）（§10） |
| 17 | `flux-bridge` 是否已删除？ | **是** |
| 18 | 是否还有旧 Flux → Provider 直接调用？ | **无**（统一经 WorkflowService → AIService） |
| 19 | 是否还有 Flux → DB 直接操作？ | **无**（Flux 不碰 DB） |
| 20 | 是否还有基础设施 → Flux 的反向依赖？ | **无**（`audit:architecture` 守卫） |

✅ 20 问全部为「否 / 无 / 已删除」或指向正确方向 → Phase 8 验收通过。
