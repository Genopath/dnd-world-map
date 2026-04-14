import React, { useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction, Location, NPC, Quest, QuestObjective, QuestTier, SessionEntry } from '../types';
import MarkdownText from './MarkdownText';

type QuestStatus = 'active' | 'completed' | 'failed';
type Filter = 'all' | QuestStatus | QuestTier;

const STATUS_COLOR: Record<QuestStatus, string> = {
  active:    '#c9a84c',
  completed: 'var(--success-text)',
  failed:    'var(--danger-text)',
};
const STATUS_BG: Record<QuestStatus, string> = {
  active:    'rgba(201,168,76,0.12)',
  completed: 'rgba(58,122,42,0.15)',
  failed:    'rgba(122,28,28,0.15)',
};
const TIER_LABEL: Record<QuestTier, string> = { main: '★ Main', side: 'Side', rumour: '? Rumour' };
const TIER_COLOR: Record<QuestTier, string> = {
  main:   '#e8a030',
  side:   'var(--text-muted)',
  rumour: '#7a8aaa',
};

interface EditState {
  title:                string;
  status:               QuestStatus;
  tier:                 QuestTier;
  description:          string;
  location_id:          number | '';
  notes:                string;
  quest_giver_id:       number | '';
  reward_gold:          string;
  reward_notes:         string;
  deadline:             string;
  tags:                 string;          // comma-separated in the input
  parent_quest_id:      number | '';
  faction_id:           number | '';
  started_session_id:   number | '';
  completed_session_id: number | '';
  is_visible:           boolean;
  objectives:           QuestObjective[];
}

function blank(): EditState {
  return {
    title: '', status: 'active', tier: 'side', description: '', location_id: '',
    notes: '', quest_giver_id: '', reward_gold: '0', reward_notes: '',
    deadline: '', tags: '', parent_quest_id: '', faction_id: '',
    started_session_id: '', completed_session_id: '', is_visible: true, objectives: [],
  };
}

function toEdit(q: Quest): EditState {
  return {
    title:                q.title,
    status:               q.status,
    tier:                 q.tier ?? 'side',
    description:          q.description,
    location_id:          q.location_id ?? '',
    notes:                q.notes,
    quest_giver_id:       q.quest_giver_id ?? '',
    reward_gold:          String(q.reward_gold ?? 0),
    reward_notes:         q.reward_notes ?? '',
    deadline:             q.deadline ?? '',
    tags:                 (q.tags ?? []).join(', '),
    parent_quest_id:      q.parent_quest_id ?? '',
    faction_id:           q.faction_id ?? '',
    started_session_id:   q.started_session_id ?? '',
    completed_session_id: q.completed_session_id ?? '',
    is_visible:           q.is_visible ?? true,
    objectives:           q.objectives ? [...q.objectives] : [],
  };
}

function fromEdit(e: EditState): Partial<Quest> {
  const tags = e.tags.split(',').map(t => t.trim()).filter(Boolean);
  return {
    title:                e.title.trim() || 'Untitled',
    status:               e.status,
    tier:                 e.tier,
    description:          e.description,
    location_id:          e.location_id === '' ? null : Number(e.location_id),
    notes:                e.notes,
    quest_giver_id:       e.quest_giver_id === '' ? null : Number(e.quest_giver_id),
    reward_gold:          parseInt(e.reward_gold) || 0,
    reward_notes:         e.reward_notes,
    deadline:             e.deadline,
    tags,
    parent_quest_id:      e.parent_quest_id === '' ? null : Number(e.parent_quest_id),
    faction_id:           e.faction_id === '' ? null : Number(e.faction_id),
    started_session_id:   e.started_session_id === '' ? null : Number(e.started_session_id),
    completed_session_id: e.completed_session_id === '' ? null : Number(e.completed_session_id),
    is_visible:           e.is_visible,
    objectives:           e.objectives,
  };
}

interface Props {
  quests:           Quest[];
  locations:        Location[];
  npcs:             NPC[];
  factions:         Faction[];
  sessions:         SessionEntry[];
  isDMMode:         boolean;
  onCreate:         (data: Omit<Quest, 'id' | 'created_at'>) => Promise<void>;
  onUpdate:         (id: number, data: Partial<Quest>) => Promise<void>;
  onDelete:         (id: number) => Promise<void>;
  onLightbox:       (url: string) => void;
  onLinkNpc:        (questId: number, npcId: number) => Promise<void>;
  onUnlinkNpc:      (questId: number, npcId: number) => Promise<void>;
  onNavigateToNpc:  (id: number) => void;
  jumpToId:         number | null;
}

export default function QuestPanel({
  quests, locations, npcs, factions, sessions, isDMMode,
  onCreate, onUpdate, onDelete, onLightbox, onLinkNpc, onUnlinkNpc, onNavigateToNpc, jumpToId,
}: Props) {
  const [filter,     setFilter]     = useState<Filter>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editState,  setEditState]  = useState<EditState | null>(null);
  const [isAdding,   setIsAdding]   = useState(false);
  const [addState,   setAddState]   = useState<EditState>(blank());
  const [saving,     setSaving]     = useState(false);
  const [boardView,  setBoardView]  = useState(false);

  const jumpProcessed = useRef<number | null>(null);
  useEffect(() => {
    if (jumpToId != null && jumpToId !== jumpProcessed.current) {
      setExpandedId(jumpToId);
      jumpProcessed.current = jumpToId;
    }
  }, [jumpToId]);

  const visibleQuests = isDMMode ? quests : quests.filter(q => q.is_visible !== false);

  const counts = {
    all:     visibleQuests.length,
    active:  visibleQuests.filter(q => q.status === 'active').length,
    completed: visibleQuests.filter(q => q.status === 'completed').length,
    failed:  visibleQuests.filter(q => q.status === 'failed').length,
    main:    visibleQuests.filter(q => q.tier === 'main').length,
    side:    visibleQuests.filter(q => q.tier === 'side').length,
    rumour:  visibleQuests.filter(q => q.tier === 'rumour').length,
  };

  const filtered = filter === 'all'
    ? visibleQuests
    : ['active', 'completed', 'failed'].includes(filter)
      ? visibleQuests.filter(q => q.status === filter)
      : visibleQuests.filter(q => q.tier === filter);

  const startEdit = (q: Quest) => { setEditingId(q.id); setEditState(toEdit(q)); };

  const saveEdit = async () => {
    if (!editState || editingId == null) return;
    setSaving(true);
    try {
      await onUpdate(editingId, fromEdit(editState) as Omit<Quest, 'id' | 'created_at'>);
      setEditingId(null);
    } finally { setSaving(false); }
  };

  const saveAdd = async () => {
    if (!addState.title.trim()) return;
    setSaving(true);
    try {
      await onCreate(fromEdit(addState) as Omit<Quest, 'id' | 'created_at'>);
      setIsAdding(false);
      setAddState(blank());
    } finally { setSaving(false); }
  };

  const toggleObjective = async (q: Quest, objId: number) => {
    const objectives = (q.objectives ?? []).map(o =>
      o.id === objId ? { ...o, done: !o.done } : o
    );
    await onUpdate(q.id, { objectives });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Status filter row */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'active', 'completed', 'failed'] as Filter[]).map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            {(counts as Record<string, number>)[f] > 0 ? ` (${(counts as Record<string, number>)[f]})` : ''}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className={`btn btn-sm ${boardView ? 'btn-active' : ''}`} onClick={() => setBoardView(v => !v)} title="Toggle corkboard view">📋</button>
          {isDMMode && (
            <button className="btn btn-sm" onClick={() => setIsAdding(true)}>+ Add</button>
          )}
        </div>
      </div>

      {/* Tier filter row */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(['main', 'side', 'rumour'] as QuestTier[]).map(t => (
          <button key={t} className={`btn btn-sm ${filter === t ? 'btn-active' : ''}`}
            style={{ color: filter === t ? TIER_COLOR[t] : undefined }}
            onClick={() => setFilter(f => f === t ? 'all' : t)}>
            {TIER_LABEL[t]}{(counts as Record<string, number>)[t] > 0 ? ` (${(counts as Record<string, number>)[t]})` : ''}
          </button>
        ))}
      </div>

      {isAdding && isDMMode && (
        <QuestForm
          state={addState} locations={locations} npcs={npcs} factions={factions}
          sessions={sessions} quests={quests} onChange={setAddState}
          onSave={saveAdd} onCancel={() => setIsAdding(false)} saving={saving} isNew
        />
      )}

      {filtered.length === 0 && !isAdding && (
        <div className="path-empty">
          No {filter !== 'all' ? filter : ''} quests.
          {isDMMode && filter === 'all' && <><br /><span style={{ fontSize: 12 }}>Click "+ Add" to create one.</span></>}
        </div>
      )}

      {/* ── Board view ── */}
      {boardView ? (
        <div className="quest-board">
          {filtered.map(q => (
            <QuestBoardCard
              key={q.id} q={q} locations={locations} npcs={npcs}
              isDMMode={isDMMode}
              onToggleObjective={toggleObjective}
              onClick={() => { setBoardView(false); setExpandedId(q.id); }}
            />
          ))}
        </div>
      ) : (
        /* ── List view ── */
        filtered.map(q => (
          <div key={q.id} className="quest-card" onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}>
            {/* Card header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0, marginTop: 2 }}>
                <span className="quest-status-badge" style={{ background: STATUS_BG[q.status], color: STATUS_COLOR[q.status] }}>
                  {q.status.toUpperCase()}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, color: TIER_COLOR[q.tier ?? 'side'], letterSpacing: '0.06em' }}>
                  {TIER_LABEL[q.tier ?? 'side']}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{q.title}</div>
                {q.location_id != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{locations.find(l => l.id === q.location_id)?.name ?? ''}</div>
                )}
                {/* Tags */}
                {(q.tags ?? []).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                    {(q.tags ?? []).map(tag => (
                      <span key={tag} className="quest-tag">{tag}</span>
                    ))}
                  </div>
                )}
                {/* Objective progress bar */}
                {(q.objectives ?? []).length > 0 && expandedId !== q.id && (
                  <ObjectiveProgress objectives={q.objectives ?? []} />
                )}
                {q.description && expandedId !== q.id && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {q.description.slice(0, 80)}{q.description.length > 80 ? '…' : ''}
                  </div>
                )}
              </div>
              {isDMMode && (
                <button
                  className={`btn btn-sm btn-ghost btn-icon${q.is_visible !== false ? '' : ' vis-off'}`}
                  title={q.is_visible !== false ? 'Visible to players — click to hide' : 'Hidden from players — click to reveal'}
                  onClick={async e => { e.stopPropagation(); await onUpdate(q.id, { is_visible: !(q.is_visible !== false) }); }}
                >
                  {q.is_visible !== false ? '👁' : '🔒'}
                </button>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>{expandedId === q.id ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {expandedId === q.id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                {editingId === q.id && editState ? (
                  <QuestForm
                    state={editState} locations={locations} npcs={npcs} factions={factions}
                    sessions={sessions} quests={quests.filter(oq => oq.id !== q.id)}
                    onChange={setEditState} onSave={saveEdit} onCancel={() => setEditingId(null)} saving={saving}
                  />
                ) : (
                  <QuestDetail
                    q={q} locations={locations} npcs={npcs} factions={factions} sessions={sessions} quests={quests}
                    isDMMode={isDMMode}
                    onUpdate={onUpdate} onDelete={onDelete} onLightbox={onLightbox}
                    onLinkNpc={onLinkNpc} onUnlinkNpc={onUnlinkNpc} onNavigateToNpc={onNavigateToNpc}
                    onStartEdit={() => startEdit(q)}
                    onToggleObjective={toggleObjective}
                  />
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Objective progress bar ────────────────────────────────────────────────────

function ObjectiveProgress({ objectives }: { objectives: QuestObjective[] }) {
  if (objectives.length === 0) return null;
  const done = objectives.filter(o => o.done).length;
  const pct  = Math.round((done / objectives.length) * 100);
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>
        <span>Objectives</span>
        <span>{done}/{objectives.length}</span>
      </div>
      <div style={{ height: 3, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--success-text)' : 'var(--accent)', borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

// ── Quest detail (expanded read-only view) ────────────────────────────────────

interface DetailProps {
  q:                  Quest;
  locations:          Location[];
  npcs:               NPC[];
  factions:           Faction[];
  sessions:           SessionEntry[];
  quests:             Quest[];
  isDMMode:           boolean;
  onUpdate:           (id: number, data: Partial<Quest>) => Promise<void>;
  onDelete:           (id: number) => Promise<void>;
  onLightbox:         (url: string) => void;
  onLinkNpc:          (questId: number, npcId: number) => Promise<void>;
  onUnlinkNpc:        (questId: number, npcId: number) => Promise<void>;
  onNavigateToNpc:    (id: number) => void;
  onStartEdit:        () => void;
  onToggleObjective:  (q: Quest, id: number) => Promise<void>;
}

function QuestDetail({ q, locations, npcs, factions, sessions, quests, isDMMode, onUpdate, onDelete, onLightbox, onLinkNpc, onUnlinkNpc, onNavigateToNpc, onStartEdit, onToggleObjective }: DetailProps) {
  const giver        = q.quest_giver_id ? npcs.find(n => n.id === q.quest_giver_id) : null;
  const faction      = q.faction_id     ? factions.find(f => f.id === q.faction_id) : null;
  const parentQuest  = q.parent_quest_id ? quests.find(oq => oq.id === q.parent_quest_id) : null;
  const startSession = q.started_session_id   ? sessions.find(s => s.id === q.started_session_id) : null;
  const endSession   = q.completed_session_id ? sessions.find(s => s.id === q.completed_session_id) : null;

  return (
    <>
      {q.image_url && (
        <img
          src={`${API_BASE}${q.image_url}`}
          alt={q.title}
          className="detail-hero-img"
          onClick={() => onLightbox(`${API_BASE}${q.image_url!}`)}
        />
      )}

      {/* Meta row: giver / deadline / faction */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, fontSize: 12 }}>
        {giver && (
          <span style={{ color: 'var(--text-muted)' }}>
            Given by: <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => onNavigateToNpc(giver.id)}>👤 {giver.name}</span>
          </span>
        )}
        {faction && (
          <span style={{ color: 'var(--text-muted)' }}>
            Faction: <span style={{ color: faction.color || 'var(--text)' }}>⚜️ {faction.name}</span>
          </span>
        )}
        {q.deadline && (
          <span style={{ color: 'var(--text-muted)' }}>⏳ Deadline: <span style={{ color: '#e06060' }}>{q.deadline}</span></span>
        )}
      </div>

      {/* Parent quest chain */}
      {parentQuest && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
          🔗 Part of: <span style={{ color: 'var(--accent)' }}>{parentQuest.title}</span>
        </div>
      )}

      {/* Child quests */}
      {(() => {
        const children = quests.filter(oq => oq.parent_quest_id === q.id);
        if (children.length === 0) return null;
        return (
          <div style={{ marginBottom: 8 }}>
            <div className="section-label" style={{ marginBottom: 4 }}>Follow-up Quests</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {children.map(c => (
                <span key={c.id} className="link-chip">→ {c.title}</span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Objectives */}
      {(q.objectives ?? []).length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Objectives</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {(q.objectives ?? []).map(obj => (
              <label key={obj.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={obj.done}
                  onChange={() => onToggleObjective(q, obj.id)}
                  style={{ marginTop: 2, accentColor: 'var(--accent)', flexShrink: 0 }}
                />
                <span style={{ textDecoration: obj.done ? 'line-through' : 'none', color: obj.done ? 'var(--text-dim)' : 'var(--text)' }}>
                  {obj.text}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Reward */}
      {(q.reward_gold! > 0 || q.reward_notes) && (
        <div style={{ marginBottom: 8, padding: '6px 10px', background: 'rgba(201,168,76,0.07)', borderRadius: 5, border: '1px solid rgba(201,168,76,0.2)' }}>
          <div className="section-label" style={{ marginBottom: 3 }}>Reward</div>
          {q.reward_gold! > 0 && <div style={{ fontSize: 12 }}>💰 {q.reward_gold} gp</div>}
          {q.reward_notes && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{q.reward_notes}</div>}
        </div>
      )}

      {q.description && (
        <div style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 4 }}>Description</div>
          <MarkdownText>{q.description}</MarkdownText>
        </div>
      )}

      {isDMMode && q.notes && (
        <div style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 4 }}>DM Notes</div>
          <MarkdownText>{q.notes}</MarkdownText>
        </div>
      )}

      {/* Session tie-in */}
      {(startSession || endSession) && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
          {startSession && <div>📖 Started: Session {startSession.session_number} — {startSession.title}</div>}
          {endSession   && <div>📖 {q.status === 'failed' ? 'Failed' : 'Completed'}: Session {endSession.session_number} — {endSession.title}</div>}
        </div>
      )}

      {/* Linked NPCs */}
      {((q.linked_npc_ids ?? []).length > 0 || isDMMode) && (
        <div style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Involved NPCs</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {(q.linked_npc_ids ?? []).map(npcId => {
              const npc = npcs.find(n => n.id === npcId);
              if (!npc) return null;
              return (
                <div key={npcId} className="link-chip" onClick={() => onNavigateToNpc(npcId)}>
                  <span>👤 {npc.name}</span>
                  {isDMMode && (
                    <button className="link-chip-remove" onClick={async e => { e.stopPropagation(); await onUnlinkNpc(q.id, npcId); }} title="Remove link">✕</button>
                  )}
                </div>
              );
            })}
            {isDMMode && (
              <NPCLinker questId={q.id} allNpcs={npcs} linkedIds={q.linked_npc_ids ?? []} onLink={onLinkNpc} />
            )}
          </div>
        </div>
      )}

      {/* DM action buttons */}
      {isDMMode && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn btn-sm" onClick={onStartEdit}>Edit</button>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            📷 Image
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { await api.quests.uploadImage(q.id, f); await onUpdate(q.id, {}); }
              catch (err) { console.error('Image upload failed:', err); }
              e.target.value = '';
            }} />
          </label>
          {q.image_url && (
            <button className="btn btn-sm" onClick={async e => { e.stopPropagation(); await api.quests.deleteImage(q.id); await onUpdate(q.id, {}); }}>🗑 Image</button>
          )}
          {q.status !== 'completed' && <button className="btn btn-sm" style={{ color: STATUS_COLOR.completed }} onClick={async e => { e.stopPropagation(); await onUpdate(q.id, { status: 'completed' }); }}>✓ Complete</button>}
          {q.status !== 'failed'    && <button className="btn btn-sm" style={{ color: STATUS_COLOR.failed }}    onClick={async e => { e.stopPropagation(); await onUpdate(q.id, { status: 'failed' }); }}>✗ Fail</button>}
          {q.status !== 'active'    && <button className="btn btn-sm" style={{ color: STATUS_COLOR.active }}    onClick={async e => { e.stopPropagation(); await onUpdate(q.id, { status: 'active' }); }}>↺ Reactivate</button>}
          <button className="btn btn-sm btn-danger" onClick={async e => { e.stopPropagation(); if (confirm(`Delete "${q.title}"?`)) await onDelete(q.id); }}>Delete</button>
        </div>
      )}
    </>
  );
}

// ── Corkboard card ────────────────────────────────────────────────────────────

function QuestBoardCard({ q, locations, npcs, isDMMode, onToggleObjective, onClick }: {
  q: Quest; locations: Location[]; npcs: NPC[]; isDMMode: boolean;
  onToggleObjective: (q: Quest, id: number) => Promise<void>;
  onClick: () => void;
}) {
  return (
    <div className={`quest-board-card quest-board-card--${q.tier ?? 'side'}`} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <span className="quest-status-badge" style={{ background: STATUS_BG[q.status], color: STATUS_COLOR[q.status] }}>
          {q.status.toUpperCase()}
        </span>
        <span style={{ fontSize: 9, color: TIER_COLOR[q.tier ?? 'side'], fontWeight: 700 }}>{TIER_LABEL[q.tier ?? 'side']}</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, lineHeight: 1.3 }}>{q.title}</div>
      {q.quest_giver_id && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
          👤 {npcs.find(n => n.id === q.quest_giver_id)?.name ?? '?'}
        </div>
      )}
      {(q.objectives ?? []).length > 0 && (
        <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
          {(q.objectives ?? []).slice(0, 4).map(obj => (
            <label key={obj.id} style={{ display: 'flex', gap: 5, fontSize: 11, cursor: 'pointer', marginBottom: 2 }}>
              <input type="checkbox" checked={obj.done} onChange={() => onToggleObjective(q, obj.id)} style={{ accentColor: 'var(--accent)' }} />
              <span style={{ textDecoration: obj.done ? 'line-through' : 'none', color: obj.done ? 'var(--text-dim)' : 'var(--text)' }}>{obj.text}</span>
            </label>
          ))}
          {(q.objectives ?? []).length > 4 && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>+{(q.objectives ?? []).length - 4} more…</div>
          )}
        </div>
      )}
      {(q.tags ?? []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
          {(q.tags ?? []).map(tag => <span key={tag} className="quest-tag">{tag}</span>)}
        </div>
      )}
      {q.deadline && (
        <div style={{ fontSize: 10, color: '#e06060', marginTop: 6 }}>⏳ {q.deadline}</div>
      )}
    </div>
  );
}

// ── NPC Linker ────────────────────────────────────────────────────────────────

function NPCLinker({ questId, allNpcs, linkedIds, onLink }: { questId: number; allNpcs: NPC[]; linkedIds: number[]; onLink: (questId: number, npcId: number) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const unlinked = allNpcs.filter(n => !linkedIds.includes(n.id));
  if (unlinked.length === 0 && !open) return null;
  return open ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Link an NPC</div>
      {unlinked.map(n => (
        <button key={n.id} className="btn btn-sm" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={async () => { await onLink(questId, n.id); setOpen(false); }}>
          👤 {n.name}
        </button>
      ))}
      <button className="btn btn-sm" onClick={() => setOpen(false)} style={{ marginTop: 2 }}>Cancel</button>
    </div>
  ) : (
    <button className="link-chip link-chip-add" onClick={() => setOpen(true)}>+ Link NPC</button>
  );
}

// ── Quest form ────────────────────────────────────────────────────────────────

interface FormProps {
  state:     EditState;
  locations: Location[];
  npcs:      NPC[];
  factions:  Faction[];
  sessions:  SessionEntry[];
  quests:    Quest[];           // for parent-quest picker (excludes self)
  onChange:  (s: EditState) => void;
  onSave:    () => void;
  onCancel:  () => void;
  saving:    boolean;
  isNew?:    boolean;
}

function QuestForm({ state, locations, npcs, factions, sessions, quests, onChange, onSave, onCancel, saving, isNew }: FormProps) {
  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...state, [key]: e.target.value });

  const setBool = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...state, [key]: e.target.checked });

  // Objectives management
  const [newObjText, setNewObjText] = useState('');
  const addObjective = () => {
    const text = newObjText.trim();
    if (!text) return;
    const id = Date.now();
    onChange({ ...state, objectives: [...state.objectives, { id, text, done: false }] });
    setNewObjText('');
  };
  const removeObjective = (id: number) =>
    onChange({ ...state, objectives: state.objectives.filter(o => o.id !== id) });
  const editObjective = (id: number, text: string) =>
    onChange({ ...state, objectives: state.objectives.map(o => o.id === id ? { ...o, text } : o) });

  return (
    <div className="edit-form" style={{ padding: 12, background: 'var(--surface2)', borderRadius: 6, border: '1px solid var(--border)' }}>
      <div className="form-group">
        <label className="form-label">Title</label>
        <input value={state.title} onChange={set('title')} placeholder="Quest title" autoFocus={isNew} />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Status</label>
          <select value={state.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Tier</label>
          <select value={state.tier} onChange={set('tier')}>
            <option value="main">★ Main Quest</option>
            <option value="side">Side Quest</option>
            <option value="rumour">? Rumour</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Location</label>
          <select value={state.location_id} onChange={set('location_id')}>
            <option value="">— None —</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Quest Giver</label>
          <select value={state.quest_giver_id} onChange={set('quest_giver_id')}>
            <option value="">— None —</option>
            {npcs.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea value={state.description} onChange={set('description')} placeholder="Quest description… (supports **bold**, - lists)" rows={3} />
      </div>

      {/* Objectives */}
      <div className="form-group">
        <label className="form-label">Objectives</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {state.objectives.map(obj => (
            <div key={obj.id} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <input
                value={obj.text}
                onChange={e => editObjective(obj.id, e.target.value)}
                style={{ flex: 1, fontSize: 12 }}
                placeholder="Objective text"
              />
              <button className="btn btn-sm btn-ghost btn-icon" onClick={() => removeObjective(obj.id)} title="Remove">✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              value={newObjText}
              onChange={e => setNewObjText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addObjective(); } }}
              placeholder="Add objective…"
              style={{ flex: 1, fontSize: 12 }}
            />
            <button className="btn btn-sm" onClick={addObjective}>+ Add</button>
          </div>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Reward (gold)</label>
          <input type="number" min={0} value={state.reward_gold} onChange={set('reward_gold')} />
        </div>
        <div className="form-group">
          <label className="form-label">Deadline</label>
          <input value={state.deadline} onChange={set('deadline')} placeholder="e.g. 15th Flamerule" />
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Reward Notes</label>
        <input value={state.reward_notes} onChange={set('reward_notes')} placeholder="Items, titles, favours…" />
      </div>

      <div className="form-group">
        <label className="form-label">Tags <span className="form-hint" style={{ display: 'inline' }}>(comma-separated)</span></label>
        <input value={state.tags} onChange={set('tags')} placeholder="rescue, dungeon, political…" />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Faction</label>
          <select value={state.faction_id} onChange={set('faction_id')}>
            <option value="">— None —</option>
            {factions.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Part of quest</label>
          <select value={state.parent_quest_id} onChange={set('parent_quest_id')}>
            <option value="">— None —</option>
            {quests.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Started in session</label>
          <select value={state.started_session_id} onChange={set('started_session_id')}>
            <option value="">— None —</option>
            {sessions.map(s => <option key={s.id} value={s.id}>#{s.session_number} {s.title}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Ended in session</label>
          <select value={state.completed_session_id} onChange={set('completed_session_id')}>
            <option value="">— None —</option>
            {sessions.map(s => <option key={s.id} value={s.id}>#{s.session_number} {s.title}</option>)}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">DM Notes</label>
        <textarea value={state.notes} onChange={set('notes')} placeholder="Hidden notes…" rows={2} />
      </div>

      <div className="checkbox-row">
        <input type="checkbox" id="q-visible" checked={state.is_visible} onChange={setBool('is_visible')} />
        <label htmlFor="q-visible" style={{ fontSize: 13, color: 'var(--text)', cursor: 'pointer' }}>Visible to players</label>
      </div>

      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create' : 'Save'}</button>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
