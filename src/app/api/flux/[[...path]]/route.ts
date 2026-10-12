/**
 * Flux 对外兼容入口（Phase 9.8.2-B）
 *
 * 承接 `proxy.ts` 版本前缀剥离后的 legacy 公共路径：
 *   /api/v1/flux/{text-to-image,image-edit}/{pro,max}
 *     → /api/flux/{...}                            （本文件）
 *     → /api/flux-kontext 的 handler                （直接复用，不复制逻辑）
 *
 * 语义约定（R1）：**不从路径推导 `action`**。action 仍只来自请求体，
 * 与 `/api/flux-kontext` 完全一致 —— 缺 action 时同样是 400。
 *
 * 之所以用再导出（而不是包一层）：`export { POST }` 让两个路径命中**同一个函数**，
 * 响应契约因此不可能漂移；`scripts/verify-api-routing.ts` 的 B2 断言这一点。
 */

export { POST, PUT, maxDuration } from '@/app/api/flux-kontext/route'
