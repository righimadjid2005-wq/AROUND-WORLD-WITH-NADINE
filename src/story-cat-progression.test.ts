import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRESSION_STORAGE_KEY,
  createProgressionState,
  isWorldUnlocked,
  isWorldDangerous,
  getWorldProgressionStatus,
  completeWorldInProgression,
  saveProgression,
  loadProgression,
  resetProgression,
} from './progression.js';
import {
  stepCompanionCat,
  resetCatToTeam,
} from './companion-cat.js';
import {
  STORY_BEATS,
  createStorylineState,
  triggerStoryEvent,
  stepStoryline,
} from './storyline.js';
import { createInteractionState } from './interactions.js';
import { LEVELS } from './levels.js';
import { createInitialLevelState, stepSimulation } from './game.js';
import {
  TIME_PRESETS,
  resolvePresetForTimeOfDay,
  createBackgroundSystem,
} from './background.js';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test('progression: World 1 starts unlocked, Worlds 2..5 locked, sequential clear unlocks next & persists', () => {
  const storage = createMemoryStorage();
  let prog = createProgressionState();

  assert.equal(prog.highestUnlockedWorld, 1);
  assert.deepEqual(prog.completedWorlds, []);
  assert.equal(isWorldUnlocked(prog, 1), true);
  assert.equal(isWorldUnlocked(prog, 2), false);
  assert.equal(isWorldUnlocked(prog, 5), false);
  assert.equal(getWorldProgressionStatus(prog, 1), 'unlocked');
  assert.equal(getWorldProgressionStatus(prog, 2), 'locked');

  assert.equal(isWorldDangerous(1), false);
  assert.equal(isWorldDangerous(2), false);
  assert.equal(isWorldDangerous(3), true);
  assert.equal(isWorldDangerous(4), true);
  assert.equal(isWorldDangerous(5), true);

  prog = completeWorldInProgression(prog, 1);
  assert.equal(prog.highestUnlockedWorld, 2);
  assert.equal(getWorldProgressionStatus(prog, 1), 'completed');
  assert.equal(isWorldUnlocked(prog, 2), true);
  assert.equal(isWorldUnlocked(prog, 3), false);

  prog = completeWorldInProgression(prog, 2);
  assert.equal(prog.highestUnlockedWorld, 3);
  assert.equal(isWorldUnlocked(prog, 3), true);

  assert.equal(saveProgression(storage, prog), true);
  assert.ok(storage.getItem(PROGRESSION_STORAGE_KEY));

  const loaded = loadProgression(storage);
  assert.equal(loaded.highestUnlockedWorld, 3);
  assert.deepEqual(loaded.completedWorlds, [1, 2]);

  const reset = resetProgression(storage);
  assert.equal(reset.highestUnlockedWorld, 1);
  assert.deepEqual(reset.completedWorlds, []);
  assert.equal(isWorldUnlocked(reset, 2), false);
});

test('companion cat: discovered in World 1, follows smoothly, equips helmet in W4/W5, alerts on W3+ traps, resets safely', () => {
  const w1 = createInitialLevelState(LEVELS[0]);
  assert.ok(w1.cat);
  assert.equal(w1.cat.discovered, false);
  assert.ok(w1.cat.x >= 260, 'W1 cat spawns clear of initial spawn affection check');

  let discoveredFired = 0;
  w1.actors.madjid.x = w1.cat.x - 42;
  w1.actors.madjid.y = w1.cat.y - 18;
  stepCompanionCat(w1.cat, w1, { soulLink: { active: false } }, 0.016, {
    onCatDiscovered() {
      discoveredFired += 1;
    },
  });
  assert.equal(w1.cat.discovered, true);
  assert.equal(discoveredFired, 1);

  // Follow & Soul-Link heart reaction
  let heartFired = 0;
  w1.actors.madjid.x = 620;
  w1.actors.nadine.x = 640;
  w1.cat.heartCooldown = 0;
  for (let i = 0; i < 60; i++) {
    stepCompanionCat(w1.cat, w1, { soulLink: { active: true } }, 0.016, {
      onCatHeart() {
        heartFired += 1;
      },
    });
  }
  assert.ok(w1.cat.x > 300, 'cat follows team across level');
  assert.ok(heartFired >= 1, 'cat purrs with heart reaction during Soul-Link');

  // Space & Underwater bubble helmet
  const w4 = createInitialLevelState(LEVELS[3]);
  assert.equal(w4.cat.discovered, true);
  assert.equal(w4.cat.helmetActive, true);
  const w5 = createInitialLevelState(LEVELS[4]);
  assert.equal(w5.cat.helmetActive, true);

  // World 3+ trap awareness alert without disabling the trap
  const w3 = createInitialLevelState(LEVELS[2]);
  assert.ok(Array.isArray(w3.dynamicTraps) && w3.dynamicTraps.length > 0);
  const trap = w3.dynamicTraps[0];
  w3.actors.madjid.x = trap.x - 32;
  w3.actors.madjid.y = trap.y - 24;
  w3.cat.x = trap.x - 60;
  w3.cat.y = trap.y - 18;
  let trapAlertFired = 0;
  stepCompanionCat(w3.cat, w3, { soulLink: { active: false } }, 0.016, {
    onCatTrapAlert() {
      trapAlertFired += 1;
    },
  });
  assert.equal(trapAlertFired, 1);
  assert.ok(w3.cat.alertTimer > 0);
  assert.notEqual(trap.phase, 'disabled');

  // Checkpoint warp recovery
  w3.cat.x = 20;
  w3.actors.madjid.x = 1850;
  resetCatToTeam(w3.cat, w3);
  assert.ok(Math.abs(w3.cat.x - w3.actors.madjid.x) < 64);

  // Step simulation includes cat & foliage smoothly
  const emptyInputs = {
    madjid: { left: false, right: false, up: false, down: false, jumpHeld: false },
    nadine: { left: false, right: false, up: false, down: false, jumpHeld: false },
  };
  assert.doesNotThrow(() => stepSimulation(w1, emptyInputs, 0.016, {}));
});

test('storyline: covers Worlds 1..5, drives duo overhead bubbles, syncs Co-op beats, and decays banner cleanly', () => {
  const beatsMap = STORY_BEATS as Record<number, Record<string, { line: string; partnerLine?: string }>>;
  for (let w = 1; w <= 5; w++) {
    assert.ok(beatsMap[w], `World ${w} storyline beats exist`);
    assert.ok(beatsMap[w].world_intro, `World ${w} has world_intro`);
    assert.ok(beatsMap[w].puzzle_solved, `World ${w} has puzzle_solved`);
    assert.ok(beatsMap[w].checkpoint_lit, `World ${w} has checkpoint_lit`);
    assert.ok(beatsMap[w].boss_down, `World ${w} has boss_down`);
  }
  assert.ok(STORY_BEATS[1].cat_found);
  assert.ok(STORY_BEATS[5].wedding_vow);

  const storyState = createStorylineState(1);
  const interactions = createInteractionState() as {
    bubbles: Record<string, { text: string } | null>;
  };
  const level = createInitialLevelState(LEVELS[0]);
  const relayed: unknown[] = [];

  const banner = triggerStoryEvent(
    storyState,
    'cat_found',
    { worldId: 1, actors: level.actors },
    interactions,
    {
      onStoryBeat(payload: unknown) {
        relayed.push(payload);
      },
    }
  ) as { id: string } | null;
  assert.ok(banner);
  assert.equal(banner!.id, 'w1:cat_found');
  assert.ok(interactions.bubbles.nadine?.text.includes('ginger cat'));
  assert.ok(interactions.bubbles.madjid?.text.includes('Mimi'));
  assert.equal(relayed.length, 1);

  // Deduplication prevents re-firing same beat in same world run
  const dup = triggerStoryEvent(storyState, 'cat_found', { worldId: 1 }, interactions, {
    onStoryBeat(payload: unknown) {
      relayed.push(payload);
    },
  });
  assert.equal(dup, null);
  assert.equal(relayed.length, 1);

  // Remote sync does not re-emit onStoryBeat
  const remoteBanner = triggerStoryEvent(
    storyState,
    'world_intro',
    { worldId: 1, fromRemote: true },
    interactions,
    {
      onStoryBeat(payload: unknown) {
        relayed.push(payload);
      },
    }
  );
  assert.ok(remoteBanner);
  assert.equal(relayed.length, 1);

  // Timer decay clears banner cleanly
  stepStoryline(storyState, 10);
  assert.equal(storyState.banner, null);
  assert.equal(storyState.cooldown, 0);
});

test('day/night mode: resolves bright daylight and moody night palettes across biomes cleanly', () => {
  const jungleDay = resolvePresetForTimeOfDay(TIME_PRESETS.jungle, 'day');
  const jungleNight = resolvePresetForTimeOfDay(TIME_PRESETS.jungle, 'night');
  assert.ok(jungleDay.sunAlpha > 0.8);
  assert.equal(jungleDay.moonAlpha, 0);
  assert.equal(jungleNight.sunAlpha, 0);
  assert.ok(jungleNight.moonAlpha > 0.8);
  assert.ok(jungleNight.starAlpha > 0.8);
  assert.equal(jungleNight.lanternAlpha, 1);
  assert.ok(jungleNight.skyTop[0] < jungleDay.skyTop[0]);

  const volcanoDay = resolvePresetForTimeOfDay(TIME_PRESETS.volcano, 'day');
  const volcanoNight = resolvePresetForTimeOfDay(TIME_PRESETS.volcano, 'night');
  assert.ok(volcanoDay.skyTop[0] > TIME_PRESETS.volcano.skyTop[0]);
  assert.ok(volcanoNight.lanternAlpha === 1 && volcanoNight.moonAlpha > 0.8);

  const bg = createBackgroundSystem('jungle', 'day');
  assert.equal(bg.getTimeOfDayMode(), 'day');
  bg.setTimeOfDayMode('night', true);
  assert.equal(bg.getTimeOfDayMode(), 'night');
  bg.update(0.05);
  assert.ok(bg.getPlatformStyle().top.startsWith('#'));
});
