/**
 * src/storyline.js
 * Integrated In-Game Storyline across Worlds 1..5 for Solo and 2-Player Co-op.
 *
 * Fires brief, heartfelt, non-blocking narrative beats on:
 * - World entry (W1..W5)
 * - Companion cat discovery (W1)
 * - Seal puzzle completions & checkpoint lanterns
 * - Escalating unpredictable trap warnings & survival (W3+)
 * - Escape sequence victories (W2, W3, W5)
 * - World guardian defeats & Wedding Arch ceremony
 *
 * Drives overhead duo speech bubbles (`setOverheadSpeechBubble`), affectionate moods,
 * a subtle non-blocking HUD whisper strip, and clean Co-op `story_beat` relay.
 */

import { setOverheadSpeechBubble } from './interactions.js';

export const STORY_BEATS = {
  1: {
    world_intro: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'Beyond our quiet village, Nadine—our real adventure starts here.',
      partnerLine: 'Hand in hand, Madjid. Let us solve these jungle seals together!',
      title: 'World 1 · The First Step',
    },
    cat_found: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'Look, Madjid! A little ginger cat wants to travel with us!',
      partnerLine: 'Welcome aboard, Mimi! Looks like we are a team of three now.',
      title: 'Companion Found · Mimi',
    },
    puzzle_solved: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'That ancient seal resonated when we aligned our steps!',
      partnerLine: 'Nothing stops us when our timing is in sync.',
      title: 'Jungle Seal Unlocked',
    },
    checkpoint_lit: {
      speaker: 'madjid',
      line: 'Lantern lit! Rest a heartbeat, Nadine—we are safe here.',
      title: 'Haven Lantern',
    },
    boss_down: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'The Canopy Guardian yields! Ahead lies the frost horizon.',
      partnerLine: 'Stay close to me when the winds turn cold, Madjid.',
      title: 'Jungle Guardian Cleared',
    },
  },
  2: {
    world_intro: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'The Ice Lands are treacherous—watch every slippery ledge!',
      partnerLine: 'Carry or brace together, Nadine. We will conquer this ridge!',
      title: 'World 2 · Mirror-Ice Ridge',
    },
    puzzle_solved: {
      speaker: 'madjid',
      line: 'Rune crystal aligned! Even this glacier cannot freeze us out.',
      title: 'Frost Rune Aligned',
    },
    checkpoint_lit: {
      speaker: 'nadine',
      line: 'Warm lantern glow against the snow—Mimi loves it already.',
      title: 'Frost Lantern',
    },
    escape_clear: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'We outran the avalanche! Are you okay, Nadine?',
      partnerLine: 'Shaking a little, smiling a lot—we made it together!',
      title: 'Avalanche Outrun',
    },
    boss_down: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'The Glacial Warden shatters into starlight! Next is the Volcano.',
      partnerLine: 'From frost to fire—still right beside you.',
      title: 'Ice Lands Conquered',
    },
  },
  3: {
    world_intro: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'Dangerous territory, Nadine—watch Mimi’s ears for hidden traps!',
      partnerLine: 'Tiles can crumble and traps shift unexpectedly here. Stay sharp!',
      title: 'World 3 · Obsidian Caldera',
    },
    trap_warning: {
      speaker: 'nadine',
      line: 'Mimi spotted a hidden trap! Watch your footing!',
      title: 'Mimi’s Warning',
    },
    puzzle_solved: {
      speaker: 'madjid',
      line: 'Ember sigils locked! Thermal updrafts ahead—ride them together!',
      title: 'Caldera Sigil Solved',
    },
    checkpoint_lit: {
      speaker: 'nadine',
      line: 'A safe obsidian shrine above the magma. Catch your breath!',
      title: 'Caldera Sanctuary',
    },
    escape_clear: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'That magma surge nearly caught our heels!',
      partnerLine: 'Good thing Mimi and you kept me moving forward!',
      title: 'Magma Surge Cleared',
    },
    boss_down: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'The Obsidian Titan cools to stone! Look up—stars await us.',
      partnerLine: 'Space! Hold my hand before gravity lets go!',
      title: 'Volcano Cleared',
    },
  },
  4: {
    world_intro: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'Zero gravity! Even Mimi got her own little crystal helmet!',
      partnerLine: 'Stay close through these airlocks and shifting laser snares.',
      title: 'World 4 · Starlight Orbit',
    },
    trap_warning: {
      speaker: 'madjid',
      line: 'Careful—orbital snare armed nearby! Wait for the safe beat.',
      title: 'Orbital Trap Alert',
    },
    puzzle_solved: {
      speaker: 'nadine',
      line: 'Starlight nodes harmonized! Airlock doors opening.',
      title: 'Starlight Airlock',
    },
    checkpoint_lit: {
      speaker: 'madjid',
      line: 'Beacon stabilized! One deep breath among the stars.',
      title: 'Orbital Beacon',
    },
    boss_down: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'The Nebula Warden powers down! One final world below us—the Ocean!',
      partnerLine: 'The Coral Wedding Arch waits at the far end of the reef.',
      title: 'Orbit Cleared',
    },
  },
  5: {
    world_intro: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'The Ocean Abyss—swim with the currents and watch the reef traps!',
      partnerLine: 'At the end of this sea lies our Wedding Arch, Madjid.',
      title: 'World 5 · Coral Abyss',
    },
    trap_warning: {
      speaker: 'nadine',
      line: 'Sea snare shifting ahead—follow Mimi’s lead!',
      title: 'Abyssal Trap Alert',
    },
    puzzle_solved: {
      speaker: 'madjid',
      line: 'Tide shrine unlocked! The current guides us toward the sanctuary.',
      title: 'Tide Shrine Open',
    },
    checkpoint_lit: {
      speaker: 'nadine',
      line: 'Pearl lantern lit! We are almost at the Coral Arch.',
      title: 'Abyssal Pearl',
    },
    escape_clear: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'We rode out the Abyssal Tide together!',
      partnerLine: 'Nothing in this world could ever sweep us apart.',
      title: 'Abyssal Tide Cleared',
    },
    boss_down: {
      speaker: 'nadine',
      partner: 'madjid',
      line: 'The Leviathan bows! Look—the Coral Wedding Arch is glowing!',
      partnerLine: 'Step beneath the arch with me, Nadine—forever begins now.',
      title: 'Final Guardian Bested',
    },
    wedding_vow: {
      speaker: 'madjid',
      partner: 'nadine',
      line: 'Around the world and back to your heart, Nadine. Forever yours ♥',
      partnerLine: 'With Mimi at our feet and every horizon behind us—yes, forever ♥',
      title: 'Beneath the Coral Arch',
    },
  },
};

/**
 * Creates a fresh storyline state for a loaded world.
 * @param {number} worldId
 */
export function createStorylineState(worldId = 1) {
  return {
    worldId: Number(worldId) || 1,
    triggeredIds: new Set(),
    banner: null, // { id, title, line, speaker, timer, duration }
    cooldown: 0,
  };
}

/**
 * Triggers a contextual narrative beat if not already shown this level/world run.
 * Updates duo overhead speech bubbles, subtle banner whisper, and emits Co-op sync payload.
 * @param {ReturnType<typeof createStorylineState>} storyState
 * @param {string} eventType
 * @param {{ worldId?: number, fromRemote?: boolean, actors?: any }} [context]
 * @param {any} [interactionState]
 * @param {any} [callbacks]
 */
export function triggerStoryEvent(storyState, eventType, context = {}, interactionState = null, callbacks = {}) {
  if (!storyState || !eventType) return null;
  const worldId = Number(context.worldId || storyState.worldId) || 1;
  const worldScript = STORY_BEATS[worldId] || STORY_BEATS[1];
  const beatDef = worldScript?.[eventType];
  if (!beatDef) return null;

  const beatId = `w${worldId}:${eventType}`;
  if (storyState.triggeredIds.has(beatId)) return null;

  // Throttle non-critical alerts slightly so bubbles stay readable
  const isPriority =
    eventType === 'world_intro' ||
    eventType === 'cat_found' ||
    eventType === 'boss_down' ||
    eventType === 'wedding_vow' ||
    eventType === 'escape_clear';
  if (!isPriority && storyState.cooldown > 0 && !context.fromRemote) {
    return null;
  }

  storyState.triggeredIds.add(beatId);
  storyState.cooldown = isPriority ? 1.2 : 3.2;

  const speaker = beatDef.speaker === 'nadine' ? 'nadine' : 'madjid';
  const other = speaker === 'madjid' ? 'nadine' : 'madjid';

  if (interactionState) {
    setOverheadSpeechBubble(interactionState, speaker, beatDef.line, 4.8);
    if (beatDef.partnerLine) {
      setOverheadSpeechBubble(interactionState, other, beatDef.partnerLine, 4.8);
    }
  }

  if (context.actors) {
    const a1 = context.actors[speaker];
    const a2 = context.actors[other];
    if (eventType === 'cat_found' || eventType === 'boss_down' || eventType === 'wedding_vow') {
      if (a1 && a1.hurtTimer <= 0) {
        a1.mood = 'happy';
        a1.blushTimer = Math.max(a1.blushTimer || 0, 2.4);
      }
      if (a2 && a2.hurtTimer <= 0) {
        a2.mood = 'happy';
        a2.blushTimer = Math.max(a2.blushTimer || 0, 2.4);
      }
    }
  }

  const duration = beatDef.partnerLine ? 6.2 : 4.6;
  storyState.banner = {
    id: beatId,
    eventType,
    worldId,
    speaker,
    title: beatDef.title,
    line: beatDef.line,
    partnerLine: beatDef.partnerLine || null,
    timer: duration,
    duration,
  };

  if (!context.fromRemote) {
    callbacks.onStoryBeat?.({
      beatId,
      eventType,
      worldId,
      banner: storyState.banner,
    });
  }

  return storyState.banner;
}

/**
 * Advances active storyline banner countdown & trigger cooldown.
 * @param {ReturnType<typeof createStorylineState>} storyState
 * @param {number} dt
 */
export function stepStoryline(storyState, dt) {
  if (!storyState || dt <= 0) return;
  if (storyState.cooldown > 0) {
    storyState.cooldown = Math.max(0, storyState.cooldown - dt);
  }
  if (storyState.banner) {
    storyState.banner.timer -= dt;
    if (storyState.banner.timer <= 0) {
      storyState.banner = null;
    }
  }
}
