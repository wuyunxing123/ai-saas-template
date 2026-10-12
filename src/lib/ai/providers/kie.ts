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
  requireSingleImage,
  sleep,
} from '@/lib/ai/utils'

/** 部署参数在请求时读 env，不在模块加载时读（理由同 atlascloud provider）。 */
function kieBaseUrl() {
  return process.env.KIE_API_BASE_URL?.trim() || 'https://api.kie.ai'
}
function kiePollIntervalMs() {
  return Number(process.env.KIE_POLL_INTERVAL_MS || 2000)
}
function kiePollTimeoutMs() {
  return Number(process.env.KIE_POLL_TIMEOUT_MS || 50000)
}

/**
 * KIE Provider 的**配置形状**（由产品数据注入，见 `src/lib/products/<id>/provider-data.ts`）。
 *
 * 模型名映射与 API 路径都属于「当前产品接的是什么」，不是 KIE 这家厂商的通用机制，
 * 所以不写死在本文件里。
 */
export interface KieModelConfig {
  /** KIE 侧的模型名。 */
  model: string
  /** 该模型是否需要输入图。 */
  requiresImage: boolean
}

export interface KieProviderConfig {
  /** 模型 id → KIE 调用参数。KIE 不支持多图编辑，因此产品数据里不会出现 `*-multi`。 */
  models: Record<string, KieModelConfig>
  /** 下单接口路径。 */
  generatePath: string
  /** 查询接口路径（后面会自动拼 `?taskId=`）。 */
  recordPath: string
}

type KieGenerateResponse = {
  taskId?: string
  code?: number
  message?: string
  data?: { taskId?: string }
}

type KieRecordResponse = {
  code?: number
  message?: string
  data?: Record<string, unknown>
  resultImageUrl?: string
  successFlag?: number
}

export class KieProvider implements AIProvider {
  readonly name = 'kie'
  readonly modality = 'image' as const
  readonly models: readonly string[]

  constructor(private readonly config: KieProviderConfig) {
    this.models = Object.keys(config.models)
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const handle = await this.submitTask(request)
    const startedAt = Date.now()

    while (Date.now() - startedAt < kiePollTimeoutMs()) {
      const task = await this.getTaskResult(handle.taskId, request.model)

      if (task.state === 'completed' && task.result) {
        return task.result
      }

      if (task.state === 'failed') {
        throw new Error(task.error || 'KIE task failed')
      }

      await sleep(kiePollIntervalMs())
    }

    throw new Error('KIE request timed out before a result was available')
  }

  async submitTask(request: GenerateRequest): Promise<AITaskHandle> {
    const config = this.getModelConfig(request.model)
    const response = await postKie<KieGenerateResponse>(
      this.config.generatePath,
      pruneUndefined({
        prompt: request.prompt,
        model: config.model,
        image_url: config.requiresImage
          ? requireSingleImage(request.model, request)
          : undefined,
        // KIE 的历史文档里 snake_case / camelCase 混用，两个都发以保证兼容。
        aspect_ratio: readParamString(request, 'aspect_ratio'),
        aspectRatio: readParamString(request, 'aspect_ratio'),
        guidance_scale: readParamNumber(request, 'guidance_scale'),
        guidanceScale: readParamNumber(request, 'guidance_scale'),
        num_images: readParamNumber(request, 'num_images'),
        numImages: readParamNumber(request, 'num_images'),
        seed: readParamNumber(request, 'seed'),
        output_format: readParamString(request, 'output_format'),
        outputFormat: readParamString(request, 'output_format'),
        safety_tolerance: readParamString(request, 'safety_tolerance'),
        safetyTolerance: readParamString(request, 'safety_tolerance'),
        callBackUrl: request.webhookUrl,
      })
    )

    const taskId = response.taskId || response.data?.taskId

    if (!taskId) {
      throw new Error('KIE did not return a taskId')
    }

    return { provider: this.name, taskId, raw: response }
  }

  async getTaskResult(taskId: string, model: string): Promise<AITaskResult> {
    this.getModelConfig(model)

    const response = await getKie<KieRecordResponse>(
      `${this.config.recordPath}?taskId=${encodeURIComponent(taskId)}`
    )
    const normalized = normalizeKiePayload(response, model, this.name)

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
    const secret = process.env.KIE_WEBHOOK_SIGNING_SECRET?.trim()

    if (!secret) {
      return false
    }

    const signature =
      getHeader(headers, 'x-kie-signature') || getHeader(headers, 'x-signature')
    const timestamp =
      getHeader(headers, 'x-kie-timestamp') || getHeader(headers, 'x-timestamp')

    if (!signature || !timestamp) {
      return false
    }

    let taskId = ''

    try {
      const parsed = JSON.parse(rawBody) as {
        taskId?: string
        data?: { taskId?: string }
      }
      taskId = parsed.taskId || parsed.data?.taskId || ''
    } catch {
      return false
    }

    if (!taskId) {
      return false
    }

    const payload = `${taskId}.${timestamp}`
    const expected = createHmac('sha256', secret).update(payload).digest('base64')

    return safeEqual(expected, signature)
  }

  /** 未登记的模型直接报错，不回退到某个「默认模型名」。 */
  private getModelConfig(model: string): KieModelConfig {
    const config = this.config.models[model]

    if (!config) {
      throw new Error(`${this.name} does not support model "${model}"`)
    }

    return config
  }
}

function getKieApiKey() {
  const key = process.env.KIE_API_KEY?.trim()

  if (!key) {
    throw new Error('KIE_API_KEY is not configured')
  }

  return key
}

async function postKie<T>(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${kieBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getKieApiKey()}`,
    },
    body: JSON.stringify(body),
  })

  const json = (await response.json()) as T & { message?: string }

  if (!response.ok) {
    throw new Error(json.message || `KIE request failed with ${response.status}`)
  }

  return json
}

async function getKie<T>(path: string) {
  const response = await fetch(`${kieBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${getKieApiKey()}` },
  })

  const json = (await response.json()) as T & { message?: string }

  if (!response.ok) {
    throw new Error(json.message || `KIE request failed with ${response.status}`)
  }

  return json
}

function normalizeKiePayload(
  response: KieRecordResponse,
  model: string,
  providerName: string
): { state: AITaskState; result?: GenerateResult; error?: string } {
  const data = response.data ?? {}
  const successFlag =
    typeof response.successFlag === 'number'
      ? response.successFlag
      : typeof data.successFlag === 'number'
        ? (data.successFlag as number)
        : 0

  if (successFlag === 0) {
    return { state: 'processing' }
  }

  if (successFlag !== 1) {
    return {
      state: 'failed',
      error:
        (data.errorMessage as string | undefined) ||
        response.message ||
        'KIE task failed',
    }
  }

  const imageUrl =
    (data.resultImageUrl as string | undefined) ||
    (response.resultImageUrl as string | undefined)

  const payload: Record<string, unknown> = imageUrl
    ? { ...data, images: [{ url: imageUrl }] }
    : data

  return {
    state: 'completed',
    result: normalizeGenerateResult(providerName, model, payload),
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}
