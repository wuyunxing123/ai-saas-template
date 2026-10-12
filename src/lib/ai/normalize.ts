/**
 * AI Core — 结果归一化
 *
 * 各家 Provider 返回的字段名五花八门（`images` / `output` / `outputs` /
 * `result` / `data.images`…）。这里把任意形状的响应压成统一的
 * `GenerateResult`，让业务层只处理一种结构。
 */

import type { GeneratedAsset, GenerateResult, AIProviderName } from '@/lib/ai/types'

/** 依次尝试这些字段名，取第一个非空的资源列表。 */
const ASSET_FIELD_CANDIDATES = [
  'images',
  'data.images',
  'output',
  'outputs',
  'result',
] as const

/**
 * 把 Provider 原始响应归一化成 `GenerateResult`。
 *
 * @throws 找不到任何资源时抛错（宁可显式失败，也不要返回空结果让上游猜）
 */
export function normalizeGenerateResult(
  provider: AIProviderName,
  model: string,
  payload: Record<string, unknown> | null | undefined
): GenerateResult {
  const assets = firstNonEmptyAssetList(payload)

  if (!assets?.length) {
    throw new Error(`No assets were returned by the ${provider} provider`)
  }

  return {
    assets,
    provider,
    model,
    seed: readOptionalNumber(payload, 'seed'),
    raw: payload,
  }
}

/** 从任意响应里找出第一个非空的资源列表。 */
export function firstNonEmptyAssetList(
  payload: Record<string, unknown> | null | undefined
): GeneratedAsset[] | null {
  if (!payload) {
    return null
  }

  for (const candidate of ASSET_FIELD_CANDIDATES) {
    const value = readPath(payload, candidate)

    if (Array.isArray(value) && value.length > 0) {
      return normalizeAssets(value)
    }

    if (typeof value === 'string' && value.startsWith('http')) {
      return [{ url: value }]
    }

    if (isAssetLike(value)) {
      return [{ ...value }]
    }
  }

  return null
}

/** 从响应里取布尔数组字段（如 `has_nsfw_concepts`）。 */
export function readBooleanArray(
  payload: Record<string, unknown> | null | undefined,
  path: string
): boolean[] | undefined {
  const value = readPath(payload, path)

  if (!Array.isArray(value)) {
    return undefined
  }

  return value.filter((item): item is boolean => typeof item === 'boolean')
}

/** 按 `a.b.c` 路径读取嵌套字段。 */
export function readPath(
  payload: Record<string, unknown> | null | undefined,
  path: string
): unknown {
  if (!payload) {
    return undefined
  }

  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    return (current as Record<string, unknown>)[key]
  }, payload)
}

function readOptionalNumber(
  payload: Record<string, unknown> | null | undefined,
  path: string
): number | undefined {
  const value = readPath(payload, path)
  return typeof value === 'number' ? value : undefined
}

function isAssetLike(value: unknown): value is GeneratedAsset {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { url?: unknown }).url === 'string'
  )
}

function normalizeAssets(items: unknown[]): GeneratedAsset[] {
  return items
    .map((item) => {
      if (typeof item === 'string' && item.startsWith('http')) {
        return { url: item }
      }

      if (isAssetLike(item)) {
        return item
      }

      return null
    })
    .filter((item): item is GeneratedAsset => !!item)
}
