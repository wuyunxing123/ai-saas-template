# Phase 9.5 Follow-ups

> Phase 9.5 完成「Environment / Config 整理」。本文件记录未处理事项。配套：`PHASE_9_5_AUDIT.md`。

---

## 1. 已完成

### ⚠️ 关键修复：`.env.example` 从未入库
- **根因**：`.gitignore` 的 `.env*` 规则把 `.env.example` 一起忽略了。
- **影响**：Phase 9.3 创建的 `.env.example` 一直**不在 git 里** → 复制模板时环境变量示例会缺失。
- **修复**：`.gitignore` 增加 `!.env.example`；本次提交首次将其纳入版本控制。

### `.env.example` 重写
- 与代码使用**完全对齐**（83 ↔ 83，`npm run audit:env` A 段 0 缺失）。
- 补入缺失项：`NEXT_PUBLIC_GOOGLE_CLIENT_ID`、`YANDEX_VERIFICATION`、
  `{KIE,ATLASCLOUD,WAVESPEED}_POLL_{INTERVAL,TIMEOUT}_MS`、`SMOKE_*`、
  `ADMIN_EMAILS`、`ENABLE_DEBUG_ROUTES`、`NEXT_PUBLIC_DEMO_VIDEOS_URL`、
  `NEXT_PUBLIC_PAY_CANCEL_URL`、`OPENAI_API_KEY`、`STRIPE_PUBLIC_KEY`、`WAVESPEED_WEBHOOK_SECRET`。
- 移除废弃项：`AZURE_CONTENT_SAFETY_*`、`NEXT_PUBLIC_DEFAULT_THEME`、`NEXT_PUBLIC_ENABLE_R2`、
  `R2_CUSTOM_DOMAIN`、`API4AI_API_KEY`、`GOOGLE_CLOUD_VISION_API_KEY`、`IPAPI_KEY`、
  `RUNWAY_API_KEY`、`SEGMIND_API_KEY`、`SMTP_*`、`PAYMENT_VALIDATION_SECRET`。
- `DATABASE_URL` 改为注释（可选，代码 0 引用）。

### 其他
- 删除空目录 `src/lib/config/`（0 文件）。
- 修复 `package.json` 的 `setup:env`：`env.example` → `.env.example`。
- 删除遗留脚本：`check-payment-config.js`（硬编码 mock、引用已删配置）、
  `setup-database.sql`（被 `supabase/migrations/` 取代）。
- 修正 `api/user/ensure/route.ts` 的过期建议（指向 `supabase/migrations/`）。
- 新增 `scripts/audit-env.mjs`（`npm run audit:env`）：校验 `.env.example` 与代码使用一致。

### 结论（审计项对照）
| 审计项 | 结论 |
|---|---|
| Secret 与 `NEXT_PUBLIC_*` 区分 | ✅ 无泄漏（仅 anon key / turnstile site key，设计为公开） |
| Config 是否承担配置职责 | ✅ `src/config/{billing,credits}.ts` 纯数据，无 `process.env` |
| 业务代码是否到处读 env | ✅ 集中在 `site-config` / providers / auth / proxy |
| Flux / ShipAny env 残留 | ✅ 0 |

---

## 2. Remaining

### F9.5-1 `.env.local` 未清理（按你的选择）
- **文件**：`.env.local`（本地，git 忽略）
- **问题**：含 14 个 0 引用变量 + `NODE_ENV`（Next 运行时注入，不应手写）。
- **建议删除清单**：`API4AI_API_KEY`、`GOOGLE_CLOUD_VISION_API_KEY`、`AZURE_CONTENT_SAFETY_ENDPOINT/KEY`、
  `IPAPI_KEY`、`RUNWAY_API_KEY`、`SEGMIND_API_KEY`、`SMTP_{HOST,PORT,USER,PASS}`、
  `PAYMENT_VALIDATION_SECRET`、`NEXT_PUBLIC_ENABLE_R2`、`R2_CUSTOM_DOMAIN`、
  `NEXT_PUBLIC_DEFAULT_THEME`、`NEXT_PUBLIC_DEMO_IMAGES_URL`、`NODE_ENV`
- **风险**：无（本机文件，未被代码读取）
- **推荐阶段**：随时（手工执行即可）

### F9.5-2 `DATABASE_URL` 代码 0 引用
- **文件**：`.env.example`（注释形式）、`README.md`
- **问题**：应用运行不依赖它；README 建议配置（工具链 / 连通性检查）。
- **原因**：保留给运维排错用。
- **风险**：低
- **推荐阶段**：可选（若要彻底精简，可连同 README 一并移除）

### F9.5-3 `NEXT_PUBLIC_ENABLE_CREEM` 仅 `check-config.js` 使用  — ✅ **Phase 9.6 已关闭**
- **文件**：~~`scripts/check-config.js`~~（已删除）、`README.md`
- **问题**：App 运行时不读它（Creem 启用由 `CREEM_API_URL + CREEM_API_KEY` 决定）。
- **原因**：`npm run check` 会校验它，删了会让检查器报缺失。
- **风险**：低
- **处置（9.6）**：`check-config.js` 已连同 `check` 命令一起退役；`NEXT_PUBLIC_ENABLE_CREEM`
  仍在 `.env.example` 中保留（`audit:env` 判定其为「已确认保留」项），不再有检查器依赖。

### F9.5-4 其余遗留脚本未逐一审计  — ✅ **Phase 9.6 已关闭**
- **文件**：`scripts/{check-config,check-seo,check-supabase,performance-check,test-api,quick-setup}.js`
- **问题**：均挂在 `package.json` 上，但年代久远，未逐项验证是否仍有效。
- **原因**：本阶段范围限定「env / config」，未做全量脚本审计。
- **风险**：低（均为辅助命令，不影响运行）
- **处置（9.6）**：已逐一审计并**全部退役**（6 个脚本 + 对应 npm 命令）。保留
  `check-image-optimization.js`（实为 sharp 可用性冒烟测试，有效）。详见
  `docs/PHASE_9_6_AUDIT.md` §3 T-7 / T-8。

### F9.5-5 `README.md` 的 env 文档与 `.env.example` 可能不一致
- **文件**：`README.md`（500+ 行，含 env 清单与说明）
- **问题**：README 列出的变量与 `.env.example` 未做一致性校验（例如它仍写 `DATABASE_URL`、
  `NEXT_PUBLIC_ENABLE_CREEM`）。
- **原因**：本阶段只对齐 `.env.example` ↔ 代码。
- **风险**：低（文档误导）
- **推荐阶段**：Phase 9.7（Mother Template 文档）

### F9.5-6 `audit:env` 的 B 段警告
- **文件**：`scripts/audit-env.mjs`
- **问题**：B 段（`.env.example` 有、代码未用）当前输出 2 条提示（F9.5-2 / F9.5-3）。
- **原因**：二者为刻意保留，故**不设为失败**（仅提示）。
- **风险**：无
- **推荐阶段**：若清理了 F9.5-2/3，警告自然消失

---

## 3. 验证

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit` / `npm run lint` | ✅ 0 错误 0 警告 |
| `npm run build` | ✅ 全部路由生成 |
| **`npm run audit:env`** | ✅ A 段 0 缺失；B 段 2 条提示（已确认保留） |
| `verify-workflow` / `ai-core` / `billing` / `storage` / `auth` / `admin` | ✅ 42 / ✅ / 78 / 20 / 28 / 45 |
| `verify:product-boundary` / `audit:architecture` / `audit:dead-files` | ✅ / ✅ / ✅ |
| `verify_migrations.mjs` / `validate_migrations.py` | ✅ 198 / ✅ |

**未改数据库 schema**。

## 4. Config 边界确认

```
src/config/billing.ts   纯数据（价格 SSOT）      ✅ 不读 env
src/config/credits.ts   纯数据（积分 SSOT）      ✅ 不读 env
env 读取集中在：site-config / lib/ai/providers/* / lib/billing/providers/* /
                lib/storage/providers/r2.ts / lib/auth.ts / proxy.ts / lib/content-safety/safe-mode.ts
```
