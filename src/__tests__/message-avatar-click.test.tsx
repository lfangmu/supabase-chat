import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import MessageItem from '@/components/chat/MessageItem';
import type { Message } from '@/types';

vi.mock('@/hooks/useSignedUrl', () => ({ useSignedUrl: (u: string) => u }));
vi.mock('@/components/chat/EmojiPicker', () => ({ default: () => null }));

const ME = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000bb';

const msg: Message = {
  id: 'm1',
  user: '张三',
  userId: OTHER,
  type: 'text',
  content: 'hi',
  timestamp: '2024-01-01T00:00:00.000Z',
  sendStatus: 'sent',
};

describe('MessageItem - 点击头像打开个人资料卡', () => {
  it('头像可点击（role=button + 可访问名），回调收到发送者的 userId 与展示名', () => {
    const onAvatarClick = vi.fn();
    const { container } = render(
      createElement(MessageItem, {
        message: msg,
        user: 'me',
        currentUserId: ME,
        onWithdraw: vi.fn(),
        onRetry: vi.fn(),
        isDM: true,
        onAvatarClick,
      })
    );

    const avatar = container.querySelector('[role="button"][aria-label="查看 张三 的资料"]');
    expect(avatar).toBeTruthy();
    fireEvent.click(avatar as Element);
    expect(onAvatarClick).toHaveBeenCalledWith({ userId: OTHER, name: '张三' });
  });

  it('未传 onAvatarClick 时头像保持纯展示（无 button 语义）', () => {
    const { container } = render(
      createElement(MessageItem, {
        message: msg,
        user: 'me',
        currentUserId: ME,
        onWithdraw: vi.fn(),
        onRetry: vi.fn(),
        isDM: true,
      })
    );
    expect(container.querySelector('[role="button"][aria-label^="查看"]')).toBeNull();
  });
});
