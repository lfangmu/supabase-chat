import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

// jsdom 不实现 SubtleCrypto，而 auth 模块（PBKDF2/HMAC 会话签名）依赖 Web Crypto 的
// crypto.subtle。用 Node 自带的 webcrypto 兜底，保证鉴权相关单测可运行。
if (!(globalThis.crypto && 'subtle' in globalThis.crypto)) {
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
      writable: true,
    });
  } catch {
    // 某些环境下 globalThis.crypto 不可重定义，忽略
  }
}

// jsdom 不实现 matchMedia，next-themes 的 ThemeProvider 依赖它；补一个空实现。
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

