/**
 * Flux Kontext 兼容 API（Phase 8 瘦身版）
 *
 * 职责边界（规格 §12）：本 handler **只**做
 *   1. Auth（session.user.id）
 *   2. Flux 产品策略：参数校验 / 内容安全 / Turnstile
 *   3. 余额预检（为了 402 的友好提示）
 *   4. 交给 `FluxKontextService`（产品服务）
 *   5. 把结果包成 Flux 兼容响应
 *
 * **已移出本文件**（改为基础设施职责）：
 *   · Provider 选择        → FluxKontextService / WorkflowService
 *   · 积分扣减 / 退款       → WorkflowService 的 settlement
 *   · R2 / Storage 转存    → WorkflowService 的 persistResult
 *   · Provider 结果归一化   → WorkflowService 的 normalizeTaskResult
 *   · Task 状态机          → WorkflowService
 *   · Phase 7 审计桥接      → 已删除（真实任务即 ai_task）
 *
 * 路径与响应格式保持不变（规格 §8 / §24：用户不应看到破坏性变化）。
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'

import { getCurrentUser, getSessionIdentity } from '@/lib/auth-session'
import { checkImageSafety, checkPromptSafety } from '@/lib/content-safety/safe-mode'
import {
  FluxKontextService,
  FluxProductError,
  getRequiredCredits,
} from '@/lib/products/flux-kontext'
import { checkUserCredits } from '@/lib/services/credits'
import { TaskError } from '@/lib/workflow/errors'
import {
  getClientIpFromHeaders,
  verboseLog,
  verifyTurnstileToken,
} from '@/lib/utils/request'

export const maxDuration = 60

/** 与旧实现一致：55 秒超时保护（留 5 秒缓冲）。 */
const REQUEST_TIMEOUT_MS = 55_000

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const body = await request.json()

    // ── 1. 参数校验 ───────────────────────────────────────────────────
    if (!body.action || !body.prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: action and prompt are required' },
        { status: 400 }
      )
    }

    if (!FluxKontextService.isValidAction(body.action)) {
      return NextResponse.json(
        { error: `Unsupported action: ${body.action}` },
        { status: 400 }
      )
    }

    // ── 2. 鉴权（F-1：身份来自 session.user.id） ───────────────────────
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json(
        {
          error: 'Sign in to start creating! Get 100 free credits instantly.',
          message: 'Sign in to start creating! Get 100 free credits instantly.',
        },
        { status: 401 }
      )
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { error: 'User not found, please sign in again' },
        { status: 404 }
      )
    }

    // ── 3. Flux 产品策略：内容安全 ─────────────────────────────────────
    const enableContentSafety =
      process.env.NEXT_PUBLIC_ENABLE_CONTENT_SAFETY === 'true'

    if (enableContentSafety) {
      try {
        const promptSafety = await checkPromptSafety(body.prompt)

        if (!promptSafety.isSafe) {
          return NextResponse.json(
            {
              error: 'Input content violated community guidelines',
              message:
                promptSafety.reason ||
                'Your prompt contains inappropriate content, please modify and try again',
              code: 'CONTENT_VIOLATION',
              provider: promptSafety.provider,
            },
            { status: 400 }
          )
        }
      } catch (safetyError) {
        console.error('❌ Content safety check error:', safetyError)
        return NextResponse.json(
          {
            error: 'Content safety check service error',
            message: 'Please try again later',
            code: 'SAFETY_CHECK_ERROR',
          },
          { status: 503 }
        )
      }
    }

    // ── 4. 余额预检（为了 402 的友好提示；真正扣费在 Workflow） ────────
    const requiredCredits = getRequiredCredits(body.action)
    const creditCheck = await checkUserCredits(user.id, requiredCredits)

    if (!creditCheck.hasEnoughCredits) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `${body.action} requires ${requiredCredits} credits, current balance: ${creditCheck.currentCredits} credits`,
          currentCredits: creditCheck.currentCredits,
          requiredCredits,
          shortfall: creditCheck.shortfall,
        },
        { status: 402 }
      )
    }

    // ── 5. Flux 产品策略：Turnstile 人机校验 ───────────────────────────
    const turnstileResponse = await enforceTurnstile(request, body, user.email)
    if (turnstileResponse) return turnstileResponse

    // ── 6. 交给产品服务（内部走 WorkflowService 同步路径） ──────────────
    verboseLog('🎨 Flux generation start', {
      action: body.action,
      promptLength: typeof body.prompt === 'string' ? body.prompt.length : 0,
      imageUrlsCount: body.image_urls?.length || 0,
    })

    const outcome = await withTimeout(
      FluxKontextService.generate({
        userId: user.id,
        action: body.action,
        prompt: body.prompt,
        imageUrl: body.image_url,
        imageUrls: body.image_urls,
        aspectRatio: body.aspect_ratio,
        seed: body.seed,
        guidanceScale: body.guidance_scale,
        numImages: body.num_images,
        safetyTolerance: body.safety_tolerance,
        outputFormat: body.output_format,
      })
    )

    const legacyResult = FluxKontextService.toLegacyResult(outcome.task)

    // ── 7. Flux 产品策略：生成结果安全检查（可选） ─────────────────────
    let safetyWarning = ''
    if (enableContentSafety && legacyResult.images.length > 0) {
      safetyWarning = await checkGeneratedImages(legacyResult.images)
    }

    const responseData: Record<string, unknown> = {
      success: true,
      provider: outcome.provider,
      data: legacyResult,
      credits_remaining: outcome.creditsRemaining,
      safety_check: {
        prompt_safe: true,
        images_checked: legacyResult.images.length,
        images_passed: legacyResult.images.length,
      },
    }

    if (safetyWarning) {
      responseData.warning = safetyWarning
    }

    return NextResponse.json(responseData)
  } catch (error) {
    return handlePostError(error, startTime)
  }
}

// ─────────────────────────────────────────────────────────────────────
// PUT：输入文件上传（Flux 产品策略）
// ─────────────────────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  try {
    // F-1：Storage key 的用户隔离应使用 user.id（主键），不是 email
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' },
        { status: 400 }
      )
    }

    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }

    // 用 id 做 Storage key 的用户隔离（老 session 无 id 时退回 email）
    const storageUserId = identity.id || identity.email
    const url = await FluxKontextService.uploadFile(file, storageUserId)

    return NextResponse.json({ success: true, url })
  } catch (error: unknown) {
    console.error('File upload error:', error)

    return NextResponse.json(
      {
        error: 'File upload failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// 辅助（Flux 产品策略）
// ─────────────────────────────────────────────────────────────────────

/** 超时包装：与旧实现一致，防止请求挂死。 */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error('Request timeout: Generation took longer than 55 seconds')),
        REQUEST_TIMEOUT_MS
      )
    ),
  ])
}

/**
 * Turnstile 校验（保持旧逻辑：注册用户带 token 才校验，匿名用户必须校验）。
 * @returns 需要中断时返回响应，否则返回 null
 */
async function enforceTurnstile(
  request: NextRequest,
  body: Record<string, unknown>,
  userEmail: string | null | undefined
): Promise<NextResponse | null> {
  if (process.env.NEXT_PUBLIC_ENABLE_TURNSTILE !== 'true') {
    return null
  }

  const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
  const isRegisteredUser = !!userEmail
  const requiresVerification = isRegisteredUser ? !!token : true

  if (!requiresVerification) {
    return null
  }

  if (!token) {
    return NextResponse.json(
      {
        error: 'Human verification required',
        message: 'Please complete human verification and try again',
        code: 'TURNSTILE_TOKEN_MISSING',
      },
      { status: 400 }
    )
  }

  try {
    const clientIP = getClientIpFromHeaders(request.headers)
    const isValid = await verifyTurnstileToken(token, clientIP)

    if (!isValid) {
      return NextResponse.json(
        {
          error: 'Human verification failed',
          message: 'Please complete human verification again',
          code: 'TURNSTILE_VERIFICATION_FAILED',
        },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('❌ Turnstile verification error:', error)
    return NextResponse.json(
      {
        error: 'Human verification service error',
        message: 'Verification service temporarily unavailable, please try again later',
        code: 'TURNSTILE_SERVICE_ERROR',
      },
      { status: 503 }
    )
  }

  return null
}

/** 对生成结果做图片安全扫描，返回给用户的安全提示（无问题时为空串）。 */
async function checkGeneratedImages(
  images: Array<{ url: string }>
): Promise<string> {
  try {
    const checks = await Promise.allSettled(
      images.map((image) =>
        image.url ? checkImageSafety(image.url) : Promise.resolve({ isSafe: true })
      )
    )

    const unsafeCount = checks.filter(
      (c) => c.status === 'fulfilled' && !c.value.isSafe
    ).length

    if (unsafeCount > 0) {
      return `${unsafeCount} images potentially contain sensitive content, please use with caution`
    }
  } catch (error) {
    console.warn('⚠️ Image safety check failed, but not affecting main flow:', error)
  }

  return ''
}

/** POST 的统一错误映射（对外只给 code + 收敛文案，不透内部细节）。 */
function handlePostError(error: unknown, startTime: number): NextResponse {
  console.error('🔥 Flux generation failed:', error)

  // 已知产品错误
  if (error instanceof FluxProductError) {
    const status =
      error.code === 'INVALID_ACTION' || error.code === 'INVALID_ASPECT_RATIO' ? 400 : 500
    return NextResponse.json(
      { error: 'Generation failed', message: error.message, code: error.code },
      { status }
    )
  }

  // 基础设施抛出的 TaskError（余额 / 模型 / Provider 失败等）
  if (error instanceof TaskError) {
    const publicError = error.toPublic()
    const status =
      error.code === 'INSUFFICIENT_CREDITS'
        ? 402
        : error.code === 'INVALID_REQUEST' ||
          error.code === 'UNKNOWN_MODEL' ||
          error.code === 'UNSUPPORTED_MODEL'
          ? 400
          : 500

    return NextResponse.json(
      { error: 'Generation failed', message: publicError.message, code: error.code },
      { status }
    )
  }

  // 超时
  const isTimeout = error instanceof Error && /timeout/i.test(error.message)
  if (isTimeout) {
    return NextResponse.json(
      {
        error: 'Generation timed out',
        message:
          'Generation took too long. If credits were deducted, the task will settle automatically.',
        code: 'PROVIDER_TIMEOUT',
        duration: Date.now() - startTime,
      },
      { status: 504 }
    )
  }

  return NextResponse.json(
    {
      error: 'Image generation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    },
    { status: 500 }
  )
}
