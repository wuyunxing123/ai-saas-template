#!/usr/bin/env node
// @product-scope flux-kontext
/**
 * Flux Kontext **产品专属**验证（Phase 9.8.2-D）
 *
 * 这里钉的全是「Flux 这个产品是什么」的数据：10 个模型档位的积分、10 个 action 的
 * 翻译表、7 个套餐的价格与渠道商品 id、厂商 endpoint、定价文案里的数字，以及
 * `/api/flux/*` 兼容路由的契约。
 *
 * 为什么要单独成文，而不是留在 `verify-billing.ts` / `verify-ai-core.ts` 里：
 *   那两份现在只验**通用机制**，靠当前绑定的 bundle 取数。把 Flux 的数字留在里面，
 *   等于换产品后仍然断言上一个产品的价目表 —— 门禁会对新产品红，而对老产品假绿。
 *
 * 与「不要牺牲产品专属测试的有效性」的对应关系：
 *   · 一条断言都没删。原来在通用脚本里的 Flux 断言**逐字搬进来**（改了归属，没改判据）；
 *   · 脚本头部声明 `@product-scope flux-kontext`，`scripts/verify-all.mjs` 在产品目录
 *     缺失时判它为 **SKIP（不是 PASS）**。所以「Flux 不在了」不会被伪装成绿灯，
 *     而「Flux 还在」时它照旧一票否决。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-flux-kontext.ts
 */

import '@/app/product-runtime'

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { config as loadEnv } from 'dotenv'

import { NextRequest } from 'next/server'

import { proxy } from '@/proxy'
import { formatPriceMinor, getBillingPackage, findBillingPackage, getFreePlan, getProviderProductId, listBillingPackages } from '@/config/billing'
import { getRequiredCredits } from '@/lib/products/flux-kontext/credits'
import { ACTION_TO_MODEL } from '@/lib/products/flux-kontext/actions'
import { FLUX_MODELS } from '@/lib/products/flux-kontext/catalogue'
import { FLUX_ASPECT_RATIOS, FLUX_DEFAULT_FAL_IMAGE_SIZE, findAspectRatio } from '@/lib/products/flux-kontext/capabilities'
import { FLUX_ATLASCLOUD_CONFIG, FLUX_FAL_CONFIG, FLUX_KIE_CONFIG, FLUX_WAVESPEED_CONFIG } from '@/lib/products/flux-kontext/provider-data'
import { FLUX_BILLING_PACKAGES } from '@/lib/products/flux-kontext/billing'
import { freeUserLimits, premiumUserLimits, pricingPlans, registeredUserLimits } from '@/lib/products/flux-kontext/tiers'
import { FLUX_KONTEXT_ACTIONS } from '@/lib/products/flux-kontext/types'

loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

const ROOT = process.cwd()

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

/** 两组键值整体比对：一条断言一屏结果，避免 10×3 行刷屏。 */
function assertTable(actual: Record<string, unknown>, expected: Record<string, unknown>, label: string) {
  const keys = [...new Set([...Object.keys(actual ?? {}), ...Object.keys(expected)])].sort()
  const diffs = keys
    .filter((k) => JSON.stringify(actual?.[k]) !== JSON.stringify(expected[k]))
    .map((k) => `${k}: 期望 ${JSON.stringify(expected[k])}，实际 ${JSON.stringify(actual?.[k])}`)

  if (diffs.length === 0) ok(`${label}（${keys.length} 项全部一致）`)
  else {
    fail(`${label}：${diffs.length} 项不符`)
    for (const d of diffs) info(`· ${d}`)
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

const read = (rel: string) => readFileSync(path.resolve(ROOT, rel), 'utf8')

// ─────────────────────────────────────────────────────────────────────
// Flux 价目表（历史上被钉在通用脚本里的数字，全部归到这里）
// ─────────────────────────────────────────────────────────────────────

function checkPriceSheet() {
  console.log('\n▶ F1. 模型目录：10 个档位的价格真相')

  assertTable(
    Object.fromEntries(Object.entries(FLUX_MODELS).map(([id, m]) => [id, m.credits])),
    {
      'flux-kontext-pro': 15,
      'flux-kontext-pro-edit': 15,
      'flux-kontext-pro-multi': 15,
      'flux-kontext-max': 30,
      'flux-kontext-max-edit': 30,
      'flux-kontext-max-multi': 45,
      'flux-schnell': 8,
      'flux-dev': 12,
      'flux-realism': 20,
      'flux-anime': 20,
    },
    '模型 → credits 价目表'
  )

  assertTable(
    Object.fromEntries(Object.entries(FLUX_MODELS).map(([id, m]) => [id, m.providers])),
    {
      'flux-kontext-pro': ['fal', 'kie', 'wavespeed', 'atlascloud'],
      'flux-kontext-pro-edit': ['fal', 'kie', 'wavespeed', 'atlascloud'],
      'flux-kontext-pro-multi': ['fal', 'wavespeed', 'atlascloud'],
      'flux-kontext-max': ['fal', 'kie', 'wavespeed', 'atlascloud'],
      'flux-kontext-max-edit': ['fal', 'kie', 'wavespeed', 'atlascloud'],
      'flux-kontext-max-multi': ['fal', 'wavespeed', 'atlascloud'],
      'flux-schnell': ['fal', 'atlascloud'],
      'flux-dev': ['fal', 'atlascloud'],
      'flux-realism': ['fal'],
      'flux-anime': ['fal'],
    },
    '模型 → 可用厂商'
  )

  assertTable(
    Object.fromEntries(Object.entries(FLUX_MODELS).map(([id, m]) => [id, m.requiredInputImages])),
    {
      'flux-kontext-pro': 0,
      'flux-kontext-pro-edit': 1,
      'flux-kontext-pro-multi': 'many',
      'flux-kontext-max': 0,
      'flux-kontext-max-edit': 1,
      'flux-kontext-max-multi': 'many',
      'flux-schnell': 0,
      'flux-dev': 0,
      'flux-realism': 0,
      'flux-anime': 0,
    },
    '模型 → 必需输入图'
  )

  assertTrue(
    Object.values(FLUX_MODELS).every((m) => m.defaultProvider === 'fal'),
    '所有档位的默认厂商都是 fal'
  )
}

function checkActionMapping() {
  console.log('\n▶ F2. action ⇄ 模型的翻译表（Flux 词表 → Core 词表）')

  assertTable(ACTION_TO_MODEL, {
    'text-to-image-pro': 'flux-kontext-pro',
    'text-to-image-max': 'flux-kontext-max',
    'text-to-image-schnell': 'flux-schnell',
    'text-to-image-dev': 'flux-dev',
    'text-to-image-realism': 'flux-realism',
    'text-to-image-anime': 'flux-anime',
    'edit-image-pro': 'flux-kontext-pro-edit',
    'edit-image-max': 'flux-kontext-max-edit',
    'edit-multi-image-pro': 'flux-kontext-pro-multi',
    'edit-multi-image-max': 'flux-kontext-max-multi',
  }, 'ACTION_TO_MODEL')

  assertEqual(FLUX_KONTEXT_ACTIONS.length, 10, 'Flux action 数量')

  // 运行时：10 个 action 的成本与历史值完全一致（防止改价失误）
  const expected: Record<string, number> = {
    'text-to-image-pro': 15,
    'edit-image-pro': 15,
    'edit-multi-image-pro': 15,
    'text-to-image-max': 30,
    'edit-image-max': 30,
    'edit-multi-image-max': 45,
    'text-to-image-schnell': 8,
    'text-to-image-dev': 12,
    'text-to-image-realism': 20,
    'text-to-image-anime': 20,
  }

  let costDiffs = 0
  for (const [action, cost] of Object.entries(expected)) {
    const actual = getRequiredCredits(action)
    if (actual !== cost) {
      fail(`action ${action} 期望 ${cost}，实际 ${actual}`)
      costDiffs += 1
    }
  }
  if (costDiffs === 0) ok(`getRequiredCredits() 的 ${Object.keys(expected).length} 个 action 成本全部命中价目表`)

  // 未知 action 必须失败（旧实现静默回退 15，把登记缺失伪装成正常定价）
  assertThrows(() => getRequiredCredits('not-a-real-action'), '未知 action 抛错', 'Unknown Flux action')
}

function checkPackages() {
  console.log('\n▶ F3. 套餐价目（7 个可售 + 免费档）')

  assertEqual(listBillingPackages('credit_pack').length, 3, '积分包数量')
  assertEqual(listBillingPackages('subscription').length, 4, '订阅包数量')

  const creator = getBillingPackage('creator')
  assertEqual(creator.priceMinor, 1500, 'creator.priceMinor')
  assertEqual(creator.credits, 4000, 'creator.credits')
  assertEqual(creator.type, 'credit_pack', 'creator.type')

  const proMonthly = getBillingPackage('pro_monthly')
  assertEqual(proMonthly.priceMinor, 2990, 'pro_monthly.priceMinor')
  assertEqual(proMonthly.credits, 8900, 'pro_monthly.credits')
  assertEqual(proMonthly.billingCycle, 'monthly', 'pro_monthly.billingCycle')
  assertEqual(proMonthly.planId, 'pro', 'pro_monthly.planId')

  assertTable(
    Object.fromEntries(Object.entries(FLUX_BILLING_PACKAGES).map(([id, p]) => [id, p.priceMinor])),
    {
      starter: 490,
      creator: 1500,
      business: 6000,
      plus_monthly: 990,
      plus_yearly: 9900,
      pro_monthly: 2990,
      pro_yearly: 29900,
    },
    '套餐金额表（美分）'
  )

  assertTable(
    Object.fromEntries(Object.entries(FLUX_BILLING_PACKAGES).map(([id, p]) => [id, p.credits])),
    {
      starter: 600,
      creator: 4000,
      business: 18000,
      plus_monthly: 1900,
      plus_yearly: 24000,
      pro_monthly: 8900,
      pro_yearly: 120000,
    },
    '套餐积分数表（履约发放值）'
  )

  const free = getFreePlan()
  assertEqual(free.id, 'basic', '免费档 id')
  assertEqual(free.welcomeCredits, 100, '注册赠送积分（全项目唯一）')

  console.log('\n▶ F4. 旧调用方兼容解析')
  assertEqual(findBillingPackage('starter')?.id, 'starter', 'productId starter')
  assertEqual(findBillingPackage('creator')?.id, 'creator', 'productId creator')
  assertEqual(findBillingPackage('plus', 'monthly')?.id, 'plus_monthly', 'plus + monthly')
  assertEqual(findBillingPackage('plus', 'yearly')?.id, 'plus_yearly', 'plus + yearly')
  assertEqual(findBillingPackage('pro', 'monthly')?.id, 'pro_monthly', 'pro + monthly')
  assertEqual(findBillingPackage('pro', 'yearly')?.id, 'pro_yearly', 'pro + yearly')
  assertEqual(findBillingPackage('nonexistent'), null, '未知 productId 返回 null')

  console.log('\n▶ F5. creem 渠道商品 id')
  assertEqual(getProviderProductId(creator, 'creem'), 'Creator Pack', 'creator → creem')
  assertEqual(getProviderProductId(creator, 'stripe'), null, 'creator → stripe（无映射，用服务端金额）')
  assertEqual(getProviderProductId(getBillingPackage('pro_yearly'), 'creem'), 'FluxKontext-Pro-Yearly', 'pro_yearly → creem')
  assertEqual(getProviderProductId(getBillingPackage('pro_monthly'), 'creem'), 'FluxKontext-Pro-Monthly', 'pro_monthly → creem')
  assertEqual(getProviderProductId(getBillingPackage('plus_monthly'), 'creem'), 'FluxKontext-Plus-Monthly', 'plus_monthly → creem')
  assertEqual(getProviderProductId(getBillingPackage('starter'), 'creem'), 'Starter Pack', 'starter → creem')
  assertEqual(getProviderProductId(getBillingPackage('business'), 'creem'), 'Business Pack', 'business → creem')
}

function checkCapabilities() {
  console.log('\n▶ F6. 宽高比能力表（UI 可选项 = fal 落点）')

  assertEqual(FLUX_ASPECT_RATIOS.length, 13, 'Flux 支持的宽高比数量')

  assertTable(
    Object.fromEntries(FLUX_ASPECT_RATIOS.map((o) => [o.value, o.falImageSize])),
    {
      '1:1': 'square_hd',
      '16:9': 'landscape_16_9',
      '9:16': 'portrait_16_9',
      '4:3': 'landscape_4_3',
      '3:4': 'portrait_4_3',
      '3:2': 'landscape_4_3',
      '2:3': 'portrait_4_3',
      '21:9': 'landscape_16_9',
      '9:21': 'portrait_16_9',
      '5:4': 'landscape_4_3',
      '4:5': 'portrait_4_3',
      '7:5': 'landscape_4_3',
      '5:7': 'portrait_4_3',
    },
    '宽高比 → fal image_size（近邻归拢显式化，竖版不得落到横版枚举）'
  )

  assertEqual(FLUX_DEFAULT_FAL_IMAGE_SIZE, 'landscape_4_3', '缺省 fal image_size')
  assertEqual(findAspectRatio('5:4')?.falImageSize, 'landscape_4_3', '5:4 显式归拢到 landscape_4_3')
  assertEqual(findAspectRatio('99:99'), null, '未列出的宽高比不被接受（无 default 兜底）')

  console.log('\n▶ F7. 档位能力（免费 / 注册 / 付费）')

  assertTable(
    {
      maxImages: [freeUserLimits.maxImages, registeredUserLimits.maxImages, premiumUserLimits.maxImages],
      modelsAllowed: [
        freeUserLimits.modelsAllowed,
        registeredUserLimits.modelsAllowed,
        premiumUserLimits.modelsAllowed,
      ],
      hourlyLimit: [freeUserLimits.hourlyLimit, registeredUserLimits.hourlyLimit],
      storageRetention: [freeUserLimits.storageRetention, registeredUserLimits.storageRetention],
    },
    {
      maxImages: [2, 4, 12],
      modelsAllowed: [['pro'], ['pro', 'max'], ['pro', 'max']],
      hourlyLimit: [10, 30],
      storageRetention: [7, 30],
    },
    'maxImages / modelsAllowed / hourlyLimit / storageRetention（免费、注册、付费）'
  )

  // 付费档用 Infinity：JSON 序列化会变成 null，所以单独断言而不是塞进上表
  assertTrue(premiumUserLimits.hourlyLimit === Infinity, '付费档不限次/小时')
  assertTrue(premiumUserLimits.storageRetention === Infinity, '付费档图片永久保留')
  assertEqual(freeUserLimits.requiresTurnstile, true, '免费用户强制 Turnstile')
  assertEqual(registeredUserLimits.requiresTurnstile, 'smart', '注册用户 Turnstile 智能判定')
  assertEqual(premiumUserLimits.requiresTurnstile, false, '付费用户不要求 Turnstile')
  assertEqual(premiumUserLimits.features.commercialLicense, true, '商用授权属付费档位能力')
  assertEqual(freeUserLimits.features.batchGeneration, false, '批量生成不对免费用户开放')
}

function checkVendorTables() {
  console.log('\n▶ F8. 厂商接入表（endpoint / LoRA / 接口路径）')

  assertTable(
    Object.fromEntries(Object.entries(FLUX_FAL_CONFIG.models).map(([id, cfg]) => [id, cfg.endpoint])),
    {
      'flux-kontext-pro': 'fal-ai/flux-pro',
      'flux-kontext-pro-edit': 'fal-ai/flux-pro/kontext',
      'flux-kontext-pro-multi': 'fal-ai/flux-pro/kontext/multi',
      'flux-kontext-max': 'fal-ai/flux-pro/v1.1',
      'flux-kontext-max-edit': 'fal-ai/flux-pro/kontext/max',
      'flux-kontext-max-multi': 'fal-ai/flux-pro/kontext/max/multi',
      'flux-schnell': 'fal-ai/flux/schnell',
      'flux-dev': 'fal-ai/flux/dev',
      'flux-realism': 'fal-ai/flux-general',
      'flux-anime': 'fal-ai/flux-general',
    },
    '模型 → fal endpoint'
  )

  assertEqual(Object.keys(FLUX_FAL_CONFIG.models).length, Object.keys(FLUX_MODELS).length, 'fal 覆盖全部 10 个模型')
  assertEqual(
    FLUX_FAL_CONFIG.models['flux-schnell'].fixedTextToImageInput?.num_inference_steps,
    4,
    'schnell 固定 4 步（模型参数，不属 Provider 逻辑）'
  )
  assertTrue(
    FLUX_FAL_CONFIG.models['flux-realism'].loras?.[0]?.path.startsWith('https://huggingface.co/XLabs-AI/'),
    'realism 挂 XLabs LoRA'
  )
  assertTrue(
    FLUX_FAL_CONFIG.models['flux-anime'].loras?.[0]?.path.startsWith('https://huggingface.co/Shakker-Labs/'),
    'anime 挂 Shakker LoRA'
  )
  assertEqual(
    Object.keys(FLUX_FAL_CONFIG.imageSizeByAspectRatio).length,
    13,
    'fal 的 image_size 映射由能力表派生（13 项）'
  )

  assertEqual(Object.keys(FLUX_KIE_CONFIG.models).length, 4, 'KIE 只接 4 个单图档位（无 multi）')
  assertEqual(FLUX_KIE_CONFIG.generatePath, '/api/v1/flux/kontext/generate', 'KIE generate 接口路径')
  assertEqual(FLUX_KIE_CONFIG.recordPath, '/api/v1/flux/kontext/record-info', 'KIE record-info 接口路径')
  assertEqual(FLUX_KIE_CONFIG.models['flux-kontext-pro-edit'].requiresImage, true, 'KIE 编辑档需要输入图')

  assertTable(
    Object.fromEntries(Object.entries(FLUX_WAVESPEED_CONFIG.models).map(([id, e]) => [id, e])),
    {
      'flux-kontext-pro': 'wavespeed-ai/flux-kontext-pro/text-to-image',
      'flux-kontext-pro-edit': 'wavespeed-ai/flux-kontext-pro',
      'flux-kontext-pro-multi': 'wavespeed-ai/flux-kontext-pro/multi',
      'flux-kontext-max': 'wavespeed-ai/flux-kontext-max/text-to-image',
      'flux-kontext-max-edit': 'wavespeed-ai/flux-kontext-max',
      'flux-kontext-max-multi': 'wavespeed-ai/flux-kontext-max/multi',
    },
    'WaveSpeed endpoint 表'
  )

  assertTable(
    Object.fromEntries(Object.entries(FLUX_ATLASCLOUD_CONFIG.models).map(([id, cfg]) => [id, cfg.images])),
    {
      'flux-kontext-pro': 'none',
      'flux-kontext-max': 'none',
      'flux-schnell': 'none',
      'flux-dev': 'none',
      'flux-kontext-pro-edit': 'single',
      'flux-kontext-max-edit': 'single',
      'flux-kontext-pro-multi': 'multi',
      'flux-kontext-max-multi': 'multi',
    },
    'Atlas Cloud 输入图模式'
  )
  assertEqual(
    Object.keys(FLUX_ATLASCLOUD_CONFIG.models).length,
    8,
    'Atlas 接 8 个档位（不含 realism / anime）'
  )
}

function checkDisplayPrices() {
  console.log('\n▶ F9. 展示价派生自套餐表（不再有第二份数字）')

  const proMonthly = getBillingPackage('pro_monthly')
  const proYearly = getBillingPackage('pro_yearly')

  assertEqual(pricingPlans.monthly.priceLabel, formatPriceMinor(proMonthly.priceMinor), 'pricingPlans 月付报价 = 套餐金额')
  assertEqual(pricingPlans.yearly.priceLabel, formatPriceMinor(proYearly.priceMinor), 'pricingPlans 年付报价 = 套餐金额')
  assertEqual(pricingPlans.monthly.price, 29.9, 'pricingPlans 月付展示价 $29.90')
  assertEqual(pricingPlans.yearly.price, 299, 'pricingPlans 年付展示价 $299')
  assertEqual(pricingPlans.monthly.credits, 8900, 'pricingPlans 月付积分 = 套餐积分')
  assertEqual(pricingPlans.yearly.discount, 'Save 17%', '年付折扣派生值')
  assertTrue(
    pricingPlans.yearly.features.includes(`${12 - proYearly.priceMinor / proMonthly.priceMinor} extra months free`),
    '升级提示的「多送月数」按套餐实算（12 - 年付÷月付）'
  )

  const tiersSource = stripCommentLines(read('src/lib/products/flux-kontext/tiers.ts'))
  assertTrue(!/price:\s*[\d.]+/.test(tiersSource), 'tiers.ts 的定价方案不写死数字')
  assertTrue(tiersSource.includes('FLUX_BILLING_PACKAGES'), 'tiers.ts 的报价从产品套餐表派生')

  // 升级提示组件的价格展示必须来自套餐表，不再有 $29 / $290 字面量
  const upgradeSource = read('src/components/UpgradePrompt.tsx')
  assertTrue(!/\$29|\$290|节省 ?20%/.test(upgradeSource), 'UpgradePrompt 不硬编码 $29 / $290 / 省 20%')
  assertTrue(
    upgradeSource.includes('pricingPlans.monthly.priceLabel') &&
      upgradeSource.includes('pricingPlans.yearly.priceLabel'),
    'UpgradePrompt 的报价来自 pricingPlans（派生自套餐表）'
  )

  // 生成器 UI 的档位价格是目录里的 credits，不是组件自己写的
  const uiSource = stripCommentLines(read('src/components/flux-kontext/model-config.ts'))
  assertTrue(!/credits:\s*\d+/.test(uiSource), 'model-config.ts 的选项价格不是字面量（与扣减同源）')
  assertTrue(
    uiSource.includes('FLUX_MODELS') && uiSource.includes('ACTION_TO_MODEL'),
    'model-config.ts 从模型目录 + action 翻译表取展示价'
  )
}

function checkPricingCopy() {
  console.log('\n▶ F10. 定价文案钉值（通用一致性由 verify-billing 负责）')

  const pricingJson = JSON.parse(
    read('src/lib/products/flux-kontext/content/pricing.json')
  ) as {
    billing: { savePercent: string }
    plans: Array<{ id: string; packageIds?: { monthly: string; yearly: string } }>
    creditPacks: Array<{ packageId: string }>
  }

  assertEqual(pricingJson.billing.savePercent, 'Save 17%', '定价页年付折扣文案')
  assertTable(
    Object.fromEntries(
      pricingJson.plans
        .filter((p) => p.packageIds)
        .map((p) => [p.id, [p.packageIds!.monthly, p.packageIds!.yearly]])
    ),
    { plus: ['plus_monthly', 'plus_yearly'], pro: ['pro_monthly', 'pro_yearly'] },
    '订阅档位 → packageId'
  )
  assertEqual(
    pricingJson.creditPacks.map((p) => p.packageId).sort().join(','),
    'business,creator,starter',
    '积分包文案 → packageId'
  )

  // 可售套餐必须全部出现在文案里，反之亦然（漏一个 = 用户买不到 / 文案卖不存在的套餐）
  const referenced = new Set<string>([
    ...pricingJson.plans.filter((p) => p.packageIds).flatMap((p) => [p.packageIds!.monthly, p.packageIds!.yearly]),
    ...pricingJson.creditPacks.map((p) => p.packageId),
  ])
  const sellable = listBillingPackages().map((p) => p.id)
  assertEqual(
    sellable.filter((id) => !referenced.has(id)).join(','),
    '',
    '没有「服务端能卖但定价页不展示」的套餐'
  )
  assertEqual(
    [...referenced].filter((id) => !sellable.includes(id)).join(','),
    '',
    '没有「文案里展示但服务端不存在」的套餐'
  )
}

// ─────────────────────────────────────────────────────────────────────
// F11. 产品入口的两条守卫：/api/flux-kontext 不自己记账 + /api/flux 兼容路由是纯再导出
// ─────────────────────────────────────────────────────────────────────

const FLUX_ROUTE_PATH = 'src/app/api/flux-kontext/route.ts'
const COMPAT_ROUTE_PATH = 'src/app/api/flux/[[...path]]/route.ts'

let ipSeq = 0
function nextIp() {
  ipSeq += 1
  return `10.78.${Math.floor(ipSeq / 256) % 256}.${ipSeq % 256}`
}

function runProxy(url: string) {
  const response = proxy(
    new NextRequest(new URL(url, 'http://localhost:3123'), {
      headers: { 'x-forwarded-for': nextIp() },
    })
  )
  const target = response.headers.get('x-middleware-rewrite')

  return {
    pathname: target ? new URL(target).pathname : null,
    passthrough: !target && response.headers.get('x-middleware-next') === '1',
    status: response.status,
  }
}

function fluxRequest(body: unknown, pathname = '/api/flux/text-to-image/pro') {
  return new NextRequest(new URL(pathname, 'http://localhost:3123'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify(body),
  })
}

async function importModule(relPath: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path.resolve(ROOT, relPath))) {
    fail(`模块缺失：${relPath}`)
    return null
  }
  try {
    return (await import(pathToFileURL(path.resolve(ROOT, relPath)).href)) as Record<string, unknown>
  } catch (error) {
    fail(`${relPath} 导入失败：${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function handlerOf(mod: Record<string, unknown>, name: string) {
  const fn = mod[name]
  if (typeof fn !== 'function') {
    fail(`${name} 不是可调用 handler（实际类型：${typeof fn}）`)
    return null
  }
  return fn as (request: NextRequest) => Promise<Response>
}

async function checkProductRoutes() {
  console.log('\n▶ F11. Flux 路由与兼容层')

  // 1. 主 handler 不再自己做积分账本操作（已交给 WorkflowService）
  const fluxCode = stripCommentLines(read(FLUX_ROUTE_PATH))
  assertTrue(
    !fluxCode.includes('grantCredits(') && !fluxCode.includes('consumeCredits'),
    'flux-kontext 路由不直接扣费 / 退款（交给 WorkflowService）'
  )
  assertTrue(
    !/prisma\.user\.update\(\{[\s\S]{0,120}credits:\s*\{\s*increment/.test(fluxCode),
    'flux-kontext 不使用非原子的 prisma increment'
  )

  // 2. legacy 公共路径由 proxy 剥回产品兼容路由
  for (const [from, to] of [
    ['/api/v1/flux/text-to-image/pro', '/api/flux/text-to-image/pro'],
    ['/api/v1/flux/text-to-image/max', '/api/flux/text-to-image/max'],
    ['/api/v1/flux/image-edit/pro', '/api/flux/image-edit/pro'],
    ['/api/v1/flux/image-edit/max', '/api/flux/image-edit/max'],
    ['/api/v1/flux-kontext', '/api/flux-kontext'],
  ] as const) {
    assertEqual(runProxy(from).pathname, to, `${from} → ${to}`)
  }

  // 3. 兼容路由自身幂等（不被二次改写）；无关路径不得被吸进 Flux 命名空间
  assertTrue(
    runProxy('/api/flux/text-to-image/pro').passthrough,
    '/api/flux/* 直连时不再 rewrite'
  )
  for (const probe of ['/api/v1/user/credits', '/api/v1/billing/checkout', '/api/v1/auth/register']) {
    const target = runProxy(probe).pathname ?? '(无 rewrite)'
    assertTrue(!target.startsWith('/api/flux'), `${probe} → ${target} 不进入 Flux 命名空间`)
  }

  // 4. 兼容路由必须是「再导出」，不是包一层
  assertTrue(existsSync(path.resolve(ROOT, COMPAT_ROUTE_PATH)), `${COMPAT_ROUTE_PATH} 存在`)

  const compat = await importModule(COMPAT_ROUTE_PATH)
  const flux = await importModule(FLUX_ROUTE_PATH)
  if (!compat || !flux) return

  assertEqual(typeof compat.POST, 'function', '兼容路由导出 POST')
  assertEqual(typeof compat.PUT, 'function', '兼容路由导出 PUT')
  assertEqual(compat.GET, undefined, '兼容路由不导出 GET（沿用原 405 行为）')

  // 为什么不比函数引用：脚本经 jiti 转成 CJS，`export { X } from` 变成 getter 转发，
  // 引用相等会被 interop 层破坏 —— 那不代表逻辑被复制。可断言的证据是：
  //   ① 源码里只有再导出、没有任何函数体；② 两个模块的 handler 源码文本相同。
  const compatExecutable = read(COMPAT_ROUTE_PATH)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim()

  assertTrue(
    !/function\s|=>\s*\{/.test(compatExecutable),
    '兼容路由没有任何函数体（不可能藏业务逻辑）'
  )
  assertTrue(
    /^export\s*\{\s*POST\s*,\s*PUT\s*,\s*maxDuration\s*\}\s*from\s*['"]@\/app\/api\/flux-kontext\/route['"];?$/.test(
      compatExecutable
    ),
    '兼容路由的全部可执行代码只有「再导出 /api/flux-kontext 的 POST / PUT」这一行'
  )

  const compatPOST = handlerOf(compat, 'POST')
  const fluxPOST = handlerOf(flux, 'POST')
  const compatPUT = handlerOf(compat, 'PUT')
  const fluxPUT = handlerOf(flux, 'PUT')
  if (!compatPOST || !fluxPOST || !compatPUT || !fluxPUT) return

  assertTrue(compatPOST.toString() === fluxPOST.toString(), 'compat POST 与 /api/flux-kontext POST 是同一个实现')
  assertTrue(compatPUT.toString() === fluxPUT.toString(), 'compat PUT 与 /api/flux-kontext PUT 是同一个实现')

  // 5. R1：路径不推导 action，缺字段仍是 400（与原 handler 逐条对照）
  const cases: Array<[string, unknown]> = [
    ['缺 action/prompt', { prompt: 'a cat' }],
    ['缺 prompt', { action: 'text-to-image-pro' }],
    ['未知 action', { action: 'not-a-real-action', prompt: 'a cat' }],
  ]

  for (const [label, body] of cases) {
    const viaCompat = await compatPOST(fluxRequest(body))
    const viaFlux = await fluxPOST(fluxRequest(body))
    const compatText = await viaCompat.text()
    const fluxText = await viaFlux.text()

    assertEqual(viaCompat.status, viaFlux.status, `${label}：status 一致`)
    assertEqual(compatText, fluxText, `${label}：body 一致`)

    if (label === '缺 action/prompt') {
      assertEqual(viaCompat.status, 400, `${label}：R1 下仍 400（未从路径补 action）`)
      assertTrue(compatText.includes('action'), `${label}：错误文案指向缺失的 action 字段`)
    }
  }

  // 6. 请求体原样进入 handler（错误回显证明未被改写）
  const queryText = await (
    await compatPOST(fluxRequest({ action: 'not-a-real-action', prompt: 'a cat' }, '/api/flux/text-to-image/pro?foo=bar'))
  ).text()
  assertTrue(queryText.includes('not-a-real-action'), '请求体字段原样进入 handler')

  // 7. 兼容路由源码不含业务逻辑复制
  const source = read(COMPAT_ROUTE_PATH)
  for (const forbidden of [
    'FluxKontextService',
    'checkUserCredits',
    'checkPromptSafety',
    'verifyTurnstileToken',
    'getSessionIdentity',
    'fetch(',
  ]) {
    assertTrue(!source.includes(forbidden), `兼容路由不自行调用「${forbidden}」（业务逻辑仍只在原 handler）`)
  }

  // 8. 请求级错误回 4xx：Core 在分发前拒绝「缺模型要求的输入图」，Flux 不能让它在
  //    产品层变成 GENERATION_FAILED/500 —— 那是客户端写错的请求，不是服务坏了。
  const errorMapping = stripCommentLines(read(FLUX_ROUTE_PATH))
  assertTrue(
    /INVALID_REQUEST[\s\S]{0,160}\?\s*400/.test(errorMapping),
    'flux 路由把 INVALID_REQUEST 映射为 400'
  )

  const serviceMapping = stripCommentLines(read('src/lib/products/flux-kontext/service.ts'))
  assertTrue(
    /task\.error\?\.code[\s\S]{0,240}INVALID_REQUEST[\s\S]{0,240}throw new TaskError\(/.test(
      serviceMapping
    ),
    '产品服务把请求级 task.error.code 原样抛成 TaskError（不并进 GENERATION_FAILED）'
  )
}

async function main() {
  console.log('Flux Kontext 产品专属验证')

  if (!existsSync(path.resolve(ROOT, 'src/lib/products/flux-kontext'))) {
    fail('src/lib/products/flux-kontext 不存在：本脚本是 Flux 的专属回归，产品不在就不该有结论。')
    console.log('\n（由 verify-all 的 @product-scope 判 SKIP；直接手动运行本脚本才会到这里）')
    process.exitCode = 1
    return
  }

  checkPriceSheet()
  checkActionMapping()
  checkPackages()
  checkCapabilities()
  checkVendorTables()
  checkDisplayPrices()
  checkPricingCopy()
  await checkProductRoutes()

  console.log(
    failures === 0
      ? `\n✅ Flux Kontext 产品验证全部通过（共 ${checks} 项检查）`
      : `\n❌ Flux Kontext 产品验证有 ${failures} 项失败（共 ${checks} 项检查）`
  )

  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(`\n❌ 验证异常终止：${error?.message || error}`)
  console.error(error?.stack)
  process.exitCode = 1
})
