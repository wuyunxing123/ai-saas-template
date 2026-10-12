/**
 * Flux Kontext 产品文案（Phase 9.4）
 *
 * 边界：这些是**产品专属**文案（首页 / 生成器 / 定价 / SEO）。
 * 通用模板文案（common / auth）在 Core 的 `@/lib/content`。
 *
 * 依赖方向：本模块可以依赖 Core 的 i18n 机制（`@/lib/content/locale`），
 * 但 **Core 不得反向依赖本模块**。
 */

import homeData from './home.json'
import generatorData from './generator.json'
import pricingData from './pricing.json'
import seoData from './seo.json'

export const home = homeData
export const generator = generatorData
export const pricing = pricingData
export const seo = seoData

// 向后兼容：旧 `@/lib/content` 曾直接导出这两个
export const footer = homeData.footer
export const twitterShowcase = homeData.twitterShowcase

export type HomeData = typeof homeData
export type GeneratorData = typeof generatorData
export type PricingData = typeof pricingData
export type SEOData = typeof seoData
