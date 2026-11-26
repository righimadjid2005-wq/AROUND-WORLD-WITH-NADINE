/**
 * src/audio.js
 * Lightweight Web Audio API Sound Effects + Streaming Background Music Engine.
 * Synthesizes warm, musical feedback for platforming/puzzles/combat while
 * streaming the 3 OST MP3 tracks off the main render thread via a single
 * reusable HTMLAudioElement for zero-hitch 60fps playback.
 */

const STORAGE_KEY = 'nadine_game_sfx_muted';
const MUSIC_ENABLED_KEY = 'nadine_game_music_enabled';
const MUSIC_TRACK_KEY = 'nadine_game_bgm_track';

export const BGM_TRACKS = Object.freeze([
  Object.freeze({
    id: 'nadine_dark',
    title: 'Nadine in the Dark',
    url: '/assets/aistudio/nadine_in_the_dark_56dfc98d.mp3',
  }),
  Object.freeze({
    id: 'planets_asleep',
    title: 'Planets Fall Asleep',
    url: '/assets/aistudio/planets_fall_asleep_7bdc81d0.mp3',
  }),
  Object.freeze({
    id: 'quiet_sky',
    title: 'Apocalypse in the Quiet Sky',
    url: '/assets/aistudio/apocalypse_in_the_quiet_sky_e10630b1.mp3',
  }),
]);

export function getPreferredTrackIdForContext({ playMode = 'story', worldId = 1 } = {}) {
  if (playMode === 'openworld') return 'nadine_dark';
  const id = Number(worldId) || 1;
  if (id === 2 || id === 4) return 'planets_asleep';
  if (id === 3) return 'quiet_sky';
  return 'nadine_dark';
}

function readStorage(key, fallback = null) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(key);
      return val === null ? fallback : val;
    }
  } catch {
    // Ignore storage failures in restricted WebViews
  }
  return fallback;
}

function writeStorage(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, String(value));
    }
  } catch {
    // Ignore storage failures in restricted WebViews
  }
}

export function createAudioEngine(options = {}) {
  let ctx = null;
  let muted = readStorage(STORAGE_KEY, 'false') === 'true';
  let musicEnabled = readStorage(MUSIC_ENABLED_KEY, 'true') !== 'false';

  const savedTrackId = readStorage(MUSIC_TRACK_KEY, null);
  const initialOptionIdx =
    typeof options.initialTrackIndex === 'number' &&
    options.initialTrackIndex >= 0 &&
    options.initialTrackIndex < BGM_TRACKS.length
      ? options.initialTrackIndex
      : -1;
  const savedIdx = savedTrackId ? BGM_TRACKS.findIndex((t) => t.id === savedTrackId) : -1;
  let currentTrackIdx = initialOptionIdx >= 0 ? initialOptionIdx : savedIdx >= 0 ? savedIdx : 0;

  const bgmVolume =
    typeof options.bgmVolume === 'number' && Number.isFinite(options.bgmVolume)
      ? Math.max(0, Math.min(1, options.bgmVolume))
      : 0.36;

  let onBgmStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;

  const createAudioEl =
    typeof options.createAudioElement === 'function'
      ? options.createAudioElement
      : (url) => {
          if (typeof Audio === 'undefined') return null;
          const el = new Audio(url);
          el.preload = 'metadata';
          return el;
        };

  let bgmEl = null;
  let loadedTrackId = null;
  let loadedTrackUrl = null;
  let paused = false;
  let tabHidden = false;
  let unlocked = false;
  let pendingPlay = false;
  let bgmUnavailable = false;
  let disposed = false;
  let lastContextKey = '';
  const failedTrackIds = new Set();

  function getTrack(idx = currentTrackIdx) {
    const safeIdx = ((idx % BGM_TRACKS.length) + BGM_TRACKS.length) % BGM_TRACKS.length;
    return BGM_TRACKS[safeIdx];
  }

  function findNextHealthyIndex(fromIdx, includeStart = false) {
    const startOffset = includeStart ? 0 : 1;
    for (let step = startOffset; step < BGM_TRACKS.length + startOffset; step++) {
      const idx = (fromIdx + step) % BGM_TRACKS.length;
      if (!failedTrackIds.has(BGM_TRACKS[idx].id)) {
        return idx;
      }
    }
    return -1;
  }

  function notifyBgmChange() {
    if (typeof onBgmStateChange === 'function' && !disposed) {
      try {
        onBgmStateChange(getBgmState());
      } catch {
        // Keep audio resilient against UI callback errors
      }
    }
  }

  function shouldPlayBgm() {
    return !disposed && !muted && musicEnabled && !paused && !tabHidden && !bgmUnavailable;
  }

  function handleTrackEnded() {
    if (disposed || !bgmEl) return;
    const nextIdx = findNextHealthyIndex(currentTrackIdx, false);
    if (nextIdx < 0) {
      bgmUnavailable = true;
      notifyBgmChange();
      return;
    }
    if (nextIdx === currentTrackIdx) {
      // Only one healthy track available: replay cleanly from start
      try {
        bgmEl.currentTime = 0;
      } catch {
        // Ignore non-seekable stubs
      }
      syncBgmPlayback({ allowPlayAttempt: true });
      notifyBgmChange();
      return;
    }
    currentTrackIdx = nextIdx;
    writeStorage(MUSIC_TRACK_KEY, getTrack().id);
    syncBgmPlayback({ allowPlayAttempt: true });
    notifyBgmChange();
  }

  function handleTrackError() {
    if (disposed) return;
    const failedId = loadedTrackId || getTrack().id;
    failedTrackIds.add(failedId);

    const nextIdx = findNextHealthyIndex(currentTrackIdx, false);
    if (nextIdx < 0) {
      bgmUnavailable = true;
      pendingPlay = false;
      try {
        bgmEl?.pause?.();
      } catch {
        // Ignore pause errors
      }
      notifyBgmChange();
      return;
    }

    currentTrackIdx = nextIdx;
    loadedTrackId = null;
    loadedTrackUrl = null;
    syncBgmPlayback({ allowPlayAttempt: unlocked });
    notifyBgmChange();
  }

  function ensureBgmElement() {
    if (disposed || bgmEl) return bgmEl;
    const initialTrack = getTrack();
    const el = createAudioEl(initialTrack.url);
    if (!el) return null;
    el.loop = false;
    el.volume = bgmVolume;
    el.muted = Boolean(muted);
    el.addEventListener?.('ended', handleTrackEnded);
    el.addEventListener?.('error', handleTrackError);
    bgmEl = el;
    loadedTrackId = initialTrack.id;
    loadedTrackUrl = initialTrack.url;
    return bgmEl;
  }

  function syncBgmPlayback({ allowPlayAttempt = false, forceRestartTrack = false } = {}) {
    if (disposed) return;

    if (!shouldPlayBgm()) {
      if (bgmEl) {
        bgmEl.muted = Boolean(muted);
        try {
          bgmEl.pause?.();
        } catch {
          // Ignore pause failures
        }
      }
      pendingPlay = false;
      return;
    }

    const el = ensureBgmElement();
    if (!el) return;

    const track = getTrack();
    el.muted = Boolean(muted);
    el.volume = bgmVolume;
    el.loop = false;

    const srcChanged = loadedTrackUrl !== track.url;
    if (srcChanged || forceRestartTrack) {
      try {
        el.pause?.();
      } catch {
        // Ignore pause errors
      }
      if (srcChanged) {
        loadedTrackId = track.id;
        loadedTrackUrl = track.url;
        el.src = track.url;
        el.load?.();
      }
      try {
        el.currentTime = 0;
      } catch {
        // Ignore seek failures before metadata load
      }
    }

    if (!unlocked && !allowPlayAttempt) {
      pendingPlay = true;
      return;
    }

    const isPaused = el.paused !== false;
    if (!isPaused && !srcChanged && !forceRestartTrack) {
      pendingPlay = false;
      return;
    }

    try {
      const playResult = el.play?.();
      if (playResult && typeof playResult.then === 'function') {
        playResult
          .then(() => {
            if (disposed) return;
            unlocked = true;
            pendingPlay = false;
            // Re-enforce state in case mute/pause changed while promise settled
            if (!shouldPlayBgm()) {
              try {
                el.pause?.();
              } catch {
                // Ignore
              }
            }
            notifyBgmChange();
          })
          .catch(() => {
            if (disposed) return;
            unlocked = false;
            pendingPlay = true;
            notifyBgmChange();
          });
      } else {
        unlocked = true;
        pendingPlay = false;
      }
    } catch {
      pendingPlay = true;
    }
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
    unlocked = true;
    ensureContext();
    syncBgmPlayback({ allowPlayAttempt: true });
    notifyBgmChange();
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

  function playCatMeow(alert = false) {
    if (alert) {
      playTone({
        freq: 760,
        endFreq: 1120,
        type: 'triangle',
        duration: 0.13,
        gain: 0.07,
        attack: 0.008,
      });
      playTone({
        freq: 1080,
        endFreq: 840,
        type: 'sine',
        duration: 0.14,
        gain: 0.05,
        delay: 0.09,
        attack: 0.01,
      });
      return;
    }
    playTone({
      freq: jitter(640, 0.05),
      endFreq: 860,
      type: 'sine',
      duration: 0.14,
      gain: 0.06,
      attack: 0.012,
    });
    playTone({
      freq: 840,
      endFreq: 560,
      type: 'triangle',
      duration: 0.19,
      gain: 0.045,
      delay: 0.09,
      attack: 0.01,
    });
  }

  function playCatPurr() {
    playTone({
      freq: 165,
      endFreq: 148,
      type: 'sine',
      duration: 0.24,
      gain: 0.04,
      attack: 0.025,
    });
    playTone({
      freq: 330,
      endFreq: 296,
      type: 'triangle',
      duration: 0.22,
      gain: 0.022,
      delay: 0.03,
      attack: 0.02,
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

  function playEmoteChime(emoteId = 'heart') {
    if (emoteId === 'ping') {
      playTone({ freq: 880, endFreq: 1318.5, type: 'sine', duration: 0.12, gain: 0.07 });
      playTone({ freq: 1318.5, type: 'sine', duration: 0.18, gain: 0.06, delay: 0.06 });
    } else if (emoteId === 'wave') {
      playTone({ freq: 587.33, endFreq: 783.99, type: 'sine', duration: 0.11, gain: 0.065 });
      playTone({ freq: 783.99, endFreq: 987.77, type: 'sine', duration: 0.13, gain: 0.06, delay: 0.06 });
    } else {
      playTone({ freq: 783.99, type: 'sine', duration: 0.12, gain: 0.065 });
      playTone({ freq: 1046.5, type: 'sine', duration: 0.2, gain: 0.07, delay: 0.06 });
    }
  }

  function playHighFive() {
    playTone({ freq: 659.25, endFreq: 987.77, type: 'triangle', duration: 0.1, gain: 0.09 });
    playTone({ freq: 1046.5, endFreq: 1567.98, type: 'sine', duration: 0.18, gain: 0.08, delay: 0.045 });
  }

  function playGhostWarn() {
    playTone({ freq: 220, endFreq: 164.81, type: 'sawtooth', duration: 0.24, gain: 0.045, attack: 0.02 });
    playTone({ freq: 311.13, endFreq: 233.08, type: 'triangle', duration: 0.28, gain: 0.055, delay: 0.08 });
  }

  function playGhostShock() {
    playTone({ freq: 110, endFreq: 48, type: 'sawtooth', duration: 0.36, gain: 0.14, attack: 0.004 });
    playTone({ freq: 880, endFreq: 210, type: 'square', duration: 0.22, gain: 0.09, attack: 0.002 });
    playTone({ freq: 1240, endFreq: 520, type: 'sawtooth', duration: 0.18, gain: 0.075, delay: 0.05 });
  }

  function playGhostSlap() {
    playTone({ freq: 620, endFreq: 140, type: 'square', duration: 0.09, gain: 0.12, attack: 0.002 });
    playTone({ freq: 940, endFreq: 280, type: 'triangle', duration: 0.12, gain: 0.09, delay: 0.025 });
  }

  function playGhostDevour() {
    playTone({ freq: 195, endFreq: 72, type: 'sawtooth', duration: 0.34, gain: 0.11, attack: 0.01 });
    playTone({ freq: 140, endFreq: 240, type: 'triangle', duration: 0.2, gain: 0.08, delay: 0.14 });
  }

  function playBonesDrop() {
    [760, 580, 910, 640].forEach((freq, i) => {
      playTone({ freq, endFreq: freq * 0.72, type: 'triangle', duration: 0.06, gain: 0.065, delay: i * 0.045, attack: 0.002 });
    });
  }

  function playCarryPickup() {
    playTone({ freq: 392, endFreq: 587.33, type: 'sine', duration: 0.12, gain: 0.08 });
    playTone({ freq: 587.33, endFreq: 783.99, type: 'triangle', duration: 0.12, gain: 0.06, delay: 0.04 });
  }

  function playCarryDrop() {
    playTone({ freq: 523.25, endFreq: 349.23, type: 'sine', duration: 0.12, gain: 0.075 });
  }

  function playDanceStep(stepIdx = 0, style = 'waltz') {
    const scale = style === 'disco'
      ? [523.25, 659.25, 783.99, 987.77]
      : [440, 554.37, 659.25, 880];
    const freq = scale[Math.abs(stepIdx) % scale.length];
    playTone({ freq, endFreq: freq * 1.06, type: 'sine', duration: 0.09, gain: 0.045, attack: 0.004 });
  }

  function playEdgeRescue() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      playTone({ freq, type: 'triangle', duration: 0.15, gain: 0.085, delay: i * 0.04 });
    });
  }

  function playBossHit() {
    playTone({ freq: 185, endFreq: 74, type: 'sawtooth', duration: 0.22, gain: 0.13, attack: 0.003 });
    playTone({ freq: 620, endFreq: 880, type: 'triangle', duration: 0.16, gain: 0.08, delay: 0.04 });
  }

  function playBossDefeat() {
    const fanfare = [392, 523.25, 659.25, 783.99, 1046.5, 1318.51];
    fanfare.forEach((freq, i) => {
      playTone({ freq, type: i % 2 === 0 ? 'triangle' : 'sine', duration: 0.36, gain: 0.1, delay: i * 0.075 });
    });
  }

  function playCameraShutter() {
    playTone({ freq: 1480, endFreq: 420, type: 'square', duration: 0.035, gain: 0.075, attack: 0.001 });
    playTone({ freq: 1120, endFreq: 680, type: 'triangle', duration: 0.05, gain: 0.06, delay: 0.045, attack: 0.001 });
    playTone({ freq: 1046.5, type: 'sine', duration: 0.22, gain: 0.065, delay: 0.09 });
  }

  function playSwordSlash() {
    playTone({ freq: jitter(540, 0.08), endFreq: 210, type: 'triangle', duration: 0.11, gain: 0.085, attack: 0.002 });
  }

  function playHammerSlam() {
    playTone({ freq: 145, endFreq: 48, type: 'sawtooth', duration: 0.2, gain: 0.12, attack: 0.003 });
    playTone({ freq: 240, endFreq: 86, type: 'triangle', duration: 0.16, gain: 0.08, delay: 0.02 });
  }

  function playWandZap() {
    playTone({ freq: 920, endFreq: 1480, type: 'sine', duration: 0.12, gain: 0.075, attack: 0.003 });
    playTone({ freq: 1320, endFreq: 860, type: 'triangle', duration: 0.1, gain: 0.055, delay: 0.04 });
  }

  function playMechanismClick() {
    playTone({ freq: 620, endFreq: 780, type: 'square', duration: 0.055, gain: 0.055, attack: 0.002 });
    playTone({ freq: 940, type: 'sine', duration: 0.09, gain: 0.06, delay: 0.035 });
  }

  function playMonsterHit() {
    playTone({ freq: jitter(220, 0.08), endFreq: 95, type: 'sawtooth', duration: 0.14, gain: 0.09, attack: 0.002 });
  }

  function playMonsterDefeat() {
    playTone({ freq: 340, endFreq: 110, type: 'sawtooth', duration: 0.22, gain: 0.1, attack: 0.003 });
    playTone({ freq: 587.33, endFreq: 880, type: 'sine', duration: 0.18, gain: 0.075, delay: 0.08 });
  }

  function playPlayerHurt() {
    playTone({ freq: 260, endFreq: 120, type: 'sawtooth', duration: 0.18, gain: 0.11, attack: 0.003 });
    playTone({ freq: 180, endFreq: 90, type: 'triangle', duration: 0.16, gain: 0.08, delay: 0.04 });
  }

  function playHealthOrbPickup() {
    [523.25, 659.25, 987.77].forEach((freq, i) => {
      playTone({ freq, type: 'sine', duration: 0.16, gain: 0.08, delay: i * 0.045 });
    });
  }

  function playPuzzleStep() {
    playTone({ freq: jitter(493.88, 0.04), endFreq: 659.25, type: 'triangle', duration: 0.1, gain: 0.075 });
  }

  function playPuzzleSolved() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      playTone({ freq, type: 'sine', duration: 0.24, gain: 0.09, delay: i * 0.06 });
    });
  }

  function playSwimStroke() {
    playTone({ freq: jitter(240, 0.08), endFreq: 380, type: 'sine', duration: 0.12, gain: 0.05, attack: 0.01 });
  }

  function isMuted() {
    return muted;
  }

  function setMuted(value) {
    muted = Boolean(value);
    writeStorage(STORAGE_KEY, muted);
    syncBgmPlayback({ allowPlayAttempt: !muted });
    notifyBgmChange();
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function isMusicEnabled() {
    return musicEnabled;
  }

  function setMusicEnabled(value) {
    musicEnabled = Boolean(value);
    writeStorage(MUSIC_ENABLED_KEY, musicEnabled);
    syncBgmPlayback({ allowPlayAttempt: musicEnabled });
    notifyBgmChange();
    return musicEnabled;
  }

  function toggleMusicEnabled() {
    return setMusicEnabled(!musicEnabled);
  }

  function playBgm(trackIndexOrId, { allowPlayAttempt = true, forceRestart = false } = {}) {
    if (disposed) return getBgmState();
    let targetIdx = currentTrackIdx;
    if (typeof trackIndexOrId === 'number') {
      targetIdx = ((Math.floor(trackIndexOrId) % BGM_TRACKS.length) + BGM_TRACKS.length) % BGM_TRACKS.length;
    } else if (typeof trackIndexOrId === 'string') {
      const found = BGM_TRACKS.findIndex((t) => t.id === trackIndexOrId);
      if (found >= 0) targetIdx = found;
    }

    if (failedTrackIds.has(BGM_TRACKS[targetIdx].id)) {
      const fallbackIdx = findNextHealthyIndex(targetIdx, false);
      if (fallbackIdx < 0) {
        bgmUnavailable = true;
        notifyBgmChange();
        return getBgmState();
      }
      targetIdx = fallbackIdx;
    }

    currentTrackIdx = targetIdx;
    writeStorage(MUSIC_TRACK_KEY, getTrack().id);
    syncBgmPlayback({ allowPlayAttempt, forceRestartTrack: forceRestart });
    notifyBgmChange();
    return getBgmState();
  }

  function nextBgmTrack() {
    if (disposed) return getBgmState();
    const nextIdx = findNextHealthyIndex(currentTrackIdx, false);
    if (nextIdx < 0) {
      bgmUnavailable = true;
      notifyBgmChange();
      return getBgmState();
    }
    currentTrackIdx = nextIdx;
    writeStorage(MUSIC_TRACK_KEY, getTrack().id);
    syncBgmPlayback({ allowPlayAttempt: true, forceRestartTrack: true });
    notifyBgmChange();
    return getBgmState();
  }

  function setWorldMusicContext({ playMode = 'story', worldId = 1, gameState = 'playing' } = {}) {
    if (disposed) return getBgmState();
    const nextContextKey = `${playMode || 'story'}:${worldId ?? 1}`;
    const sameContext = nextContextKey === lastContextKey;
    lastContextKey = nextContextKey;

    if (sameContext) {
      // Keep current track position intact on restarts/respawns
      syncBgmPlayback({ allowPlayAttempt: unlocked });
      notifyBgmChange();
      return getBgmState();
    }

    const preferredId = getPreferredTrackIdForContext({ playMode, worldId });
    const preferredIdx = BGM_TRACKS.findIndex((t) => t.id === preferredId);
    if (preferredIdx >= 0 && !failedTrackIds.has(preferredId) && preferredIdx !== currentTrackIdx) {
      currentTrackIdx = preferredIdx;
      writeStorage(MUSIC_TRACK_KEY, preferredId);
    }

    syncBgmPlayback({ allowPlayAttempt: unlocked && gameState !== 'paused' });
    notifyBgmChange();
    return getBgmState();
  }

  function setPaused(nextPaused) {
    const normalized = Boolean(nextPaused);
    if (paused === normalized) return;
    paused = normalized;
    syncBgmPlayback({ allowPlayAttempt: !paused && unlocked });
    notifyBgmChange();
  }

  function setTabHidden(nextHidden) {
    const normalized = Boolean(nextHidden);
    if (tabHidden === normalized) return;
    tabHidden = normalized;
    syncBgmPlayback({ allowPlayAttempt: !tabHidden && unlocked });
    notifyBgmChange();
  }

  function setBgmOnStateChange(fn) {
    onBgmStateChange = typeof fn === 'function' ? fn : null;
  }

  function getBgmState() {
    const track = getTrack();
    return {
      muted,
      musicEnabled,
      trackIndex: currentTrackIdx,
      trackId: track.id,
      trackTitle: track.title,
      trackUrl: track.url,
      playing: Boolean(bgmEl && bgmEl.paused === false && shouldPlayBgm()),
      paused,
      tabHidden,
      pendingUnlock: pendingPlay,
      unavailable: bgmUnavailable,
      failedTrackIds: Array.from(failedTrackIds),
    };
  }

  function dispose() {
    disposed = true;
    onBgmStateChange = null;
    if (bgmEl) {
      try {
        bgmEl.pause?.();
      } catch {
        // Ignore
      }
      bgmEl.removeEventListener?.('ended', handleTrackEnded);
      bgmEl.removeEventListener?.('error', handleTrackError);
      bgmEl = null;
    }
    if (ctx && typeof ctx.close === 'function') {
      ctx.close().catch(() => {});
    }
    ctx = null;
  }

  return {
    unlock,
    isMuted,
    setMuted,
    toggleMute,
    isMusicEnabled,
    setMusicEnabled,
    toggleMusicEnabled,
    playBgm,
    nextBgmTrack,
    setWorldMusicContext,
    setPaused,
    setTabHidden,
    setBgmOnStateChange,
    getBgmState,
    dispose,
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
    playEmoteChime,
    playHighFive,
    playGhostWarn,
    playGhostShock,
    playGhostSlap,
    playGhostDevour,
    playBonesDrop,
    playCarryPickup,
    playCarryDrop,
    playDanceStep,
    playEdgeRescue,
    playBossHit,
    playBossDefeat,
    playCameraShutter,
    playSwordSlash,
    playHammerSlam,
    playWandZap,
    playMechanismClick,
    playMonsterHit,
    playMonsterDefeat,
    playPlayerHurt,
    playHealthOrbPickup,
    playPuzzleStep,
    playPuzzleSolved,
    playSwimStroke,
    playCatMeow,
    playCatPurr,
  };
}
