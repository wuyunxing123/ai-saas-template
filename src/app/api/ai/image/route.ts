/**
 * POST /api/ai/image
 *
 * AI Core 的第一个消费者。它证明一件事：
 * 业务路由可以完全不认识 fal / kie / wavespeed / atlascloud，
 * 只通过 `AIService` 就能完成一次生成。
 *
 * 本阶段刻意复用现有的 Auth / Credit / Turnstile / R2，
 * 不同时重构其他系统（见 REFACTOR_PLAN Phase 2 §2.6 / §2.8）。
 *
 * 与旧 `/api/flux-kontext` 的区别：
 *   旧：请求里传 `action`（产品动作），路由内部再映射到 Provider
 *   新：请求里传 `model`（模型 id），路由直接把请求交给 AIService
 */

import '@/app/product-runtime'
import { NextRequest, NextResponse } from 'next/server'
import { getModel } from '@/lib/ai/models'
import { AIService } from '@/lib/ai/service'
import { getCurrentUser, getSessionIdentity } from '@/lib/auth-session'
import {
  getClientIpFromHeaders,
  verifyTurnstileToken,
  verboseLog,
} from '@/lib/utils/request'
import { StorageService } from '@/lib/storage/service'
import { grantCredits } from '@/lib/db/repositories/credit'
import {
  checkUserCredits,
  consumeUserCredits,
} from '@/lib/services/credits'

export const maxDuration = 60

const STORAGE_ENABLED = StorageService.isConfigured()

export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  // 用于失败退款的上下文（在扣费之后填充）
  let chargedUserId: string | null = null
  let chargedCredits = 0
  let chargeReferenceId = ''

  try {
    const body = (await request.json()) as Record<string, unknown>

    // ── 1. 参数校验（不依赖任何具体模型实现） ──────────────────────
    const parsed = parseImageRequest(body)

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { model, prompt, inputImages, parameters, turnstileToken } = parsed.value

    // ── 2. 鉴权 ────────────────────────────────────────────────────
    // F-1：身份来自 session.user.id（主键），email 仅作老 session 兜底
    const identity = await getSessionIdentity()

    if (!identity) {
      return NextResponse.json(
        {
          error: 'Sign in to start creating!',
          message: 'Sign in to start creating!',
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

    // ── 3. 人机验证（可选） ─────────────────────────────────────────
    const turnstileCheck = await verifyTurnstileIfEnabled(request, turnstileToken)

    if (!turnstileCheck.ok) {
      return NextResponse.json(
        { error: turnstileCheck.error, code: turnstileCheck.code },
        { status: turnstileCheck.status }
      )
    }

    // ── 4. 积分（沿用现有 CreditService，本阶段不重构） ─────────────
    const creditCheck = await checkUserCredits(user.id, model.credits)

    if (!creditCheck.hasEnoughCredits) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `${model.id} requires ${model.credits} credits, current balance: ${creditCheck.currentCredits}`,
          currentCredits: creditCheck.currentCredits,
          requiredCredits: model.credits,
          shortfall: creditCheck.shortfall,
        },
        { status: 402 }
      )
    }

    chargeReferenceId = `ai_image_${Date.now()}_${user.id.slice(0, 8)}`

    const chargeResult = await consumeUserCredits({
      userId: user.id,
      amount: model.credits,
      type: 'usage',
      description: `AI generation - ${model.id}`,
      referenceId: chargeReferenceId,
      metadata: {
        model: model.id,
        prompt: prompt.slice(0, 100),
        entrypoint: '/api/ai/image',
      },
    })

    if (!chargeResult.success) {
      return NextResponse.json(
        { error: 'Credit deduction failed', message: chargeResult.error },
        { status: 402 }
      )
    }

    chargedUserId = user.id
    chargedCredits = model.credits

    verboseLog('🤖 AIService.generate', {
      model: model.id,
      provider: body.provider,
      hasInputImages: !!inputImages?.length,
    })

    // ── 5. 调用 AI Core（这里看不到任何具体厂商） ───────────────────
    const result = await AIService.generate({
      model: model.id,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      prompt,
      inputImages,
      parameters,
    })

    // ── 6. 可选转存 Storage ────────────────────────────────────────
    const persisted = await persistToStorage(result, prompt, user.id)

    return NextResponse.json({
      success: true,
      data: persisted,
      credits_remaining: chargeResult.user?.creditsAfter ?? 0,
      duration: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    // ── 失败退款（走 Credit 原子 RPC + 幂等）───────────────────────
    if (chargedUserId && chargedCredits > 0) {
      try {
        const refund = await grantCredits({
          user_id: chargedUserId,
          amount: chargedCredits,
          type: 'refund',
          description: `Refund for failed AI generation (${chargeReferenceId})`,
          idempotency_key: `${chargeReferenceId}_refund`,
          reference_type: 'ai_generation_refund',
          reference_id: `${chargeReferenceId}_refund`,
          metadata: { reason: message, entrypoint: '/api/ai/image' },
        })
        console.log(
          `💰 Refunded ${chargedCredits} credits to ${chargedUserId} (status=${refund.status}, balance=${refund.balance})`
        )
      } catch (refundError) {
        console.error('❌ Refund failed:', refundError)
      }
    }

    console.error('🔥 /api/ai/image failed:', {
      message,
      duration: Date.now() - startedAt,
    })

    return NextResponse.json(
      {
        error: 'Generation failed',
        message,
        credits_refunded: chargedCredits,
        duration: Date.now() - startedAt,
      },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// 参数解析
// ─────────────────────────────────────────────────────────────────────

type ParsedRequest = {
  model: ReturnType<typeof getModel>
  prompt: string
  inputImages?: string[]
  parameters?: Record<string, unknown>
  turnstileToken?: string
}

type ParseOutcome =
  | { ok: true; value: ParsedRequest }
  | { ok: false; error: string }

function parseImageRequest(body: Record<string, unknown>): ParseOutcome {
  const modelId = typeof body.model === 'string' ? body.model.trim() : ''

  if (!modelId) {
    return { ok: false, error: 'Missing required field: model' }
  }

  let model: ReturnType<typeof getModel>

  try {
    model = getModel(modelId)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Unknown model "${modelId}"`,
    }
  }

  if (model.modality !== 'image') {
    return {
      ok: false,
      error: `Model "${model.id}" is not an image model. Use the matching endpoint for ${model.modality}.`,
    }
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

  if (!prompt) {
    return { ok: false, error: 'Missing required field: prompt' }
  }

  const inputImages = parseInputImages(body.inputImages)

  if (inputImages === null) {
    return { ok: false, error: 'inputImages must be an array of URL strings' }
  }

  const imageError = validateInputImageCount(model, inputImages)

  if (imageError) {
    return { ok: false, error: imageError }
  }

  const parameters =
    body.parameters && typeof body.parameters === 'object'
      ? (body.parameters as Record<string, unknown>)
      : undefined

  return {
    ok: true,
    value: {
      model,
      prompt,
      inputImages: inputImages.length ? inputImages : undefined,
      parameters,
      turnstileToken:
        typeof body.turnstile_token === 'string' ? body.turnstile_token : undefined,
    },
  }
}

/** 返回 `null` 表示格式非法。 */
function parseInputImages(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    return null
  }

  if (!value.every((item) => typeof item === 'string' && item.startsWith('http'))) {
    return null
  }

  return value as string[]
}

function validateInputImageCount(
  model: ReturnType<typeof getModel>,
  inputImages: string[]
): string | null {
  const count = inputImages.length

  if (model.requiredInputImages === 0 && count > 0) {
    return `Model "${model.id}" does not accept input images`
  }

  if (model.requiredInputImages === 1 && count !== 1) {
    return `Model "${model.id}" requires exactly 1 input image (received ${count})`
  }

  if (model.requiredInputImages === 'many' && count < 1) {
    return `Model "${model.id}" requires at least 1 input image`
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────
// Turnstile（复用现有实现，Phase 3 会迁到 lib/security/turnstile.ts）
// ─────────────────────────────────────────────────────────────────────

async function verifyTurnstileIfEnabled(
  request: NextRequest,
  token?: string
): Promise<
  { ok: true } | { ok: false; error: string; code: string; status: number }
> {
  if (process.env.NEXT_PUBLIC_ENABLE_TURNSTILE !== 'true') {
    return { ok: true }
  }

  if (!token) {
    // 与旧路由一致：已登录用户在没有 token 时放行（智能验证模式）
    return { ok: true }
  }

  try {
    const clientIp = getClientIpFromHeaders(request.headers)
    const valid = await verifyTurnstileToken(token, clientIp)

    if (!valid) {
      return {
        ok: false,
        error: 'Human verification failed',
        code: 'TURNSTILE_VERIFICATION_FAILED',
        status: 400,
      }
    }

    return { ok: true }
  } catch (error) {
    console.error('❌ Turnstile verification error:', error)

    return {
      ok: false,
      error: 'Human verification service error',
      code: 'TURNSTILE_SERVICE_ERROR',
      status: 503,
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 转存 AI 输出到 Storage
// ─────────────────────────────────────────────────────────────────────

async function persistToStorage(
  result: Awaited<ReturnType<typeof AIService.generate>>,
  prompt: string,
  userId: string
) {
  if (!STORAGE_ENABLED) {
    return result
  }

  const assets = await Promise.all(
    result.assets.map(async (asset) => {
      try {
        const stored = await StorageService.uploadFromUrl(asset.url, {
          userId,
          namespace: 'generated',
          metadata: { prompt: prompt.substring(0, 500) },
        })
        return { ...asset, url: stored.url, sourceUrl: asset.url, key: stored.key }
      } catch (error) {
        console.warn('⚠️ Storage persist failed, keeping provider URL:', error)
        return asset
      }
    })
  )

  return { ...result, assets }
}
