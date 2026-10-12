import type { Metadata } from 'next'
import { PricingContent } from '@/components/PricingContent'
import { productContent } from '@/app/product-content'
import { generateMultilingualMetadata } from '@/lib/seo/metadata-generator'

export const metadata: Metadata = generateMultilingualMetadata({
  title: 'Pricing Plans - Flux Kontext AI Image Generation | Affordable AI Art',
  description: 'Choose the perfect plan for your AI image generation needs. Flux Kontext offers flexible pricing for professional AI image creation, editing, and processing.',
  keywords: [
    'flux kontext pricing',
    'ai image generation pricing',
    'flux ai plans',
    'ai art pricing',
    'professional ai images cost',
    'flux kontext subscription',
    'ai image generator plans',
    'affordable ai art'
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
