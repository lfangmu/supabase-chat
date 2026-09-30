'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Message } from '@/types';
import { API_CONFIG } from '@/config';
import type { SendBroadcast } from '@/lib/realtimeRelay';

interface UseReadReceiptsParams {
  roomId: string;
  // 当前用户 Supabase Auth UUID（已读回执 API 以 actor 为准，UI 传展示名会被 403）
  currentUserId: string;
  isDM: boolean;
  isActive: boolean; // 会话面板当前是否真的呈现在屏幕上
  messages: Message[];
  /** 服务端中继的广播出口（替代 supabase.channel 的 send） */
  sendBroadcast: SendBroadcast;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  messagesRef: React.MutableRefObject<Message[]>;
}

/**
 * 发送方「已读」状态的兜底轮询间隔。
 *
 * receipt 广播只发给「当前正打开该房间」的客户端（后台房间用的是 chat-bg: topic，
 * 收不到发在 chat-room: 上的广播）。所以只要发送方切走了、或广播在弱网下丢了，
 * 「未读 → 已读」就不会翻转。15s 一次的服务端重拉保证最终一致（代价是一次小 GET）。
 */
const READ_RECEIPT_POLL_MS = 15_000;

/**
 * 已读回执（微信式）：
 *  - 接收方看到对方消息时，把对方发来的消息标记为已读（持久化 message_reads + 广播 receipt）
 *  - 发送方监听 receipt 广播 / 轮询 message_reads，在自己发出的消息下显示「已读 / 未读」
 * 仅私聊(isDM)展示「已读」字样。
 */
export function useReadReceipts({
  roomId,
  currentUserId,
  isDM,
  isActive,
  messages,
  sendBroadcast,
  setMessages,
}: UseReadReceiptsParams) {
  const me = currentUserId;
  // 我已经上报过已读的「对方消息」id（避免重复 POST / 重复广播）
  const markedRef = useRef<Set<string>>(new Set());
  // 我发出的消息里「已被对方读过」的 id（权威集合，来自服务端 + receipt 广播）
  const readByOtherRef = useRef<Set<string>>(new Set());
  // 轮询心跳：既驱动服务端重拉，也让「标记已读」在 POST 失败后有机会重试
  const [pollTick, setPollTick] = useState(0);
  // 回到前台的信号：见下方 visibilitychange effect 的说明
  const [visibleTick, setVisibleTick] = useState(0);

  /**
   * 把 readByOtherRef 里的 id 刷到消息对象上（Message.readByOther 供 UI 渲染「已读」）。
   *
   * 必须是「可重复调用」的纯套用动作，而不能只在 fetch 回来那一刻 map 一次：
   * fetchReadState 是异步的，它很可能在消息列表**还没加载完**（甚至是上一个房间的旧列表）
   * 时就返回；若只在那时 map 一次，之后才加载出来的消息永远拿不到标记，
   * 结果就是「对方明明已经读过，我这边却一直显示未读」（用户实际反馈的问题）。
   * 实测：同一份已读数据，直接进房间时最后一条显示未读，刷新页面后又显示已读——
   * 完全取决于 fetch 与「消息列表 setMessages」谁先落地。
   */
  const applyReadFlags = useCallback(
    (ids?: Iterable<string>) => {
      if (ids) {
        for (const id of ids) readByOtherRef.current.add(id);
      }
      if (readByOtherRef.current.size === 0) return;
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (!m.readByOther && readByOtherRef.current.has(m.id)) {
            changed = true;
            return { ...m, readByOther: true };
          }
          return m;
        });
        // 没有变化就返回原引用，避免无限重渲染
        return changed ? next : prev;
      });
    },
    [setMessages]
  );

  /** 拉取服务端已读状态：本房间内「被我以外的人读过」的消息 id（私聊里即对方读过的我的消息） */
  const fetchReadState = useCallback(async () => {
    if (!isDM || !me) return;
    try {
      const res = await fetch(
        `${API_CONFIG.MESSAGE_READ_ENDPOINT}?roomId=${encodeURIComponent(roomId)}&user=${encodeURIComponent(me)}`
      );
      const json = await res.json();
      if (json.success && Array.isArray(json.readMessageIds)) {
        applyReadFlags(json.readMessageIds as string[]);
      }
    } catch {
      /* 非致命：离线/网络抖动时忽略，下次回到前台 / 轮询会重试 */
    }
  }, [isDM, me, roomId, applyReadFlags]);

  // 切房间：重置两个集合，并拉取该房间的已读状态
  useEffect(() => {
    markedRef.current = new Set();
    readByOtherRef.current = new Set();
    fetchReadState();
  }, [roomId, fetchReadState]);

  // 消息列表每次变化都重新套用已读标记。
  // 覆盖三类场景：① fetchReadState 先于历史消息加载返回；② 实时新消息插入；
  // ③ 上滑分页加载更早的消息。缺了它就会出现「历史消息全显示未读」。
  useEffect(() => {
    if (!isDM) return;
    applyReadFlags();
  }, [messages, isDM, applyReadFlags]);

  // 监听 receipt 广播（对方标记我的消息已读）——对方正打开该房间时会即时广播
  useEffect(() => {
    if (!isDM) return;
    const handler = (payload: { messageIds?: string[] }) => {
      const ids = payload?.messageIds || [];
      if (!ids.length) return;
      applyReadFlags(ids);
    };
    // P2-24：注册到注册表（而非覆盖模块级单例），卸载时只注销自己
    return registerReceiptHandler(handler);
  }, [isDM, applyReadFlags]);

  // 回到前台时重拉一次已读状态。
  // 必要性：receipt 广播只发给「当前正打开该房间」的客户端（后台频道用的是 chat-bg: topic，
  // 收不到发在 chat-room: 上的广播）。所以对方在我切走 / 页面不可见时读了我的消息，
  // 我必须靠这次重拉才能把「未读」改成「已读」。
  //
  // 同时 bump visibleTick，让「标记已读」的 effect 也重跑一次：因为那个 effect 在页面不可见时
  // 会主动跳过（微信语义：真的看到才算已读）。若不在回到前台时补跑，就会出现
  // 「对方的消息在我切到别的应用时到达 → 我回来明明看到了 → 却没上报已读」——
  // 发送方会一直显示未读（正是用户反馈的那类问题）。
  useEffect(() => {
    if (!isDM) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchReadState();
        setVisibleTick((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isDM, fetchReadState]);

  // 兜底轮询：会话打开期间每 15s 与服务端对一次账。
  // 页面不可见时跳过（省流量，且此时 UI 也看不到）。
  useEffect(() => {
    if (!isDM || !isActive) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchReadState();
      setPollTick((n) => n + 1);
    }, READ_RECEIPT_POLL_MS);
    return () => clearInterval(timer);
  }, [isDM, isActive, fetchReadState]);

  // 接收方：会话在屏幕上可见时，把对方发来的消息标记为已读
  useEffect(() => {
    if (!isActive || !isDM || !me) return;
    // 页面被切到后台时不算「已读」（微信语义：真的看到才算）
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    // 自消息识别以 userId(UUID) 为准（与消息落库的 user_id 一致）；
    // 实时消息经 rowToMessage 已补齐 userId。服务端 POST 还会再按 user_id !== actor 兜底过滤。
    const isOwn = (m: Message) => !!m.userId && m.userId === currentUserId;
    const incoming = messages.filter((m) => !isOwn(m) && !m.withdrawn_at && !markedRef.current.has(m.id));
    if (incoming.length === 0) return;
    const ids = incoming.map((m) => m.id);
    ids.forEach((id) => markedRef.current.add(id));

    fetch(API_CONFIG.MESSAGE_READ_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, user: me, messageIds: ids }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`read ack ${res.status}`);
      })
      .catch(() => {
        // 上报失败：撤销「已标记」记录，让下一次轮询/消息变化时重试，
        // 否则对方永远看不到「已读」。
        ids.forEach((id) => markedRef.current.delete(id));
      });

    // 广播给发送方，让对方即时把「未读」改成「已读」（走服务端中继）
    sendBroadcast(roomId, 'receipt', { reader: me, messageIds: ids });
    // pollTick / visibleTick 变化时重跑本 effect：
    //  - pollTick 给上面 catch 里被撤销的 id 一次重试机会
    //  - visibleTick 保证「切到后台时到达、回到前台才被看到」的消息也补上报
  }, [
    messages,
    isActive,
    isDM,
    me,
    roomId,
    sendBroadcast,
    currentUserId,
    pollTick,
    visibleTick,
  ]);

  // 暴露给 useMessageRealtime 调用 receipt 分发
  return { fetchReadState };
}

// 模块级回执分发（P2-24）
//
// 此前是一个模块级可变引用 `receiptHandlerRef: { current: handler | null }`：
// 多实例挂载时**后写覆盖前者**（`useMessages` 被同时挂载两个房间、或 StrictMode 双挂载
// 的窗口期内都会发生），存在跨会话串扰 —— 收到 A 房间的 receipt 广播却更新了 B 房间的状态。
//
// 现在改为「注册表 + 令牌」：多个实例可并存，卸载时只移除自己注册的那一个，
// 分发时遍历全部处理器（每个实例自行判断是否与自己相关）。
type ReceiptHandler = (payload: { messageIds?: string[] }) => void;

const receiptHandlers = new Map<number, ReceiptHandler>();
let receiptHandlerSeq = 0;

/** 注册一个回执处理器，返回注销函数（供 effect cleanup 调用）。 */
export function registerReceiptHandler(handler: ReceiptHandler): () => void {
  receiptHandlerSeq += 1;
  const token = receiptHandlerSeq;
  receiptHandlers.set(token, handler);
  return () => {
    receiptHandlers.delete(token);
  };
}

/** 把回执广播分发给所有已注册处理器；单个处理器抛错不影响其它处理器。 */
export function dispatchReceipt(payload: { messageIds?: string[] }): void {
  for (const handler of Array.from(receiptHandlers.values())) {
    try {
      handler(payload);
    } catch (err) {
      console.error('receipt handler 执行失败:', err);
    }
  }
}

/** 清空注册表（仅供测试在用例之间重置状态使用）。 */
export function clearReceiptHandlers(): void {
  receiptHandlers.clear();
}
