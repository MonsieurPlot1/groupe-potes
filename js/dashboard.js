import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://htsxdzlcmobmpevzhshh.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V_w52NPbhRA69cOPbbIwIg_CnfS_22A'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Lightbox ─────────────────────────────────────────
let lbUrls = []
let lbIndex = 0

window.openLightbox = function(url, urls = []) {
  lbUrls = urls.length ? urls : [url]
  lbIndex = lbUrls.indexOf(url)
  if (lbIndex === -1) lbIndex = 0
  const lb = document.getElementById('lightbox')
  const img = document.getElementById('lb-img')
  img.src = lbUrls[lbIndex]
  lb.classList.add('open')
  lbUpdateNav()
}

window.closeLightbox = function() {
  document.getElementById('lightbox').classList.remove('open')
  document.getElementById('lb-img').src = ''
}

window.lightboxNav = function(dir) {
  lbIndex = (lbIndex + dir + lbUrls.length) % lbUrls.length
  document.getElementById('lb-img').src = lbUrls[lbIndex]
  lbUpdateNav()
}

function lbUpdateNav() {
  const prev = document.querySelector('.lb-prev')
  const next = document.querySelector('.lb-next')
  const single = lbUrls.length <= 1
  prev?.classList.toggle('hidden', single)
  next?.classList.toggle('hidden', single)
}

document.addEventListener('keydown', e => {
  const lb = document.getElementById('lightbox')
  if (!lb?.classList.contains('open')) return
  if (e.key === 'Escape') window.closeLightbox()
  if (e.key === 'ArrowLeft') window.lightboxNav(-1)
  if (e.key === 'ArrowRight') window.lightboxNav(1)
})

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
  if (name === 'params') loadMicList()
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
  const urls = data.map(file => supabase.storage.from('photos').getPublicUrl(pote + '/' + file.name).data.publicUrl)
  urls.forEach(url => {
    const img = document.createElement('img')
    img.src = url
    img.onclick = () => window.openLightbox(url, urls)
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

    const sinceEl = document.getElementById('param-since')
    if (sinceEl && currentUser.created_at) {
      sinceEl.textContent = new Date(currentUser.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    }

    const paramAv = document.getElementById('param-avatar-display')
    if (paramAv) {
      paramAv.innerHTML = ''
      paramAv.appendChild(renderAvatarEl(uname, 'user-avatar-circle'))
    }
  }
  const isLight = document.body.classList.contains('light')
  const track = document.getElementById('light-toggle-track')
  const check = document.getElementById('light-toggle-check')
  if (track) track.classList.toggle('on', isLight)
  if (check) check.checked = isLight
  buildThemePicker()
}

function showParamToast(msg, isError = false) {
  const toast = document.getElementById('param-toast')
  if (!toast) return
  toast.textContent = msg
  toast.className = 'param-toast' + (isError ? ' param-toast--error' : '') + ' visible'
  clearTimeout(toast._t)
  toast._t = setTimeout(() => toast.classList.remove('visible'), 3200)
}

window.sendPasswordReset = async function() {
  if (!currentUser) return
  const btn = document.querySelector('.param-action-btn:not(.param-action-btn--danger)')
  if (btn) { btn.disabled = true; btn.textContent = '...' }
  const { error } = await supabase.auth.resetPasswordForEmail(currentUser.email)
  if (btn) { btn.disabled = false; btn.textContent = 'Réinitialiser' }
  if (error) {
    showParamToast('Erreur : ' + error.message, true)
  } else {
    showParamToast('Email envoyé à ' + currentUser.email + ' 📧')
  }
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
            bubble.innerHTML = `<img class="chat-img" src="${payload.new.image_url}" onclick="window.openLightbox('${payload.new.image_url}')" />`
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
        ? `<img class="chat-img" src="${msg.image_url}" onclick="window.openLightbox('${msg.image_url}')" />`
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
    ? `<img class="chat-img" src="${msg.image_url}" onclick="window.openLightbox('${msg.image_url}')" />`
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
    const paramAv = document.getElementById('param-avatar-display')
    if (paramAv) { paramAv.innerHTML = ''; paramAv.appendChild(renderAvatarEl(username, 'user-avatar-circle')) }
  }
  e.target.value = ''
})

/* =====================================================
   VOCAL & STREAM (WebRTC)
   ===================================================== */

const VOICE_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
]

let voiceConnected = false
let voiceMuted = false
let localStream = null
let voiceSignalChannel = null
const voicePeers = {}
const voiceIceQueue = {}
let voiceUsers = []
let screenStream = null
let isStreaming = false
let currentStreamUser = null
const screenSenders = {}

function voiceMe() { return currentUser?.user_metadata?.username || currentUser?.email || '' }

function voiceRenderAvatar(username) {
  const div = document.createElement('div')
  div.className = 'voice-avatar'
  div.textContent = username.charAt(0).toUpperCase()
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--accent-2);color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0'
  return div
}

async function vsend(payload) {
  if (!voiceSignalChannel) return
  await voiceSignalChannel.send({ type: 'broadcast', event: 'vs', payload })
}

window.joinVoice = async function () {
  if (voiceConnected || !currentUser) return
  const savedMic = localStorage.getItem('selected-mic')
  const audioConstraint = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(savedMic ? { deviceId: { ideal: savedMic } } : {})
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false })
  } catch {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    } catch {
      showParamToast('Microphone introuvable ou refusé 🎤', true)
      return
    }
  }
  loadMicList()
  voiceConnected = true
  voiceAddUser(voiceMe(), false)
  voiceSignalChannel = supabase.channel('voice-room-v1')
  voiceSignalChannel
    .on('broadcast', { event: 'vs' }, ({ payload }) => voiceHandleSignal(payload))
    .subscribe(async status => {
      if (status !== 'SUBSCRIBED') return
      await vsend({ type: 'join', from: voiceMe() })
      voiceSetupLocalAnalyser()
      renderVoiceUI()
      renderVoiceBar()
    })
}

window.leaveVoice = async function () {
  if (!voiceConnected) return
  if (isStreaming) await stopStream(true)
  if (voiceSignalChannel) {
    await vsend({ type: 'leave', from: voiceMe() })
    await supabase.removeChannel(voiceSignalChannel)
    voiceSignalChannel = null
  }
  Object.values(voicePeers).forEach(pc => pc.close())
  for (const k in voicePeers) delete voicePeers[k]
  for (const k in voiceIceQueue) delete voiceIceQueue[k]
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null }
  document.querySelectorAll('.v-remote-audio').forEach(el => el.remove())
  voiceConnected = false
  voiceMuted = false
  voiceUsers = []
  renderVoiceUI()
  renderVoiceBar()
}

async function voiceHandleSignal(p) {
  if (!p || p.from === voiceMe()) return
  switch (p.type) {
    case 'join':
      await voiceCreateOffer(p.from)
      voiceAddUser(p.from, false)
      renderVoiceUI()
      break
    case 'offer':
      if (p.to === voiceMe()) await voiceHandleOffer(p.from, p.sdp)
      break
    case 'answer':
      if (p.to === voiceMe()) await voiceHandleAnswer(p.from, p.sdp)
      break
    case 'ice':
      if (p.to === voiceMe()) await voiceHandleIce(p.from, p.candidate)
      break
    case 'leave':
      voiceRemovePeer(p.from)
      break
    case 'mute': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.muted = p.muted; voiceRefreshCard(p.from) }
      break
    }
    case 'stream-start': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.streaming = true; voiceRefreshCard(p.from) }
      currentStreamUser = p.from
      // Ouvre le viewer tout de suite (placeholder noir) — la vidéo arrive via ontrack
      const viewer = document.getElementById('stream-viewer')
      const nameEl = document.getElementById('stream-viewer-name')
      if (viewer) viewer.style.display = ''
      if (nameEl) nameEl.textContent = p.from
      break
    }
    case 'stream-stop': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.streaming = false; voiceRefreshCard(p.from) }
      if (currentStreamUser === p.from) hideStreamView()
      break
    }
  }
}

function voiceMakePeer(remote) {
  if (voicePeers[remote]) return voicePeers[remote]
  const pc = new RTCPeerConnection({ iceServers: VOICE_ICE })
  voicePeers[remote] = pc
  voiceIceQueue[remote] = []
  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
  pc.onicecandidate = async e => {
    if (e.candidate) await vsend({ type: 'ice', from: voiceMe(), to: remote, candidate: e.candidate.toJSON() })
  }
  pc.ontrack = e => {
    const stream = e.streams[0] || new MediaStream([e.track])
    if (e.track.kind === 'video') {
      // Supprimer l'audio element créé pour ce stream si le track audio est arrivé avant la vidéo
      // Le <video> gère l'audio lui-même — sinon le son joue en double (distorsion)
      const audioEl = document.getElementById('v-audio-' + stream.id)
      if (audioEl) { audioEl.pause(); audioEl.srcObject = null; audioEl.remove() }
      voiceShowStream(remote, stream)
    } else {
      // Si le <video> joue déjà ce stream (vidéo arrivée avant audio), il gère déjà l'audio
      const videoEl = document.getElementById('stream-video')
      if (videoEl && videoEl.srcObject && videoEl.srcObject.id === stream.id) return
      voicePlayAudio(remote, stream)
      voiceAddUser(remote, false)
      renderVoiceUI()
    }
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') voiceRemovePeer(remote)
  }
  return pc
}

async function voiceCreateOffer(remote) {
  const pc = voiceMakePeer(remote)
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await vsend({ type: 'offer', from: voiceMe(), to: remote, sdp: pc.localDescription.toJSON() })
}

async function voiceHandleOffer(remote, sdp) {
  const pc = voiceMakePeer(remote)
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  for (const c of (voiceIceQueue[remote] || [])) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  voiceIceQueue[remote] = []
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await vsend({ type: 'answer', from: voiceMe(), to: remote, sdp: pc.localDescription.toJSON() })
  voiceAddUser(remote, false)
  renderVoiceUI()
}

async function voiceHandleAnswer(remote, sdp) {
  const pc = voicePeers[remote]
  if (!pc) return
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  for (const c of (voiceIceQueue[remote] || [])) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  voiceIceQueue[remote] = []
  voiceAddUser(remote, false)
  renderVoiceUI()
}

async function voiceHandleIce(remote, candidate) {
  const pc = voicePeers[remote]
  if (!pc || !pc.remoteDescription) { ;(voiceIceQueue[remote] = voiceIceQueue[remote] || []).push(candidate); return }
  await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
}

function voiceRemovePeer(remote) {
  const pc = voicePeers[remote]
  if (pc) { pc.close(); delete voicePeers[remote] }
  delete voiceIceQueue[remote]
  delete screenSenders[remote]
  document.querySelectorAll('.v-remote-audio[data-user="' + remote + '"]').forEach(el => el.remove())
  if (currentStreamUser === remote) hideStreamView()
  voiceUsers = voiceUsers.filter(u => u.name !== remote)
  renderVoiceUI()
}

function voicePlayAudio(username, stream) {
  // Clé par stream.id pour éviter qu'un stream audio écrase le stream micro
  const elId = 'v-audio-' + stream.id
  let el = document.getElementById(elId)
  if (!el) {
    el = document.createElement('audio')
    el.id = elId
    el.className = 'v-remote-audio'
    el.autoplay = true
    el.style.display = 'none'
    el.dataset.user = username
    document.body.appendChild(el)
  }
  el.srcObject = stream
  voiceWatchLevel(username, stream)
}

function voiceSetupLocalAnalyser() {
  if (!localStream) return
  voiceWatchLevel(voiceMe(), localStream)
}

function voiceWatchLevel(username, stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let prev = false
    const tick = () => {
      if (!voiceConnected) { ctx.close(); return }
      analyser.getByteFrequencyData(data)
      const avg = data.reduce((a, b) => a + b, 0) / data.length
      const now = avg > 10
      if (now !== prev) {
        prev = now
        const u = voiceUsers.find(u => u.name === username)
        if (u) { u.speaking = now; voiceRefreshCard(username) }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  } catch {}
}

window.toggleVoiceMute = function () {
  if (!voiceConnected || !localStream) return
  voiceMuted = !voiceMuted
  localStream.getAudioTracks().forEach(t => { t.enabled = !voiceMuted })
  const u = voiceUsers.find(u => u.name === voiceMe())
  if (u) { u.muted = voiceMuted; u.speaking = false; voiceRefreshCard(voiceMe()) }
  vsend({ type: 'mute', from: voiceMe(), muted: voiceMuted })
  voiceRefreshMuteBtn()
  renderVoiceBar()
}

function voiceAddUser(name, muted) {
  if (!voiceUsers.find(u => u.name === name)) voiceUsers.push({ name, muted, speaking: false, streaming: false })
}

function renderVoiceUI() {
  const list = document.getElementById('voice-users-list')
  const joinBtn = document.getElementById('voice-join-btn')
  const controls = document.getElementById('voice-controls')
  const emptyMsg = document.getElementById('voice-empty-msg')
  const countEl = document.getElementById('voice-count')
  if (!list) return
  list.innerHTML = ''
  voiceUsers.forEach(u => list.appendChild(voiceBuildCard(u)))
  if (joinBtn) joinBtn.style.display = voiceConnected ? 'none' : ''
  if (controls) controls.style.display = voiceConnected ? 'flex' : 'none'
  if (emptyMsg) emptyMsg.style.display = voiceUsers.length ? 'none' : ''
  if (countEl) countEl.textContent = voiceUsers.length
    ? voiceUsers.length + ' connecté' + (voiceUsers.length > 1 ? 's' : '')
    : 'Personne pour l\'instant'
  voiceRefreshMuteBtn()
}

function voiceBuildCard(user) {
  const div = document.createElement('div')
  div.id = 'voice-card-' + user.name
  div.className = 'voice-user-card' + (user.speaking && !user.muted ? ' speaking' : '') + (user.streaming ? ' live' : '')
  div.appendChild(voiceRenderAvatar(user.name))
  const name = document.createElement('span')
  name.className = 'voice-user-name'
  name.textContent = user.name
  div.appendChild(name)
  if (user.streaming) {
    const badge = document.createElement('span')
    badge.id = 'voice-live-badge-' + user.name
    badge.className = 'voice-live-badge'
    badge.textContent = '🔴 LIVE'
    div.appendChild(badge)
  }
  const mic = document.createElement('span')
  mic.id = 'voice-mic-' + user.name
  mic.className = 'voice-user-mic'
  mic.textContent = user.muted ? '🔇' : '🎤'
  div.appendChild(mic)
  return div
}

function voiceRefreshCard(username) {
  const card = document.getElementById('voice-card-' + username)
  const user = voiceUsers.find(u => u.name === username)
  if (!card || !user) return
  card.className = 'voice-user-card' + (user.speaking && !user.muted ? ' speaking' : '') + (user.streaming ? ' live' : '')
  const mic = document.getElementById('voice-mic-' + username)
  if (mic) mic.textContent = user.muted ? '🔇' : '🎤'
  const existingBadge = document.getElementById('voice-live-badge-' + username)
  if (user.streaming && !existingBadge) {
    const badge = document.createElement('span')
    badge.id = 'voice-live-badge-' + username
    badge.className = 'voice-live-badge'
    badge.textContent = '🔴 LIVE'
    mic.before(badge)
  } else if (!user.streaming && existingBadge) {
    existingBadge.remove()
  }
}

function voiceRefreshMuteBtn() {
  const btn = document.getElementById('voice-mute-btn')
  if (!btn) return
  btn.className = 'voice-ctrl-btn' + (voiceMuted ? ' muted' : '')
  btn.innerHTML = voiceMuted
    ? '<span class="vcb-icon">🔇</span><span class="vcb-label">Muet</span>'
    : '<span class="vcb-icon">🎤</span><span class="vcb-label">Micro</span>'
}

function renderVoiceBar() {
  const bar = document.getElementById('voice-bar')
  if (!bar) return
  bar.classList.toggle('visible', voiceConnected)
  const btn = document.getElementById('vbar-mute')
  if (btn) btn.textContent = voiceMuted ? '🔇' : '🎤'
}

/* ── Stream ───────────────────────────────────────────────── */
window.toggleStream = async function () {
  if (isStreaming) { await stopStream() } else { await startStream() }
}

async function startStream() {
  if (!voiceConnected) return
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: true })
  } catch { return }
  isStreaming = true
  const hasAudio = screenStream.getAudioTracks().length > 0
  if (!hasAudio) showParamToast('Pas d\'audio capturé — sur Windows, coche "Partager le son du système" dans la boîte de dialogue 🔇', true)
  const tracks = screenStream.getTracks() // vidéo + audio (si autorisé)
  for (const [remote, pc] of Object.entries(voicePeers)) {
    screenSenders[remote] = tracks.map(t => pc.addTrack(t, screenStream))
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await vsend({ type: 'offer', from: voiceMe(), to: remote, sdp: pc.localDescription.toJSON() })
    } catch (err) { console.warn('stream renegotiation failed for', remote, err) }
  }
  const videoTrack = screenStream.getVideoTracks()[0]
  if (videoTrack) videoTrack.onended = () => stopStream()
  await vsend({ type: 'stream-start', from: voiceMe() })
  const u = voiceUsers.find(u => u.name === voiceMe())
  if (u) { u.streaming = true; voiceRefreshCard(voiceMe()) }
  currentStreamUser = voiceMe()
  voiceShowLocalPreview()
  updateStreamBtn()
}

async function stopStream(silent = false) {
  if (!isStreaming) return
  isStreaming = false
  for (const k in screenSenders) delete screenSenders[k]
  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null }
  if (!silent) await vsend({ type: 'stream-stop', from: voiceMe() })
  const u = voiceUsers.find(u => u.name === voiceMe())
  if (u) { u.streaming = false; voiceRefreshCard(voiceMe()) }
  if (currentStreamUser === voiceMe()) hideStreamView()
  updateStreamBtn()
}

function voiceShowLocalPreview() {
  const video = document.getElementById('stream-video')
  const nameEl = document.getElementById('stream-viewer-name')
  const viewer = document.getElementById('stream-viewer')
  if (!video || !viewer || !screenStream) return
  video.srcObject = screenStream
  video.muted = true  // évite la boucle feedback locale (loopback → lecture → re-capture)
  if (nameEl) nameEl.textContent = voiceMe()
  viewer.style.display = ''
}

function voiceShowStream(username, stream) {
  const video = document.getElementById('stream-video')
  const nameEl = document.getElementById('stream-viewer-name')
  const viewer = document.getElementById('stream-viewer')
  if (!video || !viewer) return
  video.srcObject = stream
  if (nameEl) nameEl.textContent = username
  viewer.style.display = ''
  currentStreamUser = username
  const u = voiceUsers.find(u => u.name === username)
  if (u) { u.streaming = true; voiceRefreshCard(username) }
}

function hideStreamView() {
  const viewer = document.getElementById('stream-viewer')
  const video = document.getElementById('stream-video')
  if (viewer) viewer.style.display = 'none'
  if (video) video.srcObject = null
  currentStreamUser = null
}

window.toggleStreamFullscreen = function () {
  const video = document.getElementById('stream-video')
  if (!video) return
  if (!document.fullscreenElement) video.requestFullscreen?.() || video.webkitRequestFullscreen?.()
  else document.exitFullscreen?.() || document.webkitExitFullscreen?.()
}

function updateStreamBtn() {
  const btn = document.getElementById('stream-btn')
  if (!btn) return
  btn.className = 'voice-ctrl-btn' + (isStreaming ? ' streaming' : '')
  btn.innerHTML = isStreaming
    ? '<span class="vcb-icon">⏹️</span><span class="vcb-label">Stop</span>'
    : '<span class="vcb-icon">🖥️</span><span class="vcb-label">Stream</span>'
}

/* ── Mic selector ─────────────────────────────────────────── */
async function loadMicList(requestPermission = false) {
  const select = document.getElementById('mic-select')
  if (!select) return
  if (requestPermission) {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
      tmp.getTracks().forEach(t => t.stop())
    } catch {
      showParamToast('Permission micro refusée 🎤', true)
      return
    }
  }
  if (!navigator.mediaDevices) return
  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter(d => d.kind === 'audioinput')
  const hasLabels = inputs.some(d => d.label)
  const saved = localStorage.getItem('selected-mic') || ''
  select.innerHTML = '<option value="">Par défaut</option>'
  inputs.forEach((d, i) => {
    const opt = document.createElement('option')
    opt.value = d.deviceId
    opt.textContent = d.label || ('Micro ' + (i + 1))
    opt.selected = d.deviceId === saved
    select.appendChild(opt)
  })
  const sublabel = document.getElementById('mic-sublabel')
  if (sublabel) sublabel.textContent = inputs.length > 1 ? inputs.length + ' micros détectés' : 'Micro système par défaut'
  const detectRow = document.getElementById('mic-detect-row')
  if (detectRow) detectRow.style.display = hasLabels || inputs.length <= 1 ? 'none' : ''
}

window.saveMicChoice = function (deviceId) { localStorage.setItem('selected-mic', deviceId) }
window.loadMicList = (rp) => loadMicList(rp)