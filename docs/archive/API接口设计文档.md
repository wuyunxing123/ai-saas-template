# Scripto.Video API接口设计文档

## 📊 API架构概览

### 🎯 当前已实现的API
- ✅ `POST /api/video/generate` - 视频生成接口
- ✅ `GET /api/video/status/{id}` - 生成状态查询接口

### 🚧 待实现的API
- ❌ `GET /api/video/history` - 用户生成历史
- ❌ `POST /api/upload/image` - 图片上传接口
- ❌ `POST /api/auth/login` - 用户登录
- ❌ `POST /api/auth/register` - 用户注册
- ❌ `GET /api/user/profile` - 用户信息
- ❌ `POST /api/payment/create` - 创建支付订单

---

## 🎬 视频生成API详解

### 1. 视频生成接口

**接口地址**: `POST /api/video/generate`

**请求参数**:
```typescript
interface GenerateVideoRequest {
  prompt: string                    // 视频描述提示词 (必填)
  duration: "5" | "8"              // 视频时长 (秒)
  quality: "360p" | "540p" | "720p" | "1080p"  // 视频质量
  aspectRatio: "16:9" | "9:16" | "1:1" | "3:4" // 宽高比
  soundEnabled: boolean            // 是否启用音频
  mode: "fast" | "normal"          // 生成模式
  type: "text-to-video" | "image-to-video"     // 生成类型
  imageUrl?: string                // 图片URL (image-to-video时必填)
}
```

**响应格式**:
```typescript
// 成功响应
interface GenerateVideoResponse {
  success: true
  jobId: string                    // 任务ID
  message: string                  // 提示信息
  estimatedTime: number            // 预计完成时间(秒)
  status: "processing"             // 初始状态
}

// 错误响应
interface ErrorResponse {
  error: string                    // 错误信息
}
```

**示例请求**:
```bash
curl -X POST http://localhost:3000/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat walking in the garden",
    "duration": "5",
    "quality": "720p",
    "aspectRatio": "16:9",
    "soundEnabled": true,
    "mode": "fast",
    "type": "text-to-video"
  }'
```

**示例响应**:
```json
{
  "success": true,
  "jobId": "job_1737364800000_abc123def",
  "message": "Video generation started",
  "estimatedTime": 30,
  "status": "processing"
}
```

### 2. 状态查询接口

**接口地址**: `GET /api/video/status/{jobId}`

**路径参数**:
- `jobId`: 视频生成任务ID

**响应格式**:
```typescript
// 处理中
interface ProcessingStatus {
  jobId: string
  status: "processing"
  progress: number                 // 进度百分比 (0-100)
  estimatedTimeRemaining: number   // 剩余时间(秒)
}

// 完成
interface CompletedStatus {
  jobId: string
  status: "completed"
  videoUrl: string                 // 视频下载链接
  thumbnailUrl: string             // 缩略图链接
  duration: number                 // 实际视频时长
  createdAt: string               // 完成时间
}

// 失败
interface FailedStatus {
  jobId: string
  status: "failed"
  error: string                   // 失败原因
  createdAt: string              // 失败时间
}
```

**示例请求**:
```bash
curl http://localhost:3000/api/video/status/job_1737364800000_abc123def
```

**示例响应**:
```json
// 处理中
{
  "jobId": "job_1737364800000_abc123def",
  "status": "processing",
  "progress": 45,
  "estimatedTimeRemaining": 15
}

// 完成
{
  "jobId": "job_1737364800000_abc123def",
  "status": "completed",
  "videoUrl": "https://example.com/videos/job_1737364800000_abc123def.mp4",
  "thumbnailUrl": "https://example.com/thumbnails/job_1737364800000_abc123def.jpg",
  "duration": 5,
  "createdAt": "2025-01-20T10:30:00.000Z"
}

// 失败
{
  "jobId": "job_1737364800000_abc123def",
  "status": "failed",
  "error": "Generation failed due to high system load",
  "createdAt": "2025-01-20T10:30:00.000Z"
}
```

---

## 🔧 前端API调用实现

### 1. API调用函数 (utils/api.ts)

```typescript
// 视频生成API调用
export async function generateVideo(params: GenerateVideoRequest): Promise<GenerateVideoResponse> {
  const response = await fetch('/api/video/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params)
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Generation failed')
  }

  return response.json()
}

// 状态查询API调用
export async function checkVideoStatus(jobId: string): Promise<VideoStatus> {
  const response = await fetch(`/api/video/status/${jobId}`)
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Status check failed')
  }

  return response.json()
}
```

### 2. React Hook封装 (hooks/useVideoGeneration.ts)

```typescript
export function useVideoGeneration() {
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentJob, setCurrentJob] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [video, setVideo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = async (params: GenerateVideoRequest) => {
    try {
      setIsGenerating(true)
      setError(null)
      
      const result = await generateVideo(params)
      setCurrentJob(result.jobId)
      setStatus(`Generation started. Estimated time: ${result.estimatedTime}s`)
      
      // 开始轮询
      pollStatus(result.jobId)
    } catch (err) {
      setError(err.message)
      setIsGenerating(false)
    }
  }

  const pollStatus = async (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await checkVideoStatus(jobId)
        
        if (status.status === 'completed') {
          setVideo(status.videoUrl)
          setStatus("Video generated successfully!")
          setIsGenerating(false)
          clearInterval(interval)
        } else if (status.status === 'failed') {
          setError(status.error)
          setIsGenerating(false)
          clearInterval(interval)
        } else {
          setStatus(`Processing... ${status.progress}% complete`)
        }
      } catch (err) {
        setError('Failed to check status')
        setIsGenerating(false)
        clearInterval(interval)
      }
    }, 3000)

    // 5分钟超时
    setTimeout(() => {
      clearInterval(interval)
      if (isGenerating) {
        setError('Generation timeout')
        setIsGenerating(false)
      }
    }, 300000)
  }

  return {
    generate,
    isGenerating,
    currentJob,
    status,
    video,
    error,
    reset: () => {
      setIsGenerating(false)
      setCurrentJob(null)
      setStatus("")
      setVideo(null)
      setError(null)
    }
  }
}
```

---

## 🚀 如何接入真实AI服务

### 1. Runway ML API集成示例

```typescript
// src/lib/services/runway.ts
export class RunwayService {
  private apiKey: string
  private baseUrl = 'https://api.runwayml.com/v1'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generateVideo(params: {
    prompt: string
    duration: number
    quality: string
  }): Promise<{ taskId: string }> {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: params.prompt,
        duration: params.duration,
        resolution: params.quality
      })
    })

    return response.json()
  }

  async getTaskStatus(taskId: string): Promise<{
    status: string
    progress?: number
    videoUrl?: string
    error?: string
  }> {
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    })

    return response.json()
  }
}
```

### 2. 更新API路由集成真实服务

```typescript
// src/app/api/video/generate/route.ts
import { RunwayService } from '@/lib/services/runway'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { prompt, duration, quality } = body

    // 初始化AI服务
    const runway = new RunwayService(process.env.RUNWAY_API_KEY!)
    
    // 调用真实AI服务
    const result = await runway.generateVideo({
      prompt,
      duration: parseInt(duration),
      quality
    })

    // 存储到数据库
    await saveGenerationTask({
      jobId: result.taskId,
      userId: 'anonymous', // 后续集成用户系统
      prompt,
      status: 'processing',
      createdAt: new Date()
    })

    return NextResponse.json({
      success: true,
      jobId: result.taskId,
      message: 'Video generation started',
      estimatedTime: duration === '5' ? 30 : 60,
      status: 'processing'
    })
  } catch (error) {
    console.error('Generation error:', error)
    return NextResponse.json(
      { error: 'Generation failed' },
      { status: 500 }
    )
  }
}
```

---

## 📊 数据库设计

### 视频生成任务表
```sql
CREATE TABLE video_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) UNIQUE NOT NULL,
  user_id VARCHAR(255),
  prompt TEXT NOT NULL,
  duration INTEGER NOT NULL,
  quality VARCHAR(10) NOT NULL,
  aspect_ratio VARCHAR(10) NOT NULL,
  sound_enabled BOOLEAN DEFAULT false,
  mode VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'processing',
  progress INTEGER DEFAULT 0,
  video_url VARCHAR(500),
  thumbnail_url VARCHAR(500),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
```

---

## 🔐 环境变量配置

```bash
# .env.local
# AI服务配置
RUNWAY_API_KEY=your_runway_api_key
PIKA_API_KEY=your_pika_api_key

# 数据库配置
DATABASE_URL=postgresql://username:password@localhost:5432/scripto_video

# 文件存储配置
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_S3_BUCKET=scripto-video-storage
AWS_REGION=us-east-1

# 应用配置
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 🧪 API测试

### 使用Postman测试
1. **生成视频**:
   - Method: POST
   - URL: http://localhost:3000/api/video/generate
   - Body: JSON格式的生成参数

2. **查询状态**:
   - Method: GET
   - URL: http://localhost:3000/api/video/status/{jobId}

### 使用curl测试
```bash
# 生成视频
curl -X POST http://localhost:3000/api/video/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"A cat walking","duration":"5","quality":"720p","aspectRatio":"16:9","soundEnabled":true,"mode":"fast","type":"text-to-video"}'

# 查询状态
curl http://localhost:3000/api/video/status/job_1737364800000_abc123def
``` 