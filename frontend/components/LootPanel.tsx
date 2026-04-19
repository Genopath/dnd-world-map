import React, { useState } from 'react';
import type { CampaignSettings, LootItem, PartyMember, SessionEntry } from '../types';

const RARITIES = ['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'] as const;
type Rarity = typeof RARITIES[number];

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare',
  very_rare: 'Very Rare', legendary: 'Legendary', artifact: 'Artifact',
};
const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9d9d9d', uncommon: '#1eff00', rare: '#0070dd',
  very_rare: '#a335ee', legendary: '#ff8000', artifact: '#e6cc80',
};

interface EditState {
  name: string; quantity: string; rarity: Rarity;
  description: string; notes: string;
  recipient_id: string; session_id: string; is_visible: boolean;
}

function blank(): EditState {
  return { name: '', quantity: '1', rarity: 'common', description: '', notes: '', recipient_id: '', session_id: '', is_visible: true };
}
function toEdit(item: LootItem): EditState {
  return {
    name: item.name, quantity: String(item.quantity), rarity: item.rarity as Rarity,
    description: item.description, notes: item.notes,
    recipient_id: item.recipient_id != null ? String(item.recipient_id) : '',
    session_id: item.session_id != null ? String(item.session_id) : '',
    is_visible: item.is_visible !== false,
  };
}
function fromEdit(e: EditState): Omit<LootItem, 'id' | 'created_at'> {
  return {
    name: e.name.trim() || 'Unnamed',
    quantity: Math.max(1, parseInt(e.quantity) || 1),
    rarity: e.rarity,
    description: e.description.trim(),
    notes: e.notes.trim(),
    recipient_id: e.recipient_id ? parseInt(e.recipient_id) : null,
    session_id: e.session_id ? parseInt(e.session_id) : null,
    is_visible: e.is_visible,
  };
}

type Filter = 'all' | Rarity | 'party' | `char-${number}`;

type CurrencyKey = 'gold' | 'silver' | 'copper' | 'electrum';
type PoolKey = 'pool_gold' | 'pool_silver' | 'pool_copper' | 'pool_electrum';
type CurrencyData = Partial<Record<CurrencyKey, number>>;
type PoolData = Partial<Record<PoolKey, number>>;

const CURRENCIES: { key: CurrencyKey; poolKey: PoolKey; label: string; color: string }[] = [
  { key: 'gold',     poolKey: 'pool_gold',     label: 'gp', color: '#c9a84c' },
  { key: 'silver',   poolKey: 'pool_silver',   label: 'sp', color: '#aab0c0' },
  { key: 'copper',   poolKey: 'pool_copper',   label: 'cp', color: '#b87333' },
  { key: 'electrum', poolKey: 'pool_electrum', label: 'ep', color: '#8cb88c' },
];

interface Props {
  loot: LootItem[];
  party: PartyMember[];
  sessions: SessionEntry[];
  campaign: CampaignSettings | null;
  isDMMode: boolean;
  onCreate: (data: Omit<LootItem, 'id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: number, data: Partial<LootItem>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onUpdateMemberGold: (id: number, data: Partial<PartyMember>) => Promise<void>;
  onUpdatePoolGold: (data: Partial<CampaignSettings>) => Promise<void>;
}

export default function LootPanel({ loot, party, sessions, campaign, isDMMode, onCreate, onUpdate, onDelete, onUpdateMemberGold, onUpdatePoolGold }: Props) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ owner: number | 'pool'; currency: CurrencyKey } | null>(null);
  const [cellInput, setCellInput] = useState('');

  const startNew = () => { setEditState(blank()); setEditingId('new'); };
  const startEdit = (item: LootItem) => { setEditState(toEdit(item)); setEditingId(item.id); };
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

  const visible = isDMMode ? loot : loot.filter(i => i.is_visible !== false);

  const filtered = visible.filter(item => {
    if (filter === 'all') return true;
    if (filter === 'party') return item.recipient_id == null;
    if (filter.startsWith('char-')) return item.recipient_id === parseInt(filter.slice(5));
    return item.rarity === filter;
  });

  const recipientName = (id: number | null | undefined) => {
    if (id == null) return 'Party Pool';
    return party.find(m => m.id === id)?.name ?? 'Unknown';
  };

  const sessionLabel = (id: number | null | undefined) => {
    if (id == null) return null;
    const s = sessions.find(s => s.id === id);
    return s ? `Session ${s.session_number}${s.title ? ` — ${s.title}` : ''}` : null;
  };

  const recipientIds = new Set(visible.map(i => i.recipient_id));

  const startEditCell = (owner: number | 'pool', currency: CurrencyKey, current: number) => {
    if (!isDMMode) return;
    setEditingCell({ owner, currency });
    setCellInput(String(current));
  };

  const commitCell = async () => {
    if (!editingCell) return;
    const val = Math.max(0, parseInt(cellInput) || 0);
    const { owner, currency } = editingCell;
    if (owner === 'pool') {
      const poolKey = CURRENCIES.find(c => c.key === currency)!.poolKey;
      await onUpdatePoolGold({ [poolKey]: val } as Partial<CampaignSettings>);
    } else {
      await onUpdateMemberGold(owner, { [currency]: val } as Partial<PartyMember>);
    }
    setEditingCell(null);
    setCellInput('');
  };

  const gpTotal = (campaign?.pool_gold ?? 0) + party.reduce((s, m) => s + (m.gold ?? 0), 0);

  const CurrencyCell = ({ owner, currency, value }: { owner: number | 'pool'; currency: CurrencyKey; value: number }) => {
    const cur = CURRENCIES.find(c => c.key === currency)!;
    const isEditing = editingCell?.owner === owner && editingCell?.currency === currency;
    if (isEditing) return (
      <span className="gold-cell-edit">
        <input className="gold-input" type="number" min={0} value={cellInput}
          onChange={e => setCellInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitCell(); if (e.key === 'Escape') setEditingCell(null); }}
          onBlur={commitCell}
          autoFocus />
      </span>
    );
    return (
      <span className="gold-cell" style={{ '--cur-color': cur.color } as React.CSSProperties}
        onClick={() => startEditCell(owner, currency, value)}
        title={isDMMode ? `Click to edit ${cur.label}` : undefined}
      >
        <span className="gold-cell-val">{value > 0 ? value.toLocaleString() : '—'}</span>
        <span className="gold-cell-label">{cur.label}</span>
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Currency Tracker ─────────────────────────────────────────── */}
      <div className="gold-tracker">
        <div className="gold-tracker-header">
          <span className="gold-tracker-title">🪙 Currency</span>
          <span className="gold-tracker-total">{gpTotal.toLocaleString()} gp pool</span>
        </div>
        <div className="gold-tracker-table">
          {/* Header row */}
          <div className="gold-table-row gold-table-header">
            <span className="gold-table-name" />
            {CURRENCIES.map(c => (
              <span key={c.key} className="gold-table-cur-head" style={{ color: c.color }}>{c.label}</span>
            ))}
          </div>
          {/* Party pool */}
          <div className="gold-table-row gold-table-row--pool">
            <span className="gold-table-name">⚔️ Party Pool</span>
            {CURRENCIES.map(c => (
              <CurrencyCell key={c.key} owner="pool" currency={c.key} value={campaign?.[c.poolKey] ?? 0} />
            ))}
          </div>
          {/* Per-member */}
          {party.map(m => (
            <div key={m.id} className="gold-table-row">
              <span className="gold-table-name">
                <span className="gold-dot" style={{ background: m.path_color }} />
                {m.name}
              </span>
              {CURRENCIES.map(c => (
                <CurrencyCell key={c.key} owner={m.id} currency={c.key} value={m[c.key] ?? 0} />
              ))}
            </div>
          ))}
        </div>
        {isDMMode && <div className="gold-tracker-hint">Click any amount to edit</div>}
      </div>

      {isDMMode && editingId === null && (
        <button className="btn btn-primary btn-sm" onClick={startNew} style={{ alignSelf: 'flex-start' }}>+ Add Loot</button>
      )}

      {/* Edit / Create form */}
      {editState && (
        <div className="loot-form">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input value={editState.name} onChange={e => setEditState({ ...editState, name: e.target.value })} placeholder="Item name" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label className="form-label">Qty</label>
              <input type="number" min={1} value={editState.quantity} onChange={e => setEditState({ ...editState, quantity: e.target.value })} />
            </div>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Rarity</label>
              <select value={editState.rarity} onChange={e => setEditState({ ...editState, rarity: e.target.value as Rarity })}>
                {RARITIES.map(r => <option key={r} value={r}>{RARITY_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Recipient</label>
            <select value={editState.recipient_id} onChange={e => setEditState({ ...editState, recipient_id: e.target.value })}>
              <option value="">Party Pool</option>
              {party.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Session</label>
            <select value={editState.session_id} onChange={e => setEditState({ ...editState, session_id: e.target.value })}>
              <option value="">— None —</option>
              {sessions.map(s => <option key={s.id} value={s.id}>Session {s.session_number}{s.title ? ` — ${s.title}` : ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea value={editState.description} onChange={e => setEditState({ ...editState, description: e.target.value })} rows={2} placeholder="Flavour text or stats" />
          </div>
          <div className="form-group">
            <label className="form-label">DM Notes</label>
            <textarea value={editState.notes} onChange={e => setEditState({ ...editState, notes: e.target.value })} rows={1} placeholder="Private notes" />
          </div>
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="loot-visible" checked={editState.is_visible} onChange={e => setEditState({ ...editState, is_visible: e.target.checked })} />
            <label htmlFor="loot-visible" className="form-label" style={{ margin: 0 }}>Visible to players</label>
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
          <button className={`loot-filter-btn${filter === 'party' ? ' active' : ''}`} onClick={() => setFilter('party')}>Party Pool</button>
          {party.filter(m => recipientIds.has(m.id)).map(m => (
            <button key={m.id}
              className={`loot-filter-btn${filter === `char-${m.id}` ? ' active' : ''}`}
              style={{ '--filter-dot': m.path_color } as React.CSSProperties}
              onClick={() => setFilter(`char-${m.id}` as Filter)}
            >
              <span className="loot-filter-dot" />
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* Items */}
      {visible.length === 0 && editingId === null && (
        <div className="no-sel"><div>No loot tracked yet.</div>{isDMMode && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Click "+ Add Loot" to log items.</div>}</div>
      )}

      {filtered.map(item => (
        <div key={item.id} className={`loot-card${item.is_visible === false ? ' loot-card--hidden' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div className="loot-rarity-bar" style={{ '--rarity-color': RARITY_COLOR[item.rarity as Rarity] ?? '#9d9d9d' } as React.CSSProperties} title={RARITY_LABEL[item.rarity as Rarity] ?? item.rarity} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="loot-name">{item.quantity > 1 && <span className="loot-qty">×{item.quantity} </span>}{item.name}</span>
                <span className="loot-rarity-tag" style={{ color: RARITY_COLOR[item.rarity as Rarity] ?? '#9d9d9d' }}>{RARITY_LABEL[item.rarity as Rarity] ?? item.rarity}</span>
                {item.is_visible === false && <span className="loot-hidden-badge">DM Only</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>🎒 {recipientName(item.recipient_id)}</span>
                {sessionLabel(item.session_id) && <span>📖 {sessionLabel(item.session_id)}</span>}
              </div>
              {item.description && <div className="loot-desc">{item.description}</div>}
              {isDMMode && item.notes && <div className="loot-dm-notes">{item.notes}</div>}
            </div>
            {isDMMode && editingId === null && (
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button className="btn btn-sm btn-ghost btn-icon" onClick={() => startEdit(item)} title="Edit">✏</button>
                {confirmDelete === item.id
                  ? <>
                      <button className="btn btn-sm btn-danger btn-icon" onClick={() => { onDelete(item.id); setConfirmDelete(null); }} title="Confirm delete">✓</button>
                      <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirmDelete(null)} title="Cancel">✕</button>
                    </>
                  : <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setConfirmDelete(item.id)} title="Delete">🗑</button>
                }
              </div>
            )}
          </div>
        </div>
      ))}

      {filtered.length === 0 && visible.length > 0 && (
        <div className="no-sel" style={{ fontSize: 12 }}>No items match this filter.</div>
      )}
    </div>
  );
}
