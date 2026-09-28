import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MessageItem from '@/components/chat/MessageItem';
import type { Message } from '@/types';

vi.mock('@/hooks/useSignedUrl', () => ({ useSignedUrl: (u: string) => u }));
vi.mock('@/components/chat/EmojiPicker', () => ({ default: () => null }));

const ME = '00000000-0000-0000-0000-000000000001';

const baseMsg: Message = {
  id: 'm1',
  user: 'me',
  userId: ME,
  type: 'text',
  content: 'hello',
  timestamp: '2024-01-01T00:00:00.000Z',
  sendStatus: 'sent',
};

const renderItem = (over: Partial<Message> = {}, props: Record<string, unknown> = {}) =>
  render(
    createElement(MessageItem, {
      message: { ...baseMsg, ...over },
      user: 'me',
      currentUserId: ME,
      onEdit: vi.fn(),
      onWithdraw: vi.fn(),
      onRetry: vi.fn(),
      onDelete: vi.fn(),
      isDM: true,
      ...props,
    })
  );

describe('MessageItem - 编辑流程（窄气泡下按钮不可被挤出 / 不可点）', () => {
  function openMenu(container: HTMLElement) {
    // 找到 onContextMenu 实际绑定的气泡（className 含 `relative` 的最里层 div），
    // 直接派发到它。
    const bubbles = Array.from(container.querySelectorAll('div.relative'));
    const target = bubbles[bubbles.length - 1] || container;
    fireEvent.contextMenu(target);
  }

  it('上下文菜单里有「编辑」入口，点击后切换到编辑态（textarea + 取消 + 保存）', () => {
    const { container } = renderItem();
    openMenu(container);
    const editBtn = screen.getByText('编辑');
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);

    const ta = container.querySelector('textarea');
    expect(ta).toBeTruthy();
    expect((ta as HTMLTextAreaElement).value).toBe('hello');
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.getByText('保存')).toBeTruthy();

    expect(container.textContent).toContain('Esc');
    expect(container.textContent).toContain('Enter');
  });

  it('未改动时「保存」是 disabled；改动后启用；点击保存触发 onEdit 并退出编辑态', () => {
    const onEdit = vi.fn();
    const { container } = renderItem({}, { onEdit });
    openMenu(container);
    fireEvent.click(screen.getByText('编辑'));

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    const saveBtn = screen.getByText('保存').closest('button') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    fireEvent.change(ta, { target: { value: 'hello!' } });
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    expect(onEdit).toHaveBeenCalledWith('m1', 'hello!');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('「取消」按钮恢复原内容并退出编辑态（不触发 onEdit）', () => {
    const onEdit = vi.fn();
    const { container } = renderItem({}, { onEdit });
    openMenu(container);
    fireEvent.click(screen.getByText('编辑'));

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'will be discarded' } });
    fireEvent.click(screen.getByText('取消'));

    expect(onEdit).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('Enter 提交、Shift+Enter 换行、Esc 取消（键盘快捷键）', () => {
    const onEdit = vi.fn();
    const { container } = renderItem({}, { onEdit });
    openMenu(container);
    fireEvent.click(screen.getByText('编辑'));

    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'updated' } });

    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(onEdit).toHaveBeenCalledWith('m1', 'updated');

    openMenu(container);
    fireEvent.click(screen.getByText('编辑'));
    const ta2 = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(ta2, { target: { value: 'x' } });
    fireEvent.keyDown(ta2, { key: 'Escape' });
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('按钮容器带 flex-shrink-0，窄气泡下不会被挤压变形（回归点）', () => {
    // 之前按钮在窄气泡里被 mr-auto + flex 挤到重叠。修法是「把两个按钮
    // 包进带 flex-shrink-0 的内层 div」——断言这个结构存在。
    const { container } = renderItem();
    openMenu(container);
    fireEvent.click(screen.getByText('编辑'));

    const buttons = container.querySelectorAll('button');
    const cancelBtn = Array.from(buttons).find((b) => b.textContent?.trim() === '取消') as HTMLElement;
    const saveBtn = Array.from(buttons).find((b) => b.textContent?.trim() === '保存') as HTMLElement;
    expect(cancelBtn).toBeTruthy();
    expect(saveBtn).toBeTruthy();

    const parent = cancelBtn.parentElement!;
    expect(parent.className).toContain('flex-shrink-0');
    expect(saveBtn.parentElement).toBe(parent);

    expect(cancelBtn.className).toContain('whitespace-nowrap');
    expect(saveBtn.className).toContain('whitespace-nowrap');
  });
});