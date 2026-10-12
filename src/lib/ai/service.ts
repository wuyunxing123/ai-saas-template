/**
 * AI Core — 统一服务入口
 *
 * 业务层（API 路由、Workflow）只允许通过这里调用 AI：
 *
 *   AIService.generate({ model, prompt, inputImages, parameters })
 *
 * 不允许出现：
 *
 *   import { FalProvider } from '@/lib/ai/providers/fal'
 *   fal.subscribe(...)
 *
 * 这样做的收益：换模型 / 换厂商 / 加新能力，都只改 `ai/` 内部，
 * 业务代码零改动。
 */

import { getModel } from '@/lib/ai/models'
import {
  getAIProvider,
  hasAIProvider,
  listAIProviderNames,
  listAIProviders,
} from '@/lib/ai/providers'
import { requireContractInputImages } from '@/lib/ai/utils'
import type {
  AIProvider,
  AITaskHandle,
  AITaskResult,
  GenerateRequest,
  GenerateResult,
} from '@/lib/ai/types'

let invalidProviderWarned = false

/**
 * 解析出执行本次请求的 Provider。
 *
 * 优先级：
 *   1. `request.provider`（显式指定，必须支持该模型，否则报错）
 *   2. `AI_PROVIDER` / `IMAGE_GENERATION_PROVIDER` 环境变量（支持该模型时生效）
 *   3. 模型自身的 `defaultProvider`
 *
 * 全程不做「静默换成别家」—— 配置错了就报错，否则问题会被藏起来。
 */
export function resolveProvider(request: GenerateRequest): AIProvider {
  const model = getModel(request.model)

  const explicit = request.provider?.trim()

  if (explicit) {
    const provider = getAIProvider(explicit)

    if (!model.providers.includes(provider.name)) {
      throw new Error(
        `Provider "${provider.name}" does not support model "${model.id}". ` +
          `Supported: ${model.providers.join(', ')}`
      )
    }

    return provider
  }

  const preferred = getPreferredProvider()

  if (preferred && model.providers.includes(preferred)) {
    return getAIProvider(preferred)
  }

  return getAIProvider(model.defaultProvider)
}

/** 执行一次生成。 */
export async function generate(request: GenerateRequest): Promise<GenerateResult> {
  // 契约校验在分发**之前**，且在统一入口：不能让「哪家引擎恰好检查了」决定行为。
  requireContractInputImages(getModel(request.model), request)

  const provider = resolveProvider(request)
  const result = await provider.generate(request)

  return {
    ...result,
    provider: provider.name,
    model: request.model,
  }
}

/** 提交异步任务。 */
export async function submitTask(request: GenerateRequest): Promise<AITaskHandle> {
  requireContractInputImages(getModel(request.model), request)

  const provider = resolveProvider(request)

  if (!provider.submitTask) {
    throw new Error(`Provider "${provider.name}" does not support async tasks`)
  }

  return provider.submitTask(request)
}

/** 查询异步任务结果。未指定 provider 时按模型默认 Provider 查询。 */
export async function getTaskResult(
  taskId: string,
  model: string,
  providerName?: string
): Promise<AITaskResult> {
  const provider = providerName
    ? getAIProvider(providerName)
    : getAIProvider(getModel(model).defaultProvider)

  if (!provider.getTaskResult) {
    throw new Error(`Provider "${provider.name}" does not support task polling`)
  }

  return provider.getTaskResult(taskId, model)
}

/** 校验 Provider 的 webhook 签名。 */
export async function verifyWebhook(
  providerName: string,
  rawBody: string,
  headers: Headers | Record<string, string | undefined>
): Promise<boolean> {
  const provider = getAIProvider(providerName)

  if (!provider.verifyWebhook) {
    return false
  }

  return provider.verifyWebhook(rawBody, headers)
}

/**
 * 上传文件到 Provider 自己的存储。
 *
 * 不是所有 Provider 都有存储（例如 atlascloud 没有），
 * 因此调用方需要处理「没有可用上传后端」的情况。
 */
export async function uploadFile(
  file: File,
  providerName?: string
): Promise<string> {
  const provider = providerName
    ? getAIProvider(providerName)
    : getUploadProvider()

  if (!provider.uploadFile) {
    throw new Error(`Provider "${provider.name}" does not support file upload`)
  }

  return provider.uploadFile(file)
}

export const AIService = {
  generate,
  submitTask,
  getTaskResult,
  verifyWebhook,
  uploadFile,
  resolveProvider,
}

/** 环境变量指定的首选 Provider（兼容旧的 `IMAGE_GENERATION_PROVIDER`）。 */
function getPreferredProvider(): string | undefined {
  const raw =
    process.env.AI_PROVIDER?.trim() ||
    process.env.IMAGE_GENERATION_PROVIDER?.trim()

  if (!raw) {
    return undefined
  }

  const name = raw.toLowerCase()

  if (!hasAIProvider(name)) {
    if (!invalidProviderWarned) {
      invalidProviderWarned = true
      console.warn(
        `Unknown AI provider "${raw}". Registered: ${listAIProviderNames().join(', ')}. ` +
          "Falling back to each model's default provider."
      )
    }

    return undefined
  }

  return name
}

/** 上传时的默认 Provider：优先环境变量，其次第一个支持上传的 Provider。 */
function getUploadProvider(): AIProvider {
  const preferred = getPreferredProvider()

  if (preferred) {
    const provider = getAIProvider(preferred)

    if (provider.uploadFile) {
      return provider
    }
  }

  const withUpload = listAIProviders().find((provider) => !!provider.uploadFile)

  if (!withUpload) {
    throw new Error('No registered AI provider supports file upload')
  }

  return withUpload
}
