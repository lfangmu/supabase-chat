import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-lg border border-border p-8 max-w-md w-full text-center space-y-4">
        <div className="text-6xl font-bold text-muted-foreground">404</div>
        <h2 className="text-xl font-bold text-foreground">
          页面未找到
        </h2>
        <p className="text-muted-foreground text-sm">
          你访问的页面不存在或已被移除。
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 rounded-lg font-medium transition-colors"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
