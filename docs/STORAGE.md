# STORAGE.md — Storage 基础设施

> Phase 5 产物。业务层唯一入口：`StorageService`。

---

## 1. 架构

```
Business / API / Workflow
        ↓
   StorageService  ← 业务层唯一入口
        ↓
   StorageProvider  ← 接口
        ↓
    R2Provider     ← 当前唯一实现
        ↓
   Cloudflare R2
```

**边界规则**：
- 业务代码禁止直接 import `@aws-sdk/client-s3`、S3Client、R2 SDK
- AI Provider（fal/kie/wavespeed/atlascloud）禁止知道 Storage 的存在
- StorageProvider 禁止知道 AI Provider 的存在

---

## 2. Object Key 规范

格式：

```
{namespace}/{userId}/{resourceId?}/{filename}
```

| Segment | 取值 | 说明 |
|---|---|---|
| `namespace` | `uploads` / `generated` / `temporary` | 决定用途 |
| `userId` | 用户 UUID 或 sanitize 后的 email | 必须来自 authenticated session |
| `resourceId` | 可选，如 taskId / requestId | 用于同一业务下的分组 |
| `filename` | `{timestamp}-{random}.{ext}` | 由 StorageService 自动生成，**不使用原始文件名** |

示例：

```
uploads/user-123/1700000000000-a1b2c3d4.png
generated/user-456/task-789/ai-1700000000000-a1b2c3d4.jpg
temporary/user-123/request-xyz/1700000000000-a1b2c3d4.webp
```

**安全约束**：
- 所有 segment 经过 `sanitizeSegment`（仅保留 `a-z0-9-`）
- `sanitizeFilename` 去除 `..`、`/`、`\`，仅保留 `a-zA-Z0-9._-`
- `validateKey` 在 `getUrl` / `delete` 入口拒绝以 `/` 开头或包含 `..` 的 key

---

## 3. StorageService

```ts
import { StorageService } from '@/lib/storage/service'

// 上传 File 对象
const result = await StorageService.uploadFile(file, {
  userId: user.id,
  namespace: 'uploads',
  metadata: { purpose: 'avatar' },
})
// result: { key, url, contentType, provider, metadata }

// 从 URL 下载后上传（AI 生成结果转存）
const result = await StorageService.uploadFromUrl(aiImageUrl, {
  userId: user.id,
  namespace: 'generated',
  metadata: { prompt: prompt.substring(0, 500) },
})

// 取公开 URL
const url = StorageService.getUrl(key)

// 删除
await StorageService.delete(key)

// 检查是否已配置
if (StorageService.isConfigured()) { ... }
```

**`UploadInput` 字段**：
- `data: Blob | ArrayBuffer | Buffer` — 文件数据
- `contentType: string` — Content-Type
- `originalName?: string` — 原始展示名（仅 metadata，不参与 key）
- `userId: string` — 用户标识（来自 session，不是 request body）
- `namespace: 'uploads' | 'generated' | 'temporary'`
- `resourceId?: string` — 可选分组 ID
- `metadata?: Record<string, string>` — 对象级 metadata

---

## 4. StorageProvider 接口

```ts
export interface StorageProvider {
  readonly name: string
  isConfigured(): boolean
  upload(key: string, data: Blob | ArrayBuffer | Buffer, contentType: string, metadata?: Record<string, string>): Promise<StorageObject>
  getUrl(key: string): string
  delete(key: string): Promise<void>
}
```

新增 Provider = 实现接口 + 在 `src/lib/storage/providers/index.ts` 注册表加一行。

---

## 5. R2Provider

唯一读取 R2 环境变量的文件：

| 变量 | 必需 | 说明 |
|---|---|---|
| `R2_ACCOUNT_ID` | ✅ | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | ✅ | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 Secret Key |
| `R2_BUCKET_NAME` | ✅ | Bucket 名称 |
| `R2_PUBLIC_URL` | ❌ | 自定义公网地址；未设置时使用 `https://{bucket}.{accountId}.r2.cloudflarestorage.com` |

**注意**：`NEXT_PUBLIC_ENABLE_R2` 已被废弃。业务代码通过 `StorageService.isConfigured()` 判断，该值由 Provider 内部根据 env 变量是否存在决定。

---

## 6. URL 策略

当前 bucket 为 public，直接返回 public URL。

```ts
StorageService.getUrl('uploads/user-123/xxx.png')
// → https://cdn.example.com/uploads/user-123/xxx.png
```

未来如需切换为 private bucket + signed URL：
- 仅在 `R2Provider.getUrl()` 内部修改实现
- 业务代码零改动

---

## 7. 错误处理

统一异常：`StorageError`

| code | 场景 |
|---|---|
| `UPLOAD_FAILED` | 上传失败 |
| `DELETE_FAILED` | 删除失败 |
| `NOT_FOUND` | 对象不存在 |
| `INVALID_KEY` | key 格式非法 |
| `PATH_TRAVERSAL` | key 包含 `..` 等穿越序列 |
| `PROVIDER_ERROR` | Provider 未注册或内部错误 |
| `NOT_CONFIGURED` | Provider 缺少环境变量 |
| `DOWNLOAD_FAILED` | `uploadFromUrl` 时源地址下载失败 |

Provider SDK 原始异常被包装为 `StorageError`，不会直接泄漏到 API 响应。

---

## 8. 临时文件

临时文件使用 `namespace: 'temporary'`：

```ts
await StorageService.upload({
  data,
  contentType: 'image/png',
  userId: user.id,
  namespace: 'temporary',
  resourceId: requestId,
})
```

本阶段不实现自动垃圾回收。如需清理，手动调用 `StorageService.delete(key)`。

---

## 9. 与 AI Core 的关系

**明确分离**：

```
用户上传图片
  → StorageService.uploadFile() → R2
  → 得到 URL
  → AIService.generate({ inputImages: [url] })
  → AI Provider 处理
  → 得到 AI 结果 URL
  → StorageService.uploadFromUrl() → R2
```

- `AIProvider.uploadFile()` 是把文件提交给 AI Provider 的存储（如 fal storage），不是我们自己的 R2
- `StorageService` 是保存我们自己的文件
- 两者互不相识

---

## 10. 与产品层的关系（2026-09-29 复核）

产品层通过 `StorageService` 使用存储，**不碰 R2 SDK**。当前 Flux 产品
（`src/lib/products/flux-kontext/service.ts`）的相关方法：

- `FluxKontextService.uploadFile(file, userId?)` —— 上传用户输入图
  （在 `AIService.uploadFile()` 与 `StorageService` 之间做回退）
- 生成结果的转存**不在产品层**：由 Core 的 `WorkflowService` 在
  `src/lib/workflow/storage.ts` 的 `persistResult()` 里调
  `StorageService.saveGeneratedAsset()` 完成

仍保留的产品语义：响应字段名 `r2_url`（仅在成功转存时存在，
见 `service.ts:231,244`）。

### 已删除的兼容层（不要再找）

| 已删除 | 说明 |
|---|---|
| ~~`FluxKontextService.saveGeneratedImageToR2(imageUrl, prompt, userId?)`~~ | 方法已不存在；转存职责已上移到 Core 的 `persistResult()` |
| ~~`r2Storage`（`src/lib/services/r2-storage.ts`）~~ | Phase 5 的兼容适配器，105 行，**已无调用方，在死代码清理中删除**。全仓库已无 `r2Storage` 导出 |
| ~~`src/lib/storage/providers/s3.ts`~~ | 从未存在。当前 `providers/` 下只有 `index.ts` 与 `r2.ts` |

前端 `src/components/SmartImagePreview.tsx` 的 fallback URL 逻辑仍在（属 UI 层）。

---

## 11. Provider 替换策略

新增 Provider（如 S3 / OSS / COS / Local）的步骤：

1. 新建 `src/lib/storage/providers/s3.ts`，实现 `StorageProvider`
2. 在 `src/lib/storage/providers/index.ts` 注册表加一行：`s3: new S3StorageProvider()`
3. （可选）修改 `StorageService` 的默认 Provider 名称
4. 业务代码零改动

---

## 12. 测试

```bash
# Storage 基础设施验证（无需 R2 凭证）
node scripts/run-ts.mjs scripts/verify-storage.ts
```

覆盖：key 生成、路径穿越防护、filename 生成、Provider 注册表、R2Provider 配置状态、URL 策略、业务代码零直接 S3 引用。
