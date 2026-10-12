/**
 * Payment Provider 注册表
 *
 * 业务层只通过这里拿 Provider，不直接 import 具体实现。
 *
 * 命名说明：本目录导出的 `PaymentProvider` 是**接口**（见 billing/types.ts）。
 * Phase 9.2 已删除 Phase 1 遗留的同名「字符串联合」类型
 * （原 `@/lib/types/payment`），命名冲突不再存在。
 */

import { CreemProvider } from '@/lib/billing/providers/creem'
import { StripeProvider } from '@/lib/billing/providers/stripe'
import type { PaymentProvider } from '@/lib/billing/types'

/** 注册表是模块私有变量，不导出。 */
const providerRegistry: Record<string, PaymentProvider> = {
  creem: new CreemProvider(),
  stripe: new StripeProvider(),
}

/** 取 Provider。未注册时抛错（不静默回退）。 */
export function getPaymentProvider(name: string): PaymentProvider {
  const provider = providerRegistry[name]

  if (!provider) {
    throw new Error(
      `Unknown payment provider "${name}". Registered: ${listPaymentProviderNames().join(', ')}`
    )
  }

  return provider
}

export function listPaymentProviderNames(): string[] {
  return Object.keys(providerRegistry)
}

/** 该名称是否已注册。用于在路由层把「未知渠道」判为 400 而不是 500。 */
export function hasPaymentProvider(name: string): boolean {
  return name in providerRegistry
}

export function listPaymentProviders(): PaymentProvider[] {
  return Object.values(providerRegistry)
}

/** 已配置好密钥的 Provider。 */
export function listConfiguredPaymentProviders(): PaymentProvider[] {
  return listPaymentProviders().filter((provider) => provider.isConfigured())
}

/**
 * 解析默认 Provider。
 *
 * 顺序：`NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER` → 第一个已配置的。
 * 一个都没配置时抛错 —— 与「静默选一个不可用的渠道」相比，明确失败更容易排查。
 */
export function resolveDefaultPaymentProvider(): PaymentProvider {
  const configured = process.env.NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER?.trim()

  if (configured) {
    const provider = getPaymentProvider(configured)

    if (!provider.isConfigured()) {
      throw new Error(
        `Default payment provider "${configured}" is selected but not configured. ` +
          'Check its API keys in .env.local.'
      )
    }

    return provider
  }

  const available = listConfiguredPaymentProviders()

  if (available.length === 0) {
    throw new Error(
      'No payment provider is configured. Set STRIPE_PRIVATE_KEY or CREEM_API_KEY.'
    )
  }

  return available[0]
}
