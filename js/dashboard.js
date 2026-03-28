import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://htsxdzlcmobmpevzhshh.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V_w52NPbhRA69cOPbbIwIg_CnfS_22A'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Avatars ──────────────────────────────────────────
const avatarCache = {}

function renderAvatarEl(username, cls = 'user-avatar-circle') {
  const url = avatarCache[username]
  if (url) {
    const img = document.createElement('img')
    img.src = url; img.className = 'avatar-img'; img.alt = username
    const wrap = document.createElement('div')
    wrap.className = cls; wrap.appendChild(img)
    return wrap
  }
  const div = document.createElement('div')
  div.className = cls
  div.textContent = username.charAt(0).toUpperCase()
  if (avatarCache[username] === undefined) {
    avatarCache[username] = null
    const { data } = supabase.storage.from('photos').getPublicUrl('avatars/' + username + '.jpg')
    fetch(data.publicUrl, { method: 'HEAD' }).then(res => {
      if (res.ok) {
        avatarCache[username] = data.publicUrl
        if (div.isConnected) {
          const img = document.createElement('img')
          img.src = data.publicUrl; img.className = 'avatar-img'; img.alt = username
          div.innerHTML = ''; div.appendChild(img)
        }
      }
    }).catch(() => {})
  }
  return div
}

// ── Compression ──────────────────────────────────────
async function compressImage(file, maxWidth = 1600, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxWidth) { height = Math.round(height * maxWidth / width); width = maxWidth }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

let currentUser = null
let currentPote = null

async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { window.location.href = 'index.html'; return }
  currentUser = session.user
  const username = currentUser.user_metadata?.username || currentUser.email
  document.getElementById('user-name-display').textContent = username
  const myAv = renderAvatarEl(username, 'user-avatar-circle')
  const myAvDisplay = document.getElementById('my-avatar-display')
  myAvDisplay.innerHTML = ''; myAvDisplay.appendChild(myAv)
  document.getElementById('welcome-title').textContent = 'Bienvenue ' + username + ' 👋'

  // Stats
  loadHomeStats()
  loadHomeMessages()

  // Presence
  const channel = supabase.channel('online-users')
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const onlineDiv = document.getElementById('online-users')
      onlineDiv.innerHTML = ''
      const users = []
      Object.values(state).forEach(presences => presences.forEach(p => users.push(p.username)))
      users.forEach(u => {
        const div = document.createElement('div')
        div.className = 'online-user'
        const avEl = renderAvatarEl(u, 'online-avatar')
        const nameEl = document.createElement('span')
        nameEl.textContent = u
        const dotEl = document.createElement('div')
        dotEl.className = 'online-dot'; dotEl.style.marginLeft = 'auto'
        div.appendChild(avEl); div.appendChild(nameEl); div.appendChild(dotEl)
        onlineDiv.appendChild(div)
      })
      document.getElementById('stat-online').textContent = users.length
      document.getElementById('offline-count').textContent = (9 - users.length) + ' pote(s) hors ligne'
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ username })
    })
}

async function loadHomeStats() {
  const { count: msgCount } = await supabase.from('messages').select('*', { count: 'exact', head: true })
  document.getElementById('stat-messages').textContent = msgCount || 0

  const potes = ['renan','noe','cesar','erwan','wili','raphaelle','lilou','gwendal','nicolas']
  let total = 0
  for (const pote of potes) {
    const { data } = await supabase.storage.from('photos').list(pote, { limit: 100 })
    if (data) total += data.length
  }
  document.getElementById('stat-photos').textContent = total
}

async function loadHomeMessages() {
  const { data } = await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(5)
  const container = document.getElementById('home-messages')
  if (!data?.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.88rem">Aucun message pour l\'instant...</p>'; return }
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
        <span class="home-message-username">${msg.username}</span>
        <span class="home-message-time">${time}</span>
      </div>
      <div class="home-message-text">${msg.content || '📷 Photo'}</div>
    `
    div.appendChild(contentEl)
    container.appendChild(div)
  })
}

window.showSection = function(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('section-' + name).classList.add('active')
  document.querySelectorAll(`[data-section="${name}"]`).forEach(b => b.classList.add('active'))
}

window.openPote = function(pote) {
  currentPote = pote
  document.getElementById('potes-grid').style.display = 'none'
  document.getElementById('pote-view').style.display = 'block'
  document.getElementById('pote-title').textContent = '📸 ' + pote.charAt(0).toUpperCase() + pote.slice(1)
  loadPhotos(pote)
}

window.closePote = function() {
  currentPote = null
  document.getElementById('potes-grid').style.display = 'grid'
  document.getElementById('pote-view').style.display = 'none'
}

async function loadPhotos(pote) {
  const { data, error } = await supabase.storage.from('photos').list(pote, { limit: 100 })
  const grid = document.getElementById('photo-grid')
  grid.innerHTML = ''
  if (error || !data.length) {
    grid.innerHTML = '<p style="color:#aaa">Aucune photo pour l\'instant...</p>'
    return
  }
  data.forEach(file => {
    const { data: urlData } = supabase.storage.from('photos').getPublicUrl(pote + '/' + file.name)
    const img = document.createElement('img')
    img.src = urlData.publicUrl
    img.onclick = () => window.open(urlData.publicUrl, '_blank')
    grid.appendChild(img)
  })
}

window.uploadPhotos = async function() {
  const input = document.getElementById('photo-input')
  const msg = document.getElementById('upload-message')
  const files = input.files
  if (!files.length) { msg.style.color = '#f87171'; msg.textContent = 'Sélectionne au moins une photo !'; return }
  msg.style.color = '#a78bfa'
  msg.textContent = 'Upload en cours...'
  for (const file of files) {
    const fileName = currentPote + '/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const compressed = await compressImage(file)
    const { error } = await supabase.storage.from('photos').upload(fileName, compressed)
    if (error) { msg.style.color = '#f87171'; msg.textContent = 'Erreur : ' + error.message; return }
  }
  msg.style.color = '#4ade80'
  msg.textContent = 'Photos envoyées ! ✅'
  input.value = ''
  loadPhotos(currentPote)
}

window.logout = async function() {
  await supabase.auth.signOut()
  window.location.href = 'index.html'
}

init()

/* =====================================================
   THÈMES & PARAMÈTRES
   ===================================================== */

const THEMES = {
  violet: { name: 'Violet',  color: '#7c3aed',
    dark:  { accent2: '#7c3aed', accent: '#c4b5fd', glow: 'rgba(139,92,246,0.38)' },
    light: { accent2: '#4c1d95', accent: '#6d28d9', glow: 'rgba(109,40,217,0.28)' },
    blob1: 'rgba(124,58,237,0.75)', blob2: 'rgba(59,130,246,0.65)', blob3: 'rgba(236,72,153,0.45)', blob4: 'rgba(16,185,129,0.3)' },
  bleu: { name: 'Bleu',    color: '#2563eb',
    dark:  { accent2: '#1d4ed8', accent: '#93c5fd', glow: 'rgba(59,130,246,0.38)' },
    light: { accent2: '#1e3a8a', accent: '#1d4ed8', glow: 'rgba(29,78,216,0.28)' },
    blob1: 'rgba(29,78,216,0.8)', blob2: 'rgba(6,182,212,0.65)', blob3: 'rgba(99,102,241,0.45)', blob4: 'rgba(16,185,129,0.3)' },
  rose: { name: 'Rose',    color: '#ec4899',
    dark:  { accent2: '#be185d', accent: '#f9a8d4', glow: 'rgba(236,72,153,0.38)' },
    light: { accent2: '#9d174d', accent: '#be185d', glow: 'rgba(190,24,93,0.28)' },
    blob1: 'rgba(190,24,93,0.8)', blob2: 'rgba(239,68,68,0.55)', blob3: 'rgba(168,85,247,0.45)', blob4: 'rgba(251,146,60,0.3)' },
  vert: { name: 'Forêt',  color: '#10b981',
    dark:  { accent2: '#065f46', accent: '#6ee7b7', glow: 'rgba(16,185,129,0.35)' },
    light: { accent2: '#064e3b', accent: '#059669', glow: 'rgba(5,150,105,0.28)' },
    blob1: 'rgba(6,95,70,0.85)', blob2: 'rgba(5,150,105,0.65)', blob3: 'rgba(16,185,129,0.5)', blob4: 'rgba(59,130,246,0.25)' },
  ambre: { name: 'Ambre',  color: '#f59e0b',
    dark:  { accent2: '#b45309', accent: '#fcd34d', glow: 'rgba(251,191,36,0.38)' },
    light: { accent2: '#92400e', accent: '#b45309', glow: 'rgba(180,83,9,0.28)' },
    blob1: 'rgba(180,83,9,0.8)', blob2: 'rgba(234,88,12,0.65)', blob3: 'rgba(251,191,36,0.5)', blob4: 'rgba(220,38,38,0.25)' },
  cyan: { name: 'Cyan',   color: '#06b6d4',
    dark:  { accent2: '#0e7490', accent: '#67e8f9', glow: 'rgba(6,182,212,0.38)' },
    light: { accent2: '#164e63', accent: '#0e7490', glow: 'rgba(14,116,144,0.28)' },
    blob1: 'rgba(14,116,144,0.85)', blob2: 'rgba(6,182,212,0.65)', blob3: 'rgba(99,102,241,0.4)', blob4: 'rgba(16,185,129,0.3)' },
  rouge: { name: 'Cerise', color: '#ef4444',
    dark:  { accent2: '#991b1b', accent: '#fca5a5', glow: 'rgba(239,68,68,0.38)' },
    light: { accent2: '#7f1d1d', accent: '#991b1b', glow: 'rgba(153,27,27,0.28)' },
    blob1: 'rgba(153,27,27,0.85)', blob2: 'rgba(239,68,68,0.65)', blob3: 'rgba(190,24,93,0.45)', blob4: 'rgba(251,146,60,0.3)' },
  mono: { name: 'Slate',  color: '#94a3b8',
    dark:  { accent2: '#475569', accent: '#cbd5e1', glow: 'rgba(100,116,139,0.38)' },
    light: { accent2: '#334155', accent: '#475569', glow: 'rgba(71,85,105,0.28)' },
    blob1: 'rgba(51,65,85,0.85)', blob2: 'rgba(71,85,105,0.65)', blob3: 'rgba(100,116,139,0.45)', blob4: 'rgba(30,41,59,0.5)' },
}

let currentTheme = localStorage.getItem('color-theme') || 'violet'

function applyTheme(themeId) {
  const t = THEMES[themeId] || THEMES.violet
  const root = document.documentElement
  const isLight = document.body.classList.contains('light')
  const vars = isLight ? t.light : t.dark

  root.style.setProperty('--accent-2', vars.accent2)
  root.style.setProperty('--accent', vars.accent)
  root.style.setProperty('--accent-glow', vars.glow)
  root.style.setProperty('--blob-1', t.blob1)
  root.style.setProperty('--blob-2', t.blob2)
  root.style.setProperty('--blob-3', t.blob3)
  root.style.setProperty('--blob-4', t.blob4)

  currentTheme = themeId
  localStorage.setItem('color-theme', themeId)

  document.querySelectorAll('.theme-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.theme === themeId)
  })
}

window.toggleTheme = function() {
  window.toggleLightMode(!document.body.classList.contains('light'))
}

window.toggleLightMode = function(on) {
  if (on === undefined) on = !document.body.classList.contains('light')
  document.body.classList.toggle('light', on)
  localStorage.setItem('theme', on ? 'light' : 'dark')

  const btn = document.getElementById('theme-btn')
  if (btn) btn.textContent = on ? '🌙' : '☀️'

  const track = document.getElementById('light-toggle-track')
  const check = document.getElementById('light-toggle-check')
  if (track) track.classList.toggle('on', on)
  if (check) check.checked = on

  applyTheme(currentTheme)
}

function buildThemePicker() {
  const grid = document.getElementById('theme-picker-grid')
  if (!grid || grid.childElementCount > 0) return
  Object.entries(THEMES).forEach(([id, t]) => {
    const btn = document.createElement('button')
    btn.className = 'theme-swatch' + (id === currentTheme ? ' active' : '')
    btn.dataset.theme = id
    btn.style.cssText = 'width:auto;padding:12px 6px 10px;background:var(--g1);border:2px solid var(--border);border-radius:var(--r-lg);display:flex;flex-direction:column;align-items:center;gap:7px;box-shadow:none;cursor:pointer;'
    btn.innerHTML = `
      <div class="swatch-dot" style="background:${t.color};"></div>
      <span class="swatch-label">${t.name}</span>
    `
    btn.onclick = () => applyTheme(id)
    grid.appendChild(btn)
  })
}

function initSettings() {
  if (currentUser) {
    const uname = currentUser.user_metadata?.username || currentUser.email
    const el = document.getElementById('param-username')
    if (el) el.textContent = uname
    const em = document.getElementById('param-email')
    if (em) em.textContent = currentUser.email
  }
  const isLight = document.body.classList.contains('light')
  const track = document.getElementById('light-toggle-track')
  const check = document.getElementById('light-toggle-check')
  if (track) track.classList.toggle('on', isLight)
  if (check) check.checked = isLight
  buildThemePicker()
}

// Restore on load
;(function restorePrefs() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light')
    const btn = document.getElementById('theme-btn')
    if (btn) btn.textContent = '🌙'
  }
  applyTheme(currentTheme)
})()

// Chat
let chatUsername = null
let replyingTo = null
let typingTimeout = null
let typingChannel = null
let lastMessageDate = null
let unreadCount = 0
let chatOpen = false
let chatInitialized = false
let chatHasMore = true
let chatOldestAt = null
let chatLoadingMore = false

function updateBadge() {
  const val = unreadCount > 9 ? '9+' : unreadCount
  for (const id of ['chat-badge', 'chat-badge-mobile']) {
    const badge = document.getElementById(id)
    if (!badge) continue
    if (unreadCount > 0) {
      badge.style.display = 'inline-flex'
      badge.textContent = val
    } else {
      badge.style.display = 'none'
    }
  }
}

function formatDateLabel(date) {
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Aujourd\'hui'
  if (date.toDateString() === yesterday.toDateString()) return 'Hier'
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function initChat() {
  chatUsername = currentUser.user_metadata?.username || currentUser.email
  loadMessages()

  const channel = supabase
    .channel('chat-room', { config: { broadcast: { self: true } } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      appendMessage(payload.new)
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, payload => {
      document.getElementById('msg-' + payload.old.id)?.remove()
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
      const el = document.getElementById('msg-' + payload.new.id)
      if (el) {
        // Mise à jour du contenu (si édité et pas en cours d'édition)
        const bubble = el.querySelector('.chat-bubble')
        if (bubble && !bubble.querySelector('.edit-wrapper')) {
          if (payload.new.image_url) {
            bubble.innerHTML = `<img class="chat-img" src="${payload.new.image_url}" onclick="window.open('${payload.new.image_url}','_blank')" />`
          } else {
            bubble.textContent = payload.new.content
          }
        }
        // Mise à jour des réactions
        const reactionsEl = el.querySelector('.chat-reactions')
        const newReactions = buildReactions(payload.new)
        if (reactionsEl) reactionsEl.outerHTML = newReactions
        else el.querySelector('.msg-wrapper').insertAdjacentHTML('afterend', newReactions)
      }
    })
    .subscribe((status) => {
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setTimeout(() => channel.subscribe(), 2000)
      }
    })

  typingChannel = supabase.channel('typing')
  typingChannel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (payload.username !== chatUsername) {
        const el = document.getElementById('typing-indicator')
        el.innerHTML = `<span>${payload.username}</span><span class="typing-dots"><span></span><span></span><span></span></span>`
        el.style.opacity = '1'
        clearTimeout(el._timeout)
        el._timeout = setTimeout(() => { el.style.opacity = '0' }, 2000)
      }
    })
    .subscribe()
}

const CHAT_PAGE = 50

async function loadMessages() {
  chatInitialized = false
  lastMessageDate = null
  chatHasMore = true
  chatOldestAt = null
  chatLoadingMore = false

  const { data } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE)

  const container = document.getElementById('chat-messages')
  container.innerHTML = '<div id="chat-sentinel" style="height:1px;flex-shrink:0"></div>'

  if (!data?.length) { chatInitialized = true; return }

  const msgs = [...data].reverse()
  chatOldestAt = msgs[0].created_at
  if (data.length < CHAT_PAGE) chatHasMore = false

  msgs.forEach(msg => appendMessage(msg))
  container.scrollTop = container.scrollHeight
  chatInitialized = true

  setupLoadMoreObserver()
}

function setupLoadMoreObserver() {
  const sentinel = document.getElementById('chat-sentinel')
  if (!sentinel) return

  const observer = new IntersectionObserver(async entries => {
    if (!entries[0].isIntersecting || chatLoadingMore || !chatHasMore) return
    chatLoadingMore = true

    const container = document.getElementById('chat-messages')
    const prevHeight = container.scrollHeight

    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .lt('created_at', chatOldestAt)
      .limit(CHAT_PAGE)

    if (!data?.length || !data) {
      chatHasMore = false
      observer.disconnect()
      chatLoadingMore = false
      return
    }
    if (data.length < CHAT_PAGE) chatHasMore = false

    const msgs = [...data].reverse()
    chatOldestAt = msgs[0].created_at

    // Construire le fragment à insérer après le sentinel
    const frag = document.createDocumentFragment()
    const tempLastDate = lastMessageDate
    lastMessageDate = null

    msgs.forEach(msg => {
      const isMine = msg.username === chatUsername
      const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      const msgDateStr = new Date(msg.created_at).toDateString()

      if (msgDateStr !== lastMessageDate) {
        lastMessageDate = msgDateStr
        const sep = document.createElement('div')
        sep.className = 'date-separator'
        sep.textContent = formatDateLabel(new Date(msg.created_at))
        frag.appendChild(sep)
      }

      const div = document.createElement('div')
      div.className = 'chat-message ' + (isMine ? 'mine' : 'other')
      div.id = 'msg-' + msg.id
      div.dataset.username = msg.username
      div.dataset.time = time

      const replyHtml = msg.reply_preview ? `<div class="reply-preview">↩️ ${msg.reply_preview}</div>` : ''
      const bubbleContent = msg.image_url
        ? `<img class="chat-img" src="${msg.image_url}" onclick="window.open('${msg.image_url}','_blank')" />`
        : (msg.content || '')

      div.innerHTML = `
        ${replyHtml}
        <div class="msg-wrapper">
          <div class="msg-actions" id="actions-${msg.id}">
            <button onclick="startReply('${msg.id}', '${(msg.content||'').replace(/'/g,"\\'")}', '${msg.username}')">↩️</button>
            <button onclick="showReactionPicker('${msg.id}')">😄</button>
            ${isMine && !msg.image_url ? `<button onclick="window.startEdit('${msg.id}', '${(msg.content||'').replace(/'/g,"\\'")}')">✏️</button>` : ''}
            ${isMine ? `<button onclick="window.deleteMessage('${msg.id}')">🗑️</button>` : ''}
          </div>
          <div class="chat-bubble">${bubbleContent}</div>
        </div>
        ${buildReactions(msg)}
        <div class="chat-meta">${isMine ? '' : msg.username + ' · '}${time}</div>
      `
      frag.appendChild(div)
    })

    lastMessageDate = tempLastDate
    sentinel.after(frag)
    container.scrollTop = container.scrollHeight - prevHeight
    chatLoadingMore = false

  }, { root: document.getElementById('chat-messages'), rootMargin: '80px 0px 0px 0px', threshold: 0 })

  observer.observe(sentinel)
}

function buildReactions(msg) {
  const reactions = msg.reactions || {}
  if (!Object.keys(reactions).length) return '<div class="chat-reactions"></div>'
  const html = Object.entries(reactions).map(([emoji, users]) =>
    users.length ? `<span class="reaction-btn ${users.includes(chatUsername) ? 'active' : ''}" data-id="${msg.id}" data-emoji="${emoji}" title="${users.join(', ')}">${emoji} ${users.length}</span>` : ''
  ).join('')
  return `<div class="chat-reactions">${html}</div>`
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages')
  const isMine = msg.username === chatUsername
  const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  // Séparateur de date
  const msgDateStr = new Date(msg.created_at).toDateString()
  if (msgDateStr !== lastMessageDate) {
    lastMessageDate = msgDateStr
    const sep = document.createElement('div')
    sep.className = 'date-separator'
    sep.textContent = formatDateLabel(new Date(msg.created_at))
    container.appendChild(sep)
  }

  // Détecte si même personne que le message précédent
  const lastMsg = container.lastElementChild
  const lastUsername = lastMsg?.dataset.username
  const lastTime = lastMsg?.dataset.time
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

  const bubbleContent = msg.image_url
    ? `<img class="chat-img" src="${msg.image_url}" onclick="window.open('${msg.image_url}','_blank')" />`
    : msg.content

  div.innerHTML = `
    ${replyHtml}
    <div class="msg-wrapper">
      <div class="msg-actions" id="actions-${msg.id}">
        <button onclick="startReply('${msg.id}', '${msg.content.replace(/'/g, "\\'")}', '${msg.username}')">↩️</button>
        <button onclick="showReactionPicker('${msg.id}')">😄</button>
        ${isMine && !msg.image_url ? `<button onclick="window.startEdit('${msg.id}', '${msg.content.replace(/'/g, "\\'")}')">✏️</button>` : ''}
        ${isMine ? `<button onclick="window.deleteMessage('${msg.id}')">🗑️</button>` : ''}
      </div>
      <div class="chat-bubble">${bubbleContent}</div>
    </div>
    ${buildReactions(msg)}
    <div class="chat-meta">${isMine ? '' : msg.username + ' · '}${time}</div>
  `
  container.appendChild(div)
  container.scrollTop = container.scrollHeight

  // Badge de notif si on est ailleurs
  if (chatInitialized && !chatOpen && !isMine) {
    unreadCount++
    updateBadge()
  }
}

window.startReply = function(id, content, username) {
  replyingTo = { id, content, username }
  const box = document.getElementById('reply-box')
  box.style.display = 'flex'
  box.querySelector('span').textContent = '↩️ ' + username + ': ' + content.substring(0, 50)
  document.getElementById('chat-input').focus()
}

window.cancelReply = function() {
  replyingTo = null
  document.getElementById('reply-box').style.display = 'none'
}

window.deleteMessage = async function(id) {
  const { error } = await supabase.from('messages').delete().eq('id', id)
  if (!error) document.getElementById('msg-' + id)?.remove()
}

window.startEdit = function(id, content) {
  const bubble = document.querySelector('#msg-' + id + ' .chat-bubble')
  if (!bubble) return
  bubble.dataset.original = content
  bubble.innerHTML = `
    <div class="edit-wrapper">
      <input class="edit-input" id="edit-input-${id}" />
      <div class="edit-actions">
        <button onclick="window.saveEdit('${id}')">✓</button>
        <button onclick="window.cancelEdit('${id}')">✕</button>
      </div>
    </div>
  `
  const inp = document.getElementById('edit-input-' + id)
  inp.value = content
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') window.saveEdit(id)
    if (e.key === 'Escape') window.cancelEdit(id)
  })
  inp.focus()
}

window.saveEdit = async function(id) {
  const input = document.getElementById('edit-input-' + id)
  if (!input) return
  const newContent = input.value.trim()
  if (!newContent) return
  await supabase.from('messages').update({ content: newContent }).eq('id', id)
}

window.cancelEdit = function(id) {
  const bubble = document.querySelector('#msg-' + id + ' .chat-bubble')
  if (!bubble) return
  bubble.textContent = bubble.dataset.original || ''
}

window.sendImage = async function() {
  const input = document.getElementById('chat-image-input')
  const file = input.files[0]
  if (!file) return
  const fileName = 'chat/' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const compressed = await compressImage(file, 1200, 0.80)
  const { error } = await supabase.storage.from('photos').upload(fileName, compressed)
  if (error) { console.error('Upload image chat:', error.message); return }
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(fileName)
  await supabase.from('messages').insert({
    username: chatUsername,
    content: '📷 Photo',
    image_url: urlData.publicUrl
  })
  input.value = ''
}

window.showReactionPicker = function(id) {
  const existing = document.getElementById('picker-' + id)
  if (existing) { existing.remove(); return }

  const emojis = ['😂', '❤️', '🔥', '👍', '😮', '😢']
  const picker = document.createElement('div')
  picker.className = 'emoji-picker'
  picker.id = 'picker-' + id
  picker.innerHTML = emojis.map(e => `<button onclick="window.toggleReaction('${id}', '${e}')">${e}</button>`).join('')

  // Attache au body pour échapper aux overflow/stacking contexts du chat
  document.body.appendChild(picker)

  // Positionne en fixed au-dessus du message
  const msgEl = document.getElementById('msg-' + id)
  const wrapper = msgEl?.querySelector('.msg-wrapper')
  if (wrapper) {
    const rect = wrapper.getBoundingClientRect()
    picker.style.position = 'fixed'
    picker.style.bottom = (window.innerHeight - rect.top + 6) + 'px'
    picker.style.top = 'auto'
    if (msgEl.classList.contains('mine')) {
      picker.style.right = (window.innerWidth - rect.right) + 'px'
      picker.style.left = 'auto'
    } else {
      picker.style.left = rect.left + 'px'
      picker.style.right = 'auto'
    }
  }

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!picker.contains(e.target)) {
        picker.remove()
        document.removeEventListener('click', handler)
      }
    })
  }, 200)
}

window.toggleReaction = async function(id, emoji) {
  // Lit les réactions actuelles depuis le DOM (évite un SELECT Supabase qui peut échouer)
  const el = document.getElementById('msg-' + id)
  const reactions = {}
  if (el) {
    el.querySelectorAll('.reaction-btn[data-emoji]').forEach(btn => {
      const users = (btn.title || '').split(', ').filter(Boolean)
      if (users.length) reactions[btn.dataset.emoji] = users
    })
  }

  if (!reactions[emoji]) reactions[emoji] = []
  const idx = reactions[emoji].indexOf(chatUsername)
  if (idx > -1) reactions[emoji].splice(idx, 1)
  else reactions[emoji].push(chatUsername)

  // Mise à jour immédiate de l'UI
  if (el) {
    const reactionsEl = el.querySelector('.chat-reactions')
    const newReactionsHtml = buildReactions({ id, reactions })
    if (reactionsEl) reactionsEl.outerHTML = newReactionsHtml
    else el.querySelector('.msg-wrapper')?.insertAdjacentHTML('afterend', newReactionsHtml)
  }

  document.getElementById('picker-' + id)?.remove()

  const { error } = await supabase.from('messages').update({ reactions }).eq('id', id)
  if (error) console.error('toggleReaction update failed:', error)
}

window.sendMessage = async function() {
  const input = document.getElementById('chat-input')
  const content = input.value.trim()
  if (!content) return
  input.value = ''

  const msg = { username: chatUsername, content }
  if (replyingTo) {
    msg.reply_to = replyingTo.id
    msg.reply_preview = replyingTo.username + ': ' + replyingTo.content.substring(0, 60)
    cancelReply()
  }
  await supabase.from('messages').insert(msg)
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('chat-input')
  if (input) {
    input.addEventListener('input', () => {
      if (!typingChannel || !chatUsername) return
      clearTimeout(typingTimeout)
      typingChannel.send({ type: 'broadcast', event: 'typing', payload: { username: chatUsername } })
      typingTimeout = setTimeout(() => {}, 1500)
    })
  }
})

/* =====================================================
   CLASSEMENT
   ===================================================== */

const POTES = ['renan','noe','cesar','erwan','wili','raphael','lilou','gwendal','nicolas']
let rankData = null
let currentRankCat = 'score'
let classementLoaded = false

async function loadClassement() {
  document.getElementById('rank-loading').style.display = 'block'
  document.getElementById('rank-podium').style.display = 'none'
  document.getElementById('rank-list').style.display = 'none'

  // Fetch message counts
  const { data: msgs } = await supabase.from('messages').select('username')
  const msgCounts = {}
  POTES.forEach(p => msgCounts[p] = 0)
  if (msgs) msgs.forEach(m => {
    const u = (m.username || '').toLowerCase()
    if (msgCounts[u] !== undefined) msgCounts[u]++
  })

  // Fetch photo counts per pote folder
  const photoCounts = {}
  await Promise.all(POTES.map(async pote => {
    const { data } = await supabase.storage.from('photos').list(pote, { limit: 500 })
    photoCounts[pote] = data ? data.filter(f => f.name !== '.emptyFolderPlaceholder').length : 0
  }))

  rankData = POTES.map(pote => ({
    username: pote,
    messages: msgCounts[pote] || 0,
    photos: photoCounts[pote] || 0,
    score: (msgCounts[pote] || 0) + (photoCounts[pote] || 0) * 3
  }))

  classementLoaded = true
  renderClassement(currentRankCat)
}

function renderClassement(cat) {
  if (!rankData) return
  currentRankCat = cat

  // Update tab active state
  document.querySelectorAll('.rank-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === cat)
  })

  const sorted = [...rankData].sort((a, b) => b[cat] - a[cat])
  const max = sorted[0]?.[cat] || 1

  // Podium (order: 2nd left, 1st center, 3rd right)
  const podiumEl = document.getElementById('rank-podium')
  const medals = ['🥇','🥈','🥉']
  const podiumOrder = sorted.length >= 3
    ? [sorted[1], sorted[0], sorted[2]]
    : sorted.slice(0, 3)
  const podiumRanks = sorted.length >= 3 ? [2, 1, 3] : [2, 1, 3]

  podiumEl.innerHTML = ''
  podiumOrder.forEach((user, i) => {
    if (!user) return
    const rank = podiumRanks[i]
    const slot = document.createElement('div')
    slot.className = 'podium-slot'
    slot.dataset.rank = rank

    const av = document.createElement('div')
    av.className = 'podium-avatar'
    av.appendChild(renderAvatarEl(user.username, 'podium-avatar-inner'))
    // Fix: renderAvatarEl returns a div with class; we need to adapt it for podium
    av.innerHTML = ''
    const inner = renderAvatarEl(user.username, 'podium-av-img')
    // Render initial letter or img directly inside podium-avatar
    const avInner = document.createElement('div')
    avInner.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:inherit;font-weight:700;'
    const cachedUrl = avatarCache[user.username]
    if (cachedUrl) {
      const img = document.createElement('img')
      img.src = cachedUrl
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;'
      avInner.appendChild(img)
    } else {
      avInner.textContent = user.username.charAt(0).toUpperCase()
      if (avatarCache[user.username] === undefined) {
        avatarCache[user.username] = null
        const { data } = supabase.storage.from('photos').getPublicUrl('avatars/' + user.username + '.jpg')
        fetch(data.publicUrl, { method: 'HEAD' }).then(res => {
          if (res.ok) {
            avatarCache[user.username] = data.publicUrl
            const img = document.createElement('img')
            img.src = data.publicUrl
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;'
            avInner.innerHTML = ''
            avInner.appendChild(img)
          }
        }).catch(() => {})
      }
    }
    av.appendChild(avInner)

    const label = cat === 'score' ? 'pts' : cat === 'messages' ? 'msgs' : 'photos'
    slot.innerHTML = `
      <div class="podium-name">${user.username.charAt(0).toUpperCase() + user.username.slice(1)}</div>
      <div class="podium-value">${user[cat]} ${label}</div>
      <div class="podium-base">${medals[rank - 1]}</div>
    `
    slot.insertBefore(av, slot.firstChild)
    podiumEl.appendChild(slot)
  })

  // Ranked list
  const listEl = document.getElementById('rank-list')
  listEl.innerHTML = ''
  sorted.forEach((user, idx) => {
    const item = document.createElement('div')
    item.className = 'rank-item'
    item.style.animationDelay = (idx * 0.05) + 's'

    const avEl = document.createElement('div')
    avEl.className = 'rank-avatar'
    const cachedUrl = avatarCache[user.username]
    if (cachedUrl) {
      const img = document.createElement('img')
      img.src = cachedUrl
      avEl.appendChild(img)
    } else {
      avEl.textContent = user.username.charAt(0).toUpperCase()
      if (avatarCache[user.username] === undefined) {
        avatarCache[user.username] = null
        const { data } = supabase.storage.from('photos').getPublicUrl('avatars/' + user.username + '.jpg')
        fetch(data.publicUrl, { method: 'HEAD' }).then(res => {
          if (res.ok) {
            avatarCache[user.username] = data.publicUrl
            const img = document.createElement('img')
            img.src = data.publicUrl
            avEl.innerHTML = ''
            avEl.appendChild(img)
          }
        }).catch(() => {})
      }
    }

    const pct = max > 0 ? Math.round((user[cat] / max) * 100) : 0
    const label = cat === 'score' ? 'pts' : cat === 'messages' ? 'msgs' : 'photos'
    item.innerHTML = `
      <span class="rank-position">#${idx + 1}</span>
      <div class="rank-info">
        <div class="rank-username">${user.username.charAt(0).toUpperCase() + user.username.slice(1)}</div>
        <div class="rank-bar-wrap"><div class="rank-bar" data-pct="${pct}"></div></div>
      </div>
      <span class="rank-score">${user[cat]} ${label}</span>
    `
    item.insertBefore(avEl, item.children[1])
    listEl.appendChild(item)
  })

  document.getElementById('rank-loading').style.display = 'none'
  podiumEl.style.display = 'flex'
  listEl.style.display = 'flex'

  // Animate bars after paint
  requestAnimationFrame(() => requestAnimationFrame(() => {
    listEl.querySelectorAll('.rank-bar').forEach(bar => {
      bar.style.width = bar.dataset.pct + '%'
    })
  }))
}

window.switchRankCat = function(cat) {
  currentRankCat = cat
  if (rankData) renderClassement(cat)
}

const _showSection = window.showSection
window.showSection = function(name) {
  _showSection.call(this, name)
  if (name === 'chat') {
    chatOpen = true
    unreadCount = 0
    updateBadge()
    if (!chatUsername) initChat()
  } else {
    chatOpen = false
  }
  if (name === 'classement' && !classementLoaded) loadClassement()
  if (name === 'params') initSettings()
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('reaction-btn')) {
    window.toggleReaction(e.target.dataset.id, e.target.dataset.emoji)
    return
  }

  // Sur touch : tap sur une bulle = afficher/masquer les actions
  if (window.matchMedia('(hover: none)').matches) {
    const bubble = e.target.closest('.chat-bubble')
    if (bubble) {
      const wrapper = bubble.closest('.msg-wrapper')
      if (wrapper) {
        const isActive = wrapper.classList.contains('active')
        document.querySelectorAll('.msg-wrapper.active').forEach(w => w.classList.remove('active'))
        if (!isActive) wrapper.classList.add('active')
        return
      }
    }
    // Tap ailleurs = fermer toutes les actions (si on n'est pas dans un picker ou une action)
    if (!e.target.closest('.msg-actions') && !e.target.closest('.emoji-picker')) {
      document.querySelectorAll('.msg-wrapper.active').forEach(w => w.classList.remove('active'))
    }
  }
})

document.addEventListener('change', async e => {
  if (e.target.id !== 'avatar-upload-input') return
  const file = e.target.files[0]
  if (!file || !currentUser) return
  const username = currentUser.user_metadata?.username || currentUser.email
  const compressed = await compressImage(file, 400, 0.88)
  const path = 'avatars/' + username + '.jpg'
  await supabase.storage.from('photos').remove([path])
  const { error } = await supabase.storage.from('photos').upload(path, compressed, { contentType: 'image/jpeg', upsert: true })
  if (!error) {
    avatarCache[username] = null
    const myAvDisplay = document.getElementById('my-avatar-display')
    if (myAvDisplay) { myAvDisplay.innerHTML = ''; myAvDisplay.appendChild(renderAvatarEl(username, 'user-avatar-circle')) }
  }
  e.target.value = ''
})