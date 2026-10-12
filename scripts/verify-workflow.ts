#!/usr/bin/env node
/**
 * Workflow / Async Task Engine —— 纯逻辑验证（不需要数据库）
 *
 * 覆盖规格 §31 中**不依赖数据库**的部分：
 *   2. 状态机（合法 / 非法转换）
 *   3. 非法状态转换（completed→processing 等必须被拒）
 *   6. Provider submission 结果归一化（fal / KIE / WaveSpeed → 统一结构）
 *  15. Webhook payload 解析（多厂商形状）
 *  17. 重试分类（哪些错误可重试）
 *  20. Result 统一（type 字段让业务层区分 image/video）
 *  29. 错误模型（对外不泄漏内部 message）
 *
 * 依赖数据库的幂等测试（credit / webhook 重复不重复扣费）放在
 *   `supabase/scripts/verify_migrations.mjs` 的「Test 9：Workflow」段，
 *   因为那里已经起了真实的 PGlite 实例。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-workflow.ts
 */

import {
  assertTransition,
  canTransition,
  isActive,
  isTerminal,
  InvalidTaskTransitionError,
} from '@/lib/workflow/state-machine'
import { normalizeTaskResult, parseTaskResult } from '@/lib/workflow/result'
import { parseWebhookPayload } from '@/lib/workflow/webhook-payload'
import { TaskError, toTaskError } from '@/lib/workflow/errors'

let failures = 0
let checks = 0

const ok = (m: string) => {
  checks += 1
  console.log(`  ✅ ${m}`)
}
const fail = (m: string) => {
  checks += 1
  failures += 1
  console.log(`  ❌ ${m}`)
}
const info = (m: string) => console.log(`     ${m}`)

function assertTrue(condition: boolean, label: string) {
  if (condition) ok(label)
  else fail(label)
}

function assertThrows(fn: () => unknown, label: string) {
  try {
    fn()
    fail(`${label}（期望抛错，但没有）`)
  } catch (error) {
    if (error instanceof InvalidTaskTransitionError) ok(`${label}（抛出 ${error.code}）`)
    else fail(`${label}（抛出非预期错误：${(error as Error).message}）`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. 状态机：合法转换不抛错
// ─────────────────────────────────────────────────────────────────────
console.log('\n▶ 状态机 · 合法转换')

assertTrue(
  (() => {
    assertTransition('pending', 'processing')
    return true
  })(),
  'pending → processing 允许'
)
assertTrue(
  (() => {
    assertTransition('pending', 'failed')
    return true
  })(),
  'pending → failed 允许'
)
assertTrue(
  (() => {
    assertTransition('pending', 'cancelled')
    return true
  })(),
  'pending → cancelled 允许'
)
assertTrue(
  (() => {
    assertTransition('processing', 'processing') // 重试语义
    return true
  })(),
  'processing → processing 允许（重试）'
)
assertTrue(
  (() => {
    assertTransition('processing', 'completed')
    return true
  })(),
  'processing → completed 允许'
)
assertTrue(
  (() => {
    assertTransition('processing', 'failed')
    return true
  })(),
  'processing → failed 允许'
)
assertTrue(
  (() => {
    assertTransition('processing', 'cancelled')
    return true
  })(),
  'processing → cancelled 允许'
)

// ─────────────────────────────────────────────────────────────────────
// 2. 状态机：非法转换必须被拒（规格 §6 / §31 #3）
// ─────────────────────────────────────────────────────────────────────
console.log('\n▶ 状态机 · 非法转换（必须抛 InvalidTaskTransitionError）')

assertThrows(() => assertTransition('pending', 'completed'), 'pending → completed 被拒')
assertThrows(() => assertTransition('completed', 'processing'), 'completed → processing 被拒')
assertThrows(() => assertTransition('completed', 'failed'), 'completed → failed 被拒')
assertThrows(() => assertTransition('failed', 'processing'), 'failed → processing 被拒')
assertThrows(() => assertTransition('failed', 'completed'), 'failed → completed 被拒')
assertThrows(() => assertTransition('cancelled', 'completed'), 'cancelled → completed 被拒')
assertThrows(() => assertTransition('cancelled', 'processing'), 'cancelled → processing 被拒')

// canTransition 镜像
assertTrue(canTransition('pending', 'processing'), 'canTransition(pending, processing) = true')
assertTrue(!canTransition('completed', 'processing'), 'canTransition(completed, processing) = false')

// 终态 / 活跃态判定
assertTrue(isTerminal('completed') && isTerminal('failed') && isTerminal('cancelled'), '终态判定正确')
assertTrue(isActive('pending') && isActive('processing'), '活跃态判定正确')
assertTrue(!isActive('completed'), 'completed 不是活跃态')

// ─────────────────────────────────────────────────────────────────────
// 3. Result 归一化（规格 §20）：fal / KIE / WaveSpeed 形状 → 统一 TaskAsset
// ─────────────────────────────────────────────────────────────────────
console.log('\n▶ Result 归一化 · 多 Provider 形状')

// fal：assets 用 url + contentType
const falResult = normalizeTaskResult(
  {
    assets: [{ url: 'https://fal.ai/a.png', contentType: 'image/png', width: 1024, height: 1024 }],
    provider: 'fal',
    model: 'fal-ai/some-model',
    seed: 12345,
  },
  'image'
)
assertTrue(falResult.assets.length === 1, 'fal：1 个 asset')
assertTrue(falResult.assets[0].type === 'image', 'fal：type=image')
assertTrue(falResult.assets[0].mimeType === 'image/png', 'fal：mimeType=image/png')
assertTrue(falResult.metadata?.seed === 12345, 'fal：seed 进入 metadata')

// KIE：url 无 contentType，但 MIME 按 type 推断
const kieResult = normalizeTaskResult(
  {
    assets: [{ url: 'https://kie.x/y.jpg' }],
    provider: 'kie',
    model: 'kie-model',
  },
  'image'
)
assertTrue(kieResult.assets[0].type === 'image', 'KIE：type 由 URL 猜测=image')
assertTrue(kieResult.assets[0].mimeType === 'image/png', 'KIE：无 contentType 时按类型默认 image/png')

// WaveSpeed：未来视频 Provider —— 业务层靠 type 区分 <img>/<video>
const videoResult = normalizeTaskResult(
  {
    assets: [{ url: 'https://ws.x/clip.mp4', contentType: 'video/mp4' }],
    provider: 'wavespeed',
    model: 'wavespeed-video',
  },
  'video'
)
assertTrue(videoResult.assets[0].type === 'video', 'WaveSpeed 视频：type=video（业务层据此渲染 <video>）')
assertTrue(videoResult.modality === 'video', 'WaveSpeed 视频：modality=video')

// round-trip：落库后读回
const roundTrip = parseTaskResult({
  assets: [{ type: 'image', url: 'https://x/a.png', mimeType: 'image/png' }],
  provider: 'fal',
  model: 'fal-ai/some-model',
  modality: 'image',
})
assertTrue(roundTrip !== null && roundTrip.assets.length === 1, 'parseTaskResult 还原 1 个 asset')
assertTrue(roundTrip?.assets[0].url === 'https://x/a.png', 'parseTaskResult URL 正确')
assertTrue(parseTaskResult(null) === null, 'parseTaskResult(null) = null（容忍历史数据）')

// ─────────────────────────────────────────────────────────────────────
// 4. Webhook payload 解析（规格 §15）：多厂商形状
// ─────────────────────────────────────────────────────────────────────
console.log('\n▶ Webhook payload 解析 · 多 Provider 形状')

const kieWh = parseWebhookPayload(JSON.stringify({ taskId: 'kie_123', state: 'completed' }))
assertTrue(kieWh?.providerTaskId === 'kie_123' && kieWh?.state === 'completed', 'KIE：{taskId, state} 解析')

const wsWh = parseWebhookPayload(JSON.stringify({ id: 'ws_456', status: 'success' }))
assertTrue(wsWh?.providerTaskId === 'ws_456' && wsWh?.state === 'completed', 'WaveSpeed：{id, status:success} 解析')

const falWh = parseWebhookPayload(
  JSON.stringify({ requestId: 'fal_789', status: 'ERROR', error: 'boom' })
)
assertTrue(
  falWh?.providerTaskId === 'fal_789' && falWh?.state === 'failed' && falWh?.error === 'boom',
  'fal：{requestId, status:ERROR, error} 解析为失败'
)

assertTrue(parseWebhookPayload('not json') === null, '非法 JSON → null（路由应回 400，不猜）')
assertTrue(parseWebhookPayload(JSON.stringify({ state: 'completed' })) === null, '缺 taskId → null（不猜）')

// ─────────────────────────────────────────────────────────────────────
// 5. 错误模型（规格 §29）：对外不泄漏内部 message
// ─────────────────────────────────────────────────────────────────────
console.log('\n▶ 错误模型 · 对外收敛')

const authErr = new TaskError('PROVIDER_AUTH_FAILED', 'invalid api key xyz', { retryable: false })
const pub = authErr.toPublic()
assertTrue(pub.code === 'PROVIDER_AUTH_FAILED', 'toPublic 保留 code')
assertTrue(pub.message === 'AI provider authentication failed', 'toPublic 不泄漏原始 message（"invalid api key xyz"）')
assertTrue(pub.retryable === false, 'PROVIDER_AUTH_FAILED 不可重试')

// 重试分类
const timeoutErr = toTaskError(new Error('request timed out'))
assertTrue(timeoutErr.code === 'PROVIDER_TIMEOUT' && timeoutErr.retryable, 'timeout → 可重试')

const rateErr = toTaskError(new Error('429 too many requests'))
assertTrue(rateErr.code === 'PROVIDER_RATE_LIMITED' && rateErr.retryable, '429 → 可重试')

const authRaw = toTaskError(new Error('401 Unauthorized'))
assertTrue(authRaw.code === 'PROVIDER_AUTH_FAILED' && !authRaw.retryable, '401 → 不可重试')

// 模型输入图契约（AIService 分发前抛的那两类）必须是客户端错误、不重试。
// 落进 INTERNAL_ERROR 的话，同一个错误请求会被重新提交三次才终态失败。
const contractSingle = toTaskError(
  new Error('Model "some-edit-model" requires exactly one input image')
)
assertTrue(
  contractSingle.code === 'INVALID_REQUEST' && !contractSingle.retryable,
  '缺输入图（single）→ INVALID_REQUEST 且不可重试'
)

const contractMany = toTaskError(
  new Error('Model "some-compose-model" requires at least one input image')
)
assertTrue(
  contractMany.code === 'INVALID_REQUEST' && !contractMany.retryable,
  '缺输入图（many）→ INVALID_REQUEST 且不可重试'
)

const unknown = toTaskError('some raw string')
assertTrue(
  unknown.code === 'INTERNAL_ERROR' && unknown.toPublic().message !== 'some raw string',
  '未知错误 → INTERNAL_ERROR，且对外不泄漏原文'
)

// ─────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? '✅' : '❌'} Workflow 逻辑验证：${checks - failures} 通过 / ${failures} 失败（共 ${checks} 项）`)

if (failures > 0) {
  process.exit(1)
}
