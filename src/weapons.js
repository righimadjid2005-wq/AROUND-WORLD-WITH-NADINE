/**
 * src/weapons.js
 * Collectible Tools & Weapons + Multi-Stage Tool-Gated Barrier System
 * for "Around the World with Nadine".
 *
 * Canonical Tools & Weapons:
 *  - light_sword (alias: crystal_sword): Swift luminous blade — cuts jungle vines & coral,
 *    slices reactive foliage, deals 28 dmg to monsters, and banishes the Ghost.
 *  - crystal_hammer (alias: plasma_hammer): Heavy crystal breaker mallet — shatters frost &
 *    obsidian walls, crushes guardian shields, deals 38 dmg with heavy shockwave.
 *  - energy_wand (alias: star_wand): Firing starlight/plasma bolts — activates remote
 *    energy conduits & switches, breaks airlock bulkheads, deals 24 ranged dmg.
 *  - mechanism_key: Grappling / Conduit Key tool — opens airlock mechanisms, toggles
 *    levers/switches at range, and clears mechanism locks.
 */

import { canToolDamageBarrier, normalizeToolId } from './foliage.js';
import { damageSecondaryMonster } from './monsters.js';
import { interactWithNearbyPuzzle } from './puzzles.js';

export const WEAPON_CATALOG = Object.freeze({
  light_sword: {
    id: 'light_sword',
    name: 'Light Sword',
    shortName: 'Sword',
    roleHint: 'Cuts Vines & Coral',
    primary: '#38BDF8',
    secondary: '#BAE6FD',
    hilt: '#F59E0B',
    glow: 'rgba(56, 189, 248, 0.55)',
    range: 82,
    verticalReach: 48,
    duration: 0.26,
    cooldown: 0.34,
    damage: 28,
    knockback: 260,
  },
  crystal_hammer: {
    id: 'crystal_hammer',
    name: 'Crystal Hammer',
    shortName: 'Hammer',
    roleHint: 'Shatters Ice & Obsidian',
    primary: '#A855F7',
    secondary: '#FACC15',
    hilt: '#334155',
    glow: 'rgba(168, 85, 247, 0.58)',
    range: 88,
    verticalReach: 54,
    duration: 0.36,
    cooldown: 0.48,
    damage: 38,
    knockback: 340,
  },
  energy_wand: {
    id: 'energy_wand',
    name: 'Energy Wand',
    shortName: 'Wand',
    roleHint: 'Ranged Bolt & Conduits',
    primary: '#F472B6',
    secondary: '#FDE68A',
    hilt: '#7C3AED',
    glow: 'rgba(244, 114, 182, 0.55)',
    range: 102,
    verticalReach: 54,
    duration: 0.3,
    cooldown: 0.38,
    damage: 24,
    knockback: 220,
    firesProjectile: true,
  },
  mechanism_key: {
    id: 'mechanism_key',
    name: 'Mechanism Key',
    shortName: 'Key',
    roleHint: 'Unlocks Conduits & Locks',
    primary: '#34D399',
    secondary: '#FDE047',
    hilt: '#1E293B',
    glow: 'rgba(52, 211, 153, 0.55)',
    range: 92,
    verticalReach: 52,
    duration: 0.28,
    cooldown: 0.36,
    damage: 20,
    knockback: 210,
  },
  // Backward-compatible aliases preserving existing references/tests
  crystal_sword: {
    id: 'crystal_sword',
    name: 'Light Sword',
    shortName: 'Sword',
    roleHint: 'Cuts Vines & Coral',
    primary: '#38BDF8',
    secondary: '#BAE6FD',
    hilt: '#F59E0B',
    glow: 'rgba(56, 189, 248, 0.55)',
    range: 82,
    verticalReach: 48,
    duration: 0.26,
    cooldown: 0.34,
    damage: 28,
    knockback: 260,
  },
  star_wand: {
    id: 'star_wand',
    name: 'Energy Wand',
    shortName: 'Wand',
    roleHint: 'Ranged Bolt & Conduits',
    primary: '#F472B6',
    secondary: '#FDE68A',
    hilt: '#7C3AED',
    glow: 'rgba(244, 114, 182, 0.55)',
    range: 102,
    verticalReach: 54,
    duration: 0.3,
    cooldown: 0.38,
    damage: 24,
    knockback: 220,
    firesProjectile: true,
  },
  plasma_hammer: {
    id: 'plasma_hammer',
    name: 'Crystal Hammer',
    shortName: 'Hammer',
    roleHint: 'Shatters Ice & Obsidian',
    primary: '#A855F7',
    secondary: '#FACC15',
    hilt: '#334155',
    glow: 'rgba(168, 85, 247, 0.58)',
    range: 88,
    verticalReach: 54,
    duration: 0.36,
    cooldown: 0.48,
    damage: 38,
    knockback: 340,
  },
});

export const WEAPON_IDS = Object.freeze([
  'light_sword',
  'crystal_hammer',
  'energy_wand',
  'mechanism_key',
]);

export function getWeaponDef(weaponId) {
  return WEAPON_CATALOG[weaponId] || WEAPON_CATALOG.light_sword;
}

export function createWeaponState(actor) {
  if (!actor) return;
  if (!Array.isArray(actor.weapons)) {
    actor.weapons = [];
  }
  if (!actor.equippedWeapon || !actor.weapons.includes(actor.equippedWeapon)) {
    actor.equippedWeapon = actor.weapons[0] || null;
  }
  if (!actor.weaponAttack) {
    actor.weaponAttack = {
      active: false,
      weaponId: actor.equippedWeapon,
      timer: 0,
      duration: 0.28,
      cooldown: 0,
      facing: actor.facing || 1,
      hitIds: [],
    };
  }
}

export function initWeaponsForLevelState(state, level) {
  const pickups = Array.isArray(level?.weapons)
    ? level.weapons.map((w, idx) => ({
        id: w.id || `wp_${level?.id || 'lvl'}_${idx}`,
        weaponId: WEAPON_CATALOG[w.weaponId] ? w.weaponId : 'light_sword',
        x: w.x,
        y: w.y,
        collected: false,
        collectedBy: null,
        bobPhase: idx * 1.15,
      }))
    : [];

  const fragileBarriers = Array.isArray(level?.fragileBarriers)
    ? level.fragileBarriers.map((b, idx) => ({
        id: b.id || `fb_${level?.id || 'lvl'}_${idx}`,
        x: b.x,
        y: b.y,
        w: b.w || 28,
        h: b.h || 78,
        hp: typeof b.hp === 'number' ? b.hp : 1,
        maxHp: typeof b.maxHp === 'number' ? b.maxHp : (typeof b.hp === 'number' ? b.hp : 1),
        broken: false,
        material: b.material || null,
        requiredTool: b.requiredTool || null,
        altTool: b.altTool || null,
        tint: b.tint || '#7DD3FC',
        crackFlash: 0,
        flashTimer: 0,
        wrongToolTimer: 0,
      }))
    : [];

  state.weaponPickups = pickups;
  state.fragileBarriers = fragileBarriers;
  state.weaponSparks = [];
  state.weaponProjectiles = [];

  if (state.actors?.madjid) createWeaponState(state.actors.madjid);
  if (state.actors?.nadine) createWeaponState(state.actors.nadine);
}

export function giveActorWeapon(actor, weaponId, equipNow = true) {
  if (!actor || !WEAPON_CATALOG[weaponId]) return false;
  createWeaponState(actor);
  const alreadyHas = actor.weapons.includes(weaponId);
  if (!alreadyHas) {
    actor.weapons.push(weaponId);
  }
  if (equipNow || !actor.equippedWeapon) {
    actor.equippedWeapon = weaponId;
  }
  return !alreadyHas || actor.equippedWeapon === weaponId;
}

export function cycleActorWeapon(actor) {
  if (!actor) return null;
  createWeaponState(actor);
  if (actor.weapons.length === 0) return null;
  const idx = actor.weapons.indexOf(actor.equippedWeapon);
  const nextIdx = (idx + 1) % actor.weapons.length;
  actor.equippedWeapon = actor.weapons[nextIdx];
  return actor.equippedWeapon;
}

export function pickupNearbyWeapon(state, actor, maxDist = 48) {
  if (!state || !actor || !actor.alive || actor.phaseDash?.active) return null;
  createWeaponState(actor);
  const cx = actor.x + actor.w * 0.5;
  const cy = actor.y + actor.h * 0.5;
  const pickups = state.weaponPickups || [];
  let best = null;
  let bestDist = maxDist;
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (p.collected) continue;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best) return null;
  best.collected = true;
  best.collectedBy = actor.id;
  giveActorWeapon(actor, best.weaponId, true);
  spawnWeaponBurst(state, best.x, best.y, getWeaponDef(best.weaponId).primary, 12);
  return best;
}

export function spawnWeaponBurst(state, x, y, color = '#7DD3FC', count = 10) {
  if (!state) return;
  if (!Array.isArray(state.weaponSparks)) state.weaponSparks = [];
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.45;
    const spd = 70 + Math.random() * 145;
    state.weaponSparks.push({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 35,
      size: 2.5 + Math.random() * 3.5,
      color,
      life: 0.48 + Math.random() * 0.25,
      maxLife: 0.72,
    });
  }
}

export function getWeaponHitbox(actor, weaponId) {
  const def = getWeaponDef(weaponId || actor?.equippedWeapon);
  const dir = actor.facing >= 0 ? 1 : -1;
  const cx = actor.x + actor.w * 0.5;
  const cy = actor.y + actor.h * 0.5;
  const x = dir > 0 ? cx - 6 : cx + 6 - def.range;
  const y = cy - def.verticalReach * 0.55;
  return {
    x,
    y,
    w: def.range,
    h: def.verticalReach,
    dir,
    def,
  };
}

function rectsIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Triggers a weapon attack (or collects an overlapping/adjacent weapon first).
 * Also fires Energy Wand bolts cleanly!
 */
export function triggerWeaponAction(state, actor, callbacks = {}) {
  if (!state || !actor || !actor.alive || actor.phaseDash?.active) {
    return { ok: false, pickedUp: null, weaponId: null, hits: [] };
  }
  createWeaponState(actor);

  const picked = pickupNearbyWeapon(state, actor, 42);
  if (picked && typeof callbacks.onPickup === 'function') {
    callbacks.onPickup(picked, actor);
  }

  if (!actor.equippedWeapon || actor.weapons.length === 0) {
    return { ok: Boolean(picked), pickedUp: picked, weaponId: null, hits: [] };
  }

  if (actor.weaponAttack.cooldown > 0) {
    return { ok: Boolean(picked), pickedUp: picked, weaponId: actor.equippedWeapon, hits: [] };
  }

  const def = getWeaponDef(actor.equippedWeapon);
  const canonical = normalizeToolId(actor.equippedWeapon);
  actor.weaponAttack = {
    active: true,
    weaponId: actor.equippedWeapon,
    timer: def.duration,
    duration: def.duration,
    cooldown: def.cooldown,
    facing: actor.facing >= 0 ? 1 : -1,
    hitIds: [],
  };

  // Cancel dance cleanly on combat
  actor.danceStyle = null;

  // Fire ranged bolt for Energy Wand / Star Wand
  if (canonical === 'energy_wand') {
    if (!Array.isArray(state.weaponProjectiles)) state.weaponProjectiles = [];
    const dir = actor.facing >= 0 ? 1 : -1;
    state.weaponProjectiles.push({
      id: `wproj_${Date.now()}_${Math.random()}`,
      ownerId: actor.id,
      weaponId: actor.equippedWeapon,
      x: actor.x + actor.w * 0.5 + dir * 18,
      y: actor.y + actor.h * 0.45,
      vx: dir * 420,
      vy: 0,
      radius: 7,
      damage: def.damage,
      color: def.primary,
      life: 0.72,
    });
  }

  if (typeof callbacks.onSwing === 'function') {
    callbacks.onSwing(actor, def);
  }

  const hits = resolveActiveWeaponHits(state, actor, callbacks);
  return {
    ok: true,
    pickedUp: picked,
    weaponId: actor.equippedWeapon,
    hits,
  };
}

function applyBarrierHit(state, barrier, actor, toolId, callbacks = {}) {
  if (!barrier || barrier.broken) return { hit: false };
  const def = getWeaponDef(toolId);

  if (!canToolDamageBarrier(barrier, toolId)) {
    barrier.wrongToolTimer = 1.4;
    barrier.flashTimer = 0.2;
    spawnWeaponBurst(state, barrier.x + barrier.w * 0.5, barrier.y + barrier.h * 0.5, '#FCA5A5', 6);
    callbacks.onBarrierWrongTool?.(barrier, actor);
    return { hit: false, wrongTool: true };
  }

  const canonical = normalizeToolId(toolId);
  const dmg = canonical === 'crystal_hammer' ? 2 : 1;
  barrier.hp = Math.max(0, (barrier.hp ?? 1) - dmg);
  barrier.crackFlash = 0.28;
  barrier.flashTimer = 0.22;
  spawnWeaponBurst(state, barrier.x + barrier.w * 0.5, barrier.y + barrier.h * 0.5, def.primary, 14);
  if (barrier.hp <= 0) {
    barrier.broken = true;
  }
  callbacks.onBarrierHit?.(barrier, actor);
  return { hit: true, broken: barrier.broken };
}

export function resolveActiveWeaponHits(state, actor, callbacks = {}) {
  if (!state || !actor || !actor.weaponAttack?.active) return [];
  const atk = actor.weaponAttack;
  const box = getWeaponHitbox(actor, atk.weaponId);
  const hits = [];

  // 1. Multi-stage tool-gated barriers
  const barriers = state.fragileBarriers || [];
  for (let i = 0; i < barriers.length; i++) {
    const b = barriers[i];
    if (b.broken || atk.hitIds.includes(b.id)) continue;
    if (rectsIntersect(box.x, box.y, box.w, box.h, b.x, b.y, b.w, b.h)) {
      atk.hitIds.push(b.id);
      const res = applyBarrierHit(state, b, actor, atk.weaponId, callbacks);
      if (res.hit) {
        hits.push({ kind: 'barrier', id: b.id, broken: b.broken });
      }
    }
  }

  // 2. Grotesque Secondary Monsters
  const monsters = state.monsters || [];
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i];
    if (m.defeated || m.koTimer > 0 || atk.hitIds.includes(m.id)) continue;
    if (rectsIntersect(box.x, box.y, box.w, box.h, m.x, m.y, m.w, m.h)) {
      atk.hitIds.push(m.id);
      const res = damageSecondaryMonster(state, m, box.def.damage || 26, actor, atk.weaponId, callbacks);
      if (res.hit) {
        spawnWeaponBurst(state, m.x + m.w * 0.5, m.y + m.h * 0.5, box.def.primary, 12);
        hits.push({ kind: 'monster', id: m.id, defeated: res.defeated });
      }
    }
  }

  // 3. Legacy patrol enemies (for backward-compatible stage modules/tests)
  const enemies = state.enemies || [];
  for (let i = 0; i < enemies.length; i++) {
    const en = enemies[i];
    if (atk.hitIds.includes(en.id)) continue;
    if (rectsIntersect(box.x, box.y, box.w, box.h, en.x, en.y, en.w, en.h)) {
      atk.hitIds.push(en.id);
      const canonical = normalizeToolId(atk.weaponId);
      en.stunTimer = canonical === 'crystal_hammer' ? 5.2 : 3.8;
      en.x = Math.max(en.minX, Math.min(en.maxX, en.x + box.dir * 26));
      spawnWeaponBurst(state, en.x + en.w * 0.5, en.y + en.h * 0.5, box.def.primary, 10);
      hits.push({ kind: 'enemy', id: en.id });
      callbacks.onEnemyHit?.(en, actor);
    }
  }

  // 4. World Boss weapon damage
  const boss = callbacks.bossState;
  if (boss && boss.active && !boss.defeated && !atk.hitIds.includes('boss')) {
    if (rectsIntersect(box.x, box.y, box.w, box.h, boss.x, boss.y, boss.w, boss.h)) {
      atk.hitIds.push('boss');
      if (typeof callbacks.onBossWeaponHit === 'function') {
        callbacks.onBossWeaponHit(boss, actor, box.def);
      }
      hits.push({ kind: 'boss', id: boss.id });
    }
  }

  // 5. Slice reactive foliage patches visually
  const foliage = state.foliage || [];
  for (let i = 0; i < foliage.length; i++) {
    const f = foliage[i];
    if (atk.hitIds.includes(f.id)) continue;
    if (rectsIntersect(box.x, box.y, box.w, box.h, f.x - f.w * 0.5, f.y - f.h, f.w, f.h)) {
      atk.hitIds.push(f.id);
      f.cutTimer = 4.0;
      f.bendVel += box.dir * 6.5;
      spawnWeaponBurst(state, f.x, f.y - f.h * 0.4, '#86EFAC', 6);
    }
  }

  // 6. Energy Wand / Mechanism Key conduit & switch activation
  const canonical = normalizeToolId(atk.weaponId);
  if ((canonical === 'energy_wand' || canonical === 'mechanism_key') && Array.isArray(state.switches)) {
    for (let i = 0; i < state.switches.length; i++) {
      const sw = state.switches[i];
      if (sw.mode !== 'toggle' || atk.hitIds.includes(sw.id)) continue;
      if (rectsIntersect(box.x - 10, box.y - 10, box.w + 20, box.h + 20, sw.x, sw.y - 16, sw.w, 22)) {
        atk.hitIds.push(sw.id);
        sw.toggled = !sw.toggled;
        sw.active = sw.toggled;
        spawnWeaponBurst(state, sw.x + sw.w * 0.5, sw.y - 8, '#FDE68A', 8);
        hits.push({ kind: 'switch', id: sw.id });
      }
    }
  }

  if ((canonical === 'energy_wand' || canonical === 'mechanism_key') && !atk.hitIds.includes('puzzle_zap')) {
    const pRes = interactWithNearbyPuzzle(state, actor, { toolId: canonical, maxDist: 96 }, callbacks);
    if (pRes.ok) {
      atk.hitIds.push('puzzle_zap');
      hits.push({ kind: 'puzzle', id: pRes.puzzle.id });
    }
  }

  // 7. Fend off Ugly Ghost if provided in callbacks.ghostState
  const g = callbacks.ghostState;
  if (g && g.active && !atk.hitIds.includes('ghost')) {
    const gw = 54;
    const gh = 64;
    if (rectsIntersect(box.x - 16, box.y - 16, box.w + 32, box.h + 32, g.x - gw * 0.5, g.y - gh * 0.5, gw, gh)) {
      atk.hitIds.push('ghost');
      spawnWeaponBurst(state, g.x, g.y, box.def.secondary, 18);
      hits.push({ kind: 'ghost', id: 'ugly-ghost' });
      callbacks.onGhostHit?.(g, actor, box.def);
    }
  }

  return hits;
}

export function stepWeaponTimers(state, dt, callbacks = {}) {
  const actorIds = ['madjid', 'nadine'];
  for (let i = 0; i < actorIds.length; i++) {
    const actor = state.actors?.[actorIds[i]];
    if (!actor) continue;
    createWeaponState(actor);

    if (actor.alive && !actor.phaseDash?.active) {
      const picked = pickupNearbyWeapon(state, actor, 34);
      if (picked && typeof callbacks.onPickup === 'function') {
        callbacks.onPickup(picked, actor);
      }
    }

    const atk = actor.weaponAttack;
    if (atk.cooldown > 0) {
      atk.cooldown = Math.max(0, atk.cooldown - dt);
    }
    if (atk.active) {
      atk.timer = Math.max(0, atk.timer - dt);
      resolveActiveWeaponHits(state, actor, callbacks);
      if (atk.timer <= 0) {
        atk.active = false;
      }
    }
  }

  // Advance Energy Wand ranged projectiles
  if (Array.isArray(state.weaponProjectiles)) {
    const monsters = state.monsters || [];
    const barriers = state.fragileBarriers || [];
    const boss = callbacks.bossState;

    for (let p = state.weaponProjectiles.length - 1; p >= 0; p--) {
      const proj = state.weaponProjectiles[p];
      proj.life -= dt;
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      if (proj.life <= 0) {
        state.weaponProjectiles.splice(p, 1);
        continue;
      }

      let consumed = false;
      const owner = state.actors?.[proj.ownerId] || state.actors?.madjid;

      // Hit barrier
      for (let b = 0; b < barriers.length; b++) {
        const br = barriers[b];
        if (br.broken) continue;
        if (rectsIntersect(proj.x - 6, proj.y - 6, 12, 12, br.x, br.y, br.w, br.h)) {
          applyBarrierHit(state, br, owner, proj.weaponId, callbacks);
          consumed = true;
          break;
        }
      }

      // Hit secondary monster
      if (!consumed) {
        for (let m = 0; m < monsters.length; m++) {
          const mon = monsters[m];
          if (mon.defeated || mon.koTimer > 0) continue;
          if (rectsIntersect(proj.x - 6, proj.y - 6, 12, 12, mon.x, mon.y, mon.w, mon.h)) {
            damageSecondaryMonster(state, mon, proj.damage || 24, owner, proj.weaponId, callbacks);
            spawnWeaponBurst(state, proj.x, proj.y, proj.color, 10);
            consumed = true;
            break;
          }
        }
      }

      // Hit boss
      if (!consumed && boss && boss.active && !boss.defeated) {
        if (rectsIntersect(proj.x - 6, proj.y - 6, 12, 12, boss.x, boss.y, boss.w, boss.h)) {
          callbacks.onBossWeaponHit?.(boss, owner, getWeaponDef(proj.weaponId));
          spawnWeaponBurst(state, proj.x, proj.y, proj.color, 12);
          consumed = true;
        }
      }

      if (consumed) {
        state.weaponProjectiles.splice(p, 1);
      }
    }
  }

  // Advance barrier crack/hint flashes
  const barriers = state.fragileBarriers || [];
  for (let i = 0; i < barriers.length; i++) {
    if (barriers[i].crackFlash > 0) {
      barriers[i].crackFlash = Math.max(0, barriers[i].crackFlash - dt);
    }
    if (barriers[i].flashTimer > 0) {
      barriers[i].flashTimer = Math.max(0, barriers[i].flashTimer - dt);
    }
    if (barriers[i].wrongToolTimer > 0) {
      barriers[i].wrongToolTimer = Math.max(0, barriers[i].wrongToolTimer - dt);
    }
  }

  // Advance weapon particles
  if (Array.isArray(state.weaponSparks)) {
    for (let i = state.weaponSparks.length - 1; i >= 0; i--) {
      const sp = state.weaponSparks[i];
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.vy += 260 * dt;
      sp.life -= dt;
      if (sp.life <= 0) {
        state.weaponSparks.splice(i, 1);
      }
    }
  }
}

/* ============================================================================
 * CANVAS2D RENDERERS
 * ============================================================================ */

function drawWeaponIconShape(ctx, weaponId, scale = 1) {
  const def = getWeaponDef(weaponId);
  const canonical = normalizeToolId(weaponId);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (canonical === 'light_sword') {
    ctx.fillStyle = def.primary;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(5, -4);
    ctx.lineTo(3.4, 8);
    ctx.lineTo(-3.4, 8);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = def.secondary;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(2.4, -3);
    ctx.lineTo(0, 7);
    ctx.lineTo(-1.2, -3);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = def.hilt;
    ctx.beginPath();
    ctx.roundRect(-8, 7, 16, 4, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-2, 11, 4, 6);
    ctx.beginPath();
    ctx.arc(0, 18, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (canonical === 'energy_wand') {
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(0, -4);
    ctx.stroke();
    ctx.strokeStyle = def.hilt;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(0, -4);
    ctx.stroke();

    ctx.fillStyle = def.secondary;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 9.5 : 4.2;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(a) * r;
      const py = -10 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = def.primary;
    ctx.beginPath();
    ctx.arc(0, -10, 3.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (canonical === 'mechanism_key') {
    // Sleek emerald/gold grappling & mechanism key
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.strokeStyle = def.secondary;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(0, -6);
    ctx.stroke();

    // Key bow ring & teeth
    ctx.fillStyle = def.primary;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -11, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = def.secondary;
    ctx.fillRect(0, 4, 8, 4);
    ctx.fillRect(0, 10, 6, 3.5);
  } else {
    // Crystal Hammer
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(0, -6);
    ctx.stroke();
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(0, -6);
    ctx.stroke();

    ctx.fillStyle = def.primary;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-12, -16, 24, 12, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = def.secondary;
    ctx.beginPath();
    ctx.roundRect(-4.5, -15, 9, 10, 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawWeaponPickups(ctx, state, time) {
  const pickups = state.weaponPickups || [];
  for (let i = 0; i < pickups.length; i++) {
    const p = pickups[i];
    if (p.collected) continue;
    const def = getWeaponDef(p.weaponId);
    const bob = Math.sin(time * 3.1 + p.bobPhase) * 4.5;

    ctx.save();
    ctx.translate(p.x, p.y + bob);

    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
    grad.addColorStop(0, def.glow);
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.14)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-5, -7, 5, 2.2, -0.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(Math.sin(time * 2 + p.bobPhase) * 0.16);
    drawWeaponIconShape(ctx, p.weaponId, 0.78);
    ctx.restore();
  }
}

export function drawFragileBarriers(ctx, state, time) {
  const barriers = state.fragileBarriers || [];
  for (let i = 0; i < barriers.length; i++) {
    const b = barriers[i];
    if (b.broken) continue;

    if (b.material) {
      // Delegated stylized tool-gated barrier rendered cleanly via foliage module
      continue;
    }

    ctx.save();
    const x = b.x;
    const y = b.y;
    const w = b.w;
    const h = b.h;

    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    if (b.crackFlash > 0) {
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
      grad.addColorStop(1, 'rgba(186, 230, 253, 0.8)');
    } else {
      grad.addColorStop(0, 'rgba(125, 211, 252, 0.62)');
      grad.addColorStop(0.55, 'rgba(56, 189, 248, 0.44)');
      grad.addColorStop(1, 'rgba(14, 116, 144, 0.72)');
    }

    ctx.fillStyle = grad;
    ctx.strokeStyle = '#E0F2FE';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + h * 0.22);
    ctx.lineTo(x + w * 0.62, y + h * 0.36);
    ctx.lineTo(x + w * 0.3, y + h * 0.56);
    ctx.lineTo(x + w - 4, y + h * 0.74);
    ctx.stroke();

    const pulse = 0.25 + 0.12 * Math.sin(time * 4 + i);
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse.toFixed(3)})`;
    ctx.beginPath();
    ctx.roundRect(x + 4, y + 4, Math.max(4, w * 0.28), h - 8, 3);
    ctx.fill();

    ctx.restore();
  }
}

export function drawWeaponSparks(ctx, state) {
  const sparks = state.weaponSparks || [];
  for (let i = 0; i < sparks.length; i++) {
    const sp = sparks[i];
    const alpha = Math.max(0, Math.min(1, sp.life / sp.maxLife));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Render ranged Energy Wand projectiles
  const projs = state.weaponProjectiles || [];
  for (let p = 0; p < projs.length; p++) {
    const pr = projs[p];
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.fillStyle = 'rgba(244, 114, 182, 0.28)';
    ctx.beginPath();
    ctx.arc(0, 0, pr.radius + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FDE68A';
    ctx.strokeStyle = pr.color || '#F472B6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, pr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export function drawWeaponInHand(ctx, actor, handX, handY, facing) {
  if (!actor || !actor.equippedWeapon) return;
  const atk = actor.weaponAttack;
  const swinging = Boolean(atk && atk.active);
  const progress = swinging ? 1 - atk.timer / Math.max(0.05, atk.duration) : 0;
  const def = getWeaponDef(actor.equippedWeapon);
  const canonical = normalizeToolId(actor.equippedWeapon);

  ctx.save();
  ctx.translate(handX, handY);
  ctx.scale(facing, 1);

  if (swinging) {
    const swingAngle = -1.25 + progress * 2.45;
    ctx.save();
    ctx.strokeStyle = def.secondary;
    ctx.lineWidth = canonical === 'crystal_hammer' ? 7 : 5;
    ctx.globalAlpha = Math.max(0, (1 - progress * 0.65) * 0.85);
    ctx.beginPath();
    ctx.arc(8, -2, def.range * 0.46, -1.1, -1.1 + progress * 2.15);
    ctx.stroke();

    ctx.strokeStyle = def.primary;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(8, -2, def.range * 0.34, -0.95, -0.95 + progress * 2.05);
    ctx.stroke();
    ctx.restore();

    ctx.rotate(swingAngle);
  } else {
    ctx.rotate(0.45);
  }

  ctx.translate(0, -8);
  drawWeaponIconShape(ctx, actor.equippedWeapon, 0.92);
  ctx.restore();
}
