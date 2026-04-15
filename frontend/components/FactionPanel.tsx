import React, { useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction } from '../types';
import MarkdownText from './MarkdownText';
import LibraryPicker from './LibraryPicker';

function repLabel(rep: number): string {
  if (rep <= -50) return 'Hostile';
  if (rep <= -20) return 'Unfriendly';
  if (rep < 20)  return 'Neutral';
  if (rep < 50)  return 'Friendly';
  return 'Allied';
}

function repColor(rep: number): string {
  if (rep <= -50) return '#c0392b';
  if (rep <= -20) return '#e67e22';
  if (rep < 20)  return '#888898';
  if (rep < 50)  return '#5d9e5d';
  return '#4caf6e';
}

// Convert -100..100 to 0..100% for the bar fill position
function repBarPct(rep: number): number {
  return Math.min(100, Math.max(0, ((rep + 100) / 200) * 100));
}

interface EditState {
  name: string; description: string; reputation: string; notes: string; color: string;
}

function toEdit(f: Faction): EditState {
  return { name: f.name, description: f.description, reputation: String(f.reputation), notes: f.notes, color: f.color };
}

function blankEdit(): EditState {
  return { name: '', description: '', reputation: '0', notes: '', color: '#888888' };
}

function fromEdit(e: EditState): Omit<Faction, 'id' | 'created_at'> {
  return {
    name: e.name.trim() || 'Unnamed Faction',
    description: e.description.trim(),
    reputation: Math.max(-100, Math.min(100, parseInt(e.reputation) || 0)),
    notes: e.notes.trim(),
    color: e.color || '#888888',
  };
}

interface Props {
  factions: Faction[];
  isDMMode: boolean;
  onCreate: (data: Omit<Faction, 'id' | 'created_at'>) => Promise<Faction>;
  onUpdate: (id: number, data: Partial<Faction>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onLightbox: (url: string) => void;
}

export default function FactionPanel({ factions, isDMMode, onCreate, onUpdate, onDelete, onLightbox }: Props) {
  const [editingId,   setEditingId]   = useState<number | 'new' | null>(null);
  const [editState,   setEditState]   = useState<EditState | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl,  setPendingUrl]  = useState<string | null>(null);
  const [sortBy,      setSortBy]      = useState<'default' | 'rep-desc' | 'rep-asc'>('default');

  const startNew  = () => { setEditState(blankEdit()); setEditingId('new'); setPendingFile(null); setPendingUrl(null); };
  const startEdit = (f: Faction) => { setEditState(toEdit(f)); setEditingId(f.id); };
  const cancel    = () => { setEditingId(null); setEditState(null); setPendingFile(null); setPendingUrl(null); };

  const sortedFactions = sortBy === 'default' ? factions
    : [...factions].sort((a, b) => sortBy === 'rep-desc' ? b.reputation - a.reputation : a.reputation - b.reputation);

  const save = async () => {
    if (!editState) return;
    setSaving(true);
    try {
      if (editingId === 'new') {
        const faction = await onCreate(fromEdit(editState));
        if (pendingFile) {
          try { await api.factions.uploadImage(faction.id, pendingFile); await onUpdate(faction.id, {}); } catch (e) { console.error(e); }
        } else if (pendingUrl) {
          try { await onUpdate(faction.id, { image_url: pendingUrl }); } catch (e) { console.error(e); }
        }
      } else if (typeof editingId === 'number') {
        await onUpdate(editingId, fromEdit(editState));
      }
      cancel();
    } finally { setSaving(false); }
  };

  const handleDelete = async (f: Faction) => {
    if (!confirm(`Delete faction "${f.name}"?`)) return;
    await onDelete(f.id);
  };

  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setEditState(prev => prev ? { ...prev, [key]: e.target.value } : prev);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {isDMMode && editingId === null && (
          <button className="btn btn-primary btn-sm" onClick={startNew}>+ Add Faction</button>
        )}
        {factions.length > 1 && (
          <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', marginLeft: 'auto' }}>
            {(['default', 'rep-desc', 'rep-asc'] as const).map(s => (
              <button key={s}
                style={{ padding: '3px 8px', fontSize: 11, border: 'none', cursor: 'pointer', background: sortBy === s ? 'var(--accent)' : 'transparent', color: sortBy === s ? '#15100a' : 'var(--text-muted)', fontWeight: sortBy === s ? 700 : 400 }}
                onClick={() => setSortBy(s)}
                title={s === 'default' ? 'Default order' : s === 'rep-desc' ? 'Highest rep first' : 'Lowest rep first'}
              >
                {s === 'default' ? '— ' : s === 'rep-desc' ? '↑ Rep' : '↓ Rep'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Edit / Create form */}
      {editState && (
        <div className="party-edit-form">
          <div className="form-group"><label className="form-label">Name</label><input value={editState.name} onChange={set('name')} placeholder="Faction name" /></div>
          <div className="form-group"><label className="form-label">Description</label><textarea value={editState.description} onChange={set('description')} rows={2} placeholder="Brief description (supports **bold**, - lists)" /></div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Reputation ({editState.reputation})</label>
              <input type="range" min={-100} max={100} value={editState.reputation}
                onChange={e => setEditState(prev => prev ? { ...prev, reputation: e.target.value } : prev)}
                style={{ width: '100%', accentColor: repColor(parseInt(editState.reputation) || 0) }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                <span>Hostile</span><span>Neutral</span><span>Allied</span>
              </div>
            </div>
            <div className="form-group" style={{ flexShrink: 0, width: 80 }}>
              <label className="form-label">Color</label>
              <input type="color" value={editState.color} onChange={set('color')} style={{ height: 36, padding: 2, cursor: 'pointer' }} />
            </div>
          </div>
          {isDMMode && <div className="form-group"><label className="form-label">Notes (DM only)</label><textarea value={editState.notes} onChange={set('notes')} rows={2} placeholder="Private notes…" /></div>}
          {isDMMode && (
            <div className="form-group">
              <label className="form-label">Crest / Banner Image</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  🖼 Upload
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (editingId === 'new') {
                      setPendingFile(f); setPendingUrl(null);
                    } else if (typeof editingId === 'number') {
                      try { await api.factions.uploadImage(editingId, f); await onUpdate(editingId, {}); }
                      catch (err) { console.error('Image upload failed:', err); }
                    }
                    e.target.value = '';
                  }} />
                </label>
                <button className="btn btn-sm" onClick={() => setShowLibrary(true)}>📚 Library</button>
                {editingId === 'new' && (pendingFile || pendingUrl) && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--success-text)' }}>
                      {pendingFile ? `📎 ${pendingFile.name}` : '🖼 Library image selected'}
                    </span>
                    <button className="btn btn-sm btn-ghost" onClick={() => { setPendingFile(null); setPendingUrl(null); }}>✕</button>
                  </>
                )}
                {typeof editingId === 'number' && factions.find(fc => fc.id === editingId)?.image_url && (
                  <button className="btn btn-sm" onClick={async () => {
                    try { await api.factions.deleteImage(editingId as number); await onUpdate(editingId as number, {}); }
                    catch (err) { console.error('Image delete failed:', err); }
                  }}>🗑 Remove</button>
                )}
              </div>
            </div>
          )}
          <div className="form-actions">
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn btn-sm" onClick={cancel} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}

      {showLibrary && editingId === 'new' && (
        <LibraryPicker
          onSelect={url => { setPendingUrl(url); setPendingFile(null); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showLibrary && typeof editingId === 'number' && (
        <LibraryPicker
          onSelect={async url => { await onUpdate(editingId, { image_url: url }); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {factions.length === 0 && editingId === null && (
        <div className="no-sel"><div>No factions yet.</div>{isDMMode && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Track organizations and their standing with the party.</div>}</div>
      )}

      {sortedFactions.map(f => {
        const pct   = repBarPct(f.reputation);
        const color = repColor(f.reputation);
        const label = repLabel(f.reputation);
        return (
          <div key={f.id} className="faction-card" style={f.is_visible === false ? { opacity: 0.55 } : undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                {f.image_url ? (
                  <img
                    src={`${API_BASE}${f.image_url}`}
                    alt={f.name}
                    style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', border: '2px solid var(--border)', cursor: 'zoom-in', flexShrink: 0 }}
                    onClick={e => { e.stopPropagation(); onLightbox(`${API_BASE}${f.image_url!}`); }}
                  />
                ) : (
                  <div className="faction-color-dot" style={{ background: f.color, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{f.name}</div>
                  {f.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}><MarkdownText>{f.description}</MarkdownText></div>}
                </div>
              </div>
              {isDMMode && editingId === null && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    className={`btn btn-sm btn-ghost btn-icon${f.is_visible !== false ? '' : ' vis-off'}`}
                    title={f.is_visible !== false ? 'Visible to players — click to hide' : 'Hidden from players — click to reveal'}
                    onClick={async () => await onUpdate(f.id, { is_visible: !(f.is_visible !== false) })}
                  >
                    {f.is_visible !== false ? '👁' : '🔒'}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-icon" onClick={() => startEdit(f)} title="Edit">✏</button>
                  <button className="btn btn-sm btn-ghost btn-icon" onClick={() => handleDelete(f)} title="Delete">✕</button>
                </div>
              )}
            </div>

            {/* Reputation bar */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Reputation</span>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>
                  {f.reputation > 0 ? '+' : ''}{f.reputation} — {label}
                </span>
              </div>
              <div className="rep-bar">
                {/* Center tick mark */}
                <div className="rep-center-tick" />
                <div className="rep-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
            </div>

            {isDMMode && f.notes && (
              <div className="dm-box" style={{ marginTop: 8 }}>
                <div className="dm-box-label">🔒 Notes</div>
                <div className="dm-box-text"><MarkdownText>{f.notes}</MarkdownText></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
