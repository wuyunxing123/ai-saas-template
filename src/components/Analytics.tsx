import Script from 'next/script'

// 自定义分析服务组件 (支持 click.pageview.click 等第三方服务)
export function CustomAnalytics() {
  const domain = process.env.NEXT_PUBLIC_CUSTOM_ANALYTICS_DOMAIN
  const scriptUrl = process.env.NEXT_PUBLIC_CUSTOM_ANALYTICS_URL
  
  // 如果没有配置域名或脚本URL，则不加载
  if (!domain || !scriptUrl) {
    return null
  }

  return (
    <Script
      defer
      data-domain={domain}
      src={scriptUrl}
      strategy="afterInteractive"
    />
  )
}

// Plausible Analytics 组件
export function PlausibleAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
  
  // 如果没有配置域名，则不加载脚本
  if (!domain) {
    return null
  }

  return (
    <Script
      defer
      data-domain={domain}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  )
}

// Google Analytics 组件
export function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID
  
  if (!gaId) {
    return null
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}');
        `}
      </Script>
    </>
  )
}

// Microsoft Clarity 组件 - 微软免费用户行为分析
export function MicrosoftClarity() {
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID
  
  if (!clarityId) {
    return null
  }

  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {`
        (function(c,l,a,r,i,t,y){
          c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
          t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
          y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${clarityId}");
      `}
    </Script>
  )
}

// OpenPanel Analytics 组件 - 开源分析工具
export function OpenPanelAnalytics() {
  const clientId = process.env.NEXT_PUBLIC_OPENPANEL_CLIENT_ID
  
  if (!clientId) {
    return null
  }

  return (
    <Script
      src="https://openpanel.dev/op.js"
      data-client-id={clientId}
      strategy="afterInteractive"
    />
  )
}

// 统一的 Analytics 组件 - 支持多种分析工具
export function Analytics() {
  return (
    <>
      {/* 自定义分析服务 - 支持 click.pageview.click 等第三方服务 */}
      <CustomAnalytics />
      
      {/* Plausible Analytics - 隐私友好的付费服务 */}
      <PlausibleAnalytics />
      
      {/* Google Analytics - 功能强大的免费服务 */}
      <GoogleAnalytics />
      
      {/* Microsoft Clarity - 微软免费用户行为分析 */}
      <MicrosoftClarity />
      
      {/* OpenPanel Analytics - 开源分析工具 */}
      <OpenPanelAnalytics />
    </>
  )
} 