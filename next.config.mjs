/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
