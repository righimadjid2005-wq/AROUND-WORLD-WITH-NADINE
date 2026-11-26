import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BGM_TRACKS, createAudioEngine, getPreferredTrackIdForContext } from './audio.js';
import {
  AFFECTION,
  PHYSICS,
  computePortalUnlocked,
  createEmptyIntent,
  createInitialLevelState,
  findOverlappingLadder,
  isHazardActive,
  isSafeForAffection,
  stepEscapeSequence,
  stepLadders,
  stepSimulation,
  tryCarryBlockInteraction,
  triggerEscapeFailRespawn,
  triggerManualSoulDash,
} from './game.js';
import {
  LEVELS,
  STORY_PREMISE,
  WORLDS,
  getLevelsForWorld,
  getWorldById,
  registerWorldPack,
} from './levels.js';
import { SKINS, getSkin, getSkinsForCharacter, registerSkin } from './skins.js';
import { TIME_PRESETS, createBackgroundSystem } from './background.js';
import {
  WEAPON_IDS,
  cycleActorWeapon,
  pickupNearbyWeapon,
  triggerWeaponAction,
} from './weapons.js';
import {
  applyActorDamage,
  healActor,
  spawnHealthOrb,
  triggerTeamRespawnAtCheckpoint,
} from './health-combat.js';
import { createMechanicsState, toggleCarry } from './coop-mechanics.js';
import { damageSecondaryMonster, stepSecondaryMonsters } from './monsters.js';
import { PUZZLE_GLYPHS, interactWithNearbyPuzzle, isCheckpointUnlocked, stepPuzzles } from './puzzles.js';
import { createRoomManager } from './coop-server-core.js';
import { canToolDamageBarrier, stepFoliageSystem } from './foliage.js';
import { createBossForLevel } from './bosses.js';
import { buildCustomSkinConfig } from './skin-studio.js';
import { getDynamicTrapSolids, resetDynamicTraps, stepDynamicTraps } from './traps.js';

type LevelState = ReturnType<typeof createInitialLevelState>;
type Intent = ReturnType<typeof createEmptyIntent>;

function runFrames(
  state: LevelState,
  inputsFn: (frame: number, s: LevelState) => Record<string, Intent>,
  frames: number,
  dt = 1 / 60,
  callbacks: Record<string, (...args: unknown[]) => void> = {}
) {
  for (let i = 0; i < frames; i++) {
    stepSimulation(state, inputsFn(i, state), dt, callbacks);
  }
}

test('campaign integrity: 5 seamless worlds (Jungle, Ice Lands, Volcano, Space, Ocean World), boss-locked doors, safe spawns & zero NaN', () => {
  assert.equal(WORLDS.length, 5, 'Campaign must have 5 seamless worlds');
  assert.equal(LEVELS.length, 5, 'Campaign must have 5 continuous world levels');
  assert.deepEqual(
    WORLDS.map((w: { name: string }) => w.name),
    ['Jungle', 'Ice Lands', 'Volcano', 'Space', 'Ocean World']
  );
  assert.ok(STORY_PREMISE.includes('Madjid') && STORY_PREMISE.includes('Nadine'));

  const presets = TIME_PRESETS as Record<string, unknown>;
  const seenIds = new Set<number>();
  const seenCodes = new Set<string>();
  const seenTitles = new Set<string>();

  for (const world of WORLDS) {
    const worldStages = getLevelsForWorld(world.id);
    assert.equal(worldStages.length, 1, `World ${world.id} (${world.name}) must be 1 continuous seamless world`);
    assert.equal(getWorldById(world.id).name, world.name);
  }

  for (const level of LEVELS) {
    assert.ok(!seenIds.has(level.id), `Duplicate level id ${level.id}`);
    assert.ok(!seenCodes.has(level.code), `Duplicate level code ${level.code}`);
    assert.ok(!seenTitles.has(level.title), `Duplicate level title ${level.title}`);
    seenIds.add(level.id);
    seenCodes.add(level.code);
    seenTitles.add(level.title);

    assert.ok(presets[level.theme], `World ${level.code} must use a valid atmosphere theme`);
    assert.ok(level.caption.length > 20, `World ${level.code} must have a warm story caption`);
    assert.ok(level.exit.keysRequired >= 1, `World ${level.code} must require at least 1 key`);
    assert.equal(level.keys.length, level.exit.keysRequired, `World ${level.code} key count matches requirement`);
    assert.equal(level.exit.requiresBossDefeat, true, `World ${level.code} World Door must stay boss-locked`);
    assert.ok(level.puzzles && level.puzzles.length >= 1, `World ${level.code} must feature an in-world puzzle`);
    assert.ok(level.monsters && level.monsters.length >= 1, `World ${level.code} must feature secondary grotesque monsters`);
    assert.ok(level.arrowTraps && level.arrowTraps.length >= 1, `World ${level.code} must feature moving arrow traps`);

    // Verify all switches rest flush on a static platform and are referenced cleanly
    const switchIds = new Set(level.switches.map((s: { id: string }) => s.id));
    for (const sw of level.switches) {
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === sw.y && sw.x >= p.x && sw.x + sw.w <= p.x + p.w
      );
      assert.ok(host, `World ${level.code} switch ${sw.id} must rest flush on a static platform`);
    }
    for (const g of level.gates) {
      for (const sid of g.switches) {
        assert.ok(switchIds.has(sid), `World ${level.code} gate ${g.id} references valid switch ${sid}`);
      }
    }
    for (const mp of level.movingPlatforms as Array<{ id: string; switches?: string[]; patrolSwitches?: string[] }>) {
      for (const sid of [...(mp.switches || []), ...(mp.patrolSwitches || [])]) {
        assert.ok(switchIds.has(sid), `World ${level.code} moving platform ${mp.id} references valid switch ${sid}`);
      }
    }

    // Verify all checkpoints rest flush on a static platform with no hazard overlap
    for (const cp of level.checkpoints) {
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === cp.y && cp.x >= p.x + 12 && cp.x <= p.x + p.w - 12
      );
      assert.ok(host, `World ${level.code} checkpoint ${cp.id} must sit flush on a static platform`);
      for (const hz of level.hazards) {
        assert.ok(
          Math.abs(cp.x - (hz.x + hz.w * 0.5)) >= 48,
          `World ${level.code} checkpoint ${cp.id} must stay clear of hazard ${hz.id}`
        );
      }
    }

    // Verify grounded hazards rest flush on static platforms and floating hazards stay within world bounds
    for (const hz of level.hazards as Array<{ id: string; x: number; y: number; w: number; h: number; floating?: boolean }>) {
      if (hz.floating) {
        assert.ok(
          hz.x >= 0 && hz.x + hz.w <= level.worldWidth && hz.y >= 0 && hz.y + hz.h <= level.worldHeight,
          `World ${level.code} floating hazard ${hz.id} must stay inside world bounds`
        );
      } else {
        const host = level.platforms.find(
          (p: { x: number; y: number; w: number }) =>
            p.y === hz.y + hz.h && hz.x >= p.x && hz.x + hz.w <= p.x + p.w
        );
        assert.ok(host, `World ${level.code} hazard ${hz.id} must sit flush on a static platform`);
      }
    }

    // Verify spawns settle grounded, full 100/100 HP, safe, and free of NaN within 15 frames
    const state = createInitialLevelState(level);
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 15);
    assert.equal(state.actors.madjid.grounded, true, `World ${level.code} Madjid spawn grounded`);
    assert.equal(state.actors.nadine.grounded, true, `World ${level.code} Nadine spawn grounded`);
    assert.equal(state.actors.madjid.hp, 100);
    assert.equal(state.actors.nadine.hp, 100);
    assert.equal(Number.isNaN(state.actors.madjid.x), false);
    assert.equal(Number.isNaN(state.actors.nadine.y), false);
    assert.equal(isSafeForAffection(state), true, `World ${level.code} spawns must be in calm safe state`);
    assert.equal(state.completed, false);
  }

  const finalExit = LEVELS[4].exit as { isWeddingArch?: boolean };
  assert.equal(finalExit.isWeddingArch, true, 'World 5 (Ocean World) must feature the Wedding Arch');
});

test('responsive platformer feel: acceleration, friction, coyote time, jump buffer, and variable jump cut', () => {
  const state = createInitialLevelState(LEVELS[0]);
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 5);
  assert.equal(state.actors.madjid.grounded, true);

  runFrames(
    state,
    () => ({
      madjid: { ...createEmptyIntent(), right: true },
      nadine: createEmptyIntent(),
    }),
    15
  );
  assert.ok(state.actors.madjid.vx > 200, 'Madjid accelerates smoothly to the right');

  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 20);
  assert.equal(state.actors.madjid.vx, 0, 'Friction stops character cleanly');

  state.actors.madjid.grounded = false;
  state.actors.madjid.coyoteTimer = PHYSICS.COYOTE_TIME;
  stepSimulation(
    state,
    {
      madjid: { ...createEmptyIntent(), jumpHeld: true, jumpJustPressed: true },
      nadine: createEmptyIntent(),
    },
    1 / 60
  );
  assert.ok(state.actors.madjid.vy < -500, 'Coyote time permits jump just after leaving a ledge');

  const preCutVy = state.actors.madjid.vy;
  stepSimulation(
    state,
    {
      madjid: { ...createEmptyIntent(), jumpHeld: false, jumpJustReleased: true },
      nadine: createEmptyIntent(),
    },
    1 / 60
  );
  assert.ok(state.actors.madjid.vy > preCutVy * 0.65, 'Releasing jump early cuts upward velocity');

  const bufferState = createInitialLevelState(LEVELS[0]);
  bufferState.actors.madjid.y = 556;
  bufferState.actors.madjid.vy = 140;
  bufferState.actors.madjid.grounded = false;
  bufferState.actors.madjid.coyoteTimer = 0;

  let jumped = false;
  stepSimulation(
    bufferState,
    {
      madjid: { ...createEmptyIntent(), jumpHeld: true, jumpJustPressed: true },
      nadine: createEmptyIntent(),
    },
    1 / 60,
    {
      onJump: () => {
        jumped = true;
      },
    }
  );
  runFrames(
    bufferState,
    () => ({ madjid: { ...createEmptyIntent(), jumpHeld: true }, nadine: createEmptyIntent() }),
    6,
    1 / 60,
    {
      onJump: () => {
        jumped = true;
      },
    }
  );
  assert.equal(jumped, true, 'Buffered jump triggers immediately on landing');
});

test('cooperative world mechanics: switch raises moving lift, keys + boss defeat unlock World Door, both required to complete', () => {
  const state = createInitialLevelState(LEVELS[0]);
  const swFerry = state.switches.find((s: { id: string }) => s.id === 'sw_w1_ferry')!;
  const lift = state.movingPlatforms.find((m: { id: string }) => m.id === 'mp_w1_canopy')!;

  // Step onto Vine Lift toggle switch -> moving platform rises smoothly
  state.actors.madjid.x = swFerry.x + 8;
  state.actors.madjid.y = swFerry.y - PHYSICS.CHAR_H;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 60);
  assert.equal(swFerry.toggled, true);
  assert.ok(lift.y < lift.startY - 30, 'Vine Lift rises toward canopy bridge when toggled');

  // Collect both keys -> World Door still locked until boss is defeated
  state.keys.forEach((key: { x: number; y: number }) => {
    state.actors.nadine.x = key.x - 10;
    state.actors.nadine.y = key.y - 10;
    stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  });
  assert.equal(state.keysCollected, 2);
  assert.equal(state.bossDefeated, false);
  assert.equal(computePortalUnlocked(state), false, 'World Door stays locked while World Boss is undefeated');

  // Defeat boss -> World Door unlocks
  state.bossDefeated = true;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.portalUnlocked, true, 'Defeating Boss + collecting keys unlocks World Door');

  // One player in door waits for partner
  state.actors.nadine.x = state.exit.x + 20;
  state.actors.nadine.y = state.exit.y + state.exit.h - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.completed, false, 'Exit door waits for BOTH Madjid and Nadine');

  state.actors.madjid.x = state.exit.x + 24;
  state.actors.madjid.y = state.exit.y + state.exit.h - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.completed, true, 'Both characters together in unlocked World Door complete the World');
});

test('100/100 HP combat health system, hazards, +35 HP Health Orbs, checkpoint full heal, 0 HP Game Over & team respawn', () => {
  const state = createInitialLevelState(LEVELS[0]);
  const cp = state.checkpoints[0];
  const hz = state.hazards[0];

  let damageEvents = 0;
  let healEvents = 0;
  let zeroHpEvents = 0;
  let cryEvents = 0;
  let respawnEvents = 0;

  const callbacks = {
    onDamage: () => {
      damageEvents += 1;
    },
    onHeal: () => {
      healEvents += 1;
    },
    onZeroHp: () => {
      zeroHpEvents += 1;
    },
    onCry: () => {
      cryEvents += 1;
    },
    onRespawn: () => {
      respawnEvents += 1;
    },
  };

  // Injure Madjid slightly first, then walk onto Checkpoint -> Checkpoint heals team to 100/100 HP!
  applyActorDamage(state, state.actors.madjid, 25, { ignoreInvuln: true, cause: 'test' }, callbacks);
  assert.equal(state.actors.madjid.hp, 75);
  assert.equal(damageEvents, 1);

  state.actors.madjid.invulnTimer = 0;
  state.actors.madjid.x = cp.x - 10;
  state.actors.madjid.y = cp.y - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  assert.equal(cp.activated, true);
  assert.equal(state.actors.madjid.hp, 100, 'Checkpoint restores team to full 100/100 HP');
  assert.ok(healEvents >= 1);

  // Hazard deals multi-hit damage (~20) rather than instant 1-hit death
  state.actors.madjid.invulnTimer = 0;
  state.actors.madjid.x = hz.x + 8;
  state.actors.madjid.y = hz.y - PHYSICS.CHAR_H + 6;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  assert.equal(state.actors.madjid.hp, 80, 'Hazard takes 20 HP instead of 1-hit insta-death');
  assert.equal(state.gameOver, false);
  assert.ok(state.actors.madjid.invulnTimer > 0.5, 'Damage grants brief invulnerability frames');

  // Health Orb heals +35 HP capped cleanly at 100
  applyActorDamage(state, state.actors.madjid, 30, { ignoreInvuln: true, cause: 'test' }, callbacks);
  assert.equal(state.actors.madjid.hp, 50);
  const orb = spawnHealthOrb(state, state.actors.madjid.x + 17, state.actors.madjid.y + 18, 35);
  assert.ok(orb);
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  assert.equal(state.actors.madjid.hp, 85, 'Health Orb heals +35 HP');
  healActor(state, state.actors.madjid, 35, callbacks);
  assert.equal(state.actors.madjid.hp, 100);

  // Dropping to 0 HP triggers Cry + Try Again Game Over, preserving defeat until Checkpoint Team Respawn
  applyActorDamage(state, state.actors.madjid, 100, { ignoreInvuln: true, cause: 'Trap' }, callbacks);
  assert.equal(state.actors.madjid.hp, 0);
  assert.equal(state.gameOver, true);
  assert.equal(zeroHpEvents, 1);
  assert.equal(cryEvents, 1);
  assert.equal(state.actors.madjid.mood, 'crying');

  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 70, 1 / 60, callbacks);
  assert.equal(state.gameOver, true, 'Game Over modal state stays active until explicit respawn');

  triggerTeamRespawnAtCheckpoint(state, callbacks);
  assert.equal(respawnEvents, 1);
  assert.equal(state.gameOver, false);
  assert.equal(state.actors.madjid.hp, 100);
  assert.equal(state.actors.nadine.hp, 100);
  assert.ok(Math.abs(state.actors.madjid.x - (state.activeCheckpoint as { madjid: { x: number } }).madjid.x) < 4);
});

test('carry-required heavy relic blocks: strict mutex with partner carry, pedestal gate unlock, wall-safe drop & hazard snap-back', () => {
  const state = createInitialLevelState(LEVELS[0]);
  const mechState = createMechanicsState();
  const madjid = state.actors.madjid;
  const block = state.carryBlocks[0];
  const ped = state.carryPedestals[0];
  const gate = state.gates.find((g: { id: string }) => g.id === 'gate_w1_carry')!;

  assert.equal(gate.latchedOpen, false);

  // Pickup block
  madjid.x = block.x - 4;
  madjid.y = block.y;
  const pick = tryCarryBlockInteraction(state, mechState, 'madjid');
  assert.equal(pick.ok, true);
  assert.equal(pick.action, 'pickup');
  assert.equal(madjid.carryingBlockId, block.id);
  assert.equal(block.carriedBy, 'madjid');

  // Strict mutex: cannot also carry partner while carrying a heavy block
  state.actors.nadine.x = madjid.x + 12;
  state.actors.nadine.y = madjid.y;
  const partnerAttempt = toggleCarry(mechState, state, 'madjid');
  assert.equal(partnerAttempt.ok, false);

  // Carry over pedestal & set down -> pedestal occupied & gate unlocks!
  madjid.x = ped.x + 6;
  madjid.y = ped.y - PHYSICS.CHAR_H;
  madjid.facing = 1;
  const drop = tryCarryBlockInteraction(state, mechState, 'madjid');
  assert.equal(drop.ok, true);
  assert.equal(drop.action, 'drop');
  assert.equal(madjid.carryingBlockId, null);

  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 45);
  assert.equal(ped.occupied, true, 'Relic block activates pedestal when dropped onto it');
  assert.equal(gate.latchedOpen, true, 'Carry pedestal opens gate_w1_carry cleanly');

  // Pit snap-back: drop block into abyss -> snaps cleanly back to original position
  block.x = 600;
  block.y = state.worldHeight + 120;
  let snapped = false;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, {
    onBlockSnapBack: () => {
      snapped = true;
    },
  });
  assert.equal(snapped, true);
  assert.equal(block.x, block.homeX);
  assert.equal(block.y, block.homeY);
});

test('moving hazards (arrow traps): telegraph -> fire projectile -> stop on wall -> hit vulnerable actor -> phaseDash immune', () => {
  const state = createInitialLevelState(LEVELS[0]);
  const trap = state.arrowTraps[0];
  assert.ok(trap);

  let fired = 0;
  trap.timer = 0.05;
  runFrames(
    state,
    () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }),
    10,
    1 / 60,
    {
      onArrowFire: () => {
        fired += 1;
      },
    }
  );
  assert.equal(fired, 1, 'Arrow trap fires after cooldown + telegraph');
  assert.ok(state.arrowProjectiles.length >= 1, 'Arrow projectile spawns cleanly');

  // Place projectile directly ahead of Madjid -> damages HP; verify Phase-Dash is immune
  const proj = state.arrowProjectiles[0];
  state.actors.madjid.invulnTimer = 0;
  state.actors.madjid.x = proj.x + (trap.dir > 0 ? 12 : -44);
  state.actors.madjid.y = proj.y - 16;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 8);
  assert.ok(state.actors.madjid.hp < 100, 'Arrow projectile deals HP damage');

  // Spawn projectile against phase-dashing actor -> ignored
  const prevHp = state.actors.madjid.hp;
  state.actors.madjid.invulnTimer = 0;
  state.actors.madjid.phaseDash = { active: true, targetX: state.actors.madjid.x + 80, targetY: state.actors.madjid.y };
  state.arrowProjectiles.push({
    x: state.actors.madjid.x + 12,
    y: state.actors.madjid.y + 16,
    vx: 180,
    vy: 0,
    w: 16,
    h: 5,
    damage: 20,
    life: 2,
    biome: 'jungle',
  });
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.actors.madjid.hp, prevHp, 'Phase-dashing player is immune to arrow projectiles');
});

test('in-world Canvas2D puzzles (alignment pillars + conduit locks) & manual Soul Dash (Shift/C)', () => {
  // 1. World 1 alignment pillars unlock gate_w1_temple
  const w1 = createInitialLevelState(LEVELS[0]);
  const puz = w1.puzzles[0];
  const templeGate = w1.gates.find((g: { id: string }) => g.id === puz.targetGateId)!;
  assert.equal(templeGate.latchedOpen, false);

  // Cycle pillars until matching ['sun', 'moon', 'leaf']
  const desiredIndices = [0, 1, 2]; // sun=0, moon=1, leaf=2
  puz.nodes.forEach((node: { x: number; y: number; glyphIndex: number }, idx: number) => {
    w1.actors.madjid.x = node.x;
    w1.actors.madjid.y = node.y - PHYSICS.CHAR_H;
    while (node.glyphIndex !== desiredIndices[idx]) {
      const res = interactWithNearbyPuzzle(w1, w1.actors.madjid, {});
      assert.equal(res.ok, true);
    }
  });
  stepPuzzles(w1, 1 / 60);
  assert.equal(puz.solved, true);
  assert.equal(templeGate.latchedOpen, true, 'Solved alignment puzzle unlocks linked gate cleanly');

  // 2. Manual Soul Dash: horizontal glide + solid-safe landing + 2.0s cooldown
  const dashState = createInitialLevelState(LEVELS[0]);
  const madjid = dashState.actors.madjid;
  const startX = madjid.x;
  const d1 = triggerManualSoulDash(dashState, madjid, 1);
  assert.equal(d1.ok, true);
  assert.ok(madjid.dashCooldown >= 1.9, 'Soul Dash sets 2.0s cooldown');
  assert.equal(madjid.phaseDash?.active, true);
  assert.equal(triggerManualSoulDash(dashState, madjid, 1).ok, false, 'Soul Dash blocked while dashing/on cooldown');

  runFrames(dashState, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 25);
  assert.equal(madjid.phaseDash, null);
  assert.ok(madjid.x > startX + 80, 'Manual Soul Dash propels player smoothly forward');
});

test('gentle safe-state automatic kiss: triggers when calm & safe, respects cooldown, suppressed by danger, canceled on input', () => {
  const state = createInitialLevelState(LEVELS[0]);
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 10);
  assert.equal(isSafeForAffection(state), true);

  let kissEvents = 0;
  let sparkleEvents = 0;
  const callbacks = {
    onKiss: () => {
      kissEvents += 1;
    },
    onCozySparkle: () => {
      sparkleEvents += 1;
    },
  };

  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 160, 1 / 60, callbacks);
  assert.equal(kissEvents, 1, 'Automatic kiss triggers smoothly in safe rest state');
  assert.equal(state.kissCount, 1);
  assert.ok(state.kissTimer > 0, 'Kiss remains active briefly');
  assert.equal(state.actors.madjid.mood, 'kissing');
  assert.equal(state.actors.nadine.mood, 'kissing');
  assert.ok(Math.abs(state.actors.madjid.kissLean) > 0, 'Characters lean gently toward each other during kiss');

  stepSimulation(
    state,
    { madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() },
    1 / 60,
    callbacks
  );
  assert.equal(state.kissTimer, 0, 'Player input immediately cancels kiss animation');
  assert.ok(state.actors.madjid.vx > 0, 'Player movement responds on the exact same frame');

  state.actors.madjid.x = state.actors.nadine.x - 48;
  state.actors.madjid.vx = 0;
  state.actors.nadine.vx = 0;
  state.idleBounceTimer = 0.2;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 120, 1 / 60, callbacks);
  assert.equal(kissEvents, 1, 'Cooldown prevents kiss spamming');
  assert.ok(sparkleEvents >= 1, 'Cozy idle bounce/sparkle occurs gently while resting safely');

  // Danger suppression check: place hazard right beside spawns
  const dangerState = createInitialLevelState(LEVELS[0]);
  runFrames(dangerState, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 10);
  dangerState.kissCooldown = 0;
  dangerState.hazards.push({
    id: 'hz_near_test',
    x: dangerState.actors.nadine.x + 60,
    y: 586,
    w: 48,
    h: 14,
    kind: 'thorns',
  });
  assert.equal(
    isSafeForAffection(dangerState),
    false,
    `Hazard within ${AFFECTION.HAZARD_SAFE_RADIUS}px suppresses safe-state affection`
  );
  let dangerKiss = 0;
  runFrames(
    dangerState,
    () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }),
    90,
    1 / 60,
    {
      onKiss: () => {
        dangerKiss += 1;
      },
    }
  );
  assert.equal(dangerKiss, 0, 'Automatic kiss must NOT trigger when hazard is nearby');
});

test('tools & weapons, tool-gated multi-stage barriers, secondary monsters + Orb drops, foliage spring physics & Skin Studio', () => {
  assert.equal(getSkinsForCharacter('madjid').length >= 10, true, 'Madjid must have at least 10 skins');
  assert.equal(getSkinsForCharacter('nadine').length >= 10, true, 'Nadine must have at least 10 skins');
  assert.deepEqual(WEAPON_IDS, ['light_sword', 'crystal_hammer', 'energy_wand', 'mechanism_key']);

  // 1. Custom Skin Studio config builder
  const customLook = buildCustomSkinConfig({
    character: 'nadine',
    name: 'Coral Crown',
    body: '#22d3ee',
    accent: '#fde047',
    pattern: 'starry',
    headgear: 'crown',
    aura: 'hearts',
  });
  registerSkin(customLook);
  assert.equal(getSkin('nadine', customLook.id).name, 'Coral Crown');
  assert.equal(customLook.palette.body, '#22D3EE');

  // 2. World 1 Light Sword + Vine Barrier tool gating
  const state = createInitialLevelState(LEVELS[0]);
  const swordPickup = state.weaponPickups.find((w: { weaponId: string }) => w.weaponId === 'light_sword')!;
  const vineBarrier = state.fragileBarriers.find((b: { material: string }) => b.material === 'vine')!;
  const actor = state.actors.madjid;

  // Wrong tool bounces off cleanly
  actor.weapons = ['crystal_hammer'];
  actor.equippedWeapon = 'crystal_hammer';
  assert.equal(canToolDamageBarrier(vineBarrier, 'crystal_hammer'), false);
  assert.equal(canToolDamageBarrier(vineBarrier, 'light_sword'), true);

  actor.x = swordPickup.x - actor.w * 0.5;
  actor.y = swordPickup.y - actor.h * 0.5;
  const collected = pickupNearbyWeapon(state, actor, 48);
  assert.ok(collected, 'Player collects nearby weapon pickup');
  assert.equal(actor.equippedWeapon, 'light_sword');
  assert.equal(cycleActorWeapon(actor), 'crystal_hammer');
  assert.equal(cycleActorWeapon(actor), 'light_sword');

  actor.x = vineBarrier.x - actor.w - 6;
  actor.y = vineBarrier.y + vineBarrier.h - actor.h;
  actor.facing = 1;
  actor.weaponAttack.cooldown = 0;
  triggerWeaponAction(state, actor);
  actor.weaponAttack.cooldown = 0;
  triggerWeaponAction(state, actor);
  assert.equal(vineBarrier.broken, true, 'Matching Light Sword cuts down multi-hit vine barrier');

  // 3. Secondary grotesque monster defeat spawns +35 HP Health Orb
  const mon = state.monsters[0];
  let orbSpawned = false;
  damageSecondaryMonster(state, mon, 999, actor, 'light_sword', {
    onMonsterDefeat: () => {
      orbSpawned = true;
    },
  });
  assert.equal(orbSpawned, true);
  assert.ok(state.healthOrbs.length >= 1, 'Defeated secondary monster drops a +35 HP Health Orb');
  stepSecondaryMonsters(state, 1 / 60);

  // 4. Foliage spring physics deflects when player runs past
  const patch = state.foliage[0];
  const initialAngle = patch.bendAngle;
  actor.x = patch.x;
  actor.y = patch.y - PHYSICS.CHAR_H;
  actor.vx = 220;
  stepFoliageSystem(state.foliage, [actor], 1 / 60, 'normal', []);
  assert.notEqual(patch.bendAngle, initialAngle, 'Foliage blades bend dynamically as characters brush through');
});

test('modular skin registry, world-themed background landmarks, and registerWorldPack expansion', () => {
  const custom = registerSkin({
    id: 'test-explorer',
    character: 'madjid',
    name: 'Test Explorer',
    tagline: 'Unit test skin',
    palette: { ...SKINS.madjid[0].palette },
    drawBack: null,
    drawFront: null,
  });
  assert.equal(getSkin('madjid', 'test-explorer').id, custom.id);

  const bg = createBackgroundSystem('jungle');
  assert.equal(bg.getThemeName(), 'jungle');
  bg.setTheme('ocean', false, { landmark: 'coral_temple', ambient: 'bubbles' });
  assert.equal(bg.getThemeName(), 'ocean');
  assert.equal(bg.getLandmarkStyle(), 'coral_temple');
  bg.update(0.05);
  assert.ok(bg.getPlatformStyle().top.startsWith('#'));

  // Test future world pack registration without modifying engine code
  const initialWorlds = WORLDS.length;
  const initialLevels = LEVELS.length;
  const packResult = registerWorldPack(
    {
      id: 6,
      slug: 'aurora',
      name: 'Aurora Isles',
      subtitle: 'Bonus honeymoon voyage',
      theme: 'night',
      landmark: 'lighthouse',
      ambient: 'fireflies',
      enemyKind: 'wisp',
      hazardKind: 'crystals',
      accentColor: '#7CE0D8',
      platformPalette: WORLDS[0].platformPalette,
    },
    [{ ...LEVELS[0], id: 6, code: '6', title: 'Northern Lights Pier' }]
  );
  assert.equal(packResult.totalWorlds, initialWorlds + 1);
  assert.equal(packResult.totalLevels, initialLevels + 1);
  assert.equal(getWorldById(6).name, 'Aurora Isles');
  assert.equal(getLevelsForWorld(6).length, 1);
});

test('5-world gameplay diversity: Ice glide, Volcano thermal vents, Space 4-way zero-G + cycling lasers, and Ocean 4-way swim + currents', () => {
  // 1. World 2 (Ice Lands): low friction glide vs World 1
  const w1 = createInitialLevelState(LEVELS[0]);
  const w2 = createInitialLevelState(LEVELS[1]);
  assert.equal(w2.groundFrictionScale, 0.11);
  runFrames(w1, () => ({ madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() }), 15);
  runFrames(w2, () => ({ madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() }), 15);
  const w1ReleaseX = w1.actors.madjid.x;
  const w2ReleaseX = w2.actors.madjid.x;
  runFrames(w1, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 18);
  runFrames(w2, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 18);
  assert.ok(w2.actors.madjid.x - w2ReleaseX > (w1.actors.madjid.x - w1ReleaseX) * 1.5, 'Ice Lands slides notably farther than Jungle');

  // 2. World 3 (Volcano): rising thermalVents lift character upward over magma pools
  const w3 = createInitialLevelState(LEVELS[2]);
  const vent = w3.thermalVents[0];
  assert.ok(vent);
  w3.actors.madjid.x = vent.x + 12;
  w3.actors.madjid.y = vent.y + vent.h - 60;
  w3.actors.madjid.vy = 40;
  const beforeVentY = w3.actors.madjid.y;
  runFrames(w3, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 20);
  assert.ok(w3.actors.madjid.y < beforeVentY - 15, 'Volcanic thermal vent pushes player upward');

  // 3. World 4 (Space): true 4-way Zero-G thrusters + cycling laser_beam safe phase
  const w4 = createInitialLevelState(LEVELS[3]);
  assert.equal(w4.physicsMode, 'space_swim');
  w4.actors.madjid.x = 560;
  w4.actors.madjid.y = 320;
  runFrames(w4, () => ({ madjid: { ...createEmptyIntent(), up: true, jumpHeld: true }, nadine: createEmptyIntent() }), 20);
  assert.ok(w4.actors.madjid.y < 290, 'Space Zero-G upward thrust lifts character smoothly');
  const peakY = w4.actors.madjid.y;
  runFrames(w4, () => ({ madjid: { ...createEmptyIntent(), down: true }, nadine: createEmptyIntent() }), 50);
  assert.ok(w4.actors.madjid.vy > 150, 'Space Zero-G downward thrust reverses upward drift into dive');
  assert.ok(w4.actors.madjid.y > peakY + 15, 'Space Zero-G downward thrust dives cleanly');

  const laser = w4.hazards.find((h: { kind?: string }) => h.kind === 'laser_beam')!;
  assert.ok(laser);
  assert.equal(isHazardActive(laser, 0.2), true, 'Laser beam is active during firing phase');
  assert.equal(isHazardActive(laser, 2.3), false, 'Laser beam turns off safely during cooldown phase');

  // 4. World 5 (Ocean World): 4-way swimming + directional oceanCurrents drift
  const w5 = createInitialLevelState(LEVELS[4]);
  assert.equal(w5.physicsMode, 'underwater');
  const cur = w5.oceanCurrents[0];
  assert.ok(cur);
  w5.actors.nadine.x = cur.x + 20;
  w5.actors.nadine.y = cur.y + 120;
  const startCurX = w5.actors.nadine.x;
  runFrames(w5, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 25);
  assert.ok(w5.actors.nadine.x > startCurX + 10, 'Ocean current carries swimmer horizontally along flow');

  w5.actors.madjid.x = 220;
  w5.actors.madjid.y = 420;
  runFrames(w5, () => ({ madjid: { ...createEmptyIntent(), down: true }, nadine: createEmptyIntent() }), 20);
  assert.ok(w5.actors.madjid.y > 445, 'Underwater downward input dives smoothly');
  const diveY = w5.actors.madjid.y;
  runFrames(w5, () => ({ madjid: { ...createEmptyIntent(), up: true, jumpHeld: true }, nadine: createEmptyIntent() }), 50);
  assert.ok(w5.actors.madjid.vy < -150, 'Underwater upward input reverses dive momentum');
  assert.ok(w5.actors.madjid.y < diveY - 15, 'Underwater upward input swims upward smoothly');
});

test('background music system: 3 OST assets present, single-element cycling, lifecycle & error fallback', async () => {
  assert.equal(BGM_TRACKS.length, 3, 'Must expose all 3 background music tracks');
  for (const track of BGM_TRACKS) {
    assert.ok(track.url.startsWith('/assets/aistudio/'), `Track URL ${track.url} uses /assets/aistudio/`);
    const diskPath = path.resolve(process.cwd(), 'public', track.url.replace(/^\/+/, ''));
    assert.equal(fs.existsSync(diskPath), true, `MP3 asset exists on disk at ${diskPath}`);
    assert.ok(fs.statSync(diskPath).size > 10000, `MP3 asset ${diskPath} is non-empty`);
  }

  assert.equal(getPreferredTrackIdForContext({ playMode: 'story', worldId: 1 }), 'nadine_dark');
  assert.equal(getPreferredTrackIdForContext({ playMode: 'story', worldId: 2 }), 'planets_asleep');
  assert.equal(getPreferredTrackIdForContext({ playMode: 'story', worldId: 3 }), 'quiet_sky');
  assert.equal(getPreferredTrackIdForContext({ playMode: 'openworld', worldId: 0 }), 'nadine_dark');

  type ListenerMap = Record<string, Set<() => void>>;
  interface MockAudioEl {
    src: string;
    loop: boolean;
    muted: boolean;
    volume: number;
    paused: boolean;
    currentTime: number;
    playCalls: number;
    pauseCalls: number;
    loadCalls: number;
    listeners: ListenerMap;
    play: () => Promise<void>;
    pause: () => void;
    load: () => void;
    addEventListener: (type: string, fn: () => void) => void;
    removeEventListener: (type: string, fn: () => void) => void;
    emit: (type: string) => void;
  }

  let rejectNextPlay = false;
  const createdElements: MockAudioEl[] = [];
  const createMockAudioElement = (initialUrl: string): MockAudioEl => {
    const el: MockAudioEl = {
      src: initialUrl,
      loop: false,
      muted: false,
      volume: 1,
      paused: true,
      currentTime: 0,
      playCalls: 0,
      pauseCalls: 0,
      loadCalls: 0,
      listeners: { ended: new Set(), error: new Set() },
      play() {
        el.playCalls += 1;
        if (rejectNextPlay) {
          rejectNextPlay = false;
          el.paused = true;
          return Promise.reject(new Error('NotAllowedError'));
        }
        el.paused = false;
        return Promise.resolve();
      },
      pause() {
        el.pauseCalls += 1;
        el.paused = true;
      },
      load() {
        el.loadCalls += 1;
      },
      addEventListener(type: string, fn: () => void) {
        if (!el.listeners[type]) el.listeners[type] = new Set();
        el.listeners[type].add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        el.listeners[type]?.delete(fn);
      },
      emit(type: string) {
        for (const fn of Array.from(el.listeners[type] || [])) {
          fn();
        }
      },
    };
    createdElements.push(el);
    return el;
  };

  const flush = () => new Promise((r) => setTimeout(r, 0));

  // 1. Autoplay blocked -> unlock recovers cleanly, never duplicates Audio elements
  rejectNextPlay = true;
  const engine = createAudioEngine({ createAudioElement: createMockAudioElement, initialTrackIndex: 0 });
  engine.unlock();
  await flush();
  assert.equal(createdElements.length, 1, 'Creates only one streaming Audio element (zero overlap)');
  assert.equal(engine.getBgmState().pendingUnlock, true, 'Records pendingUnlock if browser blocks autoplay');
  assert.equal(engine.getBgmState().playing, false);

  engine.unlock();
  await flush();
  assert.equal(engine.getBgmState().playing, true, 'Starts playback cleanly after user gesture unlock');
  assert.equal(engine.getBgmState().trackId, 'nadine_dark');

  // 2. Track ended cycles seamlessly through all 3 tracks
  const el = createdElements[0];
  el.emit('ended');
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'planets_asleep');
  assert.equal(el.src, BGM_TRACKS[1].url);

  el.emit('ended');
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'quiet_sky');

  el.emit('ended');
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'nadine_dark');

  // 3. Same-world reload keeps currentTime intact without restarting; different world switches smoothly
  engine.setWorldMusicContext({ playMode: 'story', worldId: 1, gameState: 'playing' });
  engine.nextBgmTrack(); // manual switch to planets_asleep while in world 1
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'planets_asleep');
  el.currentTime = 42.5;
  engine.setWorldMusicContext({ playMode: 'story', worldId: 1, gameState: 'playing' });
  assert.equal(el.currentTime, 42.5, 'Restarting/reloading same world preserves track progress seamlessly');

  engine.setWorldMusicContext({ playMode: 'story', worldId: 3, gameState: 'playing' });
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'quiet_sky', 'Switching to Volcano selects Apocalypse in the Quiet Sky');

  // 4. Pause / resume, tab visibility & master mute synchronization
  engine.setPaused(true);
  assert.equal(engine.getBgmState().playing, false);
  engine.setPaused(false);
  await Promise.resolve();
  assert.equal(engine.getBgmState().playing, true);

  engine.setTabHidden(true);
  assert.equal(engine.getBgmState().playing, false);
  engine.setTabHidden(false);
  await Promise.resolve();
  assert.equal(engine.getBgmState().playing, true);

  engine.toggleMute();
  assert.equal(engine.isMuted(), true);
  assert.equal(el.muted, true);
  assert.equal(engine.getBgmState().playing, false);
  engine.toggleMute();
  await Promise.resolve();
  assert.equal(el.muted, false);
  assert.equal(engine.getBgmState().playing, true);

  // 5. Independent Music Off toggle disables BGM without muting SFX
  engine.setMusicEnabled(false);
  assert.equal(engine.isMuted(), false);
  assert.equal(engine.getBgmState().musicEnabled, false);
  assert.equal(engine.getBgmState().playing, false);
  engine.setMusicEnabled(true);
  await Promise.resolve();
  assert.equal(engine.getBgmState().playing, true);

  // 6. Error fallback skips failed tracks safely and stops cleanly if all 3 fail
  engine.playBgm('nadine_dark');
  el.emit('error');
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'planets_asleep');
  el.emit('error');
  await Promise.resolve();
  assert.equal(engine.getBgmState().trackId, 'quiet_sky');
  el.emit('error');
  await Promise.resolve();
  assert.equal(engine.getBgmState().unavailable, true, 'Degrades gracefully if all 3 MP3 tracks fail');
  assert.equal(engine.getBgmState().failedTrackIds.length, 3);
  assert.equal(createdElements.length, 1, 'Still uses single element with zero leaked instances');

  engine.dispose();
  assert.equal(el.listeners.ended.size, 0, 'Cleans up ended listeners on dispose');
  assert.equal(el.listeners.error.size, 0, 'Cleans up error listeners on dispose');
});

test('World 2 extreme difficulty spike, W2->W5 strict escalation & mandatory co-op completion across all 5 worlds', () => {
  const storyWorlds = LEVELS.slice(0, 5);
  assert.equal(storyWorlds.length, 5);

  const w1 = storyWorlds[0];
  const w2 = storyWorlds[1];
  const w1Boss = createBossForLevel(w1)!;
  const w2Boss = createBossForLevel(w2)!;

  // 1. World 2 extreme difficulty spike vs World 1
  assert.ok(w2.worldWidth >= 9000, 'World 2 gauntlet exceeds 9000px');
  assert.ok(w2.worldWidth > w1.worldWidth * 2, 'World 2 length spikes to more than 2x World 1');
  assert.equal(w2.groundFrictionScale, 0.11, 'World 2 retains mirror-ice friction');
  assert.ok(w2.hazards.length >= 7 && w2.hazards.length > w1.hazards.length * 2);
  assert.ok(w2.arrowTraps.length >= 4 && w2.arrowTraps.length > w1.arrowTraps.length * 3);
  assert.ok(w2.monsters.length >= 5 && w2.monsters.length > w1.monsters.length * 2);
  assert.ok(w2.exit.keysRequired >= 3);
  assert.ok(w2Boss.maxHp >= 260 && w2Boss.maxHp > w1Boss.maxHp * 2, 'World 2 Boss HP spikes steeply');
  assert.equal(w2Boss.shielded, true, 'World 2 Boss starts with Co-op Teamwork Shield');

  // 2. Strictly escalating difficulty after World 2 (W2 < W3 < W4 < W5)
  for (let idx = 1; idx <= 3; idx++) {
    const prev = storyWorlds[idx];
    const next = storyWorlds[idx + 1];
    const prevBoss = createBossForLevel(prev)!;
    const nextBoss = createBossForLevel(next)!;

    assert.ok(next.worldWidth > prev.worldWidth, `${next.shortCode} worldWidth > ${prev.shortCode}`);
    assert.ok(next.hazards.length > prev.hazards.length, `${next.shortCode} hazards > ${prev.shortCode}`);
    assert.ok(next.arrowTraps.length > prev.arrowTraps.length, `${next.shortCode} arrowTraps > ${prev.shortCode}`);
    assert.ok(next.monsters.length > prev.monsters.length, `${next.shortCode} monsters > ${prev.shortCode}`);
    assert.ok(nextBoss.maxHp > prevBoss.maxHp, `${next.shortCode} boss HP > ${prev.shortCode}`);
    assert.equal(prevBoss.shielded, true, `${prev.shortCode} boss spawns shielded`);
    assert.equal(nextBoss.shielded, true, `${next.shortCode} boss spawns shielded`);
  }

  // 3. Mandatory co-op locks & bypass prevention across ALL 5 Worlds
  for (const level of storyWorlds) {
    // Every progression gate & fragile barrier must have an overhead pillar ceiling (y: 0 -> 410)
    const pillars = level.platforms.filter((p: { kind?: string; y: number; h: number }) => p.kind === 'pillar' && p.y === 0 && p.h >= 410);
    for (const g of level.gates) {
      const sealedAbove = pillars.some((p: { x: number; w: number }) => p.x <= g.x && p.x + p.w >= g.x + g.w);
      assert.equal(sealedAbove, true, `World ${level.code} gate ${g.id} must be sealed overhead to prevent fly/jump bypass`);
    }
    for (const b of level.fragileBarriers || []) {
      const sealedAbove = pillars.some((p: { x: number; w: number }) => p.x <= b.x && p.x + p.w >= b.x + b.w);
      assert.equal(sealedAbove, true, `World ${level.code} barrier ${b.id} must be sealed overhead`);
    }

    // Every world has a non-latching hold-relay gate + far-side latch switch that cannot be soloed
    const state = createInitialLevelState(level);
    const holdGate = state.gates.find((g: { latchOnOpen?: boolean; latchSwitches?: string[] }) => g.latchOnOpen === false && (g.latchSwitches?.length || 0) > 0);
    assert.ok(holdGate, `World ${level.code} must include a co-op Hold-Relay gate`);

    const holdSw = state.switches.find((s: { id: string }) => holdGate.switches.includes(s.id))!;
    const latchSw = state.switches.find((s: { id: string }) => holdGate.latchSwitches.includes(s.id))!;
    assert.ok(holdSw && latchSw);

    // Manual Soul Dash cannot clip through closed gates
    state.actors.madjid.x = holdGate.x - PHYSICS.CHAR_W - 10;
    state.actors.madjid.y = holdGate.y + holdGate.h - PHYSICS.CHAR_H;
    triggerManualSoulDash(state, state.actors.madjid, 1);
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 40);
    assert.ok(state.actors.madjid.x < holdGate.x, `World ${level.code} Soul Dash stops before locked gate ${holdGate.id}`);

    // Solo run attempt: step on holdSw then sprint + dash right — gate slams shut before crossing
    state.actors.madjid.dashCooldown = 0;
    state.actors.madjid.x = holdSw.x + 6;
    state.actors.madjid.y = holdSw.y - PHYSICS.CHAR_H;
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 25);
    assert.ok(holdGate.openProgress > 0.85, `World ${level.code} Hold switch opens relay gate while held`);

    runFrames(state, () => ({ madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() }), 60);
    assert.equal(holdGate.latchedOpen, false, `World ${level.code} single player cannot solo latch hold-relay gate`);
    assert.ok(state.actors.madjid.x < holdGate.x, `World ${level.code} hold-relay gate blocks solo crossing`);

    // True co-op solution: Madjid holds sw_hold while Nadine walks across and flips sw_latch
    state.actors.madjid.x = holdSw.x + 6;
    state.actors.madjid.y = holdSw.y - PHYSICS.CHAR_H;
    state.actors.madjid.vx = 0;
    state.actors.madjid.vy = 0;
    state.actors.nadine.x = holdGate.x - 42;
    state.actors.nadine.y = holdGate.y + holdGate.h - PHYSICS.CHAR_H;
    state.actors.nadine.vx = 0;
    state.actors.nadine.vy = 0;
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 30);
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: { ...createEmptyIntent(), right: true } }), 55);
    assert.equal(holdGate.latchedOpen, true, `World ${level.code} partner relay permanently unseals gate`);
  }

  // 4. Dual simultaneous sync_plates in W2..W5 strictly require BOTH distinct characters
  for (const level of storyWorlds.slice(1)) {
    const state = createInitialLevelState(level);
    const syncPuzzle = state.puzzles.find((p: { kind: string }) => p.kind === 'sync_plates')!;
    assert.ok(syncPuzzle, `World ${level.code} must have a dual sync_plates puzzle`);
    const targetGate = state.gates.find((g: { id: string }) => g.id === syncPuzzle.targetGateId)!;

    // Single actor standing on plate 1 -> unsolved
    state.actors.madjid.x = syncPuzzle.nodes[0].x;
    state.actors.madjid.y = syncPuzzle.nodes[0].y - PHYSICS.CHAR_H;
    stepPuzzles(state, 1 / 60);
    assert.equal(syncPuzzle.solved, false);
    assert.equal(targetGate.latchedOpen, false);

    // Even stacked near same node, 1 plate occupied cannot solve -> requires distinct node 2
    state.actors.nadine.x = syncPuzzle.nodes[0].x;
    state.actors.nadine.y = syncPuzzle.nodes[0].y - PHYSICS.CHAR_H;
    stepPuzzles(state, 1 / 60);
    assert.equal(syncPuzzle.solved, false);

    // Distinct actors on separate plates simultaneously -> unlocks!
    state.actors.nadine.x = syncPuzzle.nodes[1].x;
    state.actors.nadine.y = syncPuzzle.nodes[1].y - PHYSICS.CHAR_H;
    stepPuzzles(state, 1 / 60);
    stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
    assert.equal(syncPuzzle.solved, true, `World ${level.code} dual sync_plates unlocks when both partners stand on separate plates`);
    assert.equal(targetGate.latchedOpen, true);
  }

  // 5. Verify secondary controls (ping, emote-bar, photo button) live cleanly inside collapsible drawer
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const drawerStart = html.indexOf('<aside');
  const drawerEnd = html.indexOf('</aside>');
  assert.ok(drawerStart > 0 && drawerEnd > drawerStart);
  const drawerHtml = html.slice(drawerStart, drawerEnd);
  assert.ok(drawerHtml.includes('id="hud-ping"'), 'Connection ping badge moved into Journey Menu drawer');
  assert.ok(drawerHtml.includes('id="hud-btn-photo"'), 'Snap Memory Photo button moved into Journey Menu drawer');
  assert.ok(drawerHtml.includes('id="emote-bar"'), 'Quick emote/ping bar moved into Journey Menu drawer');
});

test('puzzle-locked checkpoints, star glyph, riddle scrolls, sectors & unique per-world mazes', () => {
  assert.ok(
    PUZZLE_GLYPHS.some((g: { id: string }) => g.id === 'star'),
    'PUZZLE_GLYPHS includes star so W3/W5 alignment puzzles are solvable'
  );

  for (const level of LEVELS) {
    const state = createInitialLevelState(level);
    assert.ok(Array.isArray(state.sectors) && state.sectors.length >= 3, `World ${level.code} has >=3 progression sectors`);
    assert.ok(
      level.platforms.filter((p: { kind?: string }) => !p.kind).length >= 5,
      `World ${level.code} has elevated maze/platform geometry`
    );
    for (const pz of state.puzzles) {
      assert.ok(
        Array.isArray(pz.riddleLines) && pz.riddleLines.length >= 1,
        `Puzzle ${pz.id} in ${level.code} has carved riddleLines`
      );
    }
  }

  // W1 cp_w1_1 starts unlocked; cp_w1_2 stays locked until puz_w1_glyphs is solved
  const w1State = createInitialLevelState(LEVELS[0]);
  const cp1 = w1State.checkpoints.find((c: { id: string }) => c.id === 'cp_w1_1')!;
  const cp2 = w1State.checkpoints.find((c: { id: string }) => c.id === 'cp_w1_2')!;
  assert.equal(isCheckpointUnlocked(w1State, cp1), true, 'cp_w1_1 starts unlocked');
  assert.equal(isCheckpointUnlocked(w1State, cp2), false, 'cp_w1_2 is locked until puz_w1_glyphs is solved');

  let lockedHits = 0;
  w1State.actors.madjid.x = cp2.x - 10;
  w1State.actors.madjid.y = cp2.y - PHYSICS.CHAR_H;
  stepSimulation(w1State, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, {
    onCheckpointLocked() {
      lockedHits += 1;
    },
  });
  assert.equal(cp2.activated, false, 'Locked checkpoint does not activate while puzzle is unsolved');
  assert.ok(lockedHits >= 1, 'Locked checkpoint fires onCheckpointLocked feedback callback');

  const w1Puz = w1State.puzzles.find((p: { id: string }) => p.id === cp2.requiresPuzzleId)!;
  w1Puz.solved = true;
  assert.equal(isCheckpointUnlocked(w1State, cp2), true, 'cp_w1_2 unlocks as soon as its puzzle is solved');
  stepSimulation(w1State, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(cp2.activated, true, 'Unlocked checkpoint activates normally upon contact');
});

test('co-op updateRoomMode reset:true clears storyProgress while keeping room membership, plus HUD/CSS checks', () => {
  const manager = createRoomManager({ storagePath: null });
  const created = manager.createRoom('host-1', { name: 'Wedding Co-op', mode: 'story', levelIndex: 0 });
  assert.equal(created.ok, true);
  const code = created.room!.code;
  manager.joinRoom('guest-2', code, { character: 'nadine' });
  manager.updateStoryProgress('host-1', {
    levelIndex: 0,
    switches: { sw_test: true },
    collectedKeys: ['k1'],
  });
  assert.equal(manager.getRoomForClient('host-1')!.storyProgress.collectedKeys.length, 1, 'storyProgress stored in room');

  // Same-level restart/replay with reset:true clears storyProgress while keeping both players in the room
  const resetRes = manager.updateRoomMode('host-1', { mode: 'story', levelIndex: 0, reset: true });
  assert.equal(resetRes.ok, true);
  assert.equal(resetRes.room!.storyProgress.collectedKeys.length, 0, 'reset:true clears collectedKeys on same-level replay');
  assert.equal(Object.keys(resetRes.room!.storyProgress.switches).length, 0, 'reset:true clears switches on same-level replay');
  assert.equal(resetRes.room!.players.length, 2, 'Both players stay in the co-op room');

  // Verify collapsible HUD toggle, Jump-centered Action Hub, desktop touch auto-hide, and zero backdrop-filter
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');
  assert.ok(html.includes('id="hud-btn-collapse-hud"'), 'HUD collapse button exists in index.html');
  assert.ok(html.includes('id="touch-hub-toggle"'), 'Action Hub toggle exists in index.html');
  assert.ok(html.includes('id="touch-secondary-cluster"'), 'Secondary touch cluster exists in index.html');
  assert.ok(css.includes('@media (hover: hover) and (pointer: fine)'), 'Desktop fine-pointer touch auto-hide rule exists');
  assert.ok(!/backdrop-filter\s*:/.test(css), 'Zero backdrop-filter properties in style.css');
});

test('climbable biome ladders in W1-W5 support climbing, top-deck landing, and jump-off', () => {
  for (const level of LEVELS) {
    const state = createInitialLevelState(level);
    assert.ok(Array.isArray(state.ladders) && state.ladders.length >= 1, `World ${level.code} includes >=1 climbable ladder`);
    assert.ok(Array.isArray(state.miniScenes) && state.miniScenes.length >= 1, `World ${level.code} includes >=1 miniScene trigger`);
  }

  const w1 = createInitialLevelState(LEVELS[0]);
  const ladder = w1.ladders[0];
  const actor = w1.actors.madjid;
  actor.x = ladder.x + 2;
  actor.y = ladder.y + ladder.h - actor.h - 2;
  actor.grounded = true;

  assert.ok(findOverlappingLadder(w1, actor), 'Actor overlapping ladder is detected');

  const climbUpIntent = { ...createEmptyIntent(), up: true };
  const climbing = stepLadders(w1, actor, climbUpIntent, 1 / 60);
  assert.equal(climbing, true, 'Pressing Up on ladder enters climbing state');
  assert.equal(actor.onLadder, true, 'actor.onLadder becomes true');
  assert.ok(actor.vy < 0, 'Climbing Up applies upward velocity');

  // Top-deck landing places feet cleanly at ladder.y
  actor.y = ladder.y - actor.h + 1;
  const atTop = stepLadders(w1, actor, climbUpIntent, 1 / 60);
  assert.equal(atTop, false, 'Reaching ladder top exits climb cleanly');
  assert.equal(actor.onLadder, false, 'actor.onLadder clears upon top-deck exit');
  assert.equal(actor.grounded, true, 'Actor lands grounded on top deck');
  assert.equal(actor.y, ladder.y - actor.h, 'Actor feet align cleanly with ladder.y');

  // Directional jump-off detaches horizontally + upward
  actor.y = ladder.y + ladder.h * 0.5;
  actor.onLadder = true;
  const jumpOffIntent = { ...createEmptyIntent(), right: true, jumpJustPressed: true };
  const stillClimbing = stepLadders(w1, actor, jumpOffIntent, 1 / 60);
  assert.equal(stillClimbing, false, 'Directional jump-off releases ladder');
  assert.equal(actor.onLadder, false, 'actor.onLadder is false after jump-off');
  assert.ok(actor.vx > 0 && actor.vy < 0, 'Jump-off launches actor diagonally');
});

test('W2/W3/W5 timed co-op escape sequences activate, advance, require both partners, and respawn at checkpoint on failure', () => {
  for (const idx of [1, 2, 4]) {
    const st = createInitialLevelState(LEVELS[idx]);
    assert.ok(st.escapeState, `World ${LEVELS[idx].code} has an active escapeState gauntlet`);
    assert.ok(st.escapeState.endX > st.escapeState.triggerX, 'Escape endX is past triggerX');
  }

  const w2 = createInitialLevelState(LEVELS[1]);
  const esc = w2.escapeState!;
  const safeCp = w2.checkpoints.find((c: { x: number }) => c.x <= esc.triggerX) ?? w2.checkpoints[0];
  w2.activeCheckpoint = { x: safeCp.x, y: safeCp.y };

  // Advance one partner into trigger zone -> activates surge
  w2.actors.madjid.x = esc.triggerX + 12;
  w2.actors.nadine.x = esc.triggerX - 20;
  let started = false;
  stepEscapeSequence(w2, 0.05, {
    onEscapeStart() {
      started = true;
    },
  });
  assert.equal(started, true, 'Escape gauntlet triggers when a partner enters triggerX');
  assert.equal(esc.active, true, 'escapeState.active becomes true');
  const wallBefore = esc.wallX;
  stepEscapeSequence(w2, 0.25);
  assert.ok(esc.wallX > wallBefore, 'Escape surge wall advances forward over time');

  // Only Madjid past endX is NOT enough (mandatory co-op)
  w2.actors.madjid.x = esc.endX + 40;
  w2.actors.nadine.x = esc.triggerX + 80;
  stepEscapeSequence(w2, 0.05);
  assert.equal(esc.cleared, false, 'Escape stays uncleared while partner lags behind endX');

  // Damage both and force fail -> resets wave and respawns both at activeCheckpoint with full HP
  w2.actors.madjid.hp = 20;
  w2.actors.nadine.hp = 10;
  let failed = false;
  triggerEscapeFailRespawn(w2, {
    onEscapeFail() {
      failed = true;
    },
  });
  assert.equal(failed, true, 'Escape fail fires callback');
  assert.equal(esc.active, false, 'Escape resets active flag on fail');
  assert.equal(esc.wallX, esc.wallStartX, 'Escape surge rewinds to wallStartX');
  assert.equal(w2.actors.madjid.hp, w2.actors.madjid.maxHp, 'Madjid respawns with full HP');
  assert.equal(w2.actors.nadine.hp, w2.actors.nadine.maxHp, 'Nadine respawns with full HP');

  // Re-trigger and have BOTH pass endX -> cleared!
  w2.actors.madjid.x = esc.triggerX + 20;
  stepEscapeSequence(w2, 0.05);
  w2.actors.madjid.x = esc.endX + 40;
  w2.actors.nadine.x = esc.endX + 45;
  let cleared = false;
  stepEscapeSequence(w2, 0.05, {
    onEscapeClear() {
      cleared = true;
    },
  });
  assert.equal(cleared, true, 'Escape clears cleanly once both partners cross endX');
  assert.equal(esc.cleared, true, 'escapeState.cleared stays true');
});

test('dedication intro screen, touch force-hidden override, and PWA assets/config exist', () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');
  const viteConfig = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  assert.ok(html.includes('id="dedication-screen"'), 'Dedication intro screen exists in index.html');
  assert.ok(html.includes('id="btn-dedication-continue"'), 'Dedication continue button exists in index.html');
  assert.ok(
    html.includes('هاذا اهداء لك يا عزيزتي نادين انا احبك للغاية'),
    'Exact verbatim Arabic dedication message is present in index.html'
  );
  assert.ok(css.includes('.touch-controls.force-hidden'), 'style.css supports manual touch pad hide override');
  assert.ok(viteConfig.includes('VitePWA('), 'vite.config.ts configures VitePWA manifest and service worker');

  for (const asset of [
    'public/icon.svg',
    'public/pwa-192x192.png',
    'public/pwa-512x512.png',
    'public/pwa-maskable-512x512.png',
    'public/apple-touch-icon.png',
  ]) {
    const abs = path.resolve(process.cwd(), asset);
    assert.ok(fs.existsSync(abs) && fs.statSync(abs).size > 0, `PWA asset ${asset} exists and is non-empty`);
  }
});

test('escalating unpredictable traps start in World 3 onward, escalate W3 < W4 < W5, and reset on checkpoint respawn', () => {
  const counts = LEVELS.map((lvl) => (lvl.dynamicTraps || []).length);
  assert.equal(counts[0], 0, 'World 1 has 0 unpredictable dynamic traps');
  assert.equal(counts[1], 0, 'World 2 has 0 unpredictable dynamic traps');
  assert.equal(counts[2], 4, 'World 3 introduces 4 unpredictable traps');
  assert.equal(counts[3], 6, 'World 4 escalates to 6 unpredictable traps');
  assert.equal(counts[4], 8, 'World 5 escalates to 8 unpredictable traps');
  assert.ok(counts[2] < counts[3] && counts[3] < counts[4], 'Dynamic traps escalate monotonically W3 < W4 < W5');

  // 1. delayed_snare: dormant -> armed on contact -> active eruption -> damages actor
  const w3 = createInitialLevelState(LEVELS[2]);
  const snare = w3.dynamicTraps.find((t: { kind: string }) => t.kind === 'delayed_snare')!;
  assert.equal(snare.phase, 'dormant', 'delayed_snare starts dormant');
  w3.actors.madjid.x = snare.x + 12;
  w3.actors.madjid.y = snare.y + snare.h - w3.actors.madjid.h;
  w3.actors.madjid.invulnTimer = 0;
  const hpBeforeSnare = w3.actors.madjid.hp;
  stepDynamicTraps(w3, 0.05);
  assert.equal(snare.phase, 'armed', 'delayed_snare arms when player enters trigger zone');
  for (let i = 0; i < 14; i++) {
    stepDynamicTraps(w3, 0.05);
  }
  assert.equal(snare.phase, 'active', 'delayed_snare erupts after telegraph delay');
  assert.ok(w3.actors.madjid.hp < hpBeforeSnare, 'Active delayed_snare damages overlapping actor');

  // 2. collapsing_tile: solid initially -> arms under feet -> collapses (non-solid) -> checkpoint respawn restores
  const tile = w3.dynamicTraps.find((t: { kind: string }) => t.kind === 'collapsing_tile')!;
  assert.ok(getDynamicTrapSolids(w3).some((s: { id: string }) => s.id === tile.id), 'collapsing_tile starts solid');
  w3.actors.nadine.x = tile.x + 12;
  w3.actors.nadine.y = tile.y - w3.actors.nadine.h;
  w3.actors.nadine.vy = 0;
  stepDynamicTraps(w3, 0.05);
  assert.equal(tile.phase, 'armed', 'collapsing_tile arms when stood upon');
  for (let i = 0; i < 12; i++) {
    stepDynamicTraps(w3, 0.05);
  }
  assert.equal(tile.phase, 'collapsed', 'collapsing_tile collapses after delay');
  assert.equal(
    getDynamicTrapSolids(w3).some((s: { id: string }) => s.id === tile.id),
    false,
    'Collapsed tile is removed from solid platforms'
  );
  triggerTeamRespawnAtCheckpoint(w3);
  assert.equal(tile.phase, 'dormant', 'Checkpoint respawn resets collapsed tile back to dormant solid state');
  assert.ok(getDynamicTrapSolids(w3).some((s: { id: string }) => s.id === tile.id), 'Reset tile is solid again');

  // 3. shifting_hazard: surprise mid-track timing reversal surge when cooldown expires near player
  const shifter = w3.dynamicTraps.find((t: { kind: string }) => t.kind === 'shifting_hazard')!;
  shifter.reverseCooldown = 0;
  shifter.x = shifter.minX + 60;
  const initDir = shifter.dir;
  w3.actors.madjid.x = shifter.x + 20;
  stepDynamicTraps(w3, 0.05);
  assert.equal(shifter.phase, 'reversing', 'shifting_hazard enters reversing telegraph near actor');
  for (let i = 0; i < 8; i++) {
    stepDynamicTraps(w3, 0.05);
  }
  assert.equal(shifter.dir, -initDir, 'shifting_hazard reverses patrol direction after telegraph');
  assert.ok(shifter.surgeTimer > 0, 'shifting_hazard triggers speed surge after reversing');

  // 4. trap_chain: cascades sequentially across multiple stage pads
  const chain = w3.dynamicTraps.find((t: { kind: string }) => t.kind === 'trap_chain')!;
  w3.actors.madjid.x = chain.x + 8;
  w3.actors.madjid.y = chain.y + chain.h - w3.actors.madjid.h;
  stepDynamicTraps(w3, 0.05);
  assert.equal(chain.phase, 'chaining', 'trap_chain starts chaining when entered');
  assert.ok(chain.activeStages.length >= 2, 'trap_chain has >=2 cascading stages');
  for (let i = 0; i < 20; i++) {
    stepDynamicTraps(w3, 0.05);
  }
  assert.ok(
    chain.activeStages.some((st: { phase: string }) => st.phase === 'active' || st.phase === 'done'),
    'trap_chain stages cascade through armed/active states'
  );
  resetDynamicTraps(w3);
  assert.equal(chain.phase, 'dormant', 'resetDynamicTraps restores trap_chain to dormant');
});

test('on-screen controls are visible by default with top-bar toggle and bottom-corner fixed anchoring', () => {
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const css = fs.readFileSync(path.resolve(process.cwd(), 'style.css'), 'utf8');
  const gameSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/game.js'), 'utf8');

  assert.ok(html.includes('id="hud-btn-touch-toggle"'), 'HUD Pad visibility toggle exists in index.html');
  assert.ok(gameSrc.includes("let touchPadMode = 'on';"), 'On-screen controls default to visible (touchPadMode = on)');
  assert.match(css, /\.touch-controls\s*\{[\s\S]*?position:\s*fixed;/, 'touch-controls are fixed in bottom corners');
});






