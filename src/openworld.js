/**
 * src/openworld.js
 * Decoupled 2D Open-World Sandbox & Crafting Mode for "Around the World with Nadine".
 * Works seamlessly in both Solo and Online 2-Player Co-op Mode, plugging directly into
 * the existing 60+ FPS physics, skins, atmosphere, and SFX engines.
 */

export const OPEN_WORLD_CONFIG = {
  TILE_SIZE: 40,
  WORLD_WIDTH: 2400,
  WORLD_HEIGHT: 720,
  GROUND_Y: 600,
  MIN_BUILD_ROW: 3, // y >= 120
  MAX_BUILD_ROW: 14, // y <= 560 (flush on top of y = 600 ground)
  MAX_COLS: 60, // 60 * 40 = 2400
};

export const OPEN_WORLD_BLOCKS = {
  wood: {
    id: 'wood',
    name: 'Timber',
    solid: true,
    color: '#B57B4C',
    topColor: '#D69D6C',
    trimColor: '#4A2E1B',
    starterCount: 16,
  },
  stone: {
    id: 'stone',
    name: 'Cobble',
    solid: true,
    color: '#777C96',
    topColor: '#9EA4BF',
    trimColor: '#2E3145',
    starterCount: 14,
  },
  bridge: {
    id: 'bridge',
    name: 'Sky Bridge',
    solid: true,
    color: '#D89F63',
    topColor: '#F7CC94',
    trimColor: '#4B2F1D',
    starterCount: 6,
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern',
    solid: false,
    color: '#FFE08A',
    topColor: '#FFF7D1',
    trimColor: '#362945',
    starterCount: 4,
  },
  flower: {
    id: 'flower',
    name: 'Blossom',
    solid: false,
    color: '#F59BB2',
    topColor: '#FFF2B8',
    trimColor: '#3E6E4C',
    starterCount: 6,
  },
  arch: {
    id: 'arch',
    name: 'Love Arch',
    solid: false,
    color: '#FFF4EB',
    topColor: '#F48CA8',
    trimColor: '#4B2C3E',
    starterCount: 1,
  },
};

export const CRAFT_RECIPES = [
  {
    id: 'craft_bridge',
    name: 'Sky Bridge ×3',
    output: { type: 'bridge', count: 3 },
    cost: { wood: 2, stone: 1 },
  },
  {
    id: 'craft_lantern',
    name: 'Warm Lantern ×2',
    output: { type: 'lantern', count: 2 },
    cost: { wood: 1, stone: 1 },
  },
  {
    id: 'craft_flower',
    name: 'Blossom Box ×3',
    output: { type: 'flower', count: 3 },
    cost: { wood: 1 },
  },
  {
    id: 'craft_arch',
    name: 'Wedding Arch ×1',
    output: { type: 'arch', count: 1 },
    cost: { wood: 2, stone: 2, flower: 2 },
  },
];

/**
 * @returns {Record<string, number>}
 */
export function createStarterInventory() {
  /** @type {Record<string, number>} */
  const inv = {};
  Object.values(OPEN_WORLD_BLOCKS).forEach((b) => {
    inv[b.id] = b.starterCount;
  });
  return inv;
}

export function createStarterOpenWorldBlocks() {
  // Cozy starter meadow outpost so both players arrive in an inviting buildable world
  return [
    { gx: 9, gy: 14, type: 'wood' },
    { gx: 10, gy: 14, type: 'wood' },
    { gx: 11, gy: 14, type: 'wood' },
    { gx: 10, gy: 13, type: 'lantern' },
    { gx: 13, gy: 14, type: 'flower' },
    { gx: 16, gy: 13, type: 'bridge' },
    { gx: 17, gy: 13, type: 'bridge' },
    { gx: 18, gy: 13, type: 'bridge' },
    { gx: 22, gy: 14, type: 'stone' },
    { gx: 23, gy: 14, type: 'stone' },
    { gx: 24, gy: 14, type: 'lantern' },
    { gx: 26, gy: 14, type: 'flower' },
  ];
}

export function blockKey(gx, gy) {
  return `${gx},${gy}`;
}

export function isValidBlockCoord(gx, gy) {
  return (
    Number.isInteger(gx) &&
    Number.isInteger(gy) &&
    gx >= 1 &&
    gx < OPEN_WORLD_CONFIG.MAX_COLS - 1 &&
    gy >= OPEN_WORLD_CONFIG.MIN_BUILD_ROW &&
    gy <= OPEN_WORLD_CONFIG.MAX_BUILD_ROW
  );
}

/**
 * Returns a level definition compatible with createInitialLevelState() for the 2D Open-World Mode.
 */
export function createOpenWorldLevelDefinition(theme = 'sunrise') {
  const w = OPEN_WORLD_CONFIG.WORLD_WIDTH;
  const h = OPEN_WORLD_CONFIG.WORLD_HEIGHT;
  return {
    id: 0,
    worldId: 0,
    stageInWorld: 0,
    code: 'OW',
    chapterLabel: '2D Open-World Sandbox',
    shortCode: 'Open World',
    worldName: 'Wanderer Valley',
    title: 'Cozy Open-World Meadow',
    caption:
      'Explore, build cottages & sky bridges, craft lanterns together, and switch skies anytime—everything syncs live in Co-op Mode.',
    theme,
    landmark: theme === 'night' ? 'gazebos' : theme === 'sunset' ? 'windmills' : 'cottages',
    ambient: theme === 'night' ? 'fireflies' : 'petals',
    worldWidth: w,
    worldHeight: h,
    spawns: {
      madjid: { x: 180, y: 564 },
      nadine: { x: 232, y: 564 },
    },
    platforms: [
      { x: 0, y: OPEN_WORLD_CONFIG.GROUND_Y, w, h: 120, kind: 'ground' },
      { x: 520, y: 468, w: 180, h: 24, kind: 'ledge' },
      { x: 1120, y: 452, w: 220, h: 24, kind: 'ledge' },
      { x: 1680, y: 484, w: 200, h: 24, kind: 'ledge' },
    ],
    switches: [],
    movingPlatforms: [],
    gates: [],
    keys: [],
    checkpoints: [
      { id: 'ow_cp_1', x: 1230, y: OPEN_WORLD_CONFIG.GROUND_Y },
    ],
    hazards: [],
    enemies: [],
    exit: {
      x: -500,
      y: -500,
      w: 0,
      h: 0,
      keysRequired: 99,
      hidden: true,
    },
    decorations: [
      { type: 'signpost', x: 130, y: OPEN_WORLD_CONFIG.GROUND_Y },
      { type: 'flowers', x: 310, y: OPEN_WORLD_CONFIG.GROUND_Y },
      { type: 'lantern', x: 860, y: OPEN_WORLD_CONFIG.GROUND_Y },
      { type: 'flowers', x: 1510, y: OPEN_WORLD_CONFIG.GROUND_Y },
      { type: 'lantern', x: 1960, y: OPEN_WORLD_CONFIG.GROUND_Y },
    ],
    isOpenWorld: true,
  };
}

/**
 * @param {Array<{ gx: number, gy: number, type: string }> | null} [initialBlocks]
 * @param {Record<string, number> | null} [initialInventory]
 * @param {string} [theme]
 */
export function createOpenWorldState(initialBlocks = null, initialInventory = null, theme = 'sunrise') {
  const blocks = new Map();
  const seed = Array.isArray(initialBlocks) ? initialBlocks : createStarterOpenWorldBlocks();
  for (let i = 0; i < seed.length; i++) {
    const b = seed[i];
    if (isValidBlockCoord(b.gx, b.gy) && OPEN_WORLD_BLOCKS[b.type]) {
      blocks.set(blockKey(b.gx, b.gy), { gx: b.gx, gy: b.gy, type: b.type });
    }
  }
  const inventory = initialInventory ? { ...createStarterInventory(), ...initialInventory } : createStarterInventory();
  return {
    theme,
    blocks,
    inventory,
    craftedTotal: 0,
  };
}

export function serializeOpenWorldState(owState) {
  return {
    theme: owState.theme,
    blocks: Array.from(owState.blocks.values()),
    inventory: { ...owState.inventory },
    craftedTotal: owState.craftedTotal,
  };
}

export function placeOpenWorldBlock(owState, gx, gy, type, { consumeInventory = true } = {}) {
  if (!isValidBlockCoord(gx, gy)) return { ok: false, reason: 'OUT_OF_BOUNDS' };
  const def = OPEN_WORLD_BLOCKS[type];
  if (!def) return { ok: false, reason: 'INVALID_BLOCK' };

  const key = blockKey(gx, gy);
  const existing = owState.blocks.get(key);
  if (existing && existing.type === type) {
    return { ok: true, idempotent: true, block: existing };
  }

  if (consumeInventory) {
    const avail = owState.inventory[type] || 0;
    if (avail <= 0) return { ok: false, reason: 'NO_MATERIAL' };
    owState.inventory[type] = avail - 1;
    if (existing) {
      owState.inventory[existing.type] = (owState.inventory[existing.type] || 0) + 1;
    }
  }

  const block = { gx, gy, type };
  owState.blocks.set(key, block);
  return { ok: true, block };
}

export function removeOpenWorldBlock(owState, gx, gy, { refundInventory = true } = {}) {
  const key = blockKey(gx, gy);
  const existing = owState.blocks.get(key);
  if (!existing) return { ok: true, idempotent: true, removed: null };
  owState.blocks.delete(key);
  if (refundInventory) {
    owState.inventory[existing.type] = (owState.inventory[existing.type] || 0) + 1;
  }
  return { ok: true, removed: existing };
}

export function canCraftRecipe(inventory, recipeId) {
  const recipe = CRAFT_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return false;
  return Object.entries(recipe.cost).every(([mat, needed]) => (inventory[mat] || 0) >= needed);
}

export function craftOpenWorldItem(owState, recipeId) {
  const recipe = CRAFT_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { ok: false, reason: 'INVALID_RECIPE' };
  if (!canCraftRecipe(owState.inventory, recipeId)) {
    return { ok: false, reason: 'INSUFFICIENT_MATERIALS' };
  }
  Object.entries(recipe.cost).forEach(([mat, needed]) => {
    owState.inventory[mat] = Math.max(0, (owState.inventory[mat] || 0) - needed);
  });
  owState.inventory[recipe.output.type] =
    (owState.inventory[recipe.output.type] || 0) + recipe.output.count;
  owState.craftedTotal += 1;
  return { ok: true, recipe, inventory: { ...owState.inventory } };
}

/**
 * Converts solid open-world blocks into collision platform rectangles appended to base static platforms.
 */
export function buildOpenWorldSolidPlatforms(basePlatforms, owState) {
  const size = OPEN_WORLD_CONFIG.TILE_SIZE;
  const result = basePlatforms.map((p) => ({ ...p }));
  owState.blocks.forEach((b) => {
    const def = OPEN_WORLD_BLOCKS[b.type];
    if (!def || !def.solid) return;
    result.push({
      x: b.gx * size,
      y: b.gy * size,
      w: size,
      h: b.type === 'bridge' ? 16 : size,
      kind: 'openworld_block',
      blockType: b.type,
    });
  });
  return result;
}

/**
 * Renders all placed open-world blocks (solid timber/cobble/sky-bridges + decorative lanterns/blossoms/arches)
 * and a soft cursor hover outline when aiming to build.
 */
export function renderOpenWorldBlocks(ctx, owState, time, hoverCell = null, selectedType = 'wood') {
  const size = OPEN_WORLD_CONFIG.TILE_SIZE;

  owState.blocks.forEach((b) => {
    const x = b.gx * size;
    const y = b.gy * size;
    const def = OPEN_WORLD_BLOCKS[b.type];
    if (!def) return;

    ctx.save();
    if (b.type === 'wood' || b.type === 'stone') {
      ctx.fillStyle = def.color;
      ctx.strokeStyle = def.trimColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, size - 2, size - 2, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = def.topColor;
      ctx.beginPath();
      ctx.roundRect(x + 3, y + 3, size - 6, 8, 3);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 1.4;
      if (b.type === 'wood') {
        ctx.beginPath();
        ctx.moveTo(x + 6, y + 19);
        ctx.lineTo(x + size - 6, y + 19);
        ctx.moveTo(x + 6, y + 29);
        ctx.lineTo(x + size - 6, y + 29);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x + size * 0.5, y + 12);
        ctx.lineTo(x + size * 0.5, y + size - 4);
        ctx.moveTo(x + 6, y + 24);
        ctx.lineTo(x + size - 6, y + 24);
        ctx.stroke();
      }
    } else if (b.type === 'bridge') {
      ctx.fillStyle = def.color;
      ctx.strokeStyle = def.trimColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(x, y + 1, size, 15, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = def.topColor;
      ctx.fillRect(x + 3, y + 3, size - 6, 4);

      ctx.strokeStyle = 'rgba(75, 47, 29, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 13, y + 2);
      ctx.lineTo(x + 13, y + 15);
      ctx.moveTo(x + 27, y + 2);
      ctx.lineTo(x + 27, y + 15);
      ctx.stroke();
    } else if (b.type === 'lantern') {
      const cx = x + size * 0.5;
      const pulse = 0.92 + Math.sin(time * 4 + b.gx) * 0.08;
      ctx.fillStyle = 'rgba(255, 224, 128, 0.16)';
      ctx.beginPath();
      ctx.arc(cx, y + 16, 32 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 240, 178, 0.28)';
      ctx.beginPath();
      ctx.arc(cx, y + 16, 17 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#2B223D';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, y + size);
      ctx.lineTo(cx, y + 24);
      ctx.stroke();

      ctx.fillStyle = '#FFE496';
      ctx.strokeStyle = '#241B35';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(cx - 8, y + 8, 16, 18, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFDF2';
      ctx.beginPath();
      ctx.arc(cx, y + 17, 3.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.type === 'flower') {
      const petals = ['#F59BB2', '#FFF2B8', '#9AD9F7'];
      for (let i = 0; i < 3; i++) {
        const fx = x + 9 + i * 11;
        const sway = Math.sin(time * 3 + i + b.gx) * 2;
        ctx.strokeStyle = '#4B8A5B';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(fx, y + size);
        ctx.quadraticCurveTo(fx + sway, y + size - 11, fx + sway, y + size - 20);
        ctx.stroke();
        ctx.fillStyle = petals[i];
        ctx.strokeStyle = '#2D223B';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(fx + sway, y + size - 22, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (b.type === 'arch') {
      const cx = x + size * 0.5;
      ctx.strokeStyle = '#FFF5EB';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - 16, y + size);
      ctx.lineTo(cx - 16, y + 8);
      ctx.arc(cx, y + 8, 16, Math.PI, 0);
      ctx.lineTo(cx + 16, y + size);
      ctx.stroke();

      ctx.strokeStyle = '#4B2C3E';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      [
        [cx - 13, y + 4, '#F59BB2'],
        [cx, y - 8, '#FFE394'],
        [cx + 13, y + 4, '#F59BB2'],
      ].forEach(([fx, fy, c]) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(fx, fy, 4.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  });

  // Crisp placement preview cell outline when hovering canvas in Open-World Mode
  if (hoverCell && isValidBlockCoord(hoverCell.gx, hoverCell.gy)) {
    const x = hoverCell.gx * size;
    const y = hoverCell.gy * size;
    const occupied = owState.blocks.has(blockKey(hoverCell.gx, hoverCell.gy));
    const def = OPEN_WORLD_BLOCKS[selectedType];
    ctx.save();
    ctx.strokeStyle = occupied ? 'rgba(248, 113, 113, 0.88)' : 'rgba(255, 240, 178, 0.85)';
    ctx.fillStyle = occupied ? 'rgba(248, 113, 113, 0.14)' : 'rgba(255, 240, 178, 0.14)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, size - 4, def && selectedType === 'bridge' && !occupied ? 16 : size - 4, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
