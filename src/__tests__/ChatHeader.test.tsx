import { createElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatHeader from '@/components/chat/ChatHeader';

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

const baseProps = {
  onBack: vi.fn(),
};

describe('ChatHeader 清空聊天记录入口', () => {
  it('does not render 清空聊天记录 when onClearHistory is omitted', () => {
    render(createElement(ChatHeader, { ...baseProps, roomName: 'G' }));
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.queryByText('清空聊天记录')).toBeNull();
  });

  it('calls onClearHistory when the menu entry is clicked', () => {
    const onClearHistory = vi.fn();
    render(createElement(ChatHeader, { ...baseProps, roomName: 'G', onClearHistory }));
    fireEvent.click(screen.getByLabelText('更多操作'));
    const entry = screen.getByText('清空聊天记录');
    expect(entry).toBeInTheDocument();
    fireEvent.click(entry);
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });

  it('renders 清空聊天记录 even for a DM (not just groups)', () => {
    const onClearHistory = vi.fn();
    render(
      createElement(ChatHeader, {
        ...baseProps,
        roomName: '小明',
        isDM: true,
        dmOtherUser: '小明',
        onClearHistory,
      })
    );
    fireEvent.click(screen.getByLabelText('更多操作'));
    expect(screen.getByText('清空聊天记录')).toBeInTheDocument();
  });
});
