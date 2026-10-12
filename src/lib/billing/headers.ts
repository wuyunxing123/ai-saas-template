/**
 * Header 读取工具
 *
 * Webhook 的 header 可能以 `Headers` 对象（Next.js route）或普通对象
 * （测试 / 内部调用）传入，这里统一处理并做大小写不敏感匹配。
 */

import type { HeadersLike } from '@/lib/billing/types'

export function readHeader(headers: HeadersLike, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }

  const lowered = name.toLowerCase()

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowered) {
      return value
    }
  }

  return undefined
}

/** 把 Headers 转成普通对象（部分 SDK 需要）。 */
export function headersToRecord(
  headers: HeadersLike
): Record<string, string | undefined> {
  if (!(headers instanceof Headers)) {
    return headers
  }

  const record: Record<string, string | undefined> = {}

  headers.forEach((value, key) => {
    record[key] = value
  })

  return record
}
