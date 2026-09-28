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
  // 当前用户身份为 Supabase Auth UUID
  currentUserId: '00000000-0000-0000-0000-000000000001',
  onSelectRoom: vi.fn(),
  onCreateRoom: vi.fn(),
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

  // 左上角不再有头像/退出菜单；右上角「操作菜单」(+) 仅保留 个人资料（退出登录已移除，留在「我的」tab）
  it('exposes 个人资料 in the top-right + menu; 退出登录 is not present', () => {
    const onOpenMe = vi.fn();
    render(
      createElement(ChatListPage, {
        rooms: [makeRoom({ id: 'g1', name: 'G' })],
        ...baseProps,
        onOpenMe,
      }),
    );
    // 左上角头像菜单已移除
    expect(screen.queryByLabelText('账户菜单')).toBeNull();
    // 右上角操作菜单内可见 个人资料，且不再有 退出登录
    fireEvent.click(screen.getByLabelText('操作菜单'));
    expect(screen.getByText('个人资料')).toBeInTheDocument();
    expect(screen.queryByText('退出登录')).toBeNull();
    fireEvent.click(screen.getByText('个人资料'));
    expect(onOpenMe).toHaveBeenCalledTimes(1);
  });

  // 私聊房间名是「创建者视角」写入的：创建者看到的是对方的名字，非创建者看到的是自己的名字。
  // 所以标题必须按 roomId 里内嵌的 UUID 对称推导「对方」，不能直接用 room.name。
  const ME = '00000000-0000-0000-0000-000000000001';
  const OTHER = '00000000-0000-0000-0000-000000000002';
  const dmRoom = makeRoom({
    id: `dm:${ME}:${OTHER}`,
    name: '我自己的昵称', // 服务端按创建者视角写入 → 对「我」来说其实是我自己的名字
    type: 'dm',
  });

  it('私聊标题显示「对方」的名字，而不是创建者视角的房间名（我的名字）', () => {
    render(
      createElement(ChatListPage, {
        rooms: [dmRoom],
        ...baseProps,
        resolveUserName: (id: string) => (id === OTHER ? '对方昵称' : '我自己的昵称'),
      }),
    );

    expect(screen.getByText('对方昵称')).toBeInTheDocument();
    expect(screen.queryByText('我自己的昵称')).toBeNull();
  });

  it('对方资料还没加载到时，回退用房间名兜底（不显示空白标题）', () => {
    render(
      createElement(ChatListPage, {
        rooms: [dmRoom],
        ...baseProps,
        resolveUserName: () => '',
      }),
    );

    expect(screen.getByText('我自己的昵称')).toBeInTheDocument();
  });
});
