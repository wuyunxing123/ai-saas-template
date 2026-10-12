/**
 * StorageProvider 注册表。
 *
 * 当前只有 R2；未来增加 S3/OSS/COS/Local 时在此注册。
 */

import { R2StorageProvider } from './r2'
import type { StorageProvider } from '../types'
import { StorageError } from '../errors'

const registry: Record<string, StorageProvider> = {
  r2: new R2StorageProvider(),
}

export function getStorageProvider(name: string = 'r2'): StorageProvider {
  const provider = registry[name]
  if (!provider) {
    throw new StorageError(`Unknown storage provider: ${name}`, 'PROVIDER_ERROR')
  }
  return provider
}

export function listStorageProviderNames(): string[] {
  return Object.keys(registry)
}
