# 🔒 支付安全验证系统指南

## 🎯 **概述**

本项目实现了完整的支付安全验证系统，防止前端价格篡改、重复订单、恶意支付等安全问题。

## 🛡️ **安全架构**

### **四层安全防护**

```
🔒 第一层: 身份验证
👤 第二层: 用户存在验证  
💰 第三层: 价格校验
🔐 第四层: 订单完整性验证
```

## 💰 **价格验证系统**

### **标准价格表**

服务器端维护权威价格表，防止前端篡改：

```typescript
// src/lib/payment-security.ts
export const STANDARD_PRICING = {
  subscriptions: {
    'plus': {
      monthly: { price: 9.90, credits: 1900, currency: 'USD' },
      yearly: { price: 99.00, credits: 24000, currency: 'USD' }
    },
    'pro': {
      monthly: { price: 29.90, credits: 8900, currency: 'USD' },
      yearly: { price: 299.00, credits: 120000, currency: 'USD' }
    }
  },
  creditPacks: {
    'starter': { price: 4.90, credits: 600, currency: 'USD' },
    'creator': { price: 15.00, credits: 4000, currency: 'USD' },
    'business': { price: 60.00, credits: 18000, currency: 'USD' }
  }
}
```

### **价格验证流程**

1. **前端请求**: 用户选择产品，前端发送支付请求
2. **服务器验证**: 服务器对照标准价格表验证
3. **价格匹配**: 允许0.01美元的浮点误差
4. **强制使用**: 订单创建时强制使用服务器验证的价格

```typescript
// 价格验证示例
const priceValidation = await validatePrice({
  productType: 'creditPack',
  productId: 'starter',
  amount: 4.90,  // 前端传来的价格
  currency: 'USD',
  userId: 'user123'
})

if (!priceValidation.isValid) {
  // 拒绝支付，返回错误
  return { error: priceValidation.error }
}

// 使用验证后的价格创建订单
const order = await createOrder({
  amount: priceValidation.expectedPrice  // 🔒 强制使用服务器价格
})
```

## 🔐 **订单验证哈希**

### **哈希生成**

每个订单生成唯一的验证哈希，防止篡改：

```typescript
const validationHash = generateValidationHash({
  userId,
  productType,
  productId,
  amount: expectedPrice,
  currency,
  credits,
  timestamp: Date.now()
})
```

### **哈希验证**

Webhook处理时验证哈希完整性：

```typescript
if (validationHash !== paymentOrder.metadata.validationHash) {
  // 哈希不匹配，可能存在篡改
  await markOrderAsFailed(orderId, '验证哈希不匹配')
  return
}
```

## 🚨 **防重复订单系统**

### **时间窗口检测**

```typescript
// 5分钟内不能创建相同的订单
const duplicateCheck = await checkDuplicateOrder(
  userId, 
  amount, 
  productId,
  5  // 时间窗口（分钟）
)

if (duplicateCheck.isDuplicate) {
  return { error: '检测到重复订单，请勿重复提交' }
}
```

### **状态检查**

检查订单状态，防止重复处理：

```typescript
const validStatuses = ['pending', 'created', 'completed']
if (existingOrder && validStatuses.includes(existingOrder.status)) {
  // 存在有效订单，拒绝创建新订单
}
```

## 📊 **支付频率限制**

### **用户级别限制**

```typescript
// 1小时内最多10次支付
const rateLimitCheck = await checkPaymentRateLimit(userId, 10)

if (!rateLimitCheck.isAllowed) {
  return { 
    error: `支付频率超限: 1小时内已有${rateLimitCheck.currentCount}次支付` 
  }
}
```

### **全局监控**

- 24小时内最多10个订单
- 1小时内最多3个订单
- 异常行为自动标记和记录

## 🔍 **Webhook完整性验证**

### **五重验证机制**

```typescript
// 1️⃣ 订单状态验证
if (paymentOrder.status === 'completed') {
  return // 防止重复处理
}

// 2️⃣ 金额匹配验证
const amountDifference = Math.abs(paymentOrder.amount - webhookAmount)
if (amountDifference > 0.01) {
  await markOrderAsFailed('金额不匹配')
  return
}

// 3️⃣ 用户匹配验证
if (paymentOrder.userId !== webhookUserId) {
  await markOrderAsFailed('用户不匹配')
  return
}

// 4️⃣ 产品类型验证
if (paymentOrder.productType !== webhookProductType) {
  await markOrderAsFailed('产品类型不匹配')
  return
}

// 5️⃣ 验证哈希检查
if (validationHash !== paymentOrder.metadata.validationHash) {
  await markOrderAsFailed('验证哈希不匹配，可能存在篡改')
  return
}
```

## 🎯 **积分发放安全**

### **双重验证机制**

```typescript
// 优先使用验证过的积分数量
if (expectedCredits && typeof expectedCredits === 'number') {
  creditsToAdd = expectedCredits  // 🔒 使用预验证的积分
} else {
  // 回退到计算方式
  creditsToAdd = calculateCreditsFromProduct(productId, amount)
}
```

### **原子操作**

```typescript
// 使用数据库事务确保一致性
await prisma.$transaction([
  // 更新用户积分
  prisma.user.update({
    where: { id: userId },
    data: { credits: { increment: creditsToAdd } }
  }),
  
  // 创建交易记录
  prisma.creditTransaction.create({
    data: {
      userId,
      amount: creditsToAdd,
      type: 'purchase',
      paymentOrderId: orderId
    }
  })
])
```

## 🔧 **环境配置**

### **必需环境变量**

```bash
# 支付验证密钥（重要）
PAYMENT_VALIDATION_SECRET="your-strong-secret-key-here"

# CREEM支付配置
CREEM_API_KEY="your-creem-api-key"
CREEM_WEBHOOK_SECRET="your-creem-webhook-secret"

# 数据库配置
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

### **密钥生成建议**

```bash
# 生成强密钥
openssl rand -hex 32

# 或使用Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 📋 **安全检查清单**

### **部署前检查**

- [ ] ✅ 配置强密钥 `PAYMENT_VALIDATION_SECRET`
- [ ] ✅ 验证标准价格表正确性
- [ ] ✅ 测试价格验证功能
- [ ] ✅ 测试重复订单检测
- [ ] ✅ 测试支付频率限制
- [ ] ✅ 验证Webhook签名验证
- [ ] ✅ 测试订单完整性验证

### **运行时监控**

- [ ] 📊 监控价格验证失败率
- [ ] 🚨 监控重复订单检测
- [ ] 📈 监控支付频率异常
- [ ] 🔍 监控Webhook验证失败
- [ ] 💰 监控积分发放准确性

## 🚨 **安全事件响应**

### **价格篡改检测**

```typescript
// 自动记录可疑行为
if (!priceValidation.isValid) {
  await logSuspiciousPayment(userId, 'price_tampering', {
    expectedPrice: priceValidation.expectedPrice,
    actualPrice: priceValidation.actualPrice,
    productId,
    timestamp: new Date()
  })
}
```

### **异常订单处理**

```typescript
// 标记异常订单
await prisma.paymentOrder.update({
  where: { id: orderId },
  data: {
    status: 'failed',
    metadata: {
      error: '安全验证失败',
      securityFlag: true,
      investigationRequired: true
    }
  }
})
```

## 📊 **监控和日志**

### **关键日志记录**

```typescript
// 价格验证日志
console.log(`💰 价格验证 - 产品: ${productType}/${productId}, 期望: $${expectedPrice}, 实际: $${amount}, 有效: ${isValid}`)

// 安全检查日志
console.log(`🔒 安全检查 - 用户: ${userId}, 通过: ${passed}, 错误: ${errors.length}`)

// Webhook验证日志
console.log(`🔐 Webhook验证 - 订单: ${orderNumber}, 完整性: ${integrityVerified}`)
```

### **性能监控**

- 价格验证响应时间
- 重复订单检测效率
- Webhook处理延迟
- 数据库查询性能

## 🎯 **最佳实践**

### **开发建议**

1. **永远不信任前端数据**
2. **服务器端验证所有价格**
3. **使用强密钥和哈希验证**
4. **实现完整的审计日志**
5. **定期检查安全配置**

### **部署建议**

1. **使用HTTPS加密传输**
2. **配置强密钥和密码**
3. **启用数据库备份**
4. **监控异常支付行为**
5. **定期安全审计**

## 🔗 **相关文档**

- [CREEM支付集成指南](./CREEM_SETUP.md)
- [数据库配置指南](./SUPABASE_CONFIG_GUIDE.md)
- [环境变量配置](./env.example)

## 🎯 **CREEM产品ID配置**

### **产品映射表**

系统已预配置以下CREEM产品ID映射：

```typescript
// 📦 积分包产品
creditPacks: {
  'starter': "Starter Pack",      // $4.90 → 600积分
  'creator': "Creator Pack",      // $15.00 → 4000积分  
  'business': "Business Pack"     // $60.00 → 18000积分
}

// 💳 订阅计划产品
subscriptions: {
  plus: {
    monthly: "FluxKontext-Plus-Monthly",   // $9.90/月
    yearly: "FluxKontext-Plus-Yearly"     // $99.00/年
  },
  pro: {
    monthly: "FluxKontext-Pro-Monthly",   // $29.90/月
    yearly: "FluxKontext-Pro-Yearly"     // $299.00/年
  }
}
```

### **CREEM后台配置要求**

在CREEM后台创建产品时，请确保产品名称与上述映射完全一致：

1. **积分包产品**
   - ✅ 产品名称：`Starter Pack`
   - ✅ 价格：$4.90
   - ✅ 类型：一次性支付

2. **订阅产品**
   - ✅ 产品名称：`FluxKontext-Plus-Monthly`
   - ✅ 价格：$9.90
   - ✅ 类型：月度订阅

### **验证配置**

使用以下代码验证产品ID映射：

```typescript
import { getCreemProductId } from '@/lib/payment/creem'

// 测试积分包
const starterProductId = getCreemProductId('creditPack', 'starter')
console.log(starterProductId) // 应输出: "Starter Pack"

// 测试订阅
const plusMonthlyId = getCreemProductId('subscription', 'plus', 'monthly')
console.log(plusMonthlyId) // 应输出: "FluxKontext-Plus-Monthly"
```

---

**⚠️ 重要提醒**: 支付安全是系统的核心，任何修改都需要经过充分测试和验证。 