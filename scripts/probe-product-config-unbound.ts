#!/usr/bin/env node
/**
 * 「未绑定产品」探针（必须在**独立子进程**里跑）
 *
 * @seam deliberate-unbound —— 本文件故意不 import `@/app/product-runtime`：
 * 它要证明的就是接缝缺失时 Core 查询会**抛错**，而不是拿着默认模型 / 默认价格继续跑。
 * 主验证脚本用 spawnSync 起一个干净的 Node 进程来跑它（同一进程里已被绑定，探针就无意义了）。
 *
 * 运行：node scripts/run-ts.mjs scripts/probe-product-config-unbound.ts
 */

import { getBillingPackage, getFreePlan, listBillingPackages } from '@/config/billing'
import { getModel, listModels } from '@/lib/ai/models'
import { getAIProvider, listAIProviderNames } from '@/lib/ai/providers'
import { getBoundProductId, hasProductConfig } from '@/config/product'

import { discoveredProductIds, loadProductBundle } from './product-discovery'

let bad = 0

function expectThrow(fn: () => unknown, label: string) {
  try {
    const value = fn()
    console.log(`PROBE_FAIL ${label} 没有抛错，返回 ${JSON.stringify(value)?.slice(0, 60)}`)
    bad += 1
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/No product configuration is bound/.test(message)) {
      console.log(`PROBE_FAIL ${label} 抛了别的错：${message}`)
      bad += 1
      return
    }
    console.log(`PROBE_HIT ${label} → ${message.slice(0, 60)}`)
  }
}

/**
 * 探针要拿**真实存在的 id** 去查：用一个不存在的 id 时「抛错」可能只是因为
 * 那个 id 不存在，证明不了「未绑定就连合法查询都拒绝」。
 *
 * id 来自产品目录的**数据文件**（不 import 接缝，所以不会把 bundle 绑上）。
 * 产品目录还没装时（纯母版状态）退回中性 id，检查仍然成立，只是弱一档。
 */
async function realIds(): Promise<{ modelId: string; packageId: string; providerName: string }> {
  for (const productId of discoveredProductIds()) {
    const bundle = await loadProductBundle(productId)
    if (!bundle) continue

    const modelId = Object.keys(bundle.models)[0]
    const packageId = Object.keys(bundle.billingPackages)[0]
    const providerName = bundle.providers[0]?.name ?? 'fal'

    if (modelId && packageId) return { modelId, packageId, providerName }
  }

  return { modelId: 'no-such-model', packageId: 'no-such-package', providerName: 'fal' }
}

async function main() {
  const { modelId, packageId, providerName } = await realIds()

  console.log(`unbound=${hasProductConfig() ? 'bound(!)' : 'no'} productId=${String(getBoundProductId())}`)
  console.log(`PROBE_IDS model=${modelId} package=${packageId} provider=${providerName}`)

  expectThrow(() => getModel(modelId), 'getModel()')
  expectThrow(() => listModels(), 'listModels()')
  expectThrow(() => listAIProviderNames(), 'listAIProviderNames()')
  expectThrow(() => getAIProvider(providerName), 'getAIProvider()')
  expectThrow(() => getBillingPackage(packageId), 'getBillingPackage()')
  expectThrow(() => listBillingPackages(), 'listBillingPackages()')
  expectThrow(() => getFreePlan(), 'getFreePlan()')

  if (bad > 0) {
    console.log('PROBE_FAILED')
    process.exitCode = 1
  } else {
    console.log('PROBE_OK 所有 Core 查询在未绑定时都显式失败')
  }
}

main()
