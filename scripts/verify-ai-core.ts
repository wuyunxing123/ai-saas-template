#!/usr/bin/env node
/**
 * AI Core 验证脚本（默认不需要任何真实 API Key）—— **母版机制**测试
 *
 * 覆盖三部分：
 *   A. 静态契约 —— 模型目录 / Provider 注册表 / Provider 解析
 *   B. 完整管线 —— 用本地 mock server 打满
 *      请求 → Provider 解析 → 请求体构建 → HTTP → 任务轮询 → 结果归一化 → GenerateResult
 *   C. 真实调用 —— 仅当 FAL_KEY 不是占位符时才执行
 *
 * 为什么 B 部分要用 mock：
 *   本机 `.env.local` 里的 FAL_KEY 是占位符，无法对真实第三方 API 发起调用。
 *   但 kie / wavespeed / atlascloud 都用可配置 base URL 的原生 fetch，
 *   因此可以把它们指向本地 mock server，把整条管线跑通并断言结果形状。
 *   （fal 走 @fal-ai/client SDK，base URL 不可配置，不在 B 部分覆盖范围内。）
 *
 * ⚠️ 本脚本**不含任何产品字面量**（Phase 9.8.2-D）：
 *   所有模型、action、Provider、宽高比都从**已绑定的产品 bundle** 派生。
 *   换一个产品后它照跑，并且证明的是「这个产品接上了通用 AI 机制」——
 *   这正是母版要复用的东西。产品自己的精确断言写在
 *   `scripts/verify-flux-kontext.ts`（声明 `// @product-scope`，产品缺失时按 SKIP 处理）。
 *
 * mock server 为什么按**方法**而不是按 URL 路径应答：
 *   生成/查询路径是产品数据（`provider-data.ts` 里的 generatePath / recordPath）。
 *   守卫按路径写死就等于知道上一个产品用了哪些接口。改成「POST=提交、GET=查询」
 *   的通用应答 + 一次只针对一家 Provider，既覆盖三家真实形状，也不认产品路径。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-ai-core.ts
 */

import '@/app/product-runtime'
import { createServer } from 'node:http'
import { config as loadEnv } from 'dotenv'

import { getBoundProductId, getProductConfig } from '@/config/product'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
)

const PROMPT = 'a red cube on a white table, studio lighting'

let failures = 0
const requestLog: string[] = []
let teardownMockServer: () => Promise<void> = async () => {}

function ok(message: string) {
  console.log(`  ✅ ${message}`)
}

function fail(message: string) {
  console.log(`  ❌ ${message}`)
  failures += 1
}

function skip(message: string) {
  console.log(`  ⏭️  ${message}`)
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    ok(`${label} = ${JSON.stringify(actual)}`)
  } else {
    fail(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

function assertThrows(fn: () => unknown, label: string, contains?: string) {
  try {
    fn()
    fail(`${label}：期望抛错但没有抛`)
  } catch (error) {
    reportCaught(error, label, contains)
  }
}

async function assertRejects(
  fn: () => Promise<unknown>,
  label: string,
  contains?: string
) {
  try {
    await fn()
    fail(`${label}：期望 reject 但没有`)
  } catch (error) {
    reportCaught(error, label, contains)
  }
}

function reportCaught(error: unknown, label: string, contains?: string) {
  const message = error instanceof Error ? error.message : String(error)
  if (contains && !message.includes(contains)) {
    fail(`${label}：错误信息不含 "${contains}"，实际：${message}`)
  } else {
    ok(`${label} → 正确抛错：${message.slice(0, 88)}`)
  }
}

function assertGenerateResultShape(
  result: {
    provider?: unknown
    model?: unknown
    assets?: unknown
    raw?: unknown
  },
  label: string,
  expectedProvider: string,
  expectedModel: string
) {
  assertEqual(result.provider, expectedProvider, `${label}.provider`)
  assertEqual(result.model, expectedModel, `${label}.model`)

  if (Array.isArray(result.assets) && result.assets.length > 0) {
    ok(`${label}.assets: ${result.assets.length} 个`)
  } else {
    fail(`${label}.assets 为空`)
  }

  if (result.raw === undefined) {
    fail(`${label}.raw 缺失`)
  } else {
    ok(`${label}.raw 存在`)
  }
}

async function assertAssetReachable(url: string, label: string) {
  const head = await fetch(url, { method: 'HEAD' })
  if (head.ok) {
    ok(`${label} URL 可访问（${head.status}，${head.headers.get('content-type')}）`)
  } else {
    fail(`${label} URL 返回 ${head.status}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mock server
// ─────────────────────────────────────────────────────────────────────

/**
 * 一次只服务一家 Provider：测试在调用 generate 前把 `mockTarget` 设成该 Provider，
 * 应答就按那家的**真实响应形状**构造。
 *
 * 三家的形状故意做成超集（taskId / id / status / outputs / successFlag /
 * resultImageUrl 同时出现），所以「Provider 解析错了」不会被 mock 掩盖：
 * 结果里的 `provider` 字段仍由被测代码决定，B4 会断言它。
 */
let mockTarget: 'kie' | 'wavespeed' | 'atlascloud' | null = null
let mockBaseUrl = ''

function submissionBody() {
  return {
    code: 0,
    data: {
      taskId: 'task_mock_1',
      id: 'pred_mock_1',
      outputs: null,
      status: 'processing',
    },
  }
}

function completionBody() {
  const url = `${mockBaseUrl}/result.png`

  return {
    code: 0,
    data: {
      taskId: 'task_mock_1',
      id: 'pred_mock_1',
      status: 'completed',
      outputs: [url],
      successFlag: 1,
      resultImageUrl: url,
      url,
    },
  }
}

async function startMockServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    requestLog.push(`${req.method} ${url.pathname}`)

    const send = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (url.pathname.endsWith('.png')) {
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': PNG.length,
      })
      res.end(PNG)
      return
    }

    // 没有声明目标 Provider 就有请求进来：说明有代码绕过了被测路径去发请求。
    if (!mockTarget) {
      failures += 1
      send({ error: 'mock target not set —— 未预期的请求', path: url.pathname }, 500)
      return
    }

    send(req.method === 'POST' ? submissionBody() : completionBody())
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      mockBaseUrl = `http://127.0.0.1:${port}`
      resolve()
    })
  })

  const close = async () => {
    // teardown 顺序：先停止接收新连接并等 close 回调，再关掉残余的 keep-alive 连接。
    // 残余连接不关的话，事件循环非空 —— 本脚本末尾就不能再调用 process.exit()，
    // 而必须让 Node 自然退出（见 main 末尾的 process.exitCode）。
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
    server.closeIdleConnections()
    server.closeAllConnections()
  }

  // 异常路径也要能 teardown：main() 里还没走到 mock.close() 就抛错时，
  // 监听中的 server 会让进程永远不退出。
  teardownMockServer = close

  return { baseUrl: mockBaseUrl, close }
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const bundle = getProductConfig()
  const mock = await startMockServer()

  // ⚠️ mock server 必须先起：Provider 在**请求时**读 base URL / 轮询节奏 env，
  // 所以只要这些值在调用 generate 之前设好就行（不再是「import 之前」）。
  process.env.ATLASCLOUD_API_BASE_URL = mock.baseUrl
  process.env.ATLASCLOUD_API_KEY = 'mock-key'
  process.env.KIE_API_BASE_URL = mock.baseUrl
  process.env.KIE_API_KEY = 'mock-key'
  process.env.WAVESPEED_API_BASE_URL = mock.baseUrl
  process.env.WAVESPEED_API_KEY = 'mock-key'
  process.env.KIE_POLL_INTERVAL_MS = '10'
  process.env.WAVESPEED_POLL_INTERVAL_MS = '10'
  process.env.ATLASCLOUD_POLL_INTERVAL_MS = '10'

  // 动态 import：确保上面的 env 已生效
  const { AIService } = await import('@/lib/ai/service')
  const { getModel, listModels, isModelSupportedBy } = await import('@/lib/ai/models')
  const { getAIProvider, listAIProviderNames } = await import('@/lib/ai/providers')

  console.log(
    `AI Core 验证（产品 ${bundle.productId}，mock provider @ ${mock.baseUrl}）\n`
  )

  /** 本产品声明过的、且 mock 得起来的 Provider（按名字与 Core 注册表取交集）。 */
  const registered = listAIProviderNames()
  const mockable = (['atlascloud', 'kie', 'wavespeed'] as const).filter((n) =>
    registered.includes(n)
  )

  if (mockable.length === 0) {
    fail(
      `已注册的 Provider（${registered.join(', ') || '无'}）里没有一个能被本脚本 mock —— ` +
        '管线部分（B）等于没跑。请为新厂商补 mock 形状，或明确改写本脚本的判定范围。'
    )
  }

  /** 目录里支持某 Provider 的模型。 */
  const modelsOf = (provider: string) =>
    Object.values(bundle.models).filter((m) => m.providers.includes(provider as never))

  /** 取该 Provider 下最简单的模型（无输入图）。 */
  const textModelFor = (provider: string) =>
    modelsOf(provider).find((m) => m.requiredInputImages === 0) ?? null

  const oneImageModel = Object.values(bundle.models).find((m) => m.requiredInputImages === 1) ?? null
  const manyImageModel =
    Object.values(bundle.models).find((m) => m.requiredInputImages === 'many') ?? null

  /** 该模型第一个「可 mock」的 Provider。 */
  const mockableProviderFor = (modelId: string) =>
    mockable.find((name) => isModelSupportedBy(modelId, name)) ?? null

  // ══ A. 静态契约 ══════════════════════════════════════════════════
  console.log('▶ A1. 模型目录（Core 门面 ⇄ 产品 bundle 一致）')

  const listed = listModels('image')

  assertEqual(listed.length, Object.keys(bundle.models).length, 'listModels("image") 覆盖目录全部模型')
  assertEqual(
    getBoundProductId(),
    bundle.productId,
    '接缝绑定的产品与 bundle 自述一致'
  )

  let facadeMismatch = 0

  for (const model of Object.values(bundle.models)) {
    const viaFacade = getModel(model.id)

    if (JSON.stringify(viaFacade) !== JSON.stringify(model)) {
      fail(`getModel("${model.id}") 返回的不是目录里的那份定义`)
      facadeMismatch += 1
      continue
    }
    if (!listed.some((m) => m.id === model.id)) {
      fail(`模型 ${model.id} 在 listModels() 里缺失`)
      facadeMismatch += 1
    }
  }

  if (facadeMismatch === 0) {
    ok(`${Object.keys(bundle.models).length} 个模型经 Core 门面读到的都是 bundle 里的同一份定义`)
  }

  assertThrows(() => getModel('does-not-exist'), '未知模型', 'Unknown model')

  console.log('\n▶ A2. Provider 装配（bundle 已在绑定通过完整性校验）')

  for (const name of registered) {
    const provider = getAIProvider(name)
    const shapeOk =
      provider.name === name &&
      provider.models.length > 0 &&
      typeof provider.generate === 'function'
    const mapped = listModels('image').filter((m) => m.providers.includes(name))

    // Provider 的 models 必须与目录里的反向声明**同一集合**
    const setsMatch =
      mapped.length === provider.models.length &&
      mapped.every((m) => provider.models.includes(m.id) && isModelSupportedBy(m.id, name))

    if (shapeOk && setsMatch) {
      ok(`${name}: ${provider.models.length} 个模型，与目录的反向声明一致`)
    } else {
      fail(`${name}: 接口实现或模型一致性不完整（shape=${shapeOk} setsMatch=${setsMatch}）`)
    }
  }

  assertThrows(() => getAIProvider('openai'), '未注册 Provider', 'Unknown AI provider')

  console.log('\n▶ A3. Provider 解析（切换 Provider 不改业务代码）')

  const resolvable = mockable.map(textModelFor).find(Boolean) ?? Object.values(bundle.models)[0]
  const defaultName = resolvable.defaultProvider

  assertEqual(
    AIService.resolveProvider({ model: resolvable.id }).name,
    defaultName,
    `${resolvable.id} 未指定时用目录里的 defaultProvider`
  )

  for (const name of mockable.filter((n) => n !== defaultName)) {
    if (!isModelSupportedBy(resolvable.id, name)) continue

    assertEqual(
      AIService.resolveProvider({ model: resolvable.id, provider: name }).name,
      name,
      `显式指定 ${name} 时按指定走`
    )
  }

  // 「不支持的组合必须报错」不能只在某个模型上试：那恰好是所有 Provider 都支持的
  // 模型时等于没测。改为在 bundle 里**穷举**找一对真不支持的组合。
  const unsupportedPair = Object.values(bundle.models)
    .flatMap((m) => registered.map((n) => [m.id, n] as const))
    .find(([modelId, name]) => !isModelSupportedBy(modelId, name))

  if (unsupportedPair) {
    const [modelId, name] = unsupportedPair

    assertThrows(
      () => AIService.resolveProvider({ model: modelId, provider: name }),
      `${name} 不支持 ${modelId}`,
      'does not support model'
    )
  } else {
    fail(
      '产品把每一对「模型 × 已注册 Provider」都声明成支持，无法验证不支持组合必须报错 —— ' +
        '这是判据缺口，不是通过。'
    )
  }

  // ══ B. 完整管线（mock） ══════════════════════════════════════════
  console.log('\n▶ B1. 逐家 Provider 打满管线（submit → poll → normalize）')

  for (const name of mockable) {
    const model = textModelFor(name)

    if (!model) {
      skip(`${name}: 本产品没有该 Provider 的无输入图模型，管线未覆盖（**不是通过**）`)
      continue
    }

    mockTarget = name
    const result = await AIService.generate({
      model: model.id,
      provider: name,
      prompt: PROMPT,
    })
    mockTarget = null

    assertGenerateResultShape(result, name, name, model.id)
    await assertAssetReachable(result.assets[0].url, name)
  }

  console.log('\n▶ B2. 同一模型换多家 Provider，业务代码零改动')

  const multiProviderModel = Object.values(bundle.models)
    .filter((m) => m.requiredInputImages === 0)
    .map((m) => ({ model: m, providers: mockable.filter((n) => m.providers.includes(n)) }))
    .sort((a, b) => b.providers.length - a.providers.length)[0]

  if (multiProviderModel && multiProviderModel.providers.length >= 2) {
    const seen = new Set<string>()

    for (const name of multiProviderModel.providers) {
      mockTarget = name
      const result = await AIService.generate({
        model: multiProviderModel.model.id,
        provider: name,
        prompt: PROMPT,
      })
      mockTarget = null
      seen.add(result.provider)
    }

    ok(
      `${multiProviderModel.model.id} 经 ${seen.size} 家 Provider（${[...seen].sort().join(', ')}）` +
        '都拿到结果，调用方代码一字未改'
    )
  } else {
    skip('没有任何模型同时映射到 2 家可 mock 的 Provider')
  }

  console.log('\n▶ B3. 输入图透传（编辑类模型）')

  if (oneImageModel) {
    const name = mockableProviderFor(oneImageModel.id)

    if (!name) {
      skip(`${oneImageModel.id} 的 Provider 都不可 mock，输入图透传未覆盖`)
    } else {
      mockTarget = name
      const edit = await AIService.generate({
        model: oneImageModel.id,
        provider: name,
        prompt: 'make it blue',
        inputImages: [`${mock.baseUrl}/input.png`],
        parameters: { aspect_ratio: '1:1', num_images: 1 },
      })
      mockTarget = null
      assertGenerateResultShape(edit, '单图编辑', name, oneImageModel.id)
    }
  } else {
    skip('该产品没有 requiredInputImages=1 的模型')
  }

  console.log('\n▶ B4. Provider 选择由部署 env 决定（Core），产品不传 Provider 名')
  process.env.AI_PROVIDER = mockable[0] ?? defaultName
  assertEqual(
    AIService.resolveProvider({ model: resolvable.id }).name,
    mockable[0] ?? defaultName,
    'AI_PROVIDER env 决定未显式指定时的 Provider'
  )
  process.env.AI_PROVIDER = ''
  delete process.env.IMAGE_GENERATION_PROVIDER
  assertEqual(
    AIService.resolveProvider({ model: resolvable.id }).name,
    defaultName,
    '无 env 时回落到模型的 defaultProvider（来自产品目录）'
  )

  console.log('\n▶ B5. 参数校验（错误必须显式抛出）')
  // 输入图校验发生在 Provider 构建请求时，所以这里必须指定一个已 mock 的 Provider；
  // 走 fal 会先撞上占位符 key 的 401，测不到校验本身。
  for (const [model, expectation] of [
    [oneImageModel, 'requires exactly one input image'],
    [manyImageModel, 'requires at least one input image'],
  ] as const) {
    if (!model) continue
    const name = mockableProviderFor(model.id)

    if (!name) {
      skip(`${model.id} 的 Provider 都不可 mock，缺图校验未覆盖`)
      continue
    }

    mockTarget = name
    await assertRejects(
      () => AIService.generate({ model: model.id, provider: name, prompt: PROMPT }),
      `${model.id} 缺输入图`,
      expectation
    )
    mockTarget = null
  }

  console.log('\n▶ B6. mock server 确实被调用（防止假绿）')
  const uniquePaths = [...new Set(requestLog)].sort()
  ok(`共 ${requestLog.length} 次请求，覆盖 ${uniquePaths.length} 个路径`)
  for (const path of uniquePaths) {
    console.log(`     · ${path}`)
  }
  if (requestLog.length === 0) {
    fail('没有任何 HTTP 请求到达 mock server —— 测试无效')
  }

  // ══ C. 真实调用（仅当 key 可用） ═════════════════════════════════
  console.log('\n▶ C1. 真实 fal 调用')
  const falKey = process.env.FAL_KEY?.trim()
  const isPlaceholder = !falKey || falKey === 'your_fal_api_key_here'
  const falModel = textModelFor('fal')

  if (isPlaceholder) {
    skip('FAL_KEY 是占位符，跳过真实调用（这不影响 A/B 两部分的结论）')
  } else if (!falModel) {
    skip('已绑定的产品没有 fal 上的无输入图模型，真实调用无对象可跑')
  } else {
    const result = await AIService.generate({
      model: falModel.id,
      provider: 'fal',
      prompt: PROMPT,
    })
    assertGenerateResultShape(result, 'fal', 'fal', falModel.id)
    await assertAssetReachable(result.assets[0].url, 'fal')
  }

  await mock.close()

  console.log(
    failures === 0
      ? '\n✅ AI Core 验证全部通过'
      : `\n❌ AI Core 验证有 ${failures} 项失败`
  )

  // 不要用 process.exit()：teardown 之后仍可能有 libuv handle 处于 CLOSING 状态，
  // Node 24 / Windows 上会命中 libuv 断言（async.c）导致退出码变成 0xC0000409，
  // 把全部通过的验证判成 FAIL。设 exitCode 后让 Node 自然退出。
  process.exitCode = failures === 0 ? 0 : 1
}

main().catch(async (error) => {
  console.error(`\n❌ 测试异常终止：${error?.message || error}`)
  await teardownMockServer()
  process.exitCode = 1
})
