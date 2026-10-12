#!/usr/bin/env node
/**
 * 死文件扫描：找出 src/ 下从未被任何文件 import 的模块。
 *
 * 为什么需要：审计时发现 `src/lib/services/user.ts`（169 行）和
 * `src/lib/types/user.ts`（20 行）全部导出零引用，却一直躺在仓库里。
 * 人工 grep 容易漏（尤其相对导入），用脚本更可靠。
 *
 * 判定规则：
 *   1. 收集 src/ 下所有 .ts/.tsx 文件
 *   2. 收集所有 import/export-from 语句的模块说明符
 *   3. 把说明符解析成绝对路径，与文件列表比对
 *   4. 没有任何文件指向它的 = 候选死文件
 *
 * 白名单（框架约定入口，无需被 import）：
 *   · Next.js 特殊文件：page / layout / route / loading / error / not-found /
 *     template / default / middleware / proxy / instrumentation
 *   · 配置文件、类型声明
 *
 * 运行：node scripts/audit-dead-files.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.resolve(ROOT, 'src')

/** Next.js 约定的入口文件名（不靠 import 触发）。 */
const FRAMEWORK_ENTRY = new Set([
  'page',
  'layout',
  'route',
  'loading',
  'error',
  'global-error',
  'not-found',
  'template',
  'default',
  'middleware',
  'proxy',
  'instrumentation',
  'sitemap',
  'robots',
  'manifest',
  'opengraph-image',
  'icon',
  'apple-icon',
])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(SRC)

/** 收集所有模块说明符 → 指向的文件 */
const referenced = new Set()

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g

for (const file of files) {
  const source = readFileSync(file, 'utf8')

  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source))) {
      const spec = m[1]
      let resolved = null

      if (spec.startsWith('@/')) {
        resolved = path.resolve(SRC, spec.slice(2))
      } else if (spec.startsWith('.')) {
        resolved = path.resolve(path.dirname(file), spec)
      }

      if (!resolved) continue

      // 尝试补全扩展名 / index
      const candidates = [
        resolved,
        `${resolved}.ts`,
        `${resolved}.tsx`,
        path.join(resolved, 'index.ts'),
        path.join(resolved, 'index.tsx'),
      ]

      for (const c of candidates) {
        referenced.add(path.normalize(c))
      }
    }
  }
}

/**
 * 已知的「无引用但保留」文件。
 *
 * 加入白名单前必须想清楚为什么保留。这里只允许两类，因为它们**与装了哪个产品无关**：
 *
 *   1. **模板可选能力**（`TEMPLATE_CAPABILITY`）—— shadcn UI 原语、四家厂商引擎。
 *      它们是母版随附的可插拔层：产品接哪几家、用哪些原语，是产品的选择，
 *      不是「没人引用就可以删」的死代码。按形状排除，换产品不必改这个脚本。
 *   2. **母版本身的替代方案**（下面逐个点名 + 理由）。
 *
 * 产品自己的 UI **不写在这里**：那属于产品，声明在
 * `src/lib/products/<id>/layout-debt.json`（`verify-product-boundary.mjs` 的同一份清单）。
 * 原先这里硬写着 `src/components/UpgradePrompt.tsx` —— 那是 Flux 的产品 UI，
 * 换第二个产品时它就变成一条指向不存在文件的僵尸登记。
 */
const KNOWN_UNUSED_BUT_KEPT = new Set([
  // 可选的多语言切换器：模板提供，页面可以不用。
  'src/components/LanguageSwitcher.tsx',
  // 替代认证方案（Supabase）：与默认认证并存，供接入者二选一。
  'src/lib/auth-supabase.ts',
  // 输入图预览组件（blob / http / data 三种 URL 形态都处理好了）：
  // 由产品的生成器 UI 决定是否使用，没有 UI 的产品不引用它。
  'src/components/SmartImagePreview.tsx',
  // Turnstile 人机校验组件：与 NEXT_PUBLIC_ENABLE_TURNSTILE 配套的能力，
  // 产品路由不启用校验时就没有引用方。
  'src/components/StandardTurnstile.tsx',
  // 内容安全（prompt / 生成结果双向扫描）：Core 能力，由**产品路由**决定调用；
  // 走通用 /api/ai/image 的产品不会引用它。
  'src/lib/content-safety/safe-mode.ts',
])

const TEMPLATE_CAPABILITY = [
  /^src\/components\/ui\//, // shadcn/ui 原语库
  /^src\/lib\/ai\/providers\//, // 厂商引擎实现，由产品数据决定接哪几家
]

/** 各产品在 layout-debt.json 里登记的「住在共享目录但属于产品」的文件。 */
const PRODUCT_DECLARED_KEPT = new Set()

const PRODUCTS_DIR = path.join(SRC, 'lib', 'products')

if (statSync(PRODUCTS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
  for (const productId of readdirSync(PRODUCTS_DIR)) {
    const manifest = path.join(PRODUCTS_DIR, productId, 'layout-debt.json')
    if (!statSync(manifest, { throwIfNoEntry: false })?.isFile()) continue

    try {
      for (const rel of JSON.parse(readFileSync(manifest, 'utf8'))) {
        if (typeof rel === 'string') PRODUCT_DECLARED_KEPT.add(rel)
      }
    } catch {
      // 清单不合法由 verify-product-boundary.mjs 负责报错，这里不重复裁决。
    }
  }
}

/** 环境声明文件（`declare module`）不靠 import 生效，必须排除。 */
const AMBIENT_DECLARATION = /\.d\.ts$/

/**
 * 产品的**守卫数据文件**：`vocabulary.ts` 由 `scripts/product-discovery.ts` 以文本扫描
 * 读取（守卫要在同步断言里取词汇，所以刻意不走 import）。它因此永远不会出现在引用图里，
 * 但它不是死文件 —— 删掉它等于把「Core 不持有产品数据」的扫描降级成只看 bundle 派生词。
 *
 * 按**形状**排除而不是逐个登记：任何产品目录里的同名文件都被同一套守卫消费，
 * 新增产品不必改这个脚本。
 */
const GUARD_DATA_FILE = /^src\/lib\/products\/[^/]+\/vocabulary\.ts$/

const dead = files.filter((f) => {
  const base = path.basename(f).replace(/\.(ts|tsx)$/, '')
  if (FRAMEWORK_ENTRY.has(base)) return false
  if (AMBIENT_DECLARATION.test(f)) return false
  const relative = path.relative(ROOT, f).replace(/\\/g, '/')
  if (GUARD_DATA_FILE.test(relative)) return false
  if (TEMPLATE_CAPABILITY.some((re) => re.test(relative))) return false
  if (PRODUCT_DECLARED_KEPT.has(relative)) return false
  // 被 reference 过
  return !referenced.has(path.normalize(f))
})

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/')

const isKept = (f) => {
  const relative = rel(f)
  return (
    KNOWN_UNUSED_BUT_KEPT.has(relative) ||
    PRODUCT_DECLARED_KEPT.has(relative) ||
    TEMPLATE_CAPABILITY.some((re) => re.test(relative))
  )
}

const expected = dead.filter(isKept)
const unexpected = dead.filter((f) => !isKept(f))

console.log(`扫描 ${files.length} 个文件\n`)

console.log(`▸ 已知保留（白名单，${expected.length} 个）`)
for (const f of expected) {
  const lines = readFileSync(f, 'utf8').split('\n').length
  console.log(`  · ${rel(f)}  (${lines} 行)`)
}

if (unexpected.length === 0) {
  console.log('\n✅ 无新增死文件')
  process.exit(0)
}

console.log(`\n❌ 发现 ${unexpected.length} 个新增无引用文件：\n`)
for (const f of unexpected) {
  const lines = readFileSync(f, 'utf8').split('\n').length
  console.log(`  ⚠️  ${rel(f)}  (${lines} 行)`)
}
console.log(
  '\n请删除，或确认要保留后加入 KNOWN_UNUSED_BUT_KEPT 白名单并说明理由。'
)
process.exit(1)
