# Phase 6.5 Follow-ups

> 超出 Phase 6.5 范围、但已识别的问题。后续阶段按需处理。
> 最后更新：2026-09-25

---

## 状态总览

| ID | 项 | 状态 | 优先级 |
|---|---|---|---|
| F6.5-1 | Admin 用户角色管理 UI | ⬜ 未做（**Phase 6.5 §41 明确禁止**，待你授权） | 🟡 中 |
| F6.5-2 | Admin 审计日志独立页面 | ✅ 已完成 | — |
| F6.5-3 | 缺少 toast 组件 | ⬜ 未做（改用内联提示） | 🟢 低 |
| F6.5-4 | Dashboard 图表 | ⬜ 未做（规格 §42 明确不做） | 🟢 低 |
| F6.5-5 | Admin Settings / System Configuration | ⬜ 未做（规格 §43 明确不做） | 🟢 低 |
| F6.5-6 | 旧 Admin 路由的领域归属 | ⬜ 未做（Phase 8 决定） | 🟢 低 |
| F6.5-7 | Admin 订单/订阅/流水按 email 搜索 | ✅ 已完成（含 credits 一致性收尾） | — |
| F6.5-8 | AI Task 无 prompt 搜索 | ⬜ 未做 | 🟢 低 |
| F6.5-9 | Admin API 无限流 | ⬜ 未做 | 🟢 低 |
| F6.5-10 | 审计日志未覆盖 role 变更 | ⬜ 阻塞于 F6.5-1 | 🟢 低 |

**统计**：2 项完成 · 8 项未做（其中 3 项因规格明确禁止、1 项阻塞于 F6.5-1、4 项低优先级）

**唯一需要你决策的**：**F6.5-1** —— 它是 F6.5-10 的前置，且是你自己在
Phase 6.5 §41 里划为「留到后续版本」的。其余项都是低优先级优化，无阻塞。

---

## Admin

### F6.5-1：Admin 用户角色管理 UI

**现状**：增加管理员只能通过 `ADMIN_EMAILS` bootstrap 或直接改数据库。

**未做原因**：**Phase 6.5 规格 §41 明确要求不做** ——
> 不要做：Admin UI 修改其他用户 role。因为这会涉及权限提升 / 审计 / 安全边界，留到后续版本。

**解决方向**（若获授权）：
1. 独立页面 `/admin/users/[id]/role`
2. 强制审计（`action = 'role_change'`）
3. 禁止自我降级 / 禁止最后一个 admin 降级
4. 可能需要二次确认

**优先级**：🟡 中 · 需你明确授权

---

### F6.5-2：Admin 审计日志独立页面

**原现状**：审计日志只在用户详情页内展示（最近 20 条）。

**✅ 处理方式（2026-09-25）**：

1. 新增 `GET /api/admin/audit-logs`（经 `withAdmin()`，分页）
2. 新增 `/admin/audit-logs` 页面：展示 action / admin / target / amount / reason / created
3. 侧边栏加入口
4. admin / target 均链接到对应用户详情页
5. 页面**不直接访问数据库**（走 `AdminService`）

**验证**：`verify-admin.ts` 新增 4 项守卫 → **46 项**。

**当前状态**：✅ 已完成

**备注**：暂未做「按 action / admin / target 过滤」的 UI 控件
（`AdminService.listAuditLogs` 已支持这两个参数，接 UI 即可）。

**优先级**：✅ 已关闭

---

### F6.5-3：缺少 toast 组件

**现状**：项目未安装 toast 库（sonner / react-hot-toast）。

**处理**：积分发放表单改用**内联成功/错误提示**，未引入新依赖（避免超出阶段范围）。

**解决方向**：如需统一 toast，在专门的 UI 阶段引入。

**优先级**：低

---

### F6.5-4：Dashboard 图表

**现状**：`/admin` 只有简单计数。

**未做原因**：Phase 6.5 明确不做图表 / 趋势 / BI。

**优先级**：低 · 需明确需求后单独排期

---

### F6.5-5：Admin Settings / System Configuration

**现状**：未实现。

**未做原因**：Phase 6.5 明确禁止把 env / config 暴露给 Admin。

**备注**：旧路由 `/api/admin/payment-config` 仍存在（Phase 4 遗留），
本阶段只把它迁移到 role 鉴权，**未**把它接入新的 Admin UI。

**优先级**：低 · 后续 System Configuration 阶段

---

### F6.5-6：旧 Admin 路由的领域归属

**现状**：
- `/api/admin/maintenance` → 依赖 `src/lib/tasks/order-cleanup.ts`
- `/api/admin/payment-config` → 依赖 `src/lib/services/payment-config.ts`

这两个依赖在 Phase 4 已被标记为待清理（P4-T10 deferred）。

**解决方向**：在 Phase 8 清理阶段决定删除或迁移。

**优先级**：低

---

## Data

### F6.5-7：Admin 订单/订阅/流水的用户搜索

**原现状**：订单与订阅列表支持 status / provider 过滤，但**不支持按 email 搜索用户**。

**原因**：`orders` 有 `customer_email` 列可直接搜；但 `subscriptions` 与
`credit_transactions` 表**都没有 email 列**，只能先按 email 查出 user id 列表
再过滤（`user_id IN (...)`）。

**✅ 处理方式（2026-09-25）**：

1. **订单**：`OrderQuery` 新增 `search`，匹配 `customer_email` 或 `order_number`
   （`ilike` 模糊，大小写不敏感）
2. **订阅 / 积分流水**：`listAll` / `count` 新增 `userIds?: string[]`
   - **空数组显式短路返回空**，避免 `IN ()` 退化成「查全部」
3. **AdminService**：新增 `resolveUserIdsBySearch()` —— 先按 email/name 查 users
   拿 id 列表（上限 `MAX_SEARCH_USERS = 200`），再传给订阅 / 流水查询
4. **API**：`/api/admin/{orders,subscriptions,credits}` 均接受 `search` 参数
5. **UI**：三个列表页的过滤栏新增搜索输入框，分页链接保留 `search`

**验证**：`verify-admin.ts` 新增 11 项守卫 → **46 项**。

**当前状态**：✅ 已完成（含 credits 一致性收尾）

**备注**：`/admin/credits` 原先的 `userId`（手输 UUID）过滤框已移除 ——
`search` 已覆盖该场景，且手输 UUID 体验差。

**优先级**：✅ 已关闭

---

### F6.5-8：AI Task 无 prompt 搜索

**现状**：AI 任务列表可按 provider / model / status 过滤，不支持按 prompt 搜索。

**优先级**：低

---

## Security

### F6.5-9：Admin API 无限流

**现状**：`/api/admin/*` 未接入 `src/proxy.ts` 的限流（限流只覆盖 `/api/` 前缀的部分路径）。

**评估**：Admin 是受信任身份，风险较低，但列表接口仍可能被滥用。

**优先级**：低

---

### F6.5-10：审计日志未覆盖 role 变更

**现状**：`admin_audit_logs` 当前只记录 `credit_grant`。

**原因**：Phase 6.5 未实现 role 变更功能（见 F6.5-1）。

**优先级**：与 F6.5-1 一起处理
