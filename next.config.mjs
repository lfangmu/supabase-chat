/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
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
    formats: ['image/webp'], // 优先使用 WebP 格式
  },
};

export default nextConfig;
