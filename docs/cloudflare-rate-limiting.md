# Cloudflare Rate Limiting 配置指南

应用层的 middleware 限流是第一道防线，但 Edge Runtime 下内存不跨实例共享，
建议在 Cloudflare 控制台配置 Rate Limiting Rules 作为更可靠的第二道防线。

## 配置步骤

1. 登录 Cloudflare Dashboard → 选择你的域名 → Security → WAF → Rate limiting rules

2. 创建以下规则：

### 规则 1：密码接口防暴力破解
- **规则名称**：Password Brute Force Protection
- **表达式**：
  `
  (http.request.uri.path eq "/api/verify-password") or
  (http.request.uri.path eq "/api/admin/verify")
  `
- **限流阈值**：5 请求 / 10 秒 / IP
- **动作**：Block（429）
- **超时**：60 秒

### 规则 2：上传接口限流
- **规则名称**：Upload Rate Limit
- **表达式**：
  `
  (http.request.uri.path starts with "/api/upload-media") or
  (http.request.uri.path starts with "/api/upload-proxy")
  `
- **限流阈值**：10 请求 / 分钟 / IP
- **动作**：Block（429）
- **超时**：60 秒

### 规则 3：消息发送限流
- **规则名称**：Message Send Rate Limit
- **表达式**：
  `
  (http.request.method eq "POST" and http.request.uri.path eq "/api/messages")
  `
- **限流阈值**：30 请求 / 分钟 / IP
- **动作**：Block（429）
- **超时**：60 秒

### 规则 4：管理后台操作限流
- **规则名称**：Admin Action Rate Limit
- **表达式**：
  `
  (http.request.uri.path starts with "/api/admin/")
  `
- **限流阈值**：20 请求 / 分钟 / IP
- **动作**：Block（429）
- **超时**：60 秒

### 规则 5：全局兜底限流
- **规则名称**：Global API Rate Limit
- **表达式**：
  `
  (http.request.uri.path starts with "/api/")
  `
- **限流阈值**：120 请求 / 分钟 / IP
- **动作**：Block（429）
- **超时**：60 秒

## 注意事项

- 规则顺序很重要：更具体的规则要放在前面
- 先从较高的阈值开始，观察流量后再收紧
- 可以启用 "When rate exceeds" 后的 "Log" 动作先观察一段时间
- 对于 /api/keepalive 不需要限流（GitHub Actions 定时调用）
