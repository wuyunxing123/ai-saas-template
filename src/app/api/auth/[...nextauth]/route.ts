import NextAuth from "next-auth"
import '@/app/product-runtime'
import { authOptions } from "@/lib/auth"

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST } 