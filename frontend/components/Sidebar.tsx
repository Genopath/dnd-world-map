import React, { useCallback, useEffect, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { CalendarConfig, CharacterPathEntry, CampaignSettings, Faction, Location, LocationType, NPC, PartyMember, PathEntry, Quest, SessionEntry, SidebarTab } from '../types';
import CalendarPanel from './CalendarPanel';
import FactionPanel from './FactionPanel';
import LibraryPicker from './LibraryPicker';
import MarkdownText from './MarkdownText';
import NPCPanel from './NPCPanel';
import PartyPanel from './PartyPanel';
import QuestPanel from './QuestPanel';
import SessionPanel from './SessionPanel';

// ── Travel type metadata ──────────────────────────────────────────────────────
type TravelType = 'foot' | 'horse' | 'boat' | 'fly';
const TRAVEL_TYPES: TravelType[] = ['foot', 'horse', 'boat', 'fly'];
const TRAVEL_SYMBOLS: Record<TravelType, string> = { foot: '🥾', horse: '🐴', boat: '⛵', fly: '🦅' };
const TRAVEL_LABELS:  Record<TravelType, string> = { foot: 'Foot', horse: 'Horse', boat: 'Boat', fly: 'Flying' };
function nextTravelType(current?: string): TravelType {
  const idx = TRAVEL_TYPES.indexOf((current ?? 'foot') as TravelType);
  return TRAVEL_TYPES[(idx + 1) % TRAVEL_TYPES.length];
}

// ── Type metadata ─────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<LocationType, string> = {
  city: 'City', dungeon: 'Dungeon', wilderness: 'Wilderness', landmark: 'Landmark',
  hazard: 'Hazard', shop: 'Shop', inn: 'Inn', temple: 'Temple', port: 'Port',
};
const TYPE_ICONS: Record<LocationType, string> = {
  city: '🏰', dungeon: '💀', wilderness: '🌲', landmark: '◈',
  hazard: '⚠', shop: '🪙', inn: '🍺', temple: '⛩', port: '⚓',
};
const BADGE_CLASS: Record<LocationType, string> = {
  city: 'badge-city', dungeon: 'badge-dungeon', wilderness: 'badge-wilderness', landmark: 'badge-landmark',
  hazard: 'badge-hazard', shop: 'badge-shop', inn: 'badge-inn', temple: 'badge-temple', port: 'badge-port',
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
const isImageUrl = (url: string) => IMAGE_EXTS.some(ext => url.toLowerCase().endsWith(ext));

// ── Edit-state shape ──────────────────────────────────────────────────────────
interface EditState {
  name: string; type: LocationType; subtitle: string; description: string;
  quest_hooks: string; handouts: string; dm_notes: string; discovered: boolean;
}

function toEditState(loc: Location): EditState {
  return { name: loc.name, type: loc.type, subtitle: loc.subtitle, description: loc.description, quest_hooks: loc.quest_hooks.join('\n'), handouts: loc.handouts.join('\n'), dm_notes: loc.dm_notes, discovered: loc.discovered };
}
function fromEditState(e: EditState): Partial<Location> {
  return { name: e.name.trim() || 'Unnamed', type: e.type, subtitle: e.subtitle.trim(), description: e.description.trim(), quest_hooks: e.quest_hooks.split('\n').map(s => s.trim()).filter(Boolean), handouts: e.handouts.split('\n').map(s => s.trim()).filter(Boolean), dm_notes: e.dm_notes.trim(), discovered: e.discovered };
}
function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  location:           Location | null;
  isDMMode:           boolean;
  playerPath:         PathEntry[];
  locations:          Location[];
  npcs:               NPC[];
  quests:             Quest[];
  sessions:           SessionEntry[];
  party:              PartyMember[];
  factions:           Faction[];
  campaign:           CampaignSettings | null;
  calendarConfig:     CalendarConfig | null;
  activeTab:          SidebarTab;
  selectedLocationId: number | null;
  onTabChange:        (t: SidebarTab) => void;
  onUpdate:           (id: number, data: Partial<Location>) => Promise<void>;
  onDelete:           (id: number) => Promise<void>;
  onAddToPath:        (locationId: number) => Promise<void>;
  onRemoveFromPath:   (entryId: number) => Promise<void>;
  onReorderPath:      (order: number[]) => Promise<void>;
  onSelectLocation:   (id: number) => void;
  onCreateNPC:        (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>) => Promise<NPC>;
  onUpdateNPC:        (id: number, data: Partial<NPC>) => Promise<void>;
  onDeleteNPC:        (id: number) => Promise<void>;
  onUploadPortrait:   (id: number, file: File) => Promise<void>;
  onDeleteNpcPortrait:(id: number) => Promise<void>;
  onCreateQuest:      (data: Omit<Quest, 'id' | 'created_at'>) => Promise<void>;
  onUpdateQuest:      (id: number, data: Partial<Quest>) => Promise<void>;
  onDeleteQuest:      (id: number) => Promise<void>;
  onCreateSession:    (data: Omit<SessionEntry, 'id' | 'created_at'>) => Promise<void>;
  onUpdateSession:    (id: number, data: Partial<SessionEntry>) => Promise<void>;
  onDeleteSession:    (id: number) => Promise<void>;
  onCreateParty:      (data: Omit<PartyMember, 'id' | 'created_at'>) => Promise<PartyMember>;
  onUpdateParty:      (id: number, data: Partial<PartyMember>) => Promise<void>;
  onDeleteParty:      (id: number) => Promise<void>;
  onCreateFaction:    (data: Omit<Faction, 'id' | 'created_at'>) => Promise<Faction>;
  onUpdateFaction:    (id: number, data: Partial<Faction>) => Promise<void>;
  onDeleteFaction:    (id: number) => Promise<void>;
  onUpdateCampaign:   (data: Partial<Omit<CampaignSettings, 'id'>>) => Promise<void>;
  onUpdateCalendar:   (data: Partial<Omit<CalendarConfig, 'id'>>) => Promise<void>;
  onEnterSubmap:      (locationId: number) => void;
  isInsideSubmap:     boolean;
  onLightbox:         (url: string) => void;
  characterPaths:     CharacterPathEntry[];
  onAddToCharPath:    (memberId: number, locationId: number) => Promise<void>;
  onRemoveFromCharPath: (entryId: number) => Promise<void>;
  onReorderCharPath:  (memberId: number, order: number[]) => Promise<void>;
  onClearCharPath:    (memberId: number) => Promise<void>;
  onLinkNpc:          (questId: number, npcId: number) => Promise<void>;
  onUnlinkNpc:        (questId: number, npcId: number) => Promise<void>;
  onNavigateToNpc:    (id: number) => void;
  onNavigateToQuest:  (id: number) => void;
  npcJumpId:           number | null;
  questJumpId:         number | null;
  hiddenCharIds:              Set<number>;
  showPartyPath:              boolean;
  onToggleCharPath:           (memberId: number) => void;
  onTogglePartyPath:          () => void;
  onUpdatePathTravelType:     (entryId: number, type: string) => Promise<void>;
  onUpdateCharPathTravelType: (entryId: number, type: string) => Promise<void>;
  onUpdatePathDistance?:      (entryId: number, distance: number | null, unit: string) => Promise<void>;
  onUpdateCharPathDistance?:  (entryId: number, distance: number | null, unit: string) => Promise<void>;
  onDuplicateLocation:        (loc: Location) => Promise<void>;
  onScheduleBackup?:          () => void;
}

// ── Tab definitions ───────────────────────────────────────────────────────────
const TABS_ROW1: { key: SidebarTab; label: string; icon: string }[] = [
  { key: 'location', label: 'Location', icon: '📍' },
  { key: 'npcs',     label: 'NPCs',     icon: '👤' },
  { key: 'quests',   label: 'Quests',   icon: '📜' },
  { key: 'sessions', label: 'Log',      icon: '📖' },
];
const TABS_ROW2: { key: SidebarTab; label: string; icon: string }[] = [
  { key: 'party',    label: 'Party',    icon: '⚔️' },
  { key: 'factions', label: 'Factions', icon: '⚜️' },
  { key: 'calendar', label: 'Calendar', icon: '🗓️' },
  { key: 'path',     label: 'Path',     icon: '🧭' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function Sidebar({
  location, isDMMode, playerPath, locations, npcs, quests, sessions,
  party, factions, campaign, calendarConfig,
  characterPaths, activeTab, selectedLocationId, onTabChange, onUpdate, onDelete,
  onAddToPath, onRemoveFromPath, onReorderPath, onSelectLocation,
  onCreateNPC, onUpdateNPC, onDeleteNPC, onUploadPortrait, onDeleteNpcPortrait,
  onCreateQuest, onUpdateQuest, onDeleteQuest,
  onCreateSession, onUpdateSession, onDeleteSession,
  onCreateParty, onUpdateParty, onDeleteParty,
  onCreateFaction, onUpdateFaction, onDeleteFaction,
  onUpdateCampaign, onUpdateCalendar, onEnterSubmap, isInsideSubmap,
  onLightbox,
  onAddToCharPath, onRemoveFromCharPath, onReorderCharPath, onClearCharPath,
  onLinkNpc, onUnlinkNpc, onNavigateToNpc, onNavigateToQuest,
  npcJumpId, questJumpId,
  hiddenCharIds, showPartyPath, onToggleCharPath, onTogglePartyPath,
  onUpdatePathTravelType, onUpdateCharPathTravelType,
  onUpdatePathDistance, onUpdateCharPathDistance,
  onDuplicateLocation,
  onScheduleBackup,
}: Props) {
  const [isEditing,  setIsEditing]  = useState(false);
  const [editState,  setEditState]  = useState<EditState | null>(null);
  const [saving,     setSaving]     = useState(false);

  useEffect(() => { setIsEditing(false); setEditState(null); }, [location?.id]);

  const startEdit  = useCallback(() => { if (!location) return; setEditState(toEditState(location)); setIsEditing(true); }, [location]);
  const cancelEdit = useCallback(() => { setIsEditing(false); setEditState(null); }, []);
  const saveEdit   = useCallback(async () => {
    if (!location || !editState) return;
    setSaving(true);
    try { await onUpdate(location.id, fromEditState(editState)); setIsEditing(false); }
    finally { setSaving(false); }
  }, [location, editState, onUpdate]);

  const handleDelete = useCallback(async () => {
    if (!location) return;
    if (!confirm(`Delete "${location.name}"? This cannot be undone.`)) return;
    await onDelete(location.id);
  }, [location, onDelete]);

  const isInPath = location ? playerPath.some(e => e.location_id === location.id) : false;
  const sortedPath = [...playerPath].sort((a, b) => a.position - b.position);

  const movePathEntry = useCallback(async (entryId: number, dir: -1 | 1) => {
    const sorted = [...playerPath].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex(e => e.id === entryId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    const newOrder = sorted.map(e => e.id);
    [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
    await onReorderPath(newOrder);
  }, [playerPath, onReorderPath]);

  // ── Tab badge helpers ─────────────────────────────────────────────────────
  function tabBadge(key: SidebarTab): string {
    if (key === 'path'     && playerPath.length > 0) return ` (${playerPath.length})`;
    if (key === 'npcs'     && npcs.length > 0)       return ` (${npcs.length})`;
    if (key === 'party'    && party.length > 0)       return ` (${party.length})`;
    if (key === 'factions' && factions.length > 0)    return ` (${factions.length})`;
    if (key === 'quests') {
      const active = quests.filter(q => q.status === 'active').length;
      if (active > 0) return ` (${active})`;
    }
    if (key === 'sessions' && sessions.length > 0) return ` (${sessions.length})`;
    return '';
  }

  const renderTab = (t: { key: SidebarTab; label: string; icon: string }) => (
    <button key={t.key} className={`sidebar-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => onTabChange(t.key)}>
      <span className="tab-icon">{t.icon}</span>
      <span>{t.label}{tabBadge(t.key)}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      {/* Tabs — 2 rows of 4 */}
      <div className="sidebar-tabs">
        <div className="sidebar-tab-row">{TABS_ROW1.map(renderTab)}</div>
        <div className="sidebar-tab-row">{TABS_ROW2.map(renderTab)}</div>
      </div>

      <div className="sidebar-body">
        {/* ── Location tab ─────────────────────────────────────────────── */}
        {activeTab === 'location' && (
          !location ? (
            <div className="no-sel">
              <div className="no-sel-icon">◈</div>
              <div>Click a pin on the map to view its details</div>
              {isDMMode && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Use "+ Add Location" to place new pins</div>}
            </div>
          ) : isEditing && editState ? (
            <EditForm
              state={editState} isDMMode={isDMMode} locationId={location.id}
              onChange={setEditState} onSave={saveEdit} onCancel={cancelEdit} saving={saving}
              onUpdateLocation={onUpdate}
              currentPinSize={location.pin_size ?? 'md'}
              currentIconUrl={location.icon_url} currentImageUrl={location.image_url} currentSubmapUrl={location.submap_image_url}
              onScheduleBackup={onScheduleBackup}
            />
          ) : (
            <LocationDetail
              location={location} isDMMode={isDMMode} isInPath={isInPath}
              npcs={npcs} quests={quests}
              onEdit={startEdit} onDelete={handleDelete}
              onDuplicate={() => onDuplicateLocation(location)}
              onAddToPath={() => onAddToPath(location.id)}
              onRemoveFromPath={() => { const e = playerPath.find(e => e.location_id === location.id); if (e) onRemoveFromPath(e.id); }}
              onLightbox={onLightbox}
              onEnterSubmap={onEnterSubmap}
              isInsideSubmap={isInsideSubmap}
              onUpdate={onUpdate}
              onNavigateToNpc={id => { onNavigateToNpc(id); onTabChange('npcs'); }}
              onNavigateToQuest={id => { onNavigateToQuest(id); onTabChange('quests'); }}
            />
          )
        )}

        {/* ── NPCs tab ─────────────────────────────────────────────────── */}
        {activeTab === 'npcs' && (
          <NPCPanel
            npcs={npcs} locations={locations} quests={quests} isDMMode={isDMMode}
            selectedLocationId={selectedLocationId}
            onCreate={onCreateNPC} onUpdate={onUpdateNPC} onDelete={onDeleteNPC}
            onUploadPortrait={onUploadPortrait} onDeletePortrait={onDeleteNpcPortrait} onLightbox={onLightbox}
            onScheduleBackup={onScheduleBackup}
            onNavigateToQuest={onNavigateToQuest}
            onUnlinkNpc={onUnlinkNpc}
            jumpToId={npcJumpId}
          />
        )}

        {/* ── Quests tab ───────────────────────────────────────────────── */}
        {activeTab === 'quests' && (
          <QuestPanel
            quests={quests} locations={locations} npcs={npcs}
            factions={factions} sessions={sessions}
            isDMMode={isDMMode}
            onCreate={onCreateQuest} onUpdate={onUpdateQuest} onDelete={onDeleteQuest}
            onLightbox={onLightbox}
            onLinkNpc={onLinkNpc} onUnlinkNpc={onUnlinkNpc}
            onNavigateToNpc={onNavigateToNpc}
            jumpToId={questJumpId}
            onScheduleBackup={onScheduleBackup}
          />
        )}

        {/* ── Sessions tab ─────────────────────────────────────────────── */}
        {activeTab === 'sessions' && (
          <SessionPanel
            sessions={sessions} isDMMode={isDMMode}
            onCreate={onCreateSession} onUpdate={onUpdateSession} onDelete={onDeleteSession}
            onLightbox={onLightbox}
            onScheduleBackup={onScheduleBackup}
          />
        )}

        {/* ── Party tab ────────────────────────────────────────────────── */}
        {activeTab === 'party' && (
          <PartyPanel
            party={party} isDMMode={isDMMode}
            onCreate={onCreateParty} onUpdate={onUpdateParty} onDelete={onDeleteParty}
            onLightbox={onLightbox}
            onScheduleBackup={onScheduleBackup}
          />
        )}

        {/* ── Factions tab ─────────────────────────────────────────────── */}
        {activeTab === 'factions' && (
          <FactionPanel
            factions={factions} isDMMode={isDMMode}
            onCreate={onCreateFaction} onUpdate={onUpdateFaction} onDelete={onDeleteFaction}
            onLightbox={onLightbox}
            onScheduleBackup={onScheduleBackup}
          />
        )}

        {/* ── Calendar / World tab ─────────────────────────────────────── */}
        {activeTab === 'calendar' && (
          <CalendarPanel
            campaign={campaign} calendarConfig={calendarConfig} isDMMode={isDMMode}
            onUpdateCampaign={onUpdateCampaign} onUpdateCalendar={onUpdateCalendar}
          />
        )}

        {/* ── Path tab ─────────────────────────────────────────────────── */}
        {activeTab === 'path' && (
          <PathPanel
            sortedPath={sortedPath} locations={locations} party={party}
            characterPaths={characterPaths} isDMMode={isDMMode}
            selectedLocationId={selectedLocationId}
            hiddenCharIds={hiddenCharIds} showPartyPath={showPartyPath}
            onRemove={onRemoveFromPath} onMove={movePathEntry} onSelectLocation={onSelectLocation}
            onAddToCharPath={onAddToCharPath}
            onRemoveFromCharPath={onRemoveFromCharPath}
            onReorderCharPath={onReorderCharPath}
            onClearCharPath={onClearCharPath}
            onToggleCharPath={onToggleCharPath}
            onTogglePartyPath={onTogglePartyPath}
            onUpdateTravelType={onUpdatePathTravelType}
            onUpdateCharTravelType={onUpdateCharPathTravelType}
            onUpdateDistance={onUpdatePathDistance}
            onUpdateCharDistance={onUpdateCharPathDistance}
          />
        )}
      </div>
    </aside>
  );
}

// ── LocationDetail ────────────────────────────────────────────────────────────
interface DetailProps {
  location: Location; isDMMode: boolean; isInPath: boolean;
  npcs: NPC[]; quests: Quest[];
  onEdit: () => void; onDelete: () => void; onDuplicate: () => void;
  onAddToPath: () => void; onRemoveFromPath: () => void;
  onLightbox: (url: string) => void;
  onEnterSubmap: (id: number) => void;
  isInsideSubmap: boolean;
  onUpdate: (id: number, data: Partial<Location>) => Promise<void>;
  onNavigateToNpc: (id: number) => void;
  onNavigateToQuest: (id: number) => void;
}

function LocationDetail({ location, isDMMode, isInPath, npcs, quests, onEdit, onDelete, onDuplicate, onAddToPath, onRemoveFromPath, onLightbox, onEnterSubmap, isInsideSubmap, onUpdate, onNavigateToNpc, onNavigateToQuest }: DetailProps) {
  const residents     = npcs.filter(n => n.location_id === location.id);
  const linkedQuests  = quests.filter(q => q.location_id === location.id);
  const type = location.type as LocationType;
  return (
    <>
      {location.image_url && (
        <img
          src={`${API_BASE}${location.image_url}`}
          alt={location.name}
          className="detail-hero-img"
          onClick={() => onLightbox(`${API_BASE}${location.image_url!}`)}
        />
      )}
      <div>
        <div className={`loc-type-badge ${BADGE_CLASS[type]}`}>{TYPE_ICONS[type]} {TYPE_LABELS[type]}</div>
        <div className="loc-name">{location.name}</div>
        {location.subtitle && <div className="loc-subtitle">{location.subtitle}</div>}
      </div>
      <div>
        <span
          className={`discovered-pill ${location.discovered ? 'discovered-yes' : 'discovered-no'}`}
          onClick={isDMMode ? () => onUpdate(location.id, { discovered: !location.discovered }) : undefined}
          style={isDMMode ? { cursor: 'pointer' } : undefined}
          title={isDMMode ? (location.discovered ? 'Visible to players — click to hide' : 'Hidden from players — click to reveal') : undefined}
        >
          {location.discovered ? '✓ Discovered' : '○ Undiscovered'}
        </span>
      </div>
      {location.description && (
        <div>
          <div className="section-label">Description</div>
          <MarkdownText>{location.description}</MarkdownText>
        </div>
      )}
      {location.quest_hooks.length > 0 && (
        <div>
          <div className="section-label">Quest Hooks</div>
          <div className="list-items">
            {location.quest_hooks.map((h, i) => <div key={i} className="list-item">{h}</div>)}
          </div>
        </div>
      )}
      {location.handouts.length > 0 && (
        <div>
          <div className="section-label">Handouts</div>
          <div className="list-items">
            {location.handouts.map((h, i) => {
              if (h.startsWith('/uploads/handouts/')) {
                const raw = h.split('/').pop() ?? h;
                const displayName = raw.replace(/^[0-9a-f]{8}_/, '');
                const fullUrl = `${API_BASE}${h}`;
                if (isImageUrl(h)) {
                  return (
                    <div key={i} className="list-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                      <img src={fullUrl} alt={displayName} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 4, cursor: 'zoom-in', objectFit: 'cover' }} onClick={() => onLightbox(fullUrl)} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{displayName}</span>
                    </div>
                  );
                }
                return (
                  <div key={i} className="list-item">
                    <a href={fullUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>📎 {displayName}</a>
                  </div>
                );
              }
              return <div key={i} className="list-item">{h}</div>;
            })}
          </div>
        </div>
      )}
      {isDMMode && (
        <div className="dm-box">
          <div className="dm-box-label">🔒 DM Notes</div>
          <div className="dm-box-text">
            {location.dm_notes ? <MarkdownText>{location.dm_notes}</MarkdownText> : <em style={{ opacity: 0.5 }}>No notes yet.</em>}
          </div>
        </div>
      )}
      {isDMMode && location.icon_url && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={`${API_BASE}${location.icon_url}`} alt="Pin icon" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Custom pin icon</span>
        </div>
      )}
      {/* Residents — NPCs whose home is this location */}
      {residents.length > 0 && (
        <div>
          <div className="section-label">Residents</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {residents.map(npc => (
              <button
                key={npc.id}
                className="btn btn-sm btn-ghost"
                style={{ justifyContent: 'flex-start', gap: 6, textAlign: 'left' }}
                onClick={() => onNavigateToNpc(npc.id)}
              >
                {npc.portrait_url
                  ? <img src={`${API_BASE}${npc.portrait_url}`} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 12 }}>👤</span>}
                <span style={{ flex: 1 }}>{npc.name}</span>
                {npc.role && <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{npc.role}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quests — quests linked to this location */}
      {linkedQuests.length > 0 && (
        <div>
          <div className="section-label">Quests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {linkedQuests.map(q => (
              <button
                key={q.id}
                className="btn btn-sm btn-ghost"
                style={{ justifyContent: 'flex-start', gap: 6, textAlign: 'left' }}
                onClick={() => onNavigateToQuest(q.id)}
              >
                <span style={{ fontSize: 11, color: q.status === 'active' ? 'var(--accent)' : q.status === 'completed' ? 'var(--success-text)' : 'var(--danger-text)' }}>
                  {q.status === 'active' ? '◉' : q.status === 'completed' ? '✓' : '✗'}
                </span>
                <span style={{ flex: 1 }}>{q.title}</span>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0, textTransform: 'uppercase' }}>{q.tier}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {location.submap_image_url && !isInsideSubmap && (
          <button className="btn btn-sm btn-primary" onClick={() => onEnterSubmap(location.id)}>
            🗺 Enter Sub-Map
          </button>
        )}
        <div className="loc-actions">
          {isDMMode && <button className="btn btn-sm" onClick={onEdit}>Edit</button>}
          {isDMMode && <button className="btn btn-sm" onClick={onDuplicate} title="Duplicate this location">⧉ Copy</button>}
          {isInPath
            ? <button className="btn btn-sm" onClick={onRemoveFromPath}>Remove from Path</button>
            : <button className="btn btn-sm" onClick={onAddToPath}>Add to Path</button>}
          {isDMMode && <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>}
        </div>
      </div>
    </>
  );
}

// ── EditForm ──────────────────────────────────────────────────────────────────
interface EditFormProps {
  state: EditState; isDMMode: boolean; locationId: number;
  onChange: (s: EditState) => void;
  onSave: () => void; onCancel: () => void; saving: boolean;
  onUpdateLocation: (id: number, data: Partial<Location>) => Promise<void>;
  currentPinSize?: 'sm' | 'md' | 'lg';
  currentIconUrl?: string | null;
  currentImageUrl?: string | null;
  currentSubmapUrl?: string | null;
  onScheduleBackup?: () => void;
}

function EditForm({ state, isDMMode, locationId, onChange, onSave, onCancel, saving, onUpdateLocation, currentPinSize = 'md', currentIconUrl, currentImageUrl, currentSubmapUrl, onScheduleBackup }: EditFormProps) {
  const [libraryFor, setLibraryFor] = useState<'icon' | 'image' | 'submap' | null>(null);
  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange({ ...state, [key]: e.target.value });

  return (
    <div className="edit-form" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="form-group"><label className="form-label">Name</label><input value={state.name} onChange={set('name')} placeholder="Location name" /></div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Type</label>
          <select value={state.type} onChange={set('type')}>
            <optgroup label="Places">
              <option value="city">City</option>
              <option value="inn">Inn / Tavern</option>
              <option value="shop">Shop / Market</option>
              <option value="temple">Temple / Shrine</option>
              <option value="port">Port / Harbor</option>
            </optgroup>
            <optgroup label="Wilderness">
              <option value="wilderness">Wilderness</option>
              <option value="dungeon">Dungeon</option>
              <option value="hazard">Hazard</option>
            </optgroup>
            <optgroup label="Other">
              <option value="landmark">Landmark</option>
            </optgroup>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Discovered</label>
          <div className="checkbox-row" style={{ marginTop: 8 }}>
            <input type="checkbox" id="disc-check" checked={state.discovered} onChange={e => onChange({ ...state, discovered: e.target.checked })} />
            <label htmlFor="disc-check">Discovered</label>
          </div>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Pin Size</label>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(['sm', 'md', 'lg'] as const).map(s => (
            <button key={s} type="button"
              className={`btn btn-sm${currentPinSize === s ? ' btn-active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => onUpdateLocation(locationId, { pin_size: s })}
            >{s === 'sm' ? 'Small' : s === 'md' ? 'Medium' : 'Large'}</button>
          ))}
        </div>
      </div>
      <div className="form-group"><label className="form-label">Subtitle</label><input value={state.subtitle} onChange={set('subtitle')} placeholder="Short flavor text" /></div>
      <div className="form-group"><label className="form-label">Description</label><textarea value={state.description} onChange={set('description')} placeholder="Visible to players… (supports **bold**, - lists)" rows={4} /></div>
      <div className="form-group"><label className="form-label">Quest Hooks</label><textarea value={state.quest_hooks} onChange={set('quest_hooks')} placeholder="One hook per line" rows={3} /><span className="form-hint">One entry per line</span></div>
      <div className="form-group">
        <label className="form-label">Handouts</label>
        <textarea value={state.handouts} onChange={set('handouts')} placeholder="One handout per line" rows={2} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="form-hint" style={{ flex: 1 }}>One entry per line — or upload a file</span>
          <label className="btn btn-sm" style={{ cursor: 'pointer', flexShrink: 0 }}>
            📎 Upload
            <input type="file" style={{ display: 'none' }} onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { const { url } = await api.handouts.upload(f); onChange({ ...state, handouts: state.handouts ? `${state.handouts}\n${url}` : url }); }
              catch (err) { console.error('Handout upload failed:', err); }
              e.target.value = '';
            }} />
          </label>
        </div>
      </div>
      {isDMMode && (
        <div className="form-group">
          <label className="form-label" style={{ color: '#a06060' }}>🔒 DM Notes</label>
          <textarea value={state.dm_notes} onChange={set('dm_notes')} placeholder="Hidden from players… (supports **bold**, - lists)" rows={3} style={{ borderColor: 'rgba(122,28,28,0.5)' }} />
        </div>
      )}
      {isDMMode && (
        <div className="form-group">
          <label className="form-label">📌 Custom Pin Icon</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              Upload Icon
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await api.locations.uploadIcon(locationId, f); await onUpdateLocation(locationId, {}); onScheduleBackup?.(); }
                catch (err) { console.error('Icon upload failed:', err); }
                e.target.value = '';
              }} />
            </label>
            <button className="btn btn-sm" onClick={() => setLibraryFor('icon')}>📚 Library</button>
            {currentIconUrl && (
              <button className="btn btn-sm btn-danger" onClick={async () => {
                try { await api.locations.deleteIcon(locationId); await onUpdateLocation(locationId, {}); }
                catch (err) { console.error('Icon delete failed:', err); }
              }}>🗑 Remove</button>
            )}
          </div>
          <span className="form-hint" style={{ marginTop: 4 }}>Replaces the colored dot on the map pin</span>
        </div>
      )}
      {isDMMode && (
        <div className="form-group">
          <label className="form-label">🖼 Location Image</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              Upload Image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await api.locations.uploadImage(locationId, f); await onUpdateLocation(locationId, {}); onScheduleBackup?.(); }
                catch (err) { console.error('Image upload failed:', err); }
                e.target.value = '';
              }} />
            </label>
            <button className="btn btn-sm" onClick={() => setLibraryFor('image')}>📚 Library</button>
            {currentImageUrl && (
              <button className="btn btn-sm btn-danger" onClick={async () => {
                try { await api.locations.deleteImage(locationId); await onUpdateLocation(locationId, {}); }
                catch (err) { console.error('Image delete failed:', err); }
              }}>🗑 Remove</button>
            )}
          </div>
          <span className="form-hint" style={{ marginTop: 4 }}>Hero image shown in location detail</span>
        </div>
      )}
      {isDMMode && (
        <div className="form-group">
          <label className="form-label">🗺 Sub-Map</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
              Upload Sub-Map
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await api.locations.uploadSubmap(locationId, f); await onUpdateLocation(locationId, {}); onScheduleBackup?.(); }
                catch (err) { console.error('Sub-map upload failed:', err); }
                e.target.value = '';
              }} />
            </label>
            <button className="btn btn-sm" onClick={() => setLibraryFor('submap')}>📚 Library</button>
            {currentSubmapUrl && (
              <button className="btn btn-sm btn-danger" onClick={async () => {
                try { await api.locations.deleteSubmap(locationId); await onUpdateLocation(locationId, {}); }
                catch (err) { console.error('Sub-map delete failed:', err); }
              }}>🗑 Remove</button>
            )}
          </div>
          <span className="form-hint" style={{ marginTop: 4 }}>Allows players to enter this location's interior map</span>
        </div>
      )}
      <div className="form-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
      {libraryFor && (
        <LibraryPicker
          onSelect={async url => {
            if (libraryFor === 'icon')   await onUpdateLocation(locationId, { icon_url: url });
            if (libraryFor === 'image')  await onUpdateLocation(locationId, { image_url: url });
            if (libraryFor === 'submap') await onUpdateLocation(locationId, { submap_image_url: url });
            setLibraryFor(null);
          }}
          onClose={() => setLibraryFor(null)}
        />
      )}
    </div>
  );
}

const CHAR_PATH_COLORS = ['#e05c5c', '#5c9fe0', '#60cc78', '#c05ce0', '#e0a040', '#40d4c8', '#e07840', '#a0c840'];

// ── Distance editor — needs local state so the controlled select works ────────

const DISTANCE_UNITS_LIST = ['hours', 'days', 'weeks', 'months', 'years', 'miles', 'km', 'leagues'];

function DistanceRow({ entryId, distance, distanceUnit, onSave }: {
  entryId:      number;
  distance:     number | null | undefined;
  distanceUnit: string | null | undefined;
  onSave:       (id: number, dist: number | null, unit: string) => void;
}) {
  const [dist, setDist] = React.useState<string>(distance != null ? String(distance) : '');
  const [unit, setUnit] = React.useState<string>(distanceUnit ?? 'days');

  // Sync if props change (e.g. initial data load or reorder)
  React.useEffect(() => { setDist(distance != null ? String(distance) : ''); }, [distance]);
  React.useEffect(() => { setUnit(distanceUnit ?? 'days'); }, [distanceUnit]);

  const commit = (d: string, u: string) => {
    const num = d.trim() === '' ? null : parseFloat(d);
    onSave(entryId, isNaN(num as number) ? null : num, u);
  };

  return (
    <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 28, marginTop: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', flexShrink: 0 }}>Distance:</span>
      <input
        type="number" min="0" step="0.5" placeholder="—"
        value={dist}
        style={{ width: 60, fontSize: 11, padding: '1px 4px' }}
        onChange={e => setDist(e.target.value)}
        onBlur={e => commit(e.target.value, unit)}
      />
      <select
        value={unit}
        style={{ fontSize: 11, padding: '1px 2px' }}
        onChange={e => { const u = e.target.value; setUnit(u); commit(dist, u); }}
      >
        {DISTANCE_UNITS_LIST.map(u => <option key={u} value={u}>{u}</option>)}
      </select>
    </div>
  );
}

// ── PathPanel ─────────────────────────────────────────────────────────────────
interface PathPanelProps {
  sortedPath:              PathEntry[];
  locations:               Location[];
  party:                   PartyMember[];
  characterPaths:          CharacterPathEntry[];
  isDMMode:                boolean;
  selectedLocationId:      number | null;
  hiddenCharIds:           Set<number>;
  showPartyPath:           boolean;
  onRemove:                (id: number) => Promise<void>;
  onMove:                  (id: number, dir: -1 | 1) => Promise<void>;
  onSelectLocation:        (id: number) => void;
  onAddToCharPath:         (memberId: number, locationId: number) => Promise<void>;
  onRemoveFromCharPath:    (entryId: number) => Promise<void>;
  onReorderCharPath:       (memberId: number, order: number[]) => Promise<void>;
  onClearCharPath:         (memberId: number) => Promise<void>;
  onToggleCharPath:        (memberId: number) => void;
  onTogglePartyPath:       () => void;
  onUpdateTravelType:      (entryId: number, type: string) => Promise<void>;
  onUpdateCharTravelType:  (entryId: number, type: string) => Promise<void>;
  onUpdateDistance?:       (entryId: number, distance: number | null, unit: string) => Promise<void>;
  onUpdateCharDistance?:   (entryId: number, distance: number | null, unit: string) => Promise<void>;
}

function PathPanel({
  sortedPath, locations, party, characterPaths, isDMMode, selectedLocationId,
  hiddenCharIds, showPartyPath,
  onRemove, onMove, onSelectLocation,
  onAddToCharPath, onRemoveFromCharPath, onReorderCharPath, onClearCharPath,
  onToggleCharPath, onTogglePartyPath,
  onUpdateTravelType, onUpdateCharTravelType,
  onUpdateDistance, onUpdateCharDistance,
}: PathPanelProps) {
  const [activeSection, setActiveSection] = useState<'party' | number>('party');

  const renderPathList = (
    entries: { id: number; location_id: number; position: number; travel_type?: string; distance?: number | null; distance_unit?: string | null; visited_at?: string }[],
    canEdit: boolean,
    onRem: (id: number) => void,
    onTravelType?: (id: number, type: string) => void,
    onMov?: (id: number, dir: -1 | 1) => void,
    onDist?: (id: number, distance: number | null, unit: string) => void,
  ) => (
    <div className="path-list">
      {entries.map((entry, i) => {
        const loc = locations.find(l => l.id === entry.location_id);
        const tt = (entry.travel_type ?? 'foot') as TravelType;
        return (
          <div key={entry.id} className="path-entry" style={{ flexWrap: 'wrap', rowGap: 4 }}>
            <div className="path-num">{i + 1}</div>
            {canEdit && onTravelType && i > 0 && (
              <button
                className="btn btn-sm btn-ghost"
                style={{ fontSize: 14, padding: '0 3px', minWidth: 22 }}
                title={`Travel: ${TRAVEL_LABELS[tt]} — click to change`}
                onClick={() => onTravelType(entry.id, nextTravelType(entry.travel_type))}
              >
                {TRAVEL_SYMBOLS[tt]}
              </button>
            )}
            {(i === 0 || !canEdit) && <span style={{ fontSize: 14, minWidth: 22, display: 'inline-block', textAlign: 'center' }}>📍</span>}
            <div className="path-info" style={{ cursor: 'pointer' }} onClick={() => { if (loc) onSelectLocation(loc.id); }}>
              <div className="path-loc-name">{loc?.name ?? `Location #${entry.location_id}`}</div>
              <div className="path-loc-type">{loc ? TYPE_LABELS[loc.type as LocationType] : ''}</div>
              {entry.visited_at && <div className="path-time">{fmtDate(entry.visited_at)}</div>}
            </div>
            {canEdit && onMov && (
              <div className="path-arrows">
                <button className="path-arrow" onClick={() => onMov(entry.id, -1)} disabled={i === 0} title="Move up">▲</button>
                <button className="path-arrow" onClick={() => onMov(entry.id, 1)} disabled={i === entries.length - 1} title="Move down">▼</button>
              </div>
            )}
            {canEdit && (
              <button className="path-remove" onClick={() => onRem(entry.id)} title="Remove">✕</button>
            )}
            {canEdit && onDist && i > 0 && (
              <DistanceRow
                entryId={entry.id}
                distance={entry.distance}
                distanceUnit={entry.distance_unit}
                onSave={onDist}
              />
            )}
            {!canEdit && i > 0 && entry.distance != null && (
              <div style={{ width: '100%', paddingLeft: 28, fontSize: 11, color: 'var(--text-dim)' }}>
                {entry.distance} {entry.distance_unit ?? 'days'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Visibility toggles row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Show on map</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Party path toggle */}
          <button
            className={`path-vis-toggle ${showPartyPath ? 'active' : ''}`}
            onClick={onTogglePartyPath}
            title={showPartyPath ? 'Hide party path' : 'Show party path'}
          >
            <span style={{ display: 'inline-block', width: 10, height: 3, borderRadius: 2, background: '#c9a84c', marginRight: 5, verticalAlign: 'middle' }} />
            Party
          </button>
          {/* Per-character toggles */}
          {party.map(m => {
            const visible = !hiddenCharIds.has(m.id);
            const color = m.path_color || '#c9a84c';
            return (
              <button
                key={m.id}
                className={`path-vis-toggle ${visible ? 'active' : ''}`}
                onClick={() => onToggleCharPath(m.id)}
                title={visible ? `Hide ${m.name}'s path` : `Show ${m.name}'s path`}
              >
                <span style={{ display: 'inline-block', width: 10, height: 3, borderRadius: 2, background: color, marginRight: 5, verticalAlign: 'middle' }} />
                {m.name.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${activeSection === 'party' ? 'btn-active' : ''}`}
          onClick={() => setActiveSection('party')}
        >
          🗺 Party ({sortedPath.length})
        </button>
        {party.map(m => {
          const count = characterPaths.filter(e => e.party_member_id === m.id).length;
          const color = m.path_color || '#c9a84c';
          return (
            <button
              key={m.id}
              className={`btn btn-sm ${activeSection === m.id ? 'btn-active' : ''}`}
              style={{ borderColor: activeSection === m.id ? color : undefined, color: activeSection === m.id ? color : undefined }}
              onClick={() => setActiveSection(m.id)}
            >
              {m.name.split(' ')[0]} ({count})
            </button>
          );
        })}
      </div>

      {/* Party path */}
      {activeSection === 'party' && (
        <>
          {sortedPath.length === 0 ? (
            <div className="path-empty">No party waypoints yet.<br /><span style={{ fontSize: 12, marginTop: 4, display: 'block' }}>Select a location and click "Add to Path".</span></div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {sortedPath.length} waypoint{sortedPath.length !== 1 ? 's' : ''} — click the travel icon to change type
              </div>
              {renderPathList(sortedPath, isDMMode, onRemove, onUpdateTravelType, onMove, onUpdateDistance)}
            </>
          )}
        </>
      )}

      {/* Per-character paths */}
      {party.map(m => {
        if (activeSection !== m.id) return null;
        const color = m.path_color || '#c9a84c';
        const entries = characterPaths
          .filter(e => e.party_member_id === m.id)
          .sort((a, b) => a.position - b.position);
        return (
          <div key={m.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 12, height: 4, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                {entries.length} waypoint{entries.length !== 1 ? 's' : ''}
              </span>
              {isDMMode && selectedLocationId != null && (
                <button className="btn btn-sm" onClick={() => onAddToCharPath(m.id, selectedLocationId)}>
                  + Add Selected
                </button>
              )}
              {!selectedLocationId && isDMMode && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Select a pin first</span>
              )}
              {isDMMode && entries.length > 0 && (
                <button className="btn btn-sm btn-danger" onClick={() => { if (confirm(`Clear ${m.name}'s path?`)) onClearCharPath(m.id); }}>Clear</button>
              )}
            </div>
            {entries.length === 0 ? (
              <div className="path-empty">No waypoints for {m.name}.<br /><span style={{ fontSize: 12, marginTop: 4, display: 'block' }}>Click a pin on the map to select it, then "+ Add Selected".</span></div>
            ) : (
              renderPathList(entries, isDMMode, onRemoveFromCharPath, onUpdateCharTravelType, undefined, onUpdateCharDistance)
            )}
          </div>
        );
      })}
    </div>
  );
}
