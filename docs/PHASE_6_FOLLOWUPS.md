# Phase 6 Follow-ups

> 超出 Phase 6 范围、但已识别的问题。后续阶段按需处理。

---

## Auth

### F-1：API 普遍通过 email 查询用户

**原现状**：大量 API 路由通过 `session.user.email` 查询用户：
- `src/app/api/ai/image/route.ts`
- `src/app/api/flux-kontext/route.ts`
- `src/app/api/upload/route.ts`
- `src/app/api/user/credits/route.ts`
- `src/app/api/user/ensure/route.ts`
- `src/app/api/user/credits/consume/route.ts`
- `src/lib/billing/session.ts`
- `src/lib/admin/authorization.ts`

**问题**：email 不是稳定主键，且每个请求多一次按 email 的查询。

**✅ 处理方式（2026-09-25）**：

1. 新建 **`src/lib/auth-session.ts`** —— 统一的「session → 业务用户」入口：
   - `getSessionIdentity()`：取原始 session 身份（不查库）
   - `getCurrentUser()`：**优先 `session.user.id`（主键）**，缺失时退回 email
   - `getCurrentUserId()`：便捷方法

   保留 email 兜底的原因：Phase 6 之前签发的 JWT 没有 `user.id`，
   `session.user.id` 会是空字符串。只认 id 会让老 session 突然 404。
   等老 session 自然过期后可删除兜底分支。

2. 上列 **8 个文件全部迁移**，改为调用共享 helper。
3. `src/lib/billing/session.ts` 的 `getBillingUser()` 改为委托（保留原签名）。
4. `src/lib/admin/authorization.ts` 的 `getAdminContext()` 改为委托
   （bootstrap 白名单仍用 email 比对，但身份加载走 id）。
5. `src/app/api/flux-kontext/route.ts` 的 PUT 上传：Storage key 的用户隔离
   从 email 改为 **user.id**（符合 Phase 5 的 key 规范）。
6. `src/app/api/user/credits/consume/route.ts` 顺带修掉**非原子扣减**
   （原先是「读余额 → 计算 → UPDATE」，属 B-11 模式）→ 改为 `consumeUserCredits()` 原子 RPC。

**验证**：`verify-auth.ts` 新增 6 项守卫 → **24 项**：
- `auth-session.ts` 提供两个入口且优先用主键
- 8 个活跃路由均不再按 `session.user.email` 查用户
- Admin 授权复用统一入口
- 积分消耗路由走原子 RPC

**优先级**：✅ 已关闭

---

### F-2：signin_* 遗留字段

**原现状**：`users` 表存在 `signin_type`, `signin_provider`, `signin_openid`,
`signin_ip`, `signin_count`, `last_signin_at`。原判断是「Phase 6 删除」。

**✅ 审计结论（2026-09-25）**：**不应删列**。逐字段核实后：

| 字段 | 实际状态 |
|---|---|
| `signin_provider` | **在用** —— Admin 用户列表/详情展示 |
| `last_signin_at` | **在用** —— Admin 用户列表/详情展示 |
| `signin_count` | 有维护（登录 +1），当前无展示 |
| `signin_type` | 有写入，**无任何读取** |
| `signin_openid` | 有写入，**无任何读取** |
| `signin_ip` | **恒为 `'unknown'`**，从未记录真实 IP |

删列会**破坏 Admin 的展示功能**（这是我刚交付的），且需要同步改 4 处建号逻辑，
收益低、风险高。因此**保留列**。

**✅ 实际处理（2026-09-25）**：

1. **删除 189 行死代码**（审计时发现的真正问题）：
   - `src/lib/services/user.ts`（169 行）—— `saveUser` / `getUserByUuid` /
     `getUserByEmail` 三个导出**全部零引用**（`saveUser` 在 `auth.ts` 里
     只有一个从未被使用的 import）
   - `src/lib/types/user.ts`（20 行）—— `User` / `UserSession` 仅被上面那个死文件引用；
     且其 `User` 接口与 `UserRow` 语义冲突，容易误导
2. **清理 `auth.ts` 的无用 import**：`saveUser`、`User`、`getClientIp`、`getIsoTimestr`
3. **停止写入无意义的 `signin_ip`**（`auth.ts` 与 `api/user/credits` 两处
   的 `signin_ip: 'unknown'`）。列保留（可空），不影响任何行为。
4. **在 `UserRow` 上加逐字段说明**，明确「不要把它们当可靠审计数据使用」。

**当前状态**：✅ 已处理（方式与原计划不同：删死代码而非删列）。

**优先级**：✅ 已关闭

---

### F-2b：若将来确实要删 `signin_*` 列

需要同时确认（当前**未**做）：
- Supabase Auth 是否依赖这些列
- 是否有 trigger / SQL function / RLS 引用
- 4 处建号逻辑（`auth.ts` signIn 回调、`api/user/credits`、`api/user/ensure`、debug 路由）
- Admin 页面移除「Last sign-in」「Sign-in provider」展示

**优先级**：🟢 低 · 无实际收益，不建议做

---

### F-3：admin 通过 env 硬编码邮箱

**现状**：`src/app/api/admin/*` 通过 `ADMIN_EMAILS` 环境变量判断管理员。

**问题**：
- 添加/移除管理员需要改 env + 重启服务
- 无法支持大量管理员
- 没有审计日志

**解决方向**：
1. Phase 6 已添加 `users.role` 字段
2. 后续 Admin 面板应通过 `role = 'admin'` 判断
3. 保留 `ADMIN_EMAILS` 作为启动时自动赋予 admin 角色的白名单（可选）

**优先级**：中 · Phase 6.5 Admin 阶段处理

---

### F-4：开发环境 backdoor（test@example.com）

**现状**：`src/lib/auth.ts:87-95` 存在开发环境测试账户。

**评估**：当前已有 `NODE_ENV === 'development'` 保护，生产环境不会触发。

**建议**：保留，但建议：
1. 添加更明显的日志标记（已存在 console.log）
2. 文档中说明此 backdoor 仅限开发

**优先级**：低 · 无需处理

---

### F-5：地理位置检测硬编码为 "US"

**现状**：`src/lib/auth.ts:370` 和 `src/lib/services/user.ts:165` 中 `detectUserLocation()` 直接返回 "US"。

**问题**：`location` 字段实际未生效，但 `preferred_currency` 和 `preferred_payment_provider` 会根据 location 设置。

**解决方向**：
1. 集成真实 IP 地理位置服务（如 ipapi.co）
2. 或移除自动设置逻辑，让用户手动选择

**优先级**：低 · 建议 Phase 7+ 处理

---

## Template Cleanup

### F-6：多语言页面中的 Flux 品牌残留

**现状**：`src/app/ar/page.tsx`、`src/app/zh/page.tsx`、`src/app/tr/page.tsx` 等仍包含 "Flux Kontext" 品牌名。

**解决方向**：
1. 替换为通用品牌占位符（如 "AI Platform"）
2. 或提取到配置文件中

**优先级**：低 · Phase 8 或模板最终打磨阶段处理

---

### F-7：前端组件中的 Flux 引用

**现状**：`src/components/FluxKontextGenerator.tsx` 等组件名称仍含 Flux。

**评估**：这些是业务组件，属于 Phase 8（Flux Business Decoupling）的范围。

**优先级**：低 · Phase 8 处理

---

### F-8：SEO / Metadata 中的 Flux

**现状**：`src/app/layout.tsx`、`src/app/page.tsx` 等仍含 Flux 品牌。

**解决方向**：
1. 替换为通用描述
2. 或使用环境变量配置 `NEXT_PUBLIC_APP_NAME`

**优先级**：低 · Phase 8 或模板最终打磨阶段处理

---

## Security

### F-9：debug 路由在生产环境的风险

**现状**：`src/proxy.ts` 通过 `ENABLE_DEBUG_ROUTES` 和 `NODE_ENV !== 'production'` 双重控制 debug 路由。

**评估**：当前已有双重保护，风险可控。

**建议**：
1. 确保 production build 中 `ENABLE_DEBUG_ROUTES` 默认 false
2. 文档中明确说明

**优先级**：低 · 已足够安全

---

### F-10：User-Agent 硬编码

**现状**：多处代码使用 `'User-Agent': 'FluxKontext/1.0'`（如 `src/app/api/flux-kontext/route.ts`）。

**评估**：对外部 API 调用无实质安全影响，但暴露了产品名称。

**优先级**：极低 · 可选清理

---

## Data / Region

### F-11：`payment/router.ts` 把 HK / TW 当作独立国家（B-17）

> Phase 6 §8 要求记录，文档巡检时补录，**2026-09-25 已修复**。

**原现状**：`src/lib/payment/router.ts:44`

```ts
country: ["JP", "KR", "SG", "HK", "TW", "MY", "TH"],
```

**问题**：
- 中国香港（HK）、中国台湾（TW）在该列表中与主权国家并列
- `country` / `region` / `locale` / `currency` 四个概念在项目中存在混用

**✅ 修复方式（2026-09-25）**：

该文件经核实是**死代码** —— 全项目唯一被使用的只有末尾的
`formatAmountForProvider()`（被 `billing/providers/{creem,stripe}.ts` 引用），
其余导出（`getUserLocation` / `selectPaymentProvider` / `getPaymentConfig` /
`getRecommendedProviderByCurrency` / `parseAmountFromProvider`）零引用。

处理：
1. 把 `formatAmountForProvider()` / `parseAmountFromProvider()` 抽到
   **`src/lib/payment/amount.ts`**（纯单位换算，无地区逻辑）
2. `creem.ts` / `stripe.ts` 的 import 改为 `./amount`
3. **删除 `src/lib/payment/router.ts`**（248 行）—— 问题代码随之消失

**当前状态**：✅ 已修复。`verify-billing.ts` 新增守卫：
- `payment/router.ts` 不得重新出现
- 全 `src/` 不得存在 `country: [..., "HK"|"TW"|"MO", ...]` 形式的国家列表

**遗留提醒（面向未来）**：
若后续真的需要按地区路由支付渠道，必须：
- 使用**业务分区**（如 `APAC`）而非主权国家列表
- 面向用户的文案中，HK / MO / TW 必须表述为**中国香港 / 中国澳门 / 中国台湾**

**优先级**：✅ 已关闭

---

### F-12：`bcryptjs` 成为未使用依赖

> 本次文档巡检（B-7 修复）后发现。

**现状**：`bcrypt` 原先只在 `src/app/api/auth/register/route.ts` 使用。
B-7 修复移除了该处密码处理，因此 `bcryptjs` 现在**全项目无引用**。

**解决方向**：在依赖清理阶段从 `package.json` 移除（会同时改动 lockfile）。

**优先级**：低 · 属依赖清理，不在文档巡检范围内

---

## Docs

### F-13：`docs/` 目录包含大量模板遗留教学文档

> D-8 原计划在 Phase 6 处理。**2026-09-25 已处理。**

**原现状**：`docs/` 共 **65 个文件**，其中约 **50 个**属于原模板遗留：

| 类别 | 数量（约） | 示例 |
|---|---|---|
| 中文教学/入门指南 | 15 | `小白完整入门指南.md`、`Next.js实战练习-从零到强者.md` |
| SEO 相关 | 6 | `SEO配置检查和优化指南.md`、`SEO页面架构和内链布局策略.md` |
| 部署/平台迁移 | 7 | `Vercel迁移实施指南.md`、`部署平台迁移计划-Netlify到Vercel.md` |
| Cloudflare Worker | 4 | `api-worker-deployment-guide.md`、`worker-fal-proxy-guide.md` |
| fal 集成历史 | 5 | `fal-ai-集成实施计划.md`、`FAL-API-Documentation.md` |
| 其他分析报告 | 10 | `LOGIN_PAYMENT_ARCHITECTURE_REPORT.md`、`安全审查报告.md` |

**✅ 处理方式（2026-09-25）**：

1. 先用 `grep` 核实代码**不引用**任何遗留文档
   （代码只引用 `docs/BILLING.md` / `docs/DATABASE.md` / `docs/DATABASE_AUDIT.md`，
   三者都保留）
2. 用 `git mv` 把 **53 个**遗留文件移入 **`docs/archive/`**（保留 git 历史，可逆）
3. `docs/` 只保留 **14 个**当前有效文档
4. 新建 `docs/archive/README.md` 说明归档内容、分类、取回方式，
   并标注 4 个「仍可能有参考价值」的文件

**当前状态**：✅ 已完成。`docs/` 14 个有效文档 + `docs/archive/` 53 个历史文档。

**优先级**：✅ 已关闭

---

### F-14：`ARCHITECTURE.md` 附录 A 是 Phase 1 快照

> 本次巡检发现。

**现状**：`docs/ARCHITECTURE.md` 的附录 A 列出 B-1 ~ B-21 缺陷清单，
但**未标注哪些已修复**。经核对，其中多数已在 Phase 3 / 3.5 / 4 / 5 / 6 修复。

**解决方向**：在附录 A 增加「当前状态」列，或在 `PROJECT_STATUS.md` 中统一给出缺陷状态表。

**处理**：本次巡检已在 `docs/PROJECT_STATUS.md` 中给出**完整缺陷状态表**，
`ARCHITECTURE.md` 附录 A 保留为 Phase 1 历史快照，并在顶部加注说明。

**优先级**：低 · 已完成（通过 PROJECT_STATUS.md）
