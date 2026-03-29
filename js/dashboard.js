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
  if (lb?.classList.contains('open')) {
    if (e.key === 'Escape') window.closeLightbox()
    if (e.key === 'ArrowLeft') window.lightboxNav(-1)
    if (e.key === 'ArrowRight') window.lightboxNav(1)
    return
  }
  if (e.key === 'Escape') window.closeProfile()
})

// ── Utilitaires ──────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

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
let onlineUsersSet = new Set()
let notifSoundEnabled = localStorage.getItem('notif-sound') !== 'off'

function playNotifSound() {
  if (!notifSoundEnabled) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.12, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32)
    o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.32)
    setTimeout(() => ctx.close(), 500)
  } catch(e) {}
}

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
  loadWeather()
  loadActivity()

  // Init profil (crée l'entrée à la première connexion avec la vraie date de compte, ne fait rien si existe déjà)
  supabase.from('profiles').upsert(
    { username, joined_at: currentUser.created_at },
    { onConflict: 'username', ignoreDuplicates: true }
  ).then(() => {})

  // Presence
  const channel = supabase.channel('online-users')
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const onlineDiv = document.getElementById('online-users')
      onlineDiv.innerHTML = ''
      const users = []
      Object.values(state).forEach(presences => presences.forEach(p => users.push(p.username)))
      onlineUsersSet = new Set(users)
      // Fetch statuts pour tous les users en ligne
      supabase.from('profiles').select('username, status, status_emoji').in('username', users).then(({ data: profs }) => {
        const statusMap = {}
        if (profs) profs.forEach(p => statusMap[p.username] = p)
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
  const counts = await Promise.all(potes.map(async pote => {
    const { data } = await supabase.storage.from('photos').list(pote, { limit: 100 })
    return data ? data.length : 0
  }))
  document.getElementById('stat-photos').textContent = counts.reduce((a, b) => a + b, 0)
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
        <span class="home-message-username">${escapeHtml(msg.username)}</span>
        <span class="home-message-time">${time}</span>
      </div>
      <div class="home-message-text">${escapeHtml(msg.content) || '📷 Photo'}</div>
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
  const mainEl = document.querySelector('.main')
  if (mainEl) mainEl.scrollTop = 0
  if (name === 'params') { loadMicList(); loadParamProfile() }
  if (name === 'calendrier') initCalendar()
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
  if (error || !data?.length) {
    grid.innerHTML = '<p style="color:#aaa">Aucune photo pour l\'instant...</p>'
    return
  }
  const urls = data
    .filter(f => f.name !== '.emptyFolderPlaceholder')
    .map(file => supabase.storage.from('photos').getPublicUrl(pote + '/' + file.name).data.publicUrl)

  // Fetch likes
  const username = currentUser?.user_metadata?.username || currentUser?.email
  const { data: likes } = await supabase.from('photo_likes').select('photo_url, username').in('photo_url', urls)
  const likeMap = {}
  if (likes) likes.forEach(l => {
    likeMap[l.photo_url] = likeMap[l.photo_url] || []
    likeMap[l.photo_url].push(l.username)
  })

  urls.forEach(url => {
    const wrap = document.createElement('div')
    wrap.className = 'photo-grid-item'
    const img = document.createElement('img')
    img.src = url; img.alt = ''
    img.onclick = () => window.openLightbox(url, urls)
    const myLike = (likeMap[url] || []).includes(username)
    const count = (likeMap[url] || []).length
    const likeBtn = document.createElement('button')
    likeBtn.className = 'photo-like-btn' + (myLike ? ' liked' : '')
    likeBtn.innerHTML = `<span class="like-heart">${myLike ? '❤️' : '🤍'}</span><span class="like-count">${count || ''}</span>`
    likeBtn.onclick = (e) => { e.stopPropagation(); window.togglePhotoLike(url, likeBtn, username) }
    wrap.appendChild(img); wrap.appendChild(likeBtn)
    grid.appendChild(wrap)
  })
}

window.togglePhotoLike = async function(url, btn, username) {
  const isLiked = btn.classList.contains('liked')
  if (isLiked) {
    await supabase.from('photo_likes').delete().eq('photo_url', url).eq('username', username)
  } else {
    await supabase.from('photo_likes').insert({ photo_url: url, username })
  }
  const { data: likes } = await supabase.from('photo_likes').select('username').eq('photo_url', url)
  const count = likes?.length || 0
  const nowLiked = !isLiked
  btn.classList.toggle('liked', nowLiked)
  btn.innerHTML = `<span class="like-heart">${nowLiked ? '❤️' : '🤍'}</span><span class="like-count">${count || ''}</span>`
}

window.handleDrop = function(e) {
  e.preventDefault()
  document.getElementById('upload-zone')?.classList.remove('dragover')
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
  if (files.length) uploadFileList(files)
}

window.uploadPhotos = function() {
  const input = document.getElementById('photo-input')
  if (!input.files.length) return
  uploadFileList(Array.from(input.files))
  input.value = ''
}

async function uploadFileList(files) {
  const progressList = document.getElementById('upload-progress-list')
  const msg = document.getElementById('upload-message')
  msg.textContent = ''
  progressList.innerHTML = ''

  const items = files.map((file, i) => {
    const item = document.createElement('div')
    item.className = 'upload-progress-item'
    item.innerHTML = `<div class="upload-progress-name">${escapeHtml(file.name)}</div>
      <div class="upload-progress-bar-wrap"><div class="upload-progress-bar" id="upbar-${i}" style="width:0%"></div></div>`
    progressList.appendChild(item)
    return item
  })

  let errors = 0
  for (let i = 0; i < files.length; i++) {
    const bar = document.getElementById('upbar-' + i)
    if (bar) bar.style.width = '30%'
    const fileName = currentPote + '/' + Date.now() + '_' + files[i].name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const compressed = await compressImage(files[i])
    if (bar) bar.style.width = '70%'
    const { error } = await supabase.storage.from('photos').upload(fileName, compressed)
    if (bar) bar.style.width = error ? '100%' : '100%'
    if (bar) bar.style.background = error ? '#f87171' : 'linear-gradient(90deg,var(--accent-2),var(--accent))'
    if (error) errors++
  }

  setTimeout(() => { progressList.innerHTML = '' }, 1800)
  if (errors) {
    msg.style.color = 'var(--danger)'; msg.textContent = errors + ' erreur(s) d\'upload'
  } else {
    msg.style.color = 'var(--success)'; msg.textContent = '✅ ' + files.length + ' photo(s) envoyée(s) !'
    setTimeout(() => { msg.textContent = '' }, 3000)
  }
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
let chatObserver = null

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
        el.innerHTML = `<span>${escapeHtml(payload.username)}</span><span class="typing-dots"><span></span><span></span><span></span></span>`
        el.style.opacity = '1'
        clearTimeout(el._timeout)
        el._timeout = setTimeout(() => { el.style.opacity = '0' }, 2000)
        // Pulse sur le bouton nav Chat quand on n'est pas dans le chat
        if (!chatOpen) {
          document.querySelectorAll('[data-section="chat"]').forEach(btn => {
            btn.classList.add('typing-pulse')
            clearTimeout(btn._typingPulse)
            btn._typingPulse = setTimeout(() => btn.classList.remove('typing-pulse'), 2500)
          })
        }
      }
    })
    .subscribe()
}

const CHAT_PAGE = 50

async function loadMessages() {
  if (chatObserver) { chatObserver.disconnect(); chatObserver = null }
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
  loadPinnedBar()
}

function setupLoadMoreObserver() {
  if (chatObserver) { chatObserver.disconnect(); chatObserver = null }
  const sentinel = document.getElementById('chat-sentinel')
  if (!sentinel) return

  chatObserver = new IntersectionObserver(async entries => {
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
      chatObserver?.disconnect(); chatObserver = null
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

      const replyHtml = msg.reply_preview ? `<div class="reply-preview">↩️ ${escapeHtml(msg.reply_preview)}</div>` : ''
      const safeContentB = escapeHtml(msg.content)
      const bubbleContent = msg.image_url
        ? `<img class="chat-img" src="${escapeHtml(msg.image_url)}" onclick="window.openLightbox('${escapeHtml(msg.image_url)}')" />`
        : safeContentB

      const bubbleInner = msg.image_url
        ? `${bubbleContent}<span class="bubble-time">${time}</span>`
        : `<span class="bubble-text">${bubbleContent}</span><span class="bubble-time">${time}</span>`
      div.innerHTML = `
        ${replyHtml}
        <div class="msg-wrapper">
          ${!isMine ? `<div class="msg-name" onclick="window.openProfile('${escapeHtml(msg.username)}')">${escapeHtml(msg.username)}</div>` : ''}
          <div class="msg-row">
            <div class="msg-actions" id="actions-${msg.id}">
              <button onclick="startReply('${msg.id}', '${safeContentB}', '${escapeHtml(msg.username)}')">↩️</button>
              <button onclick="showReactionPicker('${msg.id}')">😄</button>
              <button onclick="window.togglePin('${msg.id}', '${escapeHtml((msg.content||'').substring(0,60))}')">📌</button>
              ${isMine && !msg.image_url ? `<button onclick="window.startEdit('${msg.id}', '${safeContentB}')">✏️</button>` : ''}
              ${isMine ? `<button onclick="window.deleteMessage('${msg.id}')">🗑️</button>` : ''}
            </div>
            <div class="chat-bubble">${bubbleInner}</div>
          </div>
        </div>
        ${buildReactions(msg)}
      `
      frag.appendChild(div)
    })

    lastMessageDate = tempLastDate
    sentinel.after(frag)
    container.scrollTop = container.scrollHeight - prevHeight
    chatLoadingMore = false

  }, { root: document.getElementById('chat-messages'), rootMargin: '80px 0px 0px 0px', threshold: 0 })

  chatObserver.observe(sentinel)
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
  container.appendChild(div)
  container.scrollTop = container.scrollHeight

  // Badge de notif + son si on est ailleurs
  if (chatInitialized && !chatOpen && !isMine) {
    unreadCount++
    updateBadge()
    playNotifSound()
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
  const onEditKey = e => {
    if (e.key === 'Enter') window.saveEdit(id)
    if (e.key === 'Escape') window.cancelEdit(id)
  }
  inp.addEventListener('keydown', onEditKey)
  inp._editCleanup = () => inp.removeEventListener('keydown', onEditKey)
  inp.focus()
}

window.saveEdit = async function(id) {
  const input = document.getElementById('edit-input-' + id)
  if (!input) return
  input._editCleanup?.()
  const newContent = input.value.trim()
  if (!newContent) { window.cancelEdit(id); return }
  await supabase.from('messages').update({ content: newContent }).eq('id', id)
}

window.cancelEdit = function(id) {
  const input = document.getElementById('edit-input-' + id)
  input?._editCleanup?.()
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

  requestAnimationFrame(() => {
    const handler = (e) => {
      if (!picker.isConnected) { document.removeEventListener('click', handler); return }
      if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', handler) }
    }
    document.addEventListener('click', handler)
  })
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
  Object.values(voiceAudioCtxs).forEach(ctx => ctx.close().catch(() => {}))
  Object.keys(voiceAudioCtxs).forEach(k => delete voiceAudioCtxs[k])
  Object.values(voicePeers).forEach(pc => pc.close())
  Object.keys(voicePeers).forEach(k => delete voicePeers[k])
  Object.keys(voiceIceQueue).forEach(k => delete voiceIceQueue[k])
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

const voiceAudioCtxs = {}

function voiceWatchLevel(username, stream) {
  // Ferme l'ancien AudioContext pour cet utilisateur avant d'en créer un nouveau
  if (voiceAudioCtxs[username]) { voiceAudioCtxs[username].close().catch(() => {}); delete voiceAudioCtxs[username] }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    voiceAudioCtxs[username] = ctx
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let prev = false
    const tick = () => {
      if (!voiceConnected || ctx.state === 'closed') { ctx.close().catch(() => {}); delete voiceAudioCtxs[username]; return }
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

// ── Profils ──────────────────────────────────────────
window.openProfile = async function(username) {
  const modal = document.getElementById('profile-modal')
  const avEl = document.getElementById('profile-av-el')
  const isMine = username === (currentUser?.user_metadata?.username || currentUser?.email)

  // Reset & affichage immédiat
  avEl.innerHTML = ''
  avEl.appendChild(renderAvatarEl(username, 'user-avatar-circle'))
  document.getElementById('profile-username-txt').textContent = username
  const isOnline = onlineUsersSet.has(username)
  document.getElementById('profile-status-txt').textContent = isOnline ? '🟢 En ligne' : '⚫ Hors ligne'
  document.getElementById('profile-online-dot').className = 'profile-online-dot' + (isOnline ? ' online' : '')
  document.getElementById('profile-msgs').textContent = '—'
  document.getElementById('profile-photos').textContent = '—'
  document.getElementById('profile-since-val').textContent = '—'

  const bioView = document.getElementById('profile-bio-view')
  const bioEdit = document.getElementById('profile-bio-edit')
  bioView.textContent = '...'
  bioView.className = 'profile-bio-view' + (isMine ? ' editable' : '')
  bioView.style.display = 'block'
  bioEdit.style.display = 'none'

  if (isMine) {
    bioView.onclick = () => {
      bioView.style.display = 'none'
      bioEdit.style.display = 'block'
      const inp = document.getElementById('profile-bio-input')
      inp.focus()
      inp.setSelectionRange(inp.value.length, inp.value.length)
    }
  } else {
    bioView.onclick = null
  }

  modal.classList.add('open')

  // Chargement profil Supabase
  const { data: profile } = await supabase.from('profiles').select('*').eq('username', username).maybeSingle()
  const bio = profile?.bio || ''
  bioView.textContent = bio || (isMine ? '✏️ Clique pour ajouter une description' : 'Aucune description')

  // Statut personnalisé
  const customStatusEl = document.getElementById('profile-custom-status')
  if (profile?.status) {
    customStatusEl.textContent = (profile.status_emoji ? profile.status_emoji + ' ' : '') + profile.status
    customStatusEl.style.display = 'block'
  } else {
    customStatusEl.style.display = 'none'
  }

  // Badges
  let badgesHtml = ''
  const sinceDate = isMine ? currentUser?.created_at : profile?.joined_at
  if (sinceDate && (Date.now() - new Date(sinceDate).getTime()) < 30 * 24 * 3600 * 1000) {
    badgesHtml += '<span class="profile-badge profile-badge--new">🌱 Nouveau</span>'
  }

  if (isMine) {
    const inp = document.getElementById('profile-bio-input')
    inp.value = bio
    document.getElementById('profile-bio-count').textContent = bio.length + '/200'
    inp.oninput = () => { document.getElementById('profile-bio-count').textContent = inp.value.length + '/200' }
  }

  const sinceRaw = isMine ? currentUser?.created_at : profile?.joined_at
  if (sinceRaw) {
    document.getElementById('profile-since-val').textContent = new Date(sinceRaw).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
  }

  // Stats async
  const [msgRes, photoRes] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('username', username),
    supabase.storage.from('photos').list(username, { limit: 1000 })
  ])
  const msgCount = msgRes.count ?? 0
  document.getElementById('profile-msgs').textContent = msgCount
  document.getElementById('profile-photos').textContent = photoRes.data?.length ?? 0

  // Badge actif (> 100 messages)
  if (msgCount >= 100) badgesHtml += '<span class="profile-badge profile-badge--active">⭐ Actif</span>'
  if (badgesHtml) {
    const existingBadges = document.querySelector('.profile-badges')
    if (existingBadges) existingBadges.remove()
    const badgesEl = document.createElement('div')
    badgesEl.className = 'profile-badges'
    badgesEl.innerHTML = badgesHtml
    document.getElementById('profile-username-txt').insertAdjacentElement('afterend', badgesEl)
  }
}

window.closeProfile = function() {
  document.getElementById('profile-modal').classList.remove('open')
}

window.saveProfileBio = async function() {
  const username = currentUser?.user_metadata?.username || currentUser?.email
  const bio = document.getElementById('profile-bio-input').value.trim()
  const { error } = await supabase.from('profiles').upsert(
    { username, bio, updated_at: new Date().toISOString() },
    { onConflict: 'username' }
  )
  if (!error) {
    const bioView = document.getElementById('profile-bio-view')
    bioView.textContent = bio || '✏️ Clique pour ajouter une description'
    document.getElementById('profile-bio-edit').style.display = 'none'
    bioView.style.display = 'block'
    const paramInp = document.getElementById('param-bio-input')
    if (paramInp) { paramInp.value = bio; document.getElementById('param-bio-count').textContent = bio.length + '/200' }
  }
}

async function loadParamProfile() {
  const username = currentUser?.user_metadata?.username || currentUser?.email
  if (!username) return
  const { data: profile } = await supabase.from('profiles').select('bio, status, status_emoji').eq('username', username).maybeSingle()
  const bio = profile?.bio || ''
  const inp = document.getElementById('param-bio-input')
  if (inp) { inp.value = bio; document.getElementById('param-bio-count').textContent = bio.length + '/200' }
  const emojiInp = document.getElementById('param-status-emoji')
  const textInp = document.getElementById('param-status-text')
  if (emojiInp) emojiInp.value = profile?.status_emoji || ''
  if (textInp) textInp.value = profile?.status || ''
}

window.saveParamBio = async function() {
  const username = currentUser?.user_metadata?.username || currentUser?.email
  const bio = document.getElementById('param-bio-input').value.trim()
  const { error } = await supabase.from('profiles').upsert(
    { username, bio, updated_at: new Date().toISOString() },
    { onConflict: 'username' }
  )
  if (error) { showParamToast('Erreur : ' + error.message, true) }
  else {
    showParamToast('Description sauvegardée ✓')
    document.getElementById('param-bio-count').textContent = bio.length + '/200'
  }
}

window.saveStatus = async function() {
  const username = currentUser?.user_metadata?.username || currentUser?.email
  const status_emoji = document.getElementById('param-status-emoji').value.trim()
  const status = document.getElementById('param-status-text').value.trim()
  const { error } = await supabase.from('profiles').upsert(
    { username, status, status_emoji, updated_at: new Date().toISOString() },
    { onConflict: 'username' }
  )
  if (error) showParamToast('Erreur : ' + error.message, true)
  else showParamToast('Statut mis à jour ✓')
}

// ── Météo ─────────────────────────────────────────────
const WMO = {
  0:'☀️ Ensoleillé', 1:'🌤️ Peu nuageux', 2:'⛅ Nuageux', 3:'☁️ Couvert',
  45:'🌫️ Brouillard', 48:'🌫️ Brouillard', 51:'🌦️ Bruine', 53:'🌦️ Bruine',
  55:'🌧️ Bruine dense', 61:'🌧️ Pluie', 63:'🌧️ Pluie', 65:'🌧️ Pluie forte',
  71:'❄️ Neige', 73:'❄️ Neige', 75:'❄️ Neige forte', 80:'🌧️ Averses',
  81:'🌧️ Averses', 82:'⛈️ Averses violentes', 95:'⛈️ Orage', 96:'⛈️ Orage', 99:'⛈️ Orage'
}

async function loadWeather() {
  const el = document.getElementById('weather-content')
  if (!el) return
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
    ).catch(() => null)
    const lat = pos?.coords?.latitude ?? 48.85
    const lon = pos?.coords?.longitude ?? 2.35
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`
    const r = await fetch(url)
    const d = await r.json()
    const temp = Math.round(d.current.temperature_2m)
    const code = d.current.weathercode
    const desc = WMO[code] || '🌡️ Inconnu'
    const [emoji, ...rest] = desc.split(' ')
    // Reverse geocode city
    let city = ''
    try {
      const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
      const gd = await geo.json()
      city = gd.address?.city || gd.address?.town || gd.address?.village || ''
    } catch(e) {}
    el.innerHTML = `
      <div class="weather-main">
        <div class="weather-emoji">${emoji}</div>
        <div>
          <div class="weather-temp">${temp}°C</div>
          <div class="weather-desc">${rest.join(' ')}</div>
        </div>
      </div>
      ${city ? `<div class="weather-city">📍 ${escapeHtml(city)}</div>` : ''}
    `
  } catch(e) {
    el.innerHTML = '<div class="weather-loading">Météo indisponible</div>'
  }
}

// ── Activité récente ──────────────────────────────────
async function loadActivity() {
  const container = document.getElementById('home-activity')
  if (!container) return
  const { data } = await supabase.from('messages').select('username, created_at, content, image_url')
    .order('created_at', { ascending: false }).limit(8)
  if (!data?.length) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.84rem">Aucune activité</p>'; return }
  container.innerHTML = ''
  // Déduplique par username (garder le plus récent)
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
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return Math.floor(diff / 60) + ' min'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h'
  return Math.floor(diff / 86400) + 'j'
}

// ── Messages épinglés ─────────────────────────────────
async function loadPinnedBar() {
  const { data } = await supabase.from('messages').select('id, content, username')
    .eq('pinned', true).order('updated_at', { ascending: false }).limit(1)
  const bar = document.getElementById('pinned-bar')
  const textEl = document.getElementById('pinned-bar-text')
  if (!bar || !textEl) return
  if (data?.length) {
    textEl.textContent = data[0].username + ' : ' + (data[0].content || '📷 Image')
    bar.style.display = 'flex'
  } else {
    bar.style.display = 'none'
  }
}

window.togglePin = async function(id, preview) {
  const { data: msg } = await supabase.from('messages').select('pinned').eq('id', id).single()
  const newPinned = !msg?.pinned
  await supabase.from('messages').update({ pinned: newPinned }).eq('id', id)
  if (newPinned) {
    const bar = document.getElementById('pinned-bar')
    const textEl = document.getElementById('pinned-bar-text')
    if (bar && textEl) {
      const username = (currentUser?.user_metadata?.username || currentUser?.email)
      textEl.textContent = username + ' : ' + (preview || '📷 Image')
      bar.style.display = 'flex'
    }
  } else {
    loadPinnedBar()
  }
}

// ── Calendrier ────────────────────────────────────────
let calYear = new Date().getFullYear()
let calMonth = new Date().getMonth()
let calEvents = []

async function initCalendar() {
  const { data } = await supabase.from('events').select('*').order('event_date')
  calEvents = data || []
  renderCalendar()
}

function renderCalendar() {
  const titleEl = document.getElementById('cal-month-title')
  const grid = document.getElementById('cal-grid')
  if (!titleEl || !grid) return
  titleEl.textContent = new Date(calYear, calMonth).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const firstDay = (new Date(calYear, calMonth, 1).getDay() + 6) % 7 // lundi = 0
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
  const today = new Date()
  grid.innerHTML = ''
  // Blanks
  for (let i = 0; i < firstDay; i++) {
    const blank = document.createElement('div')
    blank.className = 'cal-day empty'
    grid.appendChild(blank)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div')
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
    cell.className = 'cal-day' + (isToday ? ' today' : '')
    cell.onclick = () => window.openAddEvent(dateStr)
    const num = document.createElement('div')
    num.className = 'cal-day-num'; num.textContent = d
    cell.appendChild(num)
    calEvents.filter(e => e.event_date === dateStr).forEach(ev => {
      const dot = document.createElement('div')
      dot.className = 'cal-event-dot'
      dot.textContent = (ev.event_time ? ev.event_time.substring(0,5) + ' ' : '') + ev.title
      dot.title = ev.description || ev.title
      dot.onclick = (e) => { e.stopPropagation(); window.deleteEvent(ev.id, cell, dot) }
      cell.appendChild(dot)
    })
    grid.appendChild(cell)
  }
}

window.calPrev = function() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear-- } renderCalendar() }
window.calNext = function() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++ } renderCalendar() }

window.openAddEvent = function(dateStr = '') {
  document.getElementById('event-modal').classList.add('open')
  document.getElementById('event-title-input').value = ''
  document.getElementById('event-date-input').value = dateStr
  document.getElementById('event-time-input').value = ''
  document.getElementById('event-desc-input').value = ''
  setTimeout(() => document.getElementById('event-title-input').focus(), 50)
}
window.closeAddEvent = function() { document.getElementById('event-modal').classList.remove('open') }

window.saveEvent = async function() {
  const title = document.getElementById('event-title-input').value.trim()
  const date = document.getElementById('event-date-input').value
  if (!title || !date) return
  const username = currentUser?.user_metadata?.username || currentUser?.email
  const { data, error } = await supabase.from('events').insert({
    title, event_date: date,
    event_time: document.getElementById('event-time-input').value || null,
    description: document.getElementById('event-desc-input').value.trim(),
    created_by: username
  }).select().single()
  if (!error && data) {
    calEvents.push(data); renderCalendar()
    window.closeAddEvent()
  }
}

window.deleteEvent = async function(id, cell, dot) {
  if (!confirm('Supprimer cet événement ?')) return
  await supabase.from('events').delete().eq('id', id)
  calEvents = calEvents.filter(e => e.id !== id)
  dot.remove()
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.closeAddEvent()
}, true)