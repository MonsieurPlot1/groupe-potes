const CACHE = 'gp-v1'
const STATIC = [
  '/', '/index.html', '/dashboard.html',
  '/css/style.css', '/css/dashboard.css',
  '/js/auth.js', '/js/dashboard.js', '/js/supabase.js',
  '/manifest.json', '/icon.svg'
]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.hostname !== location.hostname) return

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request)
      const netFetch = fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone())
        return res
      }).catch(() => null)
      return cached || await netFetch
    })
  )
})
