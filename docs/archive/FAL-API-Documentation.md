# FAL AI FLUX Kontext API 完整文档

## 📋 目录

1. [API概述](#api概述)
2. [认证配置](#认证配置)
3. [模型端点](#模型端点)
4. [输入参数详解](#输入参数详解)
5. [输出格式](#输出格式)
6. [代码示例](#代码示例)
7. [最佳实践](#最佳实践)
8. [错误处理](#错误处理)
9. [性能优化](#性能优化)

---

## 📊 API概述

FAL AI提供了多个FLUX Kontext模型，专门用于AI图像生成和编辑：

### 🎯 核心功能
- **图像编辑** - 基于文本提示词编辑现有图像
- **文本生成图像** - 从文本描述生成全新图像
- **多图像处理** - 同时处理多张图像（实验性功能）
- **角色一致性** - 保持角色在不同场景中的一致性

---

## 🔐 认证配置

### 环境变量设置
```bash
export FAL_KEY="YOUR_API_KEY"
```

### 客户端配置
```javascript
import { fal } from "@fal-ai/client";

// 方法1：使用环境变量（推荐）
// FAL_KEY环境变量会自动被读取

// 方法2：手动配置
fal.config({
  credentials: "YOUR_FAL_KEY"
});
```

### 🚨 安全提醒
- **客户端应用**：不要在浏览器中暴露API密钥
- **推荐方案**：使用服务器端代理进行API调用
- **生产环境**：始终使用环境变量管理密钥

---

## 🎯 模型端点

### 1. 图像编辑模型

#### Kontext [pro] - 图像编辑
```
端点: "fal-ai/flux-pro/kontext"
功能: 快速迭代编辑，保持角色一致性
速度: 快速 (6-10秒)
成本: 16积分
```

#### Kontext [max] - 图像编辑
```
端点: "fal-ai/flux-pro/kontext/max"
功能: 最高性能，改进的提示遵循和排版生成
速度: 较慢 (10-15秒)
成本: 32积分
```

#### Kontext [max] - 多图像编辑（实验性）
```
端点: "fal-ai/flux-pro/kontext/max/multi"
功能: 实验性多图像编辑，支持角色一致性
速度: 慢 (15-25秒)
成本: 48积分
```

### 2. 文本生成图像模型

#### Kontext [pro] - 文本生成图像
```
端点: "fal-ai/flux-pro/kontext/text-to-image"
功能: 高质量文本到图像生成
速度: 快速 (6-10秒)
成本: 16积分
```

---

## 📋 输入参数详解

### 🔧 图像编辑参数

#### 必需参数
```typescript
interface ImageEditInput {
  prompt: string        // 编辑提示词
  image_url: string     // 单图像编辑
  // 或
  image_urls: string[]  // 多图像编辑
}
```

#### 可选参数
```typescript
interface OptionalParams {
  seed?: number                    // 随机种子 (可重现结果)
  guidance_scale?: number          // CFG引导强度 (默认: 3.5, 范围: 1-10)
  num_images?: number             // 生成图像数量 (默认: 1)
  safety_tolerance?: "1"|"2"|"3"|"4"|"5"|"6"  // 安全级别 (默认: "2")
  output_format?: "jpeg"|"png"    // 输出格式 (默认: "jpeg")
  sync_mode?: boolean             // 同步模式 (默认: false)
}
```

### 🔧 文本生成图像参数

#### 必需参数
```typescript
interface TextToImageInput {
  prompt: string        // 生成提示词
}
```

#### 可选参数
```typescript
interface TextToImageOptional {
  aspect_ratio?: "21:9"|"16:9"|"4:3"|"3:2"|"1:1"|"2:3"|"3:4"|"9:16"|"9:21"
  seed?: number
  guidance_scale?: number
  num_images?: number
  safety_tolerance?: "1"|"2"|"3"|"4"|"5"|"6"
  output_format?: "jpeg"|"png"
  sync_mode?: boolean
}
```

### ⚠️ 重要注意事项

#### ❌ 图像编辑模式不支持的参数
```typescript
// 以下参数在图像编辑模式下不被支持：
// aspect_ratio - Kontext图像编辑API不支持此参数
```

#### ✅ 参数使用规则
- **图像编辑**：不使用 `aspect_ratio`，输出尺寸基于输入图像
- **文本生成图像**：可以使用 `aspect_ratio` 控制输出尺寸
- **多图像编辑**：使用 `image_urls` 数组而不是单个 `image_url`

---

## 📊 输出格式

### 标准响应结构
```typescript
interface APIResponse {
  images: Array<{
    url: string           // 生成的图像URL
    width: number         // 图像宽度
    height: number        // 图像高度
    content_type: string  // MIME类型 (默认: "image/jpeg")
  }>
  seed: number            // 使用的随机种子
  has_nsfw_concepts: boolean[]  // NSFW检测结果
  prompt: string          // 使用的提示词
  timings?: object        // 时间统计信息
}
```

### 响应示例
```json
{
  "images": [
    {
      "height": 1024,
      "url": "https://fal.media/files/tiger/7dSJbIU_Ni-0Zp9eaLsvR_fe56916811d84ac69c6ffc0d32dca151.jpg",
      "width": 1024,
      "content_type": "image/jpeg"
    }
  ],
  "seed": 123456,
  "has_nsfw_concepts": [false],
  "prompt": "Put a donut next to the flour."
}
```

---

## 💻 代码示例

### 1. 图像编辑 - Kontext [pro]

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
  input: {
    prompt: "Put a donut next to the flour.",
    image_url: "https://v3.fal.media/files/rabbit/rmgBxhwGYb2d3pl3x9sKf_output.png",
    guidance_scale: 3.5,
    num_images: 1,
    safety_tolerance: "2",
    output_format: "jpeg"
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      update.logs.map((log) => log.message).forEach(console.log);
    }
  },
});

console.log(result.data);
```

### 2. 图像编辑 - Kontext [max]

```javascript
const result = await fal.subscribe("fal-ai/flux-pro/kontext/max", {
  input: {
    prompt: "Change the background to a sunset scene",
    image_url: "https://example.com/image.jpg",
    guidance_scale: 4.0,
    num_images: 1,
    safety_tolerance: "2",
    output_format: "png"
  },
  logs: true
});
```

### 3. 多图像编辑 - Kontext [max] Multi

```javascript
const result = await fal.subscribe("fal-ai/flux-pro/kontext/max/multi", {
  input: {
    prompt: "Put the little duckling on top of the woman's t-shirt.",
    image_urls: [
      "https://v3.fal.media/files/penguin/XoW0qavfF-ahg-jX4BMyL_image.webp",
      "https://v3.fal.media/files/tiger/bml6YA7DWJXOigadvxk75_image.webp"
    ],
    guidance_scale: 3.5,
    num_images: 1,
    safety_tolerance: "2"
  },
  logs: true
});
```

### 4. 文本生成图像 - Kontext [pro]

```javascript
const result = await fal.subscribe("fal-ai/flux-pro/kontext/text-to-image", {
  input: {
    prompt: "Extreme close-up of a single tiger eye, direct frontal view. Detailed iris and pupil. Sharp focus on eye texture and color. Natural lighting to capture authentic eye shine and depth. The word \"FLUX\" is painted over it in big, white brush strokes with visible texture.",
    aspect_ratio: "1:1",
    guidance_scale: 3.5,
    num_images: 1,
    safety_tolerance: "2",
    output_format: "jpeg"
  },
  logs: true
});
```

### 5. 队列模式处理（长时间任务）

```javascript
// 提交请求到队列
const { request_id } = await fal.queue.submit("fal-ai/flux-pro/kontext", {
  input: {
    prompt: "Add a red hat to the person",
    image_url: "https://example.com/image.jpg"
  },
  webhookUrl: "https://optional.webhook.url/for/results"
});

// 检查状态
const status = await fal.queue.status("fal-ai/flux-pro/kontext", {
  requestId: request_id,
  logs: true
});

// 获取结果
const result = await fal.queue.result("fal-ai/flux-pro/kontext", {
  requestId: request_id
});
```

### 6. 文件上传

```javascript
// 上传本地文件
const file = new File(["Hello, World!"], "hello.txt", { type: "text/plain" });
const url = await fal.storage.upload(file);

// 使用上传的文件URL
const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
  input: {
    prompt: "Enhance this image",
    image_url: url
  }
});
```

---

## 🎯 最佳实践

### 1. 模型选择指南

#### 选择Kontext [pro] 当：
- ✅ 需要快速迭代编辑
- ✅ 成本控制重要
- ✅ 基础编辑需求
- ✅ 保持角色一致性

#### 选择Kontext [max] 当：
- ✅ 需要最高质量输出
- ✅ 复杂的提示词遵循
- ✅ 排版和文字生成
- ✅ 专业级结果

#### 选择Multi模式当：
- ✅ 需要处理多张图像
- ✅ 角色一致性跨图像
- ✅ 实验性功能可接受

### 2. 参数优化建议

#### Guidance Scale 设置
```javascript
// 创意性编辑 (更自由)
guidance_scale: 1.0 - 2.5

// 平衡模式 (推荐)
guidance_scale: 3.0 - 4.0

// 严格遵循 (精确控制)
guidance_scale: 4.5 - 7.0
```

#### Safety Tolerance 设置
```javascript
// 最严格 (家庭友好)
safety_tolerance: "1"

// 平衡 (推荐)
safety_tolerance: "2"

// 宽松 (创意内容)
safety_tolerance: "3" - "5"
```

### 3. 提示词最佳实践

#### 图像编辑提示词
```javascript
// ✅ 好的提示词
"Add a red hat to the person"
"Change the background to a sunset"
"Make the cat wear sunglasses"

// ❌ 避免的提示词
"Make it better"
"Fix this image"
"Change everything"
```

#### 文本生成图像提示词
```javascript
// ✅ 详细描述
"Professional portrait of a wise elderly wizard with flowing silver beard, intricate robes, magical aura, studio lighting, highly detailed"

// ✅ 风格指定
"Modern minimalist architecture, clean lines, glass and steel, natural lighting, professional photography"

// ✅ 技术规格
"Photorealistic, 8K resolution, award-winning composition, cinematic lighting"
```

---

## ⚠️ 错误处理

### 常见错误类型

#### 1. 认证错误
```javascript
try {
  const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
    input: { /* ... */ }
  });
} catch (error) {
  if (error.message.includes('authentication')) {
    console.error('API密钥无效或未设置');
  }
}
```

#### 2. 参数错误
```javascript
// 图像编辑时不要使用aspect_ratio
const input = {
  prompt: "Edit this image",
  image_url: "https://example.com/image.jpg",
  // aspect_ratio: "1:1"  // ❌ 不支持
};
```

#### 3. 图像URL错误
```javascript
// 确保图像URL可公开访问
const isValidUrl = (url) => {
  return url.startsWith('http') && !url.includes('localhost');
};
```

#### 4. NSFW内容检测
```javascript
const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
  input: { /* ... */ }
});

// 检查NSFW检测结果
if (result.data.has_nsfw_concepts.some(nsfw => nsfw)) {
  console.warn('检测到NSFW内容，请调整提示词');
}
```

---

## 🚀 性能优化

### 1. 同步vs异步模式

#### 同步模式 (sync_mode: true)
```javascript
// 适用于：实时应用，小批量处理
const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
  input: {
    prompt: "Quick edit",
    image_url: "https://example.com/image.jpg",
    sync_mode: true  // 等待完成后返回
  }
});
```

#### 异步模式 (队列)
```javascript
// 适用于：批量处理，长时间任务
const { request_id } = await fal.queue.submit("fal-ai/flux-pro/kontext", {
  input: { /* ... */ },
  webhookUrl: "https://your-webhook.com/callback"
});
```

### 2. 批量处理策略

```javascript
// 并发处理多个请求
const requests = images.map(imageUrl => 
  fal.queue.submit("fal-ai/flux-pro/kontext", {
    input: {
      prompt: "Enhance this image",
      image_url: imageUrl
    }
  })
);

const requestIds = await Promise.all(requests);
```

### 3. 缓存策略

```javascript
// 使用相同的seed获得一致结果
const seed = 123456;
const result = await fal.subscribe("fal-ai/flux-pro/kontext", {
  input: {
    prompt: "Add a hat",
    image_url: "https://example.com/image.jpg",
    seed: seed  // 相同输入+seed = 相同输出
  }
});
```

### 4. 成本优化

```javascript
// 成本对比 (每次调用)
const costs = {
  "kontext-pro": 16,      // 最经济
  "kontext-max": 32,      // 高质量
  "kontext-max-multi": 48 // 多图像
};

// 根据需求选择合适模型
const endpoint = needsHighQuality ? 
  "fal-ai/flux-pro/kontext/max" : 
  "fal-ai/flux-pro/kontext";
```

---

## 📚 附录

### A. 支持的图像格式
- **输入**: JPEG, PNG, WebP
- **输出**: JPEG, PNG

### B. 图像尺寸限制
- **最大尺寸**: 2048x2048
- **推荐尺寸**: 1024x1024
- **最小尺寸**: 512x512

### C. API限制
- **并发请求**: 根据订阅计划
- **文件大小**: 最大10MB
- **超时时间**: 300秒

### D. 支持的长宽比
```
21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21
```

---

## 🔗 相关链接

- [FAL AI官方文档](https://fal.ai/docs)
- [API状态页面](https://status.fal.ai)
- [定价信息](https://fal.ai/pricing)
- [社区支持](https://discord.gg/fal-ai)

---

*最后更新: 2025年1月*
*版本: v1.0* 