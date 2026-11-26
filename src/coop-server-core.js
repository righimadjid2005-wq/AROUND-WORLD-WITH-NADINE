/**
 * src/coop-server-core.js
 * Pure server-authoritative Room & Co-op Session Manager for "Around the World with Nadine".
 *
 * Enforces:
 * - Hard cap of 2 players per room (Madjid & Nadine)
 * - Minecraft-style persistent saved rooms (never deleted when players leave/disconnect; saved to JSON on disk)
 * - Room creation, browsing saved/active rooms, and rejoin/search by code or name
 * - Server-authoritative 2D Open-World blocks, crafting inventory, Story checkpoints/weapons/barriers, & player positions
 * - Idempotent real-time text chat history & scrapbook photos
 */

import fs from 'node:fs';
import path from 'node:path';
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

function createEmptyStoryProgress(levelIndex = 0) {
  return {
    levelIndex,
    activeCheckpointId: null,
    activatedCheckpoints: [],
    defeatedBosses: [],
    defeatedMonsters: [],
    placedBlocks: {},
    puzzleProgress: {},
    collectedKeys: [],
    collectedWeapons: [],
    brokenBarriers: [],
    switches: {},
    gates: {},
  };
}

function sanitizeActorSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const weapons = Array.isArray(raw.weapons)
    ? raw.weapons.filter((w) => typeof w === 'string').slice(0, 6)
    : [];
  const equippedWeapon =
    typeof raw.equippedWeapon === 'string' && weapons.includes(raw.equippedWeapon)
      ? raw.equippedWeapon
      : weapons[0] || null;
  const maxHp = Number.isFinite(raw.maxHp) ? Math.max(10, Math.min(500, Math.round(raw.maxHp))) : 100;
  const hp = Number.isFinite(raw.hp) ? Math.max(0, Math.min(maxHp, Math.round(raw.hp))) : maxHp;
  return {
    x: Number.isFinite(raw.x) ? Math.round(raw.x * 10) / 10 : null,
    y: Number.isFinite(raw.y) ? Math.round(raw.y * 10) / 10 : null,
    facing: raw.facing === -1 ? -1 : 1,
    hp,
    maxHp,
    weapons,
    equippedWeapon,
  };
}

export function createRoomManager(options = {}) {
  const storagePath = options.storagePath ? path.resolve(options.storagePath) : null;
  const rooms = new Map(); // code -> room
  const clientRoomMap = new Map(); // clientId -> code
  let saveTimer = null;

  function serializeRoomForDisk(room) {
    return {
      code: room.code,
      name: room.name,
      mode: room.mode,
      levelIndex: room.levelIndex,
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt || room.createdAt,
      skins: { ...room.skins },
      customSkins: { ...(room.customSkins || {}) },
      playerStates: {
        madjid: sanitizeActorSave(room.playerStates?.madjid),
        nadine: sanitizeActorSave(room.playerStates?.nadine),
      },
      storyProgress: room.storyProgress || createEmptyStoryProgress(room.levelIndex),
      openWorld: serializeOpenWorldState(room.openWorld),
      chat: (room.chat || []).slice(-40),
      scrapbook: (room.scrapbook || []).slice(0, 24),
    };
  }

  function flushSaveSync() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!storagePath) return;
    try {
      const dir = path.dirname(storagePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload = {
        version: 2,
        savedAt: Date.now(),
        rooms: Array.from(rooms.values()).map(serializeRoomForDisk),
      };
      const tmpPath = `${storagePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, storagePath);
    } catch {
      // Ignore transient disk write errors cleanly
    }
  }

  function scheduleSave(immediate = false) {
    if (!storagePath) return;
    if (immediate) {
      flushSaveSync();
      return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushSaveSync();
    }, 350);
    saveTimer.unref?.();
  }

  function hydrateFromDisk() {
    if (!storagePath || !fs.existsSync(storagePath)) return;
    try {
      const raw = fs.readFileSync(storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
      for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        if (!entry || typeof entry.code !== 'string') continue;
        const ow = createOpenWorldState(
          entry.openWorld?.blocks || null,
          entry.openWorld?.inventory || null,
          entry.openWorld?.theme || 'sunrise'
        );
        ow.craftedTotal = Number(entry.openWorld?.craftedTotal) || 0;
        const chatList = Array.isArray(entry.chat) ? entry.chat.slice(-60) : [];
        const seenChatIds = new Set(chatList.map((m) => m.id).filter(Boolean));
        const levelIndex = Number.isInteger(entry.levelIndex)
          ? Math.max(0, Math.min(99, entry.levelIndex))
          : 0;
        const room = {
          code: entry.code,
          name: sanitizeRoomName(entry.name),
          mode: entry.mode === 'openworld' ? 'openworld' : 'story',
          levelIndex,
          hostClientId: null,
          createdAt: Number(entry.createdAt) || Date.now(),
          lastActiveAt: Number(entry.lastActiveAt) || Date.now(),
          players: new Map(),
          skins: {
            madjid: entry.skins?.madjid || 'traveler-azure',
            nadine: entry.skins?.nadine || 'blossom-rose',
          },
          customSkins: entry.customSkins && typeof entry.customSkins === 'object' ? { ...entry.customSkins } : {},
          playerStates: {
            madjid: sanitizeActorSave(entry.playerStates?.madjid),
            nadine: sanitizeActorSave(entry.playerStates?.nadine),
          },
          storyProgress: entry.storyProgress && typeof entry.storyProgress === 'object'
            ? { ...createEmptyStoryProgress(levelIndex), ...entry.storyProgress }
            : createEmptyStoryProgress(levelIndex),
          openWorld: ow,
          chat: chatList,
          seenChatIds,
          scrapbook: Array.isArray(entry.scrapbook) ? entry.scrapbook.slice(0, 24) : [],
        };
        rooms.set(room.code, room);
      }
    } catch {
      // Corrupt or unreadable cache safely ignored on boot
    }
  }

  hydrateFromDisk();

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
      saved: true,
      players,
      createdAt: room.createdAt,
      lastActiveAt: room.lastActiveAt || room.createdAt,
    };
  }

  function getFullRoomSnapshot(room) {
    return {
      ...getRoomSummary(room),
      skins: { ...room.skins },
      customSkins: { ...(room.customSkins || {}) },
      playerStates: {
        madjid: room.playerStates?.madjid ? { ...room.playerStates.madjid } : null,
        nadine: room.playerStates?.nadine ? { ...room.playerStates.nadine } : null,
      },
      storyProgress: room.storyProgress ? { ...room.storyProgress } : createEmptyStoryProgress(room.levelIndex),
      openWorld: serializeOpenWorldState(room.openWorld),
      chat: room.chat.slice(-40),
      scrapbook: (room.scrapbook || []).slice(0, 24),
    };
  }

  function listRooms(query = '') {
    const q = String(query || '').trim().toLowerCase();
    const list = [];
    rooms.forEach((room) => {
      if (
        !q ||
        room.code.toLowerCase().includes(q) ||
        room.name.toLowerCase().includes(q)
      ) {
        list.push(getRoomSummary(room));
      }
    });
    list.sort((a, b) => {
      // Joinable rooms (1/2 online) first, then saved offline worlds (0/2), then full (2/2)
      if (a.isFull !== b.isFull) return a.isFull ? 1 : -1;
      if ((a.playerCount > 0) !== (b.playerCount > 0)) return a.playerCount > 0 ? -1 : 1;
      return (b.lastActiveAt || b.createdAt) - (a.lastActiveAt || a.createdAt);
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
    room.lastActiveAt = Date.now();

    // Minecraft-style persistence: KEEP room saved in directory & on disk even at 0/2 players!
    if (room.players.size === 0) {
      room.hostClientId = null;
      scheduleSave(true);
      return {
        left: true,
        code,
        departed,
        roomDeleted: false,
        snapshot: getFullRoomSnapshot(room),
        remainingClientIds: [],
      };
    }

    // Reassign host if host disconnected
    if (room.hostClientId === clientId) {
      const nextHost = room.players.values().next().value;
      room.hostClientId = nextHost.clientId;
    }

    scheduleSave(true);
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
      ? Math.max(0, Math.min(99, options.levelIndex))
      : 0;
    const skinId = options.skinId || (character === 'madjid' ? 'traveler-azure' : 'blossom-rose');

    const now = Date.now();
    const room = {
      code,
      name: sanitizeRoomName(options.name),
      mode,
      levelIndex,
      hostClientId: clientId,
      createdAt: now,
      lastActiveAt: now,
      players: new Map(),
      skins: {
        madjid: character === 'madjid' ? skinId : 'traveler-azure',
        nadine: character === 'nadine' ? skinId : 'blossom-rose',
      },
      customSkins: {},
      playerStates: {
        madjid: null,
        nadine: null,
      },
      storyProgress: createEmptyStoryProgress(levelIndex),
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
    scheduleSave(true);

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
      return { ok: false, error: 'ROOM_NOT_FOUND', message: 'No active or saved room matched that code or name.' };
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
    if (!room.hostClientId) {
      room.hostClientId = clientId;
    }
    room.lastActiveAt = Date.now();

    room.players.set(clientId, {
      clientId,
      character: assigned,
      skinId,
    });
    clientRoomMap.set(clientId, room.code);
    scheduleSave(true);

    return {
      ok: true,
      character: assigned,
      room: getFullRoomSnapshot(room),
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function quickJoinRoom(clientId, options = {}) {
    const ordered = listRooms('');
    const open =
      ordered.find((r) => !r.isFull && r.playerCount > 0 && r.playerCount < MAX_PLAYERS_PER_ROOM) ||
      ordered.find((r) => !r.isFull && r.playerCount < MAX_PLAYERS_PER_ROOM);
    if (!open) {
      return {
        ok: false,
        error: 'NO_OPEN_ROOMS',
        message: 'No open sessions found yet. Create a room on the left to start!',
      };
    }
    return joinRoom(clientId, open.code, options);
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

  /**
   * @param {string} clientId
   * @param {{ mode?: string, levelIndex?: number, theme?: string, reset?: boolean }} [options]
   */
  function updateRoomMode(clientId, { mode, levelIndex, theme, reset = false } = {}) {
    const room = getRoomForClient(clientId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };

    const prevMode = room.mode;
    const prevLevel = room.levelIndex;

    if (mode === 'story' || mode === 'openworld') {
      room.mode = mode;
    }
    if (Number.isInteger(levelIndex)) {
      room.levelIndex = Math.max(0, Math.min(99, levelIndex));
    }
    if (theme === 'sunrise' || theme === 'sunset' || theme === 'night') {
      room.openWorld.theme = theme;
    }

    if (reset || room.mode !== prevMode || room.levelIndex !== prevLevel) {
      room.storyProgress = createEmptyStoryProgress(room.levelIndex);
      // Clear positional coordinates cleanly while keeping weapons/skins/scrapbook intact
      ['madjid', 'nadine'].forEach((cid) => {
        const ps = room.playerStates?.[cid];
        if (ps) {
          ps.x = null;
          ps.y = null;
        }
      });
    }

    room.lastActiveAt = Date.now();
    scheduleSave(true);

    return {
      ok: true,
      room: getFullRoomSnapshot(room),
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function updatePlayerRuntimeState(clientId, state) {
    const room = getRoomForClient(clientId);
    if (!room || !state || typeof state !== 'object') return false;
    const player = room.players.get(clientId);
    if (!player) return false;
    if (!room.playerStates) room.playerStates = { madjid: null, nadine: null };
    const prevSave = room.playerStates[player.character] || {};
    room.playerStates[player.character] = sanitizeActorSave({
      ...prevSave,
      x: state.x,
      y: state.y,
      facing: state.facing,
      hp: state.hp !== undefined ? state.hp : prevSave.hp,
      maxHp: state.maxHp !== undefined ? state.maxHp : prevSave.maxHp,
      weapons: Array.isArray(state.weapons) ? state.weapons : prevSave.weapons,
      equippedWeapon:
        state.equippedWeapon !== undefined
          ? state.equippedWeapon
          : prevSave.equippedWeapon,
    });
    room.lastActiveAt = Date.now();
    scheduleSave(false);
    return true;
  }

  function updateStoryProgress(clientId, payload) {
    const room = getRoomForClient(clientId);
    if (!room || !payload || typeof payload !== 'object') return false;
    if (!room.storyProgress) room.storyProgress = createEmptyStoryProgress(room.levelIndex);
    const sp = room.storyProgress;

    if (typeof payload.levelIndex === 'number' && Number.isInteger(payload.levelIndex)) {
      const clamped = Math.max(0, Math.min(99, payload.levelIndex));
      if (clamped !== sp.levelIndex) {
        room.levelIndex = clamped;
        room.storyProgress = createEmptyStoryProgress(clamped);
      }
    }

    const cur = room.storyProgress;
    const isReplace = Boolean(payload.replace);

    if (payload.activeCheckpointId === null) {
      if (isReplace) cur.activeCheckpointId = null;
    } else if (typeof payload.activeCheckpointId === 'string') {
      cur.activeCheckpointId = payload.activeCheckpointId;
    }

    if (Array.isArray(payload.activatedCheckpoints)) {
      cur.activatedCheckpoints = isReplace
        ? Array.from(new Set(payload.activatedCheckpoints))
        : Array.from(new Set([...(cur.activatedCheckpoints || []), ...payload.activatedCheckpoints]));
    }
    if (Array.isArray(payload.defeatedBosses)) {
      cur.defeatedBosses = isReplace
        ? Array.from(new Set(payload.defeatedBosses))
        : Array.from(new Set([...(cur.defeatedBosses || []), ...payload.defeatedBosses]));
    }
    if (Array.isArray(payload.defeatedMonsters)) {
      cur.defeatedMonsters = isReplace
        ? Array.from(new Set(payload.defeatedMonsters))
        : Array.from(new Set([...(cur.defeatedMonsters || []), ...payload.defeatedMonsters]));
    }
    if (payload.placedBlocks && typeof payload.placedBlocks === 'object') {
      cur.placedBlocks = isReplace
        ? { ...payload.placedBlocks }
        : { ...(cur.placedBlocks || {}), ...payload.placedBlocks };
    }
    if (payload.puzzleProgress && typeof payload.puzzleProgress === 'object') {
      cur.puzzleProgress = isReplace
        ? { ...payload.puzzleProgress }
        : { ...(cur.puzzleProgress || {}), ...payload.puzzleProgress };
    }
    if (Array.isArray(payload.collectedKeys)) {
      cur.collectedKeys = isReplace
        ? Array.from(new Set(payload.collectedKeys))
        : Array.from(new Set([...(cur.collectedKeys || []), ...payload.collectedKeys]));
    }
    if (Array.isArray(payload.collectedWeapons)) {
      cur.collectedWeapons = isReplace
        ? Array.from(new Set(payload.collectedWeapons))
        : Array.from(new Set([...(cur.collectedWeapons || []), ...payload.collectedWeapons]));
    }
    if (Array.isArray(payload.brokenBarriers)) {
      cur.brokenBarriers = isReplace
        ? Array.from(new Set(payload.brokenBarriers))
        : Array.from(new Set([...(cur.brokenBarriers || []), ...payload.brokenBarriers]));
    }
    if (payload.switches && typeof payload.switches === 'object') {
      cur.switches = isReplace
        ? { ...payload.switches }
        : { ...(cur.switches || {}), ...payload.switches };
    }
    if (payload.gates && typeof payload.gates === 'object') {
      cur.gates = isReplace
        ? { ...payload.gates }
        : { ...(cur.gates || {}), ...payload.gates };
    }

    room.lastActiveAt = Date.now();
    scheduleSave(false);
    return true;
  }

  function updatePlayerSkin(clientId, skinId) {
    const room = getRoomForClient(clientId);
    if (!room || !skinId) return { ok: false, error: 'NOT_IN_ROOM' };
    const player = room.players.get(clientId);
    if (!player) return { ok: false, error: 'NOT_IN_ROOM' };
    player.skinId = String(skinId);
    room.skins[player.character] = player.skinId;
    room.lastActiveAt = Date.now();
    scheduleSave(true);
    return {
      ok: true,
      character: player.character,
      skinId: player.skinId,
      memberClientIds: Array.from(room.players.keys()),
    };
  }

  function updateCustomSkin(clientId, skinConfig) {
    const room = getRoomForClient(clientId);
    if (!room || !skinConfig || typeof skinConfig !== 'object' || !skinConfig.id) {
      return { ok: false, error: 'INVALID_SKIN' };
    }
    const player = room.players.get(clientId);
    if (!player) return { ok: false, error: 'NOT_IN_ROOM' };
    if (!room.customSkins) room.customSkins = {};
    const id = String(skinConfig.id).slice(0, 48);
    room.customSkins[id] = { ...skinConfig, id };
    player.skinId = id;
    room.skins[player.character] = id;
    room.lastActiveAt = Date.now();
    scheduleSave(true);
    return {
      ok: true,
      character: player.character,
      skin: room.customSkins[id],
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
      room.lastActiveAt = Date.now();
      scheduleSave(true);
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
      room.lastActiveAt = Date.now();
      scheduleSave(true);
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
      room.lastActiveAt = Date.now();
      scheduleSave(true);
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
        room.lastActiveAt = Date.now();
        scheduleSave(true);
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
    room.lastActiveAt = Date.now();
    scheduleSave(true);

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
    room.lastActiveAt = Date.now();
    scheduleSave(true);

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
    quickJoinRoom,
    leaveRoom,
    getRoomForClient,
    getPlayerInRoom,
    getFullRoomSnapshot,
    updateRoomMode,
    updatePlayerRuntimeState,
    updateStoryProgress,
    updatePlayerSkin,
    updateCustomSkin,
    applyOpenWorldAction,
    appendChatMessage,
    appendScrapbookPhoto,
    getPeerClientIds,
    flushSaveSync,
  };
}
