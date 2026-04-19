import React, { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { PartyMember } from '../types';
import LibraryPicker from './LibraryPicker';

const COMMON_CONDITIONS = ['Poisoned', 'Frightened', 'Blinded', 'Deafened', 'Prone', 'Stunned', 'Paralyzed', 'Unconscious', 'Exhausted', 'Restrained', 'Charmed', 'Invisible'];

function hpColor(current: number, max: number): string {
  if (max === 0) return '#555';
  const pct = current / max;
  if (pct >= 0.6) return '#4caf6e';
  if (pct >= 0.3) return '#d4a017';
  return '#c0392b';
}

function hpPct(current: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(100, Math.max(0, (current / max) * 100));
}

interface EditState {
  name: string; player_name: string; class_name: string; race: string;
  level: string; hp_current: string; hp_max: string; ac: string;
  conditions: string[]; notes: string; path_color: string;
}

function toEdit(m: PartyMember): EditState {
  return {
    name: m.name, player_name: m.player_name, class_name: m.class_name,
    race: m.race, level: String(m.level), hp_current: String(m.hp_current),
    hp_max: String(m.hp_max), ac: String(m.ac), conditions: [...m.conditions],
    notes: m.notes, path_color: m.path_color || '#c9a84c',
  };
}

function blankEdit(): EditState {
  return { name: '', player_name: '', class_name: '', race: '', level: '1', hp_current: '0', hp_max: '0', ac: '10', conditions: [], notes: '', path_color: '#c9a84c' };
}

function fromEdit(e: EditState): Omit<PartyMember, 'id' | 'created_at'> {
  return {
    name: e.name.trim() || 'Unnamed',
    player_name: e.player_name.trim(),
    class_name: e.class_name.trim(),
    race: e.race.trim(),
    level: Math.max(1, parseInt(e.level) || 1),
    hp_current: parseInt(e.hp_current) || 0,
    hp_max: parseInt(e.hp_max) || 0,
    ac: parseInt(e.ac) || 10,
    conditions: e.conditions,
    notes: e.notes.trim(),
    path_color: e.path_color || '#c9a84c',
  };
}

interface Props {
  party: PartyMember[];
  isDMMode: boolean;
  onCreate: (data: Omit<PartyMember, 'id' | 'created_at'>) => Promise<PartyMember>;
  onUpdate: (id: number, data: Partial<PartyMember>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onLightbox: (url: string) => void;
  onScheduleBackup?: () => void;
  jumpToId?: number | null;
  onPingMarker?: (kind: 'party' | 'char', memberId?: number) => void;
  onOpenCampMap?: () => void;
}

export default function PartyPanel({ party, isDMMode, onCreate, onUpdate, onDelete, onLightbox, onScheduleBackup, jumpToId, onPingMarker, onOpenCampMap }: Props) {
  const [editingId,    setEditingId]    = useState<number | 'new' | null>(null);
  const [editState,    setEditState]    = useState<EditState | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [showLibrary,  setShowLibrary]  = useState(false);
  const [pendingFile,  setPendingFile]  = useState<File | null>(null);
  const [pendingUrl,   setPendingUrl]   = useState<string | null>(null);
  // Per-card HP input: memberId → raw input string
  const [hpInputs,  setHpInputs]   = useState<Record<number, string>>({});

  // Jump-to: scroll member into view and briefly expand them
  const jumpProcessed = useRef<number | null>(null);
  const memberRefs = useRef<Record<number, HTMLDivElement | null>>({});
  useEffect(() => {
    if (jumpToId != null && jumpToId !== jumpProcessed.current) {
      jumpProcessed.current = jumpToId;
      setEditingId(null); // close any open edit form
      setTimeout(() => {
        memberRefs.current[jumpToId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        memberRefs.current[jumpToId]?.classList.add('member-highlight');
        setTimeout(() => memberRefs.current[jumpToId]?.classList.remove('member-highlight'), 1500);
      }, 80);
    }
  }, [jumpToId]);

  const startNew  = () => { setEditState(blankEdit()); setEditingId('new'); setPendingFile(null); setPendingUrl(null); };
  const startEdit = (m: PartyMember) => { setEditState(toEdit(m)); setEditingId(m.id); };
  const cancel    = () => { setEditingId(null); setEditState(null); setPendingFile(null); setPendingUrl(null); };

  const save = async () => {
    if (!editState) return;
    setSaving(true);
    try {
      if (editingId === 'new') {
        const member = await onCreate(fromEdit(editState));
        if (pendingFile) {
          try { await api.party.uploadPortrait(member.id, pendingFile); await onUpdate(member.id, {}); onScheduleBackup?.(); } catch (e) { console.error(e); }
        } else if (pendingUrl) {
          try { await onUpdate(member.id, { portrait_url: pendingUrl }); } catch (e) { console.error(e); }
        }
      } else if (typeof editingId === 'number') {
        await onUpdate(editingId, fromEdit(editState));
      }
      cancel();
    } finally { setSaving(false); }
  };

  const toggleCondition = (cond: string) => {
    if (!editState) return;
    const has = editState.conditions.includes(cond);
    setEditState({ ...editState, conditions: has ? editState.conditions.filter(c => c !== cond) : [...editState.conditions, cond] });
  };

  const handleDelete = async (m: PartyMember) => {
    if (!confirm(`Remove ${m.name} from the party?`)) return;
    await onDelete(m.id);
  };

  // Quick ±1 HP — does NOT clamp to hp_max when hp_max is 0 (unset)
  const adjustHP = async (m: PartyMember, delta: number) => {
    const max = m.hp_max > 0 ? m.hp_max : Infinity;
    const newHP = Math.max(0, Math.min(max, m.hp_current + delta));
    await onUpdate(m.id, { hp_current: newHP });
  };

  // Apply a damage (negative) or heal (positive) from the text input
  const applyHPInput = async (m: PartyMember) => {
    const raw = (hpInputs[m.id] ?? '').trim();
    if (!raw) return;
    const num = parseInt(raw, 10);
    if (isNaN(num)) return;
    const max = m.hp_max > 0 ? m.hp_max : Infinity;
    const newHP = Math.max(0, Math.min(max, m.hp_current + num));
    await onUpdate(m.id, { hp_current: newHP });
    setHpInputs(prev => ({ ...prev, [m.id]: '' }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {isDMMode && editingId === null && (
          <button className="btn btn-primary btn-sm" onClick={startNew}>+ Add Member</button>
        )}
        {onPingMarker && (
          <button className="btn btn-sm btn-ghost" title="Locate party on map" onClick={() => onPingMarker('party')} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            📍 Locate Party
          </button>
        )}
        {onOpenCampMap && (
          <button className="btn btn-sm btn-ghost" title="Open camp battlemap" onClick={onOpenCampMap} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            ⛺ Camp Map
          </button>
        )}
      </div>

      {/* Edit / Create form */}
      {editState && (
        <div className="party-edit-form">
          <div className="form-row">
            <div className="form-group"><label className="form-label">Name</label><input value={editState.name} onChange={e => setEditState({ ...editState, name: e.target.value })} placeholder="Character name" /></div>
            <div className="form-group"><label className="form-label">Player</label><input value={editState.player_name} onChange={e => setEditState({ ...editState, player_name: e.target.value })} placeholder="Player name" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Class</label><input value={editState.class_name} onChange={e => setEditState({ ...editState, class_name: e.target.value })} placeholder="e.g. Wizard" /></div>
            <div className="form-group"><label className="form-label">Race</label><input value={editState.race} onChange={e => setEditState({ ...editState, race: e.target.value })} placeholder="e.g. Elf" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Level</label><input type="number" min={1} max={20} value={editState.level} onChange={e => setEditState({ ...editState, level: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">HP</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" min={0} value={editState.hp_current} onChange={e => setEditState({ ...editState, hp_current: e.target.value })} placeholder="Cur" style={{ flex: 1 }} />
                <span style={{ alignSelf: 'center', color: 'var(--text-dim)' }}>/</span>
                <input type="number" min={0} value={editState.hp_max} onChange={e => setEditState({ ...editState, hp_max: e.target.value })} placeholder="Max" style={{ flex: 1 }} />
              </div>
            </div>
            <div className="form-group"><label className="form-label">AC</label><input type="number" min={1} max={30} value={editState.ac} onChange={e => setEditState({ ...editState, ac: e.target.value })} /></div>
          </div>
          <div className="form-group">
            <label className="form-label">Conditions</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
              {COMMON_CONDITIONS.map(c => (
                <button key={c} type="button"
                  className={`condition-pill ${editState.conditions.includes(c) ? 'active' : ''}`}
                  onClick={() => toggleCondition(c)}>{c}</button>
              ))}
            </div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea value={editState.notes} onChange={e => setEditState({ ...editState, notes: e.target.value })} rows={2} placeholder="Optional notes" /></div>
          <div className="form-group">
            <label className="form-label">Map Path Colour</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="color" value={editState.path_color} onChange={e => setEditState({ ...editState, path_color: e.target.value })} style={{ height: 34, width: 48, padding: 2, cursor: 'pointer' }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Shown on the map as a dashed line</span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Portrait</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                📷 Upload
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (editingId === 'new') {
                    setPendingFile(f); setPendingUrl(null);
                  } else if (typeof editingId === 'number') {
                    try { await api.party.uploadPortrait(editingId, f); await onUpdate(editingId, {}); onScheduleBackup?.(); }
                    catch (err) { console.error('Portrait upload failed:', err); }
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
              {typeof editingId === 'number' && party.find(m => m.id === editingId)?.portrait_url && (
                <button className="btn btn-sm" onClick={async () => {
                  try { await api.party.deletePortrait(editingId); await onUpdate(editingId, {}); }
                  catch (err) { console.error('Portrait delete failed:', err); }
                }}>🗑 Remove</button>
              )}
            </div>
          </div>
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
          onSelect={async url => { await onUpdate(editingId, { portrait_url: url }); setShowLibrary(false); }}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Member cards */}
      {party.length === 0 && editingId === null && (
        <div className="no-sel"><div>No party members yet.</div>{isDMMode && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Click "+ Add Member" to get started.</div>}</div>
      )}
      {party.map(m => {
        const pct = hpPct(m.hp_current, m.hp_max);
        const color = hpColor(m.hp_current, m.hp_max);
        return (
          <div key={m.id} className="party-card" ref={el => { memberRefs.current[m.id] = el; }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                {m.portrait_url ? (
                  <img
                    className="npc-portrait"
                    src={`${API_BASE}${m.portrait_url}`}
                    alt={m.name}
                    style={{ cursor: 'zoom-in', flexShrink: 0 }}
                    onClick={() => onLightbox(`${API_BASE}${m.portrait_url!}`)}
                  />
                ) : (
                  <div className="npc-portrait npc-portrait-ph" style={{ flexShrink: 0 }}>{m.name[0]?.toUpperCase() ?? '?'}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.path_color || '#c9a84c', flexShrink: 0 }} title="Path color" />
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{m.name}</div>
                  </div>
                  {m.player_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Player: {m.player_name}</div>}
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {[m.race, m.class_name].filter(Boolean).join(' ')}
                    {m.level > 0 && <span style={{ marginLeft: 6, background: 'var(--surface3)', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>Lv {m.level}</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <div className="ac-badge" title="Armor Class">🛡 {m.ac}</div>
                {onPingMarker && m.marker_x != null && (
                  <button className="btn btn-sm btn-ghost btn-icon" title="Locate on map" onClick={() => onPingMarker('char', m.id)}>📍</button>
                )}
                {isDMMode && editingId === null && (
                  <>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => startEdit(m)} title="Edit">✏</button>
                    <button className="btn btn-sm btn-ghost btn-icon" onClick={() => handleDelete(m)} title="Remove">✕</button>
                  </>
                )}
              </div>
            </div>

            {/* HP bar */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>HP</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {isDMMode && <button className="hp-adj-btn" onClick={() => adjustHP(m, -1)} title="–1 HP">−</button>}
                  <span style={{ fontSize: 12, fontWeight: 700, color }}>{m.hp_current}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {m.hp_max > 0 ? m.hp_max : '?'}</span></span>
                  {isDMMode && <button className="hp-adj-btn" onClick={() => adjustHP(m, 1)} title="+1 HP">+</button>}
                </div>
              </div>
              <div className="hp-bar">
                <div className="hp-fill" style={{ width: `${pct}%`, background: color }} />
              </div>
              {/* Quick damage / heal row */}
              {isDMMode && (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <input
                    type="number"
                    placeholder="±HP (e.g. -8 dmg, +5 heal)"
                    value={hpInputs[m.id] ?? ''}
                    onChange={e => setHpInputs(prev => ({ ...prev, [m.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') applyHPInput(m); }}
                    style={{ flex: 1, fontSize: 12, padding: '3px 6px' }}
                  />
                  <button className="btn btn-sm" onClick={() => applyHPInput(m)} style={{ whiteSpace: 'nowrap' }}>Apply</button>
                </div>
              )}
            </div>

            {/* Conditions */}
            {m.conditions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {m.conditions.map(c => (
                  <span key={c} className="condition-pill active" style={{ cursor: isDMMode ? 'pointer' : 'default' }}
                    onClick={isDMMode ? async () => { await onUpdate(m.id, { conditions: m.conditions.filter(x => x !== c) }); } : undefined}>
                    {c}{isDMMode && ' ✕'}
                  </span>
                ))}
              </div>
            )}
            {isDMMode && m.notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 6 }}>{m.notes}</div>}
          </div>
        );
      })}
    </div>
  );
}
