import { NextRequest, NextResponse } from 'next/server'
import '@/app/product-runtime'
import { StorageService } from '@/lib/storage/service'
import { getCurrentUser, getSessionIdentity } from '@/lib/auth-session'

// 支持的文件类型配置
const SUPPORTED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3'],
  document: ['application/pdf', 'text/plain', 'application/json']
}

// 文件大小限制 (MB)
const SIZE_LIMITS = {
  image: 10,
  video: 100,
  audio: 50,
  document: 5
}

const MEDIA_TYPES = new Set(Object.keys(SUPPORTED_TYPES))

function sanitizeSegment(value: string, fallback: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return collapsed || fallback
}

export async function POST(request: NextRequest) {
  try {
    // F-1：身份来自 session.user.id（主键），email 仅作老 session 兜底
    const identity = await getSessionIdentity()
    if (!identity) {
      return NextResponse.json({
        success: false,
        error: '请先登录后再上传文件'
      }, { status: 401 })
    }

    // 检查 Storage 是否可用
    if (!StorageService.isConfigured()) {
      return NextResponse.json({
        success: false,
        error: '存储服务未配置'
      }, { status: 503 })
    }

    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({
        success: false,
        error: '用户不存在'
      }, { status: 404 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const requestedMediaType = (formData.get('mediaType') as string) || 'image'
    const requestedPurpose = (formData.get('purpose') as string) || 'general'
    const mediaType = MEDIA_TYPES.has(requestedMediaType) ? requestedMediaType : 'image'
    const purpose = sanitizeSegment(requestedPurpose, 'general')

    if (!file) {
      return NextResponse.json({
        success: false,
        error: '未选择文件'
      }, { status: 400 })
    }

    // 验证文件类型
    const supportedTypes = SUPPORTED_TYPES[mediaType as keyof typeof SUPPORTED_TYPES]
    if (!supportedTypes || !supportedTypes.includes(file.type)) {
      return NextResponse.json({
        success: false,
        error: `不支持的${mediaType}文件类型: ${file.type}`
      }, { status: 400 })
    }

    // 验证文件大小
    const maxSize = SIZE_LIMITS[mediaType as keyof typeof SIZE_LIMITS] * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json({
        success: false,
        error: `文件大小超过限制 (最大 ${SIZE_LIMITS[mediaType as keyof typeof SIZE_LIMITS]}MB)`
      }, { status: 400 })
    }

    // 上传到 Storage
    const result = await StorageService.uploadFile(file, {
      userId: user.id,
      namespace: 'uploads',
      metadata: { purpose, mediaType },
    })

    return NextResponse.json({
      success: true,
      data: {
        url: result.url,
        key: result.key,
        size: file.size,
        contentType: file.type,
        mediaType,
        purpose
      }
    })

  } catch (error: unknown) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Upload failed' 
      },
      { status: 500 }
    )
  }
}

// 支持的HTTP方法
export async function GET() {
  return NextResponse.json({
    message: 'Upload API - 使用POST方法上传文件',
    supportedTypes: SUPPORTED_TYPES,
    sizeLimits: SIZE_LIMITS
  })
}
