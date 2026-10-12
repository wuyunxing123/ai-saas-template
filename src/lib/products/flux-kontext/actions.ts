/**
 * Flux 产品 action ↔ 通用 model id 的映射与校验。
 *
 * 边界（Phase 8）：`action` 是 **Flux 产品的词表**；`model` 是 AI Core 的通用词表。
 * 转换只允许发生在产品层（本文件）。基础设施不得 import 本文件。
 *
 * 合并来源：
 *   · `src/lib/flux-kontext-actions.ts`（ACTION_TO_MODEL）
 *   · `src/lib/image-generation/utils.ts`（isFluxKontextAction）
 */

import {
  FLUX_KONTEXT_ACTIONS,
  type FluxKontextAction,
} from '@/lib/products/flux-kontext/types'

/** Flux action → AI Core model id。 */
export const ACTION_TO_MODEL: Record<FluxKontextAction, string> = {
  'text-to-image-pro': 'flux-kontext-pro',
  'text-to-image-max': 'flux-kontext-max',
  'text-to-image-schnell': 'flux-schnell',
  'text-to-image-dev': 'flux-dev',
  'text-to-image-realism': 'flux-realism',
  'text-to-image-anime': 'flux-anime',
  'edit-image-pro': 'flux-kontext-pro-edit',
  'edit-image-max': 'flux-kontext-max-edit',
  'edit-multi-image-pro': 'flux-kontext-pro-multi',
  'edit-multi-image-max': 'flux-kontext-max-multi',
}

/** 该 action 是否已知。 */
export function isKnownAction(action: string): action is FluxKontextAction {
  return Object.prototype.hasOwnProperty.call(ACTION_TO_MODEL, action)
}

/** 判断字符串是否为 Flux Kontext action（词表校验）。 */
export function isFluxKontextAction(value: string): value is FluxKontextAction {
  return (FLUX_KONTEXT_ACTIONS as readonly string[]).includes(value)
}

/** 把 action 解析成模型 id；未知 action 返回 null（不抛错，调用方决定行为）。 */
export function actionToModelId(action: string): string | null {
  return isKnownAction(action) ? ACTION_TO_MODEL[action] : null
}
