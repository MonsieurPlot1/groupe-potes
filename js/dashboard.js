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

  const channel = supabase.channel('online-users')
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const onlineDiv = document.getElementById('online-users')
      onlineDiv.innerHTML = ''
      Object.values(state).forEach(presences => {
        presences.forEach(p => {
          const div = document.createElement('div')
          div.className = 'online-user'
          div.textContent = '🟢 ' + p.username
          onlineDiv.appendChild(div)
        })
      })
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ username })
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
  const { data } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100)

  const container = document.getElementById('chat-messages')
  container.innerHTML = ''
  data.forEach(msg => appendMessage(msg))
}

function buildReactions(msg) {
  const reactions = msg.reactions || {}
  if (!Object.keys(reactions).length) return '<div class="chat-reactions"></div>'
  const html = Object.entries(reactions).map(([emoji, users]) =>
    users.length ? `<span class="reaction-btn ${users.includes(chatUsername) ? 'active' : ''}" data-id="${msg.id}" data-emoji="${emoji}">${emoji} ${users.length}</span>` : ''
  ).join('')
  return `<div class="chat-reactions">${html}</div>`
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages')
  const isMine = msg.username === chatUsername
  const time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

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

  div.innerHTML = `
    ${replyHtml}
    <div class="msg-wrapper">
      <div class="msg-actions" id="actions-${msg.id}">
        <button onclick="startReply('${msg.id}', '${msg.content.replace(/'/g, "\\'")}', '${msg.username}')">↩️</button>
        <button onclick="showReactionPicker('${msg.id}')">😄</button>
        ${isMine ? `<button onclick="window.deleteMessage('${msg.id}')">🗑️</button>` : ''}
      </div>
      <div class="chat-bubble">${msg.content}</div>
    </div>
    ${buildReactions(msg)}
    <div class="chat-meta">${isMine ? '' : msg.username + ' · '}${time}</div>
  `
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
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
  if (name === 'chat' && !chatUsername) initChat()
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('reaction-btn')) {
    window.toggleReaction(e.target.dataset.id, e.target.dataset.emoji)
  }
})