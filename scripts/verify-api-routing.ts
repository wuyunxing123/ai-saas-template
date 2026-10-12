#!/usr/bin/env node
/**
 * API 路由解耦验证（Phase 9.8.2-B，9.8.2-D 去产品化）
 *
 * 本脚本只验**通用机制**，不含任何产品字面量：
 *
 *   A. proxy 单元断言 —— 直接调用 `proxy()`，用 Next 在 rewrite 响应上写回的
 *      `x-middleware-rewrite` 头读出**目标路径**，证明 `/api/v1/*` 只做通用前缀剥离：
 *      对**当前仓库里真实存在的每个静态 API 路由**逐个验证，而不是抽查几个名字。
 *   B. 部署/源码耦合 —— `vercel.json` 不再做同应用改写；`src/proxy.ts` 不含
 *      **任何已发现产品**的词汇（词汇由产品自己声明，见 `vocabulary.ts`）；
 *      `next.config.js` 的 `/api/v0 → /api/v1` 兼容链仍在。
 *   C. 已知缺陷 F9.8.2B-1 的现状钉住（v1 不经限流/安全头），本阶段不修。
 *
 * 产品自己的公共路径契约（例如某个产品的兼容路由必须「再导出」主 handler、
 * 不得复制业务逻辑）属于产品数据，登记在带 `@product-scope` 的产品脚本里。
 *
 * 为什么用 `x-middleware-rewrite`：`NextResponse.rewrite(url)` 在纯 Node 环境里
 * 不会真的路由，但它把目的地写进该响应头，这是唯一可稳定断言的公开痕迹。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-api-routing.ts
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'

import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

import { codeMentions, discoveredProductIds, loadProductBundle, vocabularyOf } from './product-discovery'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const ROOT = process.cwd()

let failures = 0

function ok(message: string) {
  console.log(`  ✅ ${message}`)
}

function fail(message: string) {
  console.log(`  ❌ ${message}`)
  failures += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    ok(`${label} = ${JSON.stringify(actual)}`)
  } else {
    fail(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

function assertTrue(condition: boolean, label: string) {
  if (condition) ok(label)
  else fail(`${label} —— 条件不成立`)
}

// ─────────────────────────────────────────────────────────────────────
// 测试夹具
// ─────────────────────────────────────────────────────────────────────

/** 每个请求默认用独立 IP，避免互相踩到 proxy 的内存限流桶。 */
let ipSeq = 0
function nextIp() {
  ipSeq += 1
  return `10.77.${Math.floor(ipSeq / 256) % 256}.${ipSeq % 256}`
}

interface ProxyResult {
  /** rewrite 目标（无 rewrite 时为 null） */
  rewrite: URL | null
  /** 是否原样放行（NextResponse.next()） */
  passthrough: boolean
  status: number
  headers: Headers
}

function runProxy(url: string, init?: RequestInit): ProxyResult {
  const request = new NextRequest(new URL(url, 'http://localhost:3123'), {
    ...init,
    headers: {
      'x-forwarded-for': nextIp(),
      ...(init?.headers ?? {}),
    },
  })

  const response = proxy(request)
  const rewriteTarget = response.headers.get('x-middleware-rewrite')

  return {
    rewrite: rewriteTarget ? new URL(rewriteTarget) : null,
    passthrough: !rewriteTarget && response.headers.get('x-middleware-next') === '1',
    status: response.status,
    headers: response.headers,
  }
}

/** 断言 rewrite 目标的 pathname + 查询串。 */
function expectRewrite(
  label: string,
  url: string,
  expectedPathname: string,
  expectedSearch = ''
) {
  const result = runProxy(url)

  if (!result.rewrite) {
    fail(`${label}：期望 rewrite，实际 ${result.passthrough ? '放行' : `HTTP ${result.status}`}`)
    return
  }

  assertEqual(result.rewrite.pathname, expectedPathname, `${label} → pathname`)

  if (expectedSearch) {
    const actual = [...result.rewrite.searchParams.entries()].map(
      ([k, v]) => `${k}=${v}`
    )
    const expected = expectedSearch.split('&').map((p) => p.replace(/^\?/, ''))
    assertEqual(
      actual.sort().join('&'),
      expected.sort().join('&'),
      `${label} → query 透传`
    )
  } else {
    assertEqual(result.rewrite.search, '', `${label} → 不追加查询参数`)
  }
}

/**
 * 当前仓库里**真实存在的静态 API 路由**（`src/app/api/**\/route.ts`）。
 *
 * 带动态段（`[id]` / `[[...path]]`）的目录跳过：它们的可请求路径不是目录名本身，
 * 拿字面量去断言会验出一个不存在的路径。
 */
function staticApiPaths(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') {
        const rel = path
          .relative(path.join(ROOT, 'src', 'app', 'api'), path.dirname(full))
          .replace(/\\/g, '/')
        if (!rel.includes('[')) out.push(`/api/${rel}`)
      }
    }
  }

  walk(path.join(ROOT, 'src', 'app', 'api'))
  return out.sort()
}

// ─────────────────────────────────────────────────────────────────────
// A. proxy：/api/v1 只做通用前缀剥离
// ─────────────────────────────────────────────────────────────────────

function checkProxy() {
  console.log('\n=== A. proxy：通用 /api/v1 前缀剥离 ===')

  const paths = staticApiPaths()
  assertTrue(paths.length > 0, `发现 ${paths.length} 个静态 API 路由（逐个验证前缀剥离）`)

  const wrong: string[] = []
  for (const apiPath of paths) {
    const v1Url = `/api/v1${apiPath.slice('/api'.length)}`
    const result = runProxy(v1Url)
    if (result.rewrite?.pathname !== apiPath) {
      wrong.push(`${v1Url} → ${result.rewrite?.pathname ?? '(无 rewrite)'}`)
    }
  }
  assertTrue(
    wrong.length === 0,
    wrong.length === 0
      ? `全部 ${paths.length} 个真实路由的 /api/v1 形式都精确剥回原路径`
      : `前缀剥离失真：${wrong.join('；')}`
  )

  console.log('\n── A2. 查询参数保留，且不追加任何东西 ──')
  expectRewrite(
    '/api/v1/user/credits?page=2',
    '/api/v1/user/credits?page=2',
    '/api/user/credits',
    'page=2'
  )

  console.log('\n── A3. 剥离是**纯机械**的：不认识的路径同样剥回，不映射到任何专用后端 ──')
  for (const probe of ['/api/v1/definitely-not-real', '/api/v1/a/b/c']) {
    expectRewrite(probe, probe, probe.replace('/api/v1/', '/api/'))
  }

  console.log('\n── A4. `/api/v1` 自身与空 rest 不 rewrite（避免剥成 /api/ 空路径） ──')
  const bare = runProxy('/api/v1')
  assertTrue(bare.passthrough, '/api/v1（无 rest）原样放行')

  console.log('\n── A5. 非 v1 路径逻辑不变：放行 + 安全响应头 ──')
  const plain = runProxy('/api/user/credits')
  assertTrue(plain.passthrough, '/api/user/credits 原样放行（未被 rewrite）')
  assertEqual(plain.headers.get('X-Frame-Options'), 'DENY', '/api/user/credits 带 X-Frame-Options')
  assertEqual(
    plain.headers.get('X-Content-Type-Options'),
    'nosniff',
    '/api/user/credits 带 X-Content-Type-Options'
  )

  const debug = runProxy('/api/debug/anything')
  assertEqual(debug.status, 404, '/api/debug/* 未开启时仍 404')

  console.log('\n── A6. 已知缺陷 F9.8.2B-1 保持原状（v1 不经限流/安全头），本阶段不修 ──')
  const sharedIp = '10.99.0.1'
  let rateLimited = 0
  for (let i = 0; i < 12; i++) {
    const response = proxy(
      new NextRequest(new URL('/api/v1/user/credits', 'http://localhost:3123'), {
        headers: { 'x-forwarded-for': sharedIp },
      })
    )
    if (response.status === 429) rateLimited += 1
    if (i === 0) {
      assertEqual(
        response.headers.get('X-Frame-Options'),
        null,
        'F9.8.2B-1：v1 rewrite 响应不带安全头（改前即如此）'
      )
    }
  }
  assertEqual(rateLimited, 0, 'F9.8.2B-1：连续 12 次 v1 请求无限流（改前即如此）')

  const limited = (() => {
    let hits = 0
    for (let i = 0; i < 12; i++) {
      const response = proxy(
        new NextRequest(new URL('/api/user/credits', 'http://localhost:3123'), {
          headers: { 'x-forwarded-for': '10.99.0.2' },
        })
      )
      if (response.status === 429) hits += 1
    }
    return hits
  })()
  assertTrue(limited > 0, '对照组：非 v1 路径仍受限流保护')
}

// ─────────────────────────────────────────────────────────────────────
// B. 部署配置与源码耦合
// ─────────────────────────────────────────────────────────────────────

async function checkDeploymentConfig() {
  console.log('\n=== B. 部署配置 / 源码耦合 ===')

  const vercel = JSON.parse(
    readFileSync(path.resolve(ROOT, 'vercel.json'), 'utf8')
  ) as {
    rewrites?: Array<{ source: string; destination: string }>
    headers?: unknown[]
    functions?: Record<string, unknown>
    regions?: string[]
    redirects?: unknown[]
  }

  const rewrites = vercel.rewrites ?? []
  assertEqual(rewrites.length, 0, 'vercel.json rewrites 已清空（同应用改写交给 Next）')
  assertTrue(!!vercel.headers?.length, 'vercel.json headers 保留')
  assertTrue(!!vercel.functions, 'vercel.json functions 保留')
  assertTrue(!!vercel.regions?.length, 'vercel.json regions 保留')
  assertTrue(!!vercel.redirects?.length, 'vercel.json redirects 保留')

  console.log('\n── B2. proxy.ts 不含任何产品的词汇 ──')
  // 词汇来自产品自己（bundle 派生 + `vocabulary.ts`），脚本里不写死任何品牌词。
  const proxySource = readFileSync(path.resolve(ROOT, 'src/proxy.ts'), 'utf8')
  const code = proxySource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  const productIds = discoveredProductIds()
  let leaked: string[] = []

  for (const productId of productIds) {
    const bundle = await loadProductBundle(productId)
    for (const term of vocabularyOf(productId, bundle)) {
      if (codeMentions(code, term)) leaked.push(`${productId}: "${term}"`)
    }
  }

  assertTrue(
    leaked.length === 0,
    leaked.length === 0
      ? `proxy.ts 对 ${productIds.length} 个已发现产品的词汇全部中性（前缀剥离不含产品语义）`
      : `proxy.ts 含产品词表：${leaked.join('；')}`
  )

  console.log('\n── B3. next.config.js 的 /api/v0 → /api/v1 兼容链仍在 ──')
  const nextConfig = readFileSync(path.resolve(ROOT, 'next.config.js'), 'utf8')
  assertTrue(
    /['"]\/api\/v0\/:path\*['"]/.test(nextConfig),
    'next.config.js 仍把 /api/v0/* 重定向到 /api/v1/*'
  )
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
  checkProxy()
  await checkDeploymentConfig()

  console.log(`\n${failures > 0 ? '❌' : '✅'} API 路由解耦验证：${failures} 项失败`)
  // 用 process.exitCode 而不是 process.exit：保证异步输出先 flush 完。
  process.exitCode = failures > 0 ? 1 : 0
}

main()
