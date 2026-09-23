import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThemeToggle, { nextTheme } from '@/components/chat/ThemeToggle';

// 主题切换是纯函数逻辑，脱离 next-themes / React 渲染即可确定性测试，
// 不受不同 Node / 测试池环境下 ESM mock 与 hydration 行为差异的影响。
describe('nextTheme (toggle logic)', () => {
  it('flips light -> dark', () => {
    expect(nextTheme('light')).toBe('dark');
  });

  it('flips dark -> light', () => {
    expect(nextTheme('dark')).toBe('light');
  });

  it('treats undefined (pre-hydration) as light -> dark', () => {
    expect(nextTheme(undefined)).toBe('dark');
  });
});

// 渲染冒烟：按钮存在且带可访问标签。不依赖 next-themes 的具体行为。
describe('ThemeToggle render', () => {
  it('renders a toggle button with an accessible label', () => {
    render(createElement(ThemeToggle));
    expect(screen.getByLabelText('切换主题')).toBeInTheDocument();
  });
});
