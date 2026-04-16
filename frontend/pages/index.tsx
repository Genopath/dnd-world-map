import Head from 'next/head';
import { useCallback, useEffect, useRef, useState } from 'react';
import CampaignSelector from '../components/CampaignSelector';
import MapView from '../components/MapView';
import Sidebar from '../components/Sidebar';
import { useWebSocket } from '../hooks/useWebSocket';
import { api, API_BASE, setCurrentCampaign } from '../lib/api';
import type { CalendarConfig, CampaignMeta, CampaignSettings, CharacterPathEntry, Faction, Location, MapConfig, NPC, PartyMember, PathEntry, Quest, SearchResults, SessionEntry, SidebarTab } from '../types';

// ── Browser backup helpers ────────────────────────────────────────────────────
// Builds an import-compatible payload from frontend state (no binary file data).
// Used for the automatic localStorage safety net.
function _buildBrowserBackup(data: {
  locations: Location[]; playerPath: PathEntry[]; npcs: NPC[]; quests: Quest[];
  sessions: SessionEntry[]; party: PartyMember[]; factions: Faction[];
  characterPaths: CharacterPathEntry[]; campaign: CampaignSettings | null;
  calendarConfig: CalendarConfig | null; fogData: string;
}) {
  const links: Array<{ quest_id: number; npc_id: number }> = [];
  for (const q of data.quests)
    for (const npcId of (q.linked_npc_ids ?? []))
      links.push({ quest_id: q.id, npc_id: npcId });

  return {
    _version: 2,
    _browser_backup: true,
    _saved_at: new Date().toISOString(),
    campaign_settings: data.campaign ?? {},
    calendar_config:   data.calendarConfig ?? {},
    map_config:        { image_filename: '', _image_data: null },
    fog_of_war:        data.fogData,
    locations:         data.locations,
    npcs:              data.npcs,
    quests:            data.quests,
    quest_npc_links:   links,
    sessions:          data.sessions,
    party_members:     data.party,
    factions:          data.factions,
    player_path: data.playerPath.map(e => ({
      id: e.id, location_id: e.location_id,
      position: e.position, travel_type: e.travel_type ?? 'foot',
      distance: e.distance ?? null, distance_unit: e.distance_unit ?? null,
    })),
    character_paths: data.characterPaths,
  };
}

function _saveBrowserBackup(slug: string, backup: object) {
  try {
    localStorage.setItem(`campaign_backup_${slug}`, JSON.stringify(backup));
  } catch {
    // localStorage quota exceeded — silently skip
  }
}

function _loadBrowserBackup(slug: string): { _saved_at?: string; [k: string]: unknown } | null {
  try {
    const raw = localStorage.getItem(`campaign_backup_${slug}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Home() {
  // ── Campaign selection ──────────────────────────────────────────────────────
  const [campaignSlug,         setCampaignSlug]         = useState<string | null>(null);
  const [campaignName,         setCampaignName]         = useState<string>('');
  const [showCampaignSelector, setShowCampaignSelector] = useState(false);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [locations,   setLocations]   = useState<Location[]>([]);
  const [playerPath,  setPlayerPath]  = useState<PathEntry[]>([]);
  const [mapConfig,   setMapConfig]   = useState<MapConfig>({ image_url: null });
  const [selectedId,  setSelectedId]  = useState<number | null>(null);
  const [isDMMode,    setIsDMMode]    = useState(true);
  const [isAddingPin,   setIsAddingPin]   = useState(false);
  const [sidebarTab,    setSidebarTab]    = useState<SidebarTab>('location');
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [showPinLabels,   setShowPinLabels]   = useState(() => typeof window !== 'undefined' && localStorage.getItem('show_pin_labels') === '1');
  const [showDistLabels,  setShowDistLabels]  = useState(() => typeof window !== 'undefined' ? localStorage.getItem('show_dist_labels') !== '0' : true);
  const [fitTrigger,      setFitTrigger]      = useState(0);

  // ── Phase-1 state ───────────────────────────────────────────────────────────
  const [npcs,     setNpcs]     = useState<NPC[]>([]);
  const [quests,   setQuests]   = useState<Quest[]>([]);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  // ── Phase-2 state ───────────────────────────────────────────────────────────
  const [party,    setParty]    = useState<PartyMember[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [campaign, setCampaign] = useState<CampaignSettings | null>(null);
  const [fogData,  setFogData]  = useState<string>('1'.repeat(10000));
  const [fogPaint, setFogPaint] = useState(false);
  const [fogBrush, setFogBrush] = useState<'reveal' | 'hide'>('reveal');
  const [fogSize,  setFogSize]  = useState(3);

  // ── Phase-3 state ───────────────────────────────────────────────────────────
  const [calendarConfig,  setCalendarConfig]  = useState<CalendarConfig | null>(null);
  const [mapStack,        setMapStack]        = useState<number[]>([]);
  const [submapFogData,   setSubmapFogData]   = useState<string>('1'.repeat(10000));
  const [characterPaths,  setCharacterPaths]  = useState<CharacterPathEntry[]>([]);

  // ── Navigation jump state ────────────────────────────────────────────────────
  const [npcJumpId,   setNpcJumpId]   = useState<number | null>(null);
  const [questJumpId, setQuestJumpId] = useState<number | null>(null);

  // ── Path visibility state ────────────────────────────────────────────────────
  // hiddenCharIds: Set of party_member IDs whose individual paths are hidden
  // showPartyPath: whether the shared party path line is shown
  const [hiddenCharIds, setHiddenCharIds] = useState<Set<number>>(new Set());
  const [showPartyPath,  setShowPartyPath]  = useState(true);

  // ── Passcode state ──────────────────────────────────────────────────────────
  const [passcodeModal, setPasscodeModal] = useState<'enter' | 'set' | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState('');

  // ── Lightbox state ──────────────────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── Search state ────────────────────────────────────────────────────────────
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Campaign bootstrap ──────────────────────────────────────────────────────
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('campaign_slug') : null;

    api.campaigns.list()
      .then(async list => {
        // Normal path — campaigns exist on server
        if (list.length > 0) {
          if (saved && list.find((c: CampaignMeta) => c.slug === saved)) {
            const c = list.find((c: CampaignMeta) => c.slug === saved)!;
            handleSelectCampaign(c.slug, c.name);
          } else if (list.length === 1) {
            handleSelectCampaign(list[0].slug, list[0].name);
          } else {
            setShowCampaignSelector(true);
            setLoading(false);
          }
          return;
        }

        // ── Server has no campaigns (wiped on redeploy) ──────────────────────
        // Find all browser-cached backups and restore them automatically
        const backupKeys = typeof window !== 'undefined'
          ? Object.keys(localStorage).filter(k => k.startsWith('campaign_backup_'))
          : [];

        if (backupKeys.length === 0) {
          // Genuinely fresh install — show the create screen
          setShowCampaignSelector(true);
          setLoading(false);
          return;
        }

        // Sort so the last-used campaign is restored first
        const sorted = backupKeys.sort((a, b) => {
          if (a === `campaign_backup_${saved}`) return -1;
          if (b === `campaign_backup_${saved}`) return 1;
          return 0;
        });

        let firstSlug: string | null = null;
        let firstName: string | null = null;

        for (const key of sorted) {
          const oldSlug = key.replace('campaign_backup_', '');
          const backup  = _loadBrowserBackup(oldSlug);
          if (!backup) continue;

          const name = (backup.campaign_settings as any)?.world_name
            || oldSlug.replace(/-/g, ' ');

          // Recreate the campaign DB on the server
          const newCamp = await api.campaigns.create(name);
          // Point the API at this campaign before importing
          setCurrentCampaign(newCamp.slug);
          await api.data.import(backup as object);

          // Re-key the backup under the new slug (in case it changed)
          if (newCamp.slug !== oldSlug) {
            _saveBrowserBackup(newCamp.slug, backup);
            localStorage.removeItem(key);
          }

          if (!firstSlug) { firstSlug = newCamp.slug; firstName = newCamp.name; }
        }

        if (firstSlug && firstName) {
          handleSelectCampaign(firstSlug, firstName);
        } else {
          setShowCampaignSelector(true);
          setLoading(false);
        }
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectCampaign = useCallback((slug: string, name: string) => {
    setCurrentCampaign(slug);
    if (typeof window !== 'undefined') localStorage.setItem('campaign_slug', slug);
    setCampaignSlug(slug);
    setCampaignName(name);
    setShowCampaignSelector(false);
    // Reset all per-campaign UI state so nothing leaks across campaigns
    setSelectedId(null);
    setMapStack([]);
    setSubmapFogData('1'.repeat(10000));
    setNpcJumpId(null);
    setQuestJumpId(null);
    setIsAddingPin(false);
    setFogPaint(false);
  }, []);

  // ── Initial load (runs once campaign is selected) ────────────────────────────
  useEffect(() => {
    if (!campaignSlug) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.locations.list(),
      api.path.get(),
      api.map.config(),
      api.npcs.list(),
      api.quests.list(),
      api.sessions.list(),
      api.party.list(),
      api.factions.list(),
      api.campaign.get(),
      api.fog.get(),
      api.calendar.get(),
      api.characterPaths.listAll(),
    ])
      .then(async ([locs, path, cfg, npcList, questList, sessionList, partyList, factionList, campaignData, fogResult, calConfig, charPaths]) => {
        const fog = fogResult.data || '1'.repeat(10000);
        const isEmpty = locs.length === 0 && npcList.length === 0 && questList.length === 0;

        // ── Offer restore from browser backup if server data is gone ──────────
        if (isEmpty) {
          const cached = _loadBrowserBackup(campaignSlug);
          if (cached) {
            const savedAt = cached._saved_at ? new Date(cached._saved_at as string).toLocaleString() : 'unknown';
            const restore = typeof window !== 'undefined'
              && window.confirm(`Campaign data appears empty (server may have been redeployed).\n\nRestore from browser backup saved on ${savedAt}?`);
            if (restore) {
              await api.data.import(cached as object);
              // Re-fetch everything after restore
              const [rLocs, rPath, rCfg, rNpcs, rQuests, rSessions, rParty, rFactions, rCamp, rFog, rCal, rCharPaths] =
                await Promise.all([
                  api.locations.list(), api.path.get(), api.map.config(),
                  api.npcs.list(), api.quests.list(), api.sessions.list(),
                  api.party.list(), api.factions.list(), api.campaign.get(),
                  api.fog.get(), api.calendar.get(), api.characterPaths.listAll(),
                ]);
              setLocations(rLocs); setPlayerPath(rPath); setMapConfig(rCfg);
              setNpcs(rNpcs); setQuests(rQuests); setSessions(rSessions);
              setParty(rParty); setFactions(rFactions); setCampaign(rCamp);
              setFogData(rFog.data || '1'.repeat(10000));
              setCalendarConfig(rCal); setCharacterPaths(rCharPaths);
              return;
            }
          }
        }

        setLocations(locs);
        setPlayerPath(path);
        setMapConfig(cfg);
        setNpcs(npcList);
        setQuests(questList);
        setSessions(sessionList);
        setParty(partyList);
        setFactions(factionList);
        setCampaign(campaignData);
        setFogData(fog);
        setCalendarConfig(calConfig);
        setCharacterPaths(charPaths);

        // ── Save browser backup whenever we have real data ────────────────────
        if (!isEmpty) {
          const backup = _buildBrowserBackup({
            locations: locs, playerPath: path, npcs: npcList, quests: questList,
            sessions: sessionList, party: partyList, factions: factionList,
            characterPaths: charPaths, campaign: campaignData, calendarConfig: calConfig,
            fogData: fog,
          });
          _saveBrowserBackup(campaignSlug, backup);
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [campaignSlug]);

  // ── Search debounce ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      try { setSearchResults(await api.search(searchQuery)); }
      catch { /* ignore */ }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  // ── Player-mode visibility filtering ────────────────────────────────────────
  const visibleNpcs     = isDMMode ? npcs     : npcs.filter(n => n.is_visible !== false);
  const visibleQuests   = isDMMode ? quests   : quests.filter(q => q.is_visible !== false);
  const visibleFactions = isDMMode ? factions : factions.filter(f => f.is_visible !== false);
  const visibleSessions = isDMMode ? sessions : sessions.filter(s => s.is_visible !== false);

  // ── Derived state ───────────────────────────────────────────────────────────
  const currentMapId  = mapStack.length > 0 ? mapStack[mapStack.length - 1] : null;
  // Ref so async callbacks (WS refresh) can read the live value without going stale
  const currentMapIdRef = useRef(currentMapId);
  currentMapIdRef.current = currentMapId;
  const currentMapUrl = currentMapId != null
    ? (locations.find(l => l.id === currentMapId)?.submap_image_url ?? null)
    : mapConfig.image_url;
  const levelLocations = isDMMode
    ? locations.filter(l => (l.parent_id ?? null) === currentMapId)
    : locations.filter(l => (l.parent_id ?? null) === currentMapId && l.discovered);
  const selectedLocation = locations.find(l => l.id === selectedId) ?? null;

  // ── Map-scoped paths ─────────────────────────────────────────────────────────
  // Filter path entries so only entries whose location belongs to the current map
  // level are shown — prevents world-map paths bleeding into submaps and vice versa.
  const levelPlayerPath = playerPath.filter(e => {
    const loc = locations.find(l => l.id === e.location_id);
    return (loc?.parent_id ?? null) === currentMapId;
  });
  const levelCharPaths = characterPaths.filter(e => {
    const loc = locations.find(l => l.id === e.location_id);
    return (loc?.parent_id ?? null) === currentMapId;
  });

  // ── Location handlers ───────────────────────────────────────────────────────
  const handleAddPin = useCallback(async (x: number, y: number) => {
    setIsAddingPin(false);
    try {
      const newLoc = await api.locations.create({
        name: 'New Location', type: 'city', subtitle: '', description: '',
        quest_hooks: [], handouts: [], dm_notes: '', discovered: false, x, y,
        parent_id: currentMapId,
      });
      setLocations(prev => [...prev, newLoc]);
      setSelectedId(newLoc.id);
      setSidebarTab('location');
    } catch (e) { console.error(e); }
  }, [currentMapId]);

  const handleUpdateLocation = useCallback(async (id: number, data: Partial<Location>) => {
    const updated = await api.locations.update(id, data);
    setLocations(prev => prev.map(l => (l.id === id ? updated : l)));
  }, []);

  const handleDeleteLocation = useCallback(async (id: number) => {
    await api.locations.remove(id);
    setLocations(prev => prev.filter(l => l.id !== id));
    setPlayerPath(prev => prev.filter(e => e.location_id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const handleDuplicateLocation = useCallback(async (loc: Location) => {
    const newLoc = await api.locations.create({
      name: `${loc.name} (copy)`, type: loc.type, subtitle: loc.subtitle,
      description: loc.description, quest_hooks: loc.quest_hooks, handouts: loc.handouts,
      dm_notes: loc.dm_notes, discovered: false,
      x: Math.min(98, loc.x + 3), y: Math.min(98, loc.y + 3),
    });
    setLocations(prev => [...prev, newLoc]);
    setSelectedId(newLoc.id);
    setSidebarTab('location');
  }, []);

  // ── Path handlers ────────────────────────────────────────────────────────────
  const handleAddToPath           = useCallback(async (locationId: number) => { const e = await api.path.add(locationId); setPlayerPath(prev => [...prev, e]); }, []);
  const handleRemoveFromPath      = useCallback(async (entryId: number) => { await api.path.remove(entryId); setPlayerPath(prev => prev.filter(e => e.id !== entryId)); }, []);
  const handleReorderPath         = useCallback(async (order: number[]) => { setPlayerPath(await api.path.reorder(order)); }, []);
  const handleUpdatePathTravelType = useCallback(async (entryId: number, travelType: string) => {
    await api.path.updateEntry(entryId, { travel_type: travelType });
    setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, travel_type: travelType } : e));
  }, []);
  const handleUpdateCharPathTravelType = useCallback(async (entryId: number, travelType: string) => {
    await api.characterPaths.updateEntry(entryId, { travel_type: travelType });
    setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, travel_type: travelType } : e));
  }, []);
  const handleUpdatePathDistance = useCallback(async (entryId: number, distance: number | null, unit: string) => {
    await api.path.updateEntry(entryId, { distance, distance_unit: unit });
    setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, distance, distance_unit: unit } : e));
  }, []);
  const handleUpdateCharPathDistance = useCallback(async (entryId: number, distance: number | null, unit: string) => {
    await api.characterPaths.updateEntry(entryId, { distance, distance_unit: unit });
    setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, distance, distance_unit: unit } : e));
  }, []);

  // ── NPC handlers ─────────────────────────────────────────────────────────────
  const handleCreateNPC = useCallback(async (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>): Promise<NPC> => {
    const npc = await api.npcs.create(data); setNpcs(prev => [...prev, npc]); return npc;
  }, []);
  const handleUpdateNPC = useCallback(async (id: number, data: Partial<NPC>) => {
    const updated = await api.npcs.update(id, data); setNpcs(prev => prev.map(n => (n.id === id ? updated : n)));
  }, []);
  const handleDeleteNPC = useCallback(async (id: number) => {
    await api.npcs.remove(id); setNpcs(prev => prev.filter(n => n.id !== id));
  }, []);
  const handleUploadPortrait = useCallback(async (id: number, file: File) => {
    const { portrait_url } = await api.npcs.uploadPortrait(id, file);
    setNpcs(prev => prev.map(n => (n.id === id ? { ...n, portrait_url } : n)));
  }, []);
  const handleDeleteNpcPortrait = useCallback(async (id: number) => {
    await api.npcs.deletePortrait(id);
    setNpcs(prev => prev.map(n => (n.id === id ? { ...n, portrait_url: null } : n)));
  }, []);

  // ── Quest handlers ────────────────────────────────────────────────────────────
  const handleCreateQuest = useCallback(async (data: Omit<Quest, 'id' | 'created_at'>) => {
    const quest = await api.quests.create(data); setQuests(prev => [...prev, quest]);
  }, []);
  const handleUpdateQuest = useCallback(async (id: number, data: Partial<Quest>) => {
    const updated = await api.quests.update(id, data); setQuests(prev => prev.map(q => (q.id === id ? updated : q)));
  }, []);
  const handleDeleteQuest = useCallback(async (id: number) => {
    await api.quests.remove(id); setQuests(prev => prev.filter(q => q.id !== id));
  }, []);

  // ── Session handlers ──────────────────────────────────────────────────────────
  const handleCreateSession = useCallback(async (data: Omit<SessionEntry, 'id' | 'created_at'>) => {
    const session = await api.sessions.create(data); setSessions(prev => [...prev, session]);
  }, []);
  const handleUpdateSession = useCallback(async (id: number, data: Partial<SessionEntry>) => {
    const updated = await api.sessions.update(id, data); setSessions(prev => prev.map(s => (s.id === id ? updated : s)));
  }, []);
  const handleDeleteSession = useCallback(async (id: number) => {
    await api.sessions.remove(id); setSessions(prev => prev.filter(s => s.id !== id));
  }, []);

  // ── Party handlers ────────────────────────────────────────────────────────────
  const handleCreateParty = useCallback(async (data: Omit<PartyMember, 'id' | 'created_at'>): Promise<PartyMember> => {
    const member = await api.party.create(data); setParty(prev => [...prev, member]); return member;
  }, []);
  const handleUpdateParty = useCallback(async (id: number, data: Partial<PartyMember>) => {
    const updated = await api.party.update(id, data); setParty(prev => prev.map(m => (m.id === id ? updated : m)));
  }, []);
  const handleDeleteParty = useCallback(async (id: number) => {
    await api.party.remove(id); setParty(prev => prev.filter(m => m.id !== id));
  }, []);

  // ── Faction handlers ──────────────────────────────────────────────────────────
  const handleCreateFaction = useCallback(async (data: Omit<Faction, 'id' | 'created_at'>): Promise<Faction> => {
    const faction = await api.factions.create(data); setFactions(prev => [...prev, faction]); return faction;
  }, []);
  const handleUpdateFaction = useCallback(async (id: number, data: Partial<Faction>) => {
    const updated = await api.factions.update(id, data); setFactions(prev => prev.map(f => (f.id === id ? updated : f)));
  }, []);
  const handleDeleteFaction = useCallback(async (id: number) => {
    await api.factions.remove(id); setFactions(prev => prev.filter(f => f.id !== id));
  }, []);

  // ── Campaign handler ──────────────────────────────────────────────────────────
  const handleUpdateCampaign = useCallback(async (data: Partial<Omit<CampaignSettings, 'id'>>) => {
    const updated = await api.campaign.update(data); setCampaign(updated);
  }, []);

  // ── Phase-3 handlers ─────────────────────────────────────────────────────────
  const handleEnterSubmap = useCallback(async (id: number) => {
    // Fetch fog before updating mapStack so the first render already has
    // the correct fog data — prevents a flash of revealed content.
    let fog = '1'.repeat(10000);
    try {
      const result = await api.locations.getFog(id);
      fog = result.data || '1'.repeat(10000);
    } catch {}
    setSubmapFogData(fog);
    setMapStack(prev => [...prev, id]);
    setFogPaint(false);
    setFitTrigger(t => t + 1);
  }, []);
  const handleExitSubmap = useCallback(() => {
    setMapStack([]);
    setSubmapFogData('1'.repeat(10000));
    setFogPaint(false);
    setFitTrigger(t => t + 1);
  }, []);
  const handleUpdateCalendar = useCallback(async (data: Partial<Omit<CalendarConfig, 'id'>>) => {
    const updated = await api.calendar.update(data);
    setCalendarConfig(updated);
  }, []);

  // ── Character path handlers ───────────────────────────────────────────────────
  const handleAddToCharPath    = useCallback(async (memberId: number, locationId: number) => {
    const entry = await api.characterPaths.add(memberId, locationId);
    setCharacterPaths(prev => [...prev, entry]);
  }, []);
  const handleRemoveFromCharPath = useCallback(async (entryId: number) => {
    await api.characterPaths.remove(entryId);
    setCharacterPaths(prev => prev.filter(e => e.id !== entryId));
  }, []);
  const handleReorderCharPath  = useCallback(async (memberId: number, order: number[]) => {
    const updated = await api.characterPaths.reorder(memberId, order);
    setCharacterPaths(prev => [...prev.filter(e => e.party_member_id !== memberId), ...updated]);
  }, []);
  const handleClearCharPath    = useCallback(async (memberId: number) => {
    await api.characterPaths.clear(memberId);
    setCharacterPaths(prev => prev.filter(e => e.party_member_id !== memberId));
  }, []);

  // ── Path visibility handlers ─────────────────────────────────────────────────
  const handleToggleCharPath = useCallback((memberId: number) => {
    setHiddenCharIds(prev => {
      const next = new Set(prev);
      next.has(memberId) ? next.delete(memberId) : next.add(memberId);
      return next;
    });
  }, []);
  const handleTogglePartyPath = useCallback(() => setShowPartyPath(p => !p), []);

  // ── NPC ↔ Quest link handlers ─────────────────────────────────────────────────
  const handleLinkNpc = useCallback(async (questId: number, npcId: number) => {
    const [updatedQuests, updatedNpcs] = await Promise.all([
      api.quests.linkNpc(questId, npcId).then(() => api.quests.list()),
      api.npcs.list(),
    ]);
    setQuests(updatedQuests);
    setNpcs(updatedNpcs);
  }, []);
  const handleUnlinkNpc = useCallback(async (questId: number, npcId: number) => {
    const [updatedQuests, updatedNpcs] = await Promise.all([
      api.quests.unlinkNpc(questId, npcId).then(() => api.quests.list()),
      api.npcs.list(),
    ]);
    setQuests(updatedQuests);
    setNpcs(updatedNpcs);
  }, []);

  // ── Cross-navigation ──────────────────────────────────────────────────────────
  const handleNavigateToNpc = useCallback((id: number) => {
    setSidebarTab('npcs');
    setNpcJumpId(id);
  }, []);
  const handleNavigateToQuest = useCallback((id: number) => {
    setSidebarTab('quests');
    setQuestJumpId(id);
  }, []);

  // ── WebSocket (player mode) ───────────────────────────────────────────────────
  const handleWSRefresh = useCallback(async () => {
    const fetches: Promise<unknown>[] = [
      api.locations.list(), api.path.get(), api.fog.get(),
      api.party.list(), api.factions.list(), api.campaign.get(), api.calendar.get(),
      api.characterPaths.listAll(), api.npcs.list(), api.quests.list(),
    ];
    const activeSubmap = currentMapIdRef.current;
    if (activeSubmap != null) fetches.push(api.locations.getFog(activeSubmap));

    const [locs, path, fogResult, partyData, factionData, campaignData, calConfig, charPaths, updatedNpcs, updatedQuests, submapFog] =
      await Promise.all(fetches) as [Location[], PathEntry[], {data:string}, PartyMember[], Faction[], CampaignSettings, CalendarConfig, CharacterPathEntry[], NPC[], Quest[], {data:string}|undefined];

    setLocations(locs);
    setPlayerPath(path);
    setFogData((fogResult as {data:string}).data || '1'.repeat(10000));
    if (activeSubmap != null && submapFog) setSubmapFogData(submapFog.data || '1'.repeat(10000));
    setParty(partyData);
    setFactions(factionData);
    setCampaign(campaignData);
    setCalendarConfig(calConfig);
    setCharacterPaths(charPaths);
    setNpcs(updatedNpcs);
    setQuests(updatedQuests);
  }, []);
  useWebSocket(handleWSRefresh, !isDMMode);

  // ── Fog handler ───────────────────────────────────────────────────────────────
  const handleFogChange = useCallback(async (data: string) => {
    if (currentMapId != null) {
      setSubmapFogData(data);
      try { await api.locations.updateFog(currentMapId, data); } catch (e) { console.error('Submap fog save failed:', e); }
    } else {
      setFogData(data);
      try { await api.fog.update(data); } catch (e) { console.error('Fog save failed:', e); }
    }
  }, [currentMapId]);

  // ── Map upload ───────────────────────────────────────────────────────────────
  const handleMapUpload = useCallback(async (file: File) => {
    if (mapStack.length > 0) {
      // Uploading while inside a submap — update the submap image for that location
      const locId = mapStack[mapStack.length - 1];
      const { submap_image_url } = await api.locations.uploadSubmap(locId, file);
      setLocations(prev => prev.map(l => l.id === locId ? { ...l, submap_image_url } : l));
    } else {
      setMapConfig(await api.map.upload(file));
    }
  }, [mapStack]);

  // ── Export / Import ───────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const data = await api.data.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const slug = (data as any)?.campaign_settings?.world_name || campaignName || 'campaign';
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${slug.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [campaignName]);

  const handleImport = useCallback(async (file: File) => {
    if (!confirm(`Import "${file.name}"? This will overwrite ALL data in the current campaign.`)) return;
    try {
      await api.data.import(file);
      // Reload everything
      const [locs, path, npcList, questList, sessionList, partyList, factionList, campData, calCfg, charPaths, fogResult, mapCfg] =
        await Promise.all([
          api.locations.list(), api.path.get(), api.npcs.list(), api.quests.list(),
          api.sessions.list(), api.party.list(), api.factions.list(),
          api.campaign.get(), api.calendar.get(), api.characterPaths.listAll(),
          api.fog.get(), api.map.config(),
        ]);
      setLocations(locs);
      setPlayerPath(path);
      setNpcs(npcList);
      setQuests(questList);
      setSessions(sessionList);
      setParty(partyList);
      setFactions(factionList);
      setCampaign(campData);
      setCalendarConfig(calCfg);
      setCharacterPaths(charPaths);
      setFogData(fogResult.data ?? '');
      setMapConfig(mapCfg);
      setSelectedId(null);
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // ── DM Passcode ──────────────────────────────────────────────────────────────
  const handleDMModeClick = useCallback(() => {
    if (isDMMode) return;
    const stored = typeof window !== 'undefined' ? localStorage.getItem('dm_passcode') : null;
    if (stored) { setPasscodeInput(''); setPasscodeError(''); setPasscodeModal('enter'); }
    else { setIsDMMode(true); }
  }, [isDMMode]);

  const handlePasscodeSubmit = useCallback(() => {
    if (passcodeModal === 'enter') {
      if (passcodeInput === (localStorage.getItem('dm_passcode') ?? '')) { setIsDMMode(true); setPasscodeModal(null); }
      else { setPasscodeError('Incorrect passcode'); }
    } else if (passcodeModal === 'set') {
      if (passcodeInput.trim()) localStorage.setItem('dm_passcode', passcodeInput);
      else localStorage.removeItem('dm_passcode');
      setPasscodeModal(null);
    }
  }, [passcodeModal, passcodeInput]);

  // ── Loading / error ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#07070d', color: '#c9a84c', fontSize: 17, gap: 10 }}>
        <span>⚔</span> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#07070d', color: '#e07070', gap: 12, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 32 }}>⚠</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Cannot connect to backend</div>
        <div style={{ color: '#888', fontSize: 13, maxWidth: 380 }}>Make sure the FastAPI server is running on <code style={{ color: '#c9a84c' }}>http://localhost:8000</code></div>
        <code style={{ color: '#666', fontSize: 12 }}>{error}</code>
        <button className="btn" onClick={() => window.location.reload()} style={{ marginTop: 8 }}>Retry</button>
      </div>
    );
  }

  if (showCampaignSelector || !campaignSlug) {
    return (
      <>
        <Head><title>D&amp;D World Map</title></Head>
        <CampaignSelector
          currentSlug={campaignSlug}
          onSelect={handleSelectCampaign}
          onRename={(slug, name) => { if (slug === campaignSlug) setCampaignName(name); }}
        />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>D&amp;D World Map</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="app">
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header className="header">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚔</span>
            <span>{campaignName || 'World Map'}</span>
            <button
              className="btn btn-sm btn-ghost"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => setShowCampaignSelector(true)}
              title="Switch campaign"
            >⇄</button>
          </div>

          <div className="mode-toggle">
            <button className={`mode-btn ${isDMMode ? 'active' : ''}`} onClick={handleDMModeClick}>DM Mode</button>
            <button className={`mode-btn ${!isDMMode ? 'active' : ''}`} onClick={() => { setIsDMMode(false); setIsAddingPin(false); setFogPaint(false); }}>Player View</button>
          </div>

          {isDMMode && (
            <>
              <button className="btn btn-sm btn-icon" title="Set / change DM passcode" onClick={() => { setPasscodeInput(''); setPasscodeError(''); setPasscodeModal('set'); }}>🔒</button>

              {/* Fog toolbar — world map and submaps */}
              <div className="fog-toolbar">
                <button
                  className={`btn btn-sm ${fogPaint ? 'btn-active' : ''}`}
                  onClick={() => setFogPaint(p => !p)}
                  title="Toggle fog of war painting tool"
                >
                  {fogPaint ? '✕ Fog Off' : '☁ Fog'}
                </button>
                {fogPaint && (
                  <>
                    <button className={`btn btn-sm ${fogBrush === 'reveal' ? 'btn-active' : ''}`} onClick={() => setFogBrush('reveal')}>Reveal</button>
                    <button className={`btn btn-sm ${fogBrush === 'hide' ? 'btn-active' : ''}`} onClick={() => setFogBrush('hide')}>Hide</button>
                    <select
                      value={fogSize}
                      onChange={e => setFogSize(Number(e.target.value))}
                      style={{ width: 'auto', padding: '4px 8px' }}
                      title="Brush size"
                    >
                      <option value={1}>Brush S</option>
                      <option value={2}>Brush M</option>
                      <option value={3}>Brush L</option>
                      <option value={5}>Brush XL</option>
                    </select>
                    <button className="btn btn-sm" onClick={async () => {
                      if (currentMapId != null) { await api.locations.revealFog(currentMapId); setSubmapFogData('1'.repeat(10000)); }
                      else { await api.fog.revealAll(); setFogData('1'.repeat(10000)); }
                    }} title="Reveal entire map">Reveal All</button>
                    <button className="btn btn-sm" onClick={async () => {
                      if (currentMapId != null) { await api.locations.hideFog(currentMapId); setSubmapFogData('0'.repeat(10000)); }
                      else { await api.fog.hideAll(); setFogData('0'.repeat(10000)); }
                    }} title="Hide entire map">Hide All</button>
                  </>
                )}
              </div>

              <button className={`btn ${isAddingPin ? 'btn-active' : ''}`} onClick={() => setIsAddingPin(p => !p)}>
                {isAddingPin ? '✕ Cancel Placing' : '+ Add Location'}
              </button>
              <button
                className={`btn btn-sm ${showPinLabels ? 'btn-active' : ''}`}
                title="Toggle pin labels"
                onClick={() => setShowPinLabels(v => { const next = !v; localStorage.setItem('show_pin_labels', next ? '1' : '0'); return next; })}
              >🏷 Labels</button>
              <button
                className={`btn btn-sm ${showDistLabels ? 'btn-active' : ''}`}
                title="Toggle distance labels on paths"
                onClick={() => setShowDistLabels(v => { const next = !v; localStorage.setItem('show_dist_labels', next ? '1' : '0'); return next; })}
              >📏 Distance</button>
              <label className="btn" style={{ cursor: 'pointer' }}>
                {mapStack.length > 0 ? 'Upload Submap' : 'Upload Map'}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleMapUpload(f); e.target.value = ''; }} />
              </label>
              <button className="btn" onClick={handleExport} title="Export JSON backup">Export</button>
              <label className="btn" style={{ cursor: 'pointer' }} title="Import JSON backup">
                Import
                <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await handleImport(f); }} />
              </label>
            </>
          )}

          {/* Fit-to-pins / search */}
          <button className="btn btn-sm btn-icon" title="Fit map to all pins" onClick={() => setFitTrigger(t => t + 1)}>⊞</button>
          <button className="btn btn-icon" title="Search" onClick={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults(null); }}>🔍</button>
        </header>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        <div className="main">
          <MapView
            locations={levelLocations} allLocations={locations}
            selectedId={selectedId}
            playerPath={levelPlayerPath} quests={visibleQuests} isAddingPin={isAddingPin && isDMMode}
            mapImageUrl={currentMapUrl} isDMMode={isDMMode}
            fogData={currentMapId != null ? submapFogData : fogData}
            fogPaintMode={fogPaint}
            fogBrushMode={fogBrush}
            fogBrushSize={fogSize}
            mapStack={mapStack}
            characterPaths={levelCharPaths}
            party={party}
            hiddenCharIds={hiddenCharIds}
            showPartyPath={showPartyPath}
            showLabels={showPinLabels}
            showDistLabels={showDistLabels}
            fitTrigger={fitTrigger}
            onSelectLocation={id => { setSelectedId(id); setSidebarTab('location'); }}
            onDeselect={() => setSelectedId(null)}
            onAddPin={handleAddPin}
            onFogChange={handleFogChange}
            onExitSubmap={handleExitSubmap}
            onUpdateLocation={handleUpdateLocation}
          />
          <Sidebar
            location={selectedLocation} isDMMode={isDMMode}
            playerPath={levelPlayerPath} locations={locations}
            npcs={visibleNpcs} quests={visibleQuests} sessions={visibleSessions}
            party={party} factions={visibleFactions} campaign={campaign}
            calendarConfig={calendarConfig}
            characterPaths={levelCharPaths}
            activeTab={sidebarTab} selectedLocationId={selectedId}
            onTabChange={setSidebarTab}
            onUpdate={handleUpdateLocation} onDelete={handleDeleteLocation} onDuplicateLocation={handleDuplicateLocation}
            onAddToPath={handleAddToPath} onRemoveFromPath={handleRemoveFromPath} onReorderPath={handleReorderPath}
            onSelectLocation={id => { setSelectedId(id); setSidebarTab('location'); }}
            onCreateNPC={handleCreateNPC} onUpdateNPC={handleUpdateNPC} onDeleteNPC={handleDeleteNPC}
            onUploadPortrait={handleUploadPortrait} onDeleteNpcPortrait={handleDeleteNpcPortrait}
            onCreateQuest={handleCreateQuest} onUpdateQuest={handleUpdateQuest} onDeleteQuest={handleDeleteQuest}
            onCreateSession={handleCreateSession} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession}
            onCreateParty={handleCreateParty} onUpdateParty={handleUpdateParty} onDeleteParty={handleDeleteParty}
            onCreateFaction={handleCreateFaction} onUpdateFaction={handleUpdateFaction} onDeleteFaction={handleDeleteFaction}
            onUpdateCampaign={handleUpdateCampaign}
            onUpdateCalendar={handleUpdateCalendar}
            onEnterSubmap={handleEnterSubmap}
            isInsideSubmap={mapStack.length > 0}
            onLightbox={setLightboxUrl}
            onAddToCharPath={handleAddToCharPath}
            onRemoveFromCharPath={handleRemoveFromCharPath}
            onReorderCharPath={handleReorderCharPath}
            onClearCharPath={handleClearCharPath}
            onLinkNpc={handleLinkNpc}
            onUnlinkNpc={handleUnlinkNpc}
            onNavigateToNpc={handleNavigateToNpc}
            onNavigateToQuest={handleNavigateToQuest}
            npcJumpId={npcJumpId}
            questJumpId={questJumpId}
            hiddenCharIds={hiddenCharIds}
            showPartyPath={showPartyPath}
            onToggleCharPath={handleToggleCharPath}
            onTogglePartyPath={handleTogglePartyPath}
            onUpdatePathTravelType={handleUpdatePathTravelType}
            onUpdateCharPathTravelType={handleUpdateCharPathTravelType}
            onUpdatePathDistance={handleUpdatePathDistance}
            onUpdateCharPathDistance={handleUpdateCharPathDistance}
          />
        </div>
      </div>

      {/* ── Lightbox ─────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Handout" className="lightbox-img" onClick={e => e.stopPropagation()} />
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
        </div>
      )}

      {/* ── Search modal ─────────────────────────────────────────────── */}
      {searchOpen && (
        <div className="modal-overlay" onClick={() => setSearchOpen(false)}>
          <div className="modal-box search-modal" onClick={e => e.stopPropagation()}>
            <input
              className="search-input"
              type="text"
              placeholder="Search locations, NPCs, quests…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setSearchOpen(false); }}
              autoFocus
            />
            {searchResults && (
              <div className="search-results">
                {searchResults.locations.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label">Locations</div>
                    {searchResults.locations.map(l => (
                      <button key={l.id} className="search-result" onClick={() => { setSelectedId(l.id); setSidebarTab('location'); setSearchOpen(false); }}>
                        <span className="search-result-name">{l.name}</span>
                        <span className="search-result-type">{l.type}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.npcs.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label">NPCs</div>
                    {searchResults.npcs.map(n => (
                      <button key={n.id} className="search-result" onClick={() => { setSidebarTab('npcs'); setSearchOpen(false); }}>
                        <span className="search-result-name">{n.name}</span>
                        <span className="search-result-type">{n.role || n.status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.quests.length > 0 && (
                  <div className="search-group">
                    <div className="search-group-label">Quests</div>
                    {searchResults.quests.map(q => (
                      <button key={q.id} className="search-result" onClick={() => { setSidebarTab('quests'); setSearchOpen(false); }}>
                        <span className="search-result-name">{q.title}</span>
                        <span className="search-result-type">{q.status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.locations.length === 0 && searchResults.npcs.length === 0 && searchResults.quests.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No results for "{searchQuery}"</div>
                )}
              </div>
            )}
            {!searchResults && searchQuery.trim() && (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Searching…</div>
            )}
            {!searchQuery.trim() && (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>Type to search across all locations, NPCs, and quests</div>
            )}
          </div>
        </div>
      )}

      {/* ── Passcode modal ───────────────────────────────────────────── */}
      {passcodeModal && (
        <div className="modal-overlay" onClick={() => setPasscodeModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginBottom: 12 }}>
              {passcodeModal === 'enter' ? '🔒 Enter DM Passcode' : '🔒 Set DM Passcode'}
            </div>
            {passcodeModal === 'set' && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
                Protects DM Mode with a passcode. Leave blank to remove the passcode.
              </div>
            )}
            <input
              type="password"
              value={passcodeInput}
              onChange={e => { setPasscodeInput(e.target.value); setPasscodeError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handlePasscodeSubmit(); if (e.key === 'Escape') setPasscodeModal(null); }}
              placeholder={passcodeModal === 'enter' ? 'Passcode' : 'New passcode (blank to remove)'}
              autoFocus
            />
            {passcodeError && <div style={{ fontSize: 12, color: 'var(--danger-text)', marginTop: 6 }}>{passcodeError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-sm" onClick={() => setPasscodeModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handlePasscodeSubmit}>{passcodeModal === 'enter' ? 'Unlock' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
