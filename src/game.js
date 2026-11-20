/**
 * src/game.js
 * Core 60+ FPS Cooperative 2D Puzzle-Platformer Engine for
 * "Around the World with Nadine".
 *
 * Cleanly decoupled architecture:
 * - Pure exported simulation (`createInitialLevelState`, `stepSimulation`, `isSafeForAffection`)
 *   accepting per-character intent slots so a 2-player WebSocket adapter can be
 *   plugged in effortlessly without altering physics, skins, audio, or level logic.
 * - Supports 10 Worlds / 50 Levels, lantern checkpoints, hazards, patrol enemies,
 *   cry-on-death + checkpoint respawn, gentle safe-state automatic kiss & cozy idle
 *   interactions, smooth camera look-ahead, and zero-GC pooled particles.
 */

import {
  SKINS,
  getDefaultSkinId,
  getSkin,
  getSkinsForCharacter,
  renderCharacter,
  renderSkinPreview,
} from './skins.js';
import { createBackgroundSystem, TIME_PRESETS } from './background.js';
import { createAudioEngine } from './audio.js';
import {
  LEVELS,
  STORY_PREMISE,
  WORLDS,
  getLevelsForWorld,
  getWorldById,
} from './levels.js';
import {
  CRAFT_RECIPES,
  OPEN_WORLD_BLOCKS,
  OPEN_WORLD_CONFIG,
  blockKey,
  buildOpenWorldSolidPlatforms,
  canCraftRecipe,
  craftOpenWorldItem,
  createOpenWorldLevelDefinition,
  createOpenWorldState,
  isValidBlockCoord,
  placeOpenWorldBlock,
  removeOpenWorldBlock,
  renderOpenWorldBlocks,
} from './openworld.js';
import { createCoopClient, getDefaultWsUrl } from './coop-client.js';

export const PHYSICS = {
  CHAR_W: 34,
  CHAR_H: 36,
  MOVE_SPEED: 270,
  GROUND_ACCEL: 2450,
  GROUND_FRICTION: 2250,
  AIR_ACCEL: 1750,
  AIR_DRAG: 420,
  GRAVITY: 1380,
  MAX_FALL_SPEED: 780,
  JUMP_VY: -575,
  JUMP_CUT_MULT: 0.48,
  COYOTE_TIME: 0.11,
  JUMP_BUFFER_TIME: 0.11,
  MAX_DT: 0.05,
};

export const AFFECTION = {
  MAX_DIST: 72,
  MAX_DY: 14,
  ENEMY_SAFE_RADIUS: 165,
  HAZARD_SAFE_RADIUS: 85,
  CALM_DELAY: 0.65,
  KISS_DURATION: 1.25,
  KISS_COOLDOWN: 7.5,
  IDLE_BOUNCE_INTERVAL: 3.6,
};

export function createEmptyIntent() {
  return {
    left: false,
    right: false,
    jumpHeld: false,
    jumpJustPressed: false,
    jumpJustReleased: false,
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

function hasActiveMovementIntent(intent) {
  if (!intent) return false;
  return Boolean(intent.left || intent.right || intent.jumpHeld || intent.jumpJustPressed);
}

function createActor(id, name, spawn) {
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    w: PHYSICS.CHAR_W,
    h: PHYSICS.CHAR_H,
    vx: 0,
    vy: 0,
    facing: id === 'madjid' ? 1 : -1,
    grounded: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    scaleX: 1,
    scaleY: 1,
    walkDist: 0,
    blinkTimer: id === 'madjid' ? 2.4 : 1.6,
    inPortal: false,
    ridingPlatformId: null,
    safeX: spawn.x,
    safeY: spawn.y,
    hurtTimer: 0,
    invulnTimer: 0,
    tearEmitTimer: 0,
    fellOutOfWorld: false,
    kissLean: 0,
    mood: 'normal',
    happyPulseTimer: 0,
  };
}

/**
 * Creates a clean, deterministic mutable simulation state for a level definition.
 */
export function createInitialLevelState(level) {
  return {
    levelId: level.id,
    worldId: level.worldId || 1,
    code: level.code || `1-${level.id}`,
    worldWidth: level.worldWidth,
    worldHeight: level.worldHeight,
    elapsed: 0,
    completed: false,
    switchesTriggeredCount: 0,
    keysCollected: 0,
    keysRequired: level.exit.keysRequired,
    portalUnlocked: level.exit.keysRequired === 0,
    spawns: {
      madjid: { ...level.spawns.madjid },
      nadine: { ...level.spawns.nadine },
    },
    activeCheckpoint: null,
    calmTimer: 0,
    kissTimer: 0,
    kissCooldown: 1.8,
    kissCount: 0,
    idleBounceTimer: 3.2,
    cryCount: 0,
    actors: {
      madjid: createActor('madjid', 'Madjid', level.spawns.madjid),
      nadine: createActor('nadine', 'Nadine', level.spawns.nadine),
    },
    platforms: level.platforms.map((p) => ({ ...p })),
    switches: level.switches.map((s) => ({
      ...s,
      h: 12,
      pressed: false,
      toggled: false,
      wasOccupied: false,
      pressDepth: 0,
    })),
    movingPlatforms: level.movingPlatforms.map((mp) => ({
      ...mp,
      x: mp.startX,
      y: mp.startY,
      dx: 0,
      dy: 0,
      patrolDir: 1,
      progress: 0,
    })),
    gates: level.gates.map((g) => ({
      ...g,
      closedX: g.x,
      closedY: g.y,
      openProgress: 0,
      latchedOpen: false,
      wasOpen: false,
    })),
    keys: level.keys.map((k) => ({
      ...k,
      collected: false,
      bobPhase: k.x * 0.03,
    })),
    checkpoints: (level.checkpoints || []).map((cp) => ({
      ...cp,
      activated: false,
      pulse: 0,
    })),
    hazards: (level.hazards || []).map((hz) => ({
      ...hz,
    })),
    enemies: (level.enemies || []).map((en) => ({
      ...en,
      dir: en.dir || 1,
      turnPause: 0,
      animPhase: en.x * 0.05,
    })),
    exit: {
      ...level.exit,
    },
    decorations: (level.decorations || []).map((d) => ({ ...d })),
  };
}

function isSwitchActive(sw) {
  return sw.mode === 'toggle' ? sw.toggled : sw.pressed;
}

function checkSwitchGroup(state, switchIds, requireAll = false) {
  if (!switchIds || switchIds.length === 0) return false;
  if (requireAll) {
    return switchIds.every((id) => {
      const sw = state.switches.find((s) => s.id === id);
      return sw ? isSwitchActive(sw) : false;
    });
  }
  return switchIds.some((id) => {
    const sw = state.switches.find((s) => s.id === id);
    return sw ? isSwitchActive(sw) : false;
  });
}

function getSolidObstacles(state) {
  const solids = [];
  for (let i = 0; i < state.platforms.length; i++) {
    solids.push({ ...state.platforms[i], isMoving: false, id: null });
  }
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    solids.push({ x: mp.x, y: mp.y, w: mp.w, h: mp.h, isMoving: true, id: mp.id, dx: mp.dx, dy: mp.dy });
  }
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    if (g.openProgress < 0.92) {
      solids.push({ x: g.x, y: g.y, w: g.w, h: g.h, isMoving: false, id: g.id });
    }
  }
  return solids;
}

function getRespawnPosition(state, actorId) {
  if (state.activeCheckpoint && state.activeCheckpoint[actorId]) {
    return state.activeCheckpoint[actorId];
  }
  return state.spawns[actorId];
}

function triggerActorCry(state, actor, partner, callbacks, fromPit = false) {
  if (actor.hurtTimer > 0) return;
  state.kissTimer = 0;
  state.calmTimer = 0;
  actor.kissLean = 0;
  if (partner) partner.kissLean = 0;

  state.cryCount += 1;
  actor.mood = 'crying';
  actor.tearEmitTimer = 0.03;
  actor.coyoteTimer = 0;
  actor.jumpBufferTimer = 0;
  actor.ridingPlatformId = null;

  if (partner && partner.hurtTimer <= 0) {
    partner.mood = 'worried';
  }

  if (fromPit) {
    const dest = getRespawnPosition(state, actor.id);
    actor.x = dest.x;
    actor.y = dest.y;
    actor.vx = 0;
    actor.vy = 0;
    actor.grounded = false;
    actor.hurtTimer = 0.68;
    actor.invulnTimer = 1.45;
    actor.fellOutOfWorld = true;
    actor.scaleX = 1.18;
    actor.scaleY = 0.84;
    callbacks.onCry?.(actor);
    callbacks.onRespawn?.(actor);
  } else {
    actor.hurtTimer = 0.85;
    actor.fellOutOfWorld = false;
    actor.vx = -(actor.facing || 1) * 48;
    actor.vy = -170;
    actor.grounded = false;
    actor.scaleX = 0.86;
    actor.scaleY = 1.16;
    callbacks.onCry?.(actor);
  }
}

/**
 * Pure check determining whether Madjid and Nadine are standing calmly together
 * in a safe state (no nearby patrol enemies or hazards, not dying/moving).
 */
export function isSafeForAffection(state, inputsByChar = null) {
  if (!state || state.completed) return false;
  const madjid = state.actors.madjid;
  const nadine = state.actors.nadine;
  if (!madjid || !nadine) return false;

  if (madjid.hurtTimer > 0 || nadine.hurtTimer > 0) return false;
  if (!madjid.grounded || !nadine.grounded) return false;
  if (Math.abs(madjid.vx) > 28 || Math.abs(nadine.vx) > 28) return false;

  if (inputsByChar) {
    if (hasActiveMovementIntent(inputsByChar.madjid) || hasActiveMovementIntent(inputsByChar.nadine)) {
      return false;
    }
  }

  const mcx = madjid.x + madjid.w * 0.5;
  const mcy = madjid.y + madjid.h * 0.5;
  const ncx = nadine.x + nadine.w * 0.5;
  const ncy = nadine.y + nadine.h * 0.5;

  if (Math.abs(mcx - ncx) > AFFECTION.MAX_DIST) return false;
  if (Math.abs(madjid.y - nadine.y) > AFFECTION.MAX_DY) return false;

  // Check proximity to any active patrol enemy
  for (let i = 0; i < state.enemies.length; i++) {
    const en = state.enemies[i];
    const ecx = en.x + en.w * 0.5;
    const ecy = en.y + en.h * 0.5;
    if (
      Math.hypot(ecx - mcx, ecy - mcy) < AFFECTION.ENEMY_SAFE_RADIUS ||
      Math.hypot(ecx - ncx, ecy - ncy) < AFFECTION.ENEMY_SAFE_RADIUS
    ) {
      return false;
    }
  }

  // Check proximity to any immediate hazard
  for (let i = 0; i < state.hazards.length; i++) {
    const hz = state.hazards[i];
    const hcx = hz.x + hz.w * 0.5;
    const hcy = hz.y + hz.h * 0.5;
    if (
      Math.hypot(hcx - mcx, hcy - mcy) < AFFECTION.HAZARD_SAFE_RADIUS ||
      Math.hypot(hcx - ncx, hcy - ncy) < AFFECTION.HAZARD_SAFE_RADIUS
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Pure simulation tick — advances moving platforms, gates, patrol enemies, both actors,
 * checkpoints, hazards, cry-on-death + checkpoint respawn, switches, keys,
 * safe-state automatic kiss / cozy idle interactions, and exit portal completion.
 */
export function stepSimulation(state, inputsByChar, rawDt, callbacks = {}) {
  const dt = Math.min(Math.max(rawDt, 0), PHYSICS.MAX_DT);
  if (state.completed || dt <= 0) return state;

  state.elapsed += dt;

  // 1. Update Moving Platforms & Track Deltas
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    const prevX = mp.x;
    const prevY = mp.y;

    const patrolActive = mp.patrolSwitches ? checkSwitchGroup(state, mp.patrolSwitches, false) : false;
    const directActive = checkSwitchGroup(state, mp.switches, mp.requireAll);

    let targetX = mp.startX;
    let targetY = mp.startY;

    if (patrolActive) {
      targetX = mp.patrolDir > 0 ? mp.endX : mp.startX;
      targetY = mp.patrolDir > 0 ? mp.endY : mp.startY;
      const distToTarget = Math.hypot(targetX - mp.x, targetY - mp.y);
      if (distToTarget < 2) {
        mp.patrolDir *= -1;
        targetX = mp.patrolDir > 0 ? mp.endX : mp.startX;
        targetY = mp.patrolDir > 0 ? mp.endY : mp.startY;
      }
    } else if (directActive) {
      targetX = mp.endX;
      targetY = mp.endY;
    }

    const toX = targetX - mp.x;
    const toY = targetY - mp.y;
    const dist = Math.hypot(toX, toY);
    const step = mp.speed * dt;
    if (dist <= step || dist === 0) {
      mp.x = targetX;
      mp.y = targetY;
    } else {
      mp.x += (toX / dist) * step;
      mp.y += (toY / dist) * step;
    }

    mp.dx = mp.x - prevX;
    mp.dy = mp.y - prevY;
  }

  // 2. Update Gates
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    const triggered = checkSwitchGroup(state, g.switches, g.requireAll);
    if (triggered && g.latchOnOpen && !g.latchedOpen) {
      g.latchedOpen = true;
      callbacks.onGateUnseal?.(g);
    }
    const shouldOpen = g.latchedOpen || triggered;
    if (shouldOpen && !g.wasOpen) {
      g.wasOpen = true;
      callbacks.onGateOpen?.(g);
    } else if (!shouldOpen && g.wasOpen) {
      g.wasOpen = false;
    }

    const maxTravel = Math.max(1, Math.hypot(g.openOffsetX, g.openOffsetY));
    const rate = g.speed / maxTravel;
    g.openProgress = approach(g.openProgress, shouldOpen ? 1 : 0, rate * dt);
    g.x = g.closedX + g.openOffsetX * g.openProgress;
    g.y = g.closedY + g.openOffsetY * g.openProgress;
  }

  // 3. Update Patrol Enemies
  for (let i = 0; i < state.enemies.length; i++) {
    const en = state.enemies[i];
    en.animPhase += dt * 7.5;
    if (en.turnPause > 0) {
      en.turnPause = Math.max(0, en.turnPause - dt);
    } else {
      en.x += en.dir * en.speed * dt;
      if (en.x <= en.minX) {
        en.x = en.minX;
        en.dir = 1;
        en.turnPause = 0.16;
      } else if (en.x >= en.maxX) {
        en.x = en.maxX;
        en.dir = -1;
        en.turnPause = 0.16;
      }
    }
  }

  // Decay checkpoint activation glow pulses
  for (let i = 0; i < state.checkpoints.length; i++) {
    if (state.checkpoints[i].pulse > 0) {
      state.checkpoints[i].pulse = Math.max(0, state.checkpoints[i].pulse - dt * 1.6);
    }
  }

  const solids = getSolidObstacles(state);
  const actorOrder = ['madjid', 'nadine'];

  // 4. Apply Moving Platform Carry Before Physics Integration
  for (let i = 0; i < actorOrder.length; i++) {
    const actor = state.actors[actorOrder[i]];
    if (actor.hurtTimer <= 0 && actor.grounded && actor.ridingPlatformId) {
      const mp = state.movingPlatforms.find((p) => p.id === actor.ridingPlatformId);
      if (mp) {
        actor.x += mp.dx;
        actor.y += mp.dy;
      }
    }
  }

  // 5. Integrate Each Character Independently Using Its Input Intent Slot
  for (let i = 0; i < actorOrder.length; i++) {
    const id = actorOrder[i];
    const actor = state.actors[id];
    const partner = state.actors[id === 'madjid' ? 'nadine' : 'madjid'];
    const intent = inputsByChar[id] || createEmptyIntent();

    // Timers & spring recovery
    actor.blinkTimer -= dt;
    if (actor.blinkTimer <= 0) {
      actor.blinkTimer = 2.2 + ((actor.x * 0.017 + state.elapsed) % 2.4);
    }
    if (actor.invulnTimer > 0) {
      actor.invulnTimer = Math.max(0, actor.invulnTimer - dt);
    }
    if (actor.happyPulseTimer > 0) {
      actor.happyPulseTimer = Math.max(0, actor.happyPulseTimer - dt);
    }
    const spring = Math.min(1, dt * 13);
    actor.scaleX += (1 - actor.scaleX) * spring;
    actor.scaleY += (1 - actor.scaleY) * spring;

    // Cry-on-death timer & checkpoint respawn progression
    if (actor.hurtTimer > 0) {
      actor.hurtTimer = Math.max(0, actor.hurtTimer - dt);
      actor.mood = 'crying';
      actor.tearEmitTimer -= dt;
      if (actor.tearEmitTimer <= 0) {
        actor.tearEmitTimer = 0.14;
        callbacks.onTear?.(actor);
      }

      // Gentle deceleration + gravity while crying so actor never clips floors
      actor.vx = approach(actor.vx, 0, PHYSICS.GROUND_FRICTION * 0.55 * dt);
      actor.vy = Math.min(PHYSICS.MAX_FALL_SPEED, actor.vy + PHYSICS.GRAVITY * dt);

      actor.x = clamp(actor.x + actor.vx * dt, 4, state.worldWidth - 4 - actor.w);
      for (let s = 0; s < solids.length; s++) {
        const box = solids[s];
        if (rectsOverlap(actor, box)) {
          if (actor.vx > 0) actor.x = box.x - actor.w;
          else if (actor.vx < 0) actor.x = box.x + box.w;
          actor.vx = 0;
        }
      }

      actor.y += actor.vy * dt;
      actor.grounded = false;
      for (let s = 0; s < solids.length; s++) {
        const box = solids[s];
        if (rectsOverlap(actor, box)) {
          if (actor.vy >= 0) {
            actor.y = box.y - actor.h;
            actor.vy = 0;
            actor.grounded = true;
          } else {
            actor.y = box.y + box.h;
            actor.vy = 0;
          }
        }
      }

      if (actor.hurtTimer <= 0) {
        if (!actor.fellOutOfWorld) {
          const dest = getRespawnPosition(state, actor.id);
          actor.x = dest.x;
          actor.y = dest.y;
          actor.vx = 0;
          actor.vy = 0;
          actor.grounded = false;
          actor.invulnTimer = 1.15;
          actor.scaleX = 1.16;
          actor.scaleY = 0.86;
          callbacks.onRespawn?.(actor);
        }
        actor.fellOutOfWorld = false;
        actor.mood = 'normal';
      }
      continue;
    }

    // Horizontal acceleration & smooth friction
    const moveDir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
    if (moveDir !== 0) {
      actor.facing = moveDir;
      const accel = actor.grounded ? PHYSICS.GROUND_ACCEL : PHYSICS.AIR_ACCEL;
      actor.vx = approach(actor.vx, moveDir * PHYSICS.MOVE_SPEED, accel * dt);
    } else {
      const decel = actor.grounded ? PHYSICS.GROUND_FRICTION : PHYSICS.AIR_DRAG;
      actor.vx = approach(actor.vx, 0, decel * dt);
    }

    // Coyote time & jump buffering (~110ms each)
    if (actor.grounded) {
      actor.coyoteTimer = PHYSICS.COYOTE_TIME;
    } else {
      actor.coyoteTimer = Math.max(0, actor.coyoteTimer - dt);
    }

    if (intent.jumpJustPressed) {
      actor.jumpBufferTimer = PHYSICS.JUMP_BUFFER_TIME;
    } else {
      actor.jumpBufferTimer = Math.max(0, actor.jumpBufferTimer - dt);
    }

    // Execute buffered jump if within coyote window
    if (actor.jumpBufferTimer > 0 && actor.coyoteTimer > 0) {
      actor.vy = PHYSICS.JUMP_VY;
      actor.grounded = false;
      actor.ridingPlatformId = null;
      actor.coyoteTimer = 0;
      actor.jumpBufferTimer = 0;
      actor.scaleX = 0.82;
      actor.scaleY = 1.22;
      callbacks.onJump?.(actor);
    }

    // Variable jump height cut when jump is released while ascending
    if (intent.jumpJustReleased && actor.vy < -170) {
      actor.vy *= PHYSICS.JUMP_CUT_MULT;
    }

    // Gravity
    actor.vy = Math.min(PHYSICS.MAX_FALL_SPEED, actor.vy + PHYSICS.GRAVITY * dt);

    // Move & resolve X axis
    const prevX = actor.x;
    actor.x += actor.vx * dt;
    if (actor.x < 4) {
      actor.x = 4;
      actor.vx = 0;
    } else if (actor.x + actor.w > state.worldWidth - 4) {
      actor.x = state.worldWidth - 4 - actor.w;
      actor.vx = 0;
    }

    for (let s = 0; s < solids.length; s++) {
      const box = solids[s];
      if (rectsOverlap(actor, box)) {
        if (actor.vx > 0) {
          actor.x = box.x - actor.w;
          actor.vx = 0;
        } else if (actor.vx < 0) {
          actor.x = box.x + box.w;
          actor.vx = 0;
        }
      }
    }

    // Move & resolve Y axis
    const wasGrounded = actor.grounded;
    const prevBottom = actor.y + actor.h;
    const fallVy = actor.vy;
    actor.y += actor.vy * dt;
    actor.grounded = false;
    actor.ridingPlatformId = null;

    for (let s = 0; s < solids.length; s++) {
      const box = solids[s];
      if (rectsOverlap(actor, box)) {
        if (actor.vy >= 0) {
          actor.y = box.y - actor.h;
          actor.vy = 0;
          actor.grounded = true;
          if (box.isMoving) {
            actor.ridingPlatformId = box.id;
          } else {
            actor.safeX = actor.x;
            actor.safeY = actor.y;
          }
        } else if (actor.vy < 0) {
          actor.y = box.y + box.h;
          actor.vy = 0;
        }
      }
    }

    // Optional joyful cooperative piggyback: can gently stand on partner's head
    if (!actor.grounded && actor.vy >= 0 && partner && partner.hurtTimer <= 0) {
      const horizOverlap = actor.x + actor.w - 4 > partner.x && actor.x + 4 < partner.x + partner.w;
      if (horizOverlap && prevBottom <= partner.y + 8 && actor.y + actor.h >= partner.y) {
        actor.y = partner.y - actor.h;
        actor.vy = 0;
        actor.grounded = true;
        actor.ridingPlatformId = partner.ridingPlatformId;
      }
    }

    // Landing squash-and-stretch + audio/dust cue
    if (!wasGrounded && actor.grounded && fallVy > 140) {
      const impact = Math.min(1, fallVy / 540);
      actor.scaleX = 1 + 0.24 * impact;
      actor.scaleY = 1 - 0.22 * impact;
      callbacks.onLand?.(actor, impact);
    }

    // Gait-synced walk cycle distance
    if (actor.grounded) {
      actor.walkDist += Math.abs(actor.x - prevX);
    }

    // Canyon fall -> cry + checkpoint respawn
    if (actor.y > state.worldHeight + 48) {
      triggerActorCry(state, actor, partner, callbacks, true);
    }
  }

  const actorList = [state.actors.madjid, state.actors.nadine];

  // 6. Checkpoints Activation (Lantern Posts)
  for (let c = 0; c < state.checkpoints.length; c++) {
    const cp = state.checkpoints[c];
    const cpBox = { x: cp.x - 24, y: cp.y - 56, w: 48, h: 56 };
    const visitor = actorList.find((a) => a.hurtTimer <= 0 && rectsOverlap(a, cpBox));
    if (visitor) {
      const respawnPayload = {
        id: cp.id,
        x: cp.x,
        y: cp.y,
        madjid: {
          x: clamp(cp.x - 28, 8, state.worldWidth - PHYSICS.CHAR_W - 8),
          y: cp.y - PHYSICS.CHAR_H,
        },
        nadine: {
          x: clamp(cp.x + 8, 8, state.worldWidth - PHYSICS.CHAR_W - 8),
          y: cp.y - PHYSICS.CHAR_H,
        },
      };
      if (!cp.activated) {
        cp.activated = true;
        cp.pulse = 1;
        state.activeCheckpoint = respawnPayload;
        callbacks.onCheckpoint?.(cp, visitor);
      } else if (!state.activeCheckpoint || state.activeCheckpoint.id !== cp.id) {
        state.activeCheckpoint = respawnPayload;
      }
    }
  }

  // 7. Hazards & Patrol Enemy Collisions -> Cry-on-Death + Checkpoint Respawn
  for (let i = 0; i < actorList.length; i++) {
    const actor = actorList[i];
    if (actor.hurtTimer > 0 || actor.invulnTimer > 0) continue;
    const partner = actor.id === 'madjid' ? state.actors.nadine : state.actors.madjid;

    let hitDanger = false;
    for (let h = 0; h < state.hazards.length; h++) {
      const hz = state.hazards[h];
      const hzBox = { x: hz.x + 4, y: hz.y + 3, w: Math.max(8, hz.w - 8), h: Math.max(6, hz.h - 3) };
      if (rectsOverlap(actor, hzBox)) {
        hitDanger = true;
        break;
      }
    }

    if (!hitDanger) {
      for (let e = 0; e < state.enemies.length; e++) {
        const en = state.enemies[e];
        const enBox = { x: en.x + 4, y: en.y + 4, w: Math.max(10, en.w - 8), h: Math.max(10, en.h - 4) };
        if (rectsOverlap(actor, enBox)) {
          hitDanger = true;
          break;
        }
      }
    }

    if (hitDanger) {
      triggerActorCry(state, actor, partner, callbacks, false);
    }
  }

  // 8. Evaluate Pressure Switches (Hold & Toggle Modes)
  for (let i = 0; i < state.switches.length; i++) {
    const sw = state.switches[i];
    const plateBox = { x: sw.x, y: sw.y - 12, w: sw.w, h: 14 };
    const occupied = actorList.some((a) => a.hurtTimer <= 0 && rectsOverlap(a, plateBox));

    if (sw.mode === 'toggle') {
      if (occupied && !sw.wasOccupied) {
        sw.toggled = !sw.toggled;
        state.switchesTriggeredCount += 1;
        callbacks.onSwitchToggle?.(sw, sw.toggled);
      }
      sw.pressed = sw.toggled;
    } else {
      if (occupied && !sw.pressed) {
        state.switchesTriggeredCount += 1;
        callbacks.onSwitchPress?.(sw);
      } else if (!occupied && sw.pressed) {
        callbacks.onSwitchRelease?.(sw);
      }
      sw.pressed = occupied;
    }

    sw.wasOccupied = occupied;
    sw.pressDepth = approach(sw.pressDepth, isSwitchActive(sw) ? 1 : 0, dt * 10);
  }

  // 9. Key Pickups & Exit Portal Unlock
  for (let i = 0; i < state.keys.length; i++) {
    const key = state.keys[i];
    if (key.collected) continue;
    const keyBox = { x: key.x - 16, y: key.y - 16, w: 32, h: 32 };
    const picker = actorList.find((a) => a.hurtTimer <= 0 && rectsOverlap(a, keyBox));
    if (picker) {
      key.collected = true;
      state.keysCollected += 1;
      callbacks.onKeyPickup?.(key, picker);
      if (!state.portalUnlocked && state.keysCollected >= state.keysRequired) {
        state.portalUnlocked = true;
        callbacks.onPortalUnlock?.(state.exit);
      }
    }
  }

  // 10. Exit Portal Check (Requires BOTH Madjid and Nadine Inside When Unlocked)
  const portalBox = {
    x: state.exit.x + 8,
    y: state.exit.y + 10,
    w: state.exit.w - 16,
    h: state.exit.h - 10,
  };
  for (let i = 0; i < actorList.length; i++) {
    const actor = actorList[i];
    const wasIn = actor.inPortal;
    actor.inPortal = actor.hurtTimer <= 0 && rectsOverlap(actor, portalBox);
    if (actor.inPortal && !wasIn && state.portalUnlocked) {
      callbacks.onPortalEnter?.(actor);
    }
  }

  if (state.portalUnlocked && state.actors.madjid.inPortal && state.actors.nadine.inPortal) {
    state.completed = true;
    callbacks.onLevelComplete?.(state);
    return state;
  }

  // 11. Gentle Automatic Kiss & Warm Cozy Safe-State Interactions
  state.kissCooldown = Math.max(0, state.kissCooldown - dt);
  const madjid = state.actors.madjid;
  const nadine = state.actors.nadine;
  const safeNow = isSafeForAffection(state, inputsByChar);
  const mcx = madjid.x + madjid.w * 0.5;
  const ncx = nadine.x + nadine.w * 0.5;

  if (!safeNow) {
    state.calmTimer = 0;
    state.kissTimer = 0;
    madjid.kissLean = approach(madjid.kissLean, 0, dt * 2.2);
    nadine.kissLean = approach(nadine.kissLean, 0, dt * 2.2);
  } else if (state.kissTimer > 0) {
    state.kissTimer = Math.max(0, state.kissTimer - dt);
    const mFace = ncx >= mcx ? 1 : -1;
    madjid.facing = mFace;
    nadine.facing = -mFace;
    const progress = 1 - state.kissTimer / AFFECTION.KISS_DURATION;
    const leanCurve = Math.sin(progress * Math.PI);
    madjid.kissLean = mFace * 0.16 * leanCurve;
    nadine.kissLean = -mFace * 0.16 * leanCurve;
    madjid.mood = 'kissing';
    nadine.mood = 'kissing';
    if (state.kissTimer <= 0) {
      madjid.happyPulseTimer = 0.8;
      nadine.happyPulseTimer = 0.8;
    }
  } else {
    // Cozy idle: turn gently to face each other when standing calmly side by side
    const mFace = ncx >= mcx ? 1 : -1;
    madjid.facing = mFace;
    nadine.facing = -mFace;
    madjid.kissLean = approach(madjid.kissLean, 0, dt * 2.2);
    nadine.kissLean = approach(nadine.kissLean, 0, dt * 2.2);

    state.calmTimer += dt;
    if (state.calmTimer >= AFFECTION.CALM_DELAY && state.kissCooldown <= 0) {
      state.kissTimer = AFFECTION.KISS_DURATION;
      state.kissCooldown = AFFECTION.KISS_COOLDOWN;
      state.calmTimer = 0;
      state.kissCount += 1;
      madjid.mood = 'kissing';
      nadine.mood = 'kissing';
      madjid.scaleX = 1.09;
      madjid.scaleY = 0.93;
      nadine.scaleX = 1.09;
      nadine.scaleY = 0.93;
      callbacks.onKiss?.((mcx + ncx) * 0.5, Math.min(madjid.y, nadine.y) - 4);
    } else {
      state.idleBounceTimer -= dt;
      if (state.idleBounceTimer <= 0) {
        state.idleBounceTimer = AFFECTION.IDLE_BOUNCE_INTERVAL;
        madjid.scaleX = 1.1;
        madjid.scaleY = 0.91;
        nadine.scaleX = 1.1;
        nadine.scaleY = 0.91;
        madjid.happyPulseTimer = 0.7;
        nadine.happyPulseTimer = 0.7;
        callbacks.onCozySparkle?.((mcx + ncx) * 0.5, Math.min(madjid.y, nadine.y) - 6);
      }
    }
  }

  // Sync non-kissing moods cleanly every frame
  if (state.kissTimer <= 0) {
    for (let i = 0; i < actorList.length; i++) {
      const a = actorList[i];
      const p = a.id === 'madjid' ? nadine : madjid;
      if (a.hurtTimer > 0) {
        a.mood = 'crying';
      } else if (p.hurtTimer > 0) {
        a.mood = 'worried';
      } else if (a.inPortal || a.happyPulseTimer > 0) {
        a.mood = 'happy';
      } else {
        a.mood = 'normal';
      }
    }
  }

  return state;
}

// =========================================================================
// BROWSER RUNTIME, RENDERER, PARTICLE POOL, CHAT ADAPTER & GAME SHELL
// =========================================================================

function formatTime(totalSeconds) {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function createParticlePool(capacity = 180) {
  const pool = Array.from({ length: capacity }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0.6,
    size: 4,
    color: '#FFF6D1',
    shape: 'circle',
    gravity: 220,
  }));
  let cursor = 0;

  function spawn({ x, y, vx, vy, life = 0.55, size = 4, color = '#FFF6D1', shape = 'circle', gravity = 220 }) {
    const p = pool[cursor];
    cursor = (cursor + 1) % capacity;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.color = color;
    p.shape = shape;
    p.gravity = gravity;
  }

  function burst(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const angle =
        opts.angleBase !== undefined
          ? opts.angleBase + (Math.random() - 0.5) * (opts.spread ?? 1.2)
          : Math.random() * Math.PI * 2;
      const speed = (opts.minSpeed ?? 45) + Math.random() * ((opts.maxSpeed ?? 150) - (opts.minSpeed ?? 45));
      const palette = opts.colors || ['#FFF5C4', '#FBBF24', '#F472B6'];
      spawn({
        x: x + (Math.random() - 0.5) * (opts.jitter ?? 10),
        y: y + (Math.random() - 0.5) * (opts.jitter ?? 8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (opts.lift ?? 30),
        life: (opts.life ?? 0.55) * (0.75 + Math.random() * 0.5),
        size: (opts.size ?? 4.2) * (0.7 + Math.random() * 0.6),
        color: palette[i % palette.length],
        shape: opts.shape || 'circle',
        gravity: opts.gravity ?? 260,
      });
    }
  }

  function update(dt) {
    for (let i = 0; i < capacity; i++) {
      const p = pool[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function render(ctx) {
    ctx.save();
    for (let i = 0; i < capacity; i++) {
      const p = pool[i];
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      if (p.shape === 'heart') {
        const s = p.size * (0.72 + 0.28 * alpha);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        ctx.moveTo(0, s * 0.45);
        ctx.bezierCurveTo(-s, -s * 0.25, -s * 0.6, -s * 1.1, 0, -s * 0.45);
        ctx.bezierCurveTo(s * 0.6, -s * 1.1, s, -s * 0.25, 0, s * 0.45);
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'tear') {
        const s = p.size;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.25);
        ctx.quadraticCurveTo(s * 0.95, 0, 0, s * 0.95);
        ctx.quadraticCurveTo(-s * 0.95, 0, 0, -s * 1.25);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.shape === 'spark') {
        const s = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + s * 0.35, p.y - s * 0.35);
        ctx.lineTo(p.x + s, p.y);
        ctx.lineTo(p.x + s * 0.35, p.y + s * 0.35);
        ctx.lineTo(p.x, p.y + s);
        ctx.lineTo(p.x - s * 0.35, p.y + s * 0.35);
        ctx.lineTo(p.x - s, p.y);
        ctx.lineTo(p.x - s * 0.35, p.y - s * 0.35);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.45 + 0.55 * alpha), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function clear() {
    for (let i = 0; i < capacity; i++) pool[i].active = false;
  }

  return { spawn, burst, update, render, clear };
}

function drawKeyIconWorld(ctx, x, y, color, time, phase) {
  const bob = Math.sin(time * 3.4 + phase) * 5;
  const glow = 0.24 + Math.sin(time * 4 + phase) * 0.08;

  ctx.save();
  ctx.translate(x, y + bob);

  ctx.fillStyle = `rgba(255, 224, 118, ${(glow * 0.45).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 236, 158, ${(glow * 0.8).toFixed(2)})`;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(Math.sin(time * 2.2 + phase) * 0.14);

  ctx.fillStyle = color;
  ctx.strokeStyle = '#2B2142';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.roundRect(-2, -3.2, 19, 6.4, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillRect(8, 2, 3.6, 5.5);
  ctx.strokeRect(8, 2, 3.6, 5.5);
  ctx.fillRect(13, 2, 3.6, 4.2);
  ctx.strokeRect(13, 2, 3.6, 4.2);

  ctx.beginPath();
  ctx.arc(-8, 0, 8.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#2B2142';
  ctx.beginPath();
  ctx.arc(-8, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FFFDF0';
  ctx.beginPath();
  ctx.arc(-10.5, -2.5, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCheckpoint(ctx, cp, time) {
  const lit = cp.activated;
  ctx.save();
  ctx.translate(cp.x, cp.y);

  // Warm concentric aura when lit
  if (lit) {
    const pulse = 0.92 + Math.sin(time * 4.2) * 0.08 + cp.pulse * 0.45;
    ctx.fillStyle = 'rgba(255, 214, 120, 0.14)';
    ctx.beginPath();
    ctx.arc(0, -34, 42 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 238, 175, 0.24)';
    ctx.beginPath();
    ctx.arc(0, -34, 22 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stone pedestal base
  ctx.fillStyle = '#4B4160';
  ctx.strokeStyle = '#1E182E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-12, -8, 24, 8, [4, 4, 1, 1]);
  ctx.fill();
  ctx.stroke();

  // Wooden/iron post
  ctx.fillStyle = '#362D4B';
  ctx.fillRect(-3, -46, 6, 38);
  ctx.strokeRect(-3, -46, 6, 38);

  // Fluttering rose-gold pennant when checkpoint is lit
  if (lit) {
    const wave = Math.sin(time * 6 + cp.x * 0.05) * 2.4;
    ctx.fillStyle = '#F59BB2';
    ctx.strokeStyle = '#241B36';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(3, -43);
    ctx.quadraticCurveTo(13, -44 + wave * 0.5, 22, -39 + wave);
    ctx.lineTo(17, -34 + wave * 0.6);
    ctx.lineTo(22, -29 + wave);
    ctx.quadraticCurveTo(12, -31 + wave * 0.3, 3, -31);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Lantern finial crown & chamber
  ctx.fillStyle = lit ? '#FFE89E' : '#6A6582';
  ctx.strokeStyle = '#1E182E';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-8, -42, 16, 17, 6);
  ctx.fill();
  ctx.stroke();

  // Inner lantern core
  if (lit) {
    ctx.fillStyle = '#FFFDF0';
    ctx.beginPath();
    ctx.arc(0, -33.5, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lantern cap roof
  ctx.fillStyle = '#2B233D';
  ctx.beginPath();
  ctx.moveTo(-10, -41);
  ctx.lineTo(0, -50);
  ctx.lineTo(10, -41);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawHazard(ctx, hz, time) {
  ctx.save();
  const count = Math.max(3, Math.round(hz.w / 11));
  const step = hz.w / count;

  if (hz.kind === 'thorns') {
    // Cozy storybook briar vines with crimson rose thorns
    ctx.fillStyle = '#4A203A';
    ctx.strokeStyle = '#1E1226';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(hz.x, hz.y + hz.h - 6, hz.w, 6, 3);
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      const tipX = bx + (i % 2 === 0 ? -1.5 : 1.5);
      ctx.fillStyle = i % 2 === 0 ? '#D94B6A' : '#B5385A';
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.45, hz.y + hz.h);
      ctx.lineTo(tipX, hz.y + 1);
      ctx.lineTo(bx + step * 0.45, hz.y + hz.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (hz.kind === 'crystals') {
    // Luminous jagged crystal hazard shards
    const shimmer = 0.85 + Math.sin(time * 4.5 + hz.x) * 0.15;
    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      const hMod = i % 2 === 0 ? 0 : 3;
      ctx.fillStyle = i % 2 === 0 ? '#F06A98' : '#73DDE8';
      ctx.strokeStyle = '#1D1833';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.48, hz.y + hz.h);
      ctx.lineTo(bx - 1, hz.y + hMod);
      ctx.lineTo(bx + step * 0.48, hz.y + hz.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${(0.55 * shimmer).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(bx - 1, hz.y + hMod + 2);
      ctx.lineTo(bx + 1.8, hz.y + hz.h - 3);
      ctx.lineTo(bx - 1.5, hz.y + hz.h - 3);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Crisp sculpted iron-crimson spikes
    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      ctx.fillStyle = '#E06070';
      ctx.strokeStyle = '#1F162B';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.48, hz.y + hz.h);
      ctx.lineTo(bx, hz.y);
      ctx.lineTo(bx + step * 0.48, hz.y + hz.h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFD4D8';
      ctx.beginPath();
      ctx.moveTo(bx, hz.y + 2);
      ctx.lineTo(bx + 1.5, hz.y + hz.h - 3);
      ctx.lineTo(bx - 1.5, hz.y + hz.h - 3);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawEnemy(ctx, en, time) {
  const cx = en.x + en.w * 0.5;
  const bottomY = en.y + en.h;
  const waddle = Math.sin(en.animPhase) * 1.8;
  const facing = en.dir >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(cx, bottomY);

  // Soft ground shadow
  ctx.fillStyle = 'rgba(18, 20, 38, 0.28)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 13, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (en.kind === 'wisp') {
    const hover = Math.sin(time * 5.2 + en.x * 0.04) * 3.5;
    ctx.translate(0, -14 + hover);

    // Concentric soft violet-amber aura
    ctx.fillStyle = 'rgba(244, 134, 178, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    // Flame teardrop body
    ctx.fillStyle = '#C95F9E';
    ctx.strokeStyle = '#241636';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.bezierCurveTo(13, -5, 13, 10, 0, 11);
    ctx.bezierCurveTo(-13, 10, -13, -5, 0, -14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner bright core
    ctx.fillStyle = '#FFE4A8';
    ctx.beginPath();
    ctx.arc(facing * 2, 1, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Mischievous tiny eyes
    ctx.fillStyle = '#1E1530';
    ctx.beginPath();
    ctx.arc(facing * 3 - 2.6, 0, 1.8, 0, Math.PI * 2);
    ctx.arc(facing * 3 + 2.6, 0, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (en.kind === 'crab') {
    ctx.translate(0, -11 - Math.abs(waddle) * 0.45);

    // Little scuttling legs
    ctx.strokeStyle = '#2A1624';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    [-11, -6, 6, 11].forEach((lx, idx) => {
      const lift = Math.sin(en.animPhase + idx * 1.4) * 2;
      ctx.beginPath();
      ctx.moveTo(lx * 0.7, 5);
      ctx.lineTo(lx, 10 + lift);
      ctx.stroke();
    });

    // Raised snapping claws
    const clawBob = Math.sin(time * 7 + en.x) * 2;
    ctx.fillStyle = '#E8635A';
    ctx.strokeStyle = '#2A1624';
    ctx.lineWidth = 1.9;
    [-12, 12].forEach((cxOff) => {
      ctx.beginPath();
      ctx.arc(cxOff, -6 + clawBob, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Plump coral shell
    ctx.fillStyle = '#EB6B5E';
    ctx.beginPath();
    ctx.ellipse(0, 1, 13.5, 8.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Shell highlight
    ctx.fillStyle = 'rgba(255, 240, 224, 0.42)';
    ctx.beginPath();
    ctx.ellipse(-4, -3, 4.2, 2, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Expressive eyes on stalks
    [-4.5, 4.5].forEach((ex) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex + facing * 1.2, -5.5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1F1426';
      ctx.beginPath();
      ctx.arc(ex + facing * 2.1, -5.5, 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
  } else {
    // Cozy wandering scarab beetle
    ctx.translate(0, -10 - Math.abs(waddle) * 0.4);

    // Tiny waddling feet
    ctx.fillStyle = '#241933';
    [-8, 0, 8].forEach((fx, idx) => {
      const fLift = Math.sin(en.animPhase + idx * 1.8) * 1.6;
      ctx.beginPath();
      ctx.arc(fx, 9 + fLift, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Domed berry-plum shell
    ctx.fillStyle = '#9C4266';
    ctx.strokeStyle = '#241630';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.arc(0, 6, 13.5, Math.PI, 0);
    ctx.lineTo(13.5, 8);
    ctx.lineTo(-13.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Soft shell shine & golden spot
    ctx.fillStyle = '#F7C27B';
    ctx.beginPath();
    ctx.arc(-facing * 4, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Cute grumpy face on leading edge
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(facing * 7.5, 1.5, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1E152E';
    ctx.beginPath();
    ctx.arc(facing * 8.6, 1.5, 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Tiny brow & antenna
    ctx.strokeStyle = '#241630';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(facing * 4.5, -2.5);
    ctx.lineTo(facing * 10.5, -1);
    ctx.moveTo(facing * 6, -5);
    ctx.quadraticCurveTo(facing * 11, -11, facing * 13, -8);
    ctx.stroke();
  }

  ctx.restore();
}

function drawExitPortal(ctx, state, time) {
  const { exit, portalUnlocked, keysCollected, keysRequired, actors } = state;
  const cx = exit.x + exit.w * 0.5;
  const bottomY = exit.y + exit.h;

  ctx.save();

  // Radiant unlocked shimmer halo (zero-allocation concentric circles)
  if (portalUnlocked) {
    const pulse = 0.92 + Math.sin(time * 3.6) * 0.08;
    ctx.fillStyle = exit.isWeddingArch ? 'rgba(255, 224, 160, 0.14)' : 'rgba(255, 220, 140, 0.12)';
    ctx.beginPath();
    ctx.arc(cx, exit.y + exit.h * 0.5, 68 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = exit.isWeddingArch ? 'rgba(255, 240, 186, 0.26)' : 'rgba(244, 168, 186, 0.2)';
    ctx.beginPath();
    ctx.arc(cx, exit.y + exit.h * 0.5, 42 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stone / Floral Arch Frame
  ctx.fillStyle = exit.isWeddingArch ? '#FFF5EB' : '#4E4362';
  ctx.strokeStyle = '#211A30';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(exit.x, bottomY);
  ctx.lineTo(exit.x, exit.y + 34);
  ctx.arc(cx, exit.y + 34, exit.w * 0.5, Math.PI, 0);
  ctx.lineTo(exit.x + exit.w, bottomY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner Doorway / Shimmering Portal Core
  const innerPad = 10;
  const innerW = exit.w - innerPad * 2;
  const innerR = innerW * 0.5;

  ctx.beginPath();
  ctx.moveTo(exit.x + innerPad, bottomY);
  ctx.lineTo(exit.x + innerPad, exit.y + 36);
  ctx.arc(cx, exit.y + 36, innerR, Math.PI, 0);
  ctx.lineTo(exit.x + exit.w - innerPad, bottomY);
  ctx.closePath();

  if (portalUnlocked) {
    const portalGrad = ctx.createLinearGradient(cx, exit.y + 14, cx, bottomY);
    portalGrad.addColorStop(0, '#FFF8D6');
    portalGrad.addColorStop(0.45, '#F8BD7A');
    portalGrad.addColorStop(1, '#E87EA1');
    ctx.fillStyle = portalGrad;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = ((time * 24 + i * 18) % 54) + 6;
      ctx.globalAlpha = Math.max(0, 1 - r / 60) * 0.65;
      ctx.beginPath();
      ctx.arc(cx, exit.y + exit.h * 0.55, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#262138';
    ctx.fill();
    ctx.strokeStyle = '#3E3659';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, exit.y + 22);
    ctx.lineTo(cx - 10, bottomY);
    ctx.moveTo(cx + 10, exit.y + 22);
    ctx.lineTo(cx + 10, bottomY);
    ctx.stroke();

    ctx.fillStyle = '#F5B95B';
    ctx.strokeStyle = '#1D182C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, exit.y + 44, 7, Math.PI, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx - 10, exit.y + 44, 20, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1D182C';
    ctx.beginPath();
    ctx.arc(cx, exit.y + 52, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wedding floral garland accents on final arch (Level 50!)
  if (exit.isWeddingArch) {
    const spots = [
      { x: cx - 28, y: exit.y + 18, c: '#F59BB2' },
      { x: cx - 12, y: exit.y + 6, c: '#FFF4C8' },
      { x: cx + 12, y: exit.y + 6, c: '#F59BB2' },
      { x: cx + 28, y: exit.y + 18, c: '#FFF4C8' },
      { x: cx, y: exit.y + 3, c: '#F5B95B' },
    ];
    spots.forEach((f) => {
      ctx.fillStyle = f.c;
      ctx.strokeStyle = '#3A2738';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 5.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  const pipY = exit.y - 14;
  const bothNeeded = portalUnlocked;
  const labelText = !portalUnlocked
    ? `Need ${keysRequired - keysCollected} Key${keysRequired - keysCollected > 1 ? 's' : ''}`
    : actors.madjid.inPortal || actors.nadine.inPortal
      ? 'Waiting for Partner'
      : exit.isWeddingArch
        ? 'Wedding Arch'
        : 'Enter Together';

  ctx.font = '700 12px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = 'rgba(18, 20, 36, 0.88)';
  ctx.strokeText(labelText, cx, pipY - 10);
  ctx.fillStyle = bothNeeded ? '#FFF4C4' : '#F4EFFA';
  ctx.fillText(labelText, cx, pipY - 10);

  const mReady = actors.madjid.inPortal && portalUnlocked;
  const nReady = actors.nadine.inPortal && portalUnlocked;
  [
    { x: cx - 11, ready: mReady, color: '#52A5E8' },
    { x: cx + 11, ready: nReady, color: '#F07F9A' },
  ].forEach((dot) => {
    ctx.fillStyle = dot.ready ? dot.color : 'rgba(24, 28, 46, 0.78)';
    ctx.strokeStyle = dot.ready ? '#FFF9E2' : 'rgba(255, 250, 240, 0.65)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(dot.x, pipY, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

function drawWorld(
  ctx,
  state,
  bgSystem,
  skinsSelected,
  activeCharId,
  particles,
  worldToasts,
  time,
  showIndicators = true,
  openWorldOverlay = null
) {
  const style = bgSystem.getPlatformStyle();

  // 1. Crisp Glowing Connection Threads Between Switches and Linked Gates/Lifts
  ctx.save();
  const drawLinkLine = (sw, tx, ty, active) => {
    const sx = sw.x + sw.w * 0.5;
    const sy = sw.y - 4;
    const ctrlX = (sx + tx) * 0.5;
    const ctrlY = Math.max(sy, ty) + 26;

    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -time * 20;
    ctx.lineWidth = active ? 4 : 3;
    ctx.strokeStyle = 'rgba(22, 20, 38, 0.32)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
    ctx.stroke();

    ctx.lineWidth = active ? 2.2 : 1.6;
    ctx.strokeStyle = active ? sw.color : 'rgba(255, 248, 232, 0.52)';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
    ctx.stroke();
  };

  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    const active = g.latchedOpen || checkSwitchGroup(state, g.switches, g.requireAll);
    for (let j = 0; j < g.switches.length; j++) {
      const sw = state.switches.find((s) => s.id === g.switches[j]);
      if (sw) drawLinkLine(sw, g.closedX + g.w * 0.5, g.closedY + g.h * 0.5, active);
    }
  }
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    const allSw = [...(mp.switches || []), ...(mp.patrolSwitches || [])];
    const active =
      checkSwitchGroup(state, mp.switches, mp.requireAll) ||
      (mp.patrolSwitches ? checkSwitchGroup(state, mp.patrolSwitches, false) : false);
    for (let j = 0; j < allSw.length; j++) {
      const sw = state.switches.find((s) => s.id === allSw[j]);
      if (sw) drawLinkLine(sw, mp.x + mp.w * 0.5, mp.y + mp.h * 0.5, active);
    }
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 2. Moving Platform Guide Rails
  ctx.save();
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    ctx.strokeStyle = 'rgba(255, 246, 224, 0.25)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(mp.startX + mp.w * 0.5, mp.startY + mp.h * 0.5);
    ctx.lineTo(mp.endX + mp.w * 0.5, mp.endY + mp.h * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = mp.color;
    ctx.strokeStyle = '#201A30';
    ctx.lineWidth = 1.6;
    [
      [mp.startX + mp.w * 0.5, mp.startY + mp.h * 0.5],
      [mp.endX + mp.w * 0.5, mp.endY + mp.h * 0.5],
    ].forEach(([px, py]) => {
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }
  ctx.restore();

  // 3. Static Platforms & Storybook Gatehouse Archways
  for (let i = 0; i < state.platforms.length; i++) {
    const p = state.platforms[i];
    if (p.kind === 'openworld_block') continue;
    ctx.save();

    if (p.kind === 'archway') {
      const cx = p.x + p.w * 0.5;
      const bodyTop = p.y + 16;

      ctx.fillStyle = style.body;
      ctx.strokeStyle = style.trim;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(p.x + 4, bodyTop, p.w - 8, p.h - 16, [4, 4, 6, 6]);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 240, 200, 0.14)';
      ctx.strokeStyle = style.topRim;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, bodyTop + (p.h - 16) * 0.5, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = style.top;
      ctx.strokeStyle = style.trim;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x - 6, bodyTop + 3);
      ctx.lineTo(cx, p.y - 2);
      ctx.lineTo(p.x + p.w + 6, bodyTop + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#5D5073';
      ctx.beginPath();
      ctx.roundRect(p.x, p.y + p.h - 10, p.w, 10, 3);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = style.body;
      ctx.strokeStyle = style.trim;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.kind === 'ground' ? [10, 10, 0, 0] : 8);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1.4;
      const brickStep = 44;
      for (let bx = p.x + 22; bx < p.x + p.w - 14; bx += brickStep) {
        ctx.beginPath();
        ctx.moveTo(bx, p.y + 12);
        ctx.lineTo(bx, p.y + Math.min(p.h - 4, 34));
        ctx.stroke();
      }

      if (p.kind !== 'pillar') {
        ctx.fillStyle = style.top;
        ctx.beginPath();
        ctx.roundRect(p.x + 1, p.y + 1, p.w - 2, 10, [7, 7, 3, 3]);
        ctx.fill();

        ctx.fillStyle = style.topRim;
        ctx.fillRect(p.x + 6, p.y + 2, Math.max(0, p.w - 12), 3);
      }
    }
    ctx.restore();
  }

  // 4. World Environmental Props (Lantern Posts, Signpost, Wildflowers)
  for (let i = 0; i < state.decorations.length; i++) {
    const d = state.decorations[i];
    ctx.save();
    if (d.type === 'lantern') {
      const sway = Math.sin(time * 2.1 + d.x * 0.04) * 2;
      ctx.strokeStyle = '#2B233D';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y - 44);
      ctx.lineTo(d.x + 12, d.y - 44);
      ctx.stroke();

      // Concentric warm lantern halo
      ctx.fillStyle = 'rgba(255, 210, 118, 0.14)';
      ctx.beginPath();
      ctx.arc(d.x + 12 + sway, d.y - 34, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 232, 156, 0.24)';
      ctx.beginPath();
      ctx.arc(d.x + 12 + sway, d.y - 34, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFE49E';
      ctx.strokeStyle = '#2B233D';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(d.x + 7 + sway, d.y - 41, 10, 14, 4);
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'signpost') {
      ctx.fillStyle = '#8C5E3C';
      ctx.strokeStyle = '#2A1D19';
      ctx.lineWidth = 2;
      ctx.fillRect(d.x - 3, d.y - 34, 6, 34);
      ctx.strokeRect(d.x - 3, d.y - 34, 6, 34);
      ctx.beginPath();
      ctx.moveTo(d.x - 16, d.y - 30);
      ctx.lineTo(d.x + 14, d.y - 30);
      ctx.lineTo(d.x + 21, d.y - 23);
      ctx.lineTo(d.x + 14, d.y - 16);
      ctx.lineTo(d.x - 16, d.y - 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'flowers') {
      const petals = ['#FFF2B8', '#F69EB5', '#9AD9F7'];
      for (let f = 0; f < 3; f++) {
        const fx = d.x + (f - 1) * 12;
        const sway = Math.sin(time * 2.8 + f + d.x) * 1.8;
        ctx.strokeStyle = '#538E5D';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(fx, d.y);
        ctx.quadraticCurveTo(fx + sway, d.y - 6, fx + sway, d.y - 12);
        ctx.stroke();
        ctx.fillStyle = petals[f % petals.length];
        ctx.beginPath();
        ctx.arc(fx + sway, d.y - 13, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 4b. 2D Open-World Mode Placed Blocks & Placement Preview
  if (openWorldOverlay) {
    renderOpenWorldBlocks(
      ctx,
      openWorldOverlay.state,
      time,
      openWorldOverlay.hoverCell,
      openWorldOverlay.selectedTool
    );
  }

  // 5. Checkpoints
  for (let i = 0; i < state.checkpoints.length; i++) {
    drawCheckpoint(ctx, state.checkpoints[i], time);
  }

  // 6. Hazards (Thorns, Spikes, Crystal Shards)
  for (let i = 0; i < state.hazards.length; i++) {
    drawHazard(ctx, state.hazards[i], time);
  }

  // 7. Moving Platforms
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    ctx.save();
    ctx.fillStyle = '#332C4A';
    ctx.strokeStyle = '#191429';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(mp.x, mp.y, mp.w, mp.h, 7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = mp.color;
    ctx.beginPath();
    ctx.roundRect(mp.x + 4, mp.y + 3, mp.w - 8, 6, 3);
    ctx.fill();

    ctx.fillStyle = '#FFF5D6';
    ctx.beginPath();
    ctx.arc(mp.x + 11, mp.y + mp.h * 0.65, 2.2, 0, Math.PI * 2);
    ctx.arc(mp.x + mp.w - 11, mp.y + mp.h * 0.65, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 8. Sliding Gates
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    if (g.openProgress >= 0.99) continue;
    ctx.save();
    ctx.fillStyle = '#4B3E63';
    ctx.strokeStyle = '#1B152B';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(g.x, g.y, g.w, g.h, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = g.color;
    ctx.fillRect(g.x + 4, g.y + 14, g.w - 8, 6);
    ctx.fillRect(g.x + 4, g.y + g.h - 20, g.w - 8, 6);

    const gcx = g.x + g.w * 0.5;
    const gcy = g.y + g.h * 0.5;
    ctx.fillStyle = g.latchedOpen ? '#A7F3D0' : g.color;
    ctx.strokeStyle = '#1B152B';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(gcx, gcy - 8);
    ctx.lineTo(gcx + 6, gcy);
    ctx.lineTo(gcx, gcy + 8);
    ctx.lineTo(gcx - 6, gcy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // 9. Pressure Switches (Hold Plates & Toggle Latches)
  for (let i = 0; i < state.switches.length; i++) {
    const sw = state.switches[i];
    const active = isSwitchActive(sw);
    const depressedPx = sw.pressDepth * 5;

    ctx.save();
    ctx.fillStyle = '#2A233E';
    ctx.strokeStyle = '#171326';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(sw.x - 3, sw.y - 6, sw.w + 6, 7, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = active ? '#FFF4C4' : sw.color;
    ctx.strokeStyle = '#1D182E';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(sw.x + 2, sw.y - 12 + depressedPx, sw.w - 4, 8 - depressedPx * 0.4, [5, 5, 1, 1]);
    ctx.fill();
    ctx.stroke();

    if (sw.mode === 'toggle' && active) {
      ctx.fillStyle = 'rgba(255, 240, 165, 0.24)';
      ctx.beginPath();
      ctx.arc(sw.x + sw.w * 0.5, sw.y - 10, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sw.label) {
      const lx = sw.x + sw.w * 0.5;
      const ly = sw.y + 13;
      ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(18, 20, 36, 0.9)';
      ctx.strokeText(sw.label, lx, ly);
      ctx.fillStyle = active ? '#FFF4C4' : '#F8F4FF';
      ctx.fillText(sw.label, lx, ly);
    }
    ctx.restore();
  }

  // 10. Exit Portal
  if (!state.exit.hidden) {
    drawExitPortal(ctx, state, time);
  }

  // 11. Collectible Keys
  for (let i = 0; i < state.keys.length; i++) {
    const key = state.keys[i];
    if (key.collected) continue;
    drawKeyIconWorld(ctx, key.x, key.y, key.color, time, key.bobPhase);
  }

  // 12. Patrol Enemies
  for (let i = 0; i < state.enemies.length; i++) {
    drawEnemy(ctx, state.enemies[i], time);
  }

  // 13. Madjid & Nadine Characters (Rendered Exclusively via src/skins.js)
  const madjid = state.actors.madjid;
  const nadine = state.actors.nadine;
  const madjidSkin = getSkin('madjid', skinsSelected.madjid);
  const nadineSkin = getSkin('nadine', skinsSelected.nadine);

  const inactiveFirst = activeCharId === 'madjid' ? ['nadine', 'madjid'] : ['madjid', 'nadine'];
  for (let i = 0; i < inactiveFirst.length; i++) {
    const cid = inactiveFirst[i];
    const actor = state.actors[cid];
    const partner = cid === 'madjid' ? nadine : madjid;
    renderCharacter(ctx, actor, cid === 'madjid' ? madjidSkin : nadineSkin, time, {
      isActive: cid === activeCharId,
      partnerPos: { x: partner.x + partner.w * 0.5, y: partner.y + partner.h * 0.5 },
      showIndicator: showIndicators,
    });
  }

  // 14. Pooled Particles Layer
  particles.render(ctx);

  // 15. Brief Rising World Callouts (e.g., "Checkpoint!")
  if (worldToasts && worldToasts.length > 0) {
    ctx.save();
    ctx.font = '700 13px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let i = 0; i < worldToasts.length; i++) {
      const t = worldToasts[i];
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(20, 18, 36, 0.88)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}

function bootstrapBrowserGame() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // DOM References
  const elTitleScreen = document.getElementById('title-screen');
  const elStoryPremise = document.getElementById('story-premise');
  const elHudLayer = document.getElementById('hud-layer');
  const elHudChapterNum = document.getElementById('hud-chapter-num');
  const elHudChapterTitle = document.getElementById('hud-chapter-title');
  const elHudCharBtn = document.getElementById('hud-switch-char');
  const elHudCharSwatch = document.getElementById('hud-char-swatch');
  const elHudCharName = document.getElementById('hud-char-name');
  const elHudCharLocked = document.getElementById('hud-char-locked');
  const elHudCharLockedSwatch = document.getElementById('hud-char-locked-swatch');
  const elHudCharLockedName = document.getElementById('hud-char-locked-name');
  const elHudCoopRoomTag = document.getElementById('hud-coop-room-tag');
  const elHudKeyReadout = document.querySelector('.hud-key-readout');
  const elHudKeyCount = document.getElementById('hud-key-count');
  const elHudCheckpoint = document.getElementById('hud-checkpoint-indicator');
  const elHudTimer = document.getElementById('hud-timer');
  const elCaptionBar = document.getElementById('story-caption-bar');
  const elCaptionText = document.getElementById('story-caption-text');

  const elOpenWorldBar = document.getElementById('openworld-bar');
  const elOpenWorldPalette = document.getElementById('openworld-palette');
  const elOpenWorldCraftMenu = document.getElementById('openworld-craft-menu');
  const elOpenWorldCraftBtn = document.getElementById('btn-openworld-craft');
  const elOpenWorldSkyBtn = document.getElementById('btn-openworld-sky');
  const elOpenWorldStoryBtn = document.getElementById('btn-openworld-story');

  const elChatBox = document.getElementById('chat-box');
  const elChatBtn = document.getElementById('hud-btn-chat');
  const elChatMessages = document.getElementById('chat-messages');
  const elChatForm = document.getElementById('chat-form');
  const elChatInput = document.getElementById('chat-input');
  const elChatSpeaker = document.getElementById('chat-speaker-label');

  const elPauseModal = document.getElementById('pause-modal');
  const elPauseChapterInfo = document.getElementById('pause-chapter-info');
  const elPauseTouchToggle = document.getElementById('btn-pause-touch-toggle');
  const elSkinsModal = document.getElementById('skins-modal');
  const elSkinGrid = document.getElementById('skin-grid');
  const elChaptersModal = document.getElementById('chapters-modal');
  const elWorldTabs = document.getElementById('world-tabs');
  const elWorldBannerKicker = document.getElementById('world-banner-kicker');
  const elWorldBannerName = document.getElementById('world-banner-name');
  const elWorldBannerMeta = document.getElementById('world-banner-meta');
  const elChaptersProgressLabel = document.getElementById('chapters-progress-label');
  const elChaptersList = document.getElementById('chapters-list');
  const elChapterClearModal = document.getElementById('chapter-clear-modal');
  const elVictoryModal = document.getElementById('victory-modal');
  const elTouchControls = document.getElementById('touch-controls');
  const elTouchSwitch = document.getElementById('touch-switch');

  const elCoopModal = document.getElementById('coop-modal');
  const elCoopServerUrl = document.getElementById('coop-server-url');
  const elCoopConnStatus = document.getElementById('coop-conn-status');
  const elCoopFeedback = document.getElementById('coop-feedback');
  const elCoopActivePanel = document.getElementById('coop-active-panel');
  const elCoopLobbyPanels = document.getElementById('coop-lobby-panels');
  const elCoopActiveName = document.getElementById('coop-active-name');
  const elCoopActiveCode = document.getElementById('coop-active-code');
  const elCoopActiveRoster = document.getElementById('coop-active-roster');
  const elCoopCreateForm = document.getElementById('coop-create-form');
  const elCoopCreateName = document.getElementById('coop-create-name');
  const elCoopSearchForm = document.getElementById('coop-search-form');
  const elCoopSearchInput = document.getElementById('coop-search-input');
  const elCoopRoomsList = document.getElementById('coop-rooms-list');
  const elHudBtnCoop = document.getElementById('hud-btn-coop');

  const elSoundOn = document.getElementById('icon-sound-on');
  const elSoundOff = document.getElementById('icon-sound-off');
  const elMuteBtn = document.getElementById('hud-btn-mute');

  elStoryPremise.textContent = STORY_PREMISE;

  // Persistent Local Preferences (Skins & Cleared Levels across 10 Worlds / 50 Stages)
  const audio = createAudioEngine();
  const bgSystem = createBackgroundSystem('sunrise');
  const particles = createParticlePool(180);
  const worldToasts = [];

  function spawnWorldToast(x, y, text, color = '#FFE89E') {
    worldToasts.push({ x, y, text, color, life: 1.35, maxLife: 1.35 });
    if (worldToasts.length > 8) worldToasts.shift();
  }

  let selectedSkins = {
    madjid: getDefaultSkinId('madjid'),
    nadine: getDefaultSkinId('nadine'),
  };
  const clearedLevelIds = new Set();

  try {
    const savedSkins = window.localStorage.getItem('nadine_selected_skins');
    if (savedSkins) {
      const parsed = JSON.parse(savedSkins);
      if (parsed.madjid) selectedSkins.madjid = getSkin('madjid', parsed.madjid).id;
      if (parsed.nadine) selectedSkins.nadine = getSkin('nadine', parsed.nadine).id;
    }
    const savedCleared = window.localStorage.getItem('nadine_cleared_levels');
    if (savedCleared) {
      const ids = JSON.parse(savedCleared);
      if (Array.isArray(ids)) {
        ids.forEach((id) => {
          if (typeof id === 'number') clearedLevelIds.add(id);
        });
      }
    }
  } catch {
    // Fallback cleanly if storage is unavailable
  }

  function savePreferences() {
    try {
      window.localStorage.setItem('nadine_selected_skins', JSON.stringify(selectedSkins));
      window.localStorage.setItem('nadine_cleared_levels', JSON.stringify(Array.from(clearedLevelIds)));
    } catch {
      // Ignore storage errors
    }
  }

  // Core Game State Machine
  let gameState = 'title'; // 'title' | 'playing' | 'paused' | 'gameover'
  let activeSubModal = null; // 'skins' | 'chapters' | 'chapter-clear' | 'coop' | null
  let modalReturnState = 'title';
  let playMode = 'story'; // 'story' | 'openworld'
  let currentLevelIdx = 0;
  let selectedWorldTab = 1;
  let levelState = createInitialLevelState(LEVELS[0]);
  let activeCharId = 'madjid';
  let elapsedTime = 0;
  let totalJourneyTime = 0;
  let totalKeysCollectedRun = 0;
  let hitstopTimer = 0;
  let cameraShakeTrauma = 0;
  let cameraX = 0;
  let cameraY = 0;
  let cameraLookAheadX = 0;
  let captionTimeoutId = null;
  let titleHeartTimer = 1.6;
  let touchPadMode = 'auto';

  // 2D Open-World Sandbox State
  let openWorldState = createOpenWorldState();
  let openWorldBasePlatforms = [];
  let openWorldSelectedTool = 'wood'; // block type id or 'break'
  let openWorldHoverCell = null;
  let lastFrameTransform = { offsetX: 0, offsetY: 0, scale: 1 };

  // Online 2-Player Co-op Session State
  const coopSession = {
    active: false,
    room: null,
    roomCode: null,
    roomName: '',
    localCharId: null,
    remoteCharId: null,
    partnerConnected: false,
  };
  const remoteActorTarget = {
    active: false,
    charId: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    scaleX: 1,
    scaleY: 1,
    mood: 'normal',
    hurtTimer: 0,
    invulnTimer: 0,
    kissLean: 0,
    inPortal: false,
    walkDist: 0,
  };
  let coopCreateModeChoice = 'story';
  let coopCreateCharChoice = 'madjid';
  let coopDirectoryRooms = [];
  let isApplyingRemoteUpdate = false;
  let lastCoopStateSendMs = 0;

  // Decoupled Input Hub (Keyboard + Multi-Touch + Network Remote Slot)
  const keysHeld = new Set();
  const touchHeld = { left: false, right: false, jump: false };
  let localJumpJustPressed = false;
  let localJumpJustReleased = false;
  let prevJumpHeld = false;
  const remoteIntents = {
    madjid: null,
    nadine: null,
  };
  const localInputListeners = new Set();

  // Decoupled Chat Transport (Local Solo + Live Online Co-op Sync)
  const chatHistory = [];
  const seenChatIds = new Set();
  const chatTransport = {
    send(text) {
      const senderId = coopSession.active ? coopSession.localCharId : activeCharId;
      const senderName = senderId === 'madjid' ? 'Madjid' : 'Nadine';
      const msg = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        senderId,
        senderName,
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      if (typeof chatTransport.onOutgoing === 'function') {
        chatTransport.onOutgoing(msg);
      }
      if (coopSession.active) {
        coopClient.sendChat(msg);
        return;
      }
      receiveChatMessage(msg);
      audio.playChatPing();
    },
    onOutgoing: null,
  };

  function receiveChatMessage(msg) {
    if (msg.id) {
      if (seenChatIds.has(msg.id)) return;
      seenChatIds.add(msg.id);
    }
    chatHistory.push(msg);
    if (chatHistory.length > 60) chatHistory.shift();

    const row = document.createElement('div');
    row.className = 'chat-msg';

    const meta = document.createElement('div');
    meta.className = 'chat-msg-meta';

    const senderEl = document.createElement('span');
    senderEl.className = `chat-sender ${msg.senderId || 'story'}`;
    senderEl.textContent = msg.senderName;

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = msg.timestamp || '';

    meta.appendChild(senderEl);
    meta.appendChild(timeEl);

    const bodyEl = document.createElement('div');
    bodyEl.textContent = msg.text;

    row.appendChild(meta);
    row.appendChild(bodyEl);
    elChatMessages.appendChild(row);
    elChatMessages.scrollTop = elChatMessages.scrollHeight;
  }

  receiveChatMessage({
    senderId: 'story',
    senderName: 'Storybook',
    text: 'Welcome across 10 worlds! Press Tab to switch between Madjid and Nadine, or open Online Co-op to play together on two devices.',
    timestamp: 'W1-1',
  });

  function isChatFocused() {
    const el = document.activeElement;
    if (!el) return false;
    return el === elChatInput || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  }

  function toggleChatBox(forceOpen = null) {
    const currentlyOpen = !elChatBox.classList.contains('hidden');
    const nextOpen = forceOpen === null ? !currentlyOpen : forceOpen;
    elChatBox.classList.toggle('hidden', !nextOpen);
    elChatBtn.setAttribute('aria-expanded', String(nextOpen));
    if (nextOpen) {
      elChatSpeaker.textContent = `Speaking as ${activeCharId === 'madjid' ? 'Madjid' : 'Nadine'}`;
      elChatInput.focus();
    } else {
      elChatInput.blur();
      canvas.focus?.();
    }
  }

  function clearInputs() {
    keysHeld.clear();
    touchHeld.left = false;
    touchHeld.right = false;
    touchHeld.jump = false;
    localJumpJustPressed = false;
    localJumpJustReleased = false;
    prevJumpHeld = false;
    document.querySelectorAll('.touch-btn.pressed').forEach((b) => b.classList.remove('pressed'));
  }

  function syncMuteUI() {
    const muted = audio.isMuted();
    elSoundOn.classList.toggle('hidden', muted);
    elSoundOff.classList.toggle('hidden', !muted);
    elMuteBtn.setAttribute('aria-pressed', String(muted));
    elMuteBtn.setAttribute('aria-label', muted ? 'Unmute sound effects' : 'Mute sound effects');
  }

  function applyCoopUiLock() {
    const locked = coopSession.active;
    if (locked && coopSession.localCharId) {
      activeCharId = coopSession.localCharId;
    }

    document.body.classList.toggle('coop-mode', locked);
    document.body.dataset.coop = locked ? 'true' : 'false';
    document.body.dataset.playMode = playMode;

    // Strictly hide & disable Switch Character controls in Co-op Mode (Story + Open-World)
    elHudCharBtn.classList.toggle('hidden', locked);
    elHudCharBtn.disabled = locked;
    elHudCharBtn.setAttribute('aria-hidden', String(locked));

    if (elTouchSwitch) {
      elTouchSwitch.classList.toggle('hidden', locked);
      elTouchSwitch.disabled = locked;
      elTouchSwitch.setAttribute('aria-hidden', String(locked));
    }

    if (elHudCharLocked) {
      elHudCharLocked.classList.toggle('hidden', !locked);
      if (locked) {
        const lockedSkin = getSkin(activeCharId, selectedSkins[activeCharId]);
        elHudCharLockedName.textContent = activeCharId === 'madjid' ? 'Madjid' : 'Nadine';
        elHudCharLockedSwatch.style.backgroundColor = lockedSkin.palette.body;
      }
    }

    if (elHudCoopRoomTag) {
      elHudCoopRoomTag.classList.toggle('hidden', !locked);
      if (locked && coopSession.roomCode) {
        const count = coopSession.room?.playerCount || 1;
        elHudCoopRoomTag.textContent = `${coopSession.roomCode} · ${count}/2`;
      }
    }

    if (elHudBtnCoop) {
      elHudBtnCoop.setAttribute('aria-pressed', String(locked));
    }
  }

  function refreshOpenWorldCollisions() {
    if (playMode !== 'openworld') return;
    levelState.platforms = buildOpenWorldSolidPlatforms(openWorldBasePlatforms, openWorldState);
  }

  function renderOpenWorldToolbar() {
    if (!elOpenWorldBar) return;
    const visible = playMode === 'openworld';
    elOpenWorldBar.classList.toggle('hidden', !visible);
    if (!visible) {
      elOpenWorldCraftMenu.classList.add('hidden');
      elOpenWorldCraftBtn.classList.remove('active');
      return;
    }

    elOpenWorldPalette.innerHTML = '';
    Object.values(OPEN_WORLD_BLOCKS).forEach((block) => {
      const count = openWorldState.inventory[block.id] || 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.className = `ow-tool-btn${openWorldSelectedTool === block.id ? ' active' : ''}`;
      btn.dataset.blockTool = block.id;

      const swatch = document.createElement('span');
      swatch.className = 'ow-swatch';
      swatch.style.backgroundColor = block.color;

      const label = document.createElement('span');
      label.textContent = block.name;

      const countEl = document.createElement('span');
      countEl.className = 'ow-count';
      countEl.textContent = `×${count}`;

      btn.appendChild(swatch);
      btn.appendChild(label);
      btn.appendChild(countEl);
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        audio.unlock();
        audio.playUiClick();
        openWorldSelectedTool = block.id;
        renderOpenWorldToolbar();
      });
      elOpenWorldPalette.appendChild(btn);
    });

    const breakBtn = document.createElement('button');
    breakBtn.type = 'button';
    breakBtn.tabIndex = -1;
    breakBtn.className = `ow-tool-btn${openWorldSelectedTool === 'break' ? ' active' : ''}`;
    breakBtn.dataset.blockTool = 'break';
    breakBtn.textContent = 'Break';
    breakBtn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.unlock();
      audio.playUiClick();
      openWorldSelectedTool = 'break';
      renderOpenWorldToolbar();
    });
    elOpenWorldPalette.appendChild(breakBtn);

    const skyLabel =
      openWorldState.theme === 'night'
        ? 'Night'
        : openWorldState.theme === 'sunset'
          ? 'Dusk'
          : 'Dawn';
    elOpenWorldSkyBtn.textContent = `Sky: ${skyLabel}`;

    // Render craft recipes
    elOpenWorldCraftMenu.innerHTML = '';
    CRAFT_RECIPES.forEach((recipe) => {
      const craftable = canCraftRecipe(openWorldState.inventory, recipe.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.className = 'ow-recipe-btn';
      btn.dataset.recipeId = recipe.id;
      btn.disabled = !craftable;

      const title = document.createElement('span');
      title.className = 'ow-recipe-name';
      title.textContent = recipe.name;

      const costText = Object.entries(recipe.cost)
        .map(([mat, amt]) => `${OPEN_WORLD_BLOCKS[mat]?.name || mat} ×${amt}`)
        .join(' + ');
      const cost = document.createElement('span');
      cost.className = 'ow-recipe-cost';
      cost.textContent = `Cost: ${costText}`;

      btn.appendChild(title);
      btn.appendChild(cost);
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        audio.unlock();
        if (coopSession.active) {
          coopClient.sendOpenWorldAction({ kind: 'craft', recipeId: recipe.id });
        } else {
          const res = craftOpenWorldItem(openWorldState, recipe.id);
          if (res.ok) {
            audio.playKeyPickup();
            const actor = levelState.actors[activeCharId];
            spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 12, `Crafted ${recipe.name}!`, '#FFE89E');
            renderOpenWorldToolbar();
          }
        }
      });
      elOpenWorldCraftMenu.appendChild(btn);
    });
  }

  function syncHudStatic() {
    applyCoopUiLock();
    const activeSkin = getSkin(activeCharId, selectedSkins[activeCharId]);

    if (playMode === 'openworld') {
      elHudChapterNum.textContent = 'Open World';
      elHudChapterTitle.textContent = 'Cozy Open-World Meadow';
      elPauseChapterInfo.textContent = '2D Open-World Sandbox · Build & Craft Together';
      if (elHudKeyReadout) elHudKeyReadout.classList.add('hidden');
      document.body.dataset.chapter = 'openworld';
      document.body.dataset.world = '0';
      document.body.dataset.keys = 'openworld';
    } else {
      const level = LEVELS[currentLevelIdx];
      elHudChapterNum.textContent = level.shortCode || `W${level.worldId}-${level.stageInWorld}`;
      elHudChapterTitle.textContent = level.title;
      elHudKeyCount.textContent = `${levelState.keysCollected}/${levelState.keysRequired}`;
      elPauseChapterInfo.textContent = `${level.worldName} · ${level.shortCode} · ${level.title}`;
      if (elHudKeyReadout) elHudKeyReadout.classList.remove('hidden');
      document.body.dataset.chapter = String(level.id);
      document.body.dataset.world = String(level.worldId);
      document.body.dataset.keys = `${levelState.keysCollected}/${levelState.keysRequired}`;
    }

    elHudCharName.textContent = activeCharId === 'madjid' ? 'Madjid' : 'Nadine';
    elHudCharSwatch.style.backgroundColor = activeSkin.palette.body;
    elChatSpeaker.textContent = `Speaking as ${activeCharId === 'madjid' ? 'Madjid' : 'Nadine'}`;

    if (elHudCheckpoint) {
      const hasCp = Boolean(levelState.activeCheckpoint);
      elHudCheckpoint.classList.toggle('lit', hasCp);
      elHudCheckpoint.setAttribute('aria-label', hasCp ? 'Checkpoint active' : 'No checkpoint lit yet');
    }

    document.body.dataset.activeCharacter = activeCharId;
    renderOpenWorldToolbar();
  }

  function showCaption(text, durationMs = 7500) {
    elCaptionText.textContent = text;
    elCaptionBar.classList.remove('faded');
    if (captionTimeoutId) window.clearTimeout(captionTimeoutId);
    captionTimeoutId = window.setTimeout(() => {
      elCaptionBar.classList.add('faded');
    }, durationMs);
  }

  function setGameState(nextState) {
    gameState = nextState;
    document.body.dataset.state = nextState;

    elTitleScreen.classList.toggle('hidden', nextState !== 'title');
    elHudLayer.classList.toggle('hidden', nextState === 'title');
    elPauseModal.classList.toggle('hidden', nextState !== 'paused');

    if (nextState === 'playing') {
      clearInputs();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== elChatInput) {
        document.activeElement.blur();
      }
    }
  }

  function loadOpenWorld({ instantBg = false, showStory = true, syncedState = null } = {}) {
    playMode = 'openworld';
    if (syncedState) {
      openWorldState = createOpenWorldState(
        syncedState.blocks,
        syncedState.inventory,
        syncedState.theme || 'sunrise'
      );
      openWorldState.craftedTotal = syncedState.craftedTotal || 0;
    }

    const owDef = createOpenWorldLevelDefinition(openWorldState.theme);
    openWorldBasePlatforms = owDef.platforms.map((p) => ({ ...p }));
    levelState = createInitialLevelState(owDef);
    levelState.isOpenWorld = true;
    refreshOpenWorldCollisions();
    remoteActorTarget.active = false;

    if (coopSession.active && coopSession.localCharId) {
      activeCharId = coopSession.localCharId;
    }

    particles.clear();
    worldToasts.length = 0;

    bgSystem.setTheme(openWorldState.theme, instantBg, {
      landmark: owDef.landmark,
      ambient: owDef.ambient,
    });

    cameraX = 0;
    cameraY = 0;
    cameraLookAheadX = 0;
    hitstopTimer = 0;
    cameraShakeTrauma = 0;
    clearInputs();
    syncHudStatic();
    elHudTimer.textContent = '00:00';

    if (showStory) {
      showCaption(owDef.caption, 8500);
    }
  }

  function loadChapter(index, { instantBg = false, showStory = true } = {}) {
    playMode = 'story';
    currentLevelIdx = Math.max(0, Math.min(LEVELS.length - 1, index));
    const level = LEVELS[currentLevelIdx];
    const world = getWorldById(level.worldId);
    selectedWorldTab = world.id;
    levelState = createInitialLevelState(level);
    activeCharId = coopSession.active && coopSession.localCharId ? coopSession.localCharId : 'madjid';
    remoteActorTarget.active = false;
    particles.clear();
    worldToasts.length = 0;

    bgSystem.setTheme(level.theme, instantBg, {
      landmark: level.landmark || world.landmark,
      ambient: level.ambient || world.ambient,
      platformPalette: world.platformPalette,
    });

    cameraX = 0;
    cameraY = 0;
    cameraLookAheadX = 0;
    hitstopTimer = 0;
    cameraShakeTrauma = 0;
    clearInputs();
    syncHudStatic();
    elHudTimer.textContent = '00:00';

    if (showStory) {
      showCaption(`${level.worldName} (${level.code}): ${level.caption}`, 8200);
    }
  }

  function startNewGame(startChapterIdx = 0, { silent = false, fromRemote = false } = {}) {
    if (!silent) {
      audio.unlock();
      audio.playUiClick();
    }
    closeAllSubModals();
    elVictoryModal.classList.add('hidden');
    elChapterClearModal.classList.add('hidden');
    if (startChapterIdx === 0) {
      totalJourneyTime = 0;
      totalKeysCollectedRun = 0;
    }
    loadChapter(startChapterIdx, { instantBg: silent, showStory: true });
    setGameState('playing');
    if (coopSession.active && !fromRemote) {
      coopClient.setRoomMode({ mode: 'story', levelIndex: currentLevelIdx });
    }
  }

  function switchActiveCharacter() {
    // Strictly disabled in Co-op Mode (Story Levels & 2D Open-World Mode)
    if (coopSession.active) return;
    activeCharId = activeCharId === 'madjid' ? 'nadine' : 'madjid';
    const actor = levelState.actors[activeCharId];
    const skin = getSkin(activeCharId, selectedSkins[activeCharId]);
    actor.scaleX = 1.14;
    actor.scaleY = 0.88;
    particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.4, 8, {
      colors: [skin.palette.trail, '#FFF4C4'],
      minSpeed: 30,
      maxSpeed: 95,
      gravity: 60,
      size: 3.6,
      shape: 'spark',
    });
    audio.playSwitchChar(activeCharId);
    syncHudStatic();
  }

  // Sub-modals (Skins & 10-World Atlas)
  let skinModalTab = 'madjid';

  function renderSkinGrid() {
    const list = getSkinsForCharacter(skinModalTab);
    elSkinGrid.innerHTML = '';

    list.forEach((skin) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `skin-option-btn${selectedSkins[skinModalTab] === skin.id ? ' selected' : ''}`;
      btn.setAttribute('aria-pressed', String(selectedSkins[skinModalTab] === skin.id));
      btn.setAttribute('aria-label', `Select ${skin.name} skin for ${skinModalTab}`);

      const preview = document.createElement('canvas');
      preview.className = 'skin-preview-canvas';
      preview.width = 96;
      preview.height = 96;
      renderSkinPreview(preview, skinModalTab, skin.id, elapsedTime);

      const nameEl = document.createElement('span');
      nameEl.className = 'skin-name';
      nameEl.textContent = skin.name;

      const tagEl = document.createElement('span');
      tagEl.className = 'skin-tagline';
      tagEl.textContent = skin.tagline;

      btn.appendChild(preview);
      btn.appendChild(nameEl);
      btn.appendChild(tagEl);

      btn.addEventListener('click', () => {
        audio.unlock();
        audio.playUiClick();
        selectedSkins[skinModalTab] = skin.id;
        savePreferences();
        if (coopSession.active && skinModalTab === coopSession.localCharId) {
          coopClient.sendSkinUpdate(skin.id);
        }
        syncHudStatic();
        renderSkinGrid();
      });

      elSkinGrid.appendChild(btn);
    });

    document.querySelectorAll('.skin-tab').forEach((tab) => {
      const isSelected = tab.dataset.char === skinModalTab;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', String(isSelected));
    });
  }

  function openSkinsModal() {
    audio.unlock();
    audio.playUiClick();
    if (!activeSubModal) {
      modalReturnState = gameState;
    }
    activeSubModal = 'skins';
    elPauseModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elSkinsModal.classList.remove('hidden');
    clearInputs();
    renderSkinGrid();
  }

  function renderChaptersList() {
    elChaptersProgressLabel.textContent = `${WORLDS.length} Worlds · ${LEVELS.length} Stages · ${clearedLevelIds.size}/${LEVELS.length} Cleared`;

    // Render 10-World Tabs
    elWorldTabs.innerHTML = '';
    WORLDS.forEach((world) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.role = 'tab';
      const isSelected = world.id === selectedWorldTab;
      tab.className = `world-tab-btn${isSelected ? ' active' : ''}`;
      tab.setAttribute('aria-selected', String(isSelected));
      tab.setAttribute('aria-label', `World ${world.id}: ${world.name}`);

      const numSpan = document.createElement('span');
      numSpan.textContent = `W${world.id}`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'world-tab-name';
      nameSpan.textContent = world.name.split(' ')[0];

      tab.appendChild(numSpan);
      tab.appendChild(nameSpan);

      tab.addEventListener('click', () => {
        audio.unlock();
        audio.playUiClick();
        selectedWorldTab = world.id;
        renderChaptersList();
      });

      elWorldTabs.appendChild(tab);
    });

    // Update World Banner
    const activeWorld = getWorldById(selectedWorldTab);
    const worldThemeLabel = TIME_PRESETS[activeWorld.theme]?.label || activeWorld.theme;
    elWorldBannerKicker.textContent = `World ${activeWorld.id} of ${WORLDS.length}`;
    elWorldBannerName.textContent = activeWorld.name;
    elWorldBannerMeta.textContent = `${activeWorld.subtitle} · ${worldThemeLabel}`;

    // Render 5 Stages for Selected World
    elChaptersList.innerHTML = '';
    const worldLevels = getLevelsForWorld(selectedWorldTab);
    worldLevels.forEach((lvl) => {
      const globalIdx = LEVELS.findIndex((item) => item.id === lvl.id);
      const isCurrent = globalIdx === currentLevelIdx && gameState !== 'title' && playMode === 'story';
      const isCleared = clearedLevelIds.has(lvl.id);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chapter-row-btn${isCurrent ? ' is-current' : ''}`;

      const main = document.createElement('div');
      main.className = 'chapter-row-main';

      const title = document.createElement('span');
      title.className = 'chapter-row-title';
      title.textContent = `${lvl.code} · ${lvl.title}`;

      const themeLabel = TIME_PRESETS[lvl.theme]?.label || lvl.theme;
      const cpCount = lvl.checkpoints?.length || 0;
      const meta = document.createElement('span');
      meta.className = 'chapter-row-meta';
      meta.textContent = `${themeLabel} · ${lvl.exit.keysRequired} Key${lvl.exit.keysRequired > 1 ? 's' : ''}${cpCount > 0 ? ` · ${cpCount} Lantern${cpCount > 1 ? 's' : ''}` : ''}`;

      main.appendChild(title);
      main.appendChild(meta);

      const status = document.createElement('span');
      status.className = `chapter-row-status${isCleared ? ' cleared' : ''}`;
      status.textContent = isCurrent ? 'Current' : isCleared ? 'Cleared' : 'Play';

      btn.appendChild(main);
      btn.appendChild(status);

      btn.addEventListener('click', () => {
        if (globalIdx >= 0) {
          startNewGame(globalIdx);
        }
      });

      elChaptersList.appendChild(btn);
    });
  }

  function openChaptersModal() {
    audio.unlock();
    audio.playUiClick();
    if (!activeSubModal) {
      modalReturnState = gameState;
    }
    selectedWorldTab = LEVELS[currentLevelIdx]?.worldId || 1;
    activeSubModal = 'chapters';
    elPauseModal.classList.add('hidden');
    elSkinsModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elChaptersModal.classList.remove('hidden');
    clearInputs();
    renderChaptersList();
  }

  // =========================================================================
  // ONLINE 2-PLAYER CO-OP LOBBY & WEBSOCKET SYNC WIRING
  // =========================================================================

  function setCoopFeedback(message = '', isSuccess = false) {
    if (!elCoopFeedback) return;
    elCoopFeedback.textContent = message;
    elCoopFeedback.classList.toggle('hidden', !message);
    elCoopFeedback.classList.toggle('success', Boolean(isSuccess));
  }

  function renderCoopRoomsList(rooms) {
    coopDirectoryRooms = Array.isArray(rooms) ? rooms : [];
    elCoopRoomsList.innerHTML = '';

    if (coopDirectoryRooms.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'coop-empty-text';
      empty.textContent = coopClient.isConnected()
        ? 'No active rooms found. Create one on the left!'
        : 'Connect to a cloud server to browse active rooms.';
      elCoopRoomsList.appendChild(empty);
      return;
    }

    coopDirectoryRooms.forEach((room) => {
      const row = document.createElement('div');
      row.className = 'coop-room-row';
      row.setAttribute('role', 'listitem');

      const info = document.createElement('div');
      info.className = 'coop-room-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'coop-room-name';
      nameEl.textContent = room.name;

      const modeText = room.mode === 'openworld' ? '2D Open-World' : `Story W${Math.floor((room.levelIndex || 0) / 5) + 1}-${((room.levelIndex || 0) % 5) + 1}`;
      const metaEl = document.createElement('span');
      metaEl.className = 'coop-room-meta';
      metaEl.textContent = `${room.code} · ${modeText} · ${room.playerCount}/${room.maxPlayers} Players`;

      info.appendChild(nameEl);
      info.appendChild(metaEl);

      const joinBtn = document.createElement('button');
      joinBtn.type = 'button';
      joinBtn.className = `coop-mini-btn${room.isFull ? '' : ' coop-mini-gold'}`;
      joinBtn.disabled = Boolean(room.isFull);
      joinBtn.textContent = room.isFull ? 'Full (2/2)' : 'Join';
      joinBtn.addEventListener('click', () => {
        audio.unlock();
        audio.playUiClick();
        setCoopFeedback('');
        coopClient.joinRoom(room.code, { skinId: selectedSkins.nadine });
      });

      row.appendChild(info);
      row.appendChild(joinBtn);
      elCoopRoomsList.appendChild(row);
    });
  }

  function renderCoopSessionPanel() {
    const inRoom = coopSession.active && Boolean(coopSession.room);
    elCoopActivePanel.classList.toggle('hidden', !inRoom);
    elCoopLobbyPanels.classList.toggle('hidden', inRoom);

    if (!inRoom) return;
    const room = coopSession.room;
    elCoopActiveName.textContent = room.name;
    elCoopActiveCode.textContent = room.code;

    elCoopActiveRoster.innerHTML = '';
    ['madjid', 'nadine'].forEach((cid) => {
      const member = (room.players || []).find((p) => p.character === cid);
      const card = document.createElement('div');
      card.className = 'coop-slot-card';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${cid === 'madjid' ? 'Madjid' : 'Nadine'}${coopSession.localCharId === cid ? ' (You)' : ''}`;

      const statusSpan = document.createElement('span');
      statusSpan.className = `coop-slot-status${member ? ' online' : ''}`;
      statusSpan.textContent = member ? 'Connected' : 'Waiting for partner';

      card.appendChild(nameSpan);
      card.appendChild(statusSpan);
      elCoopActiveRoster.appendChild(card);
    });
  }

  function broadcastStorySnapshot(eventName) {
    if (!coopSession.active || playMode !== 'story' || isApplyingRemoteUpdate) return;
    coopClient.sendStorySync({
      event: eventName,
      levelIndex: currentLevelIdx,
      switches: levelState.switches.map((s) => ({ id: s.id, toggled: s.toggled, pressed: s.pressed })),
      keys: levelState.keys.map((k) => ({ id: k.id, collected: k.collected })),
      gates: levelState.gates.map((g) => ({ id: g.id, latchedOpen: g.latchedOpen })),
      activeCheckpointId: levelState.activeCheckpoint ? levelState.activeCheckpoint.id : null,
      completed: levelState.completed,
    });
  }

  function applyRemoteStorySync(payload) {
    if (!payload || playMode !== 'story') return;
    isApplyingRemoteUpdate = true;
    try {
      if (payload.event === 'restart' && Number.isInteger(payload.levelIndex)) {
        loadChapter(payload.levelIndex, { instantBg: false, showStory: false });
        return;
      }
      if (Number.isInteger(payload.levelIndex) && payload.levelIndex !== currentLevelIdx) {
        startNewGame(payload.levelIndex, { silent: true, fromRemote: true });
      }
      if (Array.isArray(payload.switches)) {
        payload.switches.forEach((rs) => {
          const sw = levelState.switches.find((s) => s.id === rs.id);
          if (sw && sw.mode === 'toggle' && sw.toggled !== rs.toggled) {
            sw.toggled = Boolean(rs.toggled);
            sw.pressed = sw.toggled;
          }
        });
      }
      if (Array.isArray(payload.gates)) {
        payload.gates.forEach((rg) => {
          const g = levelState.gates.find((item) => item.id === rg.id);
          if (g && rg.latchedOpen && !g.latchedOpen) {
            g.latchedOpen = true;
          }
        });
      }
      if (Array.isArray(payload.keys)) {
        payload.keys.forEach((rk) => {
          const key = levelState.keys.find((item) => item.id === rk.id);
          if (key && rk.collected && !key.collected) {
            key.collected = true;
            levelState.keysCollected += 1;
            audio.playKeyPickup();
            if (!levelState.portalUnlocked && levelState.keysCollected >= levelState.keysRequired) {
              levelState.portalUnlocked = true;
              audio.playDoorUnlock();
            }
          }
        });
        syncHudStatic();
      }
      if (payload.activeCheckpointId) {
        const cp = levelState.checkpoints.find((c) => c.id === payload.activeCheckpointId);
        if (cp && !cp.activated) {
          cp.activated = true;
          cp.pulse = 1;
          levelState.activeCheckpoint = {
            id: cp.id,
            x: cp.x,
            y: cp.y,
            madjid: {
              x: clamp(cp.x - 28, 8, levelState.worldWidth - PHYSICS.CHAR_W - 8),
              y: cp.y - PHYSICS.CHAR_H,
            },
            nadine: {
              x: clamp(cp.x + 8, 8, levelState.worldWidth - PHYSICS.CHAR_W - 8),
              y: cp.y - PHYSICS.CHAR_H,
            },
          };
          audio.playCheckpoint();
          syncHudStatic();
        }
      }
      if (payload.completed && !levelState.completed) {
        levelState.completed = true;
        simCallbacks.onLevelComplete(levelState);
      }
    } finally {
      isApplyingRemoteUpdate = false;
    }
  }

  function applyRoomSnapshot(room, assignedChar = null) {
    if (!room) return;
    coopSession.active = true;
    coopSession.room = room;
    coopSession.roomCode = room.code;
    coopSession.roomName = room.name;
    if (assignedChar) {
      coopSession.localCharId = assignedChar;
      coopSession.remoteCharId = assignedChar === 'madjid' ? 'nadine' : 'madjid';
      activeCharId = assignedChar;
    }
    coopSession.partnerConnected = (room.players || []).length >= 2;

    if (room.skins) {
      if (room.skins.madjid) selectedSkins.madjid = getSkin('madjid', room.skins.madjid).id;
      if (room.skins.nadine) selectedSkins.nadine = getSkin('nadine', room.skins.nadine).id;
    }

    applyCoopUiLock();
    renderCoopSessionPanel();
  }

  const coopClient = createCoopClient({
    onStatus(status, url, detail) {
      if (!elCoopConnStatus) return;
      elCoopConnStatus.classList.remove('connected', 'connecting');
      if (status === 'connected') {
        elCoopConnStatus.classList.add('connected');
        elCoopConnStatus.textContent = `Connected (${url})`;
      } else if (status === 'connecting') {
        elCoopConnStatus.classList.add('connecting');
        elCoopConnStatus.textContent = `Connecting to ${url}...`;
      } else {
        elCoopConnStatus.textContent = detail ? `Disconnected: ${detail}` : 'Disconnected';
      }
    },
    onRooms(rooms) {
      renderCoopRoomsList(rooms);
    },
    onRoomJoined(msg) {
      setCoopFeedback(`Joined "${msg.room.name}" as ${msg.character === 'madjid' ? 'Madjid' : 'Nadine'}.`, true);
      applyRoomSnapshot(msg.room, msg.character);

      if (Array.isArray(msg.room.chat)) {
        msg.room.chat.forEach((chatMsg) => receiveChatMessage(chatMsg));
      }
      receiveChatMessage({
        senderId: 'story',
        senderName: 'Co-op',
        text: `Connected to room "${msg.room.name}" (${msg.room.code}) as ${msg.character === 'madjid' ? 'Madjid' : 'Nadine'}. Switch control is disabled so each player controls their own character.`,
        timestamp: msg.room.code,
      });

      closeAllSubModals();
      elVictoryModal.classList.add('hidden');
      elChapterClearModal.classList.add('hidden');

      if (msg.room.mode === 'openworld') {
        loadOpenWorld({ instantBg: false, showStory: true, syncedState: msg.room.openWorld });
      } else {
        loadChapter(msg.room.levelIndex || 0, { instantBg: false, showStory: true });
      }
      setGameState('playing');
      syncHudStatic();
    },
    onRoomLeft() {
      coopSession.active = false;
      coopSession.room = null;
      coopSession.roomCode = null;
      coopSession.roomName = '';
      coopSession.localCharId = null;
      coopSession.remoteCharId = null;
      coopSession.partnerConnected = false;
      remoteActorTarget.active = false;
      applyCoopUiLock();
      renderCoopSessionPanel();
      syncHudStatic();
      coopClient.listRooms('');
    },
    onRoomMode(room) {
      applyRoomSnapshot(room);
      elChapterClearModal.classList.add('hidden');
      elVictoryModal.classList.add('hidden');
      if (room.mode === 'openworld') {
        loadOpenWorld({ instantBg: false, showStory: true, syncedState: room.openWorld });
      } else {
        loadChapter(room.levelIndex || 0, { instantBg: false, showStory: true });
      }
      if (activeSubModal === 'coop') {
        closeAllSubModals();
      }
      setGameState('playing');
    },
    onPartnerJoined(msg) {
      applyRoomSnapshot(msg.room);
      syncHudStatic();
      const who = msg.character === 'madjid' ? 'Madjid' : 'Nadine';
      receiveChatMessage({
        senderId: 'story',
        senderName: 'Co-op',
        text: `${who} joined your room!`,
        timestamp: msg.room?.code || '',
      });
      audio.playPortalEnter();
    },
    onPartnerLeft(msg) {
      if (msg.room) applyRoomSnapshot(msg.room);
      remoteActorTarget.active = false;
      syncHudStatic();
      const who = msg.character === 'madjid' ? 'Madjid' : 'Nadine';
      receiveChatMessage({
        senderId: 'story',
        senderName: 'Co-op',
        text: `${who} left the room.`,
        timestamp: msg.room?.code || '',
      });
    },
    onPlayerState(charId, state) {
      if (!coopSession.active || charId === coopSession.localCharId || !state) return;
      remoteActorTarget.active = true;
      remoteActorTarget.charId = charId;
      remoteActorTarget.x = Number(state.x) || 0;
      remoteActorTarget.y = Number(state.y) || 0;
      remoteActorTarget.vx = Number(state.vx) || 0;
      remoteActorTarget.vy = Number(state.vy) || 0;
      remoteActorTarget.facing = state.facing === -1 ? -1 : 1;
      remoteActorTarget.grounded = Boolean(state.grounded);
      remoteActorTarget.scaleX = Number(state.scaleX) || 1;
      remoteActorTarget.scaleY = Number(state.scaleY) || 1;
      remoteActorTarget.mood = state.mood || 'normal';
      remoteActorTarget.hurtTimer = Number(state.hurtTimer) || 0;
      remoteActorTarget.invulnTimer = Number(state.invulnTimer) || 0;
      remoteActorTarget.kissLean = Number(state.kissLean) || 0;
      remoteActorTarget.inPortal = Boolean(state.inPortal);
      remoteActorTarget.walkDist = Number(state.walkDist) || 0;
    },
    onStorySync(_fromChar, payload) {
      applyRemoteStorySync(payload);
    },
    onWorldUpdated(update) {
      if (update.inventory) {
        openWorldState.inventory = { ...openWorldState.inventory, ...update.inventory };
      }
      if (typeof update.craftedTotal === 'number') {
        openWorldState.craftedTotal = update.craftedTotal;
      }

      if (update.kind === 'place' && update.block) {
        openWorldState.blocks.set(blockKey(update.block.gx, update.block.gy), update.block);
        refreshOpenWorldCollisions();
        const bx = update.block.gx * OPEN_WORLD_CONFIG.TILE_SIZE + 20;
        const by = update.block.gy * OPEN_WORLD_CONFIG.TILE_SIZE + 20;
        particles.burst(bx, by, 7, {
          colors: ['#FFF4C4', OPEN_WORLD_BLOCKS[update.block.type]?.color || '#FFE08A'],
          minSpeed: 30,
          maxSpeed: 95,
          size: 3.6,
          shape: 'spark',
          gravity: 110,
        });
        audio.playSwitchPress();
      } else if (update.kind === 'remove' && Number.isInteger(update.gx) && Number.isInteger(update.gy)) {
        openWorldState.blocks.delete(blockKey(update.gx, update.gy));
        refreshOpenWorldCollisions();
        audio.playSwitchRelease();
      } else if (update.kind === 'craft' && update.recipeId) {
        const recipe = CRAFT_RECIPES.find((r) => r.id === update.recipeId);
        audio.playKeyPickup();
        const actor = levelState.actors[update.actorCharacter || activeCharId];
        if (actor && recipe) {
          spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 12, `Crafted ${recipe.name}!`, '#FFE89E');
        }
      } else if (update.kind === 'theme' && update.theme) {
        openWorldState.theme = update.theme;
        if (playMode === 'openworld') {
          const def = createOpenWorldLevelDefinition(openWorldState.theme);
          bgSystem.setTheme(openWorldState.theme, false, {
            landmark: def.landmark,
            ambient: def.ambient,
          });
        }
      }

      renderOpenWorldToolbar();
    },
    onSkinUpdated(charId, skinId) {
      if (charId === 'madjid' || charId === 'nadine') {
        selectedSkins[charId] = getSkin(charId, skinId).id;
        syncHudStatic();
      }
    },
    onChatMessage(msg) {
      receiveChatMessage(msg);
      audio.playChatPing();
    },
    onError(_code, message) {
      setCoopFeedback(message, false);
    },
  });

  if (elCoopServerUrl) {
    elCoopServerUrl.value = getDefaultWsUrl();
  }

  function openCoopModal() {
    audio.unlock();
    audio.playUiClick();
    if (!activeSubModal) {
      modalReturnState = gameState;
    }
    activeSubModal = 'coop';
    setCoopFeedback('');
    elPauseModal.classList.add('hidden');
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.remove('hidden');
    clearInputs();
    renderCoopSessionPanel();
    if (!coopClient.isConnected()) {
      coopClient.connect(elCoopServerUrl.value || getDefaultWsUrl());
    } else {
      coopClient.listRooms(elCoopSearchInput.value || '');
    }
  }

  function closeAllSubModals() {
    activeSubModal = null;
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    if (gameState === 'paused') {
      elPauseModal.classList.remove('hidden');
    }
  }

  function closeModalAndReturn() {
    audio.playUiClick();
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    activeSubModal = null;
    setGameState(modalReturnState);
  }

  // Simulation Callbacks (Weight-Scaled Audio + Zero-GC Particle Juice + Micro-Hitstop)
  const simCallbacks = {
    onJump(actor) {
      audio.playJump(actor.id);
      const skin = getSkin(actor.id, selectedSkins[actor.id]);
      particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h, 6, {
        angleBase: -Math.PI * 0.5,
        spread: 1.8,
        minSpeed: 30,
        maxSpeed: 85,
        colors: ['#FFF8E8', skin.palette.trail],
        size: 3.6,
        life: 0.38,
        gravity: 160,
      });
    },
    onLand(actor, impact) {
      audio.playLand(impact);
      particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h, Math.round(3 + impact * 4), {
        angleBase: -Math.PI * 0.5,
        spread: 2.3,
        minSpeed: 24,
        maxSpeed: 76,
        colors: ['#FFF5E0', '#D8CEBF'],
        size: 3.2,
        life: 0.34,
        gravity: 140,
      });
    },
    onCheckpoint(cp) {
      audio.playCheckpoint();
      hitstopTimer = 0.03;
      particles.burst(cp.x, cp.y - 34, 16, {
        colors: ['#FFF8D6', '#FBBF24', '#F59BB2'],
        minSpeed: 45,
        maxSpeed: 140,
        size: 4.5,
        shape: 'spark',
        gravity: 65,
        life: 0.72,
      });
      spawnWorldToast(cp.x, cp.y - 56, 'Checkpoint!', '#FFE89E');
      syncHudStatic();
      broadcastStorySnapshot('checkpoint');
    },
    onCry(actor) {
      audio.playCry(actor.id);
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.28);
      particles.burst(actor.x + actor.w * 0.5, actor.y + 12, 8, {
        angleBase: -Math.PI * 0.5,
        spread: 2.0,
        minSpeed: 40,
        maxSpeed: 105,
        colors: ['#87D7FF', '#CBEFFF'],
        size: 4.2,
        shape: 'tear',
        gravity: 340,
        life: 0.58,
      });
    },
    onTear(actor) {
      const cx = actor.x + actor.w * 0.5;
      const cy = actor.y + 14;
      [-7, 7].forEach((side) => {
        particles.spawn({
          x: cx + side,
          y: cy,
          vx: side * 6 + (Math.random() - 0.5) * 16,
          vy: -42 - Math.random() * 24,
          life: 0.52,
          size: 3.6,
          color: '#87D7FF',
          shape: 'tear',
          gravity: 320,
        });
      });
    },
    onRespawn(actor) {
      audio.playRespawn();
      particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.5, 12, {
        colors: ['#FFF8E8', '#FFE299', '#A8E0FF'],
        minSpeed: 35,
        maxSpeed: 105,
        size: 4,
        shape: 'spark',
        gravity: 35,
      });
    },
    onKiss(midX, midY) {
      audio.playKiss();
      particles.burst(midX, midY, 8, {
        angleBase: -Math.PI * 0.5,
        spread: 1.4,
        minSpeed: 26,
        maxSpeed: 68,
        colors: ['#F472B6', '#FDA4AF', '#FFF2C6'],
        size: 5.6,
        shape: 'heart',
        gravity: -28,
        life: 1.25,
      });
      particles.burst(midX, midY + 4, 6, {
        angleBase: -Math.PI * 0.5,
        spread: 2.2,
        minSpeed: 24,
        maxSpeed: 64,
        colors: ['#FFF8D6', '#FDE68A'],
        size: 3.6,
        shape: 'spark',
        gravity: -16,
        life: 0.85,
      });
    },
    onCozySparkle(midX, midY) {
      audio.playCozySparkle();
      particles.burst(midX, midY, 4, {
        angleBase: -Math.PI * 0.5,
        spread: 1.6,
        minSpeed: 20,
        maxSpeed: 52,
        colors: ['#FFF4C4', '#F9A8D4'],
        size: 3.8,
        shape: 'spark',
        gravity: -18,
        life: 0.72,
      });
    },
    onSwitchPress(sw) {
      audio.playSwitchPress();
      particles.burst(sw.x + sw.w * 0.5, sw.y - 6, 8, {
        colors: [sw.color, '#FFF5C4'],
        minSpeed: 40,
        maxSpeed: 105,
        size: 3.4,
        shape: 'spark',
        gravity: 120,
      });
    },
    onSwitchRelease() {
      audio.playSwitchRelease();
    },
    onSwitchToggle(sw, toggled) {
      if (toggled) {
        audio.playSwitchPress();
        hitstopTimer = 0.03;
        particles.burst(sw.x + sw.w * 0.5, sw.y - 8, 12, {
          colors: ['#FFF4C4', sw.color, '#FFFFFF'],
          minSpeed: 50,
          maxSpeed: 135,
          size: 4.2,
          shape: 'spark',
          gravity: 90,
        });
      } else {
        audio.playSwitchRelease();
      }
      broadcastStorySnapshot('switch');
    },
    onGateUnseal(gate) {
      audio.playDoorUnlock();
      hitstopTimer = 0.045;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.35);
      particles.burst(gate.closedX + gate.w * 0.5, gate.closedY + gate.h * 0.5, 18, {
        colors: ['#FFF5C4', gate.color, '#FFFFFF'],
        minSpeed: 65,
        maxSpeed: 185,
        size: 4.6,
        shape: 'spark',
        gravity: 120,
      });
      broadcastStorySnapshot('gate');
    },
    onGateOpen() {
      audio.playSwitchPress();
    },
    onKeyPickup(key) {
      audio.playKeyPickup();
      hitstopTimer = 0.04;
      particles.burst(key.x, key.y, 16, {
        colors: ['#FFF8C9', '#FBBF24', '#FDE68A'],
        minSpeed: 55,
        maxSpeed: 165,
        size: 4.6,
        shape: 'spark',
        gravity: 80,
      });
      syncHudStatic();
      broadcastStorySnapshot('key');
    },
    onPortalUnlock(exit) {
      audio.playDoorUnlock();
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.25);
      particles.burst(exit.x + exit.w * 0.5, exit.y + exit.h * 0.45, 22, {
        colors: ['#FFF8D6', '#FBBF24', '#F472B6', '#7CC4FA'],
        minSpeed: 65,
        maxSpeed: 195,
        size: 5,
        shape: 'spark',
        gravity: 70,
      });
    },
    onPortalEnter(actor) {
      audio.playPortalEnter();
      particles.burst(actor.x + actor.w * 0.5, actor.y + 8, 6, {
        colors: ['#F472B6', '#FFF5C4'],
        minSpeed: 28,
        maxSpeed: 72,
        size: 5,
        shape: 'heart',
        gravity: -40,
        life: 0.9,
      });
    },
    onLevelComplete(snapshot) {
      totalJourneyTime += snapshot.elapsed;
      totalKeysCollectedRun += snapshot.keysCollected;
      const lvl = LEVELS[currentLevelIdx];
      clearedLevelIds.add(lvl.id);
      savePreferences();

      const isFinalChapter = currentLevelIdx >= LEVELS.length - 1;

      const ex = snapshot.exit.x + snapshot.exit.w * 0.5;
      const ey = snapshot.exit.y + snapshot.exit.h * 0.35;
      particles.burst(ex, ey, 28, {
        colors: ['#F472B6', '#FBBF24', '#7CC4FA', '#FFF8D6'],
        minSpeed: 70,
        maxSpeed: 240,
        size: 6,
        shape: 'heart',
        gravity: 95,
        life: 1.35,
      });

      if (isFinalChapter) {
        audio.playJourneyComplete();
        document.getElementById('victory-chapters-val').textContent = `${WORLDS.length}/${WORLDS.length}`;
        document.getElementById('victory-time-val').textContent = formatTime(totalJourneyTime);
        document.getElementById('victory-keys-val').textContent = `${LEVELS.length}/${LEVELS.length}`;
        setGameState('gameover');
        elVictoryModal.classList.remove('hidden');
      } else {
        audio.playLevelComplete();
        document.getElementById('clear-kicker').textContent = `${lvl.worldName} · Stage ${lvl.code} Complete`;
        document.getElementById('chapter-clear-title').textContent = lvl.title;
        document.getElementById('clear-story-note').textContent = lvl.caption;
        document.getElementById('clear-time-val').textContent = formatTime(snapshot.elapsed);
        document.getElementById('clear-keys-val').textContent = `${snapshot.keysCollected}/${snapshot.keysRequired}`;
        document.getElementById('clear-switches-val').textContent = String(snapshot.switchesTriggeredCount);
        activeSubModal = 'chapter-clear';
        elChapterClearModal.classList.remove('hidden');
        document.body.dataset.state = 'gameover';
      }
      broadcastStorySnapshot('complete');
    },
  };

  // =========================================================================
  // EVENT LISTENERS (Keyboard, Multi-Touch, Window Blur, HUD, Modals, Chat)
  // =========================================================================

  window.addEventListener('keydown', (e) => {
    audio.unlock();

    if (isChatFocused()) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (document.activeElement === elChatInput) {
          toggleChatBox(false);
        } else if (activeSubModal === 'coop') {
          document.activeElement?.blur?.();
          closeModalAndReturn();
        } else {
          document.activeElement?.blur?.();
        }
      }
      return;
    }

    if (gameState === 'title' && !activeSubModal) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startNewGame(0);
      }
      return;
    }

    if (activeSubModal === 'skins' || activeSubModal === 'chapters' || activeSubModal === 'coop') {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModalAndReturn();
      }
      return;
    }

    if (activeSubModal === 'chapter-clear') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        elChapterClearModal.classList.add('hidden');
        activeSubModal = null;
        startNewGame(currentLevelIdx + 1);
      }
      return;
    }

    if (gameState === 'gameover') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startNewGame(0);
      }
      return;
    }

    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (gameState === 'playing') {
        if (!elChatBox.classList.contains('hidden')) {
          toggleChatBox(false);
        } else {
          setGameState('paused');
        }
      } else if (gameState === 'paused') {
        setGameState('playing');
      }
      return;
    }

    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      audio.toggleMute();
      syncMuteUI();
      return;
    }

    if (gameState !== 'playing') return;

    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      toggleChatBox(true);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!coopSession.active) {
        switchActiveCharacter();
      }
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      audio.playRestart();
      if (playMode === 'openworld') {
        const owDef = createOpenWorldLevelDefinition(openWorldState.theme);
        const actor = levelState.actors[activeCharId];
        const sp = owDef.spawns[activeCharId];
        actor.x = sp.x;
        actor.y = sp.y;
        actor.vx = 0;
        actor.vy = 0;
      } else {
        loadChapter(currentLevelIdx, { instantBg: false, showStory: false });
        broadcastStorySnapshot('restart');
      }
      return;
    }

    const code = e.code;
    if (
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'ArrowUp' ||
      code === 'Space' ||
      code === 'KeyA' ||
      code === 'KeyD' ||
      code === 'KeyW'
    ) {
      e.preventDefault();
      const wasJumpKey = keysHeld.has('Space') || keysHeld.has('ArrowUp') || keysHeld.has('KeyW');
      keysHeld.add(code);
      const isJumpKey = code === 'Space' || code === 'ArrowUp' || code === 'KeyW';
      if (isJumpKey && !wasJumpKey) {
        localJumpJustPressed = true;
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    const wasJumpKey = keysHeld.has('Space') || keysHeld.has('ArrowUp') || keysHeld.has('KeyW');
    keysHeld.delete(code);
    const nowJumpKey = keysHeld.has('Space') || keysHeld.has('ArrowUp') || keysHeld.has('KeyW');
    if (wasJumpKey && !nowJumpKey && !touchHeld.jump) {
      localJumpJustReleased = true;
    }
  });

  window.addEventListener('blur', clearInputs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInputs();
  });

  // Multi-Touch On-Screen Controls
  const activePointerActions = new Map();

  function updateTouchAction(action, pressed) {
    if (action === 'left') touchHeld.left = pressed;
    if (action === 'right') touchHeld.right = pressed;
    if (action === 'jump') {
      if (pressed && !touchHeld.jump) localJumpJustPressed = true;
      if (!pressed && touchHeld.jump) localJumpJustReleased = true;
      touchHeld.jump = pressed;
    }
  }

  document.querySelectorAll('.touch-btn').forEach((btn) => {
    const action = btn.dataset.action;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.unlock();
      if (gameState !== 'playing') return;

      if (action === 'switch') {
        if (coopSession.active) return;
        btn.classList.add('pressed');
        switchActiveCharacter();
        window.setTimeout(() => btn.classList.remove('pressed'), 120);
        return;
      }

      btn.setPointerCapture?.(e.pointerId);
      activePointerActions.set(e.pointerId, { action, btn });
      btn.classList.add('pressed');
      updateTouchAction(action, true);
    });

    const releasePointer = (e) => {
      const entry = activePointerActions.get(e.pointerId);
      if (!entry) return;
      activePointerActions.delete(e.pointerId);
      entry.btn.classList.remove('pressed');

      const stillHeld = Array.from(activePointerActions.values()).some((v) => v.action === entry.action);
      if (!stillHeld) {
        updateTouchAction(entry.action, false);
      }
    };

    btn.addEventListener('pointerup', releasePointer);
    btn.addEventListener('pointercancel', releasePointer);
  });

  // Title, HUD, Modal, Open-World, Co-op & Chat DOM Handlers
  document.getElementById('btn-start-journey').addEventListener('click', (e) => {
    e.currentTarget.blur();
    startNewGame(0);
  });
  document.getElementById('btn-title-coop').addEventListener('click', openCoopModal);
  document.getElementById('btn-title-skins').addEventListener('click', openSkinsModal);
  document.getElementById('btn-title-chapters').addEventListener('click', openChaptersModal);

  elHudBtnCoop.addEventListener('click', (e) => {
    e.currentTarget.blur();
    openCoopModal();
  });

  elHudCharBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    if (gameState === 'playing' && !coopSession.active) switchActiveCharacter();
  });

  document.getElementById('hud-btn-skins').addEventListener('click', (e) => {
    e.currentTarget.blur();
    openSkinsModal();
  });

  elChatBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    toggleChatBox();
  });

  document.getElementById('btn-close-chat').addEventListener('click', () => toggleChatBox(false));

  elChatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = elChatInput.value.trim();
    if (!text) return;
    chatTransport.send(text);
    elChatInput.value = '';
    elChatInput.focus();
  });

  document.getElementById('hud-btn-restart').addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playRestart();
    if (playMode === 'openworld') {
      const owDef = createOpenWorldLevelDefinition(openWorldState.theme);
      const actor = levelState.actors[activeCharId];
      actor.x = owDef.spawns[activeCharId].x;
      actor.y = owDef.spawns[activeCharId].y;
      actor.vx = 0;
      actor.vy = 0;
    } else {
      loadChapter(currentLevelIdx, { instantBg: false, showStory: false });
      broadcastStorySnapshot('restart');
    }
  });

  elMuteBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.toggleMute();
    syncMuteUI();
  });

  document.getElementById('hud-btn-pause').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (gameState === 'playing') setGameState('paused');
  });

  document.getElementById('btn-dismiss-caption').addEventListener('click', (e) => {
    e.currentTarget.blur();
    elCaptionBar.classList.add('faded');
  });

  document.getElementById('btn-pause-resume').addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.playUiClick();
    setGameState('playing');
  });
  document.getElementById('btn-pause-coop').addEventListener('click', openCoopModal);
  document.getElementById('btn-pause-openworld').addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    closeAllSubModals();
    if (coopSession.active) {
      coopClient.setRoomMode({ mode: 'openworld' });
    } else {
      loadOpenWorld({ instantBg: false, showStory: true });
      setGameState('playing');
    }
  });
  document.getElementById('btn-pause-restart').addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.playRestart();
    if (playMode === 'openworld') {
      loadOpenWorld({ instantBg: false, showStory: false });
    } else {
      loadChapter(currentLevelIdx, { instantBg: false, showStory: false });
      broadcastStorySnapshot('restart');
    }
    setGameState('playing');
  });
  document.getElementById('btn-pause-skins').addEventListener('click', openSkinsModal);
  document.getElementById('btn-pause-chapters').addEventListener('click', openChaptersModal);
  document.getElementById('btn-pause-title').addEventListener('click', () => {
    audio.playUiClick();
    toggleChatBox(false);
    if (coopSession.active) {
      coopClient.leaveRoom();
    }
    loadChapter(0, { instantBg: false, showStory: false });
    setGameState('title');
  });

  // 2D Open-World Toolbar & Canvas Build/Remove Handlers
  elOpenWorldCraftBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    const nextOpen = elOpenWorldCraftMenu.classList.contains('hidden');
    elOpenWorldCraftMenu.classList.toggle('hidden', !nextOpen);
    elOpenWorldCraftBtn.classList.toggle('active', nextOpen);
    if (nextOpen) {
      elCaptionBar.classList.add('faded');
    }
  });

  elOpenWorldSkyBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    const order = ['sunrise', 'sunset', 'night'];
    const nextTheme = order[(order.indexOf(openWorldState.theme) + 1) % order.length];
    if (coopSession.active) {
      coopClient.sendOpenWorldAction({ kind: 'theme', theme: nextTheme });
    } else {
      openWorldState.theme = nextTheme;
      const def = createOpenWorldLevelDefinition(nextTheme);
      bgSystem.setTheme(nextTheme, false, { landmark: def.landmark, ambient: def.ambient });
      renderOpenWorldToolbar();
    }
  });

  elOpenWorldStoryBtn.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    if (coopSession.active) {
      coopClient.setRoomMode({ mode: 'story', levelIndex: currentLevelIdx });
    } else {
      startNewGame(currentLevelIdx);
    }
  });

  function screenToOpenWorldCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = (sx - lastFrameTransform.offsetX) / lastFrameTransform.scale;
    const wy = (sy - lastFrameTransform.offsetY) / lastFrameTransform.scale;
    const gx = Math.floor(wx / OPEN_WORLD_CONFIG.TILE_SIZE);
    const gy = Math.floor(wy / OPEN_WORLD_CONFIG.TILE_SIZE);
    return { gx, gy };
  }

  function handleOpenWorldPointerAction(gx, gy, forceBreak = false) {
    if (!isValidBlockCoord(gx, gy)) return;
    const shouldBreak = forceBreak || openWorldSelectedTool === 'break';

    if (shouldBreak) {
      if (coopSession.active) {
        coopClient.sendOpenWorldAction({ kind: 'remove', gx, gy });
      } else {
        const res = removeOpenWorldBlock(openWorldState, gx, gy, { refundInventory: true });
        if (res.ok && res.removed) {
          refreshOpenWorldCollisions();
          renderOpenWorldToolbar();
          audio.playSwitchRelease();
        }
      }
      return;
    }

    const def = OPEN_WORLD_BLOCKS[openWorldSelectedTool];
    if (!def) return;
    if (def.solid) {
      const tileRect = {
        x: gx * OPEN_WORLD_CONFIG.TILE_SIZE,
        y: gy * OPEN_WORLD_CONFIG.TILE_SIZE,
        w: OPEN_WORLD_CONFIG.TILE_SIZE,
        h: def.id === 'bridge' ? 16 : OPEN_WORLD_CONFIG.TILE_SIZE,
      };
      if (rectsOverlap(levelState.actors.madjid, tileRect) || rectsOverlap(levelState.actors.nadine, tileRect)) {
        return;
      }
    }

    if (coopSession.active) {
      coopClient.sendOpenWorldAction({ kind: 'place', gx, gy, blockType: openWorldSelectedTool });
    } else {
      const res = placeOpenWorldBlock(openWorldState, gx, gy, openWorldSelectedTool, {
        consumeInventory: true,
      });
      if (res.ok && !res.idempotent) {
        refreshOpenWorldCollisions();
        renderOpenWorldToolbar();
        const bx = gx * OPEN_WORLD_CONFIG.TILE_SIZE + 20;
        const by = gy * OPEN_WORLD_CONFIG.TILE_SIZE + 20;
        particles.burst(bx, by, 7, {
          colors: ['#FFF4C4', def.color],
          minSpeed: 30,
          maxSpeed: 95,
          size: 3.6,
          shape: 'spark',
          gravity: 110,
        });
        audio.playSwitchPress();
      }
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    if (gameState !== 'playing' || playMode !== 'openworld' || activeSubModal) {
      openWorldHoverCell = null;
      return;
    }
    const cell = screenToOpenWorldCell(e.clientX, e.clientY);
    openWorldHoverCell = isValidBlockCoord(cell.gx, cell.gy) ? cell : null;
  });

  canvas.addEventListener('pointerleave', () => {
    openWorldHoverCell = null;
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'playing' || playMode !== 'openworld' || activeSubModal) return;
    if (e.button !== 0 && e.button !== 2) return;
    audio.unlock();
    const cell = screenToOpenWorldCell(e.clientX, e.clientY);
    handleOpenWorldPointerAction(cell.gx, cell.gy, e.button === 2);
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (playMode === 'openworld') e.preventDefault();
  });

  // Online Co-op Lobby Modal DOM Handlers
  document.getElementById('btn-close-coop').addEventListener('click', closeModalAndReturn);
  document.getElementById('btn-coop-connect').addEventListener('click', () => {
    audio.unlock();
    audio.playUiClick();
    setCoopFeedback('');
    coopClient.connect(elCoopServerUrl.value || getDefaultWsUrl());
  });

  document.querySelectorAll('[data-coop-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playUiClick();
      coopCreateModeChoice = btn.dataset.coopMode;
      document.querySelectorAll('[data-coop-mode]').forEach((b) => {
        const active = b.dataset.coopMode === coopCreateModeChoice;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
  });

  document.querySelectorAll('[data-coop-char]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.playUiClick();
      coopCreateCharChoice = btn.dataset.coopChar;
      document.querySelectorAll('[data-coop-char]').forEach((b) => {
        const active = b.dataset.coopChar === coopCreateCharChoice;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
  });

  elCoopCreateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    audio.unlock();
    audio.playUiClick();
    setCoopFeedback('');
    const roomName = elCoopCreateName.value.trim() || "Madjid & Nadine's Journey";
    coopClient.createRoom({
      name: roomName,
      mode: coopCreateModeChoice,
      levelIndex: currentLevelIdx,
      character: coopCreateCharChoice,
      skinId: selectedSkins[coopCreateCharChoice],
      theme: openWorldState.theme,
    });
  });

  elCoopSearchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    audio.playUiClick();
    setCoopFeedback('');
    coopClient.listRooms(elCoopSearchInput.value.trim());
  });

  document.getElementById('btn-coop-refresh').addEventListener('click', () => {
    audio.playUiClick();
    setCoopFeedback('');
    coopClient.listRooms(elCoopSearchInput.value.trim());
  });

  document.getElementById('btn-coop-join-code').addEventListener('click', () => {
    audio.unlock();
    audio.playUiClick();
    const query = elCoopSearchInput.value.trim();
    if (!query) {
      setCoopFeedback('Enter a room code (e.g. ND-4K9A) or room name first.');
      return;
    }
    setCoopFeedback('');
    coopClient.joinRoom(query, { skinId: selectedSkins.nadine });
  });

  document.getElementById('btn-coop-copy-code').addEventListener('click', async () => {
    audio.playUiClick();
    if (!coopSession.roomCode) return;
    try {
      await navigator.clipboard.writeText(coopSession.roomCode);
      setCoopFeedback(`Copied room code ${coopSession.roomCode}!`, true);
    } catch {
      setCoopFeedback(`Share code: ${coopSession.roomCode}`, true);
    }
  });

  document.getElementById('btn-coop-mode-story').addEventListener('click', () => {
    audio.playUiClick();
    coopClient.setRoomMode({ mode: 'story', levelIndex: currentLevelIdx });
  });

  document.getElementById('btn-coop-mode-openworld').addEventListener('click', () => {
    audio.playUiClick();
    coopClient.setRoomMode({ mode: 'openworld' });
  });

  document.getElementById('btn-coop-resume').addEventListener('click', () => {
    audio.playUiClick();
    closeAllSubModals();
    setGameState('playing');
  });

  document.getElementById('btn-coop-leave').addEventListener('click', () => {
    audio.playUiClick();
    coopClient.leaveRoom();
  });

  elPauseTouchToggle.addEventListener('click', () => {
    audio.playUiClick();
    if (touchPadMode === 'auto') {
      touchPadMode = 'on';
      elTouchControls.classList.add('force-visible');
      elTouchControls.classList.remove('force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Always On';
    } else if (touchPadMode === 'on') {
      touchPadMode = 'off';
      elTouchControls.classList.remove('force-visible');
      elTouchControls.classList.add('force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Hidden';
    } else {
      touchPadMode = 'auto';
      elTouchControls.classList.remove('force-visible', 'force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Auto';
    }
  });

  document.querySelectorAll('.skin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      audio.playUiClick();
      skinModalTab = tab.dataset.char;
      renderSkinGrid();
    });
  });
  document.getElementById('btn-close-skins').addEventListener('click', closeModalAndReturn);
  document.getElementById('btn-skins-done').addEventListener('click', closeModalAndReturn);
  document.getElementById('btn-close-chapters').addEventListener('click', closeModalAndReturn);

  document.getElementById('btn-next-chapter').addEventListener('click', (e) => {
    e.currentTarget.blur();
    elChapterClearModal.classList.add('hidden');
    activeSubModal = null;
    startNewGame(currentLevelIdx + 1);
  });
  document.getElementById('btn-replay-chapter').addEventListener('click', (e) => {
    e.currentTarget.blur();
    elChapterClearModal.classList.add('hidden');
    activeSubModal = null;
    startNewGame(currentLevelIdx);
  });
  document.getElementById('btn-play-again').addEventListener('click', (e) => {
    e.currentTarget.blur();
    startNewGame(0);
  });
  document.getElementById('btn-victory-title').addEventListener('click', () => {
    audio.playUiClick();
    elVictoryModal.classList.add('hidden');
    loadChapter(0, { instantBg: false, showStory: false });
    setGameState('title');
  });

  // =========================================================================
  // RESPONSIVE DPR CANVAS SIZING & VIEWPORT-ADAPTIVE CAMERA
  // =========================================================================

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    viewW = Math.max(320, Math.round(rect.width));
    viewH = Math.max(240, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
  }

  resizeCanvas();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas.parentElement);
  } else {
    window.addEventListener('resize', resizeCanvas);
  }

  function computeCameraFraming() {
    const worldW = levelState.worldWidth;
    const worldH = levelState.worldHeight;

    const scaleY = viewH / worldH;
    const scaleX = viewW / worldW;
    const isNarrow = viewW < 820;

    const scale = isNarrow
      ? Math.max(scaleX * 1.45, Math.min(scaleY * 0.72, 0.85))
      : Math.min(Math.max(scaleX, scaleY * 0.88), scaleY * 1.04);

    const visibleW = viewW / scale;
    const visibleH = viewH / scale;
    const maxCamX = Math.max(0, worldW - visibleW);
    const maxCamY = Math.max(0, worldH - visibleH);

    return { scale, visibleW, visibleH, maxCamX, maxCamY };
  }

  // Expose Clean Decoupled Bridge for Online WebSocket Co-Op / Open-World / Chat Sync
  window.NadineGameBridge = {
    getStateSnapshot() {
      const level = LEVELS[currentLevelIdx];
      return {
        gameState,
        playMode,
        chapterIndex: currentLevelIdx,
        levelId: playMode === 'openworld' ? 0 : level.id,
        levelCode: playMode === 'openworld' ? 'OW' : level.code,
        worldId: playMode === 'openworld' ? 0 : level.worldId,
        worldName: playMode === 'openworld' ? 'Wanderer Valley' : level.worldName,
        totalLevels: LEVELS.length,
        totalWorlds: WORLDS.length,
        activeCharId,
        skins: { ...selectedSkins },
        madjid: {
          x: Math.round(levelState.actors.madjid.x),
          y: Math.round(levelState.actors.madjid.y),
          mood: levelState.actors.madjid.mood,
        },
        nadine: {
          x: Math.round(levelState.actors.nadine.x),
          y: Math.round(levelState.actors.nadine.y),
          mood: levelState.actors.nadine.mood,
        },
        keysCollected: levelState.keysCollected,
        keysRequired: levelState.keysRequired,
        activeCheckpoint: levelState.activeCheckpoint ? levelState.activeCheckpoint.id : null,
        kissCount: levelState.kissCount,
        kissActive: levelState.kissTimer > 0,
        cryCount: levelState.cryCount,
        enemyCount: levelState.enemies.length,
        hazardCount: levelState.hazards.length,
        landmark: bgSystem.getLandmarkStyle(),
        coop: {
          active: coopSession.active,
          roomCode: coopSession.roomCode,
          roomName: coopSession.roomName,
          localCharId: coopSession.localCharId,
          remoteCharId: coopSession.remoteCharId,
          partnerConnected: coopSession.partnerConnected,
          playerCount: coopSession.room?.playerCount || 0,
          switchDisabled: coopSession.active,
          wsStatus: coopClient.getStatus(),
          wsUrl: coopClient.getUrl(),
        },
        openWorld: {
          blockCount: openWorldState.blocks.size,
          craftedTotal: openWorldState.craftedTotal,
          theme: openWorldState.theme,
          selectedTool: openWorldSelectedTool,
          inventory: { ...openWorldState.inventory },
        },
      };
    },
    setRemoteInput(charId, intent) {
      if (charId === 'madjid' || charId === 'nadine') {
        remoteIntents[charId] = intent;
      }
    },
    onLocalInput(listener) {
      localInputListeners.add(listener);
      return () => localInputListeners.delete(listener);
    },
    receiveRemoteChat(msg) {
      receiveChatMessage(msg);
      audio.playChatPing();
    },
    placeOpenWorldBlockAt(gx, gy, blockType = openWorldSelectedTool) {
      openWorldSelectedTool = blockType;
      handleOpenWorldPointerAction(gx, gy, blockType === 'break');
    },
    coopClient,
    chatTransport,
  };

  // =========================================================================
  // 60+ FPS MAIN LOOP
  // =========================================================================

  let lastTimestamp = performance.now();
  let lastHudSecond = -1;

  function tick(now) {
    const rawMs = now - lastTimestamp;
    if (rawMs < 15.2) {
      window.requestAnimationFrame(tick);
      return;
    }
    const rawDt = rawMs / 1000;
    lastTimestamp = now;
    const dt = Math.min(Math.max(rawDt, 0), PHYSICS.MAX_DT);
    elapsedTime += dt;

    bgSystem.update(dt);
    particles.update(dt);

    for (let i = worldToasts.length - 1; i >= 0; i--) {
      worldToasts[i].life -= dt;
      worldToasts[i].y -= 22 * dt;
      if (worldToasts[i].life <= 0) {
        worldToasts.splice(i, 1);
      }
    }

    if (cameraShakeTrauma > 0) {
      cameraShakeTrauma = Math.max(0, cameraShakeTrauma - dt * 2.1);
    }

    // Live Title Screen Ambience: Madjid & Nadine breathing gently with periodic tiny hearts
    if (gameState === 'title') {
      levelState.actors.madjid.facing = 1;
      levelState.actors.nadine.facing = -1;
      levelState.actors.madjid.grounded = true;
      levelState.actors.nadine.grounded = true;
      titleHeartTimer -= dt;
      if (titleHeartTimer <= 0) {
        titleHeartTimer = 2.6;
        const midX = (levelState.actors.madjid.x + levelState.actors.nadine.x) * 0.5 + 17;
        const midY = levelState.actors.madjid.y - 4;
        particles.spawn({
          x: midX,
          y: midY,
          vx: (Math.random() - 0.5) * 18,
          vy: -34,
          life: 1.5,
          size: 5.5,
          color: '#F59BB2',
          shape: 'heart',
          gravity: -8,
        });
      }
    }

    // Active Gameplay Simulation
    if (gameState === 'playing' && !activeSubModal) {
      if (hitstopTimer > 0) {
        hitstopTimer = Math.max(0, hitstopTimer - dt);
      } else {
        const jumpHeldNow =
          keysHeld.has('Space') || keysHeld.has('ArrowUp') || keysHeld.has('KeyW') || touchHeld.jump;

        const localIntent = {
          left: keysHeld.has('ArrowLeft') || keysHeld.has('KeyA') || touchHeld.left,
          right: keysHeld.has('ArrowRight') || keysHeld.has('KeyD') || touchHeld.right,
          jumpHeld: jumpHeldNow,
          jumpJustPressed: localJumpJustPressed || (jumpHeldNow && !prevJumpHeld),
          jumpJustReleased: localJumpJustReleased || (!jumpHeldNow && prevJumpHeld),
        };
        prevJumpHeld = jumpHeldNow;
        localJumpJustPressed = false;
        localJumpJustReleased = false;

        if (localInputListeners.size > 0) {
          localInputListeners.forEach((cb) => cb(activeCharId, localIntent));
        }

        const inputsByChar = {
          madjid:
            activeCharId === 'madjid'
              ? localIntent
              : remoteIntents.madjid || createEmptyIntent(),
          nadine:
            activeCharId === 'nadine'
              ? localIntent
              : remoteIntents.nadine || createEmptyIntent(),
        };

        stepSimulation(levelState, inputsByChar, dt, simCallbacks);

        // Online Co-op: smoothly interpolate partner & broadcast local actor state (~25 Hz)
        if (coopSession.active && coopSession.localCharId) {
          if (remoteActorTarget.active && remoteActorTarget.charId === coopSession.remoteCharId) {
            const rActor = levelState.actors[coopSession.remoteCharId];
            if (rActor) {
              const dist = Math.hypot(remoteActorTarget.x - rActor.x, remoteActorTarget.y - rActor.y);
              if (dist > 140) {
                rActor.x = remoteActorTarget.x;
                rActor.y = remoteActorTarget.y;
              } else {
                const alpha = Math.min(1, dt * 18);
                rActor.x += (remoteActorTarget.x - rActor.x) * alpha;
                rActor.y += (remoteActorTarget.y - rActor.y) * alpha;
              }
              rActor.vx = remoteActorTarget.vx;
              rActor.vy = remoteActorTarget.vy;
              rActor.facing = remoteActorTarget.facing;
              rActor.grounded = remoteActorTarget.grounded;
              rActor.scaleX = remoteActorTarget.scaleX;
              rActor.scaleY = remoteActorTarget.scaleY;
              rActor.hurtTimer = remoteActorTarget.hurtTimer;
              rActor.invulnTimer = remoteActorTarget.invulnTimer;
              rActor.inPortal = remoteActorTarget.inPortal;
              rActor.walkDist = remoteActorTarget.walkDist;
              if (levelState.kissTimer <= 0) {
                rActor.mood = remoteActorTarget.mood;
              }
            }
          }

          if (now - lastCoopStateSendMs >= 40) {
            lastCoopStateSendMs = now;
            const localActor = levelState.actors[coopSession.localCharId];
            if (localActor) {
              coopClient.sendPlayerState({
                x: Math.round(localActor.x * 10) / 10,
                y: Math.round(localActor.y * 10) / 10,
                vx: Math.round(localActor.vx),
                vy: Math.round(localActor.vy),
                facing: localActor.facing,
                grounded: localActor.grounded,
                scaleX: Math.round(localActor.scaleX * 100) / 100,
                scaleY: Math.round(localActor.scaleY * 100) / 100,
                mood: localActor.mood,
                hurtTimer: Math.round(localActor.hurtTimer * 100) / 100,
                invulnTimer: Math.round(localActor.invulnTimer * 100) / 100,
                kissLean: Math.round(localActor.kissLean * 100) / 100,
                inPortal: localActor.inPortal,
                walkDist: Math.round(localActor.walkDist),
              });
            }
          }
        }

        const sec = Math.floor(levelState.elapsed);
        if (sec !== lastHudSecond) {
          lastHudSecond = sec;
          elHudTimer.textContent = formatTime(sec);
        }
      }
    }

    // Smooth Camera Framing with Gentle Directional Look-Ahead
    const framing = computeCameraFraming();
    let targetCamX = 0;
    let targetCamY = 0;

    if (gameState === 'title') {
      targetCamX = Math.max(0, Math.min(framing.maxCamX, 30 + Math.sin(elapsedTime * 0.28) * 24));
      targetCamY = Math.max(0, Math.min(framing.maxCamY, levelState.worldHeight - framing.visibleH));
    } else {
      const focusActor = levelState.actors[activeCharId];
      const desiredLookAhead =
        (focusActor.facing || 1) * 54 +
        (Math.abs(focusActor.vx) > 20 ? Math.sign(focusActor.vx) * 22 : 0);
      cameraLookAheadX += (desiredLookAhead - cameraLookAheadX) * Math.min(1, dt * 3.4);

      const desiredX = focusActor.x + focusActor.w * 0.5 + cameraLookAheadX - framing.visibleW * 0.48;
      const desiredY = focusActor.y + focusActor.h * 0.5 - framing.visibleH * 0.54;
      targetCamX = Math.max(0, Math.min(framing.maxCamX, desiredX));
      targetCamY = Math.max(0, Math.min(framing.maxCamY, desiredY));
    }

    const camLerp = Math.min(1, dt * 6.5);
    cameraX += (targetCamX - cameraX) * camLerp;
    cameraY += (targetCamY - cameraY) * camLerp;

    const shakeMag = cameraShakeTrauma * cameraShakeTrauma * 9;
    const shakeX = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Edge-to-Edge Atmospheric Sky, World Landmarks & Ambient Particles
    bgSystem.render(ctx, viewW, viewH, cameraX, cameraY, elapsedTime);

    // 2. World Playfield Positioned Cleanly Inside Viewport
    const offsetX =
      framing.visibleW > levelState.worldWidth
        ? (viewW - levelState.worldWidth * framing.scale) * 0.5
        : -cameraX * framing.scale;
    const offsetY =
      framing.visibleH > levelState.worldHeight
        ? viewH - levelState.worldHeight * framing.scale
        : -cameraY * framing.scale;

    lastFrameTransform.offsetX = offsetX;
    lastFrameTransform.offsetY = offsetY;
    lastFrameTransform.scale = framing.scale;

    ctx.save();
    ctx.translate(Math.round(offsetX + shakeX), Math.round(offsetY + shakeY));
    ctx.scale(framing.scale, framing.scale);
    drawWorld(
      ctx,
      levelState,
      bgSystem,
      selectedSkins,
      activeCharId,
      particles,
      worldToasts,
      elapsedTime,
      gameState !== 'title',
      playMode === 'openworld'
        ? {
            state: openWorldState,
            hoverCell: openWorldHoverCell,
            selectedTool: openWorldSelectedTool,
          }
        : null
    );
    ctx.restore();

    ctx.restore();
    window.requestAnimationFrame(tick);
  }

  // Boot Initialization
  syncMuteUI();
  loadChapter(0, { instantBg: true, showStory: false });

  // Honor ?autostart=1&level=<1..50> (and backward-compatible &chapter=) for instant testing
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    const lvlParam = Number(params.get('level') || params.get('chapter') || '1');
    const startIdx = !Number.isNaN(lvlParam) && lvlParam >= 1 && lvlParam <= LEVELS.length ? lvlParam - 1 : 0;
    startNewGame(startIdx, { silent: true });
  } else {
    setGameState('title');
  }

  window.requestAnimationFrame(tick);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapBrowserGame);
  } else {
    bootstrapBrowserGame();
  }
}
