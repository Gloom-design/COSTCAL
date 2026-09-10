const CACHE_NAME = 'costcal-cache-v2';

// 只需要快取基本的靜態設定（不要把 index.html 寫死在裡面強迫離線鎖死）
const ASSETS_TO_CACHE = [
  './manifest.json'
];

// 安裝時快取基本檔案
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 啟動時自動清除舊版快取，並取得控制權
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 攔截請求
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. 略過後端 API 請求，直接走網路
  if (url.pathname.includes('/api/stock')) {
    return;
  }

  // 2. 針對網頁主畫面（index.html / 導覽頁面）：採用「網路優先」策略
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // 有網路時，順便把最新抓到的首頁更新到快取裡
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // 網路失敗（代表斷線離線中），才從快取讀取備用畫面
          return caches.match('./index.html') || caches.match('./');
        })
    );
    return;
  }

  // 3. 其他靜態資源（CSS, JS, 圖示等）：快取優先，背景更新
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
        });
        return networkResponse;
      }).catch(() => {
        // 網路抓不到時靜默忽略
      });

      return cachedResponse || fetchPromise;
    })
  );
});
