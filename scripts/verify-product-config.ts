#!/usr/bin/env node
/**
 * 产品配置完整性验证（Phase 9.8.2-C）
 *
 * 这份脚本要证明的不是「文档里说了解耦」，而是四件可判定的事：
 *
 *   1. 每个产品目录（`src/lib/products/<id>/config.ts`）都能被**枚举**出来，
 *      并且 `validateProductConfig()` 对它返回**零问题** —— 模型 / 成本 /
 *      Provider 映射 / 套餐 / 免费档缺一项就失败。
 *   2. 同一套校验器对**预先设计的违规样例**必须报错，且错误信息点名到
 *      具体配置键（否则「通过」没有信息量）。
 *   3. 未绑定产品时 Core 的查询必须抛错（子进程实测，绝不静默回退）。
 *   4. Core 里不再持有产品数据：产品**自己声明**的识别词汇（bundle 派生的模型 id /
 *      套餐 id / 渠道商品 id，加上 `vocabulary.ts` 里的 endpoint、action、厂商枚举）
 *      在 Core 代码（去注释后）里一个都不许出现。同时反证词汇表不是凑数的空集合。
 *
 * 运行：
 *   node scripts/run-ts.mjs scripts/verify-product-config.ts
 */

import '@/app/product-runtime'

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  bindProductConfig,
  getBoundProductId,
  getProductConfig,
  hasProductConfig,
  validateProductConfig,
} from '@/config/product'
import type { ProductConfig } from '@/config/product'
import {
  codeMentions,
  discoveredProductIds,
  isDistinctiveTerm,
  loadProductBundle,
  unusedVocabularyTerms,
  vocabularyOf,
} from './product-discovery'

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

function assertTrue(condition: boolean, label: string) {
  if (condition) ok(label)
  else fail(label)
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) ok(`${label} = ${JSON.stringify(actual)}`)
  else fail(`${label} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

const ROOT = path.resolve(process.cwd())

/** 浅层可变的 bundle 副本（Provider 实例按引用保留 —— 它们不是被改动的对象）。 */
function cloneBundle(bundle: ProductConfig): ProductConfig {
  return {
    ...bundle,
    models: Object.fromEntries(
      Object.entries(bundle.models).map(([key, model]) => [key, { ...model, providers: [...model.providers] }])
    ),
    providers: [...bundle.providers],
    billingPackages: Object.fromEntries(
      Object.entries(bundle.billingPackages).map(([key, pkg]) => [key, { ...pkg }])
    ),
    freePlan: { ...bundle.freePlan },
  }
}

/** 去掉注释与字符串外的行，只留**代码**。 */
function stripComments(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function listFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) listFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

async function main() {
  console.log('产品配置完整性验证\n')

  // ── 1. 产品目录枚举 + 完整性 ───────────────────────────────────────
  console.log('▶ 1. 产品目录自述完整（枚举，不硬编码产品名）')

  const productIds = discoveredProductIds()

  assertTrue(
    productIds.length > 0,
    `发现 ${productIds.length} 个产品目录：${productIds.join(', ') || '（无）'}`
  )

  const bundles: Array<{ productId: string; bundle: ProductConfig }> = []

  for (const dirName of productIds) {
    // 按**形状**而不是导出名取 bundle，所以第二个产品不必沿用 `FLUX_KONTEXT_PRODUCT`。
    const bundle = await loadProductBundle(dirName)

    if (!bundle) {
      fail(`src/lib/products/${dirName}/config.ts 没有导出形状正确的 ProductConfig`)
      continue
    }

    const errors = validateProductConfig(bundle)

    if (errors.length === 0) {
      ok(
        `${bundle.productId}: ${Object.keys(bundle.models).length} 个模型 / ` +
          `${bundle.providers.length} 个 Provider / ${Object.keys(bundle.billingPackages).length} 个套餐 全部完整`
      )
    } else {
      fail(`${bundle.productId}: 配置不完整（${errors.length} 项）`)
      for (const e of errors) info(`  · ${e}`)
    }

    bundles.push({ productId: bundle.productId, bundle })
  }

  assertEqual(
    bundles.some((b) => b.productId === getBoundProductId()),
    true,
    '接缝绑定的产品出现在枚举结果里'
  )

  const bound = getProductConfig()

  // ── 2. 预先设计的违规样例必须被判出 ────────────────────────────────
  console.log('\n▶ 2. 违规样例必须报错（证明判据有效）')

  const violationCases: Array<{
    label: string
    expect: string
    mutate: (b: ProductConfig) => void
  }> = [
    {
      label: '模型声明了未捆绑的 Provider',
      expect: 'no such provider is bundled',
      mutate: (b) => {
        const first = Object.keys(b.models)[0]
        b.models[first].providers = ['ghost'] as never
      },
    },
    {
      label: 'Provider 映射了目录里不存在的模型',
      expect: 'is not declared',
      mutate: (b) => {
        b.providers[0].models = [...b.providers[0].models, 'ghost-model']
      },
    },
    {
      label: '模型缺 credits',
      expect: 'credits must be a positive integer',
      mutate: (b) => {
        const first = Object.keys(b.models)[0]
        b.models[first].credits = undefined as unknown as number
      },
    },
    {
      label: '订阅套餐缺 planId',
      expect: 'has no planId',
      mutate: (b) => {
        const sub = Object.values(b.billingPackages).find((p) => p.type === 'subscription')!
        delete sub.planId
      },
    },
    {
      label: '积分包却声明了 billingCycle',
      expect: 'credit_pack but declares billingCycle',
      mutate: (b) => {
        const pack = Object.values(b.billingPackages).find((p) => p.type === 'credit_pack')!
        pack.billingCycle = 'monthly'
      },
    },
    {
      label: '套餐 key 与 id 不一致',
      expect: 'but the key is',
      mutate: (b) => {
        Object.values(b.billingPackages)[0].id = 'renamed'
      },
    },
    {
      label: '免费档价格不为 0',
      expect: 'freePlan.priceMinor must be 0',
      mutate: (b) => {
        b.freePlan.priceMinor = 100
      },
    },
    {
      label: '免费档 id 与付费套餐撞名',
      expect: 'collides with a paid packageId',
      mutate: (b) => {
        b.freePlan.id = Object.keys(b.billingPackages)[0]
      },
    },
    {
      label: 'Provider 重名',
      expect: 'duplicate provider name',
      mutate: (b) => {
        b.providers = [b.providers[0], b.providers[0]]
      },
    },
    {
      label: '模型目录为空',
      expect: 'at least one model is required',
      mutate: (b) => {
        b.models = {}
      },
    },
    {
      label: 'defaultProvider 不在自己的 providers 里',
      expect: 'is not in its providers list',
      mutate: (b) => {
        const first = Object.keys(b.models)[0]
        b.models[first].providers = ['kie'] as never
        b.models[first].defaultProvider = 'fal' as never
      },
    },
  ]

  for (const violation of violationCases) {
    const broken = cloneBundle(bound)
    violation.mutate(broken)
    const errors = validateProductConfig(broken)
    const hit = errors.find((e) => e.includes(violation.expect))

    if (hit) {
      ok(`${violation.label} → ${hit.slice(0, 96)}`)
    } else {
      fail(`${violation.label} 未被检出（期望错误含 "${violation.expect}"，实际 ${errors.length} 条）`)
    }
  }

  // 拒绝的绑定不得污染已有状态
  const brokenForBind = cloneBundle(bound)
  brokenForBind.models[Object.keys(brokenForBind.models)[0]].credits = 0
  let bindThrew = false

  try {
    bindProductConfig(brokenForBind)
  } catch {
    bindThrew = true
  }

  assertTrue(bindThrew, '不完整的 bundle 无法通过 bindProductConfig 装入')
  assertEqual(getBoundProductId(), bound.productId, '被拒绝的绑定没有改变进程内状态')

  // ── 3. 未绑定必须抛错（子进程，无接缝 import） ──────────────────────
  console.log('\n▶ 3. 未绑定产品时 Core 查询必须抛错')

  const probe = spawnSync(process.execPath, ['scripts/run-ts.mjs', 'scripts/probe-product-config-unbound.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })

  if (probe.status === 0 && /PROBE_OK/.test(probe.stdout)) {
    const hits = probe.stdout.split('\n').filter((line) => line.startsWith('PROBE_HIT')).length
    ok(`${hits} 个 Core 查询在未绑定进程中全部显式抛错（探针 exit=0）`)
  } else {
    fail(`探针子进程未按预期失败（exit=${probe.status}）`)
    info(probe.stdout)
    info(probe.stderr)
  }

  // ── 4. Core 不持有产品数据（词汇中性，数据驱动） ────────────────────
  console.log('\n▶ 4. Core 代码里不得出现产品数据')

  const CORE_DIRS = [
    'src/lib/ai',
    'src/lib/workflow',
    'src/lib/services',
    'src/lib/storage',
    'src/lib/billing',
    'src/lib/db',
    'src/lib/content-safety',
    'src/lib/seo',
    'src/lib/admin',
    'src/lib/utils',
    'src/config',
    'src/components/ui',
  ]

  const vendorExemptionOf = (file: string) => {
    const m = /[\\/]([^\\/]+)\.ts$/.exec(file)
    return path.basename(path.dirname(file)) === 'providers' && m ? m[1] : null
  }

  /** 「这段代码提到了该产品的词汇吗」——区分度分档见 product-discovery。 */
  const mentions = codeMentions

  // 词汇表来自**被验证的产品自己**（bundle 派生 + 产品声明），不是脚本里写死的清单。
  // 守卫硬写 Flux 词汇 = 换产品后仍在检查上一个产品的字面量。
  const vocabularies: Array<{ productId: string; terms: string[] }> = []

  for (const { productId, bundle } of bundles) {
    const terms = vocabularyOf(productId, bundle)
    vocabularies.push({ productId, terms })

    // 反证：产品不能只写两个「永远不会出现在 Core」的词来填满扫描。
    const unused = unusedVocabularyTerms(productId, terms)

    assertTrue(
      unused.length === 0,
      unused.length === 0
        ? `${productId}: 声明的 ${terms.length} 个词汇都真的用在自己的源码里`
        : `${productId}: 词汇表里有 ${unused.length} 个词在产品目录内零使用（凑数）：${unused.join(', ')}`
    )
  }

  const vocabulary = [...new Set(vocabularies.flatMap((v) => v.terms))]

  const offenders: string[] = []
  const rawHits: string[] = []

  for (const dir of CORE_DIRS) {
    for (const file of listFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      const raw = readFileSync(file, 'utf8')
      const code = stripComments(raw)
      const ownVendor = vendorExemptionOf(file)

      for (const term of vocabulary) {
        // 厂商引擎文件允许出现**自己那家**的名字（它是该厂商的通用机制实现）
        if (ownVendor && term === ownVendor) continue

        if (mentions(code, term)) offenders.push(`${rel} → 代码含产品数据 "${term}"`)
        if (raw.includes(term)) rawHits.push(`${rel} → 注释含 "${term}"`)
      }
    }
  }

  if (offenders.length === 0) {
    ok(
      `${CORE_DIRS.length} 个 Core 目录里，${vocabulary.length} 个产品词汇（模型 id / action / 套餐 id / endpoint / 宽高比）` +
        '在**代码**中零出现'
    )
  } else {
    for (const o of offenders) fail(o)
  }

  info(`（说明性注释里另有 ${rawHits.length} 处提及；注释不构成运行时依赖，仅在此列出备查）`)

  // 反证：词汇表本身不是空的，否则第 4 节是空跑
  assertTrue(vocabulary.length >= 10, `词汇表有 ${vocabulary.length} 项（反证：判据不是空集合）`)

  // 反证：把词汇表喂给一个含产品数据的文件，必须被抓到。
  // 用**真实词汇**合成样例，所以第二个产品同样有这条反证（不需要产品字面量）。
  // 两个档位各取一个：带分隔符的词（子串匹配）与纯小写词（字面量匹配）。
  const plantedTerms = [
    vocabulary.find(isDistinctiveTerm),
    vocabulary.find((term) => /^[a-z]+$/.test(term)),
  ].filter(Boolean) as string[]

  const planted = stripComments(plantedTerms.map((term) => `const x = '${term}'`).join('\n'))
  const plantedHits = vocabulary.filter((term) => mentions(planted, term))

  assertTrue(
    plantedHits.length >= plantedTerms.length,
    `合成的「Core 里写死产品数据」样例被检出 ${plantedHits.length}/${plantedTerms.length} 档词汇`
  )

  // ── 5. Core 机制不再持有数据字面量 ─────────────────────────────────
  console.log('\n▶ 5. Core 查询层只剩机制')

  for (const rel of ['src/lib/ai/models.ts', 'src/config/billing.ts', 'src/lib/ai/providers/index.ts']) {
    const code = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'))
    assertTrue(
      !/\b(?:credits|priceMinor):\s*\d+/.test(code),
      `${rel} 里没有数字字面量的成本/价格数据`
    )
    assertTrue(!/\bmodels:\s*\{[\s\S]*\bid:/.test(code), `${rel} 里没有内联模型表`)
  }

  assertTrue(
    stripComments(readFileSync(path.join(ROOT, 'src/lib/ai/utils.ts'), 'utf8')).includes('aspectRatio') === false,
    'ai/utils.ts 不再内置宽高比映射（能力表归产品）'
  )

  console.log(
    failures === 0
      ? `\n✅ 产品配置完整性验证全部通过（共 ${checks} 项检查）`
      : `\n❌ 产品配置完整性验证有 ${failures} 项失败（共 ${checks} 项检查）`
  )

  process.exitCode = failures === 0 ? 0 : 1
}

main().catch((error) => {
  console.error(`\n❌ 验证异常终止：${error?.message || error}`)
  console.error(error?.stack)
  process.exitCode = 1
})
