'use client';

import React, { useState, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import { useTheme } from 'next-themes';

interface CodeBlockProps {
  language: string | undefined;
  code: string;
  isSelf: boolean;
}

const CodeBlock: React.FC<CodeBlockProps> = React.memo(({ language, code, isSelf }) => {
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const lang = language?.replace('language-', '') || 'text';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="my-1.5 rounded-lg overflow-hidden border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted text-xs">
        <span className="text-muted-foreground font-mono">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span className="text-[10px]">{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={isSelf ? oneDark : isDark ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          padding: '12px 16px',
          fontSize: '13px',
          borderRadius: 0,
          background: isSelf ? 'rgba(0,0,0,0.15)' : undefined,
        }}
        codeTagProps={{
          style: {
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          },
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';

export default CodeBlock;