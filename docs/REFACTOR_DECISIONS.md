# REFACTOR_DECISIONS.md — 设计冲突与决策记录

> 依据重构方案第十九条：当「当前项目设计」与「目标方案」冲突时，**不擅自大规模重构**，
> 先记录在此，然后继续执行不依赖该决策的任务。
>
> 本文件由 Phase 1 分析产出，Phase 2 / 3 / 3.5 / 4 / 5 / 6 / 6.5 逐步收敛；2026-09-25 修复批次后新增 D-29 ~ D-33。
>
> **阅读方式**：先看下方「决策状态总表」拿到结论；每条决策下面分
> `### 历史决策（Phase 1）`（当时为什么提出这个问题）与 `### 最终决策`（最后怎么处理的）。
> 历史部分刻意保留，以便日后回溯「为什么当时没有那样做」。
>
> **当前仍未闭合的决策**（2026-09-29 复核）：D-13（明确不做）、
> D-16（`SmartImagePreview` 在 UI 层硬编码 R2 URL 重写，见 `src/components/SmartImagePreview.tsx:29-41`）、
> D-27 / D-28（明确不做）。其余全部 ✅。
>
> ~~D-10（`database.ts` 仍有 5 处依赖）~~ → ✅ **已闭合**（Phase 9.1 删除该文件，5 处引用全部消失，
> `audit:architecture` 阻止复活）。详见下方 D-10 条目。

---

## 决策状态总表

| ID | 主题 | 最新状态 | 结论 / 下一步 |
|---|---|---|---|
| **D-1** | 订单表统一（`orders` vs `payment_orders`） | ✅ **已解决** | 统一为 `orders`；`payment_orders` 已 deprecated。**不要重新打开此决策** |
| **D-2** | `credit_accounts` vs `users.credits` | ✅ **已决定** | 保留 `users.credits`，不创建 `credit_accounts`。余额访问已集中在 Credit Repository |
| **D-3** | 积分扣减原子性与幂等 | ✅ **已解决**（Phase 3.5） | Supabase PostgreSQL RPC：`consume_credits()` 原子扣减 + 幂等 + 同事务写流水 |
| **D-4** | migration 体系 | ✅ **已解决** | 保留 `supabase/migrations/`，编号 SQL；**暂不引入 Supabase CLI** |
| **D-5** | provider 配置方式 | ✅ **已决定** | 以 Phase 2 实际实现为准：`AI_PROVIDER` / `IMAGE_GENERATION_PROVIDER` + `ai/models.ts` 的 `defaultProvider`，不支持的 Provider 显式报错。本阶段不重新设计 |
| **D-6** | `subscriptions` 实现深度 | ✅ **已决定** | 保留表 + 真实持久化；暂不实现续费 / proration / 复杂周期逻辑 |
| **D-7** | `users.signin_*` 遗留字段 | ✅ **已解决** | **审计后决定不删列**：`signin_provider` / `last_signin_at` 被 Admin 展示使用。实际处理 = 删除 189 行死代码 + 停止写无意义的 `signin_ip`。见 F-2 |
| **D-8** | `docs/` 目录清理 | ✅ **已解决** | 53 个模板遗留文档已 `git mv` 到 `docs/archive/`，`docs/` 只留 14 个有效文档。见 F-13 |
| **D-9** | 多语言保留策略 | ✅ **已决定** | **保留全部语言**，不做裁剪。`content/*.json` + `content/locale.ts` + `seo/*` + `sitemap` 均在用 |
| **D-10** | 伪 Prisma 适配器（`src/lib/database.ts`） | ✅ **已闭合** | mock 全部移除（Phase 3）→ **文件已删除**（Phase 9.1，约 700 行）。原先的 5 处依赖全部消失（2 个已删、3 个改用 Repository）。`audit:architecture` 阻止复活。详见下方条目 |
| **D-11** | 订单状态词表（Phase 4） | ✅ **已解决** | 目标词表 `pending/paid/failed/cancelled/refunded/expired`；旧值 `created`/`completed` 兼容保留并已回填 |
| **D-12** | 价格真相归属（Phase 4） | ✅ **已解决** | 静态配置 `src/config/billing.ts`（整数最小单位）；不建数据库配置表。<br>**积分成本**另见 `src/config/credits.ts`（B-12 统一） |
| **D-13** | 退款后是否扣回积分（Phase 4） | 🟡 **明确不做** | 缺少业务规则，记录为 Phase 4 deferred。只支持 `paid → refunded` 状态流转 |
| **D-14** | Storage 抽象层（Phase 5） | ✅ **已解决** | `StorageService → StorageProvider → R2Provider`；Object Key 规范 `{namespace}/{userId}/{resourceId?}/{filename}`；原始文件名仅作 metadata |
| **D-15** | Storage 与 Asset 边界（Phase 5） | ✅ **已决定** | 本阶段只做 Storage（文件在哪），不做 Asset Management（文件属于什么业务实体）。不新建 `storage_objects` 表 |
| **D-16** | SmartImagePreview 硬编码 R2 URL（Phase 5） | 🟡 **仍存在** | `src/components/SmartImagePreview.tsx` 仍硬编码 `r2.dev` / `r2.cloudflarestorage.com` 解析逻辑。**Phase 6 未执行**。属 UI 改动，可随 Phase 8 处理 |
| **D-17** | Session 注入 user.id（Phase 6） | ✅ **已解决** | `session callback` 已注入 `user.id`，API 可直接读取 |
| **D-18** | 注册赠积分类型（Phase 6） | ✅ **已解决** | `credit_transactions.type='gift'` → `'bonus'`，修复 B-6 CHECK 约束冲突 |
| **D-19** | users.role 字段（Phase 6） | ✅ **已决定** | 新增 `users.role VARCHAR DEFAULT 'user' CHECK (role IN ('user', 'admin'))`，为 Phase 6.5 Admin 做准备 |
| **D-20** | API 通过 email 查询用户（Phase 6） | ✅ **已解决** | 已统一到 `src/lib/auth-session.ts` 的 `getCurrentUser()`：优先 `session.user.id`（主键），email 仅作老 session 兜底。迁移 8 个文件。见 F-1 |
| **D-21** | signin_* 遗留字段（Phase 6） | ✅ **已解决** | 与 D-7 同一事项，结论一致：不删列，清理死代码 |
| **D-22** | Admin 授权依据（Phase 6.5） | ✅ **已解决** | 唯一依据为 server-side `users.role === 'admin'`（`src/lib/admin/authorization.ts`）。禁止用 body / 客户端参数判断 |
| **D-23** | ADMIN_EMAILS 定位（Phase 6.5） | ✅ **已决定** | 降级为 **bootstrap 白名单**：命中即写 `users.role='admin'`，之后权限判断只看 role |
| **D-24** | Admin 积分调整路径（Phase 6.5） | ✅ **已解决** | 必须走 `credit.grantCredits()`（原子 RPC `grant_credits`，type=`adjustment`）+ 审计日志。禁用 `adjustBalance` / 直接 UPDATE |
| **D-25** | Admin 审计日志（Phase 6.5） | ✅ **已决定** | 新建 `admin_audit_logs` 表（迁移 0008），记录 谁/对谁/做了什么/为什么/什么时候；不含敏感数据。<br>查看入口 `/admin/audit-logs`（F6.5-2 已补） |
| **D-26** | Admin 页面数据访问方式（Phase 6.5） | ✅ **已决定** | 读取走 Server Query Service（`adminService`，Server Component 内调用）；写入走 Admin API。页面**禁止**直接访问数据库 |
| **D-27** | Admin 角色管理 UI（Phase 6.5） | 🟡 **明确不做** | 修改他人 role 涉及权限提升，留到后续版本（见 PHASE_6_5_FOLLOWUPS.md F6.5-1）。**需用户授权** |
| **D-28** | Admin Dashboard / Settings（Phase 6.5） | 🟡 **明确不做** | 不做图表 / BI / 系统配置。Overview 只保留简单计数 |

> 状态图例：✅ 已解决/已决定 = 不再需要你决策 · 🟡 = 仍存在或明确不做（详见对应条目）

---

## 修复批次补充决策（2026-09-25）

本轮缺陷收口产生的新约定，正式登记为决策：

| ID | 主题 | 结论 |
|---|---|---|
| **D-29** | 超时 / 失败的积分退款路径 | 必须走 `credit.grantCredits()`（原子 RPC）+ `idempotency_key`。**禁止** `prisma.user.update({ credits: { increment } })`。<br>55s 超时与生成失败**共用同一幂等键** → 同时触发也只退一次。（B-10） |
| **D-30** | 限流器的计数 key | `src/proxy.ts` 的 key 必须是 `${ip}:${bucket}`，bucket ∈ {api, auth, payment}。<br>**禁止**只按 ip 计数（不同路径阈值不同会互相误伤）。（B-21） |
| **D-31** | 积分成本唯一真相 | `src/config/credits.ts` 的 `CREDIT_COSTS`（key = 模型 id）。`ai/models.ts`、`flux-kontext-request.ts`、`services/credits.ts` 全部从它派生。<br>**禁止**任何地方再写死积分数值。（B-12） |
| **D-32** | 地区 / 主权表述 | **禁止**把 `HK` / `MO` / `TW` 放进 `country: [...]` 这类主权国家列表。按地区路由时用**业务分区**（如 `APAC`）；面向用户文案一律表述为**中国香港 / 中国澳门 / 中国台湾**。（B-17） |
| **D-33** | 用户身份来源 | 统一走 `src/lib/auth-session.ts` 的 `getCurrentUser()`：优先 `session.user.id`（主键），email 仅作老 session 兜底。<br>**禁止**新代码再按 `session.user.email` 查用户。（F-1） |

---

## Phase 7 决策（Workflow / Async Task Engine，2026-09-25）

| ID | 主题 | 结论 |
|---|---|---|
| **D-34** | ai_tasks 状态词表 | ✅ **已决定** | 采用 DB CHECK 词表 `pending/processing/completed/failed/cancelled`，不另建大写枚举（避免 `CREATED↔pending` 恒等映射）。规格建议的 `CREATED/RUNNING` 分别对应 `pending/processing` |
| **D-35** | 状态机集中管理 | ✅ **已决定** | 状态推进只允许走 `ai-task.transitionStatus()` + `state-machine.assertTransition()`；禁止 API / Provider / Repository 直接 `UPDATE status` |
| **D-36** | Credit 生命周期 | ✅ **已决定** | 创建任务即 `consumeCredits()`（原子 RPC + 幂等键）；失败 / 超时走 `grantCredits()`（refund，同一幂等键）；当前模型无 reserve→settle 两阶段（见 D-29） |
| **D-37** | 同步 / 异步 Provider 统一 | ✅ **已决定** | 二者都收敛到 `AITask`：同步 Provider 走 `waitForResult` 阻塞路径；异步走 webhook / polling。业务层不感知差异 |
| **D-38** | Webhook 幂等 | ✅ **已决定** | 终态短路返回 200（duplicate:true）；退款用固定键 `task:<id>:refund`；无验签能力的 Provider 返回 501（不伪造通过） |
| **D-39** | 任务创建幂等键 | ✅ **已决定** | `(user_id, idempotency_key)` 唯一索引 + `on conflict do nothing`，前端重复提交只建一条 |
| **D-40** | 用户任务隔离 | ✅ **已决定** | `getTask(userId)` / `listUserTasks(userId)` 强制按 `user_id` 收窄；绝不信任客户端传入的 userId |
| **D-41** | Flux 兼容层边界 | ✅ **已决定** | 仅 best-effort 写一条审计用 ai_task，**不改动** Flux 的积分 / 生成流程；Phase 8 才统一到 `WorkflowService` |
| **D-42** | Polling 策略 | ✅ **已决定** | 用户查询进行中任务时 lazy 触发 + Admin 批量兜底；不做独立 worker / 消息队列（属 Phase 32 禁止清单） |

---

## Phase 8 决策（Flux Business Decoupling，2026-09-26）

| ID | 主题 | 结论 |
|---|---|---|
| **D-43** | Flux 的归属 | ✅ **已决定** | Flux 是**产品层**：`src/lib/products/flux-kontext/`。不再是系统核心。依赖方向只能 Flux → 基础设施 |
| **D-44** | Flux 接入 Workflow 的入口 | ✅ **已决定** | `FluxKontextService.generate()` → `WorkflowService.createTask({ waitForResult: true })`。用同步路径保持前端「一次请求拿结果」体验 |
| **D-45** | 依赖方向铁律 | ✅ **已决定** | 基础设施（ai/workflow/storage/credit/billing/auth/admin/db/services）**禁止** import 产品层。`npm run audit:architecture` 静态守卫，违反退出码 1 |
| **D-46** | 通用工具归位 | ✅ **已决定** | `getClientIpFromHeaders` / `verifyTurnstileToken` / `verboseLog` 从产品模块移到 `src/lib/utils/request.ts`（它们与 Flux 无关，原先导致通用路由反向依赖产品） |
| **D-47** | 价格 vs 账本 | ✅ **已决定** | **价格计算**属产品层（`products/flux-kontext/credits.ts`）；**账本操作**属基础设施（`WorkflowService` → 原子 RPC）。Flux 不碰 `users.credits` |
| **D-48** | 删除 `flux-bridge.ts` | ✅ **已决定** | Flux 已走真实 `ai_task`，不再需要审计桥接。删除（Phase 7 的 best-effort 记录退役） |
| **D-49** | 内容安全 / Turnstile 的归属 | ✅ **已决定** | 属 **Flux 产品策略**，留在产品入口（route），不进基础设施 |
| **D-50** | 遗留支付簇 | 🟡 **延后 Phase 9** | `lib/database.ts`（伪 Prisma，9 处引用）/ `lib/payment*` 不属 Flux 解耦范围，留 Phase 9 模板清理（见 `PHASE_8_FOLLOWUPS.md` F8-1） |

---

## D-11｜订单状态词表（Phase 4）

### 历史决策（Phase 1 / Phase 3）

Phase 1 审计发现 `orders.status` 的词表不统一：

- SQL 的 CHECK 允许 `pending / created / completed / failed / refunded / cancelled / expired`
- 但代码同时用 `created`（表示「已建 checkout 会话」）与 `completed`（表示「支付成功」）
- 「支付成功」没有一等状态，只能借用语义模糊的 `completed`

Phase 3 建立统一 `orders` 表时保留了原词表（当时的目标是数据基础，不是业务语义）。

### 最终决策

**已解决（Phase 4）。** 确立目标词表并回填历史数据：

| 目标词表 | 含义 |
|---|---|
| `pending` | 已创建订单，等待支付 |
| `paid` | **支付成功**（新的一等状态） |
| `failed` | 渠道拒付 |
| `cancelled` | 用户取消 |
| `refunded` | 已退款 |
| `expired` | 待支付超时 |

兼容处理（用户约束 §6「先兼容并统一语义」）：

- `completed` → `paid`、`created` → `pending` 已在迁移 0006 回填
- 两个旧值**仍保留在 CHECK 约束里**，避免历史数据读取失败
- 新代码只使用目标词表

同时把 `paid` 与「已交付」拆开：`status='paid'` 表示钱到了，
`fulfilled_at` 非空表示东西给出去了。两者分离才能识别
「已付款未交付」（交付失败时可据此重试）。

---

## D-12｜价格真相归属（Phase 4）

### 历史决策（Phase 1）

Phase 1 发现定价散落在 **4 处**且互相不一致：

| 位置 | 问题 |
|---|---|
| `src/lib/payment-security.ts` `STANDARD_PRICING` | 服务端校验用，**浮点**（9.90 / 29.90） |
| `src/lib/payment/creem.ts` `CREEM_PRODUCT_IDS` | 渠道产品映射 |
| `src/lib/services/pricing.ts` | 定价页展示（字符串价格） |
| `src/lib/user-tiers.ts` `pricingPlans` | 死代码 |

### 最终决策

**已解决（Phase 4）。建立 `src/config/billing.ts` 作为服务端唯一价格真相。**

关键决策：

1. **静态 TypeScript 配置，不是数据库表。**
   理由：产品套餐是发布时确定的，不需要后台动态改价；
   放进数据库会引入「配置表 + 缓存 + 迁移」的额外复杂度
   （用户约束 §5：不要为了抽象创建过度复杂的数据库模型）。
   接口（`getBillingPackage`）保持不变，将来真要后台改价时替换实现即可。

2. **金额使用整数最小单位（美分）**，禁止浮点。
   `19.99 * 100` 在 JS 里得到 `1998.9999999999998`。
   `orders` 新增 `amount_minor INTEGER` 作为权威金额，
   `amount DECIMAL` 保留供展示与旧代码读取，两者由同一整数源派生。

3. **服务端忽略客户端传来的价格**（用户约束 §21）。
   checkout 只接受 `packageId`（或旧的 `productId` + `billingCycle`）。
   已加架构守卫测试：直接读路由源码断言它不读 `body.price/amount/credits`。

4. **⚠️ 记录一个渠道机制差异**：Creem 的扣款金额由 **Creem 后台产品价格**决定，
   我们传的 amount 只进 metadata；Stripe 则由我们用服务端金额动态创建价格。
   因此 `src/config/billing.ts` 必须与 Creem 后台**手工保持一致**。
   这是 Creem 的机制限制，不是设计选择（见 `docs/BILLING.md` §4.3）。

---

## D-13｜退款后是否扣回积分（Phase 4）

### 历史决策（Phase 1）

Phase 1 未涉及退款细节，只记录了「`subscriptions` / 支付链路存在 mock」。

### 最终决策

**🟡 明确不做（Phase 4 deferred）。**

用户约束 §22 要求：只保留基础 refund 状态；如果当前项目没有明确退款业务规则，
**不要自行设计**，记录为 limitation。

因此 Phase 4 只做到：

- 支持 `paid → refunded` 状态流转（由渠道退款事件驱动）
- 退款事件本身纳入 Webhook 幂等（`webhook_events`）

**未做**：部分退款、退款金额校验、**积分扣回**、退款流水记录。

**为什么不自动扣回积分**：退款后用户可能已经消费了积分。
「扣回多少、余额不足怎么办、是否允许负余额」是业务决策，
当前项目没有规则，因此不自行设计。需要时再定规则实现。

详见 `docs/BILLING.md` §10。

---
---

## D-1｜订单表统一：`orders` vs `payment_orders`

### 历史决策（Phase 1）

审计发现同一个「订单」概念存在两张表：

| 表 | 定义位置 | 使用方 |
|---|---|---|
| `payment_orders` | `scripts/setup-database.sql:28`（字段完整） | `api/payments/create-checkout`、`lib/payment-security.ts`、`api/debug/*` |
| `orders` | **SQL 中不存在** | `src/lib/database.ts`（8 处，`paymentOrder` 模型） |

问题链：

1. `create-checkout` 写入 `payment_orders`
2. `lib/payment.ts:344 handleStripeSuccess()` 从 `orders` 读订单 → 读不到
3. `lib/payment/creem.ts:293 handleCheckoutCompleted()` 也从 `orders` 读 → 读不到
4. **结果：用户支付成功，但系统找不到订单，积分 / 订阅发放流程中断**

这是全项目最严重的缺陷，也是「Payment 可以正常创建订单」验收标准无法通过的直接原因。

当时提出的方案是：保留 `orders` 作为唯一表名，因为它语义更通用，
且 `database.ts` 已有 8 处引用、`payment_orders` 的字段更完整可直接搬过来。

### 最终决策

**已解决（Phase 3）。统一为 `orders`。**

Phase 3 的审计进一步确认：二者是**同一业务概念的两个名字**，而不是
「业务订单 vs 支付渠道交易」。证据：

1. 适配器的 `PaymentOrder` 接口字段与 `payment_orders` 的列**一一对应**
2. 两者都表示「用户为某个产品下的一笔订单」，都有 `status` / `amount` / `currency` / `paid_at`
3. `orders` 在 SQL 中根本不存在 —— 它只是**适配器里写错的表名**

处理方式（`supabase/migrations/0002_orders.sql`，遵循 ADD → BACKFILL → MIGRATE → VERIFY → DEPRECATE）：

- 新建 `orders`（字段取自 `payment_orders`，provider 引用通用化）
- 从 `payment_orders` 回填（`ON CONFLICT (id) DO NOTHING`，可重复执行）
- `credit_transactions.order_id` 指向新表并回填
- `payment_orders` 保留并标记 `DEPRECATED`（**不 DROP**，保留历史数据与回滚能力）

**关于 Order ≠ Payment Transaction**：这个区分成立，但当前业务是一对一
（一次下单 → 一次支付），代码里没有任何地方需要单独记录渠道流水，
因此**不单独建 `payment_transactions` 表**。渠道侧标识由
`orders.provider_session_id` / `provider_payment_id` / `provider_refs` 承载。
将来出现「一次订单多次支付 / 退款流水 / 多渠道对账」时再拆表。
详见 `docs/DATABASE.md` §4。

**不要重新打开这个决策。**

---

## D-2｜`credit_accounts` 独立表 vs `users.credits` 单列

### 历史决策（Phase 1）

目标方案原文建议使用 `credit_account` + `credit_transaction` 两张表，
而当时余额存在 `users.credits`（INTEGER 列），没有独立的账户表。

当时的对比：

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 保留 `users.credits` | 改动最小；查询最简单；当前实现已验证可用 | 余额与用户耦合；扩展性差 |
| B. 独立 `credit_accounts` 表 | 符合目标方案原文；支持多账户 / 多积分类型 | 每次查余额多一次查询；当前只有一种积分 |

当时的倾向是 A，理由是目标方案第十五条明确说
「不要为了设计模式而设计模式」「如果一个抽象目前只有一个实现，并且未来没有明显替换需求，可以暂时保持简单」。

### 最终决策

**已决定：保留 `users.credits`，不创建 `credit_accounts`。**

Phase 3 落地时进一步明确了三条理由：

1. **移动余额 = 业务逻辑改造**。29 处代码读写 `users.credits`，改它们属于 Phase 3 禁止的范围
2. **现在建表会更危险**。它会被回填一次，但没有任何代码写入它，
   于是每做一次生成就与 `users.credits` 偏离一点 ——
   **一张立刻开始说谎的表，比没有这张表更糟**
3. 用户约束明确反对过度设计：「不要为了架构完整创建没有实际使用的 abstraction」

**补救措施**：余额的读写被**集中在 `src/lib/db/repositories/credit.ts` 一个文件里**
（`getBalance` / `adjustBalance` / `consumeCredits`）。
将来要迁移到 `credit_accounts`，只需改这一个文件，调用方无感。

迁移方案（真要做时）：

```sql
CREATE TABLE public.credit_accounts (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.credit_accounts (user_id, balance)
SELECT id, COALESCE(credits, 0) FROM public.users
ON CONFLICT (user_id) DO NOTHING;
-- 然后把 credit.ts 的 getBalance/adjustBalance/consumeCredits 指向本表，
-- 并把 users.credits 标记废弃，最后再删列。
```

**五个 Credit 概念的落位**（Phase 3.5 后）：

| 概念 | 落在哪里 |
|---|---|
| Credit Pricing Config | 配置（`ai/models.ts` 的 `credits` + 两处旧表，收敛见 L-21） |
| User Credit Balance | `users.credits` 列 |
| Credit Transaction | `credit_transactions` 表 |
| Credit Consumption | `credit_transactions` 中 `type='consume'`（旧 `usage`）的行 |
| Credit Refund | `credit_transactions` 中 `type='refund'` 的行 |

---

## D-3｜积分扣减的原子性与幂等

### 历史决策（Phase 1）

原实现（`src/lib/services/credits.ts:consumeUserCredits`）是典型的 read-check-write：

```
读取余额 → 判断是否足够 → 扣减余额 → 写流水
```

余额 100 时请求 A 与 B 同时扣 80：

```
A 读到 100，判断够扣 80
B 读到 100，判断够扣 80
A 扣 80 → 20
B 扣 80 → -60   ← 错误余额
```

Phase 1 当时提出两个候选方案：

| 方案 | 说明 |
|---|---|
| A. Supabase RPC 函数 | 一条 SQL 原子完成「判断 + 扣减」，同时天然幂等；缺点是要维护 SQL |
| B. 条件更新 + 乐观锁 | 纯 TS，`.eq('credits', current)`；缺点是需要重试逻辑，高并发下可能多次重试 |

### 最终决策

**已解决（Phase 3.5）。采用方案 A：Supabase PostgreSQL RPC。**

不采用乐观锁的理由：积分扣减本质上是**数据库事务问题**，
项目已经在用 Supabase / PostgreSQL，没有理由把这个保证放在应用层
（应用层加锁在多实例部署下也不成立）。

实现：`supabase/migrations/0005_atomic_credit_operations.sql` 的
`consume_credits(p_user_id, p_amount, p_idempotency_key, ...)`，一次调用完成：

1. `amount <= 0` → 直接失败（防止用负数反向加积分）
2. 用户不存在 → `user_not_found`（**必须在写流水之前检查**，
   否则幂等占位 INSERT 会先撞上外键约束抛异常）
3. 幂等检查（`INSERT ... ON CONFLICT DO NOTHING` 抢占幂等键）
4. 原子扣减：`UPDATE users SET credits = credits - amount WHERE id = ... AND credits >= amount RETURNING credits`
5. 写入 / 补全 `credit_transactions`（含 `balance_before` / `balance_after`）

余额更新与流水写入在同一个 PL/pgSQL 函数体内，即同一事务 ——
不会出现「扣了钱没记账」或「记了账没扣钱」。

返回值用 `status` 区分五种情况：`ok` / `insufficient` / `duplicate` /
`invalid_amount` / `user_not_found`。

**已验证**：在真实 PostgreSQL（PGlite 18.3）上跑通全部迁移与 8 组测试，
86 项检查全部通过。详见 `supabase/scripts/verify_migrations.mjs`。

**遗留**：PGlite 是单后端单连接，无法复现真正的并行执行。
并发保证依赖 Postgres 行级锁语义（第二个事务重新求值 WHERE 条件），
真正的并行验证需在有 Supabase 实例时补做。
另外 `adjustBalance`（grant / refund / 管理调整路径）仍非原子，不在本阶段范围。

---

## D-4｜是否引入 `supabase/migrations/`

### 历史决策（Phase 1）

当时项目没有任何 migration 机制，建表只有 `scripts/setup-database.sql` 一份，
靠人手动在 Supabase SQL 编辑器执行。问题：

- 无法知道线上库处于哪个版本
- 无法回滚
- 新人 setup 时不知道该执行哪些脚本
- `setup-database.sql` 本身**不幂等**（重复执行会在 `CREATE TRIGGER` / `CREATE POLICY` 报错）

当时建议新建 `supabase/migrations/` 编号 SQL 文件，
并**不引入 Supabase CLI**（避免增加复杂度），只用编号文件 + 手写执行记录。

### 最终决策

**已解决（Phase 3）。已建立编号 SQL 迁移体系。**

```
supabase/migrations/
├── 0000_baseline.sql                 当前 schema 快照（可重复执行版）
├── 0001_credit_model.sql             积分流水模型
├── 0002_orders.sql                   订单统一
├── 0003_subscriptions.sql            订阅 provider 通用化 + payment_configs 废弃
├── 0004_ai_tasks.sql                 AI 任务表
└── 0005_atomic_credit_operations.sql 积分原子扣减（Phase 3.5）
```

- **暂不引入 Supabase CLI**（项目未安装，用户约束明确禁止引入）
- 每个文件**必须可重复执行**（`IF NOT EXISTS` / 先 `DROP ... IF EXISTS`）
- 迁移安全顺序：ADD → BACKFILL → MIGRATE → VERIFY → DEPRECATE，优先保留旧表而非 `DROP`
- 静态校验：`python supabase/scripts/validate_migrations.py`
- 真实执行验证：`node supabase/scripts/verify_migrations.mjs`（PGlite）
- 执行方式与新增迁移规范：`supabase/README.md`

---

## D-5｜provider 配置方式

### 历史决策（Phase 1）

原实现是单全局环境变量 `IMAGE_GENERATION_PROVIDER`（只能选一个，且只对图片有效），
并且非法值会**静默回退 fal**。这与「不同产品用不同 provider」的目标冲突。

当时建议改用 `src/config/providers.ts` 按 modality 配置，并去掉静默回退。

### 最终决策

**已决定（以 Phase 2 实际实现为准）。本阶段不重新设计。**

Phase 2 实际采用的方案：

- 解析优先级：`request.provider`（显式）→ `AI_PROVIDER` / `IMAGE_GENERATION_PROVIDER`（环境变量，兼容旧变量）→ 模型自身的 `defaultProvider`
- **去掉了静默回退**：Provider 不支持该模型时**显式报错**
- 模型目录在 `src/lib/ai/models.ts`，每个模型声明 `defaultProvider` 与 `providers`

**未做**：按 modality 配置的 `config/providers.ts`。
当前只有图片一种 modality，等出现第二种时再做。

**不要在本阶段修改 Provider 架构。**

---

## D-6｜`subscriptions` 实现深度

### 历史决策（Phase 1）

`subscriptions` 表在 SQL 中存在且字段完整，但代码侧**完全走 mock**：
伪 Prisma 的 `create()` 返回 `Math.random()` 生成的假 id，写不进库；
`findFirst()` 在特定条件下凭空返回硬编码的 `pro-plan`。

当时的判断是：保留表 + 实现真实 Repository，但不实现续费 / proration /
按周期重置积分 / 订阅降级。

### 最终决策

**已决定（Phase 3）。已按建议执行。**

- 保留 `subscriptions` 表，并通过 `0003_subscriptions.sql` 把 provider 引用通用化
  （`provider_subscription_id` + `provider_refs`，旧两列标记废弃）
- 新增 `src/lib/db/repositories/subscription.ts` 提供**真实持久化**
- 伪 Prisma 的 `subscription` 模型已从 mock 改为委托该 Repository

**明确不实现**：订阅续费、到期处理、升降级 proration、按周期重置积分、
任何支付渠道 SDK 调用。

---

## D-7｜`users` 表的 `signin_*` 遗留字段

### 历史决策（Phase 1）

`users` 表有 7 个第三方登录遗留字段：`signin_type` / `signin_provider` /
`signin_openid` / `signin_ip` / `location` / `preferred_currency` /
`preferred_payment_provider`。这些字段与当前 NextAuth 实现没有真正对应关系
（`signin_ip` 永远写 `'unknown'`，`location` 永远写 `'US'`，
`preferred_payment_provider` 没有任何代码读取）。

当时建议全部删除，只保留 `id` / `email` / `name` / `image` / `credits` / 时间戳。

### 最终决策

**🟡 延后到 Phase 6。Phase 3 / 3.5 不处理。**

原因：删除这 7 个字段需要同步修改 4 处建号逻辑（`auth.ts`、`user/ensure`、
`user/credits` 自动建号、`database.ts` 适配器），属于业务逻辑改造，
超出数据库阶段的范围。

**✅ 2026-09-25 更新（修复批次，见 F-2）**：审计后**决定不删列**。

逐字段核实发现 `signin_provider` / `last_signin_at` 已被 Admin 用户列表与详情页
展示使用 —— 删列会破坏已交付的 Admin 功能，收益低、风险高。

实际处理改为三件事：
1. 删除 189 行**死代码**（`src/lib/services/user.ts` 三个导出零引用、
   `src/lib/types/user.ts` 仅被前者引用）
2. 清理 `auth.ts` 的 4 个无用 import
3. **停止写入无意义的 `signin_ip`**（历史恒为 `'unknown'`，从未记录真实 IP）
4. 在 `UserRow` 上加逐字段说明，标注「不要当可靠审计数据使用」

---

## D-8｜`docs/` 目录清理

### 历史决策（Phase 1）

`docs/` 有 52 个文件，其中约 30 个是「小白 Next.js 完全理解指南」这类教程，
与模板本身无关；另有约 7 个一次性报告 / 计划类文件。

当时建议分三类：架构/部署/配置类保留并更新；教程类删除或归档；
一次性报告删除。

### 最终决策

**🟡 延后到 Phase 6。**

Phase 3 / 3.5 只**新增**文档（`DATABASE_AUDIT.md`、`DATABASE.md`），不删除既有文件。

**✅ 2026-09-25 更新（修复批次，见 F-13）**：已执行。

1. 先用 grep 核实**代码不引用**任何遗留文档
   （代码只引用 `BILLING.md` / `DATABASE.md` / `DATABASE_AUDIT.md`，三者保留）
2. `git mv` 把 **53 个**模板遗留文件移入 `docs/archive/`（保留 git 历史，可逆）
3. `docs/` 只留 **14 个**有效文档
4. 新建 `docs/archive/README.md` 说明分类、取回方式，并标注 4 个
   「仍可能有参考价值」的文件

---

## D-9｜多语言（16 语言）保留策略

### 历史决策（Phase 1）

项目有 22 个 locale 页面与 6 个含 16 语言文案的 JSON 文件，
每一处都写着产品品牌名。全部替换等于 22 个页面 × 16 语言 × 多处品牌词。

当时建议保留多语言能力，但把文案中的品牌词改为 `{{projectName}}` 占位符
（`site-config.ts` 已有 `replaceSiteTokens()`），并用脚本批量替换而非手改。

### 最终决策

**🟡 延后到 Phase 6。**

Phase 3 / 3.5 不触碰 i18n（用户约束明确禁止）。

**✅ 2026-09-25 更新（修复批次）**：**决定保留全部语言，不做裁剪**。

核实结论：多语言能力是**在用**的完整链路 ——
`content/*.json`（6 个文案文件）+ `content/locale.ts`（`SUPPORTED_LOCALES`）+
`seo/metadata-generator.ts` + `app/sitemap.ts` + `app/robots.ts` + `/zh` `/tr` 等路由
全部正常工作。

「把文案中的品牌词改为占位符」这一项**未做**，但不影响功能 ——
`site-config.ts` 的 `replaceSiteTokens()` 机制仍在。若将来要做模板分发，
可作为独立任务处理。

---

## D-10｜伪 Prisma 适配器（`src/lib/database.ts`）

### 历史决策（Phase 1）

`src/lib/database.ts`（793 行）导出一个叫 `prisma` 的对象，但**不是 Prisma**：

- `user` 模型真实实现
- `paymentOrder` 真实实现但表名错误（查不存在的 `orders`）
- `creditTransaction` / `subscription` / `paymentConfig`：**mock**
- `groupBy` / `aggregate`：**返回伪造的统计数字**

问题：① 名字叫 `prisma` 却不是 Prisma，严重误导；
② 一半真实一半 mock，调用方无法判断；
③ 模仿 Prisma 语法导致复杂查询无法表达。

当时建议删除，改为显式 Repository。

### 最终决策

**🟡 过渡完成（Phase 3）。Phase 6 删除。**

Phase 3 的做法是**保留适配器但移除全部 mock**：

| 模型 | 修复前 | 修复后 |
|---|---|---|
| `paymentOrder` | 查不存在的 `orders` 表 | 查真实存在的 `orders` 表 |
| `creditTransaction` | `create()` 返回假对象 | 真实写入 `credit_transactions` |
| `subscription` | `create()` 返回随机 id | 真实写入 `subscriptions` |
| `paymentConfig` | 返回硬编码对象 | **已移除**（配置不属于数据库） |
| `groupBy` / `aggregate` | 返回伪造数字 | **已移除**（真实统计在 Order Repository） |

保留适配器的原因：Phase 3 明确禁止重构业务逻辑，
直接删除会迫使 30+ 处业务调用点同时改写。
**修好数据层、业务层不动** —— 所有既有调用方自动获得真实持久化能力。

**Phase 6 计划**：把业务调用点逐步改为直接用 Repository，然后删除本文件。

**⚠️ 2026-09-25 更新（修复批次）**：**Phase 6 未执行此项，文件仍存在**。

核实结果：`src/lib/database.ts` 仍被 **5 处**引用 ——

| 引用方 | 用途 |
|---|---|
| `src/lib/services/credits.ts` | 查 `users.credits` / 建流水（**核心链路**） |
| `src/lib/payment/creem.ts` | 兼容层 |
| `src/lib/payment-security.ts` | 兼容层 |
| `src/app/api/auth/register/route.ts` | 建号 |
| `src/app/api/debug/users/route.ts` | debug |

**✅ 2026-09-29 复核：本决策已闭合（Phase 9.1 / 9.2 / 9.3）。**

上面 5 处引用**全部消失**，`src/lib/database.ts` **已删除**（约 700 行）：

| 引用方 | 结局 |
|---|---|
| `src/lib/services/credits.ts` | 仍在，但改为调用 `src/lib/db/repositories/credit.ts`（Phase 9.1 迁移）；现只剩 `checkUserCredits` / `consumeUserCredits` 两个薄函数 |
| `src/lib/payment/creem.ts` | **已删除**（Phase 9.2，整个 `src/lib/payment/` 目录不存在） |
| `src/lib/payment-security.ts` | **已删除**（Phase 9.2） |
| `src/app/api/auth/register/route.ts` | 仍在，改用 Repository |
| `src/app/api/debug/users/route.ts` | **已删除**（Phase 9.3，连同其余 7 个 debug 路由） |

**防复活守卫**：`npm run audit:architecture` 检查 ① `src/lib/database.ts` 文件不存在
② 没有任何文件 import `@/lib/database`。违反 → `npm run verify` 第 3 步 FAIL。

> 当初估计「30+ 处业务调用点」，Phase 9.1 实际只迁了 **9 处** ——
> 因为 Phase 8 / 9.2 / 9.3 的清理已经先消化了大部分。

对比 Phase 3 当时的「30+ 处」，依赖已**大幅收敛**（业务层与 API 层基本已改用 Repository），
但**尚未归零**，因此不能删除。

**后续**：把这 5 处迁移到 Repository 后即可删除本文件。
其中 `payment/creem` / `payment-security` 属 Phase 8 待决簇（F6.5-6），
`debug/users` 属 Phase 8 删除目标。**实际只需先处理 `services/credits.ts` 与 `auth/register`。**
在此之前，**不要在这里新增 mock，也不要新增业务规则**。

---

## 附一：Phase 1 发现、已在 Phase 2 / 3 / 3.5 直接处理的缺陷

以下属于「明确是 bug」，不涉及设计取舍，未走决策流程：

| ID | 问题 | 处理阶段 | 处理方式 |
|---|---|---|---|
| B-1 | 订单表双轨 | Phase 3 | 统一为 `orders`（迁移 0002） |
| B-2 | `creemCheckoutId` camelCase 写库静默失效 | Phase 3 | 改为 `provider_session_id` |
| B-3 | `creditTransaction` 是 mock，流水不落库 | Phase 3 | 改为真实持久化 |
| B-4 | `subscription` 是 mock | Phase 3 | 改为真实持久化 |
| B-5 | `groupBy` / `aggregate` 返回伪造统计 | Phase 3 | 移除，改用 Repository 真实统计 |
| B-6 | `type='gift'` 违反 CHECK 约束 | Phase 3 | 放宽并补齐 `type` 词表（迁移 0001） |
| B-10 | 55s 超时后不退款 | 未处理 | 见附二 |
| B-13 | `session` 不含 `user.id` | 未处理 | 见附二 |
| B-17 | `router.ts` 把 HK/TW 当独立国家 | 未处理 | 见附二 |
| B-20 | 开发环境硬编码后门账号 | 未处理 | 见附二 |
| B-21 | 限流器计数器全局共享、窗口按路径区分 | 未处理 | 见附二 |
| — | `orders.expired_at` 列缺失，导致订单清理条件被静默忽略 | Phase 3 | 补列（迁移 0002） |
| — | 用户不存在时 RPC 先撞外键约束抛异常 | Phase 3.5 | 调整检查顺序（迁移 0005） |

## 附二：仍未处理、已排期的缺陷

| ID | 问题 | 位置 | 计划阶段 |
|---|---|---|---|
| B-7 | `register` 写不存在的 `password` 列 | `api/auth/register` | Phase 6（随 debug 路由一起清理） |
| B-8 | R2 public URL 用 S3 API 端点 | `r2-storage.ts` | Storage 阶段 |
| B-9 | `R2_PUBLIC_URL` / `R2_CUSTOM_DOMAIN` 未使用 | 全项目 | Storage 阶段 |
| B-10 | 55s 超时后不退款 | `api/flux-kontext` | Credit 收敛阶段 |
| B-11 | 余额调整非原子（grant/refund 路径） | `credit.adjustBalance` | Credit 收敛阶段（消费路径已在 Phase 3.5 解决） |
| B-12 | 积分价格表两份 | `flux-kontext-request.ts` / `services/credits.ts` | Credit 收敛阶段 |
| B-13 | `session` 不含 `user.id` | `auth.ts` | Phase 6 |
| B-14 | 支付配置三处真相 | `config/payment.ts` / env / mock | Phase 3 部分处理（移除 DB 来源），剩余在 Payment 阶段 |
| B-15 | 两个重复的下单入口 | `api/payment/create-session` | Phase 6 |
| B-16 | 生成历史从不落库 | `generations` | Phase 3 已建 `ai_tasks` 承载，接线在 Workflow 阶段 |
| B-17 | `router.ts` 把 HK/TW 当独立国家 | `payment/router.ts` | Phase 6（删除该文件） |
| B-18 | 前端 3 处重复 fetch | `FluxKontextGenerator.tsx` | Phase 6 |
| B-19 | `package.json` name 仍是 `nextjs-shadcn` | `package.json` | Phase 7 |
| B-20 | 开发环境硬编码后门账号 | `auth.ts` | Phase 6 |
| B-21 | 限流器计数器全局共享但窗口按路径区分 | `src/proxy.ts` | Phase 6/7 |

---

## Phase 7 决策详情（Workflow / Async Task Engine）

### D-34｜ai_tasks 状态词表

采用迁移 0004 的 CHECK 词表 `pending / processing / completed / failed / cancelled` 作为唯一真相。
规格 §6 建议的 `CREATED / RUNNING / COMPLETED / FAILED / CANCELLED` 与此一一对应
（`pending≡CREATED`、`processing≡RUNNING` 等）。不另建大写枚举，避免一层恒等映射。

### D-35｜状态机集中管理

所有状态推进只经过 `src/lib/db/repositories/ai-task.ts` 的 `transitionStatus()`，
其内部调用 `state-machine.assertTransition()` 校验合法性。非法转换
（`completed→processing`、`failed→processing`、`cancelled→completed` 等）直接抛
`InvalidTaskTransitionError`，不会落库。Repository 的通用 `update()` 仅供 Workflow 内部写非状态列。

### D-36｜Credit 生命周期

- **创建任务**：`settlement.chargeTask()` → `credit.consumeCredits()`（原子 RPC + 幂等键 `task:<id>:charge`）。
- **失败 / 超时**：`settlement.refundTask()` → `credit.grantCredits()`（type=`refund`，同一幂等键 `task:<id>:refund`）。
- 当前 credit 模型是「消费即扣，失败即退」，**没有** reserve→settle 两阶段；因此迁移 0009
  只加 `credits_used` + `credits_refunded`，没有 `credits_reserved` 冗余列。

### D-37｜同步 / 异步 Provider 统一

`WorkflowService.createTask()` 默认异步（`waitForResult:false`）：提交后立即返回 taskId，
客户端轮询。同步 Provider 或旧链路可传 `waitForResult:true` 走阻塞路径
（`runSynchronously`：pending→processing→completed）。两条路径最终都产出同一个 `AITask` 领域对象。

### D-38｜Webhook 幂等

`WorkflowService.handleWebhook()`：
1. 验签（`AIService.verifyWebhook`）；无密钥的 Provider 返回 501 而非伪造通过。
2. 解析 payload（best-effort，`parseWebhookPayload`，解析不出即 400 不猜）。
3. 按 `(provider, provider_task_id)` 定位任务。
4. 已是终态 → 返回 `{ duplicate: true }`，**不重复处理 / 不重复退款**。
5. 退款用固定幂等键 `task:<id>:refund`，与扣费键分离。

### D-39｜任务创建幂等键

`ai_tasks` 上有唯一索引 `uniq_ai_tasks_idempotency (user_id, idempotency_key)`。
`createTask()` 先查 `findByIdempotencyKey`，命中即返回既有任务；Repository 的 INSERT 也带
`on conflict do nothing` 双保险。

### D-40｜用户任务隔离

`getTask(taskId, { userId })` 与 `listUserTasks(userId)` 都按 `user_id` 强制收窄。
API 层**绝不**读取客户端传入的 `userId`。用户枚举 task id 也只能看到自己的（返回 null）。

### D-41｜Flux 兼容层边界

`src/lib/workflow/flux-bridge.ts` 在 Flux 生成前后 best-effort 写一条审计 ai_task
（`tryCreateFluxTask` / `tryCompleteFluxTask` / `tryFailFluxTask`），**所有写库动作吞异常**，
记录失败不影响生成。Phase 8 才把 Flux 真正统一到 `WorkflowService`，届时删除该桥接。

### D-42｜Polling 策略

不做独立 worker / 消息队列。采用 lazy polling：
- 用户查询进行中任务（`GET /api/ai/tasks/:id`）时，服务端顺带触发一次 `pollTask()`；
- Admin 提供 `POST /api/admin/ai-tasks/poll` 批量兜底（扫描 `processing` 且带 `provider_task_id` 的任务）。
未来需要真正后台调度时，只需新增一个独立进程调用 `pollRunningTasks()`，架构不动。

---

## Phase 8 决策详情（Flux Business Decoupling）

### D-43｜Flux 的归属

Flux Kontext 从「系统核心」降级为「产品」：
- 代码：`src/lib/products/flux-kontext/{service,actions,types,credits,index}.ts`
- 依赖方向：**只能** Flux → 基础设施（AI / Workflow / Credit / Storage / Auth / Billing / Admin / DB）。
- 基础设施**不得** import 产品层（D-45 守卫）。

### D-44｜Flux 接入 Workflow 的入口

```ts
WorkflowService.createTask({ userId, model, provider, prompt, inputImages, parameters, waitForResult: true })
```

用 `waitForResult: true`（Phase 7 的同步路径）保持 `/api/flux-kontext` 的
「一次请求拿到结果」体验。若未来 Flux 改异步，去掉该标志即可，前端改轮询。

### D-45｜依赖方向铁律

新增 `scripts/audit-architecture.mjs`（`npm run audit:architecture`）：
扫描 10 个基础设施目录下所有文件的 import 说明符，若指向产品层（`products/flux-kontext` /
`flux-kontext*` / `image-generation`）即判违规、退出码 1。

本阶段修复的 3 处反向依赖：
1. `lib/services/credits.ts` → `flux-kontext-request`（删除 Flux 专用的
   `consumeCreditsForImageGeneration` 后消失）
2. `app/api/ai/image/route.ts` → `flux-kontext-request`（通用工具移到 `utils/request.ts` 后消失）
3. `lib/workflow/flux-bridge.ts`（整文件删除）

### D-46｜通用工具归位

`getClientIpFromHeaders` / `verifyTurnstileToken` / `verboseLog` 与 Flux 无关，
原先却住在产品模块里，导致通用的 `/api/ai/image` 反向依赖产品。
移到 `src/lib/utils/request.ts`。

### D-47｜价格 vs 账本

- **价格计算**（`getRequiredCredits(action)`）→ 产品层 `products/flux-kontext/credits.ts`。
  真相仍是 `config/credits.ts` 的 `CREDIT_COSTS`。
- **账本操作**（consume / refund）→ 基础设施 `WorkflowService` → `settlement.ts` → 原子 RPC。
- Flux **不碰** `users.credits` / `credit_transactions`。

### D-48｜删除 `flux-bridge.ts`

Flux 现在走真实 `ai_task`（经 WorkflowService），不再需要 Phase 7 的审计桥接。
删除后全项目 0 引用。

### D-49｜内容安全 / Turnstile 的归属

二者是 **Flux 产品策略**（不是通用基础设施要求），保留在产品入口 `route.ts`：
- `checkPromptSafety` / `checkImageSafety`（受 `NEXT_PUBLIC_ENABLE_CONTENT_SAFETY` 控制）
- `verifyTurnstileToken`（受 `NEXT_PUBLIC_ENABLE_TURNSTILE` 控制）

### D-50｜遗留支付簇

`lib/database.ts`（伪 Prisma）/ `lib/payment*` 与 Flux 无关，不属本次解耦范围。
删除需迁移 9 处引用，留 **Phase 9** 模板清理（见 `PHASE_8_FOLLOWUPS.md` F8-1）。
