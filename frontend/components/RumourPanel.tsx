import React, { useState } from 'react';
import type { Location, NPC, Rumour } from '../types';

type Status = 'unconfirmed' | 'confirmed' | 'false';

const STATUS_LABEL: Record<Status, string> = {
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed',
  false: 'Debunked',
};
const STATUS_COLOR: Record<Status, string> = {
  unconfirmed: '#c9a84c',
  confirmed: '#4caf6e',
  false: '#d46060',
};
const STATUS_ICON: Record<Status, string> = {
  unconfirmed: '?',
  confirmed: '✓',
  false: '✗',
};

const STATUS_CYCLE: Status[] = ['unconfirmed', 'confirmed', 'false'];

interface EditState {
  title: string; content: string; status: Status;
  source: string; location_id: string; npc_id: string; is_visible: boolean;
}
function blank(): EditState {
  return { title: '', content: '', status: 'unconfirmed', source: '', location_id: '', npc_id: '', is_visible: true };
}
function toEdit(r: Rumour): EditState {
  return {
    title: r.title, content: r.content, status: r.status as Status,
    source: r.source,
    location_id: r.location_id != null ? String(r.location_id) : '',
    npc_id: r.npc_id != null ? String(r.npc_id) : '',
    is_visible: r.is_visible !== false,
  };
}
function fromEdit(e: EditState): Omit<Rumour, 'id' | 'created_at'> {
  return {
    title: e.title.trim() || 'Untitled',
    content: e.content.trim(),
    status: e.status,
    source: e.source.trim(),
    location_id: e.location_id ? parseInt(e.location_id) : null,
    npc_id: e.npc_id ? parseInt(e.npc_id) : null,
    is_visible: e.is_visible,
  };
}

interface Props {
  rumours: Rumour[];
  locations: Location[];
  npcs: NPC[];
  isDMMode: boolean;
  onCreate: (data: Omit<Rumour, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: number, data: Partial<Rumour>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

type Filter = 'all' | Status;

export default function RumourPanel({ rumours, locations, npcs, isDMMode, onCreate, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const startNew = () => { setEditState(blank()); setEditingId('new'); };
  const startEdit = (r: Rumour) => { setEditState(toEdit(r)); setEditingId(r.id); };
  const cancel = () => { setEditingId(null); setEditState(null); };

  const save = async () => {
    if (!editState) return;
    setSaving(true);
    try {
      if (editingId === 'new') await onCreate(fromEdit(editState));
      else if (typeof editingId === 'number') await onUpdate(editingId, fromEdit(editState));
      cancel();
    } finally { setSaving(false); }
  };

  const cycleStatus = async (r: Rumour) => {
    if (!isDMMode) return;
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(r.status as Status) + 1) % STATUS_CYCLE.length];
    await onUpdate(r.id, { status: next });
  };

  const visible = isDMMode ? rumours : rumours.filter(r => r.is_visible !== false);
  const filtered = filter === 'all' ? visible : visible.filter(r => r.status === filter);

  const counts: Record<Status, number> = { unconfirmed: 0, confirmed: 0, false: 0 };
  for (const r of visible) counts[r.status as Status] = (counts[r.status as Status] ?? 0) + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isDMMode && editingId === null && (
        <button className="btn btn-primary btn-sm" onClick={startNew} style={{ alignSelf: 'flex-start' }}>+ Add Rumour</button>
      )}

      {/* Edit / Create form */}
      {editState && (
        <div className="loot-form">
          <div className="form-group">
            <label className="form-label">Title</label>
            <input value={editState.title} onChange={e => setEditState({ ...editState, title: e.target.value })} placeholder="Short rumour title" />
          </div>
          <div className="form-group">
            <label className="form-label">Content</label>
            <textarea value={editState.content} onChange={e => setEditState({ ...editState, content: e.target.value })} rows={3} placeholder="The rumour as the party heard it…" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Status</label>
              <select value={editState.status} onChange={e => setEditState({ ...editState, status: e.target.value as Status })}>
                {STATUS_CYCLE.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Source</label>
              <input value={editState.source} onChange={e => setEditState({ ...editState, source: e.target.value })} placeholder="Who told them?" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Location</label>
              <select value={editState.location_id} onChange={e => setEditState({ ...editState, location_id: e.target.value })}>
                <option value="">— None —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">NPC</label>
              <select value={editState.npc_id} onChange={e => setEditState({ ...editState, npc_id: e.target.value })}>
                <option value="">— None —</option>
                {npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="rumour-visible" checked={editState.is_visible} onChange={e => setEditState({ ...editState, is_visible: e.target.checked })} />
            <label htmlFor="rumour-visible" className="form-label" style={{ margin: 0 }}>Visible to players</label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : editingId === 'new' ? 'Add' : 'Save'}</button>
            <button className="btn btn-sm btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter strip */}
      {visible.length > 0 && editingId === null && (
        <div className="loot-filter-strip">
          <button className={`loot-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>All ({visible.length})</button>
          {STATUS_CYCLE.map(s => counts[s] > 0 && (
            <button key={s}
              className={`loot-filter-btn rumour-filter-btn${filter === s ? ' active' : ''}`}
              style={{ '--rumour-status-color': STATUS_COLOR[s] } as React.CSSProperties}
              onClick={() => setFilter(s)}
            >
              {STATUS_ICON[s]} {STATUS_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>
      )}

      {/* Cards */}
      {visible.length === 0 && editingId === null && (
        <div className="no-sel"><div>No rumours yet.</div>{isDMMode && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Add rumours the party has heard.</div>}</div>
      )}

      {filtered.map(r => {
        const status = r.status as Status;
        const loc = r.location_id ? locations.find(l => l.id === r.location_id) : null;
        const npc = r.npc_id ? npcs.find(n => n.id === r.npc_id) : null;
        return (
          <div key={r.id} className={`rumour-card rumour-card--${status}${r.is_visible === false ? ' rumour-card--hidden' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              {/* Status badge — DM can click to cycle */}
              <button
                className="rumour-status-badge"
                style={{ '--status-color': STATUS_COLOR[status] } as React.CSSProperties}
                onClick={() => cycleStatus(r)}
                title={isDMMode ? `Status: ${STATUS_LABEL[status]} — click to cycle` : STATUS_LABEL[status]}
                disabled={!isDMMode}
              >
                {STATUS_ICON[status]}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="rumour-title">{r.title}</span>
                  {r.is_visible === false && <span className="loot-hidden-badge">DM Only</span>}
                </div>
                {r.content && <div className="rumour-content">{r.content}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {r.source && <span>💬 {r.source}</span>}
                  {loc && <span>📍 {loc.name}</span>}
                  {npc && <span>👤 {npc.name}</span>}
                </div>
              </div>

              {isDMMode && editingId === null && (
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="btn btn-sm btn-ghost btn-icon" onClick={() => startEdit(r)} title="Edit">✏</button>
                  {confirmDelete === r.id
                    ? <>
                        <button className="btn btn-sm btn-danger btn-icon" onClick={() => { onDelete(r.id); setConfirmDelete(null); }} title="Confirm">✓</button>
                        <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirmDelete(null)} title="Cancel">✕</button>
                      </>
                    : <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirmDelete(r.id)} title="Delete">🗑</button>
                  }
                </div>
              )}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && visible.length > 0 && (
        <div className="no-sel" style={{ fontSize: 12 }}>No rumours match this filter.</div>
      )}
    </div>
  );
}
