/**
 * Flux Kontext 能力清单（Phase 9.8.2-C）—— **客户端安全**
 *
 * 「这个产品支持哪些宽高比」是产品策略，不是通用机制：
 *   · 原先写在 `src/lib/user-tiers.ts`（Core 目录下的产品数据，守卫覆盖不到）；
 *   · fal 的 `image_size` 枚举映射原先写在 `src/lib/ai/utils.ts` 的
 *     `aspectRatioToFalImageSize()`，并且 `default: 'landscape_4_3'`
 *     会把任何认不出的比例（包括 `5:4` 这类合法值和拼错的值）静默变成 4:3。
 *
 * 现在两张表合成一张：每个比例**显式**声明它在 fal 上的落点，
 * 未列出的比例会被 `isFluxAspectRatio()` 拒绝、Provider 侧直接报错，不存在兜底。
 *
 * ⚠️ 本文件必须是纯数据：UI 组件与服务端 Provider 配置共用它。
 */

/** 宽高比选项：UI 渲染用 value/label/icon，fal 映射用 falImageSize。 */
export interface FluxAspectRatioOption {
  value: string
  label: string
  icon: string
  /**
   * fal 只接受 6 个 `image_size` 枚举值，因此近邻比例必须归拢到最接近的枚举。
   * 归拢关系写在这里而不是藏在 `default` 分支里 —— 看得见、可核对。
   */
  falImageSize:
    | 'square_hd'
    | 'square'
    | 'portrait_4_3'
    | 'portrait_16_9'
    | 'landscape_4_3'
    | 'landscape_16_9'
}

export const FLUX_ASPECT_RATIOS: readonly FluxAspectRatioOption[] = [
  { value: '1:1', label: '1:1', icon: '⬜', falImageSize: 'square_hd' },
  { value: '16:9', label: '16:9', icon: '📺', falImageSize: 'landscape_16_9' },
  { value: '9:16', label: '9:16', icon: '📱', falImageSize: 'portrait_16_9' },
  { value: '4:3', label: '4:3', icon: '🖼️', falImageSize: 'landscape_4_3' },
  { value: '3:4', label: '3:4', icon: '📄', falImageSize: 'portrait_4_3' },
  { value: '3:2', label: '3:2', icon: '📷', falImageSize: 'landscape_4_3' },
  { value: '2:3', label: '2:3', icon: '📖', falImageSize: 'portrait_4_3' },
  { value: '21:9', label: '21:9', icon: '🎬', falImageSize: 'landscape_16_9' },
  { value: '9:21', label: '9:21', icon: '🏢', falImageSize: 'portrait_16_9' },
  { value: '5:4', label: '5:4', icon: '🖼️', falImageSize: 'landscape_4_3' },
  // 旧实现把竖版的 4:5 / 5:7 也落到了 landscape_4_3（横版），这里按方向修正。
  { value: '4:5', label: '4:5', icon: '📄', falImageSize: 'portrait_4_3' },
  { value: '7:5', label: '7:5', icon: '📷', falImageSize: 'landscape_4_3' },
  { value: '5:7', label: '5:7', icon: '📖', falImageSize: 'portrait_4_3' },
]

/** 请求没带宽高比时 fal 用的默认 `image_size`（沿用旧实现落到 4:3 的行为）。 */
export const FLUX_DEFAULT_FAL_IMAGE_SIZE = 'landscape_4_3'

const BY_VALUE = new Map(FLUX_ASPECT_RATIOS.map((option) => [option.value, option]))

/** 该字符串是否是 Flux 支持的宽高比。 */
export function isFluxAspectRatio(value: string): boolean {
  return BY_VALUE.has(value)
}

/** 取宽高比选项；未支持时返回 null（调用方决定是报错还是列可用值）。 */
export function findAspectRatio(value: string): FluxAspectRatioOption | null {
  return BY_VALUE.get(value) ?? null
}

/** 供错误信息使用。 */
export function listAspectRatios(): string[] {
  return FLUX_ASPECT_RATIOS.map((option) => option.value)
}
