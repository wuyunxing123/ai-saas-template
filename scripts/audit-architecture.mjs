#!/usr/bin/env node
/**
 * 架构守卫：基础设施**不得**反向依赖产品层。
 *
 * 规则（规格 §25 / §26）：
 *
 *   允许：Product → AI / Workflow / Storage / Credit / Auth / DB / Billing / Admin
 *   禁止：上述任何一层 → Product（含 app 层接缝）
 *
 * 检查方式：扫描基础设施目录下每个文件的 import 说明符，
 * 若指向产品层（`@/lib/products/<任意 productId>`）或接缝，即判违规。
 * 判据按**产品层路径**匹配而不是按某个产品的名字 —— 否则换上第二个产品后
 * 这条守卫会对真实反向依赖假绿。
 *
 * 为什么用静态扫描而不是运行时测试：
 *   反向依赖是**编译期**问题，且最容易在后续 Phase 悄悄溜回来。
 *   把它固化成守卫（退出码 1）比写测试更早、更直接地拦截。
 *
 * 运行：node scripts/audit-architecture.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'src')

/** 基础设施层：不允许依赖任何产品层。 */
const INFRA_DIRS = [
  'lib/ai',
  'lib/workflow',
  'lib/storage',
  'lib/db',
  'lib/billing',
  'lib/admin',
  'lib/services',
  'lib/auth',
  'lib/content-safety',
  'lib/seo',
]

/**
 * 判定「指向产品层」的 import 说明符特征。
 *
 * 主判据必须是**通用**的：写死 `flux-kontext` 等于「只检查上一个产品」，
 * 换成第二个产品后这条守卫会对真实反向依赖**假绿**（9.8.1 审计发现）。
 *
 * 第二条规则是**反复活**：母版历史上那些产品耦合的旧路径名（`lib/flux-kontext*`、
 * `lib/image-generation`）已经不属于任何现存产品，留着它们不会误伤新产品，
 * 只是防止旧代码被复制回来。它按名字点名，不参与「产品层」判定。
 */
const PRODUCT_LAYER_SPECIFIER = /(@\/lib\/products\/|\/lib\/products\/|@\/app\/product-runtime|@\/app\/product-content)/

/** 已废弃的产品耦合旧路径（历史上写过 Flux 的名字，不得复活）。 */
const RESURRECTION_SPECIFIER = /@\/lib\/flux-kontext|@\/lib\/image-generation|\/flux-kontext/

/** 允许的例外（若某基础设施确实需要，请显式登记并说明理由）。 */
const ALLOWLIST = new Set([
  // 例：'lib/xxx/yyy.ts',
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g
const DYNAMIC_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * 剥离注释后再扫描。
 *
 * 否则文档注释里「原先 import 了 X，现已移除」这种句子会被误判为真实依赖
 * （本脚本首次运行时就撞到过这个假阳性）。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // 行注释（保留 :// 避免误伤 URL）
}

let violations = 0
let scanned = 0

for (const dir of INFRA_DIRS) {
  const abs = path.join(SRC, dir)
  let files
  try {
    files = walk(abs)
  } catch {
    continue // 目录不存在则跳过
  }

  for (const file of files) {
    scanned += 1
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')

    if (ALLOWLIST.has(rel)) continue

    const source = stripComments(readFileSync(file, 'utf8'))
    const specifiers = []

    for (const m of source.matchAll(IMPORT_RE)) specifiers.push(m[1])
    for (const m of source.matchAll(DYNAMIC_RE)) specifiers.push(m[1])

    for (const spec of specifiers) {
      if (PRODUCT_LAYER_SPECIFIER.test(spec)) {
        violations += 1
        console.log(`  ❌ ${rel}`)
        console.log(`       → import "${spec}"  （基础设施不得依赖产品层 / app 层接缝）`)
      } else if (RESURRECTION_SPECIFIER.test(spec)) {
        violations += 1
        console.log(`  ❌ ${rel}`)
        console.log(`       → import "${spec}"  （已废弃的产品耦合旧路径不得复活）`)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// 规则 2（Phase 9.1）：遗留伪 Prisma 适配器不得复活
// ─────────────────────────────────────────────────────────────────────
// 业务代码一律走 Repository / Domain Service，禁止再出现
// `lib/database.ts` 这类「万能 Prisma-like 适配器」。
console.log('')
console.log('▶ 遗留 database 适配器检查')

const LEGACY_ADAPTER = path.join(SRC, 'lib', 'database.ts')
if (existsSync(LEGACY_ADAPTER)) {
  violations += 1
  console.log('  ❌ src/lib/database.ts 重新出现（伪 Prisma 适配器已废弃）')
}

const LEGACY_IMPORT = /from\s*['"](?:@\/lib\/database|\.\.?\/.*database)['"]/

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/')
  const source = stripComments(readFileSync(file, 'utf8'))
  if (LEGACY_IMPORT.test(source)) {
    violations += 1
    console.log(`  ❌ ${rel}`)
    console.log('       → import 了遗留 database 适配器（应改用 Repository / Domain Service）')
  }
}

console.log('')
if (violations === 0) {
  console.log(
    `✅ 架构检查通过：${INFRA_DIRS.length} 个基础设施目录、${scanned} 个文件，无反向依赖；` +
      '无遗留 database 适配器。'
  )
  process.exit(0)
}

console.log(`❌ 架构检查失败：发现 ${violations} 处架构违规。`)
process.exit(1)
