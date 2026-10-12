/**
 * Flux 产品的积分成本查询。
 *
 * 边界（规格 §17）：**价格计算属产品层**，账本操作（consume / refund）属基础设施。
 * 因此这里只把 action 翻译成「需要多少积分」，实际扣减/退款由
 * `WorkflowService` → `CreditService`（原子 RPC）完成。
 *
 * Phase 9.8.2-C：成本真相从 `src/config/credits.ts` 的 `CREDIT_COSTS`
 * 迁到模型目录的 `credits` 字段（`catalogue.ts`）—— 那份 Core 里的表键全是 `flux-*`，
 * 本来就是产品数据。现在 UI 展示与 `WorkflowService` 扣减读的是同一个字段，
 * 「两处价格靠人工一致」这一类缺陷从结构上消失。
 *
 * ⚠️ 不再有「未知 action 回退到 Pro 档价格」的兜底：
 *   旧实现打一行 warn 然后按 15 积分继续，等于把配置错误伪装成正常定价。
 *   调用方（`/api/flux-kontext`）在更早处已校验 action 合法性，这里抛错只可能
 *   来自真正的登记缺失，应当让请求失败。
 *
 * 原位置 `src/lib/flux-kontext-request.ts` 的 `getRequiredCredits()`。
 */

import { actionToModelId } from '@/lib/products/flux-kontext/actions'
import { FLUX_MODELS } from '@/lib/products/flux-kontext/catalogue'
import { FLUX_KONTEXT_ACTIONS } from '@/lib/products/flux-kontext/types'

/** 查询某个 Flux action 需要多少积分。未知 action / 未登记成本都抛错。 */
export function getRequiredCredits(action: string): number {
  const modelId = actionToModelId(action)

  if (!modelId) {
    throw new Error(
      `Unknown Flux action "${action}". Supported: ${FLUX_KONTEXT_ACTIONS.join(', ')}`
    )
  }

  const model = FLUX_MODELS[modelId]

  if (!model) {
    throw new Error(
      `Flux action "${action}" maps to model "${modelId}", but that model has no entry in the Flux catalogue`
    )
  }

  return model.credits
}
