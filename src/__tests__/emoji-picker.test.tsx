import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import EmojiPicker from '@/components/chat/EmojiPicker';

// 关键回归：表情选择器必须渲染到 document.body（portal），从而脱离聊天容器的
// overflow:hidden 裁剪上下文，否则右侧气泡的「添加回应」会被裁掉一半（"表情包只显示一半"）。

describe('EmojiPicker', () => {
  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders into document.body via portal (not clipped by overflow:hidden ancestors)', () => {
    const anchorRef = createRef<HTMLDivElement>();
    const container = render(
      <div data-testid="host">
        <div ref={anchorRef} />
        <EmojiPicker
          anchorRef={anchorRef}
          onSelect={() => {}}
          onClose={() => {}}
        />
      </div>
    );

    const dialog = screen.getByRole('dialog', { name: '表情选择器' });
    expect(dialog).toBeTruthy();
    // portal：dialog 是 document.body 的直接/间接子节点，而不是 host 容器内部。
    expect(document.body.contains(dialog)).toBe(true);
    expect(container.queryByTestId('host')?.contains(dialog)).toBe(false);
  });

  it('calls onSelect and onClose when an emoji is clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <div ref={anchorRef}>
        <EmojiPicker anchorRef={anchorRef} onSelect={onSelect} onClose={onClose} />
      </div>
    );

    // jsdom 不回流布局，portal 初始 visibility:hidden 不会像真实浏览器那样被
    // useLayoutEffect 立即点亮；这里直接枚举 button 节点，验证「选择」逻辑即可。
    const allButtons = Array.from(document.querySelectorAll('button'));
    const emojiBtn = allButtons.find(
      (b) => b.getAttribute('aria-label') === '😀'
    );
    expect(emojiBtn).toBeTruthy();
    fireEvent.click(emojiBtn as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('😀');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on outside mousedown', () => {
    const onClose = vi.fn();
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <div ref={anchorRef}>
        <EmojiPicker anchorRef={anchorRef} onSelect={() => {}} onClose={onClose} />
      </div>
    );
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when the anchor element itself is clicked (toggle is the caller’s job)', () => {
    const onClose = vi.fn();
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <div ref={anchorRef}>
        <EmojiPicker anchorRef={anchorRef} onSelect={() => {}} onClose={onClose} />
      </div>
    );
    act(() => {
      fireEvent.mouseDown(anchorRef.current as HTMLElement);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
