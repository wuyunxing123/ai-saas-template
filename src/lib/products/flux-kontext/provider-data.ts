/**
 * Flux Kontext 的厂商接入清单（Phase 9.8.2-C）—— **服务端数据**
 *
 * 「哪个模型在哪家的哪条 endpoint 上、要挂哪套 LoRA、KIE 的接口路径是什么」
 * 是**当前产品接了什么**，不是那四家厂商的通用机制。
 * 原先这些表写死在 `src/lib/ai/providers/*.ts` 里，导致新增第二个产品必须改 Core。
 *
 * Core 侧留下的文件（`@/lib/ai/providers/<vendor>`）现在只是**可参数化的引擎类**，
 * 由 `providers.ts` 用这里的表实例化。
 *
 * ⚠️ 服务端专用：`providers.ts` 会把它带进含 `node:crypto` 的模块图，客户端不得 import。
 */

import type {
  FalModelConfig,
  FalProviderConfig,
} from '@/lib/ai/providers/fal'
import type {
  KieModelConfig,
  KieProviderConfig,
} from '@/lib/ai/providers/kie'
import type {
  AtlasCloudModelConfig,
  AtlasCloudProviderConfig,
} from '@/lib/ai/providers/atlascloud'
import type { WaveSpeedProviderConfig } from '@/lib/ai/providers/wavespeed'

import {
  FLUX_ASPECT_RATIOS,
  FLUX_DEFAULT_FAL_IMAGE_SIZE,
} from '@/lib/products/flux-kontext/capabilities'

/** 模型 id → fal endpoint + 该模型的附加输入。 */
const FAL_MODELS: Record<string, FalModelConfig> = {
  'flux-kontext-pro': { endpoint: 'fal-ai/flux-pro' },
  'flux-kontext-pro-edit': { endpoint: 'fal-ai/flux-pro/kontext' },
  'flux-kontext-pro-multi': { endpoint: 'fal-ai/flux-pro/kontext/multi' },
  'flux-kontext-max': { endpoint: 'fal-ai/flux-pro/v1.1' },
  'flux-kontext-max-edit': { endpoint: 'fal-ai/flux-pro/kontext/max' },
  'flux-kontext-max-multi': { endpoint: 'fal-ai/flux-pro/kontext/max/multi' },
  'flux-schnell': {
    endpoint: 'fal-ai/flux/schnell',
    // schnell 只跑 4 步 —— 这是该模型的参数，不是 fal Provider 的逻辑。
    fixedTextToImageInput: { num_inference_steps: 4 },
  },
  'flux-dev': { endpoint: 'fal-ai/flux/dev' },
  'flux-realism': {
    endpoint: 'fal-ai/flux-general',
    loras: [
      {
        path: 'https://huggingface.co/XLabs-AI/flux-RealismLora/resolve/main/lora.safetensors',
        scale: 0.8,
      },
    ],
  },
  'flux-anime': {
    endpoint: 'fal-ai/flux-general',
    loras: [
      {
        path: 'https://huggingface.co/Shakker-Labs/FLUX.1-dev-LoRA-AnimeStyle/resolve/main/FLUX-dev-lora-AnimeStyle.safetensors',
        scale: 0.9,
      },
    ],
  },
}

export const FLUX_FAL_CONFIG: FalProviderConfig = {
  models: FAL_MODELS,
  imageSizeByAspectRatio: Object.fromEntries(
    FLUX_ASPECT_RATIOS.map((option) => [option.value, option.falImageSize])
  ),
  defaultImageSize: FLUX_DEFAULT_FAL_IMAGE_SIZE,
}

/** KIE 侧的模型名 + 是否需要输入图。KIE 不支持多图编辑，所以这里没有 `*-multi`。 */
const KIE_MODELS: Record<string, KieModelConfig> = {
  'flux-kontext-pro': { model: 'flux-kontext-pro', requiresImage: false },
  'flux-kontext-pro-edit': { model: 'flux-kontext-pro', requiresImage: true },
  'flux-kontext-max': { model: 'flux-kontext-max', requiresImage: false },
  'flux-kontext-max-edit': { model: 'flux-kontext-max', requiresImage: true },
}

export const FLUX_KIE_CONFIG: KieProviderConfig = {
  models: KIE_MODELS,
  generatePath: '/api/v1/flux/kontext/generate',
  recordPath: '/api/v1/flux/kontext/record-info',
}

/** 模型 id → WaveSpeed 的 endpoint 路径。同样不含 `*-multi` 之外的档位。 */
export const FLUX_WAVESPEED_CONFIG: WaveSpeedProviderConfig = {
  models: {
    'flux-kontext-pro': 'wavespeed-ai/flux-kontext-pro/text-to-image',
    'flux-kontext-pro-edit': 'wavespeed-ai/flux-kontext-pro',
    'flux-kontext-pro-multi': 'wavespeed-ai/flux-kontext-pro/multi',
    'flux-kontext-max': 'wavespeed-ai/flux-kontext-max/text-to-image',
    'flux-kontext-max-edit': 'wavespeed-ai/flux-kontext-max',
    'flux-kontext-max-multi': 'wavespeed-ai/flux-kontext-max/multi',
  },
}

/** Atlas Cloud 用一个 key 暴露 FLUX 全系：档位 → 网关模型名 + 输入图模式。 */
const ATLASCLOUD_MODELS: Record<string, AtlasCloudModelConfig> = {
  'flux-kontext-pro': {
    model: 'black-forest-labs/flux-2-flex/text-to-image',
    images: 'none',
  },
  'flux-kontext-max': {
    model: 'black-forest-labs/flux-2-pro/text-to-image',
    images: 'none',
  },
  'flux-schnell': { model: 'black-forest-labs/flux-schnell', images: 'none' },
  'flux-dev': { model: 'black-forest-labs/flux-dev', images: 'none' },
  'flux-kontext-pro-edit': {
    model: 'black-forest-labs/flux-2-flex/edit',
    images: 'single',
  },
  'flux-kontext-max-edit': {
    model: 'black-forest-labs/flux-2-pro/edit',
    images: 'single',
  },
  'flux-kontext-pro-multi': {
    model: 'black-forest-labs/flux-2-flex/edit',
    images: 'multi',
  },
  'flux-kontext-max-multi': {
    model: 'black-forest-labs/flux-2-pro/edit',
    images: 'multi',
  },
}

export const FLUX_ATLASCLOUD_CONFIG: AtlasCloudProviderConfig = {
  models: ATLASCLOUD_MODELS,
}
