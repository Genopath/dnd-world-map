import React, { useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { SessionEntry } from '../types';
import MarkdownText from './MarkdownText';

type EditState = {
  session_number: number;
  title: string;
  in_world_date: string;
  real_date: string;
  summary: string;
  xp_awarded: number;
  loot_notes: string;
};

function nextBlank(sessions: SessionEntry[]): EditState {
  const max = sessions.reduce((m, s) => Math.max(m, s.session_number), 0);
  return { session_number: max + 1, title: '', in_world_date: '', real_date: new Date().toISOString().slice(0, 10), summary: '', xp_awarded: 0, loot_notes: '' };
}

interface Props {
  sessions: SessionEntry[];
  isDMMode: boolean;
  onCreate: (data: Omit<SessionEntry, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: number, data: Partial<SessionEntry>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onLightbox: (url: string) => void;
}

export default function SessionPanel({ sessions, isDMMode, onCreate, onUpdate, onDelete, onLightbox }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editState,  setEditState]  = useState<EditState | null>(null);
  const [isAdding,   setIsAdding]   = useState(false);
  const [addState,   setAddState]   = useState<EditState>(nextBlank(sessions));
  const [saving,     setSaving]     = useState(false);

  const sorted = [...sessions].sort((a, b) => b.session_number - a.session_number);

  const startEdit = (s: SessionEntry) => {
    setEditingId(s.id);
    setEditState({ session_number: s.session_number, title: s.title, in_world_date: s.in_world_date, real_date: s.real_date, summary: s.summary, xp_awarded: s.xp_awarded, loot_notes: s.loot_notes });
  };

  const saveEdit = async () => {
    if (!editState || editingId == null) return;
    setSaving(true);
    try { await onUpdate(editingId, editState); setEditingId(null); }
    finally { setSaving(false); }
  };

  const saveAdd = async () => {
    setSaving(true);
    try { await onCreate(addState); setIsAdding(false); setAddState(nextBlank(sessions)); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </span>
        {isDMMode && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setAddState(nextBlank(sessions)); setIsAdding(true); }}>
            + Add Session
          </button>
        )}
      </div>

      {isAdding && isDMMode && (
        <SessionForm state={addState} onChange={setAddState} onSave={saveAdd} onCancel={() => setIsAdding(false)} saving={saving} isNew />
      )}

      {sorted.length === 0 && !isAdding && (
        <div className="path-empty">
          No sessions logged yet.
          {isDMMode && <><br /><span style={{ fontSize: 12 }}>Click "+ Add Session" to start.</span></>}
        </div>
      )}

      {sorted.map(s => (
        <div key={s.id} className="session-card" style={s.is_visible === false ? { opacity: 0.55 } : undefined} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div className="session-num">#{s.session_number}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{s.title || `Session ${s.session_number}`}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                {s.real_date     && <span>🗓 {s.real_date}</span>}
                {s.in_world_date && <span>⏳ {s.in_world_date}</span>}
                {s.xp_awarded > 0 && <span style={{ color: 'var(--accent)' }}>+{s.xp_awarded.toLocaleString()} XP</span>}
              </div>
            </div>
            {isDMMode && (
              <button
                className={`btn btn-sm btn-ghost btn-icon${s.is_visible !== false ? '' : ' vis-off'}`}
                title={s.is_visible !== false ? 'Visible to players — click to hide' : 'Hidden from players — click to reveal'}
                onClick={async e => { e.stopPropagation(); await onUpdate(s.id, { is_visible: !(s.is_visible !== false) }); }}
              >
                {s.is_visible !== false ? '👁' : '🔒'}
              </button>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>{expandedId === s.id ? '▲' : '▼'}</span>
          </div>

          {expandedId === s.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
              {editingId === s.id && editState ? (
                <SessionForm state={editState} onChange={setEditState} onSave={saveEdit} onCancel={() => setEditingId(null)} saving={saving} />
              ) : (
                <>
                  {s.image_url && (
                    <img
                      src={`${API_BASE}${s.image_url}`}
                      alt={s.title || `Session ${s.session_number}`}
                      className="detail-hero-img"
                      onClick={() => onLightbox(`${API_BASE}${s.image_url!}`)}
                    />
                  )}
                  {s.summary    && <div style={{ marginBottom: 8 }}><div className="section-label" style={{ marginBottom: 4 }}>Summary</div><MarkdownText>{s.summary}</MarkdownText></div>}
                  {s.loot_notes && <div style={{ marginBottom: 8 }}><div className="section-label" style={{ marginBottom: 4 }}>Loot & Rewards</div><MarkdownText>{s.loot_notes}</MarkdownText></div>}
                  {isDMMode && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button>
                      <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                        📷 Image
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          try { await api.sessions.uploadImage(s.id, f); await onUpdate(s.id, {}); }
                          catch (err) { console.error('Image upload failed:', err); }
                          e.target.value = '';
                        }} />
                      </label>
                      {s.image_url && (
                        <button className="btn btn-sm" onClick={async e => { e.stopPropagation(); await api.sessions.deleteImage(s.id); await onUpdate(s.id, {}); }}>🗑 Image</button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={async e => { e.stopPropagation(); if (confirm(`Delete session #${s.session_number}?`)) await onDelete(s.id); }}>Delete</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Session form ──────────────────────────────────────────────────────────────

interface FormProps {
  state:    EditState;
  onChange: (s: EditState) => void;
  onSave:   () => void;
  onCancel: () => void;
  saving:   boolean;
  isNew?:   boolean;
}

function SessionForm({ state, onChange, onSave, onCancel, saving, isNew }: FormProps) {
  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const val = (key === 'session_number' || key === 'xp_awarded') ? Number(e.target.value) : e.target.value;
      onChange({ ...state, [key]: val });
    };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Session #</label>
          <input type="number" value={state.session_number} onChange={set('session_number')} min={1} autoFocus={isNew} />
        </div>
        <div className="form-group">
          <label className="form-label">XP Awarded</label>
          <input type="number" value={state.xp_awarded} onChange={set('xp_awarded')} min={0} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Title</label>
        <input value={state.title} onChange={set('title')} placeholder="e.g. The Mines of Madness" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Real Date</label>
          <input type="date" value={state.real_date} onChange={set('real_date')} />
        </div>
        <div className="form-group">
          <label className="form-label">In-World Date</label>
          <input value={state.in_world_date} onChange={set('in_world_date')} placeholder="e.g. 15th of Frost" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Summary</label>
        <textarea value={state.summary} onChange={set('summary')} placeholder="What happened this session… (supports **bold**, - lists)" rows={5} />
      </div>
      <div className="form-group">
        <label className="form-label">Loot & Rewards</label>
        <textarea value={state.loot_notes} onChange={set('loot_notes')} placeholder="Items found, gold, magic items…" rows={2} />
      </div>
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save'}</button>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
