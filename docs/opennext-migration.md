# OpenNext 迁移指南

从 `@cloudflare/next-on-pages` 迁移到 `@opennextjs/cloudflare`（OpenNext）。

## 背景

`@cloudflare/next-on-pages` 已被官方标记为 deprecated，Cloudflare 推荐使用 OpenNext 作为替代方案。
OpenNext 是 Vercel 官方支持的 Next.js 边缘运行时构建工具。

## 变更内容

### 1. 依赖变更
- **移除**：`@cloudflare/next-on-pages@1.13.11`
- **新增**：`@opennextjs/cloudflare@^0.5.0`
- **新增**：`wrangler@^3.0.0`（用于部署）

### 2. 构建命令变更
```bash
# 旧
npm run cf:build  # next-on-pages，输出到 .vercel/output

# 新
npm run cf:build  # opennextjs-cloudflare build，输出到 .open-next
```

### 3. 部署命令变更
```bash
# 旧
npx wrangler pages deploy .vercel/output --project-name xxx

# 新
npx wrangler pages deploy .open-next --project-name xxx
```

### 4. 新增命令
- `npm run cf:preview` - 本地预览 Cloudflare Pages 构建产物
- `npm run cf:deploy` - 直接部署到 Cloudflare Pages

## 迁移步骤

### 步骤 1：安装新依赖
```bash
# 卸载旧依赖
npm uninstall @cloudflare/next-on-pages

# 安装新依赖
npm install -D @opennextjs/cloudflare wrangler
```

### 步骤 2：更新 package.json scripts
```json
{
  "scripts": {
    "cf:build": "opennextjs-cloudflare build",
    "cf:preview": "opennextjs-cloudflare preview",
    "cf:deploy": "opennextjs-cloudflare deploy"
  }
}
```

### 步骤 3：更新 Cloudflare Pages 构建设置
本项目采用 Cloudflare Pages **Git 集成**（在 Cloudflare 控制台关联仓库，非 GitHub Actions 部署），因此迁移时只需改 Cloudflare 侧的构建设置：
- 构建命令：`npm run cf:build`（命令名不变，但底层实现从 `next-on-pages` 变为 `opennextjs-cloudflare`）
- 构建输出目录：从 `.vercel/output/static` 改为 `.open-next/assets`（OpenNext 输出到 `.open-next`）

### 步骤 4：本地测试
```bash
# 构建
npm run cf:build

# 本地预览
npm run cf:preview
```

### 步骤 5：部署测试
建议先部署到 staging 环境验证：
```bash
npx wrangler pages deploy .open-next --project-name your-staging-project
```

## 注意事项

### 1. 环境变量
OpenNext 对环境变量的处理可能略有不同。确保所有 `NEXT_PUBLIC_` 前缀的变量在构建时都已设置。

### 2. Edge Runtime
项目中所有 API routes 都使用了 `export const runtime = 'edge'`，这与 OpenNext 完全兼容。

### 3. 图片优化
`next/image` 在 Cloudflare Pages 上的支持：
- OpenNext 会自动配置图片优化
- `next.config.mjs` 中的 `images.remotePatterns` 配置保持不变
- `formats: ['image/webp']` 保持不变

### 4. 回滚方案
如果迁移遇到问题，可以快速回滚：
1. 恢复 `package.json` 中的依赖和 scripts
2. 恢复 workflow 中的部署路径
3. 重新部署

## 验证清单

- [ ] `npm run build` 正常通过
- [ ] `npm run cf:build` 正常通过
- [ ] `npm run cf:preview` 本地预览正常
- [ ] 部署到 staging 环境正常
- [ ] 所有 API 端点正常工作
- [ ] Realtime 功能正常
- [ ] 文件上传功能正常
- [ ] 管理后台正常
- [ ] Web Push 正常

## 参考链接

- [OpenNext Cloudflare 文档](https://opennext.js.org/cloudflare)
- [Cloudflare Pages + Next.js 指南](https://developers.cloudflare.com/pages/framework-guides/deploy-a-nextjs-site/)
