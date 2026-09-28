import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 建群走这个函数，测试里替换掉以捕获真实提交的群名
const createGroup = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useRoomMembers', () => ({ createGroup }));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import CreateGroupModal from '@/components/chat/CreateGroupModal';

const ME = '11111111-1111-1111-1111-111111111111';
const A = '22222222-2222-2222-2222-222222222222';
const B = '33333333-3333-3333-3333-333333333333';
const C = '44444444-4444-4444-4444-444444444444';
const D = '55555555-5555-5555-5555-555555555555';

const friend = (id: string, display_name: string) => ({
  id,
  display_name,
  avatar: null,
  signature: '',
});

const FRIENDS = [
  friend(A, '哈哈1'),
  friend(B, '小明'),
  friend(C, '阿强'),
  friend(D, '大漂亮'),
];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function renderModal(over: Record<string, unknown> = {}) {
  const props = {
    currentUserId: ME,
    currentUserName: '我',
    friends: FRIENDS,
    onClose: vi.fn(),
    onCreated: vi.fn(),
    ...over,
  };
  render(createElement(CreateGroupModal, props));
  return props;
}

const selectFriend = (name: string) => fireEvent.click(screen.getByText(name));

describe('CreateGroupModal 默认群名', () => {
  beforeEach(() => {
    createGroup.mockReset();
    createGroup.mockResolvedValue({ success: true, roomId: 'newroom' });
  });

  // 回归：历史实现用 [currentUserId, ...selected] 拼名字，3 个 UUID = 110 字，
  // 直接撞上服务端 name.length > 50 的校验 → 建群报「群名不合法」。
  it('不填群名时，默认群名用「展示名」而不是 UUID', async () => {
    renderModal();
    selectFriend('哈哈1');
    selectFriend('小明');
    fireEvent.click(screen.getByText(/^创建群聊/));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    const [name, owner, members] = createGroup.mock.calls[0];
    expect(name).toBe('我、哈哈1、小明');
    expect(name).not.toMatch(UUID_RE);
    expect(owner).toBe(ME);
    expect(members).toEqual([A, B]);
  });

  it('默认群名长度始终 ≤ 50（服务端硬校验），不会因为名字长而报「群名不合法」', async () => {
    renderModal({
      currentUserName: '这是一个特别特别特别特别长的昵称啊啊啊',
      friends: [
        friend(A, '这是一个特别特别特别特别长的好友昵称一号'),
        friend(B, '这是一个特别特别特别特别长的好友昵称二号'),
        friend(C, '这是一个特别特别特别特别长的好友昵称三号'),
        friend(D, '这是一个特别特别特别特别长的好友昵称四号'),
      ],
    });
    selectFriend('这是一个特别特别特别特别长的好友昵称一号');
    selectFriend('这是一个特别特别特别特别长的好友昵称二号');
    selectFriend('这是一个特别特别特别特别长的好友昵称三号');
    selectFriend('这是一个特别特别特别特别长的好友昵称四号');
    fireEvent.click(screen.getByText(/^创建群聊/));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    const name = createGroup.mock.calls[0][0] as string;
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name).not.toMatch(UUID_RE);
  });

  it('超过 3 个成员时默认群名以「等」结尾', async () => {
    renderModal();
    selectFriend('哈哈1');
    selectFriend('小明');
    selectFriend('阿强');
    selectFriend('大漂亮');
    fireEvent.click(screen.getByText(/^创建群聊/));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0][0]).toBe('我、哈哈1、小明等');
  });

  it('展示名全都解析不到时兜底为「群聊」，绝不提交空名（空名会被服务端 400 拒绝）', async () => {
    renderModal({ currentUserName: '', friends: [] });
    // 空好友列表无法勾选，这里直接验证 placeholder 已经退化成兜底名
    expect(screen.getByPlaceholderText('群聊名称（默认「群聊」）')).toBeInTheDocument();
  });

  it('已选 chips 显示展示名，不显示 UUID', () => {
    renderModal();
    selectFriend('哈哈1');

    // 好友列表里 1 处 + 已选 chip 1 处，都是展示名
    expect(screen.getAllByText('哈哈1')).toHaveLength(2);
    expect(screen.queryByText(A)).toBeNull();
    // placeholder 里的默认名同样不能出现 UUID
    expect(screen.getByPlaceholderText('群聊名称（默认「我、哈哈1」）')).toBeInTheDocument();
  });

  it('手填群名时优先生效，且同样截断到 50 字', async () => {
    renderModal();
    selectFriend('小明');
    const input = screen.getByPlaceholderText(/群聊名称/);
    fireEvent.change(input, { target: { value: '我的专属群' } });
    fireEvent.click(screen.getByText(/^创建群聊/));

    await waitFor(() => expect(createGroup).toHaveBeenCalledTimes(1));
    expect(createGroup.mock.calls[0][0]).toBe('我的专属群');
  });
});
