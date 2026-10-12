import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // 创建浏览器端的Supabase客户端
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// 导出默认客户端实例
export const supabase = createClient() 