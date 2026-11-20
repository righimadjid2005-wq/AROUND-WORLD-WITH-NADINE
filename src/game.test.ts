import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AFFECTION,
  PHYSICS,
  createEmptyIntent,
  createInitialLevelState,
  isSafeForAffection,
  stepSimulation,
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

test('campaign integrity: 10 worlds, 50 playable levels, safe spawns, flush checkpoints/hazards/enemies/switches', () => {
  assert.equal(WORLDS.length, 10, 'Campaign must have 10 distinct worlds');
  assert.equal(LEVELS.length, 50, 'Campaign must have 50 complete levels');
  assert.ok(STORY_PREMISE.includes('Madjid') && STORY_PREMISE.includes('Nadine'));

  const presets = TIME_PRESETS as Record<string, unknown>;
  const seenIds = new Set<number>();
  const seenCodes = new Set<string>();
  const seenTitles = new Set<string>();

  for (const world of WORLDS) {
    const worldStages = getLevelsForWorld(world.id);
    assert.equal(worldStages.length, 5, `World ${world.id} (${world.name}) must have 5 stages`);
    assert.equal(getWorldById(world.id).name, world.name);
  }

  for (const level of LEVELS) {
    assert.ok(!seenIds.has(level.id), `Duplicate level id ${level.id}`);
    assert.ok(!seenCodes.has(level.code), `Duplicate level code ${level.code}`);
    assert.ok(!seenTitles.has(level.title), `Duplicate level title ${level.title}`);
    seenIds.add(level.id);
    seenCodes.add(level.code);
    seenTitles.add(level.title);

    assert.ok(presets[level.theme], `Level ${level.code} must use a valid atmosphere theme`);
    assert.ok(level.caption.length > 20, `Level ${level.code} must have a warm story caption`);
    assert.ok(level.exit.keysRequired >= 1, `Level ${level.code} must require at least 1 key`);
    assert.equal(level.keys.length, level.exit.keysRequired, `Level ${level.code} key count matches requirement`);

    // Verify all switches rest flush on a static platform and are referenced cleanly
    const switchIds = new Set(level.switches.map((s: { id: string }) => s.id));
    for (const sw of level.switches) {
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === sw.y && sw.x >= p.x && sw.x + sw.w <= p.x + p.w
      );
      assert.ok(host, `Level ${level.code} switch ${sw.id} must rest flush on a static platform`);
    }
    for (const g of level.gates) {
      for (const sid of g.switches) {
        assert.ok(switchIds.has(sid), `Level ${level.code} gate ${g.id} references valid switch ${sid}`);
      }
    }
    for (const mp of level.movingPlatforms as Array<{ id: string; switches?: string[]; patrolSwitches?: string[] }>) {
      for (const sid of [...(mp.switches || []), ...(mp.patrolSwitches || [])]) {
        assert.ok(switchIds.has(sid), `Level ${level.code} moving platform ${mp.id} references valid switch ${sid}`);
      }
    }

    // Verify all checkpoints rest flush on a static platform with no hazard overlap
    for (const cp of level.checkpoints) {
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === cp.y && cp.x >= p.x + 12 && cp.x <= p.x + p.w - 12
      );
      assert.ok(host, `Level ${level.code} checkpoint ${cp.id} must sit flush on a static platform`);
      for (const hz of level.hazards) {
        assert.ok(
          Math.abs(cp.x - (hz.x + hz.w * 0.5)) >= 48,
          `Level ${level.code} checkpoint ${cp.id} must stay clear of hazard ${hz.id}`
        );
      }
    }

    // Verify all hazards rest flush on static platforms
    for (const hz of level.hazards) {
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === hz.y + hz.h && hz.x >= p.x && hz.x + hz.w <= p.x + p.w
      );
      assert.ok(host, `Level ${level.code} hazard ${hz.id} must sit flush on a static platform`);
    }

    // Verify all patrol enemies rest flush on static platforms and patrol within platform bounds
    for (const en of level.enemies) {
      assert.ok(en.maxX > en.minX, `Level ${level.code} enemy ${en.id} must have positive patrol span`);
      const host = level.platforms.find(
        (p: { x: number; y: number; w: number }) =>
          p.y === en.y + en.h && en.minX >= p.x && en.maxX + en.w <= p.x + p.w
      );
      assert.ok(host, `Level ${level.code} enemy ${en.id} patrol must stay within its static platform`);
    }

    // Verify both spawns settle grounded, safe, and alive within 15 frames
    const state = createInitialLevelState(level);
    runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 15);
    assert.equal(state.actors.madjid.grounded, true, `Level ${level.code} Madjid spawn grounded`);
    assert.equal(state.actors.nadine.grounded, true, `Level ${level.code} Nadine spawn grounded`);
    assert.equal(state.cryCount, 0, `Level ${level.code} spawns must be 100% safe`);
    assert.equal(isSafeForAffection(state), true, `Level ${level.code} spawns must be in calm safe state`);
    assert.equal(state.completed, false);
  }

  const finalExit = LEVELS[49].exit as { isWeddingArch?: boolean };
  assert.equal(finalExit.isWeddingArch, true, 'Level 50 (10-5) must feature the Wedding Arch');
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

test('cooperative puzzle mechanics: switch opens gate & raises lift, key unlocks portal, both required to complete', () => {
  const state = createInitialLevelState(LEVELS[0]);
  const sw1a = state.switches.find((s: { id: string }) => s.id === 'sw_1a')!;
  const gate1 = state.gates.find((g: { id: string }) => g.id === 'gate_1')!;
  const lift1 = state.movingPlatforms.find((m: { id: string }) => m.id === 'lift_1')!;

  state.actors.madjid.x = sw1a.x + 8;
  state.actors.madjid.y = sw1a.y - PHYSICS.CHAR_H;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 60);

  assert.equal(sw1a.pressed, true, 'Switch A detects Madjid standing on it');
  assert.ok(gate1.openProgress > 0.9, 'Gate 1 opens smoothly while Switch A is held');
  assert.ok(lift1.y < lift1.startY - 80, 'Lift 1 rises smoothly toward upper walkway');

  state.actors.madjid.x = 96;
  state.actors.madjid.y = 564;
  state.actors.nadine.x = lift1.x + 20;
  state.actors.nadine.y = lift1.y - PHYSICS.CHAR_H;
  state.actors.nadine.grounded = true;
  state.actors.nadine.ridingPlatformId = lift1.id;
  const startNadineY = state.actors.nadine.y;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 25);
  assert.ok(state.actors.nadine.y > startNadineY + 20, 'Character rides smoothly with moving platform');

  const key1 = state.keys[0];
  state.actors.nadine.x = key1.x - 10;
  state.actors.nadine.y = key1.y - 10;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.keysCollected, 1);
  assert.equal(state.portalUnlocked, true);

  state.actors.nadine.x = state.exit.x + 20;
  state.actors.nadine.y = state.exit.y + state.exit.h - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.completed, false, 'Exit portal waits for BOTH Madjid and Nadine');

  state.actors.madjid.x = state.exit.x + 24;
  state.actors.madjid.y = state.exit.y + state.exit.h - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60);
  assert.equal(state.completed, true, 'Both characters together in unlocked portal complete the stage');
});

test('dual-switch AND gate in Stage 1-4 requires both characters simultaneously and latches open', () => {
  const state = createInitialLevelState(LEVELS[3]);
  const swA = state.switches.find((s: { id: string }) => s.id === 'sw_4a')!;
  const swB = state.switches.find((s: { id: string }) => s.id === 'sw_4b')!;
  const gate = state.gates.find((g: { id: string }) => g.id === 'gate_4a')!;

  state.actors.madjid.x = swA.x + 6;
  state.actors.madjid.y = swA.y - PHYSICS.CHAR_H;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 20);
  assert.equal(gate.latchedOpen, false);
  assert.equal(gate.openProgress, 0);

  state.actors.nadine.x = swB.x + 6;
  state.actors.nadine.y = swB.y - PHYSICS.CHAR_H;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 45);
  assert.equal(gate.latchedOpen, true);
  assert.ok(gate.openProgress > 0.9);
});

test('checkpoint activation, hazard/enemy cry-on-death, tear emission, and checkpoint respawn', () => {
  // Use Stage 1-3 (World 1 Stage 3) which has checkpoint, hazard, and patrol enemy
  const state = createInitialLevelState(LEVELS[2]);
  const cp = state.checkpoints[0];
  const hz = state.hazards[0];
  const en = state.enemies[0];

  let checkpointEvents = 0;
  let cryEvents = 0;
  let tearEvents = 0;
  let respawnEvents = 0;
  const callbacks = {
    onCheckpoint: () => {
      checkpointEvents += 1;
    },
    onCry: () => {
      cryEvents += 1;
    },
    onTear: () => {
      tearEvents += 1;
    },
    onRespawn: () => {
      respawnEvents += 1;
    },
  };

  // Walk Madjid over checkpoint -> lights lantern & saves activeCheckpoint
  state.actors.madjid.x = cp.x - 10;
  state.actors.madjid.y = cp.y - PHYSICS.CHAR_H;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  const activeCp = state.activeCheckpoint as { id: string; madjid: { x: number; y: number } } | null;
  assert.equal(cp.activated, true, 'Checkpoint activates on contact');
  assert.equal(checkpointEvents, 1);
  assert.equal(activeCp?.id, cp.id);

  // Move Madjid into hazard -> triggers crying animation & worried partner mood
  state.actors.madjid.x = hz.x + 8;
  state.actors.madjid.y = hz.y - PHYSICS.CHAR_H + 6;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  assert.equal(cryEvents, 1, 'Hazard triggers onCry');
  assert.ok(state.actors.madjid.hurtTimer > 0.7, 'Actor enters cry timer');
  assert.equal(state.actors.madjid.mood, 'crying');
  assert.equal(state.actors.nadine.mood, 'worried');

  // Advance through cry duration (~0.9s = 56 frames) -> tears emit & actor respawns at checkpoint
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 60, 1 / 60, callbacks);
  assert.ok(tearEvents >= 3, 'Teardrop particles emit during crying');
  assert.equal(respawnEvents, 1, 'Actor respawns after cry finishes');
  assert.equal(state.actors.madjid.hurtTimer, 0);
  assert.ok(state.actors.madjid.invulnTimer > 0.5, 'Respawn grants brief invulnerability shimmer');
  assert.ok(
    Math.abs(state.actors.madjid.x - activeCp!.madjid.x) < 4,
    'Actor respawns cleanly at active checkpoint position'
  );

  // Clear invulnerability and verify patrol enemy movement + contact also triggers cry
  state.actors.madjid.invulnTimer = 0;
  const enemyStartX = en.x;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 20);
  assert.notEqual(en.x, enemyStartX, 'Patrol enemy actively patrols its route');

  state.actors.madjid.x = en.x + 2;
  state.actors.madjid.y = en.y;
  stepSimulation(state, { madjid: createEmptyIntent(), nadine: createEmptyIntent() }, 1 / 60, callbacks);
  assert.equal(cryEvents, 2, 'Patrol enemy contact triggers cry-on-death');
});

test('gentle safe-state automatic kiss: triggers when calm & safe, respects cooldown, suppressed by danger, canceled on input', () => {
  const state = createInitialLevelState(LEVELS[0]);
  // Settle on safe ground (Level 1-1 spawns are 50px apart and hazard-free)
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

  // Run ~2.6s (initial cooldown 1.8s + calm delay 0.65s) -> automatic kiss triggers once!
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 160, 1 / 60, callbacks);
  assert.equal(kissEvents, 1, 'Automatic kiss triggers smoothly in safe rest state');
  assert.equal(state.kissCount, 1);
  assert.ok(state.kissTimer > 0, 'Kiss remains active briefly');
  assert.equal(state.actors.madjid.mood, 'kissing');
  assert.equal(state.actors.nadine.mood, 'kissing');
  assert.ok(Math.abs(state.actors.madjid.kissLean) > 0, 'Characters lean gently toward each other during kiss');

  // Movement input immediately cancels kiss without interrupting player control
  stepSimulation(
    state,
    { madjid: { ...createEmptyIntent(), right: true }, nadine: createEmptyIntent() },
    1 / 60,
    callbacks
  );
  assert.equal(state.kissTimer, 0, 'Player input immediately cancels kiss animation');
  assert.ok(state.actors.madjid.vx > 0, 'Player movement responds on the exact same frame');

  // Bring them back close together during cooldown -> no spam kiss, cozy sparkle fires instead
  state.actors.madjid.x = state.actors.nadine.x - 48;
  state.actors.madjid.vx = 0;
  state.actors.nadine.vx = 0;
  state.idleBounceTimer = 0.2;
  runFrames(state, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 120, 1 / 60, callbacks);
  assert.equal(kissEvents, 1, 'Cooldown prevents kiss spamming');
  assert.ok(sparkleEvents >= 1, 'Cozy idle bounce/sparkle occurs gently while resting safely');

  // Danger suppression check: place a patrol enemy nearby -> safe-state returns false & kiss never triggers
  const dangerState = createInitialLevelState(LEVELS[2]); // Stage 1-3 has enemy & hazard
  runFrames(dangerState, () => ({ madjid: createEmptyIntent(), nadine: createEmptyIntent() }), 10);
  dangerState.kissCooldown = 0;
  // Move enemy right next to spawns
  dangerState.enemies[0].x = dangerState.actors.nadine.x + 90;
  dangerState.enemies[0].minX = dangerState.enemies[0].x - 10;
  dangerState.enemies[0].maxX = dangerState.enemies[0].x + 20;
  assert.equal(
    isSafeForAffection(dangerState),
    false,
    `Enemy within ${AFFECTION.ENEMY_SAFE_RADIUS}px suppresses safe-state affection`
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
  assert.equal(dangerKiss, 0, 'Automatic kiss must NOT trigger when an enemy is nearby');
});

test('modular skin registry, world-themed background landmarks, and registerWorldPack expansion', () => {
  assert.ok(getSkinsForCharacter('madjid').length >= 5);
  assert.ok(getSkinsForCharacter('nadine').length >= 5);

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

  const bg = createBackgroundSystem('sunrise');
  assert.equal(bg.getThemeName(), 'sunrise');
  bg.setTheme('night', false, { landmark: 'dunes', ambient: 'fireflies' });
  assert.equal(bg.getThemeName(), 'night');
  assert.equal(bg.getLandmarkStyle(), 'dunes');
  bg.update(0.05);
  assert.ok(bg.getPlatformStyle().top.startsWith('#'));

  // Test future world pack registration without modifying engine code
  const initialWorlds = WORLDS.length;
  const initialLevels = LEVELS.length;
  const packResult = registerWorldPack(
    {
      id: 11,
      name: 'Aurora Isles',
      subtitle: 'Bonus honeymoon voyage',
      theme: 'night',
      landmark: 'lighthouse',
      ambient: 'fireflies',
      enemyKind: 'wisp',
      hazardKind: 'crystals',
      accentColor: '#7CE0D8',
      platformPalette: WORLDS[0].platformPalette,
      stageThemes: ['night'],
    },
    [{ ...LEVELS[0], id: 51, code: '11-1', title: 'Northern Lights Pier' }]
  );
  assert.equal(packResult.totalWorlds, initialWorlds + 1);
  assert.equal(packResult.totalLevels, initialLevels + 1);
  assert.equal(getWorldById(11).name, 'Aurora Isles');
  assert.equal(getLevelsForWorld(11).length, 1);
});
