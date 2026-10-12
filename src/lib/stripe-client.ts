import Stripe from "stripe";

// 🔥 Stripe客户端单例管理
let stripeClient: Stripe | null = null;

/**
 * 获取Stripe客户端实例 - 单例模式
 * 只有在真正需要时才初始化，避免构建时错误
 */
export function getStripeClient(): Stripe {
  // 如果已经初始化过，直接返回（性能优化）
  if (stripeClient) {
    return stripeClient;
  }
  
  // 检查Stripe是否启用
  if (process.env.NEXT_PUBLIC_ENABLE_STRIPE !== "true") {
    throw new Error("Stripe支付未启用");
  }
  
  // 检查环境变量
  const privateKey = process.env.STRIPE_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("STRIPE_PRIVATE_KEY environment variable is not set");
  }
  
  // 创建并缓存客户端实例
  stripeClient = new Stripe(privateKey, {
    apiVersion: "2025-02-24.acacia",
  });
  
  console.log("✅ Stripe客户端初始化成功");
  return stripeClient;
}

/**
 * 检查Stripe是否可用
 */
export function isStripeAvailable(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_ENABLE_STRIPE === "true" &&
    process.env.STRIPE_PRIVATE_KEY &&
    process.env.STRIPE_PUBLIC_KEY
  );
}

/**
 * 重置Stripe客户端（主要用于测试）
 */
export function resetStripeClient(): void {
  stripeClient = null;
} 