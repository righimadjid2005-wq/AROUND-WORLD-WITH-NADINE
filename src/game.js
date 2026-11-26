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
  registerSkin,
  renderCharacter,
  renderSkinPreview,
} from './skins.js';
import { createBackgroundSystem, TIME_PRESETS, WEATHER_PRESETS, getWeatherForWorld } from './background.js';
import { BGM_TRACKS, createAudioEngine } from './audio.js';
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
import { findFirstOpenRoom, renderCoopRoomsListComponent } from './coop-rooms-list.js';
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
  repelGhostWithWeapon,
  startDance,
  startPhaseDash,
  stepDanceSystem,
  stepGhostSystem,
  stepPhaseDash,
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
  damageBossWithWeapon,
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
  captureCheckpointSnapshot,
  clearLastCoopRoom,
  clearSoloCheckpointSnapshot,
  loadLastCoopRoom,
  loadSoloCheckpointSnapshot,
  restoreCheckpointSnapshot,
  saveLastCoopRoom,
  saveSoloCheckpointSnapshot,
} from './checkpoint-snapshot.js';
import {
  drawActorContactShadow,
  drawArrowProjectile,
  drawArrowTrap,
  drawCarryBlock,
  drawCarryPedestal,
  drawDynamicTrap,
  drawEscapeSurge,
  drawGateBarrier,
  drawGuideRail,
  drawHazardObstacle,
  drawLadder,
  drawLinkCable,
  drawMovingPlatform,
  drawOceanCurrent,
  drawSwitchMechanism,
  drawTerrainContactShadows,
  drawTerrainPlatform,
  drawThermalVent,
} from './terrain-renderer.js';
import {
  createDynamicTrapState,
  getDynamicTrapSolids,
  stepDynamicTraps,
} from './traps.js';
import {
  cycleActorWeapon,
  drawFragileBarriers,
  drawWeaponPickups,
  drawWeaponSparks,
  getWeaponDef,
  giveActorWeapon,
  initWeaponsForLevelState,
  resolveActiveWeaponHits,
  stepWeaponTimers,
  triggerWeaponAction,
} from './weapons.js';
import {
  applyActorDamage,
  ensureCombatArrays,
  healTeamToFull,
  initActorHealth,
  renderHealthOrbsAndTexts,
  stepHealthOrbsAndCombatTexts,
  triggerTeamRespawnAtCheckpoint,
} from './health-combat.js';
import {
  createMonstersForLevel,
  renderMonstersAndProjectiles,
  stepSecondaryMonsters,
} from './monsters.js';
import {
  createPuzzlesForLevel,
  interactWithNearbyPuzzle,
  isCheckpointUnlocked,
  renderPuzzles,
  stepPuzzles,
  unlockPuzzleTarget,
} from './puzzles.js';
import {
  createFoliagePatches,
  perturbFoliageAt,
  renderFoliagePatches,
  renderToolBarrier,
  stepFoliageSystem,
} from './foliage.js';
import {
  analyzeImageFileToSkin,
  buildCustomSkinConfig,
  loadSavedCustomSkins,
  saveCustomSkinToStorage,
} from './skin-studio.js';
import {
  TOTAL_STORY_WORLDS,
  completeWorldInProgression,
  getWorldProgressionStatus,
  isWorldDangerous,
  isWorldUnlocked,
  loadProgression,
  resetProgression,
  saveProgression,
} from './progression.js';
import {
  createCompanionCatState,
  renderCompanionCat,
  resetCatToTeam,
  stepCompanionCat,
} from './companion-cat.js';
import {
  createStorylineState,
  stepStoryline,
  triggerStoryEvent,
} from './storyline.js';

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
    up: false,
    down: false,
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
  return Boolean(intent.left || intent.right || intent.up || intent.down || intent.jumpHeld || intent.jumpJustPressed);
}

function createActor(id, name, spawn) {
  const actor = {
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
    onLadder: false,
    ridingPlatformId: null,
    safeX: spawn.x,
    safeY: spawn.y,
    hurtTimer: 0,
    invulnTimer: 0,
    tearEmitTimer: 0,
    fellOutOfWorld: false,
    kissLean: 0,
    mood: 'normal',
    physicsMode: 'normal',
    happyPulseTimer: 0,
    blushTimer: 0,
    joyJumpTimer: 0,
    carriedBy: null,
    carryingBlockId: null,
    danceStyle: null,
    danceTempo: 0,
    devouredByGhost: false,
    speedMult: 1,
    jumpMult: 1,
    alive: true,
    hp: 100,
    maxHp: 100,
    dashCooldown: 0,
    phaseDash: /** @type {any} */ (null),
    phaseRippleTimer: 0,
    protectiveStance: false,
    gracefulPose: false,
    weddingCeremony: false,
    weapons: /** @type {string[]} */ ([]),
    equippedWeapon: /** @type {string | null} */ (null),
    weaponAttack: {
      active: false,
      weaponId: null,
      timer: 0,
      duration: 0.3,
      cooldown: 0,
      facing: id === 'madjid' ? 1 : -1,
      hitIds: [],
    },
  };
  initActorHealth(actor);
  return actor;
}

/**
 * Creates a clean, deterministic mutable simulation state for a level definition.
 */
export function computePortalUnlocked(state) {
  if (!state) return false;
  const keysOk = (state.keysCollected || 0) >= (state.keysRequired || 0);
  const bossOk = !state.exit?.requiresBossDefeat || Boolean(state.bossDefeated);
  return keysOk && bossOk;
}

/**
 * Creates a clean, deterministic mutable simulation state for a level definition.
 */
export function createInitialLevelState(level) {
  const requiresBossDefeat = Boolean(level.exit?.requiresBossDefeat && level.hasBoss !== false);
  const state = {
    levelId: level.id,
    worldId: typeof level.worldId === 'number' ? level.worldId : 1,
    theme: level.theme || 'sunrise',
    code: level.code || `W${level.worldId || 1}`,
    sectors: Array.isArray(level.sectors) ? level.sectors.map((s) => ({ ...s })) : [],
    worldWidth: level.worldWidth,
    worldHeight: level.worldHeight,
    physicsMode: level.physicsMode || 'normal',
    gravityScale: typeof level.gravityScale === 'number' ? level.gravityScale : 1,
    groundAccelScale: typeof level.groundAccelScale === 'number' ? level.groundAccelScale : 1,
    groundFrictionScale: typeof level.groundFrictionScale === 'number' ? level.groundFrictionScale : 1,
    oceanCurrents: (level.oceanCurrents || []).map((c) => ({ ...c })),
    thermalVents: (level.thermalVents || []).map((v) => ({ ...v })),
    elapsed: 0,
    completed: false,
    gameOver: false,
    defeatedActorId: null,
    defeatReason: '',
    bossDefeated: !requiresBossDefeat,
    switchesTriggeredCount: 0,
    keysCollected: 0,
    keysRequired: level.exit.keysRequired,
    portalUnlocked: level.exit.keysRequired === 0 && !requiresBossDefeat,
    spawns: {
      madjid: { ...level.spawns.madjid },
      nadine: { ...level.spawns.nadine },
    },
    activeCheckpoint: /** @type {any} */ (null),
    checkpointSnapshot: /** @type {any} */ (null),
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
      homeX: en.x,
      dir: en.dir || 1,
      initialDir: en.dir || 1,
      turnPause: 0,
      stunTimer: 0,
      animPhase: en.x * 0.05,
    })),
    arrowTraps: (level.arrowTraps || []).map((t, idx) => ({
      ...t,
      w: t.w || 32,
      h: t.h || 38,
      dir: t.dir === 1 ? 1 : -1,
      fireInterval: t.fireInterval || 2.8,
      telegraphSec: t.telegraphSec || 0.55,
      projSpeed: t.projSpeed || 260,
      damage: t.damage || 18,
      timer: typeof t.initialDelay === 'number' ? t.initialDelay : 1.2 + idx * 0.4,
      telegraph: false,
    })),
    arrowProjectiles: /** @type {any[]} */ ([]),
    carryBlocks: (level.carryBlocks || []).map((b) => ({
      ...b,
      homeX: b.x,
      homeY: b.y,
      w: b.w || 34,
      h: b.h || 36,
      vx: 0,
      vy: 0,
      carriedBy: null,
      placedPedestalId: null,
    })),
    carryPedestals: (level.carryPedestals || []).map((p) => ({
      ...p,
      w: p.w || 48,
      h: p.h || 12,
      occupied: false,
    })),
    monsters: createMonstersForLevel(level.monsters || []),
    monsterProjectiles: /** @type {any[]} */ ([]),
    puzzles: createPuzzlesForLevel(level.puzzles || []),
    foliage: createFoliagePatches(level.foliage || [], level.theme || 'jungle'),
    ladders: (level.ladders || []).map((l) => ({ ...l })),
    dynamicTraps: (level.dynamicTraps || []).map(createDynamicTrapState),
    escapeSequence: level.escapeSequence ? { ...level.escapeSequence } : null,
    escapeState: level.escapeSequence
      ? {
          id: level.escapeSequence.id,
          title: level.escapeSequence.title,
          hazardKind: level.escapeSequence.hazardKind || 'magma_wave',
          active: false,
          cleared: false,
          wallX: level.escapeSequence.wallStartX,
          wallStartX: level.escapeSequence.wallStartX,
          triggerX: level.escapeSequence.triggerX,
          endX: level.escapeSequence.endX,
          wallSpeed: level.escapeSequence.wallSpeed,
          timeLimitSec: level.escapeSequence.timeLimitSec,
          timeRemaining: level.escapeSequence.timeLimitSec,
        }
      : /** @type {any} */ (null),
    miniScenes: (level.miniScenes || []).map((ms) => ({ ...ms, triggered: false })),
    exit: {
      ...level.exit,
    },
    decorations: (level.decorations || []).map((d) => ({ ...d })),
    weaponPickups: /** @type {any[]} */ ([]),
    fragileBarriers: /** @type {any[]} */ ([]),
    weaponEffects: /** @type {any[]} */ ([]),
    healthOrbs: /** @type {any[]} */ ([]),
    combatTexts: /** @type {any[]} */ ([]),
    cat: createCompanionCatState(level),
  };
  ensureCombatArrays(state);
  initWeaponsForLevelState(state, level);
  state.actors.madjid.physicsMode = state.physicsMode;
  state.actors.nadine.physicsMode = state.physicsMode;
  state.portalUnlocked = computePortalUnlocked(state);
  state.checkpointSnapshot = captureCheckpointSnapshot(state);
  return state;
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
  const barriers = state.fragileBarriers || [];
  for (let i = 0; i < barriers.length; i++) {
    const b = barriers[i];
    if (!b.broken) {
      solids.push({ x: b.x, y: b.y, w: b.w, h: b.h, isMoving: false, id: b.id, isFragileBarrier: true });
    }
  }
  const trapSolids = getDynamicTrapSolids(state);
  for (let i = 0; i < trapSolids.length; i++) {
    solids.push(trapSolids[i]);
  }
  return solids;
}

function findSafeRectX(state, baseX, y, w, h, dir = 1) {
  const solids = getSolidObstacles(state);
  const clamped = clamp(baseX, 8, Math.max(8, state.worldWidth - w - 8));
  const check = (x) => !solids.some((s) => rectsOverlap({ x, y, w, h }, s));
  if (check(clamped)) return clamped;
  for (let step = 12; step <= 180; step += 12) {
    const candA = clamp(clamped - dir * step, 8, Math.max(8, state.worldWidth - w - 8));
    if (check(candA)) return candA;
    const candB = clamp(clamped + dir * step, 8, Math.max(8, state.worldWidth - w - 8));
    if (check(candB)) return candB;
  }
  return clamped;
}

/**
 * @param {any} state
 * @param {any} actor
 * @param {number | null} [dir]
 * @param {any} [callbacks]
 */
export function triggerManualSoulDash(state, actor, dir = null, callbacks = {}) {
  if (!state || !actor || state.completed || state.gameOver) return { ok: false, reason: 'INVALID' };
  if (actor.hurtTimer > 0 || actor.devouredByGhost || actor.phaseDash?.active) {
    return { ok: false, reason: 'BUSY' };
  }
  if ((actor.dashCooldown || 0) > 0) {
    return { ok: false, reason: 'COOLDOWN' };
  }
  const dashDir = dir === -1 || dir === 1 ? dir : actor.facing || 1;
  actor.facing = dashDir;
  const maxDash = 165;
  const blockers = [];
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    if (g.openProgress < 0.92) blockers.push(g);
  }
  const barriers = state.fragileBarriers || [];
  for (let i = 0; i < barriers.length; i++) {
    const b = barriers[i];
    if (!b.broken) blockers.push(b);
  }
  for (let i = 0; i < state.platforms.length; i++) {
    const p = state.platforms[i];
    if (p.kind === 'pillar') blockers.push(p);
  }
  let maxAllowedDist = maxDash;
  for (let step = 8; step <= maxDash; step += 8) {
    const probeX = clamp(actor.x + dashDir * step, 8, Math.max(8, state.worldWidth - actor.w - 8));
    if (blockers.some((blk) => rectsOverlap({ x: probeX, y: actor.y, w: actor.w, h: actor.h }, blk))) {
      maxAllowedDist = Math.max(0, step - 8);
      break;
    }
  }
  const targetX = findSafeRectX(state, actor.x + dashDir * maxAllowedDist, actor.y, actor.w, actor.h, dashDir);
  startPhaseDash(actor, targetX, actor.y, 'manual', state.worldWidth);
  actor.dashCooldown = 2.0;
  actor.invulnTimer = Math.max(actor.invulnTimer || 0, 0.45);
  if (Array.isArray(state.foliage)) {
    perturbFoliageAt(state.foliage, actor.x + actor.w * 0.5, actor.y + actor.h * 0.5, 95, dashDir * 3.5);
  }
  callbacks.onManualDash?.(actor);
  return { ok: true, targetX };
}

export function tryCarryBlockInteraction(state, mechState, actorId, callbacks = {}) {
  if (!state || !actorId || state.gameOver) return { ok: false, reason: 'INVALID' };
  const actor = state.actors?.[actorId];
  const blocks = state.carryBlocks || [];
  if (!actor || actor.hurtTimer > 0 || actor.devouredByGhost || actor.phaseDash?.active) {
    return { ok: false, reason: 'BUSY' };
  }
  // Strict mutex: cannot carry a stone block while carrying partner
  if (mechState?.carrying && mechState.carrying.carrierId === actorId) {
    return { ok: false, reason: 'CARRYING_PARTNER' };
  }

  if (actor.carryingBlockId) {
    const block = blocks.find((b) => b.id === actor.carryingBlockId);
    if (!block) {
      actor.carryingBlockId = null;
      return { ok: false, reason: 'MISSING' };
    }
    const solids = getSolidObstacles(state);
    const dir = actor.facing || 1;
    const dropY = actor.y + actor.h - block.h;
    const aheadX = clamp(actor.x + dir * 28, 6, Math.max(6, state.worldWidth - block.w - 6));
    const fallbackX = clamp(actor.x, 6, Math.max(6, state.worldWidth - block.w - 6));
    const canPlace = (x, y) => !solids.some((s) => rectsOverlap({ x, y, w: block.w, h: block.h }, s));

    let placedX = null;
    if (canPlace(aheadX, dropY)) placedX = aheadX;
    else if (canPlace(fallbackX, dropY)) placedX = fallbackX;
    else if (canPlace(fallbackX, actor.y - block.h)) {
      block.y = actor.y - block.h;
      placedX = fallbackX;
    }

    if (placedX === null) {
      callbacks.onBlockBlocked?.(block, actor);
      return { ok: false, reason: 'WALL_BLOCKED' };
    }

    block.x = placedX;
    if (block.y > dropY) block.y = dropY;
    else if (canPlace(placedX, dropY)) block.y = dropY;
    block.vx = dir * 35;
    block.vy = -40;
    block.carriedBy = null;
    actor.carryingBlockId = null;

    // Gentle magnetic snap if dropped directly over/adjacent to a carry pedestal
    const peds = state.carryPedestals || [];
    for (let p = 0; p < peds.length; p++) {
      const ped = peds[p];
      const pedZone = { x: ped.x - 10, y: ped.y - 46, w: ped.w + 20, h: 52 };
      if (rectsOverlap(block, pedZone)) {
        const centeredX = clamp(ped.x + ped.w * 0.5 - block.w * 0.5, 6, Math.max(6, state.worldWidth - block.w - 6));
        if (canPlace(centeredX, ped.y - block.h)) {
          block.x = centeredX;
          block.y = ped.y - block.h;
          block.vx = 0;
          block.vy = 0;
          block.placedPedestalId = ped.id;
          ped.occupied = true;
        }
        break;
      }
    }

    callbacks.onBlockCarry?.('drop', block, actor);
    return { ok: true, action: 'drop', block };
  }

  // Pick up nearby uncarried stone block
  const acx = actor.x + actor.w * 0.5;
  const acy = actor.y + actor.h * 0.5;
  let best = null;
  let bestDist = 66;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.carriedBy) continue;
    const d = Math.hypot(acx - (b.x + b.w * 0.5), acy - (b.y + b.h * 0.5));
    if (d <= bestDist) {
      bestDist = d;
      best = b;
    }
  }
  if (!best) return { ok: false, reason: 'NO_BLOCK_NEARBY' };

  best.carriedBy = actorId;
  best.placedPedestalId = null;
  best.vx = 0;
  best.vy = 0;
  actor.carryingBlockId = best.id;
  callbacks.onBlockCarry?.('pickup', best, actor);
  return { ok: true, action: 'pickup', block: best };
}

function getRespawnPosition(state, actorId) {
  if (state.activeCheckpoint && state.activeCheckpoint[actorId]) {
    return state.activeCheckpoint[actorId];
  }
  return state.spawns[actorId];
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
  if (madjid.phaseDash?.active || nadine.phaseDash?.active) return false;
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

export function isHazardActive(hz, elapsed = 0) {
  if (!hz) return false;
  if (hz.kind === 'laser_beam') {
    const period = hz.cyclePeriod || 3.0;
    const phase = (((elapsed + (hz.phase || 0)) % period) + period) % period;
    return phase < period * 0.56;
  }
  return true;
}

/**
 * Finds the first climbable ladder overlapping or immediately bordering an actor.
 * @param {any} state
 * @param {any} actor
 */
export function findOverlappingLadder(state, actor) {
  const ladders = state?.ladders;
  if (!Array.isArray(ladders) || ladders.length === 0 || !actor) return null;
  for (let i = 0; i < ladders.length; i++) {
    const l = ladders[i];
    const zone = { x: l.x - 4, y: l.y - 6, w: (l.w || 32) + 8, h: (l.h || 120) + 6 };
    if (rectsOverlap(actor, zone)) {
      return l;
    }
  }
  return null;
}

/**
 * Pure biome ladder climb handler. Suspends gravity while on a ladder and allows
 * clean top-deck exit landing onto ladder.y or directional jump-off.
 * @param {any} state
 * @param {any} actor
 * @param {any} intent
 * @param {number} _dt
 */
export function stepLadders(state, actor, intent, _dt) {
  const ladder = findOverlappingLadder(state, actor);
  if (!ladder) {
    actor.onLadder = false;
    return false;
  }

  const wantsClimb = Boolean(intent.up || intent.down);
  if (!actor.onLadder && !wantsClimb) {
    return false;
  }

  // If actor is already standing squarely above top of ladder and not pressing down, stay on top deck
  if (!actor.onLadder && actor.grounded && actor.y + actor.h <= ladder.y + 4 && !intent.down) {
    return false;
  }

  const moveDir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
  if (actor.onLadder && moveDir !== 0 && intent.jumpJustPressed) {
    actor.onLadder = false;
    actor.grounded = false;
    actor.vx = moveDir * PHYSICS.MOVE_SPEED * 0.85;
    actor.vy = PHYSICS.JUMP_VY * (actor.jumpMult || 1) * 0.88;
    actor.facing = moveDir;
    return false;
  }

  actor.onLadder = true;
  actor.grounded = false;
  actor.ridingPlatformId = null;
  const climbSpeed = 185;
  if (intent.up) {
    actor.vy = -climbSpeed;
  } else if (intent.down) {
    actor.vy = climbSpeed;
  } else {
    actor.vy = 0;
  }

  const ladderCx = ladder.x + (ladder.w || 32) * 0.5;
  if (moveDir !== 0) {
    actor.facing = moveDir;
    actor.vx = moveDir * 135;
  } else {
    actor.vx = (ladderCx - (actor.x + actor.w * 0.5)) * 6;
  }

  // Smooth step-off onto platform at top of ladder
  if (intent.up && actor.y + actor.h <= ladder.y + 3) {
    actor.y = ladder.y - actor.h;
    actor.vy = 0;
    actor.grounded = true;
    actor.onLadder = false;
    return false;
  }

  // Release at base of ladder onto floor
  const ladderBottom = ladder.y + (ladder.h || 120);
  if (intent.down && actor.y + actor.h >= ladderBottom - 2) {
    actor.y = ladderBottom - actor.h;
    actor.vy = 0;
    actor.grounded = true;
    actor.onLadder = false;
    return false;
  }

  return true;
}

/**
 * Resets active escape wave surge and respawns both characters cleanly at the last safe checkpoint.
 * @param {any} state
 * @param {any} [callbacks]
 */
export function triggerEscapeFailRespawn(state, callbacks = {}) {
  if (!state) return null;
  const esc = state.escapeState;
  if (esc) {
    esc.active = false;
    esc.cleared = false;
    esc.wallX = esc.wallStartX;
    esc.timeRemaining = esc.timeLimitSec;
  }
  const res = triggerTeamRespawnAtCheckpoint(state, callbacks);
  callbacks.onEscapeFail?.(esc, res);
  return res;
}

/**
 * Steps timed co-op escape gauntlets (W2 Avalanche, W3 Magma Wave, W5 Abyssal Tide).
 * Both partners must pass endX before time runs out or the wave reaches either partner.
 * @param {any} state
 * @param {number} dt
 * @param {any} [callbacks]
 */
export function stepEscapeSequence(state, dt, callbacks = {}) {
  const esc = state?.escapeState;
  if (!esc || esc.cleared || !state.actors?.madjid || !state.actors?.nadine) return esc;

  const m = state.actors.madjid;
  const n = state.actors.nadine;

  if (!esc.active) {
    const mTrig = m.x >= esc.triggerX && m.x < esc.endX;
    const nTrig = n.x >= esc.triggerX && n.x < esc.endX;
    if (mTrig || nTrig) {
      esc.active = true;
      esc.wallX = esc.wallStartX;
      esc.timeRemaining = esc.timeLimitSec;
      callbacks.onEscapeStart?.(esc);
    }
    return esc;
  }

  esc.wallX += esc.wallSpeed * dt;
  esc.timeRemaining = Math.max(0, esc.timeRemaining - dt);

  if (m.x >= esc.endX && n.x >= esc.endX) {
    esc.active = false;
    esc.cleared = true;
    callbacks.onEscapeClear?.(esc);
    return esc;
  }

  const minAliveX = Math.min(
    m.phaseDash?.active || m.devouredByGhost ? Infinity : m.x,
    n.phaseDash?.active || n.devouredByGhost ? Infinity : n.x
  );
  if (esc.timeRemaining <= 0 || esc.wallX >= minAliveX + 10) {
    triggerEscapeFailRespawn(state, callbacks);
  }
  return esc;
}

/**
 * Pure simulation tick — advances moving platforms, gates, patrol enemies, both actors,
 * checkpoints, hazards, cry-on-death + checkpoint respawn, switches, keys,
 * safe-state automatic kiss / cozy idle interactions, and exit portal completion.
 */
export function stepSimulation(state, inputsByChar, rawDt, callbacks = {}) {
  const dt = Math.min(Math.max(rawDt, 0), PHYSICS.MAX_DT);
  if (state.completed || state.gameOver || dt <= 0) return state;

  state.elapsed += dt;
  ensureCombatArrays(state);
  for (let i = 0; i < state.hazards.length; i++) {
    const hz = state.hazards[i];
    hz.activeNow = isHazardActive(hz, state.elapsed);
  }

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

  // 1b. Carry Block Pedestals & Linked Gates
  const carryBlocks = state.carryBlocks || [];
  const carryPedestals = state.carryPedestals || [];
  for (let p = 0; p < carryPedestals.length; p++) {
    const ped = carryPedestals[p];
    const sensorBox = { x: ped.x - 4, y: ped.y - 44, w: ped.w + 8, h: 48 };
    const matchedBlock = carryBlocks.find((b) => !b.carriedBy && rectsOverlap(b, sensorBox));
    ped.occupied = Boolean(matchedBlock);
  }

  // 2. Update Gates (supports hold-relay switches + far-side latchSwitches)
  for (let i = 0; i < state.gates.length; i++) {
    const g = state.gates[i];
    const pedestalOk = g.requiresPedestalId
      ? Boolean(carryPedestals.find((p) => p.id === g.requiresPedestalId)?.occupied)
      : true;
    const switchOk = !g.switches || g.switches.length === 0 ? true : checkSwitchGroup(state, g.switches, g.requireAll);
    const latchOk = g.latchSwitches?.length ? checkSwitchGroup(state, g.latchSwitches, false) : false;
    const triggered = Boolean((g.switches?.length || g.requiresPedestalId) && switchOk && pedestalOk);
    if (((triggered && g.latchOnOpen) || latchOk) && !g.latchedOpen) {
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
    if (en.stunTimer > 0) {
      en.stunTimer = Math.max(0, en.stunTimer - dt);
      continue;
    }
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

  // 3b. Advance Escalating Unpredictable Traps (W3+) before solids collision pass
  stepDynamicTraps(state, dt, callbacks);

  const solids = getSolidObstacles(state);
  const actorOrder = ['madjid', 'nadine'];

  // 4. Apply Moving Platform Carry Before Physics Integration
  for (let i = 0; i < actorOrder.length; i++) {
    const actor = state.actors[actorOrder[i]];
    if (actor.hurtTimer <= 0 && !actor.phaseDash?.active && actor.grounded && actor.ridingPlatformId) {
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
    actor.physicsMode = state.physicsMode || 'normal';

    // Timers & spring recovery
    actor.blinkTimer -= dt;
    if (actor.blinkTimer <= 0) {
      actor.blinkTimer = 2.2 + ((actor.x * 0.017 + state.elapsed) % 2.4);
    }
    if (actor.invulnTimer > 0) {
      actor.invulnTimer = Math.max(0, actor.invulnTimer - dt);
    }
    if (actor.hurtFlashTimer > 0) {
      actor.hurtFlashTimer = Math.max(0, actor.hurtFlashTimer - dt);
    }
    if (actor.dashCooldown > 0) {
      actor.dashCooldown = Math.max(0, actor.dashCooldown - dt);
    }
    if (actor.happyPulseTimer > 0) {
      actor.happyPulseTimer = Math.max(0, actor.happyPulseTimer - dt);
    }
    if (actor.phaseRippleTimer > 0) {
      actor.phaseRippleTimer = Math.max(0, actor.phaseRippleTimer - dt);
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
        if (!state.gameOver && !actor.fellOutOfWorld) {
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
        if (!state.gameOver) {
          actor.alive = true;
          actor.fellOutOfWorld = false;
          actor.mood = 'normal';
        }
      }
      continue;
    }

    actor.alive = true;

    // Skip independent physics integration when carried on partner's head, swallowed inside ghost, or Ethereal Phase-Dashing
    if (actor.phaseDash?.active) {
      if (actor.phaseDash.reason !== 'ghost') {
        const arrived = stepPhaseDash(actor, dt);
        if (arrived) {
          actor.x = findSafeRectX(state, actor.x, actor.y, actor.w, actor.h, actor.facing || 1);
          callbacks.onPhaseArrive?.(actor);
        }
      }
      continue;
    }
    if (actor.carriedBy || actor.devouredByGhost) {
      continue;
    }

    // Ladder climbing overrides gravity while gripping rungs
    const onLadderNow = stepLadders(state, actor, intent, dt);

    // Horizontal & vertical biome physics (Ice friction, Volcano thermals, Space 4-way Zero-G, Underwater 4-way swim + currents)
    const panicMult = actor.mood === 'panic' ? 1.72 : 1;
    const speedMult = (actor.speedMult || 1) * panicMult;
    const jumpMult = actor.jumpMult || 1;
    const groundAccelScale = state.groundAccelScale ?? 1;
    const groundFrictionScale = state.groundFrictionScale ?? 1;
    const moveDir = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);

    if (onLadderNow) {
      // Velocity handled cleanly by stepLadders
    } else if (state.physicsMode === 'space_swim') {
      const moveY = (intent.down ? 1 : 0) - (intent.up || intent.jumpHeld ? 1 : 0);
      if (moveDir !== 0) {
        actor.facing = moveDir;
        actor.vx = approach(actor.vx, moveDir * PHYSICS.MOVE_SPEED * speedMult * 0.94, 820 * panicMult * dt);
      } else {
        actor.vx = approach(actor.vx, 0, 180 * dt);
      }

      if (moveY !== 0) {
        actor.vy = approach(actor.vy, moveY * 255 * jumpMult, 780 * dt);
        actor.grounded = false;
        actor.ridingPlatformId = null;
      } else {
        actor.vy = approach(actor.vy, 0, 160 * dt);
      }

      if (actor.grounded && intent.jumpJustPressed && !intent.down) {
        actor.vy = -210 * jumpMult;
        actor.grounded = false;
        actor.ridingPlatformId = null;
        actor.scaleX = 0.86;
        actor.scaleY = 1.16;
        callbacks.onJump?.(actor);
      }

      const gravScale = state.gravityScale ?? 0.02;
      actor.vy = clamp(actor.vy + PHYSICS.GRAVITY * gravScale * dt, -275, 275);
    } else if (state.physicsMode === 'underwater') {
      let flowVx = 0;
      let flowVy = 0;
      const currents = state.oceanCurrents || [];
      for (let c = 0; c < currents.length; c++) {
        const cur = currents[c];
        if (rectsOverlap(actor, cur)) {
          flowVx += cur.vx || 0;
          flowVy += cur.vy || 0;
        }
      }

      if (moveDir !== 0) {
        actor.facing = moveDir;
        const accel = actor.grounded ? 1450 : 980;
        actor.vx = approach(
          actor.vx,
          moveDir * PHYSICS.MOVE_SPEED * speedMult * 0.88 + flowVx * 0.5,
          accel * panicMult * dt
        );
      } else {
        const decel = actor.grounded ? 1100 : 280;
        actor.vx = approach(actor.vx, actor.grounded ? 0 : flowVx, decel * dt);
      }

      if (intent.up || intent.jumpHeld) {
        actor.vy = approach(actor.vy, -245 * jumpMult + flowVy * 0.4, 720 * dt);
        actor.grounded = false;
        actor.ridingPlatformId = null;
      } else if (intent.down) {
        actor.vy = approach(actor.vy, 250 + flowVy * 0.4, 720 * dt);
        actor.grounded = false;
        actor.ridingPlatformId = null;
      } else {
        actor.vy = approach(actor.vy, flowVy !== 0 ? flowVy : 48, 280 * dt);
      }

      if (actor.grounded && intent.jumpJustPressed && !intent.down) {
        actor.vy = -220 * jumpMult;
        actor.grounded = false;
        actor.ridingPlatformId = null;
        actor.scaleX = 0.86;
        actor.scaleY = 1.18;
        callbacks.onJump?.(actor);
      }

      actor.vy = clamp(actor.vy, -280, 290);
    } else {
      if (moveDir !== 0) {
        actor.facing = moveDir;
        const accel = (actor.grounded ? PHYSICS.GROUND_ACCEL * groundAccelScale : PHYSICS.AIR_ACCEL) * panicMult;
        actor.vx = approach(actor.vx, moveDir * PHYSICS.MOVE_SPEED * speedMult, accel * dt);
      } else {
        const decel = actor.grounded ? PHYSICS.GROUND_FRICTION * groundFrictionScale : PHYSICS.AIR_DRAG;
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

      // Biome-scaled Gravity + Rising Volcanic Thermal Vents
      const gravScale = state.gravityScale ?? 1;
      actor.vy = Math.min(PHYSICS.MAX_FALL_SPEED, actor.vy + PHYSICS.GRAVITY * gravScale * dt);

      const vents = state.thermalVents || [];
      for (let v = 0; v < vents.length; v++) {
        const vent = vents[v];
        if (rectsOverlap(actor, vent)) {
          actor.vy = Math.max(-410, actor.vy - (vent.lift || 760) * dt);
          actor.grounded = false;
          actor.ridingPlatformId = null;
        }
      }
    }

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

    // Canyon fall -> damage + warp back to safe/checkpoint (or defeat on 0 HP)
    if (actor.y > state.worldHeight + 48) {
      const res = applyActorDamage(
        state,
        actor,
        25,
        { sourceX: actor.x, knockbackY: 0, cause: 'Abyss Fall' },
        callbacks
      );
      if (!res.gameOver && !state.gameOver) {
        const dest = getRespawnPosition(state, actor.id);
        actor.x = dest.x;
        actor.y = dest.y;
        actor.vx = 0;
        actor.vy = 0;
        actor.grounded = false;
        actor.invulnTimer = Math.max(actor.invulnTimer || 0, 1.35);
        callbacks.onRespawn?.(actor);
      }
    }
  }

  const actorList = [state.actors.madjid, state.actors.nadine];

  // 5b. Carry Blocks Physics, Pedestal Seating & Hazard/Pit Snap-Back
  for (let i = 0; i < carryBlocks.length; i++) {
    const block = carryBlocks[i];
    if (block.carriedBy) {
      const carrier = state.actors[block.carriedBy];
      if (!carrier || carrier.hurtTimer > 0 || carrier.devouredByGhost) {
        block.carriedBy = null;
        if (carrier) carrier.carryingBlockId = null;
      } else {
        block.x = carrier.x + carrier.w * 0.5 - block.w * 0.5;
        block.y = carrier.y - block.h - 2;
        block.vx = 0;
        block.vy = 0;
        block.placedPedestalId = null;
        continue;
      }
    }

    block.vx = approach(block.vx || 0, 0, 900 * dt);
    const blockGravScale = Math.max(0.35, state.gravityScale ?? 1);
    block.vy = Math.min(680, (block.vy || 0) + PHYSICS.GRAVITY * blockGravScale * dt);
    block.x = clamp(block.x + block.vx * dt, 4, state.worldWidth - block.w - 4);
    for (let s = 0; s < solids.length; s++) {
      const box = solids[s];
      if (rectsOverlap(block, box)) {
        if (block.vx > 0) block.x = box.x - block.w;
        else if (block.vx < 0) block.x = box.x + box.w;
        block.vx = 0;
      }
    }
    block.y += block.vy * dt;
    for (let s = 0; s < solids.length; s++) {
      const box = solids[s];
      if (rectsOverlap(block, box)) {
        if (block.vy >= 0) {
          block.y = box.y - block.h;
          block.vy = 0;
        } else {
          block.y = box.y + box.h;
          block.vy = 0;
        }
      }
    }

    // Seat on Carry Pedestals
    block.placedPedestalId = null;
    for (let p = 0; p < carryPedestals.length; p++) {
      const ped = carryPedestals[p];
      const pedZone = { x: ped.x - 4, y: ped.y - 44, w: ped.w + 8, h: 48 };
      if (rectsOverlap(block, pedZone)) {
        block.placedPedestalId = ped.id;
        ped.occupied = true;
        break;
      }
    }

    // Hazard/pit snap-back so carry blocks can never become unreachable
    const onHazard = state.hazards.some((hz) => isHazardActive(hz, state.elapsed) && rectsOverlap(block, hz));
    if (onHazard || block.y > state.worldHeight + 28) {
      block.x = block.homeX;
      block.y = block.homeY;
      block.vx = 0;
      block.vy = 0;
      block.placedPedestalId = null;
      callbacks.onBlockSnapBack?.(block);
    }
  }

  // 5c. Arrow Traps & Moving Projectiles
  const traps = state.arrowTraps || [];
  for (let i = 0; i < traps.length; i++) {
    const trap = traps[i];
    trap.timer -= dt;
    trap.telegraph = trap.timer <= (trap.telegraphSec || 0.55);
    if (trap.timer <= 0) {
      trap.timer = trap.fireInterval || 2.8;
      trap.telegraph = false;
      state.arrowProjectiles.push({
        id: `arr_${i}_${Math.round(state.elapsed * 1000)}`,
        x: trap.dir === 1 ? trap.x + (trap.w || 32) : trap.x - 14,
        y: trap.y + 13,
        w: 16,
        h: 6,
        vx: (trap.dir === 1 ? 1 : -1) * (trap.projSpeed || 260),
        damage: trap.damage || 18,
        life: 3.4,
      });
      callbacks.onArrowFire?.(trap);
    }
  }
  for (let i = state.arrowProjectiles.length - 1; i >= 0; i--) {
    const proj = state.arrowProjectiles[i];
    proj.life -= dt;
    proj.x += proj.vx * dt;
    if (proj.life <= 0 || proj.x < -32 || proj.x > state.worldWidth + 32) {
      state.arrowProjectiles.splice(i, 1);
      continue;
    }
    const hitSolid = solids.some((s) => rectsOverlap(proj, s));
    if (hitSolid) {
      state.arrowProjectiles.splice(i, 1);
      continue;
    }
    let hitActor = false;
    for (let a = 0; a < actorList.length; a++) {
      const actor = actorList[a];
      if (!actor || actor.hurtTimer > 0 || actor.invulnTimer > 0 || actor.phaseDash?.active || actor.devouredByGhost) {
        continue;
      }
      if (rectsOverlap(proj, actor)) {
        applyActorDamage(
          state,
          actor,
          proj.damage || 18,
          { sourceX: proj.x, knockbackY: -210, cause: 'Arrow Trap' },
          callbacks
        );
        hitActor = true;
        break;
      }
    }
    if (hitActor) {
      state.arrowProjectiles.splice(i, 1);
    }
  }

  // 6. Checkpoints Activation (Lantern Posts + Puzzle-Lock Check + Team Full Heal)
  for (let c = 0; c < state.checkpoints.length; c++) {
    const cp = state.checkpoints[c];
    const cpBox = { x: cp.x - 24, y: cp.y - 56, w: 48, h: 56 };
    const visitor = actorList.find((a) => a.hurtTimer <= 0 && rectsOverlap(a, cpBox));
    if (visitor) {
      if (!isCheckpointUnlocked(state, cp)) {
        callbacks.onCheckpointLocked?.(cp, visitor);
        continue;
      }
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
        healTeamToFull(state, callbacks);
        const litCount = state.checkpoints.filter((item) => item.activated).length;
        state.checkpointSnapshot = captureCheckpointSnapshot(state, {
          bossState: callbacks.bossState || null,
          checkpointNumber: litCount,
          checkpointLabel: cp.label || `Checkpoint ${litCount}`,
        });
        callbacks.onCheckpoint?.(cp, visitor, respawnPayload);
      } else if (!state.activeCheckpoint || state.activeCheckpoint.id !== cp.id) {
        state.activeCheckpoint = respawnPayload;
        const litCount = state.checkpoints.filter((item) => item.activated).length;
        state.checkpointSnapshot = captureCheckpointSnapshot(state, {
          bossState: callbacks.bossState || null,
          checkpointNumber: litCount,
          checkpointLabel: cp.label || `Checkpoint ${litCount}`,
        });
      }
    }
  }

  // 6b. Advance Weapon Pickups, Swings, Barrier Hits & Enemy/Boss Hits
  stepWeaponTimers(state, dt, callbacks);

  // 6c. In-World Puzzles, Escape Gauntlets, Secondary Grotesque Monsters, Health Orbs, Companion Cat & Foliage Spring Physics
  stepPuzzles(state, dt, callbacks);
  stepEscapeSequence(state, dt, callbacks);
  stepSecondaryMonsters(state, dt, callbacks);
  stepHealthOrbsAndCombatTexts(state, dt, callbacks);
  if (state.cat) {
    stepCompanionCat(state.cat, state, callbacks.mechState || null, dt, callbacks, solids);
  }
  if (Array.isArray(state.foliage) && state.foliage.length > 0) {
    const foliageMovers = state.cat && state.cat.discovered
      ? [...actorList, ...(state.monsters || []), state.cat]
      : [...actorList, ...(state.monsters || [])];
    stepFoliageSystem(
      state.foliage,
      foliageMovers,
      dt,
      state.physicsMode || 'normal',
      [...(state.weaponEffects || []), ...(state.monsterProjectiles || []), ...(state.arrowProjectiles || [])]
    );
  }

  // 7. Hazards & Patrol Enemy Collisions -> Tactile Health Damage & Knockback
  for (let i = 0; i < actorList.length; i++) {
    const actor = actorList[i];
    if (actor.hurtTimer > 0 || actor.invulnTimer > 0 || actor.phaseDash?.active) continue;

    let hitSource = null;
    for (let h = 0; h < state.hazards.length; h++) {
      const hz = state.hazards[h];
      if (!isHazardActive(hz, state.elapsed)) continue;
      const hzBox = { x: hz.x + 4, y: hz.y + 3, w: Math.max(8, hz.w - 8), h: Math.max(6, hz.h - 3) };
      if (rectsOverlap(actor, hzBox)) {
        hitSource = { x: hz.x + hz.w * 0.5, damage: hz.damage || 20, cause: hz.kind || 'Hazard' };
        break;
      }
    }

    if (!hitSource) {
      for (let e = 0; e < state.enemies.length; e++) {
        const en = state.enemies[e];
        if (en.stunTimer > 0) continue;
        const enBox = { x: en.x + 4, y: en.y + 4, w: Math.max(10, en.w - 8), h: Math.max(10, en.h - 4) };
        if (rectsOverlap(actor, enBox)) {
          hitSource = { x: en.x + en.w * 0.5, damage: 22, cause: 'Creature' };
          break;
        }
      }
    }

    if (hitSource) {
      applyActorDamage(
        state,
        actor,
        hitSource.damage,
        { sourceX: hitSource.x, knockbackY: -225, cause: hitSource.cause },
        callbacks
      );
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

  // 9. Key Pickups & Boss-Gated Exit Portal Unlock
  for (let i = 0; i < state.keys.length; i++) {
    const key = state.keys[i];
    if (key.collected) continue;
    const keyBox = { x: key.x - 16, y: key.y - 16, w: 32, h: 32 };
    const picker = actorList.find((a) => a.hurtTimer <= 0 && rectsOverlap(a, keyBox));
    if (picker) {
      key.collected = true;
      state.keysCollected += 1;
      callbacks.onKeyPickup?.(key, picker);
    }
  }
  const shouldUnlockNow = computePortalUnlocked(state);
  if (shouldUnlockNow && !state.portalUnlocked) {
    state.portalUnlocked = true;
    callbacks.onPortalUnlock?.(state.exit);
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

  // Locked seal sigil when gated behind an unsolved world puzzle
  if (cp.requiresPuzzleId && !lit) {
    const bob = Math.sin(time * 3.2 + cp.x * 0.02) * 2;
    ctx.fillStyle = 'rgba(245, 158, 11, 0.24)';
    ctx.beginPath();
    ctx.arc(0, -64 + bob, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FBBF24';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -67 + bob, 3.8, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#FDE68A';
    ctx.strokeStyle = '#1E182E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-5.5, -67 + bob, 11, 8.5, 2.5);
    ctx.fill();
    ctx.stroke();
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

  if (en.stunTimer > 0) {
    ctx.fillStyle = '#FDE047';
    ctx.strokeStyle = '#1E1B3A';
    ctx.lineWidth = 1.3;
    for (let s = 0; s < 3; s++) {
      const ang = time * 6.5 + (s * Math.PI * 2) / 3;
      const sx = Math.cos(ang) * 11;
      const sy = -21 + Math.sin(ang) * 3.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
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
  const bossLocked = Boolean(state.exit?.requiresBossDefeat && !state.bossDefeated);
  const labelText = !portalUnlocked
    ? keysCollected < keysRequired
      ? `Need ${keysRequired - keysCollected} Key${keysRequired - keysCollected > 1 ? 's' : ''}`
      : bossLocked
        ? 'Defeat Boss!'
        : 'Locked'
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

  // 2b. Grounded Ambient Contact Shadows underneath Elevated Ledges & Archways
  drawTerrainContactShadows(ctx, state.platforms, state.worldHeight - 120, viewRange);

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

  // 4c. Interactive Spring-Physics Biome Foliage
  renderFoliagePatches(ctx, state.foliage, time, viewRange);

  // 5. Checkpoints & Biome Climbable Ladders
  for (let c = 0; c < state.checkpoints.length; c++) {
    drawCheckpoint(ctx, state.checkpoints[c], time);
  }
  const ladders = state.ladders || [];
  for (let i = 0; i < ladders.length; i++) {
    drawLadder(ctx, ladders[i], worldTheme, time, viewRange);
  }

  // 6. Ocean Currents, Volcanic Thermal Vents, Hazards & Arrow Traps
  const currents = state.oceanCurrents || [];
  for (let i = 0; i < currents.length; i++) {
    drawOceanCurrent(ctx, currents[i], time, viewRange);
  }
  const vents = state.thermalVents || [];
  for (let i = 0; i < vents.length; i++) {
    drawThermalVent(ctx, vents[i], time, viewRange);
  }
  for (let i = 0; i < state.hazards.length; i++) {
    drawHazardObstacle(ctx, state.hazards[i], time, viewRange);
  }
  if (state.escapeState) {
    drawEscapeSurge(ctx, state.escapeState, state.worldHeight, time);
  }
  const traps = state.arrowTraps || [];
  for (let i = 0; i < traps.length; i++) {
    drawArrowTrap(ctx, traps[i], time, viewRange);
  }
  const dynamicTraps = state.dynamicTraps || [];
  const isNightLighting = bgSystem.getTimeOfDayMode?.() === 'night';
  for (let i = 0; i < dynamicTraps.length; i++) {
    const dtTrap = dynamicTraps[i];
    if (isNightLighting && dtTrap.phase !== 'collapsed') {
      ctx.save();
      ctx.fillStyle = 'rgba(251, 191, 36, 0.14)';
      ctx.beginPath();
      ctx.roundRect(dtTrap.x - 4, dtTrap.y - 4, (dtTrap.w || 48) + 8, (dtTrap.h || 16) + 8, 6);
      ctx.fill();
      ctx.restore();
    }
    drawDynamicTrap(ctx, dtTrap, worldTheme, time, viewRange);
  }
  const arrowProjs = state.arrowProjectiles || [];
  for (let i = 0; i < arrowProjs.length; i++) {
    drawArrowProjectile(ctx, arrowProjs[i], time, viewRange);
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

  // 8. Sliding Gates, Tool-Gated Barriers & Breakable Barriers
  for (let i = 0; i < state.gates.length; i++) {
    drawGateBarrier(ctx, state.gates[i], state, time, isSwitchActive);
  }
  drawFragileBarriers(ctx, state, time);
  const toolBarriers = state.fragileBarriers || [];
  for (let i = 0; i < toolBarriers.length; i++) {
    const tb = toolBarriers[i];
    if (!tb.broken && tb.material) {
      renderToolBarrier(ctx, tb, time);
    }
  }

  // 9. Pressure Switches, Carry Pedestals & In-World Canvas2D Logic Puzzles
  for (let i = 0; i < state.switches.length; i++) {
    const sw = state.switches[i];
    drawSwitchMechanism(ctx, sw, isSwitchActive(sw), time);
  }
  const carryPedestals = state.carryPedestals || [];
  const carryBlocks = state.carryBlocks || [];
  for (let i = 0; i < carryPedestals.length; i++) {
    const ped = carryPedestals[i];
    const isPowered = carryBlocks.some((b) => b.placedPedestalId === ped.id);
    drawCarryPedestal(ctx, ped, isPowered, time, viewRange);
  }
  renderPuzzles(ctx, state, time, viewRange);

  // 10. Exit Portal
  if (!state.exit.hidden) {
    drawExitPortal(ctx, state, time);
  }

  // 11. Collectible Keys, Carry Relic Blocks & Weapons
  for (let i = 0; i < state.keys.length; i++) {
    const key = state.keys[i];
    if (key.collected) continue;
    drawKeyIconWorld(ctx, key.x, key.y, key.color, time, key.bobPhase);
  }
  for (let i = 0; i < carryBlocks.length; i++) {
    drawCarryBlock(ctx, carryBlocks[i], time, viewRange);
  }
  drawWeaponPickups(ctx, state, time);

  // 12. Patrol Enemies, Grotesque Secondary Monsters & Projectiles
  for (let i = 0; i < state.enemies.length; i++) {
    drawEnemy(ctx, state.enemies[i], time);
  }
  renderMonstersAndProjectiles(ctx, state, time, viewRange);

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

  // 12e. Living Lobby Campfire Overlook Props (only rendered on Title / Journey Hub backdrop)
  if (!showIndicators && !state.isOpenWorld) {
    const campX = 186;
    const campY = 600;
    ctx.save();
    // Warm flickering radial campfire light on grass & characters
    const flicker = 1 + Math.sin(time * 9.4) * 0.06;
    const fireGlow = ctx.createRadialGradient(campX, campY - 14, 4, campX, campY - 12, 86 * flicker);
    fireGlow.addColorStop(0, 'rgba(253, 224, 71, 0.32)');
    fireGlow.addColorStop(0.55, 'rgba(251, 146, 60, 0.14)');
    fireGlow.addColorStop(1, 'rgba(251, 146, 60, 0)');
    ctx.fillStyle = fireGlow;
    ctx.beginPath();
    ctx.arc(campX, campY - 12, 86 * flicker, 0, Math.PI * 2);
    ctx.fill();

    // Travel trunk & warm campsite lantern behind Madjid
    ctx.fillStyle = '#6B442A';
    ctx.strokeStyle = '#1E182E';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(78, campY - 22, 30, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#F5B95B';
    ctx.fillRect(82, campY - 13, 22, 3);

    // Crossed logs & river stones
    ctx.fillStyle = '#4A2E20';
    ctx.beginPath();
    ctx.roundRect(campX - 16, campY - 7, 32, 7, 3);
    ctx.fill();
    ctx.stroke();

    for (let st = -2; st <= 2; st++) {
      ctx.fillStyle = st % 2 === 0 ? '#64748B' : '#475569';
      ctx.beginPath();
      ctx.ellipse(campX + st * 6.5, campY - 1.5, 4.2, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Animated layered campfire flame
    const flameH = 20 + Math.sin(time * 11.2) * 3.5;
    ctx.fillStyle = '#F97316';
    ctx.beginPath();
    ctx.moveTo(campX - 10, campY - 5);
    ctx.quadraticCurveTo(campX - 8, campY - 16, campX + Math.sin(time * 8) * 2, campY - 5 - flameH);
    ctx.quadraticCurveTo(campX + 8, campY - 16, campX + 10, campY - 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#FDE047';
    ctx.beginPath();
    ctx.moveTo(campX - 5.5, campY - 5);
    ctx.quadraticCurveTo(campX - 3, campY - 12, campX + Math.cos(time * 10) * 1.5, campY - 5 - flameH * 0.65);
    ctx.quadraticCurveTo(campX + 4, campY - 12, campX + 5.5, campY - 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 13. Elevation-Aware Ground Shadows + Madjid, Nadine & Companion Cat
  const madjid = state.actors.madjid;
  const nadine = state.actors.nadine;
  const activeCat = !showIndicators && extras?.lobbyCat ? extras.lobbyCat : state.cat;

  drawActorContactShadow(ctx, madjid, state.platforms, state.movingPlatforms, state.worldHeight);
  drawActorContactShadow(ctx, nadine, state.platforms, state.movingPlatforms, state.worldHeight);
  if (activeCat) {
    drawActorContactShadow(ctx, activeCat, state.platforms, state.movingPlatforms, state.worldHeight);
  }

  if (isNightLighting) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 226, 152, 0.14)';
    ctx.beginPath();
    ctx.arc(madjid.x + madjid.w * 0.5, madjid.y + madjid.h * 0.5, 42, 0, Math.PI * 2);
    ctx.moveTo(nadine.x + nadine.w * 0.5 + 42, nadine.y + nadine.h * 0.5);
    ctx.arc(nadine.x + nadine.w * 0.5, nadine.y + nadine.h * 0.5, 42, 0, Math.PI * 2);
    if (activeCat && activeCat.discovered) {
      ctx.moveTo(activeCat.x + 11 + 26, activeCat.y + 9);
      ctx.arc(activeCat.x + 11, activeCat.y + 9, 26, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();
  }

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

  if (activeCat) {
    renderCompanionCat(ctx, activeCat, showIndicators ? state : null, time);
  }

  // 14. Pooled Particles, Health Orbs, Floating Combat Texts & Weapon Sparks
  particles.render(ctx);
  renderHealthOrbsAndTexts(ctx, state, time);
  drawWeaponSparks(ctx, state);

  // 14a. Grotesque Ugly Ghost, Cartoon Bones & Rare Idle Co-op Overlay
  if (extras?.mechState) {
    renderIdleCoopOverlay(ctx, state, extras.mechState, time);
    renderUglyGhost(ctx, extras.mechState, state, time);
  }

  // 14b. Synchronized Waypoint Pings & Overhead Chat Speech Bubbles
  if (interactionState) {
    renderPingBeacons(ctx, interactionState, time);
    renderOverheadBubbles(ctx, state.actors, interactionState, extras?.viewportBounds || null);
  }

  // 14c. Grand Wedding Ceremony Deterministic Petals, Concentric Golden Hearts & Banner
  if (extras?.weddingCeremony?.active) {
    const wc = extras.weddingCeremony;
    const progress = clamp(wc.timer / Math.max(0.1, wc.duration), 0, 1);
    const archX = state.exit.x + state.exit.w * 0.5;
    const archY = state.exit.y + state.exit.h * 0.5;
    ctx.save();

    // Soft golden concentric halo around the Coral Wedding Arch
    const glowAlpha = Math.min(1, progress * 2.5) * 0.22;
    ctx.fillStyle = `rgba(253, 230, 138, ${glowAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(archX, archY, 108 + Math.sin(time * 3) * 8, 0, Math.PI * 2);
    ctx.fill();

    // Deterministic rose petals & rising golden hearts (zero Math.random() in render)
    const petalColors = ['#F472B6', '#FDA4AF', '#FFF1F2', '#FDE68A'];
    for (let i = 0; i < 18; i++) {
      const seed = i * 1.618;
      const fallT = (time * 0.34 + i * 0.083) % 1;
      const px = archX + Math.sin(seed * 7 + time * 1.5) * 145 + (i - 8.5) * 8;
      const py = state.exit.y - 90 + fallT * 210;
      const rot = time * 2.2 + seed * 3;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.globalAlpha = Math.sin(fallT * Math.PI) * 0.9;
      ctx.fillStyle = petalColors[i % petalColors.length];
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.2, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (let h = 0; h < 6; h++) {
      const riseT = (time * 0.45 + h * 0.166) % 1;
      const hx = archX + Math.sin(time * 2.1 + h * 1.4) * 28;
      const hy = state.exit.y + 18 - riseT * 78;
      const s = 5.5 + Math.sin(h + time * 3) * 1.2;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.globalAlpha = (1 - riseT) * 0.88;
      ctx.fillStyle = h % 2 === 0 ? '#F472B6' : '#FDE047';
      ctx.beginPath();
      ctx.moveTo(0, s * 0.45);
      ctx.bezierCurveTo(-s, -s * 0.25, -s * 0.6, -s * 1.1, 0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.6, -s * 1.1, s, -s * 0.25, 0, s * 0.45);
      ctx.fill();
      ctx.restore();
    }

    // Celebratory banner above arch
    const bannerY = state.exit.y - 54;
    const bannerText = 'Madjid & Nadine · Married Beneath the Coral Arch ♥';
    ctx.font = '800 13.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bw = Math.max(260, ctx.measureText(bannerText).width + 30);
    const bh = 32;
    const bx = archX - bw * 0.5;
    const by = bannerY - bh * 0.5;
    ctx.globalAlpha = Math.min(1, progress * 3);
    const bGrad = ctx.createLinearGradient(bx, by, bx, by + bh);
    bGrad.addColorStop(0, 'rgba(30, 22, 54, 0.9)');
    bGrad.addColorStop(1, 'rgba(88, 28, 66, 0.92)');
    ctx.fillStyle = bGrad;
    ctx.strokeStyle = 'rgba(253, 230, 138, 0.85)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#FFF8D6';
    ctx.fillText(bannerText, archX, bannerY + 0.5);

    ctx.restore();
  }

  // 15. Brief Rising World Callouts (Slime Liquid Glass Capsules)
  if (worldToasts && worldToasts.length > 0) {
    ctx.save();
    ctx.font = '800 12.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < worldToasts.length; i++) {
      const t = worldToasts[i];
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      const tw = Math.max(70, ctx.measureText(t.text).width + 22);
      const th = 26;
      const rx = t.x - tw * 0.5;
      const ry = t.y - th;

      const glassGrad = ctx.createLinearGradient(rx, ry, rx, ry + th);
      glassGrad.addColorStop(0, 'rgba(24, 34, 62, 0.86)');
      glassGrad.addColorStop(1, 'rgba(12, 18, 36, 0.92)');
      ctx.fillStyle = glassGrad;
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(rx, ry, tw, th, 13);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.roundRect(rx + 6, ry + 2.5, tw - 12, 4, 2);
      ctx.fill();

      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, ry + th * 0.54);
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
  const elLobbyWorldMap = document.getElementById('lobby-world-map');
  const elBtnStartJourney = document.getElementById('btn-start-journey');
  const elBtnLobbyModeSolo = document.getElementById('btn-lobby-mode-solo');
  const elBtnLobbyModeCoop = document.getElementById('btn-lobby-mode-coop');
  const elBtnLobbyDay = document.getElementById('btn-lobby-day');
  const elBtnLobbyNight = document.getElementById('btn-lobby-night');
  const elBtnDrawerDay = document.getElementById('btn-drawer-day');
  const elBtnDrawerNight = document.getElementById('btn-drawer-night');
  const elBtnLobbyBgmToggle = document.getElementById('btn-lobby-bgm-toggle');
  const elBtnLobbyBgmNext = document.getElementById('btn-lobby-bgm-next');
  const elBtnLobbyTouchToggle = document.getElementById('btn-lobby-touch-toggle');
  const elHudLayer = document.getElementById('hud-layer');
  const elHudChapterCluster = document.querySelector('.hud-chapter-cluster');
  const elHudBtnCollapse = document.getElementById('hud-btn-collapse-hud');
  const elHudChapterNum = document.getElementById('hud-chapter-num');
  const elHudChapterTitle = document.getElementById('hud-chapter-title');
  const elDedicationScreen = document.getElementById('dedication-screen');
  const elBtnDedicationContinue = document.getElementById('btn-dedication-continue');
  const elLobbyResumePrompt = document.getElementById('lobby-resume-prompt');
  const elLobbyResumeKicker = document.getElementById('lobby-resume-kicker');
  const elLobbyResumeSummary = document.getElementById('lobby-resume-summary');
  const elBtnResumeSaved = document.getElementById('btn-resume-saved');
  const elBtnResumeAlt = document.getElementById('btn-resume-alt');
  const elBtnResumeFresh = document.getElementById('btn-resume-fresh');
  const elBtnTitleInstall = document.getElementById('btn-title-install');
  const elBtnPwaInstall = document.getElementById('btn-pwa-install');
  const elOfflineIndicator = document.getElementById('offline-indicator');
  const elIosInstallModal = document.getElementById('ios-install-modal');
  const elBtnIosInstallClose = document.getElementById('btn-ios-install-close');
  const elHudEscapeBanner = document.getElementById('hud-escape-banner');
  const elHudEscapeTitle = document.getElementById('hud-escape-title');
  const elHudEscapeTimer = document.getElementById('hud-escape-timer');
  const elHudStoryWhisper = document.getElementById('hud-story-whisper');
  const elHudStoryWhisperTitle = document.getElementById('hud-story-whisper-title');
  const elHudStoryWhisperLine = document.getElementById('hud-story-whisper-line');
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
  const elHudBtnDanceStyles = document.getElementById('hud-btn-dance-styles');
  const elHudBtnDash = document.getElementById('hud-btn-dash');
  const elHudDashCooldown = document.getElementById('hud-dash-cooldown');
  const elHudBtnTouchToggle = document.getElementById('hud-btn-touch-toggle');
  const elHudBtnSettings = document.getElementById('hud-btn-settings');
  const elHudPing = document.getElementById('hud-ping');
  const elHudHpMadjidFill = document.getElementById('hud-hp-madjid-fill');
  const elHudHpMadjidVal = document.getElementById('hud-hp-madjid-val');
  const elHudHpNadineFill = document.getElementById('hud-hp-nadine-fill');
  const elHudHpNadineVal = document.getElementById('hud-hp-nadine-val');
  const elHudTutorialHint = document.getElementById('hud-tutorial-hint');
  const elLowHpVignette = document.getElementById('low-hp-vignette');

  const elSettingsDrawer = document.getElementById('settings-drawer');
  const elBtnCloseSettings = document.getElementById('btn-close-settings');
  const elDrawerRoomSummary = document.getElementById('drawer-room-summary');
  const elDrawerBtnOpenWorld = document.getElementById('drawer-btn-openworld');
  const elDrawerMuteLabel = document.getElementById('drawer-mute-label');
  const elDrawerBtnBgmToggle = document.getElementById('drawer-btn-bgm-toggle');
  const elDrawerBgmToggleLabel = document.getElementById('drawer-bgm-toggle-label');
  const elDrawerBtnBgmNext = document.getElementById('drawer-btn-bgm-next');
  const elDrawerBgmTrackLabel = document.getElementById('drawer-bgm-track-label');
  const elDrawerBtnLeaveRoom = document.getElementById('drawer-btn-leave-room');
  const elDrawerWorldsList = document.getElementById('drawer-worlds-list');
  const elBtnDrawerWorldsModal = document.getElementById('btn-drawer-worlds-modal');
  const elDrawerBtnResetProgress = document.getElementById('drawer-btn-reset-progress');
  const elDrawerBtnTouchCycle = document.getElementById('drawer-btn-touch-cycle');

  const elStudioPreviewCanvas = document.getElementById('studio-preview-canvas');
  const elStudioImageUpload = document.getElementById('studio-image-upload');
  const elStudioScanStatus = document.getElementById('studio-scan-status');
  const elStudioSkinName = document.getElementById('studio-skin-name');
  const elStudioBodyColor = document.getElementById('studio-body-color');
  const elStudioAccentColor = document.getElementById('studio-accent-color');
  const elStudioPattern = document.getElementById('studio-pattern');
  const elStudioHeadgear = document.getElementById('studio-headgear');
  const elStudioAura = document.getElementById('studio-aura');
  const elBtnStudioSave = document.getElementById('btn-studio-save');

  const elTryAgainModal = document.getElementById('try-again-modal');
  const elTryAgainReason = document.getElementById('try-again-reason');
  const elBtnTryAgainRespawn = document.getElementById('btn-try-again-respawn');
  const elBtnTryAgainRestart = document.getElementById('btn-try-again-restart');

  const elHudBtnPhoto = document.getElementById('hud-btn-photo');
  const elHudBtnWeapon = document.getElementById('hud-btn-weapon');
  const elHudWeaponLabel = document.getElementById('hud-weapon-label');
  const elHudBtnWeaponNext = document.getElementById('hud-btn-weapon-next');
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
  const elTouchHubToggle = document.getElementById('touch-hub-toggle');
  const elTouchSwitch = document.getElementById('touch-switch');
  const elTouchDown = document.getElementById('touch-down');
  const elTouchJump = document.getElementById('touch-jump');
  const elTouchActionE = document.getElementById('touch-action-e');
  const elTouchWeapon = document.getElementById('touch-weapon');
  const elTouchWeaponCycle = document.getElementById('touch-weapon-cycle');
  const elTouchDance = document.getElementById('touch-dance');
  const elTouchDash = document.getElementById('touch-dash');

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
  const elBtnCoopQuickJoin = document.getElementById('btn-coop-quick-join');
  const elHudBtnCoop = document.getElementById('hud-btn-coop');

  const elSoundOn = document.getElementById('icon-sound-on');
  const elSoundOff = document.getElementById('icon-sound-off');
  const elMuteBtn = document.getElementById('hud-btn-mute');

  elStoryPremise.textContent = STORY_PREMISE;

  // Persistent Local Preferences (Skins & Cleared Levels across 10 Worlds / 50 Stages)
  const audio = createAudioEngine();
  let initialTimeOfDay = 'day';
  try {
    const savedTod = window.localStorage.getItem('nadine_time_of_day_v1');
    if (savedTod === 'day' || savedTod === 'night') {
      initialTimeOfDay = savedTod;
    }
  } catch {
    initialTimeOfDay = 'day';
  }
  const bgSystem = createBackgroundSystem('sunrise', initialTimeOfDay);
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

  loadSavedCustomSkins().forEach((customSkin) => {
    registerSkin(customSkin);
  });

  let qualityPreset = 'high';
  let timeOfDayMode = initialTimeOfDay;
  let selectedSkins = {
    madjid: getDefaultSkinId('madjid'),
    nadine: getDefaultSkinId('nadine'),
  };
  const clearedLevelIds = new Set();

  try {
    const savedQuality = window.localStorage.getItem('nadine_quality_preset');
    if (savedQuality === 'not_bad' || savedQuality === 'good' || savedQuality === 'high') {
      qualityPreset = savedQuality;
    }
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
      window.localStorage.setItem('nadine_quality_preset', qualityPreset);
      window.localStorage.setItem('nadine_time_of_day_v1', timeOfDayMode);
      saveProgression(window.localStorage, progressionState);
    } catch {
      // Ignore storage errors
    }
  }

  let progressionState = loadProgression(window.localStorage, clearedLevelIds);
  let lobbySelectedWorldId = Math.min(WORLDS.length, Math.max(1, progressionState.highestUnlockedWorld || 1));
  let lobbyModeChoice = 'solo'; // 'solo' | 'coop'
  let storyState = createStorylineState(1);
  let resetProgressArmed = false;
  let resetProgressArmTimer = null;
  const lobbyCat = {
    name: 'Mimi',
    discovered: true,
    x: 158,
    y: 582,
    w: 22,
    h: 18,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    mood: 'purring',
    idleAction: 'purr',
    blinkTimer: 2,
    walkDist: 0,
    helmetActive: false,
    alertTimer: 0,
    heartTimer: 0,
  };

  // Core Game State Machine
  let gameState = 'dedication'; // 'dedication' | 'title' | 'playing' | 'paused' | 'gameover'
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
  let dedicationAutoTimer = null;
  let autoRespawnTimer = 0;
  let deferredInstallPrompt = /** @type {any} */ (null);
  let titleHeartTimer = 1.6;
  let lobbyCampEmberTimer = 0.25;
  let touchPadMode = 'on';
  let hudCollapsed = false;
  let touchHubExpanded = false;
  let lastCheckpointLockedToastAt = 0;
  let lastMicroParticleAt = 0;
  let lastRunDustAt = 0;
  let lastSectorCode = '';

  try {
    hudCollapsed = window.localStorage.getItem('nadine_hud_collapsed') === '1';
    const savedPad = window.localStorage.getItem('nadine_touch_pad_mode');
    if (savedPad === 'auto' || savedPad === 'on' || savedPad === 'off') {
      touchPadMode = savedPad;
    }
  } catch {
    hudCollapsed = false;
  }

  function applyHudCollapseState() {
    elHudChapterCluster?.classList.toggle('is-collapsed', hudCollapsed);
    if (elHudBtnCollapse) {
      elHudBtnCollapse.setAttribute('aria-expanded', String(!hudCollapsed));
      elHudBtnCollapse.setAttribute('title', hudCollapsed ? 'Expand World HUD (H)' : 'Collapse World HUD (H)');
      elHudBtnCollapse.textContent = hudCollapsed ? '+' : '−';
    }
  }
  applyHudCollapseState();

  function toggleHudCollapsed(force = null) {
    hudCollapsed = force === null ? !hudCollapsed : Boolean(force);
    try {
      window.localStorage.setItem('nadine_hud_collapsed', hudCollapsed ? '1' : '0');
    } catch {
      // Ignore storage failures
    }
    applyHudCollapseState();
  }

  function toggleTouchActionHub(force = null) {
    touchHubExpanded = force === null ? !touchHubExpanded : Boolean(force);
    elTouchControls?.classList.toggle('touch-hub-expanded', touchHubExpanded);
    elTouchHubToggle?.setAttribute('aria-expanded', String(touchHubExpanded));
  }

  // Unified Cooperative Mechanics, Boss, Weather, Wedding Ceremony & Scrapbook State
  let mechState = createMechanicsState();
  let bossState = null;
  let weddingCeremony = null;
  let photoSpots = [];
  let activePhotoSpot = null;
  let scrapbookPhotos = loadLocalScrapbook();
  let weatherMode = 'clear';
  let openWorldCycleTimer = 0;
  let shutterFlashAlpha = 0;
  let currentCamScale = 1.26;
  let currentZoomFactor = 1.26;
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
    weapons: [],
    equippedWeapon: null,
    phaseDashActive: false,
    phaseRippleTimer: 0,
    weaponSwing: null,
  };
  let coopCreateModeChoice = 'story';
  let coopCreateCharChoice = 'madjid';
  let coopDirectoryRooms = [];
  let isApplyingRemoteUpdate = false;
  let lastCoopStateSendMs = 0;
  let coopAdvanceTimer = null;
  let pendingQuickJoin = false;
  let pendingResumeRoomCode = null;
  let resumePromptDismissed = false;

  function clearCoopAdvanceTimer() {
    if (coopAdvanceTimer) {
      window.clearTimeout(coopAdvanceTimer);
      coopAdvanceTimer = null;
    }
  }

  // Decoupled Input Hub (Keyboard + Multi-Touch + Network Remote Slot)
  const keysHeld = new Set();
  const touchHeld = { left: false, right: false, down: false, jump: false };
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
      text: 'Welcome across 5 seamless Worlds! Press Tab to switch between Madjid and Nadine, Shift to Soul Dash, or open Online Co-op to play together.',
      timestamp: 'W1',
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
    touchHeld.down = false;
    touchHeld.jump = false;
    localJumpJustPressed = false;
    localJumpJustReleased = false;
    prevJumpHeld = false;
    document.querySelectorAll('.touch-btn.pressed').forEach((b) => b.classList.remove('pressed'));
  }

  function syncMuteUI() {
    const muted = audio.isMuted();
    const bgm = audio.getBgmState();
    elSoundOn?.classList.toggle('hidden', muted);
    elSoundOff?.classList.toggle('hidden', !muted);
    if (elDrawerMuteLabel) {
      elDrawerMuteLabel.textContent = muted ? 'Sound & Music: Off' : 'Sound & Music: On';
    }
    elMuteBtn?.setAttribute('aria-pressed', String(muted));
    elMuteBtn?.setAttribute('aria-label', muted ? 'Unmute sound and music' : 'Mute sound and music');

    if (elDrawerBgmToggleLabel) {
      elDrawerBgmToggleLabel.textContent = bgm.musicEnabled ? 'Music: On' : 'Music: Off';
    }
    if (elDrawerBtnBgmToggle) {
      elDrawerBtnBgmToggle.setAttribute('aria-pressed', String(bgm.musicEnabled));
      elDrawerBtnBgmToggle.classList.toggle('is-accent', bgm.musicEnabled && !muted && !bgm.unavailable);
    }
    if (elDrawerBgmTrackLabel) {
      elDrawerBgmTrackLabel.textContent = bgm.unavailable
        ? 'Music Unavailable'
        : `${bgm.trackIndex + 1}/${BGM_TRACKS.length} · ${bgm.trackTitle}`;
    }
    if (elDrawerBtnBgmNext) {
      elDrawerBtnBgmNext.disabled = Boolean(bgm.unavailable);
      elDrawerBtnBgmNext.setAttribute('aria-label', `Next background music track (current: ${bgm.trackTitle})`);
    }
    if (elBtnLobbyBgmToggle) {
      const musicActive = bgm.musicEnabled && !muted && !bgm.unavailable;
      elBtnLobbyBgmToggle.textContent = muted || !bgm.musicEnabled ? 'Music: Off' : 'Music: On';
      elBtnLobbyBgmToggle.setAttribute('aria-pressed', String(musicActive));
      elBtnLobbyBgmToggle.classList.toggle('is-active', musicActive);
    }
    if (elBtnLobbyBgmNext) {
      elBtnLobbyBgmNext.disabled = Boolean(bgm.unavailable);
      elBtnLobbyBgmNext.textContent = bgm.unavailable
        ? 'Music Unavailable'
        : `${bgm.trackIndex + 1}/${BGM_TRACKS.length} · ${bgm.trackTitle}`;
      elBtnLobbyBgmNext.setAttribute('aria-label', `Switch soundtrack (current: ${bgm.trackTitle})`);
    }
  }

  function syncStoryWhisperHud() {
    if (!elHudStoryWhisper) return;
    const activeBanner = gameState === 'playing' && !activeSubModal ? storyState?.banner : null;
    elHudStoryWhisper.classList.toggle('hidden', !activeBanner);
    if (activeBanner) {
      if (elHudStoryWhisperTitle) elHudStoryWhisperTitle.textContent = activeBanner.title || '';
      if (elHudStoryWhisperLine) elHudStoryWhisperLine.textContent = activeBanner.line || '';
    }
  }

  function fireStoryBeat(eventType, { fromRemote = false } = {}) {
    if (!storyState || playMode !== 'story') return null;
    const worldId = LEVELS[currentLevelIdx]?.worldId || 1;
    const res = triggerStoryEvent(
      storyState,
      eventType,
      {
        worldId,
        fromRemote,
        actors: levelState.actors,
      },
      interactionState,
      {
        onStoryBeat(payload) {
          if (coopSession.active && !fromRemote) {
            coopClient.sendStorySync({
              event: 'story_beat',
              beatId: payload.beatId,
              eventType: payload.eventType,
              worldId: payload.worldId,
            });
          }
        },
      }
    );
    syncStoryWhisperHud();
    return res;
  }

  const WORLD_LOBBY_ACCENTS = {
    1: '#6EE7B7',
    2: '#7DD3FC',
    3: '#FB923C',
    4: '#C084FC',
    5: '#38BDF8',
  };

  function syncLobbyModeButtons() {
    if (elBtnLobbyModeSolo) {
      const isSolo = lobbyModeChoice !== 'coop';
      elBtnLobbyModeSolo.classList.toggle('is-active', isSolo);
      elBtnLobbyModeSolo.setAttribute('aria-pressed', String(isSolo));
    }
    if (elBtnLobbyModeCoop) {
      const isCoop = lobbyModeChoice === 'coop';
      elBtnLobbyModeCoop.classList.toggle('is-active', isCoop);
      elBtnLobbyModeCoop.setAttribute('aria-pressed', String(isCoop));
    }
    if (elBtnStartJourney) {
      elBtnStartJourney.textContent =
        lobbyModeChoice === 'coop'
          ? `Open 2P Co-op · World ${lobbySelectedWorldId}`
          : `Begin World ${lobbySelectedWorldId}`;
    }
  }

  function renderLobbyWorldMap() {
    if (!elLobbyWorldMap) return;
    if (!isWorldUnlocked(progressionState, lobbySelectedWorldId)) {
      lobbySelectedWorldId = Math.min(WORLDS.length, Math.max(1, progressionState.highestUnlockedWorld || 1));
    }
    elLobbyWorldMap.innerHTML = '';

    WORLDS.forEach((world) => {
      const status = getWorldProgressionStatus(progressionState, world.id);
      const unlocked = isWorldUnlocked(progressionState, world.id);
      const dangerous = isWorldDangerous(world.id);
      const selected = world.id === lobbySelectedWorldId;

      const card = document.createElement('button');
      card.type = 'button';
      card.role = 'listitem';
      card.disabled = !unlocked;
      card.dataset.worldId = String(world.id);
      card.style.setProperty('--world-accent', WORLD_LOBBY_ACCENTS[world.id] || '#FDE68A');
      card.className = `lobby-world-card is-${status}${selected ? ' is-selected' : ''}`;
      card.setAttribute('aria-pressed', String(selected));
      card.setAttribute(
        'aria-label',
        `World ${world.id}: ${world.name}, ${status === 'locked' ? `Locked until World ${world.id - 1} is cleared` : status}${dangerous ? ', Dangerous Territory' : ''}`
      );

      const top = document.createElement('div');
      top.className = 'lobby-world-top';
      const codeEl = document.createElement('span');
      codeEl.className = 'lobby-world-code';
      codeEl.textContent = `W${world.id}`;
      const statusEl = document.createElement('span');
      statusEl.className = 'lobby-world-status';
      statusEl.textContent = status === 'completed' ? 'Cleared ✓' : status === 'unlocked' ? 'Unlocked' : 'Locked';
      top.appendChild(codeEl);
      top.appendChild(statusEl);

      const nameEl = document.createElement('span');
      nameEl.className = 'lobby-world-name';
      nameEl.textContent = world.name;

      card.appendChild(top);
      card.appendChild(nameEl);

      if (!unlocked) {
        const hintEl = document.createElement('span');
        hintEl.className = 'lobby-world-hint';
        hintEl.textContent = `Clear World ${world.id - 1}`;
        card.appendChild(hintEl);
      }
      if (dangerous) {
        const dangerEl = document.createElement('span');
        dangerEl.className = 'lobby-world-danger';
        dangerEl.textContent = 'Dangerous Territory';
        card.appendChild(dangerEl);
      }

      card.addEventListener('click', (e) => {
        if (!unlocked) return;
        e.currentTarget.blur();
        audio.unlock();
        audio.playUiClick();
        lobbySelectedWorldId = world.id;
        bgSystem.setTheme(world.theme, false, {
          landmark: world.landmark,
          ambient: world.ambient,
          platformPalette: world.platformPalette,
          weather: getWeatherForWorld(world.id),
        });
        renderLobbyWorldMap();
        syncLobbyModeButtons();
      });

      elLobbyWorldMap.appendChild(card);
    });

    syncLobbyModeButtons();
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

    if (elDrawerRoomSummary) {
      if (locked && coopSession.roomCode) {
        const who = activeCharId === 'madjid' ? 'Madjid' : 'Nadine';
        elDrawerRoomSummary.textContent = `Room ${coopSession.roomCode} (${coopSession.room?.playerCount || 1}/2) · Playing as ${who}`;
      } else {
        elDrawerRoomSummary.textContent = 'Solo Mode · Progress saves automatically';
      }
    }
    if (elDrawerBtnLeaveRoom) {
      elDrawerBtnLeaveRoom.classList.toggle('hidden', !locked);
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

  let studioTargetChar = 'madjid';

  function syncHealthHud() {
    const m = levelState.actors.madjid;
    const n = levelState.actors.nadine;
    const mMax = Math.max(1, m?.maxHp || 100);
    const nMax = Math.max(1, n?.maxHp || 100);
    const mHp = Math.max(0, Math.round(m?.hp ?? mMax));
    const nHp = Math.max(0, Math.round(n?.hp ?? nMax));
    const mPct = Math.max(0, Math.min(100, Math.round((mHp / mMax) * 100)));
    const nPct = Math.max(0, Math.min(100, Math.round((nHp / nMax) * 100)));

    if (elHudHpMadjidFill) {
      elHudHpMadjidFill.style.width = `${mPct}%`;
      elHudHpMadjidFill.classList.toggle('is-low', mHp > 0 && mPct < 30);
    }
    if (elHudHpMadjidVal) elHudHpMadjidVal.textContent = `${mHp}/${mMax}`;
    if (elHudHpNadineFill) {
      elHudHpNadineFill.style.width = `${nPct}%`;
      elHudHpNadineFill.classList.toggle('is-low', nHp > 0 && nPct < 30);
    }
    if (elHudHpNadineVal) elHudHpNadineVal.textContent = `${nHp}/${nMax}`;

    if (elLowHpVignette) {
      const watchActor = coopSession.active && coopSession.localCharId ? levelState.actors[coopSession.localCharId] : levelState.actors[activeCharId];
      const watchLow = Boolean(
        gameState === 'playing' &&
          !levelState.gameOver &&
          watchActor &&
          watchActor.hp > 0 &&
          watchActor.hp / Math.max(1, watchActor.maxHp || 100) < 0.3
      );
      elLowHpVignette.classList.toggle('hidden', !watchLow);
    }
  }

  function updateDashCooldownHud() {
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    const cd = Math.max(0, actor?.dashCooldown || 0);
    const ready = cd <= 0.02;
    if (elHudDashCooldown) {
      elHudDashCooldown.textContent = ready ? 'Shift' : `${cd.toFixed(1)}s`;
    }
    if (elHudBtnDash) {
      elHudBtnDash.classList.toggle('is-ready', ready);
      elHudBtnDash.classList.toggle('is-cooling', !ready);
    }
    if (elTouchDash) {
      elTouchDash.classList.toggle('is-ready', ready);
      const span = elTouchDash.querySelector('span');
      if (span) span.textContent = ready ? 'Dash' : `${cd.toFixed(0)}s`;
    }
  }

  let lastTutorialHintText = '';
  function updateTutorialHint() {
    if (!elHudTutorialHint) return;
    if (gameState !== 'playing' || activeSubModal || levelState.gameOver) {
      if (lastTutorialHintText !== '') {
        lastTutorialHintText = '';
        elHudTutorialHint.classList.add('hidden');
      }
      return;
    }

    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    let hint = '';

    if (actor) {
      const acx = actor.x + actor.w * 0.5;
      const acy = actor.y + actor.h * 0.5;

      const nearPickup = (levelState.weaponPickups || []).find(
        (p) => !p.collected && Math.hypot(acx - p.x, acy - p.y) <= 78
      );
      const nearPuzzle = (levelState.puzzles || []).find(
        (pz) => !pz.solved && (pz.nodes || []).some((n) => Math.hypot(acx - (n.x + n.w * 0.5), acy - (n.y + n.h * 0.5)) <= 84)
      );
      const nearBlock = (levelState.carryBlocks || []).find(
        (b) => !b.carriedBy && !b.placedPedestalId && Math.hypot(acx - (b.x + b.w * 0.5), acy - (b.y + b.h * 0.5)) <= 84
      );
      const nearBarrier = (levelState.fragileBarriers || []).find(
        (b) => !b.broken && Math.hypot(acx - (b.x + b.w * 0.5), acy - (b.y + b.h * 0.5)) <= 105
      );

      if (actor.carryingBlockId) {
        hint = 'Carry relic block onto a glowing Pedestal, then press E to set down';
      } else if (nearPickup) {
        const def = getWeaponDef(nearPickup.weaponId);
        hint = `Press X to equip ${def.name}`;
      } else if (nearPuzzle) {
        if (nearPuzzle.kind === 'ordered_levers') {
          hint = 'Inspect the Rune Mural and pull glowing levers in exact order (E)';
        } else if (nearPuzzle.kind === 'conduit_locks') {
          hint = 'Strike Energy Conduits with Energy Wand (X) or press E together';
        } else if (nearPuzzle.kind === 'sync_plates') {
          hint = 'Step onto BOTH Sync Plates together with Madjid & Nadine!';
        } else {
          hint = 'Press E near each rotating pillar to align matching symbols';
        }
      } else if (nearBlock) {
        hint = 'Press E to lift heavy stone relic block';
      } else if (nearBarrier && nearBarrier.material) {
        const toolName = nearBarrier.requiredWeapon === 'crystal_hammer'
          ? 'Crystal Hammer'
          : nearBarrier.requiredWeapon === 'energy_wand'
            ? 'Energy Wand'
            : 'Light Sword';
        hint = `Strike ${nearBarrier.material} barrier with ${toolName} (X)`;
      } else if (isBossEngaged(levelState, bossState)) {
        hint = bossState.shielded
          ? 'Stand close or strike together to shatter the Boss Shield!'
          : 'Boss Shield down! Jump on crown or attack with your weapon (X)';
      }
    }

    if (hint !== lastTutorialHintText) {
      lastTutorialHintText = hint;
      if (hint) {
        elHudTutorialHint.textContent = hint;
        elHudTutorialHint.classList.remove('hidden');
      } else {
        elHudTutorialHint.classList.add('hidden');
      }
    }
  }

  function applyQualityPreset(nextPreset) {
    if (nextPreset !== 'not_bad' && nextPreset !== 'good' && nextPreset !== 'high') return;
    qualityPreset = nextPreset;
    savePreferences();
    document.querySelectorAll('[data-quality-preset]').forEach((btn) => {
      const active = btn.dataset.qualityPreset === qualityPreset;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    resizeCanvas();
  }

  function applyTimeOfDayMode(nextMode, { instant = false, broadcast = false } = {}) {
    timeOfDayMode = nextMode === 'night' ? 'night' : 'day';
    bgSystem.setTimeOfDayMode(timeOfDayMode, instant);
    savePreferences();

    const isNight = timeOfDayMode === 'night';
    if (elBtnLobbyDay) {
      elBtnLobbyDay.classList.toggle('is-active', !isNight);
      elBtnLobbyDay.setAttribute('aria-pressed', String(!isNight));
    }
    if (elBtnLobbyNight) {
      elBtnLobbyNight.classList.toggle('is-active', isNight);
      elBtnLobbyNight.setAttribute('aria-pressed', String(isNight));
    }
    if (elBtnDrawerDay) {
      elBtnDrawerDay.classList.toggle('active', !isNight);
      elBtnDrawerDay.setAttribute('aria-pressed', String(!isNight));
    }
    if (elBtnDrawerNight) {
      elBtnDrawerNight.classList.toggle('active', isNight);
      elBtnDrawerNight.setAttribute('aria-pressed', String(isNight));
    }

    if (broadcast && coopSession.active && !isApplyingRemoteUpdate) {
      coopClient.sendStorySync({
        event: 'time_of_day',
        timeOfDayMode,
      });
    }
  }

  function renderDrawerWorldsList() {
    if (!elDrawerWorldsList) return;
    elDrawerWorldsList.innerHTML = '';
    WORLDS.forEach((world) => {
      const idx = LEVELS.findIndex((l) => l.worldId === world.id);
      if (idx < 0) return;
      const lvl = LEVELS[idx];
      const unlocked = isWorldUnlocked(progressionState, world.id);
      const dangerous = isWorldDangerous(world.id);
      const isCurrent = playMode === 'story' && idx === currentLevelIdx;
      const isCleared = clearedLevelIds.has(lvl.id) || getWorldProgressionStatus(progressionState, world.id) === 'completed';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = !unlocked;
      btn.className = `drawer-world-btn${isCurrent ? ' active' : ''}${!unlocked ? ' is-locked' : ''}${dangerous && unlocked ? ' is-danger' : ''}`;
      btn.innerHTML = `<span><strong>W${world.id}</strong> · ${world.name}</span><span class="drawer-world-status">${!unlocked ? 'Locked' : isCurrent ? 'Playing' : isCleared ? 'Cleared' : dangerous ? 'Danger · Go' : 'Go'}</span>`;
      btn.addEventListener('click', (e) => {
        if (!unlocked) return;
        e.currentTarget.blur();
        toggleSettingsDrawer(false);
        startNewGame(idx);
      });
      elDrawerWorldsList.appendChild(btn);
    });
  }

  function renderStudioPreview() {
    if (!elStudioPreviewCanvas) return;
    const draft = buildCustomSkinConfig({
      character: studioTargetChar,
      name: elStudioSkinName?.value || 'Custom Look',
      body: elStudioBodyColor?.value || '#5E85E6',
      accent: elStudioAccentColor?.value || '#FDE047',
      pattern: elStudioPattern?.value || 'solid',
      headgear: elStudioHeadgear?.value || 'none',
      aura: elStudioAura?.value || 'none',
      id: `__preview-${studioTargetChar}`,
    });
    registerSkin(draft);
    renderSkinPreview(elStudioPreviewCanvas, studioTargetChar, draft.id, elapsedTime);
  }

  async function applyStudioFile(file) {
    if (!file) return;
    if (elStudioScanStatus) elStudioScanStatus.textContent = 'Scanning 2D art palette...';
    try {
      const analyzed = await analyzeImageFileToSkin(file, {
        character: studioTargetChar,
        name: elStudioSkinName?.value || `${studioTargetChar === 'madjid' ? 'Madjid' : 'Nadine'} Scan`,
      });
      if (elStudioBodyColor && analyzed.palette?.body) elStudioBodyColor.value = analyzed.palette.body;
      if (elStudioAccentColor && analyzed.accent) elStudioAccentColor.value = analyzed.accent;
      if (elStudioPattern && analyzed.pattern) elStudioPattern.value = analyzed.pattern;
      if (elStudioSkinName && analyzed.name) elStudioSkinName.value = analyzed.name;
      if (elStudioScanStatus) {
        elStudioScanStatus.textContent = `Extracted ${analyzed.palette.body} & ${analyzed.pattern} pattern!`;
      }
      renderStudioPreview();
    } catch {
      if (elStudioScanStatus) {
        elStudioScanStatus.textContent = 'Could not read image; try another PNG/JPG.';
      }
    }
  }

  function saveStudioSkin() {
    audio.unlock();
    audio.playKeyPickup();
    const built = buildCustomSkinConfig({
      character: studioTargetChar,
      name: elStudioSkinName?.value || 'Custom Look',
      body: elStudioBodyColor?.value || '#5E85E6',
      accent: elStudioAccentColor?.value || '#FDE047',
      pattern: elStudioPattern?.value || 'solid',
      headgear: elStudioHeadgear?.value || 'none',
      aura: elStudioAura?.value || 'none',
    });
    registerSkin(built);
    saveCustomSkinToStorage(built);
    selectedSkins[studioTargetChar] = built.id;
    savePreferences();
    if (coopSession.active) {
      coopClient.sendCustomSkinSave(built);
      if (studioTargetChar === coopSession.localCharId) {
        coopClient.sendSkinUpdate(built.id);
      }
    }
    syncHudStatic();
    renderSkinGrid();
    renderStudioPreview();
    if (elStudioScanStatus) {
      elStudioScanStatus.textContent = `Equipped "${built.name}" on ${studioTargetChar === 'madjid' ? 'Madjid' : 'Nadine'}!`;
    }
  }

  function switchDrawerTab(tabId = 'room') {
    document.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
      const active = btn.dataset.drawerTab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-drawer-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.drawerPanel !== tabId);
    });
    if (tabId === 'worlds') renderDrawerWorldsList();
    if (tabId === 'studio') renderStudioPreview();
  }

  function toggleSettingsDrawer(forceOpen = null) {
    if (!elSettingsDrawer) return;
    const currentlyOpen = !elSettingsDrawer.classList.contains('hidden');
    const nextOpen = forceOpen === null ? !currentlyOpen : Boolean(forceOpen);
    elSettingsDrawer.classList.toggle('hidden', !nextOpen);
    elHudBtnSettings?.setAttribute('aria-expanded', String(nextOpen));
    if (nextOpen) {
      toggleDancePopover(false);
      renderDrawerWorldsList();
      renderStudioPreview();
    }
  }

  function isBossEngaged(state, boss) {
    if (!boss || !boss.active || boss.defeated) return false;
    if (boss.isOpenWorld) return true;
    const m = state?.actors?.madjid;
    const n = state?.actors?.nadine;
    const minTriggerX = (boss.minX ?? boss.x - 280) - 200;
    return Boolean((m && m.x >= minTriggerX) || (n && n.x >= minTriggerX));
  }

  function syncBossBarHud() {
    if (!elHudBossBar) return;
    const visible = gameState === 'playing' && isBossEngaged(levelState, bossState);
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

  let selectedDanceStyleId = DANCES[0]?.id || 'waltz';

  function startDanceByStyle(styleId, { sendInvite = false } = {}) {
    const dance = DANCES.find((d) => d.id === styleId) || DANCES[0];
    if (!dance) return false;
    selectedDanceStyleId = dance.id;
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
        if (sendInvite || (elDanceInviteChk && elDanceInviteChk.checked)) {
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
    return Boolean(started);
  }

  function triggerOneTapDance() {
    if (gameState !== 'playing' || activeSubModal) return;
    audio.unlock();
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    if (mechState.dances[myChar]) {
      stopDance(mechState, levelState, myChar);
      if (coopSession.active) {
        coopClient.sendDanceSync({ character: myChar, styleId: selectedDanceStyleId, active: false });
      }
      return;
    }
    startDanceByStyle(selectedDanceStyleId, { sendInvite: coopSession.active });
    toggleDancePopover(false);
  }

  function renderDanceMenu() {
    if (!elDanceGrid) return;
    elDanceGrid.innerHTML = '';
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const activeStyle = mechState.dances[myChar]?.style || selectedDanceStyleId;

    DANCES.forEach((dance) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dance-choice-btn${activeStyle === dance.id ? ' active' : ''}`;
      btn.dataset.danceStyle = dance.id;
      btn.innerHTML = `<span class="dance-item-icon" aria-hidden="true">${dance.icon}</span><span>${dance.name}</span>`;
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        audio.unlock();
        startDanceByStyle(dance.id, { sendInvite: Boolean(elDanceInviteChk && elDanceInviteChk.checked) });
        toggleDancePopover(false);
      });
      elDanceGrid.appendChild(btn);
    });
  }

  function toggleDancePopover(forceOpen = null) {
    if (!elDancePopover) return;
    const currentlyOpen = !elDancePopover.classList.contains('hidden');
    const nextOpen = forceOpen === null ? !currentlyOpen : Boolean(forceOpen);
    elDancePopover.classList.toggle('hidden', !nextOpen);
    document.getElementById('hud-btn-dance-styles')?.setAttribute('aria-expanded', String(nextOpen));
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
    if (gameState !== 'playing' || activeSubModal || levelState.gameOver) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const myActor = levelState.actors[myChar];

    // 1. Cooperative Edge Rescue if partner is falling nearby
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

    // 2. In-world Canvas2D Puzzle Node interaction (rotating pillars, levers, conduits)
    if (myActor && !myActor.carryingBlockId && !(mechState.carrying && mechState.carrying.carrierId === myChar)) {
      const puzRes = interactWithNearbyPuzzle(levelState, myActor, { allowHand: false }, simCallbacks);
      if (puzRes.ok) {
        audio.playSwitchPress();
        if (coopSession.active && puzRes.puzzle) {
          coopClient.sendPuzzleSync({
            puzzleId: puzRes.puzzle.id,
            solved: puzRes.puzzle.solved,
            nodes: puzRes.puzzle.nodes.map((n) => ({
              id: n.id,
              glyphIndex: n.glyphIndex,
              activated: n.activated,
            })),
            enteredOrder: puzRes.puzzle.enteredOrder,
          });
        }
        broadcastStorySnapshot('puzzle');
        return;
      }
      if (puzRes.reason === 'NEEDS_TOOL' && myActor) {
        audio.playSwitchRelease();
        spawnWorldToast(myActor.x + myActor.w * 0.5, myActor.y - 18, 'Need Energy Wand or Key!', '#FCA5A5');
        return;
      }
      if (puzRes.reason === 'WRONG_ORDER' && myActor) {
        audio.playSwitchRelease();
        spawnWorldToast(myActor.x + myActor.w * 0.5, myActor.y - 18, 'Wrong Order — Reset!', '#FCA5A5');
        return;
      }
    }

    // 3. Heavy Carry Block pickup / drop (strict mutex with partner carry)
    if (myActor && !(mechState.carrying && mechState.carrying.carrierId === myChar)) {
      const blockRes = tryCarryBlockInteraction(levelState, mechState, myChar, simCallbacks);
      if (blockRes.ok && blockRes.block) {
        if (blockRes.action === 'pickup') {
          audio.playCarryPickup();
          spawnWorldToast(myActor.x + myActor.w * 0.5, myActor.y - 24, `Carrying ${blockRes.block.label || 'Relic'}!`, '#FDE68A');
        } else {
          audio.playCarryDrop();
        }
        if (coopSession.active) {
          coopClient.sendCarrySync({
            kind: blockRes.action === 'pickup' ? 'block_pickup' : 'block_drop',
            carrierId: myChar,
            blockId: blockRes.block.id,
            x: Math.round(blockRes.block.x),
            y: Math.round(blockRes.block.y),
            placedPedestalId: blockRes.block.placedPedestalId || null,
          });
        }
        broadcastStorySnapshot('blocks');
        return;
      }
      if (blockRes.reason === 'WALL_BLOCKED') {
        audio.playSwitchRelease();
        spawnWorldToast(myActor.x + myActor.w * 0.5, myActor.y - 20, 'Room needed to drop block!', '#FCA5A5');
        return;
      }
    }

    // 4. Otherwise pickup or gently toss carried partner
    if (myActor && myActor.carryingBlockId) {
      spawnWorldToast(myActor.x + myActor.w * 0.5, myActor.y - 20, 'Drop Relic First!', '#FDE68A');
      return;
    }

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

  function handleWeaponCycle() {
    if (gameState !== 'playing' || activeSubModal) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    if (!actor || !actor.weapons || actor.weapons.length < 2) return;
    const nextId = cycleActorWeapon(actor);
    if (!nextId) return;
    const def = getWeaponDef(nextId);
    audio.playUiClick();
    spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 16, def.name, def.secondary);
    syncHudStatic();
    lastCoopStateSendMs = 0;
  }

  function handleWeaponUse() {
    if (gameState !== 'playing' || activeSubModal || levelState.gameOver) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    if (!actor) return;

    const res = triggerWeaponAction(levelState, actor, simCallbacks);

    if (res.hits.some((h) => h.kind === 'switch')) {
      audio.playSwitchPress();
      broadcastStorySnapshot('switch');
    } else if (res.pickedUp || res.hits.some((h) => h.kind === 'barrier' || h.kind === 'monster')) {
      broadcastStorySnapshot('weapon');
    }

    syncHudStatic();
    lastCoopStateSendMs = 0;
  }

  function triggerLocalDash() {
    if (gameState !== 'playing' || activeSubModal || levelState.gameOver) return;
    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const actor = levelState.actors[myChar];
    if (!actor) return;

    const dirX =
      keysHeld.has('ArrowLeft') || keysHeld.has('KeyA') || touchHeld.left
        ? -1
        : keysHeld.has('ArrowRight') || keysHeld.has('KeyD') || touchHeld.right
          ? 1
          : actor.facing || 1;
    const res = triggerManualSoulDash(levelState, actor, dirX);
    if (res.ok) {
      audio.playJump(myChar);
      particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.5, 12, {
        colors: ['#BAE6FD', '#7DD3FC', '#FDE68A'],
        minSpeed: 40,
        maxSpeed: 130,
        size: 4,
        shape: 'spark',
        gravity: 20,
      });
      spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, 'Soul Dash!', '#BAE6FD');
      lastCoopStateSendMs = 0;
    } else if (res.reason === 'COOLDOWN') {
      const rem = Math.max(0.1, actor.dashCooldown || 0);
      spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, `Dash ${rem.toFixed(1)}s`, '#94A3B8');
    }
    updateDashCooldownHud();
  }

  function getActiveSector(state) {
    if (!state || !Array.isArray(state.sectors) || state.sectors.length === 0) return null;
    const m = state.actors?.madjid;
    const n = state.actors?.nadine;
    const trackedX = coopSession.active && coopSession.localCharId
      ? state.actors?.[coopSession.localCharId]?.x ?? 0
      : Math.max(m?.x ?? 0, n?.x ?? 0);
    let active = state.sectors[0];
    for (let i = 0; i < state.sectors.length; i++) {
      if (trackedX >= state.sectors[i].startX) {
        active = state.sectors[i];
      }
    }
    return active;
  }

  function syncHudStatic() {
    applyCoopUiLock();
    const activeSkin = getSkin(activeCharId, selectedSkins[activeCharId]);

    if (playMode === 'openworld') {
      lastSectorCode = 'OW';
      elHudChapterNum.textContent = 'Open World';
      elHudChapterTitle.textContent = 'Cozy Open-World Meadow';
      elPauseChapterInfo.textContent = '2D Open-World Sandbox · Build & Craft Together';
      if (elHudKeyReadout) elHudKeyReadout.classList.add('hidden');
      document.body.dataset.chapter = 'openworld';
      document.body.dataset.world = '0';
      document.body.dataset.keys = 'openworld';
    } else {
      const level = LEVELS[currentLevelIdx];
      const sector = getActiveSector(levelState);
      lastSectorCode = sector ? sector.code : '';
      elHudChapterNum.textContent = sector
        ? `W${level.worldId} · ${sector.code}`
        : level.shortCode || `W${level.worldId}-${level.stageInWorld}`;
      elHudChapterTitle.textContent = sector ? sector.name : level.title;
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

    const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
    const myActor = levelState.actors[myChar];
    const eqId = myActor?.equippedWeapon || null;
    const eqCount = myActor?.weapons?.length || 0;
    const nearbyWeapon = Boolean(
      myActor &&
        (levelState.weaponPickups || []).some(
          (p) => !p.collected && Math.hypot(myActor.x + myActor.w * 0.5 - p.x, myActor.y + myActor.h * 0.5 - p.y) <= 52
        )
    );
    if (elHudBtnWeapon && elHudWeaponLabel) {
      elHudWeaponLabel.textContent = eqId ? getWeaponDef(eqId).shortName : nearbyWeapon ? 'Grab' : 'Hands';
      elHudBtnWeapon.classList.toggle('is-ready', Boolean(eqId || nearbyWeapon));
    }
    if (elHudBtnWeaponNext) {
      elHudBtnWeaponNext.classList.toggle('hidden', eqCount < 2);
    }
    if (elTouchWeapon) {
      const span = elTouchWeapon.querySelector('span');
      if (span) span.textContent = eqId ? getWeaponDef(eqId).shortName : nearbyWeapon ? 'Grab' : 'Use';
      elTouchWeapon.classList.toggle('is-ready', Boolean(eqId || nearbyWeapon));
    }
    if (elTouchWeaponCycle) {
      elTouchWeaponCycle.classList.toggle('hidden', eqCount < 2);
    }

    const isSpaceSwim = levelState.physicsMode === 'space_swim';
    const isSwimMode = levelState.physicsMode === 'underwater' || isSpaceSwim;
    const onOrNearLadder = Boolean(myActor && (myActor.onLadder || findOverlappingLadder(levelState, myActor)));
    elTouchDown?.classList.toggle('hidden', !(isSwimMode || onOrNearLadder));
    if (elTouchDown) {
      const dSpan = elTouchDown.querySelector('span');
      if (dSpan) dSpan.textContent = onOrNearLadder && !isSwimMode ? 'Climb' : 'Dive';
    }
    if (elTouchJump) {
      const jSpan = elTouchJump.querySelector('span');
      if (jSpan) {
        jSpan.textContent = isSpaceSwim
          ? 'Float'
          : levelState.physicsMode === 'underwater'
            ? 'Swim'
            : onOrNearLadder
              ? 'Climb'
              : 'Jump';
      }
    }

    document.body.dataset.activeCharacter = activeCharId;
    syncHealthHud();
    updateDashCooldownHud();
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

  function clearDedicationTimer() {
    if (dedicationAutoTimer) {
      window.clearTimeout(dedicationAutoTimer);
      dedicationAutoTimer = null;
    }
  }

  function persistSoloCheckpointSnapshot(labelOverride = null) {
    if (playMode !== 'story' || coopSession.active || !levelState || levelState.completed || isApplyingRemoteUpdate) {
      return;
    }
    const level = LEVELS[currentLevelIdx];
    const world = level ? getWorldById(level.worldId) : null;
    const sector = getActiveSector(levelState);
    const litCount = (levelState.checkpoints || []).filter((c) => c.activated).length;
    const label =
      labelOverride ||
      (levelState.activeCheckpoint
        ? litCount > 0
          ? `Checkpoint ${litCount}`
          : 'Checkpoint'
        : 'Start of World');
    const snap = captureCheckpointSnapshot(levelState, {
      bossState,
      levelIndex: currentLevelIdx,
      worldName: level?.worldName || world?.name || '',
      stageTitle: level?.title || '',
      sectorCode: sector?.code || '',
      sectorName: sector?.name || '',
      checkpointNumber: litCount,
      checkpointLabel: label,
    });
    levelState.checkpointSnapshot = snap;
    saveSoloCheckpointSnapshot(window.localStorage, snap);
  }

  function persistCurrentCoopRoom(room) {
    if (!room || !room.code) return;
    const idx = typeof room.levelIndex === 'number' ? room.levelIndex : currentLevelIdx;
    const lvl = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, idx))];
    saveLastCoopRoom(window.localStorage, {
      code: room.code,
      name: room.name || '',
      mode: room.mode === 'openworld' ? 'openworld' : 'story',
      levelIndex: idx,
      worldId: lvl?.worldId || 1,
      worldName: lvl?.worldName || 'Co-op Journey',
    });
  }

  function getSavedResumeDescriptor() {
    const solo = loadSoloCheckpointSnapshot(window.localStorage);
    const coop = loadLastCoopRoom(window.localStorage);
    let primary = null;
    if (solo && coop) {
      primary = (solo.savedAt || 0) >= (coop.savedAt || 0) ? 'solo' : 'coop';
    } else if (solo) {
      primary = 'solo';
    } else if (coop) {
      primary = 'coop';
    }
    return { solo, coop, primary };
  }

  function renderLobbyResumePrompt() {
    if (!elLobbyResumePrompt) return;
    const desc = getSavedResumeDescriptor();
    if (resumePromptDismissed || !desc.primary) {
      elLobbyResumePrompt.classList.add('hidden');
      return;
    }

    elLobbyResumePrompt.classList.remove('hidden');
    if (desc.primary === 'solo' && desc.solo) {
      const s = desc.solo;
      if (elLobbyResumeKicker) elLobbyResumeKicker.textContent = 'Saved Solo Progress Ready';
      if (elLobbyResumeSummary) {
        const worldText = `World ${s.worldId}${s.worldName ? `: ${s.worldName}` : ''}`;
        const cpText = s.checkpointLabel || 'Start of World';
        const keyText = s.keysRequired ? ` · Keys ${s.keysCollected || 0}/${s.keysRequired}` : '';
        elLobbyResumeSummary.textContent = `${worldText} · ${cpText}${keyText}`;
      }
      if (elBtnResumeSaved) {
        elBtnResumeSaved.textContent = `Continue W${s.worldId} (${s.checkpointLabel || 'Saved'})`;
        elBtnResumeSaved.dataset.resumeKind = 'solo';
      }
      if (elBtnResumeAlt) {
        if (desc.coop) {
          elBtnResumeAlt.classList.remove('hidden');
          elBtnResumeAlt.textContent = `Resume Co-op (${desc.coop.code})`;
          elBtnResumeAlt.dataset.resumeKind = 'coop';
        } else {
          elBtnResumeAlt.classList.add('hidden');
        }
      }
    } else if (desc.coop) {
      const c = desc.coop;
      if (elLobbyResumeKicker) elLobbyResumeKicker.textContent = 'Last Online Co-op Room Ready';
      if (elLobbyResumeSummary) {
        const roomTitle = c.name ? ` ("${c.name}")` : '';
        const modeText = c.mode === 'openworld' ? 'Open World' : `World ${c.worldId}`;
        elLobbyResumeSummary.textContent = `Room ${c.code}${roomTitle} · ${modeText}`;
      }
      if (elBtnResumeSaved) {
        elBtnResumeSaved.textContent = `Rejoin Room ${c.code}`;
        elBtnResumeSaved.dataset.resumeKind = 'coop';
      }
      if (elBtnResumeAlt) {
        if (desc.solo) {
          elBtnResumeAlt.classList.remove('hidden');
          elBtnResumeAlt.textContent = `Continue Solo W${desc.solo.worldId}`;
          elBtnResumeAlt.dataset.resumeKind = 'solo';
        } else {
          elBtnResumeAlt.classList.add('hidden');
        }
      }
    }
  }

  function resumeSavedSoloSnapshot(snap) {
    if (!snap || typeof snap.levelIndex !== 'number') return false;
    resumePromptDismissed = false;
    closeAllSubModals();
    elVictoryModal.classList.add('hidden');
    elChapterClearModal.classList.add('hidden');
    if (coopSession.active) {
      coopClient.leaveRoom();
    }
    const targetIdx = Math.max(0, Math.min(LEVELS.length - 1, snap.levelIndex));
    loadChapter(targetIdx, { instantBg: false, showStory: true });
    restoreCheckpointSnapshot(levelState, snap, { bossState });
    ['madjid', 'nadine'].forEach((cid) => {
      const actor = levelState.actors[cid];
      if (!actor) return;
      initActorHealth(actor);
      const pos = levelState.activeCheckpoint?.[cid] || levelState.spawns?.[cid];
      if (pos) {
        actor.x = pos.x;
        actor.y = pos.y;
      }
      actor.vx = 0;
      actor.vy = 0;
      actor.hp = actor.maxHp;
      actor.hurtTimer = 0;
      actor.invulnTimer = 0.8;
      actor.mood = 'normal';
    });
    const sector = getActiveSector(levelState);
    levelState.checkpointSnapshot = captureCheckpointSnapshot(levelState, {
      bossState,
      levelIndex: currentLevelIdx,
      worldName: LEVELS[currentLevelIdx]?.worldName || '',
      stageTitle: LEVELS[currentLevelIdx]?.title || '',
      sectorCode: sector?.code || '',
      sectorName: sector?.name || '',
      checkpointLabel: snap.checkpointLabel || 'Saved Checkpoint',
      checkpointNumber: snap.checkpointNumber ?? 0,
    });
    hasInitializedCam = false;
    syncHudStatic();
    syncBossBarHud();
    syncHealthHud();
    setGameState('playing');
    const lead = levelState.actors.madjid;
    if (lead) {
      spawnWorldToast(lead.x + 20, lead.y - 24, `Resumed ${snap.checkpointLabel || 'Saved Stage'}!`, '#FDE68A');
    }
    return true;
  }

  function resumeSavedCoopRoom(coopInfo) {
    if (!coopInfo || !coopInfo.code) return false;
    resumePromptDismissed = false;
    pendingResumeRoomCode = coopInfo.code;
    if (coopClient.getStatus() === 'connected') {
      const code = pendingResumeRoomCode;
      pendingResumeRoomCode = null;
      coopClient.joinRoom(code, { skinId: selectedSkins.madjid });
    } else {
      coopClient.connect(elCoopServerUrl?.value || getDefaultWsUrl());
    }
    return true;
  }

  function setGameState(nextState) {
    gameState = nextState;
    document.body.dataset.state = nextState;
    if (nextState !== 'dedication') {
      clearDedicationTimer();
    }

    elDedicationScreen?.classList.toggle('hidden', nextState !== 'dedication');
    elTitleScreen.classList.toggle('hidden', nextState !== 'title');
    elHudLayer.classList.toggle('hidden', nextState === 'title' || nextState === 'dedication');
    elPauseModal.classList.toggle('hidden', nextState !== 'paused');
    audio.setPaused(nextState === 'paused');

    if (nextState === 'title') {
      renderLobbyWorldMap();
      renderLobbyResumePrompt();
      syncMuteUI();
    }
    syncStoryWhisperHud();

    if (nextState === 'playing') {
      clearInputs();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement !== elChatInput) {
        document.activeElement.blur();
      }
    }
  }

  function loadOpenWorld({ instantBg = false, showStory = true, syncedState = null } = {}) {
    clearCoopAdvanceTimer();
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
    weddingCeremony = null;
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
    toggleSettingsDrawer(false);
    elTryAgainModal?.classList.add('hidden');
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
    audio.setWorldMusicContext({ playMode: 'openworld', worldId: 0, gameState });

    if (showStory) {
      showCaption(owDef.caption, 8500);
    }
  }

  function loadChapter(index, { instantBg = false, showStory = true } = {}) {
    clearCoopAdvanceTimer();
    playMode = 'story';
    currentLevelIdx = Math.max(0, Math.min(LEVELS.length - 1, index));
    const level = LEVELS[currentLevelIdx];
    const world = getWorldById(level.worldId);
    selectedWorldTab = world.id;
    levelState = createInitialLevelState(level);
    storyState = createStorylineState(world.id);
    activeCharId = coopSession.active && coopSession.localCharId ? coopSession.localCharId : 'madjid';
    remoteActorTarget.active = false;

    mechState = createMechanicsState();
    bossState = createBossForLevel(level);
    weddingCeremony = null;
    levelState.bossDefeated = !bossState || Boolean(bossState.defeated);
    levelState.portalUnlocked = computePortalUnlocked(levelState);
    levelState.checkpointSnapshot = captureCheckpointSnapshot(levelState, {
      bossState,
      levelIndex: currentLevelIdx,
      worldName: level.worldName,
      stageTitle: level.title,
      checkpointLabel: 'Start of World',
      checkpointNumber: 0,
    });
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
    toggleSettingsDrawer(false);
    elTryAgainModal?.classList.add('hidden');
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
    autoRespawnTimer = 0;
    cameraShakeTrauma = 0;
    elHudEscapeBanner?.classList.add('hidden');
    clearInputs();
    syncHudStatic();
    syncBossBarHud();
    syncStoryWhisperHud();
    elHudTimer.textContent = '00:00';
    audio.setWorldMusicContext({ playMode: 'story', worldId: world.id, gameState });

    if (showStory) {
      showCaption(`${level.worldName} (${level.code}): ${level.caption}`, 8200);
      fireStoryBeat('world_intro');
    }
  }

  function startNewGame(startChapterIdx = 0, { silent = false, fromRemote = false } = {}) {
    clearCoopAdvanceTimer();
    resumePromptDismissed = false;
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
    if (!silent && !fromRemote && !coopSession.active) {
      persistSoloCheckpointSnapshot('Start of World');
    }
    if (coopSession.active && !fromRemote) {
      coopClient.setRoomMode({ mode: 'story', levelIndex: currentLevelIdx, reset: true });
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
    elChaptersProgressLabel.textContent = `${WORLDS.length} Seamless Worlds · ${LEVELS.length} Guardians · ${clearedLevelIds.size}/${LEVELS.length} Cleared`;

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

    const activeWorld = getWorldById(selectedWorldTab);
    const activeWorldUnlocked = isWorldUnlocked(progressionState, activeWorld.id);
    const activeWorldDangerous = isWorldDangerous(activeWorld.id);
    const worldThemeLabel = TIME_PRESETS[activeWorld.theme]?.label || activeWorld.theme;
    elWorldBannerKicker.textContent = `World ${activeWorld.id} of ${WORLDS.length}${!activeWorldUnlocked ? ' · Locked' : activeWorldDangerous ? ' · Dangerous Territory' : ''}`;
    elWorldBannerName.textContent = activeWorld.name;
    elWorldBannerMeta.textContent = `${activeWorld.subtitle} · ${worldThemeLabel}`;

    elChaptersList.innerHTML = '';
    const worldLevels = getLevelsForWorld(selectedWorldTab);
    worldLevels.forEach((lvl) => {
      const globalIdx = LEVELS.findIndex((item) => item.id === lvl.id);
      const unlocked = isWorldUnlocked(progressionState, lvl.worldId);
      const dangerous = isWorldDangerous(lvl.worldId);
      const isCurrent = globalIdx === currentLevelIdx && gameState !== 'title' && playMode === 'story';
      const isCleared = clearedLevelIds.has(lvl.id) || getWorldProgressionStatus(progressionState, lvl.worldId) === 'completed';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = !unlocked;
      btn.className = `chapter-row-btn${isCurrent ? ' is-current' : ''}${!unlocked ? ' is-locked' : ''}`;

      const main = document.createElement('div');
      main.className = 'chapter-row-main';

      const title = document.createElement('span');
      title.className = 'chapter-row-title';
      title.textContent = `${lvl.code || `W${lvl.worldId}`} · ${lvl.title}`;

      const themeLabel = TIME_PRESETS[lvl.theme]?.label || lvl.theme;
      const cpCount = lvl.checkpoints?.length || 0;
      const puzCount = lvl.puzzles?.length || 0;
      const meta = document.createElement('span');
      meta.className = `chapter-row-meta${dangerous ? ' is-danger' : ''}`;
      meta.textContent = `${themeLabel} · ${lvl.exit.keysRequired} Key${lvl.exit.keysRequired > 1 ? 's' : ''}${lvl.boss ? ` · Boss: ${lvl.boss.name}` : ''}${puzCount ? ` · ${puzCount} Puzzle${puzCount > 1 ? 's' : ''}` : ''}${cpCount > 0 ? ` · ${cpCount} Lanterns` : ''}${dangerous ? ' · Dangerous Territory' : ''}`;

      main.appendChild(title);
      main.appendChild(meta);

      const status = document.createElement('span');
      status.className = `chapter-row-status${isCleared ? ' cleared' : ''}`;
      status.textContent = !unlocked ? 'Locked' : isCurrent ? 'Current' : isCleared ? 'Cleared' : 'Play';

      btn.appendChild(main);
      btn.appendChild(status);

      btn.addEventListener('click', () => {
        if (!unlocked) return;
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
    const openRoom = findFirstOpenRoom(coopDirectoryRooms);
    if (elBtnCoopQuickJoin) {
      elBtnCoopQuickJoin.title = openRoom
        ? `Quick Join "${openRoom.name}" (${openRoom.code})`
        : 'Search and join the first available open room';
    }
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

  function broadcastStorySnapshot(eventName = 'update', { replace = false } = {}) {
    if (!coopSession.active || playMode !== 'story' || isApplyingRemoteUpdate) return;
    const switchesMap = {};
    levelState.switches.forEach((s) => {
      switchesMap[s.id] = { toggled: Boolean(s.toggled), pressed: Boolean(s.pressed) };
    });
    const gatesMap = {};
    levelState.gates.forEach((g) => {
      gatesMap[g.id] = Boolean(g.latchedOpen);
    });
    const placedBlocksMap = {};
    (levelState.carryBlocks || []).forEach((b) => {
      placedBlocksMap[b.id] = {
        x: Math.round(b.x),
        y: Math.round(b.y),
        placedPedestalId: b.placedPedestalId || null,
      };
    });
    const puzzleProgressMap = {};
    (levelState.puzzles || []).forEach((p) => {
      puzzleProgressMap[p.id] = {
        solved: Boolean(p.solved),
        enteredOrder: Array.isArray(p.enteredOrder) ? p.enteredOrder.slice() : [],
        nodes: (p.nodes || []).map((n) => ({
          id: n.id,
          glyphIndex: n.glyphIndex,
          activated: Boolean(n.activated),
        })),
      };
    });
    const defeatedBosses = bossState?.defeated ? [bossState.id || `boss_w${LEVELS[currentLevelIdx]?.worldId || 1}`] : [];
    const defeatedMonsters = (levelState.monsters || [])
      .filter((m) => m.defeated || m.koTimer > 0)
      .map((m) => m.id);

    coopClient.sendStorySync({
      event: eventName,
      replace: Boolean(replace),
      levelIndex: currentLevelIdx,
      switches: switchesMap,
      gates: gatesMap,
      collectedKeys: levelState.keys.filter((k) => k.collected).map((k) => k.id),
      collectedWeapons: (levelState.weaponPickups || []).filter((w) => w.collected).map((w) => w.id),
      brokenBarriers: (levelState.fragileBarriers || []).filter((b) => b.broken).map((b) => b.id),
      defeatedBosses,
      defeatedMonsters,
      placedBlocks: placedBlocksMap,
      puzzleProgress: puzzleProgressMap,
      activatedCheckpoints: levelState.checkpoints.filter((c) => c.activated).map((c) => c.id),
      activeCheckpointId: levelState.activeCheckpoint ? levelState.activeCheckpoint.id : null,
      completed: levelState.completed,
    });
  }

  function restoreStoryProgress(sp, { isLiveEvent = false } = {}) {
    if (!sp || playMode !== 'story') return;

    // Switches (supports both object map from server persistence & legacy array)
    if (Array.isArray(sp.switches)) {
      sp.switches.forEach((rs) => {
        const sw = levelState.switches.find((s) => s.id === rs.id);
        if (sw && sw.mode === 'toggle') {
          sw.toggled = Boolean(rs.toggled);
          sw.pressed = Boolean(rs.pressed ?? rs.toggled);
        }
      });
    } else if (sp.switches && typeof sp.switches === 'object') {
      Object.entries(sp.switches).forEach(([swId, rs]) => {
        const sw = levelState.switches.find((s) => s.id === swId);
        if (sw && sw.mode === 'toggle' && rs && typeof rs === 'object') {
          sw.toggled = Boolean(rs.toggled);
          sw.pressed = Boolean(rs.pressed ?? rs.toggled);
        }
      });
    }

    // Gates
    if (Array.isArray(sp.gates)) {
      sp.gates.forEach((rg) => {
        const g = levelState.gates.find((item) => item.id === rg.id);
        if (g && rg.latchedOpen) {
          g.latchedOpen = true;
          if (!isLiveEvent) g.openProgress = 1;
        }
      });
    } else if (sp.gates && typeof sp.gates === 'object') {
      Object.entries(sp.gates).forEach(([gateId, latched]) => {
        const g = levelState.gates.find((item) => item.id === gateId);
        if (g && latched) {
          g.latchedOpen = true;
          if (!isLiveEvent) g.openProgress = 1;
        }
      });
    }

    // Keys
    const collectedKeyIds = Array.isArray(sp.collectedKeys)
      ? sp.collectedKeys
      : Array.isArray(sp.keys)
        ? sp.keys.filter((k) => k.collected).map((k) => k.id)
        : [];
    if (collectedKeyIds.length > 0) {
      let pickedAny = false;
      collectedKeyIds.forEach((kid) => {
        const key = levelState.keys.find((item) => item.id === kid);
        if (key && !key.collected) {
          key.collected = true;
          levelState.keysCollected += 1;
          pickedAny = true;
        }
      });
      if (pickedAny && isLiveEvent) audio.playKeyPickup();
    }

    // Weapons collected
    if (Array.isArray(sp.collectedWeapons)) {
      sp.collectedWeapons.forEach((wid) => {
        const wp = (levelState.weaponPickups || []).find((w) => w.id === wid);
        if (wp) wp.collected = true;
      });
    }

    // Fragile barriers shattered
    if (Array.isArray(sp.brokenBarriers)) {
      sp.brokenBarriers.forEach((bid) => {
        const fb = (levelState.fragileBarriers || []).find((b) => b.id === bid);
        if (fb) {
          fb.broken = true;
          fb.hp = 0;
        }
      });
    }

    // Placed Relic Blocks & Pedestals
    if (sp.placedBlocks && typeof sp.placedBlocks === 'object') {
      Object.entries(sp.placedBlocks).forEach(([bid, entry]) => {
        const block = (levelState.carryBlocks || []).find((b) => b.id === bid);
        if (block && entry && typeof entry === 'object') {
          if (typeof entry.x === 'number') block.x = entry.x;
          if (typeof entry.y === 'number') block.y = entry.y;
          block.placedPedestalId = entry.placedPedestalId || null;
          block.carriedBy = null;
          if (block.placedPedestalId) {
            const ped = (levelState.carryPedestals || []).find((p) => p.id === block.placedPedestalId);
            if (ped) {
              ped.activated = true;
              ped.occupantBlockId = block.id;
            }
          }
        }
      });
    }

    // In-World Canvas2D Puzzles
    if (sp.puzzleProgress && typeof sp.puzzleProgress === 'object') {
      Object.entries(sp.puzzleProgress).forEach(([pid, pState]) => {
        const pz = (levelState.puzzles || []).find((p) => p.id === pid);
        if (!pz || !pState || typeof pState !== 'object') return;
        pz.solved = Boolean(pState.solved);
        if (Array.isArray(pState.enteredOrder)) pz.enteredOrder = pState.enteredOrder.slice();
        if (Array.isArray(pState.nodes)) {
          pState.nodes.forEach((rn) => {
            const node = (pz.nodes || []).find((n) => n.id === rn.id);
            if (node) {
              if (typeof rn.glyphIndex === 'number') node.glyphIndex = rn.glyphIndex;
              node.activated = Boolean(rn.activated);
            }
          });
        }
        if (pz.solved) {
          unlockPuzzleTarget(levelState, pz);
          if (!isLiveEvent && pz.targetGateId) {
            const g = levelState.gates.find((item) => item.id === pz.targetGateId);
            if (g) g.openProgress = 1;
          }
        }
      });
    }

    // Secondary Monsters defeated
    if (Array.isArray(sp.defeatedMonsters) && sp.defeatedMonsters.length > 0) {
      const deadSet = new Set(sp.defeatedMonsters);
      (levelState.monsters || []).forEach((m) => {
        if (deadSet.has(m.id)) {
          m.defeated = true;
          m.koTimer = 0;
          m.hp = 0;
        }
      });
    }

    // Defeated Bosses
    if (Array.isArray(sp.defeatedBosses) && bossState) {
      const bossKey = bossState.id || `boss_w${LEVELS[currentLevelIdx]?.worldId || 1}`;
      if (sp.defeatedBosses.includes(bossKey)) {
        bossState.defeated = true;
        bossState.active = false;
        bossState.hp = 0;
        levelState.bossDefeated = true;
      }
    }

    const wasUnlocked = levelState.portalUnlocked;
    levelState.portalUnlocked = computePortalUnlocked(levelState);
    if (!wasUnlocked && levelState.portalUnlocked && isLiveEvent) {
      audio.playDoorUnlock();
    }

    // Active checkpoint lantern & optional local partner warp on live checkpoint activation
    if (sp.activeCheckpointId) {
      const cp = levelState.checkpoints.find((c) => c.id === sp.activeCheckpointId);
      if (cp) {
        const wasLit = cp.activated;
        cp.activated = true;
        cp.pulse = 1;
        const respawnPayload = {
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
        levelState.activeCheckpoint = respawnPayload;
        if (!wasLit && isLiveEvent) {
          audio.playCheckpoint();
          const myChar = coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId;
          const localActor = levelState.actors[myChar];
          if (localActor && !localActor.phaseDash?.active && localActor.hurtTimer <= 0 && !localActor.devouredByGhost) {
            const distToCp = Math.hypot(localActor.x - cp.x, localActor.y - cp.y);
            if (distToCp > 260) {
              startPhaseDash(localActor, respawnPayload[myChar].x, respawnPayload[myChar].y, 'checkpoint', levelState.worldWidth);
              spawnWorldToast(localActor.x + localActor.w * 0.5, localActor.y - 16, 'Warping to Checkpoint!', '#BAE6FD');
            }
          }
        }
      }
    }

    if (!isLiveEvent || sp.event === 'checkpoint') {
      levelState.checkpointSnapshot = captureCheckpointSnapshot(levelState, {
        bossState,
        levelIndex: currentLevelIdx,
        worldName: LEVELS[currentLevelIdx]?.worldName || '',
        stageTitle: LEVELS[currentLevelIdx]?.title || '',
      });
    }
    syncBossBarHud();
    syncHudStatic();
  }

  function restoreSavedPlayerStates(room) {
    if (!room || !room.playerStates) return;
    if (room.customSkins && typeof room.customSkins === 'object') {
      Object.values(room.customSkins).forEach((skin) => {
        if (skin && skin.id) registerSkin(skin);
      });
    }
    ['madjid', 'nadine'].forEach((cid) => {
      const ps = room.playerStates[cid];
      const actor = levelState.actors[cid];
      if (!ps || !actor) return;
      if (typeof ps.x === 'number' && Number.isFinite(ps.x) && typeof ps.y === 'number' && Number.isFinite(ps.y)) {
        actor.x = clamp(ps.x, 4, Math.max(8, levelState.worldWidth - actor.w - 4));
        actor.y = clamp(ps.y, 8, Math.max(8, levelState.worldHeight - actor.h - 4));
        actor.vx = 0;
        actor.vy = 0;
      }
      if (ps.facing === -1 || ps.facing === 1) {
        actor.facing = ps.facing;
      }
      if (typeof ps.hp === 'number') {
        actor.hp = Math.max(0, Math.min(actor.maxHp || 100, Math.round(ps.hp)));
      }
      if (Array.isArray(ps.weapons)) {
        ps.weapons.forEach((wid) => giveActorWeapon(actor, wid, false));
        if (ps.equippedWeapon && actor.weapons.includes(ps.equippedWeapon)) {
          actor.equippedWeapon = ps.equippedWeapon;
        }
      }
    });
    syncHudStatic();
  }

  function applyRemoteStorySync(payload) {
    if (!payload || playMode !== 'story') return;
    isApplyingRemoteUpdate = true;
    try {
      if (payload.event === 'story_beat' && payload.eventType) {
        fireStoryBeat(payload.eventType, { fromRemote: true });
        return;
      }
      if (payload.event === 'time_of_day' && (payload.timeOfDayMode === 'day' || payload.timeOfDayMode === 'night')) {
        applyTimeOfDayMode(payload.timeOfDayMode, { broadcast: false });
        return;
      }
      if (payload.event === 'restart' && Number.isInteger(payload.levelIndex)) {
        loadChapter(payload.levelIndex, { instantBg: false, showStory: false });
        return;
      }
      if (payload.event === 'checkpoint_rollback') {
        return;
      }
      if (Number.isInteger(payload.levelIndex) && payload.levelIndex !== currentLevelIdx) {
        startNewGame(payload.levelIndex, { silent: true, fromRemote: true });
      }
      restoreStoryProgress(payload, { isLiveEvent: true });
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
        if (pendingResumeRoomCode) {
          const code = pendingResumeRoomCode;
          pendingResumeRoomCode = null;
          setCoopFeedback(`Rejoining saved room ${code}...`, true);
          coopClient.joinRoom(code, { skinId: selectedSkins.madjid });
        } else if (pendingQuickJoin) {
          pendingQuickJoin = false;
          setCoopFeedback('Searching for first open game session...', true);
          coopClient.quickJoin({ skinId: selectedSkins[coopCreateCharChoice || 'nadine'] });
        }
      } else if (status === 'connecting') {
        elCoopConnStatus.classList.add('connecting');
        elCoopConnStatus.textContent = `Connecting to ${url}...`;
      } else {
        pendingQuickJoin = false;
        elCoopConnStatus.textContent = detail ? `Disconnected: ${detail}` : 'Disconnected';
        if (elHudPing) elHudPing.textContent = '-- ms';
      }
    },
    onPing(ms) {
      if (elHudPing) {
        elHudPing.textContent = `${ms} ms`;
        elHudPing.classList.toggle('is-good', ms < 90);
        elHudPing.classList.toggle('is-slow', ms >= 180);
      }
    },
    onRooms(rooms) {
      renderCoopRoomsList(rooms);
    },
    onRoomJoined(msg) {
      pendingQuickJoin = false;
      pendingResumeRoomCode = null;
      clearCoopAdvanceTimer();
      persistCurrentCoopRoom(msg.room);
      if (msg.room?.customSkins) {
        Object.values(msg.room.customSkins).forEach((s) => {
          if (s && s.id) registerSkin(s);
        });
      }
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
        if (msg.room.storyProgress) {
          restoreStoryProgress(msg.room.storyProgress, { isLiveEvent: false });
        }
      }
      restoreSavedPlayerStates(msg.room);
      setGameState('playing');
      syncHudStatic();
    },
    onRoomLeft() {
      clearCoopAdvanceTimer();
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
      renderLobbyResumePrompt();
      syncHudStatic();
      coopClient.listRooms('');
    },
    onRoomMode(room) {
      clearCoopAdvanceTimer();
      applyRoomSnapshot(room);
      persistCurrentCoopRoom(room);
      closeAllSubModals();
      activeSubModal = null;
      elChapterClearModal.classList.add('hidden');
      elVictoryModal.classList.add('hidden');
      if (room.mode === 'openworld') {
        loadOpenWorld({ instantBg: false, showStory: true, syncedState: room.openWorld });
      } else {
        loadChapter(room.levelIndex || 0, { instantBg: false, showStory: true });
        if (room.storyProgress) {
          restoreStoryProgress(room.storyProgress, { isLiveEvent: false });
        }
      }
      setGameState('playing');
      syncHudStatic();
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
      if (typeof state.hp === 'number') {
        const rActor = levelState.actors[charId];
        if (rActor) rActor.hp = Math.max(0, Math.min(rActor.maxHp || 100, Math.round(state.hp)));
      }
      remoteActorTarget.weapons = Array.isArray(state.weapons) ? state.weapons.slice(0, 6) : [];
      remoteActorTarget.equippedWeapon = state.equippedWeapon || null;
      remoteActorTarget.phaseDashActive = Boolean(state.phaseDashActive);
      remoteActorTarget.phaseRippleTimer = Number(state.phaseRippleTimer) || 0;
      remoteActorTarget.weaponSwing = state.weaponSwing && state.weaponSwing.weaponId ? state.weaponSwing : null;
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
    onCustomSkinSaved(charId, skin) {
      if (!skin || !skin.id) return;
      registerSkin(skin);
      if (charId === 'madjid' || charId === 'nadine') {
        selectedSkins[charId] = getSkin(charId, skin.id).id;
        syncHudStatic();
        renderSkinGrid();
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
    onError(code, message) {
      pendingQuickJoin = false;
      const wasResuming = Boolean(pendingResumeRoomCode);
      pendingResumeRoomCode = null;
      if (code === 'ROOM_NOT_FOUND') {
        clearLastCoopRoom(window.localStorage);
        renderLobbyResumePrompt();
        if (wasResuming && gameState === 'title') {
          openCoopModal();
        }
      }
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
        g.phase = 'phase_dash';
        g.outcome = 'slap';
        g.timer = 1.4;
        g.slapCalloutTimer = 1.25;
        g.slapCalloutX = msg.x || g.x;
        g.slapCalloutY = msg.y || g.y;
        audio.playGhostSlap();
        const stray = levelState.actors[g.strayId];
        const partner = levelState.actors[g.targetId];
        if (stray) {
          stray.mood = 'panic';
          if (partner) {
            const tx = clamp(partner.x - (partner.facing || 1) * 32, 8, levelState.worldWidth - stray.w - 8);
            startPhaseDash(stray, tx, partner.y, 'ghost', levelState.worldWidth);
          }
        }
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
      } else if ((msg.kind === 'block_pickup' || msg.kind === 'block_drop' || msg.kind === 'block_snap') && msg.blockId) {
        const block = (levelState.carryBlocks || []).find((b) => b.id === msg.blockId);
        const carrier = msg.carrierId ? levelState.actors[msg.carrierId] : null;
        if (block) {
          if (msg.kind === 'block_pickup') {
            block.carriedBy = msg.carrierId || null;
            block.placedPedestalId = null;
            if (carrier) carrier.carryingBlockId = block.id;
            audio.playCarryPickup();
          } else {
            block.carriedBy = null;
            if (carrier && carrier.carryingBlockId === block.id) carrier.carryingBlockId = null;
            if (typeof msg.x === 'number') block.x = msg.x;
            if (typeof msg.y === 'number') block.y = msg.y;
            block.placedPedestalId = msg.placedPedestalId || null;
            if (block.placedPedestalId) {
              const ped = (levelState.carryPedestals || []).find((p) => p.id === block.placedPedestalId);
              if (ped) {
                ped.activated = true;
                ped.occupantBlockId = block.id;
              }
            }
            audio.playCarryDrop();
          }
        }
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
          if (bossState.defeated) {
            levelState.bossDefeated = true;
            levelState.portalUnlocked = computePortalUnlocked(levelState);
          }
          if (bossState.hp < prevHp) {
            if (bossState.defeated) audio.playBossDefeat();
            else audio.playBossHit();
          }
          syncBossBarHud();
        }
      }
    },
    onHpRespawn(msg) {
      if (!msg || !coopSession.active) return;
      if (msg.kind === 'zero_hp') {
        levelState.gameOver = true;
        if (elTryAgainReason) {
          elTryAgainReason.textContent = 'A partner fell! Respawn together at your last checkpoint.';
        }
        elTryAgainModal?.classList.remove('hidden');
      } else if (msg.kind === 'respawn') {
        elTryAgainModal?.classList.add('hidden');
        if (levelState.escapeState && !levelState.escapeState.cleared) {
          levelState.escapeState.active = false;
          levelState.escapeState.wallX = levelState.escapeState.wallStartX;
          levelState.escapeState.timeRemaining = levelState.escapeState.timeLimitSec;
        }
        elHudEscapeBanner?.classList.add('hidden');
        triggerTeamRespawnAtCheckpoint(levelState, simCallbacks);
        syncHealthHud();
        syncHudStatic();
        syncBossBarHud();
      }
    },
    onPuzzleSync(msg) {
      if (!msg || !coopSession.active || !msg.puzzleId) return;
      const pz = (levelState.puzzles || []).find((p) => p.id === msg.puzzleId);
      if (!pz) return;
      pz.solved = Boolean(msg.solved);
      if (Array.isArray(msg.enteredOrder)) pz.enteredOrder = msg.enteredOrder.slice();
      if (Array.isArray(msg.nodes)) {
        msg.nodes.forEach((rn) => {
          const node = (pz.nodes || []).find((n) => n.id === rn.id);
          if (node) {
            if (typeof rn.glyphIndex === 'number') node.glyphIndex = rn.glyphIndex;
            node.activated = Boolean(rn.activated);
          }
        });
      }
      if (pz.solved) {
        unlockPuzzleTarget(levelState, pz);
        if (pz.targetGateId) {
          const g = levelState.gates.find((item) => item.id === pz.targetGateId);
          if (g) g.openProgress = 1;
        }
      }
    },
    onMonsterSync(msg) {
      if (!msg || !coopSession.active || !msg.monsterId) return;
      const m = (levelState.monsters || []).find((mon) => mon.id === msg.monsterId);
      if (!m) return;
      if (typeof msg.hp === 'number') m.hp = msg.hp;
      if (typeof msg.defeated === 'boolean') {
        m.defeated = msg.defeated;
        if (m.defeated) m.koTimer = 0;
      }
    },
    onBarrierSync(msg) {
      if (!msg || !coopSession.active || !msg.barrierId) return;
      const b = (levelState.fragileBarriers || []).find((item) => item.id === msg.barrierId);
      if (!b) return;
      if (typeof msg.hp === 'number') b.hp = msg.hp;
      if (typeof msg.broken === 'boolean') b.broken = msg.broken;
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

  const bossCallbacks = {
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
      if (actor) {
        spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 14, 'Team Up or Hammer Shield!', '#93C5FD');
      }
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
      syncBossBarHud();
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
      levelState.bossDefeated = true;
      levelState.portalUnlocked = computePortalUnlocked(levelState);
      syncBossBarHud();
      syncHudStatic();
      renderOpenWorldToolbar();
      fireStoryBeat('boss_down');
      if (coopSession.active) {
        coopClient.sendBossSync({ kind: 'state', boss: serializeBossState(b) });
      }
      broadcastStorySnapshot('boss');
    },
    onPortalUnlock(exit) {
      simCallbacks.onPortalUnlock(exit);
      syncHudStatic();
    },
    onDamage(info) {
      simCallbacks.onDamage(info);
    },
    onHeal(info) {
      simCallbacks.onHeal(info);
    },
    onCry(info) {
      simCallbacks.onCry(info);
    },
    onZeroHp(info) {
      simCallbacks.onZeroHp(info);
    },
  };

  // Simulation Callbacks (Weight-Scaled Audio + Zero-GC Particle Juice + Micro-Hitstop)
  const simCallbacks = {
    get mechState() {
      return mechState || null;
    },
    get ghostState() {
      return mechState?.ghost || null;
    },
    get bossState() {
      return bossState || null;
    },
    onCatDiscovered(cat) {
      audio.playCatMeow(false);
      if (cat) {
        particles.burst(cat.x + cat.w * 0.5, cat.y, 12, {
          colors: ['#FDE68A', '#F9A8D4', '#FFF8D6'],
          minSpeed: 30,
          maxSpeed: 95,
          size: 4.4,
          shape: 'heart',
          gravity: -16,
        });
        spawnWorldToast(cat.x + cat.w * 0.5, cat.y - 22, 'Mimi Joined Your Journey! ♥', '#FDE68A');
      }
      fireStoryBeat('cat_found');
    },
    onCatTrapAlert() {
      audio.playCatMeow(true);
      fireStoryBeat('trap_warning');
    },
    onCatHeart() {
      audio.playCatPurr();
    },
    onPickup(picked, actor) {
      const def = getWeaponDef(picked.weaponId);
      audio.playKeyPickup();
      particles.burst(picked.x, picked.y, 12, {
        colors: [def.primary, def.secondary, '#FFFFFF'],
        minSpeed: 40,
        maxSpeed: 135,
        size: 4.2,
        shape: 'spark',
        gravity: 60,
      });
      spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 18, `${def.name}!`, def.secondary);
      syncHudStatic();
      broadcastStorySnapshot('weapon');
    },
    onSwing(actor, def) {
      audio.playSwitchRelease();
      particles.burst(actor.x + actor.w * 0.5 + (actor.facing || 1) * 20, actor.y + actor.h * 0.45, 5, {
        colors: [def.primary, def.secondary],
        minSpeed: 30,
        maxSpeed: 90,
        size: 3.2,
        shape: 'spark',
        gravity: 30,
      });
    },
    onBarrierHit(b) {
      hitstopTimer = 0.035;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.28);
      audio.playSwitchPress();
      if (coopSession.active) {
        coopClient.sendBarrierSync({ barrierId: b.id, hp: b.hp, broken: Boolean(b.broken) });
      }
      if (b.broken) {
        spawnWorldToast(b.x + b.w * 0.5, b.y - 14, 'Barrier Shattered!', '#BAE6FD');
        broadcastStorySnapshot('weapon');
      }
    },
    onBarrierWrongTool(b, actor) {
      audio.playSwitchRelease();
      const target = actor || levelState.actors[activeCharId];
      if (target) {
        const toolLabel = b.requiredWeapon === 'crystal_hammer'
          ? 'Crystal Hammer'
          : b.requiredWeapon === 'energy_wand'
            ? 'Energy Wand'
            : 'Light Sword';
        spawnWorldToast(target.x + target.w * 0.5, target.y - 18, `Requires ${toolLabel}!`, '#FCA5A5');
      }
    },
    onBossWeaponHit(boss, actor, def) {
      damageBossWithWeapon(boss, actor, def, levelState, bossCallbacks);
    },
    onMonsterHit({ monster }) {
      hitstopTimer = 0.03;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.22);
      audio.playSwitchPress();
      if (coopSession.active && monster) {
        coopClient.sendMonsterSync({ monsterId: monster.id, hp: monster.hp, defeated: Boolean(monster.defeated) });
      }
    },
    onMonsterDefeat({ monster }) {
      hitstopTimer = 0.045;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.35);
      audio.playBossHit();
      if (monster) {
        particles.burst(monster.x + monster.w * 0.5, monster.y + monster.h * 0.5, 16, {
          colors: ['#6EE7B7', '#FDE047', '#FFFFFF'],
          minSpeed: 50,
          maxSpeed: 155,
          size: 4.5,
          shape: 'spark',
          gravity: 80,
        });
        spawnWorldToast(monster.x + monster.w * 0.5, monster.y - 18, '+35 HP Orb!', '#6EE7B7');
        if (coopSession.active) {
          coopClient.sendMonsterSync({ monsterId: monster.id, hp: 0, defeated: true });
        }
      }
      broadcastStorySnapshot('monster');
    },
    onEnemyHit(en) {
      hitstopTimer = 0.03;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.22);
      audio.playSwitchPress();
      spawnWorldToast(en.x + en.w * 0.5, en.y - 14, 'Stunned!', '#FDE68A');
    },
    onDamage({ actor }) {
      hitstopTimer = 0.04;
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.36);
      audio.playCry(actor?.id || 'madjid');
      syncHealthHud();
    },
    onHeal() {
      syncHealthHud();
    },
    onOrbPickup({ actor }) {
      audio.playKeyPickup();
      if (actor) {
        particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.4, 10, {
          colors: ['#6EE7B7', '#A7F3D0', '#FFFFFF'],
          minSpeed: 35,
          maxSpeed: 95,
          size: 4,
          shape: 'spark',
          gravity: -20,
        });
      }
      syncHealthHud();
    },
    onZeroHp({ actor, cause }) {
      cancelCarry(mechState, levelState);
      syncHealthHud();
      if (elTryAgainReason) {
        const who = actor?.id === 'nadine' ? 'Nadine' : 'Madjid';
        elTryAgainReason.textContent = `${who} reached 0 HP (${cause || 'Hazard'}). Respawning together at the last Checkpoint...`;
      }
      elTryAgainModal?.classList.remove('hidden');
      if (coopSession.active) {
        coopClient.sendHpRespawn({ kind: 'zero_hp', actorId: actor?.id || 'madjid', cause });
      }
    },
    onEscapeStart(esc) {
      audio.playGhostWarn();
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.45);
      if (esc) {
        spawnWorldToast(esc.triggerX, 460, esc.title || 'Escape Surge!', '#FCA5A5');
      }
    },
    onEscapeClear(esc) {
      audio.playDoorUnlock();
      elHudEscapeBanner?.classList.add('hidden');
      if (esc) {
        spawnWorldToast(esc.endX, 460, 'Escape Cleared Together! ♥', '#6EE7B7');
      }
      fireStoryBeat('escape_clear');
    },
    onEscapeFail(esc) {
      audio.playCry('madjid');
      cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.4);
      elHudEscapeBanner?.classList.add('hidden');
      resetCatToTeam(levelState.cat, levelState);
      syncHealthHud();
      syncHudStatic();
      syncBossBarHud();
      if (esc) {
        const dest = levelState.activeCheckpoint || levelState.spawns?.madjid;
        spawnWorldToast(dest?.x || esc.triggerX, 480, 'Surge Caught You — Respawned!', '#FCA5A5');
      }
      if (coopSession.active) {
        broadcastStorySnapshot('checkpoint_rollback', { replace: true });
        coopClient.sendHpRespawn({ kind: 'respawn' });
      }
    },
    onPuzzleStep({ node }) {
      audio.playSwitchPress();
      if (node) {
        particles.burst(node.x + node.w * 0.5, node.y - node.h * 0.5, 8, {
          colors: ['#7DD3FC', '#FDE68A', '#FFFFFF'],
          minSpeed: 35,
          maxSpeed: 95,
          size: 3.6,
          shape: 'spark',
          gravity: 40,
        });
      }
    },
    onPuzzleSolved({ puzzle }) {
      audio.playDoorUnlock();
      hitstopTimer = 0.04;
      if (puzzle) {
        spawnWorldToast(puzzle.tabletX, puzzle.tabletY - 56, 'Ancient Seal Unlocked!', '#6EE7B7');
      }
      fireStoryBeat('puzzle_solved');
      if (coopSession.active && puzzle) {
        coopClient.sendPuzzleSync({
          puzzleId: puzzle.id,
          solved: true,
          nodes: puzzle.nodes.map((n) => ({
            id: n.id,
            glyphIndex: n.glyphIndex,
            activated: n.activated,
          })),
          enteredOrder: puzzle.enteredOrder,
        });
      }
      broadcastStorySnapshot('puzzle');
    },
    onPuzzleMismatch({ node }) {
      audio.playSwitchRelease();
      if (node) {
        spawnWorldToast(node.x + node.w * 0.5, node.y - node.h - 14, 'Seal Reset!', '#FCA5A5');
      }
    },
    onArrowFire(trap) {
      audio.playSwitchRelease();
      if (trap) {
        particles.burst(trap.x + (trap.dir > 0 ? trap.w : 0), trap.y + trap.h * 0.5, 4, {
          colors: ['#FDE68A', '#F97316'],
          minSpeed: 20,
          maxSpeed: 70,
          size: 3,
          shape: 'spark',
          gravity: 40,
        });
      }
    },
    onBlockSnapBack(block) {
      audio.playRespawn();
      if (block) {
        spawnWorldToast(block.x + block.w * 0.5, block.y - 16, 'Relic Returned!', '#FDE68A');
      }
      broadcastStorySnapshot('blocks');
    },
    onGhostHit(g, _actor, def) {
      if (repelGhostWithWeapon(mechState, levelState)) {
        hitstopTimer = 0.06;
        cameraShakeTrauma = Math.min(1, cameraShakeTrauma + 0.45);
        audio.playGhostSlap();
        particles.burst(g.x, g.y, 20, {
          colors: [def.primary, def.secondary, '#FFFFFF'],
          minSpeed: 70,
          maxSpeed: 210,
          size: 5,
          shape: 'spark',
          gravity: 40,
        });
        spawnWorldToast(g.x, g.y - 18, 'Ghost Banished!', def.secondary);
        if (coopSession.active) {
          coopClient.sendGhostSync({
            kind: 'reunited',
            strayId: g.strayId || 'madjid',
          });
        }
      }
    },
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
    onCheckpoint(cp, visitor, respawnPayload) {
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

      // Dual-player Phase-Warp: bring far-away or gate/barrier-blocked partner to checkpoint cleanly
      if (visitor && respawnPayload && (!coopSession.active || !coopSession.partnerConnected || coopSession.localCharId === visitor.id)) {
        const partnerId = visitor.id === 'madjid' ? 'nadine' : 'madjid';
        const partner = levelState.actors[partnerId];
        if (partner && !partner.phaseDash?.active && !partner.devouredByGhost && partner.hurtTimer <= 0) {
          const dist = Math.hypot(partner.x - cp.x, partner.y - cp.y);
          const minX = Math.min(partner.x, cp.x);
          const maxX = Math.max(partner.x + partner.w, cp.x);
          const blockedByGate = levelState.gates.some(
            (g) => !g.latchedOpen && g.openProgress < 0.7 && g.x + g.w >= minX && g.x <= maxX
          );
          const blockedByBarrier = (levelState.fragileBarriers || []).some(
            (b) => !b.broken && b.x + b.w >= minX && b.x <= maxX
          );
          if (dist > 280 || blockedByGate || blockedByBarrier) {
            cancelCarry(mechState, levelState);
            startPhaseDash(partner, respawnPayload[partnerId].x, respawnPayload[partnerId].y, 'checkpoint', levelState.worldWidth);
            spawnWorldToast(partner.x + partner.w * 0.5, partner.y - 18, 'Phase-Warping!', '#BAE6FD');
          }
        }
      }

      if (!coopSession.active) {
        persistSoloCheckpointSnapshot(cp.label || null);
      } else {
        persistCurrentCoopRoom(coopSession.room);
      }
      syncHudStatic();
      syncHealthHud();
      fireStoryBeat('checkpoint_lit');
      broadcastStorySnapshot('checkpoint');
    },
    onCheckpointLocked(cp) {
      const nowMs = performance.now();
      if (nowMs - lastCheckpointLockedToastAt > 2200) {
        lastCheckpointLockedToastAt = nowMs;
        audio.playSwitchRelease();
        spawnWorldToast(cp.x, cp.y - 68, 'Solve Seal Puzzle First!', '#FBBF24');
      }
    },
    onCry(payload) {
      const actor = payload?.actor || payload;
      if (!actor) return;
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
    onRespawn(payload) {
      cancelCarry(mechState, levelState);
      resetCatToTeam(levelState.cat, levelState);
      audio.playRespawn();
      const actor = payload?.actor || payload?.state?.actors?.[activeCharId] || payload?.state?.actors?.madjid || levelState.actors[activeCharId];
      if (actor && typeof actor.x === 'number' && typeof actor.y === 'number') {
        particles.burst(actor.x + actor.w * 0.5, actor.y + actor.h * 0.5, 12, {
          colors: ['#FFF8E8', '#FFE299', '#A8E0FF'],
          minSpeed: 35,
          maxSpeed: 105,
          size: 4,
          shape: 'spark',
          gravity: 35,
        });
      }
      syncHudStatic();
      syncBossBarHud();
      syncHealthHud();
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
      progressionState = completeWorldInProgression(progressionState, lvl.worldId, WORLDS.length);
      lobbySelectedWorldId = Math.min(WORLDS.length, Math.max(lobbySelectedWorldId, progressionState.highestUnlockedWorld));
      savePreferences();
      renderLobbyWorldMap();

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
        clearSoloCheckpointSnapshot(window.localStorage);
        renderLobbyResumePrompt();
        if (snapshot.exit?.isWeddingArch && !weddingCeremony?.active) {
          weddingCeremony = {
            active: true,
            timer: 0,
            duration: 3.45,
            snapshot: {
              elapsed: snapshot.elapsed,
              keysCollected: snapshot.keysCollected,
            },
          };
          levelState.actors.madjid.weddingCeremony = true;
          levelState.actors.nadine.weddingCeremony = true;
          levelState.actors.madjid.hurtTimer = 0;
          levelState.actors.nadine.hurtTimer = 0;
          levelState.actors.madjid.danceStyle = 'waltz';
          levelState.actors.nadine.danceStyle = 'waltz';
          levelState.actors.madjid.mood = 'kissing';
          levelState.actors.nadine.mood = 'kissing';
          audio.playJourneyComplete();
          fireStoryBeat('wedding_vow');
          showCaption('Madjid & Nadine stand hand-in-hand beneath the Coral Wedding Arch!', 3400);
          spawnWorldToast(ex, ey - 42, 'Married Beneath the Coral Arch ♥', '#FDE68A');
        } else {
          audio.playJourneyComplete();
          document.getElementById('victory-chapters-val').textContent = `${WORLDS.length}/${WORLDS.length}`;
          document.getElementById('victory-time-val').textContent = formatTime(totalJourneyTime);
          document.getElementById('victory-keys-val').textContent = `${LEVELS.length}/${LEVELS.length}`;
          setGameState('gameover');
          elVictoryModal.classList.remove('hidden');
        }
      } else if (coopSession.active) {
        // Seamless Co-op Transition: never trap players behind a blocking chapter-clear modal
        audio.playLevelComplete();
        showCaption(`${lvl.worldName} · Stage ${lvl.code} Cleared! Advancing together...`, 3200);
        spawnWorldToast(ex, ey - 28, 'Stage Cleared! Next World...', '#FDE68A');
        clearCoopAdvanceTimer();
        const canHostAdvance =
          coopSession.room?.hostClientId === coopClient.getClientId() ||
          !coopSession.partnerConnected ||
          (!coopSession.room?.hostClientId && coopSession.localCharId === 'madjid');
        if (canHostAdvance) {
          const nextIdx = currentLevelIdx + 1;
          coopAdvanceTimer = window.setTimeout(() => {
            coopAdvanceTimer = null;
            if (coopSession.active) {
              coopClient.setRoomMode({ mode: 'story', levelIndex: nextIdx, reset: true });
            }
          }, 950);
        }
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

    if (gameState === 'dedication') {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        setGameState('title');
      }
      return;
    }

    if (gameState === 'title' && !activeSubModal) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (lobbyModeChoice === 'coop' && !coopSession.active) {
          openCoopModal();
        } else {
          const idx = LEVELS.findIndex((l) => l.worldId === lobbySelectedWorldId);
          startNewGame(idx >= 0 ? idx : 0);
        }
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
        if (elSettingsDrawer && !elSettingsDrawer.classList.contains('hidden')) {
          toggleSettingsDrawer(false);
        } else if (elDancePopover && !elDancePopover.classList.contains('hidden')) {
          toggleDancePopover(false);
        } else if (!elChatBox.classList.contains('hidden')) {
          toggleChatBox(false);
        } else if (!levelState.gameOver) {
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
      if (!audio.isMuted()) {
        audio.unlock();
      }
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
      triggerOneTapDance();
      return;
    }

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') {
      e.preventDefault();
      triggerLocalDash();
      return;
    }

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      handleSnapPhoto();
      return;
    }

    if (e.code === 'KeyX' || e.code === 'KeyJ') {
      e.preventDefault();
      handleWeaponUse();
      return;
    }

    if (e.code === 'KeyQ') {
      e.preventDefault();
      handleWeaponCycle();
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      audio.playUiClick();
      toggleHudCollapsed();
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
      code === 'ArrowDown' ||
      code === 'Space' ||
      code === 'KeyA' ||
      code === 'KeyD' ||
      code === 'KeyW' ||
      code === 'KeyS'
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
    audio.setTabHidden(document.hidden);
  });

  // Multi-Touch On-Screen Controls
  const activePointerActions = new Map();

  function updateTouchAction(action, pressed) {
    if (action === 'left') touchHeld.left = pressed;
    if (action === 'right') touchHeld.right = pressed;
    if (action === 'down') touchHeld.down = pressed;
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

      if (action === 'weapon') {
        btn.classList.add('pressed');
        handleWeaponUse();
        window.setTimeout(() => btn.classList.remove('pressed'), 120);
        return;
      }

      if (action === 'weapon-cycle') {
        btn.classList.add('pressed');
        handleWeaponCycle();
        window.setTimeout(() => btn.classList.remove('pressed'), 120);
        return;
      }

      if (action === 'dance') {
        btn.classList.add('pressed');
        triggerOneTapDance();
        window.setTimeout(() => btn.classList.remove('pressed'), 120);
        return;
      }

      if (action === 'dash') {
        btn.classList.add('pressed');
        triggerLocalDash();
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

  elBtnDedicationContinue?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    setGameState('title');
  });

  // Title / Journey Lobby, HUD, Modal, Open-World, Co-op & Chat DOM Handlers
  elBtnLobbyModeSolo?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    lobbyModeChoice = 'solo';
    syncLobbyModeButtons();
  });
  elBtnLobbyModeCoop?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    lobbyModeChoice = 'coop';
    syncLobbyModeButtons();
  });
  elBtnLobbyBgmToggle?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.toggleMusicEnabled();
    if (audio.isMusicEnabled() && !audio.isMuted()) {
      audio.unlock();
    }
    audio.playUiClick();
    syncMuteUI();
  });
  elBtnLobbyBgmNext?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    audio.nextBgmTrack();
    syncMuteUI();
  });
  elBtnLobbyDay?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    applyTimeOfDayMode('day', { broadcast: true });
  });

  elBtnLobbyNight?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    applyTimeOfDayMode('night', { broadcast: true });
  });

  elBtnLobbyTouchToggle?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    applyTouchPadMode(touchPadMode === 'off' ? 'on' : 'off');
  });

  elBtnResumeSaved?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    const desc = getSavedResumeDescriptor();
    const kind = elBtnResumeSaved.dataset.resumeKind || desc.primary;
    if (kind === 'coop' && desc.coop) {
      resumeSavedCoopRoom(desc.coop);
    } else if (desc.solo) {
      resumeSavedSoloSnapshot(desc.solo);
    }
  });

  elBtnResumeAlt?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    const desc = getSavedResumeDescriptor();
    const kind = elBtnResumeAlt.dataset.resumeKind || 'coop';
    if (kind === 'coop' && desc.coop) {
      resumeSavedCoopRoom(desc.coop);
    } else if (desc.solo) {
      resumeSavedSoloSnapshot(desc.solo);
    }
  });

  elBtnResumeFresh?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    resumePromptDismissed = true;
    renderLobbyResumePrompt();
    document.querySelector('.lobby-world-card:not(:disabled)')?.focus?.();
  });

  elBtnStartJourney?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (lobbyModeChoice === 'coop' && !coopSession.active) {
      openCoopModal();
      return;
    }
    const idx = LEVELS.findIndex((l) => l.worldId === lobbySelectedWorldId);
    startNewGame(idx >= 0 ? idx : 0);
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
    if (!audio.isMuted()) {
      audio.unlock();
    }
    syncMuteUI();
  });

  elDrawerBtnBgmToggle?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.toggleMusicEnabled();
    if (audio.isMusicEnabled() && !audio.isMuted()) {
      audio.unlock();
    }
    audio.playUiClick();
    syncMuteUI();
  });

  elDrawerBtnBgmNext?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    audio.nextBgmTrack();
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
      clearLastCoopRoom(window.localStorage);
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
    triggerOneTapDance();
  });

  elHudBtnDanceStyles?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleDancePopover();
  });

  elHudBtnDash?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    triggerLocalDash();
  });

  elHudBtnCollapse?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleHudCollapsed();
  });

  elTouchHubToggle?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleTouchActionHub();
  });

  elHudBtnSettings?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleSettingsDrawer();
  });

  elBtnCloseSettings?.addEventListener('click', () => {
    audio.playUiClick();
    toggleSettingsDrawer(false);
  });

  document.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.unlock();
      audio.playUiClick();
      switchDrawerTab(btn.dataset.drawerTab || 'room');
    });
  });

  elDrawerBtnOpenWorld?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    toggleSettingsDrawer(false);
    closeAllSubModals();
    if (coopSession.active) {
      coopClient.setRoomMode({ mode: 'openworld' });
    } else {
      loadOpenWorld({ instantBg: false, showStory: true });
      setGameState('playing');
    }
  });

  elDrawerBtnLeaveRoom?.addEventListener('click', () => {
    audio.playUiClick();
    clearLastCoopRoom(window.localStorage);
    coopClient.leaveRoom();
    toggleSettingsDrawer(false);
  });

  elBtnDrawerWorldsModal?.addEventListener('click', () => {
    toggleSettingsDrawer(false);
    openChaptersModal();
  });

  elDrawerBtnResetProgress?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.playUiClick();
    if (!resetProgressArmed) {
      resetProgressArmed = true;
      elDrawerBtnResetProgress.classList.add('is-confirm');
      elDrawerBtnResetProgress.textContent = 'Click Again to Confirm Reset';
      if (resetProgressArmTimer) window.clearTimeout(resetProgressArmTimer);
      resetProgressArmTimer = window.setTimeout(() => {
        resetProgressArmed = false;
        if (elDrawerBtnResetProgress) {
          elDrawerBtnResetProgress.classList.remove('is-confirm');
          elDrawerBtnResetProgress.textContent = 'Reset World Progress';
        }
      }, 4000);
      return;
    }

    if (resetProgressArmTimer) {
      window.clearTimeout(resetProgressArmTimer);
      resetProgressArmTimer = null;
    }
    resetProgressArmed = false;
    elDrawerBtnResetProgress.classList.remove('is-confirm');
    elDrawerBtnResetProgress.textContent = 'Reset World Progress';

    progressionState = resetProgression(window.localStorage);
    clearSoloCheckpointSnapshot(window.localStorage);
    clearLastCoopRoom(window.localStorage);
    clearedLevelIds.clear();
    lobbySelectedWorldId = 1;
    savePreferences();
    renderLobbyWorldMap();
    renderLobbyResumePrompt();
    renderDrawerWorldsList();
    renderChaptersList();
    toggleSettingsDrawer(false);
    startNewGame(0, { silent: true });
    const lead = levelState.actors?.madjid;
    if (lead) {
      spawnWorldToast(lead.x + 20, lead.y - 24, 'World Progress Reset!', '#FCA5A5');
    }
  });

  elDrawerBtnTouchCycle?.addEventListener('click', () => {
    elPauseTouchToggle?.click();
  });

  elHudBtnTouchToggle?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playUiClick();
    applyTouchPadMode(touchPadMode === 'off' ? 'on' : 'off');
  });

  document.querySelectorAll('[data-quality-preset]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.playUiClick();
      applyQualityPreset(btn.dataset.qualityPreset);
    });
  });

  [elBtnDrawerDay, elBtnDrawerNight].forEach((btn) => {
    btn?.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.unlock();
      audio.playUiClick();
      applyTimeOfDayMode(btn.dataset.timeOfDay || 'day', { broadcast: true });
    });
  });

  document.querySelectorAll('[data-studio-char]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.currentTarget.blur();
      audio.playUiClick();
      studioTargetChar = btn.dataset.studioChar === 'nadine' ? 'nadine' : 'madjid';
      document.querySelectorAll('[data-studio-char]').forEach((b) => {
        const active = b.dataset.studioChar === studioTargetChar;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      renderStudioPreview();
    });
  });

  [
    elStudioSkinName,
    elStudioBodyColor,
    elStudioAccentColor,
    elStudioPattern,
    elStudioHeadgear,
    elStudioAura,
  ].forEach((input) => {
    input?.addEventListener('input', renderStudioPreview);
    input?.addEventListener('change', renderStudioPreview);
  });

  elStudioImageUpload?.addEventListener('change', (e) => {
    const file = e.target?.files?.[0];
    if (file) applyStudioFile(file);
  });

  elBtnStudioSave?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    saveStudioSkin();
  });

  elBtnTryAgainRespawn?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    autoRespawnTimer = 0;
    elTryAgainModal?.classList.add('hidden');
    if (levelState.escapeState && !levelState.escapeState.cleared) {
      levelState.escapeState.active = false;
      levelState.escapeState.wallX = levelState.escapeState.wallStartX;
      levelState.escapeState.timeRemaining = levelState.escapeState.timeLimitSec;
    }
    elHudEscapeBanner?.classList.add('hidden');
    triggerTeamRespawnAtCheckpoint(levelState, simCallbacks);
    syncHealthHud();
    syncHudStatic();
    syncBossBarHud();
    if (coopSession.active) {
      broadcastStorySnapshot('checkpoint_rollback', { replace: true });
      coopClient.sendHpRespawn({ kind: 'respawn' });
    }
  });

  elBtnTryAgainRestart?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    audio.playRestart();
    elTryAgainModal?.classList.add('hidden');
    if (playMode === 'openworld') {
      loadOpenWorld({ instantBg: false, showStory: false });
    } else {
      loadChapter(currentLevelIdx, { instantBg: false, showStory: false });
      broadcastStorySnapshot('restart');
    }
  });

  elHudBtnPhoto?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    toggleSettingsDrawer(false);
    handleSnapPhoto();
  });

  elHudBtnWeapon?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    handleWeaponUse();
  });

  elHudBtnWeaponNext?.addEventListener('click', (e) => {
    e.currentTarget.blur();
    audio.unlock();
    handleWeaponCycle();
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
    if (elSettingsDrawer && !elSettingsDrawer.classList.contains('hidden')) {
      toggleSettingsDrawer(false);
    }
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

  elBtnCoopQuickJoin?.addEventListener('click', () => {
    audio.unlock();
    audio.playUiClick();
    if (!coopClient.isConnected()) {
      pendingQuickJoin = true;
      setCoopFeedback('Connecting to find an open room...', true);
      coopClient.connect(elCoopServerUrl.value || getDefaultWsUrl());
      return;
    }
    setCoopFeedback('Searching for first open game session...', true);
    coopClient.quickJoin({ skinId: selectedSkins[coopCreateCharChoice || 'nadine'] });
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
    clearLastCoopRoom(window.localStorage);
    coopClient.leaveRoom();
  });

  function applyTouchPadMode(mode) {
    touchPadMode = mode === 'on' || mode === 'off' ? mode : 'auto';
    if (touchPadMode === 'on') {
      elTouchControls.classList.add('force-visible');
      elTouchControls.classList.remove('force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Always On';
      if (elDrawerBtnTouchCycle) elDrawerBtnTouchCycle.textContent = 'On-Screen Pad: On';
    } else if (touchPadMode === 'off') {
      elTouchControls.classList.remove('force-visible');
      elTouchControls.classList.add('force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Hidden';
      if (elDrawerBtnTouchCycle) elDrawerBtnTouchCycle.textContent = 'On-Screen Pad: Hidden';
    } else {
      elTouchControls.classList.remove('force-visible', 'force-hidden');
      elPauseTouchToggle.textContent = 'On-Screen Pad: Auto';
      if (elDrawerBtnTouchCycle) elDrawerBtnTouchCycle.textContent = 'On-Screen Pad: Auto';
    }
    if (elHudBtnTouchToggle) {
      const isHidden = touchPadMode === 'off';
      elHudBtnTouchToggle.setAttribute('aria-pressed', String(!isHidden));
      elHudBtnTouchToggle.setAttribute('title', isHidden ? 'Show On-Screen Controls' : 'Hide On-Screen Controls');
      const lbl = elHudBtnTouchToggle.querySelector('.hud-btn-label');
      if (lbl) lbl.textContent = isHidden ? 'Show Pad' : 'Pad';
    }
    if (elBtnLobbyTouchToggle) {
      const isOn = touchPadMode === 'on';
      elBtnLobbyTouchToggle.textContent =
        touchPadMode === 'off' ? 'Pad: Hidden' : touchPadMode === 'auto' ? 'Pad: Auto' : 'Pad: On';
      elBtnLobbyTouchToggle.setAttribute('aria-pressed', String(touchPadMode !== 'off'));
      elBtnLobbyTouchToggle.classList.toggle('is-active', isOn);
    }
    try {
      window.localStorage.setItem('nadine_touch_pad_mode', touchPadMode);
    } catch {
      // Ignore storage errors
    }
  }
  applyTouchPadMode(touchPadMode);

  elPauseTouchToggle.addEventListener('click', () => {
    audio.playUiClick();
    if (touchPadMode === 'auto') {
      applyTouchPadMode('on');
    } else if (touchPadMode === 'on') {
      applyTouchPadMode('off');
    } else {
      applyTouchPadMode('auto');
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
    if (coopSession.active) {
      clearLastCoopRoom(window.localStorage);
      coopClient.leaveRoom();
    }
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
    const nativeDpr = window.devicePixelRatio || 1;
    dpr =
      qualityPreset === 'not_bad'
        ? 0.75
        : qualityPreset === 'good'
          ? 1.0
          : Math.min(nativeDpr, 2.5);
    canvas.width = Math.max(1, Math.round(viewW * dpr));
    canvas.height = Math.max(1, Math.round(viewH * dpr));
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
        dedicationVisible: gameState === 'dedication' && !elDedicationScreen?.classList.contains('hidden'),
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
          hp: Math.round(levelState.actors.madjid.hp ?? 100),
          maxHp: Math.round(levelState.actors.madjid.maxHp ?? 100),
          dashCooldown: Math.round((levelState.actors.madjid.dashCooldown || 0) * 100) / 100,
          mood: levelState.actors.madjid.mood,
          onLadder: Boolean(levelState.actors.madjid.onLadder),
          carriedBy: levelState.actors.madjid.carriedBy || null,
          danceStyle: levelState.actors.madjid.danceStyle || null,
          devouredByGhost: Boolean(levelState.actors.madjid.devouredByGhost),
          weapons: Array.isArray(levelState.actors.madjid.weapons) ? levelState.actors.madjid.weapons.slice() : [],
          equippedWeapon: levelState.actors.madjid.equippedWeapon || null,
          phaseDash: Boolean(levelState.actors.madjid.phaseDash?.active),
        },
        nadine: {
          x: Math.round(levelState.actors.nadine.x),
          y: Math.round(levelState.actors.nadine.y),
          hp: Math.round(levelState.actors.nadine.hp ?? 100),
          maxHp: Math.round(levelState.actors.nadine.maxHp ?? 100),
          dashCooldown: Math.round((levelState.actors.nadine.dashCooldown || 0) * 100) / 100,
          mood: levelState.actors.nadine.mood,
          onLadder: Boolean(levelState.actors.nadine.onLadder),
          carriedBy: levelState.actors.nadine.carriedBy || null,
          danceStyle: levelState.actors.nadine.danceStyle || null,
          devouredByGhost: Boolean(levelState.actors.nadine.devouredByGhost),
          weapons: Array.isArray(levelState.actors.nadine.weapons) ? levelState.actors.nadine.weapons.slice() : [],
          equippedWeapon: levelState.actors.nadine.equippedWeapon || null,
          phaseDash: Boolean(levelState.actors.nadine.phaseDash?.active),
        },
        gameOver: Boolean(levelState.gameOver),
        bossDefeated: Boolean(levelState.bossDefeated),
        portalUnlocked: Boolean(levelState.portalUnlocked),
        sectorCode: lastSectorCode || null,
        weddingActive: Boolean(weddingCeremony?.active),
        hudCollapsed: Boolean(hudCollapsed),
        touchHubExpanded: Boolean(touchHubExpanded),
        touchPadMode,
        qualityPreset,
        timeOfDayMode,
        dpr,
        ladderCount: (levelState.ladders || []).length,
        escapeActive: Boolean(levelState.escapeState?.active),
        escapeCleared: Boolean(levelState.escapeState?.cleared),
        escapeTimeRemaining: levelState.escapeState ? Math.round(levelState.escapeState.timeRemaining * 10) / 10 : null,
        puzzleCount: (levelState.puzzles || []).length,
        solvedPuzzlesCount: (levelState.puzzles || []).filter((p) => p.solved).length,
        secondaryMonsterCount: (levelState.monsters || []).length,
        arrowTrapCount: (levelState.arrowTraps || []).length,
        dynamicTrapCount: (levelState.dynamicTraps || []).length,
        carryBlockCount: (levelState.carryBlocks || []).length,
        keysCollected: levelState.keysCollected,
        keysRequired: levelState.keysRequired,
        activeCheckpoint: levelState.activeCheckpoint ? levelState.activeCheckpoint.id : null,
        hasCheckpointSnapshot: Boolean(levelState.checkpointSnapshot),
        savedResume: (() => {
          const d = getSavedResumeDescriptor();
          return {
            primary: d.primary,
            solo: d.solo
              ? { worldId: d.solo.worldId, levelIndex: d.solo.levelIndex, checkpointLabel: d.solo.checkpointLabel }
              : null,
            coop: d.coop
              ? { code: d.coop.code, name: d.coop.name, worldId: d.coop.worldId }
              : null,
          };
        })(),
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
          zoomFactor: Math.round(currentZoomFactor * 1000) / 1000,
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
        progression: {
          highestUnlockedWorld: progressionState.highestUnlockedWorld,
          completedWorlds: progressionState.completedWorlds.slice(),
          selectedLobbyWorld: lobbySelectedWorldId,
        },
        cat: levelState.cat
          ? {
              name: levelState.cat.name,
              discovered: Boolean(levelState.cat.discovered),
              x: Math.round(levelState.cat.x),
              y: Math.round(levelState.cat.y),
              mood: levelState.cat.mood,
              idleAction: levelState.cat.idleAction,
              helmetActive: Boolean(levelState.cat.helmetActive),
              alertActive: levelState.cat.alertTimer > 0,
            }
          : null,
        storyBanner: storyState?.banner
          ? {
              id: storyState.banner.id,
              title: storyState.banner.title,
              line: storyState.banner.line,
            }
          : null,
        audio: audio.getBgmState(),
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

    // Live Lobby Campfire Overlook: Madjid, Nadine & Mimi beside warm glowing fire
    if (gameState === 'title') {
      levelState.actors.madjid.x = 122;
      levelState.actors.nadine.x = 232;
      levelState.actors.madjid.facing = 1;
      levelState.actors.nadine.facing = -1;
      levelState.actors.madjid.grounded = true;
      levelState.actors.nadine.grounded = true;
      lobbyCat.x = 158;
      lobbyCat.y = 582;
      lobbyCat.facing = 1;
      lobbyCat.idleAction = Math.floor(elapsedTime * 0.35) % 2 === 0 ? 'purr' : 'sit';
      lobbyCat.blinkTimer -= dt;
      if (lobbyCat.blinkTimer <= -0.14) lobbyCat.blinkTimer = 2.4;

      lobbyCampEmberTimer -= dt;
      if (lobbyCampEmberTimer <= 0) {
        lobbyCampEmberTimer = 0.28;
        particles.spawn({
          x: 186 + (Math.random() - 0.5) * 14,
          y: 584,
          vx: (Math.random() - 0.5) * 14,
          vy: -26 - Math.random() * 20,
          life: 1.05,
          size: 2.8,
          color: Math.random() > 0.35 ? '#FDE047' : '#FB923C',
          shape: 'spark',
          gravity: -10,
        });
      }

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
          up: jumpHeldNow,
          down: keysHeld.has('ArrowDown') || keysHeld.has('KeyS') || touchHeld.down,
          jumpHeld: jumpHeldNow,
          jumpJustPressed: localJumpJustPressed || (jumpHeldNow && !prevJumpHeld),
          jumpJustReleased: localJumpJustReleased || (!jumpHeldNow && prevJumpHeld),
        };
        prevJumpHeld = jumpHeldNow;
        localJumpJustPressed = false;
        localJumpJustReleased = false;

        if (
          elSettingsDrawer &&
          !elSettingsDrawer.classList.contains('hidden') &&
          (localIntent.left || localIntent.right || localIntent.up || localIntent.down || localIntent.jumpJustPressed)
        ) {
          toggleSettingsDrawer(false);
        }

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

        // Automatic Checkpoint Team Respawn after 0 HP Cry Beat
        if (levelState.gameOver) {
          if (autoRespawnTimer <= 0) {
            autoRespawnTimer = 1.05;
          } else {
            autoRespawnTimer -= dt;
            if (autoRespawnTimer <= 0) {
              autoRespawnTimer = 0;
              elTryAgainModal?.classList.add('hidden');
              if (levelState.escapeState && !levelState.escapeState.cleared) {
                levelState.escapeState.active = false;
                levelState.escapeState.wallX = levelState.escapeState.wallStartX;
                levelState.escapeState.timeRemaining = levelState.escapeState.timeLimitSec;
              }
              elHudEscapeBanner?.classList.add('hidden');
              triggerTeamRespawnAtCheckpoint(levelState, simCallbacks);
              syncHealthHud();
              syncHudStatic();
              syncBossBarHud();
              const dest = levelState.actors.madjid;
              spawnWorldToast(dest.x + 20, dest.y - 20, 'Recovered at Checkpoint!', '#A7F3D0');
              if (coopSession.active) {
                broadcastStorySnapshot('checkpoint_rollback', { replace: true });
                coopClient.sendHpRespawn({ kind: 'respawn' });
              }
            }
          }
        } else {
          autoRespawnTimer = 0;
        }

        // Entertaining Mini-Scenes (non-blocking banter bubbles + celebration sparkles)
        const miniScenes = levelState.miniScenes || [];
        for (let msIdx = 0; msIdx < miniScenes.length; msIdx++) {
          const ms = miniScenes[msIdx];
          if (ms.triggered) continue;
          const mX = levelState.actors.madjid.x;
          const nX = levelState.actors.nadine.x;
          if (mX >= ms.triggerX || nX >= ms.triggerX) {
            ms.triggered = true;
            const leadId = ms.speaker === 'madjid' ? 'madjid' : 'nadine';
            const partnerId = leadId === 'madjid' ? 'nadine' : 'madjid';
            setOverheadSpeechBubble(interactionState, leadId, ms.bubbleText, 4.2);
            if (ms.partnerBubbleText) {
              setOverheadSpeechBubble(interactionState, partnerId, ms.partnerBubbleText, 4.2);
            }
            const actor = levelState.actors[leadId];
            if (actor) {
              if (ms.toastText) {
                spawnWorldToast(actor.x + actor.w * 0.5, actor.y - 28, ms.toastText, '#FDE68A');
              }
              particles.burst(actor.x + actor.w * 0.5, actor.y, 8, {
                colors: ['#FDE68A', '#F9A8D4', '#93C5FD'],
                minSpeed: 30,
                maxSpeed: 88,
                size: 4.2,
                shape: ms.danceCue ? 'heart' : 'spark',
                gravity: -16,
              });
            }
          }
        }

        // Grand Wedding Ceremony Cutscene Step (after stepping into World 5 Coral Arch)
        if (weddingCeremony?.active) {
          weddingCeremony.timer += dt;
          const archCx = levelState.exit.x + levelState.exit.w * 0.5;
          const archBottomY = levelState.exit.y + levelState.exit.h - PHYSICS.CHAR_H;
          const madjid = levelState.actors.madjid;
          const nadine = levelState.actors.nadine;
          madjid.x += (archCx - 38 - madjid.x) * Math.min(1, dt * 8);
          madjid.y += (archBottomY - madjid.y) * Math.min(1, dt * 8);
          nadine.x += (archCx + 4 - nadine.x) * Math.min(1, dt * 8);
          nadine.y += (archBottomY - nadine.y) * Math.min(1, dt * 8);
          madjid.facing = 1;
          nadine.facing = -1;
          const leanWave = Math.max(0, Math.sin(weddingCeremony.timer * Math.PI * 1.4));
          madjid.kissLean = 0.16 * leanWave;
          nadine.kissLean = -0.16 * leanWave;
          madjid.mood = 'kissing';
          nadine.mood = 'kissing';
          madjid.danceTempo = 4.2;
          nadine.danceTempo = 4.2;
          madjid.weddingCeremony = true;
          nadine.weddingCeremony = true;
          if (levelState.cat) {
            levelState.cat.discovered = true;
            levelState.cat.x += (archCx - 11 - levelState.cat.x) * Math.min(1, dt * 8);
            levelState.cat.y += (archBottomY + (PHYSICS.CHAR_H - 18) - levelState.cat.y) * Math.min(1, dt * 8);
            levelState.cat.facing = 1;
            levelState.cat.idleAction = 'purr';
            levelState.cat.mood = 'purring';
            levelState.cat.heartTimer = Math.max(levelState.cat.heartTimer || 0, 1.2);
          }

          if (weddingCeremony.timer >= weddingCeremony.duration) {
            weddingCeremony.active = false;
            madjid.weddingCeremony = false;
            nadine.weddingCeremony = false;
            document.getElementById('victory-chapters-val').textContent = `${WORLDS.length}/${WORLDS.length}`;
            document.getElementById('victory-time-val').textContent = formatTime(totalJourneyTime);
            document.getElementById('victory-keys-val').textContent = `${LEVELS.length}/${LEVELS.length}`;
            setGameState('gameover');
            elVictoryModal.classList.remove('hidden');
          }
        }

        // Advance storyline whisper timer & subtle running footstep dust
        stepStoryline(storyState, dt);
        syncStoryWhisperHud();

        // Expressive world-aware actor poses & micro-particles (Madjid guard stance, Nadine calm grace, Space jets & Ocean bubbles)
        {
          const m = levelState.actors.madjid;
          const n = levelState.actors.nadine;
          const bossUp = isBossEngaged(levelState, bossState);
          const monsterNearM = (levelState.monsters || []).some(
            (mon) => !mon.defeated && Math.hypot(mon.x + mon.w * 0.5 - (m.x + m.w * 0.5), mon.y + mon.h * 0.5 - (m.y + m.h * 0.5)) <= 180
          );
          m.protectiveStance = Boolean(bossUp || monsterNearM || (n.hp ?? 100) < 45);
          const nearRiddle = (levelState.puzzles || []).some(
            (pz) => !pz.solved && Math.hypot(pz.tabletX - (n.x + n.w * 0.5), pz.tabletY - (n.y + n.h * 0.5)) <= 160
          );
          n.gracefulPose = Boolean(activePhotoSpot || levelState.kissTimer > 0 || nearRiddle);

          if ((levelState.physicsMode === 'space_swim' || levelState.physicsMode === 'underwater') && elapsedTime - lastMicroParticleAt >= 0.18) {
            lastMicroParticleAt = elapsedTime;
            [m, n].forEach((act) => {
              if (Math.hypot(act.vx, act.vy) > 45) {
                particles.spawn({
                  x: act.x + act.w * 0.5 - act.facing * 10,
                  y: act.y + act.h * 0.72,
                  vx: -act.facing * 24,
                  vy: levelState.physicsMode === 'underwater' ? -38 : 12,
                  life: 0.45,
                  size: levelState.physicsMode === 'underwater' ? 3.2 : 2.8,
                  color: levelState.physicsMode === 'underwater' ? '#BAE6FD' : '#93C5FD',
                  shape: 'circle',
                  gravity: levelState.physicsMode === 'underwater' ? -55 : 10,
                });
              }
            });
          } else if (levelState.physicsMode === 'normal' && elapsedTime - lastRunDustAt >= 0.22) {
            lastRunDustAt = elapsedTime;
            const dustColor = bgSystem.getPlatformStyle().top || '#E2E8F0';
            [m, n].forEach((act) => {
              if (act.grounded && Math.abs(act.vx) > 195) {
                particles.spawn({
                  x: act.x + act.w * 0.5 - Math.sign(act.vx) * 8,
                  y: act.y + act.h - 2,
                  vx: -Math.sign(act.vx) * 26,
                  vy: -18 - Math.random() * 14,
                  life: 0.28,
                  size: 2.3,
                  color: dustColor,
                  shape: 'circle',
                  gravity: 95,
                });
              }
            });
          }
        }

        // 3. Cooperative Boss Step (Stage 5s / World Bosses & Summoned Open-World Boss)
        if (bossState && bossState.active && !bossState.defeated) {
          stepBoss(bossState, levelState, mechState, dt, bossCallbacks);
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
            rActor.weapons = remoteActorTarget.weapons.slice();
            rActor.equippedWeapon = remoteActorTarget.equippedWeapon;
            if (remoteActorTarget.phaseDashActive && !rActor.phaseDash?.active) {
              rActor.phaseDash = {
                active: true,
                trail: [{ x: rActor.x + rActor.w * 0.5, y: rActor.y + rActor.h * 0.5 }],
              };
            } else if (!remoteActorTarget.phaseDashActive && rActor.phaseDash?.active) {
              rActor.phaseDash = null;
              rActor.phaseRippleTimer = Math.max(rActor.phaseRippleTimer || 0, 0.5);
            }
            if (remoteActorTarget.phaseRippleTimer > 0) {
              rActor.phaseRippleTimer = Math.max(rActor.phaseRippleTimer || 0, remoteActorTarget.phaseRippleTimer);
            }
            if (remoteActorTarget.weaponSwing) {
              rActor.weaponAttack = {
                active: true,
                weaponId: remoteActorTarget.weaponSwing.weaponId,
                timer: remoteActorTarget.weaponSwing.timer,
                duration: remoteActorTarget.weaponSwing.duration,
                cooldown: 0,
                facing: remoteActorTarget.weaponSwing.facing,
                hitIds: [],
              };
            }
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
              hp: Math.round(localActor.hp ?? 100),
              maxHp: Math.round(localActor.maxHp ?? 100),
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
              weapons: Array.isArray(localActor.weapons) ? localActor.weapons.slice(0, 6) : [],
              equippedWeapon: localActor.equippedWeapon || null,
              phaseDashActive: Boolean(localActor.phaseDash?.active),
              phaseRippleTimer: Math.round((localActor.phaseRippleTimer || 0) * 100) / 100,
              weaponSwing: localActor.weaponAttack?.active
                ? {
                    weaponId: localActor.weaponAttack.weaponId,
                    timer: Math.round(localActor.weaponAttack.timer * 100) / 100,
                    duration: localActor.weaponAttack.duration,
                    facing: localActor.weaponAttack.facing,
                  }
                : null,
            });
          }
        }

        syncHealthHud();
        updateDashCooldownHud();
        updateTutorialHint();

        // Update Escape Surge HUD Banner & dynamic ladder/swim touch button label
        if (elHudEscapeBanner) {
          const esc = levelState.escapeState;
          if (esc && esc.active) {
            elHudEscapeBanner.classList.remove('hidden');
            if (elHudEscapeTitle) elHudEscapeTitle.textContent = esc.title || 'Escape Surge!';
            if (elHudEscapeTimer) elHudEscapeTimer.textContent = `${esc.timeRemaining.toFixed(1)}s`;
          } else {
            elHudEscapeBanner.classList.add('hidden');
          }
        }
        const activeActor = levelState.actors[coopSession.active && coopSession.localCharId ? coopSession.localCharId : activeCharId];
        const swimNow = levelState.physicsMode === 'underwater' || levelState.physicsMode === 'space_swim';
        const ladderNow = Boolean(activeActor && (activeActor.onLadder || findOverlappingLadder(levelState, activeActor)));
        elTouchDown?.classList.toggle('hidden', !(swimNow || ladderNow));
        if (elTouchDown) {
          const dSpan = elTouchDown.querySelector('span');
          if (dSpan) dSpan.textContent = ladderNow && !swimNow ? 'Climb' : 'Dive';
        }
        if (elTouchJump) {
          const jSpan = elTouchJump.querySelector('span');
          if (jSpan) {
            jSpan.textContent =
              levelState.physicsMode === 'space_swim'
                ? 'Float'
                : levelState.physicsMode === 'underwater'
                  ? 'Swim'
                  : ladderNow
                    ? 'Climb'
                    : 'Jump';
          }
        }

        if (playMode === 'story') {
          const activeSec = getActiveSector(levelState);
          if (activeSec && activeSec.code !== lastSectorCode) {
            lastSectorCode = activeSec.code;
            const curLvl = LEVELS[currentLevelIdx];
            elHudChapterNum.textContent = `W${curLvl.worldId} · ${activeSec.code}`;
            elHudChapterTitle.textContent = activeSec.name;
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
      isWedding: Boolean(weddingCeremony?.active),
      isBoss: isBossEngaged(levelState, bossState),
      isCozyTogether: Boolean(levelState.kissTimer > 0 || mechState.idleSpecial?.active),
    });
    if (!hasInitializedCam) {
      currentCamScale = targetFraming.scale;
      currentZoomFactor = targetFraming.zoomFactor;
      hasInitializedCam = true;
    } else {
      const camBlend = Math.min(1, dt * 4.2);
      currentCamScale += (targetFraming.scale - currentCamScale) * camBlend;
      currentZoomFactor += (targetFraming.zoomFactor - currentZoomFactor) * camBlend;
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
        (focusActor.facing || 1) * 72 +
        (Math.abs(focusActor.vx) > 20 ? Math.sign(focusActor.vx) * 24 : 0);
      cameraLookAheadX += (desiredLookAhead - cameraLookAheadX) * Math.min(1, dt * 3.4);

      const desiredX = targetFraming.focusX + cameraLookAheadX * 0.45 - visibleW * 0.5;
      const actorCenterX = focusActor.x + focusActor.w * 0.5;
      const minFocusCamX = actorCenterX - Math.max(80, visibleW - 72);
      const maxFocusCamX = actorCenterX - 72;
      const framedX = Math.max(minFocusCamX, Math.min(maxFocusCamX, desiredX));
      const desiredY = targetFraming.focusY - visibleH * 0.54;
      targetCamX = Math.max(0, Math.min(maxCamX, framedX));
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
        weddingCeremony,
        photoSpots,
        activePhotoSpot,
        lobbyCat,
        viewRange: {
          minX: cameraX - 160,
          maxX: cameraX + visibleW + 160,
        },
        viewportBounds: {
          minX: Math.max(0, -offsetX / activeScale),
          maxX: Math.min(levelState.worldWidth, (viewW - offsetX) / activeScale),
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
  audio.setBgmOnStateChange(() => syncMuteUI());
  syncMuteUI();
  updateScrapbookBadge();
  applyQualityPreset(qualityPreset);
  applyTimeOfDayMode(timeOfDayMode, { instant: true });
  loadChapter(0, { instantBg: true, showStory: false });
  renderLobbyWorldMap();
  renderLobbyResumePrompt();
  syncLobbyModeButtons();
  syncHealthHud();
  updateDashCooldownHud();

  // PWA Service Worker, Install Prompt & Offline Status Indicator
  if (typeof window !== 'undefined') {
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator?.standalone === true;
    const isIos = /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '');

    const refreshInstallButtons = () => {
      const canShow = !isStandalone && (Boolean(deferredInstallPrompt) || isIos);
      elBtnPwaInstall?.classList.toggle('hidden', !canShow);
      elBtnTitleInstall?.classList.toggle('hidden', !canShow);
    };

    const handleInstallClick = async (e) => {
      e?.currentTarget?.blur?.();
      audio.unlock();
      audio.playUiClick();
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch {
          // Ignore dismissal
        }
        deferredInstallPrompt = null;
        refreshInstallButtons();
      } else if (isIos) {
        elIosInstallModal?.classList.remove('hidden');
      }
    };

    elBtnPwaInstall?.addEventListener('click', handleInstallClick);
    elBtnTitleInstall?.addEventListener('click', handleInstallClick);
    elBtnIosInstallClose?.addEventListener('click', () => {
      audio.playUiClick();
      elIosInstallModal?.classList.add('hidden');
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      refreshInstallButtons();
    });

    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      refreshInstallButtons();
    });

    const syncOnlineStatus = () => {
      const online = window.navigator?.onLine !== false;
      elOfflineIndicator?.classList.toggle('hidden', online);
    };
    window.addEventListener('online', syncOnlineStatus);
    window.addEventListener('offline', syncOnlineStatus);
    syncOnlineStatus();
    refreshInstallButtons();

    if ('serviceWorker' in window.navigator) {
      import('virtual:pwa-register')
        .then(({ registerSW }) => {
          registerSW({ immediate: true });
        })
        .catch(() => {
          // Ignore if SW registration is unavailable in non-bundled harness
        });
    }
  }

  // Honor ?autostart=1&level=<1..50> (and backward-compatible &chapter=) for instant testing
  const params = new URLSearchParams(window.location.search);
  if (params.get('autostart') === '1') {
    const lvlParam = Number(params.get('level') || params.get('chapter') || '1');
    const startIdx = !Number.isNaN(lvlParam) && lvlParam >= 1 && lvlParam <= LEVELS.length ? lvlParam - 1 : 0;
    startNewGame(startIdx, { silent: true });
  } else {
    setGameState('dedication');
    dedicationAutoTimer = window.setTimeout(() => {
      dedicationAutoTimer = null;
      if (gameState === 'dedication') {
        setGameState('title');
      }
    }, 6500);
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
