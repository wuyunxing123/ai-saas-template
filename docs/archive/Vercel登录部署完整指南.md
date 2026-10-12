# 🚀 Vercel登录部署完整指南

## 🔐 **Vercel登录选项说明**

当你运行 `vercel login` 时，会看到以下选项：

```bash
? Log in to Vercel (Use arrow keys)
> Continue with GitHub          # ✅ 推荐：使用GitHub账户登录
  Continue with GitLab           # GitLab账户登录
  Continue with Bitbucket        # Bitbucket账户登录
  Continue with SAML Single Sign-On  # 🏢 企业级SSO (需要企业账户)
 ─────────────────────────────────
  Cancel
```

### **🎯 推荐选择：Continue with GitHub**

**为什么选择GitHub？**
- ✅ 最常用的代码托管平台
- ✅ 与项目仓库无缝集成
- ✅ 自动同步代码更新
- ✅ 免费账户即可使用
- ✅ 支持自动部署

**SAML Single Sign-On是什么？**
- 🏢 企业级单点登录功能
- 💰 需要Enterprise计划 ($20+/月)
- 🔒 适用于大型组织统一身份管理
- ❌ 个人开发者不需要

## 📋 **完整登录部署步骤**

### **步骤1: Vercel登录**

```bash
# 1. 启动登录流程
vercel login

# 2. 选择 "Continue with GitHub"
# 3. 浏览器会自动打开GitHub授权页面
# 4. 点击 "Authorize Vercel" 授权
# 5. 返回终端，看到登录成功提示
```

### **步骤2: 验证登录状态**

```bash
# 检查当前登录用户
vercel whoami

# 应该显示你的GitHub用户名
# 例如: > charlie-lz
```

### **步骤3: 首次部署**

```bash
# 在项目根目录执行
vercel

# 配置选项 (建议配置):
? Set up and deploy "veo3.us"? [Y/n] y
? Which scope do you want to deploy to? [选择你的个人账户]
? Link to existing project? [N/y] n
? What's your project's name? veo3-ai
? In which directory is your code located? ./

# 等待部署完成...
```

### **步骤4: 环境变量配置**

```bash
# 方法1: 使用CLI导入
vercel env pull .env.vercel.local

# 方法2: 在Dashboard中手动配置
# 访问 https://vercel.com/dashboard
# 进入项目 -> Settings -> Environment Variables
```

**必需的环境变量：**
```bash
# 数据库配置
DATABASE_URL="file:./dev.db"

# NextAuth配置  
NEXTAUTH_URL="https://your-project.vercel.app"
NEXTAUTH_SECRET="your-secret-key"

# R2存储配置
NEXT_PUBLIC_ENABLE_R2="true"
R2_ACCOUNT_ID="e9678a567f24c2f41ae40df77744e97e"
R2_ACCESS_KEY_ID="669b0c4703363bb9dd6ca0f7ddf66816"
R2_SECRET_ACCESS_KEY="63958dfaf0875c064bd0465a77388f29affea407d457cc278bdf26f20c1166f8"
R2_BUCKET_NAME="scriptovideo"
R2_PUBLIC_URL="https://pub-12f91b2f5d5d4412a751b7664f66fbb4.r2.dev"

# 站点配置
NEXT_PUBLIC_WEB_URL="https://your-project.vercel.app"
NEXT_PUBLIC_SITE_URL="https://your-project.vercel.app"
```

### **步骤5: 自定义域名 (可选)**

```bash
# 添加自定义域名
vercel domains add veo3.us

# 配置DNS记录 (在域名提供商处)
# A记录: @ -> 76.76.19.61
# CNAME记录: www -> cname.vercel-dns.com
```

## 🔄 **自动部署 vs 手动部署**

### **🤖 自动部署 (推荐)**

**设置方式：**
1. 连接GitHub仓库到Vercel项目
2. 每次push到main分支自动触发部署
3. Pull Request自动创建预览部署

**优势：**
- ✅ 零配置，自动化
- ✅ 每个PR都有预览链接
- ✅ 支持回滚到任意版本
- ✅ 团队协作友好

### **🖐️ 手动部署**

**使用场景：**
- 🔧 测试特定配置
- 🚀 紧急修复部署
- 🎯 精确控制部署时机

**命令：**
```bash
# 部署到生产环境
vercel --prod

# 部署到预览环境
vercel

# 指定项目名称部署
vercel --name my-project
```

## 📊 **部署状态监控**

### **查看部署状态**

```bash
# 列出所有部署
vercel ls

# 查看特定部署日志
vercel logs [deployment-url]

# 查看项目信息
vercel inspect [deployment-url]
```

### **常用管理命令**

```bash
# 删除部署
vercel rm [deployment-url]

# 设置域名别名
vercel alias [deployment-url] [custom-domain]

# 查看项目设置
vercel project ls
```

## 🚨 **常见问题解决**

### **问题1: 登录失败**
```bash
# 清除本地凭据
vercel logout

# 重新登录
vercel login
```

### **问题2: 构建失败**
```bash
# 检查构建日志
vercel logs [deployment-url]

# 本地测试构建
bun run build
```

### **问题3: 环境变量问题**
```bash
# 检查环境变量
vercel env ls

# 添加环境变量
vercel env add [name] [value]

# 删除环境变量
vercel env rm [name]
```

### **问题4: 域名配置问题**
```bash
# 检查域名状态
vercel domains ls

# 验证域名配置
vercel domains inspect [domain]
```

## 💡 **最佳实践**

### **🔒 安全配置**
1. **环境变量加密**: 敏感信息使用Vercel环境变量
2. **域名验证**: 确保SSL证书正确配置
3. **访问控制**: 使用Deployment Protection保护预览

### **⚡ 性能优化**
1. **图片优化**: 启用Vercel Image Optimization
2. **缓存策略**: 合理设置Cache-Control头
3. **函数优化**: 减少冷启动时间

### **📈 监控分析**
1. **Vercel Analytics**: 启用用户行为分析
2. **Speed Insights**: 监控Core Web Vitals
3. **Error Tracking**: 配置错误监控

## 🎯 **部署检查清单**

### **部署前检查**
- [ ] 本地构建成功: `bun run build`
- [ ] 环境变量配置完整
- [ ] 数据库连接正常
- [ ] API接口测试通过

### **部署后验证**
- [ ] 首页正常访问
- [ ] 用户认证功能正常
- [ ] API接口响应正常
- [ ] 图片加载正常
- [ ] 移动端适配正常

### **性能检查**
- [ ] 页面加载速度 < 3秒
- [ ] Lighthouse分数 > 90
- [ ] Core Web Vitals良好
- [ ] 错误率 < 1%

---

**🎉 完成部署后，你的项目将在以下地址访问：**
- **预览地址**: https://your-project-hash.vercel.app
- **生产地址**: https://your-custom-domain.com (如果配置了自定义域名)

**📝 记住保存部署URL，用于后续的环境变量配置！** 