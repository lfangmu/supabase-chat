'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { defaultSchema } from 'hast-util-sanitize';
import { Message } from '@/types';
import dynamic from 'next/dynamic';
import { wechatSelfBubble, wechatOtherBubble, wechatSelfSubtle, wechatSelfLink } from '@/utils/chatStyles';

// 懒加载：react-syntax-highlighter(Prism) 体积大，仅在渲染代码块时按需加载，降低首屏 JS
const CodeBlock = dynamic(() => import('./CodeBlock'), {
  ssr: false,
  loading: () => <span className="text-xs text-muted-foreground">加载代码…</span>,
});

interface TextMessageProps {
  message: Message;
  isSelf: boolean;
}

// 放行 className，保留代码高亮语言类与 @提及 高亮类；
// 其余危险标签（script/style/iframe）与 on* 事件由 defaultSchema 剥离。
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
  },
};

const markdownComponents = (isSelf: boolean) => ({
  p: ({ children }: any) => <span>{children}</span>,
  a: ({ href, children }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline ${isSelf ? wechatSelfLink : 'text-primary hover:opacity-80'}`}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {children}
      </a>
    ),
  code: ({ className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');

    if (match) {
      return <CodeBlock language={match[1]} code={codeString} isSelf={isSelf} />;
    }

        return (
      <code
        className={`px-1 py-0.5 rounded text-sm font-mono ${isSelf ? wechatSelfSubtle : 'bg-muted'}`}
        {...props}
      >
        {children}
      </code>
    );
  },
  strong: ({ children }: any) => <strong className="font-bold">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
});

const TextMessage: React.FC<TextMessageProps> = React.memo(({ message, isSelf }) => {
  const components = markdownComponents(isSelf);

  // Pre-process content to highlight @mentions
  const processedContent = message.content.replace(/@(\w+)/g, '<span class="mention-highlight">@$1</span>');

  return (
    <div
      className={`px-4 py-2 rounded-2xl transition-all duration-200 ${isSelf ? wechatSelfBubble : wechatOtherBubble} markdown-body`}
      style={{
        width: '100%',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
        display: 'block',
        minWidth: '50px'
      }}
    >
      <style>{`
        .mention-highlight {
          color: ${isSelf ? '#fef3c7' : 'hsl(var(--primary))'};
          font-weight: 600;
        }
      `}</style>
      <ReactMarkdown components={components} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}>
          {processedContent}
        </ReactMarkdown>
      {message.edited_at && (
        <span className={`text-[10px] mt-0.5 block ${isSelf ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
          (已编辑)
        </span>
      )}
    </div>
  );
});

TextMessage.displayName = 'TextMessage';

export default TextMessage;