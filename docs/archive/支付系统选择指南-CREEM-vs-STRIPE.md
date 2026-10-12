# 💳 支付系统选择指南：CREEM vs STRIPE

## 🎯 **快速选择指南**

### **🇨🇳 中国市场优先 → 选择 CREEM**
- 支持微信支付、支付宝
- 人民币结算
- 中文客服
- 国内银行卡

### **🌍 国际市场优先 → 选择 STRIPE**
- 全球信用卡支持
- 多币种结算
- 企业级功能
- 订阅管理

### **🚀 最佳方案 → 双支付系统**
- CREEM处理中国用户
- STRIPE处理国际用户
- 自动路由选择
- 最大化收入

## 📊 **详细对比分析**

| 对比项目 | 🇨🇳 CREEM | 🌍 STRIPE | 🏆 推荐 |
|---------|-----------|-----------|---------|
| **中国支付** | ✅ 微信/支付宝 | ❌ 不支持 | CREEM |
| **国际支付** | ❌ 有限支持 | ✅ 全球覆盖 | STRIPE |
| **手续费** | 2.9% + ¥0.3 | 2.9% + $0.30 | 相近 |
| **结算周期** | T+1 | T+2 | CREEM |
| **技术集成** | 简单 | 复杂但功能强 | 看需求 |
| **订阅管理** | 基础 | 企业级 | STRIPE |
| **Webhook** | 基础 | 完善 | STRIPE |
| **文档质量** | 中文 | 英文(更详细) | 看语言 |

## 🔥 **CREEM 详细分析**

### **✅ 优势**
```bash
🇨🇳 中国本土化
- 微信支付、支付宝原生支持
- 人民币直接结算
- 符合中国监管要求
- 中文客服支持

💰 费用优势
- 手续费：2.9% + ¥0.3
- 无月费
- T+1快速结算
- 提现免费

🚀 技术简单
- API设计简洁
- 集成快速
- 文档中文化
- 示例代码丰富
```

### **❌ 劣势**
```bash
🌍 国际化限制
- 主要服务中国市场
- 国际信用卡支持有限
- 多币种支持较少

🔧 功能限制
- 订阅管理功能基础
- Webhook事件较少
- 高级功能不如Stripe
- 第三方集成较少
```

### **🔥 CREEM 集成代码**

```typescript
// 🔥 CREEM 支付创建
export async function createCreemCheckout(
  productId: string,
  email: string,
  userId: string,
  amount: number,
  currency: string = "cny"
) {
  try {
    const requestBody = {
      product_id: productId,
      customer: {
        email: email,
      },
      metadata: {
        user_id: userId,
        amount: amount,
      },
      success_url: `${process.env.NEXT_PUBLIC_WEB_URL}/pay-success`,
      cancel_url: `${process.env.NEXT_PUBLIC_WEB_URL}/pricing`,
    };

    const response = await fetch(`${process.env.CREEM_API_URL}/checkouts`, {
      method: "POST",
      headers: {
        "x-api-key": process.env.CREEM_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error("Failed to create CREEM checkout");
    }

    const data = await response.json();
    return {
      checkout_url: data.checkout_url,
      checkout_id: data.id,
    };
  } catch (error) {
    console.error("CREEM checkout error:", error);
    throw error;
  }
}

// 🔥 CREEM Webhook 处理
export async function handleCreemWebhook(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("creem-signature");
    
    // 验证签名
    const expectedSignature = crypto
      .createHmac("sha256", process.env.CREEM_WEBHOOK_SECRET!)
      .update(body)
      .digest("hex");

    if (signature !== expectedSignature) {
      throw new Error("Invalid signature");
    }

    const event = JSON.parse(body);

    // 处理支付成功事件
    if (event.type === "checkout.completed") {
      const checkout = event.data;
      const userId = checkout.metadata.user_id;
      const amount = checkout.metadata.amount;

      // 更新订单状态
      await updateOrderStatus(checkout.id, "paid");
      
      // 添加积分或开通服务
      await addUserCredits(userId, amount);
    }

    return { success: true };
  } catch (error) {
    console.error("CREEM webhook error:", error);
    throw error;
  }
}
```

## 🌍 **STRIPE 详细分析**

### **✅ 优势**
```bash
🌍 全球化支持
- 135+国家支持
- 135+币种支持
- 全球信用卡网络
- 本地支付方式

🔧 功能强大
- 企业级订阅管理
- 复杂定价模型
- 发票系统
- 税务计算

🛡️ 安全合规
- PCI DSS Level 1
- 全球合规认证
- 欺诈检测
- 3D Secure

📊 数据分析
- 详细报表
- 收入分析
- 客户洞察
- A/B测试
```

### **❌ 劣势**
```bash
🇨🇳 中国市场限制
- 不支持微信支付
- 不支持支付宝
- 中国用户体验差
- 需要国际信用卡

💰 费用较高
- 手续费：2.9% + $0.30
- 订阅管理额外费用
- 国际转账费用
- 汇率损失

🔧 复杂度高
- 学习曲线陡峭
- 配置复杂
- 需要理解很多概念
- 调试困难
```

### **🔥 STRIPE 集成代码**

```typescript
// 🔥 STRIPE 支付创建
export async function createStripeCheckout(
  priceId: string,
  email: string,
  userId: string,
  mode: "payment" | "subscription" = "payment"
) {
  try {
    const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY!);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: mode,
      customer_email: email,
      metadata: {
        user_id: userId,
      },
      success_url: `${process.env.NEXT_PUBLIC_WEB_URL}/pay-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_WEB_URL}/pricing`,
      allow_promotion_codes: true,
    });

    return {
      session_id: session.id,
      url: session.url,
    };
  } catch (error) {
    console.error("Stripe checkout error:", error);
    throw error;
  }
}

// 🔥 STRIPE Webhook 处理
export async function handleStripeWebhook(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature")!;
    
    const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY!);
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );

    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object;
        await handlePaymentSuccess(session);
        break;
        
      case "customer.subscription.created":
        const subscription = event.data.object;
        await handleSubscriptionCreated(subscription);
        break;
        
      case "customer.subscription.deleted":
        const deletedSub = event.data.object;
        await handleSubscriptionCanceled(deletedSub);
        break;
    }

    return { received: true };
  } catch (error) {
    console.error("Stripe webhook error:", error);
    throw error;
  }
}
```

## 🚀 **双支付系统集成方案**

### **🎯 智能路由策略**

```typescript
// 🔥 支付方式智能选择
export function getPaymentProvider(
  userLocation: string,
  currency: string,
  paymentType: "one-time" | "subscription"
): "creem" | "stripe" {
  // 中国用户优先使用CREEM
  if (userLocation === "CN" || currency === "CNY") {
    return "creem";
  }
  
  // 订阅业务优先使用STRIPE
  if (paymentType === "subscription") {
    return "stripe";
  }
  
  // 其他情况使用STRIPE
  return "stripe";
}

// 🔥 统一支付接口
export async function createPayment(params: {
  amount: number;
  currency: string;
  userId: string;
  email: string;
  productId: string;
  paymentType: "one-time" | "subscription";
  userLocation?: string;
}) {
  const provider = getPaymentProvider(
    params.userLocation || "US",
    params.currency,
    params.paymentType
  );

  if (provider === "creem") {
    return await createCreemCheckout(
      params.productId,
      params.email,
      params.userId,
      params.amount,
      params.currency
    );
  } else {
    return await createStripeCheckout(
      params.productId,
      params.email,
      params.userId,
      params.paymentType
    );
  }
}
```

### **🔥 统一Webhook处理**

```typescript
// app/api/webhook/route.ts
export async function POST(req: Request) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");

  try {
    if (provider === "creem") {
      return await handleCreemWebhook(req);
    } else if (provider === "stripe") {
      return await handleStripeWebhook(req);
    } else {
      return Response.json({ error: "Unknown provider" }, { status: 400 });
    }
  } catch (error) {
    console.error("Webhook error:", error);
    return Response.json({ error: "Webhook failed" }, { status: 500 });
  }
}
```

### **🎨 前端支付组件**

```tsx
// components/PaymentButton.tsx
import { useState } from "react";

interface PaymentButtonProps {
  amount: number;
  currency: string;
  productId: string;
  paymentType: "one-time" | "subscription";
}

export function PaymentButton({
  amount,
  currency,
  productId,
  paymentType,
}: PaymentButtonProps) {
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/create-payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          currency,
          productId,
          paymentType,
        }),
      });

      const data = await response.json();
      
      if (data.checkout_url) {
        // CREEM 支付
        window.location.href = data.checkout_url;
      } else if (data.url) {
        // STRIPE 支付
        window.location.href = data.url;
      }
    } catch (error) {
      console.error("Payment error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handlePayment}
      disabled={loading}
      className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50"
    >
      {loading ? "处理中..." : `支付 ${currency === "CNY" ? "¥" : "$"}${amount}`}
    </button>
  );
}
```

## ⚙️ **环境变量配置**

```bash
# 🔥 CREEM 配置
CREEM_API_URL=https://api.creem.io/v1
CREEM_API_KEY=your_creem_api_key
CREEM_WEBHOOK_SECRET=your_creem_webhook_secret

# 🔥 STRIPE 配置
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_PRIVATE_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# 🔥 支付路由配置
NEXT_PUBLIC_ENABLE_CREEM=true
NEXT_PUBLIC_ENABLE_STRIPE=true
NEXT_PUBLIC_DEFAULT_PAYMENT_PROVIDER=stripe
```

## 📋 **实施步骤**

### **🚀 阶段一：单一支付系统**
1. **新手推荐**：先选择一个支付系统
2. **中国市场**：使用CREEM
3. **国际市场**：使用STRIPE
4. **快速上线**：验证商业模式

### **🔄 阶段二：双支付系统**
1. **业务增长**：用户来源多样化
2. **技术升级**：实现智能路由
3. **收入优化**：最大化支付成功率
4. **用户体验**：本地化支付方式

### **📊 阶段三：高级优化**
1. **数据分析**：支付转化率分析
2. **A/B测试**：不同支付方式效果
3. **风控优化**：欺诈检测和预防
4. **成本优化**：手续费和汇率管理

## 🎯 **最佳实践建议**

### **🇨🇳 中国市场策略**
```typescript
// 针对中国用户的支付优化
const chinaPaymentConfig = {
  provider: "creem",
  methods: ["wechat_pay", "alipay"],
  currency: "CNY",
  locale: "zh-CN",
  features: {
    mobile_optimized: true,
    qr_code_payment: true,
    instant_notification: true,
  }
};
```

### **🌍 国际市场策略**
```typescript
// 针对国际用户的支付优化
const globalPaymentConfig = {
  provider: "stripe",
  methods: ["card", "apple_pay", "google_pay"],
  currencies: ["USD", "EUR", "GBP", "JPY"],
  features: {
    subscription_management: true,
    tax_calculation: true,
    multi_currency: true,
    fraud_detection: true,
  }
};
```

## 📈 **成本效益分析**

| 场景 | CREEM成本 | STRIPE成本 | 推荐方案 |
|------|-----------|------------|----------|
| 中国用户¥100 | ¥3.2 | 无法支付 | CREEM |
| 美国用户$100 | 不适用 | $3.20 | STRIPE |
| 订阅$10/月 | 不适用 | $0.59/月 | STRIPE |
| 大额支付¥10000 | ¥290.3 | 无法支付 | CREEM |

## 🔮 **未来发展建议**

### **📱 移动端优化**
- 微信小程序支付
- App内支付集成
- 移动端UI优化

### **🤖 AI智能路由**
- 基于用户行为的支付方式推荐
- 动态手续费优化
- 支付成功率预测

### **🔗 区块链支付**
- 加密货币支付集成
- 稳定币结算
- DeFi协议集成

---

**📝 文档版本**: v1.0  
**📅 更新时间**: 2025-01-20  
**🎯 适用**: 所有需要集成支付的项目 