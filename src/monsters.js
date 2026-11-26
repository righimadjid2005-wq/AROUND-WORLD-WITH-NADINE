/**
 * src/monsters.js
 * Ugly, grotesque, asymmetrical Secondary Monsters (10 unique types across 5 Worlds,
 * implementing >= 3 distinct AI behavior policies) + 5 multi-phase World Bosses.
 *
 * Distinct Visual Identity:
 * - Madjid & Nadine: Soft rounded beans, bright eyes, blush & accessories
 * - Separation Ghost: Translucent glowing smoky spirit
 * - Monsters & Bosses: Asymmetrical jagged bodies, uneven glowing eyes, fangs,
 *   crooked horns/tusks, scars, oozing slime/lava/ink veins, and floating HP bars.
 */

import { applyActorDamage, spawnHealthOrb } from './health-combat.js';

export const SECONDARY_MONSTER_ARCHETYPES = {
  // World 1 - Jungle
  vine_gnasher: {
    id: 'vine_gnasher',
    name: 'Vine Gnasher',
    worldId: 1,
    policy: 'charger',
    w: 40,
    h: 36,
    maxHp: 50,
    speed: 78,
    chargeSpeed: 215,
    damage: 20,
    bodyColor: '#4A5D23',
    bellyColor: '#8B9A46',
    accentColor: '#FACC15',
    eyeColor: '#F97316',
    trimColor: '#1B220B',
  },
  spore_hurler: {
    id: 'spore_hurler',
    name: 'Mire Sporebag',
    worldId: 1,
    policy: 'spitter',
    w: 38,
    h: 40,
    maxHp: 45,
    speed: 44,
    projectileKind: 'acid_glob',
    damage: 18,
    bodyColor: '#5B3A63',
    bellyColor: '#9E6B9B',
    accentColor: '#A3E635',
    eyeColor: '#BEF264',
    trimColor: '#231328',
  },
  // World 2 - Ice Lands
  frost_tusk: {
    id: 'frost_tusk',
    name: 'Frost-Tusk Brute',
    worldId: 2,
    policy: 'guardian',
    w: 44,
    h: 40,
    maxHp: 70,
    speed: 64,
    damage: 24,
    bodyColor: '#3A6B8C',
    bellyColor: '#90CAE6',
    accentColor: '#E0F7FF',
    eyeColor: '#38BDF8',
    trimColor: '#142B3E',
  },
  icicle_spitter: {
    id: 'icicle_spitter',
    name: 'Rime Spit-Hag',
    worldId: 2,
    policy: 'spitter',
    w: 38,
    h: 38,
    maxHp: 50,
    speed: 52,
    projectileKind: 'frost_shard',
    damage: 20,
    bodyColor: '#4A5E7A',
    bellyColor: '#A8D1EA',
    accentColor: '#7DD3FC',
    eyeColor: '#FDE047',
    trimColor: '#182436',
  },
  // World 3 - Volcano
  cinder_hound: {
    id: 'cinder_hound',
    name: 'Cinderjaw Stalker',
    worldId: 3,
    policy: 'charger',
    w: 42,
    h: 34,
    maxHp: 60,
    speed: 96,
    chargeSpeed: 245,
    damage: 24,
    bodyColor: '#3B2322',
    bellyColor: '#8F3323',
    accentColor: '#FB923C',
    eyeColor: '#FACC15',
    trimColor: '#160B0A',
  },
  slag_bulwark: {
    id: 'slag_bulwark',
    name: 'Slag Shellback',
    worldId: 3,
    policy: 'guardian',
    w: 46,
    h: 42,
    maxHp: 80,
    speed: 58,
    damage: 26,
    bodyColor: '#402B30',
    bellyColor: '#7A423E',
    accentColor: '#FF5722',
    eyeColor: '#FDBA74',
    trimColor: '#170E10',
  },
  // World 4 - Space
  void_leech: {
    id: 'void_leech',
    name: 'Xeno Grapple-Jaw',
    worldId: 4,
    policy: 'charger',
    w: 40,
    h: 36,
    maxHp: 65,
    speed: 90,
    chargeSpeed: 235,
    damage: 22,
    bodyColor: '#314155',
    bellyColor: '#5B6C8F',
    accentColor: '#22D3EE',
    eyeColor: '#F43F5E',
    trimColor: '#0F172A',
  },
  plasma_orbiter: {
    id: 'plasma_orbiter',
    name: 'Blight Cyborg-Eye',
    worldId: 4,
    policy: 'spitter',
    w: 38,
    h: 40,
    maxHp: 60,
    speed: 62,
    projectileKind: 'plasma_orb',
    damage: 22,
    bodyColor: '#4B325E',
    bellyColor: '#7B5491',
    accentColor: '#38BDF8',
    eyeColor: '#FDE047',
    trimColor: '#1A1026',
  },
  // World 5 - Ocean World
  barnacle_hulk: {
    id: 'barnacle_hulk',
    name: 'Barnacle Maw-Hulk',
    worldId: 5,
    policy: 'guardian',
    w: 46,
    h: 42,
    maxHp: 85,
    speed: 60,
    damage: 25,
    bodyColor: '#1E525A',
    bellyColor: '#48888F',
    accentColor: '#F472B6',
    eyeColor: '#FDE047',
    trimColor: '#0A2226',
  },
  ink_wretch: {
    id: 'ink_wretch',
    name: 'Trench Ink-Wretch',
    worldId: 5,
    policy: 'spitter',
    w: 40,
    h: 38,
    maxHp: 65,
    speed: 68,
    projectileKind: 'ink_bolt',
    damage: 22,
    bodyColor: '#2A2347',
    bellyColor: '#52447A',
    accentColor: '#34D399',
    eyeColor: '#FB7185',
    trimColor: '#100D1E',
  },
};

export const WORLD_BOSS_ARCHETYPES = {
  1: {
    id: 'jungle_gorgon',
    name: 'Vilethorn Gorgon',
    subtitle: 'Blighted Beast of the Jungle',
    worldId: 1,
    bodyColor: '#3F5D2B',
    trimColor: '#16210E',
    accentColor: '#A3E635',
    eyeColor: '#F97316',
    crownColor: '#FDE047',
    projectileKind: 'acid_glob',
    speed: 96,
    maxHp: 120,
  },
  2: {
    id: 'ice_behemoth',
    name: 'Frostmaw Behemoth',
    subtitle: 'Scarred Giant of Ice Lands',
    worldId: 2,
    bodyColor: '#3C6E94',
    trimColor: '#13273A',
    accentColor: '#BAE6FD',
    eyeColor: '#38BDF8',
    crownColor: '#FDE047',
    projectileKind: 'frost_shard',
    speed: 108,
    maxHp: 140,
  },
  3: {
    id: 'volcano_titan',
    name: 'Cinderjaw Titan',
    subtitle: 'Molten Horror of Volcano Peak',
    worldId: 3,
    bodyColor: '#3D2422',
    trimColor: '#140908',
    accentColor: '#FF6B3D',
    eyeColor: '#FACC15',
    crownColor: '#FDE047',
    projectileKind: 'magma_spit',
    speed: 118,
    maxHp: 160,
  },
  4: {
    id: 'space_leviathan',
    name: 'Voidmaw Xenobeast',
    subtitle: 'Hull-Crusher of Deep Space',
    worldId: 4,
    bodyColor: '#3B3059',
    trimColor: '#120D24',
    accentColor: '#22D3EE',
    eyeColor: '#F43F5E',
    crownColor: '#FDE047',
    projectileKind: 'plasma_orb',
    speed: 126,
    maxHp: 175,
  },
  5: {
    id: 'ocean_sovereign',
    name: 'Abyssal Kraken Sovereign',
    subtitle: 'Trench Terror of Ocean World',
    worldId: 5,
    bodyColor: '#1B5A62',
    trimColor: '#072226',
    accentColor: '#F472B6',
    eyeColor: '#FDE047',
    crownColor: '#FDE047',
    projectileKind: 'ink_bolt',
    speed: 132,
    maxHp: 190,
  },
};

/**
 * Instantiates mutable secondary monsters from a level definition.
 * @param {any[]} defs
 */
export function createMonstersForLevel(defs = []) {
  return defs.map((def, idx) => {
    const arch = SECONDARY_MONSTER_ARCHETYPES[def.archetype] || SECONDARY_MONSTER_ARCHETYPES.vine_gnasher;
    const minX = def.minX ?? (def.x - 110);
    const maxX = def.maxX ?? (def.x + 110);
    return {
      id: def.id || `mon_${idx}`,
      archetype: arch.id,
      name: arch.name,
      policy: arch.policy,
      x: def.x,
      y: def.y,
      homeX: def.x,
      homeY: def.y,
      baseY: def.y,
      w: arch.w,
      h: arch.h,
      vx: 0,
      vy: 0,
      minX,
      maxX,
      dir: def.dir || -1,
      initialDir: def.dir || -1,
      speed: arch.speed,
      chargeSpeed: arch.chargeSpeed || 200,
      projectileKind: arch.projectileKind || null,
      damage: arch.damage,
      hp: arch.maxHp,
      maxHp: arch.maxHp,
      defeated: false,
      koTimer: 0,
      stunTimer: 0,
      hurtFlashTimer: 0,
      windupTimer: 0,
      attackTimer: 0,
      attackCooldown: 1.4 + idx * 0.4,
      initialAttackCooldown: 1.4 + idx * 0.4,
      shieldedFront: arch.policy === 'guardian',
      bodyColor: arch.bodyColor,
      bellyColor: arch.bellyColor,
      accentColor: arch.accentColor,
      eyeColor: arch.eyeColor,
      trimColor: arch.trimColor,
    };
  });
}

/**
 * Damages a secondary monster from player weapon attacks or stomps.
 * Drops +35 HP Health Orb cleanly upon KO.
 * @param {any} state
 * @param {any} monster
 * @param {number} damage
 * @param {any} attacker
 * @param {string | null} toolId
 * @param {any} callbacks
 */
export function damageSecondaryMonster(state, monster, damage, attacker, toolId = null, callbacks = {}) {
  if (!monster || monster.defeated || monster.koTimer > 0) return { hit: false, defeated: false };

  // Shielded guardians deflect light hits from the front unless hit by heavy hammer, wand, or flanked
  const attackerCx = attacker ? attacker.x + attacker.w * 0.5 : monster.x;
  const fromFront = (attackerCx < monster.x + monster.w * 0.5 && monster.dir < 0) ||
    (attackerCx >= monster.x + monster.w * 0.5 && monster.dir > 0);
  const breaksShield =
    toolId === 'crystal_hammer' ||
    toolId === 'plasma_hammer' ||
    toolId === 'energy_wand' ||
    toolId === 'star_wand';

  let finalDmg = Math.max(10, Math.round(damage));
  if (monster.shieldedFront && fromFront) {
    if (breaksShield) {
      monster.shieldedFront = false;
      monster.stunTimer = Math.max(monster.stunTimer, 1.5);
    } else {
      // Blocked from front: sparks + small chip
      finalDmg = 6;
      monster.hurtFlashTimer = 0.12;
      if (attacker) {
        attacker.vx = (attackerCx < monster.x ? -1 : 1) * 160;
      }
    }
  }

  monster.hp = Math.max(0, monster.hp - finalDmg);
  monster.hurtFlashTimer = 0.2;
  monster.stunTimer = Math.max(monster.stunTimer, 0.55);
  monster.windupTimer = 0;

  // Knockback
  if (attacker) {
    const push = attackerCx < monster.x + monster.w * 0.5 ? 1 : -1;
    monster.vx = push * 135;
  }

  callbacks.onMonsterHit?.({ monster, damage: finalDmg });

  if (monster.hp <= 0) {
    monster.koTimer = 0.42;
    monster.vx = (monster.vx || 100);
    monster.vy = -170;
    spawnHealthOrb(state, monster.x + monster.w * 0.5, monster.y + monster.h * 0.5, 35);
    callbacks.onMonsterDefeat?.({ monster });
    return { hit: true, defeated: true, damage: finalDmg };
  }

  return { hit: true, defeated: false, damage: finalDmg };
}

/**
 * Steps all secondary monsters and monster projectiles in the level.
 * Implements 3 distinct policies: charger, spitter, guardian.
 * @param {any} state
 * @param {number} dt
 * @param {any} callbacks
 */
export function stepSecondaryMonsters(state, dt, callbacks = {}) {
  if (!state) return;
  if (!Array.isArray(state.monsters)) state.monsters = [];
  if (!Array.isArray(state.monsterProjectiles)) state.monsterProjectiles = [];

  const actors = [state.actors?.madjid, state.actors?.nadine].filter(
    (a) => a && a.hp > 0 && !a.devouredByGhost && !a.phaseDash?.active
  );

  // 1. Step monsters
  for (let i = 0; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (m.defeated) continue;

    if (m.hurtFlashTimer > 0) m.hurtFlashTimer = Math.max(0, m.hurtFlashTimer - dt);

    // KO topple dissolve animation
    if (m.koTimer > 0) {
      m.koTimer = Math.max(0, m.koTimer - dt);
      m.x += m.vx * dt;
      m.vy += 620 * dt;
      m.y += m.vy * dt;
      if (m.koTimer <= 0) {
        m.defeated = true;
      }
      continue;
    }

    if (m.stunTimer > 0) {
      m.stunTimer = Math.max(0, m.stunTimer - dt);
      m.x = Math.max(m.minX, Math.min(m.maxX, m.x + m.vx * dt));
      m.vx *= Math.pow(0.04, dt);
      continue;
    }

    if (m.attackCooldown > 0) m.attackCooldown = Math.max(0, m.attackCooldown - dt);

    // Find closest player target
    let target = null;
    let targetDist = Infinity;
    const mcx = m.x + m.w * 0.5;
    const mcy = m.y + m.h * 0.5;
    for (let a = 0; a < actors.length; a++) {
      const act = actors[a];
      const d = Math.hypot(act.x + act.w * 0.5 - mcx, act.y + act.h * 0.5 - mcy);
      if (d < targetDist) {
        targetDist = d;
        target = act;
      }
    }

    const sameBandY = target ? Math.abs((target.y + target.h * 0.5) - mcy) < 120 : false;

    if (m.policy === 'charger') {
      if (m.attackTimer > 0) {
        // Active lunge charge
        m.attackTimer = Math.max(0, m.attackTimer - dt);
        m.x += m.dir * m.chargeSpeed * dt;
      } else if (m.windupTimer > 0) {
        // Crouch windup telegraph
        m.windupTimer = Math.max(0, m.windupTimer - dt);
        if (m.windupTimer <= 0) {
          m.attackTimer = 0.55;
          m.attackCooldown = 2.0;
          callbacks.onMonsterAttack?.({ monster: m, kind: 'charge' });
        }
      } else if (target && sameBandY && targetDist < 230 && m.attackCooldown <= 0) {
        m.dir = target.x + target.w * 0.5 >= mcx ? 1 : -1;
        m.windupTimer = 0.45;
      } else {
        // Patrol
        m.x += m.dir * m.speed * dt;
      }
    } else if (m.policy === 'spitter') {
      if (m.windupTimer > 0) {
        m.windupTimer = Math.max(0, m.windupTimer - dt);
        if (m.windupTimer <= 0 && target) {
          const tcx = target.x + target.w * 0.5;
          const tcy = target.y + target.h * 0.4;
          const dx = tcx - mcx;
          const dy = tcy - mcy;
          const len = Math.max(1, Math.hypot(dx, dy));
          const projSpeed = 240;
          state.monsterProjectiles.push({
            id: `mproj_${Date.now()}_${Math.random()}`,
            x: mcx + m.dir * 16,
            y: mcy - 4,
            vx: (dx / len) * projSpeed,
            vy: (dy / len) * projSpeed,
            radius: 7,
            damage: Math.max(12, Math.round(m.damage * 0.8)),
            kind: m.projectileKind || 'acid_glob',
            color: m.accentColor,
            life: 2.6,
          });
          m.attackCooldown = 2.6;
          callbacks.onMonsterAttack?.({ monster: m, kind: 'spit' });
        }
      } else if (target && targetDist < 340 && Math.abs((target.y + target.h * 0.5) - mcy) < 170) {
        m.dir = target.x + target.w * 0.5 >= mcx ? 1 : -1;
        // Kite backward slightly if player is too close
        if (targetDist < 120) {
          m.x -= m.dir * m.speed * 0.9 * dt;
        }
        if (m.attackCooldown <= 0) {
          m.windupTimer = 0.52;
        }
      } else {
        m.x += m.dir * m.speed * dt;
      }
    } else {
      // guardian: heavy territorial patrol + telegraphed slam
      if (m.windupTimer > 0) {
        m.windupTimer = Math.max(0, m.windupTimer - dt);
        if (m.windupTimer <= 0) {
          m.attackCooldown = 2.4;
          m.vy = -190;
          callbacks.onMonsterAttack?.({ monster: m, kind: 'slam' });
          // Shockwave check against close actors
          actors.forEach((act) => {
            const d = Math.hypot(act.x + act.w * 0.5 - mcx, act.y + act.h * 0.5 - mcy);
            if (d < 86) {
              applyActorDamage(state, act, m.damage, { sourceX: mcx, cause: m.name }, callbacks);
            }
          });
        }
      } else if (target && sameBandY && targetDist < 95 && m.attackCooldown <= 0) {
        m.dir = target.x + target.w * 0.5 >= mcx ? 1 : -1;
        m.windupTimer = 0.5;
      } else {
        if (target && sameBandY && targetDist < 220) {
          m.dir = target.x + target.w * 0.5 >= mcx ? 1 : -1;
        }
        m.x += m.dir * m.speed * dt;
      }
    }

    // Clamp to platform span
    if (m.x <= m.minX) {
      m.x = m.minX;
      m.dir = 1;
      m.attackTimer = 0;
    } else if (m.x >= m.maxX) {
      m.x = m.maxX;
      m.dir = -1;
      m.attackTimer = 0;
    }

    // Simple hop gravity for slams
    if (m.y < m.baseY || m.vy < 0) {
      m.vy += 820 * dt;
      m.y += m.vy * dt;
      if (m.y >= m.baseY) {
        m.y = m.baseY;
        m.vy = 0;
      }
    }

    // Contact collision with players
    for (let a = 0; a < actors.length; a++) {
      const act = actors[a];
      const overlaps =
        act.x + 4 < m.x + m.w &&
        act.x + act.w - 4 > m.x &&
        act.y + 4 < m.y + m.h &&
        act.y + act.h - 2 > m.y;
      if (!overlaps) continue;

      // Top stomp hurts non-guardian monster cleanly
      const fallingOnTop = act.vy > 60 && act.y + act.h - m.y < 18 && !m.shieldedFront;
      if (fallingOnTop) {
        act.vy = -340;
        act.grounded = false;
        damageSecondaryMonster(state, m, 25, act, null, callbacks);
      } else if (act.invulnTimer <= 0) {
        applyActorDamage(state, act, m.damage, { sourceX: mcx, cause: m.name }, callbacks);
      }
    }
  }

  // 2. Step hostile projectiles
  for (let p = state.monsterProjectiles.length - 1; p >= 0; p--) {
    const proj = state.monsterProjectiles[p];
    proj.life -= dt;
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    if (proj.life <= 0) {
      state.monsterProjectiles.splice(p, 1);
      continue;
    }

    // Check actor hits
    let hitActor = false;
    for (let a = 0; a < actors.length; a++) {
      const act = actors[a];
      const dist = Math.hypot(act.x + act.w * 0.5 - proj.x, act.y + act.h * 0.5 - proj.y);
      if (dist <= proj.radius + 16) {
        applyActorDamage(state, act, proj.damage, { sourceX: proj.x, cause: 'Monster Projectile' }, callbacks);
        hitActor = true;
        break;
      }
    }
    if (hitActor) {
      state.monsterProjectiles.splice(p, 1);
    }
  }
}

/**
 * Renders grotesque asymmetrical secondary monsters + floating HP bar + projectiles.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} state
 * @param {number} time
 * @param {{ minX: number; maxX: number } | null} viewRange
 */
export function renderMonstersAndProjectiles(ctx, state, time = 0, viewRange = null) {
  const monsters = state?.monsters || [];
  for (let i = 0; i < monsters.length; i++) {
    const m = monsters[i];
    if (m.defeated) continue;
    if (viewRange && (m.x + m.w < viewRange.minX - 60 || m.x > viewRange.maxX + 60)) continue;

    const cx = m.x + m.w * 0.5;
    const cy = m.y + m.h * 0.5;
    const flash = m.hurtFlashTimer > 0 && Math.floor(time * 24) % 2 === 0;
    const telegraph = m.windupTimer > 0;
    const alpha = m.koTimer > 0 ? Math.max(0.1, m.koTimer / 0.42) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (m.koTimer > 0) {
      ctx.rotate((1 - alpha) * 1.4 * m.dir);
    }

    // Ground shadow
    ctx.fillStyle = 'rgba(10, 12, 22, 0.35)';
    ctx.beginPath();
    ctx.ellipse(0, m.h * 0.5 + 1, m.w * 0.48, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    const wobble = Math.sin(time * 7 + i) * 1.6;
    const squash = telegraph ? 0.86 : 1;
    ctx.scale(m.dir, squash);

    // Spines / crooked horns / asymmetrical hump
    ctx.fillStyle = flash ? '#FFFFFF' : m.accentColor;
    ctx.strokeStyle = m.trimColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, -m.h * 0.38);
    ctx.lineTo(-16, -m.h * 0.65);
    ctx.lineTo(-2, -m.h * 0.45);
    ctx.lineTo(5, -m.h * 0.72);
    ctx.lineTo(12, -m.h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Grotesque asymmetrical hunched silhouette
    ctx.fillStyle = flash ? '#FFF8D6' : m.bodyColor;
    ctx.strokeStyle = telegraph ? '#FBBF24' : m.trimColor;
    ctx.lineWidth = telegraph ? 3 : 2.2;
    ctx.beginPath();
    ctx.moveTo(-m.w * 0.46, m.h * 0.42);
    ctx.quadraticCurveTo(-m.w * 0.54, -m.h * 0.1 + wobble, -m.w * 0.2, -m.h * 0.46);
    ctx.quadraticCurveTo(m.w * 0.25, -m.h * 0.52, m.w * 0.48, -m.h * 0.05);
    ctx.quadraticCurveTo(m.w * 0.5, m.h * 0.45, -m.w * 0.46, m.h * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Belly scars / pustule patch
    ctx.fillStyle = m.bellyColor;
    ctx.beginPath();
    ctx.ellipse(4, 5, m.w * 0.24, m.h * 0.2, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Frontal carapace shield if guardian still has front armor
    if (m.shieldedFront) {
      ctx.fillStyle = m.accentColor;
      ctx.strokeStyle = m.trimColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(m.w * 0.26, -m.h * 0.36, 9, m.h * 0.72, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Uneven glowing grotesque eyes (1 huge + 1 slit/small)
    ctx.fillStyle = telegraph ? '#FFFFFF' : m.eyeColor;
    ctx.strokeStyle = m.trimColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(8, -6, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-1, -10, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(9.5, -6, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Jagged underbite fangs
    ctx.fillStyle = '#FEFCE8';
    ctx.beginPath();
    ctx.moveTo(4, 7);
    ctx.lineTo(7, 1);
    ctx.lineTo(10, 7);
    ctx.lineTo(13, 0);
    ctx.lineTo(16, 7);
    ctx.closePath();
    ctx.fill();

    // Attack telegraph ring / sight cue
    if (telegraph) {
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(10, -4, 15 + Math.sin(time * 28) * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Floating HP bar above monster (crisp, non-flipped)
    if (m.koTimer <= 0 && !m.defeated) {
      const barW = 42;
      const barH = 5;
      const bx = cx - barW * 0.5;
      const by = m.y - 16;
      const ratio = Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHp)));

      ctx.save();
      ctx.fillStyle = 'rgba(15, 18, 30, 0.85)';
      ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
      ctx.fillStyle = ratio > 0.5 ? '#4ADE80' : ratio > 0.25 ? '#FBBF24' : '#F87171';
      ctx.fillRect(bx, by, barW * ratio, barH);
      ctx.restore();
    }
  }

  // Render projectiles
  const projs = state?.monsterProjectiles || [];
  for (let p = 0; p < projs.length; p++) {
    const pr = projs[p];
    ctx.save();
    ctx.translate(pr.x, pr.y);
    ctx.fillStyle = pr.color || '#A3E635';
    ctx.strokeStyle = '#1E1B2E';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, pr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Renders the grotesque asymmetrical Boss silhouette shared by bosses.js.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} boss
 * @param {number} time
 */
export function renderGrotesqueBoss(ctx, boss, time = 0) {
  if (!boss || !boss.active || boss.defeated) return;

  const cx = boss.x + boss.w * 0.5;
  const bottomY = boss.y + boss.h;
  const flash = boss.hurtFlashTimer > 0 && Math.floor(time * 22) % 2 === 0;
  const bob = boss.stunTimer > 0 ? Math.sin(time * 32) * 2.5 : Math.sin(time * 4.5) * 2;
  const phase2 = boss.hp <= Math.ceil(boss.maxHp * 0.5);

  ctx.save();
  ctx.translate(cx, bottomY);

  // Ground shadow
  ctx.fillStyle = 'rgba(12, 14, 24, 0.42)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 42, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, -boss.h * 0.5 + bob);

  // Teamwork Shield Dome
  if (boss.shielded) {
    ctx.strokeStyle = 'rgba(124, 196, 250, 0.85)';
    ctx.fillStyle = 'rgba(124, 196, 250, 0.16)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const faceDir = boss.dir || -1;
  ctx.save();
  ctx.scale(faceDir, 1);

  // Crooked horns & dorsal spikes
  ctx.fillStyle = flash ? '#FFF8D6' : (boss.accentColor || '#FB923C');
  ctx.strokeStyle = boss.trimColor;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-24, -22);
  ctx.lineTo(-34, -42);
  ctx.lineTo(-10, -28);
  ctx.lineTo(2, -44);
  ctx.lineTo(14, -26);
  ctx.lineTo(28, -38);
  ctx.lineTo(24, -18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Jagged grotesque asymmetrical boss hull
  ctx.fillStyle = flash ? '#FFF8D6' : boss.bodyColor;
  ctx.strokeStyle = phase2 ? '#F97316' : boss.trimColor;
  ctx.lineWidth = phase2 ? 3.5 : 3;
  ctx.beginPath();
  ctx.moveTo(-36, 30);
  ctx.quadraticCurveTo(-44, -8, -24, -30);
  ctx.quadraticCurveTo(4, -38, 34, -22);
  ctx.quadraticCurveTo(44, 6, 32, 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Diagonal scar & magma/slime fissure
  ctx.strokeStyle = boss.accentColor || '#FACC15';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.lineTo(-6, 4);
  ctx.lineTo(-14, 18);
  ctx.stroke();

  // Three uneven glowing eyes
  const eyeColor = boss.eyeColor || '#FDE047';
  [
    { x: 14, y: -10, r: 7.5 },
    { x: 0, y: -15, r: 4.4 },
    { x: 24, y: -2, r: 3.8 },
  ].forEach((eye) => {
    ctx.fillStyle = eyeColor;
    ctx.strokeStyle = boss.trimColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, eye.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(eye.x + 1.8, eye.y, eye.r * 0.36, 0, Math.PI * 2);
    ctx.fill();
  });

  // Jagged grinning maw with uneven tusks
  ctx.fillStyle = '#140B16';
  ctx.beginPath();
  ctx.roundRect(-8, 4, 34, 14, 6);
  ctx.fill();
  ctx.fillStyle = '#FEF3C7';
  for (let t = -4; t <= 20; t += 8) {
    ctx.beginPath();
    ctx.moveTo(t, 18);
    ctx.lineTo(t + 3, 9);
    ctx.lineTo(t + 6, 18);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Weak-point Crown target above boss head
  const crownPulse = boss.shielded ? 0.55 : 1 + Math.sin(time * 6) * 0.1;
  ctx.save();
  ctx.translate(0, -40);
  ctx.scale(crownPulse, crownPulse);
  ctx.fillStyle = boss.shielded ? '#94A3B8' : (boss.crownColor || '#FDE047');
  ctx.strokeStyle = '#2B2142';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-15, 5);
  ctx.lineTo(-17, -9);
  ctx.lineTo(-6, -2);
  ctx.lineTo(0, -13);
  ctx.lineTo(6, -2);
  ctx.lineTo(17, -9);
  ctx.lineTo(15, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Boss Name + Floating HP Bar above head
  const barW = 92;
  const ratio = Math.max(0, Math.min(1, boss.hp / Math.max(1, boss.maxHp)));
  ctx.fillStyle = 'rgba(15, 18, 30, 0.88)';
  ctx.fillRect(-barW * 0.5 - 1, -66, barW + 2, 7);
  ctx.fillStyle = phase2 ? '#F97316' : '#EF4444';
  ctx.fillRect(-barW * 0.5, -65, barW * ratio, 5);

  ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(18, 18, 32, 0.92)';
  const tag = `${boss.name} (${Math.ceil(boss.hp)}/${boss.maxHp})`;
  ctx.strokeText(tag, 0, -70);
  ctx.fillStyle = '#FFF4D2';
  ctx.fillText(tag, 0, -70);

  ctx.restore();
}
