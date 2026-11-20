import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUBBLE_CONFIG,
  EMOTE_DEFS,
  LOVE_REACTION_CONFIG,
  activateLoveReaction,
  addPingBeacon,
  createInteractionState,
  detectDualPlayerTriggers,
  normalizeLovePhrase,
  resolveChatReaction,
  setOverheadSpeechBubble,
  stepInteractions,
} from './interactions.js';
import { formatRoomModeLabel } from './coop-rooms-list.js';

test('normalizeLovePhrase trims whitespace and matches case-insensitively', () => {
  assert.equal(normalizeLovePhrase('I love u'), 'love_init');
  assert.equal(normalizeLovePhrase('   i   LOVE   u  '), 'love_init');
  assert.equal(normalizeLovePhrase('I love u too'), 'love_reply');
  assert.equal(normalizeLovePhrase('\t i love   u TOO \n'), 'love_reply');
  assert.equal(normalizeLovePhrase('I love you too much'), null);
  assert.equal(normalizeLovePhrase('Hello Nadine!'), null);
});

test('resolveChatReaction makes the OTHER character react and detects mutual reply', () => {
  const tracker0 = { lastLoveSenderId: null, lastLoveAt: 0 };
  const t1 = 10000;

  // Madjid sends "I love u" -> Nadine blushes & jumps
  const rx1 = resolveChatReaction('madjid', '  i LOVE u ', tracker0, t1);
  assert.ok(rx1);
  assert.equal(rx1.targetCharId, 'nadine');
  assert.equal(rx1.isMutual, false);
  assert.equal(rx1.nextTracker.lastLoveSenderId, 'madjid');

  // Nadine replies "I love u too" within mutual window -> Madjid blushes & jumps, mutual true
  const rx2 = resolveChatReaction('nadine', 'I LOVE U TOO', rx1.nextTracker, t1 + 4000);
  assert.ok(rx2);
  assert.equal(rx2.targetCharId, 'madjid');
  assert.equal(rx2.isMutual, true);
  assert.equal(rx2.nextTracker.lastLoveSenderId, null);

  // Story/system messages do not trigger character blush reactions
  assert.equal(resolveChatReaction('story', 'I love u', tracker0, t1), null);
});

test('Overhead speech bubbles (`🗨 <text>`) and love blush/bounce lifecycle step cleanly', () => {
  const interactionState = createInteractionState();
  const bubble = setOverheadSpeechBubble(interactionState, 'madjid', '  Let us go!  ');
  assert.ok(bubble);
  assert.equal(bubble.text, '🗨 Let us go!');

  const levelState = {
    completed: false,
    kissTimer: 0,
    decorations: [],
    checkpoints: [],
    actors: {
      madjid: { id: 'madjid', x: 100, y: 300, w: 34, h: 36, vx: 0, vy: 0, grounded: true, hurtTimer: 0, blushTimer: 0, joyJumpTimer: 0, mood: 'normal', scaleX: 1, scaleY: 1 },
      nadine: { id: 'nadine', x: 350, y: 300, w: 34, h: 36, vx: 0, vy: 0, grounded: true, hurtTimer: 0, blushTimer: 0, joyJumpTimer: 0, mood: 'normal', scaleX: 1, scaleY: 1 },
    },
  };

  activateLoveReaction(interactionState, 'nadine', {
    blushDuration: LOVE_REACTION_CONFIG.BLUSH_DURATION,
    jumpDuration: LOVE_REACTION_CONFIG.JUMP_DURATION,
  });

  let hopCount = 0;
  stepInteractions(interactionState, levelState, 0.1, {
    onJoyHop() {
      hopCount += 1;
    },
  });

  // Nadine jumped joyfully & blushed
  assert.equal(hopCount, 1);
  assert.ok(levelState.actors.nadine.vy < 0);
  assert.equal(levelState.actors.nadine.grounded, false);
  assert.ok(levelState.actors.nadine.blushTimer > 3.0);
  assert.equal(levelState.actors.nadine.mood, 'happy');

  // Bubble remains active before duration expires, then auto-clears after BUBBLE_CONFIG.DURATION
  assert.ok(interactionState.bubbles.madjid !== null);
  for (let i = 0; i < 60; i++) {
    stepInteractions(interactionState, levelState, 0.1);
  }
  assert.equal(interactionState.bubbles.madjid, null);
  assert.equal(levelState.actors.nadine.blushTimer, 0);
  assert.ok(BUBBLE_CONFIG.DURATION > 0);
  assert.equal(EMOTE_DEFS.ping.key, '4');
});

test('Ping beacons replace previous ping from same player and Dual-Player triggers fire cleanly', () => {
  const interactionState = createInteractionState();
  addPingBeacon(interactionState, 'nadine', 120, 220);
  addPingBeacon(interactionState, 'nadine', 240, 260);
  const beacons = interactionState.beacons as Array<{ x: number; y: number; label: string }>;
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].x, 240);
  assert.equal(beacons[0].label, 'Nadine here!');

  // 1. Mid-Air High-Five
  let highFiveFired = false;
  const airLevel = {
    completed: false,
    decorations: [],
    checkpoints: [],
    actors: {
      madjid: { id: 'madjid', x: 200, y: 200, w: 34, h: 36, vx: 10, vy: 20, grounded: false, hurtTimer: 0, scaleX: 1, scaleY: 1 },
      nadine: { id: 'nadine', x: 215, y: 204, w: 34, h: 36, vx: -10, vy: 15, grounded: false, hurtTimer: 0, scaleX: 1, scaleY: 1 },
    },
  };
  const hf = detectDualPlayerTriggers(interactionState, airLevel, {
    onHighFive() {
      highFiveFired = true;
    },
  });
  assert.equal(highFiveFired, true);
  assert.equal(hf?.kind, 'highfive');

  // 2. Dual Lantern Harmony Resonance
  let harmonyFired = false;
  const calmLevel = {
    completed: false,
    decorations: [{ type: 'lantern', x: 300, y: 340 }],
    checkpoints: [],
    actors: {
      madjid: { id: 'madjid', x: 280, y: 300, w: 34, h: 36, vx: 0, vy: 0, grounded: true, hurtTimer: 0, scaleX: 1, scaleY: 1 },
      nadine: { id: 'nadine', x: 318, y: 300, w: 34, h: 36, vx: 0, vy: 0, grounded: true, hurtTimer: 0, scaleX: 1, scaleY: 1 },
    },
  };
  const hr = detectDualPlayerTriggers(interactionState, calmLevel, {
    onLanternHarmony() {
      harmonyFired = true;
    },
  });
  assert.equal(harmonyFired, true);
  assert.equal(hr?.kind, 'lantern-harmony');
});

test('formatRoomModeLabel formats story world/stage and open-world modes cleanly', () => {
  assert.equal(formatRoomModeLabel({ mode: 'story', levelIndex: 0 }), 'Story W1-1');
  assert.equal(formatRoomModeLabel({ mode: 'story', levelIndex: 6 }), 'Story W2-2');
  assert.equal(formatRoomModeLabel({ mode: 'openworld', levelIndex: 0 }), '2D Open-World');
});
