import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { playFairyFountain, stopFairyFountain } from '../lib/sounds';
import type { CampaignMeta } from '../types';

interface Props {
  currentSlug: string | null;
  showSplash?: boolean;
  onSelect:    (slug: string, name: string) => void;
  onRename?:   (slug: string, name: string) => void;
}

type Phase = 'splash' | 'splash-out' | 'select';

interface Star { id: number; x: number; y: number; size: number; delay: number; dur: number; }

function makeStars(n: number): Star[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 1.8 + 0.4,
    delay: Math.random() * 5,
    dur: Math.random() * 3 + 2.5,
  }));
}

// Decorative SVG rune divider
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

export default function CampaignSelector({ currentSlug, showSplash = false, onSelect, onRename }: Props) {
  const [phase, setPhase] = useState<Phase>(showSplash ? 'splash' : 'select');
  const [campaigns,    setCampaigns]    = useState<CampaignMeta[]>([]);
  const [newName,      setNewName]      = useState('');
  const [creating,     setCreating]     = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameInput,  setRenameInput]  = useState('');
  const [renaming,     setRenaming]     = useState(false);
  const [showNew,      setShowNew]      = useState(false);
  const renameRef  = useRef<HTMLInputElement>(null);
  const newNameRef = useRef<HTMLInputElement>(null);
  const stars = useMemo(() => makeStars(90), []);

  const load = () =>
    api.campaigns.list().then(list => { setCampaigns(list); setLoading(false); });

  useEffect(() => { load(); }, []);

  // Stop fairy fountain when component unmounts (campaign selected)
  useEffect(() => {
    // If there's no splash (switching campaigns), we already have a user gesture — start immediately
    if (!showSplash) playFairyFountain();
    return () => stopFairyFountain();
  }, []);

  useEffect(() => {
    if (renamingSlug && renameRef.current) renameRef.current.focus();
  }, [renamingSlug]);

  useEffect(() => {
    if (showNew && newNameRef.current) newNameRef.current.focus();
  }, [showNew]);

  // ── Splash phase: advance on any key or click, auto after 3.5 s
  const advanceSplash = () => {
    // First user gesture — start the music (keeps playing through campaign select)
    playFairyFountain();
    setPhase('splash-out');
    setTimeout(() => setPhase('select'), 550);
  };

  useEffect(() => {
    if (phase !== 'splash') return;
    const timer = setTimeout(advanceSplash, 3500);
    const onKey = () => advanceSplash();
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [phase]);

  // ── Campaign actions ─────────────────────────────────────────────────────────

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const c = await api.campaigns.create(name);
      setNewName('');
      setShowNew(false);
      await load();
      onSelect(c.slug, c.name);
    } finally { setCreating(false); }
  };

  const handleDelete = async (c: CampaignMeta) => {
    if (!confirm(`Delete campaign "${c.name}"? This cannot be undone.`)) return;
    setDeleting(c.slug);
    try {
      await api.campaigns.remove(c.slug);
      await load();
    } finally { setDeleting(null); }
  };

  const startRename = (c: CampaignMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingSlug(c.slug);
    setRenameInput(c.name);
  };

  const commitRename = async () => {
    const name = renameInput.trim();
    if (!name || !renamingSlug) { setRenamingSlug(null); return; }
    setRenaming(true);
    try {
      await api.campaigns.rename(renamingSlug, name);
      await load();
      if (onRename) onRename(renamingSlug, name);
      setRenamingSlug(null);
    } finally { setRenaming(false); }
  };

  const cancelRename = () => { setRenamingSlug(null); setRenameInput(''); };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className={`cs-overlay ${phase === 'splash-out' ? 'cs-overlay--fading' : ''}`}
      onClick={phase === 'splash' ? advanceSplash : undefined}
    >
      {/* ── Starfield ── */}
      <div className="cs-stars" aria-hidden="true">
        {stars.map(s => (
          <span
            key={s.id}
            className="cs-star"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              animationDelay: `${s.delay}s`,
              animationDuration: `${s.dur}s`,
            }}
          />
        ))}
      </div>

      {/* ── Radial glow beneath content ── */}
      <div className="cs-glow" aria-hidden="true" />

      {/* ── Splash screen ── */}
      {(phase === 'splash' || phase === 'splash-out') && (
        <div className={`cs-splash ${phase === 'splash-out' ? 'cs-splash--out' : ''}`}>
          <div className="cs-splash-inner">
            <RuneDivider />
            <h1 className="cs-splash-title">D&amp;D World Map</h1>
            <RuneDivider />
            <p className="cs-splash-subtitle">Your Adventure Awaits</p>
          </div>
          <p className="cs-splash-prompt">— Press any key to continue —</p>
        </div>
      )}

      {/* ── Campaign select screen ── */}
      {phase === 'select' && (
        <div className="cs-screen">
          {/* Header */}
          <div className="cs-header">
            <RuneDivider small />
            <h2 className="cs-screen-title">Choose Your Campaign</h2>
            <RuneDivider small />
          </div>

          {/* Campaign file slots */}
          <div className="cs-file-list">
            {loading && (
              <div className="cs-loading">
                <span className="cs-loading-dot" />
                <span className="cs-loading-dot" />
                <span className="cs-loading-dot" />
                <span style={{ marginLeft: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                  Consulting the ancient scrolls…
                </span>
              </div>
            )}

            {!loading && campaigns.length === 0 && (
              <div className="cs-empty">No campaigns found. Begin a new adventure below.</div>
            )}

            {campaigns.map((c, idx) => (
              <div
                key={c.slug}
                className={`cs-file-slot ${c.slug === currentSlug ? 'cs-file-slot--active' : ''}`}
                style={{ animationDelay: `${idx * 0.07}s` }}
                onClick={() => renamingSlug !== c.slug && onSelect(c.slug, c.name)}
              >
                {renamingSlug === c.slug ? (
                  <div
                    style={{ display: 'flex', gap: 6, flex: 1, alignItems: 'center' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      ref={renameRef}
                      value={renameInput}
                      onChange={e => setRenameInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="cs-rename-input"
                    />
                    <button className="btn btn-primary btn-sm" onClick={commitRename} disabled={renaming || !renameInput.trim()}>
                      {renaming ? '…' : 'Save'}
                    </button>
                    <button className="btn btn-sm" onClick={cancelRename} disabled={renaming}>Cancel</button>
                  </div>
                ) : (
                  <>
                    {/* Slot icon */}
                    <div className="cs-file-icon" aria-hidden="true">
                      {c.slug === currentSlug ? '⚔' : '📜'}
                    </div>
                    {/* Slot info */}
                    <div className="cs-file-info">
                      <div className="cs-file-name">{c.name}</div>
                      <div className="cs-file-slug">{c.slug}</div>
                    </div>
                    {/* Actions */}
                    <div className="cs-file-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className="btn btn-sm btn-ghost btn-icon"
                        onClick={e => startRename(c, e)}
                        title="Rename campaign"
                      >✏</button>
                      {c.slug !== 'default' && (
                        <button
                          className="btn btn-sm btn-ghost btn-icon"
                          style={{ color: 'var(--danger-text)' }}
                          onClick={() => handleDelete(c)}
                          disabled={deleting === c.slug}
                          title="Delete campaign"
                        >
                          {deleting === c.slug ? '…' : '✕'}
                        </button>
                      )}
                    </div>
                    {/* Hover arrow */}
                    <div className="cs-file-arrow" aria-hidden="true">›</div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* New campaign section */}
          <div className="cs-new-area">
            {!showNew ? (
              <button
                className="cs-new-btn"
                onClick={() => setShowNew(true)}
              >
                <span className="cs-new-icon">✦</span>
                Begin a New Adventure
              </button>
            ) : (
              <div className="cs-new-form">
                <input
                  ref={newNameRef}
                  className="cs-new-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setShowNew(false); setNewName(''); }
                  }}
                  placeholder="Campaign name…"
                />
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? 'Creating…' : '+ Create'}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => { setShowNew(false); setNewName(''); }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="cs-footer-ornament" aria-hidden="true">
            <RuneDivider />
          </div>
        </div>
      )}
    </div>
  );
}
