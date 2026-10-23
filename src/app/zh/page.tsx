import { redirect } from 'next/navigation'

// 中文已是默认语言（无前缀路由），/zh 仅保留为兼容重定向。
export default function ChinesePage() {
  redirect('/')
}
