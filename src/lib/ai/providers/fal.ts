import {
  getFalQueueResult,
  getFalQueueStatus,
  submitFalQueue,
  subscribeToFal,
  uploadToFalStorage,
} from '@/lib/fal-client'
import { normalizeGenerateResult } from '@/lib/ai/normalize'
import type {
  AITaskHandle,
  AITaskResult,
  AITaskState,
  AIProvider,
  GenerateRequest,
  GenerateResult,
} from '@/lib/ai/types'
import {
  pruneUndefined,
  readParamBoolean,
  readParamNumber,
  readParamString,
  requireMultipleImages,
  requireSingleImage,
} from '@/lib/ai/utils'

/**
 * fal Provider 的**配置形状**。
 *
 * Phase 9.8.2-C：这个类是「fal 这家厂商的调用机制」，与「当前产品卖哪些模型」无关。
 * 端点表、LoRA、宽高比映射全部由产品数据注入（`src/lib/products/<id>/provider-data.ts`），
 * 因此新增第二个产品不需要改这个文件。
 */
export interface FalModelConfig {
  /** fal 的 endpoint 路径。 */
  endpoint: string
  /** LoRA 配置：只有部分模型需要。 */
  loras?: Array<{ path: string; scale: number }>
  /**
   * 文生图请求里为该模型固定附带的字段。
   *
   * 取代原先的 `if (request.model === 'flux-schnell')` 分支：
   * 「某个模型要跑几步」是产品数据，不是 Provider 逻辑。
   */
  fixedTextToImageInput?: Record<string, unknown>
}

export interface FalProviderConfig {
  /** 模型 id → 该模型在 fal 上的调用参数。 */
  models: Record<string, FalModelConfig>
  /** 宽高比 → fal 的 `image_size` 枚举。未列出的宽高比会直接报错，不会静默换成别的比例。 */
  imageSizeByAspectRatio: Record<string, string>
  /** 请求没带宽高比时使用的 `image_size`。 */
  defaultImageSize: string
}

export class FalProvider implements AIProvider {
  readonly name = 'fal'
  readonly modality = 'image' as const
  readonly models: readonly string[]

  constructor(private readonly config: FalProviderConfig) {
    this.models = Object.keys(config.models)
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const endpoint = this.getEndpoint(request.model)
    const result = await subscribeToFal(endpoint, {
      input: this.buildInput(request),
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          console.log(
            `[${this.name}] ${request.model} progress:`,
            update.logs?.map((log) => log.message).join('\n')
          )
        }
      },
    })

    return normalizeGenerateResult(
      this.name,
      request.model,
      unwrapFalPayload(result)
    )
  }

  async uploadFile(file: File): Promise<string> {
    return uploadToFalStorage(file)
  }

  async submitTask(request: GenerateRequest): Promise<AITaskHandle> {
    const endpoint = this.getEndpoint(request.model)
    const submission = await submitFalQueue(endpoint, {
      input: this.buildInput(request),
      webhookUrl: request.webhookUrl,
    })

    return {
      provider: this.name,
      taskId: submission.request_id,
      raw: submission,
    }
  }

  async getTaskResult(taskId: string, model: string): Promise<AITaskResult> {
    const endpoint = this.getEndpoint(model)
    const status = await getFalQueueStatus(endpoint, {
      requestId: taskId,
      logs: true,
    })
    const state = mapFalState(status.status)

    if (state !== 'completed') {
      return { provider: this.name, taskId, state, raw: status }
    }

    const result = await getFalQueueResult(endpoint, { requestId: taskId })

    return {
      provider: this.name,
      taskId,
      state: 'completed',
      result: normalizeGenerateResult(this.name, model, unwrapFalPayload(result)),
      raw: result,
    }
  }

  /** 未登记的模型直接报错，不回退到某个「默认端点」。 */
  private getEndpoint(model: string): string {
    const entry = this.config.models[model]

    if (!entry) {
      throw new Error(`${this.name} does not support model "${model}"`)
    }

    return entry.endpoint
  }

  private buildInput(request: GenerateRequest): Record<string, unknown> {
    const base: Record<string, unknown> = {
      prompt: request.prompt,
      seed: readParamNumber(request, 'seed'),
      guidance_scale: readParamNumber(request, 'guidance_scale'),
      num_images: readParamNumber(request, 'num_images'),
      safety_tolerance: readParamString(request, 'safety_tolerance'),
      output_format: readParamString(request, 'output_format'),
    }

    const inputImages = request.inputImages ?? []

    if (inputImages.length === 0) {
      const entry = this.config.models[request.model]

      const textInput: Record<string, unknown> = {
        ...base,
        ...entry.fixedTextToImageInput,
        sync_mode: readParamBoolean(request, 'sync_mode'),
        image_size: this.resolveImageSize(request),
      }

      if (entry.loras) {
        textInput.loras = entry.loras
      }

      return pruneUndefined(textInput)
    }

    if (inputImages.length === 1) {
      return pruneUndefined({
        ...base,
        image_url: requireSingleImage(request.model, request),
      })
    }

    return pruneUndefined({
      ...base,
      image_urls: requireMultipleImages(request.model, request),
    })
  }

  /**
   * 宽高比 → `image_size`。
   *
   * 未带宽高比时沿用产品的默认值；带了但映射表里没有则报错 ——
   * 旧实现在这里 `default: 'landscape_4_3'`，会把不支持的比例静默变成 4:3。
   */
  private resolveImageSize(request: GenerateRequest): string {
    const aspectRatio = readParamString(request, 'aspect_ratio')

    if (!aspectRatio) {
      return this.config.defaultImageSize
    }

    const imageSize = this.config.imageSizeByAspectRatio[aspectRatio]

    if (!imageSize) {
      throw new Error(
        `${this.name} has no image_size mapping for aspect ratio "${aspectRatio}"`
      )
    }

    return imageSize
  }
}

/**
 * fal 的 subscribe / queue 结果有时包一层 `data`。
 * 这里统一剥掉，交给归一化层处理。
 */
function unwrapFalPayload(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && 'data' in result) {
    const wrapped = (result as { data?: Record<string, unknown> }).data
    return wrapped ?? (result as Record<string, unknown>)
  }

  return (result ?? {}) as Record<string, unknown>
}

function mapFalState(status?: string): AITaskState {
  switch (status) {
    case 'COMPLETED':
      return 'completed'
    case 'IN_PROGRESS':
      return 'processing'
    case 'FAILED':
      return 'failed'
    case 'IN_QUEUE':
    default:
      return 'queued'
  }
}
