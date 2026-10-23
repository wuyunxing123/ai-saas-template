/**
 * 产品内容契约（Phase 9.8.2）
 *
 * 这里只有**产品无关的内容形状**，没有任何产品文案本身：
 *   · 共享组件（`src/components/*`）只认这些 interface，不再 import 具体产品；
 *   · 产品文案数据在 `src/lib/products/<name>/content/*.json`；
 *   · 唯一的装配点在 `src/app/product-content.ts`（app 层把产品数据对接到这些形状）。
 *
 * 依赖方向：Core 定义形状 → Product 提供数据 → app 层装配。
 * **本文件不得 import `@/lib/products/**`。**
 */

export interface FaqItem {
  question: string
  answer: string
}

export interface HeroContent {
  badge: string
  title: string
  description: string
}

export interface FeatureItem {
  title: string
  description: string
}

export interface FeaturesContent {
  title: string
  description: string
  items: FeatureItem[]
}

export interface HowToStepContent {
  number: string
  title: string
  description: string
}

export interface HowToContent {
  title: string
  description: string
  alternativeTitle: string
  alternativeDescription: string
  steps: HowToStepContent[]
}

export interface FaqContent {
  title: string
  description: string
  items: FaqItem[]
}

export interface FooterContent {
  brand: {
    name: string
    description: string
    copyright: string
  }
  contact: {
    title: string
    email: string
  }
  legal: {
    title: string
    terms: string
    privacy: string
    refund: string
  }
  languages: {
    title: string
  }
  social: {
    builtWith: string
    followUs: string
  }
}

export interface ShowcaseContent {
  title: string
  description: string
  scrollHint: string
}

export interface ToolboxItem {
  title: string
  description: string
  tags: string[]
  href: string
  cta: string
}

export interface ToolboxContent {
  eyebrow: string
  title: string
  description: string
  items: ToolboxItem[]
}

export interface TestimonialItem {
  avatar: string
  name: string
  role: string
  quote: string
  tags: string[]
}

export interface TestimonialsContent {
  eyebrow: string
  title: string
  description: string
  items: TestimonialItem[]
}

export interface FinalCtaContent {
  title: string
  description: string
  button: string
}

export interface HomeContentData {
  hero: HeroContent
  features: FeaturesContent
  howTo: HowToContent
  toolbox: ToolboxContent
  testimonials: TestimonialsContent
  faq: FaqContent
  finalCta: FinalCtaContent
  footer: FooterContent
  twitterShowcase: ShowcaseContent
}

export interface PricingPlanContent {
  id: string
  name: string
  description: string
  monthlyPrice: number
  yearlyPrice: number
  /**
   * 内部 packageId（订阅按周期拆分，如 `plus_monthly` / `plus_yearly`）。
   *
   * 客户端**只**发送这个稳定标识符；支付渠道商品 id 由服务端从套餐配置解析，
   * 绝不出现在前端内容里。免费档位没有。
   */
  packageIds?: {
    monthly: string
    yearly: string
  }
  features: string[]
  isPopular?: boolean
  buttonText: string
}

export interface CreditPackContent {
  id: string
  name: string
  description: string
  credits: number
  price: number
  /** 内部 packageId（如 `starter`），服务端据此查出金额与渠道商品 id。 */
  packageId: string
  features: string[]
  isPopular?: boolean
  buttonText: string
}

export interface PricingContentData {
  title: string
  description: string
  tabs: {
    subscriptionPlans: string
    creditPacks: string
  }
  billing: {
    monthly: string
    yearly: string
    savePercent: string
  }
  plans: PricingPlanContent[]
  creditPacks: CreditPackContent[]
  notice: {
    title: string
    content: string
  }
  faq: FaqItem[]
}

export interface SeoContentData {
  meta: {
    title: string
    description: string
    keywords: string[]
  }
  openGraph: {
    title: string
    description: string
  }
  twitter: {
    title: string
    description: string
  }
  structuredData: {
    organization: {
      name: string
      description: string
      contactType: string
      availableLanguage: string[]
      addressCountry: string
    }
    software: {
      name: string
      description: string
      applicationCategory: string
      operatingSystem: string
      freeDescription: string
      features: string[]
    }
    service: {
      name: string
      description: string
      plans: {
        free: string
        plus: string
        pro: string
        enterprise: string
      }
    }
  }
}

/**
 * 首页多语言字典。原本定义在产品模块（`products/flux-kontext/home-config.ts`），
 * 因为 16 个语言页和共享组件都只依赖它的**形状**，故上移为 Core 契约。
 */
export interface HomeDictionary {
  hero: {
    badge: string
    title: string
    subtitle: string
    description: string
    cta: {
      primary: string
      secondary: string
    }
  }
  features: {
    title: string
    subtitle: string
    items: Array<{
      title: string
      description: string
    }>
  }
  faq: {
    title: string
    subtitle: string
    items: Array<{
      question: string
      answer: string
    }>
  }
  cta: {
    title: string
    subtitle: string
    button: string
  }
  footer: {
    brand: {
      name: string
      description: string
      copyright: string
    }
    contact: {
      title: string
      email: string
    }
    legal: {
      title: string
      terms: string
      privacy: string
      refund: string
    }
    languages: {
      title: string
    }
    social: {
      builtWith: string
      followUs: string
    }
  }
}

/** 装配点导出的整体形状。`footer` / `twitterShowcase` 是 `home` 的子切片。 */
export interface ProductContent {
  home: HomeContentData
  pricing: PricingContentData
  seo: SeoContentData
}
