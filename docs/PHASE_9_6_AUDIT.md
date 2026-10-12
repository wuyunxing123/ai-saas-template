# Phase 9.6 Audit — Test / CI / Migration 完整性

> 只读审计，**本文件提交时未修改任何业务代码**。
> 审计时间：2026-09-26 · 基线 commit：`测试CI 前检查点`（tag `phase-9.6-before-test-ci`）
>
> **本阶段的实际处置见 `docs/PHASE_9_6_FOLLOWUPS.md`（§一 Completed + §三 Remaining）。**
> 本文件保留为审计时的快照，不再回写。

---

## 0. 结论摘要

Mother Template **已经拥有质量门禁的零件**（5 个守卫 + 7 个验证脚本 + 2 个迁移校验），
但缺三样东西：

1. **单一入口** —— 11 个检查分散，没有一条命令能证明「模板健康」。
2. **真实门禁语义** —— 至少 1 个脚本「报错仍退出 0」，属于**假绿**。
3. **可移植性** —— 迁移验证脚本硬编码本机路径 + 依赖未声明，**新克隆跑不起来**。

GitHub Actions 侧有明确的**策略约束**（见 §2），因此本阶段**不新增 push/PR workflow**，
而是建立**本地 CI 入口**。

---

## 1. 现状：已具备的质量门禁

### 1.1 `npm run lint` = `eslint . && tsc --noEmit`

一条命令覆盖 ESLint + TypeScript 类型检查。✅ 基线通过。

### 1.2 静态守卫（5 个，退出码语义正确）

| 命令 | 脚本 | 判定 | 退出码 |
|---|---|---|---|
| `audit:dead-files` | `scripts/audit-dead-files.mjs` | 无引用文件 | 发现即 1 ✅ |
| `audit:architecture` | `scripts/audit-architecture.mjs` | 基础设施→产品层反向依赖 + 遗留适配器复活 | 违规即 1 ✅ |
| `audit:env` | `scripts/audit-env.mjs` | `.env.example` ↔ 代码使用不一致 | 缺失即 1 ✅ |
| `verify:product-boundary` | `scripts/verify-product-boundary.mjs` | Core→Product import | 违规即 1 ✅ |
| `audit:unused-exports` | `scripts/audit-unused-exports.mjs` | 未使用导出 | **信息性，恒 0**（设计如此） |

### 1.3 业务验证脚本（6 个 TS，纯逻辑，无需 DB/Key）

| 脚本 | 断言数 | 覆盖 |
|---|---|---|
| `verify-ai-core.ts` | 39 | Provider 契约 / 模型目录 / 管线 |
| `verify-billing.ts` | 63 | 定价 SSOT / 订单状态机 / 幂等 |
| `verify-storage.ts` | 47 | Object Key 规范 / namespace |
| `verify-auth.ts` | 60 | 会话 / 限流桶 / Admin 授权边界 |
| `verify-admin.ts` | 65 | 授权 / 分页 / 审计日志 |
| `verify-workflow.ts` | 41 | 状态机 / 结果归一化 / webhook 解析 |

> 合计 **315 项**断言，全部通过。运行方式：`node scripts/run-ts.mjs scripts/<name>.ts`
> （`run-ts.mjs` 复用依赖树里的 `jiti` 解析 `@/` 别名，未引入新依赖）。

### 1.4 迁移校验（2 个）

| 脚本 | 方式 | 项数 |
|---|---|---|
| `supabase/scripts/validate_migrations.py` | sqlglot 静态（语法/依赖序/FK/唯一约束/索引/幂等） | — |
| `supabase/scripts/verify_migrations.mjs` | **真实 PostgreSQL**（PGlite / WASM）执行全部迁移 + 积分原子性 + Billing 闭环 | **198** |

### 1.5 迁移编号完整性

```
0000_baseline  0001_credit_model  0002_orders  0003_subscriptions  0004_ai_tasks
0005_atomic_credit_operations  0006_billing_closed_loop  0007_user_role
0008_admin_audit_logs  0009_workflow_task_engine
```

✅ **0000–0009 连续、无缺号、无重号**。`verify_migrations.mjs` 动态 `readdirSync` 加载，
新增迁移自动纳入，无需改脚本。

### 1.6 测试框架

❌ 无 vitest / jest / playwright / cypress。

**判定：非缺陷。** 本项目的测试策略是「自建 verify harness + 静态守卫」，
不依赖测试框架——这与 `docs/WORKFLOW.md` 的设计一致，也避免了为模板引入重量级依赖。
但**必须文档化**（见 §7）。

### 1.7 基线运行结果（本阶段实测）

| 命令 | 结果 |
|---|---|
| `npm run lint` | ✅ exit 0 |
| `npm run audit:dead-files` | ✅ exit 0 |
| `npm run audit:unused-exports` | ✅ exit 0（信息性） |
| `npm run audit:architecture` | ✅ exit 0 |
| `npm run audit:env` | ✅ exit 0 |
| `npm run verify:product-boundary` | ✅ exit 0 |

---

## 2. CI 现状与策略约束

### 2.1 实际存在的 workflow

| 文件 | 触发 | 内容 |
|---|---|---|
| `.github/workflows/codeql.yml` | **`workflow_dispatch`（仅手动）** | CodeQL 静态安全分析 |
| `.github/workflows/dependency-review.yml` | **`workflow_dispatch`（仅手动）** | 依赖审查 |

**没有** `push` / `pull_request` 触发的 lint / build / test workflow。

### 2.2 ⚠️ 策略约束（重要）

两个 workflow 的文件头都有同一段注释：

```yaml
# Manual trigger only (workflow_dispatch) — Charlie's policy: all CI runs locally, not on GitHub.
# Public repo: Actions minutes are free, so this is policy consistency, not cost savings.
```

→ 这是**刻意的策略决定**：CI 全部在本地跑，不在 GitHub 上跑。

**因此本阶段不得新增 push/PR 触发的 workflow。**
正确做法是建立**本地 CI 入口**（一条命令跑完全部门禁），
让「本地 CI」这件事本身变得可重复、可验证。

---

## 3. 缺陷清单

### 🔴 高

#### T-1｜无单一入口

11 个检查（1 lint + 5 守卫 + 6 verify + 2 迁移校验）分散在 `package.json` 与手工命令里。
模板使用者**无法用一条命令**证明「这个模板是健康的」。
`CONTRIBUTING.md` 与 PR template 让贡献者跑 `npm run build` + `npm run lint` + `npm run check`，
**不包含**任何守卫或 verify 脚本 → 门禁形同虚设。

#### T-2｜无自动门禁

见 §2。受策略约束，解法是本地 CI 入口 + 文档化，而非 GA workflow。

#### T-3｜**假绿**：`npm run check` 报错仍退出 0

实测输出：

```
🔧 检查关键配置文件:
❌ 支付系统配置文件: src/lib/config/payment.ts (文件不存在)      ← Phase 9.2 已删
❌ Supabase类型定义文件: src/types/supabase.ts (文件不存在)
🌐 检查API路由:
❌ 支付会话API: src/app/api/payment/create-session/route.ts (文件不存在)  ← Phase 9.3 已删

🎉 恭喜！项目配置检查通过，可以正常启动开发服务器！      ← 明明 3 个 ❌
exit=0
```

这是最危险的一类问题：**门禁报告失败却宣告成功**。
贡献者按 `CONTRIBUTING.md` 跑 `npm run check`，会得到「通过」的错误信号。

### 🟡 中

#### T-4｜重复的 env 模板：`env.example` vs `.env.example`

| 文件 | 行数 | 修改时间 | git 跟踪 | 状态 |
|---|---|---|---|---|
| `env.example` | **252** | 9/23 | ✅ **已跟踪** | 遗留（标题 `🎨 FLUX KONTEXT AI`，含 16 处 Flux/已删变量） |
| `.env.example` | 160 | 9/26 | ✅ 已跟踪 | Phase 9.5 重写的正确版本 |

两个模板并存 → **重复配置来源**。且 `CONTRIBUTING.md` / `README.md` / `docs/archive/*`
都指向**遗留的那个**。

#### T-5｜硬编码本机路径（模板不可移植）

`supabase/scripts/verify_migrations.mjs:86`：

```js
const EXTERNAL_MODULE_DIRS = [
  process.env.PGLITE_MODULES,
  'C:/Users/fs/.workbuddy-ai/binaries/node/workspace/node_modules',   // ← 本机路径
].filter(Boolean)
```

**全项目唯一一处硬编码本机路径**（已全量扫描确认）。
对模板而言这是泄漏：任何其他机器上这行必然解析失败。

#### T-6｜迁移验证依赖未声明

- `@electric-sql/pglite`：**故意不在 `package.json`**（脚本注释说明「避免为验证引入运行时依赖」）。
  后果：新克隆执行 `verify_migrations.mjs` → `Cannot resolve` → `exit 2`。
  而这是**整个项目最有价值的测试**（唯一能证明迁移真能跑、`consume_credits()` 真原子的测试）。
- Python 侧：`validate_migrations.py` 依赖 `sqlglot`，但**无 `requirements.txt`**。

#### T-7｜已失效的遗留脚本（Phase 1–4 时期产物）

| 脚本 | npm 命令 | 失效点 |
|---|---|---|
| `scripts/test-api.js` | `test:api` | 测试 `/api/v1/flux/text-to-image/{pro,max}`、`/api/v1/flux/image-edit/{pro,max}` —— **`src/app/api/v1/` 目录不存在**；需运行中的 server |
| `scripts/quick-setup.js` | `setup` | ① 引用旧 `env.example` 语义；② 写入 `src/utils/supabase/`，**真实路径是 `src/lib/supabase/`** → 会造出错误副本 |
| `scripts/check-supabase.js` | `check:supabase` | 提示访问 `/test-auth` —— **页面不存在** |
| `scripts/check-seo.js` | `seo:check` | 指向不存在的 `docs/SEO配置检查和优化指南.md`；静态正则判定 canonical → 报 43/100 **假阴性**（实际 canonical 由 `metadata-generator` 的 `alternates.canonical` 提供）；退出码恒 0 |
| `scripts/check-config.js` | `check` | 见 T-3 |

#### T-8｜缺失依赖导致脚本必然失败

`lighthouse` **未安装**（也不在 devDependencies），但 `package.json` 有：

```json
"lighthouse": "npx lighthouse http://localhost:3000 ...",
"seo:audit": "npm run seo:check && npm run lighthouse"
```

→ 两个命令必然失败（或触发联网安装）。

### 🟢 低

| 编号 | 问题 |
|---|---|
| **T-9** | `check-config.js` 结尾建议的 `npm run supabase:types` / `npm run supabase:migrate` **两个脚本不存在** |
| **T-10** | 根目录 `PAYMENT_SECURITY_GUIDE.md` 与 `docs/archive/PAYMENT_SECURITY_GUIDE.md` **逐字节相同**（各 410 行）→ 重复 |
| **T-11** | `CONTRIBUTING.md`（`cp env.example` + `npm run check` + `npm run test:api`）、`README.md`（`cp env.example` ×2）、`.github/pull_request_template.md`（`npm run check`）均指向已失效内容 |
| **T-12** | `verify_migrations.mjs` 头部注释写「把 **0000~0005** 全部执行一遍」，实际已是 **0000~0009** |

### ✅ 澄清：非缺陷

| 项 | 说明 |
|---|---|
| `check-image-optimization.js`（`check:image`） | 名字像「检查」，实为 **sharp 可用性冒烟测试**：`sharp(input).resize(64,64).toBuffer()` **内存内**执行后打印字节数，**不写文件**（实测 `git status` 干净）。保留。 |
| `audit:unused-exports` 退出码恒 0 | **设计如此**（Phase「死代码审计」结论：209 个未使用导出绝大多数是合理 API 面，照单删除有害）。信息性工具。 |
| 无 vitest/jest | 自建 harness 策略，见 §1.6。 |
| `tsconfig.tsbuildinfo` | 已被 `.gitignore:45` 的 `*.tsbuildinfo` 正确忽略。 |

---

## 4. 建议执行清单

| # | 动作 | 解决 | 风险 |
|---|---|---|---|
| 1 | **新增 `scripts/verify-all.mjs`** → `npm run verify`（+ `ci` 别名）：串行跑 lint/tsc → 5 守卫 → 6 verify → 迁移静态 → 迁移真实(PGlite) → build；聚合报告；任一失败 exit 1 | T-1 T-2 | 低 |
| 2 | **退役 `check-config.js`**，`npm run check` 指向新门禁（或修成真门禁 + 正确退出码） | T-3 T-9 | 低 |
| 3 | **删除遗留 `env.example`** | T-4 | 低（git 可回滚） |
| 4 | **移除 `verify_migrations.mjs` 的硬编码本机路径**，改为「项目 node_modules → `PGLITE_MODULES` → 明确报错」 | T-5 | 低 |
| 5 | **声明迁移验证依赖**：`@electric-sql/pglite` 入 devDependencies + 新增 `supabase/scripts/requirements.txt`（sqlglot） | T-6 | 低 |
| 6 | **退役失效脚本**：`test-api.js` / `quick-setup.js` / `check-supabase.js` / `check-seo.js`；同步删除 `test:api` / `setup` / `check:supabase` / `seo:*` / `lighthouse` 等 npm 脚本 | T-7 T-8 | 中（需确认无外部依赖） |
| 7 | 删除根目录重复 `PAYMENT_SECURITY_GUIDE.md` | T-10 | 低 |
| 8 | 更新 `CONTRIBUTING.md` / `README.md` / PR template 的命令与 env 路径 | T-11 | 低 |
| 9 | 修正 `verify_migrations.mjs` 头部注释（0000~0009） | T-12 | 无 |
| 10 | 输出 `docs/PHASE_9_6_AUDIT.md` + `docs/PHASE_9_6_FOLLOWUPS.md` | — | 无 |

### 待用户裁决的三个点

- **(A) PGlite 是否入 devDependencies？**
  入 → 模板开箱可跑迁移验证（推荐）；不入 → 保留「零验证依赖」约定，但新克隆无法验证迁移。
- **(B) 失效脚本：删除还是修复？**
  删 → 减少假信号（推荐）；修 → 保留「小白友好」入口但需重写。
- **(C) `check-config.js`：退役还是修好？**
  退役 → `check` 指向新门禁（推荐，能力已被 `audit:env` 覆盖）；修 → 去掉已删文件检查 + 失败 exit 1。

---

## 5. 依赖方向（本阶段需保持）

```
Product → Core        ✅ 允许
Core → Product        ❌ 必须 0（由 audit:architecture + verify:product-boundary 双重守卫）
```

本阶段**不新增**数据库 schema，**不新增** migration（用户 §21 原则）。

---

## 6. 与 Phase 9.7 / 9.8 的边界

| 事项 | 归属 |
|---|---|
| README 全量重写、模板使用手册 | **9.7** |
| 第二产品复制验证（`products/product-b` 设计验证） | **9.8** |
| `docs/archive/` 的历史文档更新 | 不在本阶段（历史快照） |
| 未使用导出清理（209 个） | 明确不做（见 §3 澄清） |

---

## 7. 审计问题的逐条回答

| 用户检查项 | 结论 |
|---|---|
| 1. TypeScript | ✅ `tsc --noEmit` 已并入 `lint` |
| 2. ESLint | ✅ `eslint .` 已并入 `lint` |
| 3. Production Build | ⚠️ 存在且可用，但**未纳入任何门禁** → 新 verify 入口将包含 |
| 4. 现有业务验证脚本 | ✅ 6 个 TS（315 断言）+ `smoke-ai-core.mjs`（需 server，手动） |
| 5. Migration 完整性 | ✅ 静态 + 真实 PG 双层校验 |
| 6. Migration 顺序/编号/一致性 | ✅ 0000–0009 连续无缺号，动态加载 |
| 7. Architecture Boundary | ✅ `audit:architecture` |
| 8. Dead Files | ✅ `audit:dead-files` |
| 9. Product Boundary | ✅ `verify:product-boundary` |
| 10. Environment Audit | ✅ `audit:env` |
| 11. package.json scripts | ❌ **含 7 个失效脚本**（T-3 T-7 T-8 T-9） |
| 12. CI 配置是否存在、是否有效 | ⚠️ 存在但**仅手动触发**（策略约束）；**无本地聚合入口**（T-1） |
| 13. 「脚本存在但已失效」 | ❌ **发现 5 个**（T-3 T-7） |
| 14. 「测试实际没测任何东西」 | ❌ **发现 1 个**：`check-config.js` 报错仍宣告通过（T-3）；`check-seo.js` 假阴性 |
