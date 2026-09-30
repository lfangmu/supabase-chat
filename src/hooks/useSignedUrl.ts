'use client';

import { useState, useEffect } from 'react';

/**
 * 签名 URL 缓存：`storage path → { url, expiry }`。
 *
 * P2-23 修复：此前是「只增不删」的 Map —— 过期项不清理、也没有上界。
 * 长会话里浏览大量图片会持续累积（每个条目持有一个带签名的长 URL 字符串），
 * 模块级共享意味着所有组件实例的条目都堆在同一个 Map 里。
 * 现在加上界 + 惰性淘汰（写入时若超上限，先清过期项，再按插入顺序淘汰最旧的）。
 */
const urlCache = new Map<string, { url: string; expiry: number }>();
/** 缓存条目上限（约等于「同时活跃的媒体消息数」量级）。 */
const URL_CACHE_MAX_ENTRIES = 500;
/** 缓存有效期：签名 URL 有效 1 小时，这里留 5 分钟余量。 */
const URL_CACHE_TTL_MS = 55 * 60 * 1000;

/** 淘汰：先删过期项；仍超上限则按插入顺序（Map 迭代序）删最旧的。 */
function evictUrlCache(): void {
  const now = Date.now();
  for (const [key, entry] of urlCache) {
    if (entry.expiry <= now) urlCache.delete(key);
  }
  while (urlCache.size > URL_CACHE_MAX_ENTRIES) {
    const oldest = urlCache.keys().next();
    if (oldest.done) break;
    urlCache.delete(oldest.value);
  }
}

/** 读缓存：命中且未过期才返回，过期项顺手删除。 */
function readUrlCache(key: string): string | null {
  const cached = urlCache.get(key);
  if (!cached) return null;
  if (cached.expiry <= Date.now()) {
    urlCache.delete(key);
    return null;
  }
  return cached.url;
}

/** 写缓存：带淘汰，避免无界增长。 */
function writeUrlCache(key: string, url: string): void {
  // 重新插入以更新 Map 的插入顺序（作为 LRU 近似）
  urlCache.delete(key);
  urlCache.set(key, { url, expiry: Date.now() + URL_CACHE_TTL_MS });
  if (urlCache.size > URL_CACHE_MAX_ENTRIES) evictUrlCache();
}

/**
 * Resolves a Supabase storage path to a fresh signed URL.
 * If content is already a full URL (e.g. ImgBB), returns it as-is.
 */
export function useSignedUrl(content: string): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!content) return null;
    if (content.startsWith('http')) return content;
    return readUrlCache(content);
  });

  useEffect(() => {
    if (!content) {
      setUrl(null);
      return;
    }

    if (content.startsWith('http')) {
      setUrl(content);
      return;
    }

    // Check cache
    const cachedUrl = readUrlCache(content);
    if (cachedUrl) {
      setUrl(cachedUrl);
      return;
    }

    let cancelled = false;

    const fetchUrl = async () => {
      try {
        const res = await fetch('/api/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: content }),
        });
        const data = await res.json();

        if (cancelled) return;

        if (data.success) {
          writeUrlCache(content, data.signedUrl);
          setUrl(data.signedUrl);
        } else {
          setUrl(null);
        }
      } catch {
        if (!cancelled) setUrl(null);
      }
    };

    fetchUrl();

    return () => {
      cancelled = true;
    };
  }, [content]);

  return url;
}
