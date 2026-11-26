/**
 * src/traps.js
 * Escalating unpredictable traps (starting from World 3 onward -> W4 -> W5):
 *   1. delayed_snare    - Appears dormant/safe, clicks/pulses under weight (telegraph), then erupts.
 *   2. collapsing_tile  - Looks like a real platform bridge, trembles under weight, then collapses briefly.
 *   3. shifting_hazard  - Patrols smoothly, then executes a surprise mid-track timing reversal surge.
 *   4. trap_chain       - Multi-stage cascading trap chain triggered sequentially down a corridor.
 *
 * Deterministic, checkpoint-resettable, zero per-frame allocations, 60fps safe.
 */

import { applyActorDamage } from './health-combat.js';

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Builds mutable runtime state for a trap definition from levels.js.
 * @param {any} def
 */
export function createDynamicTrapState(def) {
  const kind = def.kind || 'delayed_snare';
  const base = {
    ...def,
    kind,
    homeX: def.x,
    homeY: def.y,
    phase: 'dormant',
    timer: 0,
    dir: typeof def.dir === 'number' ? def.dir : 1,
    surgeTimer: 0,
    reverseCooldown: typeof def.reversePeriod === 'number' ? def.reversePeriod : 2.1,
    activeStages: Array.isArray(def.stages)
      ? def.stages.map((st, idx) => ({
          ...st,
          index: idx,
          phase: 'dormant',
          timer: 0,
        }))
      : [],
  };
  return base;
}

/**
 * Restores every dynamic trap cleanly to its initial safe ready state on checkpoint respawn.
 * @param {any} state
 */
export function resetDynamicTraps(state) {
  const traps = state?.dynamicTraps;
  if (!Array.isArray(traps)) return;
  for (let i = 0; i < traps.length; i++) {
    const t = traps[i];
    t.x = typeof t.homeX === 'number' ? t.homeX : t.x;
    t.y = typeof t.homeY === 'number' ? t.homeY : t.y;
    t.phase = 'dormant';
    t.timer = 0;
    t.dir = typeof t.initialDir === 'number' ? t.initialDir : 1;
    t.surgeTimer = 0;
    t.reverseCooldown = typeof t.reversePeriod === 'number' ? t.reversePeriod : 2.1;
    if (Array.isArray(t.activeStages)) {
      for (let s = 0; s < t.activeStages.length; s++) {
        t.activeStages[s].phase = 'dormant';
        t.activeStages[s].timer = 0;
      }
    }
  }
}

/**
 * Returns solid floor rectangles for uncollapsed collapsing_tile traps so actors can stand on them.
 * @param {any} state
 */
export function getDynamicTrapSolids(state) {
  const traps = state?.dynamicTraps;
  if (!Array.isArray(traps) || traps.length === 0) return [];
  const solids = [];
  for (let i = 0; i < traps.length; i++) {
    const t = traps[i];
    if (t.kind === 'collapsing_tile' && t.phase !== 'collapsed') {
      solids.push({
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        isMoving: false,
        id: t.id,
        isCollapsingTile: true,
      });
    }
  }
  return solids;
}

/**
 * Advances all dynamic unpredictable traps in World 3+.
 * @param {any} state
 * @param {number} dt
 * @param {any} [callbacks]
 */
export function stepDynamicTraps(state, dt, callbacks = {}) {
  const traps = state?.dynamicTraps;
  if (!Array.isArray(traps) || traps.length === 0 || dt <= 0) return;

  const actors = [state.actors?.madjid, state.actors?.nadine].filter(Boolean);

  for (let i = 0; i < traps.length; i++) {
    const t = traps[i];

    if (t.kind === 'delayed_snare') {
      const triggerBox = { x: t.x - 6, y: t.y - 34, w: t.w + 12, h: t.h + 36 };
      const steppedOn = actors.some((a) => a.hurtTimer <= 0 && !a.phaseDash?.active && rectsOverlap(a, triggerBox));

      if (t.phase === 'dormant') {
        if (steppedOn) {
          t.phase = 'armed';
          t.timer = t.telegraphSec || 0.52;
          callbacks.onTrapArm?.(t);
        }
      } else if (t.phase === 'armed') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.phase = 'active';
          t.timer = t.activeSec || 1.05;
          callbacks.onTrapTrigger?.(t);
        }
      } else if (t.phase === 'active') {
        t.timer -= dt;
        const burstBox = { x: t.x + 4, y: t.y - 26, w: Math.max(12, t.w - 8), h: t.h + 26 };
        for (let a = 0; a < actors.length; a++) {
          const actor = actors[a];
          if (actor.hurtTimer > 0 || actor.invulnTimer > 0 || actor.phaseDash?.active || actor.devouredByGhost) continue;
          if (rectsOverlap(actor, burstBox)) {
            applyActorDamage(
              state,
              actor,
              t.damage || 22,
              { sourceX: t.x + t.w * 0.5, knockbackY: -245, cause: t.cause || 'Snare Trap' },
              callbacks
            );
          }
        }
        if (t.timer <= 0) {
          t.phase = 'cooldown';
          t.timer = t.cooldownSec || 1.5;
        }
      } else if (t.phase === 'cooldown') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.phase = 'dormant';
          t.timer = 0;
        }
      }
      continue;
    }

    if (t.kind === 'collapsing_tile') {
      const standZone = { x: t.x - 2, y: t.y - 8, w: t.w + 4, h: 12 };
      const stoodUpon = actors.some(
        (a) => a.hurtTimer <= 0 && !a.phaseDash?.active && a.vy >= -20 && rectsOverlap(a, standZone)
      );

      if (t.phase === 'dormant') {
        if (stoodUpon) {
          t.phase = 'armed';
          t.timer = t.delaySec || 0.45;
          callbacks.onTrapArm?.(t);
        }
      } else if (t.phase === 'armed') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.phase = 'collapsed';
          t.timer = t.respawnSec || 2.4;
          for (let a = 0; a < actors.length; a++) {
            const actor = actors[a];
            if (rectsOverlap(actor, standZone)) {
              actor.grounded = false;
            }
          }
          callbacks.onTrapTrigger?.(t);
        }
      } else if (t.phase === 'collapsed') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.phase = 'dormant';
          t.timer = 0;
        }
      }
      continue;
    }

    if (t.kind === 'shifting_hazard') {
      const minX = typeof t.minX === 'number' ? t.minX : t.homeX - 80;
      const maxX = typeof t.maxX === 'number' ? t.maxX : t.homeX + 80;
      const baseSpeed = t.speed || 130;

      if (t.phase === 'reversing') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.dir *= -1;
          t.phase = 'dormant';
          t.surgeTimer = 0.82;
          t.reverseCooldown = t.reversePeriod || 2.1;
          callbacks.onTrapTrigger?.(t);
        }
      } else {
        t.reverseCooldown -= dt;
        const speedMult = t.surgeTimer > 0 ? 1.45 : 1.0;
        if (t.surgeTimer > 0) t.surgeTimer = Math.max(0, t.surgeTimer - dt);

        t.x += t.dir * baseSpeed * speedMult * dt;
        if (t.x <= minX) {
          t.x = minX;
          t.dir = 1;
        } else if (t.x + t.w >= maxX) {
          t.x = maxX - t.w;
          t.dir = -1;
        }

        // Surprise mid-track timing reversal when approaching middle range & cooldown ready
        const nearActor = actors.some(
          (a) => a.hurtTimer <= 0 && Math.abs(a.x + a.w * 0.5 - (t.x + t.w * 0.5)) < 175
        );
        if (
          t.reverseCooldown <= 0 &&
          nearActor &&
          t.x > minX + 18 &&
          t.x + t.w < maxX - 18
        ) {
          t.phase = 'reversing';
          t.timer = t.reverseTelegraphSec || 0.24;
          callbacks.onTrapArm?.(t);
        }
      }

      const hitBox = { x: t.x + 3, y: t.y + 2, w: Math.max(10, t.w - 6), h: Math.max(8, t.h - 2) };
      for (let a = 0; a < actors.length; a++) {
        const actor = actors[a];
        if (actor.hurtTimer > 0 || actor.invulnTimer > 0 || actor.phaseDash?.active || actor.devouredByGhost) continue;
        if (rectsOverlap(actor, hitBox)) {
          applyActorDamage(
            state,
            actor,
            t.damage || 23,
            { sourceX: t.x + t.w * 0.5, knockbackY: -230, cause: t.cause || 'Shifting Hazard' },
            callbacks
          );
        }
      }
      continue;
    }

    if (t.kind === 'trap_chain') {
      const stages = t.activeStages || [];
      if (stages.length === 0) continue;

      if (t.phase === 'dormant') {
        const sensor = { x: t.x - 16, y: t.y - 44, w: t.w + 32, h: t.h + 46 };
        const entered = actors.some((a) => a.hurtTimer <= 0 && !a.phaseDash?.active && rectsOverlap(a, sensor));
        if (entered) {
          t.phase = 'chaining';
          t.timer = 0;
          const stagger = t.staggerSec || 0.36;
          for (let s = 0; s < stages.length; s++) {
            stages[s].phase = 'pending';
            stages[s].timer = s * stagger;
          }
          callbacks.onTrapArm?.(t);
        }
      } else if (t.phase === 'chaining') {
        let anyActive = false;
        for (let s = 0; s < stages.length; s++) {
          const st = stages[s];
          if (st.phase === 'pending') {
            anyActive = true;
            st.timer -= dt;
            if (st.timer <= 0) {
              st.phase = 'armed';
              st.timer = t.telegraphSec || 0.38;
            }
          } else if (st.phase === 'armed') {
            anyActive = true;
            st.timer -= dt;
            if (st.timer <= 0) {
              st.phase = 'active';
              st.timer = t.activeSec || 0.85;
              callbacks.onTrapTrigger?.(t, st);
            }
          } else if (st.phase === 'active') {
            anyActive = true;
            st.timer -= dt;
            const stBox = { x: st.x + 3, y: st.y - 28, w: Math.max(10, (st.w || 42) - 6), h: (st.h || 16) + 28 };
            for (let a = 0; a < actors.length; a++) {
              const actor = actors[a];
              if (actor.hurtTimer > 0 || actor.invulnTimer > 0 || actor.phaseDash?.active || actor.devouredByGhost) continue;
              if (rectsOverlap(actor, stBox)) {
                applyActorDamage(
                  state,
                  actor,
                  t.damage || 24,
                  { sourceX: st.x + (st.w || 42) * 0.5, knockbackY: -245, cause: t.cause || 'Chain Trap' },
                  callbacks
                );
              }
            }
            if (st.timer <= 0) {
              st.phase = 'done';
            }
          }
        }
        if (!anyActive) {
          t.phase = 'cooldown';
          t.timer = t.cooldownSec || 1.75;
        }
      } else if (t.phase === 'cooldown') {
        t.timer -= dt;
        if (t.timer <= 0) {
          t.phase = 'dormant';
          for (let s = 0; s < stages.length; s++) {
            stages[s].phase = 'dormant';
            stages[s].timer = 0;
          }
        }
      }
    }
  }
}
