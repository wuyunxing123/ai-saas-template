/**
 * 产品配置持有器（Phase 9.8.2-C）
 *
 * Core 提供**机制**，产品提供**数据**。本文件是这条分工的执行点：
 *
 *   Product（`src/lib/products/<id>/config.ts`）
 *     └── 导出 `ProductConfig`（模型 / Provider 实例 / 套餐 / 免费档）
 *   app 层装配点（`src/app/product-runtime.ts`）
 *     └── `bindProductConfig(fluxConfig)` —— 静态 import，模块求值时完成绑定
 *   Core 查询（`@/lib/ai/models`、`@/config/billing`、`@/lib/ai/providers`）
 *     └── `getProductConfig()` —— 未绑定就抛错，绝不回退到默认值
 *
 * 为什么不是「运行时注册表」：
 *   Next.js 按路由分包，任何「靠某个模块被 import 才会执行的副作用」都无法在所有路由里
 *   被证明一定发生。因此这里只有两种状态 —— **已绑定**（装配点被静态 import 到）
 *   或 **抛错**（装配点没接到）。不存在「注册了一半」或「用默认值继续跑」。
 *
 * 为什么不是「Core 直接 import 产品目录」：
 *   那会让依赖方向反了（Core → Product），删除产品目录时 Core 直接编译不过 ——
 *   而「删掉产品后 Core 仍能编译」正是本母版要证明的性质。
 *
 * 依赖方向：本文件**不得** import `@/lib/products/**`（`verify-product-boundary.mjs` 检查）。
 * 只有 `import type` 指向 Core 自己的形状定义。
 */

import type { AIProvider, ModelDefinition } from '@/lib/ai/types'
import type { BillingCurrency, BillingPackage } from '@/config/billing'

/** 免费档：不经过 checkout，只用于注册赠送与展示。 */
export interface FreePlanDefinition {
  /** UI 与请求使用的稳定内部标识符（历史上叫 `basic`）。 */
  id: string
  name: string
  currency: BillingCurrency
  /** 必须是 0；非 0 说明它不是免费档。 */
  priceMinor: number
  /**
   * 注册时一次性赠送的积分。
   *
   * 全项目只有这一个「免费额度」数字：`src/lib/auth.ts` 的注册发放、
   * 定价页的免费档展示都读这里，不再各写一份。
   */
  welcomeCredits: number
}

/** 一个产品必须提供的完整配置。 */
export interface ProductConfig {
  /** 产品 id，用于错误信息与「同一进程只装一个产品」的判据。 */
  productId: string
  /** key = 模型 id，且必须与 `ModelDefinition.id` 一致。 */
  models: Record<string, ModelDefinition>
  /** Provider 实例；厂商映射表由产品数据注入，Core 类不认识具体模型。 */
  providers: readonly AIProvider[]
  /** key = packageId，且必须与 `BillingPackage.id` 一致。 */
  billingPackages: Record<string, BillingPackage>
  freePlan: FreePlanDefinition
}

let bound: ProductConfig | null = null

/** 绑定产品配置（由 app 层装配点调用；测试脚本同样通过它注入）。 */
export function bindProductConfig(config: ProductConfig): void {
  const errors = validateProductConfig(config)

  if (errors.length > 0) {
    throw new Error(
      `Product config for "${config.productId}" is incomplete (${errors.length} problem(s)):\n` +
        errors.map((e) => `  · ${e}`).join('\n')
    )
  }

  if (bound && bound.productId !== config.productId) {
    // 同一进程里换产品 = 路由分包状态不一致，必须显式失败而不是覆盖。
    throw new Error(
      `Cannot bind product "${config.productId}": "${bound.productId}" is already bound in this process. ` +
        'A single deployment serves exactly one product.'
    )
  }

  // 同产品重复绑定是**允许**的：`next dev` 改产品数据文件时只会重新求值接缝，
  // 而 `bound` 所在的这个模块不在失效图里 —— 拒绝它等于让开发服务器一改动就崩。
  // 完整性校验已经在上面跑过，所以「重新绑定」不可能装进半份配置。
  bound = config
}

/** 已绑定的产品配置。未绑定时抛错 —— 静默回退会把配置缺失伪装成正常运行。 */
export function getProductConfig(): ProductConfig {
  if (!bound) {
    throw new Error(
      'No product configuration is bound. ' +
        'Every server entry point that reaches AI / billing / model lookups must statically ' +
        'import the app-layer product seam (see docs/PRODUCT_GUIDE.md, "产品配置装配点").'
    )
  }

  return bound
}

/** 是否已绑定（供诊断 / 测试用，不用于业务分支）。 */
export function hasProductConfig(): boolean {
  return bound !== null
}

/** 当前绑定的产品 id；未绑定返回 null。 */
export function getBoundProductId(): string | null {
  return bound?.productId ?? null
}

/** 解绑（**仅测试用**：验证「未绑定必须抛错」时需要重置进程内状态）。 */
export function resetProductConfigForTests(): void {
  bound = null
}

// ─────────────────────────────────────────────────────────────────────
// 完整性校验
//
// 这段逻辑同时被 `bindProductConfig`（运行时）与 `scripts/verify-product-config.ts`
// （门禁）使用 —— 校验规则只有一份，避免「测试与运行时说法不一」。
// ─────────────────────────────────────────────────────────────────────

export function validateProductConfig(config: ProductConfig): string[] {
  const errors: string[] = []
  const where = (key: string) => `product "${config.productId}" / ${key}`

  if (!config.productId?.trim()) {
    errors.push('productId must be a non-empty string')
  }

  const providerNames = (config.providers ?? []).map((p) => p.name)
  const duplicateProviders = providerNames.filter(
    (name, index) => providerNames.indexOf(name) !== index
  )

  for (const name of new Set(duplicateProviders)) {
    errors.push(`${where('providers')}: duplicate provider name "${name}"`)
  }

  if (providerNames.length === 0) {
    errors.push(`${where('providers')}: at least one provider is required`)
  }

  // 模型声明 ⇄ Provider 端点表：**双向**一致。
  // 只做 `providers.length > 0` 之类的检查证明不了「声明能跑」。
  const models = config.models ?? {}
  const modelIds = Object.keys(models)

  if (modelIds.length === 0) {
    errors.push(`${where('models')}: at least one model is required`)
  }

  for (const [key, model] of Object.entries(models)) {
    const at = where(`models.${key}`)

    if (model.id !== key) {
      errors.push(`${at}: id is "${model.id}" but the key is "${key}"`)
    }

    if (!Number.isInteger(model.credits) || model.credits <= 0) {
      errors.push(`${at}.credits must be a positive integer, got ${JSON.stringify(model.credits)}`)
    }

    if (![0, 1, 'many'].includes(model.requiredInputImages)) {
      errors.push(`${at}.requiredInputImages must be 0 | 1 | "many", got ${JSON.stringify(model.requiredInputImages)}`)
    }

    if (!model.modality) {
      errors.push(`${at}.modality is missing`)
    }

    if (model.providers.length === 0) {
      errors.push(`${at}.providers is empty`)
    }

    for (const provider of model.providers) {
      if (!providerNames.includes(provider)) {
        errors.push(`${at}.providers declares "${provider}" but no such provider is bundled`)
      }
    }

    if (!model.providers.includes(model.defaultProvider)) {
      errors.push(`${at}.defaultProvider "${model.defaultProvider}" is not in its providers list`)
    }
  }

  for (const provider of config.providers ?? []) {
    const at = where(`providers.${provider.name}`)

    if (provider.models.length === 0) {
      errors.push(`${at} bundles no model — either map at least one endpoint or drop the provider`)
      continue
    }

    if (provider.modality !== 'image' && provider.modality !== 'video' && provider.modality !== 'audio' && provider.modality !== 'text') {
      errors.push(`${at}.modality is "${provider.modality}", not a supported kind`)
    }

    for (const modelId of provider.models) {
      const model = models[modelId]

      if (!model) {
        errors.push(`${at} maps model "${modelId}" but models.${modelId} is not declared`)
        continue
      }

      if (!model.providers.includes(provider.name)) {
        errors.push(
          `${at} maps model "${modelId}" but models.${modelId}.providers does not include "${provider.name}"`
        )
      }
    }

    for (const modelId of Object.keys(models)) {
      if (models[modelId].providers.includes(provider.name) && !provider.models.includes(modelId)) {
        errors.push(
          `models.${modelId}.providers includes "${provider.name}" but ${at} has no mapping for it`
        )
      }
    }
  }

  // 套餐
  const packages = config.billingPackages ?? {}
  const packageIds = Object.keys(packages)

  if (packageIds.length === 0) {
    errors.push(`${where('billingPackages')}: at least one package is required`)
  }

  for (const [key, pkg] of Object.entries(packages)) {
    const at = where(`billingPackages.${key}`)

    if (pkg.id !== key) {
      errors.push(`${at}: id is "${pkg.id}" but the key is "${key}"`)
    }

    if (!Number.isInteger(pkg.priceMinor) || pkg.priceMinor < 0) {
      errors.push(`${at}.priceMinor must be a non-negative integer (minor units), got ${JSON.stringify(pkg.priceMinor)}`)
    }

    if (!Number.isInteger(pkg.credits) || pkg.credits < 0) {
      errors.push(`${at}.credits must be a non-negative integer, got ${JSON.stringify(pkg.credits)}`)
    }

    if (!pkg.productId?.trim()) {
      errors.push(`${at}.productId is missing`)
    }

    if (pkg.type === 'subscription') {
      if (!pkg.planId) errors.push(`${at} is a subscription but has no planId`)
      if (!pkg.billingCycle) errors.push(`${at} is a subscription but has no billingCycle`)
    } else if (pkg.type === 'credit_pack') {
      if (pkg.billingCycle) errors.push(`${at} is a credit_pack but declares billingCycle "${pkg.billingCycle}"`)
      if (pkg.planId) errors.push(`${at} is a credit_pack but declares planId "${pkg.planId}"`)
    } else {
      errors.push(`${at}.type is "${pkg.type}", expected "subscription" | "credit_pack"`)
    }

    for (const [channel, productId] of Object.entries(pkg.providerProductIds ?? {})) {
      if (!productId?.trim()) {
        errors.push(`${at}.providerProductIds.${channel} is empty`)
      }
    }
  }

  // 免费档
  const free = config.freePlan

  if (!free) {
    errors.push(`${where('freePlan')} is missing`)
  } else {
    if (free.priceMinor !== 0) {
      errors.push(`${where('freePlan.priceMinor')} must be 0, got ${free.priceMinor}`)
    }

    if (!Number.isInteger(free.welcomeCredits) || free.welcomeCredits <= 0) {
      errors.push(
        `${where('freePlan.welcomeCredits')} must be a positive integer, got ${JSON.stringify(free.welcomeCredits)}`
      )
    }

    if (packages[free.id]) {
      errors.push(`${where('freePlan.id')} "${free.id}" collides with a paid packageId`)
    }
  }

  return errors
}
