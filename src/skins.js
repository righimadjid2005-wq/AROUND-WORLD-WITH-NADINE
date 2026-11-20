/**
 * src/skins.js
 * Modular Character Visuals & Skin Registry for "Around the World with Nadine".
 * Strictly decoupled from physics, collision, input, and level state.
 * Supports expressive moods: 'normal', 'happy', 'kissing', 'crying', 'worried'.
 */

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

function drawTravelScarfBack(ctx, state) {
  const { palette, time, vx, vy, facing } = state;
  const flutter = Math.sin(time * 9 + Math.abs(vx) * 0.03) * (2.5 + Math.min(4, Math.abs(vx) * 0.02));
  const tailDir = -facing;
  const dragX = clamp(-vx * 0.045, -10, 10);
  const dragY = clamp(-vy * 0.018, -5, 6);

  ctx.save();
  ctx.translate(0, 2);
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(tailDir * 8, 2);
  ctx.quadraticCurveTo(
    tailDir * 18 + dragX * 0.6,
    4 + flutter * 0.5 + dragY * 0.4,
    tailDir * 23 + dragX,
    9 + flutter + dragY
  );
  ctx.lineTo(tailDir * 19 + dragX, 15 + flutter + dragY);
  ctx.quadraticCurveTo(
    tailDir * 13 + dragX * 0.4,
    10 + flutter * 0.4,
    tailDir * 5,
    8
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = palette.accentAlt;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tailDir * 17 + dragX * 0.85, 8 + flutter * 0.85 + dragY * 0.85);
  ctx.lineTo(tailDir * 15 + dragX * 0.85, 13 + flutter * 0.85 + dragY * 0.85);
  ctx.stroke();
  ctx.restore();
}

function drawTravelScarfFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.translate(0, 9.2);
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.9;

  ctx.beginPath();
  ctx.roundRect(-13.5, -2, 27, 5.4, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.accentAlt;
  ctx.beginPath();
  ctx.arc(facing * 5.8, 0.7, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLeafSproutFront(ctx, state) {
  const { palette, time, vx } = state;
  const sway = Math.sin(time * 4.5) * 0.14 + clamp(-vx * 0.0012, -0.35, 0.35);

  ctx.save();
  ctx.translate(0, -17);
  ctx.rotate(sway);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.quadraticCurveTo(0, -5, 1, -10);
  ctx.stroke();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.ellipse(-6, -10, 6.5, 3.6, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.accentAlt;
  ctx.beginPath();
  ctx.ellipse(7, -11, 5.8, 3.3, 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawExplorerGogglesFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.translate(facing * 1.5, -13);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.roundRect(-14, -2.5, 28, 5, 2.5);
  ctx.fill();
  ctx.stroke();

  [-5.5, 5.5].forEach((gx) => {
    ctx.fillStyle = palette.accentAlt;
    ctx.beginPath();
    ctx.arc(gx, 0, 4.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#D9F4FF';
    ctx.beginPath();
    ctx.arc(gx, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(gx - 1, -1, 1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawStarBeretFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.translate(facing * -1, -16);
  ctx.rotate(facing * -0.14);

  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.ellipse(0, 0, 14, 6.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(1, -9);
  ctx.stroke();

  ctx.fillStyle = palette.accentAlt;
  ctx.beginPath();
  ctx.arc(facing * 5, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWeddingGroomFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.save();
  ctx.translate(facing * -1, -17);
  ctx.rotate(facing * -0.12);
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.roundRect(-12, -2, 24, 4, 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(-8, -12, 16, 11, 2.5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.accentAlt;
  ctx.fillRect(-7.2, -4.5, 14.4, 2.8);
  ctx.restore();

  ctx.translate(0, 9);
  ctx.fillStyle = palette.accentAlt;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-6, -3.5);
  ctx.lineTo(-6, 3.5);
  ctx.closePath();
  ctx.moveTo(0, 0);
  ctx.lineTo(6, -3.5);
  ctx.lineTo(6, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRibbonBowFront(ctx, state) {
  const { palette, time, vy, facing } = state;
  const bounce = clamp(vy * 0.004, -2.5, 2.5) + Math.sin(time * 5) * 0.5;

  ctx.save();
  ctx.translate(facing * -3, -16 + bounce * 0.4);
  ctx.rotate(facing * -0.15);
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.ellipse(-6.5, -1, 6.2, 4.2, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(6.5, -1, 6.2, 4.2, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.accentAlt;
  ctx.beginPath();
  ctx.arc(0, -1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDaisyFlowerFront(ctx, state) {
  const { palette, time, facing } = state;
  const nod = Math.sin(time * 4) * 0.1;

  ctx.save();
  ctx.translate(facing * -9, -13);
  ctx.rotate(nod);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.6;

  ctx.fillStyle = '#FFFDF5';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 4.6, Math.sin(a) * 4.6, 3.2, 2.1, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTwilightRibbonBack(ctx, state) {
  const { palette, time, vx, vy, facing } = state;
  const flutter = Math.sin(time * 8) * 3;
  const dir = -facing;
  const dragX = clamp(-vx * 0.04, -9, 9);
  const dragY = clamp(-vy * 0.02, -4, 5);

  ctx.save();
  ctx.translate(dir * 9, -8);
  ctx.strokeStyle = palette.outline;
  ctx.fillStyle = palette.accent;
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(dir * 9 + dragX * 0.5, 2 + flutter * 0.5, dir * 15 + dragX, 8 + flutter + dragY);
  ctx.lineTo(dir * 12 + dragX, 12 + flutter + dragY);
  ctx.quadraticCurveTo(dir * 7 + dragX * 0.4, 7 + flutter * 0.4, -dir * 1, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTwilightStarPinFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.translate(facing * -7, -14);
  ctx.fillStyle = palette.accentAlt;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 6 : 2.5;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawShellCombFront(ctx, state) {
  const { palette, facing } = state;
  ctx.save();
  ctx.translate(facing * -7, -14);
  ctx.rotate(facing * -0.35);
  ctx.fillStyle = palette.accent;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  ctx.arc(0, 1, 6.8, Math.PI, 0);
  ctx.lineTo(4, 3);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FFF9F0';
  ctx.beginPath();
  ctx.arc(0, -1, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBridalVeilBack(ctx, state) {
  const { time, vx, vy, facing } = state;
  const wave = Math.sin(time * 5.5) * 3.5;
  const dir = -facing;
  const dragX = clamp(-vx * 0.055, -13, 13);
  const dragY = clamp(-vy * 0.02, -5, 6);

  ctx.save();
  ctx.translate(0, -15);
  ctx.fillStyle = 'rgba(255, 250, 252, 0.72)';
  ctx.strokeStyle = 'rgba(226, 200, 214, 0.9)';
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.quadraticCurveTo(dir * 16 + dragX * 0.6, 4 + wave * 0.4, dir * 24 + dragX, 22 + wave + dragY);
  ctx.quadraticCurveTo(dir * 12 + dragX * 0.5, 27 + wave * 0.5 + dragY, dir * 4 + dragX * 0.2, 23 + dragY * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBridalCrownFront(ctx, state) {
  const { palette } = state;
  ctx.save();
  ctx.translate(0, -16);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 1.6;

  const blossoms = [
    { x: -8, y: 1.5, c: '#FFFDF8' },
    { x: -3, y: -0.8, c: palette.accent },
    { x: 3, y: -0.8, c: '#FFFDF8' },
    { x: 8, y: 1.5, c: palette.accentAlt },
  ];
  blossoms.forEach((b) => {
    ctx.fillStyle = b.c;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

/**
 * Modular skin registry.
 * Add new skins at runtime via registerSkin() without modifying physics or game code.
 */
export const SKINS = {
  madjid: [
    {
      id: 'traveler-azure',
      character: 'madjid',
      name: 'Sky Traveler',
      tagline: 'Cerulean coat & crimson scarf',
      palette: {
        body: '#52A5E8',
        bodyDark: '#3A82C4',
        belly: '#8BC9F7',
        outline: '#1E334F',
        highlight: 'rgba(255, 255, 255, 0.58)',
        cheek: 'rgba(255, 133, 148, 0.55)',
        spot: 'rgba(255, 255, 255, 0.28)',
        accent: '#E2555E',
        accentAlt: '#F8D476',
        eyeWhite: '#FFFFFF',
        pupil: '#1A2438',
        trail: '#7AC2FA',
      },
      drawBack: drawTravelScarfBack,
      drawFront: drawTravelScarfFront,
    },
    {
      id: 'meadow-sage',
      character: 'madjid',
      name: 'Village Sprout',
      tagline: 'Soft moss & swaying leaves',
      palette: {
        body: '#5BB585',
        bodyDark: '#3F9266',
        belly: '#95DAB3',
        outline: '#1E3C2D',
        highlight: 'rgba(255, 255, 255, 0.55)',
        cheek: 'rgba(255, 140, 148, 0.55)',
        spot: 'rgba(255, 255, 255, 0.28)',
        accent: '#86D673',
        accentAlt: '#C9EB8D',
        eyeWhite: '#FFFFFF',
        pupil: '#1B2D23',
        trail: '#84D9A7',
      },
      drawBack: null,
      drawFront: drawLeafSproutFront,
    },
    {
      id: 'sunset-amber',
      character: 'madjid',
      name: 'Horizon Nomad',
      tagline: 'Warm ochre & brass goggles',
      palette: {
        body: '#E89B4C',
        bodyDark: '#C9782C',
        belly: '#F7C488',
        outline: '#452815',
        highlight: 'rgba(255, 255, 255, 0.55)',
        cheek: 'rgba(240, 108, 108, 0.55)',
        spot: 'rgba(255, 245, 224, 0.32)',
        accent: '#7A482B',
        accentAlt: '#F5CB69',
        eyeWhite: '#FFFFFF',
        pupil: '#2E1A10',
        trail: '#F5BC76',
      },
      drawBack: null,
      drawFront: drawExplorerGogglesFront,
    },
    {
      id: 'starlight-indigo',
      character: 'madjid',
      name: 'Night Stargazer',
      tagline: 'Twilight indigo & star beret',
      palette: {
        body: '#6A78CC',
        bodyDark: '#4D59A8',
        belly: '#9DA9EB',
        outline: '#1F2347',
        highlight: 'rgba(255, 255, 255, 0.52)',
        cheek: 'rgba(247, 138, 175, 0.52)',
        spot: 'rgba(255, 244, 194, 0.35)',
        accent: '#37407A',
        accentAlt: '#FDE07D',
        eyeWhite: '#FFFFFF',
        pupil: '#161A36',
        trail: '#99A6F2',
      },
      drawBack: null,
      drawFront: drawStarBeretFront,
    },
    {
      id: 'groom-ivory',
      character: 'madjid',
      name: 'Wedding Suit',
      tagline: 'Dapper slate & burgundy bowtie',
      palette: {
        body: '#6B88AD',
        bodyDark: '#4F6A8C',
        belly: '#EBF2FA',
        outline: '#1D293B',
        highlight: 'rgba(255, 255, 255, 0.58)',
        cheek: 'rgba(245, 138, 152, 0.55)',
        spot: 'rgba(255, 255, 255, 0.3)',
        accent: '#2A3548',
        accentAlt: '#C94458',
        eyeWhite: '#FFFFFF',
        pupil: '#182130',
        trail: '#A9C2E0',
      },
      drawBack: null,
      drawFront: drawWeddingGroomFront,
    },
  ],
  nadine: [
    {
      id: 'blossom-rose',
      character: 'nadine',
      name: 'Rose Wanderer',
      tagline: 'Warm rose & fluttering bow',
      palette: {
        body: '#F07F9A',
        bodyDark: '#D15B78',
        belly: '#FBB4C5',
        outline: '#4A1F2E',
        highlight: 'rgba(255, 255, 255, 0.6)',
        cheek: 'rgba(255, 92, 122, 0.5)',
        spot: 'rgba(255, 245, 248, 0.34)',
        accent: '#FFF2B8',
        accentAlt: '#F4A950',
        eyeWhite: '#FFFFFF',
        pupil: '#2E1420',
        trail: '#FAADC0',
      },
      drawBack: null,
      drawFront: drawRibbonBowFront,
    },
    {
      id: 'sunflower-gold',
      character: 'nadine',
      name: 'Sunlit Petal',
      tagline: 'Honey gold & meadow daisy',
      palette: {
        body: '#F2BC52',
        bodyDark: '#D1992E',
        belly: '#FCE09B',
        outline: '#4A3114',
        highlight: 'rgba(255, 255, 255, 0.58)',
        cheek: 'rgba(245, 114, 110, 0.52)',
        spot: 'rgba(255, 250, 232, 0.36)',
        accent: '#F08C3A',
        accentAlt: '#FFFDF5',
        eyeWhite: '#FFFFFF',
        pupil: '#33200D',
        trail: '#FAD682',
      },
      drawBack: null,
      drawFront: drawDaisyFlowerFront,
    },
    {
      id: 'lavender-mist',
      character: 'nadine',
      name: 'Twilight Ribbon',
      tagline: 'Soft lavender & star hairpin',
      palette: {
        body: '#A389DE',
        bodyDark: '#7F64BD',
        belly: '#CEBFF2',
        outline: '#2D214A',
        highlight: 'rgba(255, 255, 255, 0.58)',
        cheek: 'rgba(247, 130, 174, 0.52)',
        spot: 'rgba(255, 250, 255, 0.32)',
        accent: '#E88EB8',
        accentAlt: '#FFE285',
        eyeWhite: '#FFFFFF',
        pupil: '#22173B',
        trail: '#C7B4F5',
      },
      drawBack: drawTwilightRibbonBack,
      drawFront: drawTwilightStarPinFront,
    },
    {
      id: 'ocean-mint',
      character: 'nadine',
      name: 'Seafoam Pearl',
      tagline: 'Coastal mint & shell comb',
      palette: {
        body: '#4EC0B1',
        bodyDark: '#339C8E',
        belly: '#9AE4D9',
        outline: '#163D38',
        highlight: 'rgba(255, 255, 255, 0.6)',
        cheek: 'rgba(255, 136, 152, 0.5)',
        spot: 'rgba(255, 255, 255, 0.34)',
        accent: '#FAD1C3',
        accentAlt: '#FFF9F0',
        eyeWhite: '#FFFFFF',
        pupil: '#132E2B',
        trail: '#8CE0D4',
      },
      drawBack: null,
      drawFront: drawShellCombFront,
    },
    {
      id: 'bride-pearl',
      character: 'nadine',
      name: 'Wedding Veil',
      tagline: 'Blush pearl & lace veil',
      palette: {
        body: '#F5A5B9',
        bodyDark: '#D98097',
        belly: '#FFF5F8',
        outline: '#4D2735',
        highlight: 'rgba(255, 255, 255, 0.68)',
        cheek: 'rgba(255, 114, 146, 0.5)',
        spot: 'rgba(255, 255, 255, 0.42)',
        accent: '#FFD4DF',
        accentAlt: '#FBE08C',
        eyeWhite: '#FFFFFF',
        pupil: '#331A24',
        trail: '#FFE0E9',
      },
      drawBack: drawBridalVeilBack,
      drawFront: drawBridalCrownFront,
    },
  ],
};

export function getDefaultSkinId(characterId) {
  const list = SKINS[characterId];
  return list && list.length > 0 ? list[0].id : 'traveler-azure';
}

export function getSkinsForCharacter(characterId) {
  return SKINS[characterId] ? [...SKINS[characterId]] : [];
}

export function getSkin(characterId, skinId) {
  const list = SKINS[characterId] || [];
  return list.find((s) => s.id === skinId) || list[0];
}

export function registerSkin(skinDef) {
  if (!skinDef || !skinDef.character || !skinDef.id || !skinDef.palette) {
    throw new Error('Skin definition requires character, id, and palette.');
  }
  if (!SKINS[skinDef.character]) {
    SKINS[skinDef.character] = [];
  }
  const idx = SKINS[skinDef.character].findIndex((s) => s.id === skinDef.id);
  if (idx >= 0) {
    SKINS[skinDef.character][idx] = skinDef;
  } else {
    SKINS[skinDef.character].push(skinDef);
  }
  return skinDef;
}

/**
 * Renders a cute, expressive, squash-and-stretch blob character using its assigned skin.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} actor - Plain actor state snapshot (x, y, w, h, vx, vy, facing, grounded, scaleX, scaleY, walkDist, blinkTimer, inPortal, hurtTimer, invulnTimer, kissLean, mood)
 * @param {object} skin - Skin definition from SKINS
 * @param {number} time - Elapsed seconds
 * @param {object} options - { isActive, partnerPos, showIndicator }
 */
export function renderCharacter(ctx, actor, skin, time, options = {}) {
  const { isActive = false, partnerPos = null, showIndicator = true } = options;
  const palette = skin.palette;

  const isCrying = (actor.hurtTimer ?? 0) > 0;
  const isShocked = actor.mood === 'shocked';
  const isPanic = actor.mood === 'panic';
  const isCarried = Boolean(actor.carriedBy);
  const isKissing = actor.mood === 'kissing';
  const isBlushing = (actor.blushTimer ?? 0) > 0;
  const isWorried = actor.mood === 'worried' && !isCrying && !isShocked;
  const isHappy = !!actor.inPortal || actor.mood === 'happy' || isBlushing || Boolean(actor.danceStyle);
  const invulnFlash = (actor.invulnTimer ?? 0) > 0 && Math.floor(time * 16) % 2 === 0;

  const cx = actor.x + actor.w * 0.5;
  const bottomY = actor.y + actor.h;
  const idleBreath =
    actor.grounded && Math.abs(actor.vx || 0) < 12 && !isCrying && !isShocked
      ? Math.sin(time * 3.4 + (actor.id === 'nadine' ? 1.4 : 0))
      : 0;
  const cryTrembleX = isShocked ? Math.sin(time * 68) * 3.2 : isCrying ? Math.sin(time * 42) * 1.8 : 0;

  // Dance kinetic offsets (purely visual)
  let danceOffsetX = 0;
  let danceOffsetY = 0;
  let danceRot = 0;
  let danceSx = 1;
  let danceSy = 1;
  if (actor.danceStyle && !isCrying && !isShocked && !isPanic) {
    const dp = time * (actor.danceTempo || 6.5);
    switch (actor.danceStyle) {
      case 'waltz':
        danceOffsetX = Math.sin(dp * 0.5) * 4;
        danceRot = Math.sin(dp * 0.5) * 0.14;
        danceOffsetY = Math.abs(Math.cos(dp * 0.5)) * 4;
        break;
      case 'hop':
        danceOffsetY = Math.abs(Math.sin(dp * 1.1)) * 10;
        danceSy = 1 + Math.sin(dp * 2.2) * 0.08;
        danceSx = 1 - Math.sin(dp * 2.2) * 0.06;
        break;
      case 'disco':
        danceRot = Math.sin(dp) * 0.18;
        danceOffsetY = Math.abs(Math.sin(dp * 1.2)) * 5;
        break;
      case 'moonwalk':
        danceOffsetX = Math.sin(dp * 0.8) * 6;
        danceRot = -0.1 * (actor.facing || 1);
        break;
      case 'spin':
        danceSx = Math.cos(dp * 1.4) * 0.92;
        if (Math.abs(danceSx) < 0.25) danceSx = danceSx >= 0 ? 0.25 : -0.25;
        danceOffsetY = Math.abs(Math.sin(dp)) * 5;
        break;
      case 'wave_arms':
        danceRot = Math.sin(dp * 1.3) * 0.12;
        danceOffsetY = Math.abs(Math.sin(dp)) * 3;
        break;
      case 'skip':
        danceOffsetY = Math.abs(Math.sin(dp * 1.4)) * 8;
        danceOffsetX = Math.sin(dp * 0.7) * 5;
        break;
      case 'celebrate':
      default:
        danceOffsetY = Math.abs(Math.sin(dp * 1.6)) * 12;
        danceRot = Math.sin(dp * 1.6) * 0.15;
        break;
    }
  }

  const sx = (actor.scaleX ?? 1) * (1 + idleBreath * 0.025) * danceSx;
  const sy = (actor.scaleY ?? 1) * (1 - idleBreath * 0.025) * danceSy;

  const walkPhase = (actor.walkDist ?? 0) * 0.14;
  const moving = Math.abs(actor.vx || 0) > 15 && actor.grounded && !isCrying;
  const hopBob = moving ? Math.abs(Math.sin(walkPhase)) * 2.4 : 0;
  const kissLeanAngle = (actor.kissLean ?? 0) + danceRot;

  ctx.save();
  if (invulnFlash) {
    ctx.globalAlpha = 0.62;
  }

  // Soft ground shadow / active glow halo
  if (actor.grounded && !isCarried) {
    ctx.save();
    ctx.fillStyle = 'rgba(18, 24, 42, 0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, bottomY + 1, 15 * Math.abs(sx), 4.2, 0, 0, Math.PI * 2);
    ctx.fill();

    if (isActive && showIndicator) {
      ctx.strokeStyle = 'rgba(255, 242, 178, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, bottomY + 1, 19 + Math.sin(time * 5) * 1.5, 5.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Anchor squash, stretch, and gentle kiss/dance lean cleanly at feet
  ctx.translate(cx + cryTrembleX + danceOffsetX, bottomY - hopBob - danceOffsetY);
  if (Math.abs(kissLeanAngle) > 0.001) {
    ctx.rotate(kissLeanAngle);
  }
  ctx.scale(sx, sy);

  // Move origin to body center (18px above feet)
  ctx.translate(0, -18);

  const renderState = {
    palette,
    time,
    vx: actor.vx || 0,
    vy: actor.vy || 0,
    facing: actor.facing || 1,
    grounded: !!actor.grounded,
  };

  // Back accessories (scarf tail, ribbons, veil)
  if (typeof skin.drawBack === 'function') {
    skin.drawBack(ctx, renderState);
  }

  // Tiny animated feet nubs synced to walk distance
  const leftFootY = moving ? Math.max(0, Math.sin(walkPhase)) * -3.5 : 0;
  const rightFootY = moving ? Math.max(0, Math.sin(walkPhase + Math.PI)) * -3.5 : 0;
  const airTilt = !actor.grounded ? clamp((actor.vy || 0) * 0.008, -3, 3) : 0;

  ctx.fillStyle = palette.bodyDark;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.ellipse(-6.5, 16 + leftFootY + airTilt, 4.8, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(6.5, 16 + rightFootY - airTilt, 4.8, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Main rounded blob body
  const bodyGrad = ctx.createLinearGradient(-12, -18, 12, 16);
  bodyGrad.addColorStop(0, palette.body);
  bodyGrad.addColorStop(1, palette.bodyDark);

  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.bezierCurveTo(13, -17, 17.5, -5, 16.5, 6);
  ctx.bezierCurveTo(16, 13.5, 10, 16.5, 0, 16.5);
  ctx.bezierCurveTo(-10, 16.5, -16, 13.5, -16.5, 6);
  ctx.bezierCurveTo(-17.5, -5, -13, -17, 0, -17);
  ctx.closePath();
  ctx.fill();

  // Soft lower belly tint, spots & highlight clipped inside silhouette
  ctx.save();
  ctx.clip();
  ctx.fillStyle = palette.belly;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(0, 12, 13, 8.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.spot;
  ctx.beginPath();
  ctx.ellipse(-10.5, 4, 3.2, 2.3, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(10.8, 7, 2.5, 1.9, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9.2, -9.5, 2.1, 1.5, 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = palette.highlight;
  ctx.beginPath();
  ctx.ellipse(-6.5, -10.5, 5.2, 2.7, -0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Crisp outer silhouette stroke
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.bezierCurveTo(13, -17, 17.5, -5, 16.5, 6);
  ctx.bezierCurveTo(16, 13.5, 10, 16.5, 0, 16.5);
  ctx.bezierCurveTo(-10, 16.5, -16, 13.5, -16.5, 6);
  ctx.bezierCurveTo(-17.5, -5, -13, -17, 0, -17);
  ctx.closePath();
  ctx.stroke();

  // Gaze calculation (tracks velocity or softly looks at partner when idle nearby)
  let gazeX = (actor.facing || 1) * 1.8;
  let gazeY = !actor.grounded ? clamp((actor.vy || 0) * 0.004, -1.6, 1.6) : 0;
  if (Math.abs(actor.vx || 0) < 10 && partnerPos) {
    const dx = partnerPos.x - cx;
    const dy = partnerPos.y - (bottomY - 18);
    const dist = Math.hypot(dx, dy);
    if (dist > 4 && dist < 300) {
      gazeX = (dx / dist) * 2.1;
      gazeY = (dy / dist) * 1.1;
    }
  }

  const faceShiftX = (actor.facing || 1) * (isKissing ? 3.2 : 2.2);
  const eyeY = -2.2;
  const isBlinking = (actor.blinkTimer ?? 2) < 0.11;

  // Rosy cheeks (warmer & fuller during automatic kiss or love reaction blush!)
  const warmBlush = isKissing || isBlushing;
  ctx.fillStyle = warmBlush ? 'rgba(255, 92, 138, 0.86)' : palette.cheek;
  const cheekRx = warmBlush ? 4.9 : 3.6;
  const cheekRy = warmBlush ? 3.1 : 2.2;
  ctx.beginPath();
  ctx.ellipse(faceShiftX - 9.0, eyeY + 5.2, cheekRx, cheekRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(faceShiftX + 9.0, eyeY + 5.2, cheekRx, cheekRy, 0, 0, Math.PI * 2);
  ctx.fill();
  if (isBlushing) {
    ctx.strokeStyle = 'rgba(255, 66, 114, 0.68)';
    ctx.lineWidth = 1.25;
    [-9.0, 9.0].forEach((bx) => {
      ctx.beginPath();
      ctx.moveTo(faceShiftX + bx - 2.2, eyeY + 4.3);
      ctx.lineTo(faceShiftX + bx - 0.8, eyeY + 6.1);
      ctx.moveTo(faceShiftX + bx + 0.6, eyeY + 4.3);
      ctx.lineTo(faceShiftX + bx + 2.0, eyeY + 6.1);
      ctx.stroke();
    });
  }

  // Expressive Eyes (Shocked @.@ / wide pinpoint, Panic, Crying > <, Kissing/Happy ^ ^, Blinking, Worried, or Normal Sparkle)
  [-5.1, 5.1].forEach((exOffset, idx) => {
    const ex = faceShiftX + exOffset;
    if (isShocked || isPanic) {
      // Wide bulging white sclera with tiny quivering pinpoint pupils
      const er = isShocked ? 5.3 : 4.8;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = palette.outline;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY - 0.5, er, er * 1.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const jit = Math.sin(time * 55 + idx * 2) * 0.7;
      ctx.fillStyle = '#181024';
      ctx.beginPath();
      ctx.arc(ex + jit, eyeY - 0.3, isShocked ? 1.25 : 1.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (isCrying) {
      // Cute scrunched > < tearful eyes with shiny tear pools
      ctx.strokeStyle = palette.pupil;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (idx === 0) {
        ctx.moveTo(ex - 2.6, eyeY - 2.4);
        ctx.lineTo(ex + 2.2, eyeY);
        ctx.lineTo(ex - 2.6, eyeY + 2.4);
      } else {
        ctx.moveTo(ex + 2.6, eyeY - 2.4);
        ctx.lineTo(ex - 2.2, eyeY);
        ctx.lineTo(ex + 2.6, eyeY + 2.4);
      }
      ctx.stroke();

      // Glossy tear droplets welling at lower corners
      ctx.fillStyle = '#87D7FF';
      ctx.beginPath();
      ctx.ellipse(ex + (idx === 0 ? -1.4 : 1.4), eyeY + 3.4, 2.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (isKissing || isHappy) {
      ctx.strokeStyle = palette.pupil;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, eyeY + 1.2, 3.5, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (isBlinking) {
      ctx.strokeStyle = palette.pupil;
      ctx.lineWidth = 2.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 3.2, eyeY + 0.5);
      ctx.quadraticCurveTo(ex, eyeY + 2, ex + 3.2, eyeY + 0.5);
      ctx.stroke();
    } else {
      const eyeR = isWorried ? 4.5 : !actor.grounded && (actor.vy || 0) < -140 ? 4.4 : 4.0;
      ctx.fillStyle = palette.eyeWhite;
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, eyeR, eyeR * 1.08, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.pupil;
      ctx.beginPath();
      ctx.arc(ex + gazeX * 0.6, eyeY + gazeY * 0.5, isWorried ? 2.1 : 2.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ex + gazeX * 0.4 - 1.0, eyeY + gazeY * 0.35 - 1.2, 1.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + gazeX * 0.5 + 0.9, eyeY + gazeY * 0.4 + 1.0, 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Mouth Expressions
  ctx.strokeStyle = palette.pupil;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (isShocked) {
    // Open shocked scream O-mouth + electric zigzag hair spike
    ctx.fillStyle = '#2A1228';
    ctx.beginPath();
    ctx.ellipse(faceShiftX, eyeY + 6.4, 3.4, 4.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (isPanic) {
    ctx.fillStyle = '#2A1228';
    ctx.beginPath();
    ctx.ellipse(faceShiftX, eyeY + 6.0, 2.8, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Panic sweat drop
    ctx.fillStyle = '#93C5FD';
    ctx.beginPath();
    ctx.arc(-14, -12 + Math.sin(time * 18) * 1.5, 2.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (isCrying) {
    // Quivering tiny sad wavy mouth
    const q = Math.sin(time * 26) * 0.7;
    ctx.moveTo(faceShiftX - 3.2, eyeY + 6.5 + q);
    ctx.quadraticCurveTo(faceShiftX, eyeY + 3.6 - q, faceShiftX + 3.2, eyeY + 6.5 + q);
    ctx.stroke();
  } else if (isKissing) {
    // Sweet tiny rosy kiss-pout / affectionate smile
    ctx.fillStyle = '#E25B7E';
    ctx.beginPath();
    ctx.arc(faceShiftX + (actor.facing || 1) * 1.4, eyeY + 5.2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (isWorried) {
    ctx.arc(faceShiftX, eyeY + 5.6, 1.8, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isHappy) {
    ctx.arc(faceShiftX, eyeY + 4.4, 3.3, 0.15, Math.PI - 0.15);
    ctx.stroke();
  } else {
    ctx.arc(faceShiftX, eyeY + 4.2, 2.5, 0.22, Math.PI - 0.22);
    ctx.stroke();
  }

  // Cheerful waving arms during wave_arms / disco / celebrate dance styles
  if (actor.danceStyle && (actor.danceStyle === 'wave_arms' || actor.danceStyle === 'disco' || actor.danceStyle === 'celebrate')) {
    const wave = Math.sin(time * 11) * 5;
    ctx.fillStyle = palette.body;
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = 1.9;
    [-16, 16].forEach((ax, i) => {
      const ay = actor.danceStyle === 'disco' ? (i === 0 ? -12 + wave : 2 - wave) : -9 + (i === 0 ? wave : -wave);
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  // Front accessories (scarf knot, bow, flower, goggles, hat, crown)
  if (typeof skin.drawFront === 'function') {
    skin.drawFront(ctx, renderState);
  }

  // Startled shock lightning sparks directly above head when shocked
  if (isShocked) {
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.2;
    [-11, 0, 11].forEach((lx, i) => {
      const jy = -24 + ((i % 2) * 3);
      ctx.beginPath();
      ctx.moveTo(lx, jy + 5);
      ctx.lineTo(lx - 2, jy);
      ctx.lineTo(lx + 2, jy - 4);
      ctx.stroke();
    });
  }

  ctx.restore();

  // Floating active-control pointer & subtle name initial above active character
  if (showIndicator) {
    const floatY = actor.y - 19 + Math.sin(time * 5.2) * 3.2;
    if (isActive) {
      ctx.save();
      ctx.translate(cx, floatY);

      ctx.fillStyle = '#FFF3C4';
      ctx.strokeStyle = '#2A233A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 7);
      ctx.lineTo(-5.5, -1);
      ctx.lineTo(0, -8);
      ctx.lineTo(5.5, -1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 24, 42, 0.85)';
      ctx.strokeText(actor.name, 0, -10);
      ctx.fillStyle = '#FFFDF5';
      ctx.fillText(actor.name, 0, -10);
      ctx.restore();
    } else {
      ctx.save();
      ctx.font = '600 10px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(20, 24, 42, 0.65)';
      ctx.strokeText(actor.name, cx, actor.y - 10);
      ctx.fillStyle = 'rgba(255, 252, 245, 0.72)';
      ctx.fillText(actor.name, cx, actor.y - 10);
      ctx.restore();
    }
  }
}

/**
 * Renders a crisp portrait preview of a skin onto a small UI canvas (for Skin Selector).
 */
export function renderSkinPreview(canvas, characterId, skinId, time = 0) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const skin = getSkin(characterId, skinId);
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createRadialGradient(w * 0.5, h * 0.52, 6, w * 0.5, h * 0.52, w * 0.48);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  const scale = Math.min(w, h) / 62;
  ctx.translate(w * 0.5, h * 0.5 + 8 * scale);
  ctx.scale(scale, scale);

  renderCharacter(
    ctx,
    {
      id: characterId,
      name: characterId === 'madjid' ? 'Madjid' : 'Nadine',
      x: -17,
      y: -26,
      w: 34,
      h: 36,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: true,
      scaleX: 1,
      scaleY: 1,
      walkDist: 0,
      blinkTimer: 2,
      inPortal: false,
      hurtTimer: 0,
      invulnTimer: 0,
      kissLean: 0,
      mood: 'normal',
    },
    skin,
    time,
    { isActive: false, showIndicator: false }
  );
  ctx.restore();
}
