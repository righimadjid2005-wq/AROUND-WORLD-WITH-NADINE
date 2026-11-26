import test from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS } from './levels.js';
import { createBossForLevel } from './bosses.js';
import { triggerTeamRespawnAtCheckpoint } from './health-combat.js';
import { createEmptyIntent, createInitialLevelState, stepSimulation } from './game.js';
import {
  SOLO_SAVE_STORAGE_KEY,
  LAST_COOP_ROOM_STORAGE_KEY,
  captureCheckpointSnapshot,
  clearLastCoopRoom,
  clearSoloCheckpointSnapshot,
  loadLastCoopRoom,
  loadSoloCheckpointSnapshot,
  saveLastCoopRoom,
  saveSoloCheckpointSnapshot,
} from './checkpoint-snapshot.js';
import { createRoomManager } from './coop-server-core.js';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

test('checkpoint snapshot preserves pre-checkpoint state and rolls back post-checkpoint keys, switches, puzzles, blocks, barriers, monsters, and boss on death', () => {
  const lvl = LEVELS[2]; // World 3: has dynamic traps, puzzles, monsters, weapons, barriers, carry blocks, and boss
  const state = createInitialLevelState(lvl);
  const bossState = createBossForLevel(lvl);
  assert.ok(state.checkpointSnapshot, 'Initial world start snapshot is captured automatically');
  assert.ok(state.checkpoints.length > 0, 'World 3 has checkpoints');
  assert.ok(state.keys.length >= 2, 'World 3 has multiple keys');
  assert.ok(state.monsters.length >= 2, 'World 3 has multiple secondary monsters');

  // 1. Pre-checkpoint progress: collect Key 0, defeat Monster 0, pick up Weapon 0
  state.keys[0].collected = true;
  state.keysCollected = 1;
  state.monsters[0].defeated = true;
  state.monsters[0].hp = 0;
  if (state.weaponPickups.length > 0) {
    state.weaponPickups[0].collected = true;
    state.actors.madjid.weapons.push(state.weaponPickups[0].weaponId);
    state.actors.madjid.equippedWeapon = state.weaponPickups[0].weaponId;
  }

  // Ensure checkpoint 0 is reachable (if it requires a puzzle, mark that puzzle solved beforehand)
  const cp0 = state.checkpoints[0];
  if (cp0.requiresPuzzleId) {
    const reqPuz = state.puzzles.find((p: { id: string }) => p.id === cp0.requiresPuzzleId);
    if (reqPuz) reqPuz.solved = true;
  }

  // Step simulation so Madjid touches Checkpoint 0 cleanly and captures checkpointSnapshot
  state.actors.madjid.x = cp0.x - 10;
  state.actors.madjid.y = cp0.y - state.actors.madjid.h;
  let cpFired = false;
  stepSimulation(
    state,
    { madjid: createEmptyIntent(), nadine: createEmptyIntent() },
    1 / 60,
    {
      bossState,
      onCheckpoint() {
        cpFired = true;
      },
    }
  );
  assert.equal(cpFired, true, 'Walking onto checkpoint lantern activates checkpoint');
  assert.equal(state.activeCheckpoint?.id, cp0.id, 'Active checkpoint is set to cp0');
  assert.equal(state.checkpointSnapshot?.collectedKeys?.includes(state.keys[0].id), true, 'Snapshot includes Key 0');

  // 2. Post-checkpoint unbanked progress (to be rolled back on death)
  state.keys[1].collected = true;
  state.keysCollected = 2;

  if (state.monsters[1]) {
    state.monsters[1].defeated = true;
    state.monsters[1].hp = 0;
  }

  if (state.fragileBarriers.length > 0) {
    state.fragileBarriers[0].broken = true;
    state.fragileBarriers[0].hp = 0;
  }

  const toggleSw = state.switches.find((s: { mode?: string }) => s.mode === 'toggle');
  const prevSwToggled = toggleSw ? Boolean(toggleSw.toggled) : false;
  if (toggleSw) {
    toggleSw.toggled = !prevSwToggled;
    toggleSw.pressed = toggleSw.toggled;
  }

  if (state.carryBlocks.length > 0 && state.carryPedestals.length > 0) {
    const blk = state.carryBlocks[0];
    const ped = state.carryPedestals[0];
    blk.x = ped.x;
    blk.y = ped.y - blk.h;
    blk.placedPedestalId = ped.id;
    ped.occupied = true;
  }

  const unsolvedPuzzle = state.puzzles.find((p: { solved: boolean }) => !p.solved);
  if (unsolvedPuzzle && unsolvedPuzzle.nodes?.length) {
    unsolvedPuzzle.nodes[0].activated = true;
    unsolvedPuzzle.enteredOrder = [unsolvedPuzzle.nodes[0].id];
  }

  if (state.dynamicTraps.length > 0) {
    state.dynamicTraps[0].phase = 'active';
    state.dynamicTraps[0].timer = 0.7;
  }

  if (bossState) {
    bossState.hp = Math.max(10, bossState.maxHp - 45);
    bossState.x += 55;
  }

  // 3. Team dies and respawns at Checkpoint 0
  state.actors.madjid.hp = 0;
  state.actors.nadine.hp = 25;
  state.gameOver = true;
  triggerTeamRespawnAtCheckpoint(state, { bossState });

  // Assert pre-checkpoint progress stays banked
  assert.equal(state.activeCheckpoint?.id, cp0.id, 'Active checkpoint remains cp0');
  assert.equal(state.checkpoints[0].activated, true, 'Checkpoint 0 remains lit');
  assert.equal(state.keys[0].collected, true, 'Pre-checkpoint Key 0 remains collected');
  assert.equal(state.monsters[0].defeated, true, 'Pre-checkpoint Monster 0 remains defeated');

  // Assert post-checkpoint unbanked actions cleanly rolled back
  assert.equal(state.keys[1].collected, false, 'Post-checkpoint Key 1 is uncollected after death');
  assert.equal(state.keysCollected, 1, 'keysCollected restores to 1');
  if (state.monsters[1]) {
    assert.equal(state.monsters[1].defeated, false, 'Post-checkpoint Monster 1 revives');
    assert.equal(state.monsters[1].hp, state.monsters[1].maxHp, 'Post-checkpoint Monster 1 restores full HP');
  }
  if (state.fragileBarriers.length > 0) {
    assert.equal(state.fragileBarriers[0].broken, false, 'Post-checkpoint fragile barrier restores intact');
  }
  if (toggleSw) {
    assert.equal(toggleSw.toggled, prevSwToggled, 'Post-checkpoint switch flips back to snapshot value');
  }
  if (state.carryBlocks.length > 0 && state.carryPedestals.length > 0) {
    assert.equal(state.carryBlocks[0].placedPedestalId, null, 'Post-checkpoint carry block unplaced from pedestal');
    assert.equal(state.carryPedestals[0].occupied, false, 'Post-checkpoint pedestal resets occupied=false');
  }
  if (unsolvedPuzzle && unsolvedPuzzle.nodes?.length) {
    assert.equal(unsolvedPuzzle.nodes[0].activated, false, 'Post-checkpoint unbanked puzzle node resets cleanly');
    assert.equal(unsolvedPuzzle.enteredOrder.length, 0, 'Post-checkpoint puzzle enteredOrder clears');
  }
  if (state.dynamicTraps.length > 0) {
    assert.equal(state.dynamicTraps[0].phase, 'dormant', 'Dynamic traps reset cleanly to dormant');
  }
  if (bossState) {
    assert.equal(bossState.hp, bossState.maxHp, 'Boss HP resets cleanly to snapshot HP');
    assert.equal(bossState.x, bossState.homeX, 'Boss position resets cleanly to homeX');
  }

  assert.equal(state.gameOver, false, 'gameOver clears after respawn');
  assert.equal(state.actors.madjid.hp, 100, 'Madjid respawns with 100 HP');
  assert.equal(state.actors.nadine.hp, 100, 'Nadine respawns with 100 HP');
});

test('solo checkpoint save and last online co-op room markers persist and clear cleanly', () => {
  const storage = createMemoryStorage();
  const state = createInitialLevelState(LEVELS[1]);
  state.keys[0].collected = true;
  state.keysCollected = 1;
  const snap = captureCheckpointSnapshot(state, {
    levelIndex: 1,
    worldName: 'Frostbite Citadel',
    stageTitle: LEVELS[1].title,
    checkpointLabel: 'Checkpoint 1',
    checkpointNumber: 1,
  });

  assert.equal(saveSoloCheckpointSnapshot(storage, snap), true);
  assert.ok(storage.getItem(SOLO_SAVE_STORAGE_KEY), 'Solo save key written');
  const loadedSolo = loadSoloCheckpointSnapshot(storage);
  assert.equal(loadedSolo?.levelIndex, 1);
  assert.equal(loadedSolo?.checkpointLabel, 'Checkpoint 1');
  assert.deepEqual(loadedSolo?.collectedKeys, [state.keys[0].id]);

  clearSoloCheckpointSnapshot(storage);
  assert.equal(loadSoloCheckpointSnapshot(storage), null);

  assert.equal(
    saveLastCoopRoom(storage, {
      code: 'AB12',
      name: 'Our Run',
      mode: 'story',
      levelIndex: 2,
      worldId: 3,
      worldName: 'Ember Ruins',
    }),
    true
  );
  assert.ok(storage.getItem(LAST_COOP_ROOM_STORAGE_KEY), 'Last co-op room key written');
  const loadedCoop = loadLastCoopRoom(storage);
  assert.equal(loadedCoop?.code, 'AB12');
  assert.equal(loadedCoop?.worldId, 3);

  clearLastCoopRoom(storage);
  assert.equal(loadLastCoopRoom(storage), null);
});

test('coop-server-core updateStoryProgress replace=true wipes post-checkpoint unbanked progress on checkpoint rollback', () => {
  const manager = createRoomManager();
  const created = manager.createRoom('host1', {
    name: 'Rollback Room',
    mode: 'story',
    levelIndex: 2,
    character: 'madjid',
  });
  assert.equal(created.ok, true);

  // Bank Checkpoint 1 + Key 1 + Monster 1
  manager.updateStoryProgress('host1', {
    levelIndex: 2,
    activeCheckpointId: 'cp_1',
    activatedCheckpoints: ['cp_1'],
    collectedKeys: ['k_1'],
    defeatedMonsters: ['m_1'],
    switches: { sw_1: { toggled: true, pressed: true } },
  });

  // Post-checkpoint unbanked pickup Key 2 + Monster 2 + Switch 2
  manager.updateStoryProgress('host1', {
    levelIndex: 2,
    collectedKeys: ['k_2'],
    defeatedMonsters: ['m_2'],
    switches: { sw_2: { toggled: true, pressed: true } },
  });

  const roomBefore = manager.getRoomForClient('host1')!;
  assert.deepEqual(roomBefore.storyProgress.collectedKeys.sort(), ['k_1', 'k_2']);
  assert.deepEqual(roomBefore.storyProgress.defeatedMonsters.sort(), ['m_1', 'm_2']);

  // Checkpoint rollback sync with replace=true restores authoritative server state to Checkpoint 1
  manager.updateStoryProgress('host1', {
    replace: true,
    levelIndex: 2,
    activeCheckpointId: 'cp_1',
    activatedCheckpoints: ['cp_1'],
    collectedKeys: ['k_1'],
    defeatedMonsters: ['m_1'],
    switches: { sw_1: { toggled: true, pressed: true } },
  });

  const roomAfter = manager.getRoomForClient('host1')!;
  assert.equal(roomAfter.storyProgress.activeCheckpointId, 'cp_1');
  assert.deepEqual(roomAfter.storyProgress.collectedKeys, ['k_1']);
  assert.deepEqual(roomAfter.storyProgress.defeatedMonsters, ['m_1']);
  assert.deepEqual(Object.keys(roomAfter.storyProgress.switches), ['sw_1']);
});
