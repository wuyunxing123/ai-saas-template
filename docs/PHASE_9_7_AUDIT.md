# Phase 9.7 Audit — Mother Template 文档

> 只读审计，**本文件提交时未修改任何业务代码**。
> 审计时间：2026-09-26 · 基线 commit：`母版文档前检查点`（tag `phase-9.7-before-docs`）
>
> 本阶段规格未提供（用户消息在 Phase 9.6 结尾处截断）。本审计按路线图条目
> 「9.7 Mother Template 文档」的字面目标执行：让母模板的文档**可导航、准确、可交付**。

---

## 0. 结论摘要

代码侧的架构收口（9.1~9.6）已经完成，但**文档没有跟上**：

1. **入口文档停在 6 个阶段之前** —— 自称「第一个读」的 `PROJECT_STATUS.md` 写着
   「覆盖 Phase 1 ~ 6.5」「Phase 7 及以后尚未定义」，而 7 / 8 / 9.1~9.6 全部已完成。
2. **32 篇文档没有索引** —— README 对 `docs/` **零链接**，`docs/` 自身也没有 README / INDEX。
3. **README 的项目结构图是 Phase 1 时期的** —— 画的目录大多已删除，当前核心目录一个没画。

一句话：**新人接手这个模板，会被文档带错路。**

---

## 1. 文档资产盘点

| 位置 | 文件数 | 行数 | 性质 |
|---|---|---|---|
| `docs/*.md` | **32** | 10,226 | 当前有效（含 14 个 PHASE_*_AUDIT/FOLLOWUPS） |
| `docs/archive/` | **54** | 20,834 | 历史归档（已有 `README.md` 说明） |
| 根目录 `*.md` | 6 | ~1,800 | `README` / `CONTRIBUTING` / `CHANGELOG` / `SECURITY` / `CODE_OF_CONDUCT` / `AGENTS` |
| **合计** | **92** | **~32,860** | |

### 1.1 `docs/` 分类

| 类别 | 文件 | 新鲜度 |
|---|---|---|
| **状态/决策** | `PROJECT_STATUS`、`REFACTOR_PLAN`、`REFACTOR_DECISIONS` | ⚠️ 见 §2 D-1 |
| **架构快照** | `ARCHITECTURE`（Phase 1）、`DATABASE_AUDIT`（Phase 1） | ⚠️ 见 §2 D-5 |
| **模块文档** | `AI_CORE`、`BILLING`、`DATABASE`、`STORAGE`、`ADMIN`、`WORKFLOW` | 🟡 09-23 ~ 09-26 |
| **产品文档** | `FLUX_PRODUCT` | ✅ 09-26 |
| **阶段审计/遗留** | 14 个 `PHASE_*_AUDIT` / `PHASE_*_FOLLOWUPS` | ✅ 最新 |

### 1.2 `docs/archive/` —— 已妥善处理

`docs/archive/README.md` **存在**，说明「模板遗留文档 · 不反映当前架构 · 仅供历史参考」。✅
（唯一瑕疵见 §2 D-6：其中「当前有效文档 14 个」已过时，实际 32 个。）

---

## 2. 缺陷清单

### 🔴 D-1｜入口文档严重过期（`PROJECT_STATUS.md`）

该文件第 3 行自称：

> **这是接手本项目时应该第一个读的文档。**

但实际内容停在 6 个阶段之前：

| 位置 | 当前文字 | 事实 |
|---|---|---|
| 头部 | 「生成时间：2026-09-25 · 覆盖 **Phase 1 ~ 6.5**」 | 现已到 **9.6** |
| §1 当前状态 | 「Phase 7 及以后**尚未定义**」 | 7 / 8 / 9.1 / 9.2 / 9.3 / 9.4 / 9.5 / 9.6 **全部完成** |
| §2 时间线表 | 最后一行 `7+ \| 待用户定义 \| ⬜` | 缺 7、8、9.1~9.6 共 8 行 |

**影响**：新人按文档指示读「第一个文档」，得到的是「本项目才做到 6.5」的错误认知。

### 🔴 D-2｜32 篇文档没有索引

- `README.md` 中对 `docs/*.md` 的引用数：**0**
- `docs/README.md` / `docs/INDEX.md`：**都不存在**
- 唯一的间接导航是 `PROJECT_STATUS.md` 里零散提到 4 个（`ADMIN` / `AI_CORE` / `BILLING` / `STORAGE`）

**影响**：`WORKFLOW.md`（13 章）、`FLUX_PRODUCT.md`（10 章）、`STORAGE.md`、`DATABASE.md` 等实质文档**无法被发现**。

### 🔴 D-3｜README §5「项目结构怎么读」严重失真

README 212–231 行画的结构图（节选）：

```text
└── lib/
    ├── flux-kontext.ts          # ← Phase 8 已删除（迁入 products/flux-kontext/）
    ├── image-generation/        # ← 已删除
    │   └── providers/
    │       ├── fal-provider.ts      # ← 从未以该路径存在
    │       ├── kie-provider.ts
    │       └── wavespeed-provider.ts
    ├── payment/                 # ← Phase 9.2 已删除
    └── services/                # ← 大部分已删除
```

而当前**真正的核心目录一个都没画**：
`lib/ai/`、`lib/workflow/`、`lib/products/`、`lib/db/`、`lib/billing/`、`lib/storage/`、`lib/admin/`、`config/`

**影响**：这是新人理解代码组织的第一张图，指向的全是不存在的路径。

### 🟡 D-4｜33 处活跃文档失效路径

已用脚本扫描 `docs/*.md` + 根目录 `*.md`（排除历史快照与 `docs/archive/`），
发现 **33** 处指向不存在文件的路径。真实失效项（全部为 8 / 9.1 / 9.2 已删文件）：

| 失效路径 | 出现在 |
|---|---|
| `src/lib/database.ts` | `DATABASE.md`、`PROJECT_STATUS.md`、`REFACTOR_DECISIONS.md`、`README.md` |
| `src/lib/flux-kontext.ts` | `AI_CORE.md`、`PROJECT_STATUS.md`、`README.md` |
| `src/lib/flux-kontext-request.ts` | `DATABASE.md` |
| `src/lib/payment-security.ts` | `BILLING.md`、`PROJECT_STATUS.md`、`REFACTOR_DECISIONS.md` |
| `src/lib/payment/{creem,stripe,router}.ts` | `BILLING.md`、`REFACTOR_DECISIONS.md`、`README.md` |
| `src/lib/services/{order,payment-config,payment-database,pricing,user,r2-storage}.ts` | `DATABASE.md`、`BILLING.md`、`STORAGE.md`、`PROJECT_STATUS.md`、`REFACTOR_DECISIONS.md`、`README.md` |
| `src/lib/types/{order,user}.ts`、`src/lib/utils/{ip,response}.ts` | `PROJECT_STATUS.md`、`REFACTOR_DECISIONS.md` |
| `src/lib/workflow/flux-bridge.ts` | `REFACTOR_DECISIONS.md` |
| `src/lib/content-safety/index.ts`、`src/lib/storage/providers/s3.ts`、`src/lib/workflows/image.ts` | `PROJECT_STATUS.md`、`STORAGE.md`、`AI_CORE.md` |
| `scripts/setup-database.sql`、`src/app/api/debug/users/route.ts`、`src/config/providers.ts` | `README.md`、`REFACTOR_DECISIONS.md` |
| `src/lib/image-generation/*`、`src/lib/config/payment.ts` | `README.md`、`PROJECT_STATUS.md` |

> 扫描中的**假阳性**（非缺陷，勿改）：`scripts/verify-`（前缀通配）、
> `src/lib/products/product-b/`（`FLUX_PRODUCT.md` 的**未来示例**，刻意如此）、
> `supabase/migrations/0000`、`00NN_`（简写/占位）。

### 🟡 D-5｜`ARCHITECTURE.md` 标题误导

- 1051 行，标题：**「ARCHITECTURE.md — 当前项目架构分析（Phase 1 产物）」**
- 正文第 0 节「阅读前必须知道的 5 个事实」中：
  - 事实 #2 描述 `src/lib/database.ts` 的伪 Prisma —— **该文件已在 9.1 删除**
  - 事实 #3 声称 `creditTransaction` / `subscription` / `paymentConfig` 是纯 mock —— **已修复**
- 虽在附录 A 处有「Phase 1 历史快照」标注，但**标题的「当前」二字**会让人误以为是现状。

### 🟡 D-6｜`docs/archive/README.md` 计数过时

「当前有效的文档在 `docs/` 目录（**14 个**）」→ 实际 **32 个**。

### 🟢 D-7｜缺少「如何用这个模板做自己的产品」指南

- 相关内容只在 `FLUX_PRODUCT.md` §10「如何未来加入第二个 AI Product」一段（约 30 行）
- 没有独立文档说明：替换产品层需要动哪些地方 / 核心哪些**不能动**
- 与 **Phase 9.8「第二产品复制验证」** 直接相关 —— 9.8 的验证依据应该来自这份文档

### 🟢 D-8｜README 未说明「CI 在本地跑」这一策略

9.6 已把 `npm run verify` 写进 README，但「为什么 GitHub 上不跑 CI」这一策略
只在 `CONTRIBUTING.md` 与 `PROJECT_STATUS.md` 里说明，README 尚未点明。

---

## 3. 建议执行清单

| # | 动作 | 解决 | 风险 |
|---|---|---|---|
| 1 | **新建 `docs/README.md`** —— 文档索引：按「先读什么 / 主题文档 / 阶段记录 / 历史归档」分组，链接全部 32 篇 | D-2 | 无 |
| 2 | **更新 `PROJECT_STATUS.md`** —— 头部覆盖到 9.6、§1 状态、§2 时间线补 7/8/9.1~9.6 八行（含 commit） | D-1 | 无 |
| 3 | **重写 README §5 项目结构** —— 按当前真实目录画（`ai` / `workflow` / `products` / `db` / `billing` / `storage` / `admin` / `config`） | D-3 | 无 |
| 4 | **修 §2 D-4 的 33 处失效路径**（逐处替换为当前路径或删除该引用） | D-4 | 低 |
| 5 | **`ARCHITECTURE.md` 加醒目历史标记**（改标题为「Phase 1 历史快照」+ 顶部红字说明），或移入 `docs/archive/` | D-5 | 低 |
| 6 | **修 `docs/archive/README.md`** 计数 14 → 32 | D-6 | 无 |
| 7 | **新建 `docs/TEMPLATE_GUIDE.md`** —— 如何用母模板做自己的产品：产品层结构、可改/不可改边界、从 Flux 换成 Product B 的具体步骤（为 9.8 提供依据） | D-7 | 低 |
| 8 | **README 增加 `docs/` 索引链接** + 一句话说明本地 CI 策略 | D-2 D-8 | 无 |
| 9 | 输出 `docs/PHASE_9_7_FOLLOWUPS.md` | — | 无 |

### 待用户裁决

- **(A) `ARCHITECTURE.md`（1051 行 Phase 1 快照）**：加历史标记保留在 `docs/`？还是整体移入 `docs/archive/`？
- **(B) `docs/TEMPLATE_GUIDE.md` 是否在本阶段写？** 还是留到 9.8（第二产品复制验证）时一并产出？
- **(C) 14 个 `PHASE_*_AUDIT` / `FOLLOWUPS` 是否要在索引里单独分组？**（它们数量已占 `docs/` 的 44%）

---

## 4. 本阶段边界

**不做**（沿用前序阶段原则）：
- 不改数据库 schema / 不新增 migration
- 不改代码（除文档内的路径引用修正）
- 不做 i18n / SEO 全量重构
- 不实现第二产品（属 9.8）
- 不清理 `docs/archive/` 内部（已有 README 说明其为历史）

**与 9.8 的关系**：9.7 产出「如何做第二个产品」的文档依据，9.8 依据它做**静态验证**
（删除 `products/flux-kontext/` 后 Core 是否仍能编译）。
