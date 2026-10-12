/**
 * Task Result 归一化（规格 §20）
 *
 * 目标：
 *   不要把 fal response / KIE response / WaveSpeed response 直接暴露给业务层。
 *   业务层只依赖统一结构；Provider 原始响应保留在 `raw` 里仅供调试。
 *
 * 为什么需要 `type`
 * ----------------
 * 现有 `GeneratedAsset`（`src/lib/ai/types.ts`）只有
 * `url / width / height / contentType / fileSize`，**没有资源类型**。
 * 图片时代看不出问题；一旦接入视频 / 音频 Provider，
 * 业务层无法区分该渲染 <img> 还是 <video>。
 * 规格 §35 的验收问题 19 明确问了「未来加入视频 Provider 需要改哪些地方」——
 * 加上 `type` 就是为了让答案是「只改 Provider，不改业务层」。
 */

import type { AIModality, GenerateResult } from '@/lib/ai/types'

/** 统一资源类型。比 `AIModality` 更贴近「单个产出的形态」。 */
export type TaskAssetType = 'image' | 'video' | 'audio' | 'text' | 'unknown'

/** 归一化后的单个产出资源。 */
export interface TaskAsset {
  type: TaskAssetType
  url: string
  /** MIME，例如 `image/png`。Provider 未给出时按 `type` 推断。 */
  mimeType: string
  width?: number
  height?: number
  fileSize?: number
  /** Provider 原始 URL（转存到自有 Storage 后，与 `url` 不同）。 */
  sourceUrl?: string
  /** 自有 Storage 的 object key。 */
  key?: string
}

/** 归一化后的任务结果。 */
export interface TaskResult {
  assets: TaskAsset[]
  /** 统一小写的 provider 名称。 */
  provider: string
  model: string
  /** 模型模态，便于业务层快速判断产出形态。 */
  modality: AIModality
  /** Provider 返回的额外信息（seed 等）。 */
  metadata?: Record<string, unknown>
}

const MIME_BY_TYPE: Record<TaskAssetType, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  text: 'text/plain',
  unknown: 'application/octet-stream',
}

const MODALITY_TO_TYPE: Record<AIModality, TaskAssetType> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  text: 'text',
}

/** 按 URL / contentType 猜测资源类型（用于覆盖模态推断）。 */
function guessTypeFromAsset(
  asset: { url?: string; contentType?: string }
): TaskAssetType | null {
  const hint = `${asset.contentType ?? ''} ${asset.url ?? ''}`.toLowerCase()

  if (/\.(png|jpe?g|webp|gif|avif|bmp)(\?|$)|^image\//.test(hint)) return 'image'
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)|^video\//.test(hint)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|flac)(\?|$)|^audio\//.test(hint)) return 'audio'

  return null
}

/**
 * 把 `AIService.generate()` / `getTaskResult()` 的结果归一化成 `TaskResult`。
 *
 * `modality` 由调用方从模型定义传入（`getModel(id).modality`），
 * 因为 `GenerateResult` 本身不含模态信息。
 */
export function normalizeTaskResult(
  result: GenerateResult,
  modality: AIModality
): TaskResult {
  const fallbackType = MODALITY_TO_TYPE[modality] ?? 'unknown'

  const assets: TaskAsset[] = (result.assets ?? []).map((asset) => {
    const guessed = guessTypeFromAsset(asset)
    const type: TaskAssetType = guessed ?? fallbackType

    const anyAsset = asset as Record<string, unknown>

    return {
      type,
      url: asset.url,
      mimeType:
        (typeof asset.contentType === 'string' && asset.contentType) ||
        MIME_BY_TYPE[type],
      ...(typeof asset.width === 'number' ? { width: asset.width } : {}),
      ...(typeof asset.height === 'number' ? { height: asset.height } : {}),
      ...(typeof asset.fileSize === 'number' ? { fileSize: asset.fileSize } : {}),
      // 转存到自有 Storage 后由 persistResult 补上
      ...(typeof anyAsset.sourceUrl === 'string'
        ? { sourceUrl: anyAsset.sourceUrl }
        : {}),
      ...(typeof anyAsset.key === 'string' ? { key: anyAsset.key } : {}),
    }
  })

  return {
    assets,
    provider: result.provider,
    model: result.model,
    modality,
    ...(typeof result.seed === 'number' ? { metadata: { seed: result.seed } } : {}),
  }
}

/**
 * 从 `output_metadata`（JSONB）还原成 `TaskResult`。
 *
 * 用于把落库的结果读回成领域对象。若结构不合法返回 null
 * —— 调用方需要能容忍历史数据的形状差异。
 */
export function parseTaskResult(value: unknown): TaskResult | null {
  if (!value || typeof value !== 'object') return null

  const raw = value as Record<string, unknown>

  if (!Array.isArray(raw.assets)) return null

  const assets = raw.assets
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      type: (typeof a.type === 'string' ? a.type : 'unknown') as TaskAssetType,
      url: typeof a.url === 'string' ? a.url : '',
      mimeType:
        typeof a.mimeType === 'string'
          ? a.mimeType
          : MIME_BY_TYPE[(typeof a.type === 'string' ? a.type : 'unknown') as TaskAssetType],
      ...(typeof a.width === 'number' ? { width: a.width } : {}),
      ...(typeof a.height === 'number' ? { height: a.height } : {}),
      ...(typeof a.fileSize === 'number' ? { fileSize: a.fileSize } : {}),
      ...(typeof a.sourceUrl === 'string' ? { sourceUrl: a.sourceUrl } : {}),
      ...(typeof a.key === 'string' ? { key: a.key } : {}),
    }))
    .filter((a) => a.url)

  const modality =
    typeof raw.modality === 'string' &&
    ['image', 'video', 'audio', 'text'].includes(raw.modality)
      ? (raw.modality as AIModality)
      : 'image'

  return {
    assets,
    provider: typeof raw.provider === 'string' ? raw.provider : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    modality,
    ...(raw.metadata && typeof raw.metadata === 'object'
      ? { metadata: raw.metadata as Record<string, unknown> }
      : {}),
  }
}
