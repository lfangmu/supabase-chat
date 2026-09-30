import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UserProfileCard from '@/components/chat/UserProfileCard';

vi.mock('@/hooks/useSignedUrl', () => ({ useSignedUrl: (u: string) => u }));
vi.mock('@/utils/errorHandler', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

const TARGET = '00000000-0000-0000-0000-0000000000aa';

function mockUser(over: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    display_name: '张三',
    avatar: null,
    signature: '你好世界',
    created_at: null,
    last_active_at: null,
    ...over,
  };
}

function stubFetch(user = mockUser()) {
  const f = vi.fn(async () => ({ json: async () => ({ success: true, user }) }));
  vi.stubGlobal('fetch', f);
  return f;
}

const baseProps = {
  userId: TARGET,
  initialName: '张三',
  isSelf: false,
  isFriend: false,
  outgoingPending: false,
  incomingPending: false,
  onClose: vi.fn(),
  onSendRequest: vi.fn(async () => ({ success: true })),
  onAccept: vi.fn(async () => ({ success: true })),
  onStartDM: vi.fn(),
  onEditSelf: vi.fn(),
};

describe('UserProfileCard（点击头像弹出的个人资料卡）', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('拉取并展示昵称/签名；非好友 →「添加到通讯录」，点击后发申请并切换为「等待验证」', async () => {
    stubFetch();
    const onSendRequest = vi.fn(async () => ({ success: true }));
    render(<UserProfileCard {...baseProps} onSendRequest={onSendRequest} />);
    expect(await screen.findByText('你好世界')).toBeTruthy();

    fireEvent.click(screen.getByText('添加到通讯录'));
    await waitFor(() => expect(onSendRequest).toHaveBeenCalledWith(TARGET));
    expect(await screen.findByText('等待验证')).toBeTruthy();
  });

  it('已是好友 →「发消息」，点击调用 onStartDM', async () => {
    stubFetch();
    const onStartDM = vi.fn();
    render(<UserProfileCard {...baseProps} isFriend onStartDM={onStartDM} />);
    fireEvent.click(await screen.findByText('发消息'));
    expect(onStartDM).toHaveBeenCalledWith(TARGET);
  });

  it('对方已申请我 →「接受好友申请」，接受后切换为「发消息」', async () => {
    stubFetch();
    const onAccept = vi.fn(async () => ({ success: true }));
    render(<UserProfileCard {...baseProps} incomingPending onAccept={onAccept} />);
    fireEvent.click(await screen.findByText('接受好友申请'));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith(TARGET));
    expect(await screen.findByText('发消息')).toBeTruthy();
  });

  it('我已申请对方 →「等待验证」且按钮禁用', async () => {
    stubFetch();
    render(<UserProfileCard {...baseProps} outgoingPending />);
    const btn = (await screen.findByText('等待验证')).closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('自己 →「编辑资料」，点击调用 onEditSelf，且不显示「添加到通讯录」', async () => {
    stubFetch(mockUser({ display_name: '我' }));
    const onEditSelf = vi.fn();
    render(<UserProfileCard {...baseProps} isSelf onEditSelf={onEditSelf} />);
    fireEvent.click(await screen.findByText('编辑资料'));
    expect(onEditSelf).toHaveBeenCalled();
    expect(screen.queryByText('添加到通讯录')).toBeNull();
  });

  it('发送申请失败 → 不进入「等待验证」', async () => {
    stubFetch();
    const onSendRequest = vi.fn(async () => ({ success: false, message: 'boom' }));
    render(<UserProfileCard {...baseProps} onSendRequest={onSendRequest} />);
    fireEvent.click(await screen.findByText('添加到通讯录'));
    await waitFor(() => expect(onSendRequest).toHaveBeenCalled());
    expect(screen.queryByText('等待验证')).toBeNull();
  });
});
