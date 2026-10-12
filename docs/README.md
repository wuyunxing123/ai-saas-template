# docs/ — 文档索引

> 最后更新：2026-10-10 · 对齐 **Phase 9.8.2-D**（母版可复用性已由 Product B 实测）完成状态
> 当前 `docs/` 下 **38 个 `.md`**（含 16 个阶段审计/遗留记录）+ `archive/` 54 个历史文件
>
> ⚠️ **本仓库以单个初始提交发布**（`git log` 只有一条记录）。文中形如 `9.8.2-C`、`B-21 限流桶修复`、
> `归档旧文档` 的标记是**发布前原仓库的开发阶段 / 提交主题**，在本仓库里**解析不出 git 对象**，
> 只作为出处标记阅读；开发过程的逐提交历史不随本仓库发布。

你是从根目录 `README.md` 过来的？那份讲**怎么把项目跑起来**。
这一份讲**去哪篇查细节**。

---

## 0. 先读哪一篇

```
README.md                  怎么把项目跑起来（安装 / 环境变量 / 常见坑）
   ↓
MOTHER_TEMPLATE.md         ⭐ 项目入口文档：这套母模板内部是怎么回事、边界在哪
   ↓
AGENT_GUIDE.md             你是 Coding Agent？动手前后的硬性约束
   ↓
PROJECT_STATUS.md          做到哪个阶段了、命令速查、缺陷状态
   ↓
PRODUCT_GUIDE.md           我要换成自己的产品 / 加第二个产品，该动哪里
   ↓
按主题查：AI_CORE / WORKFLOW / BILLING / DATABASE / STORAGE / ADMIN / FLUX_PRODUCT
```

**一句话选择**：
- 第一次接触本项目 → `MOTHER_TEMPLATE.md`
- 要改代码（人或 Agent）→ `MOTHER_TEMPLATE.md` + `AGENT_GUIDE.md`
- 要做自己的产品 → `PRODUCT_GUIDE.md`
- 想知道现在什么状态 → `PROJECT_STATUS.md`

---

## 1. 入口与总览

| 文档 | 内容 | 什么时候读 |
|---|---|---|
| [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md) | ⭐ **项目入口文档。** What is this / 架构与依赖方向 / 请求流（AI + 商业闭环）/ 12 个 Core 模块的 What-Why-Where-How-Boundary / Product 职责与边界 / 配置与环境 / 数据库与迁移 / 测试与验证 / 开发流程 / 部署运维 / **§5.4 已知边界例外** | **第一个读** |
| [`AGENT_GUIDE.md`](./AGENT_GUIDE.md) | Coding Agent 约束：动手前必读必搜、禁止清单（含**已删除 legacy 的完整黑名单**）、本仓库特有的坑、动手后的验证顺序与不变量、发现残留怎么报告 | 写代码前 |
| [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) | 如何新增第二个 Product：目录布局、正确依赖方向、**完整改动清单**、§5 剩余障碍（只剩「无产品注册表」这一项**刻意选择**与 i18n / 品牌串文案）、§7 删除实验、**§7.4 Product B 实测** | 想二开时 |
| [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) | 阶段时间线（1 ~ 9.8，含 commit）、目标架构与核心边界、四大抽象、B-1~B-21 缺陷状态、**§8 命令速查**、§9.2 待处理汇总 | 想知道现状时 |

---

## 2. 主题文档（按基础设施分层）

| 文档 | 覆盖 |
|---|---|
| [`AI_CORE.md`](./AI_CORE.md) | `AIProvider` 契约 / `AIService` / 模型目录 / Provider 注册表与解析优先级 / **§10.1 如何新增 Provider（含职责边界与 4 家实现差异表）** / §13 已知边界 |
| [`WORKFLOW.md`](./WORKFLOW.md) | AI Task 生命周期、状态机、Webhook、Polling、Retry、积分结算、幂等三层 |
| [`DATABASE.md`](./DATABASE.md) | 表结构、迁移链 0000~0009、迁移原则、**两层校验（sqlglot / PGlite）**、Repository 层规范、附录 L-10~L-24 状态 |
| [`BILLING.md`](./BILLING.md) | 订单、`PaymentProvider`、Webhook 验签、履约（发积分 / 激活订阅）、**金额整数最小单位规则** |
| [`STORAGE.md`](./STORAGE.md) | `StorageService → StorageProvider → R2`、Object Key 规范、§10 与产品层的关系 |
| [`ADMIN.md`](./ADMIN.md) | Admin 授权边界、`withAdmin` / `requireAdmin()`、审计日志、分页约定 |

---

## 3. 产品层

| 文档 | 内容 |
|---|---|
| [`FLUX_PRODUCT.md`](./FLUX_PRODUCT.md) | Flux Kontext 作为**第一个产品模块**的职责、API、UI、积分、存储、依赖方向。§10 有一段早期的「如何加第二个产品」说明 —— **以 [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) 为准** |

---

## 4. 决策与计划（含历史快照）

| 文档 | 性质 | 说明 |
|---|---|---|
| [`REFACTOR_DECISIONS.md`](./REFACTOR_DECISIONS.md) | ✅ **当前有效** | 全部架构决策 D-1 ~ D-50 及结论。每条分「历史决策（Phase 1）」与「最终决策」两段，头部有未闭合决策清单 |
| [`REFACTOR_PLAN.md`](./REFACTOR_PLAN.md) | ⚠️ **历史快照** | Phase 1 的重构计划 + 各阶段执行日志。**计划正文的路径多数已失效**，执行日志**只到 Phase 6.5**（Phase 7 起未回写）。顶部有醒目说明 |
| [`archive/ARCHITECTURE.md`](./archive/ARCHITECTURE.md) | ⚠️ **Phase 1 历史快照（已移入 archive）** | 1051 行，2026-09-23 的只读分析。**标题里的「当前」是历史遗留，内容已失效**（顶部有逐条说明）。仅用于回溯「当时为什么那样做」。2026-09-30 按 F9.7-15 从 `docs/` 移入 `docs/archive/`，这样主文档区只剩**一个**架构真相（`MOTHER_TEMPLATE.md`） |
| [`DATABASE_AUDIT.md`](./DATABASE_AUDIT.md) | ⚠️ **Phase 1 历史快照** | 数据库审计快照 |

> 想了解**当前真实架构**，读 [`MOTHER_TEMPLATE.md`](./MOTHER_TEMPLATE.md)，不是 `archive/ARCHITECTURE.md`
> （后者已于 2026-09-30 移出主文档区，避免两份架构真相）。

---

## 5. 阶段审计与遗留（PHASE_*_AUDIT / FOLLOWUPS）

每阶段两份：**AUDIT** = 动手前的只读审计快照；**FOLLOWUPS** = 该阶段做完了什么、还留什么。
**它们描述的是当时的状态**，不要当现状读。

| 阶段 | 主题 | 审计 | 遗留 |
|---|---|---|---|
| 6 | Auth + Template Cleanup | [`PHASE_6_AUTH_AUDIT.md`](./PHASE_6_AUTH_AUDIT.md) | [`PHASE_6_FOLLOWUPS.md`](./PHASE_6_FOLLOWUPS.md) |
| 6.5 | Admin | [`PHASE_6_5_AUDIT.md`](./PHASE_6_5_AUDIT.md) | [`PHASE_6_5_FOLLOWUPS.md`](./PHASE_6_5_FOLLOWUPS.md) |
| 7 | Workflow / Async Task Engine | [`PHASE_7_AUDIT.md`](./PHASE_7_AUDIT.md) | [`PHASE_7_FOLLOWUPS.md`](./PHASE_7_FOLLOWUPS.md) |
| 8 | Flux Business Decoupling | [`PHASE_8_AUDIT.md`](./PHASE_8_AUDIT.md) | [`PHASE_8_FOLLOWUPS.md`](./PHASE_8_FOLLOWUPS.md) |
| 9.1 | 移除遗留 database 适配器 | [`PHASE_9_1_AUDIT.md`](./PHASE_9_1_AUDIT.md) | [`PHASE_9_1_FOLLOWUPS.md`](./PHASE_9_1_FOLLOWUPS.md) |
| 9.2 | Payment → Billing 收口 | [`PHASE_9_2_AUDIT.md`](./PHASE_9_2_AUDIT.md) | [`PHASE_9_2_FOLLOWUPS.md`](./PHASE_9_2_FOLLOWUPS.md) |
| 9.3 | Productization & 残留清理 | [`PHASE_9_3_AUDIT.md`](./PHASE_9_3_AUDIT.md) | [`PHASE_9_3_FOLLOWUPS.md`](./PHASE_9_3_FOLLOWUPS.md) |
| 9.4 | i18n / SEO 产品化 | [`PHASE_9_4_AUDIT.md`](./PHASE_9_4_AUDIT.md) | [`PHASE_9_4_FOLLOWUPS.md`](./PHASE_9_4_FOLLOWUPS.md) |
| 9.5 | Environment / Config 整理 | [`PHASE_9_5_AUDIT.md`](./PHASE_9_5_AUDIT.md) | [`PHASE_9_5_FOLLOWUPS.md`](./PHASE_9_5_FOLLOWUPS.md) |
| 9.6 | Test / CI / Migration 完整性 | [`PHASE_9_6_AUDIT.md`](./PHASE_9_6_AUDIT.md) | [`PHASE_9_6_FOLLOWUPS.md`](./PHASE_9_6_FOLLOWUPS.md) |
| **9.7** | **Mother Template 文档** | [`PHASE_9_7_AUDIT.md`](./PHASE_9_7_AUDIT.md) | [`PHASE_9_7_FOLLOWUPS.md`](./PHASE_9_7_FOLLOWUPS.md) |
| **9.8.1** | **第二产品复制验证 · 架构基线审计** | [`PHASE_9_8_1_AUDIT.md`](./PHASE_9_8_1_AUDIT.md) | —（结论 BLOCKED，遗留写在审计文件本身 §8/§9） |
| **9.8.2** | **解耦切片 2(a)~2(d) + Product B 复用实测** | — | —（无独立 FOLLOWUPS 文件；逐切片记录在 [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) §1/§2/§10.1，可复用性的实测证据在 [`PRODUCT_GUIDE.md`](./PRODUCT_GUIDE.md) §7（删除实验）与 §7.4（Product B 实装）） |

> ⚠️ `PHASE_9_7_AUDIT.md` 有个特殊情况：它是在**用户规格送达之前**写的，
> 当时按路线图条目字面推测目标（还提议了一个 `TEMPLATE_GUIDE.md`，最终未采用）。
> **实际执行的规格与产出以 `PHASE_9_7_FOLLOWUPS.md` 为准。**
>
> 该文件 §七 另记了一个**不属任何 Phase 的收尾批次**（2026-09-30，commit `门禁 spawn 修复`：
> 修 F9.7-16 让 `npm run verify` 恢复绿、`verify-all` 改异步 spawn、
> 新增 `scripts/source-scan.ts` 去掉 Unix `cat`/`grep` 依赖）。
> 审核代码改动时请以那个 commit 为范围，不要与 9.7 的文档产出混在一起。
>
> 🔴 `PHASE_9_8_1_AUDIT.md`（2026-09-30）是**只读的架构基线审计，没有 FOLLOWUPS**：
> 规格禁止在 9.8.1 做任何修改，所以它的遗留直接写在 §8（文档不准）与 §9（给 9.8.2 的建议）里。
> 结论是 **BLOCKED** —— 「Core 不依赖 Product」成立，
> 「换掉 Product Layer 就能得到 Product B」**不成立**。
> **读 `MOTHER_TEMPLATE.md` §5.4 之前先读它**，那 10 条例外的「复制能力判定」在这一篇里。
>
> ✅ 它的 BLOCKED 结论是**当时**的状态，已被 Phase 9.8.2 的四个切片逐项解除，
> 并在 9.8.2-D 用真实的第二产品（Product B fixture：非 Flux 模型 / 成本 / 套餐 / 内容，
> Flux 全删，独立 worktree）**正向实测**：`npm run verify` + `next build` 全绿，
> Core 业务逻辑零改动。判定口径见 [`PRODUCT_GUIDE.md` §7.4](./PRODUCT_GUIDE.md)。

---

## 6. 历史归档

[`docs/archive/`](./archive/README.md) —— **55 个文件**（54 个 `.md` + 1 个 `.html`）：
中文教学指南、SEO 配置说明、部署迁移计划、历史分析报告等，首批归档于 2026-09-25；
2026-09-30 追加 `ARCHITECTURE.md`（F9.7-15，主文档区不再留第二份架构真相）。

> ⚠️ 它们**不反映当前架构**，仅供历史参考。里面的文件路径多数已失效。
> 按 Phase 9.7 规格：**不重写 archive**。

---

## 7. 质量门禁速查

```bash
npm run verify        # ⭐ 本地 CI 门禁：19 步（lint / 5 守卫 / 1 INFO / 9 验证 / 2 迁移 / build）
npm run verify:fast   # 跳过构建与迁移校验
npm run lint          # eslint + tsc --noEmit
npm run audit:env     # .env.example 与代码使用一致性
```

> **CI 策略**：本仓库**不在 GitHub 上跑 CI**（`.github/workflows/*.yml` 明确注释
> "all CI runs locally, not on GitHub"），只保留手动触发的 CodeQL 与 Dependency Review。
> 门禁由贡献者本地执行，PR 模板已同步。

完整命令表见 [`PROJECT_STATUS.md` §8](./PROJECT_STATUS.md)，
19 步的逐步说明与 **SKIP / FAIL / INFO 语义**见 [`MOTHER_TEMPLATE.md` §8](./MOTHER_TEMPLATE.md)。

---

## 8. 文档约定

- **当前代码是事实来源。** 文档与代码冲突时以代码为准，并修文档。
- 历史文档（`archive/ARCHITECTURE.md`、`REFACTOR_PLAN.md` 计划正文、`PHASE_*_AUDIT.md`、`archive/`）
  **保留但必须标记 historical**，不做逐行修正。
- 新增文档必须在本索引登记，**不留死链**。
- 每阶段收尾新建 `PHASE_<N>_FOLLOWUPS.md`，格式见 [`AGENT_GUIDE.md` §5](./AGENT_GUIDE.md)。
