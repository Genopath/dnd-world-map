/**
 * Fantasy UI sound effects — synthesized via Web Audio API (no asset files).
 * All sounds are short, subtle, and thematic for a D&D map tool.
 * Designed to evoke medieval/fantasy instruments: bells, lutes, parchment, horn.
 */

let _ctx: AudioContext | null = null;
let _muted: boolean =
  typeof window !== 'undefined' && localStorage.getItem('sounds_muted') === '1';

export function isSoundMuted(): boolean { return _muted; }

export function setSoundMuted(v: boolean): void {
  _muted = v;
  if (typeof window !== 'undefined') localStorage.setItem('sounds_muted', v ? '1' : '0');
}

function ac(): AudioContext | null {
  if (_muted) return null;
  try {
    if (!_ctx) _ctx = new AudioContext();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  } catch { return null; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function masterGain(c: AudioContext, vol: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(vol, c.currentTime);
  g.connect(c.destination);
  return g;
}

/** Single oscillator partial with ADSR-like envelope */
function tone(
  c: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  startVol: number,
  when: number,
  duration: number,
  attack = 0.005,
) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(startVol, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  g.connect(dest);

  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, when);
  if (freqEnd !== freqStart) o.frequency.exponentialRampToValueAtTime(freqEnd, when + duration);
  o.connect(g);
  o.start(when);
  o.stop(when + duration + 0.02);
}

/** Noise burst through a bandpass or lowpass filter */
function noise(
  c: AudioContext,
  dest: AudioNode,
  vol: number,
  when: number,
  duration: number,
  filterType: BiquadFilterType = 'lowpass',
  filterFreq = 2000,
  filterQ = 1,
) {
  const bufLen = Math.ceil(c.sampleRate * (duration + 0.05));
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;

  const filt = c.createBiquadFilter();
  filt.type = filterType;
  filt.frequency.setValueAtTime(filterFreq, when);
  filt.Q.setValueAtTime(filterQ, when);

  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start(when);
  src.stop(when + duration + 0.05);
}

/**
 * Bell/chime tone using inharmonic partials (simulates real bell physics).
 * Ratios: 1.0, 2.756, 5.404, 8.933 — from struck metal research.
 */
function bell(
  c: AudioContext,
  dest: AudioNode,
  fundamental: number,
  vol: number,
  when: number,
  duration: number,
) {
  const partials: [number, number, number][] = [
    // [ratio, relative volume, relative decay]
    [1.000, 1.00, 1.00],
    [2.756, 0.45, 0.60],
    [5.404, 0.25, 0.40],
    [8.933, 0.12, 0.25],
  ];
  for (const [ratio, relVol, relDecay] of partials) {
    const freq = fundamental * ratio;
    if (freq > 18000) continue;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol * relVol, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration * relDecay);
    g.connect(dest);

    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, when);
    o.connect(g);
    o.start(when);
    o.stop(when + duration + 0.02);
  }
}

/**
 * Plucked string — multiple harmonics, higher ones decay faster (lute/harp).
 */
function pluck(
  c: AudioContext,
  dest: AudioNode,
  fundamental: number,
  vol: number,
  when: number,
  duration: number,
) {
  const harmonics: [number, number, number][] = [
    [1, 1.00, 1.00],
    [2, 0.50, 0.55],
    [3, 0.25, 0.35],
    [4, 0.12, 0.22],
    [5, 0.06, 0.15],
  ];
  // Very slight detuning for warmth
  const detune = [0, 1.002, 0.998, 1.003, 0.997];
  for (let i = 0; i < harmonics.length; i++) {
    const [h, relVol, relDecay] = harmonics[i];
    const freq = fundamental * h * detune[i];
    if (freq > 16000) continue;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol * relVol, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration * relDecay);
    g.connect(dest);

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(freq, when);
    o.connect(g);
    o.start(when);
    o.stop(when + duration + 0.02);
  }
}

// ── Sound library ─────────────────────────────────────────────────────────────

/** Barely-there soft pluck when hovering/selecting a map pin */
export function playPinSelect() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.32);
  const now = c.currentTime;
  // Single fundamental only — no harmonics, very quiet, very short
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.12, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  g.connect(mg);
  const o = c.createOscillator();
  o.type = 'triangle'; o.frequency.setValueAtTime(660, now);
  o.connect(g); o.start(now); o.stop(now + 0.14);
}

/** Wax-seal stamp thud when placing a new pin */
export function playPinPlace() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.9);
  const now = c.currentTime;
  // Heavy thud — low resonant knock
  noise(c, mg, 0.22, now, 0.12, 'bandpass', 180, 8);
  noise(c, mg, 0.10, now, 0.08, 'lowpass', 400, 1);
  // Tiny wax-seal shimmer after
  bell(c, mg, 1760, 0.09, now + 0.05, 0.28);
}

/** Parchment crumple / quill scratch when deleting a pin */
export function playPinDelete() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.8);
  const now = c.currentTime;
  // Crinkle: bandpass noise sweeping down in frequency
  const bufLen = Math.ceil(c.sampleRate * 0.28);
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;

  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(3500, now);
  filt.frequency.exponentialRampToValueAtTime(600, now + 0.25);
  filt.Q.setValueAtTime(3, now);

  const g = c.createGain();
  g.gain.setValueAtTime(0.18, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  src.connect(filt); filt.connect(g); g.connect(mg);
  src.start(now); src.stop(now + 0.30);
}

/** Book page / leather turn when switching sidebar tabs */
export function playTabSwitch() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.7);
  const now = c.currentTime;
  // Soft whoosh through parchment-range frequencies
  noise(c, mg, 0.14, now, 0.09, 'bandpass', 1800, 2.5);
  noise(c, mg, 0.06, now + 0.03, 0.07, 'bandpass', 800, 2);
}

/** Triumphant ascending arpeggio when a quest is completed — keep exactly as-is (user approved) */
export function playQuestComplete() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  // C5 - E5 - G5 - C6 arpeggio
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    tone(c, mg, 'triangle', freq, freq, 0.22, now + i * 0.1, 0.22);
  });
  // Sparkle on top
  tone(c, mg, 'sine', 2093, 1760, 0.08, now + 0.3, 0.25);
}

/** Medieval horn ascending motif when entering DM mode */
export function playDMUnlock() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.75);
  const now = c.currentTime;
  // 3-note ascending horn call (G4 → B4 → D5), slightly heroic
  const hornNotes = [392, 493.88, 587.33];
  hornNotes.forEach((freq, i) => {
    pluck(c, mg, freq, 0.28, now + i * 0.11, 0.32);
  });
  // Warm sustain resonance
  noise(c, mg, 0.04, now, 0.38, 'lowpass', 600, 1);
}

/** Horn descending when leaving DM mode */
export function playDMLock() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.70);
  const now = c.currentTime;
  // Descending horn call (D5 → B4 → G4)
  const hornNotes = [587.33, 493.88, 392];
  hornNotes.forEach((freq, i) => {
    pluck(c, mg, freq, 0.24, now + i * 0.10, 0.28);
  });
}

/** Quill tap on parchment when placing a ruler waypoint */
export function playRulerTick() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.65);
  const now = c.currentTime;
  // Tiny wooden knock
  noise(c, mg, 0.18, now, 0.04, 'bandpass', 2200, 6);
  noise(c, mg, 0.08, now, 0.03, 'bandpass', 900, 4);
}

/** Boot on cobblestone footstep when adding to party path */
export function playPathAdd() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.85);
  const now = c.currentTime;
  // Heavy low thud (boot strike)
  noise(c, mg, 0.25, now, 0.10, 'bandpass', 140, 5);
  // Stone resonance tail
  noise(c, mg, 0.10, now + 0.02, 0.14, 'lowpass', 350, 1);
  // Tiny scrape on the beat
  noise(c, mg, 0.06, now + 0.03, 0.07, 'bandpass', 2800, 3);
}

/** Scroll unfurling on parchment when opening search */
export function playSearchOpen() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.7);
  const now = c.currentTime;
  // Long papery crinkle that fades
  const bufLen = Math.ceil(c.sampleRate * 0.22);
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;

  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.setValueAtTime(1000, now);
  filt.frequency.exponentialRampToValueAtTime(3500, now + 0.22);
  filt.Q.setValueAtTime(2, now);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.16, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  src.connect(filt); filt.connect(g); g.connect(mg);
  src.start(now); src.stop(now + 0.25);
}

/** Ethereal bell cluster for fog-of-war reveal */
export function playFogReveal() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.7);
  const now = c.currentTime;
  // Staggered bell tones — mysterious, not shrill
  const notes = [523.25, 659.25, 880, 1046.5];
  notes.forEach((freq, i) => {
    bell(c, mg, freq, 0.14, now + i * 0.07, 0.7 - i * 0.05);
  });
}

/** Lute chord strum when switching campaigns */
export function playCampaignSwitch() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.85);
  const now = c.currentTime;
  // Strum a G major chord (G3, B3, D4, G4) with slight delay between strings
  const strings = [196, 246.94, 293.66, 392];
  strings.forEach((freq, i) => {
    pluck(c, mg, freq, 0.22, now + i * 0.025, 0.55 + i * 0.05);
  });
  // Soft whoosh of air alongside the strum
  noise(c, mg, 0.05, now, 0.15, 'lowpass', 700, 1);
}

// ── Fairy Fountain theme (real audio file, looping) ──────────────────────────

let _fairyGain:   GainNode | null = null;
let _fairySrc:    AudioBufferSourceNode | null = null;
let _fairyBuffer: AudioBuffer | null = null;

/** Preload the audio buffer (call once on app start, no gesture needed) */
export async function preloadFairyFountain(): Promise<void> {
  if (_fairyBuffer) return;
  try {
    const res = await fetch('/great_fairy_fountain.ogg');
    const arr = await res.arrayBuffer();
    // Need a throw-away context just for decoding if _ctx not yet created
    const c = _ctx ?? new AudioContext();
    _fairyBuffer = await c.decodeAudioData(arr);
  } catch { /* silently skip if file missing */ }
}

/** Stop and fade out the fairy fountain theme */
export function stopFairyFountain() {
  if (_fairyGain && _ctx) {
    const g = _fairyGain;
    const t = _ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    setTimeout(() => { try { _fairySrc?.stop(); } catch { /* already stopped */ } }, 650);
    _fairyGain = null;
    _fairySrc  = null;
  }
}

/**
 * Play the Great Fairy Fountain theme on loop.
 * Must be called from a user-gesture context (click / keydown).
 * Call stopFairyFountain() to fade it out.
 */
export async function playFairyFountain(): Promise<void> {
  if (_fairySrc) return; // already playing
  const c = ac(); if (!c) return;

  // Decode buffer if not yet loaded
  if (!_fairyBuffer) await preloadFairyFountain();
  if (!_fairyBuffer) return;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.linearRampToValueAtTime(0.85, c.currentTime + 1.2); // gentle fade-in
  g.connect(c.destination);
  _fairyGain = g;

  const src = c.createBufferSource();
  src.buffer = _fairyBuffer;
  src.loop   = true;
  src.connect(g);
  src.start();
  _fairySrc = src;
}

/** Gentle bell strike for generic positive actions (save, export, etc.) */
export function playChime() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.65);
  const now = c.currentTime;
  bell(c, mg, 880, 0.18, now, 0.50);
  // Quiet octave harmony
  bell(c, mg, 1760, 0.07, now + 0.04, 0.35);
}
