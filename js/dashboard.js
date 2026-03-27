import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://htsxdzlcmobmpevzhshh.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V_w52NPbhRA69cOPbbIwIg_CnfS_22A'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

let currentUser = null
let currentPote = null

async function init() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { window.location.href = 'index.html'; return }
  currentUser = session.user
  const username = currentUser.user_metadata?.username || currentUser.email
  document.getElementById('user-info').textContent = '👤 ' + username
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
        div.innerHTML = `
          <div class="online-avatar">${u.charAt(0).toUpperCase()}</div>
          <span>${u}</span>
          <div class="online-dot" style="margin-left:auto"></div>
        `
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
    div.innerHTML = `
      <div class="home-message-avatar">${msg.username.charAt(0).toUpperCase()}</div>
      <div class="home-message-content">
        <div class="home-message-header">
          <span class="home-message-username">${msg.username}</span>
          <span class="home-message-time">${time}</span>
        </div>
        <div class="home-message-text">${msg.content}</div>
      </div>
    `
    container.appendChild(div)
  })
}

window.showSection = function(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'))
  document.getElementById('section-' + name).classList.add('active')
  event.target.classList.add('active')
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
    const { error } = await supabase.storage.from('photos').upload(fileName, file)
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

window.toggleTheme = function() {
  document.body.classList.toggle('light')
  const btn = document.getElementById('theme-btn')
  btn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️'
  localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark')
}

if (localStorage.getItem('theme') === 'light') {
  document.body.classList.add('light')
  document.getElementById('theme-btn').textContent = '🌙'
}

// Chat
let chatUsername = null
let replyingTo = null
let typingTimeout = null
let typingChannel = null
let lastMessageDate = null
let unreadCount = 0
let chatOpen = false
let chatInitialized = false

function updateBadge() {
  const badge = document.getElementById('chat-badge')
  if (!badge) return
  if (unreadCount > 0) {
    badge.style.display = 'inline-flex'
    badge.textContent = unreadCount > 9 ? '9+' : unreadCount
  } else {
    badge.style.display = 'none'
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
        el.textContent = payload.username + ' est en train d\'écrire...'
        el.style.opacity = '1'
        clearTimeout(el._timeout)
        el._timeout = setTimeout(() => el.style.opacity = '0', 2000)
      }
    })
    .subscribe()
}

async function loadMessages() {
  chatInitialized = false
  lastMessageDate = null
  const { data } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100)

  const container = document.getElementById('chat-messages')
  container.innerHTML = ''
  data.forEach(msg => appendMessage(msg))
  chatInitialized = true
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
  const { error } = await supabase.storage.from('photos').upload(fileName, file)
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
  document.getElementById('msg-' + id).appendChild(picker)

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
  const { data } = await supabase.from('messages').select('reactions').eq('id', id).single()
  const reactions = data.reactions || {}
  if (!reactions[emoji]) reactions[emoji] = []
  const idx = reactions[emoji].indexOf(chatUsername)
  if (idx > -1) reactions[emoji].splice(idx, 1)
  else reactions[emoji].push(chatUsername)
  await supabase.from('messages').update({ reactions }).eq('id', id)
  document.getElementById('picker-' + id)?.remove()
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
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('reaction-btn')) {
    window.toggleReaction(e.target.dataset.id, e.target.dataset.emoji)
  }
})