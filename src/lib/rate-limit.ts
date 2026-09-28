/**
 * 轻量级 IP 限流（滑动窗口）
 *
 * 注意：Edge Runtime 下内存不跨实例共享，
 * 这是应用层第一道防线，建议同时在 Cloudflare 控制台配置 Rate Limiting Rules。
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

export interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内最大请求数 */
  max: number;
}

/** 不同路由的限流策略 */
export const RATE_LIMIT_RULES: Array<{
  /** 路由前缀匹配 */
  pathPrefix: string;
  config: RateLimitConfig;
}> = [
  // 上传接口：中等限流
  {
    pathPrefix: '/api/upload-media',
    config: { windowMs: 60 * 1000, max: 10 },
  },
  {
    pathPrefix: '/api/upload-proxy',
    config: { windowMs: 60 * 1000, max: 10 },
  },
  // 发消息：中等限流
  {
    pathPrefix: '/api/messages',
    config: { windowMs: 60 * 1000, max: 30 },
  },
  // 房间操作：中等限流
  {
    pathPrefix: '/api/rooms',
    config: { windowMs: 60 * 1000, max: 20 },
  },
  // 管理后台操作：严格限流
  {
    pathPrefix: '/api/admin/rooms',
    config: { windowMs: 60 * 1000, max: 10 },
  },
  {
    pathPrefix: '/api/admin/messages',
    config: { windowMs: 60 * 1000, max: 20 },
  },
  {
    pathPrefix: '/api/admin/audit-logs',
    config: { windowMs: 60 * 1000, max: 10 },
  },
];

/** 默认限流策略（兜底） */
const DEFAULT_CONFIG: RateLimitConfig = { windowMs: 60 * 1000, max: 60 };

/**
 * 获取指定路径的限流配置
 */
export function getRateLimitConfig(pathname: string): RateLimitConfig {
  const rule = RATE_LIMIT_RULES.find((r) => pathname.startsWith(r.pathPrefix));
  return rule?.config ?? DEFAULT_CONFIG;
}

/**
 * 检查是否超过限流
 * @returns { limited: boolean; remaining: number; resetTime: number }
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): { limited: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const entry = store.get(key);

  // 新窗口或窗口已过期
  if (!entry || now >= entry.resetTime) {
    store.set(key, { count: 1, resetTime: now + config.windowMs });
    return { limited: false, remaining: config.max - 1, resetTime: now + config.windowMs };
  }

  // 在当前窗口内
  entry.count += 1;
  const limited = entry.count > config.max;
  const remaining = Math.max(0, config.max - entry.count);

  // 清理过期条目（简单内存管理：超过 1000 条时清理一半过期的）
  if (store.size > 1000) {
    for (const [k, v] of store) {
      if (now >= v.resetTime) {
        store.delete(k);
      }
    }
  }

  return { limited, remaining, resetTime: entry.resetTime };
}

/**
 * 从请求中提取客户端 IP
 * 优先用 CF-Connecting-IP（Cloudflare），其次 X-Forwarded-For，最后回退到未知
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
