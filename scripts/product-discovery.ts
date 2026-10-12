/**
 * 验证脚本的产品发现助手（Phase 9.8.2-D）
 *
 * 为什么需要它：`scripts/**` 里的**通用机制**测试原先直接
 * `import { FLUX_MODELS } from '@/lib/products/flux-kontext/…'`。那意味着
 * 「换掉产品目录」之后门禁根本跑不起来（模块找不到），新产品无法用它验证
 * 自己接进了 AI / Billing / Credit 机制 —— 而这条链正是母版要复用的东西。
 *
 * 分工因此按**测试对象**划，而不是按文件名划：
 *   · 通用机制测试 → 只读本文件提供的「已绑定 / 已发现的 bundle」，零产品字面量
 *   · 产品专属测试 → 脚本头部写 `// @product-scope <productId>`，
 *     由 `scripts/verify-all.mjs` 在产品目录缺失时判为 **SKIP（不是 PASS）**
 *
 * 依赖方向：本文件在 `scripts/` 下，不在 `tsconfig` 的 include 里，也不属于 Core；
 * 它按路径 import 产品目录是被允许的（守卫只看 `src/**`）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import type { ProductConfig } from '@/config/product'

const ROOT = process.cwd()
const PRODUCTS_DIR = path.join(ROOT, 'src', 'lib', 'products')

/** 已发现的产品目录名（只认带 config.ts 的目录）。 */
export function discoveredProductIds(): string[] {
  if (!existsSync(PRODUCTS_DIR)) return []

  return readdirSync(PRODUCTS_DIR)
    .filter((name) => {
      try {
        return statSync(path.join(PRODUCTS_DIR, name)).isDirectory()
      } catch {
        return false
      }
    })
    .filter((name) => existsSync(path.join(PRODUCTS_DIR, name, 'config.ts')))
    .sort()
}

/** 某个产品的目录是否还在（用于区分「产品未安装」与「产品装坏了」）。 */
export function productDirExists(productId: string): boolean {
  return existsSync(path.join(PRODUCTS_DIR, productId, 'config.ts'))
}

/**
 * 读取某个产品自己声明的配置包。
 *
 * 按**形状**而不是导出名查找，所以第二个产品不必沿用 `FLUX_KONTEXT_PRODUCT`
 * 这样的名字。
 */
export async function loadProductBundle(productId: string): Promise<ProductConfig | null> {
  const mod = (await import(`@/lib/products/${productId}/config`)) as Record<string, unknown>

  return (
    Object.values(mod).find(
      (value) =>
        !!value &&
        typeof value === 'object' &&
        'productId' in value &&
        'models' in value &&
        'billingPackages' in value &&
        'freePlan' in value
    ) ?? null
  )
}

/**
 * 一个产品的**识别词汇**：Core 里一个都不许出现的那些字符串。
 *
 * 两个来源：
 *   1. bundle 里的标识符 —— 模型 id / 套餐 id / 渠道商品 id。自动派生，产品不用做任何事。
 *   2. `src/lib/products/<id>/vocabulary.ts` 里导出的字符串数组 —— 用于补上
 *      不在 bundle 里的产品字面量（厂商 endpoint 前缀、action 名、厂商侧枚举值）。
 *
 * 为什么不允许守卫自己写死词汇表：那份表是**上一个产品**的数据，
 * 换产品后它会假装在检查新产品的解耦，实际什么都不知道。
 *
 * 每个产品目录都应有一份（Flux 有；缺词汇的产品不会让门禁失败，但模型 id 与
 * 套餐 id 仍然会被扫描）。
 */
export function vocabularyOf(productId: string, bundle: ProductConfig | null): string[] {
  const terms = new Set<string>()

  if (bundle) {
    for (const modelId of Object.keys(bundle.models)) terms.add(modelId)

    for (const pkg of Object.values(bundle.billingPackages)) {
      terms.add(pkg.id)
      for (const channelProductId of Object.values(pkg.providerProductIds ?? {})) {
        if (channelProductId) terms.add(channelProductId)
      }
    }
  }

  const declared = path.join(
    ROOT,
    'src',
    'lib',
    'products',
    productId,
    'vocabulary.ts'
  )

  if (!existsSync(declared)) return [...terms]

  const mod = readStringArrayExports(declared) as Record<string, unknown>

  for (const value of Object.values(mod)) {
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'string') terms.add(item)
    }
  }

  return [...terms]
}

/**
 * 读取词汇文件里的字符串数组导出。
 *
 * 为什么用正则而不是 `import()`：调用方（守卫）大多是同步断言，而词汇文件按约定
 * **只能**是 `export const X = ['a', 'b'] as const` 这一种形态 —— 产品如果往里
 * 塞 import 或函数，这里就取不到值，词汇变少会被
 * `verify-product-config.ts` 的「词汇表不是空集合」反证当场暴露。
 */
function readStringArrayExports(absolute: string): Record<string, unknown> {
  const source = readFileSync(absolute, 'utf8')
  const out: Record<string, unknown> = {}

  const arrayRe = /export\s+const\s+(\w+)\s*(?::\s*(?:readonly\s+string\[\]|as const))?\s*=\s*\[([^\]]*)\]/g

  for (const match of source.matchAll(arrayRe)) {
    const items: string[] = []
    const itemRe = /['"]([^'"]+)['"]/g

    for (const item of match[2].matchAll(itemRe)) items.push(item[1])
    out[match[1]] = items
  }

  return out
}

/**
 * 词汇的**区分度**分档（守卫判定用）。
 *
 * 带分隔符 / 数字 / 大写的词（`flux-kontext-pro`、`text-to-image-max`、`fal-ai/`、
 * `Creator Pack`）不可能是普通英文，子串匹配即可。
 *
 * 纯小写单词（套餐 id `creator` / `starter` / `business`）会撞上无关的英文：
 * SEO 生成器里的 `twitter:creator` 元标签不是产品数据。所以对这一档只认
 * **字符串字面量**形态（`'creator'` / `"creator"`）—— 那才是「Core 里写死了
 * 产品 id」的样子（`getBillingPackage('creator')`、`case 'starter':`）。
 */
export function isDistinctiveTerm(term: string): boolean {
  return /[A-Z0-9_\-/.\s]/.test(term)
}

/** 这段**已去注释**的代码是否提到了该产品的词汇。 */
export function codeMentions(code: string, term: string): boolean {
  if (isDistinctiveTerm(term)) return code.includes(term)

  return new RegExp(`['"\`]${term}['"\`]`).test(code)
}

/**
 * 声明式词汇自检：每个词必须真的出现在该目录的源码里。
 *
 * 没有这条，产品可以只写两个永远不会出现在 Core 的词来「填满」扫描，
 * 让词汇守卫变成空跑。
 */
export function unusedVocabularyTerms(productId: string, terms: string[]): string[] {
  const dir = path.join(ROOT, 'src', 'lib', 'products', productId)
  if (!existsSync(dir)) return []

  const haystack: string[] = []

  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)

      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }

      // 词汇文件本身不算「使用处」，否则声明即自证。
      if (entry === 'vocabulary.ts' || !/\.(ts|tsx|json)$/.test(entry)) continue
      haystack.push(readFileSync(full, 'utf8'))
    }
  }

  walk(dir)

  const joined = haystack.join('\n')

  return terms.filter((term) => term !== 'vocabulary' && !joined.includes(term))
}
