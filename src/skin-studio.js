/**
 * src/skin-studio.js
 * Custom Skin Creator Studio schema, local persistence, server-sync serialization,
 * and Canvas2D custom pattern/accessory helpers for "Around the World with Nadine".
 */

export const CUSTOM_SKINS_STORAGE_KEY = 'nadine_custom_skins_v1';

export const SKIN_PATTERNS = [
  { id: 'solid', label: 'Solid Satin' },
  { id: 'spots', label: 'Playful Spots' },
  { id: 'stripes', label: 'Horizon Stripes' },
  { id: 'gradient', label: 'Dual Ombre' },
  { id: 'starry', label: 'Starry Spark' },
];

export const SKIN_HEADGEAR = [
  { id: 'none', label: 'None' },
  { id: 'crown', label: 'Mini Crown' },
  { id: 'headband', label: 'Ribbon Band' },
  { id: 'helmet', label: 'Astro Visor' },
  { id: 'leaf_sprout', label: 'Leaf Sprout' },
];

export const SKIN_AURAS = [
  { id: 'none', label: 'None' },
  { id: 'glimmer', label: 'Soft Glimmer' },
  { id: 'hearts', label: 'Warm Halo' },
  { id: 'cosmic', label: 'Starlight Ring' },
];

/**
 * Sanitizes and builds a custom skin config ready for registerSkin() and WebSocket sync.
 * @param {any} input
 */
export function buildCustomSkinConfig(input = {}) {
  const character = input.character === 'nadine' ? 'nadine' : 'madjid';
  const rawName = String(input.name || 'Custom Look').trim().slice(0, 24) || 'Custom Look';
  const safeIdBase = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'look';
  const id = String(input.id || `custom-${character}-${safeIdBase}`).slice(0, 48);

  const body = normalizeHex(input.body || (character === 'madjid' ? '#5E85E6' : '#E87BA6'), '#5E85E6');
  const bodyDark = normalizeHex(input.bodyDark || darkenHex(body, 0.24), '#3A58AE');
  const outline = normalizeHex(input.outline || '#1E2540', '#1E2540');
  const trail = normalizeHex(input.trail || body, body);
  const accent = normalizeHex(input.accent || '#FDE047', '#FDE047');

  const pattern = SKIN_PATTERNS.some((p) => p.id === input.pattern) ? input.pattern : 'solid';
  const headgear = SKIN_HEADGEAR.some((h) => h.id === input.headgear) ? input.headgear : 'none';
  const aura = SKIN_AURAS.some((a) => a.id === input.aura) ? input.aura : 'none';

  return {
    id,
    character,
    name: rawName,
    tagline: `Custom ${pattern} outfit`,
    isCustom: true,
    pattern,
    headgear,
    aura,
    accent,
    palette: {
      body,
      bodyDark,
      belly: lightenHex(body, 0.45),
      outline,
      highlight: 'rgba(255, 255, 255, 0.62)',
      cheek: character === 'madjid' ? 'rgba(248, 128, 152, 0.55)' : 'rgba(255, 130, 165, 0.7)',
      blush: character === 'madjid' ? 'rgba(248, 128, 152, 0.55)' : 'rgba(255, 130, 165, 0.7)',
      spot: 'rgba(255, 255, 255, 0.3)',
      accent,
      accentAlt: lightenHex(accent, 0.25),
      eyeWhite: '#FFFFFF',
      pupil: '#1C223B',
      trail,
      shine: 'rgba(255, 255, 255, 0.6)',
    },
  };
}

function normalizeHex(hex, fallback) {
  const s = String(hex || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}

function darkenHex(hex, amount = 0.25) {
  const clean = normalizeHex(hex, '#5E85E6').slice(1);
  const r = Math.max(0, Math.round(parseInt(clean.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(clean.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(clean.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
    .toString(16)
    .padStart(2, '0')}`.toUpperCase();
}

function lightenHex(hex, amount = 0.4) {
  const clean = normalizeHex(hex, '#5E85E6').slice(1);
  const r = Math.min(255, Math.round(parseInt(clean.slice(0, 2), 16) + (255 - parseInt(clean.slice(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(clean.slice(2, 4), 16) + (255 - parseInt(clean.slice(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(clean.slice(4, 6), 16) + (255 - parseInt(clean.slice(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
    .toString(16)
    .padStart(2, '0')}`.toUpperCase();
}

/**
 * Loads saved custom skins from localStorage safely.
 */
export function loadSavedCustomSkins() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CUSTOM_SKINS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).map((item) => buildCustomSkinConfig(item));
  } catch {
    return [];
  }
}

/**
 * Persists a custom skin into localStorage list cleanly.
 * @param {any} skinConfig
 */
export function saveCustomSkinToStorage(skinConfig) {
  const built = buildCustomSkinConfig(skinConfig);
  const existing = loadSavedCustomSkins().filter((s) => s.id !== built.id);
  const next = [built, ...existing].slice(0, 20);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CUSTOM_SKINS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignore quota errors cleanly
  }
  return built;
}

/**
 * Renders custom pattern & headgear details directly inside renderCharacter().
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} skin
 * @param {number} time
 */
export function drawCustomSkinOverlay(ctx, skin, time = 0) {
  if (!skin || !skin.isCustom) return;
  const accent = skin.accent || skin.palette?.accent || '#FDE047';

  // Pattern clipped softly inside bean silhouette
  ctx.save();
  if (skin.pattern === 'spots') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.72;
    [
      [-7, -4, 3.2],
      [6, -7, 2.8],
      [-4, 8, 2.6],
      [7, 6, 3.4],
    ].forEach(([sx, sy, r]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    });
  } else if (skin.pattern === 'stripes') {
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 3;
    [-6, 2, 10].forEach((sy) => {
      ctx.beginPath();
      ctx.moveTo(-13, sy);
      ctx.lineTo(13, sy);
      ctx.stroke();
    });
  } else if (skin.pattern === 'gradient') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.42;
    ctx.beginPath();
    ctx.ellipse(0, 7, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (skin.pattern === 'starry') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    [
      [-6, 4],
      [7, -5],
      [2, 9],
    ].forEach(([sx, sy]) => {
      ctx.beginPath();
      ctx.arc(sx, sy, 2.1, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();

  // Headgear
  ctx.save();
  if (skin.headgear === 'crown') {
    ctx.fillStyle = accent;
    ctx.strokeStyle = '#2A233A';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-8, -15);
    ctx.lineTo(-9, -24);
    ctx.lineTo(-3, -19);
    ctx.lineTo(0, -26);
    ctx.lineTo(3, -19);
    ctx.lineTo(9, -24);
    ctx.lineTo(8, -15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (skin.headgear === 'headband') {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-14, -10);
    ctx.quadraticCurveTo(0, -16, 14, -10);
    ctx.stroke();
  } else if (skin.headgear === 'helmet') {
    ctx.fillStyle = 'rgba(147, 197, 253, 0.38)';
    ctx.strokeStyle = '#E0F2FE';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -3, 18.5, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();
    ctx.stroke();
  } else if (skin.headgear === 'leaf_sprout') {
    ctx.strokeStyle = '#14532D';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.quadraticCurveTo(2, -23, 6, -24);
    ctx.stroke();
    ctx.fillStyle = '#4ADE80';
    ctx.beginPath();
    ctx.ellipse(6, -25, 5, 2.8, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Aura ring behind/around actor
  if (skin.aura && skin.aura !== 'none') {
    ctx.globalAlpha = 0.42 + Math.sin(time * 4) * 0.14;
    ctx.strokeStyle = skin.aura === 'cosmic' ? '#38BDF8' : skin.aura === 'hearts' ? '#FB7185' : accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, 23, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function rgbToHex(r, g, b) {
  const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g)
    .toString(16)
    .padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`.toUpperCase();
}

function colorSaturationAndLum(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lum = (max + min) * 0.5;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * lum - 1));
  return { sat, lum };
}

/**
 * Pure pixel analyzer that turns any 2D character sprite / drawing RGBA buffer
 * into a synchronized custom character skin config (runs identically in Node tests & browser).
 * @param {Uint8ClampedArray | Uint8Array | number[]} rgbaBytes
 * @param {number} width
 * @param {number} height
 * @param {{ character?: string, name?: string }} [options]
 */
export function analyzeCharacterPixelsToSkin(rgbaBytes, width, height, options = {}) {
  const character = options.character === 'nadine' ? 'nadine' : 'madjid';
  const defaultBody = character === 'madjid' ? '#5E85E6' : '#E87BA6';
  const defaultAccent = '#FDE047';

  if (!rgbaBytes || width <= 0 || height <= 0 || rgbaBytes.length < width * height * 4) {
    return buildCustomSkinConfig({
      character,
      name: options.name || 'Imported Look',
      body: defaultBody,
      accent: defaultAccent,
      pattern: 'solid',
      headgear: 'none',
      aura: 'glimmer',
    });
  }

  // 1. Sample 2px border ring to detect uniform solid background color (for non-transparent PNG/JPGs)
  let borderCount = 0;
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let transparentEdgeCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x > 1 && x < width - 2 && y > 1 && y < height - 2) continue;
      const idx = (y * width + x) * 4;
      const a = rgbaBytes[idx + 3];
      if (a < 40) {
        transparentEdgeCount += 1;
      } else {
        bgR += rgbaBytes[idx];
        bgG += rgbaBytes[idx + 1];
        bgB += rgbaBytes[idx + 2];
        borderCount += 1;
      }
    }
  }
  const hasOpaqueBg = borderCount > transparentEdgeCount * 1.4 && borderCount > 0;
  const meanBgR = hasOpaqueBg ? bgR / borderCount : -1;
  const meanBgG = hasOpaqueBg ? bgG / borderCount : -1;
  const meanBgB = hasOpaqueBg ? bgB / borderCount : -1;

  // 2. Collect foreground pixels inside character silhouette bounding box
  let minY = height;
  let maxY = -1;
  const fgPixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rgbaBytes[idx];
      const g = rgbaBytes[idx + 1];
      const b = rgbaBytes[idx + 2];
      const a = rgbaBytes[idx + 3];
      if (a < 45) continue;
      if (hasOpaqueBg) {
        const dist = Math.abs(r - meanBgR) + Math.abs(g - meanBgG) + Math.abs(b - meanBgB);
        if (dist < 42) continue;
      }
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      fgPixels.push({ x, y, r, g, b });
    }
  }

  if (fgPixels.length === 0) {
    return buildCustomSkinConfig({
      character,
      name: options.name || 'Imported Look',
      body: defaultBody,
      accent: defaultAccent,
      pattern: 'gradient',
      headgear: 'none',
      aura: 'glimmer',
    });
  }

  // 3. Bucket colors (16-step quantization) in middle body band vs upper accent band
  const spanY = Math.max(1, maxY - minY);
  const midBuckets = new Map();
  const accentBuckets = new Map();
  const darkPixels = [];

  for (let i = 0; i < fgPixels.length; i++) {
    const p = fgPixels[i];
    const relY = (p.y - minY) / spanY;
    const { sat, lum } = colorSaturationAndLum(p.r, p.g, p.b);

    if (lum < 0.22) {
      darkPixels.push(p);
    }

    // Quantize to 24-unit buckets for dominant hue clustering
    const qr = Math.round(p.r / 24) * 24;
    const qg = Math.round(p.g / 24) * 24;
    const qb = Math.round(p.b / 24) * 24;
    const key = `${qr},${qg},${qb}`;

    // Middle-to-lower region (25%..85%) defines primary body color; skip near-black outlines if chromatic exists
    const isMidBand = relY >= 0.22 && relY <= 0.88;
    if (isMidBand && lum > 0.14 && lum < 0.94) {
      const weight = 1 + sat * 2.2;
      const cur = midBuckets.get(key) || { r: 0, g: 0, b: 0, score: 0, count: 0 };
      cur.r += p.r * weight;
      cur.g += p.g * weight;
      cur.b += p.b * weight;
      cur.score += weight;
      cur.count += 1;
      midBuckets.set(key, cur);
    }

    // Upper region (0%..35%) or high-chroma accents define headgear/accent/trail hue
    if ((relY <= 0.38 || sat > 0.45) && lum > 0.18 && lum < 0.96) {
      const weight = 1 + sat * 2.8 + (relY < 0.3 ? 0.9 : 0);
      const cur = accentBuckets.get(key) || { r: 0, g: 0, b: 0, score: 0, count: 0 };
      cur.r += p.r * weight;
      cur.g += p.g * weight;
      cur.b += p.b * weight;
      cur.score += weight;
      cur.count += 1;
      accentBuckets.set(key, cur);
    }
  }

  const pickBestBucket = (map, excludeHex = null) => {
    let best = null;
    map.forEach((entry) => {
      const hex = rgbToHex(entry.r / entry.score, entry.g / entry.score, entry.b / entry.score);
      if (excludeHex && hex === excludeHex) return;
      if (!best || entry.score > best.score) {
        best = { ...entry, hex };
      }
    });
    return best;
  };

  const bestBody = pickBestBucket(midBuckets) || pickBestBucket(accentBuckets);
  const bodyHex = bestBody ? bestBody.hex : defaultBody;

  // Pick distinct contrasting accent bucket
  let accentHex = defaultAccent;
  let bestAccentScore = -1;
  accentBuckets.forEach((entry) => {
    const r = entry.r / entry.score;
    const g = entry.g / entry.score;
    const b = entry.b / entry.score;
    const hex = rgbToHex(r, g, b);
    const bodyR = parseInt(bodyHex.slice(1, 3), 16);
    const bodyG = parseInt(bodyHex.slice(3, 5), 16);
    const bodyB = parseInt(bodyHex.slice(5, 7), 16);
    const colorDiff = Math.abs(r - bodyR) + Math.abs(g - bodyG) + Math.abs(b - bodyB);
    const score = entry.score * (0.4 + Math.min(1.8, colorDiff / 160));
    if (colorDiff > 75 && score > bestAccentScore) {
      bestAccentScore = score;
      accentHex = hex;
    }
  });
  if (bestAccentScore < 0) {
    accentHex = lightenHex(bodyHex, 0.45);
  }

  let outlineHex = darkenHex(bodyHex, 0.62);
  if (darkPixels.length >= 6) {
    let dr = 0;
    let dg = 0;
    let db = 0;
    for (let i = 0; i < darkPixels.length; i++) {
      dr += darkPixels[i].r;
      dg += darkPixels[i].g;
      db += darkPixels[i].b;
    }
    outlineHex = rgbToHex(dr / darkPixels.length, dg / darkPixels.length, db / darkPixels.length);
  }

  // Derive tasteful pattern & headgear hints from silhouette variety & top height
  const distinctColorBuckets = midBuckets.size;
  const pattern =
    distinctColorBuckets >= 6
      ? 'starry'
      : distinctColorBuckets >= 4
        ? 'spots'
        : distinctColorBuckets >= 3
          ? 'stripes'
          : 'gradient';
  const topRelPixels = fgPixels.filter((p) => (p.y - minY) / spanY < 0.16).length;
  const headgear = topRelPixels > fgPixels.length * 0.08 ? 'crown' : 'headband';

  return buildCustomSkinConfig({
    character,
    name: options.name || 'Scanned Character',
    body: bodyHex,
    bodyDark: darkenHex(bodyHex, 0.24),
    outline: outlineHex,
    accent: accentHex,
    trail: accentHex,
    pattern,
    headgear,
    aura: 'glimmer',
  });
}

/**
 * Browser helper: loads a user-uploaded 2D character File/Blob/HTMLImageElement
 * onto an offscreen canvas and runs pixel-to-skin extraction cleanly.
 * @param {Blob | HTMLImageElement} source
 * @param {{ character?: string, name?: string }} [options]
 */
export async function analyzeImageFileToSkin(source, options = {}) {
  if (typeof document === 'undefined' || !source) {
    throw new Error('Image analysis requires a browser canvas environment.');
  }

  const loadImage = () =>
    new Promise((resolve, reject) => {
      if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
        if (source.complete && source.naturalWidth > 0) {
          resolve(source);
          return;
        }
      }
      const url = typeof URL !== 'undefined' && source instanceof Blob ? URL.createObjectURL(source) : null;
      const img = new Image();
      img.onload = () => {
        if (url) URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        if (url) URL.revokeObjectURL(url);
        reject(new Error('Could not decode character image.'));
      };
      img.src = url || '';
    });

  const img = await loadImage();
  const sampleSize = 96;
  const offscreen = document.createElement('canvas');
  offscreen.width = sampleSize;
  offscreen.height = sampleSize;
  const octx = offscreen.getContext('2d');
  if (!octx) {
    throw new Error('Could not create offscreen canvas context.');
  }
  octx.clearRect(0, 0, sampleSize, sampleSize);
  octx.drawImage(img, 0, 0, sampleSize, sampleSize);
  const imageData = octx.getImageData(0, 0, sampleSize, sampleSize);
  const baseName =
    options.name ||
    (source && typeof source === 'object' && 'name' in source && typeof source.name === 'string'
      ? source.name.replace(/\.[^.]+$/, '').slice(0, 20)
      : 'Photo Skin');
  return analyzeCharacterPixelsToSkin(imageData.data, sampleSize, sampleSize, {
    character: options.character,
    name: baseName,
  });
}

