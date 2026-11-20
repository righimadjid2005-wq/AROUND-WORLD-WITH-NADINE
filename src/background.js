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
};

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

export function createBackgroundSystem(initialTheme = 'sunrise') {
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

  let targetName = TIME_PRESETS[initialTheme] ? initialTheme : 'sunrise';
  let current = clonePreset(TIME_PRESETS[targetName]);
  let landmarkStyle = 'cottages';
  let ambientStyle = 'petals';
  let customPlatformStyle = null;

  function setTheme(themeName, instant = false, options = {}) {
    if (TIME_PRESETS[themeName]) {
      targetName = themeName;
      if (instant) {
        current = clonePreset(TIME_PRESETS[targetName]);
      }
    }
    if (options.landmark) landmarkStyle = options.landmark;
    if (options.ambient) ambientStyle = options.ambient;
    customPlatformStyle = options.platformPalette || null;
  }

  function getThemeName() {
    return targetName;
  }

  function getLandmarkStyle() {
    return landmarkStyle;
  }

  function getPlatformStyle() {
    if (customPlatformStyle) return customPlatformStyle;
    const p = TIME_PRESETS[targetName];
    return {
      top: p.platformTop,
      topRim: p.platformTopRim,
      body: p.platformBody,
      trim: p.platformTrim,
    };
  }

  function update(dt) {
    const target = TIME_PRESETS[targetName];
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

    for (let i = 0; i < clouds.length; i++) {
      clouds[i].x += clouds[i].speed * dt;
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

    // 3. Sun (Sunrise / Sunset)
    if (current.sunAlpha > 0.02) {
      const sunX = width * current.sunXRatio - cameraX * 0.03;
      const sunY = height * current.sunYRatio - cameraY * 0.02;
      const r = current.sunRadius;

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

    // 12. World-Matched Ambient Particles (Fireflies / Petals / Sun Motes)
    renderAmbientParticles(ctx, width, height, time);
  }

  return {
    setTheme,
    getThemeName,
    getLandmarkStyle,
    getPlatformStyle,
    update,
    render,
  };
}
