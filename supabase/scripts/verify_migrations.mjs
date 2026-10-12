#!/usr/bin/env node
/**
 * 迁移与积分原子性验证（在**真实 PostgreSQL** 上执行）
 *
 * 为什么需要它：
 *   本机没有 Supabase / PostgreSQL 实例，`npm run build` 与静态 SQL 校验都无法证明
 *   migration 真的能跑、`consume_credits()` 真的原子。本脚本用 PGlite
 *   （PostgreSQL 编译成 WASM）起一个真实数据库，把 `supabase/migrations/` 下
 *   **全部**迁移（当前 0000~0009）按序执行一遍，再跑积分与 Billing 的测试。
 *   新增迁移会被自动纳入（脚本动态 `readdirSync`），无需改本文件。
 *
 * 覆盖内容：
 *   1. 迁移能否按顺序执行（真实语法 + 依赖顺序 + 外键 + 约束）
 *   2. 迁移是否幂等（连续执行两遍）
 *   3. schema 断言（表 / 列 / 唯一索引 / RPC 函数）
 *   4. Credit 原子扣减测试（consume：含并发场景与原子谓词直证）
 *   5. Billing 闭环测试（grant 幂等 / 订单状态机 / Webhook 事件幂等 /
 *      checkout 幂等 / 订单权限隔离 / 整数金额 / 状态约束）
 *
 * 运行：
 *   node supabase/scripts/verify_migrations.mjs
 *
 * 依赖：`@electric-sql/pglite`（devDependency —— 仅测试用，不进生产包）。
 * 脚本会依次尝试：项目 node_modules → `PGLITE_MODULES` 环境变量指定的目录。
 * 若两处都没有，会打印安装指引并以退出码 2 结束（**不会**伪装成通过）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 关于并发测试的诚实说明
 * ─────────────────────────────────────────────────────────────────────
 * PGlite 是单后端、单连接（其 wire-protocol 服务也只接受一个客户端，
 * 第二个连接会被 reset），因此**无法复现真正的并行执行**。
 *
 * 因此 Test 5 用三种方式逼近，并在报告里明确区分「已验证」与「依赖语义推理」：
 *   5a  两个请求通过 Promise.all 同时发起 → 只能一个成功（验证不会重复扣减）
 *   5b  直接执行原子 UPDATE 两次 → 第二次影响 0 行（验证数据库层拒绝超扣）
 *   5c  断言函数体内确实使用 `WHERE ... credits >= p_amount` 的原子谓词
 *
 * 在真实 Supabase 上，两个并发事务会因 Postgres 行级锁串行化：
 * 第二个事务必须等第一个提交，之后**重新求值** WHERE 条件，因此余额不足者匹配不到行。
 * 这与 5b/5c 验证的机制是同一个。真正的并行验证需要在有 Supabase 实例时补做。
 *
 * 与 Supabase 的其它差异：
 *   · PGlite 未内置 `uuid-ossp` 扩展 → 执行前剥离该语句。
 *     本 schema 全部使用内置的 `gen_random_uuid()`，剥离不影响任何约束。
 *   · `auth.uid()` 由 Supabase 提供 → 脚本先建一个返回 NULL 的桩函数，
 *     以便 CREATE POLICY 能成功。RLS 行为不在本脚本验证范围内。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations')

let failures = 0
let checks = 0

const ok = (m) => {
  checks += 1
  console.log(`  ✅ ${m}`)
}
const fail = (m) => {
  checks += 1
  failures += 1
  console.log(`  ❌ ${m}`)
}
const info = (m) => console.log(`     ${m}`)

function assertEqual(actual, expected, label) {
  if (actual === expected) ok(`${label} = ${JSON.stringify(actual)}`)
  else fail(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function assertTrue(condition, label) {
  if (condition) ok(label)
  else fail(label)
}

// ─────────────────────────────────────────────────────────────────────
// 依赖解析
// ─────────────────────────────────────────────────────────────────────

const EXTERNAL_MODULE_DIRS = [
  process.env.PGLITE_MODULES,
  path.join(ROOT, 'node_modules'),
].filter(Boolean)

/** ESM 不认 NODE_PATH，因此用 createRequire 在外部目录做 Node 风格解析。 */
async function importFrom(specifier) {
  try {
    return await import(specifier)
  } catch {
    // 继续尝试外部目录
  }

  for (const base of EXTERNAL_MODULE_DIRS) {
    try {
      const requireFrom = createRequire(path.join(base, '__resolve__.js'))
      const resolved = requireFrom.resolve(specifier)
      return await import(pathToFileURL(resolved).href)
    } catch {
      // 换下一个目录
    }
  }

  throw new Error(`Cannot resolve ${specifier}`)
}

async function loadPGlite() {
  try {
    const mod = await importFrom('@electric-sql/pglite')
    return mod.PGlite
  } catch (error) {
    console.log('缺少验证依赖：', error.message)
    console.log('\n请先安装开发依赖：')
    console.log('  npm install')
    console.log('\n若依赖装在别处，可指定目录：')
    console.log('  PGLITE_MODULES=/path/to/node_modules node supabase/scripts/verify_migrations.mjs')
    process.exit(2)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 迁移执行
// ─────────────────────────────────────────────────────────────────────

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/**
 * PGlite 未内置 uuid-ossp 扩展，剥离该语句。
 * 本 schema 全部用内置 gen_random_uuid()，剥离不影响任何约束。
 */
function adaptForPGlite(sql) {
  let stripped = false
  const adapted = sql.replace(
    /^\s*CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\s*$/gim,
    () => {
      stripped = true
      return ''
    }
  )
  return { adapted, stripped }
}

async function applyMigrations(db, label) {
  const files = listMigrations()
  let strippedAny = false

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    const { adapted, stripped } = adaptForPGlite(sql)
    strippedAny = strippedAny || stripped

    try {
      await db.exec(adapted)
      ok(`${label}${file}`)
    } catch (error) {
      fail(`${label}${file} → ${String(error.message).split('\n')[0]}`)
      throw error
    }
  }

  return { files, strippedAny }
}

// ─────────────────────────────────────────────────────────────────────
// schema 断言
// ─────────────────────────────────────────────────────────────────────

async function assertSchema(db) {
  const { rows: tableRows } = await db.query(
    `select tablename from pg_tables where schemaname = 'public'`
  )
  const existing = tableRows.map((r) => r.tablename)

  for (const table of [
    'users',
    'orders',
    'credit_transactions',
    'subscriptions',
    'ai_tasks',
  ]) {
    if (existing.includes(table)) ok(`表存在：${table}`)
    else fail(`表缺失：${table}`)
  }

  const { rows: fnRows } = await db.query(
    `select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'consume_credits'`
  )
  if (fnRows.length === 1) ok('函数存在：consume_credits')
  else fail('函数缺失：consume_credits')

  const expectedColumns = {
    credit_transactions: [
      'idempotency_key',
      'status',
      'balance_before',
      'balance_after',
      'reference_type',
      'reference_id',
      'order_id',
    ],
    orders: [
      'provider_session_id',
      'provider_payment_id',
      'provider_refs',
      'expired_at',
      'fulfilled_at',
      'package_id',
      'idempotency_key',
      'amount_minor',
    ],
    subscriptions: ['provider_subscription_id', 'provider_refs'],
    webhook_events: ['provider', 'event_id', 'event_type', 'order_id', 'payload'],
    users: ['role'],
    admin_audit_logs: [
      'admin_user_id',
      'action',
      'target_user_id',
      'target_type',
      'target_id',
      'amount',
      'reason',
      'metadata',
    ],
  }

  for (const [table, columns] of Object.entries(expectedColumns)) {
    for (const column of columns) {
      const { rows } = await db.query(
        `select 1 from information_schema.columns
         where table_schema='public' and table_name=$1 and column_name=$2`,
        [table, column]
      )
      if (rows.length === 1) ok(`列存在：${table}.${column}`)
      else fail(`列缺失：${table}.${column}`)
    }
  }

  const { rows: fnRows2 } = await db.query(
    `select p.proname from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'grant_credits'`
  )
  if (fnRows2.length === 1) ok('函数存在：grant_credits')
  else fail('函数缺失：grant_credits')

  const { rows: idxRows } = await db.query(
    `select indexname from pg_indexes where schemaname='public'`
  )
  const indexes = idxRows.map((r) => r.indexname)

  for (const index of [
    'uniq_credit_transactions_idempotency',
    'uniq_credit_transactions_reference',
    'uniq_ai_tasks_idempotency',
    'uniq_orders_idempotency',
    'uniq_webhook_events_provider_event',
  ]) {
    if (indexes.includes(index)) ok(`唯一索引存在：${index}`)
    else fail(`唯一索引缺失：${index}`)
  }
}

// ─────────────────────────────────────────────────────────────────────
// 测试辅助
// ─────────────────────────────────────────────────────────────────────

async function createUser(db, email, credits) {
  const { rows } = await db.query(
    `insert into public.users (email, name, credits) values ($1, $2, $3) returning id`,
    [email, email.split('@')[0], credits]
  )
  return rows[0].id
}

async function getBalance(db, userId) {
  const { rows } = await db.query('select credits from public.users where id = $1', [
    userId,
  ])
  return rows[0].credits
}

async function countTransactions(db, userId) {
  const { rows } = await db.query(
    'select count(*)::int as n from public.credit_transactions where user_id = $1',
    [userId]
  )
  return rows[0].n
}

/** 调用 RPC，等价于 Supabase 的 `rpc('consume_credits', ...)`。 */
async function consume(db, userId, amount, idempotencyKey) {
  const { rows } = await db.query(
    `select * from public.consume_credits($1, $2, $3)`,
    [userId, amount, idempotencyKey ?? null]
  )
  return rows[0]
}

// ─────────────────────────────────────────────────────────────────────
// Credit 测试
// ─────────────────────────────────────────────────────────────────────

async function runCreditTests(db) {
  // ── Test 1：正常扣减 ──────────────────────────────────────────────
  console.log('\n▶ Test 1：正常扣减（100 - 30 = 70）')
  {
    const userId = await createUser(db, 't1@example.com', 100)
    const result = await consume(db, userId, 30, 't1-key')

    assertEqual(result.status, 'ok', 'status')
    assertEqual(result.balance, 70, 'balance')
    assertEqual(result.idempotent, false, 'idempotent')
    assertEqual(await getBalance(db, userId), 70, 'users.credits')
    assertEqual(await countTransactions(db, userId), 1, '流水条数')

    const { rows } = await db.query(
      `select amount, type, status, balance_before, balance_after
       from public.credit_transactions where user_id = $1`,
      [userId]
    )
    assertEqual(rows[0].amount, -30, '流水 amount（负数）')
    assertEqual(rows[0].type, 'consume', '流水 type')
    assertEqual(rows[0].status, 'COMPLETED', '流水 status')
    assertEqual(rows[0].balance_before, 100, '流水 balance_before')
    assertEqual(rows[0].balance_after, 70, '流水 balance_after')
  }

  // ── Test 2：余额不足 ──────────────────────────────────────────────
  console.log('\n▶ Test 2：余额不足（20 扣 30 → 失败，余额不变）')
  {
    const userId = await createUser(db, 't2@example.com', 20)
    const result = await consume(db, userId, 30, 't2-key')

    assertEqual(result.status, 'insufficient', 'status')
    assertEqual(result.balance, 20, 'balance')
    assertEqual(result.transaction_id, null, 'transaction_id')
    assertEqual(await getBalance(db, userId), 20, 'users.credits 未变')
    assertEqual(await countTransactions(db, userId), 0, '未产生流水')

    // 失败不能永久占用幂等键 —— 用户充值后应能用同一个键重试
    await db.query('update public.users set credits = 100 where id = $1', [userId])
    const retry = await consume(db, userId, 30, 't2-key')
    assertEqual(retry.status, 'ok', '充值后同键重试')
    assertEqual(retry.balance, 70, '重试后 balance')
  }

  // ── Test 3：重复请求 ──────────────────────────────────────────────
  console.log('\n▶ Test 3：重复请求（同幂等键 → 只扣一次）')
  {
    const userId = await createUser(db, 't3@example.com', 100)

    const first = await consume(db, userId, 30, 't3-key')
    assertEqual(first.status, 'ok', '第一次 status')
    assertEqual(first.balance, 70, '第一次 balance')

    const second = await consume(db, userId, 30, 't3-key')
    assertEqual(second.status, 'duplicate', '第二次 status')
    assertEqual(second.idempotent, true, '第二次 idempotent')
    assertEqual(second.balance, 70, '第二次 balance（未再扣）')
    assertEqual(second.transaction_id, first.transaction_id, '第二次返回同一条流水')

    assertEqual(await getBalance(db, userId), 70, 'users.credits')
    assertEqual(await countTransactions(db, userId), 1, '流水仍为 1 条')
  }

  // ── Test 4：不同幂等键 ────────────────────────────────────────────
  console.log('\n▶ Test 4：不同幂等键（100 - 30 - 20 = 50）')
  {
    const userId = await createUser(db, 't4@example.com', 100)

    const a = await consume(db, userId, 30, 't4-key-a')
    assertEqual(a.status, 'ok', 'A status')
    assertEqual(a.balance, 70, 'A balance')

    const b = await consume(db, userId, 20, 't4-key-b')
    assertEqual(b.status, 'ok', 'B status')
    assertEqual(b.balance, 50, 'B balance')

    assertEqual(await getBalance(db, userId), 50, 'users.credits')
    assertEqual(await countTransactions(db, userId), 2, '流水 2 条')
  }

  // ── Test 5：并发场景 ──────────────────────────────────────────────
  console.log('\n▶ Test 5a：两个请求同时发起（余额 100，各扣 80）')
  {
    const userId = await createUser(db, 't5@example.com', 100)

    // 不 await 第一个就发出第二个
    const [resultA, resultB] = await Promise.all([
      consume(db, userId, 80, 't5-key-a'),
      consume(db, userId, 80, 't5-key-b'),
    ])

    const statuses = [resultA.status, resultB.status].sort()
    assertEqual(statuses.join(','), 'insufficient,ok', '两个请求的结果')
    assertEqual(await getBalance(db, userId), 20, '最终余额')
    assertEqual(await countTransactions(db, userId), 1, '成功流水只有 1 条')
  }

  console.log('\n▶ Test 5b：原子谓词直证（数据库层拒绝超扣）')
  {
    const userId = await createUser(db, 't5b@example.com', 100)

    // 这正是函数内部使用的那条 SQL
    const atomicUpdate = `
      update public.users
      set credits = coalesce(credits, 0) - $2
      where id = $1 and coalesce(credits, 0) >= $2
      returning credits
    `

    const first = await db.query(atomicUpdate, [userId, 80])
    assertEqual(first.rows.length, 1, '第一次 UPDATE 影响行数')
    assertEqual(first.rows[0].credits, 20, '第一次 UPDATE 后余额')

    const second = await db.query(atomicUpdate, [userId, 80])
    assertEqual(second.rows.length, 0, '第二次 UPDATE 影响行数（余额不足 → 0 行）')
    assertEqual(await getBalance(db, userId), 20, '余额未被第二次扣减')

    // 对照：如果没有 WHERE 保护，第二次会把余额扣成负数
    const unguarded = await db.query(
      `update public.users set credits = coalesce(credits,0) - $2 where id = $1 returning credits`,
      [userId, 80]
    )
    assertEqual(unguarded.rows[0].credits, -60, '无 WHERE 保护时余额会变成负数（反证）')
    await db.query('update public.users set credits = 20 where id = $1', [userId])
  }

  console.log('\n▶ Test 5c：函数体确实使用原子谓词')
  {
    const { rows } = await db.query(
      `select pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname='consume_credits'`
    )
    const def = rows[0]?.def ?? ''

    assertTrue(
      /coalesce\(credits,\s*0\)\s*>=\s*p_amount/i.test(def),
      '函数体内存在 `credits >= p_amount` 谓词'
    )
    assertTrue(
      /update\s+users/i.test(def) && /returning\s+credits/i.test(def),
      '函数体使用 UPDATE ... RETURNING credits 一次性完成检查与扣减'
    )
    assertTrue(
      /on\s+conflict\s+do\s+nothing/i.test(def),
      '函数体使用 ON CONFLICT DO NOTHING 抢占幂等键'
    )
    assertTrue(
      /p_amount\s*<=\s*0|p_amount\s*IS\s+NULL/i.test(def),
      '函数体拒绝 amount <= 0'
    )
  }

  // ── Test 6：非法 amount ──────────────────────────────────────────
  console.log('\n▶ Test 6：非法 amount（防止用负数反向加积分）')
  {
    const userId = await createUser(db, 't6@example.com', 100)

    const negative = await consume(db, userId, -100, 't6-neg')
    assertEqual(negative.status, 'invalid_amount', 'amount = -100')
    assertEqual(await getBalance(db, userId), 100, '余额未被反向增加')

    const zero = await consume(db, userId, 0, 't6-zero')
    assertEqual(zero.status, 'invalid_amount', 'amount = 0')
    assertEqual(await getBalance(db, userId), 100, '余额未变')
  }

  // ── Test 7：无幂等键时不去重（对照） ──────────────────────────────
  console.log('\n▶ Test 7：不传幂等键 → 每次都真实扣减（对照组）')
  {
    const userId = await createUser(db, 't7@example.com', 100)

    const a = await consume(db, userId, 10, null)
    const b = await consume(db, userId, 10, null)

    assertEqual(a.status, 'ok', '第一次')
    assertEqual(b.status, 'ok', '第二次')
    assertEqual(await getBalance(db, userId), 80, '两次都扣了')
    assertEqual(await countTransactions(db, userId), 2, '流水 2 条')
  }

  // ── Test 8：用户不存在 ───────────────────────────────────────────
  console.log('\n▶ Test 8：用户不存在')
  {
    const result = await consume(db, '00000000-0000-0000-0000-000000000000', 10, 't8-key')
    assertEqual(result.status, 'user_not_found', 'status')
  }
}

// ─────────────────────────────────────────────────────────────────────
// Billing 测试（Phase 4）
// ─────────────────────────────────────────────────────────────────────

/** 建一张订单，模拟 BillingService.createCheckout 落库的那一步。 */
async function createOrder(db, userId, overrides = {}) {
  const order = {
    user_id: userId,
    order_number: `ORDER_TEST_${Math.random().toString(36).slice(2, 10)}`,
    amount: 15.0,
    amount_minor: 1500,
    currency: 'USD',
    status: 'pending',
    payment_provider: 'creem',
    product_type: 'credit_pack',
    product_id: 'creator',
    product_name: 'Creator Pack',
    customer_email: 'buyer@example.com',
    package_id: 'creator',
    idempotency_key: `auto:${userId}:creator:${Math.random()}`,
    provider_session_id: `sess_${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  }

  const columns = Object.keys(order)
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')

  const { rows } = await db.query(
    `insert into public.orders (${columns.join(', ')})
     values (${placeholders}) returning *`,
    Object.values(order)
  )

  return rows[0]
}

async function runBillingTests(db) {
  // ── B1：创建 checkout → pending 订单 ──────────────────────────────
  console.log('\n▶ B1：创建 checkout 产生 pending 订单')
  {
    const userId = await createUser(db, 'b1@example.com', 0)
    const order = await createOrder(db, userId)

    assertEqual(order.status, 'pending', 'order.status')
    assertEqual(Number(order.amount_minor), 1500, 'order.amount_minor')
    assertEqual(order.package_id, 'creator', 'order.package_id')
    assertTrue(!!order.idempotency_key, 'order.idempotency_key 已写入')
  }

  // ── B2：支付成功 → order = paid ───────────────────────────────────
  console.log('\n▶ B2：支付成功把订单推进到 paid')
  {
    const userId = await createUser(db, 'b2@example.com', 0)
    const order = await createOrder(db, userId)

    const { rows } = await db.query(
      `update public.orders
       set status = 'paid', paid_at = now()
       where id = $1 and status in ('pending', 'created')
       returning *`,
      [order.id]
    )

    assertEqual(rows.length, 1, '条件更新影响行数')
    assertEqual(rows[0].status, 'paid', 'order.status')
    assertTrue(!!rows[0].paid_at, 'order.paid_at 已写入')
  }

  // ── B3：重复推进 paid → 只成功一次 ────────────────────────────────
  console.log('\n▶ B3：重复的支付成功事件不能重复推进订单')
  {
    const userId = await createUser(db, 'b3@example.com', 0)
    const order = await createOrder(db, userId)

    const markPaid = `update public.orders
      set status = 'paid', paid_at = now()
      where id = $1 and status in ('pending', 'created') returning id`

    const first = await db.query(markPaid, [order.id])
    const second = await db.query(markPaid, [order.id])

    assertEqual(first.rows.length, 1, '第一次影响行数')
    assertEqual(second.rows.length, 0, '第二次影响行数（已 paid → 0 行）')
  }

  // ── B4：webhook_events 唯一约束保证事件幂等 ───────────────────────
  console.log('\n▶ B4：webhook_events 抢占（事件级幂等）')
  {
    const insert = `insert into public.webhook_events (provider, event_id, event_type)
      values ($1, $2, $3) on conflict do nothing returning id`

    const first = await db.query(insert, ['creem', 'evt_dup_1', 'checkout.completed'])
    const second = await db.query(insert, ['creem', 'evt_dup_1', 'checkout.completed'])
    const otherProvider = await db.query(insert, [
      'stripe',
      'evt_dup_1',
      'checkout.session.completed',
    ])

    assertEqual(first.rows.length, 1, '首次抢占成功')
    assertEqual(second.rows.length, 0, '重复事件抢占失败')
    assertEqual(otherProvider.rows.length, 1, '不同渠道的同名事件互不影响')
  }

  // ── B5：购买积分 → 余额增加 + 流水 ────────────────────────────────
  console.log('\n▶ B5：购买积分（余额 100 + 4000 = 4100）')
  {
    const userId = await createUser(db, 'b5@example.com', 100)
    const order = await createOrder(db, userId)

    const { rows } = await db.query(
      `select * from public.grant_credits($1, $2, $3, 'purchase', $4, 'order', $5, $6)`,
      [
        userId,
        4000,
        `credit_grant:${order.id}`,
        `Order ${order.order_number}`,
        order.order_number,
        order.id,
      ]
    )

    assertEqual(rows[0].status, 'ok', 'status')
    assertEqual(rows[0].balance, 4100, 'balance')
    assertEqual(await getBalance(db, userId), 4100, 'users.credits')

    const { rows: txRows } = await db.query(
      `select amount, type, status, balance_before, balance_after, order_id
       from public.credit_transactions where user_id = $1`,
      [userId]
    )

    assertEqual(txRows.length, 1, '流水条数')
    assertEqual(txRows[0].amount, 4000, '流水 amount（正数）')
    assertEqual(txRows[0].type, 'purchase', '流水 type')
    assertEqual(txRows[0].status, 'COMPLETED', '流水 status')
    assertEqual(txRows[0].balance_before, 100, '流水 balance_before')
    assertEqual(txRows[0].balance_after, 4100, '流水 balance_after')
    assertEqual(txRows[0].order_id, order.id, '流水 order_id 指向订单')
  }

  // ── B6：重复 Webhook → 积分只发一次 ───────────────────────────────
  console.log('\n▶ B6：同一订单重复发放 → 只发一次积分')
  {
    const userId = await createUser(db, 'b6@example.com', 0)
    const order = await createOrder(db, userId)
    const key = `credit_grant:${order.id}`

    const grant = `select * from public.grant_credits($1, $2, $3, 'purchase', null, 'order', $4, $5)`

    const first = await db.query(grant, [userId, 600, key, order.order_number, order.id])
    const second = await db.query(grant, [userId, 600, key, order.order_number, order.id])
    const third = await db.query(grant, [userId, 600, key, order.order_number, order.id])

    assertEqual(first.rows[0].status, 'ok', '第一次 status')
    assertEqual(second.rows[0].status, 'duplicate', '第二次 status')
    assertEqual(second.rows[0].idempotent, true, '第二次 idempotent')
    assertEqual(third.rows[0].status, 'duplicate', '第三次 status')

    assertEqual(await getBalance(db, userId), 600, '余额只加了一次')
    assertEqual(await countTransactions(db, userId), 1, '流水只有 1 条')
    assertEqual(
      second.rows[0].transaction_id,
      first.rows[0].transaction_id,
      '重复调用返回同一条流水'
    )
  }

  // ── B7：并发发放同一订单 → 只发一次 ───────────────────────────────
  console.log('\n▶ B7：同一订单的两个发放请求同时发起')
  {
    const userId = await createUser(db, 'b7@example.com', 0)
    const order = await createOrder(db, userId)
    const key = `credit_grant:${order.id}`

    const grant = `select * from public.grant_credits($1, $2, $3, 'purchase', null, 'order', $4, $5)`

    const [a, b] = await Promise.all([
      db.query(grant, [userId, 500, key, order.order_number, order.id]),
      db.query(grant, [userId, 500, key, order.order_number, order.id]),
    ])

    const statuses = [a.rows[0].status, b.rows[0].status].sort()
    assertEqual(statuses.join(','), 'duplicate,ok', '两个请求的结果')
    assertEqual(await getBalance(db, userId), 500, '余额只加了一次')
    assertEqual(await countTransactions(db, userId), 1, '流水只有 1 条')
  }

  // ── B8：checkout 幂等键防止重复下单 ───────────────────────────────
  console.log('\n▶ B8：同一幂等键不能创建第二张订单')
  {
    const userId = await createUser(db, 'b8@example.com', 0)
    const key = 'click-once-key'

    await createOrder(db, userId, { idempotency_key: key })

    let rejected = false

    try {
      await createOrder(db, userId, { idempotency_key: key })
    } catch (error) {
      rejected = /duplicate key|unique/i.test(String(error.message))
    }

    assertTrue(rejected, '第二次相同幂等键被唯一约束拒绝')

    const { rows } = await db.query(
      `select count(*)::int as n from public.orders where user_id = $1`,
      [userId]
    )
    assertEqual(rows[0].n, 1, '该用户只有 1 张订单')
  }

  // ── B9：权限 —— 只能查到自己的订单 ────────────────────────────────
  console.log('\n▶ B9：用户 A 查不到用户 B 的订单')
  {
    const userA = await createUser(db, 'a@example.com', 0)
    const userB = await createUser(db, 'b@example.com', 0)

    const orderA = await createOrder(db, userA)
    await createOrder(db, userB)
    await createOrder(db, userB)

    const { rows: aOrders } = await db.query(
      `select id from public.orders where user_id = $1`,
      [userA]
    )

    assertEqual(aOrders.length, 1, 'A 查到自己的订单数')
    assertEqual(aOrders[0].id, orderA.id, 'A 查到的是自己的那张')

    // 模拟 BillingService.getOrder：按 (id, user_id) 组合查
    const { rows: crossCheck } = await db.query(
      `select id from public.orders where id = $1 and user_id = $2`,
      [orderA.id, userB]
    )
    assertEqual(crossCheck.length, 0, 'B 用 A 的订单 id 查不到任何东西')
  }

  // ── B10：金额为整数最小单位，无浮点误差 ───────────────────────────
  console.log('\n▶ B10：金额使用整数最小单位')
  {
    const userId = await createUser(db, 'b10@example.com', 0)

    // $19.99 —— 浮点直接相乘会得到 1998.9999999999998
    assertTrue(19.99 * 100 !== 1999, '浮点乘法确实会失真（反证）')

    const order = await createOrder(db, userId, {
      amount: 19.99,
      amount_minor: 1999,
    })

    assertEqual(Number(order.amount_minor), 1999, 'amount_minor 精确')
    assertEqual(Number(order.amount), 19.99, 'amount（展示字段）')
  }

  // ── B11：订单状态词表受约束 ───────────────────────────────────────
  console.log('\n▶ B11：非法订单状态被 CHECK 约束拒绝')
  {
    const userId = await createUser(db, 'b11@example.com', 0)

    let rejected = false

    try {
      await createOrder(db, userId, { status: 'not_a_status' })
    } catch (error) {
      rejected = /check constraint|violates check/i.test(String(error.message))
    }

    assertTrue(rejected, '非法状态被拒绝')

    // 目标词表都要能写入
    for (const status of ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired']) {
      const order = await createOrder(db, userId, { status })
      assertEqual(order.status, status, `状态 ${status} 可写入`)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Admin 测试
// ─────────────────────────────────────────────────────────────────────

async function runAdminTests(db) {
  // ── A1：role 默认值为 user ────────────────────────────────────────
  console.log('\n▶ A1：新用户 role 默认为 user')
  {
    const userId = await createUser(db, 'a1@example.com', 0)
    const { rows } = await db.query('select role from public.users where id = $1', [userId])
    assertEqual(rows[0].role, 'user', 'role 默认值')
  }

  // ── A2：非法 role 被 CHECK 拒绝 ───────────────────────────────────
  console.log('\n▶ A2：非法 role 被 CHECK 约束拒绝')
  {
    const userId = await createUser(db, 'a2@example.com', 0)
    let rejected = false

    try {
      await db.query('update public.users set role = $1 where id = $2', [
        'super_admin',
        userId,
      ])
    } catch (error) {
      rejected = /check constraint|violates check/i.test(String(error.message))
    }

    assertTrue(rejected, '非法 role 被拒绝')

    for (const role of ['user', 'admin']) {
      await db.query('update public.users set role = $1 where id = $2', [role, userId])
      const { rows } = await db.query('select role from public.users where id = $1', [userId])
      assertEqual(rows[0].role, role, `role ${role} 可写入`)
    }
  }

  // ── A3：admin_audit_logs 记录「谁/对谁/做了什么/为什么」 ────────────
  console.log('\n▶ A3：admin_audit_logs 写入与读取')
  {
    const adminId = await createUser(db, 'admin-a3@example.com', 0)
    const targetId = await createUser(db, 'target-a3@example.com', 0)

    await db.query(`update public.users set role = 'admin' where id = $1`, [adminId])

    const { rows } = await db.query(
      `insert into public.admin_audit_logs
         (admin_user_id, action, target_user_id, target_type, target_id, amount, reason, metadata)
       values ($1::uuid, 'credit_grant', $2::uuid, 'user', $2::text, $3::int, $4, $5)
       returning *`,
      [
        adminId,
        targetId,
        100,
        'Customer support compensation',
        JSON.stringify({ source: 'admin_console' }),
      ]
    )

    const log = rows[0]
    assertEqual(log.action, 'credit_grant', 'action')
    assertEqual(log.admin_user_id, adminId, 'admin_user_id')
    assertEqual(log.target_user_id, targetId, 'target_user_id')
    assertEqual(Number(log.amount), 100, 'amount')
    assertEqual(log.reason, 'Customer support compensation', 'reason')
    assertTrue(log.created_at != null, 'created_at 自动填充')
  }

  // ── A4：Admin 积分发放走原子 RPC（type = adjustment） ──────────────
  console.log('\n▶ A4：Admin 积分发放（grant_credits + adjustment）')
  {
    const userId = await createUser(db, 'a4@example.com', 0)

    const { rows } = await db.query(
      `select * from public.grant_credits($1, $2, $3, 'adjustment', $4, 'admin_adjustment', $5, null)`,
      [userId, 250, 'a4-idem-key', 'Support compensation', 'admin_ref_1']
    )

    assertEqual(rows[0].status, 'ok', 'status')
    assertEqual(rows[0].balance, 250, 'balance')
    assertEqual(await getBalance(db, userId), 250, 'users.credits 同步')

    const { rows: txRows } = await db.query(
      `select type, amount, balance_after from public.credit_transactions where user_id = $1`,
      [userId]
    )
    assertEqual(txRows.length, 1, '流水条数')
    assertEqual(txRows[0].type, 'adjustment', '流水 type')
    assertEqual(Number(txRows[0].amount), 250, '流水 amount')
    assertEqual(Number(txRows[0].balance_after), 250, '流水 balance_after')
  }

  // ── A5：Admin 发放金额必须为正 ────────────────────────────────────
  console.log('\n▶ A5：非法金额被 RPC 拒绝')
  {
    const userId = await createUser(db, 'a5@example.com', 50)

    const { rows } = await db.query(
      `select * from public.grant_credits($1, $2, null, 'adjustment', null, 'admin_adjustment', null, null)`,
      [userId, -100]
    )

    assertTrue(rows[0].status !== 'ok', '负数金额被拒绝')
    assertEqual(await getBalance(db, userId), 50, '余额未变化')
  }

  // ── A6：不存在的目标用户被拒绝 ────────────────────────────────────
  console.log('\n▶ A6：不存在用户发放被拒绝')
  {
    const { rows } = await db.query(
      `select * from public.grant_credits($1, $2, null, 'adjustment', null, 'admin_adjustment', null, null)`,
      ['00000000-0000-0000-0000-000000000000', 100]
    )

    assertTrue(rows[0].status !== 'ok', '不存在的用户被拒绝')
  }

  // ── A7：审计日志 admin_user_id 外键 ───────────────────────────────
  console.log('\n▶ A7：审计日志外键约束')
  {
    let rejected = false

    try {
      await db.query(
        `insert into public.admin_audit_logs (admin_user_id, action)
         values ('00000000-0000-0000-0000-000000000000', 'credit_grant')`
      )
    } catch (error) {
      rejected = /foreign key|violates foreign/i.test(String(error.message))
    }

    assertTrue(rejected, '不存在的 admin_user_id 被外键拒绝')
  }

  // ── A8：B-10 退款幂等（同一幂等键只退一次）────────────────────────
  console.log('\n▶ A8：退款幂等（B-10）')
  {
    const userId = await createUser(db, 'a8@example.com', 0)

    // 模拟：先扣 15，再退款 15（同一幂等键调用两次）
    const { rows: consumeRows } = await db.query(
      `select * from public.consume_credits($1, $2, $3)`,
      [userId, 15, 'a8-consume-key']
    )
    assertTrue(consumeRows[0].status !== 'ok', '余额不足时扣减被拒绝')

    // 先给 100，再扣 15
    await db.query(
      `select * from public.grant_credits($1, $2, null, 'bonus', null, null, null, null)`,
      [userId, 100]
    )
    await db.query(`select * from public.consume_credits($1, $2, $3)`, [
      userId,
      15,
      'a8-consume-key-2',
    ])
    assertEqual(await getBalance(db, userId), 85, '扣减后余额')

    // 同一退款幂等键调用两次
    const refundKey = 'a8-refund-key'

    const { rows: refund1 } = await db.query(
      `select * from public.grant_credits($1, $2, $3, 'refund', $4, 'ai_generation_refund', $3, null)`,
      [userId, 15, refundKey, 'generation failed']
    )
    assertEqual(refund1[0].status, 'ok', '第一次退款成功')
    assertEqual(Number(refund1[0].balance), 100, '退款后余额')

    const { rows: refund2 } = await db.query(
      `select * from public.grant_credits($1, $2, $3, 'refund', $4, 'ai_generation_refund', $3, null)`,
      [userId, 15, refundKey, 'generation failed']
    )
    assertEqual(refund2[0].status, 'duplicate', '第二次退款被幂等拦截')
    assertEqual(await getBalance(db, userId), 100, '余额只加了一次')

    const { rows: txRows } = await db.query(
      `select count(*)::int as n from public.credit_transactions
       where user_id = $1 and type = 'refund'`,
      [userId]
    )
    assertEqual(txRows[0].n, 1, '退款流水只有 1 条')
  }
}

// ─────────────────────────────────────────────────────────────────────
// Workflow / Async Task Engine 测试（Phase 7）
// ─────────────────────────────────────────────────────────────────────
async function runWorkflowTests(db) {
  // ── W1：ai_tasks 约束（0009 新增）────────────────────────────────
  console.log('\n▶ W1：ai_tasks 约束（退款不超过已扣 / 重试不超过上限）')
  {
    const userId = await createUser(db, 'w1@example.com', 0)
    const { rows: t } = await db.query(
      `insert into public.ai_tasks (user_id, model, provider, status, credits_used)
       values ($1, 'm', 'kie', 'completed', 10) returning id`,
      [userId]
    )
    const id = t[0].id

    let refundRejected = false
    try {
      await db.query(`update public.ai_tasks set credits_refunded = 20 where id = $1`, [id])
    } catch (error) {
      refundRejected = /credits_refunded_check|check/.test(String(error.message))
    }
    assertTrue(refundRejected, '退款超过已扣（20 > 10）被 CHECK 拒绝')

    let retryRejected = false
    try {
      await db.query(`update public.ai_tasks set retry_count = 99 where id = $1`, [id])
    } catch (error) {
      retryRejected = /retry_count_check|check/.test(String(error.message))
    }
    assertTrue(retryRejected, 'retry_count 超过 max_retries 被 CHECK 拒绝')
  }

  // ── W2：重复 webhook 幂等（规格 §15 / §31 #7 #12）─────────────────
  console.log('\n▶ W2：重复 webhook 只推进一次（结果不重复写）')
  {
    const userId = await createUser(db, 'w2@example.com', 0)
    const { rows: tw } = await db.query(
      `insert into public.ai_tasks (user_id, model, provider, status, provider_task_id)
       values ($1, 'm', 'kie', 'processing', 'wk_dup_1') returning id`,
      [userId]
    )

    // 模拟 Webhook 处理器：按 (provider, provider_task_id) 找到任务后，
    // 用 `status <> 'completed'` 做幂等护栏再推进。
    const markComplete = `update public.ai_tasks
      set status = 'completed', completed_at = now(),
          output_metadata = '{"assets":[{"type":"image","url":"u"}]}'::jsonb
      where id = $1 and status <> 'completed' returning id`

    const first = await db.query(markComplete, [tw[0].id])
    const second = await db.query(markComplete, [tw[0].id])

    assertEqual(first.rows.length, 1, '第一次 webhook 推进成功')
    assertEqual(second.rows.length, 0, '第二次 webhook 幂等（影响 0 行）')

    const { rows: after } = await db.query(
      `select output_metadata from public.ai_tasks where id = $1`,
      [tw[0].id]
    )
    assertTrue(
      Array.isArray(after[0].output_metadata?.assets) &&
        after[0].output_metadata.assets.length === 1,
      '结果只写入一次（未被重复覆盖）'
    )
  }

  // ── W3：用户隔离（规格 §27 / §31 #10）────────────────────────────
  console.log('\n▶ W3：任务查询按 user_id 隔离')
  {
    const u1 = await createUser(db, 'w3a@example.com', 0)
    const u2 = await createUser(db, 'w3b@example.com', 0)
    await db.query(
      `insert into public.ai_tasks (user_id, model, provider, status) values ($1, 'm', 'kie', 'pending')`,
      [u1]
    )
    await db.query(
      `insert into public.ai_tasks (user_id, model, provider, status) values ($1, 'm', 'kie', 'pending')`,
      [u2]
    )

    const { rows: own } = await db.query(
      `select * from public.ai_tasks where user_id = $1`,
      [u1]
    )
    assertEqual(own.length, 1, '按 user_id 查询只返回自己的 1 条（看不到别人的）')
  }

  // ── W4：任务创建幂等键（规格 §19）────────────────────────────────
  console.log('\n▶ W4：相同 idempotency_key 不建第二条任务')
  {
    const u4 = await createUser(db, 'w4@example.com', 0)
    const ins = `insert into public.ai_tasks (user_id, model, provider, status, idempotency_key)
      values ($1, 'm', 'kie', 'pending', $2) on conflict do nothing returning id`

    const first = await db.query(ins, [u4, 'w4-key'])
    const second = await db.query(ins, [u4, 'w4-key'])

    assertEqual(first.rows.length, 1, '第一次建任务成功')
    assertEqual(second.rows.length, 0, '相同幂等键不建第二条（uniq_ai_tasks_idempotency）')
  }

  // 积分退款幂等（规格 §18 / §31 #9）由 A8 / B6 覆盖：
  //   同一 idempotency_key 调用 grant_credits(type='refund') 只产生 1 条流水、余额只回加一次。
  info('积分退款幂等见 Test 6 A8 / Test 5 B6（grant_credits 幂等键）。')
}

// ─────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const PGlite = await loadPGlite()
  const db = await new PGlite()

  // Supabase 平台桩：CREATE POLICY 需要 auth.uid() 存在
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  `)

  console.log('▶ 1. 按顺序执行迁移（真实 PostgreSQL）')
  const { files, strippedAny } = await applyMigrations(db, '')
  info(`共 ${files.length} 个迁移文件`)
  if (strippedAny) {
    info('已适配 PGlite：剥离 CREATE EXTENSION "uuid-ossp"（本 schema 用内置 gen_random_uuid）')
  }

  console.log('\n▶ 2. 重复执行迁移（验证幂等）')
  await applyMigrations(db, '[重跑] ')

  console.log('\n▶ 3. schema 断言')
  await assertSchema(db)

  console.log('\n▶ 4. Credit 原子扣减测试')
  await runCreditTests(db)

  console.log('\n▶ 5. Billing 闭环测试')
  await runBillingTests(db)

  console.log('\n▶ 6. Admin 基础测试')
  await runAdminTests(db)

  console.log('\n▶ 7. Workflow / Async Task Engine 测试')
  await runWorkflowTests(db)

  await db.close()

  console.log(
    `\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}（共 ${checks} 项检查）`
  )
  console.log(
    '\n⚠️  并发说明：PGlite 是单后端单连接，无法复现真正的并行执行。\n' +
      '   Test 5a 验证「两个请求同时发起时不会重复扣减」，\n' +
      '   Test 5b/5c 直接验证数据库层的原子谓词（第二次 UPDATE 影响 0 行）。\n' +
      '   真实 Supabase 上由 Postgres 行级锁保证同一语义，' +
      '真正的并行验证需在有 Supabase 实例时补做。'
  )

  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\n❌ 验证异常终止：${error?.message || error}`)
  process.exit(1)
})
