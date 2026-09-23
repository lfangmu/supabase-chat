import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatListPage from '@/components/chat/ChatListPage';
import type { Room } from '@/types';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/useDraft', () => ({
  loadDraft: () => undefined,
}));

const makeRoom = (over: Partial<Room> = {}): Room => ({
  id: 'default-room',
  name: '默认大厅',
  created_by: 'u',
  created_at: '2024-01-01T00:00:00.000Z',
  last_message_content: '最近一条消息',
  last_message_user: 'someone',
  ...over,
});

const baseProps = {
  currentRoomId: '',
  unreadRoomIds: new Set<string>(),
  mentionedRoomIds: new Set<string>(),
  currentUser: 'me',
  onSelectRoom: vi.fn(),
  onCreateRoom: vi.fn(),
  onLogout: vi.fn(),
};

describe('ChatListPage', () => {
  it('renders group rooms without a 私聊 section when there is no DM', () => {
    const rooms = [
      makeRoom({ id: 'g1', name: '前端交流群' }),
      makeRoom({ id: 'g2', name: '读书会' }),
    ];
    render(createElement(ChatListPage, { rooms, ...baseProps }));

    expect(screen.getByText('前端交流群')).toBeInTheDocument();
    expect(screen.getByText('读书会')).toBeInTheDocument();

    // 没有私聊房间时不应出现「私聊」分组标题
    expect(screen.queryByText('私聊')).toBeNull();
    expect(screen.queryByText('单聊')).toBeNull();
    // Not accidentally showing the empty state
    expect(screen.queryByText('还没有聊天')).toBeNull();
  });

  it('groups DM rooms under 私聊 and group rooms under 群聊', () => {
    const rooms = [
      makeRoom({ id: 'g1', name: '前端交流群' }),
      makeRoom({ id: 'd1', name: '小明', type: 'dm' }),
    ];
    render(createElement(ChatListPage, { rooms, ...baseProps }));

    expect(screen.getByText('私聊')).toBeInTheDocument();
    expect(screen.getByText('群聊')).toBeInTheDocument();
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('前端交流群')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rooms', () => {
    render(createElement(ChatListPage, { rooms: [], ...baseProps }));
    expect(screen.getByText('还没有聊天')).toBeInTheDocument();
  });

  it('exposes 发起群聊 in the menu and never 添加朋友', () => {
    render(createElement(ChatListPage, { rooms: [makeRoom({ id: 'g1', name: 'G' })], ...baseProps }));
    fireEvent.click(screen.getByLabelText('操作菜单'));
    expect(screen.getByText('发起群聊')).toBeInTheDocument();
    expect(screen.queryByText('添加朋友')).toBeNull();
  });

  it('calls onLogout via the header logout button', () => {
    const onLogout = vi.fn();
    render(
      createElement(ChatListPage, {
        rooms: [makeRoom({ id: 'g1', name: 'G' })],
        ...baseProps,
        onLogout,
      }),
    );
    fireEvent.click(screen.getByLabelText('退出登录'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
