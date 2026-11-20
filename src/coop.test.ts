import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import { MAX_PLAYERS_PER_ROOM, createRoomManager } from './coop-server-core.js';
import {
  buildOpenWorldSolidPlatforms,
  craftOpenWorldItem,
  createOpenWorldLevelDefinition,
  createOpenWorldState,
  placeOpenWorldBlock,
  removeOpenWorldBlock,
} from './openworld.js';
import { normalizeWsUrl } from './coop-client.js';
import { attachCoopWebSocket } from '../server.ts';

interface JsonSocketHelper {
  ws: WebSocket;
  waitFor: (predicate: (msg: Record<string, unknown>) => boolean, timeoutMs?: number) => Promise<Record<string, unknown>>;
  send: (payload: Record<string, unknown>) => void;
  close: () => Promise<void>;
}

function connectTestClient(url: string): Promise<JsonSocketHelper> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: Record<string, unknown>[] = [];
    const waiters: Array<{
      predicate: (msg: Record<string, unknown>) => boolean;
      resolve: (msg: Record<string, unknown>) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }> = [];

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].predicate(msg)) {
          const w = waiters.splice(i, 1)[0];
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
      }
      queue.push(msg);
    });

    ws.on('open', () => {
      resolve({
        ws,
        waitFor(predicate, timeoutMs = 4000) {
          for (let i = 0; i < queue.length; i++) {
            if (predicate(queue[i])) {
              return Promise.resolve(queue.splice(i, 1)[0]);
            }
          }
          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.resolve === res);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('Timed out waiting for WebSocket message'));
            }, timeoutMs);
            waiters.push({ predicate, resolve: res, reject: rej, timer });
          });
        },
        send(payload) {
          ws.send(JSON.stringify(payload));
        },
        close() {
          return new Promise((res) => {
            if (ws.readyState === WebSocket.CLOSED) {
              res();
              return;
            }
            ws.once('close', () => res());
            ws.close();
          });
        },
      });
    });

    ws.on('error', reject);
  });
}

test('Room manager enforces strict 2-player cap, room search/browse, and character assignment', () => {
  assert.equal(MAX_PLAYERS_PER_ROOM, 2);
  const manager = createRoomManager();

  const created = manager.createRoom('c1', {
    name: 'Sunset Walk with Nadine',
    mode: 'story',
    levelIndex: 3,
    character: 'madjid',
    customCode: 'ND-LOVE',
  });
  assert.equal(created.ok, true);
  assert.equal(created.character, 'madjid');
  assert.equal(created.room?.code, 'ND-LOVE');
  assert.equal(created.room?.playerCount, 1);

  // Browse & search by partial name and short code (without ND- prefix)
  assert.equal(manager.listRooms('').length, 1);
  assert.equal(manager.listRooms('nadine').length, 1);
  assert.equal(manager.listRooms('LOVE').length, 1);
  assert.equal(manager.listRooms('nonexistent').length, 0);

  // 2nd player joins by short code -> automatically assigned Nadine
  const second = manager.joinRoom('c2', 'LOVE');
  assert.equal(second.ok, true);
  assert.equal(second.character, 'nadine');
  assert.equal(second.room?.playerCount, 2);
  assert.equal(second.room?.isFull, true);

  // 3rd player strictly rejected due to 2-player hard cap
  const third = manager.joinRoom('c3', 'ND-LOVE');
  assert.equal(third.ok, false);
  assert.equal(third.error, 'ROOM_FULL');

  // Leaving reassigns host & removes room once empty
  const left1 = manager.leaveRoom('c1');
  assert.equal(left1.left, true);
  assert.equal(left1.roomDeleted, false);
  assert.equal(left1.snapshot?.playerCount, 1);

  const left2 = manager.leaveRoom('c2');
  assert.equal(left2.left, true);
  assert.equal(left2.roomDeleted, true);
  assert.equal(manager.listRooms('').length, 0);
});

test('2D Open-World block placement, removal, solid collisions, and crafting recipes', () => {
  const ow = createOpenWorldState([], null, 'sunrise');
  const startWood = ow.inventory.wood;
  const startStone = ow.inventory.stone;
  const startLantern = ow.inventory.lantern;

  // Place solid wood block & decorative lantern
  const placedWood = placeOpenWorldBlock(ow, 12, 14, 'wood');
  assert.equal(placedWood.ok, true);
  assert.equal(ow.inventory.wood, startWood - 1);

  const placedLantern = placeOpenWorldBlock(ow, 12, 13, 'lantern');
  assert.equal(placedLantern.ok, true);

  // Only solid blocks generate collision platforms
  const baseDef = createOpenWorldLevelDefinition('sunrise');
  const solids = buildOpenWorldSolidPlatforms(baseDef.platforms, ow);
  assert.equal(solids.length, baseDef.platforms.length + 1);
  assert.equal(solids[solids.length - 1].blockType, 'wood');

  // Craft Warm Lantern x2 (cost: 1 wood + 1 stone)
  const crafted = craftOpenWorldItem(ow, 'craft_lantern');
  assert.equal(crafted.ok, true);
  assert.equal(ow.inventory.wood, startWood - 2);
  assert.equal(ow.inventory.stone, startStone - 1);
  assert.equal(ow.inventory.lantern, startLantern - 1 + 2);
  assert.equal(ow.craftedTotal, 1);

  // Removing block refunds material
  const removed = removeOpenWorldBlock(ow, 12, 14);
  assert.equal(removed.ok, true);
  assert.equal(ow.inventory.wood, startWood - 1);
});

test('Cloud WebSocket URL normalization supports ws://, wss://, http://, and https://', () => {
  assert.equal(normalizeWsUrl('wss://nadine-coop.example.com'), 'wss://nadine-coop.example.com/ws');
  assert.equal(normalizeWsUrl('https://nadine-coop.example.com'), 'wss://nadine-coop.example.com/ws');
  assert.equal(normalizeWsUrl('http://192.168.1.42:3000'), 'ws://192.168.1.42:3000/ws');
  assert.equal(normalizeWsUrl('ws://localhost:3000/custom'), 'ws://localhost:3000/custom');
});

test('Live WebSocket Co-op Server syncs 2 players across Story, Open-World blocks/crafting, and Chat while blocking 3rd player', async () => {
  const httpServer = http.createServer();
  const coop = attachCoopWebSocket(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = httpServer.address();
  assert.ok(addr && typeof addr !== 'string');
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  const madjid = await connectTestClient(wsUrl);
  const nadine = await connectTestClient(wsUrl);
  const third = await connectTestClient(wsUrl);

  try {
    await madjid.waitFor((m) => m.type === 'welcome');
    await nadine.waitFor((m) => m.type === 'welcome');
    await third.waitFor((m) => m.type === 'welcome');

    // 1. Madjid creates a room
    madjid.send({
      type: 'room:create',
      name: 'Lantern Harbor Co-op',
      mode: 'story',
      levelIndex: 0,
      character: 'madjid',
    });
    const madjidJoined = await madjid.waitFor((m) => m.type === 'room:joined');
    const createdRoom = madjidJoined.room as { code: string; name: string; playerCount: number };
    assert.equal(madjidJoined.character, 'madjid');
    assert.match(createdRoom.code, /^ND-/);

    // 2. Nadine searches for room by name and joins
    nadine.send({ type: 'room:list', query: 'Harbor' });
    const searchRes = await nadine.waitFor(
      (m) => m.type === 'room:list' && m.query === 'Harbor'
    );
    const listed = searchRes.rooms as Array<{ code: string }>;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].code, createdRoom.code);

    nadine.send({ type: 'room:join', query: createdRoom.code });
    const nadineJoined = await nadine.waitFor((m) => m.type === 'room:joined');
    assert.equal(nadineJoined.character, 'nadine');
    await madjid.waitFor((m) => m.type === 'partner:joined');

    // 3. 3rd player rejected with ROOM_FULL (hard 2-player cap)
    third.send({ type: 'room:join', query: createdRoom.code });
    const rejected = await third.waitFor((m) => m.type === 'error');
    assert.equal(rejected.code, 'ROOM_FULL');

    // 4. Real-time player movement sync
    madjid.send({ type: 'player:state', state: { x: 312, y: 540, facing: 1, grounded: true } });
    const syncedPos = await nadine.waitFor((m) => m.type === 'player:state');
    assert.equal(syncedPos.character, 'madjid');
    assert.equal((syncedPos.state as { x: number }).x, 312);

    // 5. Live text chat sync across both devices
    nadine.send({ type: 'chat:send', id: 'msg-1', text: 'Ready to explore!' });
    const chatOnMadjid = await madjid.waitFor((m) => m.type === 'chat:message');
    const chatOnNadine = await nadine.waitFor((m) => m.type === 'chat:message');
    assert.equal((chatOnMadjid.message as { text: string; senderId: string }).text, 'Ready to explore!');
    assert.equal((chatOnMadjid.message as { senderId: string }).senderId, 'nadine');
    assert.equal((chatOnNadine.message as { text: string }).text, 'Ready to explore!');

    // 6. Switch room to 2D Open-World Mode + sync block placement & crafting
    nadine.send({ type: 'room:mode', mode: 'openworld' });
    const modeOnMadjid = await madjid.waitFor((m) => m.type === 'room:mode');
    assert.equal((modeOnMadjid.room as { mode: string }).mode, 'openworld');

    madjid.send({ type: 'world:action', kind: 'place', gx: 15, gy: 14, blockType: 'wood' });
    const blockOnNadine = await nadine.waitFor(
      (m) => m.type === 'world:updated' && m.kind === 'place'
    );
    assert.equal((blockOnNadine.block as { gx: number; type: string }).gx, 15);
    assert.equal((blockOnNadine.block as { type: string }).type, 'wood');

    nadine.send({ type: 'world:action', kind: 'craft', recipeId: 'craft_lantern' });
    const craftOnMadjid = await madjid.waitFor(
      (m) => m.type === 'world:updated' && m.kind === 'craft'
    );
    assert.equal(craftOnMadjid.recipeId, 'craft_lantern');
    assert.equal(craftOnMadjid.craftedTotal, 1);
  } finally {
    await Promise.all([madjid.close(), nadine.close(), third.close()]);
    await coop.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});
