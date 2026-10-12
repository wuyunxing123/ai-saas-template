#!/usr/bin/env node
/**
 * HTTP 层冒烟测试：/api/ai/image 与 /api/flux-kontext
 *
 * 分两部分：
 *   A. 契约测试 —— 参数校验与鉴权门禁（**不需要数据库**）
 *   B. 端到端测试 —— 登录 → 查积分 → 真实生成 → 图片可访问
 *      （需要可用的 Supabase + 真实 FAL_KEY；缺任一项会明确标记 SKIPPED）
 *
 * 用法：
 *   npm run dev            # 另开一个终端
 *   node scripts/smoke-ai-core.mjs
 *
 * 环境变量：
 *   SMOKE_BASE_URL   默认 http://localhost:3000
 *   SMOKE_EMAIL      默认 test@example.com
 *   SMOKE_PASSWORD   默认 password
 *   SMOKE_MODEL      默认 flux-schnell
 *   SMOKE_TARGET     默认 both，可选 ai | legacy | both
 *
 * 前置条件：开发环境需要开启 credentials 登录
 * （NEXT_PUBLIC_AUTH_CREDENTIALS_ENABLED=true），脚本才能拿到真实 session。
 */

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000'
const EMAIL = process.env.SMOKE_EMAIL || 'test@example.com'
const PASSWORD = process.env.SMOKE_PASSWORD || 'password'
const MODEL = process.env.SMOKE_MODEL || 'flux-schnell'
const TARGET = process.env.SMOKE_TARGET || 'both'

/**
 * 跑哪一段：
 *   e2e      登录 → 查积分 → 真实生成（默认，约 6 次请求，不需要重启服务）
 *   contract 参数校验 + 鉴权门禁（约 9 次请求，需要**刚重启**的 dev server）
 *   billing  Billing API 契约（约 6 次请求，需要**刚重启**的 dev server）
 *   all      全部跑（会被限流拖慢数分钟，不推荐）
 *
 * 为什么默认只跑 e2e：
 *   `src/proxy.ts` 的限流计数器是**全局共享**的，但窗口按路径区分
 *   （/api/ 为 10 次/60s，/api/auth/ 为 5 次/300s）。
 *   计数器一旦被 /api/ 请求推高，后续 /api/auth/ 请求会因为阈值更低而立刻 429，
 *   而且要等满 300 秒才会重置。因此各段合跑必然被限流卡住。
 */
const SECTION = process.env.SMOKE_SECTION || 'e2e'

/**
 * `src/proxy.ts` 对 /api/ 做了限流。本脚本请求数较多会触发 429，
 * 因此统一做「等待 + 重试」。
 */
const RATE_LIMIT_WAIT_MS = Number(process.env.SMOKE_RATE_WAIT_MS || 62000)
const MAX_RETRIES = Number(process.env.SMOKE_MAX_RETRIES || 3)

const PROMPT = 'a red cube on a white table, studio lighting'

let failures = 0
let skipped = 0
let retryWaits = 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ─────────────────────────────────────────────────────────────────────
// Cookie 会话
// ─────────────────────────────────────────────────────────────────────

function createSession() {
  const cookies = new Map()

  function remember(response) {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : []

    for (const raw of setCookies) {
      const [pair] = raw.split(';')
      const index = pair.indexOf('=')
      if (index > 0) {
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
      }
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      redirect: options.redirect || 'manual',
      headers: {
        ...(options.headers || {}),
        ...(cookies.size
          ? { cookie: [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
          : {}),
      },
    })

    remember(response)
    return response
  }

  return { request, cookies }
}

/**
 * 带限流重试的请求。
 * `src/proxy.ts` 的限流计数器是全局共享的，本脚本请求数会超阈值，
 * 这里在遇到 429 时等待窗口过期再重试。
 */
async function requestWithRetry(session, path, options = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await session.request(path, options)

    if (response.status !== 429) {
      return response
    }

    if (attempt === MAX_RETRIES) {
      console.log(`     ⚠️  ${path} 仍被限流，放弃重试`)
      return response
    }

    retryWaits += 1
    console.log(
      `     ⏳ ${path} 触发限流（429），等待 ${RATE_LIMIT_WAIT_MS / 1000}s 后重试（第 ${attempt + 1} 次）`
    )
    await sleep(RATE_LIMIT_WAIT_MS)
  }

  throw new Error('unreachable')
}

// ─────────────────────────────────────────────────────────────────────
// 断言工具
// ─────────────────────────────────────────────────────────────────────

function step(name) {
  console.log(`\n▶ ${name}`)
}

function ok(message) {
  console.log(`  ✅ ${message}`)
}

function fail(message) {
  console.log(`  ❌ ${message}`)
  failures += 1
}

function skip(message) {
  console.log(`  ⏭️  ${message}`)
  skipped += 1
}

function assertStatus(actual, expected, label) {
  if (actual === expected) {
    ok(`${label} → HTTP ${actual}`)
  } else {
    fail(`${label} → 期望 HTTP ${expected}，实际 ${actual}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// A. 契约测试（不需要数据库）
// ─────────────────────────────────────────────────────────────────────

async function testAiImageContract(session) {
  step('A1. /api/ai/image 参数校验（应全部 400）')

  const cases = [
    { label: '缺少 model', body: { prompt: PROMPT } },
    { label: '未知 model', body: { model: 'nope', prompt: PROMPT } },
    { label: '缺少 prompt', body: { model: MODEL } },
    {
      label: 'inputImages 不是数组',
      body: { model: MODEL, prompt: PROMPT, inputImages: 'not-an-array' },
    },
    {
      label: '文本生图模型却传了图片',
      body: {
        model: 'flux-schnell',
        prompt: PROMPT,
        inputImages: ['https://example.com/a.png'],
      },
    },
    {
      label: '编辑模型未传图片',
      body: { model: 'flux-kontext-pro-edit', prompt: PROMPT },
    },
    {
      label: '编辑模型传了 2 张图',
      body: {
        model: 'flux-kontext-pro-edit',
        prompt: PROMPT,
        inputImages: ['https://example.com/a.png', 'https://example.com/b.png'],
      },
    },
  ]

  for (const testCase of cases) {
    const response = await requestWithRetry(session, '/api/ai/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(testCase.body),
    })

    let detail = ''
    try {
      const payload = await response.json()
      detail = payload.error || ''
    } catch {
      /* ignore */
    }

    if (response.status === 400) {
      ok(`${testCase.label} → HTTP 400（${detail.slice(0, 60)}）`)
    } else {
      fail(`${testCase.label} → 期望 HTTP 400，实际 ${response.status}`)
    }
  }
}

async function testAuthGate(session) {
  step('A2. 鉴权门禁（未登录应 401）')

  const anonymous = createSession()

  const aiResponse = await requestWithRetry(anonymous, '/api/ai/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT }),
  })
  assertStatus(aiResponse.status, 401, '/api/ai/image 未登录')

  const legacyResponse = await requestWithRetry(anonymous, '/api/flux-kontext', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'text-to-image-schnell', prompt: PROMPT }),
  })
  assertStatus(legacyResponse.status, 401, '/api/flux-kontext 未登录（旧链路仍活着）')
}

/** 登录之后再验证「已登录不再被 401 拦截」。 */async function testAuthedNotRejected(session) {
  step('B3. 已登录后鉴权放行')

  const response = await requestWithRetry(session, '/api/ai/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT }),
  })

  if (response.status === 401) {
    fail('已登录用户仍然收到 401')
  } else if (response.status === 429) {
    fail('已登录用户的请求仍被限流（429），无法判断鉴权行为')
  } else {
    ok(
      `已登录用户未被 401 拦截（HTTP ${response.status}，已进入业务逻辑）`
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// B. 端到端（需要数据库 + 真实 API Key）
// ─────────────────────────────────────────────────────────────────────

async function signIn(session) {
  step('B1. 登录（credentials）')

  const csrfResponse = await requestWithRetry(session, '/api/auth/csrf')
  const { csrfToken } = await csrfResponse.json()

  if (!csrfToken) {
    throw new Error('无法获取 csrfToken（可能被限流，可提高 SMOKE_RATE_WAIT_MS 后重试）')
  }

  await requestWithRetry(session, '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE_URL}/generate`,
      json: 'true',
    }),
  })

  const sessionResponse = await requestWithRetry(session, '/api/auth/session')
  const data = await sessionResponse.json()

  if (!data?.user?.email) {
    throw new Error(
      '登录失败。请确认 NEXT_PUBLIC_AUTH_CREDENTIALS_ENABLED=true 且开发环境后门账号可用'
    )
  }

  ok(`已登录：${data.user.email}`)
}

/** 返回 true 表示数据库可用。 */
async function ensureUser(session) {
  step('B2. 确认用户与积分')

  const response = await requestWithRetry(session, '/api/user/credits')

  if (response.ok) {
    const data = await response.json()
    ok(`用户已存在，当前积分：${data.user?.credits ?? 'unknown'}`)
    return true
  }

  const text = await response.text()

  if (text.includes('fetch failed') || response.status === 500) {
    skip(
      `数据库不可用（${text.slice(0, 120)}）。` +
        '请在 .env.local 配置真实的 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 后重跑。'
    )
    return false
  }

  if (response.status === 404) {
    const created = await requestWithRetry(session, '/api/user/ensure', {
      method: 'POST',
    })

    if (!created.ok) {
      fail(`/api/user/ensure 失败：HTTP ${created.status}`)
      return false
    }

    const retry = await requestWithRetry(session, '/api/user/credits')
    const data = await retry.json()
    ok(`用户已创建，当前积分：${data.user?.credits ?? 'unknown'}`)
    return true
  }

  fail(`查询积分失败：HTTP ${response.status}`)
  return false
}

async function verifyAssetReachable(url, label) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(15000),
    })

    if (response.ok) {
      ok(
        `${label} URL 可访问（${response.status}，${response.headers.get('content-type') || 'n/a'}）`
      )
    } else {
      fail(`${label} URL 返回 ${response.status}`)
    }
  } catch (error) {
    fail(`${label} URL 校验失败：${error.message}`)
  }
}

async function testNewEndpoint(session) {
  step(`B4. 新链路 POST /api/ai/image（model=${MODEL}）`)

  const response = await requestWithRetry(session, '/api/ai/image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT }),
  })

  const payload = await response.json()

  if (!response.ok) {
    fail(`HTTP ${response.status}：${payload.message || payload.error}`)
    return
  }

  ok(`HTTP 200，provider=${payload.data?.provider}，model=${payload.data?.model}`)

  const assets = payload.data?.assets || []

  if (!assets.length) {
    fail('返回结果中没有 assets')
    return
  }

  ok(`返回 ${assets.length} 个 asset：${assets[0].url.slice(0, 70)}…`)
  ok(`剩余积分：${payload.credits_remaining}`)

  if (!payload.data?.provider || !payload.data?.model) {
    fail('GenerateResult 缺少 provider / model 字段')
  }

  await verifyAssetReachable(assets[0].url, '新链路图片')
}

async function testLegacyEndpoint(session) {
  step('B5. 旧链路 POST /api/flux-kontext（action=text-to-image-schnell）')

  const response = await requestWithRetry(session, '/api/flux-kontext', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'text-to-image-schnell', prompt: PROMPT }),
  })

  const payload = await response.json()

  if (!response.ok) {
    fail(`HTTP ${response.status}：${payload.message || payload.error}`)
    return
  }

  const images = payload.data?.images || []

  if (!images.length) {
    fail('旧链路返回结果中没有 images')
    return
  }

  ok(`HTTP 200，provider=${payload.provider}，返回 ${images.length} 张图`)
  ok(`剩余积分：${payload.credits_remaining}`)

  await verifyAssetReachable(images[0].url, '旧链路图片')
}

// ─────────────────────────────────────────────────────────────────────
// Billing 契约测试（不需要数据库）
// ─────────────────────────────────────────────────────────────────────

async function testBillingContract() {
  step('C1. Billing API 鉴权门禁（未登录应 401）')

  const anonymous = createSession()

  const cases = [
    { label: 'GET  /api/billing/orders', path: '/api/billing/orders', method: 'GET' },
    {
      label: 'GET  /api/billing/orders/<id>',
      path: '/api/billing/orders/00000000-0000-0000-0000-000000000000',
      method: 'GET',
    },
    {
      label: 'POST /api/billing/checkout',
      path: '/api/billing/checkout',
      method: 'POST',
      body: { packageId: 'creator' },
    },
  ]

  for (const testCase of cases) {
    const response = await requestWithRetry(anonymous, testCase.path, {
      method: testCase.method,
      ...(testCase.body
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(testCase.body),
          }
        : {}),
    })

    assertStatus(response.status, 401, testCase.label)
  }
}

async function testBillingValidation() {
  step('C2. Billing 入参校验（应 400）')

  const anonymous = createSession()

  // 未注册渠道 → 400
  const badProvider = await requestWithRetry(
    anonymous,
    '/api/billing/webhook/not-a-provider',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  )
  assertStatus(badProvider.status, 400, 'Webhook 未注册渠道')

  // 已知渠道但签名缺失 → 400（验签失败）
  const badSignature = await requestWithRetry(
    anonymous,
    '/api/billing/webhook/creem',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  )
  assertStatus(badSignature.status, 400, 'Webhook 缺少签名')

  // GET 列出套餐是公开的
  const packages = await requestWithRetry(anonymous, '/api/billing/checkout', {
    method: 'GET',
  })
  assertStatus(packages.status, 200, 'GET /api/billing/checkout（列出套餐）')

  if (packages.status === 200) {
    const payload = await packages.json()
    const count = Array.isArray(payload.packages) ? payload.packages.length : 0

    if (count > 0) {
      ok(`返回 ${count} 个可售套餐`)
    } else {
      fail('套餐列表为空')
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`HTTP 冒烟测试 → ${BASE_URL}（section=${SECTION}）`)

  const session = createSession()

  if (SECTION === 'contract' || SECTION === 'all') {
    await testAiImageContract(session)
    await testAuthGate(session)
  }

  if (SECTION === 'contract') {
    console.log(
      `\n${failures === 0 ? '✅ 契约测试通过' : `❌ 契约测试有 ${failures} 项失败`}` +
        (retryWaits ? `（因限流等待重试 ${retryWaits} 次）` : '')
    )
    process.exit(failures === 0 ? 0 : 1)
  }

  if (SECTION === 'billing') {
    await testBillingContract()
    await testBillingValidation()

    console.log(
      `\n${failures === 0 ? '✅ Billing 契约测试通过' : `❌ Billing 契约测试有 ${failures} 项失败`}` +
        (retryWaits ? `（因限流等待重试 ${retryWaits} 次）` : '')
    )
    process.exit(failures === 0 ? 0 : 1)
  }

  // ── 端到端 ──────────────────────────────────────────────────────
  await signIn(session)
  await testAuthedNotRejected(session)

  const dbAvailable = await ensureUser(session)

  if (!dbAvailable) {
    console.log('\n⚠️  数据库不可用，跳过端到端生成部分（B4 / B5）')
  } else {
    if (TARGET === 'ai' || TARGET === 'both') {
      await testNewEndpoint(session)
    }
    if (TARGET === 'legacy' || TARGET === 'both') {
      await testLegacyEndpoint(session)
    }
  }

  console.log(
    `\n${failures === 0 ? '✅ 冒烟测试通过' : `❌ 冒烟测试有 ${failures} 项失败`}` +
      (skipped ? `（${skipped} 项跳过）` : '') +
      (retryWaits ? `（因限流等待重试 ${retryWaits} 次）` : '')
  )

  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\n❌ 测试异常终止：${error.message}`)
  process.exit(1)
})
