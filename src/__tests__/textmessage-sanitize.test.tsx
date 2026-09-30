import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import MessageItem from '@/components/chat/MessageItem';
import type { Message } from '@/types';

vi.mock('@/hooks/useSignedUrl', () => ({ useSignedUrl: (u: string) => u }));
vi.mock('@/components/chat/EmojiPicker', () => ({ default: () => null }));

const ME = '00000000-0000-0000-0000-000000000001';

const renderItem = (content: string) =>
  render(
    createElement(MessageItem, {
      message: {
        id: 'm1',
        user: 'me',
        userId: ME,
        type: 'text',
        content,
        timestamp: '2024-01-01T00:00:00.000Z',
        sendStatus: 'sent',
      } as Message,
      user: 'me',
      currentUserId: ME,
      onEdit: vi.fn(),
      onWithdraw: vi.fn(),
      onRetry: vi.fn(),
      onDelete: vi.fn(),
      isDM: true,
    })
  );

describe('TextMessage 安全：剥离危险 HTML（修复存储型 HTML 注入）', () => {
  it('XSS 载荷不产生 <img> / <script> / onerror', () => {
    const { container } = renderItem(
      `<script>alert('xss')</script><img src=x onerror=alert(1)>`
    );
    expect(container.querySelectorAll('img').length).toBe(0);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('绝对 URL 的 <img> 也被剥离（防外链追踪/布局注入）', () => {
    const { container } = renderItem(
      `<img src="https://evil.example/track.gif">`
    );
    expect(container.querySelectorAll('img').length).toBe(0);
  });

  it('iframe / svg 等嵌入标签同样被剥离', () => {
    const { container } = renderItem(
      `<iframe src="https://evil.example"></iframe><svg onload=alert(1)></svg>`
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('@提及 高亮 span 保留（rehypeRaw 仍生效）', () => {
    const { container } = renderItem('hi @alice how are you');
    const spans = container.querySelectorAll('span[class*="mention-highlight"]');
    expect(spans.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('@alice');
  });

  it('常规 markdown（粗体 / 行内代码）仍正常渲染', () => {
    const { container } = renderItem('**bold** and `code`');
    expect(container.querySelector('strong')).toBeTruthy();
    expect(container.querySelector('code')).toBeTruthy();
  });

  it('普通链接安全（javascript: 协议被剥离）', () => {
    const { container } = renderItem('[click](javascript:alert(1))');
    const a = container.querySelector('a');
    // javascript: 协议应被 sanitizer 丢弃：要么 <a> 没了 href（变纯文本），要么 href 不含 javascript:
    const href = a ? (a as HTMLAnchorElement).getAttribute('href') : null;
    expect(href === null || !/javascript:/i.test(href)).toBe(true);
  });
});
