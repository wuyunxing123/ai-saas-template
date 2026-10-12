"use client"

import { useEffect, useCallback } from "react"
import { useSession, signIn } from "next-auth/react"
import { usePathname } from "next/navigation"
import Script from "next/script"

interface GoogleOneTapProps {
  enabled?: boolean
  autoPrompt?: boolean
}

export function GoogleOneTap({ enabled = true, autoPrompt = true }: GoogleOneTapProps) {
  const { data: session, status } = useSession()
  const pathname = usePathname()

  const initializeGoogleOneTap = useCallback(() => {
    if (!window.google?.accounts?.id) {
      console.log("Browser does not support One Tap")
      return
    } else if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
      console.log("Google Client ID configuration error")
      return
    } else if (localStorage.getItem('google-one-tap-dismissed') === 'true') {
      console.log("User previously chose not to show One Tap")
      return
    }

    try {
      window.google.accounts.id.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "",
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
        context: "signin",
        ux_mode: "popup",
        use_fedcm_for_prompt: false,  // 🔧 禁用FedCM避免Chrome兼容性问题
        
        // 🕐 添加状态监控回调（方案1+3合并）
        moment_callback: (notification: any) => {
          if (notification.isNotDisplayed()) {
            const reason = notification.getNotDisplayedReason?.()
            console.log("Google One Tap was not displayed:", reason)
            
            // 🔧 根据不同原因提供解决建议
            if (reason === 'browser_not_supported') {
              console.log("Browser does not support One Tap")
            } else if (reason === 'invalid_client') {
              console.log("Google Client ID configuration error")
            } else if (reason === 'suppressed_by_user') {
              console.log("User previously chose not to show One Tap")
            }
          }
          if (notification.isSkippedMoment()) {
            const reason = notification.getSkippedReason?.()
            console.log("Google One Tap was skipped:", reason)
          }
          if (notification.isDismissedMoment()) {
            const reason = notification.getDismissedReason?.()
            console.log("Google One Tap was dismissed:", reason)
          }
        }
      })

      // 🕐 智能延迟显示策略（方案3优化）
      if (autoPrompt) {
        const showPrompt = () => {
          if (window.google?.accounts?.id) {
            window.google.accounts.id.prompt((notification: any) => {
              if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                console.log("Google One Tap cannot auto-display, user can use manual trigger button")
              }
            })
          }
        }

        // 🎯 优化延迟时间为6秒（平衡加载时间和用户体验）
        const delay = 6000  // 6秒延迟，既给页面充分加载时间，又不让用户等太久
        setTimeout(showPrompt, delay)
      }
    } catch (error) {
      console.error("Google One Tap initialization error:", error)
      // 🔄 出错时不影响页面正常功能
    }
  }, [autoPrompt])

  useEffect(() => {
    // 🔧 优化检查逻辑：确保已登录用户不会看到Google One Tap
    const shouldShowOneTap = 
      enabled && 
      !session && // ✅ 未登录用户
      status !== "loading" && // ✅ 会话状态已确定
      process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true" &&
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
      // ✅ 不在认证页面显示（避免与登录表单冲突）
      !pathname?.startsWith('/auth/') &&
      // ✅ 不在dashboard页面显示（用户管理页面）
      pathname !== '/dashboard'

    if (!shouldShowOneTap) {
      return
    }

    // 确保Google Identity Services已加载
    if (typeof window !== "undefined" && window.google?.accounts?.id) {
      initializeGoogleOneTap()
    }
  }, [session, status, enabled, initializeGoogleOneTap, pathname])

  const handleCredentialResponse = async (response: any) => {
    try {
      console.log("Google One Tap triggered, redirecting to standard Google login")
      
      // 🔧 简化方案：直接使用NextAuth的Google provider
      // 这样可以确保与现有的认证系统完全兼容
      await signIn("google", {
        callbackUrl: "/generate", // 🎯 登录后跳转到generate页面
      })
    } catch (error) {
      console.error("Google One Tap error:", error)
      // 出错时也使用标准Google登录流程
      await signIn("google", {
        callbackUrl: "/generate",
      })
    }
  }

  const handleScriptLoad = () => {
    // Script加载完成后初始化One Tap
    console.log("Google Identity Services script loaded")
    initializeGoogleOneTap()
  }

  const handleScriptError = () => {
    console.error("Failed to load Google Identity Services script")
  }

  // 🔧 优化检查逻辑：确保条件一致
  const shouldShowOneTap = 
    enabled && 
    !session && // ✅ 未登录用户
    status !== "loading" && // ✅ 会话状态已确定
    process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true" &&
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
    // ✅ 不在认证页面显示（避免与登录表单冲突）
    !pathname?.startsWith('/auth/') &&
    // ✅ 不在dashboard页面显示（用户管理页面）
    pathname !== '/dashboard'

  // 如果不应该显示，不渲染任何内容
  if (!shouldShowOneTap) {
    return null
  }

  return (
    <>
      {/* 加载Google Identity Services */}
      <Script
        src="https://accounts.google.com/gsi/client"
        onLoad={handleScriptLoad}
        onError={handleScriptError}
        strategy="lazyOnload"
      />
    </>
  )
}

// 扩展Window接口以包含Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void
          prompt: (callback?: (notification: any) => void) => void
          renderButton: (element: HTMLElement, config: any) => void
          disableAutoSelect: () => void
          storeCredential: (credential: any) => void
          cancel: () => void
          onGoogleLibraryLoad: () => void
          revoke: (hint: string, callback: (response: any) => void) => void
        }
      }
    }
  }
} 