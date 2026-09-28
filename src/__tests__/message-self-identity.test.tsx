import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageItem from '@/components/chat/MessageItem';
import type { Message } from '@/types';

// MessageItem 会为媒体消息签名 URL；文本用例不触发，但模块仍需可加载
vi.mock('@/hooks/useSignedUrl', () => ({ useSignedUrl: (u: string) => u }));
vi.mock('@/components/chat/EmojiPicker', () => ({ default: () => null }));

const ME = '00000000-0000-0000-0000-000000000001';

const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  user: '旧昵称',
  userId: ME,
  type: 'text',
  content: '你好',
  timestamp: '2024-01-01T00:00:00.000Z',
  sendStatus: 'sent',
  ...over,
});

const renderItem = (message: Message, user: string, currentUserId?: string) =>
  render(
    createElement(MessageItem, {
      message,
      user,
      currentUserId,
      onWithdraw: vi.fn(),
      onRetry: vi.fn(),
      isDM: true,
    })
  );

describe('MessageItem — 自消息判定（改名后历史消息不能跑到对方那一侧）', () => {
  it('改名后，用旧昵称发出的历史消息仍被认作「自己」', () => {
    // 我现在的昵称是「新昵称」，但这条历史消息里固化的是改名前的「旧昵称」
    const { container } = renderItem(msg(), '新昵称', ME);

    // 自己的消息靠右（justify-end 容器）；私聊里还会渲染「已读/未读」
    expect(container.querySelector('.justify-end')).not.toBeNull();
    expect(screen.getByText('未读')).toBeInTheDocument();
  });

  it('别人发的消息不会被认作「自己」', () => {
    const other = msg({ userId: 'other-uuid', user: '别人' });
    const { container } = renderItem(other, '新昵称', ME);

    expect(container.querySelector('.justify-end')).toBeNull();
    // 只有自己的消息才展示已读回执
    expect(screen.queryByText('未读')).toBeNull();
  });

  it('老数据缺 userId 时退回按展示名判定', () => {
    const legacy = msg({ userId: undefined, user: '新昵称' });
    const { container } = renderItem(legacy, '新昵称', ME);

    expect(container.querySelector('.justify-end')).not.toBeNull();
  });
});
