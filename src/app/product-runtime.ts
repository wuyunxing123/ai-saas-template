/**
 * 产品运行时装配点（Phase 9.8.2-C）
 *
 * 这是 `src/` 里**唯一**把产品数据接到 Core 机制上的文件（与 9.8.2-A 的
 * `src/app/product-content.ts` 并列，一个接内容、一个接配置）。
 *
 *   Core 机制（`@/lib/ai/*`、`@/config/billing`）── 读 ──▶ 已绑定的 ProductConfig
 *                                                              ▲
 *   本文件 ── bindProductConfig(FLUX_KONTEXT_PRODUCT) ──────────┘
 *
 * 为什么必须在**每个服务端入口**静态 import 本文件：
 *   Next.js 按路由分包，「某个模块被 import 时顺手注册」这种副作用无法被证明
 *   在所有路由里都发生。所以约定是：路由 / 页面显式 import 装配点，
 *   没 import 到的路由一旦触碰查询就会**抛错**（`getProductConfig()` 未绑定即失败），
 *   而不是拿着默认模型 / 默认价格继续跑。
 *   `scripts/verify-product-seam.mjs` 会沿 import 图逐个核对所有服务/测试入口。
 *
 * 换成第二个产品 = 只改下面这一行 import。
 *
 * 依赖方向：app 层（装配）→ Product（数据）→ Core（形状 + 机制）。
 * Core 不得反向 import 本文件。
 */

import { bindProductConfig } from '@/config/product'

import { FLUX_KONTEXT_PRODUCT } from '@/lib/products/flux-kontext/config'

bindProductConfig(FLUX_KONTEXT_PRODUCT)

/** 当前装配的产品 id（供诊断与入口自检使用）。 */
export const productRuntimeId = FLUX_KONTEXT_PRODUCT.productId
