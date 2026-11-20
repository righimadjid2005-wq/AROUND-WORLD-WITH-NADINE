/**
 * src/interactions.js
 * Decoupled Overhead Chat Bubbles, Love/Blush Reactions, Synchronized Emotes/Pings,
 * and Dual-Player Environmental Triggers for "Around the World with Nadine".
 *
 * Pure helpers (`normalizeLovePhrase`, `resolveChatReaction`, `stepInteractions`,
 * `detectDualPlayerTriggers`) are separated from Canvas2D renderers for unit testing.
 */

export const BUBBLE_CONFIG = {
  DURATION: 4.8,
  FADE_WINDOW: 0.9,
  MAX_WIDTH: 210,
  CHARS_LIMIT: 96,
};

export const LOVE_REACTION_CONFIG = {
  BLUSH_DURATION: 3.6,
  JUMP_DURATION: 3.2,
  MUTUAL_WINDOW_MS: 45000,
};

export const EMOTE_DEFS = {
  heart: {
    id: 'heart',
    key: '1',
    icon: '♥',
    label: 'Heart',
    bubbleText: '♥',
    color: '#F472B6',
  },
  wave: {
    id: 'wave',
    key: '2',
    icon: '👋',
    label: 'Wave',
    bubbleText: '👋 Hi!',
    color: '#7CC4FA',
  },
  cheer: {
    id: 'cheer',
    key: '3',
    icon: '✦',
    label: 'Cheer',
    bubbleText: '✦ Yay!',
    color: '#FDE047',
  },
  ping: {
    id: 'ping',
    key: '4',
    icon: '◎',
    label: 'Ping',
    bubbleText: 'Look here!',
    color: '#FFE89E',
  },
};

/**
 * Normalizes a chat message and checks if it matches "I love u" or "I love u too"
 * (case-insensitive, extra leading/trailing/internal whitespace trimmed).
 * @param {string} rawText
 * @returns {'love_init' | 'love_reply' | null}
 */
export function normalizeLovePhrase(rawText) {
  const normalized = String(rawText || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (normalized === 'i love u') return 'love_init';
  if (normalized === 'i love u too') return 'love_reply';
  return null;
}

/**
 * Resolves interactive character blush & jump reactions from a chat message.
 * - "I love u": makes the OTHER player's character blush + joyfully bounce/jump.
 * - "I love u too": makes the OTHER (corresponding) player's character blush + joyfully bounce/jump
 *   to complete the mutual exchange.
 * @param {'madjid' | 'nadine' | string} senderId
 * @param {string} rawText
 * @param {{ lastLoveSenderId?: string | null, lastLoveAt?: number }} [tracker]
 * @param {number} [nowMs]
 */
export function resolveChatReaction(senderId, rawText, tracker = {}, nowMs = Date.now()) {
  if (senderId !== 'madjid' && senderId !== 'nadine') {
    return null;
  }
  const kind = normalizeLovePhrase(rawText);
  if (!kind) return null;

  const targetCharId = senderId === 'madjid' ? 'nadine' : 'madjid';

  if (kind === 'love_init') {
    return {
      kind,
      senderId,
      targetCharId,
      isMutual: false,
      blushDuration: LOVE_REACTION_CONFIG.BLUSH_DURATION,
      jumpDuration: LOVE_REACTION_CONFIG.JUMP_DURATION,
      nextTracker: {
        lastLoveSenderId: senderId,
        lastLoveAt: nowMs,
      },
    };
  }

  // kind === 'love_reply'
  const withinWindow =
    typeof tracker.lastLoveAt === 'number' &&
    nowMs - tracker.lastLoveAt <= LOVE_REACTION_CONFIG.MUTUAL_WINDOW_MS;
  const isMutual = Boolean(
    withinWindow && tracker.lastLoveSenderId && tracker.lastLoveSenderId !== senderId
  );

  return {
    kind,
    senderId,
    targetCharId,
    isMutual,
    blushDuration: LOVE_REACTION_CONFIG.BLUSH_DURATION,
    jumpDuration: LOVE_REACTION_CONFIG.JUMP_DURATION,
    nextTracker: isMutual
      ? { lastLoveSenderId: null, lastLoveAt: 0 }
      : { lastLoveSenderId: tracker.lastLoveSenderId || null, lastLoveAt: tracker.lastLoveAt || 0 },
  };
}

export function createInteractionState() {
  return {
    bubbles: {
      madjid: null,
      nadine: null,
    },
    reactions: {
      madjid: { blushTimer: 0, jumpTimer: 0, hopCooldown: 0, cheerTimer: 0 },
      nadine: { blushTimer: 0, jumpTimer: 0, hopCooldown: 0, cheerTimer: 0 },
    },
    beacons: [], // Active synchronized waypoint pings { id, charId, x, y, label, color, life, maxLife }
    loveTracker: {
      lastLoveSenderId: null,
      lastLoveAt: 0,
    },
    highFiveCooldown: 0,
    harmonyCooldown: 0,
    lastEmoteAt: {
      madjid: 0,
      nadine: 0,
    },
  };
}

/**
 * Attaches an overhead floating speech bubble (`🗨 <text>`) directly above a character.
 */
export function setOverheadSpeechBubble(interactionState, charId, rawText, duration = BUBBLE_CONFIG.DURATION) {
  if (!interactionState || (charId !== 'madjid' && charId !== 'nadine')) return null;
  const clean = String(rawText || '').trim().slice(0, BUBBLE_CONFIG.CHARS_LIMIT);
  if (!clean) return null;

  const bubble = {
    charId,
    text: `🗨 ${clean}`,
    rawText: clean,
    life: duration,
    maxLife: duration,
    age: 0,
  };
  interactionState.bubbles[charId] = bubble;
  return bubble;
}

/**
 * Triggers blushing rosy cheeks and joyful bouncing/jumping on the target character.
 */
export function activateLoveReaction(interactionState, targetCharId, { blushDuration, jumpDuration } = {}) {
  if (!interactionState || (targetCharId !== 'madjid' && targetCharId !== 'nadine')) return;
  const rx = interactionState.reactions[targetCharId];
  rx.blushTimer = Math.max(rx.blushTimer, blushDuration ?? LOVE_REACTION_CONFIG.BLUSH_DURATION);
  rx.jumpTimer = Math.max(rx.jumpTimer, jumpDuration ?? LOVE_REACTION_CONFIG.JUMP_DURATION);
  rx.hopCooldown = 0;
}

/**
 * Adds or updates a synchronized world ping beacon from either player.
 */
export function addPingBeacon(interactionState, charId, x, y, color = '#FFE89E') {
  if (!interactionState) return null;
  const label = charId === 'madjid' ? 'Madjid here!' : 'Nadine here!';
  // Replace previous beacon from the same player so the screen stays clean
  interactionState.beacons = interactionState.beacons.filter((b) => b.charId !== charId);
  const beacon = {
    id: `${charId}-${Date.now()}`,
    charId,
    x: Number(x) || 0,
    y: Number(y) || 0,
    label,
    color,
    life: 5.5,
    maxLife: 5.5,
    age: 0,
  };
  interactionState.beacons.push(beacon);
  return beacon;
}

/**
 * Advances bubble fade timers, love blush/bounce physics, ping beacons, and dual-player triggers.
 * @param {ReturnType<typeof createInteractionState>} interactionState
 * @param {object} levelState
 * @param {number} dt
 * @param {object} [callbacks]
 * @param {string | null} [remoteSyncCharId] - Optional charId controlled remotely so we only apply visual bounce if grounded locally or solo
 */
export function stepInteractions(interactionState, levelState, dt, callbacks = {}, remoteSyncCharId = null) {
  if (!interactionState || !levelState || dt <= 0) return;

  ['madjid', 'nadine'].forEach((cid) => {
    const b = interactionState.bubbles[cid];
    if (b) {
      b.age += dt;
      b.life -= dt;
      if (b.life <= 0) {
        interactionState.bubbles[cid] = null;
      }
    }

    const rx = interactionState.reactions[cid];
    const actor = levelState.actors?.[cid];

    if (rx.blushTimer > 0) {
      rx.blushTimer = Math.max(0, rx.blushTimer - dt);
    }
    if (rx.cheerTimer > 0) {
      rx.cheerTimer = Math.max(0, rx.cheerTimer - dt);
    }

    if (actor) {
      actor.blushTimer = rx.blushTimer;
      actor.joyJumpTimer = rx.jumpTimer;

      // Joyful rhythmic bounce/jump while reaction timer is active
      if (rx.jumpTimer > 0) {
        rx.jumpTimer = Math.max(0, rx.jumpTimer - dt);
        rx.hopCooldown = Math.max(0, rx.hopCooldown - dt);

        if (actor.hurtTimer <= 0) {
          if (rx.blushTimer > 0) {
            actor.mood = 'happy';
          }
          if (cid !== remoteSyncCharId && actor.grounded && rx.hopCooldown <= 0) {
            actor.vy = -345;
            actor.grounded = false;
            actor.scaleX = 0.84;
            actor.scaleY = 1.2;
            rx.hopCooldown = 0.48;
            callbacks.onJoyHop?.(actor);
          }
        }
      } else if (rx.blushTimer > 0 && actor.hurtTimer <= 0 && levelState.kissTimer <= 0) {
        actor.mood = 'happy';
      }
    }
  });

  // Update synchronized ping beacons
  for (let i = interactionState.beacons.length - 1; i >= 0; i--) {
    const beacon = interactionState.beacons[i];
    beacon.age += dt;
    beacon.life -= dt;
    if (beacon.life <= 0) {
      interactionState.beacons.splice(i, 1);
    }
  }

  // Cooldowns for dual-player environmental triggers
  if (interactionState.highFiveCooldown > 0) {
    interactionState.highFiveCooldown = Math.max(0, interactionState.highFiveCooldown - dt);
  }
  if (interactionState.harmonyCooldown > 0) {
    interactionState.harmonyCooldown = Math.max(0, interactionState.harmonyCooldown - dt);
  }

  detectDualPlayerTriggers(interactionState, levelState, callbacks);
}

/**
 * Evaluates cooperative dual-player environmental interactions:
 * 1. Mid-Air Co-op High-Five: when both players leap and meet mid-air, triggers a joyful spark & bounce!
 * 2. Dual Lantern / Arch Harmony Resonance: when both players gather together near a lit lantern,
 *    checkpoint, or open-world lantern/arch, emits cozy lantern resonance sparkles (and optional Open-World gift).
 */
export function detectDualPlayerTriggers(interactionState, levelState, callbacks = {}) {
  const madjid = levelState.actors?.madjid;
  const nadine = levelState.actors?.nadine;
  if (!madjid || !nadine || levelState.completed) return null;
  if (madjid.hurtTimer > 0 || nadine.hurtTimer > 0) return null;

  const mcx = madjid.x + madjid.w * 0.5;
  const mcy = madjid.y + madjid.h * 0.5;
  const ncx = nadine.x + nadine.w * 0.5;
  const ncy = nadine.y + nadine.h * 0.5;
  const dist = Math.hypot(mcx - ncx, mcy - ncy);

  // 1. Mid-Air Co-op High-Five when both are airborne and meet within 44px
  if (
    interactionState.highFiveCooldown <= 0 &&
    !madjid.grounded &&
    !nadine.grounded &&
    dist <= 44
  ) {
    interactionState.highFiveCooldown = 4.2;
    interactionState.reactions.madjid.cheerTimer = 1.2;
    interactionState.reactions.nadine.cheerTimer = 1.2;
    madjid.vy = Math.min(madjid.vy, -240);
    nadine.vy = Math.min(nadine.vy, -240);
    madjid.scaleX = 1.18;
    madjid.scaleY = 0.85;
    nadine.scaleX = 1.18;
    nadine.scaleY = 0.85;
    const result = {
      kind: 'highfive',
      x: (mcx + ncx) * 0.5,
      y: (mcy + ncy) * 0.5,
    };
    callbacks.onHighFive?.(result.x, result.y);
    return result;
  }

  // 2. Dual-Player Environmental Harmony near Lanterns / Lit Checkpoints
  if (
    interactionState.harmonyCooldown <= 0 &&
    madjid.grounded &&
    nadine.grounded &&
    dist <= 78 &&
    Math.abs(madjid.vx) < 20 &&
    Math.abs(nadine.vx) < 20
  ) {
    const sources = [];
    (levelState.decorations || []).forEach((d) => {
      if (d.type === 'lantern') sources.push({ x: d.x + 10, y: d.y - 24 });
    });
    (levelState.checkpoints || []).forEach((cp) => {
      if (cp.activated) sources.push({ x: cp.x, y: cp.y - 24 });
    });

    const nearSource = sources.find(
      (src) => Math.hypot(src.x - mcx, src.y - mcy) <= 75 && Math.hypot(src.x - ncx, src.y - ncy) <= 75
    );
    if (nearSource) {
      interactionState.harmonyCooldown = 14;
      const result = {
        kind: 'lantern-harmony',
        x: nearSource.x,
        y: nearSource.y - 16,
      };
      callbacks.onLanternHarmony?.(result.x, result.y);
      return result;
    }
  }

  return null;
}

/**
 * Wraps text into concise lines for Canvas2D speech bubbles without per-frame allocations of heavy DOM nodes.
 */
function wrapBubbleLines(ctx, text, maxTextWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxTextWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      // Slice overly long single tokens cleanly
      if (ctx.measureText(word).width > maxTextWidth) {
        let chunk = '';
        for (let c = 0; c < word.length; c++) {
          if (ctx.measureText(chunk + word[c]).width > maxTextWidth && chunk) {
            lines.push(chunk);
            chunk = word[c];
          } else {
            chunk += word[c];
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (lines.length >= 3) break;
  }
  if (line && lines.length < 3) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

/**
 * Renders floating `🗨 <message>` speech bubbles directly above Madjid & Nadine in world space.
 */
export function renderOverheadBubbles(ctx, actors, interactionState) {
  if (!interactionState || !actors) return;

  ['madjid', 'nadine'].forEach((cid) => {
    const bubble = interactionState.bubbles[cid];
    const actor = actors[cid];
    if (!bubble || !actor || bubble.life <= 0) return;

    const fadeAlpha =
      bubble.life < BUBBLE_CONFIG.FADE_WINDOW
        ? Math.max(0, bubble.life / BUBBLE_CONFIG.FADE_WINDOW)
        : 1;
    const popScale = bubble.age < 0.16 ? 0.72 + (bubble.age / 0.16) * 0.28 : 1;

    ctx.save();
    ctx.font = '600 12px "Plus Jakarta Sans", system-ui, sans-serif';
    const maxTextWidth = BUBBLE_CONFIG.MAX_WIDTH - 22;
    const lines = wrapBubbleLines(ctx, bubble.text, maxTextWidth);

    let textW = 0;
    for (let i = 0; i < lines.length; i++) {
      textW = Math.max(textW, ctx.measureText(lines[i]).width);
    }

    const padX = 11;
    const padY = 7;
    const lineH = 15;
    const boxW = Math.min(BUBBLE_CONFIG.MAX_WIDTH, Math.max(58, textW + padX * 2));
    const boxH = lines.length * lineH + padY * 2;

    const cx = actor.x + actor.w * 0.5;
    const anchorY = actor.y - 34;

    ctx.globalAlpha = fadeAlpha;
    ctx.translate(cx, anchorY);
    ctx.scale(popScale, popScale);

    const x = -boxW * 0.5;
    const y = -boxH - 7;

    // Soft drop shadow
    ctx.fillStyle = 'rgba(18, 20, 38, 0.22)';
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 3, boxW, boxH, 11);
    ctx.fill();

    // Warm ivory storybook bubble + dark outline
    ctx.fillStyle = cid === 'nadine' ? '#FFF5F8' : '#F4FAFF';
    ctx.strokeStyle = '#241B36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 11);
    ctx.fill();
    ctx.stroke();

    // Speech pointer tail
    ctx.beginPath();
    ctx.moveTo(-5, y + boxH - 1);
    ctx.lineTo(0, y + boxH + 7);
    ctx.lineTo(5, y + boxH - 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Seamless inner fill covering tail top border
    ctx.fillRect(-5, y + boxH - 3, 10, 4);

    // Bubble text
    ctx.fillStyle = '#1E182E';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 0, y + padY + i * lineH);
    }

    ctx.restore();
  });
}

/**
 * Renders synchronized world ping beacons (expanding ring + diamond marker + partner callout).
 */
export function renderPingBeacons(ctx, interactionState, time) {
  if (!interactionState || !interactionState.beacons || interactionState.beacons.length === 0) return;

  interactionState.beacons.forEach((b) => {
    const alpha = b.life < 1.0 ? Math.max(0, b.life) : 1;
    const pulse = (time * 1.4) % 1;
    const ringRadius = 12 + pulse * 34;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(b.x, b.y - 26);

    // Concentric expanding ring
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = alpha * (1 - pulse) * 0.85;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = alpha;
    const bob = Math.sin(time * 5.2) * 3.5;

    // Beacon diamond
    ctx.fillStyle = b.color;
    ctx.strokeStyle = '#241B36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11 + bob);
    ctx.lineTo(9, 0 + bob);
    ctx.lineTo(0, 11 + bob);
    ctx.lineTo(-9, 0 + bob);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Label above beacon
    ctx.font = '700 11px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(18, 20, 38, 0.9)';
    ctx.strokeText(b.label, 0, -15 + bob);
    ctx.fillStyle = '#FFFDF5';
    ctx.fillText(b.label, 0, -15 + bob);

    ctx.restore();
  });
}
