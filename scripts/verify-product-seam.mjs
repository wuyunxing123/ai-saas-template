#!/usr/bin/env node
/**
 * 产品运行时接缝守卫（Phase 9.8.2-C）
 *
 * 证明的是**运行时可达性**，不是 import 方向：
 * `bindProductConfig()` 是模块级副作用，而 Next.js 会把每个路由打成独立的
 * serverless bundle —— 某个路由「恰好」加载过接缝模块，不代表别的路由也加载过。
 * 因此本守卫从**每个服务入口**出发做 BFS，要求它自己的依赖闭包里有接缝。
 *
 * 规则：
 *   1. 入口 = src/app 下的 route / page / layout 文件 + scripts/verify-*.ts 与
 *      scripts/probe-*.ts（测试环境同样必须能取到完整配置）。
 *   2. 「依赖产品配置」= 传递地 import 了某个**在运行时读 bundle** 的模块
 *      （调用 `getProductConfig()` 的非产品层、非定义文件本身）。
 *   3. 规则 2 成立的入口，闭包里必须含 `src/app/product-runtime.ts`。
 *      例外必须在源码里显式写 `@seam deliberate-unbound` 并注明理由，守卫会点名打印。
 *   4. "use client" 模块是服务图的终点，并且**不得**传递地触达
 *      `@/config/product` 、`@/config/billing` 、Provider 实现或 node: 内置模块
 *      （客户端 bundle 不能带服务端配置与加密实现）。
 *   5. Core（src/lib 除 products、src/config）不得 import 接缝或产品层；
 *      组件层（src/components）可读客户端安全的产品数据模块，但不得 import
 *      接缝，也不得 import 产品目录的服务端门面（service / providers / config）。
 *   6. src/lib/products/<id>/ 每个产品目录必须有 config.ts（产品配置自述入口）。
 *
 * 自检：`node scripts/verify-product-seam.mjs --self-test`
 *   用内存里的合成图源验证「违规输入会失败、合法输入会通过」。
 *
 * 运行：node scripts/verify-product-seam.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'src')

export const SEAM = 'src/app/product-runtime.ts'
const PRODUCTS_PREFIX = 'src/lib/products/'
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

/** 只在服务端存在的模块：客户端图不得触达。 */
const SERVER_ONLY = [
  'src/config/product.ts',
  'src/config/billing.ts',
  'src/app/product-runtime.ts',
]
const SERVER_ONLY_DIRS = ['src/lib/ai/providers']

/** 入口文件名的特征（app 层）。 */
function isAppEntry(rel) {
  if (!rel.startsWith('src/app/')) return false
  const base = path.basename(rel)
  if (base === 'product-runtime.ts' || base === 'product-content.ts') return false
  return /^(route|page|layout)\.(ts|tsx|js|jsx)$/.test(base)
}

/** 入口文件名的特征（验证脚本）。 */
function isScriptEntry(rel) {
  return (
    rel.startsWith('scripts/') &&
    /^(verify|probe)-[\w-]+\.(ts|mjs)$/.test(path.basename(rel))
  )
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FROM_CLAUSE_RE = /\b(?:import|export)\b([\s\S]{0,800}?)\bfrom\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * 抽出「运行时依赖」的说明符。
 *
 * `import type { X } from '...'` 编译后不留 require，必须忽略 —— 否则产品目录里
 * 每个 `import type { ProductConfig } from '@/config/product'` 都会假装成运行时耦合。
 */
function specifiersOf(source) {
  const out = []
  for (const m of source.matchAll(FROM_CLAUSE_RE)) {
    if (/^\s*type\b/.test(m[1])) continue
    out.push(m[2])
  }
  for (const m of source.matchAll(BARE_IMPORT_RE)) out.push(m[1])
  for (const m of source.matchAll(DYNAMIC_IMPORT_RE)) out.push(m[1])
  return out
}

/** 相对/别名说明符 → 仓库相对路径（posix）。外部包返回 null。 */
export function resolveSpecifier(spec, fromRel) {
  let base
  if (spec.startsWith('@/')) base = path.posix.join('src', spec.slice(2))
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  else return null

  const candidates = [base]
  for (const ext of EXTENSIONS) candidates.push(base + ext)
  for (const ext of EXTENSIONS) candidates.push(path.posix.join(base, 'index' + ext))

  return candidates.find((c) => existsSync(path.join(ROOT, c))) ?? null
}

/** 读源码（真实磁盘）。 */
function readReal(rel) {
  return stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
}

/**
 * 在运行时读产品 bundle 的模块。
 *
 * 判据是「调用 `getProductConfig(`」，而不是 import 了它 —— 只 import 类型
 * （产品 config.ts）或只定义访问器（`src/config/product.ts` 本身）都不算。
 */
export function findConfigReaders(files, read) {
  const readers = new Set()
  for (const rel of files) {
    // 只有真正会被 app / jiti 加载的源文件才可能「在运行时读 bundle」；
    // 守卫自身（.mjs）里的 getProductConfig 只是字符串样本。
    if (!/\.(ts|tsx)$/.test(rel)) continue
    if (rel === 'src/config/product.ts') continue
    if (rel.startsWith(PRODUCTS_PREFIX)) continue
    if (/getProductConfig\s*\(/.test(read(rel))) readers.add(rel)
  }
  return readers
}

/** 真实仓库的说明符解析。 */
function resolveReal(spec, fromRel) {
  return resolveSpecifier(spec, fromRel)
}

/** 合成图源的解析：只认 @/ 别名，且必须在该图源里存在。 */
function makeVirtualResolve(allFiles) {
  return (spec, fromRel) => {
    if (!spec.startsWith('@/')) return null
    const target = path.posix.join('src', spec.slice(2))
    const withIndex = path.posix.join(target.replace(/\.[^./]+$/, ''), 'index.ts')
    return [target, target + '.ts', target + '.tsx', withIndex].find((c) => allFiles.has(c)) ?? null
  }
}

/** 邻接表：文件 → { deps, isClient }。 */
function buildGraph(files, read, resolve) {
  const graph = new Map()
  for (const rel of files) {
    const source = read(rel)
    const deps = new Set()
    for (const specifier of specifiersOf(source)) {
      const target = resolve(specifier, rel)
      if (target) deps.add(target)
    }
    graph.set(rel, { deps, isClient: /^\s*["']use client["']/.test(source) })
  }
  return graph
}

export function reachable(graph, start) {
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const cur = stack.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const dep of graph.get(cur)?.deps ?? []) stack.push(dep)
  }
  seen.delete(start)
  return seen
}

/**
 * 扫描器核心：真实仓库或合成图源都走这一份逻辑。
 *
 * `virtual` 提供 { files, sources } 时完全脱离磁盘。
 */
export function scan(virtual) {
  const read = virtual ? (rel) => virtual.sources[rel] ?? '' : readReal
  const files = virtual
    ? virtual.files
    : [
        ...walk(SRC).map((f) => path.relative(ROOT, f).replace(/\\/g, '/')),
        ...walk(path.join(ROOT, 'scripts'))
          .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'))
          .filter((rel) => isScriptEntry(rel) || rel === 'scripts/run-ts.mjs'),
      ]
  const allFiles = new Set(files)
  const resolve = virtual ? makeVirtualResolve(allFiles) : resolveReal

  const graph = buildGraph(files, read, resolve)

  const entries = [...allFiles]
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter((f) => isAppEntry(f) || isScriptEntry(f))
  const readers = findConfigReaders([...allFiles], read)
  const deliberate = [...allFiles].filter((f) =>
    /@seam\s+deliberate-unbound/.test(virtual ? read(f) : readFileSync(path.join(ROOT, f), 'utf8'))
  )

  const failures = []

  // 规则 3：需要配置的入口必须绑定了接缝
  for (const entry of entries) {
    if (deliberate.includes(entry)) continue
    const closure = reachable(graph, entry)
    const witness = [...readers].find((r) => closure.has(r))
    if (witness && !closure.has(SEAM)) {
      failures.push(
        `${entry} 依赖产品配置（经 ${witness}）但没有 import 接缝 ${SEAM}；` +
          '该 bundle 里 getProductConfig() 会抛「No product configuration is bound」。'
      )
    }
  }

  // 规则 4：客户端 bundle 纯净性
  for (const [rel, node] of graph) {
    if (!node.isClient) continue
    const closure = reachable(graph, rel)
    for (const forbidden of SERVER_ONLY) {
      if (closure.has(forbidden)) {
        failures.push(`${rel}（"use client"）传递地触达服务端配置模块 ${forbidden}`)
      }
    }
    for (const dir of SERVER_ONLY_DIRS) {
      const hit = [...closure].find((c) => c.startsWith(dir + '/'))
      if (hit) failures.push(`${rel}（"use client"）传递地触达 Provider 实现 ${hit}`)
    }
    for (const spec of specifiersOf(read(rel))) {
      if (spec.startsWith('node:') || /^(fs|path|crypto)$/.test(spec)) {
        failures.push(`${rel}（"use client"）直接 import 了 Node 内置模块 ${spec}`)
      }
    }
  }

  // 规则 5：Core 不得 import 接缝 / 产品层
  for (const rel of allFiles) {
    const isCore =
      (rel.startsWith('src/lib/') && !rel.startsWith(PRODUCTS_PREFIX)) || rel.startsWith('src/config/')
    if (!isCore) continue
    for (const spec of specifiersOf(read(rel))) {
      if (spec === '@/app/product-runtime' || spec.startsWith('@/lib/products/')) {
        failures.push(`${rel}（Core）反向 import 了 app 层接缝或产品层：${spec}`)
      }
    }
  }

  // 规则 5b：共享组件层（src/components/**）可以读**客户端安全**的产品数据，
  // 但不得 import 接缝，也不得把产品服务端门面 / Provider 装配拉进组件图。
  for (const rel of allFiles) {
    if (!rel.startsWith('src/components/')) continue
    for (const spec of specifiersOf(read(rel))) {
      if (spec === '@/app/product-runtime') {
        failures.push(`${rel}（组件层）import 了 app 层接缝：产品绑定只发生在 app 入口`)
      }
      const m = /^@\/lib\/products\/[^/]+\/(config|providers|provider-data|service|index)$/.exec(spec)
      if (m) {
        failures.push(`${rel}（组件层）import 了产品服务端模块 ${spec}（组件只能读客户端安全的数据模块）`)
      }
    }
  }

  // 规则 6：产品自述入口存在
  const productDirs = new Set()
  for (const rel of allFiles) {
    if (rel.startsWith(PRODUCTS_PREFIX)) {
      const name = rel.slice(PRODUCTS_PREFIX.length).split('/')[0]
      if (name) productDirs.add(name)
    }
  }
  for (const name of productDirs) {
    const cfg = `${PRODUCTS_PREFIX}${name}/config.ts`
    if (!allFiles.has(cfg)) {
      failures.push(`产品目录 ${PRODUCTS_PREFIX}${name}/ 缺少 config.ts（产品配置自述入口）`)
    }
  }

  return { entries, readers, productDirs: [...productDirs], deliberate, failures }
}

// ── 自检：证明守卫本身能分辨合法/违规 ────────────────────────────────────────
function selfTest() {
  const seamSrc = `import { bindProductConfig } from '@/config/product'
import { P } from '@/lib/products/demo/config'
bindProductConfig(P)
export const productRuntimeId = 'demo'`

  const readerSrc = `import { getProductConfig } from '@/config/product'
export function getModel(id) { return getProductConfig().models[id] }`

  const base = (entryBody) => ({
    files: [
      'src/config/product.ts',
      'src/lib/ai/models.ts',
      'src/app/product-runtime.ts',
      'src/app/demo/route.ts',
      'src/lib/services/x.ts',
    ],
    sources: {
      'src/config/product.ts': `export function getProductConfig() { return { productId: 'demo' } }\nexport function bindProductConfig(c) {}`,
      'src/lib/ai/models.ts': readerSrc,
      'src/app/product-runtime.ts': seamSrc,
      'src/app/demo/route.ts': entryBody,
      'src/lib/services/x.ts': `import { getModel } from '@/lib/ai/models'\nexport const h = () => getModel('a')`,
    },
  })

  const clean = base(`import '@/app/product-runtime'\nimport { h } from '@/lib/services/x'\nexport const POST = h`)
  const dirty = base(`import { h } from '@/lib/services/x'\nexport const POST = h`)
  const clientLeak = {
    files: [...dirty.files, 'src/components/a.tsx'],
    sources: {
      ...dirty.sources,
      'src/components/a.tsx': `"use client"\nimport { h } from '@/lib/services/x'\nexport default h`,
    },
  }

  const cases = [
    { name: '合法：入口绑定接缝 → 通过', virtual: clean, expectFail: false },
    { name: '违规：入口经 Core 读配置但未绑定接缝 → 必须失败', virtual: dirty, expectFail: true },
    { name: '违规："use client" 组件拉进服务端配置 → 必须失败', virtual: clientLeak, expectFail: true },
  ]

  let bad = 0
  for (const c of cases) {
    const result = scan(c.virtual)
    const got = result.failures.length > 0
    const label = got ? '报告了违规' : '通过'
    if (got !== c.expectFail) {
      bad += 1
      console.log(`  ❌ 自检失败（判据错误）：${c.name} → ${label}`)
      for (const f of result.failures) console.log(`       · ${f}`)
    } else {
      console.log(`  ✅ ${c.name} → ${label}`)
    }
  }

  // Core 反向依赖接缝：必须失败
  const reverse = {
    files: [...clean.files, 'src/lib/services/sneaky.ts'],
    sources: {
      ...clean.sources,
      'src/lib/services/sneaky.ts': `import '@/app/product-runtime'\nexport const x = 1`,
    },
  }
  const reverseResult = scan(reverse)
  if (reverseResult.failures.some((f) => f.includes('反向 import'))) {
    console.log('  ✅ 违规：Core 反向 import app 层接缝 → 报告了违规')
  } else {
    bad += 1
    console.log('  ❌ 自检失败：Core 反向 import 接缝未被检出')
  }

  console.log('')
  if (bad > 0) {
    console.log(`❌ 接缝守卫自检失败：${bad} 个判据不符。`)
    process.exit(1)
  }
  console.log('✅ 接缝守卫自检通过：违规输入会失败，合法输入会通过。')
  process.exit(0)
}

// ── 真实扫描 ─────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) selfTest()

const { entries, readers, productDirs, deliberate, failures } = scan(null)

console.log('')
console.log(`▶ 产品运行时接缝（入口 → bundle 可达性）`)
console.log(`   产品配置读取点：${readers.size} 个模块`)
for (const r of [...readers].sort()) console.log(`     · ${r}`)
console.log(`   服务/测试入口：${entries.length} 个`)
console.log(`   已发现产品：${productDirs.join(', ') || '（无）'}`)
if (deliberate.length) {
  console.log(`   显式声明「故意不绑定」的入口（每个都必须自带理由）：`)
  for (const d of deliberate) console.log(`     · ${d}`)
}

if (failures.length === 0) {
  console.log('')
  console.log(`✅ 接缝检查通过：${entries.length} 个入口里，凡是能到达产品配置的都已绑定 ${SEAM}；`)
  console.log('   客户端模块未触达服务端配置；Core 未反向依赖接缝/产品层；产品目录均有 config.ts。')
  process.exit(0)
}

console.log('')
console.log(`❌ 接缝检查失败：${failures.length} 处。`)
for (const f of failures) console.log(`  ❌ ${f}`)
process.exit(1)
