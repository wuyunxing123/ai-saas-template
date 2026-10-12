import type { Metadata } from 'next'
import { ResourcesContent } from '@/components/ResourcesContent'
import { productContent } from '@/app/product-content'

export const metadata: Metadata = {
  title: 'AI Image Generation Resources - Flux Kontext | Free Tools & Guides',
  description: 'Free AI image generation resources and tools by Flux Kontext. Learn how to create professional images with AI. Tutorials, guides, and tips for AI art creation.',
  keywords: [
    'flux kontext resources',
    'ai image generation guide', 
    'flux ai tutorials',
    'free ai image tools',
    'ai art creation guide',
    'flux kontext tutorials',
    'ai image generation tips',
    'professional ai art resources'
  ],
  alternates: {
    canonical: '/resources',
  },
  openGraph: {
    title: 'AI Image Generation Resources - Flux Kontext',
    description: 'Free AI image generation resources and tools by Flux Kontext. Learn how to create professional images with AI.',
    url: '/resources',
    images: [
      {
        url: '/og-resources.png',
        width: 1200,
        height: 630,
        alt: 'Flux Kontext AI Image Generation Resources',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Image Generation Resources - Flux Kontext',
    description: 'Free AI image generation resources and tools by Flux Kontext',
    images: ['/twitter-resources.png'],
  },
}

export default function ResourcesPage() {
  return <ResourcesContent footer={productContent.home.footer} />
} 