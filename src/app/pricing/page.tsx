import type { Metadata } from 'next'
import { PricingContent } from '@/components/PricingContent'
import { productContent } from '@/app/product-content'
import { generateMultilingualMetadata } from '@/lib/seo/metadata-generator'

export const metadata: Metadata = generateMultilingualMetadata({
  title: '定价方案 - Flux Kontext AI 图像生成 | 灵活的创作套餐',
  description: '按你的 AI 图像生成需求选择合适的方案：从免费入门到专业级订阅与积分包。',
  keywords: [
    'flux kontext 定价',
    'ai 图像生成 价格',
    'flux ai 方案',
    'ai 艺术 定价',
    '专业图像 成本',
    'flux kontext 订阅',
    'ai 图像生成器 套餐',
    '平价 ai 艺术'
  ],
  path: '/pricing',
  images: ['/og-pricing.png'],
})

export default function PricingPage() {
  return (
    <PricingContent
      pricing={productContent.pricing}
      footer={productContent.home.footer}
    />
  )
}
