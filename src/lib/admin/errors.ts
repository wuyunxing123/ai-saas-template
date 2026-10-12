/**
 * Admin 层统一异常。
 *
 * 与 `StorageError` 同样的思路：不要在 API 响应里泄漏底层原始异常。
 */

export type AdminErrorCode =
  | 'INVALID_AMOUNT'
  | 'AMOUNT_TOO_LARGE'
  | 'MISSING_REASON'
  | 'NOT_FOUND'
  | 'GRANT_FAILED'
  | 'FORBIDDEN'

export class AdminError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: AdminErrorCode,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AdminError'
  }
}
