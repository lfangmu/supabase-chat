/**
 * Service Worker for Supabase Chat
 * 只缓存静态资源，不缓存 API 响应（保证消息实时性）
 */

const CACHE_NAME = 'supabase-chat-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
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

  // 静态资源：缓存优先，网络回退
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            // 缓存成功的响应
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            // 网络失败，返回缓存的首页（离线降级）
            if (request.mode === 'navigate') {
              return caches.match('/');
            }
            return new Response('Offline', { status: 503 });
          });
      })
    );
  }

  // 导航请求：网络优先，缓存回退
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match('/');
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
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
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
