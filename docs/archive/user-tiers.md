# 🎯 用户分层设计方案

## 📊 **三类用户体系**

### 🆓 **免费用户 (Anonymous)**
**无需注册，立即使用**

#### 功能权限
- ✅ **基础生成**: 1-2张图片/次
- ✅ **标准模型**: 仅Flux Kontext Pro
- ✅ **基础宽高比**: 1:1, 16:9, 9:16
- ✅ **标准设置**: 固定引导强度3.5
- ✅ **图像编辑**: 单图编辑
- ❌ **批量生成**: 不支持
- ❌ **高级模型**: 无法使用Max模型
- ❌ **Private Mode**: 不可用
- ❌ **历史记录**: 不保存

#### 限制条件
- 🕐 **频率限制**: 每小时最多10次生成
- 🔒 **Turnstile验证**: 每次都需要验证
- 📱 **设备限制**: 单设备使用
- 💾 **存储期限**: 图片7天后删除

#### 用户体验
```typescript
const freeUserLimits = {
  maxImages: 2,
  modelsAllowed: ['pro'],
  aspectRatios: ['1:1', '16:9', '9:16'],
  hourlyLimit: 10,
  requiresTurnstile: true,
  storageRetention: 7, // 天
  features: {
    batchGeneration: false,
    privateMode: false,
    historySync: false,
    priorityQueue: false
  }
}
```

---

### 🔐 **注册用户 (Registered)**
**免费注册，增强体验**

#### 功能权限
- ✅ **增强生成**: 1-4张图片/次
- ✅ **双模型**: Pro + Max模型
- ✅ **完整宽高比**: 所有比例选项
- ✅ **高级设置**: 自定义引导强度、种子等
- ✅ **多图编辑**: 支持多图同时编辑
- ✅ **历史记录**: 云端同步保存
- ✅ **收藏功能**: 收藏喜欢的作品
- ❌ **批量生成**: 仍不支持6+张
- ❌ **Private Mode**: 不可用
- ❌ **优先队列**: 标准队列

#### 增强权限
- 🕐 **频率限制**: 每小时30次生成
- 🔒 **智能验证**: 信任用户减少验证
- 📱 **多设备同步**: 跨设备使用
- 💾 **存储期限**: 图片30天保存
- 🎨 **模板库**: 访问提示词模板

#### 用户体验
```typescript
const registeredUserLimits = {
  maxImages: 4,
  modelsAllowed: ['pro', 'max'],
  aspectRatios: 'all',
  hourlyLimit: 30,
  requiresTurnstile: 'smart', // 智能验证
  storageRetention: 30, // 天
  features: {
    batchGeneration: false,
    privateMode: false,
    historySync: true,
    priorityQueue: false,
    templates: true,
    favorites: true
  }
}
```

---

### 👑 **付费用户 (Premium)**
**解锁全部功能，专业体验**

#### 功能权限
- ✅ **批量生成**: 1-12张图片/次
- ✅ **Private Mode**: 私人模式生成
- ✅ **优先队列**: 快速生成通道
- ✅ **高级模型**: 未来新模型优先体验
- ✅ **API访问**: 开发者API接口
- ✅ **商业授权**: 商用图片授权
- ✅ **专属客服**: 优先技术支持
- ✅ **无水印**: 去除平台水印

#### 专享特权
- 🕐 **无限制**: 无频率限制
- 🔒 **免验证**: 跳过人机验证
- 📱 **全平台**: 所有设备无限制
- 💾 **永久存储**: 图片永久保存
- 🎨 **专业工具**: 高级编辑功能
- 📊 **使用统计**: 详细数据分析

#### 定价方案
```typescript
const premiumPlans = {
  monthly: {
    price: 29, // USD/月
    credits: 1000, // 生成次数
    features: 'all'
  },
  yearly: {
    price: 290, // USD/年 (节省20%)
    credits: 15000, // 生成次数
    features: 'all',
    bonus: '额外3个月'
  },
  payAsYouGo: {
    price: 0.05, // USD/张
    minPurchase: 10, // 最少购买
    features: 'premium'
  }
}
```

---

## 🔧 **技术实现方案**

### 1. **用户状态检测**
```typescript
// 用户类型枚举
enum UserType {
  ANONYMOUS = 'anonymous',
  REGISTERED = 'registered', 
  PREMIUM = 'premium'
}

// 用户状态Hook
const useUserTier = () => {
  const [userType, setUserType] = useState<UserType>(UserType.ANONYMOUS)
  const [limits, setLimits] = useState(freeUserLimits)
  
  useEffect(() => {
    // 检查登录状态
    const checkUserStatus = async () => {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        setUserType(UserType.ANONYMOUS)
        setLimits(freeUserLimits)
        return
      }
      
      // 验证token并获取用户信息
      const user = await verifyToken(token)
      if (user.isPremium) {
        setUserType(UserType.PREMIUM)
        setLimits(premiumUserLimits)
      } else {
        setUserType(UserType.REGISTERED)
        setLimits(registeredUserLimits)
      }
    }
    
    checkUserStatus()
  }, [])
  
  return { userType, limits }
}
```

### 2. **功能权限控制**
```typescript
// 图片数量选项动态生成
const getImageCountOptions = (userType: UserType) => {
  switch (userType) {
    case UserType.ANONYMOUS:
      return [
        { value: 1, label: "1 image" },
        { value: 2, label: "2 images" }
      ]
    case UserType.REGISTERED:
      return [
        { value: 1, label: "1 image" },
        { value: 2, label: "2 images" },
        { value: 3, label: "3 images" },
        { value: 4, label: "4 images" }
      ]
    case UserType.PREMIUM:
      return [
        { value: 1, label: "1 image" },
        { value: 2, label: "2 images" },
        { value: 3, label: "3 images" },
        { value: 4, label: "4 images" },
        { value: 6, label: "6 images 👑" },
        { value: 8, label: "8 images 👑" },
        { value: 12, label: "12 images 👑" }
      ]
  }
}

// 模型选择权限
const getAvailableModels = (userType: UserType) => {
  switch (userType) {
    case UserType.ANONYMOUS:
      return ['pro']
    case UserType.REGISTERED:
    case UserType.PREMIUM:
      return ['pro', 'max']
  }
}
```

### 3. **升级提示组件**
```typescript
const UpgradePrompt = ({ feature, userType }: { feature: string, userType: UserType }) => {
  if (userType === UserType.PREMIUM) return null
  
  return (
    <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-4 rounded-lg text-white">
      <div className="flex items-center gap-2 mb-2">
        <Crown className="h-5 w-5" />
        <span className="font-semibold">升级解锁 {feature}</span>
      </div>
      <p className="text-sm opacity-90 mb-3">
        {userType === UserType.ANONYMOUS 
          ? "注册账户即可使用更多功能，升级Premium解锁全部特权"
          : "升级到Premium解锁批量生成、私人模式等专业功能"
        }
      </p>
      <div className="flex gap-2">
        {userType === UserType.ANONYMOUS && (
          <Button variant="secondary" size="sm">
            免费注册
          </Button>
        )}
        <Button variant="default" size="sm">
          升级Premium
        </Button>
      </div>
    </div>
  )
}
```

---

## 💰 **商业模式分析**

### 📈 **收入预测**
```typescript
const revenueProjection = {
  freeUsers: {
    count: 10000, // 月活跃
    conversionRate: 0.05, // 5%转化为注册
    cost: 0 // 广告收入覆盖成本
  },
  registeredUsers: {
    count: 500, // 注册用户
    conversionRate: 0.10, // 10%转化为付费
    cost: 0 // 增加用户粘性
  },
  premiumUsers: {
    count: 50, // 付费用户
    monthlyRevenue: 29 * 50, // $1,450/月
    yearlyRevenue: 1450 * 12, // $17,400/年
    churnRate: 0.05 // 5%流失率
  }
}
```

### 🎯 **转化策略**
1. **免费→注册**: 历史记录、多设备同步
2. **注册→付费**: 批量生成、私人模式
3. **付费留存**: 新功能优先、专属客服

---

## 🚀 **实施计划**

### Phase 1: 基础分层 (2周)
- ✅ 实现用户类型检测
- ✅ 添加功能权限控制
- ✅ 创建升级提示组件

### Phase 2: 用户系统 (4周)
- 🔄 集成身份验证 (Auth0/Supabase)
- 🔄 用户数据库设计
- 🔄 订阅管理系统

### Phase 3: 支付集成 (3周)
- 🔄 Stripe支付集成
- 🔄 订阅计费逻辑
- 🔄 发票和收据系统

### Phase 4: 高级功能 (4周)
- 🔄 API访问控制
- 🔄 使用统计分析
- 🔄 客服支持系统

---

这个分层设计既能吸引免费用户，又能有效转化付费用户。你觉得这个方案如何？需要调整哪些部分？ 