import React, { useState } from 'react';
import type { Location, NPC, Rumour } from '../types';

type Status = 'unconfirmed' | 'confirmed' | 'false';

const STATUS_LABEL: Record<Status, string> = {
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed',
  false: 'Debunked',
};
const STATUS_ICON: Record<Status, string> = {
  unconfirmed: '?',
  confirmed: '✓',
  false: '✕',
};
const PIN_COLOR: Record<Status, { bg: string; hi: string }> = {
  unconfirmed: { bg: '#b8860b', hi: '#f0c040' },
  confirmed:   { bg: '#1a6b35', hi: '#4caf6e' },
  false:       { bg: '#8b1a1a', hi: '#d46060' },
};
const SEAL_COLOR: Record<Status, string> = {
  unconfirmed: '#b8860b',
  confirmed:   '#1a6b35',
  false:       '#8b1a1a',
};
const STATUS_CYCLE: Status[] = ['unconfirmed', 'confirmed', 'false'];

// Parchment tones — deterministic by id
const NOTE_BG = ['#fdf5dc', '#f8ead0', '#faf0e0', '#eef5e8', '#ece8f5'];
const noteBg = (id: number) => NOTE_BG[id % NOTE_BG.length];

// Slight rotation, never zero, alternates direction
const noteRot = (id: number) => {
  const v = ((id * 17 + 5) % 10) - 5;
  return v === 0 ? 1.5 : v;
};

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
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const startNew = () => { setEditState(blank()); setEditingId('new'); setExpandedId(null); };
  const startEdit = (r: Rumour) => { setEditState(toEdit(r)); setEditingId(r.id); setExpandedId(null); };
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

  const cycleStatus = async (e: React.MouseEvent, r: Rumour) => {
    e.stopPropagation();
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

      {/* Filter strip */}
      <div className="rumour-filter-bar">
        <button className={`rb-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="rb-count">{visible.length}</span>
        </button>
        {STATUS_CYCLE.map(s => (
          <button key={s}
            className={`rb-filter-btn rb-filter-btn--${s}${filter === s ? ' active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {STATUS_ICON[s]} {STATUS_LABEL[s]}
            {counts[s] > 0 && <span className="rb-count">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {/* Edit / Create form — styled as a parchment sheet */}
      {editState && (
        <div className="rumour-form-sheet">
          <div className="rumour-form-pin" />
          <div className="rumour-form-title">
            {editingId === 'new' ? '— New Rumour —' : '— Edit Rumour —'}
          </div>
          <div className="form-group">
            <label className="form-label rb-label">Headline</label>
            <input className="rb-input" value={editState.title} onChange={e => setEditState({ ...editState, title: e.target.value })} placeholder="The rumour in brief…" />
          </div>
          <div className="form-group">
            <label className="form-label rb-label">Full account</label>
            <textarea className="rb-input" value={editState.content} onChange={e => setEditState({ ...editState, content: e.target.value })} rows={3} placeholder="As the party heard it…" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label rb-label">Status</label>
              <select className="rb-input" value={editState.status} onChange={e => setEditState({ ...editState, status: e.target.value as Status })}>
                {STATUS_CYCLE.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label rb-label">Source</label>
              <input className="rb-input" value={editState.source} onChange={e => setEditState({ ...editState, source: e.target.value })} placeholder="Who told them?" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label rb-label">Location</label>
              <select className="rb-input" value={editState.location_id} onChange={e => setEditState({ ...editState, location_id: e.target.value })}>
                <option value="">— None —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label rb-label">NPC</label>
              <select className="rb-input" value={editState.npc_id} onChange={e => setEditState({ ...editState, npc_id: e.target.value })}>
                <option value="">— None —</option>
                {npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
            </div>
          </div>
          {isDMMode && (
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="rumour-visible" checked={editState.is_visible} onChange={e => setEditState({ ...editState, is_visible: e.target.checked })} />
              <label htmlFor="rumour-visible" className="form-label rb-label" style={{ margin: 0 }}>Visible to players</label>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="btn btn-sm rb-save-btn" onClick={save} disabled={saving}>{saving ? 'Pinning…' : editingId === 'new' ? 'Pin to Board' : 'Save Changes'}</button>
            <button className="btn btn-sm btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* The board */}
      <div className="rumour-board">
        {/* "New note" card — only in DM mode and when not editing */}
        {isDMMode && editingId === null && (
          <div className="rumour-note rumour-note--new" onClick={startNew} title="Pin a new rumour">
            <div className="rumour-note-pin rumour-note-pin--new" />
            <div className="rumour-note-add-icon">+</div>
            <div className="rumour-note-add-label">New rumour</div>
          </div>
        )}

        {filtered.map(r => {
          const status = r.status as Status;
          const pin = PIN_COLOR[status];
          const loc = r.location_id ? locations.find(l => l.id === r.location_id) : null;
          const npc = r.npc_id ? npcs.find(n => n.id === r.npc_id) : null;
          const isExpanded = expandedId === r.id;
          const rot = noteRot(r.id);

          return (
            <div key={r.id}
              className={`rumour-note${r.is_visible === false ? ' rumour-note--hidden' : ''}${isExpanded ? ' rumour-note--expanded' : ''}`}
              style={{
                '--note-bg': noteBg(r.id),
                '--note-rot': `${rot}deg`,
                '--pin-bg': pin.bg,
                '--pin-hi': pin.hi,
                '--seal-color': SEAL_COLOR[status],
              } as React.CSSProperties}
              onClick={() => setExpandedId(isExpanded ? null : r.id)}
            >
              {/* Thumbtack */}
              <div className="rumour-note-pin" />

              {/* Status wax seal — DM can click to cycle */}
              <button
                className="rumour-wax-seal"
                title={isDMMode ? `${STATUS_LABEL[status]} — click to change` : STATUS_LABEL[status]}
                onClick={e => cycleStatus(e, r)}
                disabled={!isDMMode}
              >
                {STATUS_ICON[status]}
              </button>

              {/* DM-only badge */}
              {r.is_visible === false && (
                <div className="rumour-note-dm-badge">DM</div>
              )}

              {/* Note title */}
              <div className="rumour-note-title">{r.title}</div>

              {/* Content shown when expanded */}
              {isExpanded && (
                <div className="rumour-note-body">
                  {r.content && <p className="rumour-note-content">{r.content}</p>}
                  <div className="rumour-note-meta">
                    {r.source && <div>💬 <em>{r.source}</em></div>}
                    {loc && <div>📍 {loc.name}</div>}
                    {npc && <div>👤 {npc.name}</div>}
                  </div>
                  {isDMMode && (
                    <div className="rumour-note-actions" onClick={e => e.stopPropagation()}>
                      <button className="rb-action-btn" onClick={() => startEdit(r)}>✏ Edit</button>
                      <button className="rb-action-btn rb-action-btn--danger" onClick={() => onDelete(r.id)}>🗑 Remove</button>
                    </div>
                  )}
                </div>
              )}

              {/* Collapsed: show source/link hints */}
              {!isExpanded && (r.source || loc || npc) && (
                <div className="rumour-note-hint">
                  {r.source && <span>{r.source}</span>}
                  {loc && <span>📍 {loc.name}</span>}
                  {npc && <span>👤 {npc.name}</span>}
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && editingId === null && (
          <div className="rumour-board-empty">
            {visible.length === 0
              ? 'No rumours pinned yet.'
              : 'None match this filter.'
            }
          </div>
        )}
      </div>
    </div>
  );
}
