/**
 * src/terrain-renderer.js
 * Modular, viewport-culled, pattern-cached Canvas2D renderer for terrain,
 * platforms, pillars, archways, moving platforms, barriers/gates, switches/levers,
 * and hazards across all 10 Story Worlds and 2D Open-World Mode.
 *
 * Hitbox Guarantee: All walkable caps, walls, barriers, and hazard bases align
 * strictly with their exact physics bounding boxes (x, y, w, h).
 */

const patternCache = new Map();

/**
 * Deterministic fast hash for zero-allocation decorative surface details.
 */
function hash2d(a, b) {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Resolves the surface biome archetype for any Story World (1..10) or Open-World (0).
 */
export function getBiomeSurfaceType(worldId, theme = 'sunrise') {
  switch (Number(worldId)) {
    case 1:
    case 2:
      return 'meadow_turf';
    case 3:
      return 'harbor_timber';
    case 4:
      return 'canyon_sandstone';
    case 5:
      return 'desert_dune';
    case 6:
      return 'alpine_moss';
    case 7:
      return 'cloud_pagoda';
    case 8:
      return 'crystal_geode';
    case 9:
      return 'moonlit_garden';
    case 10:
      return 'summit_marble';
    default:
      if (theme === 'night') return 'moonlit_garden';
      if (theme === 'sunset') return 'canyon_sandstone';
      return 'meadow_turf';
  }
}

/**
 * Builds and caches a lightweight seamless 96x96 CanvasPattern per biome & body tint
 * so rich stone/wood/sand/crystal/marble depth fills in a single draw call.
 */
function getSurfacePattern(ctx, biome, bodyColor, trimColor, rimColor) {
  if (typeof document === 'undefined' || !ctx || typeof ctx.createPattern !== 'function') {
    return null;
  }
  const key = `${biome}|${bodyColor}|${trimColor}`;
  if (patternCache.has(key)) {
    return patternCache.get(key);
  }

  const size = 96;
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = tile.getContext('2d');
  if (!tctx) return null;

  tctx.fillStyle = bodyColor;
  tctx.fillRect(0, 0, size, size);

  if (biome === 'harbor_timber' || biome === 'cloud_pagoda') {
    // Stacked horizontal timber planks with staggered joints and soft wood grain
    const plankH = 24;
    for (let row = 0; row < 4; row++) {
      const py = row * plankH;
      tctx.fillStyle = row % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
      tctx.fillRect(0, py, size, plankH);

      tctx.strokeStyle = 'rgba(0,0,0,0.22)';
      tctx.lineWidth = 1.2;
      tctx.beginPath();
      tctx.moveTo(0, py + plankH - 0.5);
      tctx.lineTo(size, py + plankH - 0.5);
      tctx.stroke();

      const jointX = row % 2 === 0 ? 32 : 68;
      tctx.beginPath();
      tctx.moveTo(jointX, py);
      tctx.lineTo(jointX, py + plankH);
      tctx.stroke();

      tctx.strokeStyle = 'rgba(255,255,255,0.05)';
      tctx.beginPath();
      tctx.moveTo(6, py + 9);
      tctx.lineTo(jointX - 6, py + 9);
      tctx.moveTo(jointX + 8, py + 15);
      tctx.lineTo(size - 6, py + 15);
      tctx.stroke();
    }
  } else if (biome === 'canyon_sandstone' || biome === 'desert_dune') {
    // Sedimentary strata bands + fine wind-blown sandstone speckles
    const bands = [
      { y: 0, h: 20, a: 'rgba(255, 224, 178, 0.05)' },
      { y: 20, h: 14, a: 'rgba(0, 0, 0, 0.08)' },
      { y: 46, h: 18, a: 'rgba(255, 210, 160, 0.04)' },
      { y: 74, h: 16, a: 'rgba(0, 0, 0, 0.1)' },
    ];
    for (let i = 0; i < bands.length; i++) {
      tctx.fillStyle = bands[i].a;
      tctx.fillRect(0, bands[i].y, size, bands[i].h);
    }
    tctx.strokeStyle = 'rgba(0,0,0,0.16)';
    tctx.lineWidth = 1.1;
    tctx.beginPath();
    tctx.moveTo(0, 34);
    tctx.lineTo(size, 34);
    tctx.moveTo(0, 74);
    tctx.lineTo(size, 74);
    tctx.moveTo(42, 0);
    tctx.lineTo(42, 34);
    tctx.moveTo(76, 34);
    tctx.lineTo(76, 74);
    tctx.stroke();

    tctx.fillStyle = 'rgba(255, 240, 210, 0.08)';
    for (let s = 0; s < 14; s++) {
      const sx = Math.floor(hash2d(s, 3) * size);
      const sy = Math.floor(hash2d(s, 9) * size);
      tctx.fillRect(sx, sy, 2, 2);
    }
  } else if (biome === 'crystal_geode') {
    // Faceted dark mineral veins with subtle glowing crystal dust
    tctx.strokeStyle = 'rgba(124, 196, 203, 0.11)';
    tctx.lineWidth = 1.3;
    tctx.beginPath();
    tctx.moveTo(0, 26);
    tctx.lineTo(28, 12);
    tctx.lineTo(58, 34);
    tctx.lineTo(96, 20);
    tctx.moveTo(14, 72);
    tctx.lineTo(48, 52);
    tctx.lineTo(82, 78);
    tctx.stroke();

    tctx.fillStyle = 'rgba(124, 196, 203, 0.09)';
    tctx.beginPath();
    tctx.moveTo(28, 12);
    tctx.lineTo(44, 24);
    tctx.lineTo(24, 34);
    tctx.closePath();
    tctx.fill();

    tctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    for (let s = 0; s < 10; s++) {
      const sx = Math.floor(hash2d(s, 17) * size);
      const sy = Math.floor(hash2d(s, 23) * size);
      tctx.fillRect(sx, sy, 2, 2);
    }
  } else if (biome === 'summit_marble' || biome === 'moonlit_garden') {
    // Clean cut marble / temple ashlar blocks with hairline sunlit highlight edges
    const rows = 3;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const ry = r * rh;
      tctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      tctx.lineWidth = 1.1;
      tctx.beginPath();
      tctx.moveTo(0, ry + 1.5);
      tctx.lineTo(size, ry + 1.5);
      tctx.stroke();

      tctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
      tctx.beginPath();
      tctx.moveTo(0, ry + rh - 0.5);
      tctx.lineTo(size, ry + rh - 0.5);
      const jx = r === 0 ? 28 : r === 1 ? 64 : 16;
      tctx.moveTo(jx, ry);
      tctx.lineTo(jx, ry + rh);
      tctx.moveTo((jx + 48) % size, ry);
      tctx.lineTo((jx + 48) % size, ry + rh);
      tctx.stroke();
    }
    tctx.fillStyle = 'rgba(255, 244, 214, 0.05)';
    tctx.fillRect(10, 8, 12, 4);
    tctx.fillRect(54, 42, 16, 4);
  } else {
    // Meadow turf / Alpine moss masonry: organic rounded cobblestone ashlar blocks
    const stones = [
      [2, 2, 44, 28],
      [50, 2, 44, 28],
      [0, 34, 28, 28],
      [32, 34, 42, 28],
      [78, 34, 18, 28],
      [14, 66, 42, 28],
      [60, 66, 34, 28],
    ];
    for (let i = 0; i < stones.length; i++) {
      const [sx, sy, sw, sh] = stones[i];
      tctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.07)';
      tctx.beginPath();
      tctx.roundRect(sx, sy, sw, sh, 5);
      tctx.fill();

      tctx.strokeStyle = 'rgba(255,255,255,0.055)';
      tctx.lineWidth = 1;
      tctx.beginPath();
      tctx.moveTo(sx + 4, sy + 2);
      tctx.lineTo(sx + sw - 4, sy + 2);
      tctx.stroke();
    }
  }

  // Keep pattern cache bounded
  if (patternCache.size > 32) {
    patternCache.clear();
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern) {
    patternCache.set(key, pattern);
  }
  return pattern;
}

function isRectVisible(x, w, viewRange) {
  if (!viewRange) return true;
  return x + w >= viewRange.minX && x <= viewRange.maxX;
}

/**
 * Draws lush biome-matched top cap along the exact walkable surface line p.y.
 */
function drawPlatformTopCap(ctx, p, style, biome) {
  const capH = p.kind === 'ground' ? 12 : Math.min(11, Math.max(7, p.h * 0.48));
  const x = p.x + 1;
  const y = p.y + 1;
  const w = Math.max(0, p.w - 2);
  if (w <= 2) return;

  // Under-cap shadow lip for clean surface separation
  ctx.fillStyle = 'rgba(12, 10, 26, 0.34)';
  ctx.fillRect(x + 1, y + capH - 1, w - 2, 4);

  // Primary surface cap body
  ctx.fillStyle = style.top;
  ctx.beginPath();
  ctx.roundRect(x, y, w, capH, [7, 7, 3, 3]);
  ctx.fill();

  if (biome === 'meadow_turf' || biome === 'alpine_moss' || biome === 'moonlit_garden') {
    // Organic scalloped moss overhangs along the cap bottom edge (stays cleanly within p.w)
    ctx.fillStyle = style.top;
    const scallopStep = 18;
    for (let sx = x + 6; sx < x + w - 10; sx += scallopStep) {
      const drop = 2 + Math.floor(hash2d(sx, y) * 3.5);
      ctx.beginPath();
      ctx.arc(sx + 5, y + capH - 1, 4.2 + drop * 0.35, 0, Math.PI);
      ctx.fill();
    }

    // Subtle crisp sunlit top rim
    ctx.fillStyle = style.topRim;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 1, Math.max(0, w - 6), 3.2, 2);
    ctx.fill();
  } else if (biome === 'harbor_timber' || biome === 'cloud_pagoda') {
    // Segmented wooden boardwalk planks / pagoda cornice with brass studs
    ctx.fillStyle = style.topRim;
    ctx.fillRect(x + 2, y + 1, Math.max(0, w - 4), 2.8);

    ctx.strokeStyle = 'rgba(28, 18, 36, 0.35)';
    ctx.lineWidth = 1.4;
    const plankW = 26;
    for (let bx = x + plankW; bx < x + w - 8; bx += plankW) {
      ctx.beginPath();
      ctx.moveTo(bx, y + 1);
      ctx.lineTo(bx, y + capH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 236, 178, 0.55)';
      ctx.beginPath();
      ctx.arc(bx - 5, y + capH * 0.55, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (biome === 'crystal_geode' || biome === 'summit_marble') {
    // Sleek faceted crystal/marble bevel + diagonal specular catch
    ctx.fillStyle = style.topRim;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 1, Math.max(0, w - 4), 3.4, 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    const facetStep = 48;
    for (let fx = x + 12; fx < x + w - 20; fx += facetStep) {
      ctx.beginPath();
      ctx.moveTo(fx, y + 1);
      ctx.lineTo(fx + 10, y + 1);
      ctx.lineTo(fx + 4, y + capH - 1);
      ctx.lineTo(fx - 4, y + capH - 1);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Canyon sandstone / Desert dune sculpted coping
    ctx.fillStyle = style.topRim;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 1, Math.max(0, w - 6), 3.2, 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(30, 18, 36, 0.28)';
    ctx.lineWidth = 1.2;
    for (let sx = x + 32; sx < x + w - 12; sx += 36) {
      ctx.beginPath();
      ctx.moveTo(sx, y + 3);
      ctx.lineTo(sx, y + capH);
      ctx.stroke();
    }
  }
}

function drawSurfaceTufts(ctx, p, style, biome) {
  if (biome !== 'meadow_turf' && biome !== 'alpine_moss' && biome !== 'moonlit_garden') return;
  const x = p.x + 1;
  const w = Math.max(0, p.w - 2);
  if (w <= 28) return;

  ctx.strokeStyle = style.topRim;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  const tuftStep = p.kind === 'ground' ? 38 : 30;
  for (let tx = x + 14; tx < x + w - 14; tx += tuftStep) {
    if (hash2d(tx, p.y) > 0.35) {
      ctx.beginPath();
      ctx.moveTo(tx, p.y + 1);
      ctx.lineTo(tx - 2, p.y - 2.6);
      ctx.moveTo(tx + 2.5, p.y + 1);
      ctx.lineTo(tx + 4, p.y - 2.2);
      ctx.stroke();
    }
  }
}

/**
 * Renders any static terrain platform, ground floor, carved stone pillar/wall, or gatehouse archway.
 * @param {any} ctx
 * @param {any} p
 * @param {any} style
 * @param {number} worldId
 * @param {string} theme
 * @param {number} time
 * @param {{ minX: number, maxX: number } | null} [viewRange=null]
 */
export function drawTerrainPlatform(ctx, p, style, worldId, theme, time, viewRange = null) {
  if (!isRectVisible(p.x - 8, p.w + 16, viewRange)) return;

  const biome = getBiomeSurfaceType(worldId, theme);
  ctx.save();

  if (p.kind === 'archway') {
    const cx = p.x + p.w * 0.5;
    const bodyTop = p.y + 16;

    // Carved stone/wood gatehouse body
    ctx.fillStyle = style.body;
    ctx.strokeStyle = style.trim;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(p.x + 4, bodyTop, p.w - 8, p.h - 16, [4, 4, 6, 6]);
    ctx.fill();

    const pat = getSurfacePattern(ctx, biome, style.body, style.trim, style.topRim);
    if (pat) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pat;
      ctx.fillRect(p.x + 4, bodyTop, p.w - 8, p.h - 16);
      ctx.restore();
    }
    ctx.stroke();

    // Glowing rose compass window
    ctx.fillStyle = 'rgba(255, 240, 196, 0.2)';
    ctx.strokeStyle = style.topRim;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(cx, bodyTop + (p.h - 16) * 0.48, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 248, 224, 0.45)';
    ctx.beginPath();
    ctx.arc(cx, bodyTop + (p.h - 16) * 0.48, 4, 0, Math.PI * 2);
    ctx.fill();

    // Shingled peaked roof
    ctx.fillStyle = style.top;
    ctx.strokeStyle = style.trim;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x - 6, bodyTop + 3);
    ctx.lineTo(cx, p.y - 2);
    ctx.lineTo(p.x + p.w + 6, bodyTop + 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = style.topRim;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p.x - 2, bodyTop + 1);
    ctx.lineTo(cx, p.y + 1);
    ctx.lineTo(p.x + p.w + 2, bodyTop + 1);
    ctx.stroke();

    // Heavy stone base plinth
    ctx.fillStyle = '#5D5073';
    ctx.strokeStyle = style.trim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y + p.h - 10, p.w, 10, 3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  const isWallOrPillar =
    p.kind === 'pillar' || (p.kind !== 'ground' && p.h >= 56 && p.h > p.w * 1.15);

  if (isWallOrPillar) {
    // Architectural column / wall segment with carved capital & plinth matching (p.x, p.y, p.w, p.h)
    ctx.fillStyle = style.body;
    ctx.strokeStyle = style.trim;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.roundRect(p.x, p.y, p.w, p.h, 6);
    ctx.fill();

    const pat = getSurfacePattern(ctx, biome, style.body, style.trim, style.topRim);
    if (pat) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = pat;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.restore();
    }
    ctx.stroke();

    // Subtle recessed vertical fluted panel
    if (p.w >= 26 && p.h >= 40) {
      ctx.fillStyle = 'rgba(12, 10, 24, 0.22)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(p.x + 6, p.y + 12, p.w - 12, p.h - 24, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Capital crown & base plinth bands
    ctx.fillStyle = style.top;
    ctx.beginPath();
    ctx.roundRect(p.x + 1, p.y + 1, p.w - 2, 8, [5, 5, 2, 2]);
    ctx.fill();
    ctx.fillStyle = style.topRim;
    ctx.fillRect(p.x + 4, p.y + 2, Math.max(0, p.w - 8), 2.5);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.fillRect(p.x + 2, p.y + p.h - 8, Math.max(0, p.w - 4), 6);
    ctx.restore();
    return;
  }

  // Standard Ground Floor & Floating Ledges
  const radius = p.kind === 'ground' ? [10, 10, 0, 0] : 8;
  ctx.fillStyle = style.body;
  ctx.strokeStyle = style.trim;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, p.w, p.h, radius);
  ctx.fill();

  // Clip cached biome texture + subtle vertical shading inside exact bounds
  ctx.save();
  ctx.clip();
  const pat = getSurfacePattern(ctx, biome, style.body, style.trim, style.topRim);
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
  // Subtle lower depth shadow for tactile dimensionality
  ctx.fillStyle = 'rgba(10, 8, 22, 0.22)';
  ctx.fillRect(p.x, p.y + Math.max(12, p.h * 0.55), p.w, p.h);

  // Crisp under-ledge dark bevel on floating platforms
  if (p.kind !== 'ground') {
    ctx.fillStyle = 'rgba(10, 8, 22, 0.34)';
    ctx.fillRect(p.x, p.y + p.h - 4, p.w, 4);
  }

  drawPlatformTopCap(ctx, p, style, biome);
  ctx.restore();

  // Re-stroke crisp outer border after clipped fills so edge contrast pops cleanly
  ctx.strokeStyle = style.trim;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(p.x, p.y, p.w, p.h, radius);
  ctx.stroke();

  drawSurfaceTufts(ctx, p, style, biome);

  ctx.restore();
}

/**
 * Renders animated puzzle tether lines connecting switches to gates or moving platforms.
 */
export function drawLinkCable(ctx, sw, tx, ty, active, time) {
  const sx = sw.x + sw.w * 0.5;
  const sy = sw.y - 4;
  const ctrlX = (sx + tx) * 0.5;
  const ctrlY = Math.max(sy, ty) + 26;

  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = active ? -time * 36 : -time * 12;
  ctx.lineWidth = active ? 4.4 : 3;
  ctx.strokeStyle = 'rgba(18, 16, 32, 0.42)';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
  ctx.stroke();

  ctx.lineWidth = active ? 2.4 : 1.6;
  ctx.strokeStyle = active ? sw.color : 'rgba(255, 248, 232, 0.44)';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(ctrlX, ctrlY, tx, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  // Energized signal pulse traveling from switch to mechanism when active
  if (active) {
    const t = (time * 0.9) % 1;
    const mt = 1 - t;
    const px = mt * mt * sx + 2 * mt * t * ctrlX + t * t * tx;
    const py = mt * mt * sy + 2 * mt * t * ctrlY + t * t * ty;
    ctx.fillStyle = '#FFF7D0';
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders moving platform guide rail & end bumper nodes.
 */
export function drawGuideRail(ctx, mp) {
  ctx.save();
  const x1 = mp.startX + mp.w * 0.5;
  const y1 = mp.startY + mp.h * 0.5;
  const x2 = mp.endX + mp.w * 0.5;
  const y2 = mp.endY + mp.h * 0.5;

  ctx.strokeStyle = 'rgba(20, 16, 36, 0.45)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 246, 224, 0.34)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);

  [
    [x1, y1],
    [x2, y2],
  ].forEach(([px, py]) => {
    ctx.fillStyle = '#241D36';
    ctx.strokeStyle = mp.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFF5D6';
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/**
 * Renders mechanical moving platform / lift carriage with rotary end gears & energized core bar.
 */
export function drawMovingPlatform(ctx, mp, time, isPowered = false) {
  ctx.save();
  // Dark metallic carriage chassis (exact hitbox bounds mp.x, mp.y, mp.w, mp.h)
  ctx.fillStyle = '#2B2440';
  ctx.strokeStyle = '#151024';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(mp.x, mp.y, mp.w, mp.h, 7);
  ctx.fill();

  // Subtle metallic lower bevel
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fillRect(mp.x + 3, mp.y + mp.h - 6, Math.max(0, mp.w - 6), 5);
  ctx.stroke();

  // Textured non-slip metallic top deck strip
  ctx.fillStyle = mp.color;
  ctx.beginPath();
  ctx.roundRect(mp.x + 3, mp.y + 2, Math.max(0, mp.w - 6), 7, [4, 4, 2, 2]);
  ctx.fill();

  // Bright top rim + subtle grip notches
  ctx.fillStyle = 'rgba(255, 250, 232, 0.45)';
  ctx.fillRect(mp.x + 6, mp.y + 2.5, Math.max(0, mp.w - 12), 2);
  ctx.strokeStyle = 'rgba(20, 14, 34, 0.35)';
  ctx.lineWidth = 1.3;
  for (let gx = mp.x + 18; gx < mp.x + mp.w - 14; gx += 16) {
    ctx.beginPath();
    ctx.moveTo(gx, mp.y + 3);
    ctx.lineTo(gx - 3, mp.y + 8);
    ctx.stroke();
  }

  // Animated rotary track gears/rollers at both ends
  const spin = isPowered ? time * 4.5 : 0;
  [mp.x + 11, mp.x + mp.w - 11].forEach((rx) => {
    const ry = mp.y + mp.h * 0.66;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(spin);
    ctx.fillStyle = isPowered ? '#FFF5D6' : '#8D82A8';
    ctx.strokeStyle = '#151024';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-3.2, 0);
    ctx.lineTo(3.2, 0);
    ctx.moveTo(0, -3.2);
    ctx.lineTo(0, 3.2);
    ctx.stroke();
    ctx.restore();
  });

  // Central directional status bar
  const centerW = Math.max(12, mp.w - 44);
  const cx = mp.x + (mp.w - centerW) * 0.5;
  ctx.fillStyle = isPowered ? 'rgba(255, 245, 192, 0.85)' : 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.roundRect(cx, mp.y + mp.h * 0.58, centerW, 3.5, 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Renders an expressive gate/barrier showing exact lock state & linked switch gems.
 */
export function drawGateBarrier(ctx, g, state, time, isSwitchActiveFn) {
  if (g.openProgress >= 0.99) return;
  ctx.save();

  const energized =
    g.latchedOpen ||
    g.openProgress > 0.05 ||
    (g.switches &&
      g.switches.length > 0 &&
      g.switches.every((id) => {
        const sw = state.switches.find((s) => s.id === id);
        return sw && isSwitchActiveFn(sw);
      }));

  // Heavy barrier body
  ctx.fillStyle = energized ? '#3D4866' : '#403457';
  ctx.strokeStyle = '#181228';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(g.x, g.y, g.w, g.h, 5);
  ctx.fill();

  // Inner vertical energy bars clipped strictly inside gate bounds
  ctx.save();
  ctx.clip();
  ctx.fillStyle = energized ? 'rgba(110, 231, 183, 0.18)' : 'rgba(0, 0, 0, 0.24)';
  ctx.fillRect(g.x + 5, g.y + 10, Math.max(0, g.w - 10), Math.max(0, g.h - 20));

  // Diagonal iron/warning crossbands on locked gates
  ctx.strokeStyle = energized ? 'rgba(167, 243, 208, 0.36)' : 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 3;
  for (let sy = g.y + 12; sy < g.y + g.h - 8; sy += 16) {
    ctx.beginPath();
    ctx.moveTo(g.x + 2, sy);
    ctx.lineTo(g.x + g.w - 2, sy + 9);
    ctx.stroke();
  }
  ctx.restore();

  // Crisp outer frame
  ctx.strokeStyle = '#181228';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(g.x, g.y, g.w, g.h, 5);
  ctx.stroke();

  // Top & Bottom reinforced metallic lock caps
  ctx.fillStyle = '#251D38';
  ctx.fillRect(g.x + 2, g.y + 2, Math.max(0, g.w - 4), 10);
  ctx.fillRect(g.x + 2, g.y + g.h - 12, Math.max(0, g.w - 4), 10);
  ctx.fillStyle = g.color;
  ctx.fillRect(g.x + 3, g.y + 12, Math.max(0, g.w - 6), 4);
  ctx.fillRect(g.x + 3, g.y + g.h - 16, Math.max(0, g.w - 6), 4);

  // Central Mechanical Seal & Switch Indicator Gems
  const gcx = g.x + g.w * 0.5;
  const gcy = g.y + g.h * 0.5;
  const pulse = energized ? 0.9 + Math.sin(time * 8) * 0.1 : 1;

  if (energized) {
    ctx.fillStyle = 'rgba(167, 243, 208, 0.28)';
    ctx.beginPath();
    ctx.arc(gcx, gcy, 15 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = energized ? '#A7F3D0' : g.color;
  ctx.strokeStyle = '#181228';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(gcx, gcy - 9);
  ctx.lineTo(gcx + 7.5, gcy);
  ctx.lineTo(gcx, gcy + 9);
  ctx.lineTo(gcx - 7.5, gcy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Keyhole / Lock pip inside emblem
  ctx.fillStyle = '#181228';
  ctx.beginPath();
  ctx.arc(gcx, gcy - 1, 2, 0, Math.PI * 2);
  ctx.fill();

  // Twin or single linked-switch indicator gems above center seal (reads AND-gates at a glance!)
  const swIds = g.switches || [];
  if (swIds.length > 0 && g.h >= 54) {
    const spacing = 9;
    const startY = gcy - 22;
    const startX = gcx - ((swIds.length - 1) * spacing) * 0.5;
    for (let k = 0; k < swIds.length; k++) {
      const sw = state.switches.find((s) => s.id === swIds[k]);
      const lit = g.latchedOpen || (sw && isSwitchActiveFn(sw));
      ctx.fillStyle = lit ? '#FFF5B8' : 'rgba(20, 16, 32, 0.78)';
      ctx.strokeStyle = sw ? sw.color : g.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(startX + k * spacing, startY, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Renders expressive dual-state pressure plate + lever arm mechanism.
 */
export function drawSwitchMechanism(ctx, sw, active, time) {
  const depressedPx = sw.pressDepth * 5;
  const cx = sw.x + sw.w * 0.5;

  ctx.save();

  // Soft active energy aura behind energized switch
  if (active) {
    const auraR = 20 + Math.sin(time * 6 + sw.x) * 2.5;
    ctx.fillStyle = 'rgba(255, 240, 165, 0.25)';
    ctx.beginPath();
    ctx.arc(cx, sw.y - 10, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Side mechanical lever arm that flips crisply from left (-26 deg) to right (+26 deg)
  ctx.save();
  ctx.translate(sw.x + 5, sw.y - 5);
  ctx.rotate(active ? 0.45 : -0.45);
  ctx.strokeStyle = '#171326';
  ctx.lineWidth = 4.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -14);
  ctx.stroke();
  ctx.strokeStyle = active ? '#FFF4C4' : '#9E93B8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -14);
  ctx.stroke();

  ctx.fillStyle = active ? '#FFF5B8' : sw.color;
  ctx.strokeStyle = '#171326';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, -15, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Bolted metallic base housing socket
  ctx.fillStyle = '#261F3B';
  ctx.strokeStyle = '#151024';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(sw.x - 4, sw.y - 6, sw.w + 8, 7, 3);
  ctx.fill();
  ctx.stroke();

  // Corner mounting bolts
  ctx.fillStyle = '#9D93B8';
  ctx.beginPath();
  ctx.arc(sw.x - 1, sw.y - 2.5, 1.3, 0, Math.PI * 2);
  ctx.arc(sw.x + sw.w + 1, sw.y - 2.5, 1.3, 0, Math.PI * 2);
  ctx.fill();

  // Depressible Pressure Pad / Latch Plate
  ctx.fillStyle = active ? '#FFF4C4' : sw.color;
  ctx.strokeStyle = '#181329';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(sw.x + 2, sw.y - 12 + depressedPx, sw.w - 4, 8 - depressedPx * 0.4, [5, 5, 1, 1]);
  ctx.fill();
  ctx.stroke();

  // Crisp top sheen strip on pad
  ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
  ctx.fillRect(sw.x + 6, sw.y - 11 + depressedPx, Math.max(0, sw.w - 12), 2);

  // Toggle vs Hold indicator pip in center
  if (sw.mode === 'toggle') {
    ctx.fillStyle = active ? '#10B981' : '#261F3B';
    ctx.strokeStyle = '#181329';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, sw.y - 8 + depressedPx * 0.7, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  if (sw.label) {
    const lx = cx;
    const ly = sw.y + 13;
    ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(18, 20, 36, 0.9)';
    ctx.strokeText(sw.label, lx, ly);
    ctx.fillStyle = active ? '#FFF4C4' : '#F8F4FF';
    ctx.fillText(sw.label, lx, ly);
  }

  ctx.restore();
}

/**
 * Renders high-contrast unmistakable hazard obstacles (thorns, forged spikes, glowing crystals).
 * @param {any} ctx
 * @param {any} hz
 * @param {number} time
 * @param {{ minX: number, maxX: number } | null} [viewRange=null]
 */
export function drawHazardObstacle(ctx, hz, time, viewRange = null) {
  if (!isRectVisible(hz.x - 6, hz.w + 12, viewRange)) return;

  ctx.save();
  const count = Math.max(3, Math.round(hz.w / 11));
  const step = hz.w / count;
  const dangerPulse = 0.75 + Math.sin(time * 5 + hz.x * 0.05) * 0.25;

  if (hz.kind === 'thorns') {
    // High-contrast dark-plum danger aura behind briar thorns
    ctx.fillStyle = `rgba(225, 29, 72, ${(0.16 * dangerPulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.roundRect(hz.x - 2, hz.y + 2, hz.w + 4, hz.h, 4);
    ctx.fill();

    // Knotted briar root bed
    ctx.fillStyle = '#381328';
    ctx.strokeStyle = '#180B18';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(hz.x, hz.y + hz.h - 6, hz.w, 6, 3);
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      const tipX = bx + (i % 2 === 0 ? -1.4 : 1.4);
      ctx.fillStyle = i % 2 === 0 ? '#E11D48' : '#BE123C';
      ctx.strokeStyle = '#1D0A1A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.45, hz.y + hz.h - 2);
      ctx.lineTo(tipX, hz.y);
      ctx.lineTo(bx + step * 0.45, hz.y + hz.h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Razor highlight edge
      ctx.strokeStyle = 'rgba(255, 224, 232, 0.65)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(tipX, hz.y + 2);
      ctx.lineTo(bx - step * 0.14, hz.y + hz.h - 4);
      ctx.stroke();
    }
  } else if (hz.kind === 'crystals') {
    // Unstable pulsing crystal danger bed
    ctx.fillStyle = `rgba(244, 63, 94, ${(0.18 * dangerPulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.roundRect(hz.x - 2, hz.y + 1, hz.w + 4, hz.h, 4);
    ctx.fill();

    ctx.fillStyle = '#1D1333';
    ctx.strokeStyle = '#0F0A1D';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(hz.x, hz.y + hz.h - 5, hz.w, 5, 2);
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      const hMod = i % 2 === 0 ? 0 : 2.5;
      ctx.fillStyle = i % 2 === 0 ? '#F43F5E' : '#38BDF8';
      ctx.strokeStyle = '#160E2B';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.48, hz.y + hz.h - 2);
      ctx.lineTo(bx - 1, hz.y + hMod);
      ctx.lineTo(bx + step * 0.48, hz.y + hz.h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${(0.58 * dangerPulse).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(bx - 1, hz.y + hMod + 2);
      ctx.lineTo(bx + 1.8, hz.y + hz.h - 4);
      ctx.lineTo(bx - 1.4, hz.y + hz.h - 4);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Forged steel-crimson spikes on hazard-striped iron anchor plate
    ctx.fillStyle = `rgba(239, 68, 68, ${(0.16 * dangerPulse).toFixed(2)})`;
    ctx.beginPath();
    ctx.roundRect(hz.x - 2, hz.y + 2, hz.w + 4, hz.h, 3);
    ctx.fill();

    ctx.fillStyle = '#2B1626';
    ctx.strokeStyle = '#140A16';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(hz.x, hz.y + hz.h - 5, hz.w, 5, 2);
    ctx.fill();
    ctx.stroke();

    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      // Left metallic crimson facet
      ctx.fillStyle = '#E11D48';
      ctx.strokeStyle = '#1A0F24';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.48, hz.y + hz.h - 2);
      ctx.lineTo(bx, hz.y);
      ctx.lineTo(bx + step * 0.48, hz.y + hz.h - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Crisp specular steel highlight facet
      ctx.fillStyle = '#FFE4E6';
      ctx.beginPath();
      ctx.moveTo(bx, hz.y + 1.5);
      ctx.lineTo(bx + 1.8, hz.y + hz.h - 4);
      ctx.lineTo(bx - 1.6, hz.y + hz.h - 4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}
