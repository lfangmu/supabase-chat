import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

// 每个用例结束后清理 RTL 渲染到 document.body 的 DOM。
// 本项目 CI 用 vmThreads 池（默认 threads 池在此 Node 构建下无法收集用例），
// 该池会在同一 worker 内复用 jsdom 环境并跨测试文件共享 document；若不显式清理，
// 各用例渲染的节点会在不同测试文件间堆积，导致 getBy*/findBy* 命中多个元素
// （表现为 TestingLibraryElementError: Found multiple elements）。
// 显式 afterEach(cleanup) 不受 RTL_SKIP_AUTO_CLEANUP 影响，是最稳妥的兜底。
afterEach(() => {
  cleanup();
});

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

