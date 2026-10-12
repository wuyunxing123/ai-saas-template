# AGENT_GUIDE.md — Coding Agent 开发约束

> 更新时间：2026-10-10 · 对齐 Phase 9.8.2-D
> 读者：**Codex / Claude Code / WorkBuddy / Qoder 等 Coding Agent**，以及第一次接手的人类开发者。
>
> 前置阅读：[`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md)（架构与边界）。
> 本文只讲**动手时必须遵守什么**，不重复架构说明。

---

## 0. 最重要的一条

> **这个仓库已经有完整架构了。你的默认动作是「找到现有的那一个并用它」，不是「新建一个」。**

Phase 2 ~ 9.6 的全部内容就是在**消除重复实现**：
删掉了伪 Prisma 适配器（700 行）、删掉了 18 个 legacy payment 文件、
把散在两处的价格表收敛成一处、把 R2 调用收进一个 provider。

**再引入一套平行实现，等于把这些阶段全部回退。**

如果你发现「现有的抽象不好用」，正确动作是**停下来报告**，不是绕过去自己写一套。

---

## 1. Before coding — 必须做

### 1.1 必须读

按顺序，最少读到第 3 条：

1. [`docs/MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md) —— 架构、依赖方向、Core/Product 边界、
   **§5.4 已知边界例外**（避免你把既有耦合误当成「可以照抄的模式」）
2. 与你任务相关的主题文档：
   `AI_CORE.md` / `WORKFLOW.md` / `BILLING.md` / `DATABASE.md` / `STORAGE.md` / `ADMIN.md` /
   `FLUX_PRODUCT.md`
3. [`docs/PROJECT_STATUS.md`](./PROJECT_STATUS.md) §8 —— 命令速查
4. 如果任务涉及「加第二个产品」：[`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md)

**不要读**（会把你会带错路）：
- `docs/archive/ARCHITECTURE.md` —— **Phase 1 历史快照**（2026-09-30 从 `docs/` 移入 archive），标题里的「当前」是历史遗留，内容已失效
- `docs/archive/**`（55 个文件）—— 模板遗留，路径多数不存在
- `docs/PHASE_*_AUDIT.md` —— 动手前的只读快照，描述的是**当时**的状态

### 1.2 必须搜索现有实现

在写任何新文件之前，先搜。这个仓库里下列东西**都已经有了**：

| 你想做的事 | 已有的那一个 |
|---|---|
| 调 AI 生成 | `AIService.generate()` / `WorkflowService.createTask()`（`src/lib/ai/service.ts`、`src/lib/workflow/service.ts`） |
| 扣积分 / 退积分 | `WorkflowService`（内部 `consume_credits` / `grant_credits` RPC）；余额查询 `checkUserCredits()` |
| 发放订单积分 | `src/lib/billing/fulfillment.ts` 的 `fulfillOrder()` |
| 存文件 | `StorageService.saveGeneratedAsset()` / `upload()`（`src/lib/storage/service.ts`） |
| 读写数据库 | `src/lib/db/repositories/*`（7 个） |
| 拿当前用户 | `getCurrentUser()` / `getCurrentUserId()`（`src/lib/auth-session.ts`） |
| 判断是否 Admin | `withAdmin`（路由包装）/ `requireAdmin()` / `getAdminContext()` |
| 取价格 | `src/config/billing.ts` 的 `getBillingPackage()`（**机制**；套餐**数据**在 `src/lib/products/<id>/billing.ts`） |
| 取积分成本 | 产品目录的模型 `credits` 字段（Flux：`products/flux-kontext/catalogue.ts`，经 `products/flux-kontext/credits.ts` 的 `getRequiredCredits()`）。`src/config/credits.ts` **已删除** |
| 取产品配置（模型 / Provider / 套餐 / 免费档） | `src/config/product.ts` 的 `getProductConfig()`；服务端入口必须先 import 装配点 `src/app/product-runtime.ts`，否则**抛错**而不是回退 |
| 站点名 / URL 拼接 | `src/lib/site-config.ts` 的 `siteConfig` / `withSiteUrl()` / `withApiUrl()` |
| 语言 / 本地化路径 | `src/lib/content/locale.ts` |
| 多语言 metadata / sitemap | `src/lib/seo/metadata-generator.ts` |
| 生成 object key | `src/lib/storage/keys.ts` 的 `buildObjectKey()` |
| 任务日志 | `src/lib/workflow/logger.ts`（已内置敏感字段脱敏） |
| 限流 / 安全头 / HTTPS 跳转 | `src/proxy.ts` |
| 分页 | `src/lib/admin/pagination.ts` 的 `parsePagination()` / `toPaginated()` |
| 客户端 IP / Turnstile | `src/lib/utils/request.ts` |
| 订单号 / ID 生成 | `src/lib/utils/hash.ts` 的 `generateOrderNo()` / `getUuid()` / `getSnowId()` |

### 1.3 必须检查边界

动手前回答这两个问题：

**Q1：这个需求属于 Core 还是 Product？**
- 含具体产品名 / 品牌 / 产品参数语义 → **Product**（`src/lib/products/<product>/`）
- 产品无关的通用能力 → **Core**
- ⚠️ 名字有三类，别混：**母版身份** `ai-saas-template`（package/PWA/env 默认值，属 Core 元数据）、
  **产品品牌**（`NEXT_PUBLIC_PROJECT_NAME` → `siteConfig.projectName`，唯一读取点）、
  **上游归属**（`CharlieLZ/flux-kontext-template` 的 `LICENSE` 版权行 —— MIT 的署名条件，**不得改写**）。
  新产品换品牌只动 env，不改母版名；看到旧仓库名先问它是哪一类，只有第一类该改。

**Q2：我要改的目录，允许依赖 Product 吗？**

```
src/lib/{ai,workflow,db,billing,storage,admin,services,content,content-safety,seo,utils}/
src/config/
    → ❌ 禁止 import @/lib/products/*
      守卫：npm run verify:product-boundary + npm run audit:architecture（都会 exit 1）

src/app/api/<product>/**、src/app/<product-page>/**、src/components/<product>/**
    → ✅ 允许（这就是产品的对外面）
```

---

## 2. Before coding — 禁止

以下每一条都对应一次已经付出代价的返工。**没有例外。**

### 2.1 禁止创造第二套架构

- ❌ 新建一个 `XxxService` 来做 `AIService` / `WorkflowService` / `BillingService` 已经做的事
- ❌ 新建一个 `xxxRepository` 来访问已有的表
- ❌ 新建第二个价格表 / 积分成本表 / 模型目录
- ❌ 新建第二个「拿当前用户」的函数
- ❌ 新建第二套任务状态枚举

### 2.2 禁止绕过 Core

- ❌ Product 直接 import `@/lib/ai/providers/*`（fal / kie / wavespeed / atlascloud）
- ❌ 任何业务代码直接 import `@aws-sdk/client-s3`
  —— 全仓库唯一允许的文件是 `src/lib/storage/providers/r2.ts`
- ❌ 任何业务代码直接 import `stripe` 或调用 Creem HTTP API
  —— Stripe SDK 只在 `src/lib/stripe-client.ts` 懒加载
- ❌ 业务代码 `createAdminClient()` / `createClient()` 后直接 `.from('表名')`
  —— 必须走 `src/lib/db/repositories/*`
- ❌ 自己实现积分扣减（哪怕是「先 SELECT 再 UPDATE」）
  —— 只有 `consume_credits` RPC 是原子的；`adjustBalance()` **非原子**，禁止用于消费路径
- ❌ 从**请求体**读取 `price` / `amount` / `credits` / `role` / `userId`
  —— 价格只从服务端解析出的**产品套餐表**（客户端只发内部 `packageId`），身份只从 session
- ❌ Product 自己实现 Auth 或支付

### 2.3 禁止复活已删除的 legacy 架构

这些**已被删除且有守卫**，重新引入会让 `npm run verify` 直接失败：

| 已删除 | 删除于 | 守卫 |
|---|---|---|
| `src/lib/database.ts`（伪 Prisma 适配器，约 700 行） | Phase 9.1 | `audit:architecture` 检查文件不存在 + 无人 import `@/lib/database` |
| `src/lib/payment/`（`creem.ts` / `stripe.ts` / `router.ts` / `amount.ts` 等 18 个文件） | Phase 9.2 | — |
| `src/lib/payment-security.ts` | Phase 9.2 | — |
| `src/lib/flux-kontext.ts`（旧兼容层） | Phase 8 | `audit:architecture` 禁止 import `@/lib/flux-kontext` |
| `src/lib/image-generation/` | Phase 8 | 同上（禁止 import `@/lib/image-generation`） |
| `src/lib/services/{order,pricing,r2-storage,payment-config,payment-database}.ts` | Phase 9.1~9.3 | `audit:dead-files` |
| `src/lib/content-safety/index.ts`（581 行单体实现） | 死代码清理 | `audit:dead-files` |
| `src/lib/types/order.ts`、`src/lib/utils/{ip,response}.ts` | 死代码清理 | `audit:dead-files` |
| `src/lib/workflow/flux-bridge.ts` | Phase 8 | — |
| `scripts/{check-config,test-api,quick-setup,check-supabase,check-seo,performance-check}.js` | Phase 9.6 | — |
| 根目录 `env.example`（252 行旧示例） | Phase 9.6 | 唯一示例文件是 `.env.example` |

**特别注意**：不要重新引入 Prisma。这个仓库**没有** Prisma，**没有** `schema.prisma`，
从来没有过真正的 Prisma —— 那个「长得像 Prisma」的东西就是被删掉的 `database.ts`。
数据访问是手写 Repository + `src/lib/db/types.ts` 里的手写行类型。

被删的 6 个脚本里，有几个是**故意退役**的，不要用「补一个更好的版本」的名义复活：
- `check-config.js` —— 报 3 个 ❌ 仍打印「配置检查通过」且 exit 0（假绿）；能力已被 `audit:env` 覆盖
- `performance-check.js` —— 实为 `execSync('npm run build')` + 打印硬编码营销文案（「+60%」非测量值）
- `check-seo.js` —— canonical 判定假阴性，退出码恒 0

### 2.4 禁止为单一 Product 修改 Core

> **禁止为了一个 Product 需求直接修改 Core。**

需要 Core 新能力时的正确顺序：
1. 把它设计成**产品无关**的通用能力（签名、类型、默认值里都不出现产品名/品牌/产品参数）
2. 在 Core 实现，并给它加验证（`scripts/verify-*.ts`）
3. Product 再消费它
4. 判定「到底通不通用」要有客观标准，不能只靠自述：**换一个产品它还跑得动吗？**
   9.8.2-D 用 Product B 实测抓到过两类伪装成通用代码的产品耦合：
   共享组件按**固定下标**取文案条目（等于要求每个产品都提供同样条数，产品条目少则整页 SSR 抛错），
   以及验证脚本白名单里硬写某个产品的文件名。前者改为遍历文案、装饰图标按下标取模；
   后者改由该产品的 `layout-debt.json` 声明

### 2.5 禁止擅自扩大范围

- ❌ 新增依赖（`package.json`）—— 除非任务明确要求
- ❌ 新增测试框架（vitest / jest / playwright）—— Phase 9.6 已明确决策不引入
- ❌ 修改 DB schema / 新增 migration —— 除非任务明确要求
- ❌ 顺手重构、顺手清理、顺手改格式
- ❌ 新增 Queue / Worker / Temporal / cron
- ❌ 改 `.github/workflows/*` 加自动触发 —— 「CI 只在本地跑」是仓库既有策略
- ❌ 重写 `docs/archive/**`

**如果你在做 A 的时候发现了 B 的问题**：
把 B 写进当前阶段的 `docs/PHASE_*_FOLLOWUPS.md`，然后**继续做 A**。不要顺手修 B。

---

## 3. 这个仓库特有的坑

### 3.1 Next.js 16，不是你训练数据里的那个

根目录 `AGENTS.md` 有强制要求：写框架相关代码前先读 `node_modules/next/dist/docs/`。

最直接影响：

> **本仓库没有 `middleware.ts`。边缘层入口是 `src/proxy.ts`，导出 `proxy(request)`，
> `config.matcher = ['/api/:path*']`。**

不要「修复」成 `middleware.ts`。`scripts/audit-dead-files.mjs` 的框架入口白名单里两者都认，
但本项目用的是 `proxy`。

### 3.2 `scripts/**` 不在 tsconfig 里

`tsconfig.json` **排除了 `scripts/**/*`**，ESLint 也忽略 `scripts/**` 与 `docs/**`。
所以 `scripts/verify-*.ts` 是靠 **jiti** 跑的：

```bash
node scripts/run-ts.mjs scripts/verify-workflow.ts
```

不是 `tsx`，不是 `node --experimental-strip-types`。新增验证脚本沿用这个方式，
文件名匹配 `scripts/verify-*.ts` 就会被 `verify-all.mjs` **自动发现**，无需改注册表。

### 3.3 产品专属断言写进带 `@product-scope` 的脚本，不写进共用脚本

`scripts/verify-*.ts` 的分工按**测试对象**划：

- **共用脚本**（`verify-ai-core.ts` / `verify-billing.ts` / `verify-workflow.ts` …）
  只断言**通用机制**，零产品字面量：模型 / 成本 / Provider / 套餐一律从
  `scripts/product-discovery.ts` 读到的**已绑定 bundle** 派生。
  9.8.2-D 之前它们直接 `import '@/lib/products/flux-kontext/…'`，换产品就跑不了。
- **产品专属脚本**（Flux 是 `verify-flux-kontext.ts`）头部声明
  `// @product-scope <productId>`。`verify-all.mjs` 在 `src/lib/products/<id>/` 缺失时
  判 **SKIP，绝不 PASS** —— 所以「只有这个产品才成立的数字」有地方待，
  又不会被误当成母版能力。

> 因此：**新增第 5 家 Provider 引擎不再会让门禁莫名变红**（旧的
> `assertEqual(listAIProviderNames(), 'atlascloud,fal,kie,wavespeed')` 硬断言已删）。
> 代价是新厂商若 base URL 不可配就没有 mock 覆盖；产品一个可 mock 引擎都没用到时
> B 段会 **FAIL 并点名原因**，不会静默。完整步骤见 [`AI_CORE.md`](./AI_CORE.md) §10.1。

### 3.4 migration 必须幂等

`npm run migrations:real` 会把每个迁移文件**跑两遍**。
所有 DDL 必须带 `IF NOT EXISTS` / `OR REPLACE` / `IF EXISTS`。
新增迁移 = 新增 `supabase/migrations/00NN_*.sql`（当前到 `0009`），**绝不修改已有文件**。

### 3.5 金额一律整数最小单位

`priceMinor`（美分）。Stripe 的 `unit_amount` **直接赋值，不再 ×100**
（Phase 9.2 修过 100× bug，`src/lib/billing/providers/stripe.ts:12-17` 有注释）。
禁止浮点运算金额。

### 3.6 积分在任务创建时就扣

不是完成时扣。`WorkflowService.createTask()` 第 6 步 `chargeTask()`，
状态还是 `pending`。失败时 `failTask()` 走 `refundTask()` 退款，
幂等键 `task:<taskId>:charge` / `task:<taskId>:refund`。
**不要改成「完成后再扣」**，那会破坏退款幂等语义。

### 3.7 跑 HTTP 测试前重启 dev server

`src/proxy.ts` 的限流是**内存态**：`/api/` 10 次/60s、`/api/auth/` 5 次/300s。
不重启会撞 429，然后你会误判成代码坏了。

### 3.8 本机凭据是占位符

`.env.local` 的 `FAL_KEY` 与 `NEXT_PUBLIC_SUPABASE_URL` 都是占位符。
所以：真实第三方调用与真实 DB 链路**在本机跑不通**。
`verify-ai-core.ts` 的真实调用段会自动跳过；`smoke:ai` 会明确打印 SKIPPED。
**不要因为这类测试没跑通就怀疑代码，也不要为了让它跑通而伪造凭据或放宽断言。**

### 3.9 没有后台 worker

异步任务只能靠 ① 厂商 webhook ② 用户打开 `GET /api/ai/tasks/[id]`
③ Admin 手动 `POST /api/admin/ai-tasks/poll` 推进。
`vercel.json` **没有 `crons`**。`taskRepo.findRetryableTasks()` 目前**零调用方**。
不要假设「有个后台会自己重试」。

### 3.10 模型要几张输入图，是**契约**，由 Core 统一入口校验

`ModelDefinition.requiredInputImages`（`0 / 1 / 'many'`）由
`AIService.generate()` / `submitTask()` 在**分发到任何 Provider 之前**用
`requireContractInputImages(model, request)`（`src/lib/ai/utils.ts`）校验。

**不要在 Provider 里各自检查**：fal / wavespeed 的请求构造本来就按「这次带了几张图」
分支，缺图时它们不报错，而是把必须带图的编辑模型**静默降级成文生图，积分照扣**。
行为不能由「哪家引擎恰好检查了」决定。

新出现的这类错误要分类成 **`INVALID_REQUEST`**（`src/lib/workflow/errors.ts` 已认得
「requires exactly / at least … input image」），它**不可重试**、路由回 4xx；
若是未知异常会落进可重试的 `INTERNAL_ERROR`，白重跑三次。

---

## 4. After coding — 必须做

### 4.1 顺序

```bash
# 1. 针对性验证（只跑你改的模块，秒级）
node scripts/run-ts.mjs scripts/verify-workflow.ts

# 2. 静态守卫（快）
npm run audit:architecture
npm run verify:product-boundary
npm run audit:env
npm run audit:dead-files

# 3. 类型与 lint
npm run lint                     # eslint . && tsc --noEmit

# 4. ⭐ 全量门禁（19 步，含 build 与迁移，较慢；带 `@product-scope` 的步骤在产品缺席时是 SKIP）
npm run verify

# 5. 自查
git diff                         # 逐行看
git diff --stat                  # 确认改动范围符合预期
```

迭代期间可用 `npm run verify:fast`（跳过 build 与迁移），但**收尾必须跑完整 `npm run verify`**。

想连 SKIP 也判失败（例如确认迁移校验真的跑了）：

```bash
PYTHON=<带 sqlglot 的解释器> npm run verify -- --strict
```

### 4.2 判定标准

| 结果 | 含义 | 你该做什么 |
|---|---|---|
| `PASS` | 通过 | — |
| `FAIL` | 失败 | **必须修**。报告里会打印该步最后 12 行输出 |
| `SKIP` | **不算通过** | 报告里单独列出并给安装指引；用 `--strict` 可让它判失败 |
| `INFO` | 信息性，不判定 | 只有 `audit:unused-exports` 是这一类（约 209 个未使用导出，多数是合理 API 面，**不要照单删除**） |

`npm run verify` 退出码：任一 FAIL → 1；有 SKIP 且 `--strict` → 1；否则 0。

### 4.3 必须确认的不变量

改完之后这些**必须仍然成立**：

```
Core → Product          = 0        （npm run verify:product-boundary）
Product → Product       = 0        （同上）
src/lib/database.ts     不存在     （npm run audit:architecture）
无人 import @/lib/database         （同上）
基础设施不 import Flux 产品说明符    （同上）
src/lib/storage/providers/r2.ts 是唯一 import @aws-sdk/client-s3 的文件
src/config/ 下 process.env 读取数 = 0
无新增死文件                        （npm run audit:dead-files）
.env.example 与代码使用一致（A 段 0 缺失）  （npm run audit:env）
```

**不要为了让某项检查通过而弱化检查本身**（加白名单、放宽断言、删断言）。
如果检查确实错了，先说明理由再改，并在 FOLLOWUPS 里记录。

### 4.4 文档同步

行为、公开接口、环境变量、命令、目录结构发生变化时，**必须**同步：

| 变化 | 要改的文档 |
|---|---|
| 新增 / 改名 npm 命令 | `docs/PROJECT_STATUS.md` §8、`docs/README.md` §6、`CONTRIBUTING.md`、根 `README.md` |
| 新增环境变量 | `.env.example`（**必须**）；若是脚本开关，还要加进 `scripts/audit-env.mjs` 的 `TOOLING_VARS` |
| 新增 Core 模块 | `docs/MOTHER_TEMPLATE.md` §2.2 与 §4、对应主题文档 |
| 新增 Product | `docs/PRODUCT_GUIDE.md`、`docs/MOTHER_TEMPLATE.md` §5 |
| 新增 migration | `docs/MOTHER_TEMPLATE.md` §7.1、`docs/DATABASE.md` |
| 新增 AI Provider | `docs/AI_CORE.md`、`docs/MOTHER_TEMPLATE.md` §4.1、`.env.example` |
| 新增文档文件 | `docs/README.md` 索引（**不留死链**） |
| 阶段收尾 | 新建 `docs/PHASE_<N>_FOLLOWUPS.md`、更新 `docs/PROJECT_STATUS.md` §2 时间线、回写 `docs/REFACTOR_PLAN.md` |

**不要新建与现有文档职责重叠的文档。** 先查 `docs/README.md` 索引。

---

## 5. 发现旧架构残留怎么办

> **不要默默绕过。**

三种情况：

**A. 残留会让你的改动失败**（例如守卫报错、类型不通）
→ 修掉它，因为这是完成任务的必要部分。在报告里说明。

**B. 残留与你的任务无关，但是个真问题**
→ 写进当前阶段的 `docs/PHASE_*_FOLLOWUPS.md`，格式：

```markdown
### F<阶段>-<编号> <一句话标题>

- **文件**：<具体路径:行号>
- **问题**：<观察到什么>
- **原因**：<为什么会这样，如果知道>
- **风险**：低 / 中 / 高 + 一句理由
- **是否需要真实环境验证**：是 / 否
- **建议**：<下一步该怎么做>
- **推荐阶段**：<Phase X 或「后续按需」>
```

**C. 你不确定是不是问题**
→ 也写进 FOLLOWUPS，标注「待确认」。**不要猜，不要顺手改。**

Phase 9.7 已知的 10 条边界例外列在
[`MOTHER_TEMPLATE.md` §5.4](./MOTHER_TEMPLATE.md)，详情在
[`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。
**这些是已记录的存量问题，不是你的任务** —— 除非明确要求处理，否则不要动。

---

## 6. 报告要求

任务结束时报告：

1. 做了什么（**事实**，不是意图）
2. 改了哪些文件（`git diff --stat`）
3. `npm run lint` / `npm run verify` / `npm run build` 的**实际结果**
   —— 有 SKIP 要明说是哪几步、为什么
4. 四项守卫的结果（architecture / product-boundary / env / dead-files）
5. 哪些**没有验证**、为什么（例如需要真实凭据）
6. 新发现的遗留问题 → 已写进哪个 FOLLOWUPS
7. 是否建议本阶段 PASS

**禁止**：
- 把 SKIP 说成通过
- 把「静态契约检查」说成「E2E 测试通过」
- 声称 UI 正常但没有实际在浏览器里用过
- 报告没跑过的命令的结果

---

## 7. Git 约定

- Conventional Commits：`feat:` / `fix:` / `chore:` / `docs:`
- 阶段开始前打 tag（如 `phase-9.7-before-docs`）
- 阶段收尾必须 `npm run lint` + `npm run build` 通过，并回写 `docs/REFACTOR_PLAN.md`
- **不要自动 commit**，除非项目流程明确要求
- 提交前 `git status` + `git diff` 自查；确认没有 `.env.local`、没有密钥、没有意外的大文件

---

## 8. 一页速查

```
动手前
  读 MOTHER_TEMPLATE.md → 相关主题文档 → PROJECT_STATUS §8
  搜现有实现（§1.2 的表）
  判断 Core or Product
  检查依赖方向

动手中
  不新建第二套 / 不绕过 Core / 不复活 legacy / 不为单一产品改 Core / 不扩大范围
  发现别的问题 → 记 FOLLOWUPS，继续做当前任务

动手后
  针对性 verify → 4 个守卫 → npm run lint → npm run verify → git diff
  确认 §4.3 的不变量全部仍成立
  同步受影响的文档
  如实报告（SKIP 不是 PASS）
```
