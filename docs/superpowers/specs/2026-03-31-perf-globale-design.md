# Optimisation globale — Perf site
**Date :** 2026-03-31
**Statut :** Validé
**Périmètre :** `dashboard.html`, `index.html`, `sw.js`, `js/dashboard.js`

---

## Contexte

Site statique vanilla JS + Supabase, 9 utilisateurs max simultanés. Pas de build step, pas de bundler. Les optimisations doivent être purement code natif.

---

## Ce qui N'est PAS inclus

- Minification / bundling (pas de build step)
- Code splitting / ES modules refactor (trop risqué sur ~2300 lignes de globals)
- Changement d'architecture (reste vanilla JS)

---

## 1. Chargement initial — Preconnect / DNS prefetch

**Fichiers :** `dashboard.html` et `index.html`

Ajouter dans `<head>`, **avant** les feuilles de style et scripts :

```html
<link rel="preconnect" href="https://htsxdzlcmobmpevzhshh.supabase.co">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://bakasable.metered.live">
```

**Pourquoi :** établit les connexions TCP/TLS en avance. Gain typique 200–400ms sur la première requête Supabase et jsDelivr.

Note : les scripts sont déjà `type="module"` (qui est auto-différé), pas besoin d'ajouter `defer`.

---

## 2. Service Worker — Stale-while-revalidate correct

**Fichier :** `sw.js`

### Problème actuel

Le SW actuel lance **toujours** un `fetch()` même si la ressource est en cache :

```js
const netFetch = fetch(e.request).then(...)  // toujours lancé
return cached || await netFetch
```

→ Chaque chargement de page déclenche des requêtes réseau inutiles pour CSS/JS/HTML déjà en cache.

### Solution

Stratégie par type de ressource :

**Assets statiques (CSS, JS, HTML, SVG, JSON)** — stale-while-revalidate :
- Retourner le cache immédiatement si disponible
- Lancer le fetch réseau en background avec `event.waitUntil` pour mettre à jour le cache
- Si pas en cache : attendre le réseau

**Images (Supabase Storage, avatars)** — cache-first strict :
- Retourner le cache si disponible, sans jamais lancer de fetch background
- Si pas en cache : réseau, puis mise en cache

**Version :** bump `gp-v1` → `gp-v2` pour forcer la mise à jour du SW existant.

```js
const CACHE = 'gp-v2'
const STATIC_EXTS = ['.html', '.css', '.js', '.svg', '.json', '.webmanifest']
const IMAGE_HOSTS = ['htsxdzlcmobmpevzhshh.supabase.co']

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // Images Supabase : cache-first strict
  if (IMAGE_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request)
      if (cached) return cached
      const res = await fetch(e.request)
      if (res.ok) cache.put(e.request, res.clone())
      return res
    }))
    return
  }

  // Assets statiques locaux : stale-while-revalidate
  if (url.hostname !== location.hostname) return
  const isStatic = STATIC_EXTS.some(ext => url.pathname.endsWith(ext)) || url.pathname === '/'
  if (!isStatic) return

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request)
    const netFetch = fetch(e.request).then(res => {
      if (res.ok) cache.put(e.request, res.clone())
      return res
    }).catch(() => null)
    if (cached) {
      e.waitUntil(netFetch)  // update background, sans bloquer la réponse
      return cached
    }
    return await netFetch
  }))
})
```

---

## 3. Supabase — SELECT spécifiques (pas de wildcard)

**Fichier :** `js/dashboard.js`

Remplacer les `select('*')` par des colonnes explicites. Réduit le payload JSON reçu de Supabase.

| Ligne | Fonction | Avant | Après |
|-------|----------|-------|-------|
| ~232 | `loadHomeMessages` | `select('*')` | `select('id, username, content, image_url, created_at')` |
| ~699 | `loadMessages` (initial) | `select('*')` | `select('id, username, content, image_url, created_at, reply_to, reply_preview, reactions, pinned, updated_at')` |
| ~734 | `loadMessages` (load-more) | `select('*')` | même chose |
| ~2012 | `openProfile` | `select('*')` | `select('username, bio, status, status_emoji, joined_at')` |
| ~2262 | Calendar | `select('*')` | `select('id, title, event_date, event_time, description, created_by')` |

---

## 4. DOM batching — DocumentFragment

**Fichier :** `js/dashboard.js`

Remplacer les boucles qui font `container.appendChild(el)` à chaque itération par un `DocumentFragment` inséré en une fois. Évite les recalculs de style intermédiaires.

### 4a. `loadHomeMessages` (5 messages)

```js
const frag = document.createDocumentFragment()
data.forEach(msg => {
  // ... créer div ...
  frag.appendChild(div)
})
container.appendChild(frag)
```

### 4b. `loadActivity` (≤8 items)

Même pattern avec `DocumentFragment`.

### 4c. Presence list dans `init()` (≤9 users)

Dans le callback `presence sync`, construire les `div` online-user dans un fragment, puis `onlineDiv.appendChild(frag)` en une fois (au lieu de `onlineDiv.appendChild(div)` dans la boucle).

### 4d. `loadMessages` — batch initial (50 messages)

La fonction `appendMessage` fait un `container.appendChild(div)` pour chaque message et lit `container.lastElementChild` pour la logique de grouping. Pour le batch initial :

Refactorer `appendMessage(msg, target, prevEl)` :
- `target` : `HTMLElement | DocumentFragment` (défaut: le container)
- `prevEl` : l'élément précédemment inséré dans le fragment (pour le grouping)
- Retourne l'élément créé

Dans `loadMessages`, après clear du container + ajout du sentinel :
```js
const frag = document.createDocumentFragment()
let prevEl = null
msgs.forEach(msg => {
  prevEl = appendMessage(msg, frag, prevEl)
})
container.appendChild(frag)
```

L'appel normal `appendMessage(msg)` (sans args) continue de fonctionner comme avant (realtime, optimistic UI).

---

## 5. Aucun nouveau fichier

Tout dans `dashboard.html`, `index.html`, `sw.js`, `js/dashboard.js`.
