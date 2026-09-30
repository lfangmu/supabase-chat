/**
 * 安全响应头（P2-15）。
 *
 * ⚠️ 维护须知 —— 本文件与 `public/_headers` 里的策略必须保持一致：
 *   生产部署走 Cloudflare Pages（`next-on-pages` → `.vercel/output/static`），
 *   而 next-on-pages **只**会为 Next 静态目录追加 immutable 缓存头，并**不会**把
 *   这里的 `headers()` 规则翻译成 Pages 的 `_headers`。也就是说线上真正生效的是
 *   `public/_headers`；本文件里的 `headers()` 服务于 `next start` / 自托管 / 本地
 *   生产预览。改了一处请同步另一处。
 *
 * 关于 `'unsafe-inline'`：Next.js 的 hydration 数据与主题引导脚本都是内联 <script>，
 * 组件里也大量使用内联 style，在没有引入 nonce 机制之前必须放行内联，
 * 否则页面直接白屏。CSP 在这里的价值是**收敛外部来源**（img/media/connect 白名单）
 * 与**禁止被嵌套/被当插件加载**（frame-ancestors / object-src），而不是防内联。
 */
const isDev = process.env.NODE_ENV !== 'production';

/** 允许加载图片/媒体的外部来源：Supabase Storage 签名 URL 与 ImgBB 图床 */
const MEDIA_HOSTS = ['https://*.supabase.co', 'https://i.ibb.co', 'https://ibb.co'];

const contentSecurityPolicy = [
  "default-src 'self'",
  // 开发模式下 Next 的 HMR / dev overlay 需要 eval 与 ws
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${MEDIA_HOSTS.join(' ')}`,
  `media-src 'self' data: blob: ${MEDIA_HOSTS.join(' ')}`,
  "font-src 'self' data:",
  isDev
    ? "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws: http: https:"
    : "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  // 与 frame-ancestors 'none' 呼应：老浏览器不认 CSP 的那一条
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // 语音消息要用麦克风；相机留给自己拍摄入口；其余一律关掉
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '**',
      },
      {
        protocol: 'https',
        hostname: 'i.ibb.co',
        pathname: '**',
      },
      {
        protocol: 'https',
        hostname: 'ibb.co',
        pathname: '**',
      },
    ],
    minimumCacheTTL: 60 * 60 * 24, // 24小时缓存
    // 优先使用 AVIF，其次 WebP
    // AVIF 比 WebP 再小 20-30%，但编码更慢
    formats: ['image/avif', 'image/webp'],
    // 设备尺寸列表（用于 srcset 生成）
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // 图片质量（默认 75）
    // 注意：这是 next/image 优化的质量，不影响原始上传图片
  },
  async headers() {
    return [
      {
        // 全站兜底（静态资源也有自己的缓存头，见 public/_headers）
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
