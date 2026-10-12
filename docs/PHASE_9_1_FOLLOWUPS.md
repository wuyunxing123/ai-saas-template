# Phase 9.1 Follow-ups

> Phase 9.1 完成「移除遗留伪 Prisma 适配器」。本文件记录**已完成**与**未处理**事项。
> 配套：`PHASE_9_1_AUDIT.md`（改造前审计）。

---

## Completed

### 1. `database.ts` 是否删除
✅ **已删除**。`src/lib/database.ts`（700 行）从仓库移除。

- 原引用文件数：**9**
- 当前引用文件数：**0**（真实 import 为 0；仅少数文档注释提及）
- src 文件数：232 → **231**

### 2. 删除的引用（9 个文件）

| 文件 | 迁移前 | 迁移后 |
|---|---|---|
| `src/app/api/auth/register/route.ts` | `prisma.user.findUnique/create` | `userRepo.findByEmail/create` |
| `src/app/api/debug/users/route.ts` | `prisma.user.findUnique` | `userRepo.findByEmail` |
| `src/lib/services/credits.ts` | `prisma.user.findUnique` | `userRepo.findById` |
| `src/lib/services/affiliate.ts` | `prisma.user.findUnique` | `userRepo.findById` |
| `src/lib/payment-security.ts` | `prisma.paymentOrder.findUnique` | `orderRepo.findById` |
| `src/lib/services/payment-database.ts` | 6× `prisma.paymentOrder.*` | `orderRepo.*` |
| `src/lib/payment.ts` | 8× `prisma.*` | `orderRepo` / `creditRepo` / `subscriptionRepo` |
| `src/lib/payment/creem.ts` | 15× `prisma.*` | 同上 |
| `src/lib/payment/stripe.ts` | 8× `prisma.*` | 同上 |

合计约 **43 处** `prisma.*` 调用迁移到正式 Repository。

### 3. 新增 Repository
**0 个**。所有能力已有正式 Repository 承接（user / order / credit / subscription / ai-task）。

> 审计确认：`prisma.affiliateRecord` 在适配器里**根本不存在**（仅注释中的 TODO），
> 因此无需新建 AffiliateRepository。

### 4. 修改的 Service / 模块

| 文件 | 变更 |
|---|---|
| `src/lib/services/credits.ts` | 改读 `userRepo`；保持 `checkUserCredits` 契约 |
| `src/lib/services/payment-database.ts` | 全面改走 `orderRepo`；返回由 camelCase 改为 `OrderRow`（snake_case） |
| `src/lib/services/affiliate.ts` | 去 `prisma`；仅保留 `userRepo.findById`（其余为 TODO 注释） |
| `src/lib/payment-security.ts` | 去 `prisma`；`validateOrderIntegrity` 改走 `orderRepo` |
| `src/lib/payment.ts` | 去 `prisma`；**积分发放改用原子 `creditRepo.grantCredits`**（顺带消除 B-11 残留的非原子 increment） |
| `src/lib/payment/creem.ts` | 去 `prisma`；新增 `findOrderByIdentifiers()` 助手替代 `findFirst({OR})`；积分改原子 RPC |
| `src/lib/payment/stripe.ts` | 去 `prisma`；新增 `findStripeOrder()` 助手；积分改原子 RPC |
| `src/app/api/auth/register/route.ts` | 去 `prisma`，改走 `userRepo` |
| `src/app/api/debug/users/route.ts` | 去 `prisma`，改走 `userRepo` |
| `scripts/audit-architecture.mjs` | **新增规则 2**：禁止 `src/lib/database.ts` 复活 / 任何文件 import 它 |

### 5. 测试结果

| 检查 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ 0 错误 |
| lint | `npm run lint` | ✅ 0 错误 0 警告 |
| build | `CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build` | ✅ 全部路由生成 |
| AI Core | `node scripts/run-ts.mjs scripts/verify-ai-core.ts` | ✅ 通过 |
| Workflow | `node scripts/run-ts.mjs scripts/verify-workflow.ts` | ✅ 42/42 |
| Billing | `node scripts/run-ts.mjs scripts/verify-billing.ts` | ✅ 78/78 |
| Storage | `node scripts/run-ts.mjs scripts/verify-storage.ts` | ✅ 20/20 |
| Auth | `node scripts/run-ts.mjs scripts/verify-auth.ts` | ✅ 28/28 |
| Admin | `node scripts/run-ts.mjs scripts/verify-admin.ts` | ✅ 47/47 |
| 迁移（真实 PG） | `node supabase/scripts/verify_migrations.mjs` | ✅ 198/198 |
| 迁移（静态） | `python supabase/scripts/validate_migrations.py` | ✅ 通过 |
| 死文件 | `npm run audit:dead-files` | ✅ 无新增 |
| 架构守卫 | `npm run audit:architecture` | ✅ 无反向依赖 + 无遗留适配器 |
| 残留搜索 | `grep -rn "from '@/lib/database'" src` | ✅ 0 命中 |

---

## Remaining

### F9.1-1 Payment Cluster 清理（Phase 9.2）
- **文件**：`src/lib/payment.ts`（550 行）、`src/lib/payment-security.ts`（538 行）、
  `src/lib/services/affiliate.ts`（163 行）
- **问题**：三者**全项目 0 静态引用**（`payment.ts` 只被自己动态 import 的子模块引用；
  `payment-security.ts` / `affiliate.ts` 仅被死的 `payment.ts` 引用）。
- **原因**：Phase 8 已确认它们属遗留簇；Phase 9.1 按规格「不删除 Payment Cluster」只做调用迁移。
- **建议阶段**：**Phase 9.2**（可安全删除）。
- **风险**：低（无引用）。删除前需再跑一次全项目 grep。

### F9.1-2 `lib/payment/{creem,stripe}.ts` 的 webhook 处理路径（Phase 9.2）
- **文件**：`src/lib/payment/creem.ts`（745 行）、`src/lib/payment/stripe.ts`（504 行）
- **问题**：`billing/providers/*` 只使用 `createCreemCheckout` / `createStripeCheckout`；
  文件内大量 webhook 处理函数（`handleCheckoutCompleted` 等）是否仍被调用需产品决策。
- **原因**：需要确认线上是否走 `lib/payment/*` 的 webhook，还是走 `billing/` 的 webhook。
- **建议阶段**：**Phase 9.2**（统一到 `billing/` 自包含实现）。
- **风险**：中 —— 若删除仍在用的 webhook 处理会导致支付回调失效。需先确认真实路由。

### F9.1-3 `lib/services/payment-database.ts` 的消费者（Phase 9.2）
- **文件**：`src/app/api/admin/maintenance/route.ts`、`src/lib/tasks/order-cleanup.ts`
- **问题**：仍通过 `payment-database.ts` 间接访问订单；该层是遗留包装。
- **原因**：属 Payment Cluster 范围。
- **建议阶段**：**Phase 9.2**（消费者直接改用 `orderRepo`，然后删除 `payment-database.ts`）。
- **风险**：低。

### F9.1-4 `lib/utils/response.ts` + 2 个 Phase 4 遗留 admin 路由（Phase 9.2）
- **文件**：`src/lib/utils/response.ts`（15 导出，13 未用）、
  `src/app/api/admin/maintenance/route.ts`、`src/app/api/admin/payment-config/route.ts`
- **问题**：遗留路由与工具模块；`response.ts` 的唯一消费者就是这两个路由。
- **原因**：删除路由属功能删减，需确认无外部依赖。
- **建议阶段**：**Phase 9.2**。
- **风险**：低。

### F9.1-5 调试路由 `src/app/api/debug/users/route.ts`（Phase 9.2）
- **文件**：`src/app/api/debug/users/route.ts`（52 行）
- **问题**：开发调试用路由，生产环境可能不应暴露。
- **原因**：Phase 9.1 只迁移其 `database.ts` 调用，未做功能删减。
- **建议阶段**：**Phase 9.2**（确认后删除或加环境守卫）。
- **风险**：低（含 `NODE_ENV` 判断即可）。

### F9.1-6 推荐（Affiliate）系统未实现
- **文件**：`src/lib/services/affiliate.ts`
- **问题**：`affiliateRecord` 相关逻辑**全是注释 TODO**（表也不存在）；
  `invitedBy` 恒为 `null`，奖励发放从未执行。
- **原因**：Shipany 模板预留接口，从未落地。
- **建议阶段**：**Phase 9.2 / 后续**（要么实现 `affiliate_records` 表 + Repository，要么删除该模块）。
- **风险**：低（当前为 no-op）。

### F9.1-7 i18n / SEO 的 Flux 文案产品化（承接 Phase 8 F8-3）
- **文件**：`src/lib/content/{generator,home,pricing,seo}.json`、`src/lib/seo/metadata-generator.ts`
- **问题**：Flux 产品文案仍在通用 content 里。
- **建议阶段**：**Phase 9.2 / 后续**。
- **风险**：低（改动 UI 渲染路径需谨慎）。

### F9.1-8 ⚠️ NOT VERIFIED — requires real credentials/environment
- **范围**：支付 webhook 端到端（Stripe / Creem 回调 → 订单状态 → 发积分 / 激活订阅）。
- **原因**：本机 `.env.local` 的支付密钥与 Supabase 均为占位符；且 `lib/payment/*` 的
  webhook 路由是否在线上启用未确认。
- **需真实环境验证**：迁移后的 `orderRepo` / `creditRepo.grantCredits` 调用在真实
  webhook 下行为是否与旧适配器等价（尤其是 `provider_session_id` / `provider_payment_id`
  的写入路径）。
- **建议阶段**：Phase 9.2 或上线前回归。
- **风险**：中 —— 迁移是机械等价替换，但支付链路无自动化测试覆盖。

---

## 架构验证（规格 §8 / §12.6）

```
API → Domain Service → Repository → Supabase   ✅ 成立
Billing → Order / PaymentProvider / Credit      ✅ 成立
Admin → Domain Service / Repository             ✅ 成立
Workflow → AI / Credit / Storage                ✅ 成立
```

- **禁止项**：`Business → database.ts` / Prisma-like adapter / generic DB helper
  → 由 `npm run audit:architecture` 的「遗留 database 适配器检查」守卫。
- `prisma.*` 全项目真实调用：**0**。
