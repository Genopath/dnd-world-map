import { useState, useCallback, useMemo } from 'react';
import type { Faction, Location, LoreEntry, NPC } from '../types';

const CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: 'history',   label: 'History',   icon: '📜' },
  { key: 'religion',  label: 'Religion',  icon: '⛪' },
  { key: 'geography', label: 'Geography', icon: '🏔' },
  { key: 'factions',  label: 'Factions',  icon: '⚔' },
  { key: 'languages', label: 'Languages', icon: '🗣' },
  { key: 'bestiary',  label: 'Bestiary',  icon: '🐉' },
  { key: 'magic',     label: 'Magic',     icon: '🔮' },
  { key: 'other',     label: 'Other',     icon: '📖' },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

interface Props {
  entries: LoreEntry[];
  locations: Location[];
  factions: Faction[];
  npcs: NPC[];
  isDMMode: boolean;
  onCreate: (data: Omit<LoreEntry, 'id' | 'created_at'>) => Promise<LoreEntry>;
  onUpdate: (id: number, data: Partial<Omit<LoreEntry, 'id' | 'created_at'>>) => Promise<LoreEntry>;
  onDelete: (id: number) => Promise<void>;
}

type EditState = {
  title: string;
  category: string;
  content: string;
  tags: string;
  linked_location_id: number | null;
  linked_faction_id: number | null;
  linked_npc_id: number | null;
  is_visible: boolean;
};

function blankEdit(): EditState {
  return { title: '', category: 'other', content: '', tags: '', linked_location_id: null, linked_faction_id: null, linked_npc_id: null, is_visible: true };
}

function entryToEdit(e: LoreEntry): EditState {
  return {
    title: e.title,
    category: e.category,
    content: e.content,
    tags: (JSON.parse(e.tags || '[]') as string[]).join(', '),
    linked_location_id: e.linked_location_id ?? null,
    linked_faction_id: e.linked_faction_id ?? null,
    linked_npc_id: e.linked_npc_id ?? null,
    is_visible: e.is_visible !== false,
  };
}

function editToPayload(s: EditState): Omit<LoreEntry, 'id' | 'created_at'> {
  const tags = s.tags.split(',').map(t => t.trim()).filter(Boolean);
  return {
    title: s.title.trim() || 'Untitled',
    category: s.category,
    content: s.content,
    tags: JSON.stringify(tags),
    linked_location_id: s.linked_location_id,
    linked_faction_id: s.linked_faction_id,
    linked_npc_id: s.linked_npc_id,
    is_visible: s.is_visible,
  };
}

// Simple inline markdown renderer — safe (no dangerouslySetInnerHTML)
function inlineFormat(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('*')  && p.endsWith('*'))  return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

function renderContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let key = 0;

  const flushList = () => {
    if (!listBuf.length) return;
    out.push(<ul key={key++} className="lore-ul">{listBuf.map((li, i) => <li key={i}>{inlineFormat(li)}</li>)}</ul>);
    listBuf = [];
  };

  for (const line of lines) {
    if (line.startsWith('### ')) { flushList(); out.push(<h3 key={key++} className="lore-h3">{line.slice(4)}</h3>); }
    else if (line.startsWith('## ')) { flushList(); out.push(<h2 key={key++} className="lore-h2">{line.slice(3)}</h2>); }
    else if (line.startsWith('# '))  { flushList(); out.push(<h1 key={key++} className="lore-h1">{line.slice(2)}</h1>); }
    else if (line.match(/^[-*] /)) { listBuf.push(line.slice(2)); }
    else if (line.trim() === '')   { flushList(); out.push(<div key={key++} className="lore-gap" />); }
    else { flushList(); out.push(<p key={key++} className="lore-p">{inlineFormat(line)}</p>); }
  }
  flushList();
  return out;
}

export default function LorePanel({ entries, locations, factions, npcs, isDMMode, onCreate, onUpdate, onDelete }: Props) {
  const [catFilter,  setCatFilter]  = useState<string | null>(null);
  const [search,     setSearch]     = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view,       setView]       = useState<'list' | 'detail' | 'edit'>('list');
  const [editState,  setEditState]  = useState<EditState>(blankEdit);
  const [saving,     setSaving]     = useState(false);

  const visibleEntries = useMemo(() => {
    const q = search.toLowerCase();
    return entries
      .filter(e => isDMMode || e.is_visible !== false)
      .filter(e => !catFilter || e.category === catFilter)
      .filter(e => !q || e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
  }, [entries, isDMMode, catFilter, search]);

  const selected = entries.find(e => e.id === selectedId) ?? null;

  const openDetail = useCallback((e: LoreEntry) => { setSelectedId(e.id); setView('detail'); }, []);
  const openNew    = useCallback(() => { setSelectedId(null); setEditState(blankEdit()); setView('edit'); }, []);
  const openEdit   = useCallback((e: LoreEntry) => { setEditState(entryToEdit(e)); setView('edit'); }, []);
  const back       = useCallback(() => { setView(selectedId != null ? 'detail' : 'list'); }, [selectedId]);
  const backToList = useCallback(() => { setView('list'); setSelectedId(null); }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const payload = editToPayload(editState);
      if (selectedId != null) {
        const updated = await onUpdate(selectedId, payload);
        setSelectedId(updated.id);
        setView('detail');
      } else {
        const created = await onCreate(payload);
        setSelectedId(created.id);
        setView('detail');
      }
    } finally { setSaving(false); }
  }, [editState, selectedId, onCreate, onUpdate]);

  const del = useCallback(async () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected.title}"?`)) return;
    await onDelete(selected.id);
    backToList();
  }, [selected, onDelete, backToList]);

  const set = useCallback(<K extends keyof EditState>(k: K, v: EditState[K]) => {
    setEditState(prev => ({ ...prev, [k]: v }));
  }, []);

  // ── Edit form ────────────────────────────────────────────────────────────────
  if (view === 'edit') {
    const cat = CAT_MAP[editState.category] ?? CAT_MAP.other;
    return (
      <div className="lore-panel">
        <div className="lore-topbar">
          <button className="lore-back-btn" onClick={back}>← Back</button>
          <span className="lore-topbar-title">{selectedId != null ? 'Edit Entry' : 'New Entry'}</span>
        </div>

        <div className="lore-form">
          <label className="lore-label">Title</label>
          <input className="lore-input" value={editState.title} onChange={e => set('title', e.target.value)} placeholder="Entry title…" />

          <label className="lore-label">Category</label>
          <div className="lore-cat-grid">
            {CATEGORIES.map(c => (
              <button key={c.key}
                className={`lore-cat-pick${editState.category === c.key ? ' active' : ''}`}
                onClick={() => set('category', c.key)}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>

          <label className="lore-label">Content <span className="lore-hint">Markdown: # Heading, **bold**, *italic*, - list</span></label>
          <textarea className="lore-textarea" value={editState.content}
            onChange={e => set('content', e.target.value)}
            placeholder="Write your lore here…" rows={14} />

          <label className="lore-label">Tags <span className="lore-hint">comma-separated</span></label>
          <input className="lore-input" value={editState.tags} onChange={e => set('tags', e.target.value)} placeholder="ancient, dragon, empire…" />

          <label className="lore-label">Link to Location</label>
          <select className="lore-select" value={editState.linked_location_id ?? ''} onChange={e => set('linked_location_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>

          <label className="lore-label">Link to Faction</label>
          <select className="lore-select" value={editState.linked_faction_id ?? ''} onChange={e => set('linked_faction_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>

          <label className="lore-label">Link to NPC</label>
          <select className="lore-select" value={editState.linked_npc_id ?? ''} onChange={e => set('linked_npc_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>

          {isDMMode && (
            <label className="lore-visible-row">
              <input type="checkbox" checked={editState.is_visible} onChange={e => set('is_visible', e.target.checked)} />
              Visible to players
            </label>
          )}

          <div className="lore-form-actions">
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn" onClick={back}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    const cat = CAT_MAP[selected.category] ?? CAT_MAP.other;
    const tags: string[] = JSON.parse(selected.tags || '[]');
    const linkedLoc = selected.linked_location_id != null ? locations.find(l => l.id === selected.linked_location_id) : null;
    const linkedFac = selected.linked_faction_id  != null ? factions.find(f => f.id === selected.linked_faction_id)  : null;
    const linkedNpc = selected.linked_npc_id      != null ? npcs.find(n => n.id === selected.linked_npc_id)          : null;
    return (
      <div className="lore-panel">
        <div className="lore-topbar">
          <button className="lore-back-btn" onClick={backToList}>← Atlas</button>
          {isDMMode && (
            <div className="lore-topbar-actions">
              {!selected.is_visible && <span className="lore-hidden-badge">Hidden</span>}
              <button className="lore-icon-btn" title="Edit" onClick={() => openEdit(selected)}>✏️</button>
              <button className="lore-icon-btn lore-icon-btn--danger" title="Delete" onClick={del}>🗑</button>
            </div>
          )}
        </div>

        <div className="lore-detail">
          <div className="lore-detail-cat">
            <span className="lore-cat-badge">{cat.icon} {cat.label}</span>
            {linkedLoc && <span className="lore-link-badge">📍 {linkedLoc.name}</span>}
            {linkedFac && <span className="lore-link-badge" style={{ borderColor: linkedFac.color }}>⚜ {linkedFac.name}</span>}
            {linkedNpc && <span className="lore-link-badge">👤 {linkedNpc.name}</span>}
          </div>
          <h2 className="lore-detail-title">{selected.title}</h2>
          {tags.length > 0 && (
            <div className="lore-tags-row">
              {tags.map(t => <span key={t} className="lore-tag">{t}</span>)}
            </div>
          )}
          <div className="lore-content">{renderContent(selected.content)}</div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="lore-panel">
      <div className="lore-list-header">
        <input className="lore-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search atlas…" />
        {isDMMode && <button className="lore-new-btn" onClick={openNew}>+ New</button>}
      </div>

      <div className="lore-cat-pills">
        <button className={`lore-cat-pill${!catFilter ? ' active' : ''}`} onClick={() => setCatFilter(null)}>All</button>
        {CATEGORIES.map(c => {
          const count = entries.filter(e => e.category === c.key && (isDMMode || e.is_visible !== false)).length;
          if (!count) return null;
          return (
            <button key={c.key} className={`lore-cat-pill${catFilter === c.key ? ' active' : ''}`} onClick={() => setCatFilter(catFilter === c.key ? null : c.key)}>
              {c.icon} {c.label}
            </button>
          );
        })}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="lore-empty">
          {entries.length === 0
            ? isDMMode ? 'No entries yet — start building your world atlas.' : 'No lore entries visible yet.'
            : 'No entries match your search.'}
        </div>
      ) : (
        <div className="lore-list">
          {visibleEntries.map(e => {
            const cat = CAT_MAP[e.category] ?? CAT_MAP.other;
            const linkedLoc = e.linked_location_id != null ? locations.find(l => l.id === e.linked_location_id) : null;
            const linkedFac = e.linked_faction_id  != null ? factions.find(f => f.id === e.linked_faction_id)  : null;
            const tags: string[] = JSON.parse(e.tags || '[]');
            return (
              <button key={e.id} className="lore-entry" onClick={() => openDetail(e)}>
                <div className="lore-entry-top">
                  <span className="lore-entry-icon">{cat.icon}</span>
                  <span className="lore-entry-title">{e.title}</span>
                  {isDMMode && !e.is_visible && <span className="lore-hidden-dot" title="Hidden from players" />}
                </div>
                <div className="lore-entry-meta">
                  <span className="lore-entry-cat">{cat.label}</span>
                  {linkedLoc && <span className="lore-entry-link">· 📍 {linkedLoc.name}</span>}
                  {linkedFac && <span className="lore-entry-link">· ⚜ {linkedFac.name}</span>}
                </div>
                {tags.length > 0 && (
                  <div className="lore-entry-tags">
                    {tags.slice(0, 4).map(t => <span key={t} className="lore-tag lore-tag--sm">{t}</span>)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
