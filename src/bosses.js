/**
 * src/bosses.js
 * Cooperative Region Bosses & Open-World Guardian Encounter
 * for "Around the World with Nadine".
 *
 * - Spawns on Stage 5 climax levels (World Stages 5, 10, 15, 20, 25, 30, 35, 40, 45, 50)
 * - Summonable anytime in 2D Open-World Mode via the Boss Summon Altar / button
 * - Non-hue-only HUD + world weak-point & shield feedback
 * - Defeated via cooperative Crown Weak Point stomps (boosting/carrying partner or high ledges)
 */

export const BOSS_ARCHETYPES = {
  bramble_golem: {
    id: 'bramble_golem',
    name: 'Bramble Golem',
    subtitle: 'Guardian of the Outskirts',
    bodyColor: '#5B7C4B',
    trimColor: '#23301D',
    crownColor: '#FDE047',
    speed: 92,
  },
  harbor_kraken: {
    id: 'harbor_kraken',
    name: 'Harbor Kraken',
    subtitle: 'Tidekeeper of Lantern Harbor',
    bodyColor: '#D96B5E',
    trimColor: '#3A1A22',
    crownColor: '#FDE047',
    speed: 108,
  },
  sand_sphinx: {
    id: 'sand_sphinx',
    name: 'Starlight Sphinx',
    subtitle: 'Sentinel of the Golden Dunes',
    bodyColor: '#C99E57',
    trimColor: '#2E2110',
    crownColor: '#FDE047',
    speed: 118,
  },
  sky_colossus: {
    id: 'sky_colossus',
    name: 'Cloud Colossus',
    subtitle: 'Warden of the High Bridges',
    bodyColor: '#7B8FD1',
    trimColor: '#1E2542',
    crownColor: '#FDE047',
    speed: 126,
  },
  eclipse_warden: {
    id: 'eclipse_warden',
    name: 'Eclipse Warden',
    subtitle: 'Keeper of the Final Summit',
    bodyColor: '#8B5CF6',
    trimColor: '#1E1438',
    crownColor: '#FDE047',
    speed: 135,
  },
};

export function getBossArchetypeForWorld(worldId) {
  if (worldId <= 2) return BOSS_ARCHETYPES.bramble_golem;
  if (worldId <= 4) return BOSS_ARCHETYPES.harbor_kraken;
  if (worldId <= 6) return BOSS_ARCHETYPES.sand_sphinx;
  if (worldId <= 8) return BOSS_ARCHETYPES.sky_colossus;
  return BOSS_ARCHETYPES.eclipse_warden;
}

/**
 * Creates a boss state on Stage 5 of every World (indices 4, 9, 14, ..., 49), or returns null.
 */
export function createBossForLevel(level) {
  if (!level || level.stageInWorld !== 5) return null;
  const arch = getBossArchetypeForWorld(level.worldId || 1);
  const groundY = level.platforms?.[0]?.y || level.worldHeight - 108;
  const arenaMinX = Math.round(level.worldWidth * 0.42);
  const arenaMaxX = Math.round(level.worldWidth * 0.78);
  const startX = Math.round((arenaMinX + arenaMaxX) * 0.5);

  return createBossInstance(arch, {
    x: startX,
    y: groundY - 72,
    minX: arenaMinX,
    maxX: arenaMaxX,
    maxHp: 3,
    isOpenWorld: false,
  });
}

export function createOpenWorldBoss(groundY = 600, worldWidth = 2200) {
  return createBossInstance(BOSS_ARCHETYPES.eclipse_warden, {
    x: 1380,
    y: groundY - 72,
    minX: 980,
    maxX: Math.min(worldWidth - 140, 1780),
    maxHp: 3,
    isOpenWorld: true,
  });
}

function createBossInstance(arch, opts) {
  return {
    active: true,
    defeated: false,
    id: arch.id,
    name: arch.name,
    subtitle: arch.subtitle,
    bodyColor: arch.bodyColor,
    trimColor: arch.trimColor,
    crownColor: arch.crownColor,
    x: opts.x,
    y: opts.y,
    w: 76,
    h: 72,
    minX: opts.minX,
    maxX: opts.maxX,
    dir: -1,
    speed: arch.speed,
    hp: opts.maxHp,
    maxHp: opts.maxHp,
    shielded: false,
    shieldCycleTimer: 6.5,
    stunTimer: 0,
    hurtFlashTimer: 0,
    jumpSlamTimer: 4.5,
    vy: 0,
    baseY: opts.y,
    isOpenWorld: Boolean(opts.isOpenWorld),
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function getBossStatusLabel(boss) {
  if (!boss || !boss.active) return 'Defeated';
  if (boss.stunTimer > 0) return 'Staggered · Hit Crown!';
  if (boss.shielded) return 'Shielded · Team Up or Carry!';
  return 'Crown Open · Stomp!';
}

/**
 * Steps cooperative boss AI, crown weak-point stomps, shield mechanics & knockback.
 */
export function stepBoss(boss, levelState, mechState, dt, callbacks = {}) {
  if (!boss || !boss.active || boss.defeated || levelState.completed) return boss;

  if (boss.hurtFlashTimer > 0) boss.hurtFlashTimer = Math.max(0, boss.hurtFlashTimer - dt);

  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;
  const actorList = [madjid, nadine].filter(Boolean);

  // Team proximity or carrying shatters active Teamwork Shield immediately!
  const pairDist =
    madjid && nadine
      ? Math.hypot(madjid.x - nadine.x, madjid.y - nadine.y)
      : 999;
  if (boss.shielded && (pairDist <= 125 || Boolean(mechState?.carrying))) {
    boss.shielded = false;
    boss.stunTimer = Math.max(boss.stunTimer, 1.1);
    callbacks.onBossShieldBreak?.(boss);
  }

  // Toggle periodic shield every ~8s when hp <= 2 so cooperation shines
  if (boss.hp <= 2 && boss.stunTimer <= 0) {
    boss.shieldCycleTimer -= dt;
    if (boss.shieldCycleTimer <= 0) {
      boss.shielded = !boss.shielded;
      boss.shieldCycleTimer = boss.shielded ? 4.8 : 7.5;
    }
  }

  if (boss.stunTimer > 0) {
    boss.stunTimer = Math.max(0, boss.stunTimer - dt);
  } else {
    // Patrol arena smoothly
    boss.x += boss.dir * boss.speed * dt;
    if (boss.x <= boss.minX) {
      boss.x = boss.minX;
      boss.dir = 1;
    } else if (boss.x >= boss.maxX) {
      boss.x = boss.maxX;
      boss.dir = -1;
    }

    // Light telegraphed hop
    boss.jumpSlamTimer -= dt;
    if (boss.jumpSlamTimer <= 0 && boss.y >= boss.baseY - 1) {
      boss.jumpSlamTimer = 4.2;
      boss.vy = -310;
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

  // Crown weak-point box at top of boss vs body hazard box
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

    // 1. Check Crown Weak Point Stomp (requires downward fall OR being carried high!)
    const overlapsCrown =
      actor.x < crownBox.x + crownBox.w &&
      actor.x + actor.w > crownBox.x &&
      actor.y + actor.h >= crownBox.y &&
      actor.y + actor.h <= crownBox.y + crownBox.h + 14;

    if (overlapsCrown && boss.hurtFlashTimer <= 0 && (actor.vy >= -40 || actor.carriedBy)) {
      if (boss.shielded) {
        // Gentle bounce back when shielded unless teammates are together
        actor.vy = -420;
        actor.grounded = false;
        callbacks.onBossShieldDeflect?.(boss, actor);
      } else {
        boss.hp = Math.max(0, boss.hp - 1);
        boss.hurtFlashTimer = 0.75;
        boss.stunTimer = 1.1;
        boss.shielded = false;
        actor.vy = -450;
        actor.grounded = false;
        actor.invulnTimer = Math.max(actor.invulnTimer, 0.75);
        callbacks.onBossHit?.(boss, actor);

        if (boss.hp <= 0) {
          boss.defeated = true;
          boss.active = false;
          // Auto-unlock exit if locked in Story Stage 5
          if (!boss.isOpenWorld && !levelState.portalUnlocked && levelState.keysRequired > levelState.keysCollected) {
            levelState.keysCollected = levelState.keysRequired;
            levelState.portalUnlocked = true;
            callbacks.onPortalUnlock?.(levelState.exit);
          }
          callbacks.onBossDefeat?.(boss);
          return boss;
        }
      }
      continue;
    }

    // 2. Check Side Collision Pushback (gentle knockback instead of softlock)
    const overlapsBody =
      actor.x < bodyBox.x + bodyBox.w &&
      actor.x + actor.w > bodyBox.x &&
      actor.y < bodyBox.y + bodyBox.h &&
      actor.y + actor.h > bodyBox.y;

    if (overlapsBody && actor.invulnTimer <= 0 && boss.stunTimer <= 0) {
      const pushDir = actor.x + actor.w * 0.5 < boss.x + boss.w * 0.5 ? -1 : 1;
      actor.vx = pushDir * 280;
      actor.vy = -260;
      actor.grounded = false;
      actor.invulnTimer = 0.85;
      actor.scaleX = 1.18;
      actor.scaleY = 0.84;
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
  if (!boss || !boss.active || boss.defeated) return;

  const cx = boss.x + boss.w * 0.5;
  const bottomY = boss.y + boss.h;
  const flash = boss.hurtFlashTimer > 0 && Math.floor(time * 20) % 2 === 0;
  const bob = boss.stunTimer > 0 ? Math.sin(time * 32) * 2.5 : Math.sin(time * 4.5) * 2;

  ctx.save();
  ctx.translate(cx, bottomY);

  // Ground shadow
  ctx.fillStyle = 'rgba(14, 16, 30, 0.36)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 38, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, -boss.h * 0.5 + bob);

  // Teamwork Shield Dome
  if (boss.shielded) {
    ctx.strokeStyle = 'rgba(124, 196, 250, 0.85)';
    ctx.fillStyle = 'rgba(124, 196, 250, 0.16)';
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Boss Body
  ctx.fillStyle = flash ? '#FFF8D6' : boss.bodyColor;
  ctx.strokeStyle = boss.trimColor;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-34, -30, 68, 62, [24, 24, 14, 14]);
  ctx.fill();
  ctx.stroke();

  // Heavy Brow & Glowing Eyes
  const faceDir = boss.dir || -1;
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = boss.trimColor;
  ctx.lineWidth = 2;
  [-11, 11].forEach((ex) => {
    ctx.beginPath();
    ctx.arc(ex + faceDir * 4, -6, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#181024';
    ctx.beginPath();
    ctx.arc(ex + faceDir * 5.8, -6, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
  });

  // Glowing Golden Crown Weak-Point Target above head
  const crownPulse = boss.shielded ? 0.5 : 1 + Math.sin(time * 6) * 0.1;
  ctx.save();
  ctx.translate(0, -37);
  ctx.scale(crownPulse, crownPulse);
  ctx.fillStyle = boss.shielded ? '#94A3B8' : boss.crownColor;
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

  // Crisp Non-Hue-Only World Label & HP Pips above boss
  ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(18, 18, 32, 0.92)';
  const tag = `${boss.name} (${boss.hp}/${boss.maxHp})`;
  ctx.strokeText(tag, 0, -56);
  ctx.fillStyle = '#FFF4D2';
  ctx.fillText(tag, 0, -56);

  ctx.restore();
}
