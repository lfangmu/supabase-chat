import Link from 'next/link';

// 邮件验证 / 第三方登录回调（/auth/callback）兑换会话失败时落到的页面。
export default function AuthCodeError() {
  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground mb-3">登录验证失败</h1>
        <p className="text-muted-foreground text-[15px] mb-8">
          验证链接已失效或已使用，请重新注册 / 登录获取新的验证邮件。
        </p>
        <Link
          href="/"
          className="inline-flex h-[52px] items-center justify-center rounded-[14px] bg-primary px-8 text-primary-foreground text-base font-semibold transition-all hover:opacity-90"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}
