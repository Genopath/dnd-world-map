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

/** Small bell chime when selecting a map pin */
export function playPinSelect() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.7);
  const now = c.currentTime;
  bell(c, mg, 1320, 0.22, now, 0.55);
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

// ── Fairy Fountain theme ──────────────────────────────────────────────────────
// Module-level gain reference so we can fade it out on splash advance
let _fairyMasterGain: GainNode | null = null;

/** Fade out and stop the fairy fountain theme early */
export function stopFairyFountain() {
  if (_fairyMasterGain && _ctx) {
    const g = _fairyMasterGain;
    const t = _ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    _fairyMasterGain = null;
  }
}

/**
 * Great Fairy Fountain inspired harp theme.
 * Plays on the splash screen — ~4 s, fades cleanly.
 * Call stopFairyFountain() to fade it out if the player skips early.
 *
 * Approximates the Koji Kondo theme:
 *   opening D-major harp arpeggios → descending fairy melody
 */
export function playFairyFountain() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 0.72);
  _fairyMasterGain = mg;
  const now = c.currentTime;

  // ── Soft ambient bass drone (D2) ──────────────────────────────────────────
  {
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
    g.connect(mg);
    const o = c.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(73.42, now); // D2
    o.connect(g); o.start(now); o.stop(now + 4.3);
  }

  // ── Opening harp arpeggio: D4 F#4 A4 D5 F#5 A5 ──────────────────────────
  const arp1 = [293.66, 369.99, 440, 587.33, 739.99, 880]; // D4-A5
  arp1.forEach((freq, i) => {
    pluck(c, mg, freq, 0.18, now + i * 0.052, 1.1 - i * 0.08);
  });

  // ── Melody — dreamy triangle/sine blend ───────────────────────────────────
  // Approximating the descending fairy theme
  const melodyNotes: [number, number, number][] = [
    // [freq Hz, start offset s, duration s]
    [587.33, 0.44, 0.40],   // D5  — first long note
    [554.37, 0.84, 0.16],   // C#5
    [493.88, 1.00, 0.18],   // B4
    [440,    1.18, 0.30],   // A4
    [493.88, 1.48, 0.14],   // B4  — turn
    [392,    1.62, 0.28],   // G4
    [369.99, 1.90, 0.55],   // F#4 — phrase resolve
    // Second phrase — echo a fifth up
    [880,    2.52, 0.26],   // A5 — sparkle
    [783.99, 2.78, 0.18],   // G5
    [739.99, 2.96, 0.20],   // F#5
    [659.25, 3.16, 0.22],   // E5
    [587.33, 3.38, 0.65],   // D5 — final resolve
  ];

  for (const [freq, t, dur] of melodyNotes) {
    // Triangle for warm, flute-like melody
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.linearRampToValueAtTime(0.15, now + t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + dur);
    g.connect(mg);
    const o = c.createOscillator();
    o.type = 'triangle'; o.frequency.setValueAtTime(freq, now + t);
    o.connect(g); o.start(now + t); o.stop(now + t + dur + 0.02);

    // Subtle octave above for shimmer
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, now + t);
    g2.gain.linearRampToValueAtTime(0.04, now + t + 0.04);
    g2.gain.exponentialRampToValueAtTime(0.0001, now + t + dur * 0.6);
    g2.connect(mg);
    const o2 = c.createOscillator();
    o2.type = 'sine'; o2.frequency.setValueAtTime(freq * 2, now + t);
    o2.connect(g2); o2.start(now + t); o2.stop(now + t + dur + 0.02);
  }

  // ── Second harp sweep (D5-F#5-A5-D6) at ~2.5 s ──────────────────────────
  const arp2 = [587.33, 739.99, 880, 1174.66]; // D5-D6
  arp2.forEach((freq, i) => {
    pluck(c, mg, freq, 0.10, now + 2.45 + i * 0.055, 0.70 - i * 0.06);
  });
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
