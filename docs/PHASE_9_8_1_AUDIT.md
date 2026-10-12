# Phase 9.8.1 Audit — 第二产品复制验证：架构基线审计

> **只读审计。本文件提交时未修改任何业务代码、任何守卫脚本、未创建 Product B。**
> 审计时间：2026-09-30 · 基线 commit：`9.7 文档`（工作树含 Phase 9.7 收尾批次的未提交改动，见 §1）
> 规格来源：用户 2026-09-30 消息「Phase 9.8.1 — 第二产品复制验证：架构基线审计」
> 要回答的唯一问题：**如果现在要复制第二个产品，Core 是否真的已经与 Flux 产品解耦？**

---

## 0. 结论

**BLOCKED**

答案必须拆成两层，混在一起就会得出错误结论：

| 维度 | 结论 | 依据 |
|---|---|---|
| **import 方向**（Core `lib`/`config` → Product） | ✅ 已解耦，实测 **0 处** | `src/lib/**`（`products` 之外）与 `src/config/**` 对 `@/lib/products/` 的 import 命中为 0；`verify:product-boundary` 14 个 CORE_DIRS / 57 文件 PASS |
| **复制能力**（只换 Product Layer 就得到 Product B） | ❌ 不成立 | 必须编辑 5 个 Core 配置 + Edge 层 + 部署配置 + 8 个共享组件；**不存在产品注册表** |

BLOCKED 指「架构基线尚未达到可复制状态」，**不是**质量门禁坏了：
`npm run verify` 本轮实测 **15 通过 · 0 失败 · 0 跳过**（§6）。

一句话：**Core 在依赖方向上是干净的，但它仍然是「只有一个产品的 Core」。**

> **📌 后续回写（Phase 9.8.2，2026-10-09）**：本结论**整体仍是 BLOCKED**，但五项里已有两项消解 ——
> F9.8-A / F9.8-B（Edge + 部署路由，切片 2(b) `9.8.2-B`）与「8 个共享组件直接 import 产品内容」
> 那半条（切片 2(a) `9.8.2-A`）。**仍阻塞**：F9.8-D 产品注册表不存在、F9.8-C Core 配置携带产品数据、
> F9.8-E 守卫假绿区、以及 `scripts/**` 对产品的依赖。逐项最新状态见
> [`PROJECT_STATUS.md` §2 时间线](./PROJECT_STATUS.md) 与 §10.1。
>
> **📌 最终回执（Phase 9.8.2-D，2026-10-10）**：**BLOCKED 结论已解除。**
> 2(c) 把产品数据搬出 Core；2(d) 把产品专属断言按归属分区（`@product-scope`，产品不在则 SKIP）；
> 「必须编辑 5 个 Core 配置 + Edge 层 + 部署配置 + 8 个共享组件」收缩为
> **建一个产品目录 + 改两行装配点**。判据不再是推演：隔离 worktree 里装了真实的
> Product B（非 Flux 的模型 / 成本 / Provider 映射 / 套餐 / 能力 / 内容）并把 Flux 全删，
> `npm run lint` exit 0、`npm run verify` 17/0/1 exit 0、`next build` PASS
> （证据与过程见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)）。
> 「不存在产品注册表」这一项**维持原样并确认为刻意选择**（单部署单产品），不是遗留缺陷。

---

## 1. 仓库基线（以当前代码为准，不引用历史报告）

```
HEAD  40a650c  docs(phase9.7): Mother Template documentation
log -5         40a650c / 62863ce / 39f9839 / 5e8471c / d5150d6

工作树（审计开始时 = 审计结束时，**代码与配置逐字节相同**）：
  M .gitignore
  M supabase/scripts/validate_migrations.py
  M docs/{DATABASE,MOTHER_TEMPLATE,PHASE_9_7_FOLLOWUPS,PROJECT_STATUS,README}.md
  M/?? .workbuddy-ai/memory/*        ← 与本阶段无关
```

前 6 项是 **Phase 9.7 收尾批次**（14→15 步全绿那批），审计时仍未提交；本阶段没有新增任何代码改动，
审计产出只有本文件 + 两处索引行（`docs/README.md` §5、`docs/PROJECT_STATUS.md` 时间线）。
人工验收后按裁决补做了 §7 末尾列出的**文档动作**，并拆成两个 commit 提交
（9.7 收尾 / 9.8.1 审计），代码与配置在这两个 commit 里仍然零改动。

命中总量（大小写不敏感 `flux`，排除 `docs/**`）：**763 hits / 77 files**。
docs 内另有 810 hits / 58 files。

| 区域 | hits / files |
|---|---|
| `src/lib/products/**`（产品自有） | 172 / 11 |
| `src/lib/**`（products 之外，**含 Core**） | 93 / 8 |
| `src/config/**` | 19 / 2 |
| `src/app/**` | 292 / 28 |
| `src/components/**` | 92 / 18 |
| `scripts/**` | 84 / 6 |

---

## 2. 全仓命中分类（A / B / C / D）

**核心纪律：字符串命中 ≠ 架构违规。** 逐条分类后才有效。

### A — 真依赖（import 或硬编码路径，删产品即断链）

| 位置 | 形态 | 归属 |
|---|---|---|
| `src/components/FAQ.tsx:8`、`Footer.tsx:2`、`HomeContent.tsx:14`、`HowToSteps.tsx:5`、`KeyFeatures.tsx:2`、`PricingContent.tsx:23`、`TwitterShowcase.tsx:6` | `import … from "@/lib/products/flux-kontext/content"` | 产品对外表面（`MOTHER_TEMPLATE.md` §5.3 **允许**） |
| `src/components/HomeContentSimple.tsx:6` | `import type { HomeDictionary } from "…/home-config"` | 同上（类型依赖，同样会断链） |
| `src/app/api/flux-kontext/route.ts:30` | import 产品入口 | 产品 API 表面 |
| `scripts/verify-ai-core.ts:248` | 动态 `import('@/lib/products/flux-kontext')` | **工具层**，不在任何守卫覆盖内 |
| `scripts/verify-billing.ts:23` + `:221/227/231` | import + 硬编码路径字符串 | 同上 |
| `scripts/verify-auth.ts:222` | 硬编码 `src/app/api/flux-kontext/route.ts` | 同上 |

→ **真正的 Core（`src/lib` 非 products + `src/config`）→ Product：0 处。**
A 类里唯一卡住 9.8.2 的是那 **8 个共享组件**：它们决定 `tsc --noEmit` / `npm run build` 会不会因为删产品而失败。

### B — 产品自引用 / 产品自有表面（合法）

`src/lib/products/flux-kontext/**` 内部 10 处 import；`src/components/flux-kontext/*`（7 文件）、
`FluxKontextGenerator.tsx`（`fetch("/api/flux-kontext")` ×3）。不构成违规。

### C — compatibility / legacy 路由（产品耦合，但**不是**反向依赖）

`src/proxy.ts:79-100`、`vercel.json:41-60`（详见 §3 的 F9.8-A / F9.8-B）。

> ⚠️ **一个必须排除的误判**：`src/lib/ai/providers/kie.ts:80` 的 `/api/v1/flux/kontext/generate`
> 与 `:116` 的 `record-info` 是 **Kie.ai 厂商自己的上游 API 路径**，
> 与我们对外的 `/api/v1` 兼容层毫无关系。
> 若按字符串命中处理，会把 Core Provider 误判成「依赖 Flux 产品路由」——
> 这正是「不能把所有命中都算违规」的实例。

### D — 文档 / 历史注释（无依赖含义）

`models.ts:7`、`ai/types.ts:13,36`、`utils/request.ts:6-7`、`services/credits.ts:6-8`
（都在叙述「原先 import 了 X，现已移除」）、`audit-architecture.mjs` 头注释、全部 docs。

扣除 D 后，`src/lib`（非 products）的实际数据耦合 = **86 hits，全部集中在
`ai/models.ts`(44) + 4 张 provider map(42)**。

---

## 3. 五项审计（F9.8-A ~ F9.8-E）

### F9.8-A — `src/proxy.ts`

- **现状**：`if (pathname.startsWith('/api/v1/'))` → **无条件** rewrite 到 `/api/flux-kontext`，
  4 个 Flux action 关键字硬编码在 Edge 层。
- **本轮新发现（此前文档未记录）**：rewrite 注入的是 query `?action=…`，
  而 `src/app/api/flux-kontext/route.ts` 只从 **body** 取 action（`:51`），本文件从不读 `searchParams`。
  即**这个 `action` 参数目前是惰性的**，客户端仍必须在 body 里带 `action`；
  `/api/v1/*` 的实际效果只是「把任意 `/api/v1/xxx` 都送到 Flux 端点」。
- **是否真耦合**：是（Edge 层承载产品路由知识）。
- **是否阻塞 Product B**：**是，功能性阻塞** —— 第二个产品若想用自己的 `/api/v1/…` 公共路径，会被这段无条件 rewrite 吞掉。
- **本阶段是否修**：否。规格 §五「Audit first, fix later」，且修法需要「产品无关的 rewrite 设计」，属 9.8.2+。
- **附带复核**：限流 `payment` 桶判据 `pathname.includes('/payment/')` **永远匹配不到**真实路由
  `/api/payments/create-checkout`（F9.7-12 记录在案，本轮确认仍在）。
- **✅ 后续状态（Phase 9.8.2-B，代码 `9.8.2-B`）**：F9.8-A 已消解。
  惰性 `?action=` 不是被「消费」掉的，而是随 rewrite 一起**删除**（R1：action 仍只来自 body）；
  `/api/v1/*` 改为通用前缀剥离，不再吞路径。`payment` 桶缺陷**仍在**（本阶段禁区）。

### F9.8-B — `vercel.json`

- 4 条 Flux rewrite（`/api/v1/flux/{text-to-image,image-edit}/{pro,max}` → `/api/flux-kontext?action=…`）
  + 泛规则 `/api/v1/(.*)` → `/api/$1`（`:57-60`），与 `proxy.ts` 的 rewrite **语义互相冲突**
  （proxy 把 `/api/v1/*` 送去 Flux 端点，vercel 把它送去同名 `/api/*`）。
  **⚠️ 本篇此处有一句要更正**：原先写的「且路径形状不一致（带 / 不带 `/flux/`）」**不成立** ——
  proxy 用 `pathname.includes(...)`，带 `/flux/` 与不带的两种形状**都会**命中同一分支，
  它是 `vercel.json` 那 4 条的超集。9.8.2-B 实测（`x-middleware-rewrite` 头）确认。
- **不宣称线上到底哪条生效**：Vercel 平台的路由优先级本轮未做实证，不做推断。
  可确认的事实只有两条：① 两层都在硬编码产品路由；② 全仓**没有任何**针对 `/api/v1` 兼容层的测试用例
  （`scripts` 里的 `/api/v1` 命中全是厂商上游）。
- **是否阻塞 Product B**：**是**（部署层）。
- **✅ 后续状态（Phase 9.8.2-B）**：5 条同应用 rewrite **全部删除**（`rewrites: []`），
  改写只留 `proxy.ts` 一层 —— 一条幂等变换只剩一份，结果不再依赖「Vercel 与 Next 谁先」这个问题。
  **但必须说清**：这是**在没有线上实证的前提下**做的取舍。Vercel Preview 上的实际优先级
  **至今仍未实证**；「不宣称线上到底哪条生效」这句结论**没有**被推翻，只是变得不再需要回答。
  通配 CORS（`Access-Control-Allow-Origin: *` 覆盖全部 `/api/*`）**仍在**，本阶段禁区。
- **另记**：`headers` 段给全部 `/api/(.*)` 发 `Access-Control-Allow-Origin: *` —— 与产品无关，但同样是部署配置里的硬编码。

### F9.8-C — Core 配置里的产品数据

**不要看到产品数据就判违规。** 逐项区分「通用机制」vs「Product-specific configuration」：

| 文件 | 判定 | 理由 |
|---|---|---|
| `src/lib/site-config.ts` | ✅ **真通用 Core，0 产品耦合** | 全 env 驱动，默认值 `"AI SaaS Template"`，含 `{{projectName}}` 等 token 替换机制 —— 这就是产品化应有的形状<br>*（9.8.2-D 正式改名：该默认值随**母版身份**最终定为 `ai-saas-template`，判定不变 —— 机制仍 0 产品耦合，品牌仍由 `NEXT_PUBLIC_PROJECT_NAME` 提供）* |
| `src/lib/ai/models.ts` | 🟡 机制通用，**数据是产品的** | `ModelDefinition` + `MODELS` 目录 + `getModel/listModels/isModelSupportedBy` 与产品无关；10 条条目全 `flux-*`。文件头注释自己写明「flux-kontext 在这里只是一个模型，不是架构」 |
| `src/config/credits.ts` | 🟡 同上 | `Record<modelId, credits>` + 未登记抛错，机制通用；10 个 key 全 `flux-*` |
| `src/config/billing.ts` | 🟡 需按产品**重新登记**，不是架构违规 | 套餐结构与整数金额工具通用；`providerProductIds.creem: 'FluxKontext-Plus-Monthly'` 等 4 处是**渠道侧真实商品 id**（外部事实，不能随意改名） |
| `src/lib/user-tiers.ts` | 🟡 Product-specific，且**不在守卫 CORE_DIRS 内** | `modelsAllowed: ['pro','max']`、`maxImages`、13 个宽高比是 Flux 档位语义。注意：文件里**没有** literal "flux" 字符串，靠字符串扫描抓不到 |
| `src/lib/ai/providers/{fal,kie,wavespeed,atlascloud}.ts` | 🟡 Core Provider 携带产品目录 | 4 张 `模型 id → 厂商模型/端点` map。其中 **`fal.ts:162` `if (request.model === 'flux-schnell')` 是唯一一处 Provider 内按具体模型 id 分支**，性质比 map 更差 |

**结论**：以上 0 处 import 反向依赖，但每一条都要求「Product B 写进 Core 文件」→
属 9.8.2 的设计输入，本阶段不动。

### F9.8-D — 产品注册表

- **结论：不存在。** 全仓 `registry` 命中只有 `src/lib/{ai,storage,billing}/providers/index.ts` 的
  **provider** registry；没有任何 product registry / product list / 间接层。
- **术语警告**：`AGENT_GUIDE.md:197` 那句「硬断言注册表内容」指的是**模型注册表 `MODELS`**，
  不是产品注册表。后续沟通不要混淆，否则会误以为 F9.8-D 已经完成。
- **按规格未实现**。理由：这层间接至少要同时吸收 3 个性质不同的面
  （内容文案 8 组件 / 模型+积分目录 / Edge rewrite），
  在没有第二个产品的真实需求约束前设计它，就是为一个假设做抽象。
- **是否阻塞 Product B**：**是，根因级** —— 没有间接层，「只换 Product Layer」在物理上无从谈起。

### F9.8-E — 守卫覆盖

本阶段**未修改任何 guard**。

**当前 guard 能证明：**

- `verify:product-boundary`：14 个 CORE_DIRS / 57 文件内**无任何** `@/lib/products/` import 说明符；
  产品目录（7 个 `.ts`）的 16 条内部依赖全部指向 Core，无跨产品 import。
- `audit:architecture`：10 个 INFRA_DIRS / 51 文件无命中 `FLUX_SPECIFIER` 的 import；
  `src/lib/database.ts` 不存在且无人 import。
- 两者都先 `stripComments` 再只看 import 说明符 —— 所以 §2 的 D 类注释命中不会造成假阳性。
  **这正是它的优点，也正是它盲区的来源。**

**当前 guard 不能证明（= 假绿区，逐条都是实测目录清单得出的，不是推测）：**

1. 目录集是**穷举白名单**，新增 Core 目录不会自动纳入；
   且不覆盖 `src/app/**`、`src/components/**`、`src/proxy.ts`，
   以及 `src/lib` 根下的 `site-config.ts` / `user-tiers.ts` / `auth*.ts` / `fal-client.ts` / `stripe-client.ts` / `utils.ts`。
2. `audit:architecture` 的目录集比 `verify-product-boundary` **少 4 个**（utils / content / i18n / config）。
3. 不看 `vercel.json` / `package.json` / JSON 内容文件 → **F9.8-B 全盲**。
4. 只看 import 说明符 → F9.8-C 的「数据内容是产品的」全盲；
   `verify-billing.ts:221` 那类硬编码路径字符串全盲。
5. `CORE_DIRS` 里的 `lib/i18n` **磁盘上不存在**，`walk()` 静默跳过 —— 守卫报出的文件数里含一个空目录。
6. 产品目录缺失或为空时 `verify-product-boundary.mjs:112-117` 直接 FAIL；
   而它 `:170` 打印的「删除 `src/lib/products/` 后 Core 仍可编译」是**结论文案，不是验证结果** ——
   对 `src/lib/**` 成立，对 `src/app` + `src/components` + `scripts/**` **不成立**。
7. **无任何用例覆盖 `/api/v1` 兼容 rewrite**（含 F9.8-A 发现的惰性 `?action=`）。

> 所以：**门禁 15/0/0 证明的是「Core lib/config 无反向 import + 业务/迁移/构建自洽」，
> 不证明「模板可复制」。** 这两句话的差距就是 F9.8-A/B/C/D。

---

## 4. Product B 概念复制推演

**纯推演，未创建任何 Product B 文件。**
假设动作：复制模板 → 删除 `src/lib/products/flux-kontext/` → 放入 `products/product-b/`。

| # | 步骤 | 实测推演 | 分级 |
|---|---|---|---|
| 1 | Core lib/config 不改动即可编译 | 成立（0 反向 import） | **EXPECTED** |
| 2 | 为 Product B 登记模型 / 积分 / 宽高比 / 渠道商品 id | 必须编辑 `ai/models.ts` + `config/credits.ts` + 4 张 provider map + `user-tiers.ts` + `config/billing.ts` | **SUSPICIOUS** —— 目录归 Core 在架构上可辩护，但直接违背「只改 Product Layer」 |
| 3 | 删产品后构建 | 8 个共享组件 + 1 个 route 断链 → `tsc --noEmit` / `npm run build` **失败** | **ARCHITECTURE VIOLATION**（就「产品可插拔」目标而言） |
| 4 | Product B 暴露自己的公共 API 路径 | 被 `proxy.ts` 无条件 rewrite 吞掉；`vercel.json` 再叠一层冲突规则 | **ARCHITECTURE VIOLATION**（Edge + 部署层承载产品路由知识） |
| 5 | 换品牌文案 | 16 个语言页 + `terms`/`privacy`/`refund`/`resources` 等页硬编码 Flux 字符串（`src/app` 292 hits / 28 files） | **SUSPICIOUS** —— 内容未走 content 层，与 F9.7-11（i18n 单语言）重叠 |
| 6 | 用门禁验证这次复制 | `verify-ai-core.ts:248` + `verify-billing.ts:23/221` + `verify-auth.ts:222` 依赖产品 → 删产品后第 8/10 步失败；`verify-product-boundary` 在产品目录为空时直接 FAIL | **SUSPICIOUS** —— 工具层不产品无关，用 `npm run verify` 做删除实验会给出**误导结论** |

**关于步骤 3 的诚实标注**：严格说它**不是** import 方向违规 ——
按 `MOTHER_TEMPLATE.md` §5.3，`src/components/<product>/**` 与 `src/app/api/<product>/**` 依赖 Product 是**允许的**。
它是「产品内容没有间接层」造成的**复制违规**。本表按后者判定，因为 9.8.1 要回答的是复制能力。

**净结论**：「Core 不依赖 Product」= 成立；「换掉 Product Layer 就能得到 Product B」= 不成立。

---

## 5. 与既有文档的关系

`MOTHER_TEMPLATE.md` §5.4 的 E-1 ~ E-10 与本篇**不重复**：E-* 是 Phase 9.7 记录的**静态例外清单**，
本篇是 9.8.1 的**复制能力判定**。对应关系：

| 本篇 | 既有记录 | 本轮新增部分 |
|---|---|---|
| F9.8-A | E-1 | **`?action=` 惰性**（route 只读 body）+ `/api/v1/*` 无条件吞路径 |
| F9.8-B | E-2 | 全仓无 `/api/v1` 兼容层用例；平台优先级未实证 |
| F9.8-C | E-3 / E-4 / E-5 | **`fal.ts:162` 按模型 id 硬分支**；`site-config.ts` 明确判为干净 |
| F9.8-D | E-7 | 术语警告：`AGENT_GUIDE.md:197` 的「注册表」是模型注册表，不是产品注册表 |
| F9.8-E | §2.3 note | 7 条假绿区的完整化（含 `lib/i18n` 空目录、两守卫目录集差 4 个） |

---

## 6. 验证结果（本轮实测，非引用历史）

| 命令 | 结果 |
|---|---|
| `npm run lint`（eslint + `tsc --noEmit`） | PASS |
| `npm run audit:architecture` | PASS — 10 目录 / 51 文件，无反向依赖，无遗留 database 适配器 |
| `npm run audit:dead-files` | PASS — 198 文件，4 条白名单，无新增死文件 |
| `npm run audit:unused-exports` | PASS — 158 个未使用导出（信息性，不判定） |
| `npm run audit:env` | PASS — 87 使用 / 83 声明；A 段 0 缺失；B 段 2 提示（`DATABASE_URL`、`NEXT_PUBLIC_ENABLE_CREEM`） |
| `npm run verify:product-boundary` | PASS — Core→Product 0；Product 7 文件 / 16 条内部依赖均指向 Core |
| **`npm run verify`** | **15 通过 · 0 失败 · 0 跳过** ✅（含 `build` 17.6s；`migrations:static` / `migrations:real` 均为 PASS 而非 SKIP） |
| `npm run build` 单独复跑 | exit 0 |

满足规格要求的「15 PASS 0 FAIL 0 SKIP」，未触发「停止」条件，也未顺手修任何 unrelated 问题。
运行环境：Node 24.12.0 / Windows（本机唯一 runtime；**Node 20 未验证**）。

---

## 7. 代码修改状态

**No source changes.**

审计前后 `git status --short` 逐行一致（§1）。本阶段：

- 未创建 Product B、未创建产品注册表、未修改任何守卫脚本；
- 未修改 `src/**`、`scripts/**`、`vercel.json`、`package.json`、`supabase/**`；
- 审计本身的产出只有本文件 + `docs/README.md` §5、`docs/PROJECT_STATUS.md` 时间线的索引行。

**审计之后、经人工裁决才做的文档动作**（都不属审计结论的一部分，且全部随 9.7 收尾 commit 提交）：

- 修 §8 列出的 7 处过期引用（代码侧的 `verify-product-boundary.mjs:170` 明确**不动**）；
- F9.7-15：`docs/ARCHITECTURE.md` → `docs/archive/`（`git mv`，正文一行未改）+ 6 个文件的引用与计数回写；
- `.gitignore` 增 `.workbuddy-ai/memory/`（agent 本地工作状态不入库）。

---

## 8. 本阶段顺带发现的文档不准（**审计时只记录；裁决后已修，见下**）

| 位置 | 问题 | 处置 |
|---|---|---|
| `MOTHER_TEMPLATE.md:588` | 仍写「14 通过 · 0 失败 · 1 跳过」，实际已 15/0/0（F9.7-17 之后未回写） | ✅ 已改为 15/0/0，并指向 FOLLOWUPS §7.7 |
| `PRODUCT_GUIDE.md:229` / `PROJECT_STATUS.md` §9.8 行 | 引用 `scripts/verify-ai-core.ts:238`，F9.7-16 修复后行号已漂到 `:248` | ✅ 已改 `:248` |
| `AGENT_GUIDE.md:197` / `AI_CORE.md:544` / `PHASE_9_7_FOLLOWUPS.md:50` | 引用 `verify-ai-core.ts:253-257`（Provider 注册表硬断言），同批漂移后实为 **`:263-266`** | ✅ 已改 —— 与上两条同源，属同一批行号漂移（**超出用户批准的 3 处，主动扩了 4 处同类修复**，见下方说明） |
| `PHASE_9_7_FOLLOWUPS.md:362`（F9.7-5 文件清单） | 同样引用 `:238` | ✅ 已改 `:248` |
| `scripts/verify-product-boundary.mjs:170` | over-claim 文案仍在脚本输出里（见 F9.8-E 第 6 条） | ⛔ **未修** —— 属代码，9.8.1 明确禁改；留给后续「架构 Guard 强化」阶段 |

> 关于第 3 行：用户批准的是「修 3 处过期文档」。扫描时发现同一处 `process.exit` 修复
> 造成的行号漂移一共有 7 处引用，其中 4 处不在批准清单里。它们是**同一个缺陷的同一种表现**
> （把 `:253-257` 留在文档里会直接误导下一个改 Provider 的 agent），所以一并修了，并在此如实标出。
> 若你认为应当严格按 3 处执行，回退这 4 处即可，不影响任何其它内容。
>
> 同一裁决下另做了 **F9.7-15**：`docs/ARCHITECTURE.md` 移入 `docs/archive/`
> （纯文档整理，代码零引用，详见 `PHASE_9_7_FOLLOWUPS.md` F9.7-15 横幅）。
> 它随 9.7 收尾 commit 一起提交，不与本审计结论混在一起。

---

## 9. 给 Phase 9.8.2 的建议（仅建议，本阶段不实施）

> ✅ **事后回执（9.8.2-D，2026-10-10）**：本节的建议按原样执行 ——
> 判据（1）、2(a)~2(d) 的顺序（2）、不提前实现产品注册表（3）都照做了；
> 第 4 条的 `/api/v1` 用例落在 `scripts/verify-api-routing.ts`，`?action=` 无人消费**确认为
> legacy 兼容层的设计**（2(b) 的 R1：兼容层不从路径/查询补 action）；第 5 条里 `fal.ts` 的模型
> id 硬分支现在读的是产品传入的 `config.models[...]`（引擎文件里已无模型字面量），
> 而 **payment 桶与 `/api/v1` 的限流 / 安全头仍未处理** —— 已明确划在母版复用阻塞项之外
> （见 `PROJECT_STATUS.md` §10.1）。
> 本审计当时的 **BLOCKED** 结论已被 Product B 实测定为**解除**：证据见
> [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)。


1. **先定判据**：9.8.2 不得用 `npm run verify` 做「删产品」实验（原因见 F9.8-D/E 与 §4 步骤 6）；
   改用 `npm run lint` + `npm run build`，并把 `scripts/**` 的失败单列为「待解耦项」而非架构结论。
2. **按阻塞强度排序处理，不按架构漂亮程度**：
   - a) **内容间接层**（E-7：8 个组件 + `HomeDictionary` 类型）—— 唯一让 build 失败的产品耦合，单位收益最大；
   - b) **Edge + 部署 rewrite 一起处理**（先实证 Vercel 路由优先级，再同时动 `proxy.ts` 与 `vercel.json`，只改一个会制造漂移）；
   - c) 模型 / 积分 / provider-map 的产品化登记（Core 留机制，数据移入 Product）；
   - d) `scripts` 去产品化（拆出 `verify-product-flux`，或让 Core-only 用例不 import 产品）。
3. **产品注册表仍不要提前实现**：等 2(a) 的真实形状浮现后，再决定是否需要那层间接。
4. 补 `/api/v1` 兼容层用例，并确认 `?action=` 惰性是否有意为之（当前无人消费它）。
5. `proxy.ts` 的 payment 桶永不命中（F9.7-12）与 `fal.ts:162` 的模型 id 硬分支，建议并入同一批 Edge/Provider 清理。

---

## 10. 本阶段没有做的（划清范围）

- 未创建第二个产品（规格禁止，属 9.8.2）。
- 未做任何解耦修改：`proxy.ts` / `vercel.json` / `models.ts` / `config/*` / `user-tiers.ts` / 8 个组件全部原样。
- 未加强或修复守卫（未发现 guard bug，只有**覆盖范围**问题，已在 F9.8-E 记录）。
- 未修改 AI / Workflow / Billing / Credit / Storage / Auth / DB 任何业务代码。
- 未做大规模重构；未处理 E-6 / E-8 / E-9 / E-10（与「复制能力」无关）。
- 审计过程中未提交 git（验收后才按裁决拆两个 commit 提交，见 §7）。

**审计到此停止，等待人工验收。不进入 Phase 9.8.2。**
