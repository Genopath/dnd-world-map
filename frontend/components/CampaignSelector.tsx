import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { CampaignMeta } from '../types';

interface Props {
  currentSlug: string | null;
  onSelect:    (slug: string, name: string) => void;
  onRename?:   (slug: string, name: string) => void;
}

export default function CampaignSelector({ currentSlug, onSelect, onRename }: Props) {
  const [campaigns,    setCampaigns]    = useState<CampaignMeta[]>([]);
  const [newName,      setNewName]      = useState('');
  const [creating,     setCreating]     = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [deleting,     setDeleting]     = useState<string | null>(null);
  const [renamingSlug, setRenamingSlug] = useState<string | null>(null);
  const [renameInput,  setRenameInput]  = useState('');
  const [renaming,     setRenaming]     = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api.campaigns.list().then(list => { setCampaigns(list); setLoading(false); });

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (renamingSlug && renameRef.current) renameRef.current.focus();
  }, [renamingSlug]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const c = await api.campaigns.create(name);
      setNewName('');
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

  return (
    <div className="campaign-overlay">
      <div className="campaign-modal">
        <div className="campaign-modal-header">
          <div style={{ fontSize: 28, marginBottom: 4 }}>⚔</div>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', color: 'var(--accent)', fontSize: 22 }}>
            Choose Campaign
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            Select a campaign or create a new one
          </p>
        </div>

        <div className="campaign-list">
          {loading && <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: 8 }}>Loading…</div>}
          {!loading && campaigns.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '8px 0' }}>
              No campaigns yet — create your first one below.
            </div>
          )}
          {campaigns.map(c => (
            <div
              key={c.slug}
              className={`campaign-item ${c.slug === currentSlug ? 'active' : ''}`}
              onClick={() => renamingSlug !== c.slug && onSelect(c.slug, c.name)}
            >
              {renamingSlug === c.slug ? (
                /* ── Inline rename row ── */
                <div style={{ display: 'flex', gap: 6, flex: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <input
                    ref={renameRef}
                    value={renameInput}
                    onChange={e => setRenameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                    style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={commitRename} disabled={renaming || !renameInput.trim()}>
                    {renaming ? '…' : 'Save'}
                  </button>
                  <button className="btn btn-sm" onClick={cancelRename} disabled={renaming}>Cancel</button>
                </div>
              ) : (
                /* ── Normal row ── */
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{c.slug}</div>
                  </div>
                  <button
                    className="btn btn-sm btn-ghost btn-icon"
                    onClick={e => startRename(c, e)}
                    title="Rename campaign"
                  >
                    ✏
                  </button>
                  {c.slug !== 'default' && (
                    <button
                      className="btn btn-sm btn-ghost btn-icon"
                      style={{ color: 'var(--danger-text)' }}
                      onClick={e => { e.stopPropagation(); handleDelete(c); }}
                      disabled={deleting === c.slug}
                      title="Delete campaign"
                    >
                      {deleting === c.slug ? '…' : '✕'}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="campaign-create">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            placeholder="New campaign name…"
            autoFocus
          />
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
          >
            {creating ? 'Creating…' : '+ Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
