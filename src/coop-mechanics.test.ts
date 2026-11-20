import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARRY_CONFIG,
  DANCES,
  GHOST_CONFIG,
  IDLE_COOP_INTERACTIONS,
  IDLE_SPECIAL_CONFIG,
  SOUL_LINK_CONFIG,
  computeDynamicCoopCamera,
  createDanceInvite,
  createMechanicsState,
  startDance,
  stepDanceSystem,
  stepGhostSystem,
  stepRareIdleInteractions,
  stepSoulLinkAndRescue,
  syncCarriedActor,
  toggleCarry,
  triggerEdgeRescue,
} from './coop-mechanics.js';
import {
  createBossForLevel,
  createOpenWorldBoss,
  getBossStatusLabel,
  stepBoss,
} from './bosses.js';
import {
  findActivePhotoSpot,
  getOpenWorldPhotoSpots,
  getPhotoSpotsForLevel,
  mergeScrapbookPhotos,
} from './scrapbook.js';
import { getWeatherForWorld, WEATHER_PRESETS } from './background.js';
import { LEVELS } from './levels.js';
import { createEmptyIntent, createInitialLevelState, stepSimulation } from './game.js';
import {
  getBiomeSurfaceType,
  drawTerrainPlatform,
  drawLinkCable,
  drawGuideRail,
  drawMovingPlatform,
  drawGateBarrier,
  drawSwitchMechanism,
  drawHazardObstacle,
} from './terrain-renderer.js';
import {
  createOpenWorldLevelDefinition,
  createOpenWorldState,
  renderOpenWorldBlocks,
} from './openworld.js';

function makePairState(levelIdx = 0) {
  const levelState = createInitialLevelState(LEVELS[levelIdx]);
  const mechState = createMechanicsState();
  return { levelState, mechState };
}

test('dynamic co-op camera smoothly zooms out as partner separation grows across modes', () => {
  const closeFraming = computeDynamicCoopCamera({
    viewW: 1280,
    viewH: 720,
    worldW: 2200,
    worldH: 640,
    madjid: { x: 180, y: 400, w: 34, h: 36 },
    nadine: { x: 240, y: 400, w: 34, h: 36 },
    activeCharId: 'madjid',
  });

  const farFraming = computeDynamicCoopCamera({
    viewW: 1280,
    viewH: 720,
    worldW: 2200,
    worldH: 640,
    madjid: { x: 120, y: 400, w: 34, h: 36 },
    nadine: { x: 1850, y: 400, w: 34, h: 36 },
    activeCharId: 'madjid',
  });

  assert.ok(farFraming.scale < closeFraming.scale, 'Camera should zoom out when players separate');
  assert.ok(farFraming.visibleW >= 1850 - 120, 'Both separated players should remain framed');
});

test('ghost penalty system: warning banner, spawn, shock impact, Outcome A (Ghost Slap panic run)', () => {
  const { levelState, mechState } = makePairState(0);
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;

  madjid.x = 120;
  madjid.y = 480;
  nadine.x = 120 + GHOST_CONFIG.WARN_MAX + 30;
  nadine.y = 480;
  let warned = false;
  stepGhostSystem(mechState, levelState, 1 / 60, { forcedOutcome: 'slap' }, {
    onGhostWarn() {
      warned = true;
    },
  });
  assert.equal(warned, true);
  assert.equal(mechState.ghost.warningActive, true);
  assert.equal(mechState.ghost.active, false);

  // Separate past spawn threshold
  nadine.x = 120 + GHOST_CONFIG.SPAWN_MAX + 90;
  let spawned = false;
  let shocked = false;
  let slapped = false;
  stepGhostSystem(mechState, levelState, 1 / 60, { forcedOutcome: 'slap', preferredStrayId: 'nadine' }, {
    onGhostSpawn() {
      spawned = true;
    },
  });
  assert.equal(spawned, true);
  assert.equal(mechState.ghost.active, true);
  assert.equal(mechState.ghost.phase, 'chase');

  // Step until ghost catches Nadine -> shock -> slap_run
  for (let i = 0; i < 120; i++) {
    stepGhostSystem(mechState, levelState, 1 / 60, { forcedOutcome: 'slap' }, {
      onGhostShock() {
        shocked = true;
      },
      onGhostSlap() {
        slapped = true;
      },
    });
    if (slapped) break;
  }
  assert.equal(shocked, true, 'Ghost encounter must trigger shock effect');
  assert.equal(slapped, true, 'Outcome A must trigger Ghost Slap');
  assert.equal(mechState.ghost.phase, 'slap_run');
  assert.ok(mechState.ghost.slapCalloutTimer > 0, 'Comic SLAP! callout timer should activate');
  assert.equal(nadine.mood, 'panic');

  // Advance panic run -> locks controls and sprints stray player back toward partner
  let reunited = false;
  for (let i = 0; i < 300; i++) {
    const res = stepGhostSystem(mechState, levelState, 1 / 60, {}, {
      onGhostReunited() {
        reunited = true;
      },
    });
    const overrides = res.overrideIntents as Record<string, ReturnType<typeof createEmptyIntent>> | null;
    if (overrides?.nadine) {
      stepSimulation(
        levelState,
        { madjid: createEmptyIntent(), nadine: overrides.nadine },
        1 / 60
      );
    }
    if (reunited) break;
  }
  assert.equal(reunited, true, 'Slapped player should panic-run straight back to partner');
  assert.equal(mechState.ghost.active, false);
});

test('ghost penalty Outcome B: shock -> devour -> fly to partner -> drop cartoon bones -> normal respawn', () => {
  const { levelState, mechState } = makePairState(0);
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;

  madjid.x = 120;
  nadine.x = 120 + GHOST_CONFIG.SPAWN_MAX + 120;

  let devoured = false;
  let bonesDropped = false;
  for (let i = 0; i < 360; i++) {
    stepGhostSystem(
      mechState,
      levelState,
      1 / 60,
      { forcedOutcome: 'devour', preferredStrayId: 'nadine' },
      {
        onGhostDevour() {
          devoured = true;
        },
        onBonesDrop() {
          bonesDropped = true;
        },
      }
    );
    if (bonesDropped) break;
  }

  assert.equal(devoured, true, 'Outcome B should trigger ghost devour');
  assert.equal(bonesDropped, true, 'Outcome B should drop cartoon bones in front of partner');
  assert.equal(nadine.devouredByGhost, false, 'Stray player should pop back out visible & normal');
  assert.equal(nadine.mood, 'normal');
  assert.equal(mechState.ghost.bones.length, 5, 'Should leave 5 cartoon bone/skull props');
  assert.ok(
    Math.abs(nadine.x - madjid.x) < 120,
    'Devoured player should respawn right beside partner'
  );
});

test('partner carry pickup, carried lock overhead, and gentle drop/toss', () => {
  const { levelState, mechState } = makePairState(0);
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;

  madjid.x = 200;
  madjid.y = 400;
  nadine.x = 225;
  nadine.y = 400;

  const pickRes = toggleCarry(mechState, levelState, 'madjid');
  assert.equal(pickRes.ok, true);
  assert.equal(pickRes.action, 'pickup');
  assert.equal(nadine.carriedBy, 'madjid');

  madjid.x = 320;
  syncCarriedActor(mechState, levelState);
  assert.equal(nadine.x, 320);
  assert.equal(nadine.y, madjid.y - CARRY_CONFIG.HEAD_OFFSET_Y);

  const dropRes = toggleCarry(mechState, levelState, 'madjid');
  assert.equal(dropRes.ok, true);
  assert.equal(dropRes.action, 'drop');
  assert.equal(nadine.carriedBy, null);
  assert.ok(nadine.vy < 0, 'Drop should gently toss partner upward');
});

test('soul-link synergy aura and cooperative edge rescue', () => {
  const { levelState, mechState } = makePairState(0);
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;

  madjid.x = 260;
  madjid.y = 420;
  madjid.grounded = true;
  nadine.x = 320;
  nadine.y = 420;
  nadine.grounded = false;
  nadine.vy = SOUL_LINK_CONFIG.RESCUE_MIN_FALL_VY + 40;

  const sl = stepSoulLinkAndRescue(mechState, levelState, 1 / 60);
  assert.equal(sl.active, true, 'Nearby partners activate Soul-Link aura');
  assert.ok(sl.rescueCandidate, 'Falling partner near grounded partner triggers rescue candidate');
  assert.equal(sl.rescueCandidate?.rescuerId, 'madjid');

  const rescued = triggerEdgeRescue(mechState, levelState, 'madjid');
  assert.equal(rescued.ok, true);
  assert.ok(nadine.vy < 0 && nadine.y < madjid.y, 'Rescued partner pops cleanly back up near rescuer');
});

test('8 dances support start, beat, co-op invite, and cancellation on movement', () => {
  assert.equal(DANCES.length, 8);
  const { levelState, mechState } = makePairState(0);

  DANCES.forEach((d) => {
    const started = startDance(mechState, levelState, 'madjid', d.id);
    assert.equal(started?.id, d.id);
    assert.equal(levelState.actors.madjid.danceStyle, d.id);
  });

  const inv = createDanceInvite(mechState, 'madjid', 'waltz');
  assert.equal(inv.style, 'waltz');

  // Movement input cancels dance cleanly
  stepDanceSystem(
    mechState,
    levelState,
    { madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() },
    1 / 60
  );
  assert.equal(mechState.dances.madjid, null);
  assert.equal(levelState.actors.madjid.danceStyle, null);
});

test('5 low-frequency rare idle interactions trigger after 10s stillness and cancel on input', () => {
  assert.equal(IDLE_COOP_INTERACTIONS.length, 5);
  const { levelState, mechState } = makePairState(0);
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;

  madjid.x = 180;
  madjid.y = 400;
  madjid.grounded = true;
  nadine.x = 220;
  nadine.y = 400;
  nadine.grounded = true;
  mechState.idleSpecial.cooldown = 0;

  const emptyInputs = { madjid: createEmptyIntent(), nadine: createEmptyIntent() };
  let triggeredCount = 0;
  for (let i = 0; i < Math.ceil((IDLE_SPECIAL_CONFIG.STILL_THRESHOLD_SEC + 0.5) * 20); i++) {
    stepRareIdleInteractions(mechState, levelState, emptyInputs, 0.05, {
      onIdleSpecial() {
        triggeredCount += 1;
      },
    });
    if (triggeredCount > 0) break;
  }

  assert.equal(triggeredCount, 1, 'Idle interaction should fire once after stillness threshold');
  assert.equal(mechState.idleSpecial.active, true);
  assert.ok(mechState.idleSpecial.cooldown >= IDLE_SPECIAL_CONFIG.COOLDOWN_SEC - 1);

  // Any movement immediately cancels the idle interaction
  stepRareIdleInteractions(
    mechState,
    levelState,
    { madjid: { ...createEmptyIntent(), left: true }, nadine: createEmptyIntent() },
    1 / 60
  );
  assert.equal(mechState.idleSpecial.active, false);
});

test('cooperative region bosses (stage 5s) & open-world boss defeat via crown weak-point stomps', () => {
  const stage1Boss = createBossForLevel(LEVELS[0]);
  assert.equal(stage1Boss, null);

  const stage5Level = LEVELS[4]; // W1-5
  const boss = createBossForLevel(stage5Level);
  assert.ok(boss);
  assert.equal(boss.hp, 3);
  assert.equal(getBossStatusLabel(boss), 'Crown Open · Stomp!');

  const levelState = createInitialLevelState(stage5Level);
  const mechState = createMechanicsState();

  // Force shield, verify teamwork proximity breaks shield
  boss.shielded = true;
  assert.equal(getBossStatusLabel(boss), 'Shielded · Team Up or Carry!');
  levelState.actors.madjid.x = 300;
  levelState.actors.nadine.x = 340;
  let shieldBroken = false;
  stepBoss(boss, levelState, mechState, 1 / 60, {
    onBossShieldBreak() {
      shieldBroken = true;
    },
  });
  assert.equal(shieldBroken, true);
  assert.equal(boss.shielded, false);

  // Stomp Crown 3 times -> defeats boss and unlocks Stage 5 portal
  let defeated = false;
  for (let hit = 0; hit < 3; hit++) {
    boss.hurtFlashTimer = 0;
    boss.shielded = false;
    levelState.actors.madjid.x = boss.x + 20;
    levelState.actors.madjid.y = boss.y - levelState.actors.madjid.h + 4;
    levelState.actors.madjid.vy = 180;
    stepBoss(boss, levelState, mechState, 1 / 60, {
      onBossDefeat() {
        defeated = true;
      },
    });
  }
  assert.equal(defeated, true);
  assert.equal(boss.defeated, true);
  assert.equal(levelState.portalUnlocked, true);

  const owBoss = createOpenWorldBoss(600, 2200);
  assert.equal(owBoss.isOpenWorld, true);
  assert.equal(owBoss.hp, 3);
});

test('scenic photo spots, scrapbook dedup merge, and regional weather mapping', () => {
  const storySpots = getPhotoSpotsForLevel(LEVELS[0]);
  const owSpots = getOpenWorldPhotoSpots(600);
  assert.equal(storySpots.length, 1);
  assert.equal(owSpots.length, 3);

  const madjid = { x: storySpots[0].x - 20, y: storySpots[0].y - 36, w: 34, h: 36, hurtTimer: 0 };
  const nadine = { x: storySpots[0].x + 8, y: storySpots[0].y - 36, w: 34, h: 36, hurtTimer: 0 };
  const active = findActivePhotoSpot(storySpots, madjid, nadine);
  assert.equal(active?.id, storySpots[0].id);

  const merged = mergeScrapbookPhotos(
    [{ id: 'p1', title: 'A' }],
    [
      { id: 'p2', title: 'B' },
      { id: 'p1', title: 'A' },
    ]
  );
  assert.equal(merged.length, 2);

  assert.ok(WEATHER_PRESETS[getWeatherForWorld(1)]);
  assert.ok(WEATHER_PRESETS[getWeatherForWorld(3)]);
  assert.ok(WEATHER_PRESETS[getWeatherForWorld(4)]);
  assert.ok(WEATHER_PRESETS[getWeatherForWorld(9)]);
});

function createSpyCanvasContext() {
  const calls: string[] = [];
  const noop = (name: string) => (..._args: unknown[]) => {
    calls.push(name);
  };
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    lineDashOffset: 0,
    save: noop('save'),
    restore: noop('restore'),
    beginPath: noop('beginPath'),
    closePath: noop('closePath'),
    moveTo: noop('moveTo'),
    lineTo: noop('lineTo'),
    quadraticCurveTo: noop('quadraticCurveTo'),
    arc: noop('arc'),
    ellipse: noop('ellipse'),
    rect: noop('rect'),
    roundRect: noop('roundRect'),
    fill: noop('fill'),
    stroke: noop('stroke'),
    fillRect: noop('fillRect'),
    strokeRect: noop('strokeRect'),
    clip: noop('clip'),
    translate: noop('translate'),
    rotate: noop('rotate'),
    setLineDash: noop('setLineDash'),
    fillText: noop('fillText'),
    strokeText: noop('strokeText'),
  };
}

test('terrain-renderer biome mapping, Open-World worldId preservation, and viewport culling', () => {
  assert.equal(getBiomeSurfaceType(1, 'sunrise'), 'meadow_turf');
  assert.equal(getBiomeSurfaceType(3, 'sunset'), 'harbor_timber');
  assert.equal(getBiomeSurfaceType(4, 'sunset'), 'canyon_sandstone');
  assert.equal(getBiomeSurfaceType(5, 'night'), 'desert_dune');
  assert.equal(getBiomeSurfaceType(6, 'sunrise'), 'alpine_moss');
  assert.equal(getBiomeSurfaceType(7, 'sunrise'), 'cloud_pagoda');
  assert.equal(getBiomeSurfaceType(8, 'night'), 'crystal_geode');
  assert.equal(getBiomeSurfaceType(9, 'night'), 'moonlit_garden');
  assert.equal(getBiomeSurfaceType(10, 'sunrise'), 'summit_marble');
  assert.equal(getBiomeSurfaceType(0, 'sunrise'), 'meadow_turf');
  assert.equal(getBiomeSurfaceType(0, 'sunset'), 'canyon_sandstone');
  assert.equal(getBiomeSurfaceType(0, 'night'), 'moonlit_garden');

  const owStateDef = createInitialLevelState(createOpenWorldLevelDefinition('night'));
  assert.equal(owStateDef.worldId, 0);
  assert.equal(owStateDef.theme, 'night');

  const style = {
    top: '#60A96A',
    topRim: '#B4EB9D',
    body: '#4C3D52',
    trim: '#261C2E',
  };

  // Off-screen platform & hazard should cull cleanly with zero draw calls
  const culledCtx = createSpyCanvasContext();
  drawTerrainPlatform(
    culledCtx,
    { x: 2400, y: 400, w: 120, h: 24, kind: 'ledge' },
    style,
    1,
    'sunrise',
    1.2,
    { minX: 0, maxX: 900 }
  );
  drawHazardObstacle(
    culledCtx,
    { x: 2400, y: 500, w: 60, h: 18, kind: 'spikes' },
    1.2,
    { minX: 0, maxX: 900 }
  );
  assert.equal(culledCtx.calls.length, 0, 'Off-screen terrain & hazards should be culled');

  // Visible terrain variants + puzzle mechanisms + all hazard kinds draw cleanly
  const activeCtx = createSpyCanvasContext();
  const sampleKinds = [
    { x: 0, y: 520, w: 600, h: 120, kind: 'ground' },
    { x: 180, y: 380, w: 160, h: 24, kind: 'ledge' },
    { x: 380, y: 300, w: 40, h: 120, kind: 'pillar' },
    { x: 460, y: 360, w: 68, h: 92, kind: 'archway' },
  ];
  for (const plat of sampleKinds) {
    drawTerrainPlatform(activeCtx, plat, style, 3, 'sunset', 2.4, { minX: -100, maxX: 1000 });
  }
  const sw = { id: 's1', x: 120, y: 520, w: 40, h: 12, color: '#F59E0B', pressDepth: 0.8, mode: 'toggle', label: 'A' };
  const g = { id: 'g1', x: 480, y: 420, w: 26, h: 100, closedX: 480, closedY: 420, openProgress: 0, color: '#F59E0B', switches: ['s1'] };
  const mp = { x: 240, y: 440, w: 96, h: 20, startX: 200, startY: 440, endX: 360, endY: 440, color: '#38BDF8' };
  drawLinkCable(activeCtx, sw, 493, 470, true, 2.4);
  drawGuideRail(activeCtx, mp);
  drawMovingPlatform(activeCtx, mp, 2.4, true);
  drawGateBarrier(activeCtx, g, { switches: [sw] }, 2.4, () => true);
  drawSwitchMechanism(activeCtx, sw, true, 2.4);
  drawHazardObstacle(activeCtx, { x: 280, y: 504, w: 55, h: 16, kind: 'thorns' }, 2.4, { minX: -100, maxX: 1000 });
  drawHazardObstacle(activeCtx, { x: 350, y: 504, w: 55, h: 16, kind: 'spikes' }, 2.4, { minX: -100, maxX: 1000 });
  drawHazardObstacle(activeCtx, { x: 420, y: 504, w: 55, h: 16, kind: 'crystals' }, 2.4, { minX: -100, maxX: 1000 });
  assert.ok(activeCtx.calls.includes('roundRect') && activeCtx.calls.includes('stroke'));

  // Open-World blocks render with viewRange culling
  const ow = createOpenWorldState(
    [
      { gx: 2, gy: 14, type: 'wood' },
      { gx: 3, gy: 14, type: 'stone' },
      { gx: 4, gy: 13, type: 'bridge' },
      { gx: 5, gy: 14, type: 'lantern' },
      { gx: 6, gy: 14, type: 'flower' },
      { gx: 7, gy: 14, type: 'arch' },
      { gx: 50, gy: 14, type: 'wood' },
    ],
    undefined,
    'sunrise'
  );
  const owCtx = createSpyCanvasContext();
  renderOpenWorldBlocks(owCtx, ow, 1.5, { gx: 2, gy: 13 }, 'stone', { minX: 0, maxX: 500 });
  assert.ok(owCtx.calls.length > 20, 'Visible open-world blocks should draw');
});

