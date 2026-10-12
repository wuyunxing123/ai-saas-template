#!/usr/bin/env node
/**
 * Product Boundary 验证（Phase 9.3，Phase 9.8.2-C 重写扫描范围）
 *
 * 目标：证明依赖方向是 `Product → Core`，反向为 0。
 *
 *   Product → Core   ✅ 允许
 *   Core → Product   ❌ 必须为 0
 *
 * 扫描范围改成**按排除法**（9.8.1 审计发现的盲区：原先只扫一张手写的
 * `CORE_DIRS` 清单，`src/lib/*.ts` 根文件与 `src/components/**` 根本不在清单里，
 * 「0 违规」只是因为没看它们）。现在：
 *
 *   Core = src/ 下除 `src/lib/products/**`（产品层）与 `src/app/**`（app 装配层）
 *          之外的**每一个** .ts/.tsx 文件。
 *
 * 例外要**点名**，不能靠扩大白名单：产品 UI 住在共享组件目录时（路径**或文案**
 * 点名了产品，如 `src/components/FluxKontextGenerator.tsx`、写着「Flux Kontext Max
 * 模型」的 `UpgradePrompt.tsx`），守卫把它归为「产品代码」，并要求它登记在
 * **该产品自己的** `src/lib/products/<id>/layout-debt.json` 里 —— 那份清单只能缩小，
 * 新增要写理由，失效必须删掉，否则守卫失败。
 * 一个**不提任何产品名**的通用模块 import 产品目录，才是真正的反向依赖，直接违规。
 *
 * ⚠️ 本守卫证明的是**静态 import 方向**。它不证明「删掉产品目录后母版还能跑」——
 *    那是 `scripts/verify-product-seam.mjs`（接缝可达性）+ 独立 worktree 删除实验的职责。
 *
 * 运行：node scripts/verify-product-boundary.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'src')
const PRODUCTS_PREFIX = 'src/lib/products/'

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[\s\S]{0,800}?\bfrom\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function specifiersOf(file) {
  const source = stripComments(readFileSync(file, 'utf8'))
  const out = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_RE]) {
    for (const m of source.matchAll(re)) out.push(m[1])
  }
  return out
}

/**
 * 去掉 import/export 语句后的正文。
 *
 * 判「这个文件是不是在讲某个产品」只看正文：说明符本身一定写着
 * `@/lib/products/<id>/…`，把它算进内容等于让每条反向依赖都自动获得豁免。
 */
function proseOf(file) {
  let source = stripComments(readFileSync(file, 'utf8'))
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_RE]) source = source.replace(re, '')
  return source
}

const allFiles = walk(SRC).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))

/** 产品目录名（用于识别「产品命名的文件」）。 */
const productDirs = existsSync(path.join(SRC, 'lib', 'products'))
  ? readdirSync(path.join(SRC, 'lib', 'products')).filter((name) =>
      statSync(path.join(SRC, 'lib', 'products', name)).isDirectory()
    )
  : []

/** 先转小写再剔除分隔符：写成 `replace(...).toLowerCase()` 会先把大写文件名吃掉。 */
const normalise = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const productTokens = productDirs.map(normalise)

/**
 * 「这是产品代码，只是不住在产品目录里」的判据：路径**或文件内容**点名了某个产品。
 *
 * 为什么内容也算：`UpgradePrompt.tsx` 的路径是中性的，但它的文案是
 * 「Flux Kontext Max模型」—— 那是产品 UI，不是母版机制。反过来，一个**通篇不提
 * 任何产品名**的通用模块却 import 了产品目录，才是要拦住的反向依赖。
 *
 * 这条判据只决定「归类」，不决定「放过」：被归为产品 UI 的文件必须出现在下方
 * `KNOWN_LAYOUT_DEBT` 清单里，否则仍算违规。
 */
function productNamedFileOf(rel) {
  const haystack = normalise(rel) + normalise(proseOf(path.join(ROOT, rel)))
  return productTokens.some((token) => token && haystack.includes(token))
}

/**
 * 已登记的排版债务来自**每个产品自己**的清单：
 * `src/lib/products/<id>/layout-debt.json`（一个相对路径的 JSON 数组）。
 *
 * 为什么不在守卫里写死：守卫硬编码 5 个 Flux 路径时，它检查的是**上一个产品**的
 * 排版现状。换产品后要么假绿（新产品没被检查）、要么假红（Flux 路径已消失，
 * 清单过期）。改成产品自述后：
 *   · 装了哪个产品就用哪个产品的清单；
 *   · 产品没装就没有清单 —— 删除产品目录时守卫不会记住它的债务；
 *   · 清单仍然**只能缩小**：新出现的耦合必须登记，消失的必须从产品清单里删掉。
 *
 * 这些文件不构成 Core 反向依赖，但会让「删除产品目录」不干净，所以每一轮都打印。
 */
let failures = 0

const ok = (m) => {
  console.log(`  ✅ ${m}`)
}
const fail = (m) => {
  failures += 1
  console.log(`  ❌ ${m}`)
}

/** rel → 登记它的产品 */
const KNOWN_LAYOUT_DEBT = new Map()

for (const productId of productDirs) {
  const manifest = path.join(SRC, 'lib', 'products', productId, 'layout-debt.json')
  if (!existsSync(manifest)) continue

  let entries

  try {
    entries = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch (error) {
    fail(`${manifest} 不是合法 JSON（应为相对路径数组）：${error.message}`)
    continue
  }

  if (!Array.isArray(entries)) {
    fail(`${manifest} 应为 JSON 数组（相对路径列表）`)
    continue
  }

  for (const rel of entries) {
    if (typeof rel !== 'string') {
      fail(`${manifest} 含非字符串条目`)
      continue
    }
    KNOWN_LAYOUT_DEBT.set(rel, productId)
  }
}

// ── A. Core → Product（按排除法扫描全 src） ──────────────────────────────────
console.log('\n▶ A. Core → Product（必须为 0；Core = src/ 除 products 与 app）')

const coreFiles = allFiles.filter(
  (rel) => !rel.startsWith(PRODUCTS_PREFIX) && !rel.startsWith('src/app/')
)

const violations = []
const debtObserved = new Set()

for (const rel of coreFiles) {
  for (const spec of specifiersOf(path.join(ROOT, rel))) {
    const pointsAtProduct = spec.startsWith('@/lib/products/') || spec.includes('/lib/products/')
    const pointsAtSeam = spec === '@/app/product-runtime'

    if (!pointsAtProduct && !pointsAtSeam) continue

    // 指向接缝（app 层装配）永远没有例外
    if (pointsAtSeam || !productNamedFileOf(rel)) {
      violations.push(`${rel} → import "${spec}"`)
      continue
    }

    debtObserved.add(rel)
  }
}

if (violations.length === 0) {
  ok(
    `${coreFiles.length - debtObserved.size} 个 Core 文件（全 src 按排除法）` +
      `，0 处指向产品层或接缝` +
      (debtObserved.size > 0
        ? `（另有 ${debtObserved.size} 个产品 UI 文件见下方债务清单）`
        : '')
  )
} else {
  for (const v of violations) fail(v)
}

// 债务清单是双向检查：新出现的必须点名，消失的必须收回。
// 但只有**装了产品**才谈得上债务清单 —— 产品目录为空时这些文件本就不该存在，
// 报「清单过期」会把「母版还没装产品」误诊成「记得删一行常量」（9.8.1 审计 §6）。
if (productDirs.length === 0) {
  console.log('  ⓘ  产品目录为空：债务清单检查不适用（这是「母版还没装产品」的状态，不是通过）。')
} else {
  for (const file of [...debtObserved].sort()) {
    if (!KNOWN_LAYOUT_DEBT.has(file)) {
      fail(
        `未登记的产品 UI 耦合：${file}` +
          `（要保留就写进对应产品的 src/lib/products/<id>/layout-debt.json，否则把它移进产品目录）`
      )
    }
  }
  for (const [file, owner] of [...KNOWN_LAYOUT_DEBT.entries()].sort()) {
    if (!debtObserved.has(file) && !violations.some((v) => v.startsWith(file))) {
      fail(
        `债务清单过期：${file} 已不再耦合产品层，` +
          `请从 src/lib/products/${owner}/layout-debt.json 移除`
      )
    }
  }

  const registeredDebt = [...debtObserved]
    .filter((f) => KNOWN_LAYOUT_DEBT.has(f))
    .sort()

  if (registeredDebt.length > 0) {
    console.log(`  ⚠️  产品 UI 住在共享组件目录（**不是** Core，删除产品目录时应一并消失）：`)
    for (const file of registeredDebt) {
      console.log(`       · ${file}  ← 登记在 ${KNOWN_LAYOUT_DEBT.get(file)}`)
    }
    console.log(
      `     共 ${registeredDebt.length} 个 —— 已登记的排版债务，不构成 Core 反向依赖，` +
        '但删除实验必须把它们一并删除。'
    )
  }
}

// ── B. Product 出向依赖清单 ─────────────────────────────────────────────────
console.log('\n▶ B. Product 模块出向依赖（应全部落在 Core 或外部包）')

const PRODUCTS_DIR = path.join(SRC, 'lib', 'products')

if (!existsSync(PRODUCTS_DIR)) {
  console.log('  ⓘ  src/lib/products/ 不存在：没有产品可检查，§B 不适用。')
  console.log('     删除实验里这一行是**预期输出**，它同时说明 §A 的 0 违规是真的（无产品 import 目标）。')
} else {
  const productFiles = allFiles.filter((rel) => rel.startsWith(PRODUCTS_PREFIX))
  const deps = new Set()
  let crossProduct = 0

  for (const rel of productFiles) {
    for (const spec of specifiersOf(path.join(ROOT, rel))) {
      if (!spec.startsWith('@/') && !spec.startsWith('.')) continue
      deps.add(spec)

      if (spec.startsWith('@/lib/products/')) {
        const target = spec.split('/')[3]
        const owner = rel.split('/')[3]
        if (target && owner && target !== owner) {
          crossProduct += 1
          fail(`${rel} → 跨 Product 依赖 "${spec}"`)
        }
      }
    }
  }

  if (crossProduct === 0) ok(`无跨 Product 依赖（${productFiles.length} 个 Product 文件）`)

  const internal = [...deps].filter((s) => s.startsWith('@/')).sort()
  console.log(`     Product → Core 的内部依赖：${internal.length} 个说明符`)
  for (const d of internal) console.log(`       · ${d}`)
}

// ── C. 本脚本能证明什么、不能证明什么 ───────────────────────────────────────
console.log('\n▶ C. 判据边界（避免用 import 方向冒充可复制性）')
console.log('     本守卫证明：Core → Product / Core → 接缝 的静态 import 为 0。')
console.log('     本守卫**不**证明：')
console.log('       · 删除产品目录后 Core 仍可编译 —— 见独立 worktree 删除实验；')
console.log('       · 每个路由都真的拿到了产品配置 —— 见 scripts/verify-product-seam.mjs；')
console.log('       · 模型 ⇄ Provider ⇄ 成本 ⇄ 套餐的完整性 —— 见 scripts/verify-product-config.ts。')

console.log('')
if (failures === 0) {
  console.log(
    `✅ Product Boundary 验证通过：${coreFiles.length - debtObserved.size} 个 Core 文件里，` +
      `指向产品层/接缝的 import 为 0。`
  )
  process.exit(0)
}

console.log(`❌ Product Boundary 验证失败：${failures} 项。`)
process.exit(1)

