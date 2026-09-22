# Supabase Chat with Password Protection

这是一个带有密码保护功能的实时聊天应用，基于 Next.js 和 Supabase 构建，支持实时消息、文件分享、消息撤回等功能。

## 项目概述

本项目旨在提供一个安全、易用的实时聊天解决方案，适合小团队内部沟通使用。通过密码保护机制，确保只有授权用户能够访问聊天室。

## 功能特性

### 核心功能
- 🔐 **全局密码保护** - 所有用户共享同一密码，确保只有授权用户能够访问
- 🔄 **自动检测密码变更** - 管理员修改密码后，所有在线用户会自动退出并需要重新登录
- 💬 **实时聊天功能** - 基于 Supabase 的实时广播功能，消息实时同步
- 🖼️ **多媒体分享** - 支持图片和视频上传与分享
- 📱 **响应式设计** - 适配桌面端、平板和移动设备
- 🌙 **深色模式支持** - 自动根据系统设置切换
- 🔄 **消息撤回功能** - 支持撤回已发送的消息
- 📚 **聊天历史记录** - 本地缓存和数据库存储，确保消息不丢失
- 📤 **分享功能** - 生成包含密码的分享链接，方便快速邀请他人加入

### 用户体验优化
- 📊 **上传进度显示** - 文件上传时在消息列表中显示上传进度
- 🖼️ **图片压缩** - 自动压缩上传的图片，减少带宽占用
- ⚡ **懒加载图片** - 使用 Next.js 的 Image 组件实现图片懒加载
- 🎨 **现代化界面** - 简洁、现代的设计风格
- 🔒 **安全的分享链接** - 密码和时间戳加密存储在分享链接中

### 技术优化
- 📁 **模块化架构** - 组件化设计，代码结构清晰
- ⚡ **性能优化** - 使用 React.memo、useCallback、useMemo 等优化渲染性能
- 🔧 **集中化配置** - 所有配置项集中管理，方便修改
- 📝 **类型安全** - 完整的 TypeScript 类型定义
- 🛡️ **错误处理** - 友好的错误提示和错误处理机制

## 技术架构

### 前端技术栈
- Next.js 14.2.1 - React 框架
- TypeScript - 类型安全的 JavaScript 超集
- Tailwind CSS - 实用优先的 CSS 框架
- React Hooks - 状态管理和副作用处理

### 后端技术栈
- Supabase - 开源的 Firebase 替代品，提供数据库、认证和存储服务
  - PostgreSQL - 关系型数据库
  - Realtime - 实时数据同步
  - Storage - 文件存储

### 项目结构

```
supabase-chat/
├── src/
│   ├── app/            # Next.js 应用目录
│   ├── components/     # React 组件
│   │   ├── chat/       # 聊天相关组件
│   │   └── PasswordGate.tsx  # 密码验证组件
│   ├── config/         # 配置文件
│   ├── hooks/          # 自定义 React Hooks
│   ├── types/          # TypeScript 类型定义
│   └── utils/          # 工具函数
├── public/             # 静态资源
├── .env.local          # 环境变量
├── next.config.mjs     # Next.js 配置
├── package.json        # 项目依赖
├── tailwind.config.ts  # Tailwind CSS 配置
└── tsconfig.json       # TypeScript 配置
```

## 安装和设置

### 前提条件
- Node.js 18.17.0 或更高版本
- npm、yarn、pnpm 或 bun 包管理器
- Supabase 项目账户

### 安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/your-username/supabase-chat.git
   cd supabase-chat
   ```

2. **安装依赖**
   ```bash
   npm install
   # 或
   yarn install
   # 或
   pnpm install
   ```

3. **配置环境变量**
   复制 `.env.example` 文件为 `.env.local` 并填写相应的环境变量：
   ```bash
   cp .env.example .env.local
   ```

4. **设置 Supabase 项目**
   - 创建一个新的 Supabase 项目
   - 在数据库中创建 `messages` 表，包含以下字段：
     - `id` (UUID, 主键)
     - `room_id` (VARCHAR)
     - `user` (VARCHAR)
     - `type` (VARCHAR)
     - `content` (TEXT)
     - `timestamp` (VARCHAR)
   - 创建 `chat-media` 存储桶，用于存储上传的图片和视频
   - 在存储桶的策略中添加允许匿名用户上传和删除文件的权限

## 环境变量配置

在 `.env.local` 文件中配置以下环境变量：

```env
# Supabase 配置
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_KEY=your_supabase_key

# 聊天密码配置
CHAT_PASSWORD=your_password_here
```

### 环境变量说明
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase 项目的 URL
- `NEXT_PUBLIC_SUPABASE_KEY` - Supabase 项目的匿名访问密钥
- `CHAT_PASSWORD` - 聊天室的访问密码

## 开发指南

### 启动开发服务器

```bash
npm run dev
# 或
yarn dev
# 或
pnpm dev
```

在浏览器中打开 [http://localhost:3000](http://localhost:3000) 查看应用。

### 代码规范
- 使用 TypeScript 编写所有代码
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码
- 组件命名使用 PascalCase
- 变量和函数命名使用 camelCase
- 常量命名使用 UPPER_CASE

### 开发流程
1. 创建新的分支
2. 实现功能或修复 bug
3. 运行 `npm run lint` 检查代码规范
4. 运行 `npm run build` 确保项目可以正常构建
5. 提交代码并创建 Pull Request

## 部署指南

### Vercel 部署

1. **导入项目**
   - 访问 [Vercel](https://vercel.com/new) 并登录
   - 点击 "New Project"，选择导入你的 GitHub 仓库

2. **配置项目**
   - 选择项目根目录
   - 框架选择 "Next.js"

3. **设置环境变量**
   - 在 "Environment Variables" 部分添加与 `.env.local` 相同的环境变量

4. **部署项目**
   - 点击 "Deploy" 按钮开始部署
   - 部署完成后，Vercel 会提供一个 URL 访问你的应用

### Cloudflare Pages 部署

1. **登录 Cloudflare**
   - 访问 [Cloudflare Pages](https://pages.cloudflare.com/) 并登录

2. **创建项目**
   - 点击 "Create a project"
   - 选择你的 GitHub 仓库

3. **配置构建**
   - 构建命令：`npm run build`
   - 构建输出目录：`.next`

4. **设置环境变量**
   - 在 "Environment Variables" 部分添加所需的环境变量

5. **部署项目**
   - 点击 "Save and Deploy" 开始部署

## 配置选项

项目的配置选项集中在 `src/config/index.ts` 文件中，包括：

### 文件上传配置
- `MAX_FILE_SIZE` - 最大文件大小（默认 50MB）
- `ALLOWED_FILE_TYPES` - 允许的文件类型
- `IMAGE_COMPRESSION` - 图片压缩参数

### 消息配置
- `PAGE_SIZE` - 加载历史消息的页面大小（默认 20）

### 认证配置
- `SHARE_LINK_EXPIRY` - 分享链接有效期（默认 24 小时）

### 其他配置
- `DEFAULT_ROOM` - 默认房间名称
- `SIGNED_URL_EXPIRY` - 签名 URL 有效期

## 故障排除

### 常见问题

1. **上传失败**
   - 检查文件大小是否超过限制
   - 检查文件类型是否被允许
   - 检查网络连接
   - 检查 Supabase 存储桶权限设置

2. **消息发送失败**
   - 检查网络连接
   - 检查 Supabase 实时功能是否正常

3. **密码验证失败**
   - 检查输入的密码是否正确
   - 检查环境变量中的 `CHAT_PASSWORD` 是否设置

4. **部署失败**
   - 检查环境变量是否正确设置
   - 检查构建命令是否正确
   - 检查依赖是否安装成功

### 日志和调试
- 前端错误会在浏览器控制台显示
- Supabase 相关错误会在控制台显示
- 构建错误会在部署平台的日志中显示

## 贡献指南

欢迎贡献代码或提出建议！

1. **Fork 项目**
2. **创建分支** (`git checkout -b feature/AmazingFeature`)
3. **提交更改** (`git commit -m 'Add some AmazingFeature'`)
4. **推送到分支** (`git push origin feature/AmazingFeature`)
5. **打开 Pull Request**

## 许可证

本项目采用 MIT 许可证 - 详情请参阅 [LICENSE](LICENSE) 文件

## 致谢

- [Next.js](https://nextjs.org/) - React 框架
- [Supabase](https://supabase.com/) - 开源的 Firebase 替代品
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [Compressor.js](https://github.com/fengyuanchen/compressorjs) - 图片压缩库

---

**享受聊天！** 🎉
