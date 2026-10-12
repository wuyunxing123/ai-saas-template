# 📊 Scripto.Video Analytics 配置指南

## 🎯 概述

本项目支持多种分析工具，帮助你了解用户行为和网站性能：

- **自定义分析服务** - 支持 click.pageview.click 等第三方服务
- **Plausible Analytics** - 隐私友好的分析工具（推荐）
- **Google Analytics** - 功能强大的分析工具
- **Microsoft Clarity** - 微软免费用户行为分析
- **OpenPanel** - 开源分析工具

## 🔍 自定义分析服务配置

### 1. 配置第三方服务（如 click.pageview.click）

```bash
# 自定义分析服务配置
NEXT_PUBLIC_CUSTOM_ANALYTICS_DOMAIN="veo3.us"
NEXT_PUBLIC_CUSTOM_ANALYTICS_URL="https://click.pageview.click/js/script.js"
```

这会生成类似的脚本：
```html
<script defer data-domain="veo3.us" src="https://click.pageview.click/js/script.js"></script>
```

## 🔧 Plausible Analytics 配置

### 1. 注册 Plausible 账户

1. 访问 [Plausible.io](https://plausible.io)
2. 注册账户并添加你的网站域名
3. 获取你的域名配置

### 2. 环境变量配置

在 `.env.local` 文件中添加：

```bash
# Plausible Analytics 配置
NEXT_PUBLIC_PLAUSIBLE_DOMAIN="scripto.video"
```

### 3. 代码实现

项目已经自动集成了 Plausible Analytics：

```typescript
// src/components/Analytics.tsx
export function PlausibleAnalytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
  
  if (!domain) {
    return null
  }

  return (
    <Script
      defer
      data-domain={domain}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  )
}
```

### 4. 验证安装

1. 部署网站后，访问你的网站
2. 在 Plausible 仪表板中检查是否有数据
3. 通常需要等待几分钟才能看到数据

## 📈 Google Analytics 配置

### 1. 创建 GA4 属性

1. 访问 [Google Analytics](https://analytics.google.com)
2. 创建新的 GA4 属性
3. 获取测量 ID（格式：G-XXXXXXXXXX）

### 2. 环境变量配置

```bash
# Google Analytics 配置
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID="G-XXXXXXXXXX"
```

### 3. 验证安装

1. 使用 Google Analytics Debugger 扩展
2. 检查 Real-time 报告
3. 确认事件正常发送

## 🔍 Microsoft Clarity 配置

### 1. 注册 Microsoft Clarity

1. 访问 [Microsoft Clarity](https://clarity.microsoft.com)
2. 使用微软账号登录
3. 创建新项目并获取项目 ID

### 2. 环境变量配置

```bash
# Microsoft Clarity 配置
NEXT_PUBLIC_CLARITY_PROJECT_ID="your_clarity_project_id"
```

### 3. 功能特色

- **完全免费** - 无使用限制
- **用户行为录制** - 记录用户操作视频
- **热力图分析** - 显示用户点击和滚动行为
- **性能监控** - 页面加载速度分析
- **隐私友好** - 自动过滤敏感信息

### 4. 验证安装

1. 访问 Clarity 仪表板
2. 检查是否有实时数据
3. 查看用户会话录制

## 🔍 OpenPanel 配置

### 1. 注册 OpenPanel

1. 访问 [OpenPanel.dev](https://openpanel.dev)
2. 创建项目并获取 Client ID

### 2. 环境变量配置

```bash
# OpenPanel 配置
NEXT_PUBLIC_OPENPANEL_CLIENT_ID="your_openpanel_client_id"
```

## 🚀 部署配置

### Vercel 部署

在 Vercel 项目设置中添加环境变量：

```bash
NEXT_PUBLIC_PLAUSIBLE_DOMAIN=scripto.video
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=G-XXXXXXXXXX
```

### Netlify 部署

在 `netlify.toml` 中添加：

```toml
[build.environment]
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN = "scripto.video"
  NEXT_PUBLIC_GOOGLE_ANALYTICS_ID = "G-XXXXXXXXXX"
```

## 📊 分析数据说明

### Plausible 数据

- **页面浏览量** - 用户访问的页面数
- **独立访客** - 唯一用户数量
- **跳出率** - 单页面访问比例
- **访问时长** - 用户停留时间
- **流量来源** - 用户来源渠道

### 重要指标

1. **转化率** - 从访问到生成视频的转化
2. **用户路径** - 用户在网站中的行为路径
3. **热门页面** - 最受欢迎的页面
4. **设备分析** - 移动端 vs 桌面端使用情况

## 🔒 隐私合规

### GDPR 合规

Plausible Analytics 默认符合 GDPR：
- 不使用 cookies
- 不收集个人数据
- 数据存储在欧盟

### Cookie 政策

如果使用 Google Analytics，需要：
1. 添加 Cookie 同意横幅
2. 更新隐私政策
3. 提供退出选项

## 🛠️ 高级配置

### 自定义事件追踪

```typescript
// 追踪视频生成事件
function trackVideoGeneration() {
  if (typeof window !== 'undefined' && window.plausible) {
    window.plausible('Video Generated', {
      props: {
        type: 'script-to-video',
        duration: '30s'
      }
    })
  }
}
```

### 目标设置

在 Plausible 中设置转化目标：
1. 页面访问目标：`/generate`
2. 自定义事件：`Video Generated`
3. 外链点击：下载链接

## 🔧 故障排除

### 常见问题

1. **数据不显示**
   - 检查域名配置是否正确
   - 确认脚本正常加载
   - 等待数据处理时间

2. **脚本加载失败**
   - 检查网络连接
   - 确认域名已在 Plausible 中添加
   - 检查浏览器控制台错误

3. **数据不准确**
   - 排除开发环境流量
   - 检查重复计数问题
   - 验证事件配置

### 调试工具

```typescript
// 开发环境调试
if (process.env.NODE_ENV === 'development') {
  console.log('Analytics Debug:', {
    plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
    gaId: process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID
  })
}
```

## 📝 最佳实践

1. **选择合适的工具**
   - 隐私优先：选择 Plausible
   - 功能丰富：选择 Google Analytics
   - 开源方案：选择 OpenPanel

2. **数据保护**
   - 定期审查数据收集
   - 遵守当地法律法规
   - 提供透明的隐私政策

3. **性能优化**
   - 使用 `strategy="afterInteractive"`
   - 避免阻塞页面加载
   - 监控脚本性能影响

## 🎯 推荐配置

对于 Scripto.Video 项目，推荐的配置组合：

### 🥇 **最佳组合（推荐）**
```bash
# 主要分析 - 群友免费服务
NEXT_PUBLIC_CUSTOM_ANALYTICS_DOMAIN="veo3.us"
NEXT_PUBLIC_CUSTOM_ANALYTICS_URL="https://click.pageview.click/js/script.js"

# 用户行为分析 - 微软免费服务
NEXT_PUBLIC_CLARITY_PROJECT_ID="your_clarity_project_id"

# 备用分析（可选）
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID="G-XXXXXXXXXX"
```

### 🥈 **隐私优先组合**
```bash
# 隐私友好的付费服务
NEXT_PUBLIC_PLAUSIBLE_DOMAIN="scripto.video"

# 用户行为分析
NEXT_PUBLIC_CLARITY_PROJECT_ID="your_clarity_project_id"
```

### 🥉 **功能全面组合**
```bash
# 功能强大的免费服务
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID="G-XXXXXXXXXX"

# 用户行为录制
NEXT_PUBLIC_CLARITY_PROJECT_ID="your_clarity_project_id"

# 开源备用
NEXT_PUBLIC_OPENPANEL_CLIENT_ID="your_openpanel_client_id"
```

### 📊 **各工具对比**

| 工具 | 费用 | 隐私 | 功能 | 特色 |
|------|------|------|------|------|
| **自定义服务** | 🆓 免费 | ❓ 未知 | 📊 基础 | 群友提供 |
| **Microsoft Clarity** | 🆓 免费 | ✅ 友好 | 🎥 录制 | 用户行为视频 |
| **Google Analytics** | 🆓 免费 | ❌ 收集 | 🔥 最强 | 功能全面 |
| **Plausible** | 💰 付费 | ✅ 友好 | 📊 中等 | 隐私优先 |
| **OpenPanel** | 🆓 免费 | ✅ 友好 | 📊 中等 | 开源可控 |

**建议**：先用免费的自定义服务 + Microsoft Clarity，既节省成本又能获得用户行为洞察！ 