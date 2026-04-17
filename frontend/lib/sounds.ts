/**
 * Fantasy UI sound effects — synthesized via Web Audio API (no asset files).
 * All sounds are short, subtle, and thematic for a D&D map tool.
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

function tone(
  c: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freqStart: number,
  freqEnd: number,
  startVol: number,
  when: number,
  duration: number,
) {
  const g = c.createGain();
  g.gain.setValueAtTime(startVol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  g.connect(dest);

  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, when);
  if (freqEnd !== freqStart) o.frequency.exponentialRampToValueAtTime(freqEnd, when + duration);
  o.connect(g);
  o.start(when);
  o.stop(when + duration + 0.01);
}

function noise(c: AudioContext, dest: AudioNode, vol: number, when: number, duration: number, lowpass = 2000) {
  const bufLen = Math.ceil(c.sampleRate * (duration + 0.05));
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;

  const filt = c.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(lowpass, when);

  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  src.connect(filt);
  filt.connect(g);
  g.connect(dest);
  src.start(when);
  src.stop(when + duration + 0.05);
}

// ── Sound library ─────────────────────────────────────────────────────────────

/** Soft ping when selecting a map pin */
export function playPinSelect() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 880, 660, 0.18, now, 0.18);
}

/** Satisfying thud+shimmer when placing a new pin */
export function playPinPlace() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  // Low thud
  tone(c, mg, 'sine', 220, 55, 0.35, now, 0.22);
  // High shimmer
  tone(c, mg, 'sine', 1400, 1000, 0.12, now + 0.04, 0.18);
  tone(c, mg, 'sine', 1800, 1200, 0.07, now + 0.06, 0.16);
}

/** Swoosh down when deleting a pin */
export function playPinDelete() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sawtooth', 500, 80, 0.18, now, 0.28);
  noise(c, mg, 0.06, now, 0.20, 800);
}

/** Light parchment tap when switching sidebar tabs */
export function playTabSwitch() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  noise(c, mg, 0.12, now, 0.07, 3000);
  tone(c, mg, 'sine', 520, 480, 0.09, now, 0.09);
}

/** Triumphant ascending arpeggio when a quest is completed */
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

/** Magical unlock sweep when entering DM mode */
export function playDMUnlock() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 220, 880, 0.22, now, 0.40);
  tone(c, mg, 'sine', 330, 1320, 0.10, now + 0.05, 0.35);
  tone(c, mg, 'triangle', 440, 1760, 0.07, now + 0.10, 0.30);
}

/** Lock sweep when leaving DM mode */
export function playDMLock() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 880, 220, 0.20, now, 0.30);
  tone(c, mg, 'sine', 440, 110, 0.08, now + 0.05, 0.25);
}

/** Clean tick when placing a ruler waypoint */
export function playRulerTick() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 1200, 900, 0.14, now, 0.07);
}

/** Soft footstep thud when adding a location to the party path */
export function playPathAdd() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 140, 55, 0.28, now, 0.18);
  noise(c, mg, 0.08, now, 0.12, 500);
}

/** Parchment unfurl when opening search */
export function playSearchOpen() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  noise(c, mg, 0.10, now, 0.12, 4000);
  tone(c, mg, 'sine', 380, 600, 0.10, now, 0.15);
}

/** Sparkle cluster for fog reveal */
export function playFogReveal() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  [1600, 2000, 2500, 3000].forEach((f, i) => {
    tone(c, mg, 'sine', f, f * 0.7, 0.10, now + i * 0.04, 0.18);
  });
}

/** Portal whoosh when switching campaigns */
export function playCampaignSwitch() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sawtooth', 80, 400, 0.20, now, 0.20);
  tone(c, mg, 'sawtooth', 400, 80, 0.20, now + 0.20, 0.25);
  tone(c, mg, 'sine', 600, 1200, 0.10, now + 0.05, 0.35);
  noise(c, mg, 0.08, now, 0.45, 1200);
}

/** Gentle chime for generic positive actions (save, export, etc.) */
export function playChime() {
  const c = ac(); if (!c) return;
  const mg = masterGain(c, 1);
  const now = c.currentTime;
  tone(c, mg, 'sine', 660, 660, 0.15, now, 0.20);
  tone(c, mg, 'sine', 990, 990, 0.08, now + 0.06, 0.16);
}
