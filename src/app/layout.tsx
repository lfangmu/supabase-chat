import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "微聊",
  description: "安全可靠的实时聊天应用",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "微聊",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content" />
        <meta name="theme-color" content="#07C160" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* 防闪烁：在首帧前应用已保存的品牌主题（默认微信风，经典主题加 .theme-classic）。
            键名/类名需与 hooks/useBrandTheme.ts 保持一致。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('chat-brand-theme')==='classic'){document.documentElement.classList.add('theme-classic');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#4F46E5');}}catch(e){}`,
          }}
        />
      </head>
      <body className="mx-auto">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: 'var(--background)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              },
            }}
          />
        </ThemeProvider>
        <script src="/register-sw.js" async />
      </body>
    </html>
  );
}
