/**
 * Object Key 生成与校验。
 *
 * 规范：{namespace}/{userId}/{resourceId?}/{filename}
 *
 * 安全约束：
 *   - 所有 segment 经过 sanitize，禁止路径穿越
 *   - filename 不直接使用用户提供的原始文件名
 *   - 总长度受控
 */

import { StorageError } from './errors'

const EXTENSION_MAP: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp3': 'mp3',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/json': 'json',
}

export function buildObjectKey(params: {
  namespace: string
  userId: string
  resourceId?: string
  filename: string
}): string {
  const ns = sanitizeSegment(params.namespace)
  const uid = sanitizeSegment(params.userId)
  const parts = [ns, uid]

  if (params.resourceId) {
    parts.push(sanitizeSegment(params.resourceId))
  }

  const filename = sanitizeFilename(params.filename)
  if (!filename) {
    throw new StorageError('Empty filename after sanitization', 'INVALID_KEY')
  }

  parts.push(filename)
  return parts.join('/')
}

export function sanitizeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return normalized.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function sanitizeFilename(name: string): string {
  // 去掉路径分隔符与穿越序列
  let cleaned = name.replace(/[\\/]/g, '-').replace(/\.\./g, '-')
  // 只允许安全字符
  cleaned = cleaned.replace(/[^a-zA-Z0-9._-]/g, '-')
  return cleaned.slice(0, 255)
}

export function generateFilename(params: {
  contentType: string
  prefix?: string
}): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 10)
  const ext = extensionFromContentType(params.contentType)
  const prefix = params.prefix ? `${params.prefix}-` : ''
  return `${prefix}${timestamp}-${random}.${ext}`
}

function extensionFromContentType(contentType: string): string {
  return EXTENSION_MAP[contentType] || 'bin'
}

export function validateKey(key: string): void {
  if (!key || typeof key !== 'string') {
    throw new StorageError('Storage key must be a non-empty string', 'INVALID_KEY')
  }
  if (key.startsWith('/') || key.startsWith('\\')) {
    throw new StorageError('Storage key must not start with a path separator', 'INVALID_KEY')
  }
  if (key.includes('..')) {
    throw new StorageError('Storage key must not contain path traversal sequences', 'PATH_TRAVERSAL')
  }
}
