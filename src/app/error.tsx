'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Bug, Copy, Check } from 'lucide-react';

/**
 * 应用级错误边界
 * 捕获渲染错误，展示友好的错误页面，并支持错误信息复制
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 控制台输出错误
    console.error('Application error:', error);

    // 错误上报钩子（可接入 Sentry 等监控服务）
    if (typeof window !== 'undefined') {
      // @ts-ignore - Sentry 全局对象
      if (window.Sentry) {
        // @ts-ignore
        window.Sentry.captureException(error);
      }

      // 自定义错误上报（可选）
      // reportErrorToServer(error);
    }
  }, [error]);

  const copyErrorInfo = async () => {
    const errorInfo = JSON.stringify({
      message: error.message,
      name: error.name,
      digest: error.digest,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
    }, null, 2);

    try {
      await navigator.clipboard.writeText(errorInfo);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 复制失败，忽略
    }
  };

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-lg border border-border p-8 max-w-md w-full text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-destructive/10 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          出了点问题
        </h2>
        <p className="text-muted-foreground text-sm">
          应用遇到了意外错误，请尝试重新加载。
        </p>

        {/* 错误详情（可展开） */}
        <details className="text-left">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2">
            <Bug className="w-4 h-4" />
            错误详情
          </summary>
          <div className="mt-3 p-3 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-40">
            <p className="text-destructive">{error.message}</p>
            {error.digest && (
              <p className="text-muted-foreground mt-1">Digest: {error.digest}</p>
            )}
          </div>
          <button
            onClick={copyErrorInfo}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                已复制
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                复制错误信息
              </>
            )}
          </button>
        </details>

        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground hover:opacity-90 rounded-lg font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            重新加载
          </button>
        </div>
      </div>
    </div>
  );
}
