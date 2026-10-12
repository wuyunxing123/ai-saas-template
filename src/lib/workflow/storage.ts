/**
 * Task 结果的 Storage 落盘（规格 §21）
 *
 * 分层：
 *   Workflow  →  StorageService  →  StorageProvider  →  R2
 *
 * **禁止** Workflow 直接 import `@aws-sdk/client-s3` / R2 SDK
 * （Phase 5 的硬约束，见 docs/STORAGE.md）。
 *
 * 降级策略：单个 asset 转存失败时保留 Provider 原始 URL，
 * 不让整个任务失败 —— 用户已经付了积分，拿到 URL 比什么都拿不到好。
 */

import { StorageService } from '@/lib/storage/service'
import { logTaskError } from '@/lib/workflow/logger'
import type { TaskAsset, TaskResult } from '@/lib/workflow/result'
import type { TaskLogContext } from '@/lib/workflow/types'

/**
 * 把结果里的资源转存到自有 Storage。
 *
 * 未配置 Storage 时原样返回（自托管 / 本地开发的常见情况）。
 */
export async function persistResult(params: {
  result: TaskResult
  userId: string
  prompt?: string | null
  log?: TaskLogContext
}): Promise<TaskResult> {
  if (!StorageService.isConfigured()) {
    return params.result
  }

  const assets = await Promise.all(
    params.result.assets.map((asset) => persistAsset(asset, params))
  )

  return { ...params.result, assets }
}

async function persistAsset(
  asset: TaskAsset,
  params: { userId: string; prompt?: string | null; log?: TaskLogContext }
): Promise<TaskAsset> {
  try {
    const stored = await StorageService.uploadFromUrl(asset.url, {
      userId: params.userId,
      namespace: 'generated',
      metadata: {
        // 只留前 500 字符，且 Storage metadata 本身不对外暴露
        ...(params.prompt ? { prompt: params.prompt.slice(0, 500) } : {}),
        assetType: asset.type,
      },
    })

    return {
      ...asset,
      url: stored.url,
      sourceUrl: asset.url,
      key: stored.key,
    }
  } catch (error) {
    logTaskError('task.completed', params.log ?? { taskId: 'unknown' }, {
      message: `Storage persist failed for asset, keeping provider URL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })

    return asset
  }
}
