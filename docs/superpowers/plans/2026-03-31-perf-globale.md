# Optimisation globale perf — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer la vitesse de chargement, les temps de réponse Supabase et la fluidité DOM du site groupe-potes.

**Architecture:** Pas de build step — tout se fait en HTML/JS/CSS natif. 4 tâches indépendantes, chacune commitée séparément. Pas de nouveau fichier créé.

**Tech Stack:** Vanilla JS ES6+, Supabase JS v2 (CDN), Service Worker API, DocumentFragment

---

## Fichiers modifiés

| Fichier | Modifications |
|---------|--------------|
| `dashboard.html` | Ajout preconnect/dns-prefetch dans `<head>` |
| `index.html` | Même chose |
| `sw.js` | Stratégie cache par type de ressource + version bump |
| `js/dashboard.js` | SELECT spécifiques + DocumentFragment |

---

### Task 1 : Preconnect + DNS prefetch

**Files:**
- Modify: `dashboard.html` (lignes 4–16 dans `<head>`)
- Modify: `index.html` (lignes 4–15 dans `<head>`)

**Contexte :** Le navigateur ne connaît pas les domaines tiers (Supabase, jsDelivr, Google Fonts) avant de parser le HTML. Les preconnect établissent TCP+TLS en avance, économisant 200–400ms sur le premier appel. Les scripts sont déjà `type="module"` (auto-différés), pas besoin de `defer`.

- [ ] **Step 1 : Ajouter preconnect dans `dashboard.html`**

Dans `dashboard.html`, ajouter **avant** les `<link rel="stylesheet">` existants :

```html
  <link rel="preconnect" href="https://htsxdzlcmobmpevzhshh.supabase.co">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="dns-prefetch" href="https://bakasable.metered.live">
```

Le `<head>` doit ressembler à :
```html
<head>
  <meta charset="UTF-8" />
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#7c3aed" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="G. Potes" />
  <link rel="apple-touch-icon" href="/icon.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
  <link rel="preconnect" href="https://htsxdzlcmobmpevzhshh.supabase.co">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="dns-prefetch" href="https://bakasable.metered.live">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <title>Dashboard - Groupe de Potes</title>
  <link rel="stylesheet" href="css/style.css" />
  <link rel="stylesheet" href="css/dashboard.css" />
  <script defer src="/_vercel/insights/script.js"></script>
</head>
```

- [ ] **Step 2 : Ajouter preconnect dans `index.html`**

Même chose dans `index.html` (le preconnect Metered n'est pas utile sur la page login, mais Supabase + jsDelivr + Fonts oui) :

```html
  <link rel="preconnect" href="https://htsxdzlcmobmpevzhshh.supabase.co">
  <link rel="preconnect" href="https://cdn.jsdelivr.net">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

Insérer avant `<link rel="stylesheet" href="css/style.css" />`.

- [ ] **Step 3 : Vérifier**

Ouvrir le dashboard dans Chrome. DevTools → onglet **Network** → filtre `Initiator: preconnect`.
On doit voir des entrées vertes pour `htsxdzlcmobmpevzhshh.supabase.co` et `cdn.jsdelivr.net` marquées comme préconnectées avant les autres requêtes.

Alternatively : DevTools → **Performance** → record un reload, chercher "dns-lookup" et "connect" pour ces domaines — ils doivent apparaître bien avant les premières requêtes JS.

- [ ] **Step 4 : Commit**

```bash
git add dashboard.html index.html
git commit -m "perf: preconnect Supabase, jsDelivr, Google Fonts"
```

---

### Task 2 : Service Worker — Stale-while-revalidate correct

**Files:**
- Modify: `sw.js` (réécriture complète du handler fetch)

**Contexte :** Le SW actuel (`gp-v1`) fait `fetch()` à CHAQUE requête même si la ressource est en cache — gaspillage réseau. On corrige avec deux stratégies :
- **Assets statiques locaux** (`.html`, `.css`, `.js`, `.svg`, `.json`) : stale-while-revalidate — retourner cache immédiatement + mettre à jour en background via `event.waitUntil`
- **Images Supabase Storage** (domaine `htsxdzlcmobmpevzhshh.supabase.co`) : cache-first strict — pas d'update background (les avatars/photos changent rarement)
- **Tout le reste** (Supabase API, jsDelivr, etc.) : ignorer (pas de cache SW)

On bumpe la version en `gp-v2` pour que les clients existants activent le nouveau SW.

- [ ] **Step 1 : Remplacer `sw.js` entièrement**

```js
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
```

- [ ] **Step 2 : Vérifier**

Ouvrir le dashboard (doit être servi via `npx serve .` ou Vercel — pas `file://`).

1. DevTools → **Application** → **Service Workers** → vérifier que `gp-v2` est actif (pas `gp-v1`).
2. Recharger la page. DevTools → **Network** → vérifier que les ressources `.css`, `.js`, `.html` ont `(ServiceWorker)` dans la colonne Size — pas `(from disk cache)` ni de requête réseau réelle.
3. Vérifier qu'une image avatar a `(ServiceWorker)` après la première visite.

- [ ] **Step 3 : Commit**

```bash
git add sw.js
git commit -m "perf: SW stale-while-revalidate + cache-first images Supabase"
```

---

### Task 3 : SELECT spécifiques Supabase (pas de wildcard)

**Files:**
- Modify: `js/dashboard.js` (5 occurrences de `select('*')`)

**Contexte :** `select('*')` retourne toutes les colonnes même inutilisées. Pour les messages, ça inclut `reactions` (JSONB potentiellement lourd). On cible exactement les colonnes utilisées par chaque fonction.

**Colonnes table `messages` :** `id, username, content, image_url, created_at, reply_to, reply_preview, reactions, pinned, updated_at`

**Colonnes table `profiles` :** `username, bio, status, status_emoji, joined_at`

**Colonnes table `events` :** `id, title, event_date, event_time, description, created_by`

- [ ] **Step 1 : `loadHomeMessages` — remplacer `select('*')`**

Trouver (ligne ~232) :
```js
const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(5)
```

Remplacer par :
```js
const { data } = await supabase.from('messages').select('id, username, content, image_url, created_at').order('created_at', { ascending: false }).limit(5)
```

- [ ] **Step 2 : `loadMessages` initial — remplacer `select('*')`**

Trouver (ligne ~697) :
```js
  const { data } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE)
```

Remplacer par :
```js
  const { data } = await supabase
    .from('messages')
    .select('id, username, content, image_url, created_at, reply_to, reply_preview, reactions, pinned, updated_at')
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE)
```

- [ ] **Step 3 : `loadMessages` load-more — remplacer `select('*')`**

Trouver (ligne ~732) :
```js
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .lt('created_at', chatOldestAt)
      .limit(CHAT_PAGE)
```

Remplacer par :
```js
    const { data } = await supabase
      .from('messages')
      .select('id, username, content, image_url, created_at, reply_to, reply_preview, reactions, pinned, updated_at')
      .order('created_at', { ascending: false })
      .lt('created_at', chatOldestAt)
      .limit(CHAT_PAGE)
```

- [ ] **Step 4 : `openProfile` — remplacer `select('*')`**

Trouver (ligne ~2012) :
```js
  const { data: profile } = await supabase.from('profiles').select('*').eq('username', username).maybeSingle()
```

Remplacer par :
```js
  const { data: profile } = await supabase.from('profiles').select('username, bio, status, status_emoji, joined_at').eq('username', username).maybeSingle()
```

- [ ] **Step 5 : Calendrier — remplacer `select('*')`**

Chercher dans `js/dashboard.js` :
```js
supabase.from('events').select('*').order('event_date')
```

Remplacer par :
```js
supabase.from('events').select('id, title, event_date, event_time, description, created_by').order('event_date')
```

- [ ] **Step 6 : Vérifier**

Ouvrir le dashboard. DevTools → **Network** → filtrer sur `supabase.co`.

1. Aller dans le Chat → vérifier que la requête `messages` dans Network a un payload de réponse JSON sans colonnes inattendues.
2. Ouvrir un profil → vérifier que la requête `profiles` retourne seulement les 5 colonnes ciblées.
3. Vérifier que les messages s'affichent correctement (texte, images, réactions, replies).
4. Vérifier que le calendrier charge correctement.

- [ ] **Step 7 : Commit**

```bash
git add js/dashboard.js
git commit -m "perf: SELECT colonnes spécifiques — supprimer les wildcard Supabase"
```

---

### Task 4 : DOM batching avec DocumentFragment

**Files:**
- Modify: `js/dashboard.js` (4 fonctions)

**Contexte :** Quand on fait `container.appendChild(el)` dans une boucle, le navigateur peut recalculer les styles entre chaque insertion. `DocumentFragment` accumule les éléments hors DOM et les insère en une seule opération.

#### 4a — `loadHomeMessages` (5 messages d'accueil)

- [ ] **Step 1 : Wrapper la boucle avec un fragment**

Trouver (ligne ~235) :
```js
  container.innerHTML = ''
  data.forEach(msg => {
    const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const div = document.createElement('div')
    div.className = 'home-message'
    const avEl = renderAvatarEl(msg.username, 'home-message-avatar')
    div.appendChild(avEl)
    const contentEl = document.createElement('div')
    contentEl.className = 'home-message-content'
    contentEl.innerHTML = `
      <div class="home-message-header">
        <span class="home-message-username">${escapeHtml(msg.username)}</span>
        <span class="home-message-time">${time}</span>
      </div>
      <div class="home-message-text">${escapeHtml(msg.content) || '📷 Photo'}</div>
    `
    div.appendChild(contentEl)
    container.appendChild(div)
  })
```

Remplacer par :
```js
  container.innerHTML = ''
  const frag = document.createDocumentFragment()
  data.forEach(msg => {
    const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    const div = document.createElement('div')
    div.className = 'home-message'
    const avEl = renderAvatarEl(msg.username, 'home-message-avatar')
    div.appendChild(avEl)
    const contentEl = document.createElement('div')
    contentEl.className = 'home-message-content'
    contentEl.innerHTML = `
      <div class="home-message-header">
        <span class="home-message-username">${escapeHtml(msg.username)}</span>
        <span class="home-message-time">${time}</span>
      </div>
      <div class="home-message-text">${escapeHtml(msg.content) || '📷 Photo'}</div>
    `
    div.appendChild(contentEl)
    frag.appendChild(div)
  })
  container.appendChild(frag)
```

#### 4b — `loadActivity` (≤8 items)

- [ ] **Step 2 : Wrapper la boucle avec un fragment**

Trouver (ligne ~2198) :
```js
  container.innerHTML = ''
  const seen = new Set()
  data.filter(m => { if (seen.has(m.username)) return false; seen.add(m.username); return true }).forEach(m => {
    const ago = timeAgo(m.created_at)
    const div = document.createElement('div')
    div.className = 'activity-item'
    const av = renderAvatarEl(m.username, 'online-avatar activity-av')
    const text = document.createElement('div')
    text.className = 'activity-text'
    text.innerHTML = `<strong>${escapeHtml(m.username)}</strong> ${m.image_url ? 'a envoyé une photo' : 'a écrit un message'}`
    const time = document.createElement('span')
    time.className = 'activity-time'; time.textContent = ago
    div.appendChild(av); div.appendChild(text); div.appendChild(time)
    container.appendChild(div)
  })
```

Remplacer par :
```js
  container.innerHTML = ''
  const seen = new Set()
  const frag = document.createDocumentFragment()
  data.filter(m => { if (seen.has(m.username)) return false; seen.add(m.username); return true }).forEach(m => {
    const ago = timeAgo(m.created_at)
    const div = document.createElement('div')
    div.className = 'activity-item'
    const av = renderAvatarEl(m.username, 'online-avatar activity-av')
    const text = document.createElement('div')
    text.className = 'activity-text'
    text.innerHTML = `<strong>${escapeHtml(m.username)}</strong> ${m.image_url ? 'a envoyé une photo' : 'a écrit un message'}`
    const time = document.createElement('span')
    time.className = 'activity-time'; time.textContent = ago
    div.appendChild(av); div.appendChild(text); div.appendChild(time)
    frag.appendChild(div)
  })
  container.appendChild(frag)
```

#### 4c — Liste présence dans `init()` (≤9 users)

- [ ] **Step 3 : Wrapper la boucle avec un fragment**

Trouver dans le callback `presence sync` (ligne ~186) :
```js
        onlineDiv.innerHTML = ''
        users.forEach(u => {
          const div = document.createElement('div')
          // ... construction ...
          onlineDiv.appendChild(div)
        })
```

La section complète à remplacer (dans le `.then(({ data: profs }) => {` callback) :

```js
        if (profs) profs.forEach(p => { profileStatusCache[p.username] = p })
        const statusMap = {}
        users.forEach(u => { if (profileStatusCache[u]) statusMap[u] = profileStatusCache[u] })
        onlineDiv.innerHTML = ''
        users.forEach(u => {
          const div = document.createElement('div')
          div.className = 'online-user'
          div.style.cursor = 'pointer'
          div.onclick = () => window.openProfile(u)
          const avEl = renderAvatarEl(u, 'online-avatar')
          const nameWrap = document.createElement('div')
          nameWrap.style.cssText = 'flex:1;min-width:0'
          const nameEl = document.createElement('span')
          nameEl.style.cssText = 'display:block;font-weight:500'
          nameEl.textContent = u
          nameWrap.appendChild(nameEl)
          const prof = statusMap[u]
          if (prof?.status) {
            const statusEl = document.createElement('span')
            statusEl.className = 'online-user-status'
            statusEl.textContent = (prof.status_emoji ? prof.status_emoji + ' ' : '') + prof.status
            nameWrap.appendChild(statusEl)
          }
          const dotEl = document.createElement('div')
          dotEl.className = 'online-dot'; dotEl.style.marginLeft = 'auto'
          div.appendChild(avEl); div.appendChild(nameWrap); div.appendChild(dotEl)
          onlineDiv.appendChild(div)
        })
```

Remplacer par :
```js
        if (profs) profs.forEach(p => { profileStatusCache[p.username] = p })
        const statusMap = {}
        users.forEach(u => { if (profileStatusCache[u]) statusMap[u] = profileStatusCache[u] })
        onlineDiv.innerHTML = ''
        const frag = document.createDocumentFragment()
        users.forEach(u => {
          const div = document.createElement('div')
          div.className = 'online-user'
          div.style.cursor = 'pointer'
          div.onclick = () => window.openProfile(u)
          const avEl = renderAvatarEl(u, 'online-avatar')
          const nameWrap = document.createElement('div')
          nameWrap.style.cssText = 'flex:1;min-width:0'
          const nameEl = document.createElement('span')
          nameEl.style.cssText = 'display:block;font-weight:500'
          nameEl.textContent = u
          nameWrap.appendChild(nameEl)
          const prof = statusMap[u]
          if (prof?.status) {
            const statusEl = document.createElement('span')
            statusEl.className = 'online-user-status'
            statusEl.textContent = (prof.status_emoji ? prof.status_emoji + ' ' : '') + prof.status
            nameWrap.appendChild(statusEl)
          }
          const dotEl = document.createElement('div')
          dotEl.className = 'online-dot'; dotEl.style.marginLeft = 'auto'
          div.appendChild(avEl); div.appendChild(nameWrap); div.appendChild(dotEl)
          frag.appendChild(div)
        })
        onlineDiv.appendChild(frag)
```

#### 4d — `appendMessage` + batch initial chat (50 messages)

- [ ] **Step 4 : Refactorer `appendMessage` pour accepter `target` et `prevEl`**

La signature actuelle est `function appendMessage(msg)`. Elle doit devenir `function appendMessage(msg, target, prevEl)` :

- `target` (optionnel) : `DocumentFragment` ou `HTMLElement` où insérer les éléments. Si absent → container live (comportement actuel)
- `prevEl` (optionnel) : dernier élément `div.chat-message` inséré dans le fragment pour le calcul de grouping. Si absent → on lit `container.lastElementChild` comme avant
- Retourne le `div` créé (pour tracking)

Les modifications dans `appendMessage` :

1. Ajouter `const dest = target || container` au début
2. Remplacer `container.appendChild(sep)` par `dest.appendChild(sep)` (séparateur date)
3. Remplacer `const lastMsg = container.lastElementChild` par :
   ```js
   const lastMsg = prevEl !== undefined ? prevEl : container.lastElementChild
   ```
4. Remplacer `container.appendChild(div)` par `dest.appendChild(div)`
5. Entourer `container.scrollTop` et badge/son dans `if (!target) { ... }`
6. Ajouter `return div` à la fin

Voici la fonction `appendMessage` complète après modification :

```js
function appendMessage(msg, target, prevEl) {
  const container = document.getElementById('chat-messages')
  const dest = target || container
  const isMine = msg.username === chatUsername
  const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  // Séparateur de date
  const msgDateStr = new Date(msg.created_at).toDateString()
  if (msgDateStr !== lastMessageDate) {
    lastMessageDate = msgDateStr
    const sep = document.createElement('div')
    sep.className = 'date-separator'
    sep.textContent = formatDateLabel(new Date(msg.created_at))
    dest.appendChild(sep)
  }

  // Grouping : prevEl si mode batch, sinon dernier enfant du container live
  const lastMsg = prevEl !== undefined ? prevEl : container.lastElementChild
  const lastUsername = lastMsg?.dataset?.username
  const lastTime = lastMsg?.dataset?.time
  const isGrouped = lastUsername === msg.username && lastTime === time

  const div = document.createElement('div')
  div.className = 'chat-message ' + (isMine ? 'mine' : 'other') + (isGrouped ? ' grouped' : '')
  div.id = 'msg-' + msg.id
  div.dataset.username = msg.username
  div.dataset.time = time

  let replyHtml = ''
  if (msg.reply_preview) {
    replyHtml = `<div class="reply-preview">↩️ ${msg.reply_preview}</div>`
  }

  const safeContent = escapeHtml(msg.content)
  const bubbleContent = msg.image_url
    ? `<img class="chat-img" src="${escapeHtml(msg.image_url)}" onclick="window.openLightbox('${escapeHtml(msg.image_url)}')" />`
    : safeContent

  const bubbleInner2 = msg.image_url
    ? `${bubbleContent}<span class="bubble-time">${time}</span>`
    : `<span class="bubble-text">${bubbleContent}</span><span class="bubble-time">${time}</span>`
  const replyAttr = escapeHtml(msg.content)
  div.innerHTML = `
    ${replyHtml}
    <div class="msg-wrapper">
      ${!isMine && !isGrouped ? `<div class="msg-name" onclick="window.openProfile('${escapeHtml(msg.username)}')">${escapeHtml(msg.username)}</div>` : ''}
      <div class="msg-row">
        <div class="msg-actions" id="actions-${msg.id}">
          <button onclick="startReply('${msg.id}', '${replyAttr}', '${escapeHtml(msg.username)}')">↩️</button>
          <button onclick="showReactionPicker('${msg.id}')">😄</button>
          <button onclick="window.togglePin('${msg.id}', '${escapeHtml(safeContent.substring(0,60))}')">📌</button>
          ${isMine && !msg.image_url ? `<button onclick="window.startEdit('${msg.id}', '${replyAttr}')">✏️</button>` : ''}
          ${isMine ? `<button onclick="window.deleteMessage('${msg.id}')">🗑️</button>` : ''}
        </div>
        <div class="chat-bubble">${bubbleInner2}</div>
      </div>
    </div>
    ${buildReactions(msg)}
  `
  dest.appendChild(div)

  // Scroll + badge/son seulement en mode live (pas de batch)
  if (!target) {
    container.scrollTop = container.scrollHeight
    if (chatInitialized && !chatOpen && !isMine) {
      unreadCount++
      updateBadge()
      playNotifSound()
    }
  }

  return div
}
```

- [ ] **Step 5 : Mettre à jour `loadMessages` pour le batch initial**

Trouver (ligne ~706) :
```js
  const msgs = [...data].reverse()
  chatOldestAt = msgs[0].created_at
  if (data.length < CHAT_PAGE) chatHasMore = false

  msgs.forEach(msg => appendMessage(msg))
  container.scrollTop = container.scrollHeight
  chatInitialized = true
```

Remplacer par :
```js
  const msgs = [...data].reverse()
  chatOldestAt = msgs[0].created_at
  if (data.length < CHAT_PAGE) chatHasMore = false

  const frag = document.createDocumentFragment()
  let prevEl = null
  msgs.forEach(msg => { prevEl = appendMessage(msg, frag, prevEl) })
  container.appendChild(frag)
  container.scrollTop = container.scrollHeight
  chatInitialized = true
```

- [ ] **Step 6 : Vérifier**

1. Aller dans le Chat → vérifier que les 50 messages s'affichent correctement avec les bonnes dates, groupings, réactions, replies
2. Envoyer un message → vérifier que le nouveau message apparaît en bas avec scroll automatique
3. Recevoir un message depuis un autre onglet → vérifier badge + son
4. Scroller vers le haut → vérifier que le load-more fonctionne toujours
5. Vérifier section Accueil : messages récents et activité affichés correctement
6. Vérifier section Accueil : utilisateurs en ligne affichés correctement

- [ ] **Step 7 : Commit**

```bash
git add js/dashboard.js
git commit -m "perf: DocumentFragment pour batch DOM — chat, accueil, présence"
```

---

### Après toutes les tâches

- [ ] **Git push**

```bash
git push
```

- [ ] **Vérification Vercel**

Vérifier que le déploiement Vercel réussit et que le site est fonctionnel en production.
