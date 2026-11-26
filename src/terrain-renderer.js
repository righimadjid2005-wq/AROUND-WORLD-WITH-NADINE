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
      return 'jungle_ruins';
    case 2:
      return 'ice_frost';
    case 3:
      return 'volcano_obsidian';
    case 4:
      return 'space_hull';
    case 5:
      return 'ocean_coral';
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
  } else if (biome === 'ice_frost' || biome === 'crystal_geode') {
    // Faceted glacial ice / mineral veins with specular shards
    tctx.strokeStyle = biome === 'ice_frost' ? 'rgba(224, 247, 255, 0.24)' : 'rgba(124, 196, 203, 0.11)';
    tctx.lineWidth = 1.4;
    tctx.beginPath();
    tctx.moveTo(0, 26);
    tctx.lineTo(28, 12);
    tctx.lineTo(58, 34);
    tctx.lineTo(96, 20);
    tctx.moveTo(14, 72);
    tctx.lineTo(48, 52);
    tctx.lineTo(82, 78);
    tctx.stroke();

    tctx.fillStyle = biome === 'ice_frost' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(124, 196, 203, 0.09)';
    tctx.beginPath();
    tctx.moveTo(28, 12);
    tctx.lineTo(44, 24);
    tctx.lineTo(24, 34);
    tctx.closePath();
    tctx.fill();

    tctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    for (let s = 0; s < 10; s++) {
      const sx = Math.floor(hash2d(s, 17) * size);
      const sy = Math.floor(hash2d(s, 23) * size);
      tctx.fillRect(sx, sy, 2, 2);
    }
  } else if (biome === 'volcano_obsidian') {
    // Cracked dark obsidian blocks with faint ember veins
    tctx.strokeStyle = 'rgba(255, 107, 61, 0.2)';
    tctx.lineWidth = 1.5;
    tctx.beginPath();
    tctx.moveTo(4, 14);
    tctx.lineTo(36, 36);
    tctx.lineTo(68, 22);
    tctx.lineTo(94, 42);
    tctx.moveTo(18, 86);
    tctx.lineTo(52, 60);
    tctx.lineTo(88, 82);
    tctx.stroke();
    tctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    tctx.fillRect(10, 10, 32, 22);
    tctx.fillRect(54, 48, 30, 26);
  } else if (biome === 'space_hull') {
    // Sleek modular starship bulkhead plating with neon conduit seam & rivets
    tctx.strokeStyle = 'rgba(120, 220, 250, 0.16)';
    tctx.lineWidth = 1.2;
    tctx.strokeRect(4, 4, 42, 42);
    tctx.strokeRect(50, 4, 42, 42);
    tctx.strokeRect(4, 50, 88, 42);
    tctx.fillStyle = 'rgba(186, 230, 253, 0.25)';
    [
      [9, 9],
      [41, 9],
      [55, 9],
      [87, 9],
      [9, 55],
      [87, 55],
    ].forEach(([rx, ry]) => {
      tctx.fillRect(rx, ry, 2, 2);
    });
  } else if (biome === 'ocean_coral') {
    // Sculpted reef limestone with faint shell swirls & seafoam speckles
    tctx.fillStyle = 'rgba(110, 231, 212, 0.09)';
    tctx.beginPath();
    tctx.arc(24, 24, 14, 0, Math.PI * 2);
    tctx.arc(72, 66, 16, 0, Math.PI * 2);
    tctx.fill();
    tctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    tctx.lineWidth = 1.2;
    tctx.beginPath();
    tctx.arc(24, 24, 9, 0.2, Math.PI * 1.5);
    tctx.arc(72, 66, 10, 0.5, Math.PI * 1.7);
    tctx.stroke();
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

  if (
    biome === 'meadow_turf' ||
    biome === 'jungle_ruins' ||
    biome === 'alpine_moss' ||
    biome === 'moonlit_garden' ||
    biome === 'ocean_coral'
  ) {
    // Organic scalloped moss/coral overhangs along the cap bottom edge (stays cleanly within p.w)
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
  } else if (biome === 'harbor_timber' || biome === 'space_hull') {
    // Steel-riveted pier or starship deck cap
    ctx.fillStyle = style.topRim;
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 1, Math.max(0, w - 4), 3.2, 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(10, 14, 24, 0.48)';
    ctx.lineWidth = 1.4;
    const plankW = 28;
    for (let bx = x + plankW; bx < x + w - 8; bx += plankW) {
      ctx.beginPath();
      ctx.moveTo(bx, y + 1);
      ctx.lineTo(bx, y + capH);
      ctx.stroke();

      ctx.fillStyle = biome === 'space_hull' ? 'rgba(103, 232, 249, 0.72)' : 'rgba(147, 197, 253, 0.55)';
      ctx.beginPath();
      ctx.arc(bx - 5, y + capH * 0.56, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (biome === 'cloud_pagoda') {
    // Segmented pagoda cornice planks with brass studs
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
  } else if (biome === 'ice_frost' || biome === 'crystal_geode' || biome === 'summit_marble') {
    // Sleek faceted crystal/ice/marble bevel + diagonal specular catch
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
  if (
    biome !== 'meadow_turf' &&
    biome !== 'jungle_ruins' &&
    biome !== 'alpine_moss' &&
    biome !== 'moonlit_garden'
  ) {
    return;
  }
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

  // Subtle 2.5D surface specular shimmer (especially crisp on ice, coral ocean, obsidian & starship decks)
  if (p.w >= 48) {
    const isShimmerBiome =
      biome === 'ice_frost' ||
      biome === 'ocean_coral' ||
      biome === 'space_hull' ||
      biome === 'volcano_obsidian';
    const shimmerAlpha = isShimmerBiome ? 0.22 : 0.11;
    const waveX = p.x + (((time * (isShimmerBiome ? 38 : 16) + p.x * 0.17) % Math.max(40, p.w)));
    const streakW = Math.min(34, p.w * 0.25);
    ctx.fillStyle =
      biome === 'volcano_obsidian'
        ? `rgba(255, 196, 120, ${shimmerAlpha})`
        : biome === 'ocean_coral'
          ? `rgba(153, 246, 228, ${shimmerAlpha})`
          : `rgba(255, 255, 255, ${shimmerAlpha})`;
    ctx.beginPath();
    ctx.roundRect(waveX, p.y + 2, streakW, 2.5, 1.5);
    ctx.fill();
  }

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
 * Draws an elevation-aware soft ground contact shadow directly below an entity
 * projected onto the nearest solid platform beneath its feet (60fps zero-GC).
 */
export function drawActorContactShadow(ctx, entity, platforms, movingPlatforms = [], worldHeight = 720) {
  if (!ctx || !entity || entity.devouredByGhost) return;
  const cx = entity.x + entity.w * 0.5;
  const footY = entity.y + entity.h;
  let floorY = null;

  if (Array.isArray(platforms)) {
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (cx < p.x + 2 || cx > p.x + p.w - 2) continue;
      if (p.y >= footY - 5 && (floorY === null || p.y < floorY)) {
        floorY = p.y;
      }
    }
  }
  if (Array.isArray(movingPlatforms)) {
    for (let i = 0; i < movingPlatforms.length; i++) {
      const mp = movingPlatforms[i];
      if (cx < mp.x + 2 || cx > mp.x + mp.w - 2) continue;
      if (mp.y >= footY - 5 && (floorY === null || mp.y < floorY)) {
        floorY = mp.y;
      }
    }
  }
  if (floorY === null || floorY > worldHeight + 40) return;

  const heightAbove = Math.max(0, floorY - footY);
  if (heightAbove > 165) return;

  const t = 1 - heightAbove / 165;
  const rx = (entity.w * 0.44) * (0.62 + t * 0.48);
  const ry = Math.max(2, 4.4 * t);
  const alpha = 0.28 * t * t;

  ctx.save();
  ctx.fillStyle = `rgba(10, 12, 26, ${alpha.toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(cx, floorY + 1.2, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
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
  } else if (hz.kind === 'lava') {
    // Surging molten volcanic lava trough with glowing magma bubbles
    const magmaGrad = ctx.createLinearGradient(hz.x, hz.y, hz.x, hz.y + hz.h);
    magmaGrad.addColorStop(0, '#FACC15');
    magmaGrad.addColorStop(0.45, '#F97316');
    magmaGrad.addColorStop(1, '#991B1B');
    ctx.fillStyle = magmaGrad;
    ctx.strokeStyle = '#450A0A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(hz.x, hz.y, hz.w, hz.h, [6, 6, 2, 2]);
    ctx.fill();
    ctx.stroke();

    // Animated surface magma crests
    ctx.fillStyle = '#FEF08A';
    for (let bx = hz.x + 8; bx < hz.x + hz.w - 8; bx += 18) {
      const waveY = hz.y + 3 + Math.sin(time * 5 + bx * 0.1) * 1.8;
      ctx.beginPath();
      ctx.arc(bx, waveY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (hz.kind === 'laser_beam') {
    const period = hz.cyclePeriod || 3.0;
    const phase = (((time + (hz.phase || 0)) % period) + period) % period;
    const active = typeof hz.activeNow === 'boolean' ? hz.activeNow : phase < period * 0.56;
    const warning = !active && phase >= period * 0.84;
    const cx = hz.x + hz.w * 0.5;

    // Top & bottom emitter pods
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = active ? '#FCA5A5' : '#38BDF8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(hz.x - 2, hz.y, hz.w + 4, 12, 4);
    ctx.roundRect(hz.x - 2, hz.y + hz.h - 12, hz.w + 4, 12, 4);
    ctx.fill();
    ctx.stroke();

    if (active) {
      const flicker = 0.78 + Math.sin(time * 32 + hz.x) * 0.22;
      ctx.fillStyle = `rgba(239, 68, 68, ${(0.32 * flicker).toFixed(2)})`;
      ctx.fillRect(hz.x + 1, hz.y + 10, Math.max(4, hz.w - 2), hz.h - 20);

      ctx.fillStyle = '#EF4444';
      ctx.fillRect(cx - 4, hz.y + 10, 8, hz.h - 20);
      ctx.fillStyle = '#FEF2F2';
      ctx.fillRect(cx - 1.6, hz.y + 10, 3.2, hz.h - 20);
    } else if (warning) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(cx, hz.y + 12);
      ctx.lineTo(cx, hz.y + hz.h - 12);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(cx, hz.y + 12);
      ctx.lineTo(cx, hz.y + hz.h - 12);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else if (hz.kind === 'asteroid') {
    const bob = Math.sin(time * 2.1 + hz.x * 0.03) * 2.2;
    const cx = hz.x + hz.w * 0.5;
    const cy = hz.y + hz.h * 0.5 + bob;
    const rx = hz.w * 0.48;
    const ry = hz.h * 0.46;

    ctx.fillStyle = 'rgba(244, 63, 94, 0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + 5, ry + 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.85, cy - ry * 0.25);
    ctx.lineTo(cx - rx * 0.35, cy - ry * 0.92);
    ctx.lineTo(cx + rx * 0.45, cy - ry * 0.82);
    ctx.lineTo(cx + rx * 0.95, cy - ry * 0.1);
    ctx.lineTo(cx + rx * 0.65, cy + ry * 0.82);
    ctx.lineTo(cx - rx * 0.25, cy + ry * 0.94);
    ctx.lineTo(cx - rx * 0.92, cy + ry * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Craters
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.arc(cx - rx * 0.25, cy - ry * 0.15, 4.5, 0, Math.PI * 2);
    ctx.arc(cx + rx * 0.28, cy + ry * 0.24, 3.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (hz.kind === 'icicle') {
    ctx.fillStyle = '#1E3A5F';
    ctx.fillRect(hz.x, hz.y, hz.w, 4);
    for (let i = 0; i < count; i++) {
      const bx = hz.x + i * step + step * 0.5;
      ctx.fillStyle = i % 2 === 0 ? '#7DD3FC' : '#BAE6FD';
      ctx.strokeStyle = '#0F2544';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.46, hz.y + 2);
      ctx.lineTo(bx, hz.y + hz.h);
      ctx.lineTo(bx + step * 0.46, hz.y + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.beginPath();
      ctx.moveTo(bx - step * 0.18, hz.y + 3);
      ctx.lineTo(bx, hz.y + hz.h - 3);
      ctx.lineTo(bx, hz.y + 3);
      ctx.closePath();
      ctx.fill();
    }
  } else if (hz.kind === 'jellyfish') {
    const bob = Math.sin(time * 3.1 + hz.x * 0.05) * 2.5;
    const cx = hz.x + hz.w * 0.5;
    const bellY = hz.y + 14 + bob;
    // Trailing glowing tentacles inside bounds
    ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
    ctx.lineWidth = 2;
    [-9, -3, 3, 9].forEach((tx, idx) => {
      const wave = Math.sin(time * 6 + idx) * 2.8;
      ctx.beginPath();
      ctx.moveTo(cx + tx, bellY + 2);
      ctx.quadraticCurveTo(cx + tx + wave, bellY + 14, cx + tx - wave * 0.6, hz.y + hz.h - 2);
      ctx.stroke();
    });
    // Bioluminescent jellyfish dome
    ctx.fillStyle = 'rgba(244, 114, 182, 0.78)';
    ctx.strokeStyle = '#FDE047';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, bellY, hz.w * 0.44, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.beginPath();
    ctx.ellipse(cx - 4, bellY - 6, 4.5, 2.2, -0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (hz.kind === 'urchin') {
    const cx = hz.x + hz.w * 0.5;
    const cy = hz.y + hz.h - 4;
    ctx.fillStyle = '#4C1D95';
    ctx.strokeStyle = '#1E1B4B';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < count + 1; i++) {
      const px = hz.x + 5 + (i / Math.max(1, count)) * Math.max(8, hz.w - 10);
      const angle = -Math.PI + ((i + 0.5) / (count + 1)) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(px - 3, cy);
      ctx.lineTo(px + Math.cos(angle) * 5, hz.y);
      ctx.lineTo(px + 3, cy);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? '#7E22CE' : '#EC4899';
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#3B0764';
    ctx.beginPath();
    ctx.roundRect(cx - hz.w * 0.44, cy - 3, hz.w * 0.88, 6, 3);
    ctx.fill();
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

/**
 * Renders soft ambient contact shadows directly beneath elevated ledges and archways onto the ground plane.
 */
export function drawTerrainContactShadows(ctx, platforms = [], groundY = 600, viewRange = null) {
  if (!Array.isArray(platforms) || platforms.length === 0) return;
  ctx.save();
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (p.kind === 'ground') continue;
    if (!isRectVisible(p.x - 16, p.w + 32, viewRange)) continue;
    const distY = groundY - (p.y + p.h);
    if (distY < -4 || distY > 280) continue;
    const fade = Math.max(0.08, 0.26 * (1 - Math.max(0, distY) / 300));
    ctx.fillStyle = `rgba(10, 14, 28, ${fade.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      p.x + p.w * 0.5,
      groundY + 3,
      p.w * 0.46,
      Math.max(4, 9 - distY * 0.015),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders carved mechanical Arrow / Bolt Trap totem with glowing telegraph sight cue.
 */
export function drawArrowTrap(ctx, trap, time, viewRange = null) {
  if (!trap || !isRectVisible(trap.x - 24, 56, viewRange)) return;
  const dir = trap.dir === 1 ? 1 : -1;
  const w = trap.w || 32;
  const h = trap.h || 38;
  const isTelegraph = Boolean(trap.telegraph);
  const pulse = isTelegraph ? 0.65 + Math.sin(time * 28) * 0.35 : 0;

  ctx.save();
  ctx.translate(trap.x, trap.y);

  // Telegraph aim sight line before firing so players can jump cleanly
  if (isTelegraph) {
    const sightStart = dir === 1 ? w : 0;
    ctx.strokeStyle = `rgba(248, 113, 113, ${(0.45 + pulse * 0.45).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(sightStart, 14);
    ctx.lineTo(sightStart + dir * 210, 14);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Carved stone/iron trap housing
  ctx.fillStyle = trap.biome === 'ice' ? '#2B4C6F' : trap.biome === 'space' ? '#253659' : '#3C3246';
  ctx.strokeStyle = '#140F20';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 6);
  ctx.fill();
  ctx.stroke();

  // Top metallic bevel
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fillRect(3, 2, w - 6, 4);

  // Firing nozzle aperture facing trap.dir
  const nozzleX = dir === 1 ? w - 6 : -2;
  ctx.fillStyle = '#181224';
  ctx.strokeStyle = isTelegraph ? '#FCA5A5' : '#64748B';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(nozzleX, 9, 8, 10, 2);
  ctx.fill();
  ctx.stroke();

  // Glowing tension gem on front plate (turns bright crimson during telegraph)
  ctx.fillStyle = isTelegraph ? '#EF4444' : '#F59E0B';
  ctx.beginPath();
  ctx.arc(w * 0.5, 14, isTelegraph ? 4.4 : 3.2, 0, Math.PI * 2);
  ctx.fill();
  if (isTelegraph) {
    ctx.fillStyle = '#FEF2F2';
    ctx.beginPath();
    ctx.arc(w * 0.5, 14, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Renders fast flying arrow / bolt projectile with crisp directional trail.
 */
export function drawArrowProjectile(ctx, proj, _time, viewRange = null) {
  if (!proj || !isRectVisible(proj.x - 28, 56, viewRange)) return;
  const dir = proj.vx >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(proj.x, proj.y);
  ctx.scale(dir, 1);

  // Subtle air streak trail
  ctx.strokeStyle = proj.biome === 'space' ? 'rgba(56, 189, 248, 0.5)' : 'rgba(254, 226, 226, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-4, 0);
  ctx.stroke();

  // Arrow shaft
  ctx.strokeStyle = '#1C1426';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();
  ctx.strokeStyle = proj.biome === 'space' ? '#38BDF8' : '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.stroke();

  // Razor arrowhead
  ctx.fillStyle = '#F43F5E';
  ctx.strokeStyle = '#181024';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(5, -4.5);
  ctx.lineTo(7, 0);
  ctx.lineTo(5, 4.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * Renders heavy carryable Relic Weight Block (used to weigh down Carry Pedestals).
 */
export function drawCarryBlock(ctx, block, time, viewRange = null) {
  if (!block || !isRectVisible(block.x - 8, block.w + 16, viewRange)) return;
  const cx = block.x + block.w * 0.5;
  const cy = block.y + block.h * 0.5;
  const isPlaced = Boolean(block.placedPedestalId);
  const pulse = isPlaced ? 0.5 + Math.sin(time * 5) * 0.25 : 0.2;

  ctx.save();
  if (!block.carriedBy) {
    ctx.fillStyle = 'rgba(12, 16, 32, 0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, block.y + block.h + 1, block.w * 0.48, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = block.biome === 'volcano' ? '#57282A' : block.biome === 'ocean' ? '#1E5E68' : '#5B5368';
  ctx.strokeStyle = isPlaced ? '#FDE047' : '#1E1B2E';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.roundRect(block.x, block.y, block.w, block.h, 7);
  ctx.fill();
  ctx.stroke();

  // Inner carved relic rune emblem
  ctx.fillStyle = `rgba(253, 224, 71, ${(0.38 + pulse).toFixed(2)})`;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx, cy + 8);
  ctx.lineTo(cx - 8, cy);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.26)';
  ctx.fillRect(block.x + 4, block.y + 3, block.w - 8, 3);
  ctx.restore();
}

/**
 * Renders Heavy Weight Pedestal that unlocks linked Carry-Required Barriers when weighted down.
 */
export function drawCarryPedestal(ctx, ped, active, time, viewRange = null) {
  if (!ped || !isRectVisible(ped.x - 16, ped.w + 32, viewRange)) return;
  const cx = ped.x + ped.w * 0.5;
  ctx.save();

  if (active) {
    const aura = 22 + Math.sin(time * 5) * 3;
    ctx.fillStyle = 'rgba(250, 204, 21, 0.28)';
    ctx.beginPath();
    ctx.arc(cx, ped.y - 12, aura, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#241E38';
  ctx.strokeStyle = '#120F20';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.roundRect(ped.x - 3, ped.y - 7, ped.w + 6, 8, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = active ? '#FDE047' : ped.color || '#F59E0B';
  ctx.strokeStyle = '#181228';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(ped.x + 2, ped.y - (active ? 10 : 14), ped.w - 4, active ? 5 : 8, 4);
  ctx.fill();
  ctx.stroke();

  if (ped.label) {
    ctx.font = '700 10px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(14, 18, 34, 0.9)';
    ctx.strokeText(ped.label, cx, ped.y + 8);
    ctx.fillStyle = active ? '#FEF08A' : '#E2E8F0';
    ctx.fillText(ped.label, cx, ped.y + 8);
  }
  ctx.restore();
}

/**
 * Renders a rising volcanic thermal updraft column over magma vents.
 */
export function drawThermalVent(ctx, vent, time, viewRange = null) {
  if (!vent || !isRectVisible(vent.x - 8, vent.w + 16, viewRange)) return;
  ctx.save();
  const grad = ctx.createLinearGradient(vent.x, vent.y + vent.h, vent.x, vent.y);
  grad.addColorStop(0, 'rgba(251, 146, 60, 0.34)');
  grad.addColorStop(0.55, 'rgba(253, 186, 116, 0.16)');
  grad.addColorStop(1, 'rgba(254, 240, 138, 0.02)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(vent.x, vent.y, vent.w, vent.h, 12);
  ctx.fill();

  const cx = vent.x + vent.w * 0.5;
  ctx.strokeStyle = 'rgba(254, 240, 138, 0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const frac = ((time * 0.72 + i * 0.25) % 1);
    const ay = vent.y + vent.h - frac * (vent.h - 24);
    const sway = Math.sin(time * 4 + i * 1.7) * 8;
    ctx.globalAlpha = Math.sin(frac * Math.PI) * 0.85;
    ctx.beginPath();
    ctx.moveTo(cx + sway - 10, ay + 6);
    ctx.lineTo(cx + sway, ay - 2);
    ctx.lineTo(cx + sway + 10, ay + 6);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders directional underwater current streamlines pushing swimmers smoothly along (vx, vy).
 */
export function drawOceanCurrent(ctx, cur, time, viewRange = null) {
  if (!cur || !isRectVisible(cur.x - 8, cur.w + 16, viewRange)) return;
  ctx.save();
  ctx.fillStyle = 'rgba(94, 234, 212, 0.09)';
  ctx.strokeStyle = 'rgba(153, 246, 228, 0.28)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(cur.x, cur.y, cur.w, cur.h, 18);
  ctx.fill();
  ctx.stroke();

  const vx = cur.vx || 0;
  const vy = cur.vy || 0;
  const len = Math.max(1, Math.hypot(vx, vy));
  const ux = vx / len;
  const uy = vy / len;

  ctx.strokeStyle = 'rgba(204, 251, 241, 0.58)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let r = 0; r < 5; r++) {
    const prog = ((time * 0.58 + r * 0.21) % 1);
    const sx = cur.x + 24 + prog * Math.max(20, cur.w - 48);
    const sy = cur.y + 32 + ((r + 0.5) / 5) * Math.max(20, cur.h - 64) + Math.sin(time * 3 + r) * 5;
    ctx.globalAlpha = Math.sin(prog * Math.PI) * 0.9;
    ctx.beginPath();
    ctx.moveTo(sx - ux * 16, sy - uy * 16);
    ctx.lineTo(sx + ux * 16, sy + uy * 16);
    ctx.stroke();

    // Chevron head pointing along current velocity
    ctx.beginPath();
    ctx.moveTo(sx + ux * 16 - ux * 6 - uy * 4, sy + uy * 16 - uy * 6 + ux * 4);
    ctx.lineTo(sx + ux * 16, sy + uy * 16);
    ctx.lineTo(sx + ux * 16 - ux * 6 + uy * 4, sy + uy * 16 - uy * 6 - ux * 4);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders biome-styled climbable ladders with sharp specular highlights (zero Math.random()).
 */
export function drawLadder(ctx, ladder, theme, time, viewRange = null) {
  if (!ladder || !isRectVisible(ladder.x - 10, ladder.w + 20, viewRange)) return;
  const x = ladder.x;
  const y = ladder.y;
  const w = ladder.w || 32;
  const h = ladder.h || 120;
  const mat = ladder.material || 'vine_wood';

  let railFill = '#8B5A2B';
  let railStroke = '#3F230D';
  let rungFill = '#C28E4C';
  let accentGlow = null;

  if (mat === 'frost_timber') {
    railFill = '#5E8CA8';
    railStroke = '#1E3A5F';
    rungFill = '#BAE6FD';
  } else if (mat === 'obsidian_iron') {
    railFill = '#4B3A42';
    railStroke = '#1C1117';
    rungFill = '#FB923C';
  } else if (mat === 'plasma_lattice') {
    railFill = '#2E4369';
    railStroke = '#0F172A';
    rungFill = '#67E8F9';
    accentGlow = 'rgba(34, 211, 238, 0.25)';
  } else if (mat === 'coral_bamboo') {
    railFill = '#0F766E';
    railStroke = '#042F2E';
    rungFill = '#F9A8D4';
  }

  ctx.save();
  if (accentGlow) {
    ctx.fillStyle = accentGlow;
    ctx.fillRect(x + 2, y, w - 4, h);
  }

  const rungStep = 22;
  ctx.lineCap = 'round';
  for (let ry = y + 14; ry < y + h - 8; ry += rungStep) {
    ctx.fillStyle = rungFill;
    ctx.strokeStyle = railStroke;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(x + 3, ry - 2.5, w - 6, 5, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.fillRect(x + 6, ry - 1.8, Math.max(4, w - 12), 1.4);
  }

  // Left and right vertical side rails
  const railW = 6;
  [x + 2, x + w - 2 - railW].forEach((rx) => {
    ctx.fillStyle = railFill;
    ctx.strokeStyle = railStroke;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(rx, y - 2, railW, h + 4, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fillRect(rx + 1.2, y + 2, 1.6, h - 2);
  });

  // Subtle top leaf/frost/neon cap accents (deterministic sway, zero Math.random)
  if (mat === 'vine_wood' || mat === 'coral_bamboo') {
    const sway = Math.sin(time * 2.4 + x * 0.02) * 2.2;
    ctx.fillStyle = mat === 'vine_wood' ? '#4ADE80' : '#5EEAD4';
    ctx.beginPath();
    ctx.ellipse(x + 4 + sway, y + 6, 5, 3, -0.4, 0, Math.PI * 2);
    ctx.ellipse(x + w - 4 - sway, y + 18, 5, 3, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Renders advancing co-op escape surge wave (avalanche snow, magma wall, or abyssal tide).
 */
export function drawEscapeSurge(ctx, escapeState, worldHeight, time) {
  if (!escapeState || (!escapeState.active && !escapeState.cleared)) return;
  const kind = escapeState.hazardKind || 'magma_wave';

  ctx.save();
  // Safe exit beacon line at endX so players clearly see the refuge threshold
  const ex = escapeState.endX;
  ctx.strokeStyle = escapeState.cleared ? 'rgba(110, 231, 183, 0.65)' : 'rgba(250, 204, 21, 0.72)';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(ex, 160);
  ctx.lineTo(ex, worldHeight - 120);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '800 11px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = escapeState.cleared ? '#86EFAC' : '#FEF08A';
  ctx.fillText(escapeState.cleared ? 'SAFE ZONE CLEARED' : 'ESCAPE LINE', ex, 148);

  if (!escapeState.active) {
    ctx.restore();
    return;
  }

  const frontX = escapeState.wallX;
  const spanBack = 420;
  const leftX = frontX - spanBack;

  let c0 = 'rgba(224, 242, 254, 0.94)';
  let c1 = 'rgba(125, 211, 252, 0.84)';
  let crest = '#FFFFFF';
  if (kind === 'magma_wave') {
    c0 = 'rgba(254, 215, 170, 0.95)';
    c1 = 'rgba(239, 68, 68, 0.86)';
    crest = '#FDE047';
  } else if (kind === 'abyssal_tide') {
    c0 = 'rgba(165, 243, 252, 0.92)';
    c1 = 'rgba(13, 148, 136, 0.84)';
    crest = '#99F6E4';
  }

  const grad = ctx.createLinearGradient(leftX, 0, frontX + 18, 0);
  grad.addColorStop(0, c1);
  grad.addColorStop(0.84, c0);
  grad.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(leftX, 0);
  for (let sy = 0; sy <= worldHeight; sy += 28) {
    const ripple = Math.sin(sy * 0.032 + time * 9.5) * 14 + Math.cos(sy * 0.07 - time * 6) * 7;
    ctx.lineTo(frontX + ripple, sy);
  }
  ctx.lineTo(leftX, worldHeight);
  ctx.closePath();
  ctx.fill();

  // Crisp glowing leading crest
  ctx.strokeStyle = crest;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let sy = 0; sy <= worldHeight; sy += 28) {
    const ripple = Math.sin(sy * 0.032 + time * 9.5) * 14 + Math.cos(sy * 0.07 - time * 6) * 7;
    if (sy === 0) ctx.moveTo(frontX + ripple, sy);
    else ctx.lineTo(frontX + ripple, sy);
  }
  ctx.stroke();

  ctx.restore();
}

/**
 * Renders escalating World 3+ unpredictable dynamic traps with deterministic Canvas2D detail
 * and readable telegraph cues (zero Math.random()).
 */
export function drawDynamicTrap(ctx, trap, theme, time, viewRange = null) {
  if (!trap) return;

  if (trap.kind === 'trap_chain') {
    const stages = trap.activeStages || [];
    const spanMin = stages.reduce((m, s) => Math.min(m, s.x), trap.x) - 16;
    const spanMax = stages.reduce((m, s) => Math.max(m, s.x + (s.w || 42)), trap.x + (trap.w || 42)) + 16;
    if (!isRectVisible(spanMin, spanMax - spanMin, viewRange)) return;

    ctx.save();
    // Conduit wire linking chain pads
    if (stages.length > 1) {
      const first = stages[0];
      const last = stages[stages.length - 1];
      const lineY = (first.y || trap.y) + ((first.h || 16) * 0.65);
      ctx.strokeStyle = trap.phase === 'chaining' ? 'rgba(251, 146, 60, 0.72)' : 'rgba(148, 163, 184, 0.42)';
      ctx.lineWidth = trap.phase === 'chaining' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(first.x + (first.w || 42) * 0.5, lineY);
      ctx.lineTo(last.x + (last.w || 42) * 0.5, lineY);
      ctx.stroke();
    }

    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      const sw = st.w || 42;
      const sh = st.h || 16;
      const sx = st.x;
      const sy = st.y;
      const cx = sx + sw * 0.5;
      const ph = st.phase || 'dormant';

      if (ph === 'armed') {
        const pulse = 0.55 + Math.sin(time * 32 + i) * 0.35;
        ctx.fillStyle = `rgba(251, 191, 36, ${pulse.toFixed(2)})`;
        ctx.beginPath();
        ctx.roundRect(sx - 3, sy - 6, sw + 6, sh + 6, 4);
        ctx.fill();
      } else if (ph === 'active') {
        const eruptH = 28;
        ctx.fillStyle = 'rgba(244, 63, 94, 0.25)';
        ctx.beginPath();
        ctx.roundRect(sx, sy - eruptH - 4, sw, eruptH + sh, 6);
        ctx.fill();

        for (let k = 0; k < 3; k++) {
          const bx = sx + ((k + 0.5) / 3) * sw;
          ctx.fillStyle = k % 2 === 0 ? '#F43F5E' : '#FB923C';
          ctx.strokeStyle = '#181024';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(bx - 6, sy + 2);
          ctx.lineTo(bx, sy - eruptH);
          ctx.lineTo(bx + 6, sy + 2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      ctx.fillStyle = ph === 'active' ? '#9F1239' : ph === 'armed' ? '#D97706' : ph === 'pending' ? '#64748B' : '#334155';
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(sx, sy + sh - 8, sw, 8, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = ph === 'active' ? '#FECDD3' : ph === 'armed' ? '#FEF08A' : '#94A3B8';
      ctx.beginPath();
      ctx.arc(cx, sy + sh - 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (!isRectVisible(trap.x - 40, (trap.w || 64) + 80, viewRange)) return;
  ctx.save();

  if (trap.kind === 'delayed_snare') {
    const w = trap.w || 68;
    const h = trap.h || 16;
    const cx = trap.x + w * 0.5;
    const ph = trap.phase || 'dormant';

    if (ph === 'armed') {
      const pulse = 0.5 + Math.sin(time * 34) * 0.4;
      ctx.fillStyle = `rgba(251, 191, 36, ${pulse.toFixed(2)})`;
      ctx.beginPath();
      ctx.roundRect(trap.x - 4, trap.y - 4, w + 8, h + 4, 5);
      ctx.fill();

      // Telegraph warning chevron above armed plate
      ctx.strokeStyle = '#FEF08A';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 7, trap.y - 12);
      ctx.lineTo(cx, trap.y - 19);
      ctx.lineTo(cx + 7, trap.y - 12);
      ctx.stroke();
    } else if (ph === 'active') {
      const spikeCount = Math.max(3, Math.floor(w / 14));
      const step = w / spikeCount;
      ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
      ctx.beginPath();
      ctx.roundRect(trap.x, trap.y - 28, w, h + 28, 6);
      ctx.fill();

      for (let i = 0; i < spikeCount; i++) {
        const bx = trap.x + (i + 0.5) * step;
        ctx.fillStyle = i % 2 === 0 ? '#E11D48' : '#FB7185';
        ctx.strokeStyle = '#181024';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(bx - step * 0.42, trap.y + h - 4);
        ctx.lineTo(bx, trap.y - 26);
        ctx.lineTo(bx + step * 0.42, trap.y + h - 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Recessed snare plate
    ctx.fillStyle = ph === 'active' ? '#7F1D1D' : ph === 'armed' ? '#B45309' : ph === 'cooldown' ? '#1E293B' : '#3F3552';
    ctx.strokeStyle = '#140F20';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(trap.x, trap.y + h - 7, w, 7, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ph === 'dormant' ? 'rgba(253, 224, 71, 0.35)' : '#FDE047';
    ctx.fillRect(trap.x + 8, trap.y + h - 5, w - 16, 2);
  } else if (trap.kind === 'collapsing_tile') {
    const w = trap.w || 72;
    const h = trap.h || 20;
    const ph = trap.phase || 'dormant';

    if (ph === 'collapsed') {
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.38)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.roundRect(trap.x, trap.y, w, h, 5);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const jitterX = ph === 'armed' ? Math.sin(time * 54) * 2.4 : 0;
      const jitterY = ph === 'armed' ? Math.cos(time * 47) * 1.1 : 0;
      const tx = trap.x + jitterX;
      const ty = trap.y + jitterY;

      let fill = '#6B5C78';
      let topCap = '#A898B8';
      if (theme === 'volcano') {
        fill = '#5C3330';
        topCap = '#FB923C';
      } else if (theme === 'space') {
        fill = '#2E4369';
        topCap = '#67E8F9';
      } else if (theme === 'ocean') {
        fill = '#155E63';
        topCap = '#5EEAD4';
      }

      ctx.fillStyle = ph === 'armed' ? '#92400E' : fill;
      ctx.strokeStyle = ph === 'armed' ? '#FDE047' : '#140F20';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(tx, ty, w, h, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = ph === 'armed' ? '#FBBF24' : topCap;
      ctx.fillRect(tx + 3, ty + 2, w - 6, 4);

      // Distinct hairline fracture cracks so players recognize crumbling bridge tiles
      ctx.strokeStyle = ph === 'armed' ? '#FEF08A' : 'rgba(15, 23, 42, 0.72)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(tx + w * 0.28, ty + 2);
      ctx.lineTo(tx + w * 0.35, ty + h * 0.58);
      ctx.lineTo(tx + w * 0.31, ty + h - 2);
      ctx.moveTo(tx + w * 0.68, ty + 2);
      ctx.lineTo(tx + w * 0.62, ty + h * 0.54);
      ctx.lineTo(tx + w * 0.71, ty + h - 2);
      ctx.stroke();
    }
  } else if (trap.kind === 'shifting_hazard') {
    const w = trap.w || 54;
    const h = trap.h || 18;
    const minX = typeof trap.minX === 'number' ? trap.minX : trap.x - 70;
    const maxX = typeof trap.maxX === 'number' ? trap.maxX : trap.x + 70;
    const cx = trap.x + w * 0.5;
    const cy = trap.y + h * 0.5;
    const reversing = trap.phase === 'reversing';
    const surging = (trap.surgeTimer || 0) > 0;

    // Guide rail showing patrol span on ground
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(minX + 6, trap.y + h - 2);
    ctx.lineTo(maxX - 6, trap.y + h - 2);
    ctx.stroke();

    if (reversing) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.34)';
      ctx.beginPath();
      ctx.arc(cx, cy, w * 0.62, 0, Math.PI * 2);
      ctx.fill();

      // Reversal double-arrow warning glyph
      ctx.strokeStyle = '#FEF08A';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 10, trap.y - 12);
      ctx.lineTo(cx + 10, trap.y - 12);
      ctx.moveTo(cx + 5, trap.y - 16);
      ctx.lineTo(cx + 10, trap.y - 12);
      ctx.lineTo(cx + 5, trap.y - 8);
      ctx.moveTo(cx - 5, trap.y - 16);
      ctx.lineTo(cx - 10, trap.y - 12);
      ctx.lineTo(cx - 5, trap.y - 8);
      ctx.stroke();
    } else if (surging) {
      const wakeDir = -(trap.dir || 1);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.55)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx + wakeDir * 14, cy - 3);
      ctx.lineTo(cx + wakeDir * 30, cy - 3);
      ctx.moveTo(cx + wakeDir * 12, cy + 3);
      ctx.lineTo(cx + wakeDir * 26, cy + 3);
      ctx.stroke();
    }

    // Core shifting blade/orb carriage
    ctx.fillStyle = reversing ? '#F59E0B' : surging ? '#F43F5E' : '#E11D48';
    ctx.strokeStyle = '#181024';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(trap.x, trap.y + 3, w, h - 3, 7);
    ctx.fill();
    ctx.stroke();

    // Spinning saw teeth / plasma prongs
    const spin = time * (surging ? 16 : 9) * (trap.dir || 1);
    ctx.fillStyle = '#FFE4E6';
    for (let i = 0; i < 4; i++) {
      const ang = spin + (i * Math.PI) / 2;
      const tx = cx + Math.cos(ang) * (w * 0.34);
      const ty = cy + Math.sin(ang) * 4.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}



