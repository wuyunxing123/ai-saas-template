/**
 * StorageService — 业务层唯一入口
 *
 * 禁止业务代码直接 import R2 SDK、S3Client 或 @aws-sdk/*。
 * 所有文件操作（上传、下载转存、删除、取 URL）统一走此处。
 */

import { getStorageProvider } from './providers'
import type { StorageObject, UploadInput, StorageNamespace } from './types'
import { StorageError } from './errors'
import { buildObjectKey, generateFilename, validateKey } from './keys'

class StorageServiceImpl {
  async upload(input: UploadInput): Promise<StorageObject> {
    const provider = getStorageProvider()

    const filename = generateFilename({
      contentType: input.contentType,
      prefix: input.namespace === 'generated' ? 'ai' : undefined,
    })

    const key = buildObjectKey({
      namespace: input.namespace,
      userId: input.userId,
      resourceId: input.resourceId,
      filename,
    })

    return provider.upload(key, input.data, input.contentType, input.metadata)
  }

  /**
   * 从 URL 下载后上传到自己的 Storage。
   * 典型场景：把 AI Provider 的输出图片转存到 R2。
   */
  async uploadFromUrl(
    url: string,
    options: {
      userId: string
      namespace: StorageNamespace
      resourceId?: string
      metadata?: Record<string, string>
    }
  ): Promise<StorageObject> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      throw new StorageError(
        `Failed to download from URL: ${response.status} ${response.statusText}`,
        'DOWNLOAD_FAILED'
      )
    }

    const data = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'application/octet-stream'

    return this.upload({
      data,
      contentType,
      userId: options.userId,
      namespace: options.namespace,
      resourceId: options.resourceId,
      metadata: {
        'source-url': url.substring(0, 200),
        ...options.metadata,
      },
    })
  }

  /**
   * 便捷方法：直接上传 File 对象。
   * 典型场景：用户在前端选择文件后通过 API 上传。
   */
  async uploadFile(
    file: File,
    options: {
      userId: string
      namespace: StorageNamespace
      resourceId?: string
      metadata?: Record<string, string>
    }
  ): Promise<StorageObject> {
    const data = await file.arrayBuffer()
    return this.upload({
      data,
      contentType: file.type || 'application/octet-stream',
      originalName: file.name,
      userId: options.userId,
      namespace: options.namespace,
      resourceId: options.resourceId,
      metadata: {
        'original-name': file.name,
        ...options.metadata,
      },
    })
  }

  getUrl(key: string): string {
    validateKey(key)
    const provider = getStorageProvider()
    return provider.getUrl(key)
  }

  async delete(key: string): Promise<void> {
    validateKey(key)
    const provider = getStorageProvider()
    return provider.delete(key)
  }

  isConfigured(): boolean {
    try {
      return getStorageProvider().isConfigured()
    } catch {
      return false
    }
  }
}

export const StorageService = new StorageServiceImpl()
