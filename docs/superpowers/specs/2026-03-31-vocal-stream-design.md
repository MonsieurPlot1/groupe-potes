# Vocal/Stream — Refonte perfs + UX

**Date :** 2026-03-31
**Statut :** Validé
**Périmètre :** `js/dashboard.js` (section vocal, ~lignes 1141–1840)

---

## Contexte

Site privé pour 9 potes. Section vocal basée sur WebRTC full-mesh P2P, signaling via Supabase Broadcast (`voice-room-v1`). Problèmes actuels : connexions instables derrière NAT (pas de TURN), stream CPU-intensif (pas de préférence codec), UX des cartes datée, features sociales manquantes.

Usage typique : 2–3 personnes simultanément.

---

## Ce qui N'est PAS inclus

- Mode Gaming (écarté explicitement)
- Changement d'architecture WebRTC (full-mesh reste, fine à 2–3)
- Serveur TURN auto-hébergé
- Toutes les autres sections du site (chat, galerie, calendrier…)

---

## 1. Infrastructure & Perfs

### 1.1 TURN server (Metered.ca — gratuit)

**Problème racine :** `VOICE_ICE` ne contient que 3 STUN Google. Quand deux pairs sont derrière un NAT strict (Freebox, routeur d'appart), la connexion P2P directe échoue silencieusement.

**Solution :** Fetch dynamique des credentials TURN via l'API Metered.ca au moment du `joinVoice()`.

```js
// Remplace la constante VOICE_ICE statique
async function getIceServers() {
  const res = await fetch('https://groupepotes.metered.live/api/v1/turn/credentials?apiKey=METERED_API_KEY')
  const servers = await res.json()
  return servers // inclut STUN + TURN (UDP + TCP + TLS)
}
```

- Clé API en clair dans le JS (acceptable : site privé, pas de données sensibles)
- Credentials TTL 12h — renouvelés à chaque `joinVoice()`
- Fallback : si le fetch échoue, on retombe sur les STUN Google existants

### 1.2 Codec H264 hardware-first

Après `pc.createOffer()`, réordonner les codecs vidéo dans le SDP pour prioriser H264 (encodage matériel disponible sur la quasi-totalité des machines et téléphones modernes) avant VP9/VP8 (logiciel). Réduit significativement la charge CPU lors du stream.

```js
function preferH264(sdp) {
  // Réordonne les lignes m=video pour mettre H264 en premier
  // Conserve tous les codecs — juste le classement change
}
```

Appelé dans `voiceCreateOffer()` et `voiceHandleOffer()` avant `setLocalDescription`.

### 1.3 Pause analysers si tab cachée

`voiceWatchLevel()` utilise déjà `if (document.hidden) return` dans le setInterval. On renforce : suspendre l'`AudioContext` quand la page est cachée (`visibilitychange`) et le reprendre au retour.

```js
document.addEventListener('visibilitychange', () => {
  Object.values(voiceAudioCtxs).forEach(ctx => {
    if (document.hidden) ctx.suspend().catch(() => {})
    else ctx.resume().catch(() => {})
  })
})
```

### 1.4 Reconnexion automatique

Quand `pc.connectionState === 'failed'` :
- Retry automatique jusqu'à 3 fois (backoff : 1s → 2s → 4s)
- Indicateur visuel sur la carte : "⏳ Reconnexion…"
- Au-delà de 3 essais : "❌ Connexion perdue" + bouton retry manuel
- `voiceRemovePeer()` ne détruit pas immédiatement — attend la fin du backoff

---

## 2. UX — Cartes vocales (Compact Liste)

Style choisi : **lignes horizontales compactes** (vs grille avatars).

### Anatomie d'une carte

```
[ Avatar 36px ] [ Nom + barres niveau ] [ 🔊 slider volume ] [ emoji flottant ]
```

- **Avatar** : `renderAvatarEl()` existant, 36px, border violette si "parle"
- **Barres de niveau** : 4 barres verticales animées (CSS), visibles seulement si le peer parle (rms > seuil). Remplace le simple texte "parle…"
- **Statut** : "parle…" / "silencieux" / "muté 🔇" / "⏳ Reconnexion…" / "❌ Connexion perdue"
- **Volume slider** : `<input type="range" min="0" max="200" value="100">` affiché inline. Agit sur `audioEl.volume`. Sauvegardé en `localStorage` à la clé `voice-vol-{username}`.
- **Réaction emoji** : apparaît en absolut au-dessus de la carte, animation CSS `floatUp` 2s, puis disparaît.

### États visuels

| État | Border | Background | Barres |
|------|--------|------------|--------|
| Silencieux | rgba(255,255,255,0.08) | rgba(255,255,255,0.04) | cachées |
| Parle | rgba(124,58,237,0.5) | rgba(124,58,237,0.15) | visibles, vertes |
| Muté | rgba(255,255,255,0.08) | rgba(255,255,255,0.04) | cachées, icône 🔇 |
| Reconnexion | rgba(251,191,36,0.4) | rgba(251,191,36,0.08) | cachées, spinner |
| Erreur | rgba(239,68,68,0.4) | rgba(239,68,68,0.08) | cachées, ❌ |

---

## 3. Push-to-talk (PTT)

Toggle dans les paramètres vocal (checkbox "Push-to-talk"). Sauvegardé en `localStorage` (`voice-ptt`).

**Comportement quand activé :**
- Micro coupé par défaut à l'entrée dans le vocal
- Maintenir `Espace` ou `T` → unmute temporaire
- Relâcher → remute
- Indicateur sur sa propre carte : "Maintenir Espace pour parler"
- Le listener `keydown/keyup` est actif uniquement si le focus n'est pas sur un `INPUT`/`TEXTAREA`
- Compatible avec le raccourci `M` (mute toggle) déjà existant

---

## 4. Chat éphémère pendant le vocal

Zone de saisie compacte **sous la liste des cartes**, toujours visible quand on est dans le vocal.

**Envoi :** Supabase Broadcast sur `voice-room-v1`, event `vc` (voice chat), payload `{ from, text, ts }`. **Pas de stockage DB.**

**Affichage :**
- Feed de max 5 messages, empilés en bas
- Chaque message s'efface après 8 secondes (CSS `fadeOut` 1s)
- Format : `[Renan] Attention derrière !`
- Les messages de l'utilisateur courant s'affichent à droite (alignement)

**Envoi :** `Entrée` ou clic bouton send. Input limité à 100 caractères.

---

## 5. Réactions emoji

Bouton `✨` à côté de l'input de chat. Ouvre un picker inline : 5 emojis `👍 😂 🔥 💀 😮`.

**Clic sur un emoji :**
1. Broadcast sur `voice-room-v1`, event `ve` (voice emoji), payload `{ from, emoji }`
2. Sur réception (et en local) : animation CSS `floatUp` sur la carte du sender
3. Durée : 2 secondes, puis disparition

**CSS animation :**
```css
@keyframes floatUp {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-40px) scale(1.4); }
}
```

---

## 6. Intégration dans le code existant

| Zone | Modification |
|------|-------------|
| `VOICE_ICE` (constante) | Supprimée → remplacée par `getIceServers()` async |
| `joinVoice()` | Await `getIceServers()`, fallback STUN si erreur |
| `voiceMakePeer()` | Ajout appel `preferH264()` sur le SDP |
| `voiceRemovePeer()` | Wrappé dans logique retry avec backoff |
| `voiceWatchLevel()` | + suspend/resume sur `visibilitychange` |
| `renderVoiceUI()` | Refonte HTML → compact liste, volume sliders |
| `voiceBuildCard()` | Nouveau HTML + gestion états visuels |
| `voiceHandleSignal()` | + cases `vc` (chat) et `ve` (emoji) |
| Init vocal | Listener `keydown/keyup` PTT, listener broadcast chat/emoji |
| `dashboard.html` | Input chat éphémère + picker emoji + toggle PTT dans params |

**Aucun nouveau fichier.** Tout reste dans `dashboard.js` et `dashboard.html`.

---

## 7. Clé API Metered.ca

À créer sur [metered.ca](https://www.metered.ca/) (gratuit, 50 GB/mois). La clé `METERED_API_KEY` sera inlinée dans `dashboard.js`. Pas de `.env` nécessaire (site statique Vercel, pas de backend).
