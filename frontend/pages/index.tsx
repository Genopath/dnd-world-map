import Head from 'next/head';
import { useCallback, useEffect, useRef, useState } from 'react';
import CampaignSelector from '../components/CampaignSelector';
import LoginScreen, { passcodeKey } from '../components/LoginScreen';
import MapView from '../components/MapView';
import Sidebar from '../components/Sidebar';
import { useWebSocket } from '../hooks/useWebSocket';
import { api, API_BASE, setCurrentCampaign } from '../lib/api';
import {
  isSoundMuted, setSoundMuted, preloadFairyFountain,
  playPinSelect, playPinPlace, playPinDelete,
  playTabSwitch, playQuestComplete, playDMUnlock, playDMLock,
  playRulerTick, playPathAdd, playSearchOpen, playFogReveal,
  playCampaignSwitch, playChime,
} from '../lib/sounds';
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

// ── IndexedDB backup helpers ──────────────────────────────────────────────────
// Stores the FULL server export (including base64 image blobs) so maps, submap
// images, and fog data survive Railway redeployments automatically.
// IndexedDB has no meaningful size limit (~GB), unlike localStorage (~5 MB).

const _IDB_NAME = 'dnd-campaign-backups';
const _IDB_STORE = 'exports';

function _idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(_IDB_STORE))
        req.result.createObjectStore(_IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _idbSave(key: string, value: unknown): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  try {
    const db = await _idbOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readwrite');
      tx.objectStore(_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch { /* best-effort — silently ignore */ }
}

async function _idbLoad(key: string): Promise<{ _saved_at?: string; [k: string]: unknown } | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return null;
  try {
    const db = await _idbOpen();
    return await new Promise((resolve) => {
      const tx  = db.transaction(_IDB_STORE, 'readonly');
      const req = tx.objectStore(_IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as { _saved_at?: string; [k: string]: unknown }) ?? null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

// Calls /export and saves the result (images and all) to IndexedDB.
// Throttled to once per browser session per campaign; pass force=true to
// bypass the throttle (e.g. right after a map is uploaded).
function _idbBackupAsync(slug: string, force = false): void {
  if (typeof window === 'undefined') return;
  const key = `idb_saved_${slug}`;
  if (!force && sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  api.data.export()
    .then(data => _idbSave(`export_${slug}`, { ...(data as object), _saved_at: new Date().toISOString() }))
    .catch(() => { /* best-effort */ });
}

export default function Home() {
  // ── Campaign selection ──────────────────────────────────────────────────────
  const [campaignSlug,         setCampaignSlug]         = useState<string | null>(null);
  const _idbBackupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [campaignName,         setCampaignName]         = useState<string>('');
  const [showCampaignSelector, setShowCampaignSelector] = useState(false);
  const [showLoginScreen,      setShowLoginScreen]      = useState(false);
  const [mobileSidebarOpen,    setMobileSidebarOpen]    = useState(false);

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
  const [showTimeLabels,  setShowTimeLabels]  = useState(() => typeof window !== 'undefined' ? localStorage.getItem('show_time_labels') !== '0' : true);
  const [showScaleBar,    setShowScaleBar]    = useState(() => typeof window !== 'undefined' ? localStorage.getItem('show_scale_bar') !== '0' : true);
  const [rulerMode,       setRulerMode]       = useState(false);
  const [soundMuted,      setSoundMutedState] = useState(() => isSoundMuted());
  const [showGrid,        setShowGrid]        = useState(() => typeof window !== 'undefined' ? localStorage.getItem('show_grid') === '1' : false);
  const [gridCellSize,    setGridCellSize]    = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = localStorage.getItem('grid_cell_size');
    return v ? parseFloat(v) : null;
  });
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
  const [hiddenSegmentIds, setHiddenSegmentIds] = useState<Set<number>>(new Set());

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
  useEffect(() => { preloadFairyFountain(); }, []);

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
          // Prefer IndexedDB backup (has images) over localStorage (no images)
          const idbBackup = await _idbLoad(`export_${oldSlug}`);
          const backup    = idbBackup ?? _loadBrowserBackup(oldSlug);
          if (!backup) continue;

          const name = (backup.campaign_settings as any)?.world_name
            || oldSlug.replace(/-/g, ' ');

          // Recreate the campaign DB on the server
          const newCamp = await api.campaigns.create(name);
          // Point the API at this campaign before importing
          setCurrentCampaign(newCamp.slug);
          await api.data.import(new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' }));

          // Re-key backups under the new slug (in case it changed)
          if (newCamp.slug !== oldSlug) {
            _saveBrowserBackup(newCamp.slug, backup);
            localStorage.removeItem(key);
            if (idbBackup) {
              await _idbSave(`export_${newCamp.slug}`, { ...idbBackup, _saved_at: idbBackup._saved_at });
            }
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
    playCampaignSwitch();
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
    setIsDMMode(false); // always start as player until login confirms DM
    setShowLoginScreen(true);
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
          // IndexedDB backup includes images (maps, submaps, fog); localStorage does not
          const idbCached = await _idbLoad(`export_${campaignSlug}`);
          const cached    = idbCached ?? _loadBrowserBackup(campaignSlug);
          if (cached) {
            const savedAt  = cached._saved_at ? new Date(cached._saved_at as string).toLocaleString() : 'unknown';
            const hasImages = !!idbCached;
            const restore = typeof window !== 'undefined'
              && window.confirm(`Campaign data appears empty (server may have been redeployed).\n\nRestore from ${hasImages ? 'full backup (includes maps & images)' : 'text backup (no images)'} saved on ${savedAt}?`);
            if (restore) {
              await api.data.import(new File([JSON.stringify(cached)], 'backup.json', { type: 'application/json' }));
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
          // localStorage: fast metadata backup (no images)
          const backup = _buildBrowserBackup({
            locations: locs, playerPath: path, npcs: npcList, quests: questList,
            sessions: sessionList, party: partyList, factions: factionList,
            characterPaths: charPaths, campaign: campaignData, calendarConfig: calConfig,
            fogData: fog,
          });
          _saveBrowserBackup(campaignSlug, backup);
          // IndexedDB: full backup with all images — once per session in background
          _idbBackupAsync(campaignSlug);
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
  const currentMapId    = mapStack.length > 0 ? mapStack[mapStack.length - 1] : null;
  const currentMapScale = (() => {
    if (currentMapId != null) {
      const loc = locations.find(l => l.id === currentMapId);
      return (loc?.scale_value != null && loc.scale_unit)
        ? { value: loc.scale_value, unit: loc.scale_unit } : null;
    }
    return (mapConfig.scale_value != null && mapConfig.scale_unit)
      ? { value: mapConfig.scale_value, unit: mapConfig.scale_unit } : null;
  })();
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

  // Debounced IDB backup — waits 3 s after the last change then fires a full export.
  const scheduleIdbBackup = useCallback(() => {
    if (!campaignSlug) return;
    if (_idbBackupTimerRef.current) clearTimeout(_idbBackupTimerRef.current);
    _idbBackupTimerRef.current = setTimeout(() => {
      _idbBackupAsync(campaignSlug, true);
    }, 3000);
  }, [campaignSlug]);

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
      scheduleIdbBackup();
      playPinPlace();
    } catch (e) { console.error(e); }
  }, [currentMapId, scheduleIdbBackup]);

  const handleUpdateLocation = useCallback(async (id: number, data: Partial<Location>) => {
    const updated = await api.locations.update(id, data);
    setLocations(prev => prev.map(l => (l.id === id ? updated : l)));
    scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  const handleDeleteLocation = useCallback(async (id: number) => {
    await api.locations.remove(id);
    setLocations(prev => prev.filter(l => l.id !== id));
    setPlayerPath(prev => prev.filter(e => e.location_id !== id));
    if (selectedId === id) setSelectedId(null);
    scheduleIdbBackup();
    playPinDelete();
  }, [selectedId, scheduleIdbBackup]);

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
    scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Path handlers ────────────────────────────────────────────────────────────
  const handleAddToPath           = useCallback(async (locationId: number) => { const e = await api.path.add(locationId); setPlayerPath(prev => [...prev, e]); playPathAdd(); }, []);
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
  const handleToggleSegment = useCallback((entryId: number) => {
    setHiddenSegmentIds(prev => {
      const next = new Set(prev);
      next.has(entryId) ? next.delete(entryId) : next.add(entryId);
      return next;
    });
  }, []);

  const handleUpdatePathTravelTime = useCallback(async (entryId: number, travel_time: number | null, unit: string) => {
    await api.path.updateEntry(entryId, { travel_time, travel_time_unit: unit });
    setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, travel_time, travel_time_unit: unit } : e));
  }, []);
  const handleUpdateCharPathTravelTime = useCallback(async (entryId: number, travel_time: number | null, unit: string) => {
    await api.characterPaths.updateEntry(entryId, { travel_time, travel_time_unit: unit });
    setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, travel_time, travel_time_unit: unit } : e));
  }, []);
  const handleUpdatePathDirection = useCallback(async (entryId: number, direction: string) => {
    await api.path.updateEntry(entryId, { direction });
    setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, direction: direction as 'forward' | 'backward' | 'both' } : e));
  }, []);
  const handleUpdateCharPathDirection = useCallback(async (entryId: number, direction: string) => {
    await api.characterPaths.updateEntry(entryId, { direction });
    setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, direction: direction as 'forward' | 'backward' | 'both' } : e));
  }, []);

  // ── Waypoint drawing ─────────────────────────────────────────────────────────
  const [waypointMode, setWaypointMode] = useState<{ entryId: number; isChar: boolean } | null>(null);

  const handleStartWaypointDraw = useCallback((entryId: number, isChar: boolean) => {
    setWaypointMode({ entryId, isChar });
  }, []);

  const handleSaveWaypoints = useCallback((entryId: number, pts: [number, number][], isChar: boolean) => {
    const waypointsJson = pts.length >= 2 ? JSON.stringify(pts) : null;
    if (isChar) {
      api.characterPaths.updateEntry(entryId, { waypoints: waypointsJson });
      setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, waypoints: waypointsJson } : e));
    } else {
      api.path.updateEntry(entryId, { waypoints: waypointsJson });
      setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, waypoints: waypointsJson } : e));
    }
    setWaypointMode(null);
  }, []);

  const handleCancelWaypoints = useCallback(() => setWaypointMode(null), []);

  const handleClearWaypoints = useCallback(async (entryId: number, isChar: boolean) => {
    if (isChar) {
      await api.characterPaths.updateEntry(entryId, { waypoints: null });
      setCharacterPaths(prev => prev.map(e => e.id === entryId ? { ...e, waypoints: null } : e));
    } else {
      await api.path.updateEntry(entryId, { waypoints: null });
      setPlayerPath(prev => prev.map(e => e.id === entryId ? { ...e, waypoints: null } : e));
    }
  }, []);

  // ── NPC handlers ─────────────────────────────────────────────────────────────
  const handleCreateNPC = useCallback(async (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>): Promise<NPC> => {
    const npc = await api.npcs.create(data); setNpcs(prev => [...prev, npc]); scheduleIdbBackup(); return npc;
  }, [scheduleIdbBackup]);
  const handleUpdateNPC = useCallback(async (id: number, data: Partial<NPC>) => {
    const updated = await api.npcs.update(id, data); setNpcs(prev => prev.map(n => (n.id === id ? updated : n))); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleDeleteNPC = useCallback(async (id: number) => {
    await api.npcs.remove(id); setNpcs(prev => prev.filter(n => n.id !== id)); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleUploadPortrait = useCallback(async (id: number, file: File) => {
    const { portrait_url } = await api.npcs.uploadPortrait(id, file);
    setNpcs(prev => prev.map(n => (n.id === id ? { ...n, portrait_url } : n)));
    scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleDeleteNpcPortrait = useCallback(async (id: number) => {
    await api.npcs.deletePortrait(id);
    setNpcs(prev => prev.map(n => (n.id === id ? { ...n, portrait_url: null } : n)));
    scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Quest handlers ────────────────────────────────────────────────────────────
  const handleCreateQuest = useCallback(async (data: Omit<Quest, 'id' | 'created_at'>) => {
    const quest = await api.quests.create(data); setQuests(prev => [...prev, quest]); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleUpdateQuest = useCallback(async (id: number, data: Partial<Quest>) => {
    const updated = await api.quests.update(id, data);
    setQuests(prev => prev.map(q => (q.id === id ? updated : q)));
    scheduleIdbBackup();
    if (data.status === 'completed') playQuestComplete();
  }, [scheduleIdbBackup]);
  const handleDeleteQuest = useCallback(async (id: number) => {
    await api.quests.remove(id); setQuests(prev => prev.filter(q => q.id !== id)); scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Session handlers ──────────────────────────────────────────────────────────
  const handleCreateSession = useCallback(async (data: Omit<SessionEntry, 'id' | 'created_at'>) => {
    const session = await api.sessions.create(data); setSessions(prev => [...prev, session]); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleUpdateSession = useCallback(async (id: number, data: Partial<SessionEntry>) => {
    const updated = await api.sessions.update(id, data); setSessions(prev => prev.map(s => (s.id === id ? updated : s))); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleDeleteSession = useCallback(async (id: number) => {
    await api.sessions.remove(id); setSessions(prev => prev.filter(s => s.id !== id)); scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Party handlers ────────────────────────────────────────────────────────────
  const handleCreateParty = useCallback(async (data: Omit<PartyMember, 'id' | 'created_at'>): Promise<PartyMember> => {
    const member = await api.party.create(data); setParty(prev => [...prev, member]); scheduleIdbBackup(); return member;
  }, [scheduleIdbBackup]);
  const handleUpdateParty = useCallback(async (id: number, data: Partial<PartyMember>) => {
    const updated = await api.party.update(id, data); setParty(prev => prev.map(m => (m.id === id ? updated : m))); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleDeleteParty = useCallback(async (id: number) => {
    await api.party.remove(id); setParty(prev => prev.filter(m => m.id !== id)); scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Faction handlers ──────────────────────────────────────────────────────────
  const handleCreateFaction = useCallback(async (data: Omit<Faction, 'id' | 'created_at'>): Promise<Faction> => {
    const faction = await api.factions.create(data); setFactions(prev => [...prev, faction]); scheduleIdbBackup(); return faction;
  }, [scheduleIdbBackup]);
  const handleUpdateFaction = useCallback(async (id: number, data: Partial<Faction>) => {
    const updated = await api.factions.update(id, data); setFactions(prev => prev.map(f => (f.id === id ? updated : f))); scheduleIdbBackup();
  }, [scheduleIdbBackup]);
  const handleDeleteFaction = useCallback(async (id: number) => {
    await api.factions.remove(id); setFactions(prev => prev.filter(f => f.id !== id)); scheduleIdbBackup();
  }, [scheduleIdbBackup]);

  // ── Campaign handler ──────────────────────────────────────────────────────────
  const handleUpdateCampaign = useCallback(async (data: Partial<Omit<CampaignSettings, 'id'>>) => {
    const updated = await api.campaign.update(data); setCampaign(updated); scheduleIdbBackup();
  }, [scheduleIdbBackup]);

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
    scheduleIdbBackup();
  }, [scheduleIdbBackup]);

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

  // ── Keyboard shortcuts + copy/paste ──────────────────────────────────────────
  const [copiedLocation, setCopiedLocation] = useState<Location | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable) return;
      if (!isDMMode) return;

      // Escape — deselect / cancel add-pin
      if (e.key === 'Escape') {
        setSelectedId(null);
        setIsAddingPin(false);
        return;
      }
      // Delete / Backspace — delete selected pin
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const loc = locations.find(l => l.id === selectedId);
        if (loc && confirm(`Delete "${loc.name}"?`)) handleDeleteLocation(selectedId);
        return;
      }
      // Ctrl+D — duplicate selected
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        const loc = locations.find(l => l.id === selectedId);
        if (loc) handleDuplicateLocation(loc);
        return;
      }
      // Ctrl+C — copy selected
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedId) {
        const loc = locations.find(l => l.id === selectedId);
        if (loc) setCopiedLocation(loc);
        return;
      }
      // Ctrl+V — paste copied pin
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedLocation) {
        e.preventDefault();
        handleDuplicateLocation(copiedLocation);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDMMode, selectedId, locations, copiedLocation, handleDeleteLocation, handleDuplicateLocation]);

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
    // Trigger a fresh IndexedDB backup now that a map image changed.
    scheduleIdbBackup();
  }, [mapStack, campaignSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetMapScale = useCallback(async (value: number, unit: string) => {
    if (currentMapId != null) {
      // Submap — scale stored on the location record
      await api.locations.update(currentMapId, { scale_value: value, scale_unit: unit });
      setLocations(prev => prev.map(l => l.id === currentMapId ? { ...l, scale_value: value, scale_unit: unit } : l));
    } else {
      // World map — scale stored in map config
      const updated = await api.map.updateScale({ scale_value: value, scale_unit: unit });
      setMapConfig(prev => ({ ...prev, scale_value: updated.scale_value, scale_unit: updated.scale_unit }));
    }
  }, [currentMapId]);

  // ── Export / Import ───────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    playChime();
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
    const key    = campaignSlug ? passcodeKey(campaignSlug) : 'dm_passcode';
    const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    if (stored) { setPasscodeInput(''); setPasscodeError(''); setPasscodeModal('enter'); }
    else { setIsDMMode(true); playDMUnlock(); }
  }, [isDMMode, campaignSlug]);

  const handlePasscodeSubmit = useCallback(() => {
    const key = campaignSlug ? passcodeKey(campaignSlug) : 'dm_passcode';
    if (passcodeModal === 'enter') {
      if (passcodeInput === (localStorage.getItem(key) ?? '')) { setIsDMMode(true); setPasscodeModal(null); playDMUnlock(); }
      else { setPasscodeError('Incorrect passcode'); }
    } else if (passcodeModal === 'set') {
      if (passcodeInput.trim()) localStorage.setItem(key, passcodeInput);
      else localStorage.removeItem(key);
      setPasscodeModal(null);
    }
  }, [passcodeModal, passcodeInput, campaignSlug]);

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
          showSplash={!campaignSlug}
          onSelect={handleSelectCampaign}
          onRename={(slug, name) => { if (slug === campaignSlug) setCampaignName(name); }}
        />
      </>
    );
  }

  if (showLoginScreen && campaignSlug) {
    return (
      <>
        <Head><title>D&amp;D World Map</title></Head>
        <LoginScreen
          campaignName={campaignName}
          campaignSlug={campaignSlug}
          onDM={() => { setIsDMMode(true); setShowLoginScreen(false); playDMUnlock(); }}
          onPlayer={() => { setIsDMMode(false); setShowLoginScreen(false); }}
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
          {/* ── Row 1: always visible ── */}
          <div className="header-row-main">
            <div className="header-title">
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
              <button className={`mode-btn ${!isDMMode ? 'active' : ''}`} onClick={() => { setIsDMMode(false); setIsAddingPin(false); setFogPaint(false); playDMLock(); }}>Player View</button>
            </div>

            {/* Always-visible tools */}
            <button className="btn btn-sm btn-icon" title="Fit map to all pins" onClick={() => setFitTrigger(t => t + 1)}>⊞</button>
            <button className="btn btn-icon" title="Search" onClick={() => { setSearchOpen(true); setSearchQuery(''); setSearchResults(null); playSearchOpen(); }}>🔍</button>
            <button
              className="btn btn-icon"
              title={soundMuted ? 'Sounds off — click to enable' : 'Sounds on — click to mute'}
              onClick={() => { const next = !soundMuted; setSoundMuted(next); setSoundMutedState(next); }}
            >{soundMuted ? '🔇' : '🔊'}</button>

            {/* Mobile sidebar toggle */}
            <button
              className="btn btn-sm btn-icon header-sidebar-toggle"
              onClick={() => setMobileSidebarOpen(v => !v)}
              title="Open panel"
            >{mobileSidebarOpen ? '✕' : '☰'}</button>
          </div>

          {/* ── Row 2: DM tools (scrollable on mobile) ── */}
          {isDMMode && (
            <div className="header-dm-tools">
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
              <button
                className={`btn btn-sm ${showTimeLabels ? 'btn-active' : ''}`}
                title="Toggle travel time labels on paths"
                onClick={() => setShowTimeLabels(v => { const next = !v; localStorage.setItem('show_time_labels', next ? '1' : '0'); return next; })}
              >⏱ Time</button>
              <button
                className={`btn btn-sm ${showScaleBar ? 'btn-active' : ''}`}
                title={currentMapScale ? 'Toggle scale bar' : 'Toggle scale bar (no scale set — click ✏ on map to set)'}
                onClick={() => setShowScaleBar(v => { const next = !v; localStorage.setItem('show_scale_bar', next ? '1' : '0'); return next; })}
              >📐 Scale</button>
              <button
                className={`btn btn-sm ${rulerMode ? 'btn-active' : ''}`}
                title={currentMapScale ? 'Ruler tool — click map to set anchor, move to measure' : 'Ruler tool (set map scale first for distance readout)'}
                onClick={() => setRulerMode(v => !v)}
              >📐 Ruler</button>
              <button
                className={`btn btn-sm ${showGrid ? 'btn-active' : ''}`}
                title={currentMapScale ? 'Toggle grid overlay' : 'Toggle grid (set map scale first)'}
                onClick={() => setShowGrid(v => { const next = !v; localStorage.setItem('show_grid', next ? '1' : '0'); return next; })}
              >⊞ Grid</button>
              {showGrid && currentMapScale && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>cell=</span>
                  <input
                    type="number" min="1"
                    value={gridCellSize ?? ''}
                    placeholder={String(Math.round(currentMapScale.value / 10))}
                    style={{ width: 52, fontSize: 12, padding: '2px 4px', borderRadius: 3, background: 'var(--surface2)', border: '1px solid var(--border-light)', color: 'var(--text)' }}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) { setGridCellSize(v); localStorage.setItem('grid_cell_size', String(v)); }
                      else if (e.target.value === '') { setGridCellSize(null); localStorage.removeItem('grid_cell_size'); }
                    }}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>{currentMapScale.unit}</span>
                </span>
              )}
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
            </div>
          )}
        </header>

        {/* ── Main ─────────────────────────────────────────────────────── */}
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />
        )}

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
            hiddenSegmentIds={hiddenSegmentIds}
            showPartyPath={showPartyPath}
            showLabels={showPinLabels}
            showDistLabels={showDistLabels}
            showTimeLabels={showTimeLabels}
            fitTrigger={fitTrigger}
            onSelectLocation={id => { setSelectedId(id); setSidebarTab('location'); playPinSelect(); if (typeof window !== 'undefined' && window.innerWidth <= 768) setMobileSidebarOpen(true); }}
            onDeselect={() => setSelectedId(null)}
            onAddPin={handleAddPin}
            onFogChange={handleFogChange}
            onExitSubmap={handleExitSubmap}
            onUpdateLocation={handleUpdateLocation}
            onDeleteLocation={handleDeleteLocation}
            onDuplicateLocation={handleDuplicateLocation}
            onAddToPath={handleAddToPath}
            onEnterSubmap={handleEnterSubmap}
            waypointMode={waypointMode}
            onSaveWaypoints={handleSaveWaypoints}
            onCancelWaypoints={handleCancelWaypoints}
            mapScale={currentMapScale}
            showScaleBar={showScaleBar}
            onSetMapScale={handleSetMapScale}
            showGrid={showGrid}
            gridCellSize={gridCellSize}
            rulerActive={rulerMode}
          />
          <div className={`sidebar-drawer ${mobileSidebarOpen ? 'sidebar-drawer--open' : ''}`}>
          <Sidebar
            location={selectedLocation} isDMMode={isDMMode}
            playerPath={levelPlayerPath} locations={locations}
            npcs={visibleNpcs} quests={visibleQuests} sessions={visibleSessions}
            party={party} factions={visibleFactions} campaign={campaign}
            calendarConfig={calendarConfig}
            characterPaths={levelCharPaths}
            activeTab={sidebarTab} selectedLocationId={selectedId}
            onTabChange={tab => { setSidebarTab(tab); playTabSwitch(); }}
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
            hiddenSegmentIds={hiddenSegmentIds}
            showPartyPath={showPartyPath}
            onToggleCharPath={handleToggleCharPath}
            onTogglePartyPath={handleTogglePartyPath}
            onToggleSegment={handleToggleSegment}
            onUpdatePathTravelType={handleUpdatePathTravelType}
            onUpdateCharPathTravelType={handleUpdateCharPathTravelType}
            onUpdatePathDistance={handleUpdatePathDistance}
            onUpdateCharPathDistance={handleUpdateCharPathDistance}
            onUpdatePathTravelTime={handleUpdatePathTravelTime}
            onUpdateCharPathTravelTime={handleUpdateCharPathTravelTime}
            onUpdatePathDirection={handleUpdatePathDirection}
            onUpdateCharPathDirection={handleUpdateCharPathDirection}
            onStartWaypointDraw={handleStartWaypointDraw}
            onClearWaypoints={handleClearWaypoints}
            onScheduleBackup={scheduleIdbBackup}
          />
          </div>
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
