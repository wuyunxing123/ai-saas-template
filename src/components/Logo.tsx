import Image from "next/image"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { siteConfig } from "@/lib/site-config"
import { SyntheticEvent, useState } from "react"

interface LogoProps {
  /** 是否显示为链接 */
  asLink?: boolean
  /** 自定义类名 */
  className?: string
  /** 图片大小 */
  size?: "sm" | "md" | "lg" | "xl"
  /** 是否显示文字 */
  showText?: boolean
  /** 是否显示图片LOGO */
  showImage?: boolean
  /** 是否使用白色版本（深色背景） */
  variant?: "default" | "white"
  /** 链接地址 */
  href?: string
}

const sizeClasses = {
  sm: "w-6 h-6 md:w-8 md:h-8",
  md: "w-8 h-8 md:w-10 md:h-10", 
  lg: "w-10 h-10 md:w-12 md:h-12",
  xl: "w-12 h-12 md:w-16 md:h-16"
}

export function Logo({ 
  asLink = false, 
  className,
  size = "md",
  showText = true,
  showImage = false,
  variant = "default",
  href = "/"
}: LogoProps) {
  const [imageError, setImageError] = useState(false)
  const logoSrc = variant === "white" ? "/logo-white.png" : "/logo.png"
  
  const handleImageError = (e: SyntheticEvent<HTMLImageElement>) => {
    // 如果图片加载失败，设置错误状态但保留文字LOGO
    setImageError(true)
  }
  
  const LogoContent = () => (
    <div className={cn(
      "flex items-center",
      showImage && showText && !imageError && "space-x-2",
      asLink && "hover:scale-105 active:scale-95 transition-transform",
      className
    )}>
      {/* 图片LOGO - 可选显示 */}
      {showImage && !imageError && (
        <div className={cn("relative", sizeClasses[size])}>
          <Image
            src={logoSrc}
            alt={`${siteConfig.projectName} Logo`}
            fill
            className="object-contain"
            priority
            onError={handleImageError}
          />
        </div>
      )}
      
      {/* 文字LOGO - 始终显示（除非明确设置为false） */}
      {showText && (
        <span className={cn(
          "font-bold text-primary",
          size === "sm" && "text-lg md:text-xl",
          size === "md" && "text-xl md:text-2xl",
          size === "lg" && "text-2xl md:text-3xl",
          size === "xl" && "text-3xl md:text-4xl"
        )}>
          {siteConfig.projectName}
        </span>
      )}
    </div>
  )

  if (asLink) {
    return (
      <Link href={href}>
        <LogoContent />
      </Link>
    )
  }

  return <LogoContent />
}

// 预设的LOGO变体
export const LogoVariants = {
  /** 导航栏LOGO - 只显示文字 */
  Navigation: () => <Logo asLink showText showImage={false} size="md" />,
  
  /** 页脚LOGO - 只显示文字，白色版本 */
  Footer: () => <Logo asLink showText showImage={false} size="sm" variant="white" />,
  
  /** 大尺寸展示LOGO - 只显示文字 */
  Hero: () => <Logo showText showImage={false} size="xl" />,
  
  /** 纯文字LOGO - 只显示文字 */
  TextOnly: ({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) => 
    <Logo showText showImage={false} size={size} />,
  
  /** 纯图标LOGO - 只显示图片（需要时可以启用） */
  IconOnly: ({ size = "md" }: { size?: "sm" | "md" | "lg" | "xl" }) => 
    <Logo showText={false} showImage size={size} />,
} 