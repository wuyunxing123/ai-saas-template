import type { Metadata } from 'next'
import { HomeContentSimple } from '@/components/HomeContentSimple'
import { generateLocalizedHomeMetadata } from '@/lib/seo/metadata-generator'

export const metadata: Metadata = generateLocalizedHomeMetadata({
  locale: 'en',
  title: 'Flux Kontext AI - Professional AI Image Generation Platform | Create Stunning Images',
  description: 'Turn your ideas into professional images with our cutting-edge AI technology. Generate images from text, edit existing images, and process multiple images with the power of Flux Kontext AI.',
  keywords: ['AI image generation', 'text to image', 'image editing', 'Flux Kontext', 'artificial intelligence', 'professional images'],
})

const enDictionary = {
  hero: {
    badge: "Professional AI Image Generation Platform",
    title: "Create stunning images with",
    subtitle: "Flux Kontext AI",
    description: "Turn your ideas into professional images with our cutting-edge AI technology. Generate images from text, edit existing images, and process multiple images with the power of Flux Kontext AI.",
    cta: {
      primary: "Start Creating",
      secondary: "View Pricing"
    }
  },
  features: {
    title: "Key features of the Flux Kontext AI platform",
    subtitle: "Our Flux Kontext AI combines cutting-edge technology to deliver professional image generation and editing in one seamless platform.",
    items: [
      {
        title: "Text-to-image generation",
        description: "Transform your text descriptions into stunning, high-quality images with advanced AI technology."
      },
      {
        title: "Professional image editing",
        description: "Edit existing images with natural language instructions for precise modifications."
      },
      {
        title: "Multi-image processing",
        description: "Process multiple images simultaneously with consistent style and quality."
      }
    ]
  },
  faq: {
    title: "Frequently asked questions",
    subtitle: "Find answers to common questions about our Flux Kontext AI platform and its powerful image generation features.",
    items: [
      {
        question: "What is Flux Kontext AI?",
        answer: "Flux Kontext AI is an advanced image generation platform that uses cutting-edge artificial intelligence to create stunning images from text descriptions, edit existing images, and process multiple images simultaneously."
      },
      {
        question: "How does text-to-image generation work?",
        answer: "Our AI analyzes your text description and generates high-quality images using advanced Flux Pro and Max models. Simply describe what you want to see, and our AI creates professional-grade images in seconds."
      }
    ]
  },
  cta: {
    title: "Ready to create stunning images?",
    subtitle: "Join thousands of creators using Flux Kontext AI to bring their ideas to life.",
    button: "Get Started Now"
  },
  footer: {
    brand: {
      name: "Flux Kontext",
      description: "Professional AI image generation platform. Create stunning images from text, edit existing images, and process multiple images with advanced AI technology.",
      copyright: "© 2025 Flux Kontext. All rights reserved."
    },
    contact: {
      title: "Contact",
      email: "{{supportEmail}}"
    },
    legal: {
      title: "Legal",
      terms: "Terms of Service",
      privacy: "Privacy Policy",
      refund: "Refund Policy"
    },
    languages: {
      title: "Languages"
    },
    social: {
      builtWith: "Built with ❤️ for creators worldwide",
      followUs: "Follow us on"
    }
  }
}

export default function EnglishPage() {
  return <HomeContentSimple dictionary={enDictionary} />
}
