# Phase 9.7 Follow-ups — Mother Template 文档

> 对应审计：`docs/PHASE_9_7_AUDIT.md`（⚠️ 该审计写于**用户规格送达之前**，见 §5.1）
> 基线 commit：`9.7 审计`（tag `phase-9.7-before-docs`）
> 规格来源：用户 Phase 9.7 完整规格（§1 ~ §19）
>
> **本阶段只改文档，未改任何业务代码、未改 schema、未新增依赖。**
> 唯一的非 `.md` 改动是 `.env.example` 的**两处注释**（变量本身一个没动）。

---

## 一、Completed（本阶段已完成）

### ✅ 建立 Mother Template 文档体系（规格 §三 / §十六）

| 文档 | 状态 | 覆盖规格 |
|---|---|---|
| **`docs/MOTHER_TEMPLATE.md`**（新建，1040 行） | ⭐ 项目入口文档 | §四（1~5 全部）+ §七 + §八 + §九 + §十 + §十二 |
| **`docs/AGENT_GUIDE.md`**（新建） | Coding Agent 约束 | §十一 |
| **`docs/PRODUCT_GUIDE.md`**（新建） | 如何新增第二个 Product | §五 |
| **`docs/README.md`**（重写） | 全部 38 篇文档的索引 + 阅读顺序 | §三「总览」 |
| `docs/PHASE_9_7_FOLLOWUPS.md`（本文件） | 遗留记录 | §十五 / §十六 |

**没有为了数量造文档。** 规格 §三 列的 11 类中，7 类靠**升级现有文档**承担：

| 规格要求的类别 | 由谁承担 |
|---|---|
| 1 Mother Template 总览 | 🆕 `MOTHER_TEMPLATE.md` |
| 2 Architecture | 🆕 `MOTHER_TEMPLATE.md` §2（现状）；`ARCHITECTURE.md` 标记为历史 |
| 3 Core / Product Boundary | 🆕 `MOTHER_TEMPLATE.md` §5（含 §5.3 允许/禁止矩阵、§5.4 例外） |
| 4 Development Guide | ♻️ `CONTRIBUTING.md` + `MOTHER_TEMPLATE.md` §9 |
| 5 Configuration / Environment | 🆕 `MOTHER_TEMPLATE.md` §6 |
| 6 AI / Provider Extension Guide | ♻️ **`AI_CORE.md` §10 大幅扩写** |
| 7 Product Development Guide | 🆕 `PRODUCT_GUIDE.md` |
| 8 Testing / Verification / CI | 🆕 `MOTHER_TEMPLATE.md` §8 |
| 9 Database / Migration Guide | ♻️ **`DATABASE.md` §9 重写** + `MOTHER_TEMPLATE.md` §7 |
| 10 Deployment / Operations | 🆕 `MOTHER_TEMPLATE.md` §10 |
| 11 Agent 开发约束 | 🆕 `AGENT_GUIDE.md` |

### ✅ AI Provider 扩展指南（规格 §六）

`docs/AI_CORE.md` §10.1 从 4 行步骤扩写为完整指南：

- **职责边界表**：Provider 只能负责 provider API / authentication / request mapping /
  response normalization / webhook verification / provider-specific polling
- **禁止清单**：不得知道 Flux / Product / Credit 业务规则 / Billing / UI / 数据库
- **标准步骤 5 步**，含 3 个此前未记录的硬性要求：
  - env 必须在**模块顶层**读取（`verify-ai-core.ts` 先设 env 再动态 import）
  - 必须用 `normalize.ts` / `ai/utils.ts`，不要手写 assets 提取
  - ⚠️ **必须同步改 `scripts/verify-ai-core.ts:263-266`** —— 它硬断言注册表恰好等于
    `atlascloud,fal,kie,wavespeed`，漏改则 `npm run verify` 必然失败
- **4 家现有实现差异表**（鉴权 env / generate 策略 / 轮询参数 / 验签算法 / uploadFile /
  模型数 / 各自怪癖）
- §10.2 新增模型：补上「**必须先在 `src/config/credits.ts` 注册**，否则 `getCreditCost()` 抛错」
- §10.3 切换 Provider：补上旧变量名兼容、非法值会 `console.warn` 后回落 `defaultProvider`、
  **无故障转移链**

### ✅ Database / Migration 指南（规格 §八）

`docs/DATABASE.md`：

- 顶部加**复核横幅** + Phase 3 → 9.6 的 8 项变化对照表
- §1 架构图去掉「兼容层 `src/lib/database.ts`」，补齐 **7 个 Repository**
  （原文只列 5 个，漏 `webhook-event.ts` / `admin-audit-log.ts`）与 `createAdminClient()` 来源
- §1.1 从「为什么保留 database.ts」改为「历史 + 已删除 + 守卫阻止复活」
- §1.2 命名约定删掉已不存在的 camelCase 适配层那一行
- §6.4 `ai_tasks`「尚未接线」→ **已接线**（Phase 7），含 `transitionStatus()` 双道强制点、
  `0009` 新增列、以及 `next_retry_at` 无人消费的落差
- §9 迁移章重写：迁移链 **0000~0009 全 10 个**（原文只到 0005）、编号规则、7 条 SQL 原则、
  **static vs real 对照表**（实现/依赖/手段/检查项/缺依赖时行为/局限）、PGlite 用途、
  `.venv` 建立方法与 Python 探测顺序
- 附录 L-10 ~ L-22 全部加**复核状态列**，合并**重复且自相矛盾的两条 L-21**
  （其中一条声称 `src/config/credits.ts` 尚未创建，而它早已存在）；新增 L-23 / L-24

### ✅ Testing / Verification（规格 §九）

`MOTHER_TEMPLATE.md` §8 按 Phase 9.6 的真实结果写：

- **15 步逐条表**（步骤名 / 命令 / 门禁性质）
- 全部开关与环境变量（`--skip-build` / `--skip-migrations` / `--strict` / `--only=` /
  `PYTHON` / `PGLITE_MODULES` / `VERIFY_*`）、Python 探测顺序、退出码语义、FAIL 时打印最后 12 行
- `scripts/verify-*.ts` **自动发现**机制；`.ts` 靠 **jiti**（`scripts/run-ts.mjs`）执行，
  原因是 `tsconfig.json` 排除 `scripts/**`
- **§8.3 五类验证严格区分**（规格 §九 的重点要求）：
  automated verification / migration verification / build verification /
  HTTP smoke test / real external provider test
- **明确写入规格要求保持的事实**：
  > `verify-ai-core.ts` 是**进程内 + 127.0.0.1 本地 mock HTTP**，**不是**生产 E2E；
  > 真实 dev server + 真实 Supabase + 真实凭据的 HTTP E2E **尚未纳入默认 `verify`**。
- 四个守卫脚本的 FAIL 条件与白名单机制（`FRAMEWORK_ENTRY` / `KNOWN_UNUSED_BUT_KEPT` /
  `ALLOWLIST`（当前为空）/ `KNOWN_INDIRECT` / `TOOLING_VARS`）
- 其它质量事实：无 husky / 无 git hooks；ESLint 忽略 `scripts/**` 与 `docs/**` 且关闭多条规则；
  **自定义约束全部实现在 audit 脚本里，没有自定义 ESLint 规则**；Biome 手动、非门禁
- CI 策略：引用 `.github/workflows/*.yml` 里的原文注释

### ✅ Configuration / Environment（规格 §七）

`MOTHER_TEMPLATE.md` §6：

- `Environment → Config → Service → Product` 的实际依赖方向，并**如实说明 env 访问没有收口**
  （实测直接 `process.env` 读取数：`src/lib` 93 · `src/components` 55 · `scripts/` 31 ·
  `src/app` 5 · **`src/config` 0**）
- `.env.example` 的 5 个分组（`[CORE]` / `[STORAGE]` / `[BILLING]` / `[PRODUCT]` / `[OPTIONAL]`）
  与 83 个变量（47 未注释 + 36 注释）
- Secret vs `NEXT_PUBLIC_*` 分类表 + **哪些配置不能进代码**
  （价格 → `config/billing.ts`；积分 → `config/credits.ts`；品牌 → `site-config.ts`）
- 变量缺失时的行为对照（哪个会**让 build 失败**、哪个只在运行时失败、哪个不影响功能）
- deprecated / 未使用变量的处理原则 + `audit:env` A 段（FAIL）/ B 段（WARN）语义 +
  `TOOLING_VARS` / `KNOWN_INDIRECT` 白名单的维护要求
- ⚠️ 特别标注 `STRIPE_PUBLIC_KEY` **没有** `NEXT_PUBLIC_` 前缀是有意的，别「修正」

### ✅ Deployment / Operations（规格 §十二 —— 只写真实能力）

`MOTHER_TEMPLATE.md` §10：

- `vercel.json` 实测配置表：`regions`（hkg1/sin1/sfo1）、`functions.maxDuration: 60`、
  CORS 头、rewrites、redirects、**无 `crons`**
- required / required-if-used / optional 三档环境变量
- 生产 secret 管理与 4 个 webhook 密钥的对应关系
- **迁移上线方式：手工在 Supabase SQL Editor 执行**，本仓库**没有自动迁移流水线**
- Webhook 端点清单（6 个）与验签方式
- 运行时注意事项：**限流是单实例内存态**（3 区域 → 实际阈值约为配置值 3 倍）、
  **没有后台 worker**（任务只能靠 webhook / 用户查询 / Admin 手动 poll 推进）、
  `maxDuration: 60` 对同步生成的约束、退款不回收积分
- §10.7 观测能力：只有 workflow 结构化日志 + `ENABLE_VERBOSE_LOGS`，**没有** APM/tracing/告警
- §1.4 显式列出「这个模板**没有**什么」：Kubernetes / worker 集群 / 队列 / Temporal /
  自动扩缩容 / 可观测性平台 / 分布式限流 / cron / 覆盖率 / 浏览器 E2E

### ✅ 修正活跃文档的失效引用（规格 §十三）

| 文档 | 修正内容 |
|---|---|
| `README.md` | 删掉指向 `src/lib/payment/{stripe,creem,router}.ts` 与 `services/payment-config.ts` 的 4 个死链 → 换成 `src/lib/billing/**`；标注 `NEXT_PUBLIC_ENABLE_CREEM` **代码零读取**；「坑 3」把 `DATABASE_URL` 换成真实的 Supabase 三变量并说明**应用完全不读 `DATABASE_URL`**；文档指引从死链 `TEMPLATE_GUIDE.md` 改为 4 个真实入口 |
| `AI_CORE.md` | `src/lib/flux-kontext.ts` → 产品层 `products/flux-kontext/actions.ts`；`credits` 的「临时位置」注释 → 已迁 `config/credits.ts`；「Workflow ⬜ Phase 8 未实现」→ ✅ Phase 7 已落地 `src/lib/workflow/`（并说明**实际路径不是**当初计划的 `src/lib/workflows/image.ts`）；§13 六条已知边界**逐条复核**（4 条已解决、2 条仍存在），修正「非法 provider 值静默返回 fal」的错误描述 |
| `BILLING.md` | §2.3 三处「仍存在」→ **已删除**（`payment-security.ts` / `payment/creem.ts` / `services/pricing.ts`）；`pricingPlans` 的「死代码」说法精确化（只被白名单里的 `UpgradePrompt.tsx` 引用）；§4.2 去掉「复用 `lib/payment/*`」→ 说明 Phase 9.2 已内联自包含 + 补 `PaymentProvider` 5 成员；§11.1 `POST /api/payment/create-session` → **已于 9.3 删除**；§11.3 迁移计划改为可执行的删除前置条件；§10 三条「待清理」逐条复核 |
| `DATABASE.md` | 见上「Database / Migration 指南」 |
| `STORAGE.md` | §10 重写：删掉不存在的 `saveGeneratedImageToR2()` 与已删除的 `r2Storage` 兼容适配器；说明**生成结果转存在 Core 的 `persistResult()`**、不在产品层；标注 `providers/s3.ts` **从未存在** |
| `WORKFLOW.md` | §6 轮询条件 `pending/processing` → **仅 `processing` 且有 `providerTaskId`**；§10「完成时扣费」→ **创建时（`pending`）扣费**，并指出本文 §8 本来就是对的、§10 自相矛盾；§11 `requireAdmin` → **`withAdmin`**；retry 段补 `CREDIT_DEDUCTION_FAILED` 的实际行为与「退避时间无人等待」 |
| `PROJECT_STATUS.md` | 头部覆盖到 9.7；§1 补 9.7 产出 + **§5.4 十条例外的警示**；§2 时间线 9.7 改为 ✅、9.8 补前置条件；§3 核心边界表补「最后一条有 2 处违反」+「7 条规则里只有 4 条有守卫」；§4.1 修正 `FluxKontextService` 的结局（**迁到产品层，不是被删**）；§4.2 迁移 0008→0009、Repository 5→7；§6 文档索引**去重**（改为指向 `docs/README.md`，不再维护第二份清单）；§7 B-15/B-16/B-17/B-18 复核 + 汇总 18/3/1 → **19/1/1**；§9.2 待处理表重做（汇总各阶段开放项）；§10 **删掉格式损坏且完全过时的「下一步候选」**（原表把 Phase 7/8 当未来，还有重复的 D 行与游离表行），改为「已定义 9.8 + 待授权选项」 |
| `.env.example` | 修正 2 处**误导性注释**：`NEXT_PUBLIC_ENABLE_CREEM` 原注释指向已退役的 `npm run check`（该命令 Phase 9.6 已删）→ 改为说明**代码零读取**、Creem 启用只看 `CREEM_API_URL` + `CREEM_API_KEY`；`DATABASE_URL` → 补明**应用运行时 0 处引用**。**变量本身一个没增没删** |

### ✅ 历史文档标记（规格 §十三：保留但必须标记 historical）

| 文档 | 处理 |
|---|---|
| `docs/ARCHITECTURE.md` | 标题去掉「**当前**」二字 → 「项目架构分析（**Phase 1 历史快照**）」；顶部加醒目横幅，**逐条列出已失效内容**（§0 事实 #2 `database.ts`、#3 mock 声称、已删的 5 组路径、附录 A 缺陷清单的当前状态应查 `PROJECT_STATUS.md` §7），并指向 `MOTHER_TEMPLATE.md`。**正文 1051 行未改**（规格禁止为文档清理大规模重写历史快照） |
| `docs/REFACTOR_PLAN.md` | 顶部加横幅：**区分「计划正文」与「实际完成情况日志」**，明确前者路径多数失效、后者只到 Phase 6.5；指出 **Phase 7 ~ 9.7 未回写本文件**（违反其自身 §0 与附录 C 的契约），并给出权威替代记录在哪 |
| `docs/REFACTOR_DECISIONS.md` | **D-10 闭合**：头部「当前仍未闭合的决策」去掉 D-10；总表状态 🟡→✅；详情节补「5 处引用的逐个结局」表 + 防复活守卫 + 「当初估计 30+ 处、实际只迁 9 处」的更正。D-16 复核为**仍开放**（`SmartImagePreview.tsx:29-41` 确实硬编码 R2 URL 重写） |
| `docs/archive/README.md` | 「当前有效文档 14 个」→ **38 个 `.md`**，并改为**指向 `docs/README.md` 索引**（避免再次过时）；归档数量 53 → **54 个文件（53 `.md` + 1 `.html`）** |
| `docs/README.md` | 索引里对 `ARCHITECTURE.md` / `REFACTOR_PLAN.md` / `DATABASE_AUDIT.md` 明确标注 ⚠️ 历史快照，并单独分成 §4「决策与计划（含历史快照）」 |

### ✅ 同步根目录文档（规格 §十六）

- `README.md`：新增「接下来读什么」4 条入口指引（MOTHER_TEMPLATE / PRODUCT_GUIDE / AGENT_GUIDE / docs 索引）
- `CONTRIBUTING.md`：新增 **"Read This First"** 分角色指引表 + 历史快照警告；
  Ground Rules 补 3 条（不得为单一 Product 改 Core、发现无关问题写 FOLLOWUPS 而非顺手修）；
  标题去掉产品名（`Flux Kontext Template` → 通用）
- `docs/PROJECT_STATUS.md`：见上表

---

## 二、测试执行结果

> 🟢 **2026-09-29 更新**：下表记录的是 **Phase 9.7 收尾时**的结果，其中唯一的失败项
> 已在随后的**独立修复批次**修掉（见 F9.7-16）。修复后 `npm run verify` =
> **14 通过 · 0 失败 · 1 跳过 → 门禁通过**。本表按原样保留，不作追溯修改。

> 执行时间：2026-09-29 · Node **v24.12.0** · Windows
> 本阶段**未改任何业务代码**，因此门禁结果反映的是**基线代码 + 当前环境**的状态。

### 2.1 `npm run verify` —— ❌ **门禁未通过**

```
结果  13 通过 · 1 失败 · 1 跳过        ❌ 门禁未通过
```

| # | 步骤 | 结果 | 耗时 |
|---|---|---|---|
| 1 | `lint`（eslint + tsc --noEmit） | ✅ PASS | 26.1s |
| 2 | `audit:dead-files` | ✅ PASS | 1.0s |
| 3 | `audit:architecture` | ✅ PASS | 1.0s |
| 4 | `audit:env` | ✅ PASS | 0.9s |
| 5 | `verify:product-boundary` | ✅ PASS | 0.9s |
| 6 | `audit:unused-exports` | ✅ PASS（INFO 性质） | 1.1s |
| 7 | `verify-admin.ts` | ✅ PASS | 0.4s |
| 8 | **`verify-ai-core.ts`** | ❌ **FAIL**（exit `3221226505` = `0xC0000409`） | 3.0s |
| 9 | `verify-auth.ts` | ✅ PASS | 1.6s |
| 10 | `verify-billing.ts` | ✅ PASS | 0.4s |
| 11 | `verify-storage.ts` | ✅ PASS | 1.0s |
| 12 | `verify-workflow.ts` | ✅ PASS | 0.3s |
| 13 | `migrations:static` | ⚠️ **SKIP** —— 未找到带 `sqlglot` 的 Python | — |
| 14 | `migrations:real`（PGlite） | ✅ PASS | 2.0s |
| 15 | `build` | ✅ PASS | 21.9s |

### 2.2 ❌ 唯一失败项的诊断（**不是文档改动造成的**）

`verify-ai-core.ts` 的输出末尾是：

```
✅ AI Core 验证全部通过
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

即：**全部断言通过**，随后进程在**退出阶段**崩溃（libuv 断言，Windows）。
`verify-all.mjs` 只看子进程退出码，非 0 即判 FAIL → 记为失败。

**证据链（三条，均已实测）**：

1. **改动范围为零**：`git status --short -- src scripts package.json tsconfig.json
   eslint.config.mjs next.config.js vercel.json supabase` → **无任何输出**。
   本阶段只改了 `docs/**`、`README.md`、`CONTRIBUTING.md`、`.env.example`（仅注释）。
   而 `verify-ai-core.ts` 既不 import 文档、也不读 `.env.example`（它读 `.env.local` / `.env`）。
   → **该脚本运行的是与基线 commit `9.7 审计` 逐字节相同的代码。**
2. **确定性复现**：单独执行 `node scripts/run-ts.mjs scripts/verify-ai-core.ts`
   **连续 3 次全部崩溃**在同一处，非偶发。
3. **崩溃点在 teardown**：`scripts/verify-ai-core.ts:392-400` 的顺序是
   `await mock.close()` → 打印 ✅ → `process.exit(0)`。
   `mock.close()` 是 `server.close(cb)`（`:208-211`）。

**未成立的假设**：用最小脚本复刻「`createServer` + fetch(keep-alive) + `server.close()` +
`process.exit()`」在**纯 node（ESM 与 CJS 两种）下均不崩溃**（exit 0）。
所以触发条件比这个模式更具体 —— 差异在于真实脚本经 **jiti** 加载
（`scripts/run-ts.mjs`）、跨 3 个 provider 发了更多请求、且有轮询循环。
用 jiti 加载 /tmp 下最小复现的尝试因模块解析越界而失败，**未能进一步隔离**。

**结论**：这是**基线代码在当前环境（Node v24.12.0 / Windows / jiti）下的既有缺陷**，
与 Phase 9.7 的文档改动**无因果关系**。但它意味着
**Phase 9.6 记录的「15 通过 · 0 失败 · 0 跳过」在当前环境已不可复现**。

→ 详见 **F9.7-16**（当时列为阻塞级；已于 2026-09-30 修复，见 §七）。

### 2.3 四项审计（单独执行，全绿）

| 命令 | 结果 |
|---|---|
| `npm run audit:env` | ✅ **A 段 0 缺失**（扫描 214 个文件；代码使用 87 个变量；`.env.example` 声明 83 个）· B 段仍 2 条告警（`DATABASE_URL`、`NEXT_PUBLIC_ENABLE_CREEM`，**与本阶段改动前一致**） |
| `npm run audit:architecture` | ✅ **10 个基础设施目录、51 个文件，无反向依赖；无遗留 database 适配器** |
| `npm run verify:product-boundary` | ✅ **Core → Product = 0**；Product → Core 单向成立 |
| `npm run audit:dead-files` | ✅ 无新增死文件（`verify` 第 2 步） |
| `npm run lint` | ✅ 0 错误（`verify` 第 1 步） |
| `npm run build` | ✅ 全路由生成，21.9s（`verify` 第 15 步） |

> ⚠️ `audit:env` 的 A 段仍是 **0 缺失** —— 证明本阶段对 `.env.example` 的
> **两处注释修改没有影响声明计数**（83 个变量一个没增没删）。

### 2.4 未执行 / 无法执行

| 项 | 状态 | 原因 |
|---|---|---|
| `npm run smoke:ai`（HTTP E2E） | ⏭️ **未执行**（承接 F9.6-4，仍 **NOT VERIFIED**） | 需运行中的 dev server + 真实 Supabase + 真实 `FAL_KEY`；本机均为占位符 |
| `migrations:static`（sqlglot） | ⏭️ **SKIP** | 仓库无 `.venv`，未设 `PYTHON`。建法已写入 `DATABASE.md` §9.2 |
| `verify-ai-core.ts` C 段（真实 fal 调用） | ⏭️ **自动跳过** | 脚本自己判定 `FAL_KEY` 是占位符并跳过，**不判失败**（设计如此） |
| 每模块断言数核对 | ⏭️ **未取得** | `verify-all.mjs` 对通过的步骤只打印耗时，不打印内部断言数；`verify-ai-core.ts` 自身也只打印「全部通过」不打印计数 → 见 F9.7-14 |

**未改数据库 schema，未新增 migration。**

---

## 三、Remaining（F9.7-X）

> 规格 §十五：**发现架构问题只记录，不顺手扩大范围解决。**
> 以下条目全部是 Phase 9.7 审计**新发现**或**承接自 9.6** 的开放项，
> **Phase 9.7 阶段内一律未改代码**；
> 唯一例外是 F9.7-16，经用户单独授权后在**独立修复批次**里修掉了（记在该条目下）。
> 当前共 17 条（F9.7-17 为修复批次新发现）。
>
> F9.7-1 ~ F9.7-10 与 `MOTHER_TEMPLATE.md` §5.4 的 E-1 ~ E-10 一一对应
> （那里是「读者视角的例外清单」，这里是「带处置建议的遗留清单」）。

> ## ✅ 曾经的阻塞级：F9.7-16 —— **已修复**（2026-09-29 独立修复批次）
>
> Phase 9.7 收尾时 `npm run verify` 是红的（13 通过 · 1 失败 · 1 跳过），
> 失败项 `verify-ai-core.ts` 的**断言全部通过**，进程在退出阶段被 libuv 断言打断。
>
> 经用户单独授权后已修复（**只改 `scripts/verify-ai-core.ts`**，详见该条目的
> 「✅ 已修复」小节）。修复后：
> **`npm run verify` = 14 通过 · 0 失败 · 1 跳过 → 门禁通过**
> （当时唯一跳过是 `migrations:static`，因本机还没有 `.venv`；
> 后续 §7.7 已补齐为 **15 通过 · 0 失败 · 0 跳过**）。
>
> Phase 9.7 阶段的处置本身是正确的：当时**未改代码**、只记录并上报，
> 由用户决定是否越界修复。

> ## 🟡 修复批次新发现：F9.7-17
>
> 其余 `scripts/verify-*.ts` 仍用 `process.exit()` 收尾，属同一风险模式（当前不崩，
> 因为没有 keep-alive socket）。见 §三 末尾。

### F9.7-1 `src/proxy.ts` 含产品语义，且守卫覆盖不到（= E-1）

- **文件**：`src/proxy.ts:79-100`
- **问题**：边缘层硬编码 Flux 的 4 个 action，把 `/api/v1/*` 重写到 `/api/flux-kontext?action=…`。
  `proxy.ts` 位于 `src/` 根，**不在** `verify-product-boundary.mjs` 的 14 个 CORE_DIRS 内，
  也不在 `audit-architecture.mjs` 的基础设施目录列表内 → 两个守卫都抓不到。
- **原因**：Phase 8 解耦时只处理了 `src/lib/`，边缘层与部署配置没进范围。
- **风险**：**中高** —— 这是「删掉产品目录后 Core 仍干净」的直接反例，会**污染 Phase 9.8 的结论**。
- **是否需要真实环境验证**：否（纯静态）
- **建议**：把重写规则数据化（例如产品自己声明 `compatRoutes`，由 proxy 读取），
  或把 `src/proxy.ts` 加入 CORE_DIRS 并为现有耦合登记 ALLOWLIST 条目（`ALLOWLIST` 目前为空）。
- **推荐阶段**：**Phase 9.8 前置**
- **✅ 状态（Phase 9.8.2-B，代码 `9.8.2-B`）**：已消解，但**没有**采纳上面两条建议 ——
  实际做法是把 proxy 的 Flux 分支换成通用 `/api/v1/<rest>` → `/api/<rest>` 前缀剥离，
  legacy 路径改由产品自己的 `src/app/api/flux/[[...path]]/route.ts` 承接（再导出原 handler）。
  既没有加 `compatRoutes` 注册表（F9.8-D 仍未解），也没有改 CORE_DIRS（改守卫属禁区）。

### F9.7-2 `vercel.json` 含产品语义，且与 `proxy.ts` 路径不一致（= E-2）

- **文件**：`vercel.json` `rewrites`
- **问题**：同样硬编码 `/api/v1/flux/*` → `/api/flux-kontext?action=…`（4 条）。
  **两处的源路径还不一致**：`vercel.json` 是 `/api/v1/flux/text-to-image/pro`，
  `proxy.ts` 匹配的是 `/api/v1/text-to-image/pro`（**没有 `/flux/` 段**）。
- **原因**：两处独立演进，无单一真相。
- **风险**：**中** —— 除了产品耦合，还意味着同一套兼容 URL 在 Vercel 上与本地 dev
  行为**可能不同**（本地 dev 不走 `vercel.json` rewrites）。**未在真实环境比对过。**
- **是否需要真实环境验证**：**是** —— 需在 Vercel 部署上确认 `/api/v1/flux/*` 与
  `/api/v1/*` 两套路径各自的实际行为
- **建议**：统一到一处（推荐 `proxy.ts`，因为它在本地与生产行为一致），
  `vercel.json` 只保留通用的 `/api/v1/(.*) → /api/$1`。
- **推荐阶段**：Phase 9.8 前置
- **⚠️ 事实更正（Phase 9.8.2-B 实测）**：上面「两处的源路径还不一致」那句**不成立**。
  `proxy.ts` 用的是 `pathname.includes('/text-to-image/pro')`，所以
  `/api/v1/flux/text-to-image/pro`（带 `/flux/`）与 `/api/v1/text-to-image/pro`（不带）
  **都会**命中同一个分支 —— 它匹配的是 `vercel.json` 那 4 条的**超集**，不是另一套形状。
  真实缺陷是 F9.8-A 记的那条：**任意** `/api/v1/*` 都被无条件吞进 Flux 端点
  （实测 `/api/v1/user/credits` 返回 Flux 的 400 而不是自己的结果）。
  「本地 dev 不走 `vercel.json`」这一点已由实测确认：本地 `vercel.json` 全程惰性。
- **✅ 状态（Phase 9.8.2-B）**：已消解 —— `vercel.json` 的 4 条 Flux rewrite 与
  泛规则 `/api/v1/(.*) → /api/$1` **全部删除**（`rewrites: []`），改写只留在 `proxy.ts` 一层。
  建议里「vercel.json 只保留通用规则」被**推翻**：保留两层做同一件事仍要靠平台优先级才能判定，
  而优先级至今未在 Vercel 上实证；删干净之后结果与优先级无关。

### F9.7-3 Core 配置里含产品语义（= E-3 / E-4 / E-5）

- **文件**：`src/lib/ai/models.ts`（`MODELS` 10 条全是 `flux-*`）、
  `src/config/credits.ts`（`CREDIT_COSTS` 键全是 `flux-*`）、
  `src/config/billing.ts`（`providerProductIds.creem` 含 `'FluxKontext-Plus-Monthly'` 等品牌串）、
  `src/lib/user-tiers.ts`（Flux 专属模型/宽高比列表）
- **问题**：Core 目录里存的是**产品的目录数据与品牌串**。守卫只查 import 关系，
  查不出「数据内容是产品专属的」，所以 `Core → Product = 0` 依然成立。
- **原因**：模型目录与积分成本天然是「按模型 id 索引」的全局表；Phase 8 只搬走了**代码**，
  没搬**数据**。`models.ts` 里甚至有注释说明「flux-kontext 在这里只是**一个模型**」，
  属有意设计。
- **风险**：**中** —— 不影响运行，但意味着「换产品」必须改 Core 配置文件，
  与 `.env.example` 里「`[PRODUCT]` 段：换产品时只改这一段」的承诺**不符**。
- **是否需要真实环境验证**：否
- **建议**：两个方向择一 ——
  ① 让产品**注册**自己的模型与成本（`registerModels()` / `registerCreditCosts()`，
  Core 只提供注册表与查询）；
  ② 承认「模型目录属于 Core 的共享资产」，但把 `billing.ts` 里的品牌串移出 Core
  （渠道产品 id 属于产品/部署配置，可进 env 或产品目录）。
  ②的改动面小得多。
- **推荐阶段**：Phase 9.8（与 F9.7-5 一起做，否则第二产品无处注册）

### F9.7-4 2 个路由绕过 Repository（= E-6）

- **文件**：`src/app/api/user/credits/route.ts`（`:2` `createAdminClient`，
  `:23,:55,:77,:92,:153` 直接 `.from('users')` / `.from('credit_transactions')`）、
  `src/app/api/user/ensure/route.ts`（`:2,:20,:24,:75,:152,:155`）
- **问题**：违反 `DATABASE.md` §8.1 与 `PROJECT_STATUS.md` §3 的成文规则
  「业务层禁止直接创建 Supabase 客户端 / 直接操作底层数据库」。
- **原因**：这两个路由早于 Repository 层收敛，Phase 9.1 迁移了 `database.ts` 的 9 处调用，
  但这两处本来就不走 `database.ts`，所以没被那次迁移覆盖。
- **风险**：**中** —— 目前**没有守卫**覆盖这条规则（`verify-admin.ts` 只查 Admin 路由）。
  实际风险取决于这两处是否绕过了 `consume_credits` 的原子性；
  **本阶段未逐行审计其积分写入路径**，需专项确认。
- **是否需要真实环境验证**：否（静态可查），但**积分路径的正确性需要专项审计**
- **建议**：① 迁到 `db/repositories/{user,credit}.ts`；
  ② 给 `audit-architecture.mjs` 加一条规则：
  `src/app/**` 与 `src/lib/**`（除 `lib/db/`、`lib/supabase/`、`lib/auth*`）
  不得 import `createAdminClient` / `@supabase/supabase-js`。
- **推荐阶段**：独立小阶段（改动面小、收益明确），或并入 9.8

### F9.7-5 无产品注册表 + 验证脚本依赖产品（= E-7，**Phase 9.8 的最大障碍**）

- **文件**：
  - 8 个组件直接 import 产品内容：`src/components/{FAQ,Footer,HomeContent,HomeContentSimple,HowToSteps,KeyFeatures,PricingContent,TwitterShowcase}.tsx`
  - `scripts/verify-ai-core.ts:248` → `import('@/lib/products/flux-kontext')`
  - `scripts/verify-billing.ts:23` → `import { getRequiredCredits } from '@/lib/products/flux-kontext/credits'`
  - `scripts/verify-billing.ts:221` → 硬编码路径字符串 `'src/lib/products/flux-kontext/credits.ts'`
- **问题**：不存在任何「产品列表」的间接层。所有产品接线都是硬编码 import。
- **原因**：Phase 8 的目标是「把 Flux 关进 `products/`」，达成了；
  「让 UI 与测试对具体产品无感」不在当时范围内。
- **风险**：**高（对 9.8 而言）** ——
  ① 加第二产品要改这 8 个组件；
  ② **删掉产品目录会让 `npm run verify` 的第 8、10 步失败**，
  所以 9.8 那个「删掉产品看 Core 能否编译」的实验**不能用 `npm run verify` 做**；
  ③ `verify-product-boundary.mjs:113-118` 在 `src/lib/products/` 为空时**直接 FAIL**，
  进一步堵死这个实验路径。
- **是否需要真实环境验证**：否
- **建议**：9.8 开始前先做两件事 ——
  ① 引入产品注册表（`src/lib/products/registry.ts`，产品各自 `register()`；
  UI 与 sitemap 通过它取「当前产品」）；
  ② 把验证脚本里的产品引用改为**遍历注册表**，而不是硬编码 Flux。
  9.8 的实验方法已在 `PRODUCT_GUIDE.md` §7 写明（用 `npm run lint` + `npm run build`，
  **不要**用 `verify`）。
- **推荐阶段**：**Phase 9.8 的第一步**

### F9.7-6 `verify-product-boundary.mjs` 的输出声称不准确

- **文件**：`scripts/verify-product-boundary.mjs:170`
- **问题**：脚本在通过后打印
  `（删除 src/lib/products/ 后，Core 仍可编译；仅产品 API/UI 失效。）`。
  这句话对 `src/lib/**` 的 Core 目录成立，但对 `scripts/**` **不成立**（见 F9.7-5），
  对 `src/proxy.ts` 也不成立（见 F9.7-1）。
- **原因**：脚本只检查 CORE_DIRS 的 import，输出却做了一个更大的断言。
- **风险**：**中** —— 这是**假绿的一种**：门禁自己打印了一个未经它验证的结论，
  容易让人（和 Agent）据此做出错误判断。Phase 9.6 刚花大力气消除过同类问题
  （退役 `check-config.js` 就是因为它「报错却打印通过」）。
- **是否需要真实环境验证**：否
- **建议**：把该行改为脚本**实际验证过的范围**，例如
  「CORE_DIRS 内无任何 `@/lib/products/*` 引用；`scripts/**` 与 `src/proxy.ts` 未检查」。
  **这是本阶段最值得优先修的一条**（一行输出文案，零风险）。
- **推荐阶段**：随时可做（改动极小）

### F9.7-7 `sitemap.ts` / `robots.ts` 暴露 404 路由（= E-8）

- **文件**：`src/app/sitemap.ts:14`、`src/app/robots.ts:22`
- **问题**：两处都列了 `/features`，但 `src/app/features/` **不存在** → 对外发布了一个 404 URL。
- **原因**：页面被删或从未创建，SEO 清单没同步。
- **风险**：**低但对外可见** —— 影响 SEO 质量信号（sitemap 里有死链）。
- **是否需要真实环境验证**：否（`ls src/app/features` 已确认不存在）
- **建议**：删掉这两处 `/features`；或补一个真实页面。
  顺带把路由清单收敛到一处（现在 `sitemap.ts` 与 `robots.ts` 各维护一份）。
- **推荐阶段**：随时可做

### F9.7-8 `next_retry_at` 写了没人读（= E-9）

- **文件**：`src/lib/workflow/service.ts`（`nextRetryDelayMs` / `failTask`）、
  `src/lib/db/repositories/ai-task.ts`（`findRetryableTasks`）
- **问题**：指数退避 `min(5000 * 2^n, 60000)` 会写进 `next_retry_at`，但
  ① `failTask()` **立即**调 `submitTask()`，不等待退避；
  ② `findRetryableTasks()` **零调用方**；③ `vercel.json` 无 `crons`。
  → 「退避后自动重试」这个能力**实际上不存在**。
- **原因**：Phase 7 已知并在 `WORKFLOW.md` 记录过「同步重提交会烧完重试次数」，
  但退避字段仍按设计写库，等未来接调度器。
- **风险**：**中** —— 瞬时故障会在一次请求内烧完 3 次重试；
  且「有 `next_retry_at` 字段」会让人误以为有退避重试。
- **是否需要真实环境验证**：否（静态可确认零调用方）
- **建议**：短期先在文档里说清（**本阶段已在 `WORKFLOW.md` §7 与 `MOTHER_TEMPLATE.md` §3.2 标注**）；
  中期要么接调度器（cron / 外部定时器打 `/api/admin/ai-tasks/poll`），
  要么删掉 `findRetryableTasks()` 与 `next_retry_at` 以免误导。
- **推荐阶段**：后续按需（接调度器属新增能力，需用户授权）

### F9.7-9 空目录 `src/app/api/payment/`（= E-10）

- **文件**：`src/app/api/payment/`
- **问题**：目录存在但**为空**（`create-session` 于 Phase 9.3 删除后残留）。
  git 不跟踪空目录，所以它是**本地未跟踪残留**，不会出现在 `git status` 里。
- **原因**：删文件时没删父目录。
- **风险**：**无**（不影响构建与运行）；但会误导读目录结构的人，
  也可能让 `audit:dead-files` 之类的扫描产生噪音。
- **是否需要真实环境验证**：否
- **建议**：直接删目录。**本阶段未删** —— 规格 §十五禁止扩大范围，
  且删目录属代码树改动而非文档改动。
- **推荐阶段**：随时可做

### F9.7-10 `REFACTOR_PLAN.md` 未回写 Phase 7 ~ 9.7（流程缺口）

- **文件**：`docs/REFACTOR_PLAN.md`
- **问题**：该文件 §0「执行规则」与附录 C 都要求**每个 Phase 完成后回写状态**，
  且 `PROJECT_STATUS.md` §2 下方也写着「每个阶段收尾都必须…回写 `REFACTOR_PLAN.md`」。
  实际「实际完成情况」日志**只到 Phase 6.5**，Phase 7 / 8 / 9.1~9.7 共 **8 个阶段全部未回写**。
- **原因**：Phase 7 起改用 `PHASE_<N>_AUDIT.md` + `PHASE_<N>_FOLLOWUPS.md` 双文件记录，
  实际取代了回写 `REFACTOR_PLAN.md` 的约定，但约定本身没被更新。
- **风险**：**低（但会持续误导）** —— 新人读到「本文件是执行契约」会以为它是最新的。
- **是否需要真实环境验证**：否
- **建议**：**不要补写 8 个阶段的历史日志**（那是事后编造，且真实细节已不可靠）。
  正确做法是**修订约定本身**：把 §0 与附录 C 改为
  「阶段记录写在 `PHASE_<N>_AUDIT.md` / `PHASE_<N>_FOLLOWUPS.md`，
  时间线汇总在 `PROJECT_STATUS.md` §2」，并同步 `PROJECT_STATUS.md` §2 下方那句话。
  **本阶段只加了顶部横幅说明现状，未改约定正文**（避免改动 1535 行历史文件的规则章节）。
- **推荐阶段**：Phase 9.8 收尾时，或独立文档小阶段

### F9.7-11 i18n：机制是 16 语言，内容只有 1 种，且字典重复 18 份

- **文件**：`src/lib/products/flux-kontext/home-config.ts`（`EN_DICTIONARY` / `getDictionary`）、
  `src/lib/products/flux-kontext/content/*.json`、
  `src/app/{zh,de,es,fr,it,ja,ko,nl,pl,pt,ru,tr,ar,hi,bn}/page.tsx`（15 个）、
  `src/components/flux-kontext/types.ts`
- **问题**：
  ① `getDictionary(locale)` **忽略入参，恒返回 `EN_DICTIONARY`**；
  ② 产品 `content/*.json` **只有英文**，没有 locale 维度；
  ③ 英文首页字典存在 **2 份**（`home-config.ts` 与 `content/home.json`），
  再**内联 15 份**在各 locale 页面里；
  ④ `src/components/flux-kontext/types.ts` **重复定义**了 `FluxKontextAction` 联合类型
  （与 `src/lib/products/flux-kontext/types.ts` 里那份并存）。
- **原因**：Phase 9.4 的目标是「把产品文案搬进产品目录、把 `locale.ts` 收敛成纯机制」，
  做到了；**翻译内容本身**不在范围内。
- **风险**：**中** —— Core 有完整的 16 locale 机制（含 RTL、字体、本地化路径），
  但产品侧只喂英文，机制的价值没兑现；且 18 份字典意味着改一句文案要改 18 处。
- **是否需要真实环境验证**：否
- **建议**：① 先消除重复：以 `content/*.json` 为唯一来源，删 `EN_DICTIONARY`；
  ② 把 `content/` 改成 `content/<locale>.json` 或 `content/{home,generator,pricing,seo}.<locale>.json`，
  让 `getDictionary(locale)` 真正生效；③ 15 个 locale 页面改为读同一份数据源；
  ④ 删掉 `components/flux-kontext/types.ts` 里重复的类型，统一从产品目录 import。
- **推荐阶段**：独立阶段（属功能改造，不是文档）

### F9.7-12 限流的 `payment` 桶永远匹配不到真实路由

- **文件**：`src/proxy.ts:166`
- **问题**：分桶判断是 `pathname.includes('/payment/')`，但当前**没有任何路由**的路径含
  `/payment/`：`src/app/api/payment/` 是空目录（F9.7-9），
  真实支付路由是 `/api/billing/*`（不含 `payment`）与 `/api/payments/create-checkout`
  （是 `/payments/`，**不匹配** `/payment/`）。
  →  intended 的「支付接口 3 次/600s」严格限流**从未生效**，
  这些路由实际落在通用 `api` 桶（10 次/60s）。
- **原因**：Phase 9.2 把路由从 `/api/payment/*` 迁到 `/api/billing/*` 时，限流分桶没跟着改。
- **风险**：**中（安全相关）** —— 支付下单接口的限流比设计意图**宽松约 3 倍**，
  且窗口从 600s 缩到 60s。
- **是否需要真实环境验证**：否（静态可确认），但**修复后建议用 `smoke:ai` 的 billing 段验证 429 行为**
- **建议**：把判断改为匹配 `/billing/` 与 `/payments/`（或直接用前缀列表）。
  **本阶段未改** —— 属安全策略变更，需用户确认预期阈值。
- **推荐阶段**：**建议尽快**（独立小改动，需用户授权阈值）

### F9.7-13 `vercel.json` 对全部 `/api/*` 开放 `Access-Control-Allow-Origin: *`

- **文件**：`vercel.json` `headers[0]`
- **问题**：`source: "/api/(.*)"` 配 `Access-Control-Allow-Origin: *` +
  允许 GET/POST/PUT/DELETE/OPTIONS，**覆盖所有 API**，包括需要凭据的
  `/api/user/*`、`/api/billing/*`、`/api/admin/*`。
- **原因**：原模板为了让 `/api/v1/*` 对外可调用而设，范围写成了全部 `/api/*`。
- **风险**：**中** —— 通配 CORS 本身不等于漏洞（浏览器不会自动附带 cookie 到 `*` 源，
  且本项目主要用 Bearer/session），但**把 Admin 与用户端点一起纳入通配范围**
  超出必要，且与 `proxy.ts` 里 `X-Frame-Options: DENY` 等收紧姿态不一致。
  **本阶段未做渗透验证，不下安全结论。**
- **是否需要真实环境验证**：**是** —— 需确认哪些端点真的需要跨域
- **建议**：把通配 CORS 收窄到确实需要对外调用的路径（例如只 `/api/v1/*`），
  其余走同源。改动前需评估既有集成方。
- **推荐阶段**：待用户决定（属安全策略）

### F9.7-14 文档里的断言计数未经运行时核对 —— ✅ **已解决（2026-09-30 收尾批次）**

- **文件**：`docs/PROJECT_STATUS.md` §8
- **问题**：§8 写了每个 verify 脚本的断言数（`verify-workflow` 42 项、`verify-billing` 78 项、
  `verify-storage` 20 项、`verify-auth` 28 项、`verify-admin` 47 项）与
  `migrations:real` 的「198 项」。这些数字**是历史阶段记录的**，
  而脚本里的断言数是**运行时计数**，随代码演进会漂移。
  `docs/DATABASE.md` 原先还写着另一套数字（「8 组积分原子性测试，86 项检查」），
  与 198 冲突 —— 本阶段已把该处改为「由运行时计数，以实际输出为准」。
- **原因**：把运行时数字硬写进文档，必然过时。
- **风险**：**低** —— 但会让读者误判覆盖规模。
- **是否需要真实环境验证**：**是**（跑一次 `npm run verify` 即可拿到真实数字）
- **处置（2026-09-30）**：已实测各脚本计数，并**按 `DATABASE.md` 的既定约定把计数从
  §8 移除**，改为一句「断言数量由脚本运行时输出，不在文档里硬写」。
  历史阶段表里的计数加上「当时」限定，避免被误读为当前值。
  实测值（本批次）：`verify-admin` **45**、`verify-auth` **28**、`verify-storage` **20**、
  `verify-workflow` **42**；`verify-ai-core` / `verify-billing` **只打印「全部通过」不打印计数**。
  实测同时发现 §8 原写 `verify-admin` 47 项、`verify-auth` 13 项（Phase 6 时代的旧值）均为失真。

### ✅ F9.7-15 `ARCHITECTURE.md`（1051 行）移入 `docs/archive/`【已裁决 · 已执行 2026-09-30】

> **裁决（用户 2026-09-30）**：移入 `docs/archive/`。理由是真正的架构基线已进入
> `MOTHER_TEMPLATE.md` + 9.8.x 审计体系，旧 Architecture 文档继续留在主文档区
> 容易产生**两个架构真相**。属文档整理，不影响运行代码。
> 执行：`git mv docs/ARCHITECTURE.md docs/archive/ARCHITECTURE.md`，正文一行未改（历史快照）。
> 实际更新的引用是 **6 个文件、十余处**（当年预测的「4 处（含 `DATABASE.md` 头部）」不准 ——
> `DATABASE.md` 其实没有引用它）：
> `docs/README.md`（§4 行 + §4 提示 + §6 计数 + §8 约定）、`docs/MOTHER_TEMPLATE.md`（§0/§9.1/§10）、
> `docs/AGENT_GUIDE.md` §1、`docs/PROJECT_STATUS.md`（§2 注 + §7 注）、`docs/REFACTOR_PLAN.md` 头部、
> `CONTRIBUTING.md`；`docs/archive/README.md` 计数与分类同步。
> **代码零引用**（2026-09-30 复核：`grep -r ARCHITECTURE src scripts package.json next.config.* vercel.json`
> 无命中），所以这次移动不可能影响运行时代码或门禁。

- **文件**：`docs/ARCHITECTURE.md`
- **问题**：`PHASE_9_7_AUDIT.md` §3 提出的裁决项 (A) 至今未答。
  本阶段选择了**风险较低的方案**：留在 `docs/`，改标题 + 顶部加逐条失效说明横幅，
  并在 `docs/README.md` §4 明确归类为「历史快照」。
- **原因**：移动 1051 行文件（`git mv`）比加横幅影响面大，且规格 §十三 只要求
  「保留并标记 historical」，未要求移动。
- **风险**：**无** —— 两种方案都能防止误读，当前方案已足够。
- **是否需要真实环境验证**：否
- **建议**：~~**保持现状**~~ —— 已被上面的裁决推翻。原建议原文：
  若你更希望 `docs/` 下只剩当前有效文档，
  可 `git mv docs/ARCHITECTURE.md docs/archive/` 并更新 4 处引用
  （`docs/README.md`、`PROJECT_STATUS.md`、`REFACTOR_PLAN.md` 头部、`DATABASE.md` 头部）。
- **推荐阶段**：~~待用户决定~~ → **已执行（2026-09-30，纯文档整理，无代码改动）**

---

### ✅ F9.7-16 `verify-ai-core.ts` 在退出阶段崩溃 → `npm run verify` 无法通过【已修复】

- **文件**：`scripts/verify-ai-core.ts:392-400`（teardown）、`scripts/run-ts.mjs`（jiti 加载器）
- **问题**：脚本**全部断言通过**并打印 `✅ AI Core 验证全部通过`，随后进程崩溃：
  ```
  Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
  ```
  退出码 `3221226505`（`0xC0000409`）。`verify-all.mjs` 只判退出码 → 记为 FAIL →
  **整个 `npm run verify` 返回 ❌**。
- **环境**：Node **v24.12.0** · Windows 10.0.26200 · 经 jiti 加载
- **原因（已实测的部分）**：
  - 崩溃发生在 `await mock.close()`（`server.close(cb)`）**之后**、`process.exit(0)` 前后，
    属 libuv 句柄关闭竞态；
  - **不是本阶段造成的**：`src/`、`scripts/`、`package.json`、`tsconfig.json`、
    `eslint.config.mjs`、`next.config.js`、`vercel.json`、`supabase/` **零改动**，
    脚本跑的是与基线 `9.7 审计` 逐字节相同的代码；
  - **确定性**：连续 3 次单独执行全部崩溃在同一处；
  - **已排除的假设**：最小复现（`createServer` + keep-alive `fetch` + `server.close()` +
    `process.exit()`）在纯 node 的 ESM 与 CJS 下**都不崩**（exit 0）→
    触发条件与 jiti 加载、跨 3 provider 的更多请求、或轮询循环有关，**尚未隔离到单一因子**。
- **风险**：**高（流程层面）** ——
  ① 本地 CI 门禁**当前是红的**，`CONTRIBUTING.md` / PR 模板 / `AGENT_GUIDE.md`
  都要求「收尾必须 `npm run verify` 全绿」，这条现在谁都做不到；
  ② 失败信息**极具误导性**：它发生在「全部通过」之后，容易被误读成
  「验证脚本自己坏了」或「环境问题，可以忽略」，从而**习惯性无视红色门禁**
  —— 这正是 Phase 9.6 花大力气消除的「假绿/假红」类问题；
  ③ Phase 9.6 的验收结论（15/15）在当前环境**不可复现**。
- **是否需要真实环境验证**：**是** —— 需在不同 Node 版本（尤其 Node 20 LTS，
  `package.json` `engines` 写的是 `>=20.9.0`）与不同 OS 上比对，
  以判断这是 Node 24 回归还是 Windows 特有问题。
- **建议（按成本排序，均未实施）**：
  1. **最小改动**：在 `process.exit()` 之前主动销毁残留连接 ——
     `server.closeAllConnections()`（Node ≥ 18.2）后再 `close()`；
     或干脆**去掉 `process.exit()`**，改为设置 `process.exitCode` 并让事件循环自然退出
     （前提是 mock server 已关闭，否则进程会挂住）。
  2. **绕过验证**：先确认 Node 20 LTS 下是否复现。若不复现，
     在 `package.json` `engines` 或 `CONTRIBUTING.md` 里写明已验证的 Node 版本区间
     —— 但这只是规避，不是修复。
  3. **改门禁语义（不推荐）**：让 `verify-all.mjs` 解析子进程输出里的
     `✅ … 全部通过` 来覆盖退出码。**这会重新引入「假绿」**，
     与 Phase 9.6 退役 `check-config.js` 的理由直接冲突，**明确不建议**。
- **本阶段为何不修**：规格 §十五 明令「严禁改代码 / 严禁扩大范围」，
  且修法 1 会改变一个**已验收阶段**的测试脚本行为，应由用户决定。
- **推荐阶段**：**立即单独处理**（一个独立的小 commit，不属任何 Phase）；
  在修好之前，Phase 9.8 不应开始 —— 因为 9.8 依赖 `npm run lint` + `build` 做判定，
  而门禁整体红着会让人无法区分「9.8 引入的失败」与「这条既有失败」。

#### ✅ 已修复（2026-09-29，独立修复批次，仅改 `scripts/verify-ai-core.ts`）

**根因（本轮实测确认，比上文更进一步）**：崩溃点是 **`process.exit()` 本身**，
不是 mock server 关闭失败。用同一脚本的三个变体对照：

| 退出方式 | 结果 |
|---|---|
| `process.exit(0)`（原样） | ❌ `3221226505`，stderr 命中 libuv `async.c` 断言 |
| `process.exitCode = 0`（自然退出） | ✅ `0`，无崩溃，**且没有挂死**（~1.8s） |
| 自然退出 + 显式关连接 | ✅ `0` |

关键证据：`process._getActiveHandles()` 在 `mock.close()` **之后**仍返回
`["Socket","Server","Socket","Socket","Socket","Socket"]` —— 残留的是 undici
keep-alive 连接与尚未释放的 listening handle。`process.exit()` 会**立刻**拆事件循环，
此时仍有 libuv handle 处于 `UV_HANDLE_CLOSING`，Windows 下的
`uv_async_send` 断言即被命中。自然退出则先让这些 handle 走完关闭流程。
**未隔离的因子**：jiti。脚本必须经 `run-ts.mjs`（jiti）加载才能解析 `@/` 别名，
本轮没有「同一脚本不经 jiti 运行」的对照组，
所以**不能断言 jiti 无关** —— 只能说：修复后无论经不经 jiti，
崩溃路径（`process.exit()` 时残留 socket）已不存在。

**修复内容**（`scripts/verify-ai-core.ts`，3 处）：
1. `startMockServer().close()`：`server.close()` 回调之后追加
   `closeIdleConnections()` + `closeAllConnections()`（两者 Node ≥18.2 起可用，
   满足 `engines >=20.9.0`）；
2. 脚本末尾 `process.exit(...)` → **`process.exitCode = ...`**，让 Node 自然退出；
3. `main().catch(...)` 也改为 **先 `await teardownMockServer()` 再设 `process.exitCode = 1`**。
   第 3 点是必需的：实测**若异常发生在 `mock.close()` 之前**（listening handle 仍存活），
   单纯去掉 `process.exit()` 会让进程**永久挂死**（60s 超时无输出），
   所以「删 process.exit」必须配套「异常路径也 teardown」。

**未采用**：改 `verify-all.mjs` 语义（禁止假绿）、`setTimeout` 延迟退出、
改 `scripts/run-ts.mjs`、升级 `engines`。

**三条退出码路径回归**（用临时副本注入故障后实测，副本已删除）：

| 场景 | 退出码 | 耗时 | 崩溃 |
|---|---|---|---|
| 正常全通过 | 0 | 1.6s | 无 |
| 中途抛异常（teardown 未跑） | 1 | 0.2s | 无、**不挂死** |
| 断言失败 1 项 | 1 | 1.5s | 无 |

**修复后门禁**：`npm run verify` → **14 通过 · 0 失败 · 1 跳过**（跳过仍是
`migrations:static`，本机无 sqlglot，与本项无关；§7.7 已补齐至 15/0/0）·
单跑 `verify-ai-core.ts` **3/3 exit 0**。

**仍未验证**：**Node 20 LTS = NOT VERIFIED** —— 本机只有 `C:\Program Files\nodejs\node.exe`
v24.12.0，无 nvm/volta/fnm，未安装其他版本。API 层面兼容（两个方法 v18.2.0 起存在），
但「Node 20 下 PASS」没有实测过，不要当成已验证。

**残留问题（本批次不处理）**：`scripts/verify-*.ts` 里其余脚本仍用
`process.exit(...)` 收尾；它们当前不崩（无 keep-alive socket），
但属同一风险模式。见下文新增 **F9.7-17**。

---

### F9.7-17 其余 `verify-*.ts` 仍用 `process.exit()` 收尾（同风险模式，当前不崩）

- **文件**：`scripts/verify-auth.ts`、`scripts/verify-storage.ts`、
  `scripts/verify-billing.ts`、`scripts/verify-admin.ts`、`scripts/verify-workflow.ts`
- **问题**：与 F9.7-16 相同的写法 —— 末尾 `process.exit(code)`。
  F9.7-16 已证实「`process.exit()` + 残留 libuv handle」在 Node 24 / Windows 会命中断言。
  这几个脚本目前不崩，因为它们**完全不建立 HTTP 连接** ——
  `grep -n "fetch(\|createServer\|listen(" ` 对这 5 个文件**零命中**（均为纯逻辑 / 内存 fake）。
- **风险**：**低-中** —— 一旦有人往这些脚本里加真实 `fetch` 或本地 server，
  就会复现同一类「断言全过但门禁红」。
- **建议修法**：与 F9.7-16 一致（`process.exitCode` + 完整 teardown），
  或统一抽一个 `scripts/finish-with.ts`。**不要在本次单独改**，
  等下一个确实要动这些脚本的阶段顺手做。
- **推荐阶段**：Phase 9.8 之后的清理批次。

---

## 四、承接自 Phase 9.6 的遗留项处置

| 编号 | 9.6 的建议 | 9.7 的处置 | 状态 |
|---|---|---|---|
| **F9.6-1** | Phase 9.7 说明如何建 `.venv`；或把静态检查迁到 Node | ✅ **已文档化**：`DATABASE.md` §9.2 给出建 venv 的完整命令、`PYTHON=` 用法、`--strict` 语义，以及 `verify-all.mjs` 的 Python 探测顺序。**未迁到 Node**（属代码改动，规格禁止）。2026-09-30：本机已按 §9.2 建好 `.venv` + `sqlglot 30.20.0`，`/.venv/` 加入 `.gitignore`，静态校验纳入常规门禁（见 §7.7） | ✅ **已关闭**（文档 + 本机环境都到位；仍依赖使用者各自建 venv） |
| **F9.6-2** | `NEXT_PUBLIC_ENABLE_CREEM` 确认无部署依赖后移除 | ✅ **已确认代码零读取**（`grep` 全仓库 0 命中），并**修正了 `.env.example` 里指向已退役 `npm run check` 的误导注释**。**未移除变量**（移除属配置变更，且可能影响既有部署） | 🟡 注释已修正，变量保留 |
| **F9.6-3** | 若未来需要覆盖率或组件测试，再引入 vitest；不在 9.6 引入 | 维持不引入。`MOTHER_TEMPLATE.md` §1.2 与 `AGENT_GUIDE.md` §2.5 都**明确写了「禁止新增测试框架」**，避免后来的 Agent 自作主张 | ✅ 决策已固化进文档 |
| **F9.6-4** | 具备真实环境时手动执行 `npm run smoke:ai` 并记录 | ✅ **已文档化**：`MOTHER_TEMPLATE.md` §8.3 把它归入「HTTP smoke test」类并标注**不在 `verify` 内**、需要哪些凭据、`SMOKE_*` 全部环境变量、以及「跑前必须重启 dev server」；`AI_CORE.md` §12 加了「三类验证不要混淆」的警告。⚠️ **仍未实际执行**（本机凭据是占位符） | 🟡 文档已关闭，**验证仍 NOT VERIFIED** |
| **F9.6-5** | 保持 INFO；若要治理需先定规则 | 维持 INFO。`MOTHER_TEMPLATE.md` §8.2 / §8.4 与 `AGENT_GUIDE.md` §4.2 都写明「约 209 个未使用导出，多数是合理 API 面，**不要照单删除**」 | ✅ 决策已固化进文档 |
| **F9.6-6** | 若策略变更，把 `npm run verify` 封进 `ci.yml` | 维持本地 CI。`MOTHER_TEMPLATE.md` §8.6 **引用了 workflow 文件里的原文注释**（"Charlie's policy: all CI runs locally, not on GitHub"），并写明「脚本已就绪，策略变更时只需包一层」 | ✅ 决策已固化进文档 |
| **F9.6-7** | Phase 9.7 统一处理 `docs/archive/` 与 `ARCHITECTURE.md` 的历史 env 引用 | ✅ **已处理**，方式是规格 §十三 要求的「保留 + 标记 historical」而非修改内容：`ARCHITECTURE.md` 加横幅、`REFACTOR_PLAN.md` 加横幅、`archive/README.md` 修计数、`docs/README.md` §4/§6 明确分类。**未改 archive 内部任何文件**（规格明令禁止） | ✅ 已关闭 |

---

## 五、交接说明

### 5.1 ⚠️ `PHASE_9_7_AUDIT.md` 与本文件的关系

`PHASE_9_7_AUDIT.md` 是在**用户规格送达之前**写的（该文件自己声明：
「本阶段规格未提供（用户消息在 Phase 9.6 结尾处截断）」），
因此它是按路线图条目「9.7 Mother Template 文档」**字面推测**目标做的审计。

差异对照：

| | AUDIT 推测的 | 规格实际要求的 | 本阶段执行 |
|---|---|---|---|
| 入口文档 | 更新 `PROJECT_STATUS.md` 作为入口 | 新建 **`docs/MOTHER_TEMPLATE.md`** 作为入口 | ✅ 按规格：新建 MOTHER_TEMPLATE，PROJECT_STATUS 降为「时间线 + 命令 + 缺陷」 |
| 二开指南 | `docs/TEMPLATE_GUIDE.md` | 未指定文件名，要求「Product Development Guide」 | ✅ 命名 **`docs/PRODUCT_GUIDE.md`**（`TEMPLATE_GUIDE.md` **从未创建**；工作区里曾有两处指向它的死链，已修） |
| Agent 约束 | 未提及 | 明确要求 **`docs/AGENT_GUIDE.md`** | ✅ 已建 |
| 文档体系 | 8 条动作清单 | 11 类文档 + 「优先复用，不要为数量造文档」 | ✅ 4 新建 + 7 类靠升级现有文档承担 |
| 裁决项 (A)(B)(C) | 3 个待用户裁决 | 规格未回应 | (A) 见 F9.7-15；(B) 已按规格在 9.7 写；(C) 已在索引里单独分组（`docs/README.md` §5） |

**AUDIT 里的事实性发现（D-1 ~ D-8）依然有效**，且本阶段全部处理或记录了；
但**它的「建议执行清单」不要当作本阶段的验收标准**，以本文件 §一 为准。

### 5.2 给 Phase 9.8 的四条硬性提醒

0. ~~**先修 F9.7-16，否则不要开始 9.8。** 门禁当前是红的~~
   → **已完成**（2026-09-30 收尾批次，见本文件 §七 与 F9.7-16 的「✅ 已修复」小节）。
   门禁现为绿；开始 9.8 前仍建议确认 `npm run verify` 本机输出，
   因为 `migrations:static` 在**没有 `.venv` 的机器上**是 SKIP（不算通过）——
   `.venv/` 不入库，每人 clone 后自建一次，见 `DATABASE.md` §9.2。
   本机已于 2026-09-30 建好 venv，现为 **15 通过 · 0 失败 · 0 跳过**（见 §7.7）。
1. **不要用 `npm run verify` 做「删产品看 Core 能否编译」的实验** ——
   验证脚本自身 import 产品（F9.7-5），且 `verify-product-boundary` 在产品目录为空时直接 FAIL。
   正确方法见 `PRODUCT_GUIDE.md` §7。
2. **`verify-product-boundary.mjs` 打印的那句「删除 products/ 后 Core 仍可编译」不可信** ——
   它没检查 `scripts/**` 与 `src/proxy.ts`（F9.7-6）。
3. **先解耦再验证**：F9.7-1（proxy）、F9.7-3（Core 配置含品牌）、F9.7-5（无注册表）
   是 9.8 的**前置工作**，不是 9.8 的发现项。

### 5.3 本阶段边界（实际遵守情况）

规格 §十五 的禁止项，逐条确认**未触犯**：

```
创建第二产品          ❌ 未做（PRODUCT_GUIDE 里的 example-product 只是文档示例）
修改 Flux 业务        ❌ 未做
修改 AI Provider      ❌ 未做
修改 Billing          ❌ 未做
修改 Workflow         ❌ 未做
修改 DB schema        ❌ 未做
新增 migration        ❌ 未做
新增支付/小程序/App    ❌ 未做
新增 Queue/Worker/Temporal ❌ 未做
新增测试框架          ❌ 未做
新增依赖              ❌ 未做（package.json 未改）
大规模重构            ❌ 未做
重写 archive          ❌ 未做（archive 内只改了 README.md 的 2 行计数与指引）
进入 Phase 9.8        ❌ 未做
```

---

## 六、架构验证

```
API / Webhook → Service → Repository → Supabase      ✅ 成立（audit:architecture）
Product → Core                                        ✅ 成立（单向）
Core → Product                                        ❌ 0（verify:product-boundary）
Product → Product                                     ❌ 0（同上）
Business → legacy database.ts / legacy payment.*      ❌ 已全部消除（9.1 / 9.2）
```

**但请注意适用范围**：上面的 `Core → Product = 0` 只对
`verify-product-boundary.mjs` 的 **14 个 CORE_DIRS** 成立。
`src/proxy.ts`、`vercel.json`、`scripts/**`、`src/lib/user-tiers.ts`、`src/lib/site-config.ts`
**不在覆盖范围内**，其中前三者确实存在产品耦合（F9.7-1 / F9.7-2 / F9.7-5）。

质量门禁链路（未变）：

```
代码  →  npm run verify  →  Test(verify-*)  →  Static Audit  →  Build  →  Migration Validation
                                                                              （静态 + 真实 PG）
```

**当前门禁状态（2026-09-30，收尾批次后）**：`15 通过 · 0 失败 · 0 跳过` → ✅
（含 `migrations:static`，因显式指定了带 sqlglot 的 `PYTHON`）。
门禁恢复过程见 §七。

**本阶段未修改数据库 schema，未新增 migration。**
`src/**` 零改动；`scripts/**` 有 4 处改动，全部为**测试工具自身的健壮性修复**
（F9.7-16 + §七），不含任何产品逻辑。

---

## 七、2026-09-30 收尾批次（门禁恢复 + 计数核对）

上一轮结束时工作区**未提交**，且 §2.1 记录的门禁是红的。本批次做了三件事，
全部**只动 `scripts/**` 与 `docs/**`**。

### 7.1 ⚠️ 环境发现：本机 `spawnSync` / `execSync` 恒失败（`EBUSY`）

排查 F9.7-16 时发现：**同步 spawn API 在当前环境完全不可用**。

| 调用 | 结果 |
|---|---|
| `spawnSync('echo', ['hi'])` | ❌ `status=null`，`error.code = EBUSY` |
| `execSync('echo hi')` | ❌ `EBUSY` |
| `spawn('echo', ['hi'])`（异步） | ✅ `status=0` |
| 从 bash 直接 `cat package.json` | ✅ 正常 |

- **与 Node 版本无关**：Node **22.22.2** 与 **24.12.0** 表现一致。
- **与 sandbox 开关无关**：非沙箱模式下同样 `EBUSY`。
- **不影响 npm**：`npm run lint` 正常（npm 内部用的是**异步** `spawn`）。
- **结论**：这是**运行环境的限制**，不是仓库缺陷。但它意味着
  **任何依赖同步 spawn 的工具链在本机都跑不起来** —— 而 `verify-all.mjs` 恰好用了
  `spawnSync`，`verify-auth.ts` / `verify-storage.ts` 用了 `execSync`。

### 7.2 修复 1：`verify-all.mjs` 改用异步 `spawn`

- **改动**：`spawnSync` → 新增 `run()` 助手（异步 `spawn` + 流式收集）；
  `resolvePython()` 与 `runStep()` 改 `async`，主循环 `await`。
- **顺带收益**：不再受 `maxBuffer` 限制、输出流式、跨平台更稳。
- **语义不变**：仍是「FAIL 即退出 1」「SKIP 不算通过」「聚合报告」。

### 7.3 修复 2：去掉验证脚本对 `cat` / `grep` 的依赖

`verify-auth.ts`（14 处 `execSync`）与 `verify-storage.ts`（1 处）原先用
`execSync('cat ...')` / `execSync('grep -rn ...')` 读源码。

- **这本身就是可移植性缺陷**：`cat` / `grep` 是 **Unix 工具**，
  纯 Windows（PATH 无 Git Bash）上不存在 → 母模板的验证脚本在 Windows 上会失败。
- **改动**：新增 `scripts/source-scan.ts`（`readSource()` / `grepSource()`，纯 Node 实现，
  输出格式与 `grep -rn` 一致），替换全部 15 处调用。
- **顺带**：`verify-admin.ts` 有一个**未使用的** `execSync` import，已删除。
- **`scripts/kill-ports.js` 保留 `execSync`**：它是开发便捷脚本（`kill:ports`），
  本身就是在调 `taskkill` / `kill`，不在门禁链路上。

### 7.4 修复 3：核对并移除文档里硬写的断言计数（F9.7-14）

实测各脚本计数，发现 §8 的数字**两处失真**：

| 脚本 | 文档原写 | 实测 |
|---|---|---|
| `verify-admin` | 47 项 | **45** |
| `verify-auth` | 13 项（Phase 6 时代的旧值） | **28** |
| `verify-storage` | 20 项 | 20 ✅ |
| `verify-workflow` | 42 项 | 42 ✅ |
| `verify-ai-core` / `verify-billing` | — | **只打印「全部通过」，不打印计数** |

→ 按 `DATABASE.md` 已确立的约定（「断言数量由运行时计数，不要在文档里硬写」），
把计数从 `PROJECT_STATUS.md` §8 移除；历史阶段表里的计数加「当时」限定。

### 7.5 门禁恢复验证

```
npm run verify  →  15 通过 · 0 失败 · 0 跳过   ✅
```

| 验证项 | 结果 |
|---|---|
| `verify-ai-core.ts` 单跑 ×3（Node 22.22.2） | ✅ exit 0 / 0 / 0 |
| `verify-ai-core.ts` 单跑 ×3（Node 24.12.0） | ✅ exit 0 / 0 / 0 |
| **A/B 对照**：HEAD 原始版本（含 `process.exit`）在 Node 24 | ❌ 断言全过后崩溃（libuv `async.c` 断言），证实 F9.7-16 的修复**确有实效** |
| `verify-auth.ts` | ✅ 28 通过 / 0 失败 |
| `verify-storage.ts` | ✅ 20 通过 / 0 失败 |
| 文档内部链接 | ✅ 136 个链接，**0 失效** |
| 失效路径复扫 | ✅ 剩余命中**全部**是「已删除/历史/示例」的合规标注 |

> ⚠️ **仍未验证**：Node **20 LTS**。本机只有 22.22.2 与 24.12.0，
> 无 nvm/volta/fnm。`package.json` 的 `engines` 写的是 `>=20.9.0`，
> 而修复用到的 `closeIdleConnections()` / `closeAllConnections()` 自 Node 18.2 起存在
> —— API 层面兼容，但**没有实测**，不要当成已验证。

### 7.6 未做

- ~~`ARCHITECTURE.md` 处置（F9.7-15）→ **待用户裁决**~~
  → **已裁决并执行**（2026-09-30 移入 `docs/archive/`，见上方 F9.7-15 横幅）
- F9.7-1 / 2 / 3 / 4 / 5 / 7 / 8 / 9 / 11 / 12 / 13 → 均属**代码/配置**改动，不属本批次
- F9.7-17（其余 verify 脚本仍用 `process.exit()`）→ 当前不崩，留后续
- ~~`migrations:static` 在本机仍需显式 `PYTHON=`（F9.6-1，仓库无 `.venv`）~~
  → **已解决**，见 §7.7

### 7.7 migrations:static 补齐（2026-09-30 第三批）→ 门禁 **15 / 0 / 0**

目标：让 `npm run verify` 不再有任何 SKIP。

**做的三件事**：

1. **建本地 venv**（按 `DATABASE.md` §9.2 的既有约定，非新发明）：
   ```bash
   python -m venv .venv                                            # Python 3.13.12
   .venv/Scripts/pip install -r supabase/scripts/requirements.txt   # → sqlglot 30.20.0
   ```
   `verify-all.mjs` 的探测顺序里 `.venv/Scripts/python.exe` 排第 2，**无需再设 `PYTHON=`**。
2. **`.gitignore` 加 `/.venv/` + `__pycache__/` + `*.py[cod]`**。
   此前 `.venv` 从未被忽略 —— 一旦有人照文档建 venv，`git status` 就会冒出几万个未跟踪文件，
   极易被误提交。
3. **修 Windows 编码缺陷**（`supabase/scripts/validate_migrations.py`，4 行）：
   脚本在打印结尾的 `✅ 全部通过…` 时抛
   `UnicodeEncodeError: 'gbk' codec can't encode character '\u2705'`
   → **校验实际全过（170 语句 / 解析失败 0），但进程以退出码 1 结束，门禁记成 FAIL**。
   修法是在任何 `print` 之前把 stdout/stderr 重设为 UTF-8：
   ```python
   sys.stdout.reconfigure(encoding="utf-8", errors="replace")
   sys.stderr.reconfigure(encoding="utf-8", errors="replace")
   ```
   放在导入 `sys` 之后、`import sqlglot` 之前，使「缺少 sqlglot」那条中文提示也不会踩同一个坑。
   直跑 `.venv/Scripts/python.exe supabase/scripts/validate_migrations.py` 同样验证 exit 0、输出无乱码。

**这是真绿还是假绿？** —— 真绿。没有改 `verify-all.mjs` 的判定语义，
没有把 SKIP 改成 PASS，没有动 SQL 迁移内容，也没有放宽校验器；
补的是**工具链缺失**与**输出编码导致的假失败**。

**结果**：

```
npm run verify  →  15 通过 · 0 失败 · 0 跳过   ✅ 门禁全部通过
migrations:static   PASS 0.5s（0000~0009，170 语句，解析失败 0）
migrations:real     PASS 2.4s（PGlite，每个迁移跑两遍）
```

**残留**：`.venv` 仍是**每台机器各自建**（不入库）—— 这是刻意选择：
把 Python 虚拟环境提交进仓库会让母模板体积失控。
新人的踩坑点从「不知道要建 venv」变成「建了但被 git 跟踪」，两者都已在 §9.2 / `.gitignore` 关闭。
