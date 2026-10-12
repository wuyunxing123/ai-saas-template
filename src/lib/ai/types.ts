/**
 * AI Core — 通用类型定义
 *
 * 这一层只描述一件事：
 *
 *   「调用一个 AI 模型完成一次生成」
 *
 * 而不是：
 *
 *   「调用某个具体产品完成一次生成」
 *
 * 因此这里不允许出现任何具体产品名、具体厂商名、具体业务动作名。
 * 具体模型的清单属于**产品数据**（`src/lib/products/<id>/catalogue.ts`），
 * 具体厂商的调用细节属于各 Provider 实现。
 * 本文件只定义它们共同的形状。
 */

/** AI 能力类型。新增产品线时在这里扩展，而不是新增 Provider 接口。 */
export type AIModality = 'image' | 'video' | 'audio' | 'text'

/**
 * Provider 名称。
 *
 * 刻意使用 `string` 而非联合字面量：
 * Provider 是「可插拔实现」，不应该要求修改核心类型才能新增一家。
 * 合法的取值集合由当前产品绑定的 Provider 清单决定（`@/config/product`）。
 */
export type AIProviderName = string

/**
 * 一个模型的通用形状。
 *
 * 这是 **Core 的形状契约**，不是 Core 的数据：具体的模型条目由产品提供
 * （`src/lib/products/<id>/catalogue.ts`），经 `@/config/product` 绑定后由
 * `@/lib/ai/models` 查询。Core 里不存在任何具体模型的清单。
 */
export interface ModelDefinition {
  /** 模型 id，`GenerateRequest.model` 的取值。 */
  id: string
  modality: AIModality
  /** 展示名。 */
  label: string
  /** 一句话说明。 */
  description?: string
  /**
   * 需要几张输入图片。
   * - `0`：纯文本生图
   * - `1`：单图编辑
   * - `'many'`：多图编辑
   */
  requiredInputImages: 0 | 1 | 'many'
  /** 未显式指定 provider 时使用哪家。 */
  defaultProvider: AIProviderName
  /** 支持该模型的 Provider 列表。切换 Provider 不需要改业务代码。 */
  providers: AIProviderName[]
  /**
   * 一次生成的积分成本（正整数）。
   *
   * 唯一真相就是模型定义上的这个字段：UI 展示与 `WorkflowService` 实际扣减
   * 都读同一份（`getModel(id).credits`），不再各自维护价格表。
   */
  credits: number
}

/**
 * 一次生成请求。
 *
 * `model` 是唯一的必填项 —— 它决定「用哪个模型」；
 * 其余全部可选，由具体 Provider 决定如何使用。
 */
export interface GenerateRequest {
  /** 模型 id；合法取值由当前产品目录（`src/lib/products/<id>/catalogue.ts`）决定。 */
  model: string
  /**
   * 指定用哪家 Provider 执行。
   *
   * 不填时按「环境变量偏好 → 模型默认 Provider」解析。
   * 填了但该 Provider 不支持这个模型时会直接报错，
   * 不会静默换成别家 —— 静默回退会掩盖配置错误。
   */
  provider?: AIProviderName
  /** 文本提示词。纯文本模型也走这里。 */
  prompt?: string
  /** 输入图片 URL 列表（图生图 / 多图编辑 / 视频首帧）。 */
  inputImages?: string[]
  /**
   * 模型参数。
   *
   * 使用 `Record<string, unknown>` 而不是为每个模型定义参数类型：
   * 参数空间由第三方 API 决定，且各模型差异很大，
   * 在这里穷举会导致每接一个模型都要改核心类型。
   * 参数契约由 `ai/models.ts` 的 `ModelDefinition` 声明，Provider 负责映射。
   */
  parameters?: Record<string, unknown>
  /** 幂等键，透传给支持它的 Provider。 */
  idempotencyKey?: string
  /** 异步任务回调地址。 */
  webhookUrl?: string
}

/** 一次生成产出的单个资源。 */
export interface GeneratedAsset {
  url: string
  width?: number
  height?: number
  contentType?: string
  fileSize?: number
  /** Provider 返回的原始字段，保留用于调试。 */
  [key: string]: unknown
}

/** 一次生成的统一结果。所有 Provider 都必须归一化成这个形状。 */
export interface GenerateResult {
  assets: GeneratedAsset[]
  /** 实际执行本次生成的 Provider 名称。 */
  provider: AIProviderName
  /** 实际使用的模型 id。 */
  model: string
  /** 异步任务的 task id；同步生成为 undefined。 */
  taskId?: string
  seed?: number
  /** Provider 原始响应，仅用于调试，业务层不应依赖其结构。 */
  raw?: unknown
}

/** 异步任务状态。 */
export type AITaskState = 'queued' | 'processing' | 'completed' | 'failed'

/** 异步任务句柄（提交后立即返回）。 */
export interface AITaskHandle {
  provider: AIProviderName
  taskId: string
  raw?: unknown
}

/** 异步任务查询结果。 */
export interface AITaskResult {
  provider: AIProviderName
  taskId: string
  state: AITaskState
  /** 仅当 `state === 'completed'` 时存在。 */
  result?: GenerateResult
  /** 仅当 `state === 'failed'` 时存在。 */
  error?: string
  raw?: unknown
}

/**
 * AI Provider 契约。
 *
 * 业务层只依赖这个接口，永远不直接 import 具体 Provider。
 * 只有 `generate` 是必需的；其余按 Provider 能力实现。
 */
export interface AIProvider {
  readonly name: AIProviderName
  readonly modality: AIModality
  /** 本 Provider 支持的模型 id 列表，用于启动时校验配置。 */
  readonly models: readonly string[]

  /** 执行一次生成（同步语义：内部可以轮询，但对外是一次调用）。 */
  generate(request: GenerateRequest): Promise<GenerateResult>

  /** 上传文件到 Provider 自己的存储，返回可被该 Provider 读取的 URL。 */
  uploadFile?(file: File): Promise<string>

  /** 提交异步任务，立即返回 taskId。 */
  submitTask?(request: GenerateRequest): Promise<AITaskHandle>

  /** 查询异步任务结果。 */
  getTaskResult?(taskId: string, model: string): Promise<AITaskResult>

  /** 校验 Provider 的 webhook 签名。 */
  verifyWebhook?(
    rawBody: string,
    headers: Headers | Record<string, string | undefined>
  ): Promise<boolean>
}
