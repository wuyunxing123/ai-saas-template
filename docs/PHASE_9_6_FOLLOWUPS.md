# Phase 9.6 Follow-ups — Test / CI / Migration 完整性

> 对应审计：`docs/PHASE_9_6_AUDIT.md`
> 基线 commit：`测试CI 前检查点`（tag `phase-9.6-before-test-ci`）

---

## 一、Completed（本阶段已完成）

### ✅ 建立本地 CI 单一入口

- **新增 `scripts/verify-all.mjs`** → `npm run verify` / `npm run ci`（别名）
- 顺序执行 **15 步**：lint → 4 守卫 → 1 信息性工具 → 6 个 verify 脚本 → 迁移静态 → 迁移真实 → build
- 聚合报告（PASS / FAIL / SKIP / INFO + 耗时），**任一 FAIL 退出码 1**
- 新增 `npm run verify:fast`（`--skip-build --skip-migrations`）
- 新增 `npm run migrations:static` / `migrations:real`（复用同一套解析逻辑，避免重复实现 Python 探测）
- `scripts/verify-*.ts` **自动发现**，新增验证脚本无需改本文件
- 支持 `--strict`（SKIP 也判失败）、`--only=<kw>`、`PYTHON=`、`PGLITE_MODULES=`

### ✅ 修复「假绿」

| 问题 | 处置 |
|---|---|
| `npm run check` 报 3 个 ❌ 仍输出「🎉 配置检查通过」且 exit 0 | **退役** `scripts/check-config.js` + `check` 命令；该能力已被 `audit:env` 覆盖 |
| `check-config.js` 引用的 3 个文件在 9.2/9.3 已删除 | 同上 |
| `check-config.js` 建议不存在的 `npm run supabase:types` / `supabase:migrate` | 同上 |

### ✅ 退役失效脚本（6 个 + 7 条 npm 命令）

| 脚本 | 失效点 | 对应 npm 命令 |
|---|---|---|
| `scripts/check-config.js` | 见上（假绿） | `check` |
| `scripts/test-api.js` | 测 `/api/v1/flux/*` —— `src/app/api/v1/` 不存在 | `test:api` |
| `scripts/quick-setup.js` | 写入 `src/utils/supabase/`（真实为 `src/lib/supabase/`）；引用旧 `env.example` | `setup` |
| `scripts/check-supabase.js` | 提示访问已删除的 `/test-auth` 页面 | `check:supabase` |
| `scripts/check-seo.js` | 指向不存在的文档；canonical 判定假阴性（43/100）；退出码恒 0 | `seo:check` / `seo:audit` |
| `scripts/performance-check.js` | 实为 `execSync('npm run build')` + 打印硬编码营销文案（「+60%」等，非测量值） | `perf` |

另移除 `analyze`（依赖 `@next/bundle-analyzer` **未安装**，必然失败）与
`lighthouse`（依赖未安装，必然失败）。

> **保留**：`scripts/check-image-optimization.js`（`check:image`）—— 经核实是
> **sharp 可用性冒烟测试**，内存内 resize 后打印字节数，**不写文件**，有效。

### ✅ 消除重复配置来源

- 删除遗留 `env.example`（252 行，git 已跟踪，标题 `🎨 FLUX KONTEXT AI`，含 16 处 Flux/已删变量）
- 删除根目录 `PAYMENT_SECURITY_GUIDE.md`（与 `docs/archive/` 版逐字节相同，各 410 行）

### ✅ 修复模板可移植性

| 问题 | 处置 |
|---|---|
| `verify_migrations.mjs:86` 硬编码 `C:/Users/fs/.workbuddy-ai/.../node_modules` | 改为 `path.join(ROOT, 'node_modules')`；**全项目已无硬编码本机路径** |
| `@electric-sql/pglite` 未声明 → 新克隆跑不了迁移验证 | 加入 **devDependencies**（`^0.5.8`，仅测试用不进生产包） |
| Python 侧 `sqlglot` 无依赖声明 | 新增 `supabase/scripts/requirements.txt` |

### ✅ 修正 `audit:env` 的语义缺口

`scripts/` 下工具的**命令行开关**（`PYTHON` / `PGLITE_MODULES` / `VERIFY_*`）
被误判为「应用环境变量未在 `.env.example` 记录」→ 新增显式 `TOOLING_VARS` 白名单，
注释说明「新增脚本开关时须同步此处，或确认它属于应用配置应记入 `.env.example`」。
检查强度不变。

> 顺带修复一个隐蔽 bug：`spawnSync(bin, ['-c', 'import sqlglot'], { shell: true })`
> 在 `shell: true` 下会**丢掉引号**，Python 收到两个参数 → 明明装了 sqlglot 却探测不到。
> 改为拼成单条命令字符串并显式引用。

### ✅ 文档同步

- `CONTRIBUTING.md`：`env.example` → `.env.example`；PR 前检查改为 `npm run verify`，并说明本地 CI 策略
- `README.md`：2 处 `cp env.example` → `cp .env.example`；新增 `npm run verify` / `verify:fast` / `audit:env` 说明；「等 GitHub checks」改为「无自动 GitHub checks」
- `.github/pull_request_template.md`：Testing 清单改为 `npm run verify`
- `docs/PROJECT_STATUS.md`：命令速查新增「⭐ 本地 CI 门禁」段与 SKIP 语义说明
- `docs/PHASE_9_5_FOLLOWUPS.md`：F9.5-3 / F9.5-4 标注为 **Phase 9.6 已关闭**

---

## 二、测试执行结果

| 命令 | 结果 |
|---|---|
| `npm run verify`（全量 15 步） | ✅ 15 通过 · 0 失败 · 0 跳过（设 `PYTHON` 后） |
| `npm run lint`（eslint + tsc） | ✅ 0 错误 0 警告 |
| `npm run build` | ✅ 全部路由生成（170s） |
| `audit:dead-files` | ✅ 无新增死文件 |
| `audit:architecture` | ✅ 无反向依赖 |
| `audit:env` | ✅ A 段 0 缺失 |
| `verify:product-boundary` | ✅ Core → Product = 0 |
| `migrations:real`（PGlite） | ✅ **198/198** |
| `migrations:static`（sqlglot） | ✅ 通过 |
| `verify-workflow` / `ai-core` / `billing` / `storage` / `auth` / `admin` | ✅ 全通过 |

**未改数据库 schema**（用户 §21 原则）。

---

## 三、Remaining（F9.6-X）

### F9.6-1 `migrations:static` 依赖本机 Python 环境

- **文件**：`supabase/scripts/validate_migrations.py`、`scripts/verify-all.mjs`
- **问题**：`sqlglot` 只装在本机隔离 venv 中；未设 `PYTHON` 时该步骤 SKIP。
  `requirements.txt` 已提供，但项目**没有 `.venv`**，仍需人工创建。
- **原因**：本阶段不引入 Python 运行时管理；PGlite（Node 侧）已能覆盖迁移**真实执行**，
  静态校验属补充。
- **风险**：低。PGlite 步骤（198 项）才是主门禁，静态校验只多做列级约束检查。
- **是否需要真实环境验证**：否（纯静态）
- **建议**：**Phase 9.7**（文档）说明如何建 `.venv`；或考虑把静态检查也迁到 Node
  （用 `pg-query-parser` 之类）以彻底去掉 Python 依赖。
- **推荐阶段**：Phase 9.7 或后续

### F9.6-2 `.env.local` 仍有 2 个「记录但未使用」变量

- **文件**：`.env.example`（`DATABASE_URL`、`NEXT_PUBLIC_ENABLE_CREEM`）
- **问题**：`audit:env` B 段提示这两项代码未使用。
- **原因**：`DATABASE_URL` 为旧模板残留（本仓库用 Supabase，不走直接 PG 连接）；
  `NEXT_PUBLIC_ENABLE_CREEM` 原由已退役的 `check-config.js` 校验。
- **风险**：低（B 段仅为提示，不阻塞）
- **是否需要真实环境验证**：否
- **建议**：保留 `DATABASE_URL` 注释项（Supabase 迁移/本地工具可能用到）；
  `NEXT_PUBLIC_ENABLE_CREEM` 可在确认无部署依赖后移除。
- **推荐阶段**：Phase 9.7（env 文档定稿时一并清理）

### F9.6-3 无单元/集成测试框架

- **文件**：项目整体
- **问题**：无 vitest / jest / playwright。测试能力由自建 `scripts/verify-*.ts` harness 提供。
- **原因**：Phase 9.6 明确原则「不要为了增加测试数量而增加测试」「不要为了覆盖率制造 mock test」。
  现有 315 项断言覆盖核心逻辑，且无需 DB / Key 即可运行。
- **风险**：中低 —— 优点是零额外依赖、可离线跑；缺点是无法表达「单元测试」语义、
  无覆盖率报告、无 watch 模式。
- **是否需要真实环境验证**：否
- **建议**：若未来需要覆盖率或组件测试，再引入 vitest。**不在 9.6 引入。**
- **推荐阶段**：后续按需

### F9.6-4 HTTP E2E 未纳入门禁

- **文件**：`scripts/smoke-ai-core.mjs`（新增 `npm run smoke:ai`）
- **问题**：它是唯一的 HTTP 端到端测试，但**需要运行中的 dev server + 真实凭据**，
  因此未纳入 `npm run verify`。
- **原因**：本机 `FAL_KEY` / `NEXT_PUBLIC_SUPABASE_URL` 为占位符，无法真实跑通。
- **风险**：中 —— 契约层由 `verify-ai-core.ts` 静态覆盖，HTTP 层无自动化覆盖。
- **是否需要真实环境验证**：**是 —— NOT VERIFIED，requires real dev server + credentials**
- **建议**：在具备真实环境时手动执行 `npm run smoke:ai` 并记录结果。
- **推荐阶段**：Phase 9.7（文档化）或具备环境时

### F9.6-5 `audit:unused-exports` 恒为 INFO

- **文件**：`scripts/audit-unused-exports.mjs`、`scripts/verify-all.mjs`
- **问题**：209 个未使用导出，脚本设计上**不做失败判定**（Phase「死代码审计」结论：
  多数是合理 API 面，照单删除有害）。在 verify 中标记为 INFO。
- **原因**：刻意设计。
- **风险**：低 —— 但意味着「过度导出」问题不会被门禁拦截。
- **是否需要真实环境验证**：否
- **建议**：保持 INFO；若未来要治理，需先定「哪些导出算必须保留」的规则。
- **推荐阶段**：后续按需

### F9.6-6 GitHub Actions 仍无自动触发

- **文件**：`.github/workflows/codeql.yml`、`dependency-review.yml`
- **问题**：二者均为 `workflow_dispatch`（手动），push/PR 无自动门禁。
- **原因**：**仓库既有策略**（文件头注释："Charlie's policy: all CI runs locally, not on GitHub"）。
  本阶段**刻意不新增** push/PR workflow。
- **风险**：低 —— 已有本地入口 `npm run verify`，且 README / CONTRIBUTING / PR 模板已同步。
  但依赖贡献者自觉执行。
- **是否需要真实环境验证**：否
- **建议**：若策略变更，把 `npm run verify` 封进一个 `ci.yml`（push + PR 触发）即可，
  脚本已就绪。
- **推荐阶段**：待策略决定

### F9.6-7 `docs/archive/` 与 `docs/ARCHITECTURE.md` 的历史 env 引用

- **文件**：`docs/archive/*`（多份）、`docs/ARCHITECTURE.md`、`docs/REFACTOR_PLAN.md`
- **问题**：仍写 `env.example`（旧名）与已删除文件（如 `scripts/setup-database.sql`）。
- **原因**：**历史快照，刻意保留**用于回溯「当时为什么那样做」。
- **风险**：无（不影响运行）；但可能误导只读这些文档的人。
- **是否需要真实环境验证**：否
- **建议**：**Phase 9.7**（Mother Template 文档）统一处理 —— 或加一段「历史文档说明」，
  或整体移入 `docs/archive/`。
- **推荐阶段**：Phase 9.7

---

## 四、架构验证

```
API / Webhook → Service → Repository → Supabase      ✅ 成立（audit:architecture）
Product → Core                                        ✅ 成立
Core → Product                                        ❌ 0（verify:product-boundary）
Business → legacy database.ts / legacy payment.*      ❌ 已全部消除（9.1 / 9.2）
```

质量门禁链路：

```
代码  →  npm run verify  →  Test(verify-*)  →  Static Audit  →  Build  →  Migration Validation
                                                                              （静态 + 真实 PG）
```

**本阶段未修改数据库 schema，未新增 migration。**
