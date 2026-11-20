/**
 * src/audio.js
 * Lightweight Web Audio API Sound Effects (SFX ONLY — no background music).
 * Synthesizes warm, musical, pitch-varied feedback for platforming, puzzles,
 * checkpoints, crying/respawn, and safe-state affectionate interactions.
 */

const STORAGE_KEY = 'nadine_game_sfx_muted';

export function createAudioEngine() {
  let ctx = null;
  let muted = false;

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      muted = window.localStorage.getItem(STORAGE_KEY) === 'true';
    }
  } catch {
    muted = false;
  }

  function ensureContext() {
    if (muted) return null;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function unlock() {
    ensureContext();
  }

  function jitter(base, variance = 0.06) {
    return base * (1 + (Math.random() * 2 - 1) * variance);
  }

  function playTone({
    freq = 440,
    endFreq = null,
    type = 'sine',
    duration = 0.14,
    gain = 0.12,
    delay = 0,
    attack = 0.008,
  }) {
    const audio = ensureContext();
    if (!audio) return;

    const now = audio.currentTime + delay;
    const osc = audio.createOscillator();
    const env = audio.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(env);
    env.connect(audio.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function playJump(characterId = 'madjid') {
    const base = characterId === 'nadine' ? 370 : 300;
    playTone({
      freq: jitter(base, 0.06),
      endFreq: jitter(base * 1.95, 0.05),
      type: 'triangle',
      duration: 0.13,
      gain: 0.11,
      attack: 0.006,
    });
    playTone({
      freq: jitter(base * 1.4, 0.05),
      endFreq: jitter(base * 2.3, 0.05),
      type: 'sine',
      duration: 0.09,
      gain: 0.05,
      delay: 0.02,
    });
  }

  function playLand(intensity = 0.6) {
    const clamped = Math.max(0.25, Math.min(1, intensity));
    playTone({
      freq: jitter(135, 0.08),
      endFreq: 62,
      type: 'sine',
      duration: 0.08,
      gain: 0.08 * clamped,
      attack: 0.004,
    });
  }

  function playSwitchPress() {
    playTone({
      freq: jitter(420, 0.04),
      endFreq: 560,
      type: 'triangle',
      duration: 0.09,
      gain: 0.11,
    });
    playTone({
      freq: 660,
      type: 'sine',
      duration: 0.14,
      gain: 0.08,
      delay: 0.035,
    });
  }

  function playSwitchRelease() {
    playTone({
      freq: 360,
      endFreq: 250,
      type: 'triangle',
      duration: 0.08,
      gain: 0.06,
    });
  }

  function playKeyPickup() {
    const notes = [659.25, 880, 1174.66];
    notes.forEach((n, idx) => {
      playTone({
        freq: jitter(n, 0.02),
        type: 'sine',
        duration: 0.19,
        gain: 0.11,
        delay: idx * 0.06,
        attack: 0.005,
      });
    });
  }

  function playDoorUnlock() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      playTone({
        freq: n,
        type: 'triangle',
        duration: 0.24,
        gain: 0.1,
        delay: idx * 0.055,
      });
    });
  }

  function playCheckpoint() {
    const notes = [587.33, 739.99, 880, 1174.66];
    notes.forEach((n, idx) => {
      playTone({
        freq: n,
        type: 'sine',
        duration: 0.24,
        gain: 0.09,
        delay: idx * 0.05,
      });
    });
  }

  function playCry(characterId = 'madjid') {
    const start = characterId === 'nadine' ? 540 : 440;
    playTone({
      freq: start,
      endFreq: start * 0.68,
      type: 'sine',
      duration: 0.22,
      gain: 0.09,
      attack: 0.015,
    });
    playTone({
      freq: start * 0.82,
      endFreq: start * 0.54,
      type: 'triangle',
      duration: 0.26,
      gain: 0.075,
      delay: 0.14,
      attack: 0.015,
    });
  }

  function playRespawn() {
    playTone({
      freq: 392,
      endFreq: 587.33,
      type: 'sine',
      duration: 0.18,
      gain: 0.075,
    });
    playTone({
      freq: 523.25,
      endFreq: 783.99,
      type: 'sine',
      duration: 0.2,
      gain: 0.065,
      delay: 0.06,
    });
  }

  function playKiss() {
    // Soft romantic celesta-like bell chime for gentle safe-state kiss
    playTone({
      freq: 783.99,
      endFreq: 880,
      type: 'sine',
      duration: 0.16,
      gain: 0.075,
      attack: 0.01,
    });
    playTone({
      freq: 1046.5,
      type: 'sine',
      duration: 0.28,
      gain: 0.085,
      delay: 0.08,
      attack: 0.012,
    });
    playTone({
      freq: 1318.51,
      type: 'sine',
      duration: 0.32,
      gain: 0.06,
      delay: 0.15,
      attack: 0.012,
    });
  }

  function playCozySparkle() {
    playTone({
      freq: jitter(987.77, 0.04),
      endFreq: 1174.66,
      type: 'sine',
      duration: 0.14,
      gain: 0.045,
      attack: 0.008,
    });
  }

  function playSwitchChar(characterId = 'nadine') {
    const f1 = characterId === 'nadine' ? 440 : 392;
    const f2 = characterId === 'nadine' ? 587.33 : 493.88;
    playTone({ freq: f1, type: 'sine', duration: 0.07, gain: 0.07 });
    playTone({ freq: f2, type: 'sine', duration: 0.09, gain: 0.08, delay: 0.045 });
  }

  function playPortalEnter() {
    playTone({
      freq: 587.33,
      endFreq: 783.99,
      type: 'sine',
      duration: 0.18,
      gain: 0.08,
    });
  }

  function playLevelComplete() {
    const chord = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    chord.forEach((freq, i) => {
      playTone({
        freq,
        type: i % 2 === 0 ? 'triangle' : 'sine',
        duration: 0.34,
        gain: 0.11,
        delay: i * 0.085,
      });
    });
  }

  function playJourneyComplete() {
    const melody = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.5, 1567.98];
    melody.forEach((freq, i) => {
      playTone({
        freq,
        type: 'sine',
        duration: 0.48,
        gain: 0.11,
        delay: i * 0.095,
      });
    });
  }

  function playRestart() {
    playTone({
      freq: 380,
      endFreq: 220,
      type: 'triangle',
      duration: 0.14,
      gain: 0.08,
    });
  }

  function playChatPing() {
    playTone({
      freq: 740,
      endFreq: 880,
      type: 'sine',
      duration: 0.08,
      gain: 0.055,
    });
  }

  function playUiClick() {
    playTone({
      freq: 520,
      endFreq: 620,
      type: 'sine',
      duration: 0.05,
      gain: 0.05,
    });
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, String(muted));
      }
    } catch {
      // Ignore storage failures in restricted WebViews
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  return {
    unlock,
    isMuted,
    setMuted,
    toggleMute,
    playJump,
    playLand,
    playSwitchPress,
    playSwitchRelease,
    playKeyPickup,
    playDoorUnlock,
    playCheckpoint,
    playCry,
    playRespawn,
    playKiss,
    playCozySparkle,
    playSwitchChar,
    playPortalEnter,
    playLevelComplete,
    playJourneyComplete,
    playRestart,
    playChatPing,
    playUiClick,
  };
}
