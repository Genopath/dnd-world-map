import React, { useState } from 'react';
import { API_BASE } from '../lib/api';
import type { Location, NPC, Quest, Rumour } from '../types';

// ── Rumour status ─────────────────────────────────────────────────────────────
type Status = 'unconfirmed' | 'confirmed' | 'false';

const STATUS_LABEL: Record<Status, string> = {
  unconfirmed: 'Unconfirmed', confirmed: 'Confirmed', false: 'Debunked',
};
const STATUS_ICON: Record<Status, string> = {
  unconfirmed: '?', confirmed: '✓', false: '✕',
};
const STATUS_CYCLE: Status[] = ['unconfirmed', 'confirmed', 'false'];

// ── Quest status display ──────────────────────────────────────────────────────
const QUEST_STATUS_ICON: Record<string, string> = {
  active: '⚡', completed: '✓', failed: '✕',
};
const QUEST_STATUS_LABEL: Record<string, string> = {
  active: 'Active', completed: 'Completed', failed: 'Failed',
};

// ── Pin / seal colours ────────────────────────────────────────────────────────
const PIN_COLOR: Record<Status, { bg: string; hi: string }> = {
  unconfirmed: { bg: '#b8860b', hi: '#f0c040' },
  confirmed:   { bg: '#1a6b35', hi: '#4caf6e' },
  false:       { bg: '#8b1a1a', hi: '#d46060' },
};
const SEAL_COLOR: Record<Status, string> = {
  unconfirmed: '#b8860b', confirmed: '#1a6b35', false: '#8b1a1a',
};

const QUEST_PIN: Record<string, { bg: string; hi: string }> = {
  active:    { bg: '#5b3c00', hi: '#c9a84c' },
  completed: { bg: '#1a6b35', hi: '#4caf6e' },
  failed:    { bg: '#5a1a1a', hi: '#a05050' },
};
const QUEST_SEAL: Record<string, string> = {
  active: '#c9a84c', completed: '#1a6b35', failed: '#7a2a2a',
};

// ── Note appearance ───────────────────────────────────────────────────────────
const NOTE_BG    = ['#fdf5dc', '#f8ead0', '#faf0e0', '#eef5e8', '#ece8f5'];
const QUEST_BG   = ['#f5e8c8', '#ede0b8', '#f0e6c4', '#e8ddb0', '#f2e9c2'];
const noteBg  = (id: number) => NOTE_BG[id % NOTE_BG.length];
const questBg = (id: number) => QUEST_BG[id % QUEST_BG.length];
const noteRot = (id: number) => {
  const v = ((id * 17 + 5) % 10) - 5;
  return v === 0 ? 1.5 : v;
};

// ── Edit state ────────────────────────────────────────────────────────────────
interface EditState {
  title: string; content: string; status: Status;
  source: string; location_id: string; npc_id: string; is_visible: boolean;
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

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  rumours: Rumour[];
  quests: Quest[];
  locations: Location[];
  npcs: NPC[];
  isDMMode: boolean;
  onCreate: (data: Omit<Rumour, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: number, data: Partial<Rumour>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOpenQuestLog?: () => void;
  onWaxStamp?: () => void;
  onNoteFlip?: () => void;
}

type FilterKind = 'all' | 'main' | 'side' | 'rumour' | 'archived';

export default function RumourPanel({
  rumours, quests, locations, npcs, isDMMode,
  onUpdate, onDelete, onOpenQuestLog, onWaxStamp, onNoteFlip,
}: Props) {
  const [editingId,   setEditingId]   = useState<number | 'new' | null>(null);
  const [editState,   setEditState]   = useState<EditState | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [filter,      setFilter]      = useState<FilterKind>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const startEdit = (r: Rumour) => { setEditState(toEdit(r)); setEditingId(r.id); setExpandedKey(null); };
  const cancel    = () => { setEditingId(null); setEditState(null); };

  const toggleExpand = (key: string) => {
    setExpandedKey(prev => { const next = prev === key ? null : key; if (next) onNoteFlip?.(); return next; });
  };

  const save = async () => {
    if (!editState || typeof editingId !== 'number') return;
    setSaving(true);
    try {
      await onUpdate(editingId, fromEdit(editState));
      cancel();
    } finally { setSaving(false); }
  };

  const cycleStatus = async (e: React.MouseEvent, r: Rumour) => {
    e.stopPropagation();
    if (!isDMMode) return;
    onWaxStamp?.();
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(r.status as Status) + 1) % STATUS_CYCLE.length];
    await onUpdate(r.id, { status: next });
  };

  const toggleArchive = async (e: React.MouseEvent, r: Rumour) => {
    e.stopPropagation();
    await onUpdate(r.id, { archived: !r.archived });
  };

  // ── Visible pools ─────────────────────────────────────────────────────────
  const visibleRumours = isDMMode ? rumours : rumours.filter(r => r.is_visible !== false);
  const activeRumours  = visibleRumours.filter(r => !r.archived);
  const archivedRumours = visibleRumours.filter(r => r.archived);

  const visibleQuests = isDMMode ? quests : quests.filter(q => q.is_visible !== false);
  const mainQuests = visibleQuests.filter(q => q.tier === 'main');
  const sideQuests = visibleQuests.filter(q => q.tier === 'side');

  // ── Filter ────────────────────────────────────────────────────────────────
  const showRumoursOn  = filter === 'all' || filter === 'rumour';
  const showMainOn     = filter === 'all' || filter === 'main';
  const showSideOn     = filter === 'all' || filter === 'side';
  const showArchivedOn = filter === 'archived';

  const displayedRumours  = showArchivedOn ? archivedRumours : showRumoursOn  ? activeRumours : [];
  const displayedMain     = showArchivedOn ? [] : showMainOn  ? mainQuests : [];
  const displayedSide     = showArchivedOn ? [] : showSideOn  ? sideQuests : [];

  const totalActive = activeRumours.length + mainQuests.length + sideQuests.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Filter strip ─────────────────────────────────────────────── */}
      <div className="rumour-filter-bar">
        <button className={`rb-filter-btn${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="rb-count">{totalActive}</span>
        </button>
        <button className={`rb-filter-btn rb-filter-btn--mainquest${filter === 'main' ? ' active' : ''}`} onClick={() => setFilter('main')}>
          ⚔️ Main Quests {mainQuests.length > 0 && <span className="rb-count">{mainQuests.length}</span>}
        </button>
        <button className={`rb-filter-btn rb-filter-btn--sidequests${filter === 'side' ? ' active' : ''}`} onClick={() => setFilter('side')}>
          📜 Side Quests {sideQuests.length > 0 && <span className="rb-count">{sideQuests.length}</span>}
        </button>
        <button className={`rb-filter-btn rb-filter-btn--rumours${filter === 'rumour' ? ' active' : ''}`} onClick={() => setFilter('rumour')}>
          📌 Rumours {activeRumours.length > 0 && <span className="rb-count">{activeRumours.length}</span>}
        </button>
        {archivedRumours.length > 0 && (
          <button className={`rb-filter-btn${filter === 'archived' ? ' active' : ''}`} onClick={() => setFilter('archived')}>
            📦 Archived <span className="rb-count">{archivedRumours.length}</span>
          </button>
        )}
      </div>

      {/* ── Quest log notice ──────────────────────────────────────────── */}
      {(filter === 'all' || filter === 'main' || filter === 'side') && (mainQuests.length > 0 || sideQuests.length > 0) && (
        <div className="rumour-quest-notice">
          Quest notes are pulled from the Quest Log.{' '}
          {onOpenQuestLog && (
            <button className="rb-link-btn" onClick={onOpenQuestLog}>Open Quest Log →</button>
          )}
        </div>
      )}

      {/* ── Edit / Create form ───────────────────────────────────────── */}
      {editState && (
        <div className="rumour-form-sheet">
          <div className="rumour-form-pin" />
          <div className="rumour-form-title">
            {'— Edit Rumour —'}
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
            <button className="btn btn-sm rb-save-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            <button className="btn btn-sm btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── The board ─────────────────────────────────────────────────── */}
      <div className="rumour-board">


        {/* ── Quest notes (read-only, from quest log) ─────────────────── */}
        {[...displayedMain, ...displayedSide].map(q => {
          const key = `q-${q.id}`;
          const isExpanded = expandedKey === key;
          const rot = noteRot(q.id + 500);
          const pin = QUEST_PIN[q.status] ?? QUEST_PIN.active;
          const loc = q.location_id ? locations.find(l => l.id === q.location_id) : null;
          const giver = q.quest_giver_id ? npcs.find(n => n.id === q.quest_giver_id) : null;
          const tierLabel = q.tier === 'main' ? '⚔️ Main Quest' : '📜 Side Quest';

          return (
            <div key={key}
              className={`rumour-note rumour-note--quest rumour-note--quest-${q.tier}${isExpanded ? ' rumour-note--expanded' : ''}`}
              style={{
                '--note-bg': questBg(q.id),
                '--note-rot': `${rot}deg`,
                '--pin-bg': pin.bg,
                '--pin-hi': pin.hi,
                '--seal-color': QUEST_SEAL[q.status] ?? '#c9a84c',
              } as React.CSSProperties}
              onClick={() => toggleExpand(key)}
            >
              <div className="rumour-note-pin" />

              <div className="rumour-quest-tier-badge">{tierLabel}</div>

              {/* Status seal (read-only) */}
              <div className="rumour-wax-seal rumour-wax-seal--readonly" title={QUEST_STATUS_LABEL[q.status]}>
                {QUEST_STATUS_ICON[q.status]}
              </div>

              {q.is_visible === false && <div className="rumour-note-dm-badge">DM</div>}

              <div className="rumour-note-title">{q.title}</div>

              {isExpanded && (
                <div className="rumour-note-body">
                  {q.image_url && (
                    <img src={`${API_BASE}${q.image_url}`} alt={q.title} className="rumour-note-quest-img" />
                  )}
                  {q.description && <p className="rumour-note-content">{q.description}</p>}
                  <div className="rumour-note-meta">
                    {giver && <div>👤 {giver.name}</div>}
                    {loc && <div>📍 {loc.name}</div>}
                    {q.reward_gold ? <div>💰 {q.reward_gold}gp</div> : null}
                  </div>
                  <div className="rumour-note-actions" onClick={e => e.stopPropagation()}>
                    {onOpenQuestLog && (
                      <button className="rb-action-btn" onClick={onOpenQuestLog}>📖 Open Quest Log</button>
                    )}
                  </div>
                </div>
              )}

              {!isExpanded && (loc || giver) && (
                <div className="rumour-note-hint">
                  {giver && <span>👤 {giver.name}</span>}
                  {loc && <span>📍 {loc.name}</span>}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Rumour notes ─────────────────────────────────────────────── */}
        {displayedRumours.map(r => {
          const key = `r-${r.id}`;
          const status = r.status as Status;
          const pin = PIN_COLOR[status];
          const loc = r.location_id ? locations.find(l => l.id === r.location_id) : null;
          const npc = r.npc_id ? npcs.find(n => n.id === r.npc_id) : null;
          const isExpanded = expandedKey === key;
          const rot = noteRot(r.id);

          return (
            <div key={key}
              className={`rumour-note${r.is_visible === false ? ' rumour-note--hidden' : ''}${isExpanded ? ' rumour-note--expanded' : ''}${r.archived ? ' rumour-note--archived' : ''}`}
              style={{
                '--note-bg': noteBg(r.id),
                '--note-rot': `${rot}deg`,
                '--pin-bg': pin.bg,
                '--pin-hi': pin.hi,
                '--seal-color': SEAL_COLOR[status],
              } as React.CSSProperties}
              onClick={() => toggleExpand(key)}
            >
              <div className="rumour-note-pin" />

              <button
                className="rumour-wax-seal"
                title={isDMMode ? `${STATUS_LABEL[status]} — click to change` : STATUS_LABEL[status]}
                onClick={e => cycleStatus(e, r)}
                disabled={!isDMMode}
              >
                {STATUS_ICON[status]}
              </button>

              {r.is_visible === false && <div className="rumour-note-dm-badge">DM</div>}

              <div className="rumour-note-title">{r.title}</div>

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
                      <button className="rb-action-btn rb-action-btn--archive" onClick={e => toggleArchive(e, r)}>
                        {r.archived ? '📤 Restore' : '📦 Archive'}
                      </button>
                      <button className="rb-action-btn rb-action-btn--danger" onClick={() => onDelete(r.id)}>🗑 Remove</button>
                    </div>
                  )}
                </div>
              )}

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

        {/* Empty state */}
        {displayedRumours.length === 0 && displayedMain.length === 0 && displayedSide.length === 0 && editingId === null && (
          <div className="rumour-board-empty">
            {filter === 'archived' ? 'No archived rumours.'
              : totalActive === 0 ? 'Nothing on the board yet.'
              : 'None match this filter.'}
          </div>
        )}
      </div>
    </div>
  );
}
