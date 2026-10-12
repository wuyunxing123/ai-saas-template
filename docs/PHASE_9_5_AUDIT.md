# Phase 9.5 Audit — Environment / Config 整理

> 只读审计（写于改造前）。目标：建立清晰、可维护、无重复/废弃项的 Environment / Config 体系。
> 方法：**先查消费者 → 判断用途 → 分类 → 再决定保留 / 迁移 / 删除**。

## 0. 执行摘要

| 维度 | 结论 |
|---|---|
| env 文件 | `.env.local`（本地）+ `.env.example`（模板） |
| ⚠️ **`.gitignore` 缺陷** | `.gitignore:35` 的 `.env*` 把 **`.env.example` 也忽略了** → Phase 9.3 创建的 `.env.example` **从未入库**（模板缺失） |
| `.env.local` 变量总数 | **83** |
| **代码 0 引用**（全仓库核对后） | **14**（其中 9 个纯废弃，见 §3） |
| `.env.example` 缺失（`.env.local` 有） | **21**（含 7 个在用 → 应补；10 个废弃 → 不补） |
| `.env.example` 独有 | 2（`AI_PROVIDER`、`NEXT_PUBLIC_TWITTER_HANDLE`）✅ |
| **Secret 泄漏检查** | ✅ **无**（`NEXT_PUBLIC_*` 中只有 `SUPABASE_ANON_KEY` / `TURNSTILE_SITE_KEY`，均设计为公开） |
| Config 模块 | `src/config/{billing,credits}.ts` —— **纯配置，无 `process.env`** ✅ |
| 空目录 | `src/lib/config/` **（0 文件）** → 应删 |
| 遗留脚本 | `check-payment-config.js`（硬编码 mock，引用已删配置）、`setup-database.sql`（被 migrations 取代） |
| `package.json` 缺陷 | `setup:env` 引用不存在的 `env.example`（实际是 `.env.example`） |

---

## 1. env 文件现状

```
.env.local     83 个变量（本地开发用，含真实占位值）
.env.example   新建于 Phase 9.3，分组注释：CORE / STORAGE / BILLING / PRODUCT / OPTIONAL
```

`.env.example` 独有（`AI_PROVIDER`、`NEXT_PUBLIC_TWITTER_HANDLE`）→ 属示例补充，合理。

---

## 2. 变量分类（Core / Billing / Product / Optional）

### Core
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` ·
`NEXTAUTH_URL` · `NEXTAUTH_SECRET` · `NEXTAUTH_COOKIE_DOMAIN` ·
`AI_PROVIDER` · `IMAGE_GENERATION_PROVIDER` · `FAL_KEY` · `KIE_*` · `ATLASCLOUD_*` · `WAVESPEED_*` ·
`R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET_NAME` · `R2_PUBLIC_URL` ·
`AUTH_GITHUB_*` · `GOOGLE_ID` · `GOOGLE_SECRET` · `NEXT_PUBLIC_AUTH_*`

### Billing
`STRIPE_PRIVATE_KEY` · `STRIPE_PUBLIC_KEY` · `STRIPE_WEBHOOK_SECRET` · `NEXT_PUBLIC_ENABLE_STRIPE` ·
`CREEM_API_KEY` · `CREEM_API_URL` · `CREEM_WEBHOOK_SECRET` · `NEXT_PUBLIC_ENABLE_CREEM` ·
`NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER`

### Product
`NEXT_PUBLIC_PROJECT_NAME` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_WEB_URL` ·
`NEXT_PUBLIC_API_BASE_URL` · `NEXT_PUBLIC_CDN_URL` · `NEXT_PUBLIC_SUPPORT_EMAIL` ·
`NEXT_PUBLIC_GITHUB_REPO_URL` · `NEXT_PUBLIC_{X,TWITTER,PINTEREST}_URL` · `NEXT_PUBLIC_TWITTER_HANDLE`

### Optional
analytics（`NEXT_PUBLIC_{GOOGLE_ANALYTICS_ID,CLARITY_PROJECT_ID,PLAUSIBLE_DOMAIN,OPENPANEL_CLIENT_ID,CUSTOM_ANALYTICS_*}`）·
`GOOGLE_SITE_VERIFICATION` · `NEXT_PUBLIC_ENABLE_TURNSTILE` · `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ·
`TURNSTILE_SECRET_KEY` · `NEXT_PUBLIC_ENABLE_CONTENT_SAFETY` · `OPENAI_API_KEY` ·
`ENABLE_DEBUG_ROUTES` · `ENABLE_VERBOSE_LOGS` · `ADMIN_EMAILS` · `NEXT_PUBLIC_PAY_CANCEL_URL`

---

## 3. 0 引用的变量（全仓库核对）

| 变量 | 命中 | 判定 | 建议 |
|---|---|---|---|
| `PAYMENT_VALIDATION_SECRET` | 0 | 曾属已删的 `payment-security.ts` | 🗑 **删** |
| `NEXT_PUBLIC_ENABLE_R2` | 0 | 记忆记载已废弃（用 `StorageService.isConfigured()`） | 🗑 **删** |
| `R2_CUSTOM_DOMAIN` | 0 | 被 `R2_PUBLIC_URL` 取代 | 🗑 **删** |
| `API4AI_API_KEY` | 0 | 无任何 Provider 使用 | 🗑 **删** |
| `GOOGLE_CLOUD_VISION_API_KEY` | 0 | 内容安全已走 OpenAI / 内置 | 🗑 **删** |
| `AZURE_CONTENT_SAFETY_ENDPOINT` / `_KEY` | 0 | 内容安全未使用 Azure | 🗑 **删** |
| `IPAPI_KEY` | 0 | 无 IP 地理查询代码 | 🗑 **删** |
| `RUNWAY_API_KEY` / `SEGMIND_API_KEY` | 0 | 无对应 Provider | 🗑 **删** |
| `SMTP_HOST/PORT/USER/PASS` | 0 | 无邮件发送代码 | 🗑 **删** |
| `NEXT_PUBLIC_DEFAULT_THEME` | 0 | 无主题切换逻辑 | 🗑 **删** |
| `NEXT_PUBLIC_DEMO_IMAGES_URL` | 0 | 仅 `_VIDEOS_URL` 被 `next.config.js` 用 | 🗑 **删** |
| `NODE_ENV` | 32 | Next 运行时注入，**不应写在 `.env.local`** | ⚠️ 从 `.env.local` 移除 |

**在用但 `.env.example` 缺失（应补）**：
`ADMIN_EMAILS` · `ENABLE_DEBUG_ROUTES` · `NEXT_PUBLIC_DEMO_VIDEOS_URL` · `NEXT_PUBLIC_PAY_CANCEL_URL` ·
`OPENAI_API_KEY` · `STRIPE_PUBLIC_KEY` · `WAVESPEED_WEBHOOK_SECRET`

**间接使用（保留）**：
`NEXTAUTH_SECRET`（next-auth 内部读取）· `DATABASE_URL`（仅 README 文档提及，代码未用 → 建议标注为「可选/工具链」）

---

## 4. Config 模块

| 模块 | 内容 | 是否读 env | 判定 |
|---|---|---|---|
| `src/config/billing.ts` | 套餐 / 价格（`priceMinor`）/ 渠道产品 id | ❌ 纯数据 | ✅ 正确（价格 SSOT） |
| `src/config/credits.ts` | 模型 → 积分成本 | ❌ 纯数据 | ✅ 正确（积分 SSOT） |
| `src/lib/config/` | **空目录（0 文件）** | — | 🗑 **删** |

**结论**：Config 层职责清晰（纯数据 + 派生函数），**没有**「业务代码到处直接读 env」的混乱 —— 
env 读取集中在：`site-config.ts`、`lib/ai/providers/*`、`lib/billing/providers/*`、`lib/storage/providers/r2.ts`、
`lib/auth.ts`、`proxy.ts`、`lib/content-safety/safe-mode.ts`。

---

## 5. Secret 与 `NEXT_PUBLIC_*`

✅ **无泄漏**。`NEXT_PUBLIC_*` 中含 `KEY` 的只有：
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` —— Supabase 设计为可公开（受 RLS 保护）
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` —— Turnstile 站点密钥，设计为公开

真正的 secret（`SUPABASE_SERVICE_ROLE_KEY` / `*_SECRET` / `*_PRIVATE_KEY` / `*_API_KEY`）**均未加 `NEXT_PUBLIC_` 前缀**。✅

---

## 6. 历史残留（Flux / ShipAny / 旧模板）

| 项 | 位置 | 判定 |
|---|---|---|
| `env.example`（无点前缀）被 `setup:env` 引用 | `package.json` | ⚠️ **路径错误**（实际是 `.env.example`） |
| `scripts/check-payment-config.js` | 87 行，**硬编码 mock** `PAYMENT_CONFIG`，引用已删的支付配置 | 🗑 遗留 |
| `scripts/setup-database.sql` | 184 行，被 `supabase/migrations/` 取代 | 🗑 遗留 |
| `src/app/api/user/ensure/route.ts` | 2 处错误提示仍指向 `scripts/setup-database.sql` | ⚠️ 过期建议 |
| 无 `FLUX_*` / `SHIPANY_*` env | — | ✅ 已无 |

---

## 7. 建议执行清单

0. ⚠️ **修复 `.gitignore`**：`.env*` → 改为忽略 `.env*` 但 `!.env.example`
   （否则模板里的环境变量示例不会被提交）
1. `.env.example`：补 7 个在用变量；移除废弃项；`DATABASE_URL` 标注「可选」
2. `.env.local`：移除 14 个 0 引用变量 + `NODE_ENV`（本地文件，不入库）
3. 删除空目录 `src/lib/config/`
4. 修复 `package.json` 的 `setup:env`（`env.example` → `.env.example`）
5. 删除遗留脚本 `check-payment-config.js`（及对应 npm script）；`setup-database.sql` 处理见 §8 问题
6. 修正 `user/ensure/route.ts` 的过期建议文案
7. 新增 `scripts/audit-env.mjs`：校验「`.env.example` ⊆ 代码使用」与「代码使用 ⊆ `.env.example`」
8. 文档 + 校验（lint / build / verify 全套 / audit）

## 8. 需你确认的问题

1. **`setup-database.sql` 是否删除？** 它已被 `supabase/migrations/` 取代，但 `user/ensure/route.ts`
   的错误提示仍引用它。删除需同步改提示文案。
2. **`.env.local` 是否清理？** 它是本地文件（通常 git 忽略），清理只影响本机。
   若你的部署依赖它，我改为只输出「建议删除清单」不动文件。
3. **`DATABASE_URL` 是否保留？** 代码 0 引用，README 建议配置（工具链/排错）。
4. **`NEXT_PUBLIC_ENABLE_CREEM` 是否保留？** 仅 `check-config.js` 与 README 提及，App 运行时不用
   （Creem 启用由 `CREEM_API_URL + CREEM_API_KEY` 是否配置决定）。

## 9. 本阶段不做
不改数据库 schema、不重构 Config 结构、不新增产品、不动 Billing/AI/Storage/Auth 实现。
