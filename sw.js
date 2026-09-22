// CostCal Service Worker - Version v0.4.1
const SW_VERSION = 'v0.4.1';
const CACHE_NAME = 'costcal-pwa-' + SW_VERSION;
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// 1. 安裝 Service Worker 並快取核心資源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// 2. 清除舊版快取
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. 攔截請求：採用「網路優先，失敗則退回快取」(Network First) 的策略
self.addEventListener('fetch', event => {
  // 僅處理 http 與 https 請求，忽略 chrome-extension 等瀏覽器擴充套件
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // 忽略 API 與 Supabase，且忽略帶有 t= (Cache Buster) 的版本偵測請求，確保管理員能抓到原始檔
  if (event.request.method !== 'GET' || 
      event.request.url.includes('supabase') || 
      event.request.url.includes('api') ||
      event.request.url.includes('?t=')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 若成功從網路取得，就更新快取
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 離線時，從快取尋找替代方案
        return caches.match(event.request);
      })
  );
});

// 4. 推播點擊事件：點擊通知時自動開啟或聚焦計算器視窗
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('index.html') || client.url.endsWith('/') || client.url.includes('costcal')) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
