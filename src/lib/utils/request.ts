/**
 * 通用请求工具（与产品无关）。
 *
 * 为什么在这里
 * ------------
 * 这三个函数原先住在 `src/lib/flux-kontext-request.ts` —— 一个**产品模块**里。
 * 但它们与 Flux 毫无关系（IP 提取、Turnstile 人机校验、verbose 日志），
 * 结果导致通用的 `/api/ai/image` 也要 import 产品模块（反向依赖）。
 *
 * Phase 8 把它们提到通用位置，产品模块与通用路由都能用，方向不再倒挂。
 */

const verboseLogging =
  process.env.ENABLE_VERBOSE_LOGS === 'true' &&
  process.env.NODE_ENV !== 'production'

/** 仅在 `ENABLE_VERBOSE_LOGS=true` 且非生产环境时输出。 */
export function verboseLog(message: string, payload?: unknown) {
  if (!verboseLogging) {
    return
  }

  if (typeof payload === 'undefined') {
    console.log('[verbose]', message)
    return
  }

  console.log('[verbose]', message, payload)
}

/** 从请求头解析客户端 IP（Cloudflare / 代理 / 直连）。 */
export function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for') ||
    headers.get('x-real-ip') ||
    'unknown'
  )
}

/**
 * 校验 Cloudflare Turnstile 人机验证 token。
 *
 * 失败重试最多 3 次（区分 5xx / 4xx 的退避）。未配置 secret 时返回 false
 * （调用方应把「未配置」与「校验失败」区分对待）。
 */
export async function verifyTurnstileToken(
  token: string,
  clientIP: string
): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY
  if (!secretKey) {
    console.error('❌ Turnstile secret key not configured')
    return false
  }

  verboseLog('🔑 Starting Turnstile token verification')

  const maxRetries = 3
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const formData = new FormData()
      formData.append('secret', secretKey)
      formData.append('response', token)

      if (clientIP && clientIP !== 'unknown' && clientIP !== '127.0.0.1') {
        formData.append('remoteip', clientIP)
        verboseLog(`🌐 Adding client IP to Turnstile verification (attempt ${attempt}/${maxRetries})`)
      } else {
        verboseLog(`🌐 Skipping IP verification (attempt ${attempt}/${maxRetries})`)
      }

      console.log(`🚀 Sending Turnstile verification request... (attempt ${attempt}/${maxRetries})`)
      const verifyResponse = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: formData,
          headers: {
            'User-Agent': 'AISaaS/1.0',
          },
          signal: AbortSignal.timeout(15000),
        }
      )

      if (!verifyResponse.ok) {
        const errorMsg = `❌ Turnstile API response error: ${verifyResponse.status} ${verifyResponse.statusText}`
        console.error(errorMsg)
        lastError = new Error(errorMsg)

        if (verifyResponse.status >= 500 && attempt < maxRetries) {
          console.log(`⏳ Server error, retrying after ${2000 * attempt}ms...`)
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
          continue
        }

        if (
          verifyResponse.status >= 400 &&
          verifyResponse.status < 500 &&
          attempt < maxRetries
        ) {
          console.log(`⏳ Client error, retrying after ${1000 * attempt}ms...`)
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
          continue
        }

        return false
      }

      const result = await verifyResponse.json()
      console.log(`📋 Turnstile verification response (attempt ${attempt}):`, {
        success: result.success,
        'error-codes': result['error-codes'],
        challenge_ts: result.challenge_ts,
        hostname: result.hostname,
        action: result.action,
      })

      if (result.success === true) {
        console.log(`✅ Turnstile verification successful (attempt ${attempt})`)
        return true
      }

      if (result['error-codes']) {
        const errorCodes = result['error-codes']
        console.warn('⚠️ Turnstile verification failed, error codes:', errorCodes)

        const retryableErrors = [
          'timeout-or-duplicate',
          'internal-error',
          'invalid-input-response',
          'bad-request',
        ]
        const hasRetryableError = errorCodes.some((code: string) =>
          retryableErrors.includes(code)
        )
        const hasHostnameError = errorCodes.includes('hostname-mismatch')
        const isDevelopment = process.env.NODE_ENV === 'development'

        if (hasHostnameError && isDevelopment) {
          console.log('🔧 Development environment detected hostname mismatch, but allowing pass')
          return true
        }

        if (hasRetryableError && attempt < maxRetries) {
          console.log(`⏳ Detected retryable error, retrying after ${2000 * attempt}ms...`)
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
          continue
        }

        lastError = new Error(`Turnstile verification failed: ${errorCodes.join(', ')}`)
      }

      break
    } catch (error) {
      console.error(`❌ Turnstile verification network error (attempt ${attempt}):`, error)
      lastError = error

      if (attempt < maxRetries) {
        console.log(`⏳ Network error, retrying after ${2000 * attempt}ms...`)
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
        continue
      }
    }
  }

  console.error(`❌ Turnstile verification final failure, attempted ${maxRetries} times:`, lastError)
  return false
}
