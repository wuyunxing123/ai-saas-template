# 🎬 fal.ai 集成参考代码

> 从 temp-video-starter-kit 项目中提取的重要代码，用于未来集成 fal.ai 视频生成服务

## 📋 **项目概述**

temp-video-starter-kit 是一个基于 fal.ai 的视频生成项目，包含以下核心功能：
- 多种AI模型集成 (Veo2, Minimax, Kling等)
- 视频编辑和合成
- Remotion 视频渲染
- IndexedDB 本地存储

## 🔧 **核心配置文件**

### fal.ai 客户端配置
```typescript
// src/lib/fal.ts
"use client";

import { createFalClient } from "@fal-ai/client";

export const fal = createFalClient({
  credentials: () => {
    if (typeof localStorage === "object") {
      return localStorage.getItem("falKey") as string;
    }
    return undefined;
  },
  proxyUrl: "/api/fal",
});

export type ApiInfo = {
  endpointId: string;
  label: string;
  description: string;
  cost: string;
  inferenceTime?: string;
  inputMap?: Record<string, string>;
  inputAsset?: InputAsset[];
  initialInput?: Record<string, unknown>;
  cameraControl?: boolean;
  imageForFrame?: boolean;
  category: "image" | "video" | "music" | "voiceover";
  prompt?: boolean;
  from?: string;
};

export const AVAILABLE_ENDPOINTS: ApiInfo[] = [
  {
    endpointId: "fal-ai/veo2",
    label: "Veo 2",
    description: "Veo creates videos with realistic motion and high quality output, up to 4K.",
    cost: "",
    category: "video",
    from: "Google",
  },
  {
    endpointId: "fal-ai/veo2/image-to-video",
    label: "Veo 2 (Image to Video)",
    description: "Veo 2 creates videos from images with realistic motion and very high quality output.",
    cost: "",
    category: "video",
    inputAsset: ["image"],
    from: "Google",
  },
  {
    endpointId: "fal-ai/minimax/video-01-live",
    label: "Minimax Video 01 Live",
    description: "High quality video, realistic motion and physics",
    cost: "",
    category: "video",
    inputAsset: ["image"],
  },
  // ... 更多端点配置
];
```

### 视频生成核心逻辑
```typescript
// 视频生成函数
const generateVideo = async (input: any) => {
  const { data } = await fal.subscribe(endpointId, {
    input: {
      prompt: input.prompt,
      image_url: input.image_url,
      aspect_ratio: input.aspect_ratio,
      seconds_total: input.duration,
    },
    mode: "polling",
    pollInterval: 3000,
  });
  
  return data;
};
```

### 媒体元数据获取
```typescript
// src/lib/ffmpeg.ts
export async function getMediaMetadata(media: MediaItem) {
  try {
    const { data: mediaMetadata } = await fal.subscribe(
      "fal-ai/ffmpeg-api/metadata",
      {
        input: {
          media_url: resolveMediaUrl(media),
          extract_frames: true,
        },
        mode: "streaming",
      },
    );

    return mediaMetadata;
  } catch (error) {
    console.error(error);
    return {};
  }
}
```

### 视频合成和导出
```typescript
// 视频导出功能
const exportVideo = async (tracks: any[]) => {
  const videoData = tracks.map((track) => ({
    id: track.id,
    type: track.type === "video" ? "video" : "audio",
    keyframes: frames[track.id].map((frame) => ({
      timestamp: frame.timestamp,
      duration: frame.duration,
      url: resolveMediaUrl(mediaItems[frame.data.mediaId]),
    })),
  }));

  const { data } = await fal.subscribe("fal-ai/ffmpeg-api/compose", {
    input: {
      tracks: videoData,
    },
    mode: "polling",
    pollInterval: 3000,
  });
  
  return data;
};
```

## 🎨 **Remotion 视频组合**

### 视频组合组件
```typescript
// src/components/video-preview.tsx
const VideoComposition: React.FC<VideoCompositionProps> = ({
  project,
  tracks,
  frames,
  mediaItems,
}) => {
  const sortedTracks = [...tracks].sort((a, b) => {
    return TRACK_TYPE_ORDER[a.type] - TRACK_TYPE_ORDER[b.type];
  });

  let width = VIDEO_WIDTH;
  let height = VIDEO_HEIGHT;

  if (project.aspectRatio) {
    const size = videoSizeMap[project.aspectRatio];
    if (size) {
      width = size.width;
      height = size.height;
    }
  }

  return (
    <Composition
      id={project.id}
      component={MainComposition as any}
      durationInFrames={DEFAULT_DURATION * FPS}
      fps={FPS}
      width={width}
      height={height}
      defaultProps={{
        project,
        tracks: sortedTracks,
        frames,
        mediaItems,
      }}
    />
  );
};
```

## 📊 **数据结构定义**

### 媒体项目类型
```typescript
interface MediaItem {
  id: string;
  kind: "generated" | "uploaded";
  input: Record<string, any>;
  mediaType: "image" | "video" | "audio" | "music";
  status: "pending" | "completed" | "failed";
  createdAt: number;
  endpointId: string;
  projectId: string;
  requestId: string;
  output?: {
    video?: {
      url: string;
      content_type: string;
      file_name: string;
      file_size: number;
    };
    images?: Array<{
      url: string;
      width: number;
      height: number;
      content_type: string;
    }>;
    audio_file?: {
      url: string;
      content_type: string;
      file_name: string;
      file_size: number;
    };
  };
  metadata?: {
    media_type: string;
    url: string;
    content_type: string;
    file_name: string;
    file_size: number;
    duration?: number;
    bitrate?: number;
    codec?: string;
    container?: string;
    fps?: number;
    frame_count?: number;
    resolution?: {
      aspect_ratio: string;
      width: number;
      height: number;
    };
  };
}
```

### 项目配置类型
```typescript
interface VideoProject {
  id: string;
  title: string;
  description: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  createdAt: number;
  updatedAt: number;
}
```

## 🔄 **状态管理**

### Zustand Store 配置
```typescript
interface VideoProjectStore {
  // 生成对话框状态
  generateDialogOpen: boolean;
  openGenerateDialog: () => void;
  closeGenerateDialog: () => void;
  
  // 媒体选择
  selectedMediaId: string | null;
  setSelectedMediaId: (id: string | null) => void;
  
  // 生成数据
  generateData: GenerateData;
  setGenerateData: (data: Partial<GenerateData>) => void;
  
  // 端点配置
  endpointId: string;
  setEndpointId: (id: string) => void;
  
  // 媒体类型
  generateMediaType: "image" | "video" | "music" | "voiceover";
  setGenerateMediaType: (type: "image" | "video" | "music" | "voiceover") => void;
}
```

## 🎯 **集成建议**

### 1. 渐进式集成
```typescript
// 第一步：集成基础的fal.ai客户端
// 第二步：添加视频生成端点
// 第三步：集成Remotion视频合成
// 第四步：添加高级编辑功能
```

### 2. 环境变量配置
```bash
# fal.ai 配置
FAL_KEY=your_fal_api_key

# 代理配置 (可选)
FAL_PROXY_URL=/api/fal
```

### 3. 依赖包安装
```json
{
  "dependencies": {
    "@fal-ai/client": "^0.7.3",
    "@remotion/cli": "^4.0.0",
    "@remotion/player": "^4.0.0",
    "zustand": "^4.4.0"
  }
}
```

## 📝 **实施步骤**

1. **安装依赖**: 添加 fal.ai 客户端和相关依赖
2. **配置客户端**: 设置 API 密钥和代理
3. **集成端点**: 添加视频生成端点配置
4. **实现生成**: 创建视频生成函数
5. **添加UI**: 集成生成界面和进度显示
6. **测试验证**: 确保功能正常工作

## ⚠️ **注意事项**

1. **API费用**: fal.ai 按使用量计费，需要监控成本
2. **处理时间**: 视频生成需要较长时间，需要良好的用户体验
3. **错误处理**: 需要完善的错误处理和重试机制
4. **存储管理**: 生成的视频文件需要合理的存储策略

## 🔗 **相关资源**

- [fal.ai 官方文档](https://fal.ai/docs)
- [Remotion 文档](https://remotion.dev/docs)
- [原始项目仓库](https://github.com/fal-ai-community/video-starter-kit)

---

**📝 文档版本**: v1.0  
**📅 创建时间**: 2025-01-20  
**🎯 用途**: fal.ai 集成参考和未来开发指南 