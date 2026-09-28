import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminPage from '@/app/admin/page';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const makeFetch = (status: number) =>
  vi.fn(async () => ({ status, json: async () => ({}) }) as unknown as Response);

describe('AdminPage 鉴权分支', () => {
  it('非管理员(403) 不应卡在「校验中」无限转圈，应退回登录框并提示无权限', async () => {
    vi.stubGlobal('fetch', makeFetch(403));
    render(createElement(AdminPage));

    // 退回登录框：能看到「管理后台」标题（不再是纯 Loader2 画面）
    expect(await screen.findByText('管理后台')).toBeInTheDocument();
    // 明确告知「不是管理员」
    expect(
      await screen.findByText('当前账号不是管理员，请使用管理员账号登录')
    ).toBeInTheDocument();
  });

  it('未登录(401) 退回登录框，但不显示「不是管理员」提示', async () => {
    vi.stubGlobal('fetch', makeFetch(401));
    render(createElement(AdminPage));

    expect(await screen.findByText('管理后台')).toBeInTheDocument();
    expect(
      screen.queryByText('当前账号不是管理员，请使用管理员账号登录')
    ).toBeNull();
  });
});
