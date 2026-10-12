import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Dashboard - Redirecting to AI Image Generator | Flux Kontext',
  description: 'Redirecting to the main AI image generation interface.',
  alternates: {
    canonical: '/dashboard',
  },
  robots: {
    index: false, // 重定向页面不需要被搜索引擎索引
    follow: true,
  }
}

export default function DashboardPage() {
  // 🎯 自动重定向到主功能页面
  redirect('/generate')
}
