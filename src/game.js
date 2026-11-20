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
import { createBackgroundSystem, TIME_PRESETS, WEATHER_PRESETS, getWeatherForWorld } from './background.js';
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
import { renderCoopRoomsListComponent } from './coop-rooms-list.js';
import {
  EMOTE_DEFS,
  activateLoveReaction,
  addPingBeacon,
  createInteractionState,
  renderOverheadBubbles,
  renderPingBeacons,
  resolveChatReaction,
  setOverheadSpeechBubble,
  stepInteractions,
} from './interactions.js';
import {
  DANCES,
  SOUL_LINK_CONFIG,
  canCarryPartner,
  cancelCarry,
  computeDynamicCoopCamera,
  createDanceInvite,
  createMechanicsState,
  renderIdleCoopOverlay,
  renderSoulLinkAura,
  renderUglyGhost,
  startDance,
  stepDanceSystem,
  stepGhostSystem,
  stepRareIdleInteractions,
  stepSoulLinkAndRescue,
  stopDance,
  syncCarriedActor,
  toggleCarry,
  triggerEdgeRescue,
} from './coop-mechanics.js';
import {
  applyBossSnapshot,
  createBossForLevel,
  createOpenWorldBoss,
  getBossStatusLabel,
  renderBoss,
  serializeBossState,
  stepBoss,
} from './bosses.js';
import {
  captureScrapbookPhoto,
  findActivePhotoSpot,
  getOpenWorldPhotoSpots,
  getPhotoSpotsForLevel,
  loadLocalScrapbook,
  mergeScrapbookPhotos,
  renderPhotoSpots,
  renderScrapbookGrid,
  saveLocalScrapbook,
} from './scrapbook.js';
import {
  drawGateBarrier,
  drawGuideRail,
  drawHazardObstacle,
  drawLinkCable,
  drawMovingPlatform,
  drawSwitchMechanism,
  drawTerrainPlatform,
} from './terrain-renderer.js';

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
    blushTimer: 0,
    joyJumpTimer: 0,
    carriedBy: null,
    danceStyle: null,
    danceTempo: 0,
    devouredByGhost: false,
    speedMult: 1,
    jumpMult: 1,
  };
}

/**
 * Creates a clean, deterministic mutable simulation state for a level definition.
 */
export function createInitialLevelState(level) {
  return {
    levelId: level.id,
    worldId: typeof level.worldId === 'number' ? level.worldId : 1,
    theme: level.theme || 'sunrise',
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

    // Skip independent physics integration when carried on partner's head or swallowed inside ghost
    if (actor.carriedBy || actor.devouredByGhost) {
      continue;
    }

    // Horizontal acceleration & smooth friction (with Soul-Link & Ghost Slap panic sprint boost)
    const panicMult = actor.mood === 'panic' ? 1.72 : 1;
    const speedMult = (actor.speedMult || 1) * panicMult;
    const jumpMult = actor.jumpMult || 1;
    const moveDir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
    if (moveDir !== 0) {
      actor.facing = moveDir;
      const accel = (actor.grounded ? PHYSICS.GROUND_ACCEL : PHYSICS.AIR_ACCEL) * panicMult;
      actor.vx = approach(actor.vx, moveDir * PHYSICS.MOVE_SPEED * speedMult, accel * dt);
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
      actor.vy = PHYSICS.JUMP_VY * jumpMult;
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
  openWorldOverlay = null,
  interactionState = null,
  extras = null
) {
  const style = bgSystem.getPlatformStyle();
  const viewRange = extras?.viewRange || null;
  const worldId = state.isOpenWorld ? 0 : typeof state.worldId === 'number' ? state.worldId : 1;
  const worldTheme = openWorldOverlay?.state?.theme || state.theme || 'sunrise';

  // 1. Crisp Glowing Connection Threads Between Switches and Linked Gates/Lifts
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    const active = g.latchedOpen || checkSwitchGroup(state, g.switches, g.requireAll);
    for (let j = 0; j < g.switches.length; j++) {
      const sw = state.switches.find((s) => s.id === g.switches[j]);
      if (sw) drawLinkCable(ctx, sw, g.closedX + g.w * 0.5, g.closedY + g.h * 0.5, active, time);
    }
  }
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    const allSw = [...(mp.switches || []), ...(mp.patrolSwitches || [])];
    const active =
      mp.patrol ||
      checkSwitchGroup(state, mp.switches, mp.requireAll) ||
      (mp.patrolSwitches ? checkSwitchGroup(state, mp.patrolSwitches, false) : false);
    for (let j = 0; j < allSw.length; j++) {
      const sw = state.switches.find((s) => s.id === allSw[j]);
      if (sw) drawLinkCable(ctx, sw, mp.x + mp.w * 0.5, mp.y + mp.h * 0.5, active, time);
    }
  }

  // 2. Moving Platform Guide Rails
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    drawGuideRail(ctx, state.movingPlatforms[i]);
  }

  // 3. Static Platforms, Pillars & Storybook Gatehouse Archways
  for (let i = 0; i < state.platforms.length; i++) {
    const p = state.platforms[i];
    if (p.kind === 'openworld_block') continue;
    drawTerrainPlatform(ctx, p, style, worldId, worldTheme, time, viewRange);
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
      openWorldOverlay.selectedTool,
      viewRange
    );
  }

  // 5. Checkpoints
  for (let i = 0; i < state.checkpoints.length; i++) {
    drawCheckpoint(ctx, state.checkpoints[i], time);
  }

  // 6. Hazards (Thorns, Spikes, Crystal Shards)
  for (let i = 0; i < state.hazards.length; i++) {
    drawHazardObstacle(ctx, state.hazards[i], time, viewRange);
  }

  // 7. Moving Platforms
  for (let i = 0; i < state.movingPlatforms.length; i++) {
    const mp = state.movingPlatforms[i];
    const isPowered =
      Boolean(mp.patrol) ||
      checkSwitchGroup(state, mp.switches, mp.requireAll) ||
      (mp.patrolSwitches ? checkSwitchGroup(state, mp.patrolSwitches, false) : false);
    drawMovingPlatform(ctx, mp, time, isPowered);
  }

  // 8. Sliding Gates
  for (let i = 0; i < state.gates.length; i++) {
    drawGateBarrier(ctx, state.gates[i], state, time, isSwitchActive);
  }

  // 9. Pressure Switches (Hold Plates & Toggle Latches)
  for (let i = 0; i < state.switches.length; i++) {
    const sw = state.switches[i];
    drawSwitchMechanism(ctx, sw, isSwitchActive(sw), time);
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

  // 12b. Scenic Photo Spots
  if (extras?.photoSpots) {
    renderPhotoSpots(ctx, extras.photoSpots, extras.activePhotoSpot || null, time);
  }

  // 12c. Cooperative Region / Open-World Boss
  if (extras?.bossState) {
    renderBoss(ctx, extras.bossState, time);
  }

  // 12d. Soul-Link Synergy Tether Aura
  if (extras?.mechState) {
    renderSoulLinkAura(ctx, state, extras.mechState, time);
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
    if (actor.devouredByGhost) continue;
    const partner = cid === 'madjid' ? nadine : madjid;
    renderCharacter(ctx, actor, cid === 'madjid' ? madjidSkin : nadineSkin, time, {
      isActive: cid === activeCharId,
      partnerPos: { x: partner.x + partner.w * 0.5, y: partner.y + partner.h * 0.5 },
      showIndicator: showIndicators,
    });
  }

  // 14. Pooled Particles Layer
  particles.render(ctx);

  // 14a. Grotesque Ugly Ghost, Cartoon Bones & Rare Idle Co-op Overlay
  if (extras?.mechState) {
    renderIdleCoopOverlay(ctx, state, extras.mechState, time);
    renderUglyGhost(ctx, extras.mechState, state, time);
  }

  // 14b. Synchronized Waypoint Pings & Overhead Chat Speech Bubbles
  if (interactionState) {
    renderPingBeacons(ctx, interactionState, time);
    renderOverheadBubbles(ctx, state.actors, interactionState);
  }

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
  const elOpenWorldWeatherBtn = document.getElementById('btn-openworld-weather');
  const elOpenWorldBossBtn = document.getElementById('btn-openworld-boss');
  const elOpenWorldStoryBtn = document.getElementById('btn-openworld-story');

  const elChatBox = document.getElementById('chat-box');
  const elChatBtn = document.getElementById('hud-btn-chat');
  const elChatMessages = document.getElementById('chat-messages');
  const elChatForm = document.getElementById('chat-form');
  const elChatInput = document.getElementById('chat-input');
  const elChatSpeaker = document.getElementById('chat-speaker-label');

  const elHudBtnCarry = document.getElementById('hud-btn-carry');
  const elHudCarryLabel = document.getElementById('hud-carry-label');
  const elHudBtnDance = document.getElementById('hud-btn-dance');
  const elHudBtnPhoto = document.getElementById('hud-btn-photo');
  const elHudBtnScrapbook = document.getElementById('hud-btn-scrapbook');
  const elScrapbookBadge = document.getElementById('scrapbook-badge');
  const elHudBtnFullscreen = document.getElementById('hud-btn-fullscreen');
  const elDancePopover = document.getElementById('dance-popover');
  const elDanceGrid = document.getElementById('dance-grid');
  const elDanceInviteChk = document.getElementById('dance-invite-coop-chk');

  const elGhostWarningBanner = document.getElementById('ghost-warning-banner');
  const elHudBossBar = document.getElementById('hud-boss-bar');
  const elBossBarName = document.getElementById('boss-bar-name');
  const elBossBarHp = document.getElementById('boss-bar-hp');
  const elBossBarFill = document.getElementById('boss-bar-fill');
  const elBossBarStatus = document.getElementById('boss-bar-status');
  const elDanceInviteBanner = document.getElementById('dance-invite-banner');
  const elDanceInviteText = document.getElementById('dance-invite-text');
  const elBtnDanceAccept = document.getElementById('btn-dance-accept');
  const elBtnDanceDecline = document.getElementById('btn-dance-decline');

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
  const elScrapbookModal = document.getElementById('scrapbook-modal');
  const elScrapbookGrid = document.getElementById('scrapbook-grid');
  const elScrapbookCount = document.getElementById('scrapbook-count');
  const elTouchControls = document.getElementById('touch-controls');
  const elTouchSwitch = document.getElementById('touch-switch');
  const elTouchActionE = document.getElementById('touch-action-e');

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
  const interactionState = createInteractionState();

  function spawnWorldToast(x, y, text, color = '#FFE89E') {
    let adjustedY = y;
    for (let i = 0; i < worldToasts.length; i++) {
      const existing = worldToasts[i];
      if (Math.abs(existing.x - x) < 110 && Math.abs(existing.y - adjustedY) < 20) {
        adjustedY = existing.y - 22;
      }
    }
    worldToasts.push({ x, y: adjustedY, text, color, life: 1.35, maxLife: 1.35 });
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

  // Unified Cooperative Mechanics, Boss, Weather & Scrapbook State
  let mechState = createMechanicsState();
  let bossState = null;
  let photoSpots = [];
  let activePhotoSpot = null;
  let scrapbookPhotos = loadLocalScrapbook();
  let weatherMode = 'clear';
  let openWorldCycleTimer = 0;
  let shutterFlashAlpha = 0;
  let currentCamScale = 1;
  let hasInitializedCam = false;
  let lastBossBroadcastSig = '';
  let lastGhostWarnSoundAt = 0;

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
    blushTimer: 0,
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

  function receiveChatMessage(msg, { live = true } = {}) {
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

    // Live overhead speech bubble (`🗨 <text>`) & interactive blush/jump reactions
    if (live && (msg.senderId === 'madjid' || msg.senderId === 'nadine')) {
      setOverheadSpeechBubble(interactionState, msg.senderId, msg.text);

      const loveRx = resolveChatReaction(msg.senderId, msg.text, interactionState.loveTracker);
      if (loveRx) {
        interactionState.loveTracker = loveRx.nextTracker;
        activateLoveReaction(interactionState, loveRx.targetCharId, loveRx);

        const targetActor = levelState.actors[loveRx.targetCharId];
        if (targetActor) {
          targetActor.blushTimer = Math.max(targetActor.blushTimer || 0, loveRx.blushDuration);
          targetActor.mood = 'happy';
          const cx = targetActor.x + targetActor.w * 0.5;
          const cy = targetActor.y + 4;
          particles.burst(cx, cy, loveRx.isMutual ? 14 : 8, {
            angleBase: -Math.PI * 0.5,
            spread: 1.9,
            minSpeed: 32,
            maxSpeed: 84,
            colors: ['#F472B6', '#FDA4AF', '#FFF2C6'],
            size: 5.4,
            shape: 'heart',
            gravity: -26,
            life: 1.25,
          });
          if (loveRx.isMutual) {
            spawnWorldToast(cx, cy - 16, 'Mutual Love! ♥', '#F9A8D4');
          }
        }
        audio.playKiss();
      }
    }
  }

  receiveChatMessage(
    {
      senderId: 'story',
      senderName: 'Storybook',
      text: 'Welcome across 10 worlds! Press Tab to switch between Madjid and Nadine, or open Online Co-op to play together on two devices.',
      timestamp: 'W1-1',
    },
    { live: false }
  );

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

    if (elOpenWorldWeatherBtn) {
      const wLabel =
        weatherMode === 'auto'
          ? 'Auto'
          : WEATHER_PRESETS[weatherMode]?.label?.split(' ')[0] || 'Clear';
      elOpenWorldWeatherBtn.textContent = `Weather: ${wLabel}`;
    }
    if (elOpenWorldBossBtn) {
      const bossUp = Boolean(bossState && bossState.active && !bossState.defeated);
      elOpenWorldBossBtn.textContent = bossUp ? 'Boss Active' : 'Boss';
      elOpenWorldBossBtn.classList.toggle('active', bossUp);
    }
  }

  function updateScrapbookBadge() {
    if (!elScrapbookBadge) return;
    const count = scrapbookPhotos.length;
    elScrapbookBadge.textContent = String(count);
    elScrapbookBadge.classList.toggle('hidden', count === 0);
  }

  function syncBossBarHud() {
    if (!elHudBossBar) return;
    const visible = gameState === 'playing' && Boolean(bossState && bossState.active && !bossState.defeated);
    elHudBossBar.classList.toggle('hidden', !visible);
    if (!visible) return;
    const pct = Math.max(0, Math.min(100, Math.round((bossState.hp / bossState.maxHp) * 100)));
    elBossBarName.textContent = bossState.name;
    elBossBarHp.textContent = `HP: ${bossState.hp}/${bossState.maxHp}`;
    elBossBarFill.style.width = `${pct}%`;
    elBossBarStatus.textContent = getBossStatusLabel(bossState);
  }

  function applyWeatherMode(mode, { broadcast = false } = {}) {
    weatherMode = mode || 'clear';
    if (weatherMode === 'auto') {
      const cycleOrder = ['clear', 'wind', 'rain', 'fireflies'];
      const picked = cycleOrder[Math.floor(elapsedTime / 20) % cycleOrder.length];
      bgSystem.setWeather(picked);
    } else {
      bgSystem.setWeather(weatherMode);
    }
    renderOpenWorldToolbar();
    if (broadcast && coopSession.active) {
      coopClient.sendWeatherSync(weatherMode);
    }
  }

  function renderDanceMenu() {
    if (!elDanceGrid) return;
    elDanceGrid.innerHTML = '';
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const activeStyle = mechState.dances[myChar]?.style || null;

    DANCES.forEach((dance) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dance-item-btn${activeStyle === dance.id ? ' active' : ''}`;
      btn.dataset.danceStyle = dance.id;
      btn.innerHTML = `<span class="dance-item-icon" aria-hidden="true">${dance.icon}</span><span>${dance.name}</span>`;
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        audio.unlock();
        const actorId = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
        const started = startDance(mechState, levelState, actorId, dance.id);
        if (started) {
          audio.playDanceStep(0, dance.id);
          const actor = levelState.actors[actorId];
          if (actor) {
            spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, `${dance.icon} ${dance.name}!`, '#FDE68A');
          }
          if (coopSession.active) {
            coopClient.sendDanceSync({ character: actorId, styleId: dance.id, active: true });
            if (elDanceInviteChk && elDanceInviteChk.checked) {
              coopClient.sendDanceInvite(dance.id, dance.name);
              spawnWorldToast(
                (actor?.x || 200) + 17,
                (actor?.y || 300) - 34,
                'Dance Invite Sent!',
                '#F9A8D4'
              );
            }
          }
        }
        toggleDancePopover(false);
      });
      elDanceGrid.appendChild(btn);
    });
  }

  function toggleDancePopover(forceOpen = null) {
    if (!elDancePopover || !elHudBtnDance) return;
    const currentlyOpen = !elDancePopover.classList.contains('hidden');
    const nextOpen = forceOpen === null ? !currentlyOpen : Boolean(forceOpen);
    elDancePopover.classList.toggle('hidden', !nextOpen);
    elHudBtnDance.setAttribute('aria-expanded', String(nextOpen));
    if (nextOpen) {
      renderDanceMenu();
    }
  }

  function renderScrapbookModal() {
    renderScrapbookGrid(elScrapbookGrid, elScrapbookCount, scrapbookPhotos, {
      onDelete(photoId) {
        audio.playUiClick();
        scrapbookPhotos = scrapbookPhotos.filter((p) => p.id !== photoId);
        saveLocalScrapbook(scrapbookPhotos);
        updateScrapbookBadge();
        renderScrapbookModal();
      },
    });
  }

  function openScrapbookModal() {
    audio.unlock();
    audio.playUiClick();
    if (!activeSubModal) {
      modalReturnState = gameState;
    }
    activeSubModal = 'scrapbook';
    toggleDancePopover(false);
    elPauseModal.classList.add('hidden');
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elScrapbookModal.classList.remove('hidden');
    clearInputs();
    renderScrapbookModal();
  }

  function handleCarryOrRescue() {
    if (gameState !== 'playing' || activeSubModal) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;

    // 1. Check cooperative Edge Rescue first if partner is slipping/falling nearby
    if (mechState.soulLink.rescueCandidate && mechState.soulLink.rescueCandidate.rescuerId === myChar) {
      const rescueRes = triggerEdgeRescue(mechState, levelState, myChar);
      if (rescueRes.ok) {
        audio.playEdgeRescue();
        const rescued = levelState.actors[rescueRes.rescuedId];
        if (rescued) {
          particles.burst(rescued.x + rescued.w * 0.5, rescued.y + rescued.h * 0.5, 14, {
            colors: ['#93C5FD', '#F9A8D4', '#FFF4C4'],
            minSpeed: 40,
            maxSpeed: 120,
            size: 4.6,
            shape: 'heart',
            gravity: 30,
          });
          spawnWorldToast(rescued.x + rescued.w * 0.5, rescued.y - 16, 'Rescued! ♥', '#93C5FD');
        }
        if (coopSession.active) {
          coopClient.sendCarrySync({
            kind: 'rescue',
            rescuerId: myChar,
            rescuedId: rescueRes.rescuedId,
            x: rescued ? Math.round(rescued.x) : 0,
            y: rescued ? Math.round(rescued.y) : 0,
          });
        }
        return;
      }
    }

    // 2. Otherwise pickup or gently toss carried partner
    const res = toggleCarry(mechState, levelState, myChar);
    const actor = levelState.actors[myChar];
    if (res.ok) {
      if (res.action === 'pickup') {
        audio.playCarryPickup();
        const partnerName = res.carriedId === 'nadine' ? 'Nadine' : 'Madjid';
        if (actor) spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 26, `Carrying ${partnerName}!`, '#F9A8D4');
      } else {
        audio.playCarryDrop();
        if (actor) spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 18, 'Gentle Toss!', '#FDE68A');
      }
      if (actor) {
        particles.burst(actor.x + actor.w * 0.5, actor.y + 8, 8, {
          colors: ['#FFF4C4', '#F9A8D4', '#93C5FD'],
          minSpeed: 30,
          maxSpeed: 85,
          size: 4,
          shape: 'spark',
          gravity: 60,
        });
      }
      if (coopSession.active) {
        coopClient.sendCarrySync({
          kind: res.action,
          carrierId: myChar,
          carriedId: res.carriedId,
          facing: actor ? actor.facing : 1,
        });
      }
    } else if (res.reason === 'TOO_FAR' && actor) {
      spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, 'Move closer to carry!', '#FDE68A');
    }
  }

  function handleSnapPhoto() {
    if (gameState !== 'playing' || activeSubModal) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    const lvl = LEVELS[currentLevelIdx];
    const skyLabel = bgSystem.getThemePreset?.().label || 'Golden Dawn';
    const meta = activePhotoSpot
      ? {
          title: activePhotoSpot.title,
          location: activePhotoSpot.location,
          skyWeather: `${skyLabel} · ${WEATHER_PRESETS[bgSystem.getWeather()]?.label || 'Clear'}`,
        }
      : {
          title: playMode === 'openworld' ? 'Wanderer Valley Moment' : `${lvl.title}`,
          location: playMode === 'openworld' ? 'Wanderer Valley · Open World' : `${lvl.worldName} · Stage ${lvl.code}`,
          skyWeather: `${skyLabel} · ${WEATHER_PRESETS[bgSystem.getWeather()]?.label || 'Clear'}`,
        };

    const photo = captureScrapbookPhoto(canvas, meta);
    scrapbookPhotos = mergeScrapbookPhotos(scrapbookPhotos, [photo]);
    saveLocalScrapbook(scrapbookPhotos);
    updateScrapbookBadge();
    shutterFlashAlpha = 0.85;
    audio.playCameraShutter();
    if (actor) {
      particles.burst(actor.x + actor.w * 0.5, actor.y - 10, 12, {
        colors: ['#FFF8D6', '#FDE047', '#F9A8D4'],
        minSpeed: 35,
        maxSpeed: 105,
        size: 4.5,
        shape: 'spark',
        gravity: 40,
      });
      spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 22, 'Photo Saved! 📸', '#FEF08A');
    }
    if (coopSession.active) {
      coopClient.sendPhotoSnap(photo);
    }
  }

  function toggleFullscreen() {
    audio.unlock();
    audio.playUiClick();
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch?.(() => {});
      } else {
        document.exitFullscreen?.().catch?.(() => {});
      }
    } catch {
      // Fullscreen may be restricted inside some embedded iframes
    }
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

    mechState = createMechanicsState();
    bossState = null;
    photoSpots = getOpenWorldPhotoSpots(600);
    activePhotoSpot = null;
    lastBossBroadcastSig = '';
    openWorldCycleTimer = 0;

    if (coopSession.active && coopSession.localCharId) {
      activeCharId = coopSession.localCharId;
    }

    particles.clear();
    worldToasts.length = 0;
    interactionState.bubbles.madjid = null;
    interactionState.bubbles.nadine = null;
    interactionState.beacons.length = 0;
    toggleDancePopover(false);
    if (elGhostWarningBanner) elGhostWarningBanner.classList.add('hidden');
    if (elDanceInviteBanner) elDanceInviteBanner.classList.add('hidden');
    if (elHudBossBar) elHudBossBar.classList.add('hidden');

    bgSystem.setTheme(openWorldState.theme, instantBg, {
      landmark: owDef.landmark,
      ambient: owDef.ambient,
      weather: weatherMode === 'auto' ? 'clear' : weatherMode,
    });

    cameraX = 0;
    cameraY = 0;
    cameraLookAheadX = 0;
    hasInitializedCam = false;
    hitstopTimer = 0;
    cameraShakeTrauma = 0;
    clearInputs();
    syncHudStatic();
    syncBossBarHud();
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

    mechState = createMechanicsState();
    bossState = createBossForLevel(level);
    photoSpots = getPhotoSpotsForLevel(level);
    activePhotoSpot = null;
    lastBossBroadcastSig = '';
    weatherMode = getWeatherForWorld(world.id);

    particles.clear();
    worldToasts.length = 0;
    interactionState.bubbles.madjid = null;
    interactionState.bubbles.nadine = null;
    interactionState.beacons.length = 0;
    toggleDancePopover(false);
    if (elGhostWarningBanner) elGhostWarningBanner.classList.add('hidden');
    if (elDanceInviteBanner) elDanceInviteBanner.classList.add('hidden');

    bgSystem.setTheme(level.theme, instantBg, {
      landmark: level.landmark || world.landmark,
      ambient: level.ambient || world.ambient,
      platformPalette: world.platformPalette,
      weather: weatherMode,
    });

    cameraX = 0;
    cameraY = 0;
    cameraLookAheadX = 0;
    hasInitializedCam = false;
    hitstopTimer = 0;
    cameraShakeTrauma = 0;
    clearInputs();
    syncHudStatic();
    syncBossBarHud();
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
    toggleDancePopover(false);
    elPauseModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elScrapbookModal.classList.add('hidden');
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
    toggleDancePopover(false);
    elPauseModal.classList.add('hidden');
    elSkinsModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elScrapbookModal.classList.add('hidden');
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
    renderCoopRoomsListComponent(elCoopRoomsList, coopDirectoryRooms, {
      isConnected: coopClient.isConnected(),
      onJoinRoom(room) {
        audio.unlock();
        audio.playUiClick();
        setCoopFeedback('');
        coopClient.joinRoom(room.code, { skinId: selectedSkins.nadine });
      },
    });
  }

  function applyEmoteEffect(charId, emoteId, x, y) {
    const def = EMOTE_DEFS[emoteId];
    const actor = levelState.actors[charId];
    if (!def || !actor) return;

    const px = Number.isFinite(x) ? x : actor.x + actor.w * 0.5;
    const py = Number.isFinite(y) ? y : actor.y;

    setOverheadSpeechBubble(interactionState, charId, def.bubbleText, 2.5);
    audio.playEmoteChime(emoteId);

    actor.scaleX = 1.15;
    actor.scaleY = 0.86;
    if (emoteId === 'heart') {
      interactionState.reactions[charId].blushTimer = Math.max(
        interactionState.reactions[charId].blushTimer,
        1.6
      );
      particles.burst(px, py - 4, 7, {
        angleBase: -Math.PI * 0.5,
        spread: 1.6,
        minSpeed: 28,
        maxSpeed: 72,
        colors: ['#F472B6', '#FDA4AF', '#FFF2C6'],
        size: 5,
        shape: 'heart',
        gravity: -22,
        life: 1.1,
      });
    } else if (emoteId === 'ping') {
      addPingBeacon(interactionState, charId, px, py, def.color);
      particles.burst(px, py - 8, 9, {
        colors: [def.color, '#FFFFFF'],
        minSpeed: 38,
        maxSpeed: 98,
        size: 3.8,
        shape: 'spark',
        gravity: 25,
      });
    } else {
      interactionState.reactions[charId].cheerTimer = 1.1;
      particles.burst(px, py - 6, 8, {
        colors: [def.color, '#FFF5C4', '#FFFFFF'],
        minSpeed: 35,
        maxSpeed: 95,
        size: 4.1,
        shape: 'spark',
        gravity: 40,
      });
    }
  }

  function triggerLocalOrCoopEmote(emoteId) {
    if (!EMOTE_DEFS[emoteId] || gameState !== 'playing' || activeSubModal) return;
    const cid = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const now = performance.now();
    if (now - (interactionState.lastEmoteAt[cid] || 0) < 300) return;
    interactionState.lastEmoteAt[cid] = now;

    const actor = levelState.actors[cid];
    if (!actor) return;
    const px = Math.round(actor.x + actor.w * 0.5);
    const py = Math.round(actor.y);

    if (coopSession.active) {
      coopClient.sendEmote({ emoteId, x: px, y: py });
    } else {
      applyEmoteEffect(cid, emoteId, px, py);
    }
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
        msg.room.chat.forEach((chatMsg) => receiveChatMessage(chatMsg, { live: false }));
      }
      if (Array.isArray(msg.room.scrapbook)) {
        scrapbookPhotos = mergeScrapbookPhotos(scrapbookPhotos, msg.room.scrapbook);
        saveLocalScrapbook(scrapbookPhotos);
        updateScrapbookBadge();
      }
      receiveChatMessage(
        {
          senderId: 'story',
          senderName: 'Co-op',
          text: `Connected to room "${msg.room.name}" (${msg.room.code}) as ${msg.character === 'madjid' ? 'Madjid' : 'Nadine'}. Switch control is disabled so each player controls their own character.`,
          timestamp: msg.room.code,
        },
        { live: false }
      );

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
      remoteActorTarget.blushTimer = Number(state.blushTimer) || 0;
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
      receiveChatMessage(msg, { live: true });
      audio.playChatPing();
    },
    onPlayerEmote(msg) {
      if (msg && msg.character && msg.emoteId) {
        applyEmoteEffect(msg.character, msg.emoteId, msg.x, msg.y);
      }
    },
    onWorldTrigger(msg) {
      if (!msg || !msg.triggerKind) return;
      if (msg.triggerKind === 'highfive' && interactionState.highFiveCooldown <= 0) {
        interactionState.highFiveCooldown = 4.2;
        audio.playHighFive();
        particles.burst(msg.x, msg.y, 14, {
          colors: ['#FFF8D6', '#FDE047', '#F472B6', '#7CC4FA'],
          minSpeed: 55,
          maxSpeed: 160,
          size: 4.8,
          shape: 'spark',
          gravity: 40,
        });
        spawnWorldToast(msg.x, msg.y - 18, 'High Five!', '#FFE89E');
      } else if (msg.triggerKind === 'lantern-harmony' && interactionState.harmonyCooldown <= 0) {
        interactionState.harmonyCooldown = 14;
        audio.playCozySparkle();
        particles.burst(msg.x, msg.y, 12, {
          angleBase: -Math.PI * 0.5,
          spread: 1.8,
          minSpeed: 28,
          maxSpeed: 76,
          colors: ['#FFF4C4', '#F9A8D4', '#FDE047'],
          size: 5,
          shape: 'heart',
          gravity: -24,
        });
        spawnWorldToast(msg.x, msg.y - 16, 'Harmony Resonance! ♥', '#FDE68A');
      }
    },
    onError(_code, message) {
      setCoopFeedback(message, false);
    },
    onGhostSync(msg) {
      if (!msg || !coopSession.active) return;
      const g = mechState.ghost;
      if (msg.kind === 'state' && msg.ghost) {
        Object.assign(g, msg.ghost);
        if (Array.isArray(msg.ghost.bones)) {
          g.bones = msg.ghost.bones.map((b) => ({ ...b }));
        }
      } else if (msg.kind === 'spawn') {
        g.active = true;
        g.phase = 'chase';
        g.strayId = msg.strayId || g.strayId;
        g.targetId = msg.targetId || g.targetId;
        g.x = Number(msg.x) || g.x;
        g.y = Number(msg.y) || g.y;
        g.facing = msg.facing === -1 ? -1 : 1;
        g.timer = 0;
      } else if (msg.kind === 'shock') {
        g.active = true;
        g.phase = 'shock';
        g.flashAlpha = 0.85;
        g.timer = 0.48;
        g.strayId = msg.strayId || g.strayId;
        g.targetId = msg.targetId || g.targetId;
        g.outcome = msg.outcome || g.outcome;
        hitstopTimer = 0.14;
        cameraShakeTrauma = 1.0;
        audio.playGhostShock();
        const stray = levelState.actors[g.strayId];
        if (stray) stray.mood = 'shocked';
      } else if (msg.kind === 'slap') {
        g.phase = 'slap_run';
        g.outcome = 'slap';
        g.timer = 4.5;
        g.slapCalloutTimer = 1.2;
        g.slapCalloutX = msg.x || g.x;
        g.slapCalloutY = msg.y || g.y;
        audio.playGhostSlap();
        const stray = levelState.actors[g.strayId];
        if (stray) stray.mood = 'panic';
      } else if (msg.kind === 'devour') {
        g.phase = 'devour_fly';
        g.outcome = 'devour';
        g.timer = 3.5;
        audio.playGhostDevour();
        const stray = levelState.actors[g.strayId];
        if (stray) stray.devouredByGhost = true;
      } else if (msg.kind === 'bones') {
        g.active = false;
        g.phase = 'idle';
        g.warningActive = false;
        audio.playBonesDrop();
        const stray = levelState.actors[msg.strayId || g.strayId];
        if (stray) {
          stray.devouredByGhost = false;
          stray.mood = 'normal';
        }
        if (Array.isArray(msg.bones)) {
          g.bones = msg.bones.map((b) => ({ ...b }));
        }
      } else if (msg.kind === 'reunited') {
        g.active = false;
        g.phase = 'idle';
        g.warningActive = false;
        const stray = levelState.actors[msg.strayId || g.strayId];
        if (stray) {
          stray.devouredByGhost = false;
          stray.mood = 'happy';
        }
      }
    },
    onCarrySync(msg) {
      if (!msg || !coopSession.active) return;
      if (msg.kind === 'pickup' && msg.carrierId && msg.carriedId) {
        mechState.carrying = { carrierId: msg.carrierId, carriedId: msg.carriedId };
        const carried = levelState.actors[msg.carriedId];
        if (carried) carried.carriedBy = msg.carrierId;
        syncCarriedActor(mechState, levelState);
        audio.playCarryPickup();
      } else if (msg.kind === 'drop' && msg.carrierId) {
        const carriedId = mechState.carrying?.carriedId || msg.carriedId;
        mechState.carrying = null;
        const carried = levelState.actors[carriedId];
        if (carried) {
          carried.carriedBy = null;
          carried.vx = (msg.facing || 1) * 145;
          carried.vy = -245;
        }
        audio.playCarryDrop();
      } else if (msg.kind === 'rescue' && msg.rescuedId) {
        const rescued = levelState.actors[msg.rescuedId];
        if (rescued) {
          if (typeof msg.x === 'number') rescued.x = msg.x;
          if (typeof msg.y === 'number') rescued.y = msg.y;
          rescued.vy = -210;
          rescued.invulnTimer = 0.9;
          particles.burst(rescued.x + rescued.w * 0.5, rescued.y + rescued.h * 0.5, 12, {
            colors: ['#93C5FD', '#F9A8D4', '#FFF4C4'],
            minSpeed: 40,
            maxSpeed: 120,
            size: 4.5,
            shape: 'heart',
            gravity: 30,
          });
          spawnWorldToast(rescued.x + rescued.w * 0.5, rescued.y - 16, 'Rescued! ♥', '#93C5FD');
        }
        audio.playEdgeRescue();
      }
    },
    onDanceSync(msg) {
      if (!msg || !coopSession.active) return;
      const cid = msg.character || msg.fromCharacter;
      if (!cid) return;
      if (msg.active) {
        startDance(mechState, levelState, cid, msg.styleId);
        audio.playDanceStep(0, msg.styleId);
      } else {
        stopDance(mechState, levelState, cid);
      }
    },
    onDanceInvite(msg) {
      if (!msg || !coopSession.active) return;
      const fromId = msg.fromCharacter || 'partner';
      createDanceInvite(mechState, fromId, msg.styleId);
      const who = fromId === 'madjid' ? 'Madjid' : 'Nadine';
      if (elDanceInviteText && elDanceInviteBanner) {
        elDanceInviteText.textContent = `${who} invited you to ${msg.styleName || 'Dance'}!`;
        elDanceInviteBanner.classList.remove('hidden');
      }
      audio.playEmoteChime('heart');
    },
    onDanceRespond(msg) {
      if (!msg || !coopSession.active) return;
      const who = msg.fromCharacter === 'madjid' ? 'Madjid' : 'Nadine';
      if (msg.accepted) {
        const myChar = coopSession.localCharId || activeCharId;
        startDance(mechState, levelState, myChar, msg.styleId);
        startDance(mechState, levelState, msg.fromCharacter, msg.styleId);
        const actor = levelState.actors[myChar];
        if (actor) spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 16, `${who} joined your dance!`, '#F9A8D4');
        audio.playHighFive();
      } else {
        const actor = levelState.actors[coopSession.localCharId || activeCharId];
        if (actor) spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 16, `${who} declined dance`, '#CBD5E1');
      }
    },
    onBossSync(msg) {
      if (!msg || !coopSession.active) return;
      if (msg.kind === 'summon' && playMode === 'openworld') {
        bossState = createOpenWorldBoss(600, levelState.worldWidth);
        if (msg.boss) applyBossSnapshot(bossState, msg.boss);
        syncBossBarHud();
        renderOpenWorldToolbar();
      } else if (msg.kind === 'state' && msg.boss) {
        if (!bossState && msg.boss.isOpenWorld && playMode === 'openworld') {
          bossState = createOpenWorldBoss(600, levelState.worldWidth);
        }
        if (bossState) {
          const prevHp = bossState.hp;
          applyBossSnapshot(bossState, msg.boss);
          if (bossState.hp < prevHp) {
            if (bossState.defeated) audio.playBossDefeat();
            else audio.playBossHit();
          }
          syncBossBarHud();
        }
      }
    },
    onWeatherSync(msg) {
      if (!msg || !coopSession.active || !msg.weather) return;
      applyWeatherMode(msg.weather, { broadcast: false });
    },
    onScrapbookUpdated(msg) {
      if (!msg) return;
      const incoming = Array.isArray(msg.scrapbook) ? msg.scrapbook : msg.photo ? [msg.photo] : [];
      scrapbookPhotos = mergeScrapbookPhotos(scrapbookPhotos, incoming);
      saveLocalScrapbook(scrapbookPhotos);
      updateScrapbookBadge();
      if (activeSubModal === 'scrapbook') {
        renderScrapbookModal();
      }
      if (msg.photo) {
        audio.playCameraShutter();
      }
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
    toggleDancePopover(false);
    setCoopFeedback('');
    elPauseModal.classList.add('hidden');
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elScrapbookModal.classList.add('hidden');
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
    toggleDancePopover(false);
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elScrapbookModal.classList.add('hidden');
    if (gameState === 'paused') {
      elPauseModal.classList.remove('hidden');
    }
  }

  function closeModalAndReturn() {
    audio.playUiClick();
    toggleDancePopover(false);
    elSkinsModal.classList.add('hidden');
    elChaptersModal.classList.add('hidden');
    elCoopModal.classList.add('hidden');
    elScrapbookModal.classList.add('hidden');
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
      cancelCarry(mechState, levelState);
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
      cancelCarry(mechState, levelState);
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

    if (activeSubModal === 'skins' || activeSubModal === 'chapters' || activeSubModal === 'coop' || activeSubModal === 'scrapbook') {
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
        if (elDancePopover && !elDancePopover.classList.contains('hidden')) {
          toggleDancePopover(false);
        } else if (!elChatBox.classList.contains('hidden')) {
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

    if (e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      handleCarryOrRescue();
      return;
    }

    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      toggleDancePopover();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      handleSnapPhoto();
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
    if (e.key === '1') {
      e.preventDefault();
      triggerLocalOrCoopEmote('heart');
      return;
    }
    if (e.key === '2') {
      e.preventDefault();
      triggerLocalOrCoopEmote('wave');
      return;
    }
    if (e.key === '3') {
      e.preventDefault();
      triggerLocalOrCoopEmote('cheer');
      return;
    }
    if (e.key === '4') {
      e.preventDefault();
      triggerLocalOrCoopEmote('ping');
      return;
    }

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

      if (action === 'carry') {
        btn.classList.add('pressed');
        handleCarryOrRescue();
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

  document.querySelectorAll('.emote-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.unlock();
      triggerLocalOrCoopEmote(btn.dataset.emote);
    });
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

  elHudBtnCarry?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    handleCarryOrRescue();
  });

  elHudBtnDance?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleDancePopover();
  });

  elHudBtnPhoto?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    handleSnapPhoto();
  });

  elHudBtnScrapbook?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    openScrapbookModal();
  });

  elHudBtnFullscreen?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    if (elHudBtnFullscreen) {
      elHudBtnFullscreen.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    }
  });

  elBtnDanceAccept?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    const inv = mechState.dances.invite;
    if (!inv) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    startDance(mechState, levelState, myChar, inv.style);
    if (inv.fromId === 'madjid' || inv.fromId === 'nadine') {
      startDance(mechState, levelState, inv.fromId, inv.style);
    }
    audio.playHighFive();
    if (coopSession.active) {
      coopClient.sendDanceRespond(true, inv.style);
    }
    mechState.dances.invite = null;
    elDanceInviteBanner?.classList.add('hidden');
  });

  elBtnDanceDecline?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.playUiClick();
    const inv = mechState.dances.invite;
    if (inv && coopSession.active) {
      coopClient.sendDanceRespond(false, inv.style);
    }
    mechState.dances.invite = null;
    elDanceInviteBanner?.classList.add('hidden');
  });

  document.getElementById('btn-close-scrapbook')?.addEventListener('click', closeModalAndReturn);
  document.getElementById('btn-scrapbook-done')?.addEventListener('click', closeModalAndReturn);
  document.getElementById('btn-scrapbook-clear')?.addEventListener('click', () => {
    audio.playUiClick();
    scrapbookPhotos = [];
    saveLocalScrapbook([]);
    updateScrapbookBadge();
    renderScrapbookModal();
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

  elOpenWorldWeatherBtn?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    const order = ['clear', 'wind', 'rain', 'fireflies', 'auto'];
    const nextW = order[(order.indexOf(weatherMode) + 1) % order.length];
    applyWeatherMode(nextW, { broadcast: true });
  });

  elOpenWorldBossBtn?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    if (playMode !== 'openworld') return;
    if (bossState && bossState.active && !bossState.defeated) {
      bossState = null;
    } else {
      bossState = createOpenWorldBoss(600, levelState.worldWidth);
      spawnWorldToast(bossState.x + bossState.w * 0.5, bossState.y - 20, `${bossState.name} Awakens!`, '#FDE047');
      if (coopSession.active) {
        coopClient.sendBossSync({ kind: 'summon', boss: serializeBossState(bossState) });
      }
    }
    syncBossBarHud();
    renderOpenWorldToolbar();
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
          carriedBy: levelState.actors.madjid.carriedBy || null,
          danceStyle: levelState.actors.madjid.danceStyle || null,
          devouredByGhost: Boolean(levelState.actors.madjid.devouredByGhost),
        },
        nadine: {
          x: Math.round(levelState.actors.nadine.x),
          y: Math.round(levelState.actors.nadine.y),
          mood: levelState.actors.nadine.mood,
          carriedBy: levelState.actors.nadine.carriedBy || null,
          danceStyle: levelState.actors.nadine.danceStyle || null,
          devouredByGhost: Boolean(levelState.actors.nadine.devouredByGhost),
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
        weather: bgSystem.getWeather(),
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
        mechanics: {
          camScale: Math.round(currentCamScale * 1000) / 1000,
          carrying: mechState.carrying ? { ...mechState.carrying } : null,
          soulLinkActive: mechState.soulLink.active,
          rescueCandidate: mechState.soulLink.rescueCandidate ? { ...mechState.soulLink.rescueCandidate } : null,
          ghost: {
            active: mechState.ghost.active,
            warningActive: mechState.ghost.warningActive,
            phase: mechState.ghost.phase,
            outcome: mechState.ghost.outcome,
            separationDist: Math.round(mechState.ghost.separationDist),
            bonesCount: mechState.ghost.bones.length,
          },
          dances: {
            madjid: mechState.dances.madjid?.style || null,
            nadine: mechState.dances.nadine?.style || null,
          },
          idleSpecial: mechState.idleSpecial.active ? mechState.idleSpecial.id : null,
          boss: bossState
            ? {
                active: bossState.active,
                defeated: bossState.defeated,
                name: bossState.name,
                hp: bossState.hp,
                maxHp: bossState.maxHp,
                shielded: bossState.shielded,
              }
            : null,
          scrapbookCount: scrapbookPhotos.length,
          activePhotoSpot: activePhotoSpot ? activePhotoSpot.id : null,
        },
        interactions: {
          bubbles: {
            madjid: interactionState.bubbles.madjid?.text || null,
            nadine: interactionState.bubbles.nadine?.text || null,
          },
          reactions: {
            madjid: {
              blushTimer: Math.round((interactionState.reactions.madjid.blushTimer || 0) * 100) / 100,
              joyJumpTimer: Math.round((interactionState.reactions.madjid.jumpTimer || 0) * 100) / 100,
            },
            nadine: {
              blushTimer: Math.round((interactionState.reactions.nadine.blushTimer || 0) * 100) / 100,
              joyJumpTimer: Math.round((interactionState.reactions.nadine.jumpTimer || 0) * 100) / 100,
            },
          },
          beaconsCount: interactionState.beacons.length,
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
      receiveChatMessage(msg, { live: true });
      audio.playChatPing();
    },
    placeOpenWorldBlockAt(gx, gy, blockType = openWorldSelectedTool) {
      openWorldSelectedTool = blockType;
      handleOpenWorldPointerAction(gx, gy, blockType === 'break');
    },
    triggerEmote(emoteId) {
      triggerLocalOrCoopEmote(emoteId);
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
    if (shutterFlashAlpha > 0) {
      shutterFlashAlpha = Math.max(0, shutterFlashAlpha - dt * 2.8);
    }

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
        if (mechState.ghost.flashAlpha > 0) {
          mechState.ghost.flashAlpha = Math.max(0, mechState.ghost.flashAlpha - dt * 2.6);
        }
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

        // 1. Soul-Link Aura (+Speed/+Jump boost when together) & Edge Rescue check
        const sl = stepSoulLinkAndRescue(mechState, levelState, dt);
        ['madjid', 'nadine'].forEach((cid) => {
          const actor = levelState.actors[cid];
          if (actor) {
            actor.speedMult = sl.active ? SOUL_LINK_CONFIG.SPEED_MULT : 1;
            actor.jumpMult = sl.active ? SOUL_LINK_CONFIG.JUMP_MULT : 1;
          }
        });

        // 2. Ghost Separation Warning, Chase, Shock Impact, Slap & Devour outcomes
        const ghostSyncHost = !coopSession.active || !coopSession.partnerConnected || coopSession.localCharId === 'madjid';
        const ghostStep = stepGhostSystem(
          mechState,
          levelState,
          dt,
          {
            disableSpawn: !ghostSyncHost,
            preferredStrayId: coopSession.active ? coopSession.localCharId : activeCharId,
          },
          {
            onGhostWarn() {
              if (now - lastGhostWarnSoundAt > 4000) {
                lastGhostWarnSoundAt = now;
                audio.playGhostWarn();
              }
            },
            onGhostSpawn(g) {
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({
                  kind: 'spawn',
                  strayId: g.strayId,
                  targetId: g.targetId,
                  x: Math.round(g.x),
                  y: Math.round(g.y),
                  facing: g.facing,
                });
              }
            },
            onGhostShock(stray, g) {
              hitstopTimer = 0.14;
              cameraShakeTrauma = 1.0;
              audio.playGhostShock();
              particles.burst(stray.x + stray.w * 0.5, stray.y + stray.h * 0.4, 16, {
                colors: ['#FACC15', '#FEF08A', '#EF4444', '#FFFFFF'],
                minSpeed: 80,
                maxSpeed: 210,
                size: 4.5,
                shape: 'spark',
                gravity: 40,
              });
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({
                  kind: 'shock',
                  strayId: g.strayId,
                  targetId: g.targetId,
                  outcome: g.outcome,
                });
              }
            },
            onGhostSlap(stray, _partner, g) {
              audio.playGhostSlap();
              cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.55);
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({
                  kind: 'slap',
                  x: Math.round(g.slapCalloutX),
                  y: Math.round(g.slapCalloutY),
                });
              }
            },
            onGhostDevour(_stray, _partner, g) {
              audio.playGhostDevour();
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({ kind: 'devour', strayId: g.strayId });
              }
            },
            onBonesDrop(bx, by, _stray, _partner) {
              audio.playBonesDrop();
              particles.burst(bx, by - 6, 12, {
                colors: ['#F8F6EE', '#CBD5E1', '#FACC15'],
                minSpeed: 40,
                maxSpeed: 120,
                size: 4,
                shape: 'spark',
                gravity: 220,
              });
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({
                  kind: 'bones',
                  strayId: mechState.ghost.strayId,
                  bones: mechState.ghost.bones,
                });
              }
            },
            onGhostReunited(stray) {
              if (coopSession.active && ghostSyncHost) {
                coopClient.sendGhostSync({
                  kind: 'reunited',
                  strayId: stray.id,
                });
              }
            },
          }
        );

        const simInputs = ghostStep.overrideIntents
          ? {
              madjid: ghostStep.overrideIntents.madjid || inputsByChar.madjid,
              nadine: ghostStep.overrideIntents.nadine || inputsByChar.nadine,
            }
          : inputsByChar;

        stepSimulation(levelState, simInputs, dt, simCallbacks);
        syncCarriedActor(mechState, levelState);

        // 3. Cooperative Boss Step (Stage 5 levels & Summoned Open-World Boss)
        if (bossState && bossState.active && !bossState.defeated) {
          stepBoss(bossState, levelState, mechState, dt, {
            onBossShieldBreak(b) {
              audio.playSwitchPress();
              spawnWorldToast(b.x + b.w * 0.5, b.y - 14, 'Shield Shattered!', '#7CC4FA');
              particles.burst(b.x + b.w * 0.5, b.y + b.h * 0.5, 16, {
                colors: ['#7CC4FA', '#FFFFFF', '#FDE047'],
                minSpeed: 65,
                maxSpeed: 175,
                size: 4.5,
                shape: 'spark',
                gravity: 60,
              });
            },
            onBossShieldDeflect(b, actor) {
              audio.playSwitchRelease();
              spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, 'Team Up to Break Shield!', '#93C5FD');
            },
            onBossHit(b) {
              hitstopTimer = 0.055;
              cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.45);
              audio.playBossHit();
              particles.burst(b.x + b.w * 0.5, b.y, 18, {
                colors: ['#FDE047', '#FB923C', '#FFFFFF'],
                minSpeed: 70,
                maxSpeed: 195,
                size: 5,
                shape: 'spark',
                gravity: 110,
              });
              spawnWorldToast(b.x + b.w * 0.5, b.y - 20, `${b.hp}/${b.maxHp} HP`, '#FDE047');
            },
            onBossDefeat(b) {
              hitstopTimer = 0.08;
              cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.7);
              audio.playBossDefeat();
              particles.burst(b.x + b.w * 0.5, b.y + b.h * 0.4, 30, {
                colors: ['#FDE047', '#F472B6', '#7CC4FA', '#FFF8D6'],
                minSpeed: 80,
                maxSpeed: 240,
                size: 5.5,
                shape: 'heart',
                gravity: 75,
                life: 1.35,
              });
              spawnWorldToast(b.x + b.w * 0.5, b.y - 24, `${b.name} Defeated!`, '#FDE047');
              renderOpenWorldToolbar();
            },
            onPortalUnlock(exit) {
              simCallbacks.onPortalUnlock(exit);
              syncHudStatic();
            },
          });
          syncBossBarHud();
          if (coopSession.active) {
            const sig = `${bossState.hp}:${bossState.shielded}:${bossState.defeated}:${Math.round(bossState.stunTimer * 2)}`;
            if (sig !== lastBossBroadcastSig) {
              lastBossBroadcastSig = sig;
              coopClient.sendBossSync({ kind: 'state', boss: serializeBossState(bossState) });
            }
          }
        } else {
          syncBossBarHud();
        }

        // 4. Solo/Co-op Dances & Rare Idle Interactions
        stepDanceSystem(mechState, levelState, simInputs, dt, {
          onDanceBeat(actor, d) {
            audio.playDanceStep(d.stepCount, d.style);
            particles.burst(actor.x + actor.w * 0.5, actor.y + 4, 3, {
              angleBase: -Math.PI * 0.5,
              spread: 1.5,
              minSpeed: 20,
              maxSpeed: 54,
              colors: ['#FDE68A', '#F9A8D4', '#93C5FD'],
              size: 3.8,
              shape: 'spark',
              gravity: -16,
              life: 0.7,
            });
          },
        });

        stepRareIdleInteractions(mechState, levelState, simInputs, dt, {
          onIdleSpecial(def, mx, my) {
            audio.playCozySparkle();
            particles.burst(mx, my, 10, {
              angleBase: -Math.PI * 0.5,
              spread: 1.8,
              minSpeed: 26,
              maxSpeed: 72,
              colors: [def.color, '#FFF8D6'],
              size: 5,
              shape: 'heart',
              gravity: -20,
              life: 1.15,
            });
          },
        });

        // 5. Dynamic Open-World Auto Weather/Sky Cycle
        if (playMode === 'openworld' && weatherMode === 'auto') {
          openWorldCycleTimer += dt;
          if (openWorldCycleTimer >= 28) {
            openWorldCycleTimer = 0;
            const skies = ['sunrise', 'sunset', 'night'];
            const nextSky = skies[(skies.indexOf(openWorldState.theme) + 1) % skies.length];
            const weathers = ['clear', 'wind', 'rain', 'fireflies'];
            const nextW = weathers[Math.floor(Math.random() * weathers.length)];
            openWorldState.theme = nextSky;
            const def = createOpenWorldLevelDefinition(nextSky);
            bgSystem.setTheme(nextSky, false, { landmark: def.landmark, ambient: def.ambient, weather: nextW });
            renderOpenWorldToolbar();
          }
        }

        // 6. Contextual HUD Updates (Ghost Banner, Carry/Rescue pill, Photo Spot pill)
        if (elGhostWarningBanner) {
          elGhostWarningBanner.classList.toggle('hidden', !mechState.ghost.warningActive);
        }
        if (elDanceInviteBanner) {
          elDanceInviteBanner.classList.toggle('hidden', !mechState.dances.invite);
        }
        const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
        if (elHudBtnCarry && elHudCarryLabel) {
          const isRescuable = Boolean(mechState.soulLink.rescueCandidate && mechState.soulLink.rescueCandidate.rescuerId === myChar);
          const isCarrying = Boolean(mechState.carrying && mechState.carrying.carrierId === myChar);
          const canPick = canCarryPartner(mechState, levelState, myChar);
          elHudCarryLabel.textContent = isRescuable ? 'Rescue!' : isCarrying ? 'Drop' : 'Carry';
          elHudBtnCarry.classList.toggle('is-active', isCarrying || isRescuable);
          elHudBtnCarry.classList.toggle('is-ready', isRescuable || canPick);
          if (elTouchActionE) {
            const span = elTouchActionE.querySelector('span');
            if (span) span.textContent = elHudCarryLabel.textContent;
          }
        }
        activePhotoSpot = findActivePhotoSpot(photoSpots, levelState.actors.madjid, levelState.actors.nadine);
        if (elHudBtnPhoto) {
          elHudBtnPhoto.classList.toggle('is-ready', Boolean(activePhotoSpot));
        }

        // Online Co-op: smoothly interpolate partner before interaction checks & broadcast local actor state (~25 Hz)
        if (coopSession.active && coopSession.localCharId && remoteActorTarget.active && remoteActorTarget.charId === coopSession.remoteCharId) {
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
            if (remoteActorTarget.blushTimer > 0) {
              interactionState.reactions[rActor.id].blushTimer = Math.max(
                interactionState.reactions[rActor.id].blushTimer,
                remoteActorTarget.blushTimer
              );
            }
            if (levelState.kissTimer <= 0 && !mechState.ghost.active) {
              rActor.mood = remoteActorTarget.mood;
            }
          }
        }

        // Advance overhead chat bubbles, love blush/jump reactions, ping beacons & dual-player triggers
        stepInteractions(
          interactionState,
          levelState,
          dt,
          {
            onJoyHop(actor) {
              audio.playJump();
              particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.4, 5, {
                angleBase: -Math.PI * 0.5,
                spread: 1.5,
                minSpeed: 24,
                maxSpeed: 64,
                colors: ['#F472B6', '#FDA4AF', '#FFF2C6'],
                size: 4.5,
                shape: 'heart',
                gravity: -18,
              });
            },
            onHighFive(hx, hy) {
              audio.playHighFive();
              particles.burst(hx, hy, 14, {
                colors: ['#FFF8D6', '#FDE047', '#F472B6', '#7CC4FA'],
                minSpeed: 55,
                maxSpeed: 160,
                size: 4.8,
                shape: 'spark',
                gravity: 40,
              });
              spawnWorldToast(hx, hy - 18, 'High Five!', '#FFE89E');
              if (coopSession.active) {
                coopClient.sendWorldTrigger({ triggerKind: 'highfive', x: Math.round(hx), y: Math.round(hy) });
              }
            },
            onLanternHarmony(lx, ly) {
              audio.playCozySparkle();
              particles.burst(lx, ly, 12, {
                angleBase: -Math.PI * 0.5,
                spread: 1.8,
                minSpeed: 28,
                maxSpeed: 76,
                colors: ['#FFF4C4', '#F9A8D4', '#FDE047'],
                size: 5,
                shape: 'heart',
                gravity: -24,
              });
              spawnWorldToast(lx, ly - 16, 'Harmony Resonance! ♥', '#FDE68A');
              if (coopSession.active) {
                coopClient.sendWorldTrigger({ triggerKind: 'lantern-harmony', x: Math.round(lx), y: Math.round(ly) });
              }
            },
          },
          coopSession.active ? coopSession.remoteCharId : null
        );

        if (coopSession.active && coopSession.localCharId && now - lastCoopStateSendMs >= 40) {
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
              blushTimer: Math.round((localActor.blushTimer || 0) * 100) / 100,
            });
          }
        }

        const sec = Math.floor(levelState.elapsed);
        if (sec !== lastHudSecond) {
          lastHudSecond = sec;
          elHudTimer.textContent = formatTime(sec);
        }
      }
    }

    // Dynamic Co-op Camera Zoom + Smooth Framing Across All Modes
    const targetFraming = computeDynamicCoopCamera({
      viewW,
      viewH,
      worldW: levelState.worldWidth,
      worldH: levelState.worldHeight,
      madjid: levelState.actors.madjid,
      nadine: levelState.actors.nadine,
      activeCharId,
      ghostState: mechState.ghost,
    });
    if (!hasInitializedCam) {
      currentCamScale = targetFraming.scale;
      hasInitializedCam = true;
    } else {
      currentCamScale += (targetFraming.scale - currentCamScale) * Math.min(1, dt * 4.2);
    }

    const activeScale = currentCamScale;
    const visibleW = viewW / activeScale;
    const visibleH = viewH / activeScale;
    const maxCamX = Math.max(0, levelState.worldWidth - visibleW);
    const maxCamY = Math.max(0, levelState.worldHeight - visibleH);

    let targetCamX = 0;
    let targetCamY = 0;

    if (gameState === 'title') {
      targetCamX = Math.max(0, Math.min(maxCamX, 30 + Math.sin(elapsedTime * 0.28) * 24));
      targetCamY = Math.max(0, Math.min(maxCamY, levelState.worldHeight - visibleH));
    } else {
      const focusActor = levelState.actors[activeCharId];
      const desiredLookAhead =
        (focusActor.facing || 1) * 44 +
        (Math.abs(focusActor.vx) > 20 ? Math.sign(focusActor.vx) * 18 : 0);
      cameraLookAheadX += (desiredLookAhead - cameraLookAheadX) * Math.min(1, dt * 3.4);

      const desiredX = targetFraming.focusX + cameraLookAheadX * 0.35 - visibleW * 0.5;
      const desiredY = targetFraming.focusY - visibleH * 0.54;
      targetCamX = Math.max(0, Math.min(maxCamX, desiredX));
      targetCamY = Math.max(0, Math.min(maxCamY, desiredY));
    }

    const camLerp = Math.min(1, dt * 6.5);
    cameraX += (targetCamX - cameraX) * camLerp;
    cameraY += (targetCamY - cameraY) * camLerp;

    const shakeMag = cameraShakeTrauma * cameraShakeTrauma * 9;
    const shakeX = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.1 ? (Math.random() * 2 - 1) * shakeMag : 0;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Edge-to-Edge Atmospheric Sky, World Landmarks, Weather & Ambient Particles
    bgSystem.render(ctx, viewW, viewH, cameraX, cameraY, elapsedTime);

    // 2. World Playfield Positioned Cleanly Inside Viewport
    const offsetX =
      visibleW > levelState.worldWidth
        ? (viewW - levelState.worldWidth * activeScale) * 0.5
        : -cameraX * activeScale;
    const mobilePlayInset =
      viewW < 680 && gameState !== 'title'
        ? playMode === 'openworld'
          ? 128
          : 72
        : 0;
    const baseOffsetY =
      visibleH > levelState.worldHeight
        ? viewH - levelState.worldHeight * activeScale
        : -cameraY * activeScale;
    const offsetY =
      mobilePlayInset > 0 && visibleH > levelState.worldHeight
        ? Math.max(84, baseOffsetY - mobilePlayInset)
        : baseOffsetY;

    lastFrameTransform.offsetX = offsetX;
    lastFrameTransform.offsetY = offsetY;
    lastFrameTransform.scale = activeScale;

    ctx.save();
    ctx.translate(Math.round(offsetX + shakeX), Math.round(offsetY + shakeY));
    ctx.scale(activeScale, activeScale);
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
        : null,
      interactionState,
      {
        mechState,
        bossState,
        photoSpots,
        activePhotoSpot,
        viewRange: {
          minX: cameraX - 160,
          maxX: cameraX + visibleW + 160,
        },
      }
    );
    ctx.restore();

    const groundBottomPx = Math.round(offsetY + shakeY + levelState.worldHeight * activeScale);
    if (groundBottomPx < viewH) {
      ctx.fillStyle = bgSystem.getPlatformStyle().body || '#2f2940';
      ctx.fillRect(0, groundBottomPx - 2, viewW, viewH - groundBottomPx + 4);
    }

    // 3. Screen-Space Shock Flash & Camera Shutter Flash Overlay
    const overlayFlash = Math.max(mechState.ghost.flashAlpha * 0.65, shutterFlashAlpha * 0.72);
    if (overlayFlash > 0.01) {
      ctx.fillStyle =
        shutterFlashAlpha > mechState.ghost.flashAlpha
          ? `rgba(255, 250, 235, ${overlayFlash.toFixed(3)})`
          : `rgba(254, 240, 138, ${overlayFlash.toFixed(3)})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    ctx.restore();
    window.requestAnimationFrame(tick);
  }

  // Boot Initialization
  syncMuteUI();
  updateScrapbookBadge();
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
