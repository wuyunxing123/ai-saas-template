/**
 * Flux Kontext 的用户分层与档位能力（Phase 9.8.2-C 起属**产品层**）
 *
 * 原先在 `src/lib/user-tiers.ts`：机制（`UserType` / `UserLimits` / 查询函数）与
 * Flux 的档位数据（`modelsAllowed: ['pro','max']`、13 个宽高比、$29.90 派生的展示价）
 * 混在 Core 目录里，而 `src/lib` 根目录不在任何守卫的 CORE_DIRS 名单内 ——
 * 「Core 不写死 pro/max」这条约束当时既没有归属也没有检查。
 *
 * 现在：整份文件归 Flux 产品。宽高比来自 `capabilities.ts`（与 fal 的 `image_size`
 * 映射同一张表），展示价来自 `billing.ts`（与 checkout 实际金额同一份数据）。
 *
 * ⚠️ 本文件必须保持**客户端安全**：不得 import Provider 引擎（`node:crypto`）
 *    或任何走 `getProductConfig()` 的 Core 查询模块 —— 客户端没有绑定状态。
 *    展示价因此读 `FLUX_BILLING_PACKAGES` 字面量：它与绑定后的配置是**同一个对象**
 *    （`config.ts` 直接引用），不存在第二份数字。
 */

import { FLUX_ASPECT_RATIOS } from '@/lib/products/flux-kontext/capabilities'
import { FLUX_BILLING_PACKAGES } from '@/lib/products/flux-kontext/billing'

export enum UserType {
  ANONYMOUS = 'anonymous',
  REGISTERED = 'registered', 
  PREMIUM = 'premium'
}

export interface UserLimits {
  maxImages: number
  modelsAllowed: string[]
  aspectRatios: string[] | 'all'
  hourlyLimit: number
  requiresTurnstile: boolean | 'smart'
  storageRetention: number // 天数
  features: {
    batchGeneration: boolean
    privateMode: boolean
    historySync: boolean
    priorityQueue: boolean
    templates?: boolean
    favorites?: boolean
    apiAccess?: boolean
    commercialLicense?: boolean
  }
}

// 免费用户限制
export const freeUserLimits: UserLimits = {
  maxImages: 2,
  modelsAllowed: ['pro'],
  aspectRatios: 'all',
  hourlyLimit: 10,
  requiresTurnstile: true,
  storageRetention: 7,
  features: {
    batchGeneration: false,
    privateMode: false,
    historySync: false,
    priorityQueue: false
  }
}

// 注册用户限制
export const registeredUserLimits: UserLimits = {
  maxImages: 4,
  modelsAllowed: ['pro', 'max'],
  aspectRatios: 'all',
  hourlyLimit: 30,
  requiresTurnstile: 'smart',
  storageRetention: 30,
  features: {
    batchGeneration: false,
    privateMode: false,
    historySync: true,
    priorityQueue: false,
    templates: true,
    favorites: true
  }
}

// 付费用户限制
export const premiumUserLimits: UserLimits = {
  maxImages: 12,
  modelsAllowed: ['pro', 'max'],
  aspectRatios: 'all',
  hourlyLimit: Infinity,
  requiresTurnstile: false,
  storageRetention: Infinity,
  features: {
    batchGeneration: true,
    privateMode: true,
    historySync: true,
    priorityQueue: true,
    templates: true,
    favorites: true,
    apiAccess: true,
    commercialLicense: true
  }
}

// 获取用户限制
export const getUserLimits = (userType: UserType): UserLimits => {
  switch (userType) {
    case UserType.ANONYMOUS:
      return freeUserLimits
    case UserType.REGISTERED:
      return registeredUserLimits
    case UserType.PREMIUM:
      return premiumUserLimits
    default:
      return freeUserLimits
  }
}

// 图片数量选项
export const getImageCountOptions = (userType: UserType) => {
  const limits = getUserLimits(userType)
  const baseOptions = [
    { value: 1, label: "1 image", premium: false },
    { value: 2, label: "2 images", premium: false }
  ]
  
  if (limits.maxImages >= 3) {
    baseOptions.push({ value: 3, label: "3 images", premium: false })
  }
  
  if (limits.maxImages >= 4) {
    baseOptions.push({ value: 4, label: "4 images", premium: false })
  }
  
  // 付费用户专享选项
  if (userType === UserType.PREMIUM) {
    baseOptions.push(
      { value: 6, label: "6 images 👑", premium: true },
      { value: 8, label: "8 images 👑", premium: true },
      { value: 12, label: "12 images 👑", premium: true }
    )
  }
  
  return baseOptions
}

// 模型选择权限
export const getAvailableModels = (userType: UserType) => {
  const limits = getUserLimits(userType)
  return limits.modelsAllowed
}

// 宽高比选项权限
//
// 直接来自产品的能力表（`capabilities.ts`）—— UI 能选的比例与服务端能映射的比例
// 从此是同一份数据，不会再出现「UI 给了 5:4，fal 悄悄变成 4:3」。
export const getAvailableAspectRatios = (_userType: UserType) => {
  return FLUX_ASPECT_RATIOS.map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.icon,
    premium: false,
  }))
}

// 检查功能权限
export const hasFeature = (userType: UserType, feature: keyof UserLimits['features']): boolean => {
  const limits = getUserLimits(userType)
  return limits.features[feature] || false
}

// 检查是否需要升级提示
export const needsUpgrade = (userType: UserType, requestedImages: number): boolean => {
  const limits = getUserLimits(userType)
  return requestedImages > limits.maxImages
}

// 获取升级建议
export const getUpgradeSuggestion = (userType: UserType, feature?: string) => {
  switch (userType) {
    case UserType.ANONYMOUS:
      return {
        title: "Sign Up for Free",
        description: "Unlock Max model, more images and history features",
        action: "Sign Up Free",
        nextTier: UserType.REGISTERED
      }
    case UserType.REGISTERED:
      return {
        title: "Upgrade to Premium",
        description: "Unlock batch generation, private mode and unlimited usage",
        action: "Upgrade Premium",
        nextTier: UserType.PREMIUM
      }
    case UserType.PREMIUM:
      return null
  }
}

// 定价方案（**展示用**）
//
// 价格与积分从产品套餐表 `billing.ts` 派生 —— 与 checkout 实际收的金额、
// 履约发放的积分是同一份数据。旧实现硬编码 $29 / $290，与套餐的 $29.90 / $299
// 不一致，会造成「展示价 ≠ 实际扣款价」。
const PRO_MONTHLY = FLUX_BILLING_PACKAGES.pro_monthly
const PRO_YEARLY = FLUX_BILLING_PACKAGES.pro_yearly

/** 最小单位（美分）→ 展示金额（美元）。 */
function displayPrice(pkg: { priceMinor: number }): number {
  return pkg.priceMinor / 100
}

/** 最小单位 → 展示字符串。本地实现，避免把 Core 查询模块带进客户端模块图。 */
function priceLabel(pkg: { priceMinor: number }): string {
  const major = Math.trunc(pkg.priceMinor / 100)
  const minor = String(Math.abs(pkg.priceMinor % 100)).padStart(2, '0')
  return `$${major}.${minor}`
}

/**
 * 年付相对月付的折扣百分比与赠送月数（都按套餐实算）。
 *
 * 旧实现把「Save 20%」写死，定价页内容 JSON 又写「Save 25%」，features 里再写
 * 「3 extra months free」—— 同一概念三个数字，而按套餐实算是 17% / 2 个月。
 * 这里改成派生，文案不再自己发明数字。
 */
function yearlySavePercent(): string {
  return `Save ${Math.round((1 - PRO_YEARLY.priceMinor / (PRO_MONTHLY.priceMinor * 12)) * 100)}%`
}

/** 年付相当于按月付价格买了几个月的量 → 多出来的月数。 */
function extraMonthsFree(): number {
  return 12 - Math.round(PRO_YEARLY.priceMinor / PRO_MONTHLY.priceMinor)
}

export const pricingPlans = {
  monthly: {
    price: displayPrice(PRO_MONTHLY),
    priceLabel: priceLabel(PRO_MONTHLY),
    currency: PRO_MONTHLY.currency,
    period: 'month',
    credits: PRO_MONTHLY.credits,
    features: [
      'Batch generation 1-12 images',
      'Private Mode for personal use',
      'Priority queue for fast generation',
      'Unlimited usage frequency',
      'Permanent image storage',
      'Commercial license included',
      'API developer access',
      'Dedicated customer support'
    ]
  },
  yearly: {
    price: displayPrice(PRO_YEARLY),
    priceLabel: priceLabel(PRO_YEARLY),
    currency: PRO_YEARLY.currency,
    period: 'year',
    credits: PRO_YEARLY.credits,
    discount: yearlySavePercent(),
    features: [
      'All monthly features included',
      `${extraMonthsFree()} extra months free`,
      'Early access to new features',
      'Exclusive community access'
    ]
  }
}

// 模拟用户状态（实际应该从后端获取）
export const getCurrentUserType = (): UserType => {
  // 检查是否在浏览器环境
  if (typeof window === 'undefined') {
    return UserType.ANONYMOUS
  }
  
  try {
    // 检查用户登录状态（从localStorage或其他状态管理获取）
    const userSession = localStorage.getItem('user-session')
    if (userSession) {
      const session = JSON.parse(userSession)
      
      // 检查是否为付费用户
      if (session.isPremium || session.subscription?.status === 'active') {
        return UserType.PREMIUM
      }
      
      // 检查是否为注册用户
      if (session.user?.email) {
        return UserType.REGISTERED
      }
    }
    
    // 也可以检查NextAuth session
    // 这里可以添加更复杂的用户状态检测逻辑
    
  } catch (error) {
    console.warn('User status detection failed:', error)
  }
  
  // 默认返回匿名用户
  return UserType.ANONYMOUS
} 