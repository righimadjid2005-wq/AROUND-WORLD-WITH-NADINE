/**
 * src/background.js
 * Atmospheric Time-of-Day, World-Themed Horizon Landmarks & Ambient Particle Layer.
 * Supports Sunrise (golden-pink dawn), Sunset (orange-purple dusk),
 * and Calm Night (starry navy sky, crescent moon, soft layered clouds, glowing lanterns),
 * plus 10 world-themed distant silhouettes and ambient petals/fireflies/dandelions.
 */

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

function rgbStr(rgb, alpha = 1) {
  return alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`;
}

export const TIME_PRESETS = {
  sunrise: {
    id: 'sunrise',
    label: 'Golden Dawn',
    skyTop: hexToRgb('#5A6BA8'),
    skyMid: hexToRgb('#E294A3'),
    skyLow: hexToRgb('#FCD4A0'),
    sunColor: hexToRgb('#FFF4CC'),
    sunHalo: hexToRgb('#FFB88C'),
    sunXRatio: 0.74,
    sunYRatio: 0.34,
    sunRadius: 44,
    sunAlpha: 0.95,
    moonAlpha: 0,
    starAlpha: 0.08,
    lanternAlpha: 0.25,
    cloudFill: hexToRgb('#FFF0E2'),
    cloudShade: hexToRgb('#E7A6B2'),
    cloudAlpha: 0.82,
    hillFar: hexToRgb('#A487A8'),
    hillMid: hexToRgb('#806D92'),
    hillNear: hexToRgb('#59577B'),
    hazeColor: hexToRgb('#FDE1B8'),
    hazeAlpha: 0.24,
    moteColor: hexToRgb('#FFF6C8'),
    platformTop: '#76A665',
    platformTopRim: '#9AC981',
    platformBody: '#463E54',
    platformTrim: '#2A2438',
  },
  sunset: {
    id: 'sunset',
    label: 'Amber Dusk',
    skyTop: hexToRgb('#2D2554'),
    skyMid: hexToRgb('#9B4E73'),
    skyLow: hexToRgb('#F29563'),
    sunColor: hexToRgb('#FFE1A8'),
    sunHalo: hexToRgb('#F2785C'),
    sunXRatio: 0.26,
    sunYRatio: 0.36,
    sunRadius: 48,
    sunAlpha: 0.92,
    moonAlpha: 0.12,
    starAlpha: 0.26,
    lanternAlpha: 0.68,
    cloudFill: hexToRgb('#F9C29B'),
    cloudShade: hexToRgb('#8E4A6D'),
    cloudAlpha: 0.78,
    hillFar: hexToRgb('#6E4369'),
    hillMid: hexToRgb('#4F3357'),
    hillNear: hexToRgb('#352645'),
    hazeColor: hexToRgb('#F59F76'),
    hazeAlpha: 0.22,
    moteColor: hexToRgb('#FFD79A'),
    platformTop: '#C98456',
    platformTopRim: '#E8A979',
    platformBody: '#382B47',
    platformTrim: '#21182E',
  },
  night: {
    id: 'night',
    label: 'Starry Night',
    skyTop: hexToRgb('#091226'),
    skyMid: hexToRgb('#142447'),
    skyLow: hexToRgb('#263E6B'),
    sunColor: hexToRgb('#FFF1C4'),
    sunHalo: hexToRgb('#F5B971'),
    sunXRatio: 0.5,
    sunYRatio: 0.95,
    sunRadius: 34,
    sunAlpha: 0,
    moonAlpha: 1,
    starAlpha: 1,
    lanternAlpha: 1,
    cloudFill: hexToRgb('#365080'),
    cloudShade: hexToRgb('#1A2B50'),
    cloudAlpha: 0.56,
    hillFar: hexToRgb('#1B2D52'),
    hillMid: hexToRgb('#142240'),
    hillNear: hexToRgb('#0E1830'),
    hazeColor: hexToRgb('#4A6FA5'),
    hazeAlpha: 0.16,
    moteColor: hexToRgb('#FFE299'),
    platformTop: '#4A7C82',
    platformTopRim: '#75ADB0',
    platformBody: '#1F2C45',
    platformTrim: '#111A2B',
  },
  jungle: {
    id: 'jungle',
    label: 'Jungle Dawn',
    skyTop: hexToRgb('#2A5C48'),
    skyMid: hexToRgb('#7DB878'),
    skyLow: hexToRgb('#DDF2B8'),
    sunColor: hexToRgb('#FFF9D6'),
    sunHalo: hexToRgb('#FFE08A'),
    sunXRatio: 0.72,
    sunYRatio: 0.28,
    sunRadius: 44,
    sunAlpha: 0.9,
    moonAlpha: 0,
    starAlpha: 0.05,
    lanternAlpha: 0.25,
    cloudFill: hexToRgb('#EFFBE8'),
    cloudShade: hexToRgb('#9ECBA2'),
    cloudAlpha: 0.74,
    hillFar: hexToRgb('#447B5B'),
    hillMid: hexToRgb('#2E6146'),
    hillNear: hexToRgb('#1E4534'),
    hazeColor: hexToRgb('#C8EEAE'),
    hazeAlpha: 0.25,
    moteColor: hexToRgb('#E2FFBA'),
    platformTop: '#56A654',
    platformTopRim: '#8BE07B',
    platformBody: '#3A4A3A',
    platformTrim: '#1B281E',
  },
  ice: {
    id: 'ice',
    label: 'Frozen Aurora',
    skyTop: hexToRgb('#18365C'),
    skyMid: hexToRgb('#4C84B5'),
    skyLow: hexToRgb('#C2EBFF'),
    sunColor: hexToRgb('#F0FAFF'),
    sunHalo: hexToRgb('#9CE3FF'),
    sunXRatio: 0.68,
    sunYRatio: 0.26,
    sunRadius: 40,
    sunAlpha: 0.78,
    moonAlpha: 0.15,
    starAlpha: 0.35,
    lanternAlpha: 0.4,
    cloudFill: hexToRgb('#EBF9FF'),
    cloudShade: hexToRgb('#93C6E6'),
    cloudAlpha: 0.72,
    hillFar: hexToRgb('#6FA8D1'),
    hillMid: hexToRgb('#4A85B3'),
    hillNear: hexToRgb('#2D5E88'),
    hazeColor: hexToRgb('#DDF5FF'),
    hazeAlpha: 0.26,
    moteColor: hexToRgb('#FFFFFF'),
    platformTop: '#7CC6EB',
    platformTopRim: '#CFF2FF',
    platformBody: '#2A4E70',
    platformTrim: '#152B42',
  },
  volcano: {
    id: 'volcano',
    label: 'Volcanic Dusk',
    skyTop: hexToRgb('#1E0E1C'),
    skyMid: hexToRgb('#6E2326'),
    skyLow: hexToRgb('#DF5926'),
    sunColor: hexToRgb('#FFD29A'),
    sunHalo: hexToRgb('#FF6A2B'),
    sunXRatio: 0.3,
    sunYRatio: 0.38,
    sunRadius: 46,
    sunAlpha: 0.88,
    moonAlpha: 0,
    starAlpha: 0.14,
    lanternAlpha: 0.72,
    cloudFill: hexToRgb('#8C4A46'),
    cloudShade: hexToRgb('#401B1E'),
    cloudAlpha: 0.82,
    hillFar: hexToRgb('#592222'),
    hillMid: hexToRgb('#3D181A'),
    hillNear: hexToRgb('#261012'),
    hazeColor: hexToRgb('#FF7A38'),
    hazeAlpha: 0.24,
    moteColor: hexToRgb('#FFB066'),
    platformTop: '#783B35',
    platformTopRim: '#FF7844',
    platformBody: '#281C22',
    platformTrim: '#120A0E',
  },
  space: {
    id: 'space',
    label: 'Orbital Nebula',
    skyTop: hexToRgb('#060818'),
    skyMid: hexToRgb('#151C42'),
    skyLow: hexToRgb('#29366B'),
    sunColor: hexToRgb('#A5F3FC'),
    sunHalo: hexToRgb('#38BDF8'),
    sunXRatio: 0.5,
    sunYRatio: 0.9,
    sunRadius: 30,
    sunAlpha: 0,
    moonAlpha: 0.9,
    starAlpha: 1,
    lanternAlpha: 0.15,
    cloudFill: hexToRgb('#283C70'),
    cloudShade: hexToRgb('#131D3B'),
    cloudAlpha: 0.32,
    hillFar: hexToRgb('#1C264F'),
    hillMid: hexToRgb('#161F42'),
    hillNear: hexToRgb('#101733'),
    hazeColor: hexToRgb('#38BDF8'),
    hazeAlpha: 0.14,
    moteColor: hexToRgb('#7DD3FC'),
    platformTop: '#3C6E91',
    platformTopRim: '#78DCFA',
    platformBody: '#1B2540',
    platformTrim: '#0D1426',
  },
  ocean: {
    id: 'ocean',
    label: 'Abyssal Sanctuary',
    skyTop: hexToRgb('#09324A'),
    skyMid: hexToRgb('#146482'),
    skyLow: hexToRgb('#34B3B8'),
    sunColor: hexToRgb('#CCFBF1'),
    sunHalo: hexToRgb('#5EEAD4'),
    sunXRatio: 0.5,
    sunYRatio: 0.08,
    sunRadius: 52,
    sunAlpha: 0.45,
    moonAlpha: 0,
    starAlpha: 0.12,
    lanternAlpha: 0.45,
    cloudFill: hexToRgb('#2F8F9D'),
    cloudShade: hexToRgb('#175769'),
    cloudAlpha: 0.3,
    hillFar: hexToRgb('#1A5D70'),
    hillMid: hexToRgb('#134659'),
    hillNear: hexToRgb('#0D3445'),
    hazeColor: hexToRgb('#5EEAD4'),
    hazeAlpha: 0.18,
    moteColor: hexToRgb('#A7F3D0'),
    platformTop: '#26948A',
    platformTopRim: '#6EE7D4',
    platformBody: '#153447',
    platformTrim: '#0A1E2B',
  },
};

export const WEATHER_PRESETS = {
  clear: { id: 'clear', label: 'Clear' },
  rain: { id: 'rain', label: 'Soft Rain' },
  wind: { id: 'wind', label: 'Breeze & Petals' },
  fireflies: { id: 'fireflies', label: 'Fireflies' },
  snow: { id: 'snow', label: 'Snowflakes' },
  embers: { id: 'embers', label: 'Volcanic Embers' },
  bubbles: { id: 'bubbles', label: 'Ocean Bubbles' },
};

export function getWeatherForWorld(worldId) {
  switch (Number(worldId)) {
    case 1:
      return 'wind';
    case 2:
      return 'snow';
    case 3:
      return 'embers';
    case 4:
      return 'clear';
    case 5:
      return 'bubbles';
    case 6:
      return 'rain';
    case 7:
      return 'wind';
    case 8:
    case 9:
      return 'fireflies';
    default:
      return 'clear';
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clonePreset(preset) {
  return {
    ...preset,
    skyTop: [...preset.skyTop],
    skyMid: [...preset.skyMid],
    skyLow: [...preset.skyLow],
    sunColor: [...preset.sunColor],
    sunHalo: [...preset.sunHalo],
    cloudFill: [...preset.cloudFill],
    cloudShade: [...preset.cloudShade],
    hillFar: [...preset.hillFar],
    hillMid: [...preset.hillMid],
    hillNear: [...preset.hillNear],
    hazeColor: [...preset.hazeColor],
    moteColor: [...preset.moteColor],
  };
}

const NIGHT_SKY_TOP = [9, 18, 42];
const NIGHT_SKY_MID = [20, 36, 74];
const NIGHT_SKY_LOW = [38, 62, 108];
const NIGHT_HILL_FAR = [27, 45, 82];
const NIGHT_HILL_MID = [20, 34, 64];
const NIGHT_HILL_NEAR = [14, 24, 48];
const NIGHT_CLOUD_FILL = [54, 80, 128];
const NIGHT_CLOUD_SHADE = [26, 43, 80];
const NIGHT_HAZE = [74, 111, 165];
const DAY_SKY_LIFT = [214, 228, 248];
const DAY_HILL_LIFT = [148, 174, 206];

/**
 * Computes an effective Day or Night atmospheric preset from any biome base preset
 * without mutating TIME_PRESETS or sacrificing world identity.
 */
export function resolvePresetForTimeOfDay(basePreset, mode = 'day') {
  const source = basePreset || TIME_PRESETS.sunrise;
  const resolved = clonePreset(source);
  const timeOfDay = mode === 'night' ? 'night' : 'day';

  if (timeOfDay === 'night') {
    if (source.id === 'night') {
      resolved.lanternAlpha = 1;
      resolved.moonAlpha = 1;
      resolved.starAlpha = 1;
      return resolved;
    }
    const skyMix = source.id === 'space' ? 0.36 : source.id === 'volcano' ? 0.56 : 0.66;
    const hillMix = source.id === 'space' ? 0.34 : 0.6;
    resolved.skyTop = lerpRgb(source.skyTop, NIGHT_SKY_TOP, skyMix);
    resolved.skyMid = lerpRgb(source.skyMid, NIGHT_SKY_MID, skyMix);
    resolved.skyLow = lerpRgb(source.skyLow, NIGHT_SKY_LOW, skyMix * 0.92);
    resolved.cloudFill = lerpRgb(source.cloudFill, NIGHT_CLOUD_FILL, 0.58);
    resolved.cloudShade = lerpRgb(source.cloudShade, NIGHT_CLOUD_SHADE, 0.58);
    resolved.cloudAlpha = Math.min(source.cloudAlpha, 0.56);
    resolved.hillFar = lerpRgb(source.hillFar, NIGHT_HILL_FAR, hillMix);
    resolved.hillMid = lerpRgb(source.hillMid, NIGHT_HILL_MID, hillMix);
    resolved.hillNear = lerpRgb(source.hillNear, NIGHT_HILL_NEAR, hillMix);
    resolved.hazeColor = lerpRgb(source.hazeColor, NIGHT_HAZE, 0.52);
    resolved.hazeAlpha = Math.max(0.14, Math.min(0.22, source.hazeAlpha));
    resolved.sunAlpha = source.id === 'volcano' ? 0.26 : 0;
    resolved.moonAlpha = source.id === 'ocean' ? 0.62 : 0.96;
    resolved.starAlpha = source.id === 'ocean' ? 0.48 : 0.98;
    resolved.lanternAlpha = 1;
    resolved.moteColor = [255, 226, 153];
    return resolved;
  }

  // Day Mode: bright, crisp daylight clarity across every world
  if (source.id === 'night') {
    const dayRef = clonePreset(TIME_PRESETS.sunrise);
    dayRef.id = source.id;
    dayRef.platformTop = source.platformTop;
    dayRef.platformTopRim = source.platformTopRim;
    dayRef.platformBody = source.platformBody;
    dayRef.platformTrim = source.platformTrim;
    return dayRef;
  }

  if (source.id === 'volcano' || source.id === 'sunset' || source.id === 'ocean') {
    const lift = source.id === 'ocean' ? 0.16 : 0.24;
    resolved.skyTop = lerpRgb(source.skyTop, DAY_SKY_LIFT, lift);
    resolved.skyMid = lerpRgb(source.skyMid, DAY_SKY_LIFT, lift * 0.85);
    resolved.skyLow = lerpRgb(source.skyLow, [255, 240, 214], lift * 0.7);
    resolved.hillFar = lerpRgb(source.hillFar, DAY_HILL_LIFT, lift * 0.75);
    resolved.hillMid = lerpRgb(source.hillMid, DAY_HILL_LIFT, lift * 0.55);
    resolved.sunAlpha = source.id === 'ocean' ? 0.64 : Math.max(source.sunAlpha, 0.82);
    resolved.moonAlpha = 0;
    resolved.starAlpha = 0.05;
    resolved.lanternAlpha = 0.24;
  } else if (source.id === 'space') {
    resolved.skyTop = lerpRgb(source.skyTop, [32, 50, 96], 0.34);
    resolved.skyMid = lerpRgb(source.skyMid, [56, 86, 146], 0.34);
    resolved.skyLow = lerpRgb(source.skyLow, [86, 124, 184], 0.3);
    resolved.hillFar = lerpRgb(source.hillFar, [64, 92, 152], 0.28);
    resolved.hillMid = lerpRgb(source.hillMid, [48, 74, 130], 0.26);
    resolved.sunAlpha = 0.42;
    resolved.moonAlpha = 0.45;
    resolved.starAlpha = 0.82;
    resolved.lanternAlpha = 0.2;
  } else {
    resolved.sunAlpha = Math.max(source.sunAlpha, 0.88);
    resolved.moonAlpha = 0;
    resolved.starAlpha = Math.min(source.starAlpha, 0.08);
    resolved.lanternAlpha = Math.min(source.lanternAlpha, 0.28);
  }
  return resolved;
}

export function createBackgroundSystem(initialTheme = 'sunrise', initialTimeOfDay = 'day') {
  const rand = mulberry32(202607);

  const stars = Array.from({ length: 84 }, () => ({
    x: rand(),
    y: rand() * 0.58,
    r: 0.7 + rand() * 1.6,
    phase: rand() * Math.PI * 2,
    speed: 1.2 + rand() * 2.4,
    warm: rand() > 0.75,
  }));

  const clouds = Array.from({ length: 9 }, (_, i) => ({
    x: (i / 9) * 1.35 - 0.15 + rand() * 0.08,
    y: 0.12 + (i % 3) * 0.1 + rand() * 0.05,
    scale: 0.65 + rand() * 0.65,
    speed: 0.004 + rand() * 0.006,
    layer: i % 2,
  }));

  const motes = Array.from({ length: 30 }, () => ({
    x: rand(),
    y: 0.2 + rand() * 0.72,
    r: 1.4 + rand() * 2.2,
    phase: rand() * Math.PI * 2,
    vx: 0.006 + rand() * 0.011,
    vy: 0.004 + rand() * 0.009,
    rot: rand() * Math.PI * 2,
  }));

  const birds = Array.from({ length: 5 }, (_, i) => ({
    x: 0.12 + i * 0.19 + rand() * 0.05,
    y: 0.22 + (i % 3) * 0.06,
    speed: 0.012 + rand() * 0.008,
    flapOffset: rand() * Math.PI * 2,
    scale: 0.7 + rand() * 0.4,
  }));

  const raindrops = Array.from({ length: 68 }, () => ({
    x: rand(),
    y: rand(),
    len: 12 + rand() * 14,
    speed: 0.95 + rand() * 0.55,
    alpha: 0.28 + rand() * 0.3,
  }));

  const windRibbons = Array.from({ length: 5 }, (_, i) => ({
    x: rand(),
    y: 0.18 + (i / 5) * 0.55,
    len: 75 + rand() * 75,
    speed: 0.24 + rand() * 0.14,
    phase: rand() * Math.PI * 2,
  }));

  let targetName = TIME_PRESETS[initialTheme] ? initialTheme : 'sunrise';
  let timeOfDayMode = initialTimeOfDay === 'night' ? 'night' : 'day';
  let current = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
  let landmarkStyle = 'cottages';
  let ambientStyle = 'petals';
  let weatherType = 'clear';
  let customPlatformStyle = null;

  function setTheme(themeName, instant = false, options = {}) {
    if (TIME_PRESETS[themeName]) {
      targetName = themeName;
      if (instant) {
        current = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
      }
    }
    if (options.timeOfDay === 'day' || options.timeOfDay === 'night') {
      timeOfDayMode = options.timeOfDay;
      if (instant) {
        current = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
      }
    }
    if (options.landmark) landmarkStyle = options.landmark;
    if (options.ambient) ambientStyle = options.ambient;
    if (options.weather && WEATHER_PRESETS[options.weather]) {
      weatherType = options.weather;
    }
    customPlatformStyle = options.platformPalette || null;
  }

  function setTimeOfDayMode(mode, instant = false) {
    timeOfDayMode = mode === 'night' ? 'night' : 'day';
    if (instant) {
      current = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
    }
    return timeOfDayMode;
  }

  function getTimeOfDayMode() {
    return timeOfDayMode;
  }

  function setWeather(weather) {
    if (WEATHER_PRESETS[weather]) {
      weatherType = weather;
    }
  }

  function getWeather() {
    return weatherType;
  }

  function getThemeName() {
    return targetName;
  }

  function getLandmarkStyle() {
    return landmarkStyle;
  }

  function getPlatformStyle() {
    if (customPlatformStyle) return customPlatformStyle;
    const p = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
    return {
      top: p.platformTop,
      topRim: p.platformTopRim,
      body: p.platformBody,
      trim: p.platformTrim,
    };
  }

  function update(dt) {
    const target = resolvePresetForTimeOfDay(TIME_PRESETS[targetName], timeOfDayMode);
    const blend = Math.min(1, dt * 2.4);

    current.skyTop = lerpRgb(current.skyTop, target.skyTop, blend);
    current.skyMid = lerpRgb(current.skyMid, target.skyMid, blend);
    current.skyLow = lerpRgb(current.skyLow, target.skyLow, blend);
    current.sunColor = lerpRgb(current.sunColor, target.sunColor, blend);
    current.sunHalo = lerpRgb(current.sunHalo, target.sunHalo, blend);
    current.cloudFill = lerpRgb(current.cloudFill, target.cloudFill, blend);
    current.cloudShade = lerpRgb(current.cloudShade, target.cloudShade, blend);
    current.hillFar = lerpRgb(current.hillFar, target.hillFar, blend);
    current.hillMid = lerpRgb(current.hillMid, target.hillMid, blend);
    current.hillNear = lerpRgb(current.hillNear, target.hillNear, blend);
    current.hazeColor = lerpRgb(current.hazeColor, target.hazeColor, blend);
    current.moteColor = lerpRgb(current.moteColor, target.moteColor, blend);

    current.sunXRatio = lerp(current.sunXRatio, target.sunXRatio, blend);
    current.sunYRatio = lerp(current.sunYRatio, target.sunYRatio, blend);
    current.sunRadius = lerp(current.sunRadius, target.sunRadius, blend);
    current.sunAlpha = lerp(current.sunAlpha, target.sunAlpha, blend);
    current.moonAlpha = lerp(current.moonAlpha, target.moonAlpha, blend);
    current.starAlpha = lerp(current.starAlpha, target.starAlpha, blend);
    current.lanternAlpha = lerp(current.lanternAlpha, target.lanternAlpha, blend);
    current.cloudAlpha = lerp(current.cloudAlpha, target.cloudAlpha, blend);
    current.hazeAlpha = lerp(current.hazeAlpha, target.hazeAlpha, blend);

    const windBoost = weatherType === 'wind' ? 2.4 : 1;
    for (let i = 0; i < clouds.length; i++) {
      clouds[i].x += clouds[i].speed * windBoost * dt;
      if (clouds[i].x > 1.25) clouds[i].x = -0.25;
    }

    for (let i = 0; i < birds.length; i++) {
      birds[i].x += birds[i].speed * dt;
      if (birds[i].x > 1.15) birds[i].x = -0.15;
    }
  }

  function drawCloud(ctx, x, y, scale, fill, shade, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;

    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(0, 10, 68, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(-36, 4, 22, 0, Math.PI * 2);
    ctx.arc(-8, -6, 30, 0, Math.PI * 2);
    ctx.arc(24, -1, 25, 0, Math.PI * 2);
    ctx.arc(48, 7, 17, 0, Math.PI * 2);
    ctx.ellipse(6, 9, 58, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawWorldLandmark(ctx, sx, hy, idx, color, time) {
    const glowAlpha = Math.max(0.28, current.lanternAlpha * 0.8);
    ctx.fillStyle = color;

    if (landmarkStyle === 'jungle_ruins') {
      // Jungle temple pyramid + broadleaf palm canopy
      if (Math.abs(idx) % 2 === 0) {
        ctx.fillRect(sx - 18, hy - 14, 36, 18);
        ctx.fillRect(sx - 12, hy - 26, 24, 14);
        ctx.fillRect(sx - 6, hy - 35, 12, 10);
        ctx.fillStyle = `rgba(190, 242, 100, ${glowAlpha.toFixed(2)})`;
        ctx.fillRect(sx - 3, hy - 20, 6, 6);
      } else {
        ctx.fillRect(sx - 3, hy - 32, 6, 36);
        for (let a = -2; a <= 2; a++) {
          ctx.beginPath();
          ctx.ellipse(sx + a * 8, hy - 30 + Math.abs(a) * 3, 10, 4, a * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    if (landmarkStyle === 'glaciers') {
      // Jagged crystalline glacier spires
      ctx.beginPath();
      ctx.moveTo(sx - 20, hy + 4);
      ctx.lineTo(sx - 8, hy - 42);
      ctx.lineTo(sx + 2, hy - 18);
      ctx.lineTo(sx + 10, hy - 52);
      ctx.lineTo(sx + 24, hy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(224, 247, 255, 0.32)';
      ctx.beginPath();
      ctx.moveTo(sx + 10, hy - 52);
      ctx.lineTo(sx + 18, hy + 4);
      ctx.lineTo(sx + 6, hy + 4);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (landmarkStyle === 'calderas') {
      // Jagged volcanic cone with molten rim glow
      ctx.beginPath();
      ctx.moveTo(sx - 30, hy + 4);
      ctx.lineTo(sx - 12, hy - 38);
      ctx.lineTo(sx + 12, hy - 38);
      ctx.lineTo(sx + 30, hy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 118, 46, ${Math.max(0.45, glowAlpha).toFixed(2)})`;
      ctx.fillRect(sx - 10, hy - 40, 20, 4);
      return;
    }

    if (landmarkStyle === 'space_station') {
      // Orbital dome & radio spire
      ctx.fillRect(sx - 20, hy - 14, 40, 18);
      ctx.beginPath();
      ctx.arc(sx, hy - 14, 15, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(sx - 2, hy - 42, 4, 16);
      ctx.fillStyle = `rgba(103, 232, 249, ${Math.max(0.5, glowAlpha).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, hy - 43, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(sx - 12, hy - 10, 24, 4);
      return;
    }

    if (landmarkStyle === 'coral_temple') {
      // Sunken ocean coral spires & pearl dome
      ctx.beginPath();
      ctx.arc(sx, hy - 16, 14, Math.PI, 0);
      ctx.lineTo(sx + 14, hy + 4);
      ctx.lineTo(sx - 14, hy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(sx - 22, hy - 26, 5, 30);
      ctx.fillRect(sx + 17, hy - 32, 5, 36);
      ctx.fillStyle = `rgba(153, 246, 228, ${Math.max(0.45, glowAlpha).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, hy - 10, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (landmarkStyle === 'windmills') {
      // Cozy meadow windmill with slowly rotating sails
      ctx.beginPath();
      ctx.moveTo(sx - 9, hy + 4);
      ctx.lineTo(sx - 5, hy - 34);
      ctx.lineTo(sx + 5, hy - 34);
      ctx.lineTo(sx + 9, hy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.translate(sx, hy - 30);
      ctx.rotate(time * 0.45 + idx);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (let b = 0; b < 4; b++) {
        ctx.rotate(Math.PI * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -18);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (landmarkStyle === 'lighthouse') {
      if (Math.abs(idx) % 2 === 0) {
        // Coastal lighthouse + soft warm lantern room
        ctx.beginPath();
        ctx.moveTo(sx - 8, hy + 4);
        ctx.lineTo(sx - 5, hy - 44);
        ctx.lineTo(sx + 5, hy - 44);
        ctx.lineTo(sx + 8, hy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(255, 228, 150, ${glowAlpha.toFixed(2)})`;
        ctx.fillRect(sx - 4, hy - 50, 8, 6);
        // Gentle sweeping harbor light beam
        const sweep = Math.sin(time * 0.9 + idx) * 28;
        ctx.fillStyle = `rgba(255, 232, 166, ${(glowAlpha * 0.22).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(sx, hy - 47);
        ctx.lineTo(sx + 66 + sweep, hy - 64);
        ctx.lineTo(sx + 66 + sweep, hy - 34);
        ctx.closePath();
        ctx.fill();
      } else {
        // Tiny harbor sailboat silhouette
        ctx.beginPath();
        ctx.moveTo(sx - 12, hy - 2);
        ctx.lineTo(sx + 12, hy - 2);
        ctx.lineTo(sx + 8, hy + 4);
        ctx.lineTo(sx - 8, hy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(sx, hy - 22);
        ctx.lineTo(sx + 10, hy - 4);
        ctx.lineTo(sx, hy - 4);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    if (landmarkStyle === 'aqueduct') {
      // Ancient multi-arch sunset viaduct
      ctx.fillRect(sx - 42, hy - 30, 84, 7);
      for (let a = -36; a <= 36; a += 24) {
        ctx.fillRect(sx + a - 3, hy - 24, 6, 28);
      }
      return;
    }

    if (landmarkStyle === 'dunes') {
      if (Math.abs(idx) % 2 === 0) {
        // Oasis lantern dome & slender minaret
        ctx.beginPath();
        ctx.arc(sx, hy - 14, 15, Math.PI, 0);
        ctx.lineTo(sx + 15, hy + 4);
        ctx.lineTo(sx - 15, hy + 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(sx + 19, hy - 34, 6, 38);
        ctx.fillStyle = `rgba(255, 224, 138, ${glowAlpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(sx + 22, hy - 36, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Slender desert palm silhouette
        ctx.strokeStyle = color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(sx, hy + 4);
        ctx.quadraticCurveTo(sx + 4, hy - 14, sx + 7, hy - 28);
        ctx.stroke();
        for (let f = -2; f <= 2; f++) {
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx + 7, hy - 28);
          ctx.quadraticCurveTo(sx + 7 + f * 6, hy - 34, sx + 7 + f * 11, hy - 23);
          ctx.stroke();
        }
      }
      return;
    }

    if (landmarkStyle === 'peaks') {
      // Alpine highland pine cluster & stone cairn
      for (let t = -1; t <= 1; t++) {
        const tx = sx + t * 14;
        const th = t === 0 ? 32 : 22;
        ctx.beginPath();
        ctx.moveTo(tx, hy - th);
        ctx.lineTo(tx - 9, hy + 4);
        ctx.lineTo(tx + 9, hy + 4);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }

    if (landmarkStyle === 'pagodas') {
      // Cloud-top tiered pavilion silhouette
      ctx.fillRect(sx - 13, hy - 14, 26, 18);
      ctx.beginPath();
      ctx.moveTo(sx - 20, hy - 13);
      ctx.lineTo(sx, hy - 24);
      ctx.lineTo(sx + 20, hy - 13);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx - 13, hy - 23);
      ctx.lineTo(sx, hy - 33);
      ctx.lineTo(sx + 13, hy - 23);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 224, 150, ${glowAlpha.toFixed(2)})`;
      ctx.fillRect(sx - 3, hy - 10, 6, 7);
      return;
    }

    if (landmarkStyle === 'crystals') {
      // Softly glowing faceted cavern crystal cluster
      ctx.beginPath();
      ctx.moveTo(sx - 6, hy + 4);
      ctx.lineTo(sx - 3, hy - 34);
      ctx.lineTo(sx + 5, hy - 28);
      ctx.lineTo(sx + 7, hy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(145, 232, 245, ${(glowAlpha * 0.45).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(sx - 14, hy + 4);
      ctx.lineTo(sx - 11, hy - 20);
      ctx.lineTo(sx - 5, hy + 4);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (landmarkStyle === 'gazebos') {
      // Moonlit garden gazebo with glowing lantern
      ctx.fillRect(sx - 14, hy - 18, 3, 22);
      ctx.fillRect(sx + 11, hy - 18, 3, 22);
      ctx.beginPath();
      ctx.arc(sx, hy - 18, 17, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 224, 150, ${glowAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, hy - 11, 3.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (landmarkStyle === 'chapel') {
      // Horizon wedding chapel spire & golden bell window
      ctx.fillRect(sx - 16, hy - 20, 32, 24);
      ctx.beginPath();
      ctx.moveTo(sx - 20, hy - 19);
      ctx.lineTo(sx, hy - 33);
      ctx.lineTo(sx + 20, hy - 19);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(sx - 5, hy - 48, 10, 20);
      ctx.beginPath();
      ctx.moveTo(sx - 7, hy - 47);
      ctx.lineTo(sx, hy - 60);
      ctx.lineTo(sx + 7, hy - 47);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(255, 236, 170, ${Math.max(0.55, glowAlpha).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(sx, hy - 38, 3.2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Default: Quiet Village cottages & cypress trees
    if (Math.abs(idx) % 2 === 0) {
      ctx.fillRect(sx - 12, hy - 14, 24, 18);
      ctx.beginPath();
      ctx.moveTo(sx - 16, hy - 13);
      ctx.lineTo(sx, hy - 26);
      ctx.lineTo(sx + 16, hy - 13);
      ctx.closePath();
      ctx.fill();
      if (current.lanternAlpha > 0.35) {
        ctx.fillStyle = `rgba(255, 224, 140, ${(current.lanternAlpha * 0.72).toFixed(2)})`;
        ctx.fillRect(sx - 3, hy - 9, 6, 6);
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(sx, hy - 12, 5.5, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(sx + 13, hy - 9, 4.5, 13, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHillLayer(ctx, w, h, cameraX, parallax, baseY, amp1, amp2, freq1, freq2, color, addLandmarks, time) {
    const offset = cameraX * parallax;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const step = 28;
    for (let x = 0; x <= w + step; x += step) {
      const wx = x + offset;
      const y = baseY + Math.sin(wx * freq1) * amp1 + Math.cos(wx * freq2 + 1.1) * amp2;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    if (addLandmarks) {
      ctx.save();
      const spacing = 440;
      const startIdx = Math.floor((offset - 120) / spacing);
      const endIdx = Math.ceil((offset + w + 120) / spacing);
      for (let i = startIdx; i <= endIdx; i++) {
        const wx = i * spacing + 180;
        const sx = wx - offset;
        const hy = baseY + Math.sin(wx * freq1) * amp1 + Math.cos(wx * freq2 + 1.1) * amp2;
        drawWorldLandmark(ctx, sx, hy, i, color, time);
      }
      ctx.restore();
    }
  }

  function drawHangingLantern(ctx, x, y, time, alpha) {
    if (alpha <= 0.02) return;
    const sway = Math.sin(time * 1.45 + x * 0.01) * 0.075;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(sway);

    ctx.strokeStyle = 'rgba(218, 192, 148, 0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -68);
    ctx.lineTo(0, 0);
    ctx.stroke();

    const pulse = 0.94 + Math.sin(time * 3.1 + x) * 0.06;
    ctx.fillStyle = 'rgba(255, 174, 84, 0.11)';
    ctx.beginPath();
    ctx.arc(0, 18, 68 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 214, 126, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 18, 38 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2A2238';
    ctx.beginPath();
    ctx.roundRect(-9, 0, 18, 5, 2);
    ctx.roundRect(-8, 31, 16, 4, 2);
    ctx.fill();

    const paperGrad = ctx.createLinearGradient(0, 5, 0, 31);
    paperGrad.addColorStop(0, '#FFF5C4');
    paperGrad.addColorStop(0.6, '#FFB95C');
    paperGrad.addColorStop(1, '#E67A3E');
    ctx.fillStyle = paperGrad;
    ctx.strokeStyle = '#382B47';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-10, 5, 20, 26, 8);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(72, 42, 32, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-4, 6);
    ctx.lineTo(-4, 30);
    ctx.moveTo(4, 6);
    ctx.lineTo(4, 30);
    ctx.stroke();

    ctx.strokeStyle = '#E0684B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 35);
    ctx.lineTo(Math.sin(time * 2.2) * 2, 47);
    ctx.stroke();

    ctx.restore();
  }

  let skyCacheCanvas = null;
  let skyCacheKey = '';

  function getSkyCache(width, height) {
    if (typeof document === 'undefined') return null;
    const key = [
      width,
      height,
      current.skyTop.join(','),
      current.skyMid.join(','),
      current.skyLow.join(','),
    ].join('|');

    if (skyCacheCanvas && skyCacheKey === key) {
      return skyCacheCanvas;
    }

    if (!skyCacheCanvas) {
      skyCacheCanvas = document.createElement('canvas');
    }
    skyCacheCanvas.width = Math.max(1, Math.round(width));
    skyCacheCanvas.height = Math.max(1, Math.round(height));
    const sctx = skyCacheCanvas.getContext('2d');
    if (!sctx) return null;

    const skyGrad = sctx.createLinearGradient(0, 0, 0, height);
    skyGrad.addColorStop(0, rgbStr(current.skyTop));
    skyGrad.addColorStop(0.54, rgbStr(current.skyMid));
    skyGrad.addColorStop(1, rgbStr(current.skyLow));
    sctx.fillStyle = skyGrad;
    sctx.fillRect(0, 0, width, height);

    skyCacheKey = key;
    return skyCacheCanvas;
  }

  function renderAmbientParticles(ctx, width, height, time) {
    ctx.save();
    if (ambientStyle === 'petals') {
      // Soft warm drifting blossom petals
      ctx.fillStyle = current.sunAlpha > 0.2 ? 'rgba(255, 224, 232, 0.72)' : 'rgba(244, 198, 224, 0.55)';
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + time * m.vx * 1.15) % 1) + 1) % 1) * width;
        const my = ((((m.y + time * m.vy * 0.9 + Math.sin(time * 1.8 + m.phase) * 0.025) % 0.85) + 0.85) % 0.85) * height + 20;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(time * 1.4 + m.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, m.r * 1.65, m.r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (ambientStyle === 'fireflies') {
      // Warm twinkling fireflies at night
      ctx.fillStyle = 'rgba(255, 232, 146, 0.24)';
      ctx.beginPath();
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + time * m.vx * 0.6) % 1) + 1) % 1) * width;
        const my = (m.y + Math.sin(time * 1.5 + m.phase) * 0.045) * height;
        const glowR = m.r * (2.6 + 1.1 * Math.sin(time * 3.2 + m.phase));
        ctx.moveTo(mx + glowR, my);
        ctx.arc(mx, my, glowR, 0, Math.PI * 2);
      }
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 248, 200, 0.88)';
      ctx.beginPath();
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + time * m.vx * 0.6) % 1) + 1) % 1) * width;
        const my = (m.y + Math.sin(time * 1.5 + m.phase) * 0.045) * height;
        const r = m.r * (0.7 + 0.4 * Math.sin(time * 3.2 + m.phase));
        ctx.moveTo(mx + r, my);
        ctx.arc(mx, my, r, 0, Math.PI * 2);
      }
      ctx.fill();
    } else if (ambientStyle === 'snow') {
      ctx.fillStyle = 'rgba(236, 250, 255, 0.85)';
      ctx.beginPath();
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + Math.sin(time + m.phase) * 0.03 + time * m.vx * 0.5) % 1) + 1) % 1) * width;
        const my = ((((m.y + time * m.vy * 4.5) % 1) + 1) % 1) * height;
        const r = m.r * 1.1;
        ctx.moveTo(mx + r, my);
        ctx.arc(mx, my, r, 0, Math.PI * 2);
      }
      ctx.fill();
    } else if (ambientStyle === 'embers') {
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + Math.sin(time * 2 + m.phase) * 0.025 + time * m.vx * 0.4) % 1) + 1) % 1) * width;
        const my = ((((1 - (m.y + time * m.vy * 5.2) % 1) + 1) % 1)) * height;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 168, 76, 0.85)' : 'rgba(255, 92, 46, 0.72)';
        ctx.beginPath();
        ctx.arc(mx, my, m.r * 1.05, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (ambientStyle === 'bubbles') {
      ctx.strokeStyle = 'rgba(204, 251, 241, 0.72)';
      ctx.fillStyle = 'rgba(153, 246, 228, 0.22)';
      ctx.lineWidth = 1.3;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + Math.sin(time * 1.8 + m.phase) * 0.02) % 1) + 1) % 1) * width;
        const my = ((((1 - (m.y + time * m.vy * 4.0) % 1) + 1) % 1)) * height;
        const r = 2.4 + m.r * 1.25;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // Gentle drifting sun motes / dandelion seeds
      ctx.fillStyle = rgbStr(current.moteColor, 0.62);
      ctx.beginPath();
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const mx = ((((m.x + time * m.vx) % 1) + 1) % 1) * width;
        const my = (m.y + Math.sin(time * 1.4 + m.phase) * 0.035) * height;
        const r = m.r * (0.7 + 0.3 * Math.sin(time * 2.2 + m.phase));
        ctx.moveTo(mx + r, my);
        ctx.arc(mx, my, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  function render(ctx, width, height, cameraX = 0, cameraY = 0, time = 0) {
    // 1. Cached Sky Gradient
    const cachedSky = getSkyCache(width, height);
    if (cachedSky) {
      ctx.drawImage(cachedSky, 0, 0);
    } else {
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, rgbStr(current.skyTop));
      skyGrad.addColorStop(0.54, rgbStr(current.skyMid));
      skyGrad.addColorStop(1, rgbStr(current.skyLow));
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Twinkling Stars (batched into 3 twinkle bands)
    if (current.starAlpha > 0.02) {
      ctx.save();
      const bands = [0.42, 0.72, 1.0];
      for (let b = 0; b < 3; b++) {
        ctx.fillStyle =
          b === 2
            ? `rgba(255, 240, 200, ${(bands[b] * current.starAlpha).toFixed(3)})`
            : `rgba(232, 242, 255, ${(bands[b] * current.starAlpha).toFixed(3)})`;
        ctx.beginPath();
        for (let i = b; i < stars.length; i += 3) {
          const s = stars[i];
          const twinkle = 0.5 + 0.5 * Math.sin(time * s.speed + s.phase);
          const sx = ((s.x * width - cameraX * 0.02) % width + width) % width;
          const sy = s.y * height;
          const r = s.r * (0.65 + 0.35 * twinkle);
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. Sun (Sunrise / Sunset) + Subtle Atmospheric Sunbeams
    if (current.sunAlpha > 0.02) {
      const sunX = width * current.sunXRatio - cameraX * 0.03;
      const sunY = height * current.sunYRatio - cameraY * 0.02;
      const r = current.sunRadius;

      if (targetName === 'sunrise' || targetName === 'jungle') {
        ctx.save();
        ctx.fillStyle = rgbStr(current.sunHalo, 0.048 * current.sunAlpha);
        for (let ray = -2; ray <= 2; ray++) {
          const ang = 0.72 + ray * 0.19 + Math.sin(time * 0.25 + ray) * 0.03;
          const farX = sunX + Math.cos(ang) * width * 0.9;
          const farY = sunY + Math.sin(ang) * height * 1.1;
          ctx.beginPath();
          ctx.moveTo(sunX, sunY);
          ctx.lineTo(farX - 48, farY);
          ctx.lineTo(farX + 48, farY);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.fillStyle = rgbStr(current.sunHalo, 0.1 * current.sunAlpha);
      ctx.beginPath();
      ctx.arc(sunX, sunY, r * 3.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgbStr(current.sunHalo, 0.2 * current.sunAlpha);
      ctx.beginPath();
      ctx.arc(sunX, sunY, r * 1.9, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgbStr(current.sunColor, current.sunAlpha);
      ctx.beginPath();
      ctx.arc(sunX, sunY, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Glowing Crescent Moon (Night / Dusk)
    if (current.moonAlpha > 0.02) {
      const moonX = width * 0.8 - cameraX * 0.03;
      const moonY = height * 0.21 - cameraY * 0.02;
      const moonR = 30;

      ctx.save();
      ctx.globalAlpha = current.moonAlpha;

      ctx.fillStyle = 'rgba(180, 210, 255, 0.1)';
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR * 3.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(225, 238, 255, 0.18)';
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR * 1.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFF7DE';
      ctx.beginPath();
      ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = rgbStr(lerpRgb(current.skyTop, current.skyMid, 0.32));
      ctx.beginPath();
      ctx.arc(moonX + 11, moonY - 7, moonR * 0.86, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Far Clouds
    const cloudFillStr = rgbStr(current.cloudFill);
    const cloudShadeStr = rgbStr(current.cloudShade);
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      if (c.layer !== 0) continue;
      const cx = c.x * width - cameraX * 0.05;
      const cy = c.y * height;
      drawCloud(ctx, cx, cy, c.scale * 0.85, cloudFillStr, cloudShadeStr, current.cloudAlpha * 0.72);
    }

    // 6. Distant Gliding Birds (Sunrise & Sunset)
    if (current.sunAlpha > 0.25) {
      ctx.save();
      ctx.strokeStyle = rgbStr(current.hillNear, current.sunAlpha * 0.55);
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        const bx = b.x * width;
        const by = b.y * height + Math.sin(time * 2 + b.flapOffset) * 4;
        const wing = Math.sin(time * 6.5 + b.flapOffset) * 4 * b.scale;
        const span = 7 * b.scale;
        ctx.moveTo(bx - span, by + wing);
        ctx.quadraticCurveTo(bx - span * 0.4, by - 3 * b.scale, bx, by);
        ctx.quadraticCurveTo(bx + span * 0.4, by - 3 * b.scale, bx + span, by + wing);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 7. Three Parallax Mountain / Hill Silhouettes with World-Themed Landmarks
    drawHillLayer(ctx, width, height, cameraX, 0.08, height * 0.67, 36, 22, 0.0032, 0.0068, rgbStr(current.hillFar), false, time);
    drawHillLayer(ctx, width, height, cameraX, 0.16, height * 0.75, 28, 18, 0.0045, 0.009, rgbStr(current.hillMid), true, time);

    // 8. Mid Clouds
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      if (c.layer !== 1) continue;
      const cx = c.x * width - cameraX * 0.1;
      const cy = c.y * height + 24;
      drawCloud(ctx, cx, cy, c.scale, cloudFillStr, cloudShadeStr, current.cloudAlpha);
    }

    // 9. Near Rolling Ridge
    drawHillLayer(ctx, width, height, cameraX, 0.28, height * 0.84, 22, 12, 0.0058, 0.011, rgbStr(current.hillNear), false, time);

    // 10. Lower Atmospheric Depth Mist
    ctx.fillStyle = rgbStr(current.hazeColor, current.hazeAlpha * 0.55);
    ctx.fillRect(0, height * 0.68, width, height * 0.32);

    // 11. Warm Glowing Hanging Lantern Accents (framed cleanly clear of HUD & moon)
    if (current.lanternAlpha > 0.3) {
      drawHangingLantern(ctx, width * 0.26 - cameraX * 0.08, 76, time, current.lanternAlpha);
      drawHangingLantern(ctx, width * 0.67 - cameraX * 0.08, 90, time + 1.8, current.lanternAlpha * 0.9);
    }

    // 12. World-Matched Ambient Particles (Fireflies at night when petals/clear, or biome weather)
    const effectiveAmbient =
      weatherType === 'fireflies'
        ? 'fireflies'
        : weatherType === 'wind'
          ? timeOfDayMode === 'night' && ambientStyle === 'petals'
            ? 'fireflies'
            : 'petals'
          : weatherType === 'snow'
            ? 'snow'
            : weatherType === 'embers'
              ? 'embers'
              : weatherType === 'bubbles'
                ? 'bubbles'
                : timeOfDayMode === 'night' && ambientStyle === 'petals'
                  ? 'fireflies'
                  : ambientStyle;
    const prevAmbient = ambientStyle;
    ambientStyle = effectiveAmbient;
    renderAmbientParticles(ctx, width, height, time);
    ambientStyle = prevAmbient;

    // 13. Weather & Biome Atmosphere Overlays (strictly deterministic math)
    if (targetName === 'ice') {
      // Shimmering polar aurora borealis ribbons drifting smoothly across upper glacial sky
      ctx.save();
      for (let band = 0; band < 2; band++) {
        const yBase = height * (0.17 + band * 0.08);
        const auroraGrad = ctx.createLinearGradient(0, yBase - 42, 0, yBase + 46);
        auroraGrad.addColorStop(0, 'rgba(56, 189, 248, 0)');
        auroraGrad.addColorStop(0.45, band === 0 ? 'rgba(94, 234, 212, 0.14)' : 'rgba(125, 211, 252, 0.11)');
        auroraGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = auroraGrad;
        ctx.beginPath();
        ctx.moveTo(0, yBase - 36);
        for (let sx = 0; sx <= width; sx += 48) {
          const wave = Math.sin(sx * 0.008 + time * 0.45 + band * 1.9 - cameraX * 0.002) * 18;
          ctx.lineTo(sx, yBase + wave);
        }
        ctx.lineTo(width, yBase + 52);
        ctx.lineTo(0, yBase + 52);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (targetName === 'volcano') {
      // Warm molten caldera horizon glow rising from lower crater rim
      ctx.save();
      const emberGlow = ctx.createLinearGradient(0, height * 0.62, 0, height);
      const pulse = 0.14 + Math.sin(time * 1.6) * 0.03;
      emberGlow.addColorStop(0, 'rgba(251, 146, 60, 0)');
      emberGlow.addColorStop(0.7, `rgba(249, 115, 22, ${pulse.toFixed(3)})`);
      emberGlow.addColorStop(1, `rgba(239, 68, 68, ${(pulse + 0.09).toFixed(3)})`);
      ctx.fillStyle = emberGlow;
      ctx.fillRect(0, height * 0.62, width, height * 0.38);
      ctx.restore();
    } else if (targetName === 'space') {
      // Distant ringed gas giant + soft iridescent nebula band in Space
      ctx.save();
      const px = width * 0.22 - cameraX * 0.025;
      const py = height * 0.23;
      const nebula = ctx.createRadialGradient(px + 28, py + 12, 12, px + 28, py + 12, 165);
      nebula.addColorStop(0, 'rgba(139, 92, 246, 0.18)');
      nebula.addColorStop(0.55, 'rgba(56, 189, 248, 0.08)');
      nebula.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.fillStyle = nebula;
      ctx.beginPath();
      ctx.arc(px + 28, py + 12, 165, 0, Math.PI * 2);
      ctx.fill();

      const pGrad = ctx.createRadialGradient(px - 10, py - 10, 6, px, py, 44);
      pGrad.addColorStop(0, '#A5F3FC');
      pGrad.addColorStop(0.6, '#6366F1');
      pGrad.addColorStop(1, '#1E1B4B');
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(px, py, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(165, 243, 252, 0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(px, py, 60, 13, -0.22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (targetName === 'ocean') {
      // Shimmering underwater sun caustic beams from surface
      ctx.save();
      ctx.fillStyle = 'rgba(153, 246, 228, 0.09)';
      for (let b = 0; b < 5; b++) {
        const bx = width * (0.1 + b * 0.21) + Math.sin(time * 0.9 + b * 1.1) * 18;
        ctx.beginPath();
        ctx.moveTo(bx - 16, 0);
        ctx.lineTo(bx + 26, 0);
        ctx.lineTo(bx + 92, height);
        ctx.lineTo(bx - 42, height);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    if (weatherType === 'rain') {
      ctx.save();
      ctx.fillStyle = 'rgba(18, 28, 54, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(196, 228, 255, 0.44)';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < raindrops.length; i++) {
        const rd = raindrops[i];
        const rx = (((rd.x + time * 0.14) % 1 + 1) % 1) * width;
        const ry = (((rd.y + time * rd.speed) % 1 + 1) % 1) * height;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 4, ry + rd.len);
      }
      ctx.stroke();

      // Ground rain ripples near lower playfield band
      ctx.strokeStyle = 'rgba(216, 238, 255, 0.34)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const phase = (time * 1.9 + i * 0.41) % 1;
        const px = ((i * 0.13 + Math.floor(time * 1.9 + i * 0.41) * 0.19) % 1) * width;
        const py = height * (0.86 + (i % 3) * 0.04);
        ctx.globalAlpha = (1 - phase) * 0.45;
        ctx.beginPath();
        ctx.ellipse(px, py, 3 + phase * 11, 1.4 + phase * 3.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    } else if (weatherType === 'wind') {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < windRibbons.length; i++) {
        const wr = windRibbons[i];
        const rx = (((wr.x + time * wr.speed) % 1.35) - 0.18) * width;
        const ry = wr.y * height + Math.sin(time * 2.2 + wr.phase) * 14;
        ctx.strokeStyle = 'rgba(255, 248, 236, 0.22)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.quadraticCurveTo(rx + wr.len * 0.5, ry - 10, rx + wr.len, ry + 4);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Subtle floating sunlit dust/spore motes for rich atmospheric depth (zero-allocation)
    ctx.save();
    for (let m = 0; m < 12; m++) {
      const mx = (((m * 0.137 + time * (0.012 + (m % 3) * 0.004) - cameraX * 0.00018) % 1 + 1) % 1) * width;
      const my = (((m * 0.219 + Math.sin(time * 0.7 + m) * 0.04) % 0.85 + 0.85) % 0.85) * height + height * 0.06;
      const mr = 1.1 + (m % 3) * 0.55;
      const alpha = 0.16 + Math.sin(time * 1.8 + m * 1.3) * 0.1;
      ctx.fillStyle =
        targetName === 'ocean'
          ? `rgba(153, 246, 228, ${alpha.toFixed(3)})`
          : targetName === 'volcano'
            ? `rgba(253, 186, 116, ${alpha.toFixed(3)})`
            : targetName === 'ice'
              ? `rgba(224, 242, 254, ${alpha.toFixed(3)})`
              : `rgba(255, 248, 220, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    setTheme,
    setTimeOfDayMode,
    getTimeOfDayMode,
    setWeather,
    getWeather,
    getThemeName,
    getLandmarkStyle,
    getPlatformStyle,
    update,
    render,
  };
}
