/**
 * server.ts
 * Cloud-ready HTTP + WebSocket Co-op Server for "Around the World with Nadine".
 *
 * Designed for internet & cloud hosting (Cloud Run, Render, Railway, Fly.io, VPS, LAN):
 * - Serves both HTTP (Vite dev middleware in dev / static dist in prod) and WebSocket
 *   at `/ws` on the same port (`process.env.PORT || 3000`), compatible with `ws://` and `wss://`.
 * - Enforces a strict hard cap of 2 players per room (Madjid & Nadine) via `coop-server-core.js`.
 * - Exposes REST discovery endpoints (`GET /api/rooms?q=...`, `GET /api/health`) with CORS headers.
 */

import http, { type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { createRoomManager } from './src/coop-server-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientMeta {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
}

interface IncomingMessage {
  type?: string;
  query?: string;
  name?: string;
  mode?: string;
  levelIndex?: number;
  character?: string;
  skinId?: string;
  theme?: string;
  customCode?: string;
  state?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  kind?: string;
  gx?: number;
  gy?: number;
  blockType?: string;
  recipeId?: string;
  id?: string;
  text?: string;
  timestamp?: string;
  emoteId?: string;
  x?: number;
  y?: number;
  triggerKind?: string;
  photo?: unknown;
  weather?: string;
  styleId?: string;
  styleName?: string;
  accepted?: boolean;
  boss?: unknown;
  [key: string]: unknown;
}

function safeSend(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function attachCoopWebSocket(httpServer: HttpServer) {
  const manager = createRoomManager();
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Map<string, ClientMeta>();
  let nextClientSeq = 1;

  function sendToIds(ids: string[], payload: Record<string, unknown>): void {
    for (let i = 0; i < ids.length; i++) {
      const target = clients.get(ids[i]);
      if (target) safeSend(target.ws, payload);
    }
  }

  function broadcastLobbyDirectory(): void {
    const rooms = manager.listRooms('');
    clients.forEach((client) => {
      if (!manager.getRoomForClient(client.id)) {
        safeSend(client.ws, { type: 'room:list', query: '', rooms });
      }
    });
  }

  // Cloud proxy keep-alive ping/pong (prevents idle disconnects on Cloud Run / Render / Fly)
  const heartbeat = setInterval(() => {
    clients.forEach((client) => {
      if (!client.isAlive) {
        client.ws.terminate();
        return;
      }
      client.isAlive = false;
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping();
      }
    });
  }, 25000);
  heartbeat.unref?.();

  wss.on('connection', (ws: WebSocket) => {
    const clientId = `p_${nextClientSeq++}_${Math.random().toString(36).slice(2, 6)}`;
    const meta: ClientMeta = { id: clientId, ws, isAlive: true };
    clients.set(clientId, meta);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    safeSend(ws, {
      type: 'welcome',
      clientId,
      rooms: manager.listRooms(''),
    });

    ws.on('message', (raw) => {
      meta.isAlive = true;
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(String(raw)) as IncomingMessage;
      } catch {
        safeSend(ws, { type: 'error', code: 'BAD_JSON', message: 'Malformed JSON payload.' });
        return;
      }

      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'ping': {
          safeSend(ws, { type: 'pong', t: Date.now() });
          break;
        }

        case 'room:list': {
          const query = typeof msg.query === 'string' ? msg.query : '';
          safeSend(ws, {
            type: 'room:list',
            query,
            rooms: manager.listRooms(query),
          });
          break;
        }

        case 'room:create': {
          const res = manager.createRoom(clientId, {
            name: msg.name,
            mode: msg.mode,
            levelIndex: msg.levelIndex,
            character: msg.character,
            skinId: msg.skinId,
            theme: msg.theme,
            customCode: msg.customCode,
          });
          if (!res.ok) {
            safeSend(ws, { type: 'error', code: res.error, message: res.message });
            return;
          }
          safeSend(ws, {
            type: 'room:joined',
            clientId,
            character: res.character,
            room: res.room,
          });
          broadcastLobbyDirectory();
          break;
        }

        case 'room:join': {
          const res = manager.joinRoom(clientId, msg.query || '', {
            character: msg.character,
            skinId: msg.skinId,
          });
          if (!res.ok) {
            safeSend(ws, { type: 'error', code: res.error, message: res.message });
            return;
          }
          safeSend(ws, {
            type: 'room:joined',
            clientId,
            character: res.character,
            room: res.room,
          });
          const peers = manager.getPeerClientIds(clientId);
          sendToIds(peers, {
            type: 'partner:joined',
            character: res.character,
            room: res.room,
          });
          broadcastLobbyDirectory();
          break;
        }

        case 'room:leave': {
          const res = manager.leaveRoom(clientId);
          safeSend(ws, { type: 'room:left', code: res.code || null });
          if (res.left && !res.roomDeleted && res.remainingClientIds && res.remainingClientIds.length > 0) {
            sendToIds(res.remainingClientIds, {
              type: 'partner:left',
              character: res.departed?.character || null,
              room: res.snapshot,
            });
          }
          broadcastLobbyDirectory();
          break;
        }

        case 'room:mode': {
          const res = manager.updateRoomMode(clientId, {
            mode: msg.mode,
            levelIndex: msg.levelIndex,
            theme: msg.theme,
          });
          if (!res.ok) {
            safeSend(ws, { type: 'error', code: res.error, message: 'Join a room first.' });
            return;
          }
          sendToIds(res.memberClientIds || [], {
            type: 'room:mode',
            room: res.room,
          });
          broadcastLobbyDirectory();
          break;
        }

        case 'player:state': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player || !msg.state || typeof msg.state !== 'object') return;
          const peers = manager.getPeerClientIds(clientId);
          if (peers.length === 0) return;
          sendToIds(peers, {
            type: 'player:state',
            character: player.character,
            state: msg.state,
          });
          break;
        }

        case 'story:sync': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player || !msg.payload || typeof msg.payload !== 'object') return;
          if (typeof msg.payload.levelIndex === 'number' && Number.isInteger(msg.payload.levelIndex)) {
            manager.updateRoomMode(clientId, {
              mode: undefined,
              levelIndex: msg.payload.levelIndex,
              theme: undefined,
            });
          }
          const peers = manager.getPeerClientIds(clientId);
          if (peers.length === 0) return;
          sendToIds(peers, {
            type: 'story:sync',
            fromCharacter: player.character,
            payload: msg.payload,
          });
          break;
        }

        case 'world:action': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player) {
            safeSend(ws, { type: 'error', code: 'NOT_IN_ROOM', message: 'Not inside a co-op room.' });
            return;
          }
          const res = manager.applyOpenWorldAction(clientId, {
            kind: msg.kind,
            gx: msg.gx,
            gy: msg.gy,
            blockType: msg.blockType,
            recipeId: msg.recipeId,
            theme: msg.theme,
          }) as {
            ok: boolean;
            error?: string;
            reason?: string;
            kind?: string;
            block?: Record<string, unknown>;
            gx?: number;
            gy?: number;
            recipeId?: string;
            theme?: string;
            inventory?: Record<string, number>;
            craftedTotal?: number;
            memberClientIds?: string[];
          };
          if (!res.ok) {
            safeSend(ws, {
              type: 'error',
              code: res.error || res.reason || 'WORLD_ACTION_FAILED',
              message: 'Could not apply open-world action.',
            });
            return;
          }
          sendToIds(res.memberClientIds || [], {
            type: 'world:updated',
            actorCharacter: player.character,
            kind: res.kind,
            block: res.block || null,
            gx: res.gx,
            gy: res.gy,
            recipeId: res.recipeId || null,
            theme: res.theme || null,
            inventory: res.inventory || null,
            craftedTotal: res.craftedTotal,
          });
          break;
        }

        case 'skin:update': {
          const res = manager.updatePlayerSkin(clientId, msg.skinId || '');
          if (!res.ok) return;
          const peers = manager.getPeerClientIds(clientId);
          sendToIds(peers, {
            type: 'skin:updated',
            character: res.character,
            skinId: res.skinId,
          });
          break;
        }

        case 'chat:send': {
          const res = manager.appendChatMessage(clientId, {
            id: msg.id,
            text: msg.text,
            timestamp: msg.timestamp,
          });
          if (!res.ok || res.idempotent) return;
          sendToIds(res.memberClientIds || [], {
            type: 'chat:message',
            message: res.message,
          });
          break;
        }

        case 'player:emote': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player || typeof msg.emoteId !== 'string') return;
          const allowed = new Set(['heart', 'wave', 'cheer', 'ping']);
          if (!allowed.has(msg.emoteId)) return;
          const memberIds = [clientId, ...manager.getPeerClientIds(clientId)];
          sendToIds(memberIds, {
            type: 'player:emote',
            character: player.character,
            emoteId: msg.emoteId,
            x: typeof msg.x === 'number' ? Math.round(msg.x) : null,
            y: typeof msg.y === 'number' ? Math.round(msg.y) : null,
            t: Date.now(),
          });
          break;
        }

        case 'world:trigger': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player || typeof msg.triggerKind !== 'string') return;
          const peers = manager.getPeerClientIds(clientId);
          if (peers.length === 0) return;
          sendToIds(peers, {
            type: 'world:trigger',
            character: player.character,
            triggerKind: msg.triggerKind,
            x: typeof msg.x === 'number' ? Math.round(msg.x) : null,
            y: typeof msg.y === 'number' ? Math.round(msg.y) : null,
          });
          break;
        }

        case 'ghost:sync':
        case 'carry:sync':
        case 'dance:sync':
        case 'dance:invite':
        case 'dance:respond':
        case 'boss:sync':
        case 'weather:sync': {
          const player = manager.getPlayerInRoom(clientId);
          if (!player) return;
          const peers = manager.getPeerClientIds(clientId);
          if (peers.length === 0) return;
          sendToIds(peers, {
            ...msg,
            fromCharacter: player.character,
          });
          break;
        }

        case 'photo:snap': {
          const res = manager.appendScrapbookPhoto(clientId, msg.photo);
          if (!res.ok) return;
          sendToIds(res.memberClientIds || [], {
            type: 'scrapbook:updated',
            photo: res.photo,
            scrapbook: res.scrapbook,
          });
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      const res = manager.leaveRoom(clientId);
      if (res.left && !res.roomDeleted && res.remainingClientIds && res.remainingClientIds.length > 0) {
        sendToIds(res.remainingClientIds, {
          type: 'partner:left',
          character: res.departed?.character || null,
          room: res.snapshot,
        });
      }
      broadcastLobbyDirectory();
    });
  });

  function close(): Promise<void> {
    clearInterval(heartbeat);
    clients.forEach((client) => {
      try {
        client.ws.terminate();
      } catch {
        // Ignore termination error during shutdown
      }
    });
    clients.clear();
    return new Promise((resolve) => {
      wss.close(() => resolve());
    });
  }

  return { wss, manager, close };
}

export function createCoopApp(): {
  app: Express;
  httpServer: HttpServer;
  coop: ReturnType<typeof attachCoopWebSocket>;
} {
  const app = express();
  app.use(express.json());

  // Cloud / cross-device CORS headers for room discovery REST routes
  app.use('/api', (_req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  const httpServer = http.createServer(app);
  const coop = attachCoopWebSocket(httpServer);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'nadine-coop-server',
      wsPath: '/ws',
      maxPlayersPerRoom: 2,
      activeRooms: coop.manager.listRooms('').length,
    });
  });

  app.get('/api/rooms', (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({
      rooms: coop.manager.listRooms(query),
      maxPlayersPerRoom: 2,
    });
  });

  return { app, httpServer, coop };
}

async function startServer(): Promise<void> {
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const { app, httpServer } = createCoopApp();

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(
      `[Nadine Co-op Server] Listening on http://0.0.0.0:${port} (WebSocket endpoint: /ws, max 2 players/room)`
    );
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[Nadine Co-op Server] Failed to start:', err);
    process.exit(1);
  });
}
