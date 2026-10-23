"use client"

import Link from "next/link"
import Script from "next/script"
import { Button } from "@/components/ui/button"
import { Navigation } from "@/components/Navigation"
import { TwitterShowcase } from "@/components/TwitterShowcase"
import { KeyFeatures } from "@/components/KeyFeatures"
import { HowToSteps } from "@/components/HowToSteps"
import { Toolbox } from "@/components/Toolbox"
import { Testimonials } from "@/components/Testimonials"
import { FAQ } from "@/components/FAQ"
import { FinalCta } from "@/components/FinalCta"
import { Footer } from "@/components/Footer"
import { OrganizationSchema, WebSiteSchema, SoftwareApplicationSchema } from "@/components/StructuredData"
import { common } from "@/lib/content"
import type { HomeContentData, SeoContentData } from "@/lib/content/contracts"
import { siteConfig } from "@/lib/site-config"

export function HomeContent({
  home,
  seo,
}: {
  home: HomeContentData
  seo: SeoContentData
}) {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <Navigation />

      {/* 结构化数据 - Structured Data */}
      <OrganizationSchema />
      <WebSiteSchema />
      <SoftwareApplicationSchema />

      {/* JSON-LD 应用程序数据 */}
      <Script
        id="structured-data"
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            "name": "Flux Kontext AI",
            "description": seo.meta.description,
            "url": siteConfig.siteUrl,
            "applicationCategory": "ImageEditingApplication",
            "operatingSystem": "Web Browser",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD",
              "description": "Professional AI image generation and editing"
            },
            "creator": {
              "@type": "Organization",
              "name": "Flux Kontext AI"
            }
          })
        }}
      />

      {/* Hero Section */}
      <section className="px-4 pt-32 pb-16">
        <div className="container mx-auto max-w-5xl">
          <div className="mb-6 flex items-center gap-3">
            <span className="h-px w-8 bg-primary" />
            <span className="text-sm font-semibold tracking-wide text-primary">
              {home.hero.badge}
            </span>
          </div>
          <h1 className="mb-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            {home.hero.title}
          </h1>
          <p className="mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            {home.hero.description}
          </p>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link href="/generate">
              <Button
                size="lg"
                className="rounded-full bg-foreground px-8 py-3 text-base text-background transition-colors hover:bg-foreground/90"
              >
                {common.buttons.startCreating}
              </Button>
            </Link>
            <Link href="/pricing">
              <Button
                variant="outline"
                size="lg"
                className="rounded-full border-border bg-transparent px-8 py-3 text-base transition-colors hover:bg-muted"
              >
                {common.buttons.viewPricing}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Twitter展示区域 */}
      <TwitterShowcase twitterShowcase={home.twitterShowcase} />

      {/* Key Features Section */}
      <KeyFeatures features={home.features} />

      {/* How-to Steps Section */}
      <HowToSteps howTo={home.howTo} />

      {/* Toolbox Section */}
      <Toolbox toolbox={home.toolbox} />

      {/* Testimonials Section */}
      <Testimonials testimonials={home.testimonials} />

      {/* FAQ Section */}
      <FAQ faq={home.faq} />

      {/* Final CTA Section */}
      <FinalCta finalCta={home.finalCta} />

      {/* Footer */}
      <Footer footer={home.footer} />

      {/* 推特脚本 - 确保推特内容正常加载 */}
      <Script 
        src="https://platform.twitter.com/widgets.js" 
        strategy="lazyOnload"
      />
    </div>
  )
} 
