#!/usr/bin/env node
/**
 * 环境变量一致性校验（Phase 9.5）
 *
 * 检查两件事：
 *   A. 代码里用到、但 `.env.example` 没有记录的变量  → 模板会缺文档（❌ 失败）
 *   B. `.env.example` 记录、但代码没用到的变量        → 可能已废弃（⚠️ 提示，不失败）
 *
 * 为什么需要它：
 *   `.env*` 被 git 忽略（`.env.example` 例外），因此「环境变量是否齐全」很容易漂移。
 *   把它固化成脚本，换产品 / 加 Provider 时能立刻发现漏配。
 *
 * 白名单：
 *   · `KNOWN_INDIRECT` —— 由框架或依赖库**间接读取**、代码中 grep 不到的变量。
 *   · `TOOLING_VARS`   —— `scripts/` 下工具的**命令行开关**（不是应用环境变量），
 *     不写进 `.env.example`，使用方式见各自脚本的文件头注释。
 *
 * 运行：node scripts/audit-env.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

/** 扫描目录（相对 ROOT）。 */
const SCAN_DIRS = ['src', 'scripts']
const SCAN_ROOT_FILES = ['next.config.js', 'proxy.ts']

/** 由框架 / 依赖库间接读取的变量，不要求出现在 `.env.example` 的「代码使用」比对里。 */
const KNOWN_INDIRECT = new Set([
  'NODE_ENV',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'NEXTAUTH_COOKIE_DOMAIN',
  'VERCEL',
  'VERCEL_URL',
  'VERCEL_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'NEXT_RUNTIME',
  'PORT',
])

/**
 * 开发者工具的**命令行开关**，不是应用的环境变量。
 *
 * `.env.example` 描述的是「把应用跑起来需要哪些环境变量」；
 * 而 `scripts/` 下的工具可以用环境变量做开关（例如跳过构建、指定解释器），
 * 这些属于**本地开发时的命令行选项**，写进 `.env.example` 反而会误导部署者。
 *
 * 它们的使用方式写在各自脚本的文件头注释里。新增脚本开关时请同步到这里，
 * 并确认它确实不属于应用配置 —— 否则应该记进 `.env.example`。
 */
const TOOLING_VARS = new Set([
  'PYTHON', // verify-all.mjs：指定带 sqlglot 的 Python 解释器
  'PGLITE_MODULES', // verify_migrations.mjs：指定含 pglite 的 node_modules 目录
  'VERIFY_SKIP_BUILD', // verify-all.mjs --skip-build
  'VERIFY_SKIP_MIGRATIONS', // verify-all.mjs --skip-migrations
  'VERIFY_ONLY', // verify-all.mjs --only=<kw>
])

const ENV_EXAMPLE = path.join(ROOT, '.env.example')

// ─────────────────────────────────────────────────────────────────────
// 1. 收集代码里的 process.env.X
// ─────────────────────────────────────────────────────────────────────
const ENV_RE = /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g

/** 本脚本自身不参与扫描（否则其注释里的 `process.env.X` 会被当成真实变量）。 */
const SELF = fileURLToPath(import.meta.url)

/** 剥离注释，避免文档/注释里的 `process.env.NEXT_PUBLIC_*` 之类的示例被误判。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry) && full !== SELF) out.push(full)
  }
  return out
}

const files = []
for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d)
  try {
    walk(abs, files)
  } catch {
    /* 目录不存在则跳过 */
  }
}
for (const f of SCAN_ROOT_FILES) {
  const abs = path.join(ROOT, f)
  try {
    if (statSync(abs).isFile()) files.push(abs)
  } catch {
    /* 跳过 */
  }
}

const usedInCode = new Set()

for (const file of files) {
  const source = stripComments(readFileSync(file, 'utf8'))
  for (const m of source.matchAll(ENV_RE)) {
    const name = m[1] || m[2]
    if (name) usedInCode.add(name)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 2. 收集 .env.example 声明的变量（含注释掉的示例）
// ─────────────────────────────────────────────────────────────────────
const exampleSource = readFileSync(ENV_EXAMPLE, 'utf8')
const declared = new Set()

for (const line of exampleSource.split(/\r?\n/)) {
  const m = line.match(/^\s*#?\s*([A-Z_][A-Z0-9_]*)=/)
  if (m) declared.add(m[1])
}

// ─────────────────────────────────────────────────────────────────────
// 3. 比对
// ─────────────────────────────────────────────────────────────────────
const isAllowed = (v) => declared.has(v) || KNOWN_INDIRECT.has(v) || TOOLING_VARS.has(v)

const missingInExample = [...usedInCode].filter((v) => !isAllowed(v)).sort()

const unusedInExample = [...declared]
  .filter((v) => !usedInCode.has(v) && !KNOWN_INDIRECT.has(v))
  .sort()

console.log(`\n扫描 ${files.length} 个文件；代码使用 ${usedInCode.size} 个变量；\n.env.example 声明 ${declared.size} 个。\n`)

let failures = 0

console.log('▶ A. 代码使用但 .env.example 未记录（必须补）')
if (missingInExample.length === 0) {
  console.log('  ✅ 无缺失')
} else {
  failures += missingInExample.length
  for (const v of missingInExample) console.log(`  ❌ ${v}`)
}

console.log('\n▶ B. .env.example 记录但代码未使用（可能已废弃）')
if (unusedInExample.length === 0) {
  console.log('  ✅ 无冗余')
} else {
  for (const v of unusedInExample) console.log(`  ⚠️  ${v}`)
}

console.log('')
if (failures === 0) {
  console.log('✅ 环境变量校验通过（A 无缺失；B 仅为提示，可人工确认后清理）。')
  process.exit(0)
}

console.log(`❌ 环境变量校验失败：${failures} 个变量未在 .env.example 中记录。`)
process.exit(1)
