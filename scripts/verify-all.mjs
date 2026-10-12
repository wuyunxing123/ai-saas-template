#!/usr/bin/env node
/**
 * 本地 CI 入口 —— 一条命令跑完全部门禁。
 *
 * 为什么需要它
 * ------------
 * 本项目**刻意不在 GitHub 上跑 CI**（见 .github/workflows/*.yml 头部注释：
 * "all CI runs locally, not on GitHub"）。因此「CI」这件事必须在本地可重复执行。
 * 在此之前，11 个检查分散在 package.json 与手工命令里，没有任何单一入口能回答
 * 「这个模板现在是健康的吗」。
 *
 * 覆盖内容（顺序执行，聚合结果，不 fail-fast）
 * --------------------------------------------
 *   1. lint                  eslint + tsc --noEmit
 *   2. guards                静态守卫（死文件 / 架构 / 环境变量 / 产品边界 / 接缝可达性）
 *   3. verify:*              业务验证脚本（scripts/verify-*.ts，自动发现）
 *   4. migrations:static     sqlglot 静态校验（需要 Python + sqlglot）
 *   5. migrations:real       PGlite 真实 PostgreSQL 执行 + 幂等 + 积分原子性
 *   6. build                 next build（生产构建）
 *
 * 判定语义（诚实优先）
 * --------------------
 *   · PASS    命令退出码 0
 *   · FAIL    命令退出码非 0（**任一 FAIL → 整体退出 1**）
 *   · SKIP    前置工具链缺失（如未装 sqlglot）。**不算通过**，报告里单独列出并给出安装指引。
 *   · INFO    信息性工具（如 audit:unused-exports，设计上恒为 0），失败不影响结论。
 *
 * 环境变量 / 命令行参数
 * ----------------------
 *   --skip-build / VERIFY_SKIP_BUILD=1        跳过生产构建（本地快速迭代用；CI 不要跳）
 *   --skip-migrations / VERIFY_SKIP_MIGRATIONS=1  跳过两个迁移校验（改非 SQL 文件时用）
 *   --only=<kw> / VERIFY_ONLY=<kw>            只跑名字含该关键字的步骤（如 --only=verify）
 *   --strict                                  把 SKIP 也视为失败（要求全量覆盖时用）
 *   PYTHON=<path>        指定带 sqlglot 的 Python 解释器（默认依次尝试
 *                        .venv → python3 → python）
 *   PGLITE_MODULES=<dir> 指定含 @electric-sql/pglite 的 node_modules 目录
 *
 * 运行
 * ----
 *   npm run verify            # 全量（含 build）
 *   npm run verify:fast       # 跳过 build 与迁移校验
 */

import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(`--${name}`)
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const SKIP_BUILD = hasFlag('skip-build') || process.env.VERIFY_SKIP_BUILD === '1'
const SKIP_MIGRATIONS = hasFlag('skip-migrations') || process.env.VERIFY_SKIP_MIGRATIONS === '1'
const STRICT = hasFlag('strict')
const ONLY = flagValue('only') || process.env.VERIFY_ONLY || ''

// ─────────────────────────────────────────────────────────────────────
// 步骤定义
// ─────────────────────────────────────────────────────────────────────

/** 自动发现 scripts/verify-*.ts（新增验证脚本无需改本文件）。 */
function discoverVerifyScripts() {
  return readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => f.startsWith('verify-') && f.endsWith('.ts'))
    .sort()
    .map((f) => `scripts/${f}`)
}

/**
 * 产品专属测试的作用域声明。
 *
 * 脚本头部写一行 `// @product-scope <productId>` 表示「这是那个产品自己的测试」：
 * 产品目录不在了就按 SKIP 处理（**不是 PASS**），产品目录还在时照常运行、照常判绿。
 * 这样母版换产品时门禁仍然可跑，而不必为了全绿去削弱产品断言。
 */
function productScopeOf(script) {
  const source = readFileSync(path.join(ROOT, script), 'utf8').slice(0, 4000)
  const match = source.match(/@product-scope\s+([\w-]+)/)
  return match ? match[1] : null
}

function productExists(productId) {
  try {
    return statSync(path.join(ROOT, 'src', 'lib', 'products', productId)).isDirectory()
  } catch {
    return false
  }
}

/**
 * 用**异步** spawn 跑一条命令并收集输出。
 *
 * 为什么不用 `spawnSync` / `execSync`：
 *   同步 API 在部分 Windows 环境下会直接失败（`EBUSY`），连 `echo` 都起不来 ——
 *   而此时异步 `spawn`（npm 自己用的也是它）完全正常。用异步 API 顺带还带来
 *   流式输出、不受 `maxBuffer` 限制两个好处。
 */
function run(cmd, { silent = false } = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, {
      cwd: ROOT,
      shell: true,
      stdio: silent ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    if (!silent) {
      proc.stdout?.on('data', (d) => {
        stdout += d
      })
      proc.stderr?.on('data', (d) => {
        stderr += d
      })
    }

    proc.on('error', (error) => {
      resolve({ status: null, signal: null, stdout, stderr, error })
    })

    proc.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr })
    })
  })
}

/** 找一个能 import sqlglot 的 Python。 */
async function resolvePython() {
  const candidates = [
    process.env.PYTHON,
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean)

  for (const bin of candidates) {
    // 注意：必须拼成**单条命令字符串**并自己加引号。
    // 若用 spawn(bin, ['-c', 'import sqlglot'], { shell: true })，
    // Node 会把参数重新拼进命令行且丢掉引号，Python 会收到两个参数而语法错误，
    // 导致「明明装了 sqlglot 却探测不到」。
    const probe = await run(`"${bin}" -c "import sqlglot"`, { silent: true })
    if (probe.status === 0) return bin
  }
  return null
}

const steps = []

// 1. lint（eslint + tsc）
steps.push({
  name: 'lint',
  group: 'gate',
  cmd: 'npm run lint',
  why: 'ESLint + TypeScript 类型检查',
})

// 2. 静态守卫
const guards = [
  ['audit:dead-files', '无引用文件扫描'],
  ['audit:architecture', '基础设施→产品层反向依赖 + 遗留适配器复活'],
  ['audit:env', '.env.example 与代码使用一致性'],
  ['verify:product-boundary', 'Core→Product import 边界'],
  ['verify:product-seam', '每个服务入口的闭包里都有产品接缝'],
]
for (const [cmd, why] of guards) {
  steps.push({ name: cmd, group: 'gate', cmd: `npm run ${cmd}`, why })
}

// 2b. 信息性工具（失败不影响结论）
steps.push({
  name: 'audit:unused-exports',
  group: 'info',
  cmd: 'npm run audit:unused-exports',
  why: '未使用导出（信息性，恒退出 0）',
})

// 3. 业务验证脚本
for (const script of discoverVerifyScripts()) {
  const scope = productScopeOf(script)
  const absent = scope && !productExists(scope)

  steps.push({
    name: path.basename(script),
    group: 'gate',
    // 产品专属测试在它所依赖的产品缺失时是 SKIP，**不是 PASS**：
    // 母版换产品后门禁仍然可跑，而产品自己的断言不会被偷偷削弱。
    cmd: absent ? null : `node scripts/run-ts.mjs ${script}`,
    why: absent
      ? `产品专属验证（依赖 src/lib/products/${scope}/）`
      : '业务逻辑验证（纯逻辑，无需 DB/Key）',
    skipReason: absent
      ? `产品「${scope}」未安装：脚本声明了 @product-scope ${scope}。换产品时这是预期跳过。`
      : null,
  })
}

// 4. 迁移静态校验
const python = SKIP_MIGRATIONS ? null : await resolvePython()
steps.push({
  name: 'migrations:static',
  group: 'gate',
  cmd: python ? `"${python}" supabase/scripts/validate_migrations.py` : null,
  why: 'sqlglot 静态校验（语法 / 依赖序 / 外键 / 唯一约束 / 索引 / 幂等）',
  skipReason: SKIP_MIGRATIONS
    ? 'VERIFY_SKIP_MIGRATIONS=1'
    : python
      ? null
      : '未找到带 sqlglot 的 Python。安装：pip install -r supabase/scripts/requirements.txt；或设 PYTHON=<path>',
})

// 5. 迁移真实执行（PGlite）
steps.push({
  name: 'migrations:real',
  group: 'gate',
  cmd: SKIP_MIGRATIONS
    ? null
    : `node supabase/scripts/verify_migrations.mjs`,
  why: '真实 PostgreSQL 执行全部迁移 + 幂等 + 积分原子性 + Billing 闭环',
  skipReason: SKIP_MIGRATIONS ? 'VERIFY_SKIP_MIGRATIONS=1' : null,
})

// 6. 生产构建
steps.push({
  name: 'build',
  group: 'gate',
  cmd: SKIP_BUILD ? null : 'npm run build',
  why: '生产构建（Next.js 全路由编译）',
  skipReason: SKIP_BUILD ? 'VERIFY_SKIP_BUILD=1' : null,
})

// ─────────────────────────────────────────────────────────────────────
// 执行
// ─────────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
}

const results = []

async function runStep(step) {
  if (ONLY && !step.name.includes(ONLY)) return null
  if (step.cmd === null) {
    results.push({ ...step, status: 'SKIP', ms: 0, tail: '' })
    return 'SKIP'
  }

  const started = Date.now()
  const proc = await run(step.cmd)
  const ms = Date.now() - started
  const output = `${proc.stdout}${proc.stderr}`
  const lines = output.trimEnd().split(/\r?\n/)
  const tail = lines.slice(-12).join('\n')

  const passed = proc.status === 0
  const status = passed ? 'PASS' : step.group === 'info' ? 'INFO' : 'FAIL'
  results.push({ ...step, status, ms, tail, code: proc.status })
  return status
}

const selected = steps.filter((s) => !ONLY || s.name.includes(ONLY))

console.log(`${C.bold}${C.cyan}▶ 本地 CI 门禁${C.reset} ${C.dim}(${selected.length} 步)${C.reset}`)
console.log(`${C.dim}  仓库策略：CI 全部在本地跑，不使用 GitHub Actions 自动触发${C.reset}\n`)

for (const step of selected) {
  process.stdout.write(`  ${step.name.padEnd(30)} `)
  const status = await runStep(step)
  if (status === null) continue

  const last = results[results.length - 1]
  const badge =
    status === 'PASS'
      ? `${C.green}PASS${C.reset}`
      : status === 'FAIL'
        ? `${C.red}FAIL${C.reset}`
        : status === 'SKIP'
          ? `${C.yellow}SKIP${C.reset}`
          : `${C.cyan}INFO${C.reset}`
  const dur = last.ms ? `${C.dim}${(last.ms / 1000).toFixed(1)}s${C.reset}` : ''
  console.log(`${badge} ${dur}`)
}

// ─────────────────────────────────────────────────────────────────────
// 报告
// ─────────────────────────────────────────────────────────────────────

const failures = results.filter((r) => r.status === 'FAIL')
const skips = results.filter((r) => r.status === 'SKIP')
const infos = results.filter((r) => r.status === 'INFO')
const passes = results.filter((r) => r.status === 'PASS')

if (failures.length > 0) {
  console.log(`\n${C.red}${C.bold}✗ 失败详情${C.reset}`)
  for (const f of failures) {
    console.log(`\n${C.red}── ${f.name}${C.reset} ${C.dim}(exit ${f.code})${C.reset}`)
    console.log(`${C.dim}   ${f.why}${C.reset}`)
    if (f.tail) console.log(f.tail.replace(/^/gm, '   '))
  }
}

if (skips.length > 0) {
  console.log(`\n${C.yellow}${C.bold}⚠ 跳过（不算通过）${C.reset}`)
  for (const s of skips) {
    console.log(`  ${C.yellow}${s.name}${C.reset}  ${C.dim}${s.why}${C.reset}`)
    if (s.skipReason) console.log(`      ${C.yellow}原因：${s.skipReason}${C.reset}`)
  }
}

if (infos.length > 0) {
  console.log(`\n${C.cyan}ℹ 信息性步骤（不影响结论）${C.reset}`)
  for (const i of infos) console.log(`  ${i.name}`)
}

console.log(
  `\n${C.bold}结果${C.reset}  ${C.green}${passes.length} 通过${C.reset} · ` +
    `${failures.length > 0 ? C.red : C.dim}${failures.length} 失败${C.reset} · ` +
    `${skips.length > 0 ? C.yellow : C.dim}${skips.length} 跳过${C.reset}` +
    (infos.length ? ` · ${C.cyan}${infos.length} 信息${C.reset}` : '')
)

if (failures.length > 0) {
  console.log(`\n${C.red}${C.bold}❌ 门禁未通过${C.reset}`)
  process.exit(1)
}

if (skips.length > 0) {
  if (STRICT) {
    console.log(
      `\n${C.red}${C.bold}❌ 门禁未通过（--strict）：有 ${skips.length} 步被跳过，覆盖率不完整${C.reset}`
    )
    process.exit(1)
  }
  console.log(`\n${C.yellow}${C.bold}⚠ 门禁通过，但有 ${skips.length} 步被跳过 —— 覆盖率不完整${C.reset}`)
  process.exit(0)
}

console.log(`\n${C.green}${C.bold}✅ 门禁全部通过${C.reset}`)
process.exit(0)
