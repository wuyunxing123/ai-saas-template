/**
 * Flux Kontext 的产品配置（Phase 9.8.2-C）
 *
 * 一个产品的完整形状 = 模型目录 + Provider 实例 + 套餐 + 免费档。
 * 四块数据各自在自己的文件里（便于客户端只 import 需要的部分），
 * 这里只做拼装，不放任何数值。
 *
 * 拼装结果交给 `src/app/product-runtime.ts` 绑定；
 * 绑定前 `validateProductConfig()` 会检查模型 ⇄ Provider 映射、积分、套餐完整性，
 * 任何一项缺失都会在**装配时**失败，而不是在某个用户请求里失败。
 *
 * 依赖方向：Product → Core（形状 + 机制）。Core 不 import 本文件。
 */

import type { ProductConfig } from '@/config/product'

import { FLUX_MODELS } from '@/lib/products/flux-kontext/catalogue'
import { FLUX_PROVIDERS } from '@/lib/products/flux-kontext/providers'
import { FLUX_BILLING_PACKAGES, FLUX_FREE_PLAN } from '@/lib/products/flux-kontext/billing'

export const FLUX_KONTEXT_PRODUCT: ProductConfig = {
  productId: 'flux-kontext',
  models: FLUX_MODELS,
  providers: FLUX_PROVIDERS,
  billingPackages: FLUX_BILLING_PACKAGES,
  freePlan: FLUX_FREE_PLAN,
}
