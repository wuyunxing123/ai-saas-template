/**
 * Flux Kontext 产品模块入口。
 *
 * 依赖方向（规格 §26）：`products/*` → 基础设施。
 * 基础设施**不得** import 本模块。
 */

export { FluxKontextService, FluxProductError } from '@/lib/products/flux-kontext/service'
export type {
  FluxGenerateParams,
  FluxGenerationOutcome,
} from '@/lib/products/flux-kontext/service'

export { ACTION_TO_MODEL, actionToModelId, isFluxKontextAction } from '@/lib/products/flux-kontext/actions'
export { getRequiredCredits } from '@/lib/products/flux-kontext/credits'

export type {
  FluxKontextAction,
  FluxKontextAspectRatio,
  FluxKontextGenerationRequest,
  FluxKontextImage,
  FluxKontextResult,
  FluxKontextSafetyTolerance,
  FluxKontextOutputFormat,
  ImageGenerationProviderName,
} from '@/lib/products/flux-kontext/types'
