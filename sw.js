const VERSION = 'v5';
const SHELL = 'shell-' + VERSION;
const DATA = 'ledger-data';
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const ASSETS = ['./', './index.html', './app.js', './rules.js', './style.css', './manifest.webmanifest', './icon-192.png', './icon-512.png', XLSX_URL];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 공유 목록에서 넘어온 가계부 파일을 저장하고 앱 화면으로 돌려보낸다
async function receiveShare(request) {
  try {
    const form = await request.formData();
    // 메일 보내기로 공유하면 본문 글과 첨부 엑셀이 함께 온다. 가장 큰 것이 가계부다.
    const files = form.getAll('file').filter((f) => f && f.arrayBuffer);
    const file = files.sort((a, b) => b.size - a.size)[0];
    const info = files.map((f) => `${f.type || '?'}:${f.size}`).join(',');
    if (file) {
      const cache = await caches.open(DATA);
      await cache.put('./ledger-file', new Response(await file.arrayBuffer(), {
        headers: { 'X-Name': encodeURIComponent(file.name || ''), 'X-Saved': String(Date.now()) },
      }));
      return Response.redirect('./?shared=1&got=' + encodeURIComponent(info), 303);
    }
  } catch (err) { /* 아래에서 실패 화면으로 */ }
  return Response.redirect('./?shared=0', 303);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET') return;
  // 새 버전이 있으면 받아 두고, 오프라인이면 저장본으로
  // 브라우저에 남은 옛 파일을 쓰지 않도록 서버에 매번 확인한다
  const fresh = url.origin === location.origin ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok && (url.origin === location.origin || e.request.url === XLSX_URL)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
