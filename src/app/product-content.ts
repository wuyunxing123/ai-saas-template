/**
 * 产品内容装配点（Phase 9.8.2）
 *
 * 这是 `src/` 里**唯一**把产品文案接到共享组件上的文件（产品自己的 API 路由除外）。
 *
 *   · 共享组件（`src/components/*`）只接受 `@/lib/content/contracts` 声明的形状，不再 import 产品；
 *   · 页面（`src/app/**`）从本文件取当前产品的内容并注入；
 *   · 换成第二个产品 = 只改下面这一行 import。
 *
 * 类型标注即契约校验：产品 JSON 的形状与本文件的 `ProductContent` 不符时 `tsc --noEmit` 直接失败。
 *
 * 依赖方向：app 层（装配）→ Product（数据）→ Core（形状 + 机制）。Core 不得反向 import 本文件。
 */

import type { ProductContent } from '@/lib/content/contracts'

import { home, pricing, seo } from '@/lib/products/flux-kontext/content'

export const productContent: ProductContent = {
  home,
  pricing,
  seo,
}
