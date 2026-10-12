# docs/archive — 模板遗留文档

> 归档时间：2026-09-25 · 归档数量：**55 个文件**（54 个 `.md` + 1 个 `.html`）
> · 2026-09-30 追加 1 份：`ARCHITECTURE.md`（Phase 1 架构分析快照，F9.7-15 裁决移入）

## 为什么在这里

这些文档来自本项目作为 **`flux-kontext-template`** 模板时期的原始资料，
包括中文教学指南、SEO 配置说明、部署迁移计划、历史分析报告等。

它们**不反映当前 `ai-saas-template` 的架构**，保留仅供历史参考。

**当前有效的文档在 [`docs/`](../) 目录（38 个 `.md`，截至 2026-09-29）**，
索引见 [`docs/README.md`](../README.md)，建议从
[`docs/MOTHER_TEMPLATE.md`](../MOTHER_TEMPLATE.md) 开始阅读。

## 归档内容分类

| 类别 | 数量 | 示例 |
|---|---|---|
| 中文教学 / 入门指南 | 9 | `小白完整入门指南.md`、`Next.js实战练习-从零到强者.md` |
| SEO 相关 | 5 | `SEO配置检查和优化指南.md`、`SEO页面架构和内链布局策略.md` |
| 部署 / 平台迁移 | 5 | `Vercel迁移实施指南.md`、`部署平台迁移计划-Netlify到Vercel.md` |
| Cloudflare Worker / 子域 | 4 | `api-worker-deployment-guide.md`、`worker-fal-proxy-guide.md` |
| fal.ai 集成历史 | 5 | `fal-ai-集成实施计划.md`、`FAL-API-Documentation.md` |
| 支付系统（旧架构） | 5 | `支付系统选择指南-CREEM-vs-STRIPE.md`、`PAYMENT_SECURITY_GUIDE.md` |
| 多语言 / SEO 报告 | 4 | `MULTILINGUAL_CANONICAL_STRATEGY.md`、`PAGES_CANONICAL_REPORT.md` |
| Auth / 用户分层 | 3 | `auth-system-guide.md`、`NextAuth学习指南.md`、`user-tiers.md` |
| 项目结构 / 配置说明 | 5 | `当前项目实际文件结构详解.md`、`项目配置检查和小白上手指南.md` |
| 其他分析 / 计划 / 记录 | 8 | `LOGIN_PAYMENT_ARCHITECTURE_REPORT.md`、`安全审查报告.md`、`fix-record.md` |

## 仍然可能有参考价值的几个

如果后续需要，可以单独取回：

- **`FAL-API-Documentation.md`** — fal.ai 接口文档摘录，做 Provider 时可能有用
- **`PAYMENT_SECURITY_GUIDE.md`** — 支付安全要点（当前 Billing 设计见 `docs/BILLING.md`）
- **`user-tiers.md`** — 用户分层设计（当前未实现，可能作为未来参考）
- **`网页结构可视化流程图.html`** — 原模板页面结构可视化

## 取回方式

```bash
git mv docs/archive/<文件名> docs/
```

## 删除建议

若确认不再需要，可直接删除整个 `docs/archive/` 目录
（全部内容都在 git 历史中，可随时恢复）。
