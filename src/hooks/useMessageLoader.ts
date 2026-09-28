'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Message } from '@/types';
import { MESSAGE_CONFIG, STORAGE_CONFIG_KEYS, API_CONFIG } from '@/config';
import { safeSetCache, invalidateMessageCacheIfNeeded } from '@/utils/cacheUtils';

const PAGE_SIZE = MESSAGE_CONFIG.PAGE_SIZE;
const MAX_PROCESSED_IDS = MESSAGE_CONFIG.MAX_PROCESSED_IDS;

/** Trim processedIds Set to prevent unbounded memory growth */
function trimProcessedIds(set: Set<string>) {
  if (set.size > MAX_PROCESSED_IDS) {
    const arr = Array.from(set);
    // Keep the most recent half
    const keep = arr.slice(arr.length - Math.floor(MAX_PROCESSED_IDS / 2));
    set.clear();
    keep.forEach((id) => set.add(id));
  }
}

interface UseMessageLoaderParams {
  roomId: string;
  processedIdsRef: React.MutableRefObject<Set<string>>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
}

export function useMessageLoader({ roomId, processedIdsRef, abortControllerRef }: UseMessageLoaderParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const oldestTimeRef = useRef<string | null>(null);

  /**
   * 切换房间时「同步」清空消息列表。
   *
   * messages 的加载发生在 effect 里，而 effect 要等本轮 render 提交之后才执行。若不处理，
   * 从 A 房间切到 B 房间的**第一帧**会用 B 房间的标题去渲染 A 房间的旧消息——典型症状就是
   * 「在通讯录里点开某个私聊时，会先闪一下默认聊天室的消息」。
   *
   * 这里采用 React 官方推荐的「渲染期间同步调整 state」写法：在本轮 render 内直接触发一次
   * 额外渲染，浏览器不会绘制出带旧消息的中间帧（等价于 key 变化时的状态重置）。
   */
  const [messagesRoomId, setMessagesRoomId] = useState(roomId);
  if (messagesRoomId !== roomId) {
    setMessagesRoomId(roomId);
    setMessages([]);
  }

  // Keep oldestTimeRef in sync
  useEffect(() => {
    if (messages.length > 0) {
      oldestTimeRef.current = messages[0].timestamp;
    } else {
      oldestTimeRef.current = null;
    }
  }, [messages]);

  // Initial load: DB + local cache merge
  useEffect(() => {
    // 破坏性迁移（如 00020 TRUNCATE messages）后，清掉可能残留的旧消息缓存
    invalidateMessageCacheIfNeeded();

    const cacheKey = `${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`;
    let initial: Message[] = [];
    let cancelled = false;

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        initial = JSON.parse(cached).map((m: Message) => ({ ...m, sendStatus: 'sent' as const }));
      }
    } catch {
      // Corrupted cache, start fresh
    }

    setMessages(initial);
    setIsLoading(true);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const params = new URLSearchParams({ roomId });
    fetch(`${API_CONFIG.MESSAGES_ENDPOINT}?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success || !data.messages) {
          console.error('加载历史失败:', data.message);
          return;
        }
        const dbMessages = data.messages.map((m: Message) => ({ ...m, sendStatus: 'sent' as const }));
        const map = new Map<string, Message>();
        dbMessages.forEach((msg: Message) => {
          map.set(msg.id, msg);
          processedIdsRef.current.add(msg.id);
        });
        trimProcessedIds(processedIdsRef.current);
        initial.forEach((msg) => {
          if (!map.has(msg.id)) map.set(msg.id, msg);
        });
        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        setMessages(merged);
        safeSetCache(cacheKey, merged);
        setHasMore(data.messages.length === PAGE_SIZE);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.error('加载历史请求失败:', err);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      // 注意：不要在这里 clear() 共享的 processedIdsRef。它是跨房间共用的去重集合
      // （useMessages 实例级），被某个房间的清理逻辑清空会导致其它房间的实时消息
      // 去重失效、出现重复处理。内存上限由 trimProcessedIds 在各处统一管控。
    };
  }, [roomId, processedIdsRef, abortControllerRef]);

  // Load older messages
  const loadMoreHistory = useCallback(async () => {
    if (loadingMore || !hasMore || !oldestTimeRef.current) return;

    setLoadingMore(true);

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const params = new URLSearchParams({ roomId, before: oldestTimeRef.current });
      const res = await fetch(`${API_CONFIG.MESSAGES_ENDPOINT}?${params}`, { signal: controller.signal });
      const data = await res.json();

      if (!data.success || !data.messages) {
        console.error('加载更多失败:', data.message);
        setLoadingMore(false);
        return;
      }

      if (data.messages.length < PAGE_SIZE) setHasMore(false);
      const olderData = data.messages.map((m: Message) => ({ ...m, sendStatus: 'sent' as const }));
      olderData.forEach((m: Message) => processedIdsRef.current.add(m.id));
      trimProcessedIds(processedIdsRef.current);

      setMessages((prev) => {
        const map = new Map<string, Message>();
        [...olderData, ...prev].forEach((msg) => map.set(msg.id, msg));
        const merged = Array.from(map.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, merged);
        return merged;
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('加载更多请求失败:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, roomId, processedIdsRef, abortControllerRef]);

  // Sync new messages from DB (catch-up after reconnect or pull-to-refresh)
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const syncNewMessages = useCallback(async (): Promise<number> => {
    const current = messagesRef.current;
    const newestTimestamp = current.length > 0 ? current[current.length - 1].timestamp : null;

    try {
      const params = new URLSearchParams({ roomId });
      if (newestTimestamp) params.set('after', newestTimestamp);
      const res = await fetch(`${API_CONFIG.MESSAGES_ENDPOINT}?${params}`);
      const data = await res.json();

      if (!data.success || !data.messages || data.messages.length === 0) return 0;

      const newMsgs = (data.messages as Message[]).map((m) => ({ ...m, sendStatus: 'sent' as const }));
      let addedCount = 0;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const toAdd = newMsgs.filter((m) => {
          if (existingIds.has(m.id)) return false;
          processedIdsRef.current.add(m.id);
          return true;
        });
        if (toAdd.length === 0) return prev;
        addedCount = toAdd.length;
        trimProcessedIds(processedIdsRef.current);
        const merged = [...prev, ...toAdd].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        safeSetCache(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, merged);
        return merged;
      });

      return addedCount;
    } catch {
      return 0;
    }
  }, [roomId, processedIdsRef]);

  return { messages, setMessages, loadingMore, hasMore, loadMoreHistory, isLoading, syncNewMessages };
}