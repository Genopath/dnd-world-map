import { useEffect, useRef, useState } from 'react';

interface Props {
  campaignName: string;
  campaignSlug: string;
  onDM:     () => void;
  onPlayer: () => void;
}

type Phase = 'role' | 'dm-auth' | 'dm-set';

function passcodeKey(slug: string) { return `dm_passcode_${slug}`; }

export default function LoginScreen({ campaignName, campaignSlug, onDM, onPlayer }: Props) {
  const [phase,    setPhase]    = useState<Phase>('role');
  const [input,    setInput]    = useState('');
  const [error,    setError]    = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const hasPasscode = typeof window !== 'undefined'
    ? !!localStorage.getItem(passcodeKey(campaignSlug))
    : false;

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

  return (
    <div className="login-overlay">
      <div className="login-bg" aria-hidden="true" />

      <div className="login-card">
        <div className="login-campaign-name">{campaignName}</div>

        {phase === 'role' && (
          <>
            <h2 className="login-title">Who are you?</h2>
            <p className="login-subtitle">Choose your role to enter the campaign</p>

            <div className="login-role-btns">
              <button className="login-role-btn login-role-dm" onClick={handleDMChoice}>
                <span className="login-role-icon">⚔</span>
                <span className="login-role-label">Dungeon Master</span>
                <span className="login-role-hint">{hasPasscode ? 'Passcode required' : 'Set a passcode'}</span>
              </button>
              <button className="login-role-btn login-role-player" onClick={onPlayer}>
                <span className="login-role-icon">🗺</span>
                <span className="login-role-label">Player</span>
                <span className="login-role-hint">View-only mode</span>
              </button>
            </div>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Helper — read per-campaign passcode key (used by index.tsx for the change-passcode flow) */
export { passcodeKey };
