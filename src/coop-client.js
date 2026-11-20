/**
 * src/coop-client.js
 * Decoupled WebSocket Co-op Client for "Around the World with Nadine".
 *
 * Supports:
 * - Configurable cloud/internet `ws://` and `wss://` server URLs
 * - Automatic reconnect with exponential backoff and session rejoin
 * - Room creation, active room browsing, and code/name search & join
 * - Real-time player sync, story progress sync, 2D Open-World build/craft sync,
 *   skin sync, and live text chat sync
 */

const STORAGE_WS_KEY = 'nadine_coop_ws_url';

export function normalizeWsUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return getFallbackWsUrl();

  let candidate = trimmed;
  if (candidate.startsWith('https://')) {
    candidate = `wss://${candidate.slice('https://'.length)}`;
  } else if (candidate.startsWith('http://')) {
    candidate = `ws://${candidate.slice('http://'.length)}`;
  } else if (!candidate.startsWith('ws://') && !candidate.startsWith('wss://')) {
    const defaultProto =
      typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    candidate = `${defaultProto}${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/ws';
    }
    return parsed.toString();
  } catch {
    return getFallbackWsUrl();
  }
}

function getFallbackWsUrl() {
  if (typeof window !== 'undefined' && window.location && window.location.host) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return 'ws://localhost:3000/ws';
}

export function getDefaultWsUrl() {
  try {
    const envUrl =
      typeof import.meta !== 'undefined' && import.meta.env
        ? import.meta.env.VITE_COOP_WS_URL
        : '';
    if (envUrl && String(envUrl).trim()) {
      return normalizeWsUrl(envUrl);
    }
  } catch {
    // Ignore env read errors outside Vite
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_WS_KEY);
      if (saved && saved.trim()) {
        return normalizeWsUrl(saved);
      }
    }
  } catch {
    // Ignore storage access errors
  }

  return getFallbackWsUrl();
}

export function savePreferredWsUrl(url) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_WS_KEY, normalizeWsUrl(url));
    }
  } catch {
    // Ignore storage errors
  }
}

export function createCoopClient(callbacks = {}) {
  let ws = null;
  let currentUrl = getDefaultWsUrl();
  let status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
  let clientId = null;
  let activeRoomCode = null;
  let activeCharacter = null;
  let lastSkinId = null;
  let shouldReconnect = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  const pendingQueue = [];

  function setStatus(nextStatus, detail = '') {
    status = nextStatus;
    callbacks.onStatus?.(status, currentUrl, detail);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function sendPacket(packet) {
    const serialized = JSON.stringify(packet);
    if (ws && ws.readyState === 1) {
      ws.send(serialized);
      return true;
    }
    if (pendingQueue.length < 24 && packet.type !== 'player:state') {
      pendingQueue.push(serialized);
    }
    return false;
  }

  function flushPending() {
    if (!ws || ws.readyState !== 1) return;
    while (pendingQueue.length > 0) {
      ws.send(pendingQueue.shift());
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return;
    clearReconnectTimer();
    const delay = Math.min(6000, 750 * Math.pow(1.6, reconnectAttempt));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      if (shouldReconnect) {
        openSocket(currentUrl);
      }
    }, delay);
  }

  function openSocket(targetUrl) {
    clearReconnectTimer();
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      } catch {
        // Ignore close error
      }
      ws = null;
    }

    currentUrl = normalizeWsUrl(targetUrl);
    setStatus('connecting');

    try {
      ws = new WebSocket(currentUrl);
    } catch {
      setStatus('disconnected', 'Invalid WebSocket URL');
      return;
    }

    ws.onopen = () => {
      reconnectAttempt = 0;
      setStatus('connected');
      flushPending();
      if (activeRoomCode) {
        sendPacket({
          type: 'room:join',
          query: activeRoomCode,
          character: activeCharacter || undefined,
          skinId: lastSkinId || undefined,
        });
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'welcome':
          clientId = msg.clientId || null;
          callbacks.onRooms?.(msg.rooms || [], '');
          break;

        case 'room:list':
          callbacks.onRooms?.(msg.rooms || [], msg.query || '');
          break;

        case 'room:joined':
          activeRoomCode = msg.room?.code || null;
          activeCharacter = msg.character || null;
          callbacks.onRoomJoined?.(msg);
          break;

        case 'room:left':
          activeRoomCode = null;
          activeCharacter = null;
          callbacks.onRoomLeft?.(msg);
          break;

        case 'room:mode':
          callbacks.onRoomMode?.(msg.room);
          break;

        case 'partner:joined':
          callbacks.onPartnerJoined?.(msg);
          break;

        case 'partner:left':
          callbacks.onPartnerLeft?.(msg);
          break;

        case 'player:state':
          callbacks.onPlayerState?.(msg.character, msg.state);
          break;

        case 'story:sync':
          callbacks.onStorySync?.(msg.fromCharacter, msg.payload);
          break;

        case 'world:updated':
          callbacks.onWorldUpdated?.(msg);
          break;

        case 'skin:updated':
          callbacks.onSkinUpdated?.(msg.character, msg.skinId);
          break;

        case 'chat:message':
          callbacks.onChatMessage?.(msg.message);
          break;

        case 'player:emote':
          callbacks.onPlayerEmote?.(msg);
          break;

        case 'world:trigger':
          callbacks.onWorldTrigger?.(msg);
          break;

        case 'ghost:sync':
          callbacks.onGhostSync?.(msg);
          break;

        case 'carry:sync':
          callbacks.onCarrySync?.(msg);
          break;

        case 'dance:sync':
          callbacks.onDanceSync?.(msg);
          break;

        case 'dance:invite':
          callbacks.onDanceInvite?.(msg);
          break;

        case 'dance:respond':
          callbacks.onDanceRespond?.(msg);
          break;

        case 'boss:sync':
          callbacks.onBossSync?.(msg);
          break;

        case 'weather:sync':
          callbacks.onWeatherSync?.(msg);
          break;

        case 'scrapbook:updated':
          callbacks.onScrapbookUpdated?.(msg);
          break;

        case 'error':
          callbacks.onError?.(msg.code || 'ERROR', msg.message || 'Server error.');
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      // Handled cleanly in onclose
    };

    ws.onclose = () => {
      ws = null;
      setStatus('disconnected');
      if (shouldReconnect) {
        scheduleReconnect();
      }
    };
  }

  function connect(url = currentUrl) {
    shouldReconnect = true;
    savePreferredWsUrl(url);
    openSocket(url);
  }

  function disconnect() {
    shouldReconnect = false;
    activeRoomCode = null;
    activeCharacter = null;
    pendingQueue.length = 0;
    clearReconnectTimer();
    if (ws) {
      try {
        ws.close();
      } catch {
        // Ignore close error
      }
      ws = null;
    }
    setStatus('disconnected');
  }

  function ensureConnected() {
    if (!ws || ws.readyState > 1) {
      connect(currentUrl);
    }
  }

  function listRooms(query = '') {
    ensureConnected();
    sendPacket({ type: 'room:list', query: String(query || '').trim() });
  }

  function createRoom({ name, mode = 'story', levelIndex = 0, character = 'madjid', skinId, theme = 'sunrise' } = {}) {
    ensureConnected();
    lastSkinId = skinId || null;
    sendPacket({
      type: 'room:create',
      name,
      mode,
      levelIndex,
      character,
      skinId,
      theme,
    });
  }

  function joinRoom(query, { character, skinId } = {}) {
    ensureConnected();
    lastSkinId = skinId || null;
    sendPacket({
      type: 'room:join',
      query: String(query || '').trim(),
      character,
      skinId,
    });
  }

  function leaveRoom() {
    activeRoomCode = null;
    activeCharacter = null;
    sendPacket({ type: 'room:leave' });
  }

  function setRoomMode({ mode, levelIndex, theme }) {
    sendPacket({ type: 'room:mode', mode, levelIndex, theme });
  }

  function sendPlayerState(state) {
    if (!ws || ws.readyState !== 1 || !activeRoomCode) return;
    ws.send(JSON.stringify({ type: 'player:state', state }));
  }

  function sendStorySync(payload) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'story:sync', payload });
  }

  function sendOpenWorldAction(action) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'world:action', ...action });
  }

  function sendSkinUpdate(skinId) {
    lastSkinId = skinId;
    if (!activeRoomCode) return;
    sendPacket({ type: 'skin:update', skinId });
  }

  function sendChat(msg) {
    if (!activeRoomCode) return;
    sendPacket({
      type: 'chat:send',
      id: msg.id,
      text: msg.text,
      timestamp: msg.timestamp,
    });
  }

  function sendEmote({ emoteId, x = null, y = null }) {
    if (!activeRoomCode || !emoteId) return;
    sendPacket({
      type: 'player:emote',
      emoteId,
      x,
      y,
    });
  }

  function sendWorldTrigger({ triggerKind, x = null, y = null }) {
    if (!activeRoomCode || !triggerKind) return;
    sendPacket({
      type: 'world:trigger',
      triggerKind,
      x,
      y,
    });
  }

  function sendGhostSync(payload) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'ghost:sync', ...payload });
  }

  function sendCarrySync(payload) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'carry:sync', ...payload });
  }

  function sendDanceSync(payload) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'dance:sync', ...payload });
  }

  function sendDanceInvite(styleId, styleName) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'dance:invite', styleId, styleName });
  }

  function sendDanceRespond(accepted, styleId) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'dance:respond', accepted: Boolean(accepted), styleId });
  }

  function sendBossSync(payload) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'boss:sync', ...payload });
  }

  function sendWeatherSync(weather) {
    if (!activeRoomCode) return;
    sendPacket({ type: 'weather:sync', weather });
  }

  function sendPhotoSnap(photo) {
    if (!activeRoomCode || !photo) return;
    sendPacket({ type: 'photo:snap', photo });
  }

  return {
    connect,
    disconnect,
    getUrl: () => currentUrl,
    getStatus: () => status,
    getClientId: () => clientId,
    isConnected: () => status === 'connected',
    listRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    setRoomMode,
    sendPlayerState,
    sendStorySync,
    sendOpenWorldAction,
    sendSkinUpdate,
    sendChat,
    sendEmote,
    sendWorldTrigger,
    sendGhostSync,
    sendCarrySync,
    sendDanceSync,
    sendDanceInvite,
    sendDanceRespond,
    sendBossSync,
    sendWeatherSync,
    sendPhotoSnap,
  };
}
