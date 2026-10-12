# PROJECT_STATUS.md — 项目现状总览

> 更新时间：2026-10-10 · 覆盖 **Phase 1 ~ 9.8.2-D**
> **这是接手本项目时应该第一个读的文档之一。**
>
> ⚠️ 本仓库以**单个初始提交**发布：下文「出处」列里的 `9.8.2-C` 这类标记是发布前原仓库的阶段 /
> 提交主题，在本仓库解析不出 git 对象（判据与实测数字仍然有效，见 §1 各段）。
>
> - 想了解**架构与边界** → [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md)（**项目入口文档**）
> - 想按主题查细节 → [`docs/README.md`](./README.md)（全部文档的索引）
> - 本文负责：**阶段时间线、命令速查、缺陷状态**

---

## 1. 项目定位

**目标**：从 `flux-kontext-template` 逐步抽取通用的 **`my-ai-saas-template`**。
不是「修复 Flux 模板」，而是把它变成可复用的 AI SaaS 母模板。

**当前状态**：Phase 1 ~ 9.6 已完成并验收；**Phase 9.7（Mother Template 文档）已完成**；
**Phase 9.8.1（架构基线审计）已完成 → 结论 BLOCKED**；
**Phase 9.8.2 切片 2(a) 内容间接层、2(b) Edge / Deployment 解耦、2(c) 产品配置与 Core 机制分离、
2(d) `scripts/**` 去产品化 —— 全部完成**。
**9.8.2-D 另用真实的第二产品（Product B fixture，隔离 worktree，Flux 全删）证明了可复用性**，
并在该场景里发现并修掉了 3 个母版缺陷（见 §2 时间线与 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)）。

- **基础设施**（AI / DB / Credit / Billing / Storage / Auth / Admin / Workflow）已全部抽象完毕，
  且**不含任何 Flux 产品语义**（`npm run verify:product-boundary` 守卫 Core → Product = 0）。
- **Flux Kontext 已降级为产品模块**，位于 `src/lib/products/flux-kontext/`，只能单向依赖基础设施。
  2(c) 之后它**owning 自己的模型目录、积分成本、Provider 模型映射、能力表与套餐表**；
  Core 只留形状（`ProductConfig` / `BillingPackage`）与机制（绑定、校验、查询、执行流程）。
- **遗留代码已清空**：伪 Prisma 适配器（9.1）、Legacy Payment 簇（9.2）均已删除，
  且 `audit:architecture` 阻止复活。
- **质量门禁**：`npm run verify` 一条命令跑完 19 步（lint / 守卫 / 验证 / 迁移 / 构建）。
  自 9.8.2-B 起新增 `verify-api-routing.ts`（`/api/v1` 路由链与 Flux 兼容层契约），
  历史验收数字「15/0/0」自此变为「16/0/0」—— 是覆盖变广，不是旧结果有假。
  自 9.8.2-C 起再加两步：`verify:product-seam`（每个服务入口的闭包里都有装配接缝）与
  `verify-product-config.ts`（产品配置包完整性 + 违规样例 + Core 词表扫描），
  即「18/0/0」。
  自 9.8.2-D 起是 **19 步**：产品专属断言从共用脚本里拆出来，独立成
  `verify-flux-kontext.ts`，并带 `@product-scope flux-kontext` 标记 ——
  产品目录不在时该步报 **SKIP，绝不报 PASS**，脚本根本不会被执行。
  因此「删掉产品后门禁数字变少」是**设计行为**：产品少一个，它自己的测试也少一步。
- **文档体系已建立**（9.7）：入口 `MOTHER_TEMPLATE.md`、Agent 约束 `AGENT_GUIDE.md`、
  二开指南 `PRODUCT_GUIDE.md`，索引在 `docs/README.md`。

> ⚠️ **「Core 不含产品语义」的判据在 9.8.2-C 换过一次。**
> Phase 9.7 / 9.8.1 审计发现的 10 条边界例外（`src/proxy.ts` 与 `vercel.json` 的 Flux 重写、
> `MODELS` / `CREDIT_COSTS` 只含 flux 模型、2 个路由绕过 Repository、无产品注册表等），
> 全部记录在 [`MOTHER_TEMPLATE.md` §5.4](./MOTHER_TEMPLATE.md) 与
> [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。其中「守卫只查手写 `CORE_DIRS` 清单」
> 这个盲区本身已被修掉：`verify-product-boundary` 现在按**排除法**取 Core
> （`src/` 除 `src/lib/products/**` 与 `src/app/**` 的每一文件），并另跑一遍
> **从产品配置包派生的词表**扫描（`verify-product-config.ts` §4，带正对照）。
>
> **2(a) 当时的实测**（移走 `src/lib/products/flux-kontext/` 后跑 `tsc --noEmit`）是
> 8 条错误，全部落在产品对外面；Core 与 `src/components/**` 零报错。
> 当时判为「整体仍不成立」的三项里：**Core 配置里的产品数据已由 2(c) 消除**，
> 验证脚本对产品的依赖（`scripts/**`，不在 `tsc` 范围内）**由 2(d) 按归属分区解决**，
> 「不存在产品注册表」则**确认为刻意选择**而非缺陷（见 §10.1）。
>
> **Phase 9.8.2 切片 2(b) 已解掉的一项**：`src/proxy.ts` 不再认识任何产品 ——
> `/api/v1/*` 改为通用版本前缀剥离（`/api/v1/<rest>` → `/api/<rest>`），Flux 的 legacy
> 公共路径由产品自己的 `src/app/api/flux/[[...path]]/route.ts` 承接；`vercel.json` 的
> 5 条同应用 rewrite 全部删除。
>
> **9.8.2-B-Gate 已补齐真实的隔离删除实验**（基准 HEAD
> `b1996b8e1252750af448503a8b55451b9d06763d`，独立 `git worktree` + 依赖真实复制，
> 主工作区产品目录全程未被改动）：删除前隔离副本 `npm run lint` **exit 0**（证明环境可信）；
> 删除 `src/lib/products/flux-kontext` 后 `npm run lint` **exit 2**，其中 `eslint .` **exit 0**、
> `tsc --noEmit` 报 **8 条错误** —— `src/app/api/flux-kontext/route.ts` 7 条（1 条 `TS2307`
> 模块缺失根因 + 6 条由此派生的 `unknown`）、`src/app/product-content.ts` 1 条 `TS2307`。
> `src/proxy.ts`、`vercel.json` 与 Core **没有出现预期之外的断裂**，数字与 2(a) 的 8/7/1 逐字一致
> —— 2(b) 既没有扩大断裂面，也没有把它「修绿」。**lint 失败落在产品的两个预期接缝上，
> 不是 Edge / Deployment 解耦的失败**。
> **结论边界**：本实验补齐的是 9.8.2-B 的验收证据；本次**未运行 `npm run build`**，
> Vercel Preview 路由优先级**仍未验证**。它当时遗留的 2(c) 已由下面的 2(c) 完成。
>
> **9.8.2-C：Core 只剩机制，产品数据全部回到产品目录**（代码 `9.8.2-C`）。
> Core 侧新增 `src/config/product.ts`（`ProductConfig` 形状 + `bindProductConfig()`
> 绑定前完整性校验 + `getProductConfig()` **未绑定即抛错**）与装配接缝
> `src/app/product-runtime.ts`；产品侧新增 `catalogue.ts` / `credits.ts` /
> `provider-data.ts` / `providers.ts` / `billing.ts` / `capabilities.ts` / `config.ts`，
> `src/lib/ai/models.ts` 与 `src/config/billing.ts` 的内联表被删空成查询机制，
> `src/config/credits.ts` 删除，`src/lib/user-tiers.ts` 改名进产品目录。
> **为什么是显式接缝而不是运行时注册**：Next.js 按路由分包，某模块的注册副作用
> 无法被证明在所有路由里都发生过；`instrumentation.ts` 虽在本版 Next 稳定，但那是
> **第二套**注册机制且无法静态核对，因此约定为「每个服务端入口静态 import 接缝」，
> 由 `scripts/verify-product-seam.mjs` 沿 import 图逐个核对（当前 82 个入口，
> 未绑定探针 1 个带 `@seam deliberate-unbound` 标记）。
> **隔离删除实验（基准提交 `9.8.2-C`，独立 worktree + 依赖真实复制，主工作区全程未动）**：
> 基线 `tsc`/`eslint` 双 exit 0；第一遍只删产品数据与两个装配点 → `tsc` **18 条错误全部**
> 落在产品消费者，Core 机制零报错；第二遍再删 Flux 的路由 / 页面 / 产品 UI →
> `tsc` **exit 0**、`eslint` **exit 0**、`audit-architecture` **PASS**、
> `verify-product-boundary` **PASS**（104 个 Core 文件 0 违规，§B 打印「产品目录为空：不适用」）；
> `verify-product-seam` 在该状态下 **FAIL 32 条**，报「该 bundle 里 `getProductConfig()` 会抛错」——
> 这是**设计要的**结果：没有产品的母版不会拿着默认模型 / 默认价格继续跑。
> **边界（已在 9.8.2-D 更正）**：该轮实验当时认为 worktree 跑不了 `next build`，所以**不含**
> build 证据；实际 `node_modules` 用 `robocopy /E /MT:16` 真实复制后 build 可跑通（见下）。
> build 当时由主工作区 `npm run verify` 的 18/18 单独证明。
> **当时仍未解决**：2(d) `scripts/**` 去产品化 —— 已由下面的 9.8.2-D 处理。
>
> **9.8.2-D：脚本层去产品化（2(d)）+ 用真实的第二产品证明可复用**。
> ① **2(d)**：新增 `scripts/product-discovery.ts`（按形状枚举产品目录、从**已绑定 bundle**
> 派生词汇表）；`verify-ai-core.ts` / `verify-billing.ts` 等共用脚本改为零产品字面量，
> 只有 Flux 才成立的断言（价目数字、渠道商品 id、tier 限额、115 条）整体搬进
> `scripts/verify-flux-kontext.ts`，头部声明 `// @product-scope flux-kontext` ——
> `verify-all.mjs` 在产品目录缺失时判 **SKIP，绝不 PASS**。门禁 **18 → 19 步**。
> ② **Product B 实测**（`aurora-portrait` fixture，独立 worktree，Flux 全删）：
> `npm run lint` exit 0、`npm run verify` **17 通过 · 0 失败 · 1 跳过（exit 0）**、
> `next build` **PASS**（44 个静态页，通用 `/api/ai/image`、`/api/ai/tasks` 在路由表里）、
> `migrations:real` PASS、`migrations:static` 需显式 `PYTHON` 才 PASS（首轮 SKIP，未谎报）。
> **接入 B 只改了产品目录 + 两行装配点，Core 业务逻辑一行没改**；它反过来暴露并修掉
> 三个真实缺陷：`requiredInputImages` 未在统一入口强制、缺图错误被分类成可重试的
> `INTERNAL_ERROR`（白重跑 3 次 + 回 500）、共享组件按固定下标取文案条目
> （要求每个产品都提供同样条数）。另修 `audit-dead-files.mjs` 白名单里硬写的 Flux 文件。
> 完整过程与判据见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)。
> **产品注册表仍不存在**（单部署单产品，这是**选择**，见 §10.1）。
>
> **9.8.2-D 补充交付：项目正式改名**（不另开阶段）。**最终名 = `ai-saas-template`**
> （与新仓库名一致；本轮内曾先统一为 `my-ai-saas-template`，该中间名已作废，下面的记录按当时状态保留）。
> 改的是**母版身份**：`package.json` + `package-lock.json` 的 `name`（两处必须同步，否则 `npm ci`
> 判为不同步）、`README.md` 标题、`public/manifest.json`、`.env.example` 里
> `NEXT_PUBLIC_PROJECT_NAME` 的默认值、`src/lib/site-config.ts` 的回落值。
> **逐项判断，不做全局替换**：上游来源（`CharlieLZ/flux-kontext-template` 的
> `LICENSE` 版权行 / `docs/archive/**` 原始资料）、Flux Kontext 这个**示例产品**的名字、
> 第三方依赖名、`docs/archive/**` 与历史行里的旧称，**全部保留**。
> （发布到新 GitHub 账号时，`.github/ISSUE_TEMPLATE/config.yml` 的安全报告 URL 改指本仓库 ——
> 漏洞报告要到达当前仓库所有者；`LICENSE` 版权行不动。）
> 品牌与身份从此分离：产品换品牌只改 `NEXT_PUBLIC_PROJECT_NAME`，不碰母版名 —— 完整清单
> 与每条保留理由见 [`PRODUCT_GUIDE.md` §4.5](./PRODUCT_GUIDE.md)。**改名与最终定名都在
> Phase 9.8.2-D 这一轮完成**，验证：改名后门禁 **19 通过 · 0 失败 · 0 跳过**（exit 0，含 `verify-flux-kontext` 与 `build`），
> 并在 `NEXT_PUBLIC_PROJECT_NAME` 留空时实测回落（`next dev` + curl 首页）：meta
> `author` / `creator` / `publisher`、`og:site_name`、JSON-LD 的 Organization / WebSite、
> Logo 文字与 `/llms.txt` 标题全部变成 `ai-saas-template`（首页 `<title>` 仍是
> 「Flux Kontext AI - …」—— 由产品页自己的 metadata 覆盖，属 §10.1 已登记的
> 「产品页品牌串残留」，不是回落失效）。

详见 §2 时间线、[`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md)（架构与边界）与
[`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md)（如何换成你自己的产品）。

---

## 2. 阶段时间线

| Phase | 主题 | 状态 | 关键产出 | 出处（原仓库阶段） |
|---|---|---|---|---|
| 1 | 分析（只读） | ✅ | `ARCHITECTURE.md` / `REFACTOR_PLAN.md` / `REFACTOR_DECISIONS.md` | `1` |
| 2 | **AI Core** | ✅ | `src/lib/ai/`（AIService / AIProvider / 模型目录） | `2` |
| 3 | **Database / Schema / Repository** | ✅ | `supabase/migrations/0000~0004` + `src/lib/db/` | `3` |
| 3.5 | **Credit 原子扣减** | ✅ | `0005` + `consume_credits()` RPC | `3.5` |
| 4 | **Credit + Billing 商业闭环** | ✅ | `src/lib/billing/` + `0006` + `grant_credits()` | `5 前检查点` |
| 5 | **Storage 基础设施抽象** | ✅ | `src/lib/storage/` | `5` |
| 6 | **Auth + Template Cleanup** | ✅ | session 注入 user.id + `0007` + `users.role` | `6` |
| 6.5 | **Admin Foundation + Console** | ✅ | `src/lib/admin/` + `/admin/*` + `0008` | `6.5` |
| 7 | **Workflow / Async Task Engine** | ✅ | `src/lib/workflow/` + `0009`（`ai_tasks` 扩展）+ `/api/ai/tasks` + 用户 `/tasks` | `7` |
| 8 | **Flux Business Decoupling** | ✅ | `src/lib/products/flux-kontext/`；`/api/flux-kontext` 改走 `WorkflowService`；删 `flux-bridge.ts` | `8` |
| 9.1 | **移除遗留 database 适配器** | ✅ | 删 `src/lib/database.ts`（伪 Prisma，700 行）；9 处调用迁到 Repository | `注释修正` |
| 9.2 | **Payment Legacy → Billing 收口** | ✅ | checkout 内联进 `billing/providers/*`；删 18 个遗留文件；修 Stripe 100× 金额 bug | `9.2` |
| 9.3 | **Productization & 残留清理** | ✅ | 品牌/SEO 去 Flux 硬编码；删 `api/payment/create-session` + 8 个 debug 路由；新增 `.env.example` | `9.3` |
| 9.4 | **i18n / SEO 产品化** | ✅ | 产品文案迁 `products/flux-kontext/content/`；`lib/content/locale.ts` 收敛为纯机制 | `9.4` |
| 9.5 | **Environment / Config 整理** | ✅ | 修 `.gitignore`（`.env.example` 首次入库）；重写示例至 83 变量；新增 `audit:env` | `9.5` |
| 9.6 | **Test / CI / Migration 完整性** | ✅ | 新增 `npm run verify`（15 步本地 CI 门禁）；退役 6 个失效脚本；PGlite 入 devDeps | `9.6` |
| 9.7 | **Mother Template 文档** | ✅ | 新建 `MOTHER_TEMPLATE.md`（入口）/ `AGENT_GUIDE.md` / `PRODUCT_GUIDE.md` / `docs/README.md`（索引）；修 5 篇主题文档的失效引用；`ARCHITECTURE.md` / `REFACTOR_PLAN.md` 标记 historical；记录 10 条边界例外 | `9.7 文档` |
| 9.7+ | **收尾批次（不属任何 Phase：门禁修复）** | ✅ | 修 F9.7-16（`verify-ai-core.ts` 用 `process.exitCode` + 完整 teardown 取代 `process.exit`）；`verify-all.mjs` `spawnSync`→异步 `spawn`；新增 `scripts/source-scan.ts` 去掉脚本对 `cat`/`grep` 的 Unix 依赖；核对并移除文档里硬写的断言计数 | `门禁 spawn 修复` |
| 9.8 | **第二产品复制验证** | ✅ **四个切片 2(a)~2(d) 全部完成，可复用性已由 Product B 实测** | 静态验证：删 `products/flux-kontext/` 后 Core 是否仍能编译。**方法以 [`PRODUCT_GUIDE.md` §7 / §7.4](./PRODUCT_GUIDE.md) 为准** —— 判据是 `tsc --noEmit` + `eslint` + 三个产品无关守卫，**不是**「删掉产品后 `npm run verify` 全绿」（产品专属那步本来就该 SKIP）。**2(a)** 组件层、**2(b)** Edge / 部署路由、**2(c)** Core 不再携带产品数据（整面删除实验 `tsc`+`eslint` exit 0）、**2(d)** 脚本层按归属分区 + Product B 实装（`verify` + `build` 全绿）。剩余的非阻塞项见 §10.1 | — |
| 9.8.1 | **架构基线审计（只读）** | ✅ 审计完成 → 结论 **BLOCKED** | 实测：Core（`src/lib` 非 products + `src/config`）→ Product 的 import **为 0**，依赖方向干净；但复制能力不成立 —— 无产品注册表（F9.8-D）、8 个共享组件直接 import 产品内容（删产品则 build 断链）、`proxy.ts:79-100` 与 `vercel.json` 硬编码 Flux 路由（F9.8-A/B）、Core 配置携带产品数据（F9.8-C）。**新发现**：rewrite 注入的 `?action=` 无人消费（route 只读 body）。门禁 15/0/0。零代码修改 | `9.8.1 审计` |
| 9.8.2 | **内容间接层（切片 2(a)）** | ✅ 组件层解耦完成（**当时 9.8.2 整体仍 BLOCKED** → 2(d) 由 9.8.2-D 解除） | 新建 Core 内容契约 `src/lib/content/contracts.ts` + 唯一装配点 `src/app/product-content.ts`；8 个共享组件改为 props 驱动（`src/components/**` 对 `@/lib/products` 的 import **8 → 0**）；5 个页面接线装配点；删除 0 消费者的 `home-config.ts`（`HomeDictionary` 形状上移 Core）。**真实删除实验**：移走产品目录后 `tsc --noEmit` 仅 8 条错误，全部落在 `route.ts`(7) + `product-content.ts`(1)，**组件与 Core 零报错**；`src/app/product-content.ts` 成为换产品时唯一需改的内容文件 | 代码 `9.8.2-A`<br>文档 `9.8.2-A` |
| 9.8.2-B | **Edge / Deployment 解耦（切片 2(b)）** | ✅ 路由层解耦完成（**当时 9.8.2 整体仍 BLOCKED** → 2(d) 由 9.8.2-D 解除） | `src/proxy.ts` 的 Flux 分支改为**通用版本前缀剥离**（`/api/v1/<rest>` → `/api/<rest>`，保留查询参数，源码零产品词表）；Flux 的 legacy 公共路径由产品自己的 `src/app/api/flux/[[...path]]/route.ts` 承接 —— 该文件**只有一行再导出**，复用 `/api/flux-kontext` 的 POST/PUT，不复制任何业务逻辑，**R1：不从路径补 `action`**；`vercel.json` 删掉 4 条 Flux + 1 条通用 rewrite（同应用改写只留一层）；新增门禁 `scripts/verify-api-routing.ts`（15 → **16 步**）。**实测**：三个入口（`/api/v1/flux/*`、`/api/flux/*`、`/api/flux-kontext`）的状态码与响应体逐条一致；F9.8-A 的「任意 `/api/v1/*` 被无条件吞进 Flux」消失（不存在的路径恢复 404，`/api/v1/auth/session` 等真实路由可达）。**未验证**：Vercel Preview 的路由优先级；本切片只跑到 `npm run lint`，未跑 `build`。**删除实验已在 9.8.2-B-Gate 补齐**：独立 worktree（基准提交 `9.8.2-B`）移除产品目录 → lint exit 2、`tsc` 8 条错误全部落在 `route.ts`(7) + `product-content.ts`(1) 两个预期接缝，`src/proxy.ts` / `vercel.json` / Core 零意外断裂，与 2(a) 的 8/7/1 一致 | 代码 `9.8.2-B` |
| 9.8.2-C | **产品配置与 Core 机制分离（切片 2(c)）+ Billing 标识符契约（B）** | ✅ 本切片完成（**当时 9.8.2 整体仍 BLOCKED**：2(d) `scripts/**` —— 已由 **9.8.2-D** 解除；产品注册表是刻意选择，见 §10.1） | Core 新增 `src/config/product.ts`：`ProductConfig` 形状 + `bindProductConfig()`（**绑定前**跑完整性校验；同产品重复绑定合法以兼容 `next dev`；跨产品绑定拒绝）+ `getProductConfig()` 未绑定即抛错。产品新增 `config.ts` / `catalogue.ts` / `provider-data.ts` / `providers.ts` / `billing.ts` / `capabilities.ts`；`models.ts` 与 `config/billing.ts` 的内联产品表**删成查询机制**，`src/config/credits.ts` **删除**，`src/lib/user-tiers.ts` → `products/flux-kontext/tiers.ts`。装配点 `src/app/product-runtime.ts` 由**每个服务端入口**静态 import（按路由分包下唯一可静态证明的做法；不引入 `instrumentation.ts` 这第二套注册机制）。**B 段**：客户端只发内部 `packageId`，金额 / 积分 / 渠道商品 id 全部服务端从已绑定套餐表解析，legacy `/api/payments/create-checkout` 删除；Provider 的 base URL 与轮询时序改为**请求时**读取（模块级常量会被 import 顺序冻结）。**一致性**：定价页展示价 ⇄ 实付价 ⇄ 发放积分同源（`savePercent` / 「多送几个月」由派生而非写死，年付折扣实测 17%、多送 2 个月），注册赠送 100 积分三处同源。**守卫**：新增 `verify-product-seam.mjs`（82 入口闭包 + 客户端不得触达服务端配置 + `--self-test` 4 fixture）、`verify-product-config.ts`（27 项：包完整性 / 11 个违规样例 / 未绑定探针 / 派生词表扫 Core 带正对照）、`verify-product-boundary.mjs` 重写为**排除法** + 只能缩小的排版债务清单；`9.8.2-C` 修掉它在产品目录为空时的两处误诊。**门禁 16 → 18 步，18/0/0**（lint / 5 守卫 / 8 验证 / 迁移 2 / build 全绿）。**隔离删除实验见 §1 与 [`PRODUCT_GUIDE.md` §7.1](./PRODUCT_GUIDE.md)** | 代码 `9.8.2-C` |
| 9.8.2-D | **脚本层去产品化（切片 2(d)）+ Product B 复用实测** | ✅ **9.8.2 全部切片完成；可复用性判定 PASS** | **2(d)**：新增 `scripts/product-discovery.ts`（按形状枚举产品、从已绑定 bundle 派生词汇）；`verify-ai-core.ts` / `verify-billing.ts` / `verify-api-routing.ts` / `audit-dead-files.mjs` 去掉产品字面量；只有 Flux 才成立的断言搬进 `scripts/verify-flux-kontext.ts` + `// @product-scope flux-kontext`，`verify-all.mjs` 在产品目录缺失时判 **SKIP 绝不 PASS**；Flux 的保留 UI 改由 `products/flux-kontext/layout-debt.json` 声明。**门禁 18 → 19 步**。**Product B 实测**（`aurora-portrait`，隔离 worktree + `robocopy` 真实依赖，Flux 全删）：`npm run lint` exit 0、`npm run verify` **17/0/1** exit 0、`next build` **PASS**、`migrations:real` PASS、`migrations:static` 需显式 `PYTHON`；**接入 B 只建产品目录 + 改两行装配点，Core 业务逻辑零改动**。**B 暴露并由 `9.8.2-D` 修掉的 3 处真实耦合**：输入图契约未在统一入口强制（连带缺图被分类成可重试 `INTERNAL_ERROR`，白重跑 3 次 + 回 500）、`KeyFeatures` / `HowToSteps` 按下标取文案、`audit-dead-files` 白名单硬写 Flux 文件。**同时更正一条历史结论**：worktree 里 `next build` **可以**跑通（真实复制 `node_modules` 即可）。**补充交付：母版正式改名，最终名 `ai-saas-template`**（本轮中间名 `my-ai-saas-template` 已作废）—— 包元数据 / PWA / env 默认值与回落值；上游来源、`LICENSE` 版权行、依赖名与 Flux 产品名逐项保留，见 `PRODUCT_GUIDE.md` §4.5。过程与判据见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md) | 代码与改名同为 `9.8.2-D` 这一轮 |

> 每个阶段收尾都必须：`npm run lint` + `npm run build` 通过 → 回写 `REFACTOR_PLAN.md`。

---

## 3. 目标架构（已落地）

```
┌──────────────────────────────────────────────────────────────┐
│                        业务层（app/api、页面）                 │
└───────┬──────────────┬──────────────┬──────────────┬─────────┘
        │              │              │              │
   AIService     StorageService  BillingService  AdminService
        │              │              │              │
   AIProvider    StorageProvider PaymentProvider    │
        │              │              │              │
  fal/kie/ws/atlas     R2        creem/stripe       │
        │              │              │              │
        └──────────────┴──────────────┴──────────────┘
                              │
                    Credit（原子 RPC）
                    consume_credits() / grant_credits()
                              │
                    Repository 层（src/lib/db/）
                              │
                    Supabase PostgreSQL
```

**核心边界（不得回退）**：

| 规则 | 说明 |
|---|---|
| 业务层禁止直接 import `@/lib/ai/providers/*` | 只能走 `AIService` |
| 业务层禁止直接 import `@aws-sdk/client-s3` | 只能走 `StorageService` |
| 业务层禁止直接 import 支付渠道 SDK | 只能走 `BillingService` |
| 积分消费只能用 `credit.consumeCredits()` | 原子 RPC |
| 积分发放只能用 `credit.grantCredits()` | 原子 RPC |
| 权限判断只能用 `users.role` | 走 `getAdminContext()` |
| 业务层禁止直接创建 Supabase 客户端 | 走 `src/lib/db/client.ts` |

> ⚠️ **上表最后一条当前有 2 处违反**（Phase 9.7 审计发现，本阶段按规格未修）：
> `src/app/api/user/credits/route.ts`、`src/app/api/user/ensure/route.ts`
> 直接 `createAdminClient()` + `.from('users')` / `.from('credit_transactions')`。
> 详见 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) F9.7-6。
>
> 另外：上表 7 条规则里，**只有前 4 条与「Core 不依赖 Product」有脚本守卫**
> （`audit:architecture` / `verify-product-boundary` / `verify-storage.ts` / `verify-billing.ts`）。
> 「禁止直接创建 Supabase 客户端」**没有专门守卫**，靠 `verify-admin.ts` 局部覆盖 Admin 路由。

---

## 4. 四大抽象

### 4.1 AI Core（Phase 2）

```
业务层 → AIService（src/lib/ai/service.ts） → AIProvider → fal / kie / wavespeed / atlascloud
```

- `src/lib/ai/types.ts` — 通用契约，**零产品名**
- `src/lib/ai/models.ts` — 模型目录（10 个模型，`credits` 取自 `src/config/credits.ts`）
- `src/lib/ai/providers/` — 4 个 Provider 实现（`fal` / `kie` / `wavespeed` / `atlascloud`）
- 模型 → endpoint 映射留在各自 Provider 内部，不进中央配置
- `AIService` **不做**鉴权 / 积分 / 计费 / 数据库 —— 那些是 Workflow 层的职责
- ~~`FluxKontextService`（`src/lib/flux-kontext.ts`）是兼容层，Phase 8 删除~~
  → **Phase 8 的实际结果**：旧路径 `src/lib/flux-kontext.ts` 已删除，
  但 `FluxKontextService` **没有被删**，而是**迁到产品层**
  `src/lib/products/flux-kontext/service.ts`，成为 Flux 产品的正式 Service

### 4.2 Database（Phase 3 / 3.5）

```
src/lib/db/client.ts          ← 唯一客户端来源（service_role，server-only）
src/lib/db/types.ts           ← 手写行类型，与 migrations 一一对应
src/lib/db/repositories/*.ts  ← 数据操作（7 个），参数镜像列名（snake_case）
supabase/migrations/0000~0009 ← 编号 SQL，可重复执行（10 个文件）
```

- ~~`src/lib/database.ts` 是过渡适配器（伪 Prisma）~~ → **已于 Phase 9.1 删除**；
  业务代码统一 `API → Service → Repository`，`npm run audit:architecture` 守卫禁止其复活
- 订单表只有一张：`orders`（`payment_orders` 已 deprecated）

### 4.3 Credit + Billing（Phase 3.5 / 4）

```
consume_credits()  ← 原子扣减 + 幂等（0005）
grant_credits()    ← 原子发放 / 退款 + 幂等（0006）
```

- 幂等三层：`webhook_events`（事件级）→ `orders.idempotency_key`（checkout）→ `credit_transactions` 唯一索引（流水）
- `status='paid'` 与 `fulfilled_at` 分离 → 可识别「已付款未交付」
- **定价唯一真相**：`src/config/billing.ts`（套餐价格，整数最小单位）
- **积分成本唯一真相**：`src/config/credits.ts`（模型 → 积分，B-12 统一）
- **退款必须走 `grant_credits()` + `idempotency_key`**（B-10 修复后确立）

### 4.4 Storage（Phase 5）

```
StorageService → StorageProvider → R2Provider
```

- Object Key：`{namespace}/{userId}/{resourceId?}/{timestamp}-{random}.{ext}`
- namespace ∈ {uploads, generated, temporary}
- 唯一允许 import `@aws-sdk/client-s3` 的文件：`src/lib/storage/providers/r2.ts`

### 4.5 Auth + Admin（Phase 6 / 6.5）

```
Auth（NextAuth）→ session.user.id → getAdminContext() → users.role === 'admin'
```

- Session 已注入 `user.id`（Phase 6）
- **统一的「session → 业务用户」入口**：`src/lib/auth-session.ts` 的
  `getCurrentUser()` / `getSessionIdentity()`（F-1）
  —— 优先 `session.user.id`（主键），email 仅作老 session 兜底
- `users.role`：`user` / `admin`（迁移 0007）
- `ADMIN_EMAILS` 仅为 bootstrap 白名单
- Admin 页面禁止直接访问数据库

---

## 5. 每阶段产物索引

### Phase 2 — AI Core

| 文件 | 说明 |
|---|---|
| `src/lib/ai/types.ts` | `GenerateRequest` / `GenerateResult` / `AIProvider` |
| `src/lib/ai/models.ts` | 模型目录 |
| `src/lib/ai/service.ts` | `AIService` |
| `src/lib/ai/providers/{fal,kie,wavespeed,atlascloud,index}.ts` | Provider 实现 + 注册表 |
| `docs/AI_CORE.md` | 设计文档 |
| `scripts/verify-ai-core.ts` | 静态契约 + 完整管线验证 |

### Phase 3 / 3.5 — Database + Credit 原子性

| 文件 | 说明 |
|---|---|
| `supabase/migrations/0000~0005` | baseline / credit / orders / subscriptions / ai_tasks / atomic credit |
| `src/lib/db/{client,types}.ts` | 客户端 + 行类型 |
| `src/lib/db/repositories/{user,credit,order,subscription,ai-task}.ts` | Repository |
| `supabase/scripts/validate_migrations.py` | 迁移静态校验 |
| `supabase/scripts/verify_migrations.mjs` | **真实 PostgreSQL 验证**（PGlite） |
| `docs/{DATABASE,DATABASE_AUDIT}.md` | 设计 + 审计 |

### Phase 4 — Billing

| 文件 | 说明 |
|---|---|
| `supabase/migrations/0006_billing_closed_loop.sql` | 状态词表 / 幂等 / `webhook_events` / `grant_credits()` |
| `src/config/billing.ts` | 定价唯一真相 |
| `src/lib/billing/{types,headers,service,fulfillment,session}.ts` | Billing 层 |
| `src/lib/billing/providers/{creem,stripe,index}.ts` | PaymentProvider |
| `src/app/api/billing/{checkout,orders,orders/[id],webhook/[provider]}/route.ts` | Billing API |
| `docs/BILLING.md` | 设计文档 |
| `scripts/verify-billing.ts` | 配置层验证 |

### Phase 5 — Storage

| 文件 | 说明 |
|---|---|
| `src/lib/storage/{types,errors,keys,service}.ts` | Storage 层 |
| `src/lib/storage/providers/{r2,index}.ts` | R2Provider + 注册表 |
| `docs/STORAGE.md` | 设计文档 |
| `scripts/verify-storage.ts` | 验证（20 项） |

### Phase 6 — Auth + Cleanup

| 文件 | 说明 |
|---|---|
| `supabase/migrations/0007_user_role.sql` | `users.role` |
| `docs/{PHASE_6_AUTH_AUDIT,PHASE_6_FOLLOWUPS}.md` | 审计 + 跟进 |
| `scripts/verify-auth.ts` | Auth 验证（当时 13 项；现为 28 项） |

### Phase 6.5 — Admin

| 文件 | 说明 |
|---|---|
| `supabase/migrations/0008_admin_audit_logs.sql` | 审计日志表 |
| `src/lib/admin/{authorization,api,errors,pagination,service}.ts` | 授权 + 编排 |
| `src/app/api/admin/**` | 13 个 Admin API |
| `src/app/admin/**` | 9 个 Admin 页面 |
| `src/components/admin/**` | 4 个 Admin UI 组件 |
| `src/lib/db/repositories/admin-audit-log.ts` | 审计 Repository |
| `docs/ADMIN.md` | 设计文档 |
| `scripts/verify-admin.ts` | 架构验证（当时 32 项；现为 45 项） |

---

## 6. 文档索引

**索引已迁出本文** —— 全部文档的分类与阅读顺序见 **[`docs/README.md`](./README.md)**。

这里只留最重要的三个入口：

| 文档 | 用途 |
|---|---|
| [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md) | **项目入口文档**：架构、Core/Product 边界、请求流、配置、验证、部署 |
| [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) | Coding Agent 动手前后的硬性约束 |
| [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) | 如何新增第二个 Product（含当前障碍清单） |

> 本文（`PROJECT_STATUS.md`）负责**阶段时间线、命令速查、缺陷状态**，
> 不再重复维护文档清单，避免两处索引不一致。

### ⚠️ 模板遗留 → 已归档

原模板遗留文档已于 2026-09-25 移入 **`docs/archive/`**（54 个文件，`git mv` 保留历史）。

详见 [`docs/archive/README.md`](./archive/README.md)。
代码**不引用**任何归档文档（已核实）。

> 另：`docs/ARCHITECTURE.md`（1051 行）**已于 2026-09-30 移入 `docs/archive/`**（F9.7-15 裁决：
> 架构真相只留 `MOTHER_TEMPLATE.md` + 9.8.x 审计体系一份）；`docs/REFACTOR_PLAN.md` 的计划正文
> **仍在 `docs/` 但已标记为 Phase 1 历史快照**。两者路径多数失效，不要当现状读。

---

## 7. 缺陷状态表（B-1 ~ B-21）

> 原清单见 `docs/archive/ARCHITECTURE.md` 附录 A（Phase 1 快照）。以下是**当前实际状态**。

| ID | 缺陷 | 状态 | 处理阶段 |
|---|---|---|---|
| B-1 | 订单表双轨（`payment_orders` vs `orders`） | ✅ 已修复 | Phase 3（迁移 0002） |
| B-2 | `creemCheckoutId` camelCase 写库 | ✅ 已修复 | Phase 3/4 |
| B-3 | `creditTransaction` 是 mock | ✅ 已修复 | Phase 3 |
| B-4 | `subscription` 是 mock | ✅ 已修复 | Phase 3 |
| B-5 | `groupBy`/`aggregate` 伪造统计 | ✅ 已修复 | Phase 3 |
| B-6 | `type='gift'` 违反 CHECK | ✅ 已修复 | Phase 6（改 `bonus`） |
| B-7 | `register` 写不存在的 `password` 列 | ✅ 已修复 | **本次巡检** |
| B-8 | R2 public URL 用 S3 端点 | ✅ 已修复 | Phase 5（统一 `publicUrlBase`） |
| B-9 | `R2_PUBLIC_URL` 未使用 | ✅ 已修复 | Phase 5 |
| B-10 | 55s 超时后不退款 | ✅ 已修复 | 本次（超时/失败统一走原子退款 + 幂等） |
| B-11 | 积分扣减非原子 | ✅ 已修复 | Phase 3.5（RPC） |
| B-12 | 价格表两份 | ✅ 已修复 | 本次（统一到 `src/config/credits.ts`） |
| B-13 | `session` 不含 `user.id` | ✅ 已修复 | Phase 6 |
| B-14 | 支付配置三处真相 | ✅ 已修复 | 定价已收敛（Phase 4）；`src/lib/config/payment.ts` 已于 Phase 9.2 删除 |
| B-15 | 两条下单路径重复 | ✅ 已修复 | 已委托 `BillingService`（9.4）；**9.8.2-C** 把定价页切到 `/api/billing/checkout`，客户端只发内部 `packageId`，兼容路由 `/api/payments/create-checkout` 已删除。`/api/payment/create-session` 已于 9.3 删除 |
| B-16 | 生成历史从不落库 | ✅ **已修复** | **Phase 7 接线**：`WorkflowService.createTask()` 写 `ai_tasks`，`0009` 扩展 retry/settlement 列，用户 `/tasks` 与 Admin `/admin/ai-tasks` 均可查 |
| B-17 | `router.ts` 把 HK/TW 当独立国家 | ✅ 已修复 | 本次（删除死代码 `payment/router.ts`，抽出 `payment/amount.ts`；两者均已在 9.2 随 `src/lib/payment/` 整体删除） |
| B-18 | 前端 3 处重复 fetch 逻辑 | ❌ **仍存在** | 原定 Phase 8，**该阶段未处理此项**；Phase 9.7 复核未展开（属代码审计，非文档范围）→ 顺延 |
| B-19 | `package.json` name 是 `nextjs-shadcn` | ✅ 已修复 | Phase 6（改 `ai-saas-template`） |
| B-20 | 开发环境硬编码后门账号 | ✅ 已确认安全 | Phase 6（有 `NODE_ENV` 保护） |
| B-21 | 限流器计数器全局共享，误伤登录接口 | ✅ 已修复 | 本次（限流 key 加入 bucket + 过期清理） |

**汇总**（2026-10-10 复核）：✅ **20** 项已修复（B-15 于 9.8.2-C 闭合）· ❌ **1** 项仍存在（B-18）

> Phase 9.7 新增的 **10 条边界例外（E-1 ~ E-10）** 不在此表内 —— 它们不是 B 系列缺陷，
> 而是「守卫覆盖不到的架构耦合」，见 [`MOTHER_TEMPLATE.md` §5.4](./MOTHER_TEMPLATE.md)
> 与 [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md)。

---

## 8. 验证命令速查

```bash
# ── ⭐ 本地 CI 门禁（一条命令跑全部）─────────────────────
npm run verify            # lint → 5 守卫 → 全部 verify → 迁移校验 → build
npm run ci                # 同上（别名）
npm run verify:fast       # 跳过 build + 迁移校验，快速迭代用
# 沙箱下 build 需带环境变量：
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run verify
# migrations:static 需要带 sqlglot 的 Python。仓库内 .venv 不入库，clone 后自建一次：
#   python -m venv .venv && .venv/Scripts/pip install -r supabase/scripts/requirements.txt
# 建好后 verify-all 会自动探测到；也可用 PYTHON=<path> 显式指定（否则该步 SKIP，不算通过）：
PYTHON=<path-to-python> npm run verify

# ── 构建与静态检查 ──────────────────────────────────────
npm run lint                          # eslint + tsc --noEmit
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run build   # 沙箱下需带环境变量

# ── 迁移 ────────────────────────────────────────────────
npm run migrations:static             # 静态校验（语法/依赖/外键/索引/幂等）
npm run migrations:real               # 真实 PostgreSQL（PGlite）198 项检查
python supabase/scripts/validate_migrations.py   # 直接调用（等价 migrations:static）
node supabase/scripts/verify_migrations.mjs      # 直接调用（等价 migrations:real）

# ── 各模块验证（无需真实 Key）────────────────────────────
# 断言数量由脚本运行时输出，**不在文档里硬写**（会随阶段增长而失真）。
node scripts/run-ts.mjs scripts/verify-ai-core.ts    # AI Core（通用机制；模型/成本从已绑定 bundle 派生）
node scripts/run-ts.mjs scripts/verify-workflow.ts   # Workflow 逻辑
node scripts/run-ts.mjs scripts/verify-billing.ts    # Billing + 积分价格表
node scripts/run-ts.mjs scripts/verify-storage.ts    # Storage
node scripts/run-ts.mjs scripts/verify-auth.ts       # Auth + 限流桶
node scripts/run-ts.mjs scripts/verify-admin.ts      # Admin
node scripts/run-ts.mjs scripts/verify-api-routing.ts    # /api/v1 路由链 + proxy 零产品词
node scripts/run-ts.mjs scripts/verify-product-config.ts # 产品配置包完整性 + 11 个违规样例 + 未绑定探针 + Core 词表扫描
node scripts/run-ts.mjs scripts/verify-flux-kontext.ts   # ⚠️ Flux **产品专属**回归（`@product-scope`；产品目录不在 → 门禁里 SKIP）
npm run audit:dead-files                             # 死文件扫描（发现即退出码 1）
npm run audit:unused-exports                         # 未使用导出（信息性，无退出码）
npm run audit:architecture                           # 架构守卫：基础设施不得依赖产品层（退出码 1）
npm run verify:product-boundary                      # 产品边界验证：Core → Product 必须为 0（Core 按排除法取）
npm run verify:product-seam                          # 接缝可达性：每个入口的闭包里都有 product-runtime
npm run verify:product-seam -- --self-test           # 上述守卫的 4 个内存 fixture（合法/未绑定/客户端泄漏/反向依赖）
node scripts/run-ts.mjs scripts/probe-product-config-unbound.ts  # 证明「未绑定 → 每个查询都抛错」，不静默回退

# ── HTTP 层（需先启动 dev server）────────────────────────
npm run smoke:ai                                        # E2E 冒烟（需 dev server + 真实凭据）
SMOKE_SECTION=contract node scripts/smoke-ai-core.mjs   # 契约测试
SMOKE_SECTION=billing  node scripts/smoke-ai-core.mjs   # Billing 契约
```

> **CI 策略**：本仓库**不在 GitHub 上跑 CI**（`.github/workflows/*.yml` 明确注释
> "all CI runs locally, not on GitHub"），只保留手动触发的 CodeQL 与 Dependency Review。
> 因此质量门禁是 `npm run verify`，由贡献者在本地执行；PR 模板已同步。
>
> **SKIP 语义**：工具链缺失（如未装 `sqlglot`）的步骤标记为 SKIP，**不算通过**，
> 报告中单独列出并给出安装指引；`npm run verify -- --strict` 可让 SKIP 也判定失败。

**重要环境限制**：本机 `.env.local` 的 `FAL_KEY` 与 `NEXT_PUBLIC_SUPABASE_URL` **都是占位符**，
因此真实第三方调用与 DB 链路无法在本机验证。不要因为测试失败就怀疑代码。

跑 HTTP 测试前**必须重启 dev server**（`src/proxy.ts` 限流计数器是内存态，见 B-21）。

---

## 9. 未决事项

### 9.1 死代码清理（2026-09-25 完成）

用 `scripts/audit-dead-files.mjs` 全量扫描后删除 **5 个已被替代的文件**（1250 行）：

| 删除 | 行数 | 为什么是死代码 |
|---|---|---|
| `src/lib/content-safety/index.ts` | 581 | 旧的单体实现；线上走 `safe-mode.ts`（376 行，独立实现） |
| `src/lib/services/order.ts` | 426 | 被 `db/repositories/order.ts` 取代 |
| `src/lib/services/r2-storage.ts` | 105 | Phase 5 的兼容适配器，已无调用方 |
| `src/lib/types/order.ts` | 102 | 仅被上面那个 `services/order.ts` 引用 |
| `src/lib/utils/ip.ts` | 36 | 被 `getClientIpFromHeaders()` 取代（Phase 8 后位于 `src/lib/utils/request.ts`） |

**保留 4 个「无引用但属模板可选能力」的文件**（见脚本白名单）：
`LanguageSwitcher.tsx`、`UpgradePrompt.tsx`、`ui/progress.tsx`、`auth-supabase.ts`。

> `npm run audit:dead-files` 已接入为守卫：新增无引用文件会退出码 1。
> 删除前必须同时 grep **绝对路径导入**与**相对导入**（`from './xxx'`），
> 否则 `tsc` 会报 `Cannot find module`。

**架构边界扫描**（同轮，全部通过）：业务层未直接 import AI Provider / 厂商 SDK；
`ai/` 内无产品类名（只有模型 id 字符串）；Admin 页面未直接访问数据库。

**未使用导出**（`npm run audit:unused-exports`）：**不作为死代码处理**。
绝大多数是刻意导出的类型、成对辅助函数、或过度导出的内部函数。
真正值得注意的是「单文件未使用占比 >70%」的模块 —— 它们曾是遗留 Payment 簇的信号：

| 文件 | 未使用占比 | 状态 |
|---|---|---|
| `src/lib/utils/response.ts` | 13/15 | ✅ **Phase 9.2 已删除**（仅被 2 个 legacy admin 路由用） |
| `src/lib/payment-security.ts` | 10/13 | ✅ **Phase 9.2 已删除**（仅被死的 `payment.ts` 用） |
| `src/lib/services/payment-database.ts` | 8/13 | ✅ **Phase 9.2 已删除** |

整个遗留 Payment 簇（18 个文件）已在 Phase 9.2 收口到 Billing，详见
`docs/PHASE_9_2_AUDIT.md` / `PHASE_9_2_FOLLOWUPS.md`。

### 9.2 待处理（2026-10-10 复核）

各阶段的完整遗留清单在对应的 `PHASE_*_FOLLOWUPS.md` 里，这里只汇总**当前仍开放**的：

| 来源 | 项 | 优先级 |
|---|---|---|
| **F9.7 边界例外** | 10 条里 **E-1 / E-2 / E-3 / E-4 / E-5** 已在 9.8.2-B/C 消解；仍开放：E-6（2 个路由绕过 Repository）、E-8（`/features` 404）、E-9（`next_retry_at` 无人消费）、E-10（本地空目录 `api/payment/`）、i18n 内容单语言。**E-7（产品注册表）缺位是选择不是遗漏**，见 §10.1 | 🟡 中 |
| F9.6-1 | `migrations:static` 依赖本机 Python venv（仓库无 `.venv`，未设 `PYTHON` 则 SKIP） | 🟡 中 |
| F9.6-2 | `.env.example` 里 `DATABASE_URL`、`NEXT_PUBLIC_ENABLE_CREEM` 记录但代码未使用 | 🟢 低 |
| F9.6-4 | `npm run smoke:ai`（唯一 HTTP E2E）需真实 dev server + 凭据，**NOT VERIFIED** | 🟡 中 |
| F6.5-1 | Admin 角色管理 UI（Phase 6.5 规格 §41 明确禁止，**待授权**） | 🟡 中 |
| B-18 | 前端重复 fetch 逻辑 | 🟢 低 |
| F-2b / L-14 | 删除 `users.signin_*` 6 个遗留列（**不建议做**，需同步改 4 处建号逻辑） | 🟢 低 |
| L-15 | 3 张 DEPRECATED 表（`payment_orders` / `payment_configs` / `generations`）仍由 `0000_baseline.sql` 创建，从未 DROP | 🟢 低 |
| L-22 | 真实并行并发未验证（PGlite 单连接，需真实 Supabase 实例） | 🟡 中 |
| D-16 | `SmartImagePreview.tsx:29-41` 在 UI 层硬编码 R2 URL 重写 | 🟢 低 |
| F6.5-4/5 | Dashboard 图表 / Admin Settings | 🟢 低 |

> 明确**不做**的：D-13、D-27、D-28；F9.6-3（不引入 vitest/jest/playwright）、
> F9.6-5（`audit:unused-exports` 保持 INFO）、F9.6-6（不加 GitHub Actions 自动触发）。

---

## 10. 下一步

### 10.1 已定义

| Phase | 内容 | 前置条件 |
|---|---|---|
| **9.8.2 剩余切片** | **2(a) 内容间接层、2(b) Edge / Deployment 路由、2(c) 产品配置与 Core 机制分离 + Billing 标识符契约、2(d) `scripts/**` 去产品化 —— 四个切片全部完成。** 2(d) 的做法：共用 `verify-*.ts` 只保留通用机制断言（零产品字面量），只有 Flux 才成立的精确断言移入 `scripts/verify-flux-kontext.ts` + `// @product-scope flux-kontext`（产品目录缺失 → **SKIP，绝不 PASS**）。 | 判据一直是「换一个产品目录后通用脚本仍能跑，且证明的是通用机制」，**不是**「删掉产品后 `npm run verify` 全绿」—— 后者永远不该成立，因为产品专属那步本来就该 SKIP。删除实验的判据见 [`PRODUCT_GUIDE.md` §7](./PRODUCT_GUIDE.md)：`tsc --noEmit` + `eslint` + 三个产品无关守卫，**不能**用 `npm run verify` 做。逐项判定见 [`PHASE_9_8_1_AUDIT.md`](./PHASE_9_8_1_AUDIT.md) F9.8-A~E 与 §9 建议 |
| **可复用性验收（9.8.2-D 已做）** | **Product B 场景实测通过**：在隔离 worktree 里装一个非 Flux 产品（自己的 4 个模型 / 成本 / Provider 映射 / 套餐 / 档位能力 / 内容 / 词汇表），把 Flux 全删 —— `npm run lint` exit 0、`npm run verify` 17/0/1 exit 0、`next build` PASS。**接入只动了产品目录 + 两行装配点，Core 业务逻辑零改动。** | 过程、判据、以及 B 暴露并已修掉的 3 个真实缺陷（输入图契约未在统一入口强制 / 缺图被分类成可重试 `INTERNAL_ERROR` / 共享组件按固定下标取文案），见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md) |
| **9.8.2-D 之后仍登记在册的事项（均不阻塞复用）** | ① 产品 UI 仍住在 `src/components/` 根（`FluxKontextGenerator.tsx` / `UpgradePrompt.tsx` / `src/components/flux-kontext/*` 共 5 个文件），守卫按各产品的 `layout-debt.json` 逐条点名且清单**只能缩小**；② 16 个 `src/app/<locale>/page.tsx` 各自**内联**一份 Flux 首页字典，未走内容装配点；③ 档位能力（`capabilities.ts`）目前只被展示层消费，**服务端未按档位拦截**模型选择（D-5，行为与本轮前一致，未新增也未修复）；④ `verify-product-config.ts` 的词表扫描只覆盖 **12 个 Core 目录**（`src/proxy.ts` 与 `src/lib/*.ts` 根文件不在其中 —— 前者的产品词由 `verify-api-routing.ts` 钉为 0，后者的反向 import 由排除法边界守卫拦，但**产品词汇**回归无人查）；⑤ `scripts/**` 不做词表扫描，改由 `@product-scope` 按**归属**分区 —— 有人把产品字面量写回共用脚本时没有守卫会直接抓到，只有「换产品后跑通用脚本」才会暴露 | ②④ 是解除「复制第二个产品」剩余摩擦的主要摩擦点（② 是文案重复，④ 是回归覆盖）；①③⑤ 记录在案，不构成本轮验收缺口 |
| **仍不存在产品注册表（刻意选择，不是阻塞）** | **F9.8-D / E-7** —— 2(b) 刻意没有引入它，2(c)、2(d) 也没有。**这是选择而不是遗漏**：规格明确「不要为了架构形式提前引入大型 Product Registry」，且当前运行模型是**单部署单产品**，所以采用「统一配置对象 + app 层显式接缝」，`bindProductConfig()` 直接拒绝在同进程绑定第二个不同 id。9.8.2-D 的 Product B 实测也确认「装第二个产品」不需要注册表 —— 需要的是那两行装配点。 | 真要「一个部署里并存多产品」，需要的是路由级多租户装配（每请求选包），不是把接缝改成列表 —— 那是一个新的阶段目标，需要先有第二个真实产品 |
| **2(b) 留下的已知缺口** | ① **F9.8.2B-1（本阶段新记录）**：`/api/v1/*` 既不进限流桶也不带安全响应头 —— v1 分支提前 `return NextResponse.rewrite(...)`，改前改后一致，**本阶段既没修也没新增绕过**；② 文档承诺的 `Authorization: Bearer` 与实现的 session 鉴权不一致（F9.7 系列）；③ 通配 CORS 覆盖全部 `/api/*`；④ `payment` 限流桶匹配不到真实路由（F9.7-12）；⑤ Vercel Preview 上的**实际**路由优先级仍未实证 —— 2(b) 是靠「只留一层做同一条幂等改写」把优先级问题**绕开**，不是满足它 | ②③④ 记录在 `PHASE_9_7_FOLLOWUPS.md` / `PHASE_9_8_1_AUDIT.md`；① 由 `scripts/verify-api-routing.ts` 的 A6 钉住现状，防止被「顺手改掉」 |

### 10.2 待用户定义 / 授权

| 选项 | 内容 |
|---|---|
| A | 处理 F9.7 仍开放的 4 条（E-6 绕过 Repository、E-8 `/features` 404、E-9 `next_retry_at` 无消费者、E-10 本地空目录）。~~E-7 产品注册表~~ **不再是候选**：9.8.2-C 已论证当前运行模型下采用「配置对象 + app 层接缝」，注册表是有意的非选择 |
| B | 授权 F6.5-1（Admin 角色管理 UI） |
| C | 真实环境验证：配好真实 Supabase + `FAL_KEY` 后跑 `npm run smoke:ai`，关闭 F9.6-4 |
| D | 建 `.venv` 让 `migrations:static` 不再 SKIP，关闭 F9.6-1 |

> 已完成的阶段见 §2，缺陷状态见 §7，各阶段遗留见 `PHASE_*_FOLLOWUPS.md`。
