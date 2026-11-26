/**
 * src/bosses.js
 * Cooperative Grotesque World Bosses (5 Worlds) & Open-World Guardian Encounter
 * for "Around the World with Nadine".
 *
 * - Spawns a grotesque multi-phase boss at the climax arena of every seamless World (Worlds 1..5)
 * - World Doors stay strictly locked until `boss.defeated === true`
 * - Damageable by BOTH equipped Weapons/Tools AND cooperative Crown Weak-Point Stomps
 */

import { WORLD_BOSS_ARCHETYPES, renderGrotesqueBoss } from './monsters.js';
import { applyActorDamage } from './health-combat.js';

export const BOSS_ARCHETYPES = WORLD_BOSS_ARCHETYPES;

export function getBossArchetypeForWorld(worldId) {
  const safeId = Math.max(1, Math.min(5, Number(worldId) || 1));
  return WORLD_BOSS_ARCHETYPES[safeId] || WORLD_BOSS_ARCHETYPES[1];
}

/**
 * Creates a grotesque multi-phase World Boss for any story world (`worldId >= 1`)
 * or custom world pack where `hasBoss !== false`.
 */
export function createBossForLevel(level) {
  if (!level || level.hasBoss === false) return null;
  if (!level.worldId && level.stageInWorld !== 5) return null;

  const arch = getBossArchetypeForWorld(level.worldId || 1);
  const groundY = level.bossArena?.groundY ?? level.platforms?.[0]?.y ?? level.worldHeight - 108;
  const arenaMinX = level.bossArena?.minX ?? level.bossArena?.arenaMinX ?? Math.round(level.worldWidth * 0.72);
  const arenaMaxX = level.bossArena?.maxX ?? level.bossArena?.arenaMaxX ?? Math.round(level.worldWidth * 0.91);
  const startX = level.bossArena?.bossX ?? Math.round((arenaMinX + arenaMaxX) * 0.5);

  const worldId = Math.max(1, Number(level.worldId) || 1);
  const initialShielded =
    typeof level.bossArena?.initialShielded === 'boolean'
      ? level.bossArena.initialShielded
      : worldId >= 2;

  return createBossInstance(arch, {
    x: startX,
    y: groundY - 76,
    minX: arenaMinX,
    maxX: arenaMaxX,
    maxHp: level.bossArena?.maxHp ?? arch.maxHp,
    worldId,
    initialShielded,
    isOpenWorld: false,
  });
}

export function createOpenWorldBoss(groundY = 600, worldWidth = 2200) {
  return createBossInstance(WORLD_BOSS_ARCHETYPES[4], {
    x: 1380,
    y: groundY - 76,
    minX: 980,
    maxX: Math.min(worldWidth - 140, 1780),
    maxHp: 120,
    worldId: 4,
    initialShielded: false,
    isOpenWorld: true,
  });
}

function createBossInstance(arch, opts) {
  const worldId = Math.max(1, Number(opts.worldId ?? arch.worldId) || 1);
  const difficultyScale = opts.isOpenWorld ? 1 : 1 + Math.max(0, worldId - 1) * 0.16;
  return {
    active: true,
    defeated: false,
    id: arch.id,
    name: arch.name,
    subtitle: arch.subtitle,
    worldId,
    difficultyScale,
    bodyColor: arch.bodyColor,
    trimColor: arch.trimColor,
    accentColor: arch.accentColor,
    eyeColor: arch.eyeColor,
    crownColor: arch.crownColor,
    projectileKind: arch.projectileKind || 'magma_spit',
    x: opts.x,
    y: opts.y,
    homeX: opts.x,
    homeY: opts.y,
    w: 78,
    h: 76,
    minX: opts.minX,
    maxX: opts.maxX,
    dir: -1,
    initialDir: -1,
    speed: Math.round(arch.speed * (opts.isOpenWorld ? 1 : 1 + Math.max(0, worldId - 1) * 0.07)),
    hp: opts.maxHp,
    maxHp: opts.maxHp,
    shielded: Boolean(opts.initialShielded),
    initialShielded: Boolean(opts.initialShielded),
    shieldCycleTimer: worldId >= 2 && !opts.isOpenWorld ? 5.2 : 6.5,
    stunTimer: 0,
    hurtFlashTimer: 0,
    jumpSlamTimer: Math.max(1.8, 3.8 / difficultyScale),
    spitCooldown: Math.max(1.2, 2.8 / difficultyScale),
    vy: 0,
    baseY: opts.y,
    isOpenWorld: Boolean(opts.isOpenWorld),
  };
}

export function getBossStatusLabel(boss) {
  if (!boss || !boss.active) return 'Defeated · World Door Open!';
  const phase2 = boss.hp <= Math.ceil(boss.maxHp * 0.5);
  if (boss.stunTimer > 0) return 'Staggered · Attack or Stomp!';
  if (boss.shielded) return 'Shielded · Team Up or Hammer!';
  return phase2 ? 'Phase 2 Enraged · Strike!' : 'Boss Arena · Attack or Stomp!';
}

/**
 * Applies weapon damage directly to an active World Boss.
 */
export function damageBossWithWeapon(boss, actor, def, levelState, callbacks = {}) {
  if (!boss || !boss.active || boss.defeated) return { hit: false, defeated: false };
  const weaponId = def?.id || actor?.equippedWeapon || '';
  const breaksShield = weaponId === 'crystal_hammer' || weaponId === 'plasma_hammer';

  if (boss.shielded) {
    if (breaksShield) {
      boss.shielded = false;
      boss.stunTimer = Math.max(boss.stunTimer, 1.3);
      callbacks.onBossShieldBreak?.(boss);
    } else {
      boss.hurtFlashTimer = 0.14;
      callbacks.onBossShieldDeflect?.(boss, actor);
      return { hit: false, defeated: false, shielded: true };
    }
  }

  const dmg = Math.max(18, Math.round(def?.damage || 26));
  boss.hp = Math.max(0, boss.hp - dmg);
  boss.hurtFlashTimer = 0.25;
  if (boss.hp <= Math.ceil(boss.maxHp * 0.5)) {
    boss.speed = Math.max(boss.speed, 138);
  }
  callbacks.onBossHit?.(boss, actor, dmg);

  if (boss.hp <= 0) {
    finalizeBossDefeat(boss, levelState, callbacks);
    return { hit: true, defeated: true, damage: dmg };
  }
  return { hit: true, defeated: false, damage: dmg };
}

function finalizeBossDefeat(boss, levelState, callbacks = {}) {
  boss.defeated = true;
  boss.active = false;
  if (!boss.isOpenWorld && levelState) {
    levelState.bossDefeated = true;
    levelState.portalUnlocked = true;
    if (levelState.keysRequired > levelState.keysCollected) {
      levelState.keysCollected = levelState.keysRequired;
    }
    callbacks.onPortalUnlock?.(levelState.exit);
  }
  callbacks.onBossDefeat?.(boss);
}

/**
 * Steps cooperative multi-phase boss AI, crown stomps, phase-2 projectiles & knockback.
 */
export function stepBoss(boss, levelState, mechState, dt, callbacks = {}) {
  if (!boss || !boss.active || boss.defeated || levelState.completed) return boss;

  if (boss.hurtFlashTimer > 0) boss.hurtFlashTimer = Math.max(0, boss.hurtFlashTimer - dt);

  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;
  const actorList = [madjid, nadine].filter(
    (a) => a && a.hp > 0 && !a.devouredByGhost && !a.phaseDash?.active
  );

  const phase2 = boss.hp <= Math.ceil(boss.maxHp * 0.5);
  const worldId = boss.worldId || 1;
  const diffScale = boss.difficultyScale || 1;
  const nearArena = actorList.some(
    (a) => a.x + a.w >= boss.minX - 240 && a.x <= boss.maxX + 240
  );
  if (nearArena) {
    boss.engaged = true;
  }

  // Team proximity or carrying shatters active Teamwork Shield
  // For Worlds 2-5, require players to actually engage near the boss arena first so spawn proximity doesn't strip it prematurely.
  const canBreakViaProximity = worldId <= 1 || boss.isOpenWorld || nearArena || boss.engaged;
  const pairDist =
    madjid && nadine
      ? Math.hypot(madjid.x - nadine.x, madjid.y - nadine.y)
      : 999;
  if (boss.shielded && canBreakViaProximity && (pairDist <= 130 || Boolean(mechState?.carrying))) {
    boss.shielded = false;
    boss.stunTimer = Math.max(boss.stunTimer, 1.1);
    callbacks.onBossShieldBreak?.(boss);
  }

  // Periodic Teamwork Shield cycling (Phase 2 on all worlds; Phase 1+2 on Worlds 2-5)
  if ((phase2 || (!boss.isOpenWorld && worldId >= 2 && nearArena)) && boss.stunTimer <= 0) {
    boss.shieldCycleTimer -= dt;
    if (boss.shieldCycleTimer <= 0) {
      boss.shielded = !boss.shielded;
      const baseHold = phase2 ? 4.8 : 4.0;
      const baseOpen = phase2 ? Math.max(4.6, 8.2 / diffScale) : Math.max(5.5, 9.5 / diffScale);
      boss.shieldCycleTimer = boss.shielded ? baseHold : baseOpen;
    }
  }

  if (boss.stunTimer > 0) {
    boss.stunTimer = Math.max(0, boss.stunTimer - dt);
  } else {
    const activeSpeed = nearArena ? boss.speed * (phase2 ? 1.24 : 1) : boss.speed * 0.45;
    boss.x += boss.dir * activeSpeed * dt;
    if (boss.x <= boss.minX) {
      boss.x = boss.minX;
      boss.dir = 1;
    } else if (boss.x >= boss.maxX) {
      boss.x = boss.maxX;
      boss.dir = -1;
    }

    if (nearArena) {
      boss.jumpSlamTimer -= dt;
      if (boss.jumpSlamTimer <= 0 && boss.y >= boss.baseY - 1) {
        boss.jumpSlamTimer = Math.max(1.45, (phase2 ? 2.8 : 4.0) / diffScale);
        boss.vy = phase2 ? -375 : -315;
      }

      // Phase 2 grotesque projectile spit (multi-spread in higher worlds)
      if (phase2) {
        boss.spitCooldown -= dt;
        if (boss.spitCooldown <= 0 && actorList.length > 0) {
          boss.spitCooldown = Math.max(1.25, 2.5 / diffScale);
          const target = actorList[0];
          const bcx = boss.x + boss.w * 0.5;
          const bcy = boss.y + boss.h * 0.4;
          const dx = target.x + target.w * 0.5 - bcx;
          const dy = target.y + target.h * 0.5 - bcy;
          const baseAngle = Math.atan2(dy, dx);
          const worldId = boss.worldId || 1;
          const spreadOffsets = !boss.isOpenWorld && worldId >= 4 ? [-0.22, 0, 0.22] : !boss.isOpenWorld && worldId >= 2 ? [-0.14, 0.14] : [0];
          const projSpeed = Math.round(255 * diffScale);
          const projDmg = Math.min(30, 18 + Math.max(0, worldId - 1) * 2);
          if (!Array.isArray(levelState.monsterProjectiles)) {
            levelState.monsterProjectiles = [];
          }
          for (let sIdx = 0; sIdx < spreadOffsets.length; sIdx++) {
            const ang = baseAngle + spreadOffsets[sIdx];
            levelState.monsterProjectiles.push({
              id: `bproj_${Date.now()}_${sIdx}_${Math.random()}`,
              x: bcx + boss.dir * 24,
              y: bcy,
              vx: Math.cos(ang) * projSpeed,
              vy: Math.sin(ang) * projSpeed,
              radius: 9,
              damage: projDmg,
              kind: boss.projectileKind,
              color: boss.accentColor || '#FB923C',
              life: 2.6,
            });
          }
        }
      }
    }
  }

  // Vertical motion for hop
  if (boss.y < boss.baseY || boss.vy < 0) {
    boss.vy += 980 * dt;
    boss.y += boss.vy * dt;
    if (boss.y >= boss.baseY) {
      boss.y = boss.baseY;
      boss.vy = 0;
    }
  }

  const crownBox = {
    x: boss.x + 12,
    y: boss.y - 12,
    w: boss.w - 24,
    h: 22,
  };
  const bodyBox = {
    x: boss.x + 10,
    y: boss.y + 18,
    w: boss.w - 20,
    h: boss.h - 20,
  };

  for (let i = 0; i < actorList.length; i++) {
    const actor = actorList[i];
    if (!actor || actor.hurtTimer > 0 || actor.devouredByGhost) continue;

    const overlapsCrown =
      actor.x < crownBox.x + crownBox.w &&
      actor.x + actor.w > crownBox.x &&
      actor.y + actor.h >= crownBox.y &&
      actor.y + actor.h <= crownBox.y + crownBox.h + 14;

    if (overlapsCrown && boss.hurtFlashTimer <= 0 && (actor.vy >= -40 || actor.carriedBy)) {
      if (boss.shielded) {
        actor.vy = -420;
        actor.grounded = false;
        callbacks.onBossShieldDeflect?.(boss, actor);
      } else {
        const stompDmg = Math.max(35, Math.ceil(boss.maxHp / 3));
        boss.hp = Math.max(0, boss.hp - stompDmg);
        boss.hurtFlashTimer = 0.65;
        boss.stunTimer = 1.05;
        boss.shielded = false;
        actor.vy = -450;
        actor.grounded = false;
        actor.invulnTimer = Math.max(actor.invulnTimer, 0.75);
        callbacks.onBossHit?.(boss, actor, stompDmg);

        if (boss.hp <= 0) {
          finalizeBossDefeat(boss, levelState, callbacks);
          return boss;
        }
      }
      continue;
    }

    const overlapsBody =
      actor.x < bodyBox.x + bodyBox.w &&
      actor.x + actor.w > bodyBox.x &&
      actor.y < bodyBox.y + bodyBox.h &&
      actor.y + actor.h > bodyBox.y;

    if (overlapsBody && actor.invulnTimer <= 0 && boss.stunTimer <= 0) {
      applyActorDamage(
        levelState,
        actor,
        24,
        {
          sourceX: boss.x + boss.w * 0.5,
          knockbackY: -260,
          cause: boss.name,
        },
        callbacks
      );
      callbacks.onBossBumpPlayer?.(boss, actor);
    }
  }

  return boss;
}

export function serializeBossState(boss) {
  if (!boss) return { active: false };
  return {
    active: boss.active,
    defeated: boss.defeated,
    id: boss.id,
    x: Math.round(boss.x),
    y: Math.round(boss.y),
    dir: boss.dir,
    hp: boss.hp,
    maxHp: boss.maxHp,
    shielded: boss.shielded,
    stunTimer: Math.round(boss.stunTimer * 100) / 100,
    isOpenWorld: boss.isOpenWorld,
  };
}

export function applyBossSnapshot(boss, snap) {
  if (!snap || !boss) return;
  boss.active = Boolean(snap.active);
  boss.defeated = Boolean(snap.defeated);
  if (typeof snap.x === 'number') boss.x = snap.x;
  if (typeof snap.y === 'number') boss.y = snap.y;
  if (typeof snap.dir === 'number') boss.dir = snap.dir;
  if (typeof snap.hp === 'number') boss.hp = snap.hp;
  if (typeof snap.shielded === 'boolean') boss.shielded = snap.shielded;
  if (typeof snap.stunTimer === 'number') boss.stunTimer = snap.stunTimer;
}

export function renderBoss(ctx, boss, time) {
  renderGrotesqueBoss(ctx, boss, time);
}
