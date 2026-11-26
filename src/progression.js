/**
 * src/progression.js
 * Sequential World Unlock & Persistence Logic for "Around the World with Nadine".
 *
 * Rules:
 * - World 1 starts unlocked; Worlds 2..5 start locked.
 * - Completing World N unlocks World N + 1 (persisted cleanly in localStorage).
 * - Worlds 3+ are marked "Dangerous Territory" (escalating unpredictable traps).
 * - Optional progress reset restores World 1 unlocked only.
 */

export const PROGRESSION_STORAGE_KEY = 'nadine_progression_v1';
export const TOTAL_STORY_WORLDS = 5;
export const WORLD_DANGER_FROM = 3;

/**
 * Normalizes a saved progression payload into a clean, bounded state.
 * Optionally migrates sequential clears from legacy clearedLevelIds if needed.
 * @param {any} [saved]
 * @param {number[] | Set<number> | null} [legacyClearedIds]
 * @param {number} [totalWorlds]
 */
export function createProgressionState(saved = null, legacyClearedIds = null, totalWorlds = TOTAL_STORY_WORLDS) {
  const completedSet = new Set();

  if (saved && Array.isArray(saved.completedWorlds)) {
    for (let i = 0; i < saved.completedWorlds.length; i++) {
      const wid = Number(saved.completedWorlds[i]);
      if (Number.isInteger(wid) && wid >= 1 && wid <= totalWorlds) {
        completedSet.add(wid);
      }
    }
  } else if (legacyClearedIds) {
    const legacySet = legacyClearedIds instanceof Set ? legacyClearedIds : new Set(legacyClearedIds);
    // Migrate only sequentially from World 1 onward so progression rules remain consistent
    for (let w = 1; w <= totalWorlds; w++) {
      if (legacySet.has(w)) {
        completedSet.add(w);
      } else {
        break;
      }
    }
  }

  let highest = 1;
  if (saved && typeof saved.highestUnlockedWorld === 'number' && Number.isFinite(saved.highestUnlockedWorld)) {
    highest = Math.max(1, Math.min(totalWorlds, Math.floor(saved.highestUnlockedWorld)));
  }

  // Ensure sequential consistency with completedWorlds
  for (let w = 1; w <= totalWorlds; w++) {
    if (completedSet.has(w)) {
      highest = Math.max(highest, Math.min(totalWorlds, w + 1));
    } else {
      break;
    }
  }

  return {
    highestUnlockedWorld: highest,
    completedWorlds: Array.from(completedSet).sort((a, b) => a - b),
  };
}

/**
 * Returns true if the world is currently unlocked for play.
 * @param {ReturnType<typeof createProgressionState>} prog
 * @param {number} worldId
 */
export function isWorldUnlocked(prog, worldId) {
  const wid = Number(worldId) || 1;
  const highest = prog?.highestUnlockedWorld || 1;
  return wid <= highest;
}

/**
 * Returns true for Worlds 3+ where escalating unpredictable dynamic traps begin.
 * @param {number} worldId
 */
export function isWorldDangerous(worldId) {
  return Number(worldId) >= WORLD_DANGER_FROM;
}

/**
 * Resolves the UI display status of a world: 'completed' | 'unlocked' | 'locked'.
 * @param {ReturnType<typeof createProgressionState>} prog
 * @param {number} worldId
 */
export function getWorldProgressionStatus(prog, worldId) {
  const wid = Number(worldId) || 1;
  if (Array.isArray(prog?.completedWorlds) && prog.completedWorlds.includes(wid)) {
    return 'completed';
  }
  return isWorldUnlocked(prog, wid) ? 'unlocked' : 'locked';
}

/**
 * Marks worldId as completed and unlocks worldId + 1 (clamped to totalWorlds).
 * Returns a fresh progression state object.
 * @param {ReturnType<typeof createProgressionState>} prog
 * @param {number} worldId
 * @param {number} [totalWorlds]
 */
export function completeWorldInProgression(prog, worldId, totalWorlds = TOTAL_STORY_WORLDS) {
  const wid = Math.max(1, Math.min(totalWorlds, Math.floor(Number(worldId) || 1)));
  const current = createProgressionState(prog, null, totalWorlds);
  const completedSet = new Set(current.completedWorlds);
  completedSet.add(wid);
  const nextUnlocked = Math.min(totalWorlds, wid + 1);
  return {
    highestUnlockedWorld: Math.max(current.highestUnlockedWorld, nextUnlocked),
    completedWorlds: Array.from(completedSet).sort((a, b) => a - b),
  };
}

/**
 * Persists progression state into storage.
 * @param {Storage | null | undefined} storage
 * @param {ReturnType<typeof createProgressionState>} prog
 */
export function saveProgression(storage, prog) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    const clean = createProgressionState(prog);
    storage.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads progression state from storage, optionally migrating legacy sequential clears.
 * @param {Storage | null | undefined} storage
 * @param {number[] | Set<number> | null} [legacyClearedIds]
 */
export function loadProgression(storage, legacyClearedIds = null) {
  if (!storage || typeof storage.getItem !== 'function') {
    return createProgressionState(null, legacyClearedIds);
  }
  try {
    const raw = storage.getItem(PROGRESSION_STORAGE_KEY);
    if (raw) {
      return createProgressionState(JSON.parse(raw), null);
    }
  } catch {
    // Ignore corrupt JSON and fall back cleanly
  }
  return createProgressionState(null, legacyClearedIds);
}

/**
 * Resets progression back to World 1 unlocked only and saves to storage.
 * @param {Storage | null | undefined} storage
 */
export function resetProgression(storage) {
  const fresh = createProgressionState(null, null);
  saveProgression(storage, fresh);
  try {
    storage?.removeItem?.('nadine_cleared_levels');
  } catch {
    // Ignore storage removal failure
  }
  return fresh;
}
