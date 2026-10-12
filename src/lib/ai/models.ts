/**
 * AI Core — 模型查询
 *
 * 这里回答「有哪些模型可用」，不回答「怎么调用它们」，更**不携带任何模型清单**。
 *
 * Phase 9.8.2-C：`MODELS` 字面量已移出 Core。
 *   · 形状契约：`ModelDefinition`（`@/lib/ai/types`）
 *   · 数据：产品的 `src/lib/products/<id>/catalogue.ts`
 *   · 装配：`bindProductConfig()`（`@/config/product`）
 *
 * 本文件只剩**查询机制**：命中就返回，未命中就抛错并列出可用 id。
 * 未绑定产品配置时 `getProductConfig()` 直接抛错 —— 不存在「回退到某个默认模型」。
 *
 * 关于 flux-kontext：它在这里连一个字都不出现。
 */

import { getProductConfig } from '@/config/product'
import type { AIModality, AIProviderName, ModelDefinition } from '@/lib/ai/types'

export type { ModelDefinition }

/** 取模型定义，不存在则抛错（不静默回退，避免掩盖配置错误）。 */
export function getModel(modelId: string): ModelDefinition {
  const models = getProductConfig().models
  const model = models[modelId]

  if (!model) {
    throw new Error(
      `Unknown model "${modelId}" for product "${getProductConfig().productId}". ` +
        `Available: ${Object.keys(models).join(', ')}`
    )
  }

  return model
}

/** 按能力类型列出模型。 */
export function listModels(modality?: AIModality): ModelDefinition[] {
  const all = Object.values(getProductConfig().models)
  return modality ? all.filter((model) => model.modality === modality) : all
}

/** 判断某个 Provider 是否支持该模型。 */
export function isModelSupportedBy(modelId: string, provider: AIProviderName): boolean {
  return getModel(modelId).providers.includes(provider)
}
