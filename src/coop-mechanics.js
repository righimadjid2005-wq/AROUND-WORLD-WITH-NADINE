/**
 * src/coop-mechanics.js
 * Unified Cooperative, Separation Penalty, Expressive & Synergy Mechanics
 * shared identically across Story Mode, 2D Open-World Mode, Solo & Online Co-op:
 *
 * 1. Dynamic Co-op Camera Zoom (frames both players smoothly as separation increases)
 * 2. Separation Warning Banner + Grotesque Ugly Ghost Chase + Visceral Shock Effect
 *    + Outcome A (Ghost Slap & Automatic Panic-Run Back)
 *    + Outcome B (Ghost Devour, Carry to Partner, Cartoon Bones Drop & Normal Respawn)
 * 3. Partner Carry ("Carrying Nadine" / Partner Lift, Hold & Toss)
 * 4. 8 Solo Dances + Co-op Synced Dance Invite (Accept / Decline)
 * 5. 5 Low-Frequency Rare Synchronized Idle Co-op Interactions
 * 6. Soul-Link Synergy Aura (+Speed/+Jump) & Cooperative Edge Rescue
 */

export const GHOST_CONFIG = {
  WARN_MIN: 350,
  WARN_MAX: 460,
  SPAWN_MIN: 485,
  SPAWN_MAX: 650,
  CHASE_SPEED: 380,
  CATCH_RADIUS: 34,
  SHOCK_DURATION: 0.48,
  PANIC_SPEED: 460,
  PANIC_MAX_TIME: 4.5,
  REUNITE_RADIUS: 64,
  DEVOUR_FLY_SPEED: 520,
  BONES_LIFETIME: 4.2,
  COOLDOWN_AFTER_PENALTY: 6.5,
};

export const CARRY_CONFIG = {
  PICKUP_RADIUS: 72,
  HEAD_OFFSET_Y: 34,
  TOSS_VX: 145,
  TOSS_VY: -245,
};

export const SOUL_LINK_CONFIG = {
  AURA_RADIUS: 118,
  SPEED_MULT: 1.12,
  JUMP_MULT: 1.06,
  RESCUE_MAX_DIST: 155,
  RESCUE_MIN_FALL_VY: 190,
};

export const DANCES = [
  { id: 'waltz', name: 'Starlight Waltz', tempo: 5.2, duration: 5.5, icon: '💃' },
  { id: 'hop', name: 'Joyful Hop', tempo: 7.4, duration: 4.5, icon: '✨' },
  { id: 'disco', name: 'Lantern Disco', tempo: 8.2, duration: 5.2, icon: '🕺' },
  { id: 'moonwalk', name: 'Moonbeam Glide', tempo: 5.8, duration: 4.8, icon: '🌙' },
  { id: 'spin', name: 'Whirlwind Twirl', tempo: 7.8, duration: 4.5, icon: '🌀' },
  { id: 'wave_arms', name: 'Happy Wave', tempo: 6.8, duration: 4.5, icon: '🙌' },
  { id: 'skip', name: 'Meadow Skip', tempo: 7.2, duration: 5.0, icon: '🌼' },
  { id: 'celebrate', name: 'Wedding Cheer', tempo: 8.8, duration: 5.5, icon: '🎉' },
];

export const IDLE_COOP_INTERACTIONS = [
  { id: 'nose_boop', label: 'Boop!', duration: 2.3, color: '#F9A8D4' },
  { id: 'peekaboo_hug', label: 'Cozy Hug ♥', duration: 2.6, color: '#FDA4AF' },
  { id: 'stargaze_lean', label: 'Stargazing ✨', duration: 3.0, color: '#FDE68A' },
  { id: 'silly_tickle', label: 'Giggle Tickle!', duration: 2.4, color: '#93C5FD' },
  { id: 'sync_heart_hop', label: 'Heart Sync! ♥', duration: 2.5, color: '#F472B6' },
];

export const IDLE_SPECIAL_CONFIG = {
  STILL_THRESHOLD_SEC: 10.0,
  COOLDOWN_SEC: 42.0,
  MAX_PAIR_DIST: 82,
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function createMechanicsState() {
  return {
    carrying: null, // { carrierId: 'madjid'|'nadine', carriedId: 'nadine'|'madjid' } | null
    ghost: {
      active: false,
      warningActive: false,
      separationDist: 0,
      warnDist: GHOST_CONFIG.WARN_MAX,
      spawnDist: GHOST_CONFIG.SPAWN_MAX,
      phase: 'idle', // 'idle' | 'chase' | 'shock' | 'slap_run' | 'devour_fly'
      outcome: null, // 'slap' | 'devour'
      nextOutcomeFlip: 0,
      strayId: null,
      targetId: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      facing: 1,
      timer: 0,
      animTime: 0,
      flashAlpha: 0,
      slapCalloutTimer: 0,
      slapCalloutX: 0,
      slapCalloutY: 0,
      cooldown: 0,
      bones: [], // [{ x, y, life, maxLife, rot, kind }]
    },
    soulLink: {
      active: false,
      dist: 0,
      rescueCandidate: null, // { rescuerId, fallingId, dist } | null
      rescueCooldown: 0,
    },
    dances: {
      madjid: null, // { style, name, tempo, timer, beatAccum, stepCount } | null
      nadine: null,
      invite: null, // { fromId, style, name, expiresAt } | null
    },
    idleSpecial: {
      active: false,
      id: null,
      label: '',
      color: '#F9A8D4',
      stillTimer: 0,
      timer: 0,
      cooldown: 8,
      nextIndex: 0,
    },
  };
}

/**
 * Computes responsive viewport framing & dynamic Co-op Camera Zoom so both Madjid & Nadine
 * stay inside the viewport even when separated across Story Mode or 2D Open-World Mode.
 */
export function computeDynamicCoopCamera({
  viewW,
  viewH,
  worldW,
  worldH,
  madjid,
  nadine,
  activeCharId = 'madjid',
  ghostState = null,
}) {
  const scaleY = viewH / worldH;
  const scaleX = viewW / worldW;
  const isNarrow = viewW < 820;

  const baseScale = isNarrow
    ? Math.max(scaleX * 1.45, Math.min(scaleY * 0.72, 0.85))
    : Math.min(Math.max(scaleX, scaleY * 0.88), scaleY * 1.04);

  if (!madjid || !nadine) {
    const visibleW = viewW / baseScale;
    const visibleH = viewH / baseScale;
    return {
      scale: baseScale,
      zoomFactor: 1,
      visibleW,
      visibleH,
      maxCamX: Math.max(0, worldW - visibleW),
      maxCamY: Math.max(0, worldH - visibleH),
      focusX: 0,
      focusY: 0,
    };
  }

  const mPos = {
    x: madjid.x + madjid.w * 0.5,
    y: madjid.y + madjid.h * 0.5,
  };
  const nPos = {
    x: nadine.x + nadine.w * 0.5,
    y: nadine.y + nadine.h * 0.5,
  };

  // If one player is swallowed inside ghost, track ghost for that position!
  if (ghostState && ghostState.active && ghostState.phase === 'devour_fly') {
    if (ghostState.strayId === 'madjid') {
      mPos.x = ghostState.x;
      mPos.y = ghostState.y;
    } else if (ghostState.strayId === 'nadine') {
      nPos.x = ghostState.x;
      nPos.y = ghostState.y;
    }
  }

  const dx = Math.abs(mPos.x - nPos.x);
  const dy = Math.abs(mPos.y - nPos.y);

  // Required span to keep both players comfortably framed with generous padding
  const padX = isNarrow ? 200 : 280;
  const padY = 190;
  const neededW = dx + padX;
  const neededH = dy + padY;

  const baseVisW = viewW / baseScale;
  const baseVisH = viewH / baseScale;

  const sepDist = Math.hypot(dx, dy);
  let zoomFactor = 1;
  if (sepDist > 140) {
    zoomFactor = clamp(1 - ((sepDist - 140) / 1400) * 0.24, 0.72, 1);
  }
  if (neededW > baseVisW || neededH > baseVisH) {
    const fitScale = Math.min(viewW / neededW, viewH / neededH);
    zoomFactor = Math.min(zoomFactor, clamp(fitScale / baseScale, 0.42, 1));
  }

  const scale = Math.max(scaleX, baseScale * zoomFactor);
  const visibleW = viewW / scale;
  const visibleH = viewH / scale;

  const activeActor = activeCharId === 'nadine' ? nPos : mPos;
  const midX = (mPos.x + nPos.x) * 0.5;
  const midY = (mPos.y + nPos.y) * 0.5;

  // Blend focus between active player (when close) and midpoint (as they spread apart)
  const sepRatio = clamp(Math.hypot(dx, dy) / 280, 0, 1);
  const focusX = activeActor.x * (1 - sepRatio * 0.85) + midX * (sepRatio * 0.85);
  const focusY = activeActor.y * (1 - sepRatio * 0.85) + midY * (sepRatio * 0.85);

  return {
    scale,
    zoomFactor: scale / baseScale,
    visibleW,
    visibleH,
    maxCamX: Math.max(0, worldW - visibleW),
    maxCamY: Math.max(0, worldH - visibleH),
    focusX,
    focusY,
  };
}

// =========================================================================
// PARTNER CARRY SYSTEM ("Carrying Nadine" / Carrying Partner)
// =========================================================================

export function canCarryPartner(mechState, levelState, carrierId) {
  if (!mechState || !levelState || levelState.completed) return false;
  if (mechState.ghost.active && (mechState.ghost.phase === 'shock' || mechState.ghost.phase === 'devour_fly' || mechState.ghost.phase === 'slap_run')) {
    return false;
  }
  const carriedId = carrierId === 'madjid' ? 'nadine' : 'madjid';
  const carrier = levelState.actors[carrierId];
  const partner = levelState.actors[carriedId];
  if (!carrier || !partner) return false;
  if (carrier.hurtTimer > 0 || partner.hurtTimer > 0) return false;

  if (mechState.carrying && mechState.carrying.carrierId === carrierId) {
    return true;
  }
  if (mechState.carrying) return false;

  const dist = Math.hypot(
    carrier.x + carrier.w * 0.5 - (partner.x + partner.w * 0.5),
    carrier.y + carrier.h * 0.5 - (partner.y + partner.h * 0.5)
  );
  return dist <= CARRY_CONFIG.PICKUP_RADIUS;
}

export function toggleCarry(mechState, levelState, carrierId) {
  if (!mechState || !levelState) return { ok: false };
  const carriedId = carrierId === 'madjid' ? 'nadine' : 'madjid';
  const carrier = levelState.actors[carrierId];
  const partner = levelState.actors[carriedId];
  if (!carrier || !partner) return { ok: false };

  // Release if already carrying
  if (mechState.carrying) {
    if (mechState.carrying.carrierId !== carrierId) return { ok: false };
    mechState.carrying = null;
    partner.carriedBy = null;
    partner.vx = (carrier.facing || 1) * CARRY_CONFIG.TOSS_VX;
    partner.vy = CARRY_CONFIG.TOSS_VY;
    partner.grounded = false;
    partner.scaleX = 0.86;
    partner.scaleY = 1.15;
    carrier.scaleX = 1.1;
    carrier.scaleY = 0.92;
    return { ok: true, action: 'drop', carrierId, carriedId };
  }

  if (!canCarryPartner(mechState, levelState, carrierId)) {
    return { ok: false, reason: 'TOO_FAR' };
  }

  mechState.carrying = { carrierId, carriedId };
  partner.carriedBy = carrierId;
  partner.vx = 0;
  partner.vy = 0;
  partner.grounded = false;
  partner.ridingPlatformId = null;
  carrier.scaleX = 1.12;
  carrier.scaleY = 0.88;
  syncCarriedActor(mechState, levelState);
  return { ok: true, action: 'pickup', carrierId, carriedId };
}

export function cancelCarry(mechState, levelState) {
  if (!mechState || !mechState.carrying) return false;
  const { carriedId } = mechState.carrying;
  mechState.carrying = null;
  const carried = levelState?.actors?.[carriedId];
  if (carried) carried.carriedBy = null;
  return true;
}

export function syncCarriedActor(mechState, levelState) {
  if (!mechState || !mechState.carrying || !levelState) return;
  const { carrierId, carriedId } = mechState.carrying;
  const carrier = levelState.actors[carrierId];
  const carried = levelState.actors[carriedId];
  if (!carrier || !carried || carrier.hurtTimer > 0 || carried.hurtTimer > 0) {
    cancelCarry(mechState, levelState);
    return;
  }
  carried.x = clamp(carrier.x, 4, levelState.worldWidth - carried.w - 4);
  carried.y = Math.max(4, carrier.y - CARRY_CONFIG.HEAD_OFFSET_Y);
  carried.vx = carrier.vx;
  carried.vy = 0;
  carried.facing = carrier.facing;
  carried.grounded = false;
  carried.carriedBy = carrierId;
  carried.mood = carried.mood === 'shocked' ? 'shocked' : 'happy';
}

// =========================================================================
// SOUL-LINK SYNERGY AURA & COOPERATIVE EDGE RESCUE
// =========================================================================

export function stepSoulLinkAndRescue(mechState, levelState, dt) {
  const sl = mechState.soulLink;
  if (sl.rescueCooldown > 0) sl.rescueCooldown = Math.max(0, sl.rescueCooldown - dt);

  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;
  if (!madjid || !nadine || levelState.completed) {
    sl.active = false;
    sl.rescueCandidate = null;
    return sl;
  }

  const dist = Math.hypot(
    madjid.x + madjid.w * 0.5 - (nadine.x + nadine.w * 0.5),
    madjid.y + madjid.h * 0.5 - (nadine.y + nadine.h * 0.5)
  );
  sl.dist = dist;

  const healthyBoth = madjid.hurtTimer <= 0 && nadine.hurtTimer <= 0 && !mechState.ghost.active;
  sl.active = healthyBoth && dist <= SOUL_LINK_CONFIG.AURA_RADIUS;

  // Detect edge rescue opportunity (one slipping/falling fast while partner is safe nearby)
  sl.rescueCandidate = null;
  if (healthyBoth && sl.rescueCooldown <= 0 && !mechState.carrying && dist <= SOUL_LINK_CONFIG.RESCUE_MAX_DIST) {
    const checkPair = (rescuer, falling) => {
      if (!rescuer.grounded || falling.grounded) return null;
      const nearHazard = (levelState.hazards || []).some(
        (hz) =>
          falling.x + falling.w > hz.x - 18 &&
          falling.x < hz.x + hz.w + 18 &&
          falling.y + falling.h <= hz.y + 12 &&
          hz.y - (falling.y + falling.h) < 95
      );
      const lowOverVoid = falling.y > levelState.worldHeight - 165;
      if (falling.vy >= SOUL_LINK_CONFIG.RESCUE_MIN_FALL_VY || nearHazard || lowOverVoid) {
        return { rescuerId: rescuer.id, fallingId: falling.id, dist };
      }
      return null;
    };
    sl.rescueCandidate = checkPair(madjid, nadine) || checkPair(nadine, madjid);
  }

  return sl;
}

export function triggerEdgeRescue(mechState, levelState, rescuerId) {
  const cand = mechState.soulLink.rescueCandidate;
  if (!cand || (rescuerId && cand.rescuerId !== rescuerId)) {
    return { ok: false };
  }
  const rescuer = levelState.actors[cand.rescuerId];
  const falling = levelState.actors[cand.fallingId];
  if (!rescuer || !falling) return { ok: false };

  falling.x = clamp(
    rescuer.x + (rescuer.facing || 1) * 14,
    8,
    levelState.worldWidth - falling.w - 8
  );
  falling.y = Math.max(8, rescuer.y - 36);
  falling.vx = 0;
  falling.vy = -210;
  falling.invulnTimer = Math.max(falling.invulnTimer, 0.9);
  falling.scaleX = 0.84;
  falling.scaleY = 1.18;
  falling.mood = 'happy';
  rescuer.scaleX = 1.14;
  rescuer.scaleY = 0.88;

  mechState.soulLink.rescueCooldown = 1.6;
  mechState.soulLink.rescueCandidate = null;
  return { ok: true, rescuerId: cand.rescuerId, rescuedId: cand.fallingId };
}

// =========================================================================
// SEPARATION WARNING BANNER, UGLY GHOST, SHOCK EFFECT & 2 OUTCOMES
// =========================================================================

export function getGhostThresholds(worldWidth) {
  const warnDist = clamp(Math.round(worldWidth * 0.34), GHOST_CONFIG.WARN_MIN, GHOST_CONFIG.WARN_MAX);
  const spawnDist = clamp(Math.round(worldWidth * 0.46), GHOST_CONFIG.SPAWN_MIN, GHOST_CONFIG.SPAWN_MAX);
  return { warnDist, spawnDist };
}

export function stepGhostSystem(mechState, levelState, dt, options = {}, callbacks = {}) {
  const g = mechState.ghost;
  g.animTime += dt;
  if (g.flashAlpha > 0) g.flashAlpha = Math.max(0, g.flashAlpha - dt * 2.6);
  if (g.slapCalloutTimer > 0) g.slapCalloutTimer = Math.max(0, g.slapCalloutTimer - dt);
  if (g.cooldown > 0) g.cooldown = Math.max(0, g.cooldown - dt);

  // Decay cartoon bone piles
  for (let i = g.bones.length - 1; i >= 0; i--) {
    g.bones[i].life -= dt;
    if (g.bones[i].life <= 0) g.bones.splice(i, 1);
  }

  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;
  if (!madjid || !nadine || levelState.completed) {
    g.warningActive = false;
    return { overrideIntents: null };
  }

  const { warnDist, spawnDist } = getGhostThresholds(levelState.worldWidth);
  g.warnDist = warnDist;
  g.spawnDist = spawnDist;

  // Compute separation distance (0 if carried)
  const sepDist = mechState.carrying
    ? 0
    : Math.hypot(
        madjid.x + madjid.w * 0.5 - (nadine.x + nadine.w * 0.5),
        madjid.y + madjid.h * 0.5 - (nadine.y + nadine.h * 0.5)
      );
  g.separationDist = sepDist;

  // Reunited cleanly before encounter during chase
  if (!g.active) {
    const wasWarn = g.warningActive;
    g.warningActive = sepDist >= warnDist && !options.disableGhost;
    if (g.warningActive && !wasWarn) {
      callbacks.onGhostWarn?.(sepDist);
    }

    if (
      g.warningActive &&
      !options.disableSpawn &&
      sepDist >= spawnDist &&
      g.cooldown <= 0 &&
      madjid.hurtTimer <= 0 &&
      nadine.hurtTimer <= 0
    ) {
      const strayId = options.preferredStrayId === 'nadine' ? 'nadine' : 'madjid';
      const targetId = strayId === 'madjid' ? 'nadine' : 'madjid';
      const stray = levelState.actors[strayId];
      const target = levelState.actors[targetId];
      const spawnSide = stray.x >= target.x ? 1 : -1;

      g.active = true;
      g.phase = 'chase';
      g.strayId = strayId;
      g.targetId = targetId;
      g.outcome = null;
      g.timer = 0;
      g.x = clamp(stray.x + stray.w * 0.5 + spawnSide * 190, 20, levelState.worldWidth - 20);
      g.y = Math.max(40, stray.y - 44);
      g.vx = 0;
      g.vy = 0;
      g.facing = -spawnSide;
      callbacks.onGhostSpawn?.(g);
    }
    return { overrideIntents: null };
  }

  // Active ghost state machine
  const stray = levelState.actors[g.strayId];
  const partner = levelState.actors[g.targetId];
  if (!stray || !partner) {
    g.active = false;
    g.phase = 'idle';
    return { overrideIntents: null };
  }

  g.warningActive = true;

  if (g.phase === 'chase') {
    // If players ran back close enough before ghost caught up, ghost dissipates!
    if (sepDist < warnDist * 0.86) {
      g.active = false;
      g.phase = 'idle';
      g.warningActive = false;
      g.cooldown = 2.0;
      return { overrideIntents: null };
    }

    const sx = stray.x + stray.w * 0.5;
    const sy = stray.y + stray.h * 0.5;
    const dx = sx - g.x;
    const dy = sy - g.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    g.facing = dx >= 0 ? 1 : -1;
    g.vx = (dx / d) * GHOST_CONFIG.CHASE_SPEED;
    g.vy = (dy / d) * GHOST_CONFIG.CHASE_SPEED;
    g.x += g.vx * dt;
    g.y += g.vy * dt;

    if (d <= GHOST_CONFIG.CATCH_RADIUS) {
      // Encounter -> Visceral SHOCK EFFECT first!
      const chosenOutcome =
        options.forcedOutcome === 'slap' || options.forcedOutcome === 'devour'
          ? options.forcedOutcome
          : g.nextOutcomeFlip % 2 === 0
            ? 'slap'
            : 'devour';
      g.nextOutcomeFlip += 1;
      g.phase = 'shock';
      g.outcome = chosenOutcome;
      g.timer = GHOST_CONFIG.SHOCK_DURATION;
      g.flashAlpha = 0.85;
      stray.mood = 'shocked';
      stray.vx = 0;
      stray.vy = 0;
      cancelCarry(mechState, levelState);
      callbacks.onGhostShock?.(stray, g);
    }
    return { overrideIntents: null };
  }

  if (g.phase === 'shock') {
    g.timer -= dt;
    stray.mood = 'shocked';
    stray.vx = 0;
    stray.vy = 0;
    g.x = stray.x + stray.w * 0.5 - g.facing * 24;
    g.y = stray.y + 4;

    if (g.timer <= 0) {
      if (g.outcome === 'slap') {
        // Outcome A: Ghost SLAPS the stray player's behind -> high-speed panic run back to partner!
        g.phase = 'slap_run';
        g.timer = GHOST_CONFIG.PANIC_MAX_TIME;
        g.slapCalloutTimer = 1.2;
        g.slapCalloutX = stray.x + stray.w * 0.5;
        g.slapCalloutY = stray.y - 12;
        stray.mood = 'panic';
        stray.scaleX = 1.24;
        stray.scaleY = 0.78;
        stray.vy = -195;
        callbacks.onGhostSlap?.(stray, partner, g);
      } else {
        // Outcome B: Ghost DEVOURS the stray player -> flies across screen to partner & drops bones!
        g.phase = 'devour_fly';
        g.timer = 3.5;
        stray.devouredByGhost = true;
        stray.vx = 0;
        stray.vy = 0;
        g.x = stray.x + stray.w * 0.5;
        g.y = stray.y + stray.h * 0.5;
        callbacks.onGhostDevour?.(stray, partner, g);
      }
    }

    // Lock movement controls for stray player during shock freeze
    return {
      overrideIntents: {
        [g.strayId]: { left: false, right: false, jumpHeld: false, jumpJustPressed: false, jumpJustReleased: false },
      },
    };
  }

  if (g.phase === 'slap_run') {
    g.timer -= dt;
    const px = partner.x + partner.w * 0.5;
    const sx = stray.x + stray.w * 0.5;
    const toPartner = px - sx;
    const dir = toPartner >= 0 ? 1 : -1;
    stray.mood = 'panic';
    stray.facing = dir;
    stray.vx = dir * GHOST_CONFIG.PANIC_SPEED;

    // Ghost floats menacingly close behind during the panic sprint
    g.x += (sx - dir * 56 - g.x) * Math.min(1, dt * 10);
    g.y += (stray.y + 4 - g.y) * Math.min(1, dt * 10);
    g.facing = dir;

    const nowDist = Math.hypot(px - sx, partner.y - stray.y);
    if (nowDist <= GHOST_CONFIG.REUNITE_RADIUS || Math.abs(toPartner) <= 44 || g.timer <= 0) {
      stray.mood = 'happy';
      stray.invulnTimer = Math.max(stray.invulnTimer, 1.0);
      stray.vx = 0;
      g.active = false;
      g.phase = 'idle';
      g.warningActive = false;
      g.cooldown = GHOST_CONFIG.COOLDOWN_AFTER_PENALTY;
      callbacks.onGhostReunited?.(stray, partner, 'slap');
      return { overrideIntents: null };
    }

    // Automatically run toward partner (and auto-hop small steps if blocked horizontally)
    const blockedStep = Math.abs(stray.vx) < 10 && stray.grounded;
    return {
      overrideIntents: {
        [g.strayId]: {
          left: dir < 0,
          right: dir > 0,
          jumpHeld: blockedStep,
          jumpJustPressed: blockedStep,
          jumpJustReleased: false,
        },
      },
    };
  }

  if (g.phase === 'devour_fly') {
    g.timer -= dt;
    const destX = clamp(partner.x + partner.w * 0.5 + (partner.facing || 1) * 44, 24, levelState.worldWidth - 24);
    const destY = partner.y + 8;
    const dx = destX - g.x;
    const dy = destY - g.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    g.facing = dx >= 0 ? 1 : -1;
    g.x += (dx / d) * GHOST_CONFIG.DEVOUR_FLY_SPEED * dt;
    g.y += (dy / d) * GHOST_CONFIG.DEVOUR_FLY_SPEED * dt;
    stray.devouredByGhost = true;
    stray.x = g.x - stray.w * 0.5;
    stray.y = g.y - stray.h * 0.5;
    stray.vx = 0;
    stray.vy = 0;

    if (d <= 22 || g.timer <= 0) {
      // Drop cartoon bones in front of partner & respawn stray player completely normal!
      stray.devouredByGhost = false;
      stray.x = clamp(destX - stray.w * 0.5, 8, levelState.worldWidth - stray.w - 8);
      stray.y = Math.max(8, partner.y - 6);
      stray.vx = 0;
      stray.vy = -120;
      stray.hurtTimer = 0;
      stray.mood = 'normal';
      stray.invulnTimer = 1.4;
      stray.scaleX = 1.2;
      stray.scaleY = 0.84;

      const boneBaseY = partner.y + partner.h - 4;
      for (let b = 0; b < 5; b++) {
        g.bones.push({
          x: destX + (b - 2) * 11,
          y: boneBaseY - (b % 2) * 4,
          life: GHOST_CONFIG.BONES_LIFETIME,
          maxLife: GHOST_CONFIG.BONES_LIFETIME,
          rot: (b - 2) * 0.38,
          kind: b === 2 ? 'skull' : 'femur',
        });
      }

      g.active = false;
      g.phase = 'idle';
      g.warningActive = false;
      g.cooldown = GHOST_CONFIG.COOLDOWN_AFTER_PENALTY;
      callbacks.onBonesDrop?.(destX, boneBaseY, stray, partner);
    }

    return {
      overrideIntents: {
        [g.strayId]: { left: false, right: false, jumpHeld: false, jumpJustPressed: false, jumpJustReleased: false },
      },
    };
  }

  return { overrideIntents: null };
}

// =========================================================================
// 8 SOLO DANCES + CO-OP SYNCED DANCE INVITE
// =========================================================================

export function startDance(mechState, levelState, actorId, styleId) {
  const def = DANCES.find((d) => d.id === styleId) || DANCES[0];
  const actor = levelState?.actors?.[actorId];
  if (!actor || actor.hurtTimer > 0) return null;

  mechState.dances[actorId] = {
    style: def.id,
    name: def.name,
    tempo: def.tempo,
    timer: def.duration,
    beatAccum: 0,
    stepCount: 0,
  };
  actor.danceStyle = def.id;
  actor.danceTempo = def.tempo;
  return def;
}

export function stopDance(mechState, levelState, actorId) {
  if (mechState.dances[actorId]) {
    mechState.dances[actorId] = null;
  }
  const actor = levelState?.actors?.[actorId];
  if (actor) {
    actor.danceStyle = null;
    actor.danceTempo = 0;
  }
}

export function createDanceInvite(mechState, fromId, styleId) {
  const def = DANCES.find((d) => d.id === styleId) || DANCES[0];
  mechState.dances.invite = {
    fromId,
    style: def.id,
    name: def.name,
    timer: 14,
  };
  return mechState.dances.invite;
}

export function stepDanceSystem(mechState, levelState, inputsByChar, dt, callbacks = {}) {
  ['madjid', 'nadine'].forEach((cid) => {
    const d = mechState.dances[cid];
    const actor = levelState.actors[cid];
    const intent = inputsByChar?.[cid];
    if (!d || !actor) return;

    // Cancel solo/synced dance cleanly on hurt or explicit jump/movement
    if (
      actor.hurtTimer > 0 ||
      actor.mood === 'shocked' ||
      actor.mood === 'panic' ||
      (intent && (intent.left || intent.right || intent.jumpJustPressed))
    ) {
      stopDance(mechState, levelState, cid);
      return;
    }

    d.timer -= dt;
    d.beatAccum += dt * (d.tempo * 0.45);
    if (d.beatAccum >= 1) {
      d.beatAccum -= 1;
      d.stepCount += 1;
      callbacks.onDanceBeat?.(actor, d);
    }
    actor.danceStyle = d.style;
    actor.danceTempo = d.tempo;

    if (d.timer <= 0) {
      stopDance(mechState, levelState, cid);
    }
  });

  if (mechState.dances.invite) {
    mechState.dances.invite.timer -= dt;
    if (mechState.dances.invite.timer <= 0) {
      mechState.dances.invite = null;
    }
  }
}

// =========================================================================
// 5 LOW-FREQUENCY RARE SYNCHRONIZED IDLE CO-OP INTERACTIONS
// =========================================================================

export function stepRareIdleInteractions(mechState, levelState, inputsByChar, dt, callbacks = {}) {
  const sp = mechState.idleSpecial;
  const madjid = levelState.actors.madjid;
  const nadine = levelState.actors.nadine;
  if (!madjid || !nadine || levelState.completed) return sp;

  const anyInput = Boolean(
    inputsByChar?.madjid?.left ||
      inputsByChar?.madjid?.right ||
      inputsByChar?.madjid?.jumpHeld ||
      inputsByChar?.madjid?.jumpJustPressed ||
      inputsByChar?.nadine?.left ||
      inputsByChar?.nadine?.right ||
      inputsByChar?.nadine?.jumpHeld ||
      inputsByChar?.nadine?.jumpJustPressed
  );

  if (sp.active) {
    if (
      anyInput ||
      madjid.hurtTimer > 0 ||
      nadine.hurtTimer > 0 ||
      mechState.ghost.active ||
      mechState.dances.madjid ||
      mechState.dances.nadine
    ) {
      sp.active = false;
      sp.id = null;
      sp.timer = 0;
      sp.stillTimer = 0;
      return sp;
    }
    sp.timer -= dt;
    if (sp.timer <= 0) {
      sp.active = false;
      sp.id = null;
      sp.stillTimer = 0;
      sp.cooldown = IDLE_SPECIAL_CONFIG.COOLDOWN_SEC;
    }
    return sp;
  }

  if (sp.cooldown > 0) sp.cooldown = Math.max(0, sp.cooldown - dt);

  const dist = Math.hypot(
    madjid.x + madjid.w * 0.5 - (nadine.x + nadine.w * 0.5),
    madjid.y - nadine.y
  );

  const bothStill =
    !anyInput &&
    madjid.grounded &&
    nadine.grounded &&
    Math.abs(madjid.vx) < 10 &&
    Math.abs(nadine.vx) < 10 &&
    madjid.hurtTimer <= 0 &&
    nadine.hurtTimer <= 0 &&
    !mechState.ghost.active &&
    !mechState.carrying &&
    !mechState.dances.madjid &&
    !mechState.dances.nadine &&
    dist <= IDLE_SPECIAL_CONFIG.MAX_PAIR_DIST;

  if (!bothStill) {
    sp.stillTimer = 0;
    return sp;
  }

  sp.stillTimer += dt;
  if (sp.stillTimer >= IDLE_SPECIAL_CONFIG.STILL_THRESHOLD_SEC && sp.cooldown <= 0) {
    const def = IDLE_COOP_INTERACTIONS[sp.nextIndex % IDLE_COOP_INTERACTIONS.length];
    sp.nextIndex += 1;
    sp.active = true;
    sp.id = def.id;
    sp.label = def.label;
    sp.color = def.color;
    sp.timer = def.duration;
    sp.stillTimer = 0;
    sp.cooldown = IDLE_SPECIAL_CONFIG.COOLDOWN_SEC;

    if (def.id === 'sync_heart_hop') {
      madjid.vy = -215;
      nadine.vy = -215;
      madjid.grounded = false;
      nadine.grounded = false;
    }
    callbacks.onIdleSpecial?.(def, (madjid.x + nadine.x) * 0.5 + 17, Math.min(madjid.y, nadine.y) - 10);
  }

  return sp;
}

// =========================================================================
// CANVAS2D RENDERERS (Soul-Link Aura, Idle Specials, Ugly Ghost & Bones)
// =========================================================================

export function renderSoulLinkAura(ctx, levelState, mechState, time) {
  if (!mechState.soulLink.active) return;
  const m = levelState.actors.madjid;
  const n = levelState.actors.nadine;
  if (!m || !n) return;

  const mx = m.x + m.w * 0.5;
  const my = m.y + m.h * 0.5;
  const nx = n.x + n.w * 0.5;
  const ny = n.y + n.h * 0.5;
  const midX = (mx + nx) * 0.5;
  const midY = (my + ny) * 0.5 - 10 + Math.sin(time * 4) * 4;

  ctx.save();
  ctx.strokeStyle = 'rgba(249, 168, 212, 0.52)';
  ctx.lineWidth = 3;
  ctx.setLineDash([7, 6]);
  ctx.lineDashOffset = -time * 24;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.quadraticCurveTo(midX, midY, nx, ny);
  ctx.stroke();

  ctx.setLineDash([]);
  // Tiny pulsing heart jewel at tether midpoint
  const pulse = 0.85 + Math.sin(time * 5.2) * 0.16;
  ctx.translate(midX, midY - 2);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = '#F472B6';
  ctx.strokeStyle = '#FFF5F8';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(-7, -1, -4, -7, 0, -3);
  ctx.bezierCurveTo(4, -7, 7, -1, 0, 4);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderIdleCoopOverlay(ctx, levelState, mechState, time) {
  const sp = mechState.idleSpecial;
  if (!sp.active || !sp.id) return;
  const m = levelState.actors.madjid;
  const n = levelState.actors.nadine;
  if (!m || !n) return;

  const midX = (m.x + m.w * 0.5 + n.x + n.w * 0.5) * 0.5;
  const topY = Math.min(m.y, n.y) - 18;

  ctx.save();
  const pulse = 1 + Math.sin(time * 9) * 0.12;
  ctx.strokeStyle = sp.color;
  ctx.lineWidth = 2.2;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.arc(midX, topY + 26, 26 * pulse, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.font = '700 12px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(20, 18, 36, 0.9)';
  ctx.strokeText(sp.label, midX, topY - 4);
  ctx.fillStyle = sp.color;
  ctx.fillText(sp.label, midX, topY - 4);
  ctx.restore();
}

export function renderUglyGhost(ctx, mechState, _levelState, time) {
  const g = mechState.ghost;

  // 1. Render any dropped cartoon femur/skull bone piles
  for (let i = 0; i < g.bones.length; i++) {
    const b = g.bones[i];
    const alpha = clamp(b.life / 0.8, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.fillStyle = '#F8F6EE';
    ctx.strokeStyle = '#231B32';
    ctx.lineWidth = 1.6;
    if (b.kind === 'skull') {
      ctx.beginPath();
      ctx.arc(0, -2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1E152E';
      ctx.beginPath();
      ctx.arc(-2.2, -2.5, 1.3, 0, Math.PI * 2);
      ctx.arc(2.2, -2.5, 1.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.roundRect(-8, -2.2, 16, 4.4, 2);
      ctx.fill();
      ctx.stroke();
      [-8, 8].forEach((bx) => {
        [-2.2, 2.2].forEach((by) => {
          ctx.beginPath();
          ctx.arc(bx, by, 2.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      });
    }
    ctx.restore();
  }

  // 2. Render comic "SLAP!" starburst if Outcome A just triggered
  if (g.slapCalloutTimer > 0) {
    ctx.save();
    ctx.translate(g.slapCalloutX, g.slapCalloutY - (1.2 - g.slapCalloutTimer) * 20);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#FDE047';
    ctx.strokeStyle = '#991B1B';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      const r = k % 2 === 0 ? 28 : 16;
      const sx = Math.cos(ang) * r;
      const sy = Math.sin(ang) * r * 0.68;
      if (k === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7F1D1D';
    ctx.fillText('SLAP!', 0, 1);
    ctx.restore();
  }

  if (!g.active) return;

  // 3. Render genuinely eerie, grotesque/ugly crooked ghost
  const hoverY = Math.sin(time * 8.5) * 4;
  const bloated = g.phase === 'devour_fly' ? 1.28 : 1.0;
  const facing = g.facing || 1;

  ctx.save();
  ctx.translate(g.x, g.y + hoverY);
  ctx.scale(facing * bloated, bloated);

  // Ragged smoky eerie trail wisps behind ghost
  for (let w = 1; w <= 4; w++) {
    ctx.fillStyle = `rgba(38, 22, 48, ${(0.34 - w * 0.06).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(-w * 14, Math.sin(time * 10 + w) * 6, 17 - w * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sickly spectral outer glow
  ctx.fillStyle = g.phase === 'shock' ? 'rgba(250, 204, 21, 0.34)' : 'rgba(132, 204, 22, 0.16)';
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.fill();

  // Crooked hunched grotesque phantom body with jagged ragged hem
  const bodyGrad = ctx.createLinearGradient(-22, -32, 24, 34);
  bodyGrad.addColorStop(0, '#9EB89A');
  bodyGrad.addColorStop(0.55, '#596F5D');
  bodyGrad.addColorStop(1, '#262134');

  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#120D1A';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(-18, -24);
  ctx.bezierCurveTo(-4, -38, 24, -30, 28, -6);
  ctx.bezierCurveTo(32, 12, 22, 24, 26, 33);
  // Jagged tattered hem
  ctx.lineTo(15, 23);
  ctx.lineTo(8, 36);
  ctx.lineTo(-1, 22);
  ctx.lineTo(-11, 35);
  ctx.lineTo(-20, 20);
  ctx.bezierCurveTo(-30, 8, -29, -12, -18, -24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Hunched warty spine bumps & crooked nose bulge
  ctx.fillStyle = '#425348';
  ctx.beginPath();
  ctx.arc(-14, -22, 5.5, 0, Math.PI * 2);
  ctx.arc(-20, -10, 4.2, 0, Math.PI * 2);
  ctx.fill();

  // Asymmetrical bulging creepy glowing eyes (one oversized yellow, one bloodshot crimson)
  ctx.fillStyle = '#FEF08A';
  ctx.strokeStyle = '#160C18';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(6, -11, 8.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FCA5A5';
  ctx.beginPath();
  ctx.arc(19, -8, 5.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Reptilian slit pupils
  ctx.fillStyle = '#12050B';
  ctx.beginPath();
  ctx.ellipse(7.5, -11, 1.8, 5.2, 0.15, 0, Math.PI * 2);
  ctx.ellipse(20, -8, 1.4, 3.6, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // Jagged gaping monster grin with crooked fangs & tongue
  ctx.fillStyle = '#1E0814';
  ctx.strokeStyle = '#0B0408';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, 4);
  ctx.quadraticCurveTo(14, 1, 25, 9);
  ctx.quadraticCurveTo(14, 24, -4, 15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Jagged uneven fangs
  ctx.fillStyle = '#EAE6D5';
  const teethX = [1, 7, 13, 19];
  teethX.forEach((tx, idx) => {
    ctx.beginPath();
    ctx.moveTo(tx, 5 + idx * 0.6);
    ctx.lineTo(tx + 2.4, 12 + (idx % 2) * 2);
    ctx.lineTo(tx + 4.8, 5 + idx * 0.6);
    ctx.closePath();
    ctx.fill();
  });

  // Reaching gnarled clawed hand
  const clawShake = Math.sin(time * 22) * 3;
  ctx.strokeStyle = '#89A185';
  ctx.lineWidth = 3.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(16, 10);
  ctx.quadraticCurveTo(30, 12 + clawShake, 37, 4 + clawShake);
  ctx.stroke();
  [-3, 1, 5].forEach((dy) => {
    ctx.strokeStyle = '#160C18';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(36, 4 + clawShake + dy * 0.5);
    ctx.lineTo(43, 2 + clawShake + dy);
    ctx.stroke();
  });

  // Electric shock sparks crackling during encounter shock phase
  if (g.phase === 'shock') {
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 2.4;
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + time * 14;
      const r1 = 28;
      const r2 = 52;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a + 0.15) * ((r1 + r2) * 0.5), Math.sin(a + 0.15) * ((r1 + r2) * 0.5));
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
  }

  ctx.restore();
}
