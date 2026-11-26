/**
 * src/foliage.js
 * Physics-reactive biome foliage (sways in breeze/current and bends softly
 * as players/monsters brush past or get sliced by tools) + tall, unjumpable
 * multi-stage tool-gated barriers across the 5 Worlds.
 */

export const FOLIAGE_BIOME_PALETTES = {
  jungle: {
    bladeA: '#3D9956',
    bladeB: '#65C474',
    tip: '#A6F09E',
    outline: '#163824',
  },
  ice: {
    bladeA: '#68B4E3',
    bladeB: '#AEE4FA',
    tip: '#EFFBFF',
    outline: '#1D4466',
  },
  volcano: {
    bladeA: '#5A3A3A',
    bladeB: '#9E462C',
    tip: '#FF8E42',
    outline: '#241214',
  },
  space: {
    bladeA: '#496C8E',
    bladeB: '#69B5C9',
    tip: '#8CF7E6',
    outline: '#16283D',
  },
  ocean: {
    bladeA: '#1D8A7A',
    bladeB: '#3FC4A8',
    tip: '#9BF9DF',
    outline: '#0C3836',
  },
};

export const BARRIER_MATERIAL_META = {
  vine: {
    name: 'Thick Jungle Vines',
    requiredTool: 'light_sword',
    requiredLabel: 'Light Sword',
    colorA: '#2D6B3E',
    colorB: '#4D9E5C',
    outline: '#122918',
    hintIcon: 'sword',
  },
  frost: {
    name: 'Glacial Ice Wall',
    requiredTool: 'crystal_hammer',
    requiredLabel: 'Crystal Hammer',
    colorA: '#5BA9DB',
    colorB: '#BBEBFF',
    outline: '#1E466E',
    hintIcon: 'hammer',
  },
  obsidian: {
    name: 'Obsidian Crust Wall',
    requiredTool: 'crystal_hammer',
    requiredLabel: 'Crystal Hammer',
    colorA: '#35263B',
    colorB: '#FF6B3D',
    outline: '#140C18',
    hintIcon: 'hammer',
  },
  energy: {
    name: 'Airlock Energy Bulkhead',
    requiredTool: 'energy_wand',
    requiredLabel: 'Energy Wand / Key',
    altTool: 'mechanism_key',
    colorA: '#274572',
    colorB: '#60E8FF',
    outline: '#0E1F3B',
    hintIcon: 'wand',
  },
  coral: {
    name: 'Sunken Coral Reef Wall',
    requiredTool: 'light_sword',
    requiredLabel: 'Light Sword / Wand',
    altTool: 'energy_wand',
    colorA: '#8E3E68',
    colorB: '#FF85A1',
    outline: '#361326',
    hintIcon: 'sword',
  },
};

/**
 * Instantiates mutable foliage patches from a level definition.
 * @param {any[]} defs
 * @param {string} biome
 */
export function createFoliagePatches(defs = [], biome = 'jungle') {
  return defs.map((def, idx) => {
    const blades = [];
    const count = def.count || 6;
    for (let i = 0; i < count; i++) {
      blades.push({
        offsetX: (i / Math.max(1, count - 1) - 0.5) * (def.w || 54),
        height: (def.h || 28) * (0.72 + ((i * 37 + idx * 13) % 10) * 0.045),
        width: 5 + (i % 3) * 1.8,
        phase: (i * 0.9 + idx * 0.6) % (Math.PI * 2),
      });
    }
    return {
      id: def.id || `fol_${idx}`,
      x: def.x,
      y: def.y,
      w: def.w || 56,
      h: def.h || 30,
      biome: def.biome || biome,
      bendAngle: 0,
      bendVel: 0,
      cutTimer: 0,
      blades,
    };
  });
}

/**
 * Applies a localized foliage bend impulse from a dash, projectile, or shockwave.
 * @param {any[]} patches
 * @param {number} x
 * @param {number} y
 * @param {number} vx
 * @param {number} [radius]
 * @param {number} [strength]
 */
export function perturbFoliageAt(patches = [], x = 0, y = 0, vx = 0, radius = 48, strength = 1) {
  if (!Array.isArray(patches) || patches.length === 0) return;
  const dir = vx !== 0 ? Math.sign(vx) : 1;
  for (let i = 0; i < patches.length; i++) {
    const f = patches[i];
    if (Math.abs(x - f.x) <= f.w * 0.55 + radius && Math.abs(y - (f.y - f.h * 0.5)) <= f.h + radius) {
      f.bendVel += dir * 8.5 * strength;
    }
  }
}

/**
 * Updates foliage spring-damper physics when players, monsters, dashes, or projectiles brush through.
 * @param {any[]} patches
 * @param {any[]} movers
 * @param {number} dt
 * @param {string} physicsMode
 * @param {Array<{ x: number, y: number, vx?: number, vy?: number }>} [projectiles]
 */
export function stepFoliageSystem(
  patches = [],
  movers = [],
  dt = 1 / 60,
  physicsMode = 'normal',
  projectiles = []
) {
  if (!Array.isArray(patches) || patches.length === 0) return;

  const isUnderwater = physicsMode === 'underwater';
  const stiffness = isUnderwater ? 28 : 54;
  const damping = isUnderwater ? 4.8 : 6.4;

  for (let i = 0; i < patches.length; i++) {
    const f = patches[i];
    if (f.cutTimer > 0) {
      f.cutTimer = Math.max(0, f.cutTimer - dt);
    }

    // Check overlapping actors/monsters/dashes to push bend angle
    for (let m = 0; m < movers.length; m++) {
      const mover = movers[m];
      if (!mover || mover.hp <= 0 || mover.devouredByGhost) continue;
      const mx = mover.x + mover.w * 0.5;
      const my = mover.y + mover.h;
      const dashBoost = mover.phaseDash?.active ? 1.85 : 1;
      const dashReach = mover.phaseDash?.active ? 32 : 14;
      if (Math.abs(mx - f.x) <= f.w * 0.6 + dashReach && Math.abs(my - f.y) <= f.h + 18) {
        const vx = mover.phaseDash?.active ? (mover.facing || 1) * 340 : mover.vx || 0;
        if (Math.abs(vx) > 12) {
          const push = Math.max(-1.0, Math.min(1.0, (vx / 210) * dashBoost));
          f.bendVel += (push - f.bendAngle) * 16 * dashBoost * dt;
        } else {
          const away = mx < f.x ? 0.35 : -0.35;
          f.bendVel += away * 8 * dt;
        }
      }
    }

    // Fast-moving projectiles flutter blades cleanly as they zip past
    if (Array.isArray(projectiles) && projectiles.length > 0) {
      for (let p = 0; p < projectiles.length; p++) {
        const proj = projectiles[p];
        if (!proj) continue;
        if (
          Math.abs(proj.x - f.x) <= f.w * 0.6 + 22 &&
          Math.abs(proj.y - (f.y - f.h * 0.45)) <= f.h + 20
        ) {
          const pushDir = proj.vx ? Math.sign(proj.vx) : 1;
          f.bendVel += pushDir * 14 * dt;
        }
      }
    }

    // Spring-damper return to rest
    const accel = -stiffness * f.bendAngle - damping * f.bendVel;
    f.bendVel += accel * dt;
    f.bendAngle += f.bendVel * dt;
    f.bendAngle = Math.max(-1.05, Math.min(1.05, f.bendAngle));
  }
}

/**
 * Checks whether an actor's equipped tool can damage a multi-stage barrier.
 * Accepts canonical IDs and backward-compatible legacy aliases.
 * @param {any} barrier
 * @param {string | null} weaponId
 */
export function canToolDamageBarrier(barrier, weaponId) {
  if (!barrier || !weaponId) return false;
  if (!barrier.requiredTool) return true; // Legacy generic fragile barrier

  const canonical = normalizeToolId(weaponId);
  const req = normalizeToolId(barrier.requiredTool);
  const alt = barrier.altTool ? normalizeToolId(barrier.altTool) : null;
  return canonical === req || (alt !== null && canonical === alt);
}

/**
 * Maps legacy weapon IDs and new tool IDs cleanly.
 * @param {string | null} id
 */
export function normalizeToolId(id) {
  if (id === 'crystal_sword') return 'light_sword';
  if (id === 'plasma_hammer') return 'crystal_hammer';
  if (id === 'star_wand') return 'energy_wand';
  return id;
}

/**
 * Renders physics-reactive foliage patches.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} patches
 * @param {number} time
 * @param {{ minX: number; maxX: number } | null} viewRange
 */
export function renderFoliagePatches(ctx, patches = [], time = 0, viewRange = null) {
  if (!Array.isArray(patches) || patches.length === 0) return;

  for (let i = 0; i < patches.length; i++) {
    const f = patches[i];
    if (viewRange && (f.x + f.w < viewRange.minX - 60 || f.x - f.w > viewRange.maxX + 60)) {
      continue;
    }

    const pal = FOLIAGE_BIOME_PALETTES[f.biome] || FOLIAGE_BIOME_PALETTES.jungle;
    const heightScale = f.cutTimer > 0 ? 0.45 + 0.55 * (1 - f.cutTimer / 4) : 1;

    for (let b = 0; b < f.blades.length; b++) {
      const blade = f.blades[b];
      const bx = f.x + blade.offsetX;
      const by = f.y;
      const bh = blade.height * heightScale;
      const wind =
        f.biome === 'ocean'
          ? Math.sin(time * 2.6 + blade.phase + bx * 0.02) * 7
          : Math.sin(time * 1.9 + blade.phase + bx * 0.03) * 3.5;
      const tipX = bx + f.bendAngle * bh * 0.85 + wind;
      const tipY = by - bh;

      ctx.fillStyle = b % 2 === 0 ? pal.bladeA : pal.bladeB;
      ctx.strokeStyle = pal.outline;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(bx - blade.width * 0.5, by);
      ctx.quadraticCurveTo(bx + f.bendAngle * bh * 0.35 - blade.width * 0.2, by - bh * 0.55, tipX, tipY);
      ctx.quadraticCurveTo(bx + f.bendAngle * bh * 0.35 + blade.width * 0.4, by - bh * 0.5, bx + blade.width * 0.5, by);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Subtle glowing/pale tip on every 2nd blade
      if (b % 2 === 1 && heightScale > 0.6) {
        ctx.fillStyle = pal.tip;
        ctx.beginPath();
        ctx.arc(tipX, tipY + 1, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/**
 * Renders tall multi-stage tool-gated barriers with crack progression and tool icons.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} barrier
 * @param {number} time
 */
export function renderToolBarrier(ctx, barrier, time = 0) {
  if (!barrier || barrier.broken) return;
  const mat = BARRIER_MATERIAL_META[barrier.material] || {
    name: 'Fragile Crystal',
    requiredTool: null,
    requiredLabel: 'Any Weapon',
    colorA: '#64B5F6',
    colorB: '#BAE6FD',
    outline: '#1E3A5F',
    hintIcon: 'sword',
  };

  const maxHp = barrier.maxHp || 1;
  const hp = barrier.hp ?? maxHp;
  const damageRatio = 1 - Math.max(0, Math.min(1, hp / maxHp));
  const shakeX = barrier.flashTimer > 0 ? Math.sin(time * 60) * 3 : 0;

  ctx.save();
  ctx.translate(barrier.x + shakeX, barrier.y);

  // Main tall body
  ctx.fillStyle = barrier.flashTimer > 0 ? '#FFFFFF' : mat.colorA;
  ctx.strokeStyle = mat.outline;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.roundRect(0, 0, barrier.w, barrier.h, 8);
  ctx.fill();
  ctx.stroke();

  // Inner biome veins / layers
  ctx.fillStyle = mat.colorB;
  ctx.globalAlpha = 0.55;
  if (barrier.material === 'vine') {
    for (let y = 12; y < barrier.h - 10; y += 22) {
      ctx.beginPath();
      ctx.moveTo(2, y);
      ctx.quadraticCurveTo(barrier.w * 0.5, y + 8, barrier.w - 2, y - 4);
      ctx.lineWidth = 4;
      ctx.strokeStyle = mat.colorB;
      ctx.stroke();
    }
  } else if (barrier.material === 'energy') {
    const pulse = 0.35 + Math.sin(time * 5) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.fillRect(6, 6, barrier.w - 12, barrier.h - 12);
  } else {
    ctx.fillRect(4, 6, barrier.w * 0.32, barrier.h - 12);
  }
  ctx.globalAlpha = 1;

  // Multi-stage crack lines as barrier weakens
  if (damageRatio > 0.05) {
    ctx.strokeStyle = '#FFF7D6';
    ctx.lineWidth = 2.2;
    const crackCount = Math.ceil(damageRatio * 4);
    for (let c = 0; c < crackCount; c++) {
      const cy = barrier.h * (0.2 + c * 0.2);
      ctx.beginPath();
      ctx.moveTo(4, cy);
      ctx.lineTo(barrier.w * 0.45, cy + 7);
      ctx.lineTo(barrier.w - 4, cy - 5);
      ctx.stroke();
    }
  }

  // In-world floating tool hint badge (shows required tool icon & stage HP)
  const showHint = barrier.wrongToolTimer > 0 || barrier.h >= 90;
  if (showHint) {
    const hintY = -22 + Math.sin(time * 3.5) * 2.5;
    ctx.fillStyle = barrier.wrongToolTimer > 0 ? 'rgba(220, 38, 38, 0.9)' : 'rgba(15, 23, 42, 0.8)';
    ctx.strokeStyle = barrier.wrongToolTimer > 0 ? '#FCA5A5' : '#93C5FD';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(barrier.w * 0.5 - 32, hintY - 11, 64, 20, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    const shortTag =
      barrier.requiredTool === 'crystal_hammer'
        ? 'Hammer'
        : barrier.requiredTool === 'energy_wand'
          ? 'Wand'
          : barrier.requiredTool === 'mechanism_key'
            ? 'Key'
            : 'Sword';
    ctx.fillText(`${shortTag} ${hp}/${maxHp}`, barrier.w * 0.5, hintY - 1);
  }

  ctx.restore();
}
