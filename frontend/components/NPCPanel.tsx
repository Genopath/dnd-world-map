import React, { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Location, NPC, Quest } from '../types';
import MarkdownText from './MarkdownText';
import LibraryPicker from './LibraryPicker';

type NPCStatus = 'alive' | 'dead' | 'unknown';

const STATUS_COLOR: Record<NPCStatus, string> = {
  alive:   'var(--success-text)',
  dead:    'var(--danger-text)',
  unknown: 'var(--text-muted)',
};

interface EditState {
  name:        string;
  role:        string;
  status:      NPCStatus;
  notes:       string;
  location_id: number | '';
}

function blank(): EditState {
  return { name: '', role: '', status: 'alive', notes: '', location_id: '' };
}

function toEdit(n: NPC): EditState {
  return { name: n.name, role: n.role, status: n.status, notes: n.notes, location_id: n.location_id ?? '' };
}

interface Props {
  npcs:               NPC[];
  locations:          Location[];
  quests:             Quest[];
  isDMMode:           boolean;
  selectedLocationId: number | null;
  onCreate:           (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>) => Promise<NPC>;
  onUpdate:           (id: number, data: Partial<NPC>) => Promise<void>;
  onDelete:           (id: number) => Promise<void>;
  onUploadPortrait:   (id: number, file: File) => Promise<void>;
  onDeletePortrait:   (id: number) => Promise<void>;
  onLightbox:         (url: string) => void;
  onNavigateToQuest:  (id: number) => void;
  onUnlinkNpc:        (questId: number, npcId: number) => Promise<void>;
  jumpToId:           number | null;
}

export default function NPCPanel({
  npcs, locations, quests, isDMMode, selectedLocationId,
  onCreate, onUpdate, onDelete, onUploadPortrait, onDeletePortrait, onLightbox,
  onNavigateToQuest, onUnlinkNpc, jumpToId,
}: Props) {
  const [filterMode, setFilterMode] = useState<'all' | 'location'>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editState,  setEditState]  = useState<EditState | null>(null);
  const [isAdding,   setIsAdding]   = useState(false);
  const [addState,   setAddState]   = useState<EditState>(blank());
  const [saving,     setSaving]     = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl,  setPendingUrl]  = useState<string | null>(null);

  const jumpProcessed = useRef<number | null>(null);
  useEffect(() => {
    if (jumpToId != null && jumpToId !== jumpProcessed.current) {
      setExpandedId(jumpToId);
      jumpProcessed.current = jumpToId;
    }
  }, [jumpToId]);

  const filtered = filterMode === 'location' && selectedLocationId != null
    ? npcs.filter(n => n.location_id === selectedLocationId)
    : npcs;

  const startEdit = (npc: NPC) => { setEditingId(npc.id); setEditState(toEdit(npc)); };

  const saveEdit = async () => {
    if (!editState || editingId == null) return;
    setSaving(true);
    try {
      await onUpdate(editingId, { ...editState, location_id: editState.location_id === '' ? null : editState.location_id as number });
      setEditingId(null);
    } finally { setSaving(false); }
  };

  const saveAdd = async () => {
    if (!addState.name.trim()) return;
    setSaving(true);
    try {
      const npc = await onCreate({ ...addState, location_id: addState.location_id === '' ? null : addState.location_id as number });
      if (pendingFile) {
        try { await onUploadPortrait(npc.id, pendingFile); } catch (e) { console.error(e); }
      } else if (pendingUrl) {
        try { await onUpdate(npc.id, { portrait_url: pendingUrl }); } catch (e) { console.error(e); }
      }
      setIsAdding(false);
      setAddState(blank());
      setPendingFile(null);
      setPendingUrl(null);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} NPC{filtered.length !== 1 ? 's' : ''}
        </span>
        {selectedLocationId != null && (
          <div style={{ display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            {(['all', 'location'] as const).map(m => (
              <button key={m} style={{ padding: '3px 8px', fontSize: 11, border: 'none', cursor: 'pointer', background: filterMode === m ? 'var(--accent)' : 'transparent', color: filterMode === m ? '#15100a' : 'var(--text-muted)', fontWeight: filterMode === m ? 700 : 400 }} onClick={() => setFilterMode(m)}>
                {m === 'all' ? 'All' : 'Here'}
              </button>
            ))}
          </div>
        )}
        {isDMMode && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setIsAdding(true); setExpandedId(null); }}>
            + Add NPC
          </button>
        )}
      </div>

      {/* Add form */}
      {isAdding && isDMMode && (
        <NPCForm state={addState} locations={locations} onChange={setAddState} onSave={saveAdd}
          onCancel={() => { setIsAdding(false); setPendingFile(null); setPendingUrl(null); }}
          saving={saving} isNew
          pendingPortraitFile={pendingFile} pendingPortraitUrl={pendingUrl}
          onPendingFile={setPendingFile} onPendingUrl={setPendingUrl}
        />
      )}

      {/* Empty state */}
      {filtered.length === 0 && !isAdding && (
        <div className="path-empty">
          No NPCs yet.
          {isDMMode && <><br /><span style={{ fontSize: 12 }}>Click "+ Add NPC" to create one.</span></>}
        </div>
      )}

      {/* NPC cards */}
      {filtered.map(npc => (
        <div key={npc.id} className="npc-card" style={npc.is_visible === false ? { opacity: 0.55 } : undefined} onClick={() => setExpandedId(expandedId === npc.id ? null : npc.id)}>
          <div className="npc-card-row">
            {npc.portrait_url ? (
              <img
                className="npc-portrait"
                src={`${API_BASE}${npc.portrait_url}`}
                alt={npc.name}
                onClick={e => { e.stopPropagation(); onLightbox(`${API_BASE}${npc.portrait_url!}`); }}
              />
            ) : (
              <div className="npc-portrait npc-portrait-ph">{npc.name[0]?.toUpperCase() ?? '?'}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{npc.name}</div>
              {npc.role && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{npc.role}</div>}
              {npc.location_id != null && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {locations.find(l => l.id === npc.location_id)?.name ?? ''}
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[npc.status] ?? 'var(--text-muted)', flexShrink: 0 }}>
              {npc.status.charAt(0).toUpperCase() + npc.status.slice(1)}
            </span>
            {isDMMode && (
              <button
                className={`btn btn-sm btn-ghost btn-icon${npc.is_visible !== false ? '' : ' vis-off'}`}
                title={npc.is_visible !== false ? 'Visible to players — click to hide' : 'Hidden from players — click to reveal'}
                onClick={async e => { e.stopPropagation(); await onUpdate(npc.id, { is_visible: !(npc.is_visible !== false) }); }}
              >
                {npc.is_visible !== false ? '👁' : '🔒'}
              </button>
            )}
            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 4 }}>{expandedId === npc.id ? '▲' : '▼'}</span>
          </div>

          {expandedId === npc.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
              {editingId === npc.id && editState ? (
                <NPCForm
                  state={editState} locations={locations} onChange={setEditState}
                  onSave={saveEdit} onCancel={() => setEditingId(null)} saving={saving}
                  npcId={npc.id} onUploadPortrait={onUploadPortrait}
                  onSetPortrait={async (id, url) => { await onUpdate(id, { portrait_url: url }); }}
                  hasPortrait={!!npc.portrait_url}
                  onDeletePortrait={onDeletePortrait}
                />
              ) : (
                <>
                  {npc.notes ? <div style={{ marginBottom: 8 }}><MarkdownText>{npc.notes}</MarkdownText></div> : null}

                  {/* Linked quests */}
                  {(npc.linked_quest_ids ?? []).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="section-label" style={{ marginBottom: 6 }}>Related Quests</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {(npc.linked_quest_ids ?? []).map(questId => {
                          const quest = quests.find(q => q.id === questId);
                          if (!quest) return null;
                          return (
                            <div key={questId} className="link-chip" onClick={() => onNavigateToQuest(questId)}>
                              <span>📜 {quest.title}</span>
                              {isDMMode && (
                                <button className="link-chip-remove" onClick={async e => { e.stopPropagation(); await onUnlinkNpc(questId, npc.id); }} title="Remove link">✕</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {isDMMode && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => startEdit(npc)}>Edit</button>
                      <button className="btn btn-sm" title="Duplicate NPC" onClick={async e => {
                        e.stopPropagation();
                        await onCreate({ name: `${npc.name} (copy)`, role: npc.role, status: npc.status, notes: npc.notes, location_id: npc.location_id });
                      }}>⧉ Copy</button>
                      <button className="btn btn-sm btn-danger" onClick={async e => {
                        e.stopPropagation();
                        if (confirm(`Delete "${npc.name}"?`)) await onDelete(npc.id);
                      }}>Delete</button>
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

// ── NPC form ──────────────────────────────────────────────────────────────────

interface FormProps {
  state:                EditState;
  locations:            Location[];
  onChange:             (s: EditState) => void;
  onSave:               () => void;
  onCancel:             () => void;
  saving:               boolean;
  isNew?:               boolean;
  npcId?:               number;
  onUploadPortrait?:    (id: number, file: File) => Promise<void>;
  onSetPortrait?:       (id: number, url: string) => Promise<void>;
  // For new NPCs — staged before creation
  pendingPortraitFile?: File | null;
  pendingPortraitUrl?:  string | null;
  onPendingFile?:       (f: File | null) => void;
  onPendingUrl?:        (url: string | null) => void;
  hasPortrait?:         boolean;
  onDeletePortrait?:    (id: number) => Promise<void>;
}

function NPCForm({ state, locations, onChange, onSave, onCancel, saving, isNew, npcId, onUploadPortrait, onSetPortrait, pendingPortraitFile, pendingPortraitUrl, onPendingFile, onPendingUrl, hasPortrait, onDeletePortrait }: FormProps) {
  const [showLibrary, setShowLibrary] = useState(false);
  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...state, [key]: e.target.value });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Name</label>
          <input value={state.name} onChange={set('name')} placeholder="NPC name" autoFocus={isNew} />
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select value={state.status} onChange={set('status')}>
            <option value="alive">Alive</option>
            <option value="dead">Dead</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Role / Title</label>
        <input value={state.role} onChange={set('role')} placeholder="e.g. Innkeeper, Villain, Merchant" />
      </div>
      <div className="form-group">
        <label className="form-label">Location</label>
        <select value={state.location_id} onChange={set('location_id')}>
          <option value="">— None —</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea value={state.notes} onChange={set('notes')} placeholder="Personality, history, secrets… (supports **bold**, *italic*, - lists)" rows={4} />
      </div>
      {isNew && onPendingFile && onPendingUrl && (
        <div className="form-group">
          <label className="form-label">Portrait</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              📷 Upload
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                const f = e.target.files?.[0];
                if (f) { onPendingFile(f); onPendingUrl(null); }
                e.target.value = '';
              }} />
            </label>
            <button className="btn btn-sm" onClick={() => setShowLibrary(true)}>📚 Library</button>
            {(pendingPortraitFile || pendingPortraitUrl) && (
              <>
                <span style={{ fontSize: 11, color: 'var(--success-text)' }}>
                  {pendingPortraitFile ? `📎 ${pendingPortraitFile.name}` : '🖼 Library image selected'}
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => { onPendingFile(null); onPendingUrl(null); }}>✕</button>
              </>
            )}
          </div>
        </div>
      )}
      {!isNew && npcId != null && (onUploadPortrait || onSetPortrait) && (
        <div className="form-group">
          <label className="form-label">Portrait</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {onUploadPortrait && (
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                📷 Upload
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await onUploadPortrait(npcId, f);
                  e.target.value = '';
                }} />
              </label>
            )}
            {onSetPortrait && (
              <button className="btn btn-sm" onClick={() => setShowLibrary(true)}>📚 Library</button>
            )}
            {hasPortrait && onDeletePortrait && npcId != null && (
              <button className="btn btn-sm btn-danger" onClick={async () => {
                await onDeletePortrait(npcId);
              }}>🗑 Remove</button>
            )}
          </div>
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
        </button>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {showLibrary && isNew && onPendingUrl && (
        <LibraryPicker
          onSelect={url => { onPendingUrl(url); if (onPendingFile) onPendingFile(null); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showLibrary && !isNew && onSetPortrait && npcId != null && (
        <LibraryPicker
          onSelect={async url => { await onSetPortrait(npcId, url); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}
