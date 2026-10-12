/**
 * Flux Kontext 模型目录（Phase 9.8.2-C）
 *
 * 这份清单原先在 `src/lib/ai/models.ts`（Core）里。它描述的是 **Flux 这个产品**
 * 卖哪些档位、每档多少积分、可以走哪几家厂商 —— 属于产品数据，不属于通用机制。
 *
 * Core 侧只留下：
 *   · `ModelDefinition` 形状（`@/lib/ai/types`）
 *   · 查询机制（`@/lib/ai/models` 的 `getModel` / `listModels`）
 *   · 完整性校验（`@/config/product` 的 `validateProductConfig`）
 *
 * ⚠️ 本文件必须是**纯数据**：客户端 UI 直接 import 它来显示积分成本，
 *    所以这里不得引入任何服务端 Provider 代码。
 *
 * 唯一价格真相：`credits` 字段。UI 展示与 `WorkflowService` 实际扣减读的是同一个值。
 */

import type { ModelDefinition } from '@/lib/ai/types'

export const FLUX_MODELS: Record<string, ModelDefinition> = {
  // ── FLUX Kontext Pro 系列 ──────────────────────────────────────────
  'flux-kontext-pro': {
    id: 'flux-kontext-pro',
    modality: 'image',
    label: 'FLUX Kontext Pro',
    description: '文本生图，质量与速度均衡',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal', 'kie', 'wavespeed', 'atlascloud'],
    credits: 15,
  },
  'flux-kontext-pro-edit': {
    id: 'flux-kontext-pro-edit',
    modality: 'image',
    label: 'FLUX Kontext Pro · Edit',
    description: '单图编辑',
    requiredInputImages: 1,
    defaultProvider: 'fal',
    providers: ['fal', 'kie', 'wavespeed', 'atlascloud'],
    credits: 15,
  },
  'flux-kontext-pro-multi': {
    id: 'flux-kontext-pro-multi',
    modality: 'image',
    label: 'FLUX Kontext Pro · Multi',
    description: '多图编辑',
    requiredInputImages: 'many',
    defaultProvider: 'fal',
    providers: ['fal', 'wavespeed', 'atlascloud'],
    credits: 15,
  },

  // ── FLUX Kontext Max 系列 ──────────────────────────────────────────
  'flux-kontext-max': {
    id: 'flux-kontext-max',
    modality: 'image',
    label: 'FLUX Kontext Max',
    description: '文本生图，最高质量',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal', 'kie', 'wavespeed', 'atlascloud'],
    credits: 30,
  },
  'flux-kontext-max-edit': {
    id: 'flux-kontext-max-edit',
    modality: 'image',
    label: 'FLUX Kontext Max · Edit',
    description: '单图编辑，最高质量',
    requiredInputImages: 1,
    defaultProvider: 'fal',
    providers: ['fal', 'kie', 'wavespeed', 'atlascloud'],
    credits: 30,
  },
  'flux-kontext-max-multi': {
    id: 'flux-kontext-max-multi',
    modality: 'image',
    label: 'FLUX Kontext Max · Multi',
    description: '多图编辑，最高质量',
    requiredInputImages: 'many',
    defaultProvider: 'fal',
    providers: ['fal', 'wavespeed', 'atlascloud'],
    credits: 45,
  },

  // ── FLUX 其他档位 ─────────────────────────────────────────────────
  'flux-schnell': {
    id: 'flux-schnell',
    modality: 'image',
    label: 'FLUX Schnell',
    description: '极速文本生图',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal', 'atlascloud'],
    credits: 8,
  },
  'flux-dev': {
    id: 'flux-dev',
    modality: 'image',
    label: 'FLUX Dev',
    description: '开放权重文本生图',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal', 'atlascloud'],
    credits: 12,
  },
  'flux-realism': {
    id: 'flux-realism',
    modality: 'image',
    label: 'FLUX Realism',
    description: '写实风格文本生图',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal'],
    credits: 20,
  },
  'flux-anime': {
    id: 'flux-anime',
    modality: 'image',
    label: 'FLUX Anime',
    description: '动漫风格文本生图',
    requiredInputImages: 0,
    defaultProvider: 'fal',
    providers: ['fal'],
    credits: 20,
  },
}
