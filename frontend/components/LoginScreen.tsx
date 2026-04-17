import { useEffect, useMemo, useRef, useState } from 'react';
import { playFairyFountain, stopFairyFountain } from '../lib/sounds';

interface Props {
  campaignName: string;
  campaignSlug: string;
  onDM:     () => void;
  onPlayer: () => void;
  onBack:   () => void;
}

type Phase = 'role' | 'dm-auth' | 'dm-set';

function passcodeKey(slug: string) { return `dm_passcode_${slug}`; }

interface Particle { id: number; x: number; y: number; size: number; delay: number; dur: number; }

function makeStars(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100,
    size: Math.random() * 1.8 + 0.4, delay: Math.random() * 5, dur: Math.random() * 3 + 2.5,
  }));
}

function makeSparkles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i, x: Math.random() * 100, y: 40 + Math.random() * 60,
    size: Math.random() * 4 + 2, delay: Math.random() * 8, dur: Math.random() * 5 + 6,
  }));
}

function RuneDivider({ small = false }: { small?: boolean }) {
  const w = small ? 180 : 320;
  return (
    <svg width={w} height={16} viewBox={`0 0 ${w} 16`} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={0} y1={8} x2={w * 0.35} y2={8} stroke="#c9a84c" strokeWidth={0.8} strokeOpacity={0.6} />
      <polygon points={`${w * 0.38},8 ${w * 0.40},4 ${w * 0.42},8 ${w * 0.40},12`} fill="#c9a84c" opacity={0.7} />
      <line x1={w * 0.43} y1={8} x2={w * 0.46} y2={8} stroke="#c9a84c" strokeWidth={0.8} strokeOpacity={0.4} />
      <circle cx={w * 0.5} cy={8} r={3} fill="none" stroke="#c9a84c" strokeWidth={1} opacity={0.9} />
      <circle cx={w * 0.5} cy={8} r={1.2} fill="#c9a84c" opacity={0.9} />
      <line x1={w * 0.54} y1={8} x2={w * 0.57} y2={8} stroke="#c9a84c" strokeWidth={0.8} strokeOpacity={0.4} />
      <polygon points={`${w * 0.58},8 ${w * 0.60},4 ${w * 0.62},8 ${w * 0.60},12`} fill="#c9a84c" opacity={0.7} />
      <line x1={w * 0.63} y1={8} x2={w} y2={8} stroke="#c9a84c" strokeWidth={0.8} strokeOpacity={0.6} />
    </svg>
  );
}

export default function LoginScreen({ campaignName, campaignSlug, onDM, onPlayer, onBack }: Props) {
  const [phase,     setPhase]     = useState<Phase>('role');
  const [input,     setInput]     = useState('');
  const [error,     setError]     = useState('');
  const [activeBtn, setActiveBtn] = useState<'dm' | 'player' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const stars    = useMemo(() => makeStars(90), []);
  const sparkles = useMemo(() => makeSparkles(28), []);

  const hasPasscode = typeof window !== 'undefined'
    ? !!localStorage.getItem(passcodeKey(campaignSlug))
    : false;

  // Keep music playing from CampaignSelector; stop it when entering the map
  useEffect(() => {
    playFairyFountain(); // no-op if already playing
    return () => stopFairyFountain();
  }, []);

  useEffect(() => {
    if ((phase === 'dm-auth' || phase === 'dm-set') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [phase]);

  const handleDMChoice = () => {
    if (hasPasscode) { setPhase('dm-auth'); setInput(''); setError(''); }
    else             { setPhase('dm-set');  setInput(''); setError(''); }
  };

  const handleSubmit = () => {
    if (phase === 'dm-auth') {
      const stored = localStorage.getItem(passcodeKey(campaignSlug)) ?? '';
      if (input === stored) { onDM(); }
      else { setError('Incorrect passcode.'); }
    } else if (phase === 'dm-set') {
      if (input.trim()) localStorage.setItem(passcodeKey(campaignSlug), input.trim());
      onDM();
    }
  };

  const handleResetPasscode = () => {
    localStorage.removeItem(passcodeKey(campaignSlug));
    setPhase('dm-set');
    setInput('');
    setError('');
  };

  return (
    <div className="cs-overlay">
      {/* ── Starfield ── */}
      <div className="cs-stars" aria-hidden="true">
        {stars.map(s => (
          <span key={s.id} className="cs-star" style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: `${s.size}px`, height: `${s.size}px`,
            animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
          }} />
        ))}
      </div>

      {/* ── Floating gold sparkles ── */}
      <div className="cs-sparkles" aria-hidden="true">
        {sparkles.map(s => (
          <span key={s.id} className="cs-sparkle" style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: `${s.size}px`, height: `${s.size}px`,
            animationDelay: `${s.delay}s`, animationDuration: `${s.dur}s`,
          }} />
        ))}
      </div>

      {/* ── Radial glow ── */}
      <div className="cs-glow" aria-hidden="true" />

      {/* ── Card ── */}
      <div className="login-card">
        <div className="login-campaign-name">{campaignName}</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <RuneDivider small />
        </div>

        {phase === 'role' && (
          <>
            <h2 className="login-title">Who are you?</h2>
            <p className="login-subtitle">Choose your role to enter the campaign</p>

            <div className="login-role-btns">
              <button
                className="login-role-btn login-role-dm"
                onMouseEnter={() => setActiveBtn('dm')}
                onMouseLeave={() => setActiveBtn(null)}
                onClick={handleDMChoice}
              >
                <span className="login-hand-col" aria-hidden="true">
                  {activeBtn === 'dm' && <span className="cs-hand">☞</span>}
                </span>
                <span className="login-role-icon">⚔</span>
                <span className="login-role-label">Dungeon Master</span>
                <span className="login-role-hint">{hasPasscode ? 'Passcode required' : 'Set a passcode'}</span>
              </button>
              <button
                className="login-role-btn login-role-player"
                onMouseEnter={() => setActiveBtn('player')}
                onMouseLeave={() => setActiveBtn(null)}
                onClick={onPlayer}
              >
                <span className="login-hand-col" aria-hidden="true">
                  {activeBtn === 'player' && <span className="cs-hand">☞</span>}
                </span>
                <span className="login-role-icon">🗺</span>
                <span className="login-role-label">Player</span>
                <span className="login-role-hint">View-only mode</span>
              </button>
            </div>

            <button className="login-back-link" onClick={onBack}>
              ← Back to campaign select
            </button>
          </>
        )}

        {(phase === 'dm-auth' || phase === 'dm-set') && (
          <>
            <h2 className="login-title">
              {phase === 'dm-auth' ? '🔒 Enter DM Passcode' : '🔑 Set DM Passcode'}
            </h2>
            <p className="login-subtitle">
              {phase === 'dm-auth'
                ? 'Enter your passcode to unlock DM mode'
                : 'Choose a passcode to protect DM mode, or leave blank to skip'}
            </p>

            <div className="login-passcode-form">
              <input
                ref={inputRef}
                type="password"
                className="login-passcode-input"
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setPhase('role'); }}
                placeholder={phase === 'dm-auth' ? 'Passcode' : 'New passcode (optional)'}
                autoComplete="off"
              />
              {error && <div className="login-error">{error}</div>}
              <div className="login-passcode-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => setPhase('role')}>← Back</button>
                <button className="btn btn-primary" onClick={handleSubmit}>
                  {phase === 'dm-auth' ? 'Unlock' : 'Continue'}
                </button>
              </div>
              {phase === 'dm-auth' && (
                <button className="login-reset-link" onClick={handleResetPasscode}>
                  Forgot passcode? Reset it
                </button>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <RuneDivider small />
        </div>
      </div>
    </div>
  );
}

/** Helper — read per-campaign passcode key (used by index.tsx for the change-passcode flow) */
export { passcodeKey };
