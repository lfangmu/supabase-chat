# Sentry 错误监控集成指南

## 为什么需要 Sentry

- 实时捕获前端和后端错误
- 自动收集错误堆栈、用户环境、操作面包屑
- 错误聚合与告警
- 性能监控（可选）

## 前端集成

### 步骤 1：安装依赖
```bash
npm install @sentry/nextjs
```

### 步骤 2：初始化 Sentry

创建 `sentry.client.config.ts`：
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1, // 采样率 10%
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === 'production',
});
```

创建 `sentry.server.config.ts`：
```typescript
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === 'production',
});
```

### 步骤 3：更新 next.config.mjs
```javascript
const { withSentryConfig } = require('@sentry/nextjs');

const nextConfig = {
  // ... 现有配置
};

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: 'your-org',
  project: 'your-project',
});
```

### 步骤 4：添加环境变量
在 `.env.local` 和 Cloudflare Pages 环境变量中添加：
```bash
# 前端 DSN（可公开）
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# 后端 DSN（保密）
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx

# Sentry Auth Token（用于上传 source map）
SENTRY_AUTH_TOKEN=xxx
```

## 错误边界集成

当前的 `error.tsx` 已经内置了 Sentry 上报钩子：

```typescript
// 自动检测并上报到 Sentry
if (window.Sentry) {
  window.Sentry.captureException(error);
}
```

如果集成了 Sentry，错误边界会自动上报错误。

## 自定义错误上报

如果不想用 Sentry，也可以实现自定义上报：

```typescript
// src/lib/error-reporting.ts
export async function reportError(error: Error, context?: Record<string, unknown>) {
  try {
    await fetch('/api/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        name: error.name,
        stack: error.stack,
        context,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // 上报失败，静默忽略
  }
}
```

## Cloudflare Pages 上的注意事项

1. **Source Maps**：构建时上传 source maps 到 Sentry，方便定位错误
2. **Edge Runtime**：Sentry 在 Edge Runtime 下也能工作，但某些功能受限
3. **环境变量**：确保 `NEXT_PUBLIC_` 前缀的变量在构建时就已设置

## 替代方案

如果不想用 Sentry，也可以考虑：

- **Logflare**（Cloudflare 生态，免费额度大）
- **Better Stack**
- **Datadog**
- **自建**：写入 Supabase 表 + 邮件/钉钉告警

## 验证

集成后，可以手动触发一个错误来验证：

```typescript
// 在某个组件中
<button onClick={() => { throw new Error('Test error'); }}>
  触发测试错误
</button>
```

然后去 Sentry 控制台查看是否收到错误报告。
