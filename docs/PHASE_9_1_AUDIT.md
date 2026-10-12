# Phase 9.1 Audit — Remove Legacy Database Adapter

> 只读审计（写于改造前）。目标：摸清 `src/lib/database.ts` 的全部职责与引用，
> 为「彻底删除它」建立精确的迁移清单。配套：`PHASE_9_1_FOLLOWUPS.md`。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| `database.ts` 规模 | 700 行，`class SupabaseAdapter` + 5 个模型 |
| 引用文件 | **9 个** |
| `prisma.*` 调用点 | **约 43 处** |
| 本质 | **薄 Prisma 形状包装** —— 每个方法都委托给已有的正式 Repository |
| 删除可行性 | **高**（无隐藏依赖；所有能力已有 Repository 承接） |
| 需要新建的 Repository | **0**（`affiliateRecord` 是注释掉的 TODO，无实际调用） |
| 隐藏/动态引用 | 无（`payment.ts` 的动态 import 指向的都是被迁移对象本身） |

**核心结论**：`database.ts` 已经是「空壳」——它不自己访问数据库，只是把 Prisma 风格
（camelCase + `where/data` 参数）翻译成 Repository 调用。删除它不会丢能力，
只需把 9 个调用点改为直接调 Repository。

---

## 1. `database.ts` 当前职责

```
class SupabaseAdapter
├── user              → userRepo (findById/findByEmail/create/update/remove)
│                       + creditRepo.adjustBalance / getBalance（credits 增减）
├── paymentOrder      → orderRepo (findById/findByOrderNumber/findByProviderSession/
│                       create/update/remove/listAll/count/updateManyStatus)
├── creditTransaction → creditRepo (listTransactions/findByReference/createTransaction)
├── subscription      → subscriptionRepo (listByUser/findActiveByUser/findById/create/update)
└── aiTask            → aiTaskRepo (create/findById/findByProviderTaskId/
                        findByIdempotencyKey/listByUser/transitionStatus)
```

另含 5 个 camelCase 映射器：`toUser` / `toPaymentOrder` / `toCreditTransaction` /
`toSubscription` / `readProviderRefs` / `toIso`。

**结论**：适配器**不含任何数据库访问逻辑**，只是形状转换层。

---

## 2. 引用清单（9 个文件）

| # | 文件 | 存活？ | prisma 调用点 | 说明 |
|---|---|---|---|---|
| 1 | `src/app/api/auth/register/route.ts` | ✅ 活 | 2 | 注册：查重 + 建用户 |
| 2 | `src/app/api/debug/users/route.ts` | ✅ 活（调试路由） | 1 | 调试：按 email 查用户 |
| 3 | `src/lib/services/credits.ts` | ✅ 活 | 1 | `checkUserCredits` 读余额 |
| 4 | `src/lib/services/affiliate.ts` | ⚠️ 死（仅被死的 payment.ts 动态引用） | 1（活）+ 4（注释） | 仅 `user.findUnique` 是活的 |
| 5 | `src/lib/payment-security.ts` | ⚠️ 死（仅被死的 payment.ts 引用） | 1 | `validateOrderIntegrity` |
| 6 | `src/lib/services/payment-database.ts` | ✅ 活（admin/maintenance + order-cleanup） | 6 | 订单 CRUD 包装 |
| 7 | `src/lib/payment.ts` | ⚠️ **死**（0 静态引用） | 8 | 旧支付会话 + webhook 处理 |
| 8 | `src/lib/payment/creem.ts` | ✅ 活（仅 `createCreemCheckout`） | 15 | checkout 活；webhook 处理为旧路径 |
| 9 | `src/lib/payment/stripe.ts` | ✅ 活（仅 `createStripeCheckout`） | 8 | 同上 |

> 「死」= 全项目 0 静态引用，且动态 import 扫描无命中。

---

## 3. 调用点 → 能力 → 新架构位置

| 能力 | 当前调用 | 新位置 |
|---|---|---|
| 用户：按 id / email 查 | `prisma.user.findUnique` | `userRepo.findById` / `findByEmail` |
| 用户：创建 | `prisma.user.create` | `userRepo.create` |
| 用户：更新（非 credits） | `prisma.user.update` | `userRepo.update` |
| 用户：credits 增减 | `prisma.user.update({credits:{increment}})` | `creditRepo.grantCredits`（原子）/ `consumeCredits` |
| 订单：按 id / 单号 / 会话查 | `prisma.paymentOrder.findUnique/findFirst` | `orderRepo.findById` / `findByOrderNumber` / `findByProviderSession` |
| 订单：创建 | `prisma.paymentOrder.create` | `orderRepo.create` |
| 订单：更新状态 | `prisma.paymentOrder.update` | `orderRepo.update` / `markPaidIfPending` |
| 订单：批量状态 | `prisma.paymentOrder.updateMany` | `orderRepo.updateManyStatus` |
| 订单：列表 / 计数 | `prisma.paymentOrder.findMany/count` | `orderRepo.listAll` / `listByUser` / `count` |
| 积分流水：创建 | `prisma.creditTransaction.create` | `creditRepo.createTransaction` |
| 积分流水：查询 | `prisma.creditTransaction.findUnique/findMany` | `creditRepo.findByReference` / `listTransactions` |
| 订阅：查活跃 / 按 id | `prisma.subscription.findFirst/findUnique` | `subscriptionRepo.findActiveByUser` / `findById` |
| 订阅：创建 / 更新 | `prisma.subscription.create/update` | `subscriptionRepo.create` / `update` |

**所有能力都已有 Repository 承接 → 无需新建 Repository。**

---

## 4. 可直接删除的调用

| 位置 | 内容 |
|---|---|
| `services/affiliate.ts` | 4 处 `affiliateRecord.*` + `user.update` **全在注释里**（TODO stub），删除注释即可 |
| `services/affiliate.ts` | `prisma.affiliateRecord` 模型**在适配器里根本不存在** → 若被执行会抛错（实际是坏代码） |

> ⚠️ 但**不删除这些文件**（属 Payment Cluster，规格 §10 明确「不删除 Payment Cluster」）。
> 仅迁移其 `database.ts` 调用。

---

## 5. 需要迁移的调用（约 43 处）

见 §3 映射。分布：register(2) / debug(1) / credits(1) / affiliate(1 活) /
payment-security(1) / payment-database(6) / payment(8) / creem(15) / stripe(8)。

**迁移要点**：适配器返回 **camelCase**（`order.userId`），Repository 返回 **snake_case**
（`order.user_id`）。迁移时须同步调整字段读取。

---

## 6. 隐藏 / 动态引用

| 检查 | 结果 |
|---|---|
| `import('@/lib/database')` 动态 | 无 |
| `require('@/lib/database')` | 无 |
| `getPrisma` / 其它别名导出 | 无（仅 `prisma` 具名 + `default`） |
| `prisma.affiliateRecord` | 有调用但模型不存在（死代码，见 §4） |
| scripts/ 引用 | 无 |

---

## 7. 删除后的潜在风险

| 风险 | 评估 | 缓解 |
|---|---|---|
| 漏迁移导致编译失败 | 中 | 删除后 `tsc --noEmit` 会立刻暴露 |
| camelCase → snake_case 改错字段 | 中 | 逐个调用点核对 Row 类型 |
| 支付 webhook 路径行为变化 | 中 | 这些路径无自动化测试覆盖（需真实 webhook），迁移保持等价语义 |
| `prisma.user.update({credits:{increment}})` 非原子 | 已知（B-11） | 迁移时改走 `creditRepo` 原子 RPC（顺带修 B-11 残留） |

---

## 8. Phase 9.1 vs Phase 9.2 边界

### Phase 9.1（本阶段）完成
- 删除 `src/lib/database.ts`
- 9 个调用点迁移到正式 Repository
- 不动 Payment Cluster 的文件结构

### Phase 9.2（后续）需要
- **Payment Cluster 清理**：`lib/payment.ts`（死）、`lib/payment-security.ts`（死）、
  `lib/services/affiliate.ts`（死）可直接删除；
  `lib/payment/{creem,stripe}.ts` 的 webhook 处理路径是否仍需要，需产品决策
- 统一到 `billing/` 自包含实现（`billing/providers/*` 不再依赖 `lib/payment/*`）
- `lib/services/payment-database.ts` 的消费者（admin/maintenance、order-cleanup）改用 `orderRepo`
- `lib/utils/response.ts` + 2 个 Phase 4 遗留 admin 路由
- i18n / SEO 的 Flux 文案产品化（承接 Phase 8 F8-3）

---

## 9. 架构目标

```
API → Domain Service → Repository → Supabase      （禁止 Business → database.ts）
Billing → Order / PaymentProvider / Credit
Admin → Domain Service / Repository
Workflow → AI / Credit / Storage
```
