import { createHmac, timingSafeEqual } from 'node:crypto'

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
  getHeader,
  pruneUndefined,
  readParamNumber,
  readParamString,
  requireMultipleImages,
  requireSingleImage,
  sleep,
} from '@/lib/ai/utils'

/** 部署参数在请求时读 env，不在模块加载时读（理由同 atlascloud provider）。 */
function waveSpeedBaseUrl() {
  return process.env.WAVESPEED_API_BASE_URL?.trim() || 'https://api.wavespeed.ai/api/v3'
}
function waveSpeedPollIntervalMs() {
  return Number(process.env.WAVESPEED_POLL_INTERVAL_MS || 2000)
}
function waveSpeedPollTimeoutMs() {
  return Number(process.env.WAVESPEED_POLL_TIMEOUT_MS || 50000)
}

/**
 * WaveSpeed Provider 的**配置形状**（由产品数据注入）。
 *
 * 「哪个模型走哪条 endpoint」属于当前产品的接入清单，不属于 WaveSpeed 的通用机制。
 */
export interface WaveSpeedProviderConfig {
  /** 模型 id → WaveSpeed 的 endpoint 路径。 */
  models: Record<string, string>
}

type WaveSpeedPrediction = {
  code?: number
  message?: string
  data?: {
    id?: string
    model?: string
    outputs?: string[]
    status?: string
    error?: string
    timings?: Record<string, unknown>
    has_nsfw_contents?: boolean[]
  }
}

export class WaveSpeedProvider implements AIProvider {
  readonly name = 'wavespeed'
  readonly modality = 'image' as const
  readonly models: readonly string[]

  constructor(private readonly config: WaveSpeedProviderConfig) {
    this.models = Object.keys(config.models)
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const endpoint = this.getEndpoint(request.model)
    const response = await postWaveSpeed(endpoint, {
      ...buildWaveSpeedInput(request),
      enable_sync_mode: true,
    })
    const normalized = normalizeWaveSpeedTask(response, request.model, this.name)

    if (normalized.state === 'completed' && normalized.result) {
      return normalized.result
    }

    if (!response.data?.id) {
      throw new Error('WaveSpeed did not return a prediction id')
    }

    const startedAt = Date.now()

    while (Date.now() - startedAt < waveSpeedPollTimeoutMs()) {
      const task = await this.getTaskResult(response.data.id, request.model)

      if (task.state === 'completed' && task.result) {
        return task.result
      }

      if (task.state === 'failed') {
        throw new Error(task.error || 'WaveSpeed task failed')
      }

      await sleep(waveSpeedPollIntervalMs())
    }

    throw new Error('WaveSpeed request timed out before a result was available')
  }

  async submitTask(request: GenerateRequest): Promise<AITaskHandle> {
    const endpoint = this.getEndpoint(request.model)
    const response = await postWaveSpeed(endpoint, {
      ...buildWaveSpeedInput(request),
      webhook_url: request.webhookUrl,
    })

    const taskId = response.data?.id

    if (!taskId) {
      throw new Error('WaveSpeed did not return a prediction id')
    }

    return { provider: this.name, taskId, raw: response }
  }

  async getTaskResult(taskId: string, model: string): Promise<AITaskResult> {
    this.getEndpoint(model)

    const response = await getWaveSpeed(`/predictions/${taskId}/result`)
    const normalized = normalizeWaveSpeedTask(response, model, this.name)

    return {
      provider: this.name,
      taskId,
      state: normalized.state,
      result: normalized.result,
      error: normalized.error,
      raw: response,
    }
  }

  async verifyWebhook(
    rawBody: string,
    headers: Headers | Record<string, string | undefined>
  ): Promise<boolean> {
    const secret = normalizeWebhookSecret(
      process.env.WAVESPEED_WEBHOOK_SECRET?.trim()
    )

    if (!secret) {
      return false
    }

    const webhookId = getHeader(headers, 'webhook-id')
    const timestamp = getHeader(headers, 'webhook-timestamp')
    const signatureHeader = getHeader(headers, 'webhook-signature')

    if (!webhookId || !timestamp || !signatureHeader) {
      return false
    }

    const timestampNumber = Number(timestamp)

    if (!Number.isFinite(timestampNumber)) {
      return false
    }

    if (Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
      return false
    }

    const payload = `${webhookId}.${timestamp}.${rawBody}`
    const expected = createHmac('sha256', secret).update(payload).digest('hex')

    return extractWaveSpeedSignatures(signatureHeader).some((signature) =>
      safeEqual(expected, signature)
    )
  }

  /** 未登记的模型直接报错，不回退到某个「默认端点」。 */
  private getEndpoint(model: string): string {
    const endpoint = this.config.models[model]

    if (!endpoint) {
      throw new Error(`${this.name} does not support model "${model}"`)
    }

    return endpoint
  }
}

function getWaveSpeedApiKey() {
  const key = process.env.WAVESPEED_API_KEY?.trim()

  if (!key) {
    throw new Error('WAVESPEED_API_KEY is not configured')
  }

  return key
}

async function postWaveSpeed(
  endpoint: string,
  body: Record<string, unknown>
): Promise<WaveSpeedPrediction> {
  const apiKey = getWaveSpeedApiKey()
  const response = await fetch(`${waveSpeedBaseUrl()}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: JSON.stringify(pruneUndefined(body)),
  })

  const json = (await response.json()) as WaveSpeedPrediction

  if (!response.ok) {
    throw new Error(
      json.message || `WaveSpeed request failed with ${response.status}`
    )
  }

  return json
}

async function getWaveSpeed(path: string): Promise<WaveSpeedPrediction> {
  const apiKey = getWaveSpeedApiKey()
  const response = await fetch(`${waveSpeedBaseUrl()}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
  })

  const json = (await response.json()) as WaveSpeedPrediction

  if (!response.ok) {
    throw new Error(
      json.message || `WaveSpeed request failed with ${response.status}`
    )
  }

  return json
}

function buildWaveSpeedInput(request: GenerateRequest): Record<string, unknown> {
  const base: Record<string, unknown> = {
    prompt: request.prompt,
    aspect_ratio: readParamString(request, 'aspect_ratio'),
    seed: readParamNumber(request, 'seed'),
    num_images: readParamNumber(request, 'num_images'),
    guidance_scale: readParamNumber(request, 'guidance_scale'),
    output_format: readParamString(request, 'output_format'),
    safety_tolerance: readParamString(request, 'safety_tolerance'),
  }

  const inputImages = request.inputImages ?? []

  if (inputImages.length === 0) {
    return pruneUndefined(base)
  }

  if (inputImages.length === 1) {
    return pruneUndefined({
      ...base,
      image: requireSingleImage(request.model, request),
    })
  }

  return pruneUndefined({
    ...base,
    images: requireMultipleImages(request.model, request),
  })
}

function normalizeWaveSpeedTask(
  response: WaveSpeedPrediction,
  model: string,
  providerName: string
): { state: AITaskState; result?: GenerateResult; error?: string } {
  const status = response.data?.status || 'created'

  if (status === 'failed') {
    return {
      state: 'failed',
      error: response.data?.error || response.message || 'WaveSpeed task failed',
    }
  }

  if (status !== 'completed') {
    return { state: status === 'processing' ? 'processing' : 'queued' }
  }

  const payload: Record<string, unknown> = {
    images: response.data?.outputs?.map((url) => ({ url })) || [],
    timings: response.data?.timings,
    has_nsfw_concepts: response.data?.has_nsfw_contents,
  }

  return {
    state: 'completed',
    result: normalizeGenerateResult(providerName, model, payload),
  }
}

function normalizeWebhookSecret(secret?: string) {
  if (!secret) {
    return ''
  }

  return secret.startsWith('whsec_') ? secret.slice(6) : secret
}

function extractWaveSpeedSignatures(signatureHeader: string) {
  return signatureHeader
    .split(/\s+/)
    .flatMap((part) => part.split(','))
    .map((part) => {
      const [, value] = part.split('=')
      return (value || part).trim()
    })
    .filter(Boolean)
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}
