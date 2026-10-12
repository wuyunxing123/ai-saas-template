import { NextRequest, NextResponse } from 'next/server'

/**
 * 简单的内存限流器。生产环境请换成 Redis 等共享后端。
 *
 * 🔧 B-21 修复
 * ------------
 * 原先 map 的 key 只有 `ip`，但 limit / window 按路径区分
 * （/api/ 10次/60s，/api/auth/ 5次/300s，/api/payment/ 3次/600s）。
 * 于是：一旦 /api/ 请求把计数推到 10，后续 /api/auth/ 请求会因阈值更低（5）
 * 立刻 429，而且要等满 300 秒才重置 —— 正常使用中登录接口被误伤。
 *
 * 修复：把「限流桶」并入 key（`${ip}:${bucket}`），不同路径各自独立计数。
 */
const rateLimitMap = new Map<string, { count: number; lastReset: number }>()

/** 上一次清理过期记录的时间（避免每次请求都全量扫描）。 */
let lastSweep = 0
const SWEEP_INTERVAL_MS = 60_000
/** 超过该时长未活动的记录可安全丢弃（取最长窗口 600s）。 */
const STALE_AFTER_MS = 600_000

function sweepStaleEntries(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return
  lastSweep = now

  for (const [key, record] of rateLimitMap) {
    if (record.lastReset < now - STALE_AFTER_MS) {
      rateLimitMap.delete(key)
    }
  }
}

function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const windowStart = now - windowMs

  sweepStaleEntries(now)

  const record = rateLimitMap.get(key)

  if (!record || record.lastReset < windowStart) {
    rateLimitMap.set(key, { count: 1, lastReset: now })
    return true
  }

  if (record.count >= limit) {
    return false
  }

  record.count++
  return true
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const hostname = request.nextUrl.hostname
  const debugRoutesEnabled =
    process.env.ENABLE_DEBUG_ROUTES === 'true' &&
    process.env.NODE_ENV !== 'production'
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'

  if (pathname.startsWith('/api/debug/') && !debugRoutesEnabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (process.env.NODE_ENV === 'production') {
    const proto = request.headers.get('x-forwarded-proto')
    if (proto === 'http' && !isLocalHost) {
      const httpsUrl = request.nextUrl.clone()
      httpsUrl.protocol = 'https'
      return NextResponse.redirect(httpsUrl, 301)
    }
  }

  // 版本前缀剥离：`/api/v1/<rest>` → `/api/<rest>`，不含任何产品语义。
  // 产品若要暴露自己的公共路径，由**产品作用域的路由文件**承接
  // （见 docs/PRODUCT_GUIDE.md §5.3），查询参数由 clone 保留。
  if (pathname.startsWith('/api/v1/')) {
    const rest = pathname.slice('/api/v1/'.length)

    if (rest) {
      const url = request.nextUrl.clone()
      url.pathname = `/api/${rest}`
      return NextResponse.rewrite(url)
    }
  }

  const response = NextResponse.next()

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  )

  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' " +
      "https://platform.twitter.com " +
      "https://www.googletagmanager.com " +
      "https://accounts.google.com " +
      "https://apis.google.com " +
      "https://www.gstatic.com " +
      "https://gstatic.com " +
      "https://challenges.cloudflare.com " +
      "https://static.cloudflareinsights.com " +
      "data: blob:; " +
      "style-src 'self' 'unsafe-inline' " +
      "https://fonts.googleapis.com " +
      "https://accounts.google.com " +
      "https://www.gstatic.com; " +
      "font-src 'self' " +
      "https://fonts.gstatic.com " +
      "https://accounts.google.com " +
      "data:; " +
      "img-src 'self' data: https: blob:; " +
      "connect-src 'self' https: " +
      "https://accounts.google.com " +
      "https://www.googleapis.com " +
      "https://challenges.cloudflare.com " +
      "wss: ws:; " +
      "frame-src 'self' " +
      "https://accounts.google.com " +
      "https://www.google.com " +
      "https://challenges.cloudflare.com; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self' https:; " +
      "frame-ancestors 'self';"
  )

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const forwarded = request.headers.get('x-forwarded-for')
    const ip =
      forwarded
        ? forwarded.split(',')[0].trim()
        : request.headers.get('x-real-ip') ?? '127.0.0.1'

    // 🔧 B-21：限流桶按路径区分，各自独立计数
    let bucket = 'api'
    let limit = 10
    let windowMs = 60000

    if (request.nextUrl.pathname.includes('/auth/')) {
      bucket = 'auth'
      limit = 5
      windowMs = 300000
    } else if (request.nextUrl.pathname.includes('/payment/')) {
      bucket = 'payment'
      limit = 3
      windowMs = 600000
    }

    if (!rateLimit(`${ip}:${bucket}`, limit, windowMs)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      )
    }
  }

  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
