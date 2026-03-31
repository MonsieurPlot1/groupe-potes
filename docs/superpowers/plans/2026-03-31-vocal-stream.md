# Vocal/Stream — Refonte perfs + UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Améliorer la fiabilité WebRTC (TURN, codec H264, reconnexion), l'UI des cartes vocales (volume individuel, états visuels), et ajouter PTT, chat éphémère et réactions emoji.

**Architecture:** Tout le code vocal est dans `js/dashboard.js` (lignes ~1141–1840) et `dashboard.html` (section `#section-vocal`). Pas de nouveau fichier — on modifie les existants. Signaling via Supabase Broadcast sur le channel `voice-room-v1`.

**Tech Stack:** Vanilla JS, HTML/CSS, WebRTC (RTCPeerConnection), Supabase Broadcast, Metered.ca TURN API (gratuit)

---

## Fichiers modifiés

| Fichier | Modifications |
|---------|--------------|
| `js/dashboard.js` | `VOICE_ICE` → async `getIceServers()`, `preferH264()`, AudioContext suspend/resume, auto-reconnect, `voiceBuildCard()` + `voiceRefreshCard()` (volume slider, états), PTT keydown/keyup, chat éphémère, réactions emoji |
| `dashboard.html` | Section `#section-vocal` : chat éphémère input, emoji picker, toggle PTT |
| `css/dashboard.css` | Styles : `.voice-user-card.reconnecting/failed`, volume slider, chat éphémère, emoji picker, animation `floatUp` |

---

## Prérequis manuel (à faire avant de coder)

- [ ] **Créer un compte Metered.ca** sur https://www.metered.ca/ (gratuit, pas de carte bancaire)
- [ ] Dans le dashboard Metered : créer une app, copier la `API_KEY` et le sous-domaine (ex: `groupepotes`)
- [ ] Garder la clé sous la main — elle sera inlinée dans `dashboard.js` à la tâche 2

---

## Task 1 : Async ICE servers (TURN Metered.ca)

**Fichiers :**
- Modifier : `js/dashboard.js:1141-1145` (constante `VOICE_ICE`)
- Modifier : `js/dashboard.js` (fonctions `joinVoice`, `voiceMakePeer`)

- [ ] **Étape 1 — Remplacer la constante par une variable + fallback**

Remplace les lignes 1141–1145 :
```js
// Avant :
const VOICE_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
]

// Après :
const VOICE_ICE_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]
let cachedIceServers = VOICE_ICE_FALLBACK

async function getIceServers() {
  try {
    const res = await fetch(
      'https://groupepotes.metered.live/api/v1/turn/credentials?apiKey=REMPLACER_PAR_TA_CLE'
    )
    if (!res.ok) throw new Error('TURN fetch failed')
    cachedIceServers = await res.json()
  } catch {
    cachedIceServers = VOICE_ICE_FALLBACK
  }
}
```

> **Note :** Remplace `groupepotes` par ton sous-domaine Metered et `REMPLACER_PAR_TA_CLE` par ta vraie clé.

- [ ] **Étape 2 — Appeler `getIceServers()` au début de `joinVoice()`**

Dans `joinVoice()` (ligne ~1224), ajoute **avant** le `getUserMedia` :
```js
window.joinVoice = async function () {
  if (voiceConnected || !currentUser) return
  const btn = document.getElementById('voice-join-btn')
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Connexion...' }
  await getIceServers()   // ← ajouter cette ligne
  // ... reste de la fonction inchangé
```

- [ ] **Étape 3 — Utiliser `cachedIceServers` dans `voiceMakePeer()`**

Ligne 1337, remplace `VOICE_ICE` par `cachedIceServers` :
```js
// Avant :
const pc = new RTCPeerConnection({ iceServers: VOICE_ICE })
// Après :
const pc = new RTCPeerConnection({ iceServers: cachedIceServers })
```

- [ ] **Étape 4 — Tester**

Ouvrir `dashboard.html` dans deux onglets (ou deux navigateurs). Rejoindre le vocal dans chacun. Vérifier dans la console (F12) qu'il n'y a pas d'erreur TURN. Les connexions doivent s'établir.

- [ ] **Étape 5 — Commit**
```bash
git add js/dashboard.js
git commit -m "fix: TURN Metered.ca — connexions fiables derrière NAT"
```

---

## Task 2 : Codec H264 hardware-first

**Fichiers :**
- Modifier : `js/dashboard.js` (fonctions `voiceCreateOffer`, `voiceHandleOffer`)

- [ ] **Étape 1 — Ajouter la fonction `preferH264(sdp)`**

Ajoute juste après la fonction `getIceServers()` (après le `}` qui la ferme) :
```js
function preferH264(sdp) {
  const lines = sdp.split('\r\n')
  const mIdx = lines.findIndex(l => l.startsWith('m=video'))
  if (mIdx === -1) return sdp
  const h264 = lines
    .filter(l => l.startsWith('a=rtpmap:') && l.toLowerCase().includes('h264'))
    .map(l => l.match(/a=rtpmap:(\d+)/)?.[1])
    .filter(Boolean)
  if (!h264.length) return sdp
  const parts = lines[mIdx].split(' ')
  const prefix = parts.slice(0, 3)
  const payloads = parts.slice(3)
  lines[mIdx] = [...prefix, ...h264, ...payloads.filter(p => !h264.includes(p))].join(' ')
  return lines.join('\r\n')
}
```

- [ ] **Étape 2 — Appliquer dans `voiceCreateOffer()`**

Ligne ~1373, avant `setLocalDescription` :
```js
async function voiceCreateOffer(remote) {
  const pc = voiceMakePeer(remote)
  const offer = await pc.createOffer()
  const preferredSdp = { ...offer, sdp: preferH264(offer.sdp) }
  await pc.setLocalDescription(preferredSdp)
  await vsend({ type: 'offer', from: voiceMe(), to: remote, sdp: pc.localDescription.toJSON() })
}
```

- [ ] **Étape 3 — Appliquer dans `voiceHandleOffer()`**

Ligne ~1383 :
```js
async function voiceHandleOffer(remote, sdp) {
  const pc = voiceMakePeer(remote)
  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  for (const c of (voiceIceQueue[remote] || [])) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  voiceIceQueue[remote] = []
  const answer = await pc.createAnswer()
  const preferredSdp = { ...answer, sdp: preferH264(answer.sdp) }
  await pc.setLocalDescription(preferredSdp)
  await vsend({ type: 'answer', from: voiceMe(), to: remote, sdp: pc.localDescription.toJSON() })
  voiceAddUser(remote, false)
  renderVoiceUI()
}
```

- [ ] **Étape 4 — Tester**

Dans la console après connexion, exécute :
```js
Object.values(voicePeers)[0]?.getStats().then(stats => stats.forEach(r => { if (r.type === 'codec') console.log(r) }))
```
Vérifie que `mimeType` inclut `H264` (pas VP8/VP9).

- [ ] **Étape 5 — Commit**
```bash
git add js/dashboard.js
git commit -m "perf: préférence codec H264 hardware pour le stream"
```

---

## Task 3 : AudioContext suspend/resume (visibilitychange)

**Fichiers :**
- Modifier : `js/dashboard.js` (~ligne 1482, listener `visibilitychange` existant)

- [ ] **Étape 1 — Renforcer le listener `visibilitychange` existant**

Remplace le listener existant (lignes 1482–1486) :
```js
// Avant :
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && voiceConnected) {
    voiceUsers.forEach(u => voiceRefreshCard(u.name))
  }
})

// Après :
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Suspend tous les AudioContexts actifs — libère CPU quand tab cachée (jeu)
    Object.values(voiceAudioCtxs).forEach(ctx => {
      if (ctx.state === 'running') ctx.suspend().catch(() => {})
    })
  } else {
    // Reprend au retour
    Object.values(voiceAudioCtxs).forEach(ctx => {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    })
    if (voiceConnected) voiceUsers.forEach(u => voiceRefreshCard(u.name))
  }
})
```

- [ ] **Étape 2 — Tester**

Rejoindre le vocal, switcher vers un autre onglet (ou alt-tab vers un jeu), vérifier que le CPU de l'onglet baisse. Revenir — les barres de niveau reprennent.

- [ ] **Étape 3 — Commit**
```bash
git add js/dashboard.js
git commit -m "perf: suspend AudioContext quand tab cachée"
```

---

## Task 4 : Auto-reconnexion avec backoff

**Fichiers :**
- Modifier : `js/dashboard.js` (variables globales, `voiceMakePeer`, `voiceRemovePeer`, `voiceAddUser`, `voiceBuildCard`, `voiceRefreshCard`)
- Modifier : `css/dashboard.css` (états `.reconnecting`, `.failed`)

- [ ] **Étape 1 — Ajouter les variables de suivi reconnexion**

Après la ligne `const voiceAnalyserTimers = {}` (ligne ~1442), ajoute :
```js
const voiceReconnectTimers = {}
const voiceReconnectAttempts = {}
```

- [ ] **Étape 2 — Ajouter la fonction `voiceScheduleReconnect()`**

Après `voiceRemovePeer` (après sa fermeture `}`), ajoute :
```js
function voiceScheduleReconnect(remote) {
  const attempt = voiceReconnectAttempts[remote] || 0
  if (attempt >= 3) {
    const u = voiceUsers.find(u => u.name === remote)
    if (u) { u.reconnecting = false; u.failed = true; voiceRefreshCard(remote) }
    return
  }
  voiceReconnectAttempts[remote] = attempt + 1
  const u = voiceUsers.find(u => u.name === remote)
  if (u) { u.reconnecting = true; u.failed = false; voiceRefreshCard(remote) }
  const delay = [1000, 2000, 4000][attempt]
  voiceReconnectTimers[remote] = setTimeout(async () => {
    delete voiceReconnectTimers[remote]
    const old = voicePeers[remote]
    if (old) { old.close(); delete voicePeers[remote] }
    delete voiceIceQueue[remote]
    await voiceCreateOffer(remote)
  }, delay)
}
```

- [ ] **Étape 3 — Modifier `onconnectionstatechange` dans `voiceMakePeer()`**

Remplace le bloc `pc.onconnectionstatechange` (lignes ~1361–1367) :
```js
pc.onconnectionstatechange = () => {
  if (pc.connectionState === 'connected') {
    applyAudioBitrate(pc)
    if (isStreaming) applyVideoBitrate(pc)
    delete voiceReconnectAttempts[remote]
    const u = voiceUsers.find(u => u.name === remote)
    if (u) { u.reconnecting = false; u.failed = false; voiceRefreshCard(remote) }
  }
  if (pc.connectionState === 'failed') {
    voiceScheduleReconnect(remote)
  }
  if (pc.connectionState === 'closed') {
    voiceRemovePeer(remote)
  }
}
```

- [ ] **Étape 4 — Ajouter les champs `reconnecting` et `failed` dans `voiceAddUser()`**

Ligne ~1510 :
```js
function voiceAddUser(name, muted) {
  if (!voiceUsers.find(u => u.name === name)) {
    voiceUsers.push({ name, muted, speaking: false, streaming: false, level: 0, reconnecting: false, failed: false })
  }
}
```

- [ ] **Étape 5 — Nettoyer les timers dans `leaveVoice()`**

Après `Object.values(voiceAnalyserTimers).forEach(t => clearInterval(t))` (ligne ~1273), ajoute :
```js
Object.values(voiceReconnectTimers).forEach(t => clearTimeout(t))
Object.keys(voiceReconnectTimers).forEach(k => delete voiceReconnectTimers[k])
Object.keys(voiceReconnectAttempts).forEach(k => delete voiceReconnectAttempts[k])
```

- [ ] **Étape 6 — Mettre à jour `voiceRefreshCard()` pour les nouveaux états**

Dans `voiceRefreshCard()`, mets à jour la classe de la carte (ligne ~1594) :
```js
function voiceRefreshCard(username) {
  const card = document.getElementById('voice-card-' + username)
  const user = voiceUsers.find(u => u.name === username)
  if (!card || !user) return
  card.className = [
    'voice-user-card',
    user.speaking && !user.muted ? 'speaking' : '',
    user.streaming ? 'live' : '',
    user.reconnecting ? 'reconnecting' : '',
    user.failed ? 'failed' : ''
  ].filter(Boolean).join(' ')
  // ... reste de la fonction inchangé (mic, bars, badge)
```

- [ ] **Étape 7 — Ajouter les CSS pour `.reconnecting` et `.failed`**

Dans `css/dashboard.css`, après `.voice-user-card.speaking { ... }` (après la ligne ~2310) :
```css
.voice-user-card.reconnecting {
  border-color: rgba(251,191,36,0.5);
  background: rgba(251,191,36,0.07);
}
.voice-user-card.failed {
  border-color: rgba(239,68,68,0.5);
  background: rgba(239,68,68,0.07);
}
body.light .voice-user-card.reconnecting { background: rgba(251,191,36,0.12); }
body.light .voice-user-card.failed { background: rgba(239,68,68,0.12); }
```

- [ ] **Étape 8 — Ajouter le texte de statut dans `voiceBuildCard()`**

Dans `voiceBuildCard()`, sous la création de `info` (après `info.appendChild(name)`), ajoute un sous-titre de statut :
```js
const statusTxt = document.createElement('span')
statusTxt.className = 'voice-status-txt'
statusTxt.id = 'voice-status-txt-' + user.name
statusTxt.textContent = user.reconnecting ? '⏳ Reconnexion…'
  : user.failed ? '❌ Connexion perdue'
  : user.muted ? 'muté'
  : user.streaming ? '🔴 live'
  : ''
info.appendChild(statusTxt)
```

Et dans `voiceRefreshCard()`, mettre à jour ce texte :
```js
const statusTxt = document.getElementById('voice-status-txt-' + username)
if (statusTxt) {
  statusTxt.textContent = user.reconnecting ? '⏳ Reconnexion…'
    : user.failed ? '❌ Connexion perdue'
    : user.muted ? 'muté'
    : user.streaming ? '🔴 live'
    : ''
}
```

- [ ] **Étape 9 — CSS pour `.voice-status-txt`**

Ajoute dans `css/dashboard.css` après `.voice-user-name { ... }` :
```css
.voice-status-txt {
  font-size: 0.72rem;
  color: var(--text-muted);
  min-height: 1em;
}
```

- [ ] **Étape 10 — Tester**

Dans la console, simule un `failed` :
```js
const pc = Object.values(voicePeers)[0]
// Vérifier que voiceScheduleReconnect existe
typeof voiceScheduleReconnect // "function"
```
Visuellement : la carte doit passer en jaune avec "⏳ Reconnexion…" quand l'état est `reconnecting`.

- [ ] **Étape 11 — Commit**
```bash
git add js/dashboard.js css/dashboard.css
git commit -m "feat: reconnexion automatique WebRTC avec backoff (3 essais)"
```

---

## Task 5 : Volume individuel par personne

**Fichiers :**
- Modifier : `js/dashboard.js` (`voiceBuildCard`, `voiceRefreshCard`, `voicePlayAudio`)
- Modifier : `css/dashboard.css` (styles slider volume)

- [ ] **Étape 1 — Ajouter la fonction `setVoiceVolume()`**

Ajoute après `voiceRefreshMuteBtn()` :
```js
window.setVoiceVolume = function(username, value) {
  localStorage.setItem('voice-vol-' + username, value)
  const vol = parseInt(value) / 100
  document.querySelectorAll('.v-remote-audio[data-user="' + username + '"]')
    .forEach(el => { el.volume = Math.min(Math.max(vol, 0), 1) })
}
```

- [ ] **Étape 2 — Appliquer le volume sauvegardé dans `voicePlayAudio()`**

À la fin de `voicePlayAudio()`, après `el.srcObject = stream` (ligne ~1430) :
```js
const savedVol = parseInt(localStorage.getItem('voice-vol-' + username) || '100') / 100
el.volume = Math.min(Math.max(savedVol, 0), 1)
```

- [ ] **Étape 3 — Ajouter le slider dans `voiceBuildCard()`**

Remplace le bloc `// Mic icon` à la fin de `voiceBuildCard()` par :
```js
// Volume control
const volWrap = document.createElement('div')
volWrap.className = 'vc-vol-wrap'
const volIcon = document.createElement('span')
volIcon.className = 'vc-vol-icon'
volIcon.textContent = user.muted ? '🔇' : '🔊'
volIcon.id = 'voice-mic-' + user.name  // réutilise le même id pour voiceRefreshCard
const volSlider = document.createElement('input')
volSlider.type = 'range'
volSlider.className = 'vc-vol-slider'
volSlider.min = '0'
volSlider.max = '100'
volSlider.value = localStorage.getItem('voice-vol-' + user.name) || '100'
volSlider.oninput = () => window.setVoiceVolume(user.name, volSlider.value)
// Cache le slider sur sa propre carte (on ne contrôle pas son propre volume)
if (user.name === voiceMe()) { volSlider.style.display = 'none' }
volWrap.appendChild(volIcon)
volWrap.appendChild(volSlider)
div.appendChild(volWrap)
return div
```

> **Note :** On garde `id = 'voice-mic-' + user.name` sur `volIcon` car `voiceRefreshCard()` l'utilise pour mettre à jour l'icône micro.

- [ ] **Étape 4 — CSS pour le volume**

Dans `css/dashboard.css`, ajoute après `.voice-user-mic { ... }` :
```css
.vc-vol-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.vc-vol-icon {
  font-size: 0.95rem;
  opacity: 0.7;
  flex-shrink: 0;
}
.vc-vol-slider {
  width: 58px;
  height: 4px;
  cursor: pointer;
  accent-color: var(--accent-2);
  opacity: 0.7;
  transition: opacity 0.15s;
}
.vc-vol-slider:hover { opacity: 1; }
/* Mobile : slider plus grand pour le touch */
@media (max-width: 600px) {
  .vc-vol-slider { width: 44px; }
}
```

- [ ] **Étape 5 — Tester**

Avec deux onglets connectés en vocal. Dans le premier, bouger le slider d'un peer → le volume de l'audio de cette personne change. Recharger la page → le slider retrouve la valeur sauvegardée.

- [ ] **Étape 6 — Commit**
```bash
git add js/dashboard.js css/dashboard.css
git commit -m "feat: volume individuel par personne dans le vocal"
```

---

## Task 6 : Push-to-talk (PTT)

**Fichiers :**
- Modifier : `dashboard.html` (section `#voice-controls`)
- Modifier : `js/dashboard.js` (variable PTT, keydown/keyup, joinVoice, leaveVoice, renderVoiceUI)
- Modifier : `css/dashboard.css`

- [ ] **Étape 1 — Ajouter le toggle PTT dans le HTML**

Dans `dashboard.html`, après le `</div>` de `voice-controls` (ligne ~378) et avant `stream-quality-row`, ajoute :
```html
<div class="voice-ptt-row" id="voice-ptt-row" style="display:none">
  <label class="ptt-label">
    <input type="checkbox" id="voice-ptt-toggle" onchange="window.onPTTToggle(this.checked)">
    <span>Push-to-talk</span>
  </label>
  <span class="ptt-key-hint" id="ptt-key-hint" style="display:none">Maintenir <kbd>Espace</kbd> ou <kbd>T</kbd></span>
</div>
```

- [ ] **Étape 2 — Ajouter la variable `voicePTT` et la fonction `onPTTToggle()`**

Après `let voiceMuted = false` (ligne ~1148), ajoute :
```js
let voicePTT = false
```

Après `window.toggleVoiceMute` (après sa fermeture `}`), ajoute :
```js
window.onPTTToggle = function(on) {
  voicePTT = on
  localStorage.setItem('voice-ptt', on ? '1' : '0')
  const hint = document.getElementById('ptt-key-hint')
  if (hint) hint.style.display = on ? '' : 'none'
  if (on && voiceConnected && !voiceMuted) {
    // Mute immédiatement quand on active PTT
    voiceMuted = true
    localStream?.getAudioTracks().forEach(t => { t.enabled = false })
    const u = voiceUsers.find(u => u.name === voiceMe())
    if (u) { u.muted = true; u.speaking = false; voiceRefreshCard(voiceMe()) }
    vsend({ type: 'mute', from: voiceMe(), muted: true })
    voiceRefreshMuteBtn()
  }
}
```

- [ ] **Étape 3 — Ajouter les listeners keydown/keyup pour PTT**

Le listener `keydown` existant (ligne ~1489) gère déjà `M`. Ajoute un deuxième listener juste après :
```js
document.addEventListener('keydown', e => {
  if (!voiceConnected || !voicePTT) return
  if (e.key !== ' ' && e.key !== 't' && e.key !== 'T') return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
  if (e.repeat) return
  if (e.key === ' ') e.preventDefault()
  localStream?.getAudioTracks().forEach(t => { t.enabled = true })
  voiceMuted = false
  const u = voiceUsers.find(u => u.name === voiceMe())
  if (u) { u.muted = false; voiceRefreshCard(voiceMe()) }
  vsend({ type: 'mute', from: voiceMe(), muted: false })
  voiceRefreshMuteBtn()
  renderVoiceBar()
})

document.addEventListener('keyup', e => {
  if (!voiceConnected || !voicePTT) return
  if (e.key !== ' ' && e.key !== 't' && e.key !== 'T') return
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
  localStream?.getAudioTracks().forEach(t => { t.enabled = false })
  voiceMuted = true
  const u = voiceUsers.find(u => u.name === voiceMe())
  if (u) { u.muted = true; u.speaking = false; voiceRefreshCard(voiceMe()) }
  vsend({ type: 'mute', from: voiceMe(), muted: true })
  voiceRefreshMuteBtn()
  renderVoiceBar()
})
```

- [ ] **Étape 4 — Restaurer l'état PTT dans `joinVoice()`**

Dans `joinVoice()`, après `await getIceServers()`, ajoute :
```js
voicePTT = localStorage.getItem('voice-ptt') === '1'
const pttToggle = document.getElementById('voice-ptt-toggle')
if (pttToggle) pttToggle.checked = voicePTT
const pttHint = document.getElementById('ptt-key-hint')
if (pttHint) pttHint.style.display = voicePTT ? '' : 'none'
if (voicePTT) {
  voiceMuted = true
  // Le track sera muté après getUserMedia — fait dans le bloc try/catch existant juste après
}
```

Puis, après `localStream = await navigator.mediaDevices.getUserMedia(...)` (succès), ajoute :
```js
if (voicePTT) localStream.getAudioTracks().forEach(t => { t.enabled = false })
```

- [ ] **Étape 5 — Reset PTT dans `leaveVoice()`**

Après `voiceMuted = false` dans `leaveVoice()` :
```js
voicePTT = false
const pttToggle = document.getElementById('voice-ptt-toggle')
if (pttToggle) pttToggle.checked = false
const pttHint = document.getElementById('ptt-key-hint')
if (pttHint) pttHint.style.display = 'none'
```

- [ ] **Étape 6 — Afficher/cacher `voice-ptt-row` dans `renderVoiceUI()`**

Dans `renderVoiceUI()`, ajoute avec les autres `style.display` :
```js
const pttRow = document.getElementById('voice-ptt-row')
if (pttRow) pttRow.style.display = voiceConnected ? '' : 'none'
```

- [ ] **Étape 7 — CSS PTT row**

Dans `css/dashboard.css` :
```css
.voice-ptt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  flex-wrap: wrap;
}
.ptt-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.88rem;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.ptt-label input { cursor: pointer; accent-color: var(--accent-2); }
.ptt-key-hint {
  font-size: 0.8rem;
  color: var(--accent);
}
.ptt-key-hint kbd {
  background: var(--g2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.78rem;
}
```

- [ ] **Étape 8 — Tester**

Rejoindre le vocal, cocher "Push-to-talk". Le micro doit se muter immédiatement. Maintenir Espace → micro actif. Relâcher → mute. Vérifier dans l'autre onglet que le statut muted/speaking change en temps réel.

- [ ] **Étape 9 — Commit**
```bash
git add dashboard.html js/dashboard.js css/dashboard.css
git commit -m "feat: push-to-talk vocal (Espace / T)"
```

---

## Task 7 : Chat éphémère pendant le vocal

**Fichiers :**
- Modifier : `dashboard.html` (section `#section-vocal`)
- Modifier : `js/dashboard.js` (`voiceHandleSignal`, `renderVoiceUI`, nouvelles fonctions)
- Modifier : `css/dashboard.css`

- [ ] **Étape 1 — Ajouter le HTML du chat éphémère**

Dans `dashboard.html`, après `</div>` de `voice-ptt-row` (juste avant `</div>` qui ferme `voice-room`), ajoute :
```html
<div class="voice-chat-area" id="voice-chat-area" style="display:none">
  <div class="voice-chat-feed" id="voice-chat-feed"></div>
  <div class="voice-chat-bar">
    <input
      type="text"
      id="voice-chat-input"
      class="voice-chat-input"
      placeholder="Message rapide..."
      maxlength="100"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.sendVoiceChat()}"
    >
    <button class="voice-chat-send-btn" onclick="window.sendVoiceChat()">↵</button>
  </div>
</div>
```

- [ ] **Étape 2 — Ajouter les fonctions chat dans `dashboard.js`**

Après `renderVoiceBar()` (après sa fermeture `}`), ajoute :
```js
window.sendVoiceChat = async function() {
  if (!voiceConnected) return
  const input = document.getElementById('voice-chat-input')
  const text = input?.value.trim()
  if (!text) return
  input.value = ''
  const msg = { from: voiceMe(), text }
  displayVoiceChatMsg(msg)
  await vsend({ type: 'vc', from: msg.from, text: msg.text })
}

function displayVoiceChatMsg({ from, text }) {
  const feed = document.getElementById('voice-chat-feed')
  if (!feed) return
  const el = document.createElement('div')
  el.className = 'vchat-msg' + (from === voiceMe() ? ' mine' : '')
  el.innerHTML = '<span class="vchat-from">' + escapeHtml(from) + '</span> '
    + '<span class="vchat-text">' + escapeHtml(text) + '</span>'
  feed.appendChild(el)
  while (feed.children.length > 5) feed.firstChild.remove()
  setTimeout(() => el.classList.add('vchat-fade'), 7000)
  setTimeout(() => { if (el.parentNode) el.remove() }, 8200)
}
```

- [ ] **Étape 3 — Brancher dans `voiceHandleSignal()`**

Dans le `switch` de `voiceHandleSignal()`, ajoute deux cases avant le `}` final :
```js
case 'vc':
  displayVoiceChatMsg({ from: p.from, text: p.text })
  break
```

- [ ] **Étape 4 — Afficher/cacher `voice-chat-area` dans `renderVoiceUI()`**

```js
const chatArea = document.getElementById('voice-chat-area')
if (chatArea) chatArea.style.display = voiceConnected ? '' : 'none'
```

- [ ] **Étape 5 — CSS chat éphémère**

```css
.voice-chat-area {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.voice-chat-feed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
}
.vchat-msg {
  font-size: 0.82rem;
  color: var(--text);
  background: var(--g1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 5px 10px;
  animation: fadeInUp 0.2s ease-out both;
  transition: opacity 0.8s, transform 0.8s;
  align-self: flex-start;
  max-width: 90%;
}
.vchat-msg.mine {
  align-self: flex-end;
  background: rgba(124,58,237,0.15);
  border-color: rgba(124,58,237,0.3);
}
.vchat-msg.vchat-fade {
  opacity: 0;
  transform: translateY(-6px);
}
.vchat-from {
  font-weight: 600;
  color: var(--accent);
  margin-right: 4px;
}
.vchat-text { color: var(--text); }
.voice-chat-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}
.voice-chat-input {
  flex: 1;
  background: var(--g1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 7px 12px;
  font-size: 0.85rem;
  color: var(--text);
  outline: none;
  transition: border-color 0.15s;
}
.voice-chat-input:focus { border-color: var(--border-hi); }
.voice-chat-input::placeholder { color: var(--text-muted); }
.voice-chat-send-btn {
  background: var(--g2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 7px 12px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s;
}
.voice-chat-send-btn:hover { background: var(--g3); }
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Étape 6 — Tester**

Deux onglets en vocal. Taper un message dans le premier → apparaît dans les deux. Attendre 8s → disparaît. Envoyer 6 messages rapidement → seuls les 5 derniers sont visibles.

- [ ] **Étape 7 — Commit**
```bash
git add dashboard.html js/dashboard.js css/dashboard.css
git commit -m "feat: chat éphémère pendant le vocal"
```

---

## Task 8 : Réactions emoji

**Fichiers :**
- Modifier : `dashboard.html` (ajouter le picker à côté du chat input)
- Modifier : `js/dashboard.js` (`voiceHandleSignal`, nouvelles fonctions, `voiceBuildCard`)
- Modifier : `css/dashboard.css`

- [ ] **Étape 1 — Ajouter le picker emoji dans le HTML**

Dans `dashboard.html`, dans `.voice-chat-bar` (après le `.voice-chat-send-btn`), ajoute :
```html
<div class="voice-emoji-wrap">
  <button class="voice-emoji-btn" onclick="window.toggleVoiceEmojiPicker(event)" title="Réactions">✨</button>
  <div class="voice-emoji-picker" id="voice-emoji-picker" style="display:none">
    <span onclick="window.sendVoiceEmoji('👍')">👍</span>
    <span onclick="window.sendVoiceEmoji('😂')">😂</span>
    <span onclick="window.sendVoiceEmoji('🔥')">🔥</span>
    <span onclick="window.sendVoiceEmoji('💀')">💀</span>
    <span onclick="window.sendVoiceEmoji('😮')">😮</span>
  </div>
</div>
```

- [ ] **Étape 2 — Ajouter `vc-emoji-float` dans `voiceBuildCard()`**

À la fin de `voiceBuildCard()`, avant `return div` :
```js
const emojiFloat = document.createElement('div')
emojiFloat.className = 'vc-emoji-float'
emojiFloat.id = 'vc-emoji-' + user.name
div.appendChild(emojiFloat)
```

- [ ] **Étape 3 — Ajouter les fonctions emoji dans `dashboard.js`**

Après `window.sendVoiceChat` / `displayVoiceChatMsg`, ajoute :
```js
window.sendVoiceEmoji = async function(emoji) {
  if (!voiceConnected) return
  const picker = document.getElementById('voice-emoji-picker')
  if (picker) picker.style.display = 'none'
  displayVoiceEmoji(voiceMe(), emoji)
  await vsend({ type: 've', from: voiceMe(), emoji })
}

function displayVoiceEmoji(from, emoji) {
  const el = document.getElementById('vc-emoji-' + from)
  if (!el) return
  el.textContent = emoji
  el.className = 'vc-emoji-float vc-emoji-anim'
  setTimeout(() => {
    el.className = 'vc-emoji-float'
    el.textContent = ''
  }, 2000)
}

window.toggleVoiceEmojiPicker = function(e) {
  e.stopPropagation()
  const picker = document.getElementById('voice-emoji-picker')
  if (!picker) return
  picker.style.display = picker.style.display === 'none' ? 'flex' : 'none'
}

// Ferme le picker si on clique ailleurs
document.addEventListener('click', () => {
  const picker = document.getElementById('voice-emoji-picker')
  if (picker) picker.style.display = 'none'
})
```

- [ ] **Étape 4 — Brancher dans `voiceHandleSignal()`**

Dans le `switch`, ajoute après le case `'vc'` :
```js
case 've':
  displayVoiceEmoji(p.from, p.emoji)
  break
```

- [ ] **Étape 5 — CSS emoji**

```css
.voice-emoji-wrap {
  position: relative;
  flex-shrink: 0;
}
.voice-emoji-btn {
  background: var(--g2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.15s;
}
.voice-emoji-btn:hover { background: var(--g3); }
.voice-emoji-picker {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  display: flex;
  gap: 6px;
  background: var(--g3);
  border: 1px solid var(--border-hi);
  border-radius: 12px;
  padding: 8px 10px;
  box-shadow: var(--sh-md);
  z-index: 100;
}
.voice-emoji-picker span {
  font-size: 1.4rem;
  cursor: pointer;
  transition: transform 0.1s;
  line-height: 1;
}
.voice-emoji-picker span:hover { transform: scale(1.3); }

/* Float animation sur la carte */
.vc-emoji-float {
  position: absolute;
  top: -4px;
  right: 10px;
  font-size: 1.6rem;
  pointer-events: none;
  line-height: 1;
}
.vc-emoji-anim {
  animation: floatUp 2s ease-out forwards;
}
@keyframes floatUp {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  60%  { opacity: 1; }
  100% { opacity: 0; transform: translateY(-36px) scale(1.5); }
}
```

- [ ] **Étape 6 — Tester**

Deux onglets en vocal. Cliquer ✨ → picker s'ouvre. Cliquer 👍 → emoji flotte au-dessus de ta propre carte + apparaît sur la carte dans l'autre onglet.

- [ ] **Étape 7 — Commit**
```bash
git add dashboard.html js/dashboard.js css/dashboard.css
git commit -m "feat: réactions emoji temps réel dans le vocal"
```

---

## Checklist finale

Après toutes les tâches, vérifier :

- [ ] Connexion TURN établie (pas d'erreur console `ICE failed`)
- [ ] Stream moins gourmand CPU (surveiller via Task Manager)
- [ ] Tab cachée → CPU réduit, retour → barres reprennent
- [ ] Déconnexion simulée → carte jaune, retente automatiquement
- [ ] Slider volume change le son du peer
- [ ] PTT mute/unmute avec Espace/T
- [ ] Chat éphémère s'auto-efface après 8s, max 5 messages
- [ ] Emoji flotte sur la carte, visible dans l'autre onglet
- [ ] Mode light : vérifier les nouvelles couleurs CSS `.reconnecting`, `.failed`

```bash
git log --oneline -10
```
