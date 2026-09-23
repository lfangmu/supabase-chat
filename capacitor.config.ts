import type { CapacitorConfig } from '@capacitor/cli';

// 加载线上部署地址。构建 APK 前请用环境变量 APP_URL 指定你的站点 URL，例如：
//   APP_URL=https://your-chat.example.com npx cap sync android
// 仓库不内置任何具体部署地址；未设置时回退到占位地址（需自行替换）。
const APP_URL = process.env.APP_URL || 'https://your-chat.example.com';

const config: CapacitorConfig = {
  appId: 'cc.ru.chat',
  appName: '私聊',
  // 直接加载线上部署地址，无需打包前端静态资源
  server: {
    url: APP_URL,
    cleartext: false,
    androidScheme: 'https',
  },
  // 允许 WebSocket 和 API 请求通过
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#09090b',
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
