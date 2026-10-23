"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Navigation } from "@/components/Navigation"
import { Footer } from "@/components/Footer"
import { ProductSchema } from "@/components/StructuredData"
import { 
  Check, 
  Zap, 
  Crown, 
  Building2, 
  Star,
  AlertTriangle,
  CreditCard,
  Package,
  Loader2
} from "lucide-react"
import { common } from "@/lib/content"
import type {
  FooterContent,
  PricingContentData,
  PricingPlanContent,
  CreditPackContent,
} from "@/lib/content/contracts"
import { replaceSiteTokens } from "@/lib/site-config"

// 分离出使用useSearchParams的组件
function PricingTabHandler({ 
  setActiveTab 
}: { 
  setActiveTab: (tab: string) => void 
}) {
  const searchParams = useSearchParams()

  // 根据URL参数设置初始标签
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'credits') {
      setActiveTab('credits')
    } else if (tab === 'subscription') {
      setActiveTab('subscription')
    }
  }, [searchParams, setActiveTab])

  return null // 这个组件只处理逻辑，不渲染任何内容
}

// 主要的定价内容组件
function PricingMainContent({
  pricing,
  footer,
}: {
  pricing: PricingContentData
  footer: FooterContent
}) {
  const pricingPlans: PricingPlanContent[] = pricing.plans
  const creditPacks: CreditPackContent[] = pricing.creditPacks
  const pricingFAQs = pricing.faq

  const [isYearly, setIsYearly] = useState(true)
  const [activeTab, setActiveTab] = useState("subscription")
  const [loadingPayment, setLoadingPayment] = useState<string | null>(null)

  // 发起支付：客户端**只**发送内部 packageId。
  // 金额、积分、支付渠道商品 id 全部由服务端从套餐配置解析（见 src/config/billing.ts），
  // 任何 price / amount / credits 字段都不会被读取。
  const handlePayment = async (itemKey: string, packageId: string) => {
    try {
      setLoadingPayment(itemKey)

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ packageId }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 401) {
          // 用户未登录，跳转到登录页面
          window.location.href = '/auth/signin?callbackUrl=' + encodeURIComponent(window.location.pathname)
          return
        }
        throw new Error(data.error || 'Payment creation failed')
      }

      if (data.success && data.checkoutUrl) {
        // 跳转到CREEM支付页面
        window.location.href = data.checkoutUrl
      } else {
        throw new Error('Payment link creation failed')
      }

    } catch (error) {
      console.error('Payment processing failed:', error)
      alert(`Payment processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setLoadingPayment(null)
    }
  }

  return (
    <>
      <Navigation />
      
      {/* 添加产品结构化数据 */}
      <ProductSchema />

      {/* Main Content - 优化后的紧凑布局 */}
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-4">
          {/* Header Section - 左对齐编辑风 */}
          <div className="mb-12">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 bg-primary" />
              <span className="text-sm font-semibold tracking-wide text-primary">
                定价
              </span>
            </div>
            <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">
              {pricing.title}
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground md:text-xl">
              {pricing.description}
            </p>
          </div>

          {/* Plan Type Toggle */}
          <div className="mb-8 flex justify-start">
            <div className="app-floating-panel flex rounded-xl p-1">
              <button
                onClick={() => setActiveTab("subscription")}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 ${
                  activeTab === "subscription"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {pricing.tabs.subscriptionPlans}
              </button>
              <button
                onClick={() => setActiveTab("credits")}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 ${
                  activeTab === "credits"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {pricing.tabs.creditPacks}
              </button>
            </div>
          </div>

          {/* Billing Toggle - 只在订阅计划时显示 */}
          {activeTab === "subscription" && (
            <div className="mb-8 flex items-center justify-start">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-medium transition-all duration-300 ${!isYearly ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  {pricing.billing.monthly}
                </span>
                <button
                  onClick={() => setIsYearly(!isYearly)}
                  className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm hover:shadow-md transform hover:scale-105 active:scale-95 ${
                    isYearly 
                      ? 'bg-gradient-to-r from-primary via-accent to-primary focus:ring-primary/40' 
                      : 'bg-gradient-to-r from-muted via-secondary to-muted-foreground/50 focus:ring-primary/20'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-all duration-300 ${
                      isYearly ? 'translate-x-7' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className={`text-sm font-medium transition-all duration-300 ${isYearly ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  {pricing.billing.yearly}
                </span>
                {isYearly && (
                  <Badge variant="outline" className="app-tint-badge app-tint-badge--success ml-2 animate-pulse">
                    {pricing.billing.savePercent}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Subscription Plans */}
          {activeTab === "subscription" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto mb-16">
              {pricingPlans.map((plan) => (
                <div
                  key={plan.id}
                  className={`app-surface-card rounded-2xl p-6 ${
                    plan.isPopular
                      ? 'border-primary shadow-lg shadow-primary/20'
                      : 'border-border hover:border-primary/50'
                  } transition-all duration-300`}
                >
                  {plan.isPopular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                        {common.buttons.mostPopular}
                      </span>
                    </div>
                  )}

                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-foreground mb-2">{plan.name}</h3>
                    <p className="text-muted-foreground text-sm mb-4">{plan.description}</p>
                    <div className="mb-4">
                      <span className="text-3xl font-bold text-foreground">
                        ${isYearly ? plan.yearlyPrice : plan.monthlyPrice}
                      </span>
                      <span className="text-muted-foreground">
                        /{isYearly ? '年' : '月'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    {plan.features.map((feature, index) => (
                      <div key={`${plan.id}-feature-${index}`} className="flex items-center space-x-3">
                        <Check className="h-4 w-4 text-success flex-shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full"
                    variant={plan.isPopular ? "default" : "outline"}
                    disabled={loadingPayment === plan.id}
                    onClick={() => {
                      // 免费档位没有套餐，直接进主功能页
                      if (plan.monthlyPrice === 0 && plan.yearlyPrice === 0) {
                        window.location.href = '/generate'
                        return
                      }

                      if (plan.packageIds) {
                        handlePayment(
                          plan.id,
                          isYearly ? plan.packageIds.yearly : plan.packageIds.monthly
                        )
                      }
                    }}
                  >
                    {loadingPayment === plan.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        处理中...
                      </>
                    ) : (
                      plan.buttonText || "开始使用"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Credit Packs */}
          {activeTab === "credits" && (
            <div id="credits" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto mb-16">
              {creditPacks.map((pack) => (
                <div
                  key={pack.id}
                  className={`app-surface-card rounded-2xl p-6 ${
                    pack.isPopular
                      ? 'border-primary shadow-lg shadow-primary/20'
                      : 'border-border hover:border-primary/50'
                  } transition-all duration-300`}
                >
                  {pack.isPopular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full">
                        {common.buttons.mostPopular}
                      </span>
                    </div>
                  )}

                  <div className="text-center mb-6">
                    <div className="app-icon-surface mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                      <CreditCard className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground mb-2">{pack.name}</h3>
                    <p className="text-muted-foreground text-sm mb-4">{pack.description}</p>
                    <div className="mb-4">
                      <span className="text-3xl font-bold text-foreground">${pack.price}</span>
                      <div className="text-sm text-muted-foreground mt-1">
                        {pack.credits} 积分
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    {pack.features.map((feature, index) => (
                      <div key={`${pack.id}-feature-${index}`} className="flex items-center space-x-3">
                        <Check className="h-4 w-4 text-success flex-shrink-0" />
                        <span className="text-sm text-muted-foreground">{feature}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    className="w-full"
                    variant={pack.isPopular ? "default" : "outline"}
                    disabled={loadingPayment === pack.id}
                    onClick={() => {
                      handlePayment(pack.id, pack.packageId)
                    }}
                  >
                    {loadingPayment === pack.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        处理中...
                      </>
                    ) : (
                      pack.buttonText || "购买"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* FAQ Section */}
          <div className="max-w-4xl mx-auto">
            <div className="mb-8 flex items-center gap-3">
              <span className="h-px w-8 bg-primary" />
              <span className="text-sm font-semibold tracking-wide text-primary">
                直接回答
              </span>
            </div>
            <h2 className="mb-8 text-3xl font-bold tracking-tight">
              常见问题
            </h2>
            <div className="space-y-6">
              {pricingFAQs.map((faq, index) => (
                <div key={index} className="app-surface-card rounded-2xl p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">
                    {faq.question}
                  </h3>
                  <p className="text-muted-foreground">
                    {replaceSiteTokens(faq.answer)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <Footer footer={footer} />

      {/* Suspense包装的URL参数处理器 */}
      <Suspense fallback={null}>
        <PricingTabHandler setActiveTab={setActiveTab} />
      </Suspense>
    </>
  )
}

// 主导出组件，包含Suspense边界
export function PricingContent({
  pricing,
  footer,
}: {
  pricing: PricingContentData
  footer: FooterContent
}) {
  return (
    <div className="min-h-screen bg-background">
      <Suspense fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground">加载定价中...</p>
          </div>
        </div>
      }>
        <PricingMainContent pricing={pricing} footer={footer} />
      </Suspense>
    </div>
  )
} 
