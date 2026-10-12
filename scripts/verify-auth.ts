/**
 * Auth 基础能力验证（无需真实数据库或第三方服务）
 *
 * 覆盖：
 *   1. Session 类型包含 id
 *   2. User 类型包含 role
 *   3. users 表 schema 包含 role 列
 *   4. 开发环境 backdoor 仅 dev 生效
 *   5. 无 password 字段写入 users 表
 *   6. admin 判断不依赖 request.body.userId
 *   7. auth.ts 不直接 import R2 SDK
 *   8. 积分注册赠礼类型为 bonus 而非 gift
 */

import { existsSync, readdirSync, statSync } from 'fs'
import path from 'node:path'
import { ROOT, readSource, grepSource } from './source-scan'

let passed = 0
let failed = 0

function ok(label: string) {
  passed++
  console.log(`  ✅ ${label}`)
}

function fail(label: string, detail?: string) {
  failed++
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
}

function section(title: string) {
  console.log(`\n▶ ${title}`)
}

// ─────────────────────────────────────────────────────────────────────
// 1. Session 类型包含 id
// ─────────────────────────────────────────────────────────────────────

section('1. Session 类型')

const sessionType = readSource('src/types/next-auth.d.ts')
if (sessionType.includes('id: string')) ok('Session.user 包含 id')
else fail('Session.user 缺少 id')

if (sessionType.includes('role?:')) ok('Session.user 包含 role')
else fail('Session.user 缺少 role')

// ─────────────────────────────────────────────────────────────────────
// 2. users 表 schema 包含 role 列
// ─────────────────────────────────────────────────────────────────────

section('2. users 表 schema')

const userRow = readSource('src/lib/db/types.ts')
if (userRow.includes('role:')) ok('UserRow 包含 role')
else fail('UserRow 缺少 role')

const migration = readSource('supabase/migrations/0007_user_role.sql')
if (migration.includes("role VARCHAR")) ok('迁移 0007 添加 role 列')
else fail('迁移 0007 缺少 role 列')

if (migration.includes("chk_users_role")) ok('迁移 0007 有 role CHECK 约束')
else fail('迁移 0007 缺少 role CHECK 约束')

// ─────────────────────────────────────────────────────────────────────
// 3. auth.ts 关键修复
// ─────────────────────────────────────────────────────────────────────

section('3. auth.ts 关键修复')

const authTs = readSource('src/lib/auth.ts')

if (authTs.includes("session.user.id =")) ok('session callback 注入 user.id')
else fail('session callback 未注入 user.id')

if (authTs.includes("type: 'bonus'")) ok('注册赠积分使用 bonus 类型')
else if (authTs.includes("type: 'gift'")) fail('注册赠积分仍使用 gift 类型（违反 CHECK）')
else ok('注册赠积分已移除 gift 类型')

// 开发环境 backdoor 检查
if (authTs.includes("NODE_ENV === 'development'")) ok('backdoor 有 development 保护')
else fail('backdoor 缺少 development 保护')

// 检查没有直接写 password 到 users 表
if (!authTs.includes('password:') || authTs.match(/password:/g)!.length <= 2) {
  ok('auth.ts 未向 users 表写入 password')
} else {
  fail('auth.ts 可能向 users 表写入 password')
}

// B-7：register 路由不得向 users 表写 password（users 表无该列）
const registerSrc = readSource('src/app/api/auth/register/route.ts')

if (!/password\s*:\s*hashedPassword/.test(registerSrc)) {
  ok('B-7：register 路由未写入 password 字段')
} else {
  fail('B-7：register 路由仍在写入 password 字段')
}

if (!/from\s+['"]bcryptjs['"]|bcrypt\.hash\(/.test(registerSrc)) {
  ok('B-7：register 路由不再使用 bcrypt')
} else {
  fail('B-7：register 路由仍使用 bcrypt')
}

// ─────────────────────────────────────────────────────────────────────
// 4. admin 判断不依赖 request.body.userId
// ─────────────────────────────────────────────────────────────────────

section('4. Admin 安全')

// Phase 9.2：改用**现存**的 admin 路由做检查
// （原 maintenance / payment-config 两个 Phase 4 遗留路由已删除）
const adminRoutes = readSource(
  'src/app/api/admin/users/route.ts',
  'src/app/api/admin/orders/route.ts',
  'src/app/api/admin/credits/route.ts',
  'src/app/api/admin/ai-tasks/route.ts'
)
if (!adminRoutes.includes('body.userId') && !adminRoutes.includes('body.user')) {
  ok('admin 路由不读取 request.body.userId')
} else {
  fail('admin 路由读取了 request.body.userId')
}

// Phase 6.5 起，admin 路由统一走 Admin 授权边界（users.role），不再直接比对 ADMIN_EMAILS
if (adminRoutes.includes('withAdmin(') || adminRoutes.includes('getAdminContext(')) {
  ok('admin 路由使用统一 Admin 授权边界（role-based）')
} else if (adminRoutes.includes('ADMIN_EMAILS')) {
  fail('admin 路由仍直接使用 ADMIN_EMAILS 做权限判断')
} else {
  fail('admin 路由鉴权方式未知')
}

// ─────────────────────────────────────────────────────────────────────
// 5. package.json 名称
// ─────────────────────────────────────────────────────────────────────

section('5. Package 元数据')

const pkg = readSource('package.json')
if (!pkg.includes('"name": "nextjs-shadcn"')) ok('package.json 名称已不再是 nextjs-shadcn')
else fail('package.json 名称仍是 nextjs-shadcn')

// ─────────────────────────────────────────────────────────────────────
// 6. 限流桶隔离（B-21）
// ─────────────────────────────────────────────────────────────────────

section('6. 限流桶隔离（B-21）')

const proxySrc = readSource('src/proxy.ts')

if (/\$\{ip\}:\$\{bucket\}/.test(proxySrc)) {
  ok('B-21：限流 key 包含 bucket（路径各自独立计数）')
} else {
  fail('B-21：限流 key 未包含 bucket，不同路径仍会互相干扰')
}

if (proxySrc.includes("bucket = 'auth'") && proxySrc.includes("bucket = 'payment'")) {
  ok('B-21：auth / payment 使用独立桶')
} else {
  fail('B-21：auth / payment 未使用独立桶')
}

if (proxySrc.includes('sweepStaleEntries')) {
  ok('B-21：限流 map 有过期清理（避免内存无限增长）')
} else {
  fail('B-21：限流 map 无清理逻辑')
}

// ─────────────────────────────────────────────────────────────────────
// 7. 业务代码零直接 S3 引用（Storage 回归）
// ─────────────────────────────────────────────────────────────────────

section('7. Storage 架构回归')

const s3Grep = grepSource(
  /@aws-sdk\/client-s3|S3Client|PutObjectCommand|DeleteObjectCommand/,
  { exts: ['.ts', '.tsx'], exclude: /src\/lib\/storage\/providers\/r2\.ts/ }
).trim()

const s3Imports = s3Grep
  .split(/\r?\n/)
  .filter((line) => {
    const content = line.replace(/^[^:]+:[^:]+:/, '').trim()
    return content && !content.startsWith('*') && !content.startsWith('//')
  })
  .join('\n')

if (!s3Imports) ok('src/ 内无业务代码直接 import S3 SDK')
else fail('发现业务代码直接 import S3 SDK', s3Imports.split('\n').length + ' 处')

// ─────────────────────────────────────────────────────────────────────
// 8. 用户身份来源统一（F-1）
// ─────────────────────────────────────────────────────────────────────

section('8. 用户身份来源（F-1）')

const authSessionSrc = readSource('src/lib/auth-session.ts')

if (authSessionSrc.includes('export async function getCurrentUser')) {
  ok('F-1：auth-session.ts 提供 getCurrentUser()')
} else {
  fail('F-1：auth-session.ts 缺少 getCurrentUser()')
}

if (authSessionSrc.includes('export async function getSessionIdentity')) {
  ok('F-1：auth-session.ts 提供 getSessionIdentity()')
} else {
  fail('F-1：auth-session.ts 缺少 getSessionIdentity()')
}

if (/userRepo\.findById\(identity\.id\)/.test(authSessionSrc)) {
  ok('F-1：优先用主键 id 查询（email 仅兜底）')
} else {
  fail('F-1：未优先使用主键 id 查询')
}

// 活跃业务路由不得再按 session.email 查用户。
// 路由清单按**目录发现**（src/app/api/**\/route.ts）而不是手写：手写的清单里
// 点着某个产品的路由名，换产品后要么漏检、要么根本读不到文件。
function discoverApiRoutes(dir = 'src/app/api'): string[] {
  const out: string[] = []
  const abs = path.join(ROOT, dir)

  if (!existsSync(abs)) return out

  for (const entry of readdirSync(abs)) {
    const full = path.join(abs, entry)
    const rel = path.relative(ROOT, full).split(path.sep).join('/')

    if (statSync(full).isDirectory()) {
      out.push(...discoverApiRoutes(rel))
      continue
    }
    if (path.basename(full) === 'route.ts') out.push(rel)
  }
  return out.sort()
}

const liveRoutes = [
  ...discoverApiRoutes(),
  'src/lib/billing/session.ts',
  'src/lib/admin/authorization.ts',
]

let emailLookupOffenders = 0
for (const route of liveRoutes) {
  const src = readSource(route)
  if (/where:\s*\{\s*email:\s*session\.user\.email|\.eq\(\s*'email'\s*,\s*session\.user\.email/.test(src)) {
    fail(`F-1：${route} 仍按 session.user.email 查用户`)
    emailLookupOffenders += 1
  }
}
if (emailLookupOffenders === 0) {
  ok(`F-1：${liveRoutes.length} 个活跃路由均不再按 email 查用户`)
}

// Admin 授权必须走共享 helper
const adminAuthSrc = readSource('src/lib/admin/authorization.ts')
if (adminAuthSrc.includes("from '@/lib/auth-session'")) {
  ok('F-1：Admin 授权复用 auth-session 统一入口')
} else {
  fail('F-1：Admin 授权未复用 auth-session')
}

// 积分消耗路由必须走原子 RPC
const consumeSrc = readSource('src/app/api/user/credits/consume/route.ts')
if (consumeSrc.includes('consumeUserCredits(') && !/credits:\s*currentCredits\s*-/.test(consumeSrc)) {
  ok('F-1：积分消耗路由走原子 RPC（无 read-compute-write）')
} else {
  fail('F-1：积分消耗路由仍是非原子实现')
}

// ─────────────────────────────────────────────────────────────────────
// 9. signin_* 死代码清理（F-2）
// ─────────────────────────────────────────────────────────────────────

section('9. signin_* 遗留清理（F-2）')

if (!existsSync('src/lib/services/user.ts')) {
  ok('F-2：死代码 services/user.ts 已删除')
} else {
  fail('F-2：services/user.ts 仍存在（三个导出零引用）')
}

if (!existsSync('src/lib/types/user.ts')) {
  ok('F-2：死代码 types/user.ts 已删除')
} else {
  fail('F-2：types/user.ts 仍存在（仅被死文件引用）')
}

if (!/from ['"]@\/lib\/services\/user['"]/.test(authTs)) {
  ok('F-2：auth.ts 不再 import saveUser')
} else {
  fail('F-2：auth.ts 仍 import saveUser')
}

// signin_ip 不应在活跃路由被写入（历史恒为 'unknown'，是误导性数据）
let signinIpWriters = 0
for (const route of [
  'src/lib/auth.ts',
  'src/app/api/user/credits/route.ts',
  'src/app/api/user/ensure/route.ts',
]) {
  const src = readSource(route)
  if (/signin_ip\s*:/.test(src)) {
    fail(`F-2：${route} 仍在写入 signin_ip`)
    signinIpWriters += 1
  }
}
if (signinIpWriters === 0) ok('F-2：活跃路由不再写入无意义的 signin_ip')

// ─────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`)
console.log(`Auth 验证结果：${passed} 通过 / ${failed} 失败`)
console.log(`${'='.repeat(50)}`)

process.exit(failed === 0 ? 0 : 1)
