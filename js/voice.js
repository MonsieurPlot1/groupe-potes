import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://htsxdzlcmobmpevzhshh.supabase.co'
const SUPABASE_KEY = 'sb_publishable_V_w52NPbhRA69cOPbbIwIg_CnfS_22A'
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
]

/* ─── State ──────────────────────────────────────────────── */
let voiceConnected = false
let voiceMuted = false
let localStream = null
let voiceSignalChannel = null
let currentVoiceUser = null

const peers = {}       // { username: RTCPeerConnection }
const iceQueue = {}    // { username: RTCIceCandidateInit[] }  — buffered before remoteDesc
let voiceUsers = []    // [{ name, muted, speaking, streaming }]

// Screen share
let screenStream = null
let isStreaming = false
let currentStreamUser = null   // who's currently streaming (their name)
const screenSenders = {}       // { username: RTCRtpSender } — to remove later

/* ─── Helpers ────────────────────────────────────────────── */
function me() { return currentVoiceUser }

function renderAvatar(username) {
  // Fallback avatar circle matching the app style
  const div = document.createElement('div')
  div.className = 'voice-avatar'
  div.textContent = username.charAt(0).toUpperCase()
  div.style.cssText = 'display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:var(--accent-2);color:#fff;font-weight:700;font-size:1.1rem;flex-shrink:0'
  return div
}

function showToast(msg, err = false) {
  // Reuse param-toast if available
  const t = document.getElementById('param-toast')
  if (!t) return
  t.textContent = msg
  t.className = 'param-toast' + (err ? ' param-toast--error' : '') + ' visible'
  clearTimeout(t._t)
  t._t = setTimeout(() => t.classList.remove('visible'), 3400)
}

async function vsend(payload) {
  if (!voiceSignalChannel) return
  await voiceSignalChannel.send({ type: 'broadcast', event: 'vs', payload })
}

/* ─── Join ───────────────────────────────────────────────── */
window.joinVoice = async function () {
  if (voiceConnected) return

  const { data: { session } } = await sb.auth.getSession()
  if (!session) return
  currentVoiceUser = session.user.user_metadata?.username || session.user.email

  const savedMic = localStorage.getItem('selected-mic')
  const audioConstraint = savedMic ? { deviceId: { ideal: savedMic } } : true
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false })
  } catch {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      showToast('Microphone introuvable ou refusé 🎤', true)
      return
    }
  }
  // Refresh mic list now that permission is granted
  window.loadMicList()

  voiceConnected = true
  addVoiceUser(me(), false)

  voiceSignalChannel = sb.channel('voice-room-v1')
  voiceSignalChannel
    .on('broadcast', { event: 'vs' }, ({ payload }) => handleSignal(payload))
    .subscribe(async status => {
      if (status !== 'SUBSCRIBED') return
      await vsend({ type: 'join', from: me() })
      setupLocalAnalyser()
      renderVoiceUI()
      renderVoiceBar()
    })
}

/* ─── Leave ──────────────────────────────────────────────── */
window.leaveVoice = async function () {
  if (!voiceConnected) return
  if (isStreaming) await stopStream(true) // silent stop (leave handles the signal)
  if (voiceSignalChannel) {
    await vsend({ type: 'leave', from: me() })
    await sb.removeChannel(voiceSignalChannel)
    voiceSignalChannel = null
  }
  Object.values(peers).forEach(pc => pc.close())
  for (const k in peers) delete peers[k]
  for (const k in iceQueue) delete iceQueue[k]
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null }
  document.querySelectorAll('.v-remote-audio').forEach(el => el.remove())
  voiceConnected = false
  voiceMuted = false
  voiceUsers = []
  renderVoiceUI()
  renderVoiceBar()
}

/* ─── Signal handler ─────────────────────────────────────── */
async function handleSignal(p) {
  if (!p || p.from === me()) return

  switch (p.type) {
    case 'join':
      await createOfferFor(p.from)
      addVoiceUser(p.from, false)
      renderVoiceUI()
      break
    case 'offer':
      if (p.to === me()) await handleOffer(p.from, p.sdp)
      break
    case 'answer':
      if (p.to === me()) await handleAnswer(p.from, p.sdp)
      break
    case 'ice':
      if (p.to === me()) await handleIce(p.from, p.candidate)
      break
    case 'leave':
      removePeer(p.from)
      break
    case 'mute': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.muted = p.muted; refreshUserCard(p.from) }
      break
    }
    case 'stream-start': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.streaming = true; refreshUserCard(p.from) }
      currentStreamUser = p.from
      break
    }
    case 'stream-stop': {
      const u = voiceUsers.find(u => u.name === p.from)
      if (u) { u.streaming = false; refreshUserCard(p.from) }
      if (currentStreamUser === p.from) hideStreamView()
      break
    }
  }
}

/* ─── Peer connection factory ────────────────────────────── */
function makePeer(remote) {
  if (peers[remote]) return peers[remote]
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  peers[remote] = pc
  iceQueue[remote] = []

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream))

  pc.onicecandidate = async e => {
    if (e.candidate) await vsend({ type: 'ice', from: me(), to: remote, candidate: e.candidate.toJSON() })
  }

  pc.ontrack = e => {
    const stream = e.streams[0] || new MediaStream([e.track])
    if (e.track.kind === 'video') {
      showStreamView(remote, stream)
    } else {
      playRemoteAudio(remote, stream)
      addVoiceUser(remote, false)
      renderVoiceUI()
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(remote)
  }

  return pc
}

async function createOfferFor(remote) {
  const pc = makePeer(remote)
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await vsend({ type: 'offer', from: me(), to: remote, sdp: pc.localDescription.toJSON() })
}

async function handleOffer(remote, sdp) {
  const pc = makePeer(remote)
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  for (const c of (iceQueue[remote] || [])) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }
  iceQueue[remote] = []
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await vsend({ type: 'answer', from: me(), to: remote, sdp: pc.localDescription.toJSON() })
  addVoiceUser(remote, false)
  renderVoiceUI()
}

async function handleAnswer(remote, sdp) {
  const pc = peers[remote]
  if (!pc) return
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  for (const c of (iceQueue[remote] || [])) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }
  iceQueue[remote] = []
  addVoiceUser(remote, false)
  renderVoiceUI()
}

async function handleIce(remote, candidate) {
  const pc = peers[remote]
  if (!pc || !pc.remoteDescription) {
    ;(iceQueue[remote] = iceQueue[remote] || []).push(candidate)
    return
  }
  await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
}

function removePeer(remote) {
  const pc = peers[remote]
  if (pc) { pc.close(); delete peers[remote] }
  delete iceQueue[remote]
  delete screenSenders[remote]
  document.getElementById('v-audio-' + remote)?.remove()
  if (currentStreamUser === remote) hideStreamView()
  voiceUsers = voiceUsers.filter(u => u.name !== remote)
  renderVoiceUI()
}

/* ─── Audio ──────────────────────────────────────────────── */
function playRemoteAudio(username, stream) {
  let el = document.getElementById('v-audio-' + username)
  if (!el) {
    el = document.createElement('audio')
    el.id = 'v-audio-' + username
    el.className = 'v-remote-audio'
    el.autoplay = true
    el.style.display = 'none'
    document.body.appendChild(el)
  }
  el.srcObject = stream
  watchLevel(username, stream)
}

/* ─── Speaking detection ─────────────────────────────────── */
function setupLocalAnalyser() {
  if (!localStream) return
  watchLevel(me(), localStream)
}

function watchLevel(username, stream) {
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
        if (u) { u.speaking = now; refreshUserCard(username) }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  } catch {}
}

/* ─── Mute ───────────────────────────────────────────────── */
window.toggleVoiceMute = function () {
  if (!voiceConnected || !localStream) return
  voiceMuted = !voiceMuted
  localStream.getAudioTracks().forEach(t => { t.enabled = !voiceMuted })
  const u = voiceUsers.find(u => u.name === me())
  if (u) { u.muted = voiceMuted; u.speaking = false; refreshUserCard(me()) }
  vsend({ type: 'mute', from: me(), muted: voiceMuted })
  refreshMuteBtn()
  renderVoiceBar()
}

/* ─── UI ─────────────────────────────────────────────────── */
function addVoiceUser(name, muted) {
  if (!voiceUsers.find(u => u.name === name)) voiceUsers.push({ name, muted, speaking: false })
}

function renderVoiceUI() {
  const list = document.getElementById('voice-users-list')
  const joinBtn = document.getElementById('voice-join-btn')
  const controls = document.getElementById('voice-controls')
  const emptyMsg = document.getElementById('voice-empty-msg')
  const countEl = document.getElementById('voice-count')
  if (!list) return

  list.innerHTML = ''
  voiceUsers.forEach(u => list.appendChild(buildUserCard(u)))

  if (joinBtn) joinBtn.style.display = voiceConnected ? 'none' : ''
  if (controls) controls.style.display = voiceConnected ? 'flex' : 'none'
  if (emptyMsg) emptyMsg.style.display = voiceUsers.length ? 'none' : ''
  if (countEl) countEl.textContent = voiceUsers.length
    ? voiceUsers.length + ' connecté' + (voiceUsers.length > 1 ? 's' : '')
    : 'Personne pour l\'instant'

  refreshMuteBtn()
}

function buildUserCard(user) {
  const div = document.createElement('div')
  div.id = 'voice-card-' + user.name
  div.className = 'voice-user-card' + (user.speaking && !user.muted ? ' speaking' : '') + (user.streaming ? ' live' : '')
  div.appendChild(renderAvatar(user.name))
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

function refreshUserCard(username) {
  const card = document.getElementById('voice-card-' + username)
  const user = voiceUsers.find(u => u.name === username)
  if (!card || !user) return
  card.className = 'voice-user-card' + (user.speaking && !user.muted ? ' speaking' : '') + (user.streaming ? ' live' : '')
  const mic = document.getElementById('voice-mic-' + username)
  if (mic) mic.textContent = user.muted ? '🔇' : '🎤'
  // Add/remove live badge
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

function refreshMuteBtn() {
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

/* ─── Screen share ───────────────────────────────────────── */
window.toggleStream = async function () {
  if (isStreaming) await stopStream() else await startStream()
}

async function startStream() {
  if (!voiceConnected) return
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false })
  } catch {
    return // user cancelled the picker
  }

  isStreaming = true
  const track = screenStream.getVideoTracks()[0]

  // Add to every existing peer connection and renegotiate manually
  for (const [remote, pc] of Object.entries(peers)) {
    screenSenders[remote] = pc.addTrack(track, screenStream)
    try {
      if (pc.signalingState === 'stable') {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await vsend({ type: 'offer', from: me(), to: remote, sdp: pc.localDescription.toJSON() })
      }
    } catch {}
  }

  // User stops sharing from the browser's native stop button
  track.onended = () => stopStream()

  await vsend({ type: 'stream-start', from: me() })

  const u = voiceUsers.find(u => u.name === me())
  if (u) { u.streaming = true; refreshUserCard(me()) }
  currentStreamUser = me()
  showLocalStreamPreview()
  updateStreamBtn()
}

async function stopStream(silent = false) {
  if (!isStreaming) return
  isStreaming = false

  for (const k in screenSenders) delete screenSenders[k]

  if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null }

  if (!silent) await vsend({ type: 'stream-stop', from: me() })

  const u = voiceUsers.find(u => u.name === me())
  if (u) { u.streaming = false; refreshUserCard(me()) }
  if (currentStreamUser === me()) hideStreamView()
  updateStreamBtn()
}

function showLocalStreamPreview() {
  const video = document.getElementById('stream-video')
  const nameEl = document.getElementById('stream-viewer-name')
  const viewer = document.getElementById('stream-viewer')
  if (!video || !viewer || !screenStream) return
  video.srcObject = screenStream
  if (nameEl) nameEl.textContent = me()
  viewer.style.display = ''
}

function showStreamView(username, stream) {
  const video = document.getElementById('stream-video')
  const nameEl = document.getElementById('stream-viewer-name')
  const viewer = document.getElementById('stream-viewer')
  if (!video || !viewer) return
  video.srcObject = stream
  if (nameEl) nameEl.textContent = username
  viewer.style.display = ''
  currentStreamUser = username
  const u = voiceUsers.find(u => u.name === username)
  if (u) { u.streaming = true; refreshUserCard(username) }
}

function hideStreamView() {
  const viewer = document.getElementById('stream-viewer')
  const video = document.getElementById('stream-video')
  if (viewer) viewer.style.display = 'none'
  if (video) { video.srcObject = null }
  currentStreamUser = null
}

window.toggleStreamFullscreen = function () {
  const video = document.getElementById('stream-video')
  if (!video) return
  if (!document.fullscreenElement) {
    video.requestFullscreen?.() || video.webkitRequestFullscreen?.()
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.()
  }
}

function updateStreamBtn() {
  const btn = document.getElementById('stream-btn')
  if (!btn) return
  btn.className = 'voice-ctrl-btn' + (isStreaming ? ' streaming' : '')
  btn.innerHTML = isStreaming
    ? '<span class="vcb-icon">⏹️</span><span class="vcb-label">Stop</span>'
    : '<span class="vcb-icon">🖥️</span><span class="vcb-label">Stream</span>'
}

/* ─── Mic selector ───────────────────────────────────────── */
window.loadMicList = async function (requestPermission = false) {
  const select = document.getElementById('mic-select')
  const sublabel = document.getElementById('mic-sublabel')
  const detectRow = document.getElementById('mic-detect-row')
  if (!select) return

  // If we need permission first, request a short stream then stop it
  if (requestPermission) {
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
      tmp.getTracks().forEach(t => t.stop())
    } catch {
      showToast('Permission micro refusée 🎤', true)
      return
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  const inputs = devices.filter(d => d.kind === 'audioinput')
  const hasLabels = inputs.some(d => d.label)
  const saved = localStorage.getItem('selected-mic') || ''

  // Rebuild options
  select.innerHTML = '<option value="">Par défaut</option>'
  inputs.forEach((d, i) => {
    const opt = document.createElement('option')
    opt.value = d.deviceId
    opt.textContent = d.label || ('Micro ' + (i + 1))
    opt.selected = d.deviceId === saved
    select.appendChild(opt)
  })

  if (sublabel) {
    sublabel.textContent = inputs.length > 1
      ? inputs.length + ' micros détectés'
      : 'Micro système par défaut'
  }
  if (detectRow) detectRow.style.display = hasLabels || inputs.length <= 1 ? 'none' : ''
}

window.saveMicChoice = function (deviceId) {
  localStorage.setItem('selected-mic', deviceId)
}

// Refresh mic list each time params section opens
const _origShowSection = window.showSection
if (_origShowSection) {
  window.showSection = function (name) {
    _origShowSection(name)
    if (name === 'params') window.loadMicList()
  }
}

// Initial load (silent, no permission request)
window.loadMicList()
