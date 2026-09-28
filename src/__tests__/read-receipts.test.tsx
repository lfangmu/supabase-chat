import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useReadReceipts, receiptHandlerRef } from '@/hooks/useReadReceipts';
import type { Message } from '@/types';
import type { SendBroadcast } from '@/lib/realtimeRelay';

/**
 * 已读回执回归测试。
 *
 * 背景（线上真实故障）：对方明明已经读过、服务端 message_reads 里也有记录，
 * 但发送方消息下方一直显示「未读」。实测同一份数据「直接进房间」显示未读、
 * 「刷新页面后」显示已读——取决于 GET 已读状态与「消息列表 setMessages」谁先落地。
 *
 * 根因：已读标记只在 fetchReadState 返回的那一刻 map 一次。若那一刻消息列表还是空的
 * （或还是上一个房间的旧列表），之后才加载出来的历史消息永远拿不到 readByOther。
 *
 * 修复：applyReadFlags 变成「幂等套用」，并在 messages 每次变化时重新套用。
 */

const ME = 'me-uuid';
const OTHER = 'other-uuid';
const ROOM = `dm:${ME}:${OTHER}`;

function msg(id: string, userId: string, content: string): Message {
  return {
    id,
    user: userId === ME ? '我' : '对方',
    userId,
    type: 'text',
    content,
    timestamp: '2026-09-27T02:20:31.000Z',
    sendStatus: 'sent',
  };
}

/** 服务端已读：对方读过的我的消息 */
let serverReadIds: string[] = [];
let getCalls = 0;
let postCalls: { ids: string[] }[] = [];

function installFetchMock() {
  getCalls = 0;
  postCalls = [];
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const method = (init?.method || 'GET').toUpperCase();
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'));
      postCalls.push({ ids: body.messageIds || [] });
      return { ok: true, status: 200, json: async () => ({ success: true }) } as unknown as Response;
    }
    getCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, readMessageIds: [...serverReadIds] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/** 复刻 useMessages → useReadReceipts 的真实接线（messages 由 state 持有） */
function useHarness() {
  const [messages, setMessages] = useState<Message[]>([]);
  // 服务端中继广播出口的测试替身（真实实现由 useRelayRealtime 提供）
  const sendBroadcast: SendBroadcast = () => {};
  const messagesRef = useRef<Message[]>([]);
  useReadReceipts({
    roomId: ROOM,
    currentUserId: ME,
    isDM: true,
    isActive: true,
    messages,
    sendBroadcast,
    setMessages,
    messagesRef,
  });
  return { messages, setMessages };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useReadReceipts — 发送方「已读」状态', () => {
  beforeEach(() => {
    serverReadIds = [];
    installFetchMock();
  });

  afterEach(() => {
    receiptHandlerRef.current = null;
    vi.restoreAllMocks();
  });

  it('已读状态先于消息列表返回时，后加载的历史消息仍要拿到「已读」', async () => {
    // 对方读过 m2（但此刻消息列表还没加载出来）
    serverReadIds = ['m2'];

    const { result } = renderHook(() => useHarness());

    // 等 GET 已读状态落地——此时 messages 仍是空数组（模拟首屏竞态）
    await waitFor(() => expect(getCalls).toBe(1));
    await flush();
    expect(result.current.messages).toHaveLength(0);

    // 消息列表这才加载出来（含被读过的 m2）
    await act(async () => {
      result.current.setMessages([
        msg('m1', ME, '第一条'),
        msg('m2', ME, '第二条（对方已读）'),
        msg('m3', OTHER, '对方的回复'),
      ]);
    });
    await flush();

    const byId = (id: string) => result.current.messages.find((m) => m.id === id);
    expect(byId('m2')?.readByOther).toBe(true);
    // 未被读过的自己的消息不得误标
    expect(byId('m1')?.readByOther).toBeFalsy();
    // 对方发来的消息不该被标「已读」
    expect(byId('m3')?.readByOther).toBeFalsy();
  });

  it('重复套用已读标记不产生新数组（幂等，避免无限重渲染）', async () => {
    serverReadIds = ['m2'];

    const { result } = renderHook(() => useHarness());
    await waitFor(() => expect(getCalls).toBe(1));
    await flush();

    await act(async () => {
      result.current.setMessages([msg('m1', ME, 'a'), msg('m2', ME, 'b')]);
    });
    await flush();
    const afterFlag = result.current.messages;
    expect(afterFlag.find((m) => m.id === 'm2')?.readByOther).toBe(true);

    // 消息列表被「原样重建」（新的数组、同样的对象）——真实场景里 syncNewMessages /
    // 缓存回写都会这么做。若套用逻辑不是幂等的，这里会无限 setState 直到栈溢出。
    await act(async () => {
      result.current.setMessages((prev) => [...prev]);
    });
    await flush();

    // 内容与对象引用都不应被无意义地改写
    expect(result.current.messages[1]).toBe(afterFlag[1]);
  });

  it('收到 receipt 广播时立刻翻转对应消息', async () => {
    const { result } = renderHook(() => useHarness());
    await flush();

    await act(async () => {
      result.current.setMessages([msg('m1', ME, 'a'), msg('m2', ME, 'b')]);
    });
    await flush();

    // 对方在房间内读完 → 广播 receipt
    await act(async () => {
      receiptHandlerRef.current?.({ messageIds: ['m1', 'm2'] });
    });
    await flush();

    expect(result.current.messages.find((m) => m.id === 'm1')?.readByOther).toBe(true);
    expect(result.current.messages.find((m) => m.id === 'm2')?.readByOther).toBe(true);
  });

  it('接收方会把对方消息上报为已读（且不重复上报）', async () => {
    const { result } = renderHook(() => useHarness());
    await flush();

    await act(async () => {
      result.current.setMessages([msg('m3', OTHER, '对方消息')]);
    });
    await flush();
    await waitFor(() => expect(postCalls.length).toBe(1));
    expect(postCalls[0].ids).toEqual(['m3']);

    // 再触发一次渲染（内容不变）不应重复 POST
    await act(async () => {
      result.current.setMessages((prev) => [...prev]);
    });
    await flush();
    expect(postCalls.length).toBe(1);
  });

  it('页面不可见时到达的消息，回到前台后要补上报（否则发送方永久未读）', async () => {
    // 模拟「用户切到别的应用 / 别的 tab」：会话面板开着，但页面不可见
    let vis = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      get: () => vis,
      configurable: true,
    });

    try {
      const { result } = renderHook(() => useHarness());
      await flush();

      // 不可见期间收到对方消息 → 不能算「已读」，也不应上报
      await act(async () => {
        result.current.setMessages([msg('m3', OTHER, '切到后台时到达的消息')]);
      });
      await flush();
      expect(postCalls.length).toBe(0);

      // 用户回到前台 → 必须补上报
      vis = 'visible';
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await flush();
      await waitFor(() => expect(postCalls.length).toBe(1));
      expect(postCalls[0].ids).toEqual(['m3']);
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
      });
    }
  });
});
