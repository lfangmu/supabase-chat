'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Message } from '@/types';
import { MESSAGE_CONFIG, STORAGE_CONFIG_KEYS } from '@/config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const PAGE_SIZE = MESSAGE_CONFIG.PAGE_SIZE;

export const useMessages = (roomId: string) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // 初次加载：数据库优先 + 本地缓存合并
  useEffect(() => {
    const cacheKey = `${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`;
    const cached = localStorage.getItem(cacheKey);
    let initial = cached ? JSON.parse(cached) : [];

    setMessages(initial);

    supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('timestamp', { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data, error }) => {
        if (error) {
          console.error('加载历史失败:', error);
          return;
        }
        if (data) {
          const dbMessages = data.reverse();
          const map = new Map<string, Message>();
          dbMessages.forEach(msg => {
            const key = `${msg.timestamp}-${msg.content}`;
            map.set(key, msg);
          });
          const merged = Array.from(map.values()).sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          setMessages(merged);
          localStorage.setItem(cacheKey, JSON.stringify(merged));
          setHasMore(data.length === PAGE_SIZE);
        }
      });
  }, [roomId]);

  // 向上拉加载更多
  const loadMoreHistory = useCallback(async () => {
    // 使用 ref 来获取最新的 messages 状态，避免依赖循环
    let oldestTime: string | null = null;
    let hasMessages = false;
    
    // 临时获取 messages 状态
    setMessages(prev => {
      hasMessages = prev.length > 0;
      if (hasMessages) {
        oldestTime = prev[0].timestamp;
      }
      return prev;
    });
    
    if (loadingMore || !hasMore || !hasMessages || !oldestTime) return;

    setLoadingMore(true);

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .lt('timestamp', oldestTime)
      .order('timestamp', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      console.error('加载更多失败:', error);
      setLoadingMore(false);
      return;
    }

    if (data) {
      if (data.length < PAGE_SIZE) setHasMore(false);

      const olderData = data.reverse();

      setMessages(prev => {
        const map = new Map<string, Message>();
        [...olderData, ...prev].forEach(msg => {
          const key = `${msg.timestamp}-${msg.content}`;
          map.set(key, msg);
        });
        const merged = Array.from(map.values()).sort((a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        localStorage.setItem(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, JSON.stringify(merged));
        return merged;
      });
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, roomId]);

  // 实时广播 + 撤回同步
  useEffect(() => {
    const channelName = `chat-room:${roomId}`;

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: true } },
    });

    // 独立调用 subscribe，不作为 cleanup 返回值
    channel.subscribe();

    // 监听新消息
    channel.on('broadcast', { event: 'chat-message' }, ({ payload }) => {
      setMessages(prev => {
        if (prev.some(m => m.timestamp === payload.timestamp && m.content === payload.content)) return prev;
        return [...prev, payload];
      });
    });

    // 监听撤回事件
    channel.on('broadcast', { event: 'withdraw-message' }, ({ payload }) => {
      const withdrawTimestamp = payload.timestamp;
      setMessages(prev => {
        const filtered = prev.filter(m => m.timestamp !== withdrawTimestamp);
        localStorage.setItem(`chat_messages_${roomId}`, JSON.stringify(filtered));
        return filtered;
      });
    });

    // cleanup 只 unsubscribe
    return () => {
      channel.unsubscribe();
    };
  }, [roomId]);

  // 发送消息
  const sendMessage = useCallback((message: Message) => {
    // 立即显示
    setMessages(prev => {
      if (prev.some(m => m.timestamp === message.timestamp && m.content === message.content)) return prev;
      return [...prev, message];
    });

    // 实时广播
    supabase.channel(`chat-room:${roomId}`).send({
      type: 'broadcast',
      event: 'chat-message',
      payload: message,
    });

    // 写入数据库
    supabase
      .from('messages')
      .insert([{
        room_id: roomId,
        user: message.user,
        type: message.type,
        content: message.content,
        timestamp: message.timestamp,
      }])
      .then(({ error }) => {
        if (error) console.error('写入失败:', error);
      });
  }, [roomId]);

  // 撤回消息
  const withdrawMessage = useCallback((timestamp: string) => {
    // 本地撤回
    setMessages(prev => {
      // 找到要撤回的消息
      const messageToWithdraw = prev.find(m => m.timestamp === timestamp);
      
      // 过滤掉要撤回的消息
          const filtered = prev.filter(m => m.timestamp !== timestamp);
          localStorage.setItem(`${STORAGE_CONFIG_KEYS.MESSAGES_PREFIX}${roomId}`, JSON.stringify(filtered));
      
      // 如果是图片或视频消息，删除对应的文件
      if (messageToWithdraw && (messageToWithdraw.type === 'image' || messageToWithdraw.type === 'video')) {
        // 从签名 URL 中提取文件路径
        const contentUrl = messageToWithdraw.content;
        try {
          // 处理 Supabase 存储的文件
          // 从消息中获取文件路径（直接使用存储时的路径格式）
          // 注意：这里假设消息的 content 字段是签名 URL，我们需要从 URL 中提取文件路径
          // 对于 Supabase 生成的签名 URL，格式通常是：https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
          
          let filePath = '';
          
          // 尝试解析 URL
          const url = new URL(contentUrl);
          const pathname = url.pathname;
          
          // 从路径中提取文件路径
          // 匹配格式 1：/storage/v1/object/public/<bucket>/<path>
          let match = pathname.match(/\/storage\/v1\/object\/public\/[^\/]+\/(.*)$/);
          
          // 匹配格式 2：/storage/v1/object/sign/<bucket>/<path>
          if (!match) {
            match = pathname.match(/\/storage\/v1\/object\/sign\/[^\/]+\/(.*)$/);
          }
          
          if (match && match[1]) {
            filePath = match[1];
          } else {
            // 尝试其他可能的格式
            // 匹配格式：/object/<path>
            const match2 = pathname.match(/\/object\/(.*)$/);
            if (match2 && match2[1]) {
              filePath = match2[1];
            } else {
              // 如果都匹配失败，尝试直接使用路径名
              filePath = pathname;
            }
          }
          
          console.log('提取的文件路径:', filePath);
          
          // 删除 Supabase Storage 中的文件
          supabase.storage
            .from('chat-media')
            .remove([filePath])
            .then(({ error }) => {
              if (error) {
                console.error('删除文件失败:', error);
              } else {
                console.log('删除文件成功');
              }
            });
        } catch (err) {
          console.error('解析文件 URL 失败:', err);
        }
      }
      
      return filtered;
    });

    // 广播撤回事件（让其他在线用户同步撤回）
    supabase.channel(`chat-room:${roomId}`).send({
      type: 'broadcast',
      event: 'withdraw-message',
      payload: { timestamp },
    });

    // 数据库删除
    supabase
      .from('messages')
      .delete()
      .eq('room_id', roomId)
      .eq('timestamp', timestamp)
      .then(({ error }) => {
        if (error) {
          console.error('撤回失败:', error);
        } else {
          console.log('撤回成功');
        }
      });
  }, [roomId]);

  return {
    messages,
    loadingMore,
    hasMore,
    loadMoreHistory,
    sendMessage,
    withdrawMessage,
  };
};
