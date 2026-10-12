/**
 * 通用模板文案（Phase 9.4）
 *
 * 只包含与**具体产品无关**的文案：按钮 / 导航 / 表单 / 认证 / 通用错误。
 *
 * 产品专属文案（首页 / 生成器 / 定价 / SEO）在
 * `@/lib/products/<name>/content` —— Core 不得反向依赖它们。
 *
 * 多语言机制见 `@/lib/content/locale`。
 *
 * 变更说明（Phase 9.4）：
 *   · `home` / `generator` / `pricing` / `seo` / `footer` / `twitterShowcase`
 *     已迁到产品模块。
 *   · 删除死导出 `getContent` / `getText` / `getTextArray` / `moduleStats`（0 消费者）。
 */

import authData from './auth.json'
import commonData from './common.json'

export const auth = authData
export const common = commonData

export type AuthData = typeof authData
export type CommonData = typeof commonData
