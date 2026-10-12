/**
 * Admin 基础设施静态验证（无需数据库 / 无需运行服务）
 *
 * 覆盖：
 *   1. requireAdmin / getAdminContext 存在
 *   2. 授权依据是 users.role（不是 email）
 *   3. 所有 /api/admin/* 路由都经过 Admin 边界
 *   4. Admin 页面不直接访问数据库
 *   5. Admin 积分调整走 Credit 原子 RPC
 *   6. 不信任客户端传入的 role / userId
 *   7. ADMIN_EMAILS 仅为 bootstrap（不是最终权限判断）
 *   8. service_role key 不泄漏到客户端
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

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

function read(path: string): string {
  return readFileSync(path, 'utf-8')
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full.replace(/\\/g, '/'))
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// 1. Authorization 模块
// ─────────────────────────────────────────────────────────────────────

section('1. Admin Authorization 模块')

const authPath = 'src/lib/admin/authorization.ts'
if (existsSync(authPath)) {
  ok('authorization.ts 存在')
} else {
  fail('authorization.ts 缺失')
}

const authSrc = existsSync(authPath) ? read(authPath) : ''

if (authSrc.includes('export async function requireAdmin')) ok('requireAdmin 已导出')
else fail('requireAdmin 未导出')

if (authSrc.includes('export async function getAdminContext')) ok('getAdminContext 已导出')
else fail('getAdminContext 未导出')

if (authSrc.includes("user.role !== 'admin'")) ok('授权依据为 users.role')
else fail('授权未使用 users.role')

if (authSrc.includes('401') && authSrc.includes('403')) ok('区分 401 与 403')
else fail('未区分 401 / 403')

// ADMIN_EMAILS 只能是 bootstrap
if (authSrc.includes('getBootstrapEmails') && authSrc.includes("role: 'admin'")) {
  ok('ADMIN_EMAILS 作为 bootstrap 白名单（命中即写 role）')
} else {
  fail('ADMIN_EMAILS 未实现为 bootstrap 机制')
}

// ─────────────────────────────────────────────────────────────────────
// 2. Admin API 边界
// ─────────────────────────────────────────────────────────────────────

section('2. Admin API 边界')

const adminApiFiles = walk('src/app/api/admin').filter((f) => f.endsWith('/route.ts'))

if (adminApiFiles.length === 0) {
  fail('未找到 /api/admin/* 路由')
} else {
  ok(`找到 ${adminApiFiles.length} 个 /api/admin/* 路由`)
}

for (const file of adminApiFiles) {
  const src = read(file)
  const usesBoundary =
    src.includes('withAdmin(') || src.includes('getAdminContext(')

  if (usesBoundary) ok(`${file} 经过 Admin 边界`)
  else fail(`${file} 未经过 Admin 边界`)
}

// 没有任何 admin route 直接用 ADMIN_EMAILS 做最终判断
const routesUsingEmailWhitelist = adminApiFiles.filter((f) =>
  read(f).includes('ADMIN_EMAILS')
)

if (routesUsingEmailWhitelist.length === 0) {
  ok('没有 admin route 直接使用 ADMIN_EMAILS')
} else {
  fail('仍有 route 直接使用 ADMIN_EMAILS', routesUsingEmailWhitelist.join(', '))
}

// ─────────────────────────────────────────────────────────────────────
// 3. Admin 页面不直接访问数据库
// ─────────────────────────────────────────────────────────────────────

section('3. Admin 页面不直接访问数据库')

const adminPages = walk('src/app/admin').filter((f) => /\.(tsx|ts)$/.test(f))

if (adminPages.length === 0) {
  fail('未找到 /admin 页面')
} else {
  ok(`找到 ${adminPages.length} 个 /admin 页面文件`)
}

const forbidden = [
  'supabase.from(',
  'createAdminClient(',
  'getDb(',
  'prisma.',
  'SERVICE_ROLE_KEY',
]

let pageViolations = 0
for (const file of adminPages) {
  const src = read(file)
  for (const pattern of forbidden) {
    if (src.includes(pattern)) {
      fail(`${file} 直接访问数据库：${pattern}`)
      pageViolations++
    }
  }
}
if (pageViolations === 0) ok('所有 /admin 页面均无直接数据库访问')

// ─────────────────────────────────────────────────────────────────────
// 4. Admin 积分调整走原子 RPC
// ─────────────────────────────────────────────────────────────────────

section('4. Admin 积分调整走 Credit 原子 RPC')

const servicePath = 'src/lib/admin/service.ts'
const serviceSrc = existsSync(servicePath) ? read(servicePath) : ''

if (serviceSrc.includes('creditRepo.grantCredits(')) {
  ok('Admin 发放调用 credit.grantCredits()（原子 RPC）')
} else {
  fail('Admin 发放未调用 credit.grantCredits()')
}

if (serviceSrc.includes('adjustBalance')) {
  fail('Admin 发放使用了非原子的 adjustBalance()')
} else {
  ok('Admin 发放未使用非原子的 adjustBalance()')
}

// 不得直接 UPDATE users.credits
if (/credits:\s*\{\s*increment/.test(serviceSrc)) {
  fail('Admin service 直接 increment users.credits')
} else {
  ok('Admin service 未直接 increment users.credits')
}

// 审计
if (serviceSrc.includes('auditRepo.create(')) ok('Admin 发放写审计日志')
else fail('Admin 发放未写审计日志')

// ─────────────────────────────────────────────────────────────────────
// 5. 不信任客户端输入
// ─────────────────────────────────────────────────────────────────────

section('5. 不信任客户端输入')

let spoofViolations = 0
for (const file of adminApiFiles) {
  const src = read(file)
  if (/body\.(role|isAdmin|userId)/.test(src) && file.includes('users')) {
    fail(`${file} 读取了 body.role / body.isAdmin / body.userId`)
    spoofViolations++
  }
}
if (spoofViolations === 0) ok('Admin API 不读取客户端传入的 role / userId')

// 积分路由必须用 URL 参数作为目标用户
const creditRoute = 'src/app/api/admin/users/[id]/credits/route.ts'
if (existsSync(creditRoute)) {
  const src = read(creditRoute)
  if (src.includes('params.id') && src.includes('admin.id')) {
    ok('积分路由：目标用户来自 URL params，操作者来自 session')
  } else {
    fail('积分路由未正确区分目标用户与操作者')
  }
} else {
  fail('积分路由缺失')
}

// ─────────────────────────────────────────────────────────────────────
// 6. service_role 不泄漏到客户端
// ─────────────────────────────────────────────────────────────────────

section('6. service_role 不泄漏到客户端')

// 只匹配真正的 env 访问（process.env.NEXT_PUBLIC_*SERVICE_ROLE*），
// 不匹配错误提示字符串里的文字提及。
let leak = false
for (const file of walk('src').filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
  const src = read(file)
  if (/process\.env\.NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(src)) {
    fail(`${file} 把 service role 暴露为 NEXT_PUBLIC`)
    leak = true
  }
}
if (!leak) ok('service role key 未暴露为 NEXT_PUBLIC')

// ─────────────────────────────────────────────────────────────────────
// 7. Migration
// ─────────────────────────────────────────────────────────────────────

section('7. Migration')

if (existsSync('supabase/migrations/0007_user_role.sql')) ok('迁移 0007（user role）存在')
else fail('迁移 0007 缺失')

if (existsSync('supabase/migrations/0008_admin_audit_logs.sql'))
  ok('迁移 0008（admin_audit_logs）存在')
else fail('迁移 0008 缺失')

// ─────────────────────────────────────────────────────────────────────
// 8. 列表搜索能力（F6.5-7）
// ─────────────────────────────────────────────────────────────────────

section('8. 列表搜索能力（F6.5-7）')

{
  const orderRepo = read('src/lib/db/repositories/order.ts')
  if (orderRepo.includes('search?: string') && orderRepo.includes('customer_email.ilike')) {
    ok('F6.5-7：订单支持 email / 订单号模糊搜索')
  } else {
    fail('F6.5-7：订单仓库缺少 search 过滤')
  }

  const subRepo = read('src/lib/db/repositories/subscription.ts')
  if (subRepo.includes('userIds?: string[]') && subRepo.includes("query.in('user_id'")) {
    ok('F6.5-7：订阅支持 userIds 过滤')
  } else {
    fail('F6.5-7：订阅仓库缺少 userIds 过滤')
  }

  // 空数组必须短路，不能退化成「查全部」
  if (/userIds && options\.userIds\.length === 0/.test(subRepo)) {
    ok('F6.5-7：订阅空 userIds 短路（不返回全部）')
  } else {
    fail('F6.5-7：订阅空 userIds 未短路，会返回全部')
  }

  const service = read('src/lib/admin/service.ts')
  if (service.includes('resolveUserIdsBySearch')) {
    ok('F6.5-7：AdminService 按 email 解析用户 id 再查订阅')
  } else {
    fail('F6.5-7：AdminService 未实现 email → userIds 解析')
  }

  if (/search:\s*params\.search/.test(service)) {
    ok('F6.5-7：AdminService 把 search 透传到订单查询')
  } else {
    fail('F6.5-7：AdminService 未把 search 透传到订单查询')
  }

  // 页面必须有搜索输入框
  for (const page of [
    'src/app/admin/orders/page.tsx',
    'src/app/admin/subscriptions/page.tsx',
    'src/app/admin/credits/page.tsx',
  ]) {
    const src = read(page)
    if (src.includes("name: 'search'")) ok(`F6.5-7：${page} 有搜索输入框`)
    else fail(`F6.5-7：${page} 缺少搜索输入框`)
  }

  // 积分流水仓库也支持 userIds
  const creditRepo = read('src/lib/db/repositories/credit.ts')
  if (creditRepo.includes('userIds?: string[]')) {
    ok('F6.5-7：积分流水支持 userIds 过滤')
  } else {
    fail('F6.5-7：积分流水仓库缺少 userIds 过滤')
  }
}

// ─────────────────────────────────────────────────────────────────────
// 9. 审计日志页（F6.5-2）
// ─────────────────────────────────────────────────────────────────────

section('9. 审计日志页（F6.5-2）')

{
  if (existsSync('src/app/admin/audit-logs/page.tsx')) {
    ok('F6.5-2：审计日志页面存在')
  } else {
    fail('F6.5-2：审计日志页面缺失')
  }

  if (existsSync('src/app/api/admin/audit-logs/route.ts')) {
    ok('F6.5-2：审计日志 API 存在')
  } else {
    fail('F6.5-2：审计日志 API 缺失')
  }

  const layout = read('src/app/admin/layout.tsx')
  if (layout.includes('/admin/audit-logs')) {
    ok('F6.5-2：侧边栏含 Audit Logs 入口')
  } else {
    fail('F6.5-2：侧边栏缺少 Audit Logs 入口')
  }

  const page = read('src/app/admin/audit-logs/page.tsx')
  if (!/supabase\.from\(|createAdminClient\(|prisma\./.test(page)) {
    ok('F6.5-2：审计日志页面不直接访问数据库')
  } else {
    fail('F6.5-2：审计日志页面直接访问了数据库')
  }
}

// ─────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`)
console.log(`Admin 验证结果：${passed} 通过 / ${failed} 失败`)
console.log(`${'='.repeat(50)}`)

process.exit(failed === 0 ? 0 : 1)
