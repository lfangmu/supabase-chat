'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
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
// 关键加固：rehypeRaw 会把用户文本里的原始 HTML 解析进 AST，再交给 rehypeSanitize。
// defaultSchema 默认放行 <img>，导致 `<img src="https://evil/1.gif">` 这类标签被原样渲染，
// 形成存储型 HTML 注入（图片外链追踪 / 布局破坏）。这里明确把「嵌入/可执行/表单」类标签
// 从允许清单里剔除——聊天图片走独立的 image 消息类型，文本 markdown 不需要裸 <img>。
const DENY_TAGS = new Set([
  'img', 'iframe', 'video', 'audio', 'source', 'track', 'svg', 'object',
  'embed', 'map', 'area', 'link', 'style', 'script', 'form', 'input',
  'button', 'canvas', 'picture', 'portal', 'frame', 'frameset', 'applet',
  'base', 'meta', 'noscript', 'template', 'slot',
]);

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className'],
    code: [...(defaultSchema.attributes?.code ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
  },
  // defaultSchema.tagNames 默认包含 img 等——过滤掉所有嵌入/活动/表单类标签，
  // 仅保留安全排版标签（b/i/em/strong/code/pre/a/p/ul/ol/li/blockquote/hr/br/table/span...）。
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => !DENY_TAGS.has(t)),
};

const markdownComponents = (isSelf: boolean): Components => ({
  p: ({ children }) => <span>{children}</span>,
  a: ({ href, children }) => (
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
  code: ({ className, children, ...props }) => {
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
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
});

const TextMessage: React.FC<TextMessageProps> = React.memo(({ message, isSelf }) => {
  // P3：`markdownComponents(isSelf)` 每次 render 都返回**新对象** → react-markdown 的
  // components prop 引用变化会击穿内部 memo，整条消息重解析 markdown。按 isSelf 缓存即可。
  const components = useMemo(() => markdownComponents(isSelf), [isSelf]);

  // Pre-process content to highlight @mentions.
  // P3：同样 useMemo 化，避免每次 render 重跑正则 + 重建字符串。
  // 类名按 isSelf 二选一，样式在 globals.css 里全局定义一次（原先每条消息都注入一份 <style>）。
  const processedContent = useMemo(
    () =>
      message.content.replace(
        /@(\w+)/g,
        `<span class="${isSelf ? 'mention-highlight-self' : 'mention-highlight'}">@$1</span>`
      ),
    [message.content, isSelf]
  );

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