'use client';

import React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

/**
 * Compact theme switch (light/dark). Reuses next-themes' ThemeProvider.
 * Uses only semantic design tokens — no hardcoded colors.
 */
/**
 * 根据当前主题返回切换后的目标主题（纯函数，便于单测）。
 * 未确定（undefined，next-themes 未完成 hydration）时默认切到 dark。
 */
export function nextTheme(theme: string | undefined): 'light' | 'dark' {
  return theme === 'dark' ? 'light' : 'dark';
}

const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const toggle = () => {
    setTheme(nextTheme(theme));
  };

  return (
    <button
      onClick={toggle}
      className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
      aria-label="切换主题"
    >
      {theme === 'dark' ? (
        <Sun className="w-5 h-5 text-primary" />
      ) : (
        <Moon className="w-5 h-5 text-primary" />
      )}
    </button>
  );
};

ThemeToggle.displayName = 'ThemeToggle';

export default ThemeToggle;
