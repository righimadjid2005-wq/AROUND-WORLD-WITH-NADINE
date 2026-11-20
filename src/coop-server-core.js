/**
 * src/coop-server-core.js
 * Pure server-authoritative Room & Co-op Session Manager for "Around the World with Nadine".
 *
 * Enforces:
 * - Hard cap of 2 players per room (Madjid & Nadine)
 * - Room creation, active room browsing, and search by code or name
 * - Server-authoritative 2D Open-World blocks & shared crafting inventory
 * - Idempotent real-time text chat history & story progress sync
 *
 * Decoupled from WebSocket transport so every rule can be deterministically unit-tested.
 */

import {
  createOpenWorldState,
  craftOpenWorldItem,
  placeOpenWorldBlock,
  removeOpenWorldBlock,
  serializeOpenWorldState,
} from './openworld.js';

export const MAX_PLAYERS_PER_ROOM = 2;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(existingCodes) {
  for (let attempt = 0; attempt < 40; attempt++) {
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const code = `ND-${suffix}`;
    if (!existingCodes.has(code)) return code;
  }
  return `ND-${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function sanitizeRoomName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 36);
  return cleaned || 'Madjid & Nadine Room';
}

function normalizeCharacter(charId) {
  return charId === 'nadine' ? 'nadine' : 'madjid';
}

export function createRoomManager() {
  const rooms = new Map(); // code -> room
  const clientRoomMap = new Map(); // clientId -> code

  function getRoomSummary(room) {
    const players = Array.from(room.players.values()).map((p) => ({
      clientId: p.clientId,
      character: p.character,
      skinId: p.skinId,
      isHost: p.clientId === room.hostClientId,
    }));
    return {
      code: room.code,
      name: room.name,
      mode: room.mode,
      levelIndex: room.levelIndex,
      playerCount: room.players.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      isFull: room.players.size >= MAX_PLAYERS_PER_ROOM,
      players,
      createdAt: room.createdAt,
    };
  }

  function getFullRoomSnapshot(room) {
    return {
      ...getRoomSummary(room),
      skins: { ...room.skins },
      openWorld: serializeOpenWorldState(room.openWorld),
      chat: room.chat.slice(-40),
      scrapbook: (room.scrapbook || []).slice(0, 24),
    };
  }

  function listRooms(query = '') {
    const q = String(query || '').trim().toLowerCase();
    const list = [];
    rooms.forEach((room) => {
      if (room.players.size <= 0) return;
      if (
        !q ||
        room.code.toLowerCase().includes(q) ||
        room.name.toLowerCase().includes(q)
      ) {
        list.push(getRoomSummary(room));
      }
    });
    list.sort((a, b) => {
      if (a.isFull !== b.isFull) return a.isFull ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
    return list;
  }

  function leaveRoom(clientId) {
    const code = clientRoomMap.get(clientId);
    if (!code) return { left: false };
    clientRoomMap.delete(clientId);
    const room = rooms.get(code);
    if (!room) return { left: false };

    const departed = room.players.get(clientId);
    room.players.delete(clientId);

    if (room.players.size === 0) {
      rooms.delete(code);
      return { left: true, code, departed, roomDeleted: true, remainingClientIds: [] };
    }

    // Reassign host if host disconnected
    if (room.hostClientId === clientId) {
      const nextHost = room.players.values().next().value;
      room.hostClientId = nextHost.clientId;
    }

    return {
      left: true,
      code,
      departed,
      roomDeleted: false,
      snapshot: getFullRoomSnapshot(room),
      remainingClientIds: Array.from(room.players.keys()),
    };
  }

  function createRoom(clientId, options = {}) {
    if (clientRoomMap.has(clientId)) {
      leaveRoom(clientId);
    }

    const code = options.customCode
      ? String(options.customCode).trim().toUpperCase().slice(0, 12)
      : generateRoomCode(rooms);
    if (rooms.has(code)) {
      return { ok: false, error: 'ROOM_CODE_EXISTS', message: 'A room with that code already exists.' };
    }

    const character = normalizeCharacter(options.character || 'madjid');
    const mode = options.mode === 'openworld' ? 'openworld' : 'story';
    const levelIndex = Number.isInteger(options.levelIndex)
      ? Math.max(0, Math.min(49, options.levelIndex))
      : 0;
    const skinId = options.skinId || (character === 'madjid' ? 'traveler-azure' : 'blossom-rose');

    const room = {
      code,
      name: sanitizeRoomName(options.name),
      mode,
      levelIndex,
      hostClientId: clientId,
      createdAt: Date.now(),
      players: new Map(),
      skins: {
        madjid: character === 'madjid' ? skinId : 'traveler-azure',
        nadine: character === 'nadine' ? skinId : 'blossom-rose',
      },
      openWorld: createOpenWorldState(null, null, options.theme || 'sunrise'),
      chat: [],
      seenChatIds: new Set(),
      scrapbook: [],
    };

    room.players.set(clientId, {
      clientId,
      character,
      skinId,
    });

    rooms.set(code, room);
    clientRoomMap.set(clientId, code);

    return {
      ok: true,
      character,
      room: getFullRoomSnapshot(room),
    };
  }

  function findRoomByCodeOrName(query) {
    const clean = String(query || '').trim().toLowerCase();
    if (!clean) return null;

    // 1. Exact code match (case-insensitive, with or without "ND-" prefix)
    for (const room of rooms.values()) {
      const codeLower = room.code.toLowerCase();
      if (codeLower === clean || codeLower.replace('nd-', '') === clean) {
        return room;
      }
    }
    // 2. Exact name match
    for (const room of rooms.values()) {
      if (room.name.toLowerCase() === clean) return room;
    }
    // 3. Partial name match (prefer non-full rooms)
    let partialFallback = null;
    for (const room of rooms.values()) {
      if (room.name.toLowerCase().includes(clean)) {
        if (room.players.size < MAX_PLAYERS_PER_ROOM) return room;
        if (!partialFallback) partialFallback = room;
      }
    }
    return partialFallback;
  }

  function joinRoom(clientId, codeOrQuery, options = {}) {
    const room = findRoomByCodeOrName(codeOrQuery);
    if (!room) {
      return { ok: false, error: 'ROOM_NOT_FOUND', message: 'No active room matched that code or name.' };
    }

    // Idempotent rejoin for same clientId already inside room
    if (room.players.has(clientId)) {
      const existing = room.players.get(clientId);
      return { ok: true, character: existing.character, room: getFullRoomSnapshot(room) };
    }

    // Strict hard cap: 2 players max (Madjid & Nadine)
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
      return {
        ok: false,
        error: 'ROOM_FULL',
        message: `Room "${room.name}" is already full (2/2 players: Madjid & Nadine).`,
      };
    }

    if (clientRoomMap.has(clientId)) {
      leaveRoom(clientId);
    }

    // Assign whichever character slot is free (Madjid or Nadine)
    const takenCharacters = new Set(Array.from(room.players.values()).map((p) => p.character));
    const preferred = options.character ? normalizeCharacter(options.character) : null;
    const assigned =
      preferred && !takenCharacters.has(preferred)
        ? preferred
        : takenCharacters.has('madjid')
          ? 'nadine'
          : 'madjid';

    const skinId = options.skinId || room.skins[assigned];
    room.skins[assigned] = skinId;

    room.players.set(clientId, {
      clientId,
      character: assigned,
      skinId,
    });
    clientRoomMap.set(clientId, room.code);

    return {
      ok: true,
      character: assigned,
      room: getFullRoomSnapshot(room),
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function getRoomForClient(clientId) {
    const code = clientRoomMap.get(clientId);
    if (!code) return null;
    return rooms.get(code) || null;
  }

  function getPlayerInRoom(clientId) {
    const room = getRoomForClient(clientId);
    if (!room) return null;
    return room.players.get(clientId) || null;
  }

  function updateRoomMode(clientId, { mode, levelIndex, theme }) {
    const room = getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };

    if (mode === 'story' || mode === 'openworld') {
      room.mode = mode;
    }
    if (Number.isInteger(levelIndex)) {
      room.levelIndex = Math.max(0, Math.min(49, levelIndex));
    }
    if (theme === 'sunrise' || theme === 'sunset' || theme === 'night') {
      room.openWorld.theme = theme;
    }

    return {
      ok: true,
      room: getFullRoomSnapshot(room),
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function updatePlayerSkin(clientId, skinId) {
    const room = getRoomForClient(clientId);
    if (!room || !skinId) return { ok: false, error: 'NOT_IN_ROOM' };
    const player = room.players.get(clientId);
    if (!player) return { ok: false, error: 'NOT_IN_ROOM' };
    player.skinId = String(skinId);
    room.skins[player.character] = player.skinId;
    return {
      ok: true,
      character: player.character,
      skinId: player.skinId,
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function applyOpenWorldAction(clientId, action) {
    const room = getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };

    if (action.kind === 'place') {
      const res = placeOpenWorldBlock(room.openWorld, action.gx, action.gy, action.blockType, {
        consumeInventory: true,
      });
      if (!res.ok) return res;
      return {
        ok: true,
        kind: 'place',
        block: res.block,
        inventory: { ...room.openWorld.inventory },
        craftedTotal: room.openWorld.craftedTotal,
        memberClientIds: Array.from(room.players.keys()),
      };
    }

    if (action.kind === 'remove') {
      const res = removeOpenWorldBlock(room.openWorld, action.gx, action.gy, {
        refundInventory: true,
      });
      if (!res.ok) return res;
      return {
        ok: true,
        kind: 'remove',
        gx: action.gx,
        gy: action.gy,
        inventory: { ...room.openWorld.inventory },
        craftedTotal: room.openWorld.craftedTotal,
        memberClientIds: Array.from(room.players.keys()),
      };
    }

    if (action.kind === 'craft') {
      const res = craftOpenWorldItem(room.openWorld, action.recipeId);
      if (!res.ok) return res;
      return {
        ok: true,
        kind: 'craft',
        recipeId: action.recipeId,
        inventory: { ...room.openWorld.inventory },
        craftedTotal: room.openWorld.craftedTotal,
        memberClientIds: Array.from(room.players.keys()),
      };
    }

    if (action.kind === 'theme') {
      if (action.theme === 'sunrise' || action.theme === 'sunset' || action.theme === 'night') {
        room.openWorld.theme = action.theme;
        return {
          ok: true,
          kind: 'theme',
          theme: room.openWorld.theme,
          memberClientIds: Array.from(room.players.keys()),
        };
      }
    }

    return { ok: false, error: 'INVALID_ACTION' };
  }

  function appendChatMessage(clientId, { id, text, timestamp }) {
    const room = getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    const player = room.players.get(clientId);
    if (!player) return { ok: false, error: 'NOT_IN_ROOM' };

    const cleanText = String(text || '').trim().slice(0, 160);
    if (!cleanText) return { ok: false, error: 'EMPTY_MESSAGE' };

    const msgId = String(id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    if (room.seenChatIds.has(msgId)) {
      return { ok: true, idempotent: true, memberClientIds: [] };
    }
    room.seenChatIds.add(msgId);

    const msg = {
      id: msgId,
      senderId: player.character,
      senderName: player.character === 'madjid' ? 'Madjid' : 'Nadine',
      text: cleanText,
      timestamp:
        timestamp ||
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    room.chat.push(msg);
    if (room.chat.length > 60) room.chat.shift();

    return {
      ok: true,
      message: msg,
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function getPeerClientIds(clientId) {
    const room = getRoomForClient(clientId);
    if (!room) return [];
    const peers = [];
    room.players.forEach((_p, id) => {
      if (id !== clientId) peers.push(id);
    });
    return peers;
  }

  function appendScrapbookPhoto(clientId, photo) {
    const room = getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    const player = room.players.get(clientId);
    if (!player || !photo || typeof photo !== 'object') {
      return { ok: false, error: 'INVALID_PHOTO' };
    }

    const sanitized = {
      id: String(photo.id || `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 48),
      title: String(photo.title || 'Journey Memory').trim().slice(0, 64),
      location: String(photo.location || 'Around the World').trim().slice(0, 72),
      skyWeather: String(photo.skyWeather || 'Golden Dawn').trim().slice(0, 48),
      capturedAt: String(photo.capturedAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).slice(0, 24),
      imageDataUrl:
        typeof photo.imageDataUrl === 'string' && photo.imageDataUrl.startsWith('data:image/')
          ? photo.imageDataUrl.slice(0, 120000)
          : '',
      byCharacter: player.character,
    };

    if (!room.scrapbook) room.scrapbook = [];
    if (!room.scrapbook.some((p) => p.id === sanitized.id)) {
      room.scrapbook.unshift(sanitized);
      if (room.scrapbook.length > 24) room.scrapbook.pop();
    }

    return {
      ok: true,
      photo: sanitized,
      scrapbook: room.scrapbook.slice(0, 24),
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  return {
    listRooms,
    createRoom,
    joinRoom,
    leaveRoom,
    getRoomForClient,
    getPlayerInRoom,
    getFullRoomSnapshot,
    updateRoomMode,
    updatePlayerSkin,
    applyOpenWorldAction,
    appendChatMessage,
    appendScrapbookPhoto,
    getPeerClientIds,
  };
}
