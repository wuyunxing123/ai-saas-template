/**
 * i18n 机制层（Phase 9.4）
 *
 * 职责：**只提供通用多语言能力** —— 语言清单、语言名/旗帜、路由前缀工具、文本方向、字体。
 *
 * 边界：
 *   · 本文件**不包含任何产品文案**（产品文案见 `@/lib/products/<name>/content`）。
 *   · Core（`lib/seo`、`app/robots`、`app/sitemap` 等）只依赖本文件。
 */

// 支持的语言列表 - 16 种语言
export const SUPPORTED_LOCALES = [
  'en',  // English
  'zh',  // 中文 (默认)
  'de',  // Deutsch
  'es',  // Español
  'fr',  // Français
  'it',  // Italiano
  'ja',  // 日本語
  'ko',  // 한국어
  'nl',  // Nederlands
  'pl',  // Polski
  'pt',  // Português
  'ru',  // Русский
  'tr',  // Türkçe
  'ar',  // العربية
  'hi',  // हिन्दी
  'bn'   // বাংলা
] as const

export type SupportedLocale = typeof SUPPORTED_LOCALES[number]

// 默认语言
export const DEFAULT_LOCALE: SupportedLocale = 'zh'

// 语言显示名称
export const LOCALE_NAMES = {
  'en': 'English',
  'zh': '中文',
  'de': 'Deutsch',
  'es': 'Español',
  'fr': 'Français',
  'it': 'Italiano',
  'ja': '日本語',
  'ko': '한국어',
  'nl': 'Nederlands',
  'pl': 'Polski',
  'pt': 'Português',
  'ru': 'Русский',
  'tr': 'Türkçe',
  'ar': 'العربية',
  'hi': 'हिन्दी',
  'bn': 'বাংলা'
} as const

// 语言标志
export const LOCALE_FLAGS = {
  'en': '🇺🇸',
  'zh': '🇨🇳',
  'de': '🇩🇪',
  'es': '🇪🇸',
  'fr': '🇫🇷',
  'it': '🇮🇹',
  'ja': '🇯🇵',
  'ko': '🇰🇷',
  'nl': '🇳🇱',
  'pl': '🇵🇱',
  'pt': '🇵🇹',
  'ru': '🇷🇺',
  'tr': '🇹🇷',
  'ar': '🇸🇦',
  'hi': '🇮🇳',
  'bn': '🇧🇩'
} as const

/**
 * 检查是否为支持的语言
 * @param locale 语言代码
 * @returns 是否支持该语言
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return SUPPORTED_LOCALES.includes(locale as SupportedLocale)
}

/**
 * 从URL路径中提取语言代码
 * @param pathname URL路径
 * @returns 语言代码
 */
export function getLocaleFromPathname(pathname: string): SupportedLocale {
  const segments = pathname.split('/')
  const potentialLocale = segments[1]

  return isSupportedLocale(potentialLocale) ? potentialLocale : DEFAULT_LOCALE
}

/**
 * 生成带语言前缀的URL
 * @param path 路径
 * @param locale 语言代码
 * @returns 完整的URL路径
 */
export function getLocalizedPath(path: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  // 如果是默认语言，不添加前缀
  if (locale === DEFAULT_LOCALE) {
    return path
  }

  // 确保路径以/开头
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `/${locale}${cleanPath}`
}

/**
 * 移除路径中的语言前缀
 * @param pathname 完整路径
 * @returns 不带语言前缀的路径
 */
export function removeLocaleFromPathname(pathname: string): string {
  const segments = pathname.split('/')
  const potentialLocale = segments[1]

  if (isSupportedLocale(potentialLocale)) {
    return '/' + segments.slice(2).join('/')
  }

  return pathname
}

/**
 * 获取语言的文本方向 (LTR/RTL)
 * @param locale 语言代码
 * @returns 文本方向
 */
export function getTextDirection(locale: SupportedLocale): 'ltr' | 'rtl' {
  // 阿拉伯语使用从右到左的文本方向
  return locale === 'ar' ? 'rtl' : 'ltr'
}

/**
 * 获取语言的字体族
 * @param locale 语言代码
 * @returns CSS字体族
 */
export function getFontFamily(locale: SupportedLocale): string {
  switch (locale) {
    case 'zh':
      return '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
    case 'ja':
      return '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif'
    case 'ko':
      return '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
    case 'ar':
      return '"Noto Sans Arabic", "Tahoma", sans-serif'
    case 'hi':
      return '"Noto Sans Devanagari", "Mangal", sans-serif'
    case 'bn':
      return '"Noto Sans Bengali", "Vrinda", sans-serif'
    default:
      return 'system-ui, -apple-system, sans-serif'
  }
}
