/**
 * AI Core — Provider 查询
 *
 * 这是业务代码与具体厂商之间**唯一**的边界。
 * 业务代码只调用 `getAIProvider(name)`，永远不 import 具体 Provider 类。
 *
 * Phase 9.8.2-C：这里不再有 `providerRegistry` 字面量。
 * Provider **实例**由产品目录构造（厂商映射表是产品数据），经
 * `bindProductConfig()` 绑定后由本文件查询。Core 提供 `AIProvider` 形状与
 * 各厂商适配器**类**（可复用的机制），但不决定装哪几家、支持哪些模型。
 *
 * 新增一家 Provider = 产品侧引入 Core 的适配器类、注入自己的映射表。
 * 未绑定 / 未收录都抛错，绝不回退到「默认那家」。
 */

import { getProductConfig } from '@/config/product'
import type { AIProvider, AIProviderName } from '@/lib/ai/types'

function bundledProviders(): readonly AIProvider[] {
  return getProductConfig().providers
}

/** 取 Provider 实例。未绑定该名称时抛错（不静默回退）。 */
export function getAIProvider(name: AIProviderName): AIProvider {
  const provider = bundledProviders().find((entry) => entry.name === name)

  if (!provider) {
    throw new Error(
      `Unknown AI provider "${name}" for product "${getProductConfig().productId}". ` +
        `Bundled: ${listAIProviderNames().join(', ')}`
    )
  }

  return provider
}

/** 已绑定的 Provider 名称列表。 */
export function listAIProviderNames(): AIProviderName[] {
  return bundledProviders().map((provider) => provider.name)
}

/** 已绑定的 Provider 实例列表。 */
export function listAIProviders(): AIProvider[] {
  return [...bundledProviders()]
}

/** 该名称是否已绑定。 */
export function hasAIProvider(name: AIProviderName): boolean {
  return bundledProviders().some((provider) => provider.name === name)
}
