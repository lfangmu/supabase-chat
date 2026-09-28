import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContactsPage from '@/components/chat/ContactsPage';

const A = '22222222-2222-2222-2222-222222222222';
const B = '33333333-3333-3333-3333-333333333333';

const FRIENDS = [
  { id: A, display_name: '哈哈1', avatar: null, signature: '你好' },
  { id: B, display_name: '小明', avatar: null, signature: '' },
];

const baseProps = {
  friends: FRIENDS,
  incoming: [],
  outgoing: [],
  onlineNicknames: [],
  onSelectFriend: vi.fn(),
  onAddFriend: vi.fn(),
  onAccept: vi.fn(),
  onReject: vi.fn(),
};

describe('ContactsPage 删除好友入口', () => {
  // 回归：之前好友行是纯按钮，没有任何删除入口，用户报「没有删除好友的入口」。
  it('每个好友行都有「更多操作」按钮，点开出现「删除好友」', () => {
    render(createElement(ContactsPage, { ...baseProps, onRemoveFriend: vi.fn() }));

    expect(screen.getByLabelText('更多操作：哈哈1')).toBeInTheDocument();
    expect(screen.getByLabelText('更多操作：小明')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('更多操作：哈哈1'));
    expect(screen.getByText('删除好友')).toBeInTheDocument();
    expect(screen.getByText('发消息')).toBeInTheDocument();
  });

  it('未传 onRemoveFriend 时不渲染删除入口（保持旧行为）', () => {
    render(createElement(ContactsPage, baseProps));
    expect(screen.queryByLabelText('更多操作：哈哈1')).toBeNull();
  });

  it('删除需二次确认，确认后按「对方 UUID」调用 onRemoveFriend', async () => {
    const onRemoveFriend = vi.fn().mockResolvedValue(undefined);
    render(createElement(ContactsPage, { ...baseProps, onRemoveFriend }));

    fireEvent.click(screen.getByLabelText('更多操作：哈哈1'));
    fireEvent.click(screen.getByText('删除好友'));

    // 二次确认文案出现前不应该已经删除
    expect(onRemoveFriend).not.toHaveBeenCalled();
    expect(screen.getByText(/确定删除好友「哈哈1」/)).toBeInTheDocument();

    // 面板里的「删除」按钮（与菜单项「删除好友」区分）
    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(onRemoveFriend).toHaveBeenCalledTimes(1));
    expect(onRemoveFriend).toHaveBeenCalledWith(A);
  });

  it('二次确认里点「取消」不会删除', () => {
    const onRemoveFriend = vi.fn();
    render(createElement(ContactsPage, { ...baseProps, onRemoveFriend }));

    fireEvent.click(screen.getByLabelText('更多操作：小明'));
    fireEvent.click(screen.getByText('删除好友'));
    fireEvent.click(screen.getAllByText('取消')[0]);

    expect(onRemoveFriend).not.toHaveBeenCalled();
  });

  it('点好友行仍然是打开私聊（删除入口不劫持主点击区）', () => {
    const onSelectFriend = vi.fn();
    render(
      createElement(ContactsPage, {
        ...baseProps,
        onSelectFriend,
        onRemoveFriend: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByText('小明'));
    expect(onSelectFriend).toHaveBeenCalledWith(B);
  });

  it('点「更多操作」不会顺带打开私聊', () => {
    const onSelectFriend = vi.fn();
    render(
      createElement(ContactsPage, {
        ...baseProps,
        onSelectFriend,
        onRemoveFriend: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByLabelText('更多操作：哈哈1'));
    expect(onSelectFriend).not.toHaveBeenCalled();
  });

  it('面板里的「发消息」直接进入私聊', () => {
    const onSelectFriend = vi.fn();
    render(
      createElement(ContactsPage, {
        ...baseProps,
        onSelectFriend,
        onRemoveFriend: vi.fn(),
      }),
    );

    fireEvent.click(screen.getByLabelText('更多操作：哈哈1'));
    fireEvent.click(screen.getByText('发消息'));
    expect(onSelectFriend).toHaveBeenCalledWith(A);
  });
});
