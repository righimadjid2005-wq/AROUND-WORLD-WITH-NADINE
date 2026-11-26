/**
 * src/checkpoint-snapshot.js
 * Pure, dependency-free Checkpoint Snapshot & Rollback + Solo/Co-op Save Persistence
 * for "Around the World with Nadine".
 *
 * Captures world state at world start and every Checkpoint lantern activation.
 * On death / hazard failure, restores that exact snapshot so everything banked before/at
 * the Checkpoint remains intact while post-Checkpoint switches, puzzles, carry blocks,
 * keys, barriers, weapon pickups, monsters, boss HP, and traps cleanly roll back.
 */

export const SOLO_SAVE_STORAGE_KEY = 'nadine_solo_save_v1';
export const LAST_COOP_ROOM_STORAGE_KEY = 'nadine_last_coop_room_v1';

function cloneCheckpointRef(cp) {
  if (!cp || typeof cp !== 'object') return null;
  return {
    ...cp,
    madjid: cp.madjid ? { x: Number(cp.madjid.x), y: Number(cp.madjid.y) } : undefined,
    nadine: cp.nadine ? { x: Number(cp.nadine.x), y: Number(cp.nadine.y) } : undefined,
  };
}

/**
 * Captures a clean, JSON-serializable snapshot of level progress at this instant.
 * @param {any} state
 * @param {any} [extra]
 */
export function captureCheckpointSnapshot(state, extra = {}) {
  if (!state) return null;

  const switches = {};
  if (Array.isArray(state.switches)) {
    for (let i = 0; i < state.switches.length; i++) {
      const s = state.switches[i];
      switches[s.id] = {
        toggled: Boolean(s.toggled),
        pressed: Boolean(s.pressed),
      };
    }
  }

  const gates = {};
  if (Array.isArray(state.gates)) {
    for (let i = 0; i < state.gates.length; i++) {
      const g = state.gates[i];
      gates[g.id] = {
        latchedOpen: Boolean(g.latchedOpen),
        openProgress: Number(g.openProgress || 0),
      };
    }
  }

  const movingPlatforms = {};
  if (Array.isArray(state.movingPlatforms)) {
    for (let i = 0; i < state.movingPlatforms.length; i++) {
      const mp = state.movingPlatforms[i];
      movingPlatforms[mp.id] = {
        latchedActive: Boolean(mp.latchedActive),
      };
    }
  }

  const puzzles = {};
  if (Array.isArray(state.puzzles)) {
    for (let i = 0; i < state.puzzles.length; i++) {
      const pz = state.puzzles[i];
      puzzles[pz.id] = {
        solved: Boolean(pz.solved),
        enteredOrder: Array.isArray(pz.enteredOrder) ? pz.enteredOrder.slice() : [],
        nodes: Array.isArray(pz.nodes)
          ? pz.nodes.map((n) => ({
              id: n.id,
              glyphIndex: typeof n.glyphIndex === 'number' ? n.glyphIndex : 0,
              activated: Boolean(n.activated),
            }))
          : [],
      };
    }
  }

  const carryBlocks = {};
  if (Array.isArray(state.carryBlocks)) {
    for (let i = 0; i < state.carryBlocks.length; i++) {
      const b = state.carryBlocks[i];
      carryBlocks[b.id] = {
        x: Number(b.x),
        y: Number(b.y),
        placedPedestalId: b.placedPedestalId || null,
      };
    }
  }

  const actorWeapons = {};
  if (state.actors) {
    ['madjid', 'nadine'].forEach((cid) => {
      const actor = state.actors[cid];
      if (!actor) return;
      actorWeapons[cid] = {
        weapons: Array.isArray(actor.weapons) ? actor.weapons.slice() : [],
        equippedWeapon: actor.equippedWeapon || null,
      };
    });
  }

  const bossState = extra.bossState || null;
  const bossSnapshot = bossState
    ? {
        hp: Number(bossState.hp ?? bossState.maxHp ?? 0),
        maxHp: Number(bossState.maxHp ?? 0),
        shielded: Boolean(bossState.shielded),
        defeated: Boolean(bossState.defeated),
        active: Boolean(bossState.active),
      }
    : null;

  const activatedCheckpoints = Array.isArray(state.checkpoints)
    ? state.checkpoints.filter((c) => c.activated).map((c) => c.id)
    : [];

  const checkpointNumber =
    typeof extra.checkpointNumber === 'number'
      ? extra.checkpointNumber
      : activatedCheckpoints.length;

  const checkpointLabel =
    extra.checkpointLabel ||
    (state.activeCheckpoint
      ? checkpointNumber > 0
        ? `Checkpoint ${checkpointNumber}`
        : 'Checkpoint'
      : 'Start of World');

  return {
    version: 1,
    savedAt: Date.now(),
    levelId: state.levelId ?? extra.levelId ?? null,
    worldId: typeof state.worldId === 'number' ? state.worldId : (extra.worldId ?? 1),
    levelIndex: typeof extra.levelIndex === 'number' ? extra.levelIndex : (state.levelIndex ?? 0),
    worldName: extra.worldName || state.worldName || '',
    stageTitle: extra.stageTitle || state.title || '',
    sectorCode: extra.sectorCode || '',
    sectorName: extra.sectorName || '',
    checkpointLabel,
    checkpointNumber,
    elapsed: Math.round((state.elapsed || 0) * 100) / 100,
    keysCollected: Number(state.keysCollected || 0),
    keysRequired: Number(state.keysRequired || 0),
    switchesTriggeredCount: Number(state.switchesTriggeredCount || 0),
    activeCheckpoint: cloneCheckpointRef(state.activeCheckpoint),
    activatedCheckpoints,
    collectedKeys: Array.isArray(state.keys)
      ? state.keys.filter((k) => k.collected).map((k) => k.id)
      : [],
    switches,
    gates,
    movingPlatforms,
    puzzles,
    carryBlocks,
    collectedWeapons: Array.isArray(state.weaponPickups)
      ? state.weaponPickups.filter((w) => w.collected).map((w) => w.id)
      : [],
    actorWeapons,
    brokenBarriers: Array.isArray(state.fragileBarriers)
      ? state.fragileBarriers.filter((b) => b.broken).map((b) => b.id)
      : [],
    defeatedMonsters: Array.isArray(state.monsters)
      ? state.monsters.filter((m) => m.defeated || m.koTimer > 0).map((m) => m.id)
      : [],
    bossDefeated: Boolean(state.bossDefeated),
    boss: bossSnapshot,
    escapeCleared: Boolean(state.escapeState?.cleared),
    catDiscovered: Boolean(state.cat?.discovered),
  };
}

/**
 * Restores a previously captured snapshot onto a mutable level state,
 * rolling back everything performed after the checkpoint while preserving banked progress.
 * @param {any} state
 * @param {any} snapshot
 * @param {any} [extra]
 */
export function restoreCheckpointSnapshot(state, snapshot, extra = {}) {
  if (!state || !snapshot || typeof snapshot !== 'object') return false;

  if (typeof snapshot.elapsed === 'number' && Number.isFinite(snapshot.elapsed)) {
    state.elapsed = snapshot.elapsed;
  }
  state.switchesTriggeredCount = Number(snapshot.switchesTriggeredCount || 0);
  state.activeCheckpoint = cloneCheckpointRef(snapshot.activeCheckpoint);

  const activatedCpSet = new Set(Array.isArray(snapshot.activatedCheckpoints) ? snapshot.activatedCheckpoints : []);
  if (Array.isArray(state.checkpoints)) {
    for (let i = 0; i < state.checkpoints.length; i++) {
      const cp = state.checkpoints[i];
      cp.activated = activatedCpSet.has(cp.id);
      cp.pulse = 0;
    }
  }

  const collectedKeySet = new Set(Array.isArray(snapshot.collectedKeys) ? snapshot.collectedKeys : []);
  if (Array.isArray(state.keys)) {
    let keyCount = 0;
    for (let i = 0; i < state.keys.length; i++) {
      const k = state.keys[i];
      k.collected = collectedKeySet.has(k.id);
      if (k.collected) keyCount += 1;
    }
    state.keysCollected = keyCount;
  }

  const savedSwitches = snapshot.switches && typeof snapshot.switches === 'object' ? snapshot.switches : {};
  if (Array.isArray(state.switches)) {
    for (let i = 0; i < state.switches.length; i++) {
      const sw = state.switches[i];
      const saved = savedSwitches[sw.id];
      if (sw.mode === 'toggle') {
        sw.toggled = Boolean(saved?.toggled);
        sw.pressed = Boolean(saved?.pressed ?? sw.toggled);
      } else {
        sw.pressed = false;
      }
      sw.wasOccupied = false;
      sw.pressDepth = sw.toggled || sw.pressed ? 1 : 0;
    }
  }

  const savedGates = snapshot.gates && typeof snapshot.gates === 'object' ? snapshot.gates : {};
  if (Array.isArray(state.gates)) {
    for (let i = 0; i < state.gates.length; i++) {
      const g = state.gates[i];
      const saved = savedGates[g.id];
      g.latchedOpen = Boolean(saved?.latchedOpen);
      const prog = g.latchedOpen ? 1 : Math.max(0, Math.min(1, Number(saved?.openProgress || 0)));
      g.openProgress = prog;
      g.wasOpen = g.latchedOpen || prog > 0.05;
      const closedX = typeof g.closedX === 'number' ? g.closedX : g.x;
      const closedY = typeof g.closedY === 'number' ? g.closedY : g.y;
      g.x = closedX + (g.openOffsetX || 0) * prog;
      g.y = closedY + (g.openOffsetY || 0) * prog;
    }
  }

  const savedMps = snapshot.movingPlatforms && typeof snapshot.movingPlatforms === 'object'
    ? snapshot.movingPlatforms
    : {};
  if (Array.isArray(state.movingPlatforms)) {
    for (let i = 0; i < state.movingPlatforms.length; i++) {
      const mp = state.movingPlatforms[i];
      const saved = savedMps[mp.id];
      mp.latchedActive = Boolean(saved?.latchedActive);
      mp.x = mp.startX;
      mp.y = mp.startY;
      mp.dx = 0;
      mp.dy = 0;
      mp.patrolDir = 1;
      mp.progress = 0;
    }
  }

  const savedPuzzles = snapshot.puzzles && typeof snapshot.puzzles === 'object' ? snapshot.puzzles : {};
  if (Array.isArray(state.puzzles)) {
    for (let i = 0; i < state.puzzles.length; i++) {
      const pz = state.puzzles[i];
      const saved = savedPuzzles[pz.id];
      if (saved && typeof saved === 'object') {
        pz.solved = Boolean(saved.solved);
        pz.enteredOrder = Array.isArray(saved.enteredOrder) ? saved.enteredOrder.slice() : [];
        if (Array.isArray(saved.nodes) && Array.isArray(pz.nodes)) {
          for (let n = 0; n < pz.nodes.length; n++) {
            const node = pz.nodes[n];
            const sn = saved.nodes.find((item) => item.id === node.id);
            if (sn) {
              if (typeof sn.glyphIndex === 'number') node.glyphIndex = sn.glyphIndex;
              node.activated = Boolean(sn.activated);
            }
            node.pulse = 0;
          }
        }
      } else {
        pz.solved = false;
        pz.enteredOrder = [];
        if (Array.isArray(pz.nodes)) {
          for (let n = 0; n < pz.nodes.length; n++) {
            pz.nodes[n].activated = false;
            pz.nodes[n].pulse = 0;
          }
        }
      }
      pz.stuckTimer = 0;
      pz.hintRevealLevel = 0;
      pz.flashTimer = 0;
      pz.errorTimer = 0;

      if (pz.solved) {
        if (pz.targetGateId && Array.isArray(state.gates)) {
          const gate = state.gates.find((g) => g.id === pz.targetGateId);
          if (gate) {
            gate.latchedOpen = true;
            gate.openProgress = 1;
            const closedX = typeof gate.closedX === 'number' ? gate.closedX : gate.x;
            const closedY = typeof gate.closedY === 'number' ? gate.closedY : gate.y;
            gate.x = closedX + (gate.openOffsetX || 0);
            gate.y = closedY + (gate.openOffsetY || 0);
          }
        }
        if (pz.targetBridgePlatformId && Array.isArray(state.movingPlatforms)) {
          const mp = state.movingPlatforms.find((m) => m.id === pz.targetBridgePlatformId);
          if (mp) mp.latchedActive = true;
        }
      }
    }
  }

  if (state.actors) {
    ['madjid', 'nadine'].forEach((cid) => {
      const actor = state.actors[cid];
      if (!actor) return;
      actor.carryingBlockId = null;
      const savedWep = snapshot.actorWeapons?.[cid];
      if (savedWep && Array.isArray(savedWep.weapons)) {
        actor.weapons = savedWep.weapons.slice();
        actor.equippedWeapon =
          savedWep.equippedWeapon && actor.weapons.includes(savedWep.equippedWeapon)
            ? savedWep.equippedWeapon
            : actor.weapons[0] || null;
      }
      actor.weaponAttack = {
        active: false,
        weaponId: actor.equippedWeapon || null,
        timer: 0,
        duration: 0.28,
        cooldown: 0,
        facing: actor.facing || 1,
        hitIds: [],
      };
    });
  }

  if (Array.isArray(state.carryPedestals)) {
    for (let i = 0; i < state.carryPedestals.length; i++) {
      const ped = state.carryPedestals[i];
      ped.occupied = false;
      ped.activated = false;
      ped.occupantBlockId = null;
    }
  }

  const savedBlocks = snapshot.carryBlocks && typeof snapshot.carryBlocks === 'object' ? snapshot.carryBlocks : {};
  if (Array.isArray(state.carryBlocks)) {
    for (let i = 0; i < state.carryBlocks.length; i++) {
      const b = state.carryBlocks[i];
      const saved = savedBlocks[b.id];
      b.x = typeof saved?.x === 'number' ? saved.x : (typeof b.homeX === 'number' ? b.homeX : b.x);
      b.y = typeof saved?.y === 'number' ? saved.y : (typeof b.homeY === 'number' ? b.homeY : b.y);
      b.vx = 0;
      b.vy = 0;
      b.carriedBy = null;
      b.placedPedestalId = saved?.placedPedestalId || null;
      if (b.placedPedestalId && Array.isArray(state.carryPedestals)) {
        const ped = state.carryPedestals.find((p) => p.id === b.placedPedestalId);
        if (ped) {
          ped.occupied = true;
          ped.activated = true;
          ped.occupantBlockId = b.id;
        }
      }
    }
  }

  const collectedWepSet = new Set(Array.isArray(snapshot.collectedWeapons) ? snapshot.collectedWeapons : []);
  if (Array.isArray(state.weaponPickups)) {
    for (let i = 0; i < state.weaponPickups.length; i++) {
      const wp = state.weaponPickups[i];
      wp.collected = collectedWepSet.has(wp.id);
      if (!wp.collected) wp.collectedBy = null;
    }
  }

  const brokenSet = new Set(Array.isArray(snapshot.brokenBarriers) ? snapshot.brokenBarriers : []);
  if (Array.isArray(state.fragileBarriers)) {
    for (let i = 0; i < state.fragileBarriers.length; i++) {
      const fb = state.fragileBarriers[i];
      fb.broken = brokenSet.has(fb.id);
      fb.hp = fb.broken ? 0 : (typeof fb.maxHp === 'number' ? fb.maxHp : 1);
      fb.crackFlash = 0;
      fb.flashTimer = 0;
      fb.wrongToolTimer = 0;
    }
  }

  const deadMonsterSet = new Set(Array.isArray(snapshot.defeatedMonsters) ? snapshot.defeatedMonsters : []);
  if (Array.isArray(state.monsters)) {
    for (let i = 0; i < state.monsters.length; i++) {
      const m = state.monsters[i];
      if (deadMonsterSet.has(m.id)) {
        m.defeated = true;
        m.hp = 0;
        m.koTimer = 0;
      } else {
        m.defeated = false;
        m.hp = m.maxHp;
        m.koTimer = 0;
        m.stunTimer = 0;
        m.hurtFlashTimer = 0;
        m.windupTimer = 0;
        m.attackTimer = 0;
        m.vx = 0;
        m.vy = 0;
        m.x = typeof m.homeX === 'number' ? m.homeX : m.x;
        m.y = typeof m.homeY === 'number' ? m.homeY : (typeof m.baseY === 'number' ? m.baseY : m.y);
        m.dir = typeof m.initialDir === 'number' ? m.initialDir : -1;
        m.attackCooldown = typeof m.initialAttackCooldown === 'number' ? m.initialAttackCooldown : 1.4 + i * 0.4;
      }
    }
  }

  if (Array.isArray(state.enemies)) {
    for (let i = 0; i < state.enemies.length; i++) {
      const en = state.enemies[i];
      if (typeof en.homeX === 'number') en.x = en.homeX;
      if (typeof en.initialDir === 'number') en.dir = en.initialDir;
      en.stunTimer = 0;
      en.turnPause = 0;
    }
  }

  if (Array.isArray(state.arrowProjectiles)) state.arrowProjectiles.length = 0;
  if (Array.isArray(state.arrowTraps)) {
    for (let i = 0; i < state.arrowTraps.length; i++) {
      const t = state.arrowTraps[i];
      t.telegraph = false;
      t.timer = typeof t.initialDelay === 'number' ? t.initialDelay : 1.2 + i * 0.4;
    }
  }

  if (Array.isArray(state.weaponProjectiles)) state.weaponProjectiles.length = 0;
  if (Array.isArray(state.weaponSparks)) state.weaponSparks.length = 0;
  if (Array.isArray(state.weaponEffects)) state.weaponEffects.length = 0;
  if (Array.isArray(state.monsterProjectiles)) state.monsterProjectiles.length = 0;
  if (Array.isArray(state.healthOrbs)) state.healthOrbs.length = 0;
  if (Array.isArray(state.combatTexts)) state.combatTexts.length = 0;

  state.bossDefeated = Boolean(snapshot.bossDefeated);
  const bossState = extra.bossState || null;
  if (bossState) {
    const sb = snapshot.boss;
    if (sb && typeof sb === 'object') {
      bossState.hp = Math.max(0, Math.min(bossState.maxHp || sb.maxHp || 100, Number(sb.hp ?? bossState.maxHp)));
      bossState.shielded = Boolean(sb.shielded);
      bossState.defeated = Boolean(sb.defeated);
      bossState.active = Boolean(sb.active);
    } else {
      bossState.defeated = Boolean(snapshot.bossDefeated);
      bossState.active = !bossState.defeated;
      bossState.hp = bossState.defeated ? 0 : bossState.maxHp;
      bossState.shielded = Boolean(bossState.initialShielded);
    }
    if (!bossState.defeated) {
      if (typeof bossState.homeX === 'number') bossState.x = bossState.homeX;
      if (typeof bossState.homeY === 'number') bossState.y = bossState.homeY;
      else if (typeof bossState.baseY === 'number') bossState.y = bossState.baseY;
      bossState.vy = 0;
      bossState.dir = typeof bossState.initialDir === 'number' ? bossState.initialDir : -1;
      bossState.stunTimer = 0;
      bossState.hurtFlashTimer = 0;
    }
  }

  if (state.escapeState) {
    state.escapeState.cleared = Boolean(snapshot.escapeCleared);
    state.escapeState.active = false;
    state.escapeState.wallX = state.escapeState.wallStartX;
    state.escapeState.timeRemaining = state.escapeState.timeLimitSec;
  }

  if (state.cat && typeof snapshot.catDiscovered === 'boolean') {
    state.cat.discovered = snapshot.catDiscovered;
  }

  const keysOk = (state.keysCollected || 0) >= (state.keysRequired || 0);
  const bossOk = !state.exit?.requiresBossDefeat || Boolean(state.bossDefeated);
  state.portalUnlocked = keysOk && bossOk;
  return true;
}

export function saveSoloCheckpointSnapshot(storage, snapshot) {
  if (!storage || !snapshot) return false;
  try {
    storage.setItem(SOLO_SAVE_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadSoloCheckpointSnapshot(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SOLO_SAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.levelIndex !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearSoloCheckpointSnapshot(storage) {
  if (!storage) return;
  try {
    storage.removeItem(SOLO_SAVE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function saveLastCoopRoom(storage, roomInfo) {
  if (!storage || !roomInfo || !roomInfo.code) return false;
  try {
    const payload = {
      code: String(roomInfo.code).trim().toUpperCase(),
      name: String(roomInfo.name || '').trim(),
      mode: roomInfo.mode === 'openworld' ? 'openworld' : 'story',
      levelIndex: typeof roomInfo.levelIndex === 'number' ? roomInfo.levelIndex : 0,
      worldId: typeof roomInfo.worldId === 'number' ? roomInfo.worldId : 1,
      worldName: String(roomInfo.worldName || ''),
      savedAt: Date.now(),
    };
    storage.setItem(LAST_COOP_ROOM_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadLastCoopRoom(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_COOP_ROOM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.code !== 'string' || !parsed.code.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLastCoopRoom(storage) {
  if (!storage) return;
  try {
    storage.removeItem(LAST_COOP_ROOM_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}
