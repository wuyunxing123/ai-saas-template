# fal-ai 集成实施计划 - Veo3.ai 项目

## 🎯 总体目标

将 `fal-ai-community/video-starter-kit` 的核心AI视频生成功能集成到 Veo3.ai 项目中，实现从纯前端展示到完整AI视频生成平台的升级。

## 📋 实施阶段规划

### 🚀 阶段一：基础API集成 (1-2周)

#### 目标
- 集成 fal.ai 客户端SDK
- 实现API代理和速率限制
- 建立基础的AI模型调用能力

#### 具体任务

**1. 安装依赖包**
```bash
# 安装 fal.ai 相关依赖
npm install @fal-ai/client @fal-ai/server-proxy

# 安装速率限制依赖
npm install @upstash/ratelimit @vercel/kv

# 安装React Query用于数据管理
npm install @tanstack/react-query
```

**2. 创建API代理** (`src/app/api/fal/route.ts`)
```typescript
import { route } from "@fal-ai/server-proxy/nextjs"
import { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

// 速率限制配置
const limiter = {
  perMinute: 10,
  perHour: 30, 
  perDay: 100
}

export const POST = async (req: NextRequest) => {
  // 1. 用户认证检查
  const session = await getServerSession(authOptions)
  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  // 2. 速率限制检查
  const ip = req.headers.get("x-forwarded-for") || ""
  const limiterResult = await shouldLimitRequest(limiter, ip)
  if (limiterResult.shouldLimitRequest) {
    return new Response(`Rate limit exceeded`, { status: 429 })
  }

  // 3. 积分检查 (可选)
  const userCredits = await getUserCredits(session.user.id)
  if (userCredits < 1) {
    return new Response("Insufficient credits", { status: 402 })
  }

  // 4. 转发到 fal.ai
  return route.POST(req)
}

export const { GET, PUT } = route
```

**3. 创建fal.ai客户端配置** (`src/lib/fal-client.ts`)
```typescript
"use client"

import { createFalClient } from "@fal-ai/client"

export const fal = createFalClient({
  credentials: () => {
    // 从localStorage获取API密钥
    if (typeof localStorage === "object") {
      return localStorage.getItem("falKey") as string
    }
    return undefined
  },
  proxyUrl: "/api/fal",
})

// 支持的AI模型配置
export const AVAILABLE_ENDPOINTS = [
  {
    endpointId: "fal-ai/veo2",
    label: "Veo 2",
    description: "Google Veo 2 - 高质量视频生成",
    category: "video",
    from: "Google"
  },
  {
    endpointId: "fal-ai/minimax/video-01-live", 
    label: "Minimax Video 01",
    description: "高质量视频，逼真的运动和物理效果",
    category: "video"
  },
  {
    endpointId: "fal-ai/kling-video/v1.5/pro",
    label: "Kling 1.5 Pro", 
    description: "高质量视频生成",
    category: "video"
  }
]
```

#### 验收标准
- ✅ fal.ai API调用成功
- ✅ 速率限制正常工作
- ✅ 用户认证集成完成
- ✅ 基础错误处理实现

---

### 🗄️ 阶段二：数据模型扩展 (1周)

#### 目标
- 扩展Prisma数据模型
- 创建视频生成相关的数据表
- 实现数据服务层

#### 具体任务

**1. 扩展Prisma模型** (`prisma/schema.prisma`)
```prisma
model VideoGeneration {
  id          String   @id @default(cuid())
  userId      String
  prompt      String
  type        String   @default("text-to-video") // "text-to-video" | "image-to-video"
  duration    Int      @default(5) // 5 or 8 seconds
  quality     String   @default("720p") // "360p" | "540p" | "720p" | "1080p"
  aspectRatio String   @default("16:9") // "16:9" | "9:16" | "1:1" | "3:4"
  soundEnabled Boolean @default(false)
  mode        String   @default("fast") // "fast" | "normal"
  
  // AI模型相关
  endpointId  String   @default("fal-ai/veo2")
  requestId   String?  // fal.ai请求ID
  
  // 状态和结果
  status      String   @default("pending") // "pending" | "processing" | "completed" | "failed"
  videoUrl    String?
  thumbnailUrl String?
  errorMessage String?
  
  // 元数据
  creditsUsed Int      @default(1)
  createdAt   DateTime @default(now())
  completedAt DateTime?
  
  // 关联
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@map("video_generations")
}

// 扩展User模型
model User {
  // ... 现有字段
  videoGenerations VideoGeneration[]
}
```

**2. 创建数据服务层** (`src/lib/services/video-generation.ts`)
```typescript
import { prisma } from "@/lib/prisma"

export interface CreateVideoGenerationData {
  userId: string
  prompt: string
  type?: string
  duration?: number
  quality?: string
  aspectRatio?: string
  soundEnabled?: boolean
  mode?: string
  endpointId?: string
}

export const videoGenerationService = {
  // 创建生成记录
  async create(data: CreateVideoGenerationData) {
    return prisma.videoGeneration.create({
      data: {
        ...data,
        status: "pending"
      }
    })
  },

  // 更新生成状态
  async updateStatus(id: string, status: string, data?: {
    videoUrl?: string
    thumbnailUrl?: string
    errorMessage?: string
    requestId?: string
  }) {
    return prisma.videoGeneration.update({
      where: { id },
      data: {
        status,
        ...data,
        completedAt: status === "completed" ? new Date() : undefined
      }
    })
  },

  // 获取用户的生成历史
  async getUserGenerations(userId: string, limit = 20) {
    return prisma.videoGeneration.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit
    })
  },

  // 获取单个生成记录
  async findById(id: string) {
    return prisma.videoGeneration.findUnique({
      where: { id },
      include: { user: true }
    })
  }
}
```

**3. 数据库迁移**
```bash
# 生成迁移文件
npx prisma migrate dev --name add_video_generation

# 更新数据库
npx prisma db push
```

#### 验收标准
- ✅ 数据库表创建成功
- ✅ CRUD操作正常工作
- ✅ 数据关联正确建立
- ✅ 迁移脚本无错误

---

### 🎨 阶段三：UI组件开发 (1-2周)

#### 目标
- 重构现有的DashboardContent组件
- 实现真实的视频生成功能
- 添加生成历史和状态管理

#### 具体任务

**1. 创建视频生成Hook** (`src/hooks/useVideoGeneration.ts`)
```typescript
"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fal } from "@/lib/fal-client"
import { videoGenerationService } from "@/lib/services/video-generation"
import { useSession } from "next-auth/react"
import { toast } from "@/hooks/use-toast"

export interface GenerateVideoData {
  prompt: string
  duration: number
  quality: string
  aspectRatio: string
  soundEnabled: boolean
  mode: string
  endpointId: string
}

export function useVideoGeneration() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()

  // 生成视频的mutation
  const generateVideo = useMutation({
    mutationFn: async (data: GenerateVideoData) => {
      if (!session?.user?.id) throw new Error("User not authenticated")

      // 1. 创建数据库记录
      const generation = await videoGenerationService.create({
        userId: session.user.id,
        ...data
      })

      // 2. 调用fal.ai API
      const result = await fal.subscribe(data.endpointId, {
        input: {
          prompt: data.prompt,
          duration: data.duration,
          aspect_ratio: data.aspectRatio,
          // ... 其他参数
        },
        onQueueUpdate: (update) => {
          console.log("Queue update:", update)
        }
      })

      // 3. 更新数据库记录
      await videoGenerationService.updateStatus(generation.id, "completed", {
        videoUrl: result.video.url,
        thumbnailUrl: result.thumbnail?.url,
        requestId: result.requestId
      })

      return { generation, result }
    },
    onSuccess: () => {
      toast({
        title: "视频生成成功！",
        description: "您的AI视频已经生成完成"
      })
      // 刷新历史记录
      queryClient.invalidateQueries({ queryKey: ["video-generations"] })
    },
    onError: (error) => {
      toast({
        title: "生成失败",
        description: error.message,
        variant: "destructive"
      })
    }
  })

  // 获取生成历史
  const { data: generations, isLoading } = useQuery({
    queryKey: ["video-generations", session?.user?.id],
    queryFn: () => {
      if (!session?.user?.id) return []
      return videoGenerationService.getUserGenerations(session.user.id)
    },
    enabled: !!session?.user?.id
  })

  return {
    generateVideo,
    generations,
    isLoading,
    isGenerating: generateVideo.isPending
  }
}
```

**2. 重构DashboardContent组件** (`src/components/DashboardContent.tsx`)
```typescript
"use client"

import { useState } from "react"
import { useVideoGeneration } from "@/hooks/useVideoGeneration"
import { AVAILABLE_ENDPOINTS } from "@/lib/fal-client"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Play, Download } from "lucide-react"

export function DashboardContent() {
  const { generateVideo, generations, isGenerating } = useVideoGeneration()
  
  const [formData, setFormData] = useState({
    prompt: "",
    duration: 5,
    quality: "720p",
    aspectRatio: "16:9",
    soundEnabled: false,
    mode: "fast",
    endpointId: "fal-ai/veo2"
  })

  const handleGenerate = () => {
    if (!formData.prompt.trim()) {
      toast({
        title: "请输入提示词",
        description: "提示词不能为空",
        variant: "destructive"
      })
      return
    }
    generateVideo.mutate(formData)
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 生成表单 */}
        <Card>
          <CardHeader>
            <CardTitle>AI视频生成器</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 提示词输入 */}
            <div>
              <label className="text-sm font-medium">提示词</label>
              <Textarea
                placeholder="描述您想要生成的视频内容..."
                value={formData.prompt}
                onChange={(e) => setFormData(prev => ({ ...prev, prompt: e.target.value }))}
                rows={3}
              />
            </div>

            {/* AI模型选择 */}
            <div>
              <label className="text-sm font-medium">AI模型</label>
              <Select value={formData.endpointId} onValueChange={(value) => setFormData(prev => ({ ...prev, endpointId: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABLE_ENDPOINTS.map((endpoint) => (
                    <SelectItem key={endpoint.endpointId} value={endpoint.endpointId}>
                      <div className="flex items-center gap-2">
                        <span>{endpoint.label}</span>
                        {endpoint.from && (
                          <Badge variant="secondary" className="text-xs">
                            {endpoint.from}
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 其他参数 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">时长</label>
                <Select value={formData.duration.toString()} onValueChange={(value) => setFormData(prev => ({ ...prev, duration: parseInt(value) }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5秒</SelectItem>
                    <SelectItem value="8">8秒</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium">质量</label>
                <Select value={formData.quality} onValueChange={(value) => setFormData(prev => ({ ...prev, quality: value }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="360p">360p</SelectItem>
                    <SelectItem value="540p">540p</SelectItem>
                    <SelectItem value="720p">720p</SelectItem>
                    <SelectItem value="1080p">1080p</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 生成按钮 */}
            <Button 
              onClick={handleGenerate} 
              disabled={isGenerating || !formData.prompt.trim()}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                "生成视频"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* 生成历史 */}
        <Card>
          <CardHeader>
            <CardTitle>生成历史</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {generations?.map((generation) => (
                <div key={generation.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {generation.prompt}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant={
                          generation.status === "completed" ? "default" :
                          generation.status === "failed" ? "destructive" :
                          "secondary"
                        }>
                          {generation.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(generation.createdAt).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    
                    {generation.status === "completed" && generation.videoUrl && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline">
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {generation.videoUrl && (
                    <div className="mt-3">
                      <video 
                        src={generation.videoUrl} 
                        controls 
                        className="w-full rounded-md"
                        style={{ maxHeight: "200px" }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

#### 验收标准
- ✅ 视频生成表单正常工作
- ✅ AI模型调用成功
- ✅ 生成历史正确显示
- ✅ 状态管理正常
- ✅ 错误处理完善

---

### 🔧 阶段四：高级功能集成 (2-3周)

#### 目标
- 添加图片转视频功能
- 实现批量生成
- 集成分享和导出功能
- 优化性能和用户体验

#### 具体任务

**1. 图片转视频功能**
- 集成文件上传组件
- 支持图片预处理
- 实现图片+提示词的组合生成

**2. 批量生成功能**
- 支持多个提示词批量生成
- 队列管理和进度显示
- 批量下载功能

**3. 分享和导出**
- 生成分享链接
- 社交媒体分享集成
- 多格式导出支持

**4. 性能优化**
- 实现视频预览缓存
- 优化大文件加载
- 添加进度指示器

#### 验收标准
- ✅ 图片转视频功能正常
- ✅ 批量生成稳定运行
- ✅ 分享功能完整
- ✅ 性能指标达标

---

## 📊 项目里程碑

### 里程碑1：基础集成完成 (第2周末)
- ✅ fal.ai API集成
- ✅ 数据模型扩展
- ✅ 基础UI组件

### 里程碑2：核心功能完成 (第4周末)
- ✅ 视频生成功能
- ✅ 生成历史管理
- ✅ 用户认证集成

### 里程碑3：高级功能完成 (第6周末)
- ✅ 图片转视频
- ✅ 批量生成
- ✅ 分享导出

### 里程碑4：生产就绪 (第8周末)
- ✅ 性能优化
- ✅ 错误处理
- ✅ 用户测试

## 🎯 成功指标

### 技术指标
- **API响应时间**: < 2秒
- **视频生成成功率**: > 95%
- **页面加载时间**: < 3秒
- **错误率**: < 1%

### 业务指标
- **用户生成视频数**: 目标100+/天
- **用户留存率**: > 60%
- **功能使用率**: > 80%

### 用户体验指标
- **界面响应速度**: 优秀
- **操作流程**: 简单直观
- **错误提示**: 清晰明确

## ⚠️ 风险评估

### 技术风险
1. **API稳定性**: fal.ai服务可用性
2. **性能问题**: 大文件处理和存储
3. **兼容性**: 不同浏览器支持

### 业务风险
1. **成本控制**: AI API调用费用
2. **用户体验**: 生成时间较长
3. **内容安全**: 生成内容审核

### 缓解措施
1. **备用方案**: 多AI服务商支持
2. **成本监控**: 实时费用追踪
3. **内容过滤**: 自动审核机制

## 📝 总结

通过分阶段的实施计划，我们可以将 fal-ai 项目的核心功能成功集成到 Veo3.ai 中，实现从展示型网站到功能完整的AI视频生成平台的转变。整个过程预计需要6-8周时间，最终将大幅提升产品的实用价值和用户体验。 