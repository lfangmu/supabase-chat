'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 品牌主题（与明暗模式是两回事，二者可叠加）：
 * - `wechat`  微信风（默认）：微信绿 + 中性灰
 * - `classic` 经典「靛蓝冷调」：indigo + slate
 *
 * 落地方式：在 <html> 上切换 `.theme-classic` 类（默认无类即微信风），
 * 令牌定义见 globals.css。选择持久化在 localStorage，由管理页一键切换。
 */
export type BrandTheme = 'wechat' | 'classic';

/** localStorage 键名（与 layout.tsx 的防闪烁内联脚本保持一致） */
export const BRAND_THEME_KEY = 'chat-brand-theme';
export const DEFAULT_BRAND_THEME: BrandTheme = 'wechat';
/** 经典主题的根类名 */
export const BRAND_THEME_CLASS = 'theme-classic';
/** 同页多组件同步用的自定义事件名 */
const BRAND_THEME_EVENT = 'brand-theme-change';

/** 各主题对应的浏览器主题色（用于 <meta name="theme-color">） */
const THEME_COLOR: Record<BrandTheme, string> = {
  wechat: '#07C160',
  classic: '#4F46E5',
};

export function getBrandTheme(): BrandTheme {
  if (typeof window === 'undefined') return DEFAULT_BRAND_THEME;
  try {
    return window.localStorage.getItem(BRAND_THEME_KEY) === 'classic' ? 'classic' : 'wechat';
  } catch {
    return DEFAULT_BRAND_THEME;
  }
}

/** 把主题应用到 DOM（根类 + 浏览器主题色），不做持久化 */
export function applyBrandTheme(theme: BrandTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(BRAND_THEME_CLASS, theme === 'classic');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
}

/** 持久化 + 应用 + 广播（同页组件与跨标签页都会同步） */
export function setBrandTheme(theme: BrandTheme): void {
  try {
    window.localStorage.setItem(BRAND_THEME_KEY, theme);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略即可 */
  }
  applyBrandTheme(theme);
  window.dispatchEvent(new Event(BRAND_THEME_EVENT));
}

/** 读取 + 切换品牌主题的 React Hook */
export function useBrandTheme() {
  const [theme, setThemeState] = useState<BrandTheme>(DEFAULT_BRAND_THEME);

  useEffect(() => {
    setThemeState(getBrandTheme());
    const sync = () => setThemeState(getBrandTheme());
    // 同页切换（自定义事件）与跨标签页切换（storage）都要同步
    window.addEventListener(BRAND_THEME_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BRAND_THEME_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setTheme = useCallback((t: BrandTheme) => setBrandTheme(t), []);
  const toggle = useCallback(
    () => setBrandTheme(getBrandTheme() === 'classic' ? 'wechat' : 'classic'),
    []
  );

  return { theme, setTheme, toggle };
}
