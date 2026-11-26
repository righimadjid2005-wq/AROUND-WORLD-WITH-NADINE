/**
 * src/health-combat.js
 * Shared 100/100 HP system, injury scratches & low-HP state,
 * floating combat numbers (-20, +35), Health Orb drops (+35 HP),
 * and Checkpoint Team Respawn for "Around the World with Nadine".
 */

import { resetDynamicTraps } from './traps.js';
import { restoreCheckpointSnapshot } from './checkpoint-snapshot.js';

export const HEALTH_CONFIG = {
  MAX_HP: 100,
  SCRATCH_THRESHOLD_HP: 75,
  LOW_HP_RATIO: 0.3,
  ORB_HEAL_AMOUNT: 35,
  ORB_RADIUS: 11,
  ORB_MAGNET_RADIUS: 78,
  ORB_LIFETIME: 32,
  HURT_INVULN_SEC: 0.85,
  RESPAWN_INVULN_SEC: 1.65,
};

/**
 * Initializes or normalizes an actor's HP fields.
 * @param {any} actor
 */
export function initActorHealth(actor) {
  if (!actor) return;
  if (typeof actor.maxHp !== 'number' || actor.maxHp <= 0) {
    actor.maxHp = HEALTH_CONFIG.MAX_HP;
  }
  if (typeof actor.hp !== 'number' || Number.isNaN(actor.hp)) {
    actor.hp = actor.maxHp;
  }
  actor.hp = Math.max(0, Math.min(actor.maxHp, Math.round(actor.hp)));
  if (typeof actor.hurtFlashTimer !== 'number') actor.hurtFlashTimer = 0;
  if (typeof actor.cryTriggerCount !== 'number') actor.cryTriggerCount = 0;
}

/**
 * Ensures combat containers exist on levelState.
 * @param {any} state
 */
export function ensureCombatArrays(state) {
  if (!Array.isArray(state.healthOrbs)) {
    state.healthOrbs = /** @type {any[]} */ ([]);
  }
  if (!Array.isArray(state.combatTexts)) {
    state.combatTexts = /** @type {any[]} */ ([]);
  }
  if (typeof state.gameOver !== 'boolean') {
    state.gameOver = false;
  }
  if (state.defeatedActorId === undefined) {
    state.defeatedActorId = /** @type {string | null} */ (null);
  }
}

/**
 * Spawns a floating combat number (-20, +35, etc.) above a world point.
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {string} color
 */
export function spawnCombatText(state, x, y, text, color = '#FF6B7A') {
  ensureCombatArrays(state);
  state.combatTexts.push({
    x,
    y,
    vy: -46,
    text,
    color,
    life: 1.05,
    maxLife: 1.05,
  });
}

/**
 * Applies damage to Madjid or Nadine.
 * Decrements 100 HP cleanly, shows red flash & floating number, triggers 0 HP Game Over if <= 0.
 * @param {any} state
 * @param {any} actor
 * @param {number} amount
 * @param {any} opts
 * @param {any} callbacks
 */
export function applyActorDamage(state, actor, amount = 20, opts = {}, callbacks = {}) {
  if (!state || !actor || state.completed || state.gameOver) {
    return { applied: false, zeroHp: false, amount: 0 };
  }
  initActorHealth(actor);
  ensureCombatArrays(state);

  if (
    !opts.ignoreInvuln &&
    (actor.invulnTimer > 0 || actor.hurtTimer > 0 || actor.phaseDash?.active || actor.devouredByGhost)
  ) {
    return { applied: false, zeroHp: false, amount: 0 };
  }

  const dmg = Math.max(1, Math.round(amount));
  const prevHp = actor.hp;
  actor.hp = Math.max(0, prevHp - dmg);
  actor.hurtFlashTimer = 0.24;
  actor.invulnTimer = Math.max(actor.invulnTimer || 0, opts.invulnSec ?? HEALTH_CONFIG.HURT_INVULN_SEC);
  actor.scaleX = 1.2;
  actor.scaleY = 0.82;

  // Cancel dance / kiss / carry safely on injury
  actor.danceStyle = null;
  if (state.kissTimer > 0) state.kissTimer = 0;

  if (typeof opts.knockbackX === 'number') {
    actor.vx = opts.knockbackX;
  } else if (typeof opts.sourceX === 'number') {
    const pushDir = actor.x + actor.w * 0.5 < opts.sourceX ? -1 : 1;
    actor.vx = pushDir * 235;
  }
  if (typeof opts.knockbackY === 'number') {
    actor.vy = opts.knockbackY;
    actor.grounded = false;
  } else if (actor.grounded) {
    actor.vy = -210;
    actor.grounded = false;
  }

  spawnCombatText(state, actor.x + actor.w * 0.5, actor.y - 6, `-${dmg}`, '#FF6B7A');
  callbacks.onDamage?.({ actor, amount: dmg, prevHp, newHp: actor.hp, cause: opts.cause || 'hazard' });

  if (actor.hp <= 0) {
    state.gameOver = true;
    state.defeatedActorId = actor.id;
    state.cryCount = (state.cryCount || 0) + 1;
    actor.mood = 'crying';
    actor.hurtTimer = 0.9;
    actor.vx = 0;
    const partner = state.actors?.[actor.id === 'madjid' ? 'nadine' : 'madjid'];
    if (partner && partner.hp > 0) {
      partner.mood = 'worried';
    }
    callbacks.onCry?.({ actor, cause: opts.cause || 'hazard' });
    callbacks.onZeroHp?.({ actor, state, cause: opts.cause || 'hazard' });
    return { applied: true, zeroHp: true, amount: dmg };
  }

  // Temporary wince mood if low HP
  if (actor.hp / actor.maxHp < HEALTH_CONFIG.LOW_HP_RATIO) {
    actor.mood = 'worried';
  }

  return { applied: true, zeroHp: false, amount: dmg };
}

/**
 * Heals a single actor up to maxHp.
 * @param {any} state
 * @param {any} actor
 * @param {number} amount
 * @param {any} callbacks
 */
export function healActor(state, actor, amount = HEALTH_CONFIG.ORB_HEAL_AMOUNT, callbacks = {}) {
  if (!state || !actor || actor.hp <= 0) return { healed: 0 };
  initActorHealth(actor);
  ensureCombatArrays(state);
  const before = actor.hp;
  actor.hp = Math.min(actor.maxHp, actor.hp + Math.round(amount));
  const healed = actor.hp - before;
  if (healed > 0) {
    spawnCombatText(state, actor.x + actor.w * 0.5, actor.y - 10, `+${healed}`, '#6EE7B7');
    if (actor.hp / actor.maxHp >= HEALTH_CONFIG.LOW_HP_RATIO && actor.mood === 'worried') {
      actor.mood = 'happy';
    }
    callbacks.onHeal?.({ actor, amount: healed });
  }
  return { healed };
}

/**
 * Heals both partners to full HP when a new Checkpoint activates.
 * @param {any} state
 * @param {any} callbacks
 */
export function healTeamToFull(state, callbacks = {}) {
  if (!state?.actors) return;
  ['madjid', 'nadine'].forEach((id) => {
    const actor = state.actors[id];
    if (!actor) return;
    initActorHealth(actor);
    if (actor.hp < actor.maxHp) {
      const gained = actor.maxHp - actor.hp;
      actor.hp = actor.maxHp;
      spawnCombatText(state, actor.x + actor.w * 0.5, actor.y - 14, `+${gained} HP`, '#6EE7B7');
      if (actor.mood === 'worried') actor.mood = 'happy';
      callbacks.onHeal?.({ actor, amount: gained, fullHeal: true });
    }
  });
}

/**
 * Spawns a +35 HP Health Orb pickup in the world (e.g., when defeating a secondary monster).
 * @param {any} state
 * @param {number} x
 * @param {number} y
 * @param {number} amount
 */
export function spawnHealthOrb(state, x, y, amount = HEALTH_CONFIG.ORB_HEAL_AMOUNT) {
  if (!state) return null;
  ensureCombatArrays(state);
  const orb = {
    id: `orb_${Math.round(x)}_${Math.round(y)}_${Math.round(Math.random() * 9999)}`,
    x,
    y: y - 10,
    vx: (Math.random() - 0.5) * 90,
    vy: -220,
    amount,
    radius: HEALTH_CONFIG.ORB_RADIUS,
    life: HEALTH_CONFIG.ORB_LIFETIME,
    bobPhase: Math.random() * Math.PI * 2,
    collected: false,
  };
  state.healthOrbs.push(orb);
  return orb;
}

/**
 * Steps Health Orb physics/pickup and floating combat numbers.
 * @param {any} state
 * @param {number} dt
 * @param {any} callbacks
 */
export function stepHealthOrbsAndCombatTexts(state, dt, callbacks = {}) {
  if (!state) return;
  ensureCombatArrays(state);

  const actors = [state.actors?.madjid, state.actors?.nadine].filter(Boolean);
  const platforms = state.platforms || [];

  for (let i = state.healthOrbs.length - 1; i >= 0; i--) {
    const orb = state.healthOrbs[i];
    orb.life -= dt;
    orb.bobPhase += dt * 4.5;
    if (orb.life <= 0 || orb.collected) {
      state.healthOrbs.splice(i, 1);
      continue;
    }

    // Gravity + platform landing
    orb.vy = Math.min(480, orb.vy + 760 * dt);
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;
    orb.vx *= Math.pow(0.08, dt);

    for (let p = 0; p < platforms.length; p++) {
      const plat = platforms[p];
      if (
        orb.x >= plat.x - 4 &&
        orb.x <= plat.x + plat.w + 4 &&
        orb.y + orb.radius >= plat.y &&
        orb.y + orb.radius <= plat.y + 22 &&
        orb.vy >= 0
      ) {
        orb.y = plat.y - orb.radius;
        orb.vy = 0;
        break;
      }
    }

    // Clamp to world floor if underwater/arena
    if (orb.y > (state.worldHeight || 720) - 30) {
      orb.y = (state.worldHeight || 720) - 30;
      orb.vy = 0;
    }

    // Magnetic attraction & pickup by any injured (or overlapping) actor
    for (let a = 0; a < actors.length; a++) {
      const actor = actors[a];
      if (!actor || actor.hp <= 0 || actor.devouredByGhost) continue;
      const acx = actor.x + actor.w * 0.5;
      const acy = actor.y + actor.h * 0.5;
      const dist = Math.hypot(acx - orb.x, acy - orb.y);

      if (dist < HEALTH_CONFIG.ORB_MAGNET_RADIUS && actor.hp < actor.maxHp) {
        const pull = 280 * dt;
        orb.x += ((acx - orb.x) / Math.max(1, dist)) * pull;
        orb.y += ((acy - orb.y) / Math.max(1, dist)) * pull;
      }

      if (dist <= orb.radius + 22) {
        if (actor.hp < actor.maxHp) {
          healActor(state, actor, orb.amount, callbacks);
          orb.collected = true;
          callbacks.onOrbPickup?.({ actor, orb });
          break;
        }
      }
    }
  }

  for (let i = state.combatTexts.length - 1; i >= 0; i--) {
    const t = state.combatTexts[i];
    t.life -= dt;
    t.y += t.vy * dt;
    t.vy *= Math.pow(0.2, dt);
    if (t.life <= 0) {
      state.combatTexts.splice(i, 1);
    }
  }
}

/**
 * Respawns BOTH Madjid and Nadine together at the last activated Checkpoint with full 100 HP.
 * @param {any} state
 * @param {any} callbacks
 */
export function triggerTeamRespawnAtCheckpoint(state, callbacks = {}) {
  if (!state?.actors) return null;
  ensureCombatArrays(state);

  const injectedCp = state.activeCheckpoint;
  if (state.checkpointSnapshot) {
    restoreCheckpointSnapshot(state, state.checkpointSnapshot, {
      bossState: callbacks.bossState || null,
    });
    if (injectedCp && !state.activeCheckpoint) {
      state.activeCheckpoint = injectedCp;
    }
  }

  const cp = state.activeCheckpoint || {
    id: 'spawn',
    madjid: state.spawns?.madjid || { x: 74, y: 400 },
    nadine: state.spawns?.nadine || { x: 124, y: 400 },
  };

  ['madjid', 'nadine'].forEach((id) => {
    const actor = state.actors[id];
    if (!actor) return;
    initActorHealth(actor);
    const pos = cp[id] || state.spawns?.[id] || { x: 90, y: 400 };
    actor.x = pos.x;
    actor.y = pos.y;
    actor.vx = 0;
    actor.vy = 0;
    actor.hp = actor.maxHp;
    actor.hurtTimer = 0;
    actor.hurtFlashTimer = 0;
    actor.invulnTimer = HEALTH_CONFIG.RESPAWN_INVULN_SEC;
    actor.mood = 'normal';
    actor.carriedBy = null;
    actor.phaseDash = null;
    actor.devouredByGhost = false;
    actor.danceStyle = null;
    actor.scaleX = 0.88;
    actor.scaleY = 1.14;
  });

  state.gameOver = false;
  state.defeatedActorId = null;
  if (Array.isArray(state.monsterProjectiles)) {
    state.monsterProjectiles.length = 0;
  }
  resetDynamicTraps(state);

  callbacks.onRespawn?.({ checkpoint: cp, state });
  return cp;
}

/**
 * Renders floating +35 HP Health Orbs and combat numbers (-20, +35).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} state
 * @param {number} time
 */
export function renderHealthOrbsAndTexts(ctx, state, time = 0) {
  if (!state) return;
  const orbs = state.healthOrbs || [];
  for (let i = 0; i < orbs.length; i++) {
    const orb = orbs[i];
    if (orb.collected) continue;
    const bobY = orb.y + Math.sin(time * 4 + orb.bobPhase) * 3.5;

    ctx.save();
    ctx.translate(orb.x, bobY);

    // Outer translucent glow
    ctx.fillStyle = 'rgba(74, 222, 128, 0.28)';
    ctx.beginPath();
    ctx.arc(0, 0, orb.radius + 6, 0, Math.PI * 2);
    ctx.fill();

    // Crisp potion/orb sphere
    ctx.fillStyle = '#34D399';
    ctx.strokeStyle = '#064E3B';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, orb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner cross icon (+HP)
    ctx.fillStyle = '#ECFDF5';
    ctx.fillRect(-5, -1.8, 10, 3.6);
    ctx.fillRect(-1.8, -5, 3.6, 10);

    // Top specular shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.beginPath();
    ctx.ellipse(-3.5, -4, 3, 1.8, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  const texts = state.combatTexts || [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const alpha = Math.max(0, Math.min(1, t.life / Math.max(0.01, t.maxLife)));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(15, 18, 30, 0.92)';
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  }
}
