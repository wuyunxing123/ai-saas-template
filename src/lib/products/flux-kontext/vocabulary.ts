/**
 * Flux Kontext 的识别词汇（供门禁扫描 Core 用）
 *
 * `scripts/verify-product-config.ts` 会拿这份清单去扫 Core 目录，要求这些字符串
 * 在 **Core 代码**（去注释后）里一个都不出现 —— 出现了就说明母版机制里还藏着
 * Flux 的数据。
 *
 * 为什么由产品自己声明，而不是守卫写死：守卫里硬写一份 Flux 词表，等于
 * 「换掉产品后仍然在检查上一个产品的字面量」，那种绿色没有信息量。
 *
 * 两条约束（由 `product-discovery.ts` 的自检执行）：
 *   · 每个词必须真的出现在本产品的其它文件里 —— 否则就是凑数的死词汇；
 *   · 模型 id / 套餐 id / 渠道商品 id 由 bundle 自动派生，不必在这里重复。
 *
 * 纯数据文件：不得 import 任何东西。
 */

/** 产品对外的 action 名（与 `types.ts` 的清单一致）。 */
export const FLUX_KONTEXT_ACTION_TERMS: readonly string[] = [
  'text-to-image-pro',
  'text-to-image-max',
  'text-to-image-schnell',
  'text-to-image-dev',
  'text-to-image-realism',
  'text-to-image-anime',
  'edit-image-pro',
  'edit-image-max',
  'edit-multi-image-pro',
  'edit-multi-image-max',
]

/** 品牌与目录词。 */
export const FLUX_BRAND_TERMS: readonly string[] = [
  'Flux Kontext',
  'FLUX Kontext',
  'flux-kontext',
  'kontext',
]

/** 厂商侧的产品专属字面量：endpoint 前缀、接口路径、枚举值、LoRA 来源。 */
export const FLUX_VENDOR_TERMS: readonly string[] = [
  'fal-ai/',
  'flux/kontext',
  'landscape_4_3',
  'portrait_4_3',
  'landscape_16_9',
  'portrait_16_9',
  'square_hd',
  'huggingface.co',
]
