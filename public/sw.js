/**
 * Service Worker for Supabase Chat
 * 只缓存静态资源，不缓存 API 响应（保证消息实时性）
 */

const CACHE_NAME = 'supabase-chat-v4';
// 离线兜底页（纯静态，不含任何用户数据）
const OFFLINE_FALLBACK = '/offline.html';
// 注意：这里只放「静态、与登录用户无关」的资源。
// '/' 不进 STATIC_ASSETS：它是按用户 SSR 出来的动态文档，缓存它会串号，
// 也会把「被截断的流式文档」写进缓存。离线兜底改用 /offline.html。
const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
];

// 安装：缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // 忽略缓存失败（可能某些文件不存在）
      });
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 拦截请求：缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只缓存 GET 请求
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 不缓存 API 请求
  if (url.pathname.startsWith('/api/')) return;

  // 不缓存 Supabase 请求
  if (url.hostname.includes('supabase.co')) return;

  // 不缓存 ImgBB 请求
  if (url.hostname.includes('ibb.co')) return;

  // 脚本/样式：网络优先，缓存回退。
  // 这样每次部署后浏览器会优先取到新 bundle（Next.js 的 chunk 文件名带内容哈希，
  // 新版本即新文件名），不会再被旧缓存兜住喂旧 JS。
  if (
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // 离线时回退到缓存的副本
          return caches.match(request).then((cached) => {
            return cached || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // 图片/字体：缓存优先，网络回退（这些资源变更少，适合长缓存）
  if (
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            return new Response('Offline', { status: 503 });
          });
      })
    );
    return;
  }

  // 导航请求：只走网络，绝不写入缓存。
  //
  // 为什么不做 cache.put：
  // 1) Next.js 的 HTML 是 chunked 流式响应。cache.put 在这里是「发出即忘」的
  //    （没有 await / waitUntil 保护），Service Worker 可能在读完整个 body 之前
  //    就被浏览器回收，于是缓存里落下一份**被截断的 HTML**。截断的文档缺少
  //    app/page-*.js 等脚本标签，React 永远不会 hydrate —— 表现为整个页面卡死。
  // 2) 这条分支没有 response.ok / status===200 判断，会把 5xx 错误页
  //    （例如 Cloudflare 的 "Worker exceeded resource limits"）当作正常文档缓存。
  // 3) 每次带 query 的导航（?n= / ?cb= / ?v= ...）都会写一条，缓存无限膨胀。
  //
  // 离线兜底用 install 阶段预缓存的静态 /offline.html（cache.addAll 会完整读流）。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(OFFLINE_FALLBACK).then((cached) => {
          return cached || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        });
      })
    );
  }
});

// 处理推送通知（配合 Web Push）
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body || '新消息',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: data.data || {},
      vibrate: [200, 100, 200],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || '新消息', options)
    );
  } catch {
    // 解析失败，忽略
  }
});

// 点击通知：聚焦或打开应用
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已经打开了，就聚焦
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
