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
  readParamNumber,
  readParamString,
  requireMultipleImages,
  requireSingleImage,
  sleep,
} from '@/lib/ai/utils'

/**
 * 部署参数在**请求时**读 env，不在模块加载时读。
 *
 * 接缝 `src/app/product-runtime.ts` 会早于任何启动/测试代码设定的 env 被 import；
 * 把 base URL 存成模块级常量等于把「加载顺序」变成隐式契约。
 */
function atlasCloudBaseUrl() {
  return process.env.ATLASCLOUD_API_BASE_URL?.trim() || 'https://api.atlascloud.ai'
}
function atlasCloudPollIntervalMs() {
  return Number(process.env.ATLASCLOUD_POLL_INTERVAL_MS || 2000)
}
function atlasCloudPollTimeoutMs() {
  return Number(process.env.ATLASCLOUD_POLL_TIMEOUT_MS || 50000)
}

/**
 * Atlas Cloud Provider 的**配置形状**（由产品数据注入）。
 *
 * 该厂商用一个 key 暴露一整系模型，因此「模型档位 → 网关模型名 + 输入图模式」
 * 是当前产品的接入清单，不是 Atlas Cloud 的通用机制。
 */
export interface AtlasCloudModelConfig {
  /** 网关侧的模型名。 */
  model: string
  /** 该调用需要的输入图模式。 */
  images: 'none' | 'single' | 'multi'
}

export interface AtlasCloudProviderConfig {
  /** 模型 id → 调用参数。 */
  models: Record<string, AtlasCloudModelConfig>
}

type AtlasCloudEnvelope<T> = {
  code?: number | string
  message?: string
  data?: T
}

type AtlasCloudPrediction = {
  id?: string
  status?: string
  outputs?: string[] | null
  error?: string
  has_nsfw_contents?: boolean | null
}

export class AtlasCloudProvider implements AIProvider {
  readonly name = 'atlascloud'
  readonly modality = 'image' as const
  readonly models: readonly string[]

  constructor(private readonly config: AtlasCloudProviderConfig) {
    this.models = Object.keys(config.models)
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const handle = await this.submitTask(request)
    const startedAt = Date.now()

    while (Date.now() - startedAt < atlasCloudPollTimeoutMs()) {
      const task = await this.getTaskResult(handle.taskId, request.model)

      if (task.state === 'completed' && task.result) {
        return task.result
      }

      if (task.state === 'failed') {
        throw new Error(task.error || 'Atlas Cloud task failed')
      }

      await sleep(atlasCloudPollIntervalMs())
    }

    throw new Error('Atlas Cloud request timed out before a result was available')
  }

  async submitTask(request: GenerateRequest): Promise<AITaskHandle> {
    const config = this.getModelConfig(request.model)
    const safetyTolerance = readParamString(request, 'safety_tolerance')

    const body: Record<string, unknown> = {
      model: config.model,
      prompt: request.prompt,
      seed: readParamNumber(request, 'seed'),
      num_images: readParamNumber(request, 'num_images'),
      output_format: readParamString(request, 'output_format'),
      safety_tolerance: safetyTolerance ? Number(safetyTolerance) : undefined,
      aspect_ratio: readParamString(request, 'aspect_ratio'),
      guidance_scale: readParamNumber(request, 'guidance_scale'),
      enable_base64_output: false,
    }

    if (config.images === 'single') {
      body.images = [requireSingleImage(request.model, request)]
    } else if (config.images === 'multi') {
      body.images = requireMultipleImages(request.model, request)
    }

    const response = await postAtlasCloud<AtlasCloudPrediction>(
      '/api/v1/model/generateImage',
      body
    )
    const taskId = response.data?.id

    if (!taskId) {
      throw new Error('Atlas Cloud did not return a prediction id')
    }

    return { provider: this.name, taskId, raw: response }
  }

  async getTaskResult(taskId: string, model: string): Promise<AITaskResult> {
    this.getModelConfig(model)

    const response = await getAtlasCloud<AtlasCloudPrediction>(
      `/api/v1/model/prediction/${encodeURIComponent(taskId)}`
    )
    const prediction = response.data ?? {}
    const state = toTaskState(prediction)

    return {
      provider: this.name,
      taskId,
      state,
      result:
        state === 'completed'
          ? normalizeGenerateResult(this.name, model, {
              images: prediction.outputs ?? [],
            })
          : undefined,
      error:
        state === 'failed'
          ? prediction.error || 'Atlas Cloud task failed'
          : undefined,
      raw: response,
    }
  }

  /** 未登记的模型直接报错，不回退到某个「默认模型名」。 */
  private getModelConfig(model: string): AtlasCloudModelConfig {
    const config = this.config.models[model]

    if (!config) {
      throw new Error(`${this.name} does not support model "${model}"`)
    }

    return config
  }
}

function toTaskState(prediction: AtlasCloudPrediction): AITaskState {
  const status = (prediction.status || '').toLowerCase()

  if (prediction.outputs?.length) {
    return 'completed'
  }

  if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
    return 'failed'
  }

  if (['queued', 'starting', 'pending'].includes(status)) {
    return 'queued'
  }

  return 'processing'
}

function getAtlasCloudApiKey(): string {
  const key = process.env.ATLASCLOUD_API_KEY?.trim()

  if (!key) {
    throw new Error('ATLASCLOUD_API_KEY is not configured')
  }

  return key
}

async function postAtlasCloud<T>(
  path: string,
  body: Record<string, unknown>
): Promise<AtlasCloudEnvelope<T>> {
  const response = await fetch(`${atlasCloudBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getAtlasCloudApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pruneUndefined(body)),
  })

  return readAtlasCloudResponse<T>(response)
}

async function getAtlasCloud<T>(path: string): Promise<AtlasCloudEnvelope<T>> {
  const response = await fetch(`${atlasCloudBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${getAtlasCloudApiKey()}` },
  })

  return readAtlasCloudResponse<T>(response)
}

async function readAtlasCloudResponse<T>(
  response: Response
): Promise<AtlasCloudEnvelope<T>> {
  const text = await response.text()
  let payload: AtlasCloudEnvelope<T> | null = null

  try {
    payload = text ? (JSON.parse(text) as AtlasCloudEnvelope<T>) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      `Atlas Cloud request failed (${response.status}): ${
        payload?.message || text || response.statusText
      }`
    )
  }

  if (!payload) {
    throw new Error('Atlas Cloud returned an empty response')
  }

  return payload
}
