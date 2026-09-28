import { createElement, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ChatClient from '@/app/ChatClient';

/**
 * 回归测试：改昵称后回读身份，**不能让 ChatApp 卸载重挂**。
 *
 * 症状（用户反馈）：「我修改昵称，提交后会刷新页面到消息 tab 页」。
 * 根因：`loadSession` 无条件 `setChecking(true)` → 渲染全屏 loading →
 * ChatApp 被卸载，刷新完再重挂 → 当前 tab / 打开的会话 / 滚动位置全部重置。
 * 修法：`loadSession({ silent: true })` 静默刷新，只更新 currentUser。
 */

// vi.hoisted：mock 工厂会被提升到 import 之前，普通模块级变量此时还在 TDZ。
const state = vi.hoisted(() => ({ mounts: 0 }));

vi.mock('@/components/chat/ChatApp', () => {
  const MockChatApp = ({ currentUser, onIdentityRefresh }: {
    currentUser: { displayName: string };
    onIdentityRefresh?: () => void;
  }) => {
    useEffect(() => {
      state.mounts += 1;
    }, []);
    return createElement(
      'div',
      { 'data-testid': 'chat-app', 'data-name': currentUser.displayName },
      createElement('button', { onClick: () => onIdentityRefresh?.() }, 'refresh')
    );
  };
  return { default: MockChatApp };
});

vi.mock('@/components/AuthScreen', () => ({ default: () => createElement('div', null, 'auth') }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'u1', email: null, is_anonymous: false } },
        error: null,
      }),
    },
  },
}));

describe('ChatClient — 改昵称后的身份刷新不能卸载 ChatApp', () => {
  let displayName = '旧昵称';

  beforeEach(() => {
    state.mounts = 0;
    displayName = '旧昵称';
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, user: { display_name: displayName, role: 'user' } }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('静默刷新：新昵称生效，且 ChatApp 始终只挂载一次（没有卸载重挂）', async () => {
    render(createElement(ChatClient));

    // 首次加载完成
    await waitFor(() => expect(screen.getByTestId('chat-app')).toBeInTheDocument());
    expect(screen.getByTestId('chat-app').getAttribute('data-name')).toBe('旧昵称');
    expect(state.mounts).toBe(1);

    // 用户改了昵称 → 服务端返回新名字 → 触发身份刷新
    displayName = '新昵称';
    await act(async () => {
      fireEvent.click(screen.getByText('refresh'));
    });

    // 新昵称必须传到 ChatApp
    await waitFor(() =>
      expect(screen.getByTestId('chat-app').getAttribute('data-name')).toBe('新昵称')
    );

    // 关键断言：全程没有出现过「卸载 → 重挂」
    expect(state.mounts).toBe(1);
    // 也不应出现全屏 loading（loading 时 ChatApp 不在 DOM 里）
    expect(screen.queryByTestId('chat-app')).toBeInTheDocument();
  });
});
