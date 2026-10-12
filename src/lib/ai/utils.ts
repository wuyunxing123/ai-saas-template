/**
 * AI Core — 共享工具
 *
 * 只放被两个以上 Provider 真正用到的工具函数。
 * 只有一个 Provider 用的东西（例如 fal 的 SDK 封装）留在那个 Provider 自己的文件里。
 */

import type { GenerateRequest, ModelDefinition } from '@/lib/ai/types'

/** 校验并取出「恰好一张」输入图片。 */
export function requireSingleImage(model: string, request: GenerateRequest): string {
  const [first] = request.inputImages ?? []

  if (!first) {
    throw new Error(`Model "${model}" requires exactly one input image`)
  }

  return first
}

/** 校验并取出「多张」输入图片。 */
export function requireMultipleImages(
  model: string,
  request: GenerateRequest
): string[] {
  const images = request.inputImages ?? []

  if (images.length === 0) {
    throw new Error(`Model "${model}" requires at least one input image`)
  }

  return images
}

/**
 * 按**模型契约**校验输入图数量。
 *
 * 为什么必须在统一分发口做，而不是留给各引擎：fal 与 wavespeed 的请求构造函数按
 * 「这次调用带了几张图」分支，它们并不认识 `ModelDefinition.requiredInputImages`。
 * 于是一个声明需要输入图的模型，缺图时会被**静默降级成文生图请求** —— 用户拿到
 * 另一种结果，积分照扣。kie / atlascloud 因为按产品配置分支才恰好没这个问题。
 * 检查放进这里，四家引擎的行为与产品声明的契约从此一致。
 */
export function requireContractInputImages(
  model: ModelDefinition,
  request: GenerateRequest
): void {
  if (model.requiredInputImages === 1) {
    requireSingleImage(model.id, request)
  } else if (model.requiredInputImages === 'many') {
    requireMultipleImages(model.id, request)
  }
}

/** 从参数包里读一个字符串。 */
export function readParamString(
  request: GenerateRequest,
  key: string
): string | undefined {
  const value = request.parameters?.[key]
  return typeof value === 'string' ? value : undefined
}

/** 从参数包里读一个数字。 */
export function readParamNumber(
  request: GenerateRequest,
  key: string
): number | undefined {
  const value = request.parameters?.[key]
  return typeof value === 'number' ? value : undefined
}

/** 从参数包里读一个布尔值。 */
export function readParamBoolean(
  request: GenerateRequest,
  key: string
): boolean | undefined {
  const value = request.parameters?.[key]
  return typeof value === 'boolean' ? value : undefined
}

/** 去掉值为 `undefined` 的字段，避免把 `undefined` 发给第三方 API。 */
export function pruneUndefined(
  input: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

/** 从大小写不敏感的 headers 里取值。 */
export function getHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }

  const lowered = name.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered) {
      return value
    }
  }

  return undefined
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
