/**
 * Storage 层统一异常。
 *
 * 不要把 Provider SDK 原始异常直接泄漏到 API 响应。
 */

export type StorageErrorCode =
  | 'UPLOAD_FAILED'
  | 'DELETE_FAILED'
  | 'NOT_FOUND'
  | 'INVALID_KEY'
  | 'PROVIDER_ERROR'
  | 'NOT_CONFIGURED'
  | 'PATH_TRAVERSAL'
  | 'DOWNLOAD_FAILED'

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: StorageErrorCode,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'StorageError'
  }
}
