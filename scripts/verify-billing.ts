#!/usr/bin/env node
/**
 * Billing 配置层验证（**通用机制**，纯逻辑，不需要数据库）
 *
 * Phase 9.8.2-D 的分工：本脚本里**一个产品字面量都没有**。套餐清单、模型成本、
 * 渠道商品 id、定价文案全部取自「当前绑定的 bundle」与内容装配点
 * （`@/app/product-runtime` / `@/app/product-content`），所以换成第二个产品时
 * 这份验证不用改一行就仍在检查**那个产品**的计费链路。
 *
 * 「某套餐卖 $15.00 / 4000 积分」「creem 商品 id 叫什么」这类**具体数字**是产品
 * 数据，登记在 `scripts/verify-flux-kontext.ts`（`@product-scope`）。把它们留在
 * 这里 = 换产品后仍在断言上一个产品的价目表，那种绿色没有信息量。
 *
 * 覆盖用户约束 §10 / §20 / §21 的三条硬要求：
 *   1. 价格只来自服务端配置 —— 客户端传什么都不影响
 *   2. 金额使用整数最小单位，不出现浮点误差
 *   3. 旧调用方（productId + billingCycle）仍能解析到套餐
 *
 * 另含四条架构守卫（读源码，比运行时测试更直接）：
 *   · checkout 路由与服务层不读请求体的 price / amount / credits；
 *   · 单次成本只有一处真相（模型目录），Core 与组件层都不得再各写一份；
 *   · 退款走 Credit 原子 RPC；
 *   · 地区列表不把中国香港/澳门/台湾当作独立国家。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-billing.ts
 */

import '@/app/product-runtime'

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { productContent } from '@/app/product-content'
import { getModel } from '@/lib/ai/models'
import { getProductConfig } from '@/config/product'

import {
  findBillingPackage,
  formatPriceMinor,
  getBillingPackage,
  getFreePlan,
  getProviderProductId,
  listBillingPackages,
  toMinorUnits,
} from '@/config/billing'

let failures = 0
let checks = 0

const ok = (m: string) => {
  checks += 1
  console.log(`  ✅ ${m}`)
}
const fail = (m: string) => {
  checks += 1
  failures += 1
  console.log(`  ❌ ${m}`)
}
const info = (m: string) => console.log(`     ${m}`)

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(`${label} = ${JSON.stringify(actual)}`)
  else fail(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function assertTrue(condition: boolean, label: string) {
  if (condition) ok(label)
  else fail(label)
}

function assertThrows(fn: () => unknown, label: string, contains?: string) {
  try {
    fn()
    fail(`${label}：期望抛错但没有`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (contains && !message.includes(contains)) {
      fail(`${label}：错误信息不含 "${contains}"，实际：${message}`)
    } else {
      ok(`${label} → 正确抛错`)
    }
  }
}

function stripCommentLines(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

/** 读仓库相对路径的源码（不存在返回 null，便于「主路径消失了」也要如实报错）。 */
function readRepo(rel: string): string | null {
  const absolute = path.resolve(process.cwd(), rel)
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null
}

const rel = (absolute: string) => path.relative(process.cwd(), absolute).replace(/\\/g, '/')

function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) listSourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function main() {
  const bundle = getProductConfig()
  const packages = Object.values(bundle.billingPackages)

  console.log(`Billing 配置层验证（当前产品：${bundle.productId}）\n`)

  // ── 1. 套餐定义完整性 ─────────────────────────────────────────────
  console.log('▶ 1. 套餐定义（清单来自绑定的 bundle，不是脚本里写死的数量）')
  {
    const all = listBillingPackages()
    assertTrue(all.length > 0, `共 ${all.length} 个可售套餐`)

    for (const pkg of all) {
      assertTrue(
        Number.isInteger(pkg.priceMinor) && pkg.priceMinor > 0,
        `${pkg.id}: priceMinor 是正整数（${pkg.priceMinor}）`
      )
      assertTrue(
        Number.isInteger(pkg.credits) && pkg.credits > 0,
        `${pkg.id}: credits 是正整数（${pkg.credits}）`
      )
      assertEqual(pkg.currency, 'USD', `${pkg.id}: currency`)

      // 两类套餐的形状约定：checkout 与账本都按这个分支走
      if (pkg.type === 'subscription') {
        assertTrue(!!pkg.planId && !!pkg.billingCycle, `${pkg.id}: 订阅带 planId + billingCycle`)
      } else {
        assertTrue(!pkg.planId && !pkg.billingCycle, `${pkg.id}: 积分包不带 planId / billingCycle`)
      }
    }

    const creditPacks = listBillingPackages('credit_pack')
    const subscriptions = listBillingPackages('subscription')
    info(`类型分布：${creditPacks.length} 个积分包 / ${subscriptions.length} 个订阅包`)
    assertEqual(
      creditPacks.length + subscriptions.length,
      all.length,
      '按类型过滤等于全量（type 只有两种取值）'
    )
  }

  // ── 2. 按 id 取套餐 ───────────────────────────────────────────────
  console.log('\n▶ 2. 按 packageId 取套餐')
  {
    let diverged = 0
    for (const pkg of packages) {
      // 必须返回**同一个对象**：查询层若另建一份表，改价就只改了一半。
      if (getBillingPackage(pkg.id) !== pkg) {
        fail(`getBillingPackage("${pkg.id}") 返回的不是 bundle 里的那个对象`)
        diverged += 1
      }
    }
    assertTrue(
      diverged === 0,
      `${packages.length} 个套餐经查询层读到的都是 bundle 里的同一份数据`
    )

    assertThrows(() => getBillingPackage('does-not-exist'), '未知 packageId', 'Unknown billing package')
    assertThrows(() => getBillingPackage(''), '空 packageId 不回退到默认套餐', 'Unknown billing package')
  }

  // ── 3. 旧调用方兼容（productId + billingCycle） ───────────────────
  console.log('\n▶ 3. 旧调用方兼容')
  {
    for (const pkg of packages.filter((p) => p.type === 'credit_pack')) {
      const found = findBillingPackage(pkg.productId)
      // 积分包没有周期概念：兼容入口必须先命中它（老 checkout 调用方的语义）。
      assertTrue(
        !!found && found.type === 'credit_pack',
        `按 productId "${pkg.productId}" 找积分包 → ${found?.id ?? 'null'}`
      )
    }

    for (const pkg of packages.filter((p) => p.type === 'subscription')) {
      const found = findBillingPackage(pkg.productId, pkg.billingCycle)
      assertEqual(
        found?.billingCycle,
        pkg.billingCycle,
        `productId "${pkg.productId}" + ${pkg.billingCycle} 解析到对应周期`
      )
    }

    assertEqual(findBillingPackage('nonexistent-product-id'), null, '未知 productId 返回 null')
  }

  // ── 4. 金额：整数最小单位，无浮点误差 ─────────────────────────────
  console.log('\n▶ 4. 金额处理（无浮点）')
  {
    // 反证：浮点直接相乘确实会失真
    assertTrue(19.99 * 100 !== 1999, '浮点乘法失真（反证）')
    info(`19.99 * 100 = ${19.99 * 100}`)

    assertEqual(toMinorUnits(19.99), 1999, 'toMinorUnits(19.99)')
    assertEqual(toMinorUnits(4.9), 490, 'toMinorUnits(4.90)')
    assertEqual(toMinorUnits(299), 29900, 'toMinorUnits(299)')
    assertEqual(toMinorUnits(0.01), 1, 'toMinorUnits(0.01)')
    assertEqual(toMinorUnits(15), 1500, 'toMinorUnits(15)')

    assertEqual(formatPriceMinor(490), '$4.90', 'formatPriceMinor(490)')
    assertEqual(formatPriceMinor(1500), '$15.00', 'formatPriceMinor(1500)')
    assertEqual(formatPriceMinor(2990), '$29.90', 'formatPriceMinor(2990)')
    assertEqual(formatPriceMinor(29900), '$299.00', 'formatPriceMinor(29900)')
    assertEqual(formatPriceMinor(1), '$0.01', 'formatPriceMinor(1)')

    // 当前产品的每个金额都要能格式化并**精确**回到最小单位（不是四舍五入回来的）
    let roundTripBad = 0
    for (const pkg of packages) {
      const display = formatPriceMinor(pkg.priceMinor)
      const cents = Number(display.slice(1).replace('.', ''))
      if (cents !== pkg.priceMinor) {
        fail(`${pkg.id}: ${display} 回读成 ${cents}，与 ${pkg.priceMinor} 不符`)
        roundTripBad += 1
      }
    }
    assertTrue(
      roundTripBad === 0,
      `${packages.length} 个套餐的价格格式化后能精确回读（无浮点损失）`
    )
  }

  // ── 5. 渠道产品 id 映射 ───────────────────────────────────────────
  console.log('\n▶ 5. 渠道产品 id 映射（只在服务端）')
  {
    let mapped = 0
    let wrongValue = 0

    for (const pkg of packages) {
      const channels = Object.entries(pkg.providerProductIds ?? {})
      mapped += channels.length

      for (const [channel, channelProductId] of channels) {
        if (getProviderProductId(pkg, channel) !== channelProductId) wrongValue += 1
      }

      // 没有映射的渠道必须返回 null，由调用方用**服务端金额**动态创建价格
      assertEqual(getProviderProductId(pkg, 'no-such-channel'), null, `${pkg.id}: 未声明的渠道返回 null`)
    }

    assertEqual(wrongValue, 0, `${mapped} 条渠道映射全部按 bundle 原值返回`)
    info(`已声明渠道：${[...new Set(packages.flatMap((p) => Object.keys(p.providerProductIds ?? {})))].join(', ') || '（无）'}`)
  }

  // ── 6. 免费档（注册赠送的唯一数字） ───────────────────────────────
  console.log('\n▶ 6. 免费档')
  {
    const free = getFreePlan()
    assertEqual(free.priceMinor, 0, 'freePlan.priceMinor（免费档不进 checkout）')
    assertTrue(
      Number.isInteger(free.welcomeCredits) && free.welcomeCredits > 0,
      `freePlan.welcomeCredits 是正整数（${free.welcomeCredits}）`
    )
    assertTrue(
      !listBillingPackages().some((pkg) => pkg.id === free.id),
      `免费档 "${free.id}" 不在可售套餐里（不经过 checkout）`
    )

    // 三处发放点必须读同一个来源，不再各写一个字面量
    for (const [label, source] of [
      ['注册发放', 'src/lib/auth.ts'],
      ['ensure 兜底建号', 'src/app/api/user/ensure/route.ts'],
      ['credits 兜底建号', 'src/app/api/user/credits/route.ts'],
    ] as const) {
      const code = stripCommentLines(readFileSync(path.resolve(process.cwd(), source), 'utf8'))
      assertTrue(
        code.includes('getFreePlan().welcomeCredits') &&
          !new RegExp(`credits:\\s*${free.welcomeCredits}\\b`).test(code),
        `${label} 的赠送值来自 freePlan（不再有硬编码 ${free.welcomeCredits}）`
      )
    }
  }

  // ── 7. 架构守卫：checkout 路由不读客户端价格 ──────────────────────
  console.log('\n▶ 7. 架构守卫：checkout 不读客户端价格')
  {
    const source = readRepo('src/app/api/billing/checkout/route.ts')
    if (!source) {
      fail('src/app/api/billing/checkout/route.ts 不存在（下单主路径消失了）')
    } else {
      for (const forbidden of ['body.price', 'body.amount', 'body.credits', 'body.currency']) {
        assertTrue(!source.includes(forbidden), `checkout 路由未读取 ${forbidden}`)
      }

      // 必须确实读取了 packageId / productId
      assertTrue(source.includes('body.packageId'), 'checkout 路由读取 body.packageId')
      assertTrue(source.includes('body.productId'), 'checkout 路由读取 body.productId')
      assertTrue(
        source.includes("from '@/config/billing'"),
        'checkout 路由依赖服务端的套餐查询层（服务端报价）'
      )
    }

    // 服务层同样不得读取请求里的价格字段；下单金额只能来自套餐查询结果
    const serviceSource = readRepo('src/lib/billing/service.ts')
    if (!serviceSource) {
      fail('src/lib/billing/service.ts 不存在')
    } else {
      assertTrue(
        !/request\.(price|amount|credits)\b/.test(serviceSource),
        'BillingService 未读取请求里的 price / amount / credits'
      )
      assertTrue(
        serviceSource.includes('getBillingPackage') && serviceSource.includes('findBillingPackage'),
        'BillingService 按 packageId / productId 解析套餐'
      )
      assertTrue(
        /amount\w*:\s*pkg\.priceMinor/.test(serviceSource),
        'BillingService 的下单金额取 pkg.priceMinor（解析结果，不是请求字段）'
      )
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 架构守卫：单次成本只有一处真相（模型目录）（B-12）
  //
  // 原先这里还钉着「每个 action 各扣多少积分」的表 —— 那是**产品的价目数据**。
  // 通用不变量是「成本只能从模型目录读出，别处不许再写第二份」；具体数字由
  // 产品脚本钉死（改价失误照样红）。
  // ─────────────────────────────────────────────────────────────────────

  console.log('\n▶ 8. 成本只有一处真相（模型目录）')
  {
    // 1. Core 里那份「按产品键索引的积分表」不得复活
    assertTrue(
      !existsSync(path.resolve(process.cwd(), 'src/config/credits.ts')),
      'src/config/credits.ts 不存在（成本由产品的模型目录承担）'
    )

    // 2. Core 的模型门面不持有任何数值
    const modelsSource = stripCommentLines(
      readFileSync(path.resolve(process.cwd(), 'src/lib/ai/models.ts'), 'utf8')
    )
    assertTrue(!/credits:\s*\d+/.test(modelsSource), 'ai/models.ts 不写死 credits 数值')
    assertTrue(!modelsSource.includes('getCreditCost'), 'ai/models.ts 不引用 Core 积分表')

    // 3. 通用积分服务层只剩机制：既没有内联价目表，也不反向依赖产品层
    const serviceSource = stripCommentLines(
      readFileSync(path.resolve(process.cwd(), 'src/lib/services/credits.ts'), 'utf8')
    )
    assertTrue(
      !/case\s+'[^']+':[\s\S]{0,80}return\s+\d+/.test(serviceSource),
      'services/credits.ts 没有内联价格 switch'
    )
    assertTrue(
      !serviceSource.includes('@/lib/products/') && !serviceSource.includes('getRequiredCredits'),
      'services/credits.ts 与产品层解耦（无反向依赖）'
    )

    // 4. 运行时：Core 门面读到的就是 bundle 里的同一个模型对象（不是第二份表）
    const modelIds = Object.keys(bundle.models)
    let mismatch = 0
    for (const id of modelIds) {
      if (getModel(id) !== bundle.models[id]) {
        fail(`模型 ${id} 经 Core 门面读到的不是 bundle 里的同一份定义`)
        mismatch += 1
      }
    }
    assertTrue(
      mismatch === 0,
      `${modelIds.length} 个模型经 Core 门面读到的都是目录里的同一份 credits`
    )

    // 5. 未登记的 id 必须抛错（静默回退会把配置缺失伪装成正常定价）
    assertThrows(() => getModel('not-a-real-model'), '未知 model id 抛错', 'Unknown model')

    // 6. UI 展示价格不得再各写一份：组件层出现 `credits: <数字>` 就是第二份真相
    const uiOffenders: string[] = []
    for (const file of listSourceFiles(path.resolve(process.cwd(), 'src/components'))) {
      const code = stripCommentLines(readFileSync(file, 'utf8'))
      const hit = /\bcredits:\s*\d+/.exec(code)
      if (hit) uiOffenders.push(`${rel(file)} → ${hit[0]}`)
    }
    assertTrue(
      uiOffenders.length === 0,
      uiOffenders.length === 0
        ? 'src/components 内没有写死的 credits 数值（展示价与扣减同源）'
        : `组件层有 ${uiOffenders.length} 处自写成本：${uiOffenders.join('；')}`
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  // 架构守卫（9.8.2-C）：套餐标识符契约 —— 客户端只发内部 id，渠道 id 留在服务端
  //
  // 文案 ⇄ 金额的一致性原先读死某个产品的 content/pricing.json，现在走内容装配点：
  // 换产品后检查的是**那个产品**的文案。
  // ─────────────────────────────────────────────────────────────────────

  console.log('\n▶ 9. 套餐标识符契约 + 文案/金额一致性')
  {
    assertTrue(
      !existsSync(path.resolve(process.cwd(), 'src/app/api/payments/create-checkout/route.ts')),
      '旧的 /api/payments/create-checkout 适配层不存在'
    )

    const uiSource = readRepo('src/components/PricingContent.tsx')
    if (!uiSource) {
      fail('src/components/PricingContent.tsx 不存在')
    } else {
      assertTrue(uiSource.includes("fetch('/api/billing/checkout'"), '定价页调用 /api/billing/checkout')
      assertTrue(!uiSource.includes('create-checkout'), '定价页不再调用旧适配层')
      assertTrue(
        !/body:\s*JSON\.stringify\(\{[^}]*\b(amount|price|credits)\b/.test(uiSource),
        '定价页请求体不含 amount / price / credits（客户端不报价）'
      )
      assertTrue(uiSource.includes('packageId'), '定价页只发送内部 packageId')
    }

    const pricing = productContent.pricing
    const pricingJson = JSON.stringify(pricing)

    // 渠道名属于服务端到渠道的映射，不得进任何前端内容
    const channels = [...new Set(packages.flatMap((p) => Object.keys(p.providerProductIds ?? {})))]
    for (const channel of channels) {
      assertTrue(!new RegExp(channel, 'i').test(pricingJson), `定价文案里不含渠道名 "${channel}"`)
    }

    // 渠道商品 id 同理。例外：某个 id 恰好等于该套餐自己的展示名（那出现的是
    // 人类可读的名字，不是渠道映射泄漏），逐条打印出来，不静默放过。
    const coincidences: string[] = []
    for (const pkg of packages) {
      for (const [channel, channelProductId] of Object.entries(pkg.providerProductIds ?? {})) {
        if (channelProductId === pkg.name) {
          coincidences.push(`${pkg.id}.${channel} = "${channelProductId}"（与展示名同名，不计为泄漏）`)
          continue
        }
        assertTrue(
          !pricingJson.includes(channelProductId),
          `定价文案里不含渠道商品 id "${channelProductId}"`
        )
      }
    }
    for (const c of coincidences) info(`· ${c}`)

    for (const plan of pricing.plans) {
      if (!plan.packageIds) {
        assertTrue(
          plan.monthlyPrice === 0 && plan.yearlyPrice === 0,
          `无套餐 id 的档位 "${plan.id}" 确实是免费的`
        )
        assertEqual(plan.id, getFreePlan().id, `免费档位 "${plan.id}" 的 id 与 freePlan 对齐`)
        continue
      }

      for (const [cycle, pkgId] of [
        ['monthly', plan.packageIds.monthly],
        ['yearly', plan.packageIds.yearly],
      ] as const) {
        const pkg = getBillingPackage(pkgId)
        assertEqual(
          pkg.priceMinor / 100,
          cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice,
          `${pkgId}: 文案价格 $${cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice} = 服务端金额`
        )
        assertEqual(pkg.billingCycle, cycle, `${pkgId}: 周期与文案档位一致`)
      }
    }

    for (const pack of pricing.creditPacks) {
      const pkg = getBillingPackage(pack.packageId)
      assertEqual(pkg.priceMinor / 100, pack.price, `${pack.packageId}: 文案价格 = 服务端金额`)
      assertEqual(pkg.credits, pack.credits, `${pack.packageId}: 文案积分 = 服务端积分`)
    }

    // 「Save X%」必须能由某个订阅档的实价差算出来，不是手写的营销数字
    const computedSavings = pricing.plans
      .filter((plan) => plan.packageIds)
      .map((plan) => {
        const monthly = getBillingPackage(plan.packageIds!.monthly)
        const yearly = getBillingPackage(plan.packageIds!.yearly)
        return `Save ${Math.round((1 - yearly.priceMinor / (monthly.priceMinor * 12)) * 100)}%`
      })

    if (computedSavings.length > 0) {
      assertTrue(
        computedSavings.includes(pricing.billing.savePercent),
        `年付折扣文案 "${pricing.billing.savePercent}" 等于按套餐实算的价差（候选：${[...new Set(computedSavings)].join(' / ')}）`
      )
    } else {
      assertTrue(
        !pricing.billing.savePercent,
        '没有年付档时文案不宣称年付折扣（折扣数字必须有实价可算）'
      )
    }

    // 免费额度文案与 freePlan 一致
    const basic = pricing.plans.find((p) => p.monthlyPrice === 0)
    if (basic) {
      assertTrue(
        basic.features.some((f) => f.includes(String(getFreePlan().welcomeCredits))),
        `定价页免费档文案含 "${getFreePlan().welcomeCredits}"（与发放值一致）`
      )
      assertTrue(
        !/credits per (month|year)/i.test(basic.features.join(' ')),
        '免费档不宣称周期性额度（周期额度只属于付费套餐）'
      )
    } else {
      info('定价文案没有免费档位（产品可只卖付费套餐），跳过免费档文案一致性')
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 架构守卫：生成退款必须走原子 RPC（B-10）
  //
  // 产品自己的入口是否还手工扣费，属于那个产品的守卫；这里守 Core 结算层、
  // 遗留 `/api/ai/image` 入口，以及全项目的非原子写法。
  // ─────────────────────────────────────────────────────────────────────

  console.log('\n▶ 10. 退款走 Credit 原子 RPC')
  {
    const settlementSource = readRepo('src/lib/workflow/settlement.ts')
    if (!settlementSource) {
      fail('src/lib/workflow/settlement.ts 不存在')
    } else {
      assertTrue(
        settlementSource.includes('grantCredits'),
        'workflow/settlement 退款走 credit.grantCredits()（原子 RPC）'
      )
      assertTrue(
        settlementSource.includes('refundKey') && settlementSource.includes(':refund'),
        'workflow/settlement 退款带幂等键 task:<id>:refund'
      )
    }

    const aiImageSource = readRepo('src/app/api/ai/image/route.ts')
    if (aiImageSource) {
      assertTrue(aiImageSource.includes('grantCredits('), 'ai/image 退款调用 credit.grantCredits()')
      assertTrue(
        !aiImageSource.includes('grantUserCredits('),
        'ai/image 不使用非原子的 grantUserCredits()'
      )
    }

    // 全项目不得再用「读-判-写」式的 prisma increment 记账
    const incrementOffenders: string[] = []
    for (const file of listSourceFiles(path.resolve(process.cwd(), 'src'))) {
      const code = stripCommentLines(readFileSync(file, 'utf8'))
      if (/credits:\s*\{\s*increment/.test(code)) incrementOffenders.push(rel(file))
    }
    assertTrue(
      incrementOffenders.length === 0,
      incrementOffenders.length === 0
        ? 'src/ 内无非原子的 prisma credits increment'
        : `发现非原子扣减：${incrementOffenders.join(', ')}`
    )

    const grantOffenders: string[] = []
    for (const file of listSourceFiles(path.resolve(process.cwd(), 'src'))) {
      const code = stripCommentLines(readFileSync(file, 'utf8'))
      if (/\bgrantUserCredits\s*\(/.test(code)) grantOffenders.push(rel(file))
    }
    assertTrue(
      grantOffenders.length === 0,
      grantOffenders.length === 0
        ? 'src/ 内不再调用已删除的非原子 grantUserCredits()'
        : `仍在调用：${grantOffenders.join(', ')}`
    )
  }

  // ─────────────────────────────────────────────────────────────────────
  // 架构守卫：不把中国香港/澳门/台湾当作独立国家（B-17）
  // ─────────────────────────────────────────────────────────────────────

  console.log('\n▶ 11. 地区列表不得把 HK/MO/TW 当作独立国家')
  {
    assertTrue(
      !existsSync(path.resolve(process.cwd(), 'src/lib/payment/router.ts')),
      'payment/router.ts 不存在（原含 HK/TW 国家列表）'
    )

    const offenders: string[] = []

    for (const file of listSourceFiles(path.resolve(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8')
      // 形如 country: [..., "HK", ...] 或 country: [..., "TW", ...]
      if (/country\s*:\s*\[[^\]]*"(HK|TW|MO)"/.test(source)) offenders.push(rel(file))
    }

    assertTrue(
      offenders.length === 0,
      offenders.length === 0
        ? 'src/ 内无把 HK/MO/TW 当作国家的列表'
        : `发现 ${offenders.length} 处：${offenders.join(', ')}`
    )
  }

  console.log(
    failures === 0
      ? `\n✅ Billing 配置层验证全部通过（共 ${checks} 项检查）`
      : `\n❌ Billing 配置层验证有 ${failures} 项失败（共 ${checks} 项检查）`
  )

  process.exit(failures === 0 ? 0 : 1)
}

try {
  main()
} catch (error) {
  // 抛出说明主路径本身缺失或套餐 id 解析不了 —— 必须红，不能悄悄跑完
  console.error(`\n❌ Billing 验证异常终止：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
