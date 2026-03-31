const CACHE = 'gp-v2'
const STATIC = [
  '/', '/index.html', '/dashboard.html',
  '/css/style.css', '/css/dashboard.css',
  '/js/auth.js', '/js/dashboard.js', '/js/supabase.js',
  '/manifest.json', '/icon.svg'
]
const STATIC_EXTS = ['.html', '.css', '.js', '.svg', '.json', '.webmanifest']
const SUPABASE_STORAGE_HOST = 'htsxdzlcmobmpevzhshh.supabase.co'

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

  // Images Supabase Storage : cache-first strict (avatars, photos)
  if (url.hostname === SUPABASE_STORAGE_HOST && url.pathname.startsWith('/storage/')) {
    e.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        const res = await fetch(e.request)
        if (res.ok) cache.put(e.request, res.clone())
        return res
      })
    )
    return
  }

  // Assets statiques locaux : stale-while-revalidate
  if (url.hostname !== location.hostname) return
  const isStatic = STATIC_EXTS.some(ext => url.pathname.endsWith(ext)) || url.pathname === '/'
  if (!isStatic) return

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request)
      const netFetch = fetch(e.request).then(res => {
        if (res.ok) cache.put(e.request, res.clone())
        return res
      }).catch(() => null)
      if (cached) {
        e.waitUntil(netFetch) // update background, sans bloquer la réponse
        return cached
      }
      return await netFetch
    })
  )
})
