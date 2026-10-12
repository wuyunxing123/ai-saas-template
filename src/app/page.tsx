import type { Metadata } from 'next'
import { HomeContent } from '@/components/HomeContent'
import { productContent } from '@/app/product-content'
import { generateMultilingualMetadata } from '@/lib/seo/metadata-generator'

export const metadata: Metadata = generateMultilingualMetadata({
  title: 'Flux Kontext AI - Professional AI Image Generation & Editing Platform',
  description: 'Advanced AI image generation platform powered by Flux Kontext. Create stunning images from text, edit existing images, and process multiple images with cutting-edge AI technology.',
  keywords: [
    'flux kontext ai', 
    'ai image generation', 
    'text to image ai',
    'ai image editing',
    'flux ai generator',
    'professional ai images',
    'multi-image processing',
    'ai image creator',
    'flux kontext platform',
    'advanced image ai',
    'ai powered imaging',
    'flux image generation',
    'kontext ai technology',
    'professional image creation',
    'ai visual content'
  ],
  path: '/',
  images: ['/og-home.png'],
})

export default function Home() {
  return <HomeContent home={productContent.home} seo={productContent.seo} />
}
