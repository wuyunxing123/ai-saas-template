/**
 * Flux Kontext 的 Provider 装配（Phase 9.8.2-C）—— **服务端专用**
 *
 * Core 的 `@/lib/ai/providers/<vendor>` 现在是「厂商引擎类」，
 * 本文件把产品的接入清单（`provider-data.ts`）注进这些引擎，产出实例给
 * `config.ts` 绑定。
 *
 * 新增第二个产品 = 在自己的产品目录里重复这一步，Core 零改动。
 *
 * ⚠️ `kie` / `wavespeed` 的引擎用 `node:crypto` 验签，因此本文件及其依赖
 *    不得进入客户端模块图（`verify-product-config.ts` 有检查）。
 */

import { AtlasCloudProvider } from '@/lib/ai/providers/atlascloud'
import { FalProvider } from '@/lib/ai/providers/fal'
import { KieProvider } from '@/lib/ai/providers/kie'
import { WaveSpeedProvider } from '@/lib/ai/providers/wavespeed'
import type { AIProvider } from '@/lib/ai/types'

import {
  FLUX_ATLASCLOUD_CONFIG,
  FLUX_FAL_CONFIG,
  FLUX_KIE_CONFIG,
  FLUX_WAVESPEED_CONFIG,
} from '@/lib/products/flux-kontext/provider-data'

/** 当前产品捆绑的 Provider 实例。 */
export const FLUX_PROVIDERS: readonly AIProvider[] = [
  new FalProvider(FLUX_FAL_CONFIG),
  new KieProvider(FLUX_KIE_CONFIG),
  new WaveSpeedProvider(FLUX_WAVESPEED_CONFIG),
  new AtlasCloudProvider(FLUX_ATLASCLOUD_CONFIG),
]
