/**
 * src/companion-cat.js
 * Loyal Storybook Companion Cat ("Mimi") for "Around the World with Nadine".
 *
 * Features:
 * - Discovered early in World 1 along the village trail; accompanies Madjid & Nadine
 *   across Worlds 1..5, Lobby Camp Overlook, and the Grand Wedding Arch ceremony.
 * - Smooth follow & platform-hop physics, plus Space & Underwater bubble-helmet glide.
 * - Idle animations (sit, stretch, purr, nuzzle), heart reactions near the couple,
 *   and subtle ear-twitch alert cues near armed/hidden dynamic traps (W3+).
 * - Zero per-frame heap churn and safe checkpoint warp/recovery.
 */

const CAT_W = 22;
const CAT_H = 18;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function approach(cur, target, delta) {
  if (cur < target) return Math.min(cur + delta, target);
  if (cur > target) return Math.max(cur - delta, target);
  return target;
}

function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/**
 * Finds solid landing surface top y directly underneath or overlapping entity horizontally.
 */
function findNearestFloorY(solids, x, w, fromY) {
  let bestY = null;
  const cx1 = x + 3;
  const cx2 = x + w - 3;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (cx2 <= s.x || cx1 >= s.x + s.w) continue;
    if (s.y >= fromY - 6 && (bestY === null || s.y < bestY)) {
      bestY = s.y;
    }
  }
  return bestY;
}

/**
 * Creates initial runtime state for the companion cat on a level.
 * In World 1, the cat waits eagerly just ahead of the village spawn to be discovered.
 * In Worlds 2..5 (or Open World), the cat begins faithfully beside the couple.
 * @param {any} level
 */
export function createCompanionCatState(level) {
  const worldId = Number(level?.worldId) || 1;
  const isW1 = worldId === 1 && !level?.isOpenWorld;
  const madjidSpawn = level?.spawns?.madjid || { x: 70, y: 564 };
  const spawnX = isW1 ? 278 : Math.max(24, madjidSpawn.x - 32);
  const spawnY = isW1 ? 582 : madjidSpawn.y + (36 - CAT_H);
  const mode = level?.physicsMode || 'normal';

  return {
    name: 'Mimi',
    discovered: !isW1,
    discoveryX: spawnX,
    discoveryY: spawnY,
    x: spawnX,
    y: spawnY,
    w: CAT_W,
    h: CAT_H,
    vx: 0,
    vy: 0,
    facing: isW1 ? -1 : 1,
    grounded: !isW1 && mode !== 'space_swim' && mode !== 'underwater' ? false : true,
    mood: isW1 ? 'curious' : 'happy',
    idleAction: isW1 ? 'sit' : 'none', // 'none' | 'sit' | 'stretch' | 'purr' | 'nuzzle'
    idleTimer: 0,
    calmDuration: 0,
    heartTimer: 0,
    heartCooldown: 2.2,
    alertTimer: 0,
    alertTrapId: null,
    alertCooldown: 0,
    walkDist: 0,
    blinkTimer: 1.9,
    jumpCooldown: 0,
    helmetActive: mode === 'space_swim' || mode === 'underwater',
  };
}

/**
 * Warps the companion cat safely near Madjid/Nadine or the active checkpoint.
 * @param {ReturnType<typeof createCompanionCatState>} cat
 * @param {any} state
 */
export function resetCatToTeam(cat, state) {
  if (!cat || !state?.actors) return;
  if (!cat.discovered) return;
  const lead = state.actors.madjid || state.actors.nadine;
  if (!lead) return;
  const worldW = state.worldWidth || 4400;
  cat.x = clamp(lead.x - (lead.facing || 1) * 28, 12, worldW - cat.w - 12);
  cat.y = Math.max(24, lead.y + (lead.h - cat.h));
  cat.vx = 0;
  cat.vy = 0;
  cat.grounded = false;
  cat.alertTimer = 0;
  cat.alertTrapId = null;
}

/**
 * Advances companion cat discovery, follow/swim/hop AI, idle storybook poses,
 * affection heart reactions, and subtle W3+ trap awareness alerts.
 * @param {ReturnType<typeof createCompanionCatState>} cat
 * @param {any} state
 * @param {any} mechState
 * @param {number} dt
 * @param {any} [callbacks]
 * @param {any[] | null} [solidsCache]
 */
export function stepCompanionCat(cat, state, mechState, dt, callbacks = {}, solidsCache = null) {
  if (!cat || !state?.actors || dt <= 0 || state.completed || state.gameOver) return;

  const madjid = state.actors.madjid;
  const nadine = state.actors.nadine;
  if (!madjid || !nadine) return;

  const mode = state.physicsMode || 'normal';
  cat.helmetActive = mode === 'space_swim' || mode === 'underwater';

  // Blink timer
  cat.blinkTimer -= dt;
  if (cat.blinkTimer <= -0.13) {
    cat.blinkTimer = 2.0 + ((cat.walkDist % 7) * 0.25);
  }

  cat.heartCooldown = Math.max(0, cat.heartCooldown - dt);
  cat.alertCooldown = Math.max(0, cat.alertCooldown - dt);
  cat.jumpCooldown = Math.max(0, cat.jumpCooldown - dt);
  if (cat.heartTimer > 0) cat.heartTimer = Math.max(0, cat.heartTimer - dt);
  if (cat.alertTimer > 0) {
    cat.alertTimer = Math.max(0, cat.alertTimer - dt);
    if (cat.alertTimer <= 0) cat.alertTrapId = null;
  }

  const mCx = madjid.x + madjid.w * 0.5;
  const mCy = madjid.y + madjid.h * 0.5;
  const nCx = nadine.x + nadine.w * 0.5;
  const nCy = nadine.y + nadine.h * 0.5;
  const catCx = cat.x + cat.w * 0.5;
  const catCy = cat.y + cat.h * 0.5;

  // 1. World 1 Discovery Check
  if (!cat.discovered) {
    const distM = Math.hypot(mCx - catCx, mCy - catCy);
    const distN = Math.hypot(nCx - catCx, nCy - catCy);
    cat.facing = mCx < catCx ? -1 : 1;
    cat.idleAction = 'sit';
    cat.idleTimer += dt;
    if (Math.min(distM, distN) <= 74 || Math.max(madjid.x, nadine.x) > cat.x + 80) {
      cat.discovered = true;
      cat.mood = 'happy';
      cat.idleAction = 'purr';
      cat.heartTimer = 2.2;
      cat.vy = -210;
      cat.grounded = false;
      callbacks.onCatDiscovered?.(cat);
    }
    return;
  }

  // 2. Determine Follow Target (stay playfully beside trailing partner or midpoint)
  const lead = mCx >= nCx ? madjid : nadine;
  const trail = mCx >= nCx ? nadine : madjid;
  const teamSpread = Math.abs(mCx - nCx);
  const anchor = teamSpread > 180 ? lead : trail;
  const desiredOffset = (anchor.facing || 1) * -36;
  const targetX = clamp(
    anchor.x + anchor.w * 0.5 - cat.w * 0.5 + desiredOffset,
    12,
    Math.max(24, (state.worldWidth || 4400) - cat.w - 12)
  );
  const targetY = anchor.y + anchor.h - cat.h;

  const dx = targetX - cat.x;
  const dy = targetY - cat.y;
  const distToAnchor = Math.hypot(dx, dy);

  // Safety recovery if separated too far or fell out of world
  if (distToAnchor > 440 || cat.y > (state.worldHeight || 720) + 60) {
    resetCatToTeam(cat, state);
  }

  // 3. Movement Physics (Space Swim / Underwater vs Normal Platforming)
  const solids = solidsCache || [
    ...(state.platforms || []),
    ...(state.movingPlatforms || []),
    ...(state.gates || []).filter((g) => g.openProgress < 0.88),
  ];

  if (mode === 'space_swim' || mode === 'underwater') {
    const floatTargetY = anchor.y + 4;
    const fdy = floatTargetY - cat.y;
    const desiredVx = Math.abs(dx) > 14 ? clamp(dx * 3.1, -225, 225) : 0;
    const desiredVy = Math.abs(fdy) > 10 ? clamp(fdy * 2.8, -165, 165) : Math.sin(state.elapsed * 3.2) * 14;
    cat.vx = approach(cat.vx, desiredVx, 680 * dt);
    cat.vy = approach(cat.vy, desiredVy, 560 * dt);
    cat.x = clamp(cat.x + cat.vx * dt, 8, (state.worldWidth || 4400) - cat.w - 8);
    cat.y = clamp(cat.y + cat.vy * dt, 24, (state.worldHeight || 720) - cat.h - 24);
    cat.grounded = false;
    if (Math.abs(cat.vx) > 12) {
      cat.facing = cat.vx > 0 ? 1 : -1;
      cat.walkDist += Math.abs(cat.vx) * dt * 0.5;
    }
  } else {
    const maxSpeed = distToAnchor > 170 ? 285 : 225;
    const desiredVx = Math.abs(dx) > 16 ? Math.sign(dx) * Math.min(maxSpeed, Math.abs(dx) * 4.2) : 0;
    cat.vx = approach(cat.vx, desiredVx, 1450 * dt);
    if (Math.abs(cat.vx) > 12) {
      cat.facing = cat.vx > 0 ? 1 : -1;
    }

    // Jump when partner is higher or wall blocks path
    const needStepHop = cat.grounded && cat.jumpCooldown <= 0 && (dy < -36 && Math.abs(dx) < 160);
    if (needStepHop) {
      cat.vy = -425;
      cat.grounded = false;
      cat.jumpCooldown = 0.55;
    }

    cat.vy = Math.min(720, cat.vy + 1180 * dt);

    // Horizontal step + wall hop assist
    cat.x = clamp(cat.x + cat.vx * dt, 8, (state.worldWidth || 4400) - cat.w - 8);
    let blockedHoriz = false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (rectsOverlap(cat, s)) {
        blockedHoriz = true;
        if (cat.vx > 0) cat.x = s.x - cat.w;
        else if (cat.vx < 0) cat.x = s.x + s.w;
        cat.vx = 0;
      }
    }
    if (blockedHoriz && cat.grounded && cat.jumpCooldown <= 0) {
      cat.vy = -435;
      cat.grounded = false;
      cat.jumpCooldown = 0.45;
    }

    // Vertical step
    const prevBottom = cat.y + cat.h;
    cat.y += cat.vy * dt;
    cat.grounded = false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!rectsOverlap(cat, s)) continue;
      if (cat.vy >= 0 && prevBottom <= s.y + 18) {
        cat.y = s.y - cat.h;
        cat.vy = 0;
        cat.grounded = true;
      } else if (cat.vy < 0 && cat.y >= s.y + s.h - 18) {
        cat.y = s.y + s.h;
        cat.vy = 0;
      }
    }

    // Hazard-pit safety hop if cat's landing x is over active lava/spikes
    if (cat.grounded && Array.isArray(state.hazards)) {
      const probe = { x: cat.x + 2, y: cat.y + cat.h - 2, w: cat.w - 4, h: 10 };
      const overHazard = state.hazards.some((hz) => rectsOverlap(probe, hz));
      if (overHazard && cat.jumpCooldown <= 0) {
        cat.vy = -390;
        cat.grounded = false;
        cat.jumpCooldown = 0.55;
      }
    }

    // If no floor right beneath and dropping past ground level, soft-snap to nearest safe floor
    if (!cat.grounded && cat.vy > 360) {
      const floorY = findNearestFloorY(solids, cat.x, cat.w, cat.y + cat.h - 14);
      if (floorY === null && cat.y > (state.worldHeight || 720) - 40) {
        resetCatToTeam(cat, state);
      }
    }

    if (cat.grounded && Math.abs(cat.vx) > 8) {
      cat.walkDist += Math.abs(cat.vx) * dt;
    }
  }

  // 4. Subtle World 3+ Trap Awareness (Non-intrusive ear twitch + tiny cue)
  const worldId = Number(state.worldId) || 1;
  if (worldId >= 3 && Array.isArray(state.dynamicTraps) && state.dynamicTraps.length > 0 && cat.alertCooldown <= 0) {
    let closestTrap = null;
    let closestDist = 115;
    for (let i = 0; i < state.dynamicTraps.length; i++) {
      const tr = state.dynamicTraps[i];
      if (!tr || tr.phase === 'collapsed' || tr.phase === 'cooldown') continue;
      const tCx = tr.x + (tr.w || 32) * 0.5;
      const tCy = tr.y + (tr.h || 20) * 0.5;
      const dLead = Math.hypot(tCx - mCx, tCy - mCy);
      const dNadine = Math.hypot(tCx - nCx, tCy - nCy);
      const dMin = Math.min(dLead, dNadine);
      if (dMin < closestDist) {
        closestDist = dMin;
        closestTrap = tr;
      }
    }
    if (closestTrap) {
      cat.alertTimer = 1.65;
      cat.alertCooldown = 7.0;
      cat.alertTrapId = closestTrap.id || closestTrap.kind;
      cat.mood = 'alert';
      cat.idleAction = 'none';
      callbacks.onCatTrapAlert?.(cat, closestTrap);
    }
  }

  // 5. Affection / Soul-Link Heart Reaction
  const coupleClose = Boolean(mechState?.soulLink?.active || state.kissTimer > 0);
  if (coupleClose && cat.heartCooldown <= 0 && distToAnchor < 140) {
    cat.heartTimer = 1.9;
    cat.heartCooldown = 6.5;
    cat.mood = 'purring';
    callbacks.onCatHeart?.(cat);
  }

  // 6. Idle Pose Machine when calmly stationary near team
  const moving = Math.abs(cat.vx) > 16 || Math.abs(cat.vy) > 35;
  if (moving) {
    cat.calmDuration = 0;
    cat.idleAction = 'none';
    if (cat.alertTimer <= 0) cat.mood = cat.heartTimer > 0 ? 'purring' : 'happy';
  } else {
    cat.calmDuration += dt;
    cat.idleTimer += dt;
    if (cat.alertTimer <= 0) {
      if (coupleClose) {
        cat.idleAction = Math.floor(cat.idleTimer * 0.45) % 2 === 0 ? 'purr' : 'nuzzle';
        cat.mood = 'purring';
      } else if (cat.calmDuration > 3.2) {
        cat.idleAction = 'stretch';
        cat.mood = 'sleepy';
      } else if (cat.calmDuration > 0.7) {
        cat.idleAction = 'sit';
        cat.mood = 'happy';
      } else {
        cat.idleAction = 'none';
      }
    }
  }
}

/**
 * Renders the expressive storybook companion cat onto Canvas2D.
 * Works both inside levels (`renderCompanionCat(ctx, cat, state, time)`)
 * and at fixed coordinates in the Lobby Camp (`renderCompanionCat(ctx, lobbyCat, null, time)`).
 */
export function renderCompanionCat(ctx, cat, state, time = 0) {
  if (!ctx || !cat) return;
  const cx = cat.x + cat.w * 0.5;
  const bottomY = cat.y + cat.h;
  const facing = cat.facing || 1;
  const moving = Math.abs(cat.vx || 0) > 16;
  const stretchAmt = cat.idleAction === 'stretch' ? Math.sin(time * 2.4) * 0.08 + 0.08 : 0;
  const purrBob = cat.idleAction === 'purr' || cat.idleAction === 'nuzzle' ? Math.sin(time * 9) * 0.7 : 0;
  const sitSquat = cat.idleAction === 'sit' ? 0.92 : 1;
  const walkBob = moving ? Math.abs(Math.sin((cat.walkDist || 0) * 0.24)) * 2.2 : 0;

  ctx.save();
  ctx.translate(cx, bottomY - walkBob + purrBob);

  // Subtle ambient warm rim under bell/coat
  if (!cat.discovered && state) {
    const pulse = 15 + Math.sin(time * 4) * 3;
    ctx.fillStyle = 'rgba(253, 224, 71, 0.22)';
    ctx.beginPath();
    ctx.ellipse(0, -8, pulse, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.scale(facing * (1 + stretchAmt), sitSquat * (1 - stretchAmt * 0.45));

  // Animated curled tail
  const tailWag = cat.mood === 'alert' ? Math.sin(time * 14) * 0.25 : Math.sin(time * 3.4 + cx * 0.02) * 0.32;
  ctx.save();
  ctx.translate(-8, -7);
  ctx.rotate(-0.35 + tailWag);
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 4.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-8, -6, -6, -13);
  ctx.stroke();
  ctx.strokeStyle = '#F59E56';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-8, -6, -6, -13);
  ctx.stroke();
  // Cream tail tip
  ctx.fillStyle = '#FFF3D6';
  ctx.beginPath();
  ctx.arc(-6, -13, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Back paws & animated trot paws
  const stepOff = moving ? Math.sin((cat.walkDist || 0) * 0.24) * 2.5 : 0;
  ctx.fillStyle = '#FFF3D6';
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(-4.5 - stepOff, -1.6, 2.7, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(4.5 + stepOff, -1.6, 2.7, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Plump ginger-cream body
  const bodyGrad = ctx.createLinearGradient(-8, -14, 8, 0);
  bodyGrad.addColorStop(0, '#FDBA74');
  bodyGrad.addColorStop(1, '#EA7C38');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.ellipse(-1, -7.5, 9.2, 6.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cream chest bib + tiger stripes
  ctx.fillStyle = '#FFF5E1';
  ctx.beginPath();
  ctx.ellipse(5, -6.5, 3.6, 4.2, 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#B45309';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-4, -12.5);
  ctx.lineTo(-3, -9.5);
  ctx.moveTo(-1, -13);
  ctx.lineTo(-0.5, -10);
  ctx.stroke();

  // Round expressive head
  const headX = 5.5;
  const headY = -12.5;
  ctx.save();
  ctx.translate(headX, headY);
  if (cat.mood === 'alert') {
    ctx.rotate(-0.08);
  }

  // Ears (back & front) with twitch animation when alert
  const twitch = cat.mood === 'alert' ? Math.sin(time * 22) * 1.4 : 0;
  ctx.fillStyle = '#FDBA74';
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 1.7;
  // Back ear
  ctx.beginPath();
  ctx.moveTo(-4.8, -3.5);
  ctx.lineTo(-6.2, -9.8 + twitch);
  ctx.lineTo(-0.8, -5.8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Front ear
  ctx.beginPath();
  ctx.moveTo(0.8, -5.8);
  ctx.lineTo(4.6, -10.2 - twitch * 0.6);
  ctx.lineTo(5.6, -3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Inner pink ear triangles
  ctx.fillStyle = '#FDA4AF';
  ctx.beginPath();
  ctx.moveTo(1.8, -5.6);
  ctx.lineTo(4.1, -8.5 - twitch * 0.4);
  ctx.lineTo(4.6, -4.4);
  ctx.closePath();
  ctx.fill();

  // Head silhouette + sunlit rim highlight
  const headGrad = ctx.createRadialGradient(-2, -3, 1, 0, 0, 8);
  headGrad.addColorStop(0, '#FED7AA');
  headGrad.addColorStop(1, '#F59E56');
  ctx.fillStyle = headGrad;
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.8, 5.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Eyes (blinking / happy curve / alert wide)
  const isBlinking = cat.blinkTimer <= 0 || cat.mood === 'purring' || cat.mood === 'sleepy';
  if (isBlinking) {
    ctx.strokeStyle = '#2B1B2E';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(-1.2, -0.2, 1.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.0, -0.2, 1.5, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#1E1B2E';
    const eyeR = cat.mood === 'alert' ? 1.55 : 1.3;
    ctx.beginPath();
    ctx.arc(-1.0, -0.6, eyeR, 0, Math.PI * 2);
    ctx.arc(3.1, -0.6, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-1.4, -1.0, 0.5, 0, Math.PI * 2);
    ctx.arc(2.7, -1.0, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tiny pink nose + whiskers + rosy cheeks
  ctx.fillStyle = '#F472B6';
  ctx.beginPath();
  ctx.arc(1.2, 1.4, 1.0, 0, Math.PI * 2);
  ctx.fill();

  if (cat.mood === 'purring' || cat.mood === 'happy') {
    ctx.fillStyle = 'rgba(244, 114, 182, 0.45)';
    ctx.beginPath();
    ctx.arc(-3.1, 1.8, 1.4, 0, Math.PI * 2);
    ctx.arc(4.4, 1.8, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(43, 27, 46, 0.55)';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-3.2, 1.1);
  ctx.lineTo(-6.4, 0.6);
  ctx.moveTo(-3.2, 2.1);
  ctx.lineTo(-6.2, 2.5);
  ctx.moveTo(4.2, 1.1);
  ctx.lineTo(7.4, 0.6);
  ctx.moveTo(4.2, 2.1);
  ctx.lineTo(7.2, 2.5);
  ctx.stroke();

  ctx.restore();

  // Tiny red ribbon collar & golden bell
  ctx.strokeStyle = '#E11D48';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(2, -7.8);
  ctx.quadraticCurveTo(5.2, -6.4, 8, -8);
  ctx.stroke();
  ctx.fillStyle = '#FDE047';
  ctx.strokeStyle = '#2B1B2E';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(5.5, -6.2, 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Translucent Astro / Aqua Bubble Helmet in Space & Ocean World
  if (cat.helmetActive) {
    ctx.strokeStyle = 'rgba(186, 230, 253, 0.88)';
    ctx.fillStyle = 'rgba(186, 230, 253, 0.16)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(5.4, -12.5, 9.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(3.6, -15.2, 5.2, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
  }

  ctx.restore();

  // Unflipped World-Space Floating Reactions (Discovery prompt / Heart / W3+ Trap Warning)
  if (!cat.discovered && state) {
    const bob = Math.sin(time * 4) * 2.5;
    ctx.save();
    ctx.font = '700 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(16, 18, 34, 0.88)';
    ctx.strokeText('Meow? ♥', cx, cat.y - 11 + bob);
    ctx.fillStyle = '#FDE68A';
    ctx.fillText('Meow? ♥', cx, cat.y - 11 + bob);
    ctx.restore();
  } else if (cat.alertTimer > 0) {
    const bob = Math.sin(time * 16) * 1.5;
    ctx.save();
    ctx.fillStyle = '#FEF08A';
    ctx.strokeStyle = '#1E1B2E';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cat.y - 16 + bob, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#DC2626';
    ctx.font = '800 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, cat.y - 15.5 + bob);
    ctx.restore();
  } else if (cat.heartTimer > 0) {
    const rise = (1.9 - Math.min(1.9, cat.heartTimer)) * 8;
    ctx.save();
    ctx.translate(cx, cat.y - 13 - rise * 0.4);
    ctx.fillStyle = '#F472B6';
    ctx.strokeStyle = '#1E1B2E';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 3.2);
    ctx.bezierCurveTo(-5, -1, -3, -6, 0, -2.6);
    ctx.bezierCurveTo(3, -6, 5, -1, 0, 3.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
