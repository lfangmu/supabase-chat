import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Supabase Chat",
  description: "Secure chat application with password protection",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="dark mx-auto max-w-3xl">{children}</body>
    </html>
  );
}
