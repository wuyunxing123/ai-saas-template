/**
 * Storage Infrastructure — Phase 5
 *
 * 业务层唯一入口：StorageService（src/lib/storage/service.ts）
 * 禁止业务代码直接 import R2 SDK 或 S3Client。
 */

export interface StorageObject {
  key: string
  url: string
  size?: number
  contentType?: string
  etag?: string
  provider?: string
  metadata?: Record<string, string>
}

export type StorageNamespace = 'uploads' | 'generated' | 'temporary'

export interface UploadInput {
  /** 文件数据 */
  data: Blob | ArrayBuffer | Buffer
  /** Content-Type，如 'image/png' */
  contentType: string
  /** 原始展示名（仅写入 metadata，不参与 key 生成） */
  originalName?: string
  /** 用户 ID，用于 key 隔离 */
  userId: string
  /** 命名空间，决定 key 前缀 */
  namespace: StorageNamespace
  /** 可选资源 ID，用于分组 */
  resourceId?: string
  /** 可选 metadata（会被 sanitize 后写入对象 metadata） */
  metadata?: Record<string, string>
}

export interface StorageProvider {
  readonly name: string
  /** Provider 是否已完成配置（env 变量齐全）。 */
  isConfigured(): boolean
  /** 上传对象。key 已由 StorageService 生成并校验。 */
  upload(
    key: string,
    data: Blob | ArrayBuffer | Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<StorageObject>
  /** 根据 key 返回可访问 URL。 */
  getUrl(key: string): string
  /** 删除对象。key 不存在时不抛异常（幂等删除）。 */
  delete(key: string): Promise<void>
}
