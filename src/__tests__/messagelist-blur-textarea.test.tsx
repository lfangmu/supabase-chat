import { describe, it, expect } from 'vitest';

// 验证关键修复点：消息列表容器的 onClick「收起键盘」逻辑，不能误把
// 编辑态 textarea 一起 blur，否则用户点了编辑框之后焦点立刻回到 <body>，
// 键盘事件落不进 textarea，造成「点了编辑但无法改」的 bug。

function makeListLikeContainer(): HTMLElement {
  // 复用 MessageList.tsx:496-502 的同款 handler
  const container = document.createElement('main');
  container.setAttribute('role', 'list');
  container.addEventListener('click', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'TEXTAREA' && tag !== 'INPUT') {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  });
  return container;
}

describe('MessageList onClick — 点击 textarea 不能把它 blur 掉', () => {
  it('点击 TEXTAREA 后焦点保留在 textarea', () => {
    document.body.innerHTML = '';
    const container = makeListLikeContainer();
    const ta = document.createElement('textarea');
    ta.value = 'hi';
    container.appendChild(ta);
    document.body.appendChild(container);

    ta.focus();
    expect(document.activeElement).toBe(ta);

    // 模拟冒泡到容器
    ta.click();

    expect(document.activeElement).toBe(ta);
  });

  it('点击普通 DIV（空白区）会把活动元素 blur', () => {
    document.body.innerHTML = '';
    const container = makeListLikeContainer();
    const div = document.createElement('div');
    const ta = document.createElement('textarea');
    container.appendChild(ta);
    container.appendChild(div);
    document.body.appendChild(container);

    ta.focus();
    expect(document.activeElement).toBe(ta);

    div.click();

    expect(document.activeElement).not.toBe(ta);
    expect(document.activeElement).toBe(document.body);
  });

  it('点击 INPUT 后焦点保留在 input', () => {
    document.body.innerHTML = '';
    const container = makeListLikeContainer();
    const inp = document.createElement('input');
    container.appendChild(inp);
    document.body.appendChild(container);

    inp.focus();
    expect(document.activeElement).toBe(inp);

    inp.click();

    expect(document.activeElement).toBe(inp);
  });

  it('点击 BUTTON 后焦点保留在 button', () => {
    document.body.innerHTML = '';
    const container = makeListLikeContainer();
    const btn = document.createElement('button');
    container.appendChild(btn);
    document.body.appendChild(container);

    btn.focus();
    expect(document.activeElement).toBe(btn);

    btn.click();

    expect(document.activeElement).toBe(btn);
  });

  it('点击 A 后焦点保留在链接', () => {
    document.body.innerHTML = '';
    const container = makeListLikeContainer();
    const a = document.createElement('a');
    a.href = '#';
    container.appendChild(a);
    document.body.appendChild(container);

    a.focus();
    expect(document.activeElement).toBe(a);

    a.click();

    expect(document.activeElement).toBe(a);
  });
});