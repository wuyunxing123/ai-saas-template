/**
 * FluxKontextService —— **Flux 产品业务服务**（Phase 8 重新定位）
 *
 * 边界（规格 §7 / §10 / §26）
 * --------------------------
 * 它是 **product / business layer**，不是 AI 基础设施服务：
 *
 *   FluxKontextService  ──►  WorkflowService  ──►  AITask
 *                                                   ├─ AIService → AIProvider
 *                                                   ├─ StorageService
 *                                                   └─ CreditService（结算）
 *
 * **禁止**它做（这些是基础设施的职责）：
 *   · 直接调用 AI Provider / 厂商 SDK
 *   · 直接读写 R2 / S3
 *   · 直接操作 users.credits / credit_transactions（扣费 / 退款）
 *   · 直接推进 Task 状态机
 *
 * 它**只**负责：
 *   1. 接收 Flux 专属输入（action / image_urls / …）
 *   2. 校验 Flux 专属参数
 *   3. 翻译成通用 CreateTaskInput（action → model，Flux 参数 → parameters）
 *   4. 调用 `WorkflowService.createTask()`（同步模式，保持前端体验）
 *   5. 把 AITask 结果映射回 Flux 兼容响应
 */

import { AIService } from '@/lib/ai/service'
import { checkUserCredits } from '@/lib/services/credits'
import { StorageService } from '@/lib/storage/service'
import { actionToModelId, isFluxKontextAction } from '@/lib/products/flux-kontext/actions'
import { isFluxAspectRatio, listAspectRatios } from '@/lib/products/flux-kontext/capabilities'
import { WorkflowService } from '@/lib/workflow/service'
import { TaskError } from '@/lib/workflow/errors'
import type { AITask, TaskAsset } from '@/lib/workflow/types'
import type {
  FluxKontextImage,
  FluxKontextResult,
  ImageGenerationProviderName,
} from '@/lib/products/flux-kontext/types'

/** 产品层校验错误（可安全对外展示 code）。 */
export class FluxProductError extends Error {
  constructor(
    readonly code: 'INVALID_ACTION' | 'INVALID_ASPECT_RATIO' | 'GENERATION_FAILED',
    message: string
  ) {
    super(message)
    this.name = 'FluxProductError'
  }
}

/** Flux 生成入参（已由路由完成鉴权与内容安全）。 */
export interface FluxGenerateParams {
  userId: string
  action: string
  prompt: string
  imageUrl?: string
  imageUrls?: string[]
  aspectRatio?: string
  seed?: number
  guidanceScale?: number
  numImages?: number
  safetyTolerance?: string
  outputFormat?: string
}

export interface FluxGenerationOutcome {
  task: AITask
  /** 生成后用户余额（供响应里的 credits_remaining）。 */
  creditsRemaining: number
  provider: ImageGenerationProviderName
}

export class FluxKontextService {
  /** 该 action 是否是合法的 Flux action。 */
  static isValidAction(action: string): boolean {
    return isFluxKontextAction(action)
  }

  /**
   * 执行一次 Flux 生成。
   *
   * 走 `WorkflowService.createTask({ waitForResult: true })` —— Phase 7 的**同步路径**：
   * 内部完成「建 ai_task → 扣积分 → 提交 Provider → 归一化 → 落 Storage → 结算」，
   * 失败时自动退款。因此前端仍拿到同步结果，但任务已进入 AITask 基础设施。
   *
   * @throws FluxProductError —— action 非法 / 生成失败
   * @throws TaskError        —— 余额不足 / 模型未知（由 WorkflowService 抛出）
   */
  static async generate(params: FluxGenerateParams): Promise<FluxGenerationOutcome> {
    if (!isFluxKontextAction(params.action)) {
      throw new FluxProductError(
        'INVALID_ACTION',
        `Unsupported action: ${params.action}`
      )
    }

    const model = actionToModelId(params.action)
    if (!model) {
      throw new FluxProductError(
        'INVALID_ACTION',
        `Unsupported action: ${params.action}`
      )
    }

    // 宽高比必须在产品能力表里。旧实现把它一路带到 fal，由
    // `aspectRatioToFalImageSize()` 的 `default` 分支悄悄换成 4:3 ——
    // 用户拿到的是另一个比例的结果，却按原比例扣了积分。
    if (params.aspectRatio && !isFluxAspectRatio(params.aspectRatio)) {
      throw new FluxProductError(
        'INVALID_ASPECT_RATIO',
        `Unsupported aspect ratio: ${params.aspectRatio}. Available: ${listAspectRatios().join(', ')}`
      )
    }

    const inputImages = params.imageUrls?.length
      ? params.imageUrls
      : params.imageUrl
        ? [params.imageUrl]
        : undefined

    const task = await WorkflowService.createTask({
      userId: params.userId,
      model,
      // 不指定 Provider：由 Core 按「环境变量偏好 → 模型 defaultProvider」解析。
      // 原先这里产品自己读 env 并在认不出时**硬回退到 'fal'**，等于把产品配置
      // 塞回产品层再做一次错误兜底；解析顺序属于 Core 机制，只保留一份。
      prompt: params.prompt,
      inputImages,
      parameters: buildParameters(params),
      // 同步路径：保持 `/api/flux-kontext` 的「一次请求拿到结果」体验
      waitForResult: true,
    }).then((r) => r.task)

    if (task.status !== 'completed') {
      // 请求级错误（缺模型要求的输入图 / 未知模型 / Provider 不支持）是调用方的问题，
      // 原样抛 TaskError 让路由回 4xx —— 把「你没带图」报成 500 会让客户端以为服务坏了。
      const code = task.error?.code
      if (
        code === 'INVALID_REQUEST' ||
        code === 'UNKNOWN_MODEL' ||
        code === 'UNSUPPORTED_MODEL'
      ) {
        throw new TaskError(code, task.error?.message ?? 'Invalid request')
      }

      throw new FluxProductError(
        'GENERATION_FAILED',
        task.error?.message || 'Generation failed'
      )
    }

    // 结算已完成；余额用于响应（一次轻量读）
    const creditCheck = await checkUserCredits(params.userId, 0)

    return {
      task,
      creditsRemaining: creditCheck.currentCredits,
      // task.provider 是 AIProviderName(=string)；此处收敛回 Flux 的枚举
      provider: task.provider as ImageGenerationProviderName,
    }
  }

  /** 把 AITask 结果映射回 Flux 兼容结果（旧前端读 `images` 字段）。 */
  static toLegacyResult(task: AITask): FluxKontextResult {
    return {
      images: (task.result ?? []).map(toLegacyImage),
      provider: task.provider as ImageGenerationProviderName,
    }
  }

  /**
   * 上传输入文件：优先 Provider 自带存储，失败则回退 StorageService。
   * （这是 Flux 的**输入**上传，与生成结果的 Storage 落盘是两件事。）
   *
   * @param userId 用于 Storage key 隔离；未提供时使用 'anonymous'（不推荐）
   */
  static async uploadFile(file: File, userId?: string): Promise<string> {
    let providerUrl: string | null = null
    let storageUrl: string | null = null

    try {
      providerUrl = await AIService.uploadFile(file)
    } catch (error) {
      console.warn('Provider upload failed, falling back to Storage:', error)
    }

    if (StorageService.isConfigured()) {
      try {
        const uid = userId || 'anonymous'
        const result = await StorageService.uploadFile(file, {
          userId: uid,
          namespace: 'uploads',
        })
        storageUrl = result.url
      } catch (error) {
        console.warn('Storage upload failed during provider fallback:', error)
      }
    }

    if (providerUrl) {
      return providerUrl
    }

    if (storageUrl) {
      return storageUrl
    }

    throw new Error(
      'No upload backend is available. Configure provider credentials or storage.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// 内部映射
// ─────────────────────────────────────────────────────────────────────

/** Flux 参数 → 通用 `parameters`（只保留有值的项）。 */
function buildParameters(params: FluxGenerateParams): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (params.seed !== undefined) out.seed = params.seed
  if (params.guidanceScale !== undefined) out.guidance_scale = params.guidanceScale
  if (params.numImages !== undefined) out.num_images = params.numImages
  if (params.safetyTolerance !== undefined) out.safety_tolerance = params.safetyTolerance
  if (params.outputFormat !== undefined) out.output_format = params.outputFormat
  if (params.aspectRatio !== undefined) out.aspect_ratio = params.aspectRatio

  return out
}

/**
 * `TaskAsset` → 旧 `FluxKontextImage`。
 *
 * 兼容性（保持历史行为）：
 *   · `url`      = Provider 原始 URL（旧代码把它作为主 URL）
 *   · `fal_url`  = Provider 原始 URL
 *   · `r2_url`   = 自有 Storage URL（仅在成功转存时存在）
 *   · `storage`  = 'both' | 'fal'
 */
function toLegacyImage(asset: TaskAsset): FluxKontextImage {
  const providerUrl = asset.sourceUrl ?? asset.url

  return {
    url: providerUrl,
    ...(typeof asset.width === 'number' ? { width: asset.width } : {}),
    ...(typeof asset.height === 'number' ? { height: asset.height } : {}),
    content_type: asset.mimeType,
    ...(typeof asset.fileSize === 'number' ? { file_size: asset.fileSize } : {}),
    fal_url: providerUrl,
    ...(asset.key ? { r2_url: asset.url } : {}),
    storage: asset.key ? 'both' : 'fal',
  }
}
