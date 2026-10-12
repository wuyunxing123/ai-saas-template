# ☁️ 部署平台迁移计划：Netlify → Vercel

## 🎯 **迁移目标**
- 获得更好的Next.js支持
- 提升部署性能和速度
- 改善中国用户访问体验
- 简化部署配置

## 📊 **平台对比分析**

### **🟦 Netlify 当前状态**
```toml
# netlify.toml
[build]
  command = "bun run build"
  publish = ".next"

[build.environment]
  NETLIFY_NEXT_PLUGIN_SKIP = "true"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

**❌ Netlify 限制：**
- 需要额外插件支持Next.js
- 构建时间较长
- 中国访问速度较慢
- 配置相对复杂

### **🟩 Vercel 优势**
```json
// vercel.json (可选配置)
{
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "framework": "nextjs",
  "regions": ["hkg1", "sin1", "nrt1"]
}
```

**✅ Vercel 优势：**
- Next.js原生支持，零配置
- 更快的构建和部署
- 更好的中国访问速度
- 强大的分析和监控功能
- 更好的预览部署体验

## 🚀 **迁移步骤**

### **阶段一：Vercel账户准备 (30分钟)**

#### **1.1 创建Vercel账户**
```bash
# 1. 访问 https://vercel.com
# 2. 使用GitHub账户登录
# 3. 连接GitHub仓库
```

#### **1.2 安装Vercel CLI**
```bash
# 全局安装Vercel CLI
npm i -g vercel
# 或使用bun
bun add -g vercel

# 登录Vercel
vercel login
```

### **阶段二：项目配置 (1小时)**

#### **2.1 创建vercel.json配置**
```json
{
  "buildCommand": "bun run build",
  "installCommand": "bun install",
  "framework": "nextjs",
  "regions": ["hkg1", "sin1", "nrt1"],
  "env": {
    "NODE_ENV": "production"
  },
  "build": {
    "env": {
      "NEXT_TELEMETRY_DISABLED": "1"
    }
  },
  "functions": {
    "src/app/api/**/*.ts": {
      "maxDuration": 30
    }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    }
  ]
}
```

#### **2.2 环境变量配置**
```bash
# 在Vercel Dashboard中配置环境变量
# 或使用CLI批量导入

# 从.env.local导入
vercel env pull .env.vercel.local
```

#### **2.3 更新next.config.js**
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel优化配置
  experimental: {
    optimizeCss: true,
    optimizeServerReact: true,
  },
  
  // 图片配置
  images: {
    domains: [
      "source.unsplash.com",
      "images.unsplash.com",
      // R2存储域名
      process.env.NEXT_PUBLIC_DEMO_VIDEOS_URL?.replace('https://', '') || 
      "pub-49364ecf52e344d3a722a3c5bca11271.r2.dev",
    ],
    // Vercel图片优化
    loader: 'default',
    minimumCacheTTL: 60,
  },
  
  // 输出配置
  output: 'standalone',
  
  // 压缩配置
  compress: true,
  
  // 性能优化
  swcMinify: true,
}

module.exports = nextConfig
```

### **阶段三：首次部署测试 (30分钟)**

#### **3.1 本地测试部署**
```bash
# 在项目根目录执行
vercel

# 选择配置
? Set up and deploy "veo3.us"? [Y/n] y
? Which scope do you want to deploy to? [选择你的账户]
? Link to existing project? [N/y] n
? What's your project's name? veo3-ai
? In which directory is your code located? ./
```

#### **3.2 验证部署结果**
```bash
# 检查部署状态
vercel ls

# 查看部署日志
vercel logs [deployment-url]

# 测试功能
- 访问首页
- 测试generate页面
- 验证API接口
- 检查文件上传
- 测试支付功能
```

### **阶段四：域名和DNS配置 (1小时)**

#### **4.1 自定义域名配置**
```bash
# 添加自定义域名
vercel domains add veo3.us

# 配置DNS记录
# A记录: @ -> 76.76.19.61
# CNAME记录: www -> cname.vercel-dns.com
```

#### **4.2 SSL证书配置**
```bash
# Vercel自动配置SSL证书
# 验证HTTPS访问
curl -I https://veo3.us
```

### **阶段五：性能优化配置 (1小时)**

#### **5.1 边缘函数配置**
```javascript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // 地理位置优化
  const country = request.geo?.country || 'US'
  const response = NextResponse.next()
  
  // 设置地理位置头
  response.headers.set('x-user-country', country)
  
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
```

#### **5.2 分析和监控配置**
```javascript
// next.config.js 添加
const nextConfig = {
  // Vercel Analytics
  experimental: {
    instrumentationHook: true,
  },
  
  // Web Vitals
  analyticsId: process.env.VERCEL_ANALYTICS_ID,
}
```

### **阶段六：CI/CD配置 (30分钟)**

#### **6.1 GitHub集成**
```yaml
# .github/workflows/vercel.yml
name: Vercel Production Deployment
env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
on:
  push:
    branches:
      - main
jobs:
  Deploy-Production:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
      - name: Pull Vercel Environment Information
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - name: Build Project Artifacts
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
      - name: Deploy Project Artifacts to Vercel
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

## ✅ **验证清单**

### **🔧 功能验证**
- [ ] 首页正常访问
- [ ] Generate页面功能正常
- [ ] API接口响应正常
- [ ] 文件上传功能正常
- [ ] 数据库连接正常
- [ ] 支付功能正常
- [ ] 用户认证正常
- [ ] 视频生成功能正常

### **📊 性能验证**
- [ ] 页面加载速度 < 3秒
- [ ] API响应时间 < 1秒
- [ ] 图片加载优化正常
- [ ] 移动端适配正常
- [ ] SEO配置正常

### **🌍 地理位置验证**
- [ ] 中国访问速度测试
- [ ] 美国访问速度测试
- [ ] 欧洲访问速度测试
- [ ] 亚洲其他地区测试

## 📈 **预期收益**

### **⚡ 性能提升**
- **构建速度**：提升40-60%
- **部署速度**：提升50-70%
- **页面加载**：提升20-30%
- **API响应**：提升15-25%

### **🌍 用户体验**
- **中国访问**：速度提升50%+
- **全球CDN**：更好的边缘缓存
- **预览部署**：每个PR自动预览
- **错误监控**：实时错误追踪

### **🔧 开发体验**
- **零配置**：Next.js原生支持
- **实时日志**：详细的部署日志
- **分析面板**：性能和用户分析
- **团队协作**：更好的团队管理

## 🗑️ **清理Netlify配置**

### **删除Netlify相关文件**
```bash
# 删除Netlify配置文件
rm netlify.toml

# 更新.gitignore
echo "# Vercel" >> .gitignore
echo ".vercel" >> .gitignore

# 提交更改
git add .
git commit -m "🚀 迁移到Vercel：删除Netlify配置"
```

### **更新文档**
```markdown
# 更新README.md部署说明
## 🚀 部署

### Vercel部署 (推荐)
1. Fork本项目到你的GitHub
2. 在Vercel中导入项目
3. 配置环境变量
4. 自动部署完成

### 本地部署
```bash
bun install
bun run build
bun run start
```
```

## ⚠️ **注意事项**

### **🚨 迁移风险**
1. **DNS切换**：可能有短暂的服务中断
2. **环境变量**：需要重新配置所有环境变量
3. **域名解析**：DNS传播需要时间
4. **缓存清理**：可能需要清理CDN缓存

### **🛡️ 风险控制**
1. **分阶段迁移**：先用子域名测试
2. **备份准备**：保留Netlify部署作为备份
3. **监控部署**：密切关注部署状态
4. **回滚计划**：准备快速回滚方案

## 📅 **实施时间表**

| 阶段 | 时间 | 任务 | 状态 |
|------|------|------|------|
| 准备 | Day 1 上午 | Vercel账户设置 | ⏳ 待开始 |
| 配置 | Day 1 下午 | 项目配置和首次部署 | ⏳ 待开始 |
| 测试 | Day 2 上午 | 功能验证和性能测试 | ⏳ 待开始 |
| 域名 | Day 2 下午 | 域名配置和DNS切换 | ⏳ 待开始 |
| 优化 | Day 3 | 性能优化和监控配置 | ⏳ 待开始 |
| 清理 | Day 3 | 删除Netlify配置 | ⏳ 待开始 |

---

**📝 文档版本**: v1.0  
**📅 创建时间**: 2025-01-20  
**🎯 目标**: 获得更好的Next.js部署体验和性能 