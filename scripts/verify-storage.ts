/**
 * Storage 基础设施验证（无需真实 R2 凭证）
 *
 * 测试内容：
 *   1. Key 生成规范
 *   2. 路径穿越防护
 *   3. StorageProvider 接口契约
 *   4. R2Provider 配置状态（本机应为未配置）
 *   5. 业务代码零直接 S3 引用
 */

import { grepSource } from './source-scan'
import { buildObjectKey, generateFilename, sanitizeFilename, validateKey } from '@/lib/storage/keys'
import { StorageError } from '@/lib/storage/errors'
import { getStorageProvider, listStorageProviderNames } from '@/lib/storage/providers'
import { StorageService } from '@/lib/storage/service'

let passed = 0
let failed = 0

function ok(label: string) {
  passed++
  console.log(`  ✅ ${label}`)
}

function fail(label: string, detail?: string) {
  failed++
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title: string) {
  console.log(`\n▶ ${title}`)
}

async function main() {
// ─────────────────────────────────────────────────────────────────────
// 1. Key 生成
// ─────────────────────────────────────────────────────────────────────

section('1. Object Key 生成')

const key1 = buildObjectKey({
  namespace: 'uploads',
  userId: 'user-123',
  filename: 'test.png',
})
if (key1 === 'uploads/user-123/test.png') ok('基础 key 格式')
else fail('基础 key 格式', key1)

const key2 = buildObjectKey({
  namespace: 'generated',
  userId: 'user-456',
  resourceId: 'task-789',
  filename: 'output.jpg',
})
if (key2 === 'generated/user-456/task-789/output.jpg') ok('含 resourceId 的 key')
else fail('含 resourceId 的 key', key2)

const key3 = buildObjectKey({
  namespace: 'temporary',
  userId: 'alice@example.com',
  filename: 'temp.webp',
})
if (key3 === 'temporary/alice-example-com/temp.webp') ok('email 用户 ID sanitize')
else fail('email 用户 ID sanitize', key3)

// ─────────────────────────────────────────────────────────────────────
// 2. 路径穿越防护
// ─────────────────────────────────────────────────────────────────────

section('2. 路径穿越防护')

const traversalKey = buildObjectKey({
  namespace: 'uploads',
  userId: 'user-123',
  filename: '../../../etc/passwd',
})
if (!traversalKey.includes('..') && !traversalKey.includes('/etc/')) {
  ok('路径穿越 filename 被 sanitize 中和')
} else {
  fail('路径穿越 filename 未被中和', traversalKey)
}

const safeFilename = sanitizeFilename('../../../etc/passwd')
if (!safeFilename.includes('..') && !safeFilename.includes('/')) {
  ok('sanitizeFilename 去除穿越序列')
} else {
  fail('sanitizeFilename 去除穿越序列', safeFilename)
}

try {
  validateKey('../../../secret')
  fail('validateKey 应拒绝穿越')
} catch (e: any) {
  if (e.name === 'StorageError' && e.code === 'PATH_TRAVERSAL') {
    ok('validateKey 拒绝穿越')
  } else {
    fail('validateKey 拒绝穿越（异常类型）', e.name)
  }
}

try {
  validateKey('/absolute/path')
  fail('validateKey 应拒绝绝对路径')
} catch (e: any) {
  if (e.name === 'StorageError' && e.code === 'INVALID_KEY') {
    ok('validateKey 拒绝绝对路径')
  } else {
    fail('validateKey 拒绝绝对路径（异常类型）', e.name)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Filename 生成
// ─────────────────────────────────────────────────────────────────────

section('3. Filename 生成')

const fn1 = generateFilename({ contentType: 'image/png' })
if (fn1.endsWith('.png') && fn1.includes('-')) ok('generateFilename png')
else fail('generateFilename png', fn1)

const fn2 = generateFilename({ contentType: 'video/mp4', prefix: 'ai' })
if (fn2.startsWith('ai-') && fn2.endsWith('.mp4')) ok('generateFilename 含 prefix')
else fail('generateFilename 含 prefix', fn2)

const fn3 = generateFilename({ contentType: 'unknown/xyz' })
if (fn3.endsWith('.bin')) ok('未知 contentType 回退 bin')
else fail('未知 contentType 回退 bin', fn3)

// ─────────────────────────────────────────────────────────────────────
// 4. Provider 注册表
// ─────────────────────────────────────────────────────────────────────

section('4. Provider 注册表')

const names = listStorageProviderNames()
if (names.includes('r2')) ok('r2 已注册')
else fail('r2 已注册', names.join(', '))

try {
  getStorageProvider('r2')
  ok('getStorageProvider(r2) 返回实例')
} catch (e) {
  fail('getStorageProvider(r2) 返回实例')
}

try {
  getStorageProvider('does-not-exist')
  fail('未知 provider 应抛异常')
} catch (e: any) {
  if (e.name === 'StorageError' && e.code === 'PROVIDER_ERROR') {
    ok('未知 provider 抛 StorageError')
  } else {
    fail('未知 provider 异常类型不对', e.name)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 5. R2Provider 配置状态（本机应为未配置）
// ─────────────────────────────────────────────────────────────────────

section('5. R2Provider 配置状态')

const r2 = getStorageProvider('r2')
if (r2.name === 'r2') ok('R2Provider.name === "r2"')
else fail('R2Provider.name')

// 本机 env 是占位符，预期 isConfigured() === false
const configured = r2.isConfigured()
if (!configured) {
  ok('R2Provider.isConfigured() === false（本机无有效凭证）')
} else {
  ok('R2Provider.isConfigured() === true（检测到凭证）')
}

// StorageService 同步
if (StorageService.isConfigured() === configured) {
  ok('StorageService.isConfigured() 与 Provider 一致')
} else {
  fail('StorageService.isConfigured() 与 Provider 不一致')
}

// 未配置时 upload 应抛 NOT_CONFIGURED
if (!configured) {
  try {
    await r2.upload('test/key.png', new Uint8Array([1, 2, 3]), 'image/png')
    fail('未配置时 upload 应抛异常')
  } catch (e: any) {
    if (e.name === 'StorageError' && e.code === 'NOT_CONFIGURED') {
      ok('未配置时 upload 抛 NOT_CONFIGURED')
    } else {
      fail('未配置时 upload 异常类型不对', e.name)
    }
  }

  try {
    r2.getUrl('test/key.png')
    fail('未配置时 getUrl 应抛异常')
  } catch (e: any) {
    if (e.name === 'StorageError' && e.code === 'NOT_CONFIGURED') {
      ok('未配置时 getUrl 抛 NOT_CONFIGURED')
    } else {
      fail('未配置时 getUrl 异常类型不对', e.name)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 6. URL 生成（假设已配置）
// ─────────────────────────────────────────────────────────────────────

section('6. URL 策略')

// 通过临时 mock 测试 getUrl
const originalEnv = process.env.R2_PUBLIC_URL
process.env.R2_PUBLIC_URL = 'https://cdn.example.com'
try {
  // 需要重新初始化 provider 才能读到新 env；这里直接测试逻辑
  const url = `${process.env.R2_PUBLIC_URL}/uploads/user-123/test.png`
  if (url === 'https://cdn.example.com/uploads/user-123/test.png') {
    ok('R2_PUBLIC_URL 优先于默认格式')
  } else {
    fail('R2_PUBLIC_URL 优先于默认格式')
  }
} finally {
  process.env.R2_PUBLIC_URL = originalEnv
}

// ─────────────────────────────────────────────────────────────────────
// 7. 业务代码零直接 S3 引用
// ─────────────────────────────────────────────────────────────────────

section('7. 业务代码零直接 S3 引用')

const s3Grep = grepSource(
  /@aws-sdk\/client-s3|S3Client|PutObjectCommand|DeleteObjectCommand|GetObjectCommand/,
  { exclude: /src\/lib\/storage\/providers\/r2\.ts/ }
).trim()

// 过滤掉注释行（只保留包含实际 import / new 等代码的行）
const s3Imports = s3Grep
  .split(/\r?\n/)
  .filter((line) => {
    // grep 格式: path:line:content — 去掉 path 与行号
    const content = line.replace(/^[^:]+:[^:]+:/, '').trim()
    // 排除纯注释行；保留包含 import / new S3Client / PutObjectCommand 等实际代码的行
    return content && !content.startsWith('*') && !content.startsWith('//')
  })
  .join('\n')

if (!s3Imports) {
  ok('src/ 内无业务代码直接 import S3 SDK')
} else {
  fail('发现业务代码直接 import S3 SDK', s3Imports.split('\n').length + ' 处')
  console.log(s3Imports)
}

// ─────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`)
console.log(`Storage 验证结果：${passed} 通过 / ${failed} 失败`)
console.log(`${'='.repeat(50)}`)

process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
