import type { Metadata } from 'next'
import { HomeContent } from '@/components/HomeContent'
import { productContent } from '@/app/product-content'
import { generateMultilingualMetadata } from '@/lib/seo/metadata-generator'

export const metadata: Metadata = generateMultilingualMetadata({
  title: 'Flux Kontext AI - 专业 AI 图像生成与编辑平台',
  description: '基于 Flux Kontext 的先进 AI 图像生成平台：从文字生成图像、编辑现有图像、批量处理多图，一个工作台完成全部创作。',
  keywords: [
    'flux kontext ai',
    'ai 图像生成',
    '文字生成图像',
    'ai 修图',
    'flux ai 生成器',
    '多图批量处理',
    'ai 图像创作',
    '专业图像生成'
  ],
  path: '/',
  images: ['/og-home.png'],
})

export default function Home() {
  return <HomeContent home={productContent.home} seo={productContent.seo} />
}
