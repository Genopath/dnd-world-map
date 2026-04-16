import type {
  CalendarConfig, CampaignMeta, CampaignSettings, CharacterPathEntry, Faction, Location, MapConfig,
  NPC, PartyMember, PathEntry, Quest, SearchResults, SessionEntry,
} from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Current campaign — set by selectCampaign() in index.tsx before any data calls
let _campaign = 'default';
export function setCurrentCampaign(slug: string) { _campaign = slug; }

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Campaign': _campaign },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function upload<T>(path: string, file: File, fieldName = 'file'): Promise<T> {
  const fd = new FormData();
  fd.append(fieldName, file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST', body: fd,
    headers: { 'X-Campaign': _campaign },
  });
  if (!res.ok) throw new Error(`Upload failed ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  locations: {
    list: () => req<Location[]>('/locations'),
    create: (data: Omit<Location, 'id' | 'created_at' | 'icon_url' | 'image_url' | 'submap_image_url'>) =>
      req<Location>('/locations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<Location, 'id' | 'created_at'>>) =>
      req<Location>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/locations/${id}`, { method: 'DELETE' }),
    uploadIcon:    (id: number, file: File) => upload<{ icon_url: string }>(`/locations/${id}/icon`, file),
    deleteIcon:    (id: number) => req<{ ok: boolean }>(`/locations/${id}/icon`, { method: 'DELETE' }),
    uploadImage:   (id: number, file: File) => upload<{ image_url: string }>(`/locations/${id}/image`, file),
    deleteImage:   (id: number) => req<{ ok: boolean }>(`/locations/${id}/image`, { method: 'DELETE' }),
    uploadSubmap:  (id: number, file: File) => upload<{ submap_image_url: string }>(`/locations/${id}/submap`, file),
    deleteSubmap:  (id: number) => req<{ ok: boolean }>(`/locations/${id}/submap`, { method: 'DELETE' }),
    getFog:      (id: number) => req<{ data: string }>(`/locations/${id}/fog`),
    updateFog:   (id: number, data: string) => req<{ ok: boolean }>(`/locations/${id}/fog`, { method: 'PUT', body: JSON.stringify({ data }) }),
    revealFog:   (id: number) => req<{ ok: boolean }>(`/locations/${id}/fog/reveal-all`, { method: 'POST' }),
    hideFog:     (id: number) => req<{ ok: boolean }>(`/locations/${id}/fog/hide-all`, { method: 'POST' }),
  },
  path: {
    get: () => req<PathEntry[]>('/player-path'),
    add: (locationId: number, travelType = 'foot') =>
      req<PathEntry>('/player-path', { method: 'POST', body: JSON.stringify({ location_id: locationId, travel_type: travelType }) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/player-path/${id}`, { method: 'DELETE' }),
    reorder: (order: number[]) =>
      req<PathEntry[]>('/player-path/reorder', { method: 'PUT', body: JSON.stringify({ order }) }),
    updateEntry: (id: number, data: { travel_type?: string; distance?: number | null; distance_unit?: string | null; direction?: string; waypoints?: string | null; travel_time?: number | null; travel_time_unit?: string | null }) =>
      req<PathEntry>(`/player-path/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  map: {
    config: () => req<MapConfig>('/map-config'),
    upload: (file: File) => upload<MapConfig>('/map-config/upload', file),
  },
  npcs: {
    list: () => req<NPC[]>('/npcs'),
    create: (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>) =>
      req<NPC>('/npcs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<NPC, 'id' | 'created_at'>>) =>
      req<NPC>(`/npcs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/npcs/${id}`, { method: 'DELETE' }),
    uploadPortrait: (id: number, file: File) =>
      upload<{ portrait_url: string }>(`/npcs/${id}/portrait`, file),
    deletePortrait: (id: number) =>
      req<{ ok: boolean }>(`/npcs/${id}/portrait`, { method: 'DELETE' }),
  },
  quests: {
    list: () => req<Quest[]>('/quests'),
    create: (data: Omit<Quest, 'id' | 'created_at' | 'image_url' | 'linked_npc_ids'>) =>
      req<Quest>('/quests', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<Quest, 'id' | 'created_at'>>) =>
      req<Quest>(`/quests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/quests/${id}`, { method: 'DELETE' }),
    uploadImage: (id: number, file: File) =>
      upload<{ image_url: string }>(`/quests/${id}/image`, file),
    deleteImage: (id: number) =>
      req<{ ok: boolean }>(`/quests/${id}/image`, { method: 'DELETE' }),
    linkNpc: (questId: number, npcId: number) =>
      req<Quest>(`/quests/${questId}/link-npc/${npcId}`, { method: 'POST' }),
    unlinkNpc: (questId: number, npcId: number) =>
      req<Quest>(`/quests/${questId}/link-npc/${npcId}`, { method: 'DELETE' }),
  },
  sessions: {
    list: () => req<SessionEntry[]>('/sessions'),
    create: (data: Omit<SessionEntry, 'id' | 'created_at'>) =>
      req<SessionEntry>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<SessionEntry, 'id' | 'created_at'>>) =>
      req<SessionEntry>(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/sessions/${id}`, { method: 'DELETE' }),
    uploadImage: (id: number, file: File) =>
      upload<{ image_url: string }>(`/sessions/${id}/image`, file),
    deleteImage: (id: number) =>
      req<{ ok: boolean }>(`/sessions/${id}/image`, { method: 'DELETE' }),
  },
  party: {
    list: () => req<PartyMember[]>('/party'),
    create: (data: Omit<PartyMember, 'id' | 'created_at'>) =>
      req<PartyMember>('/party', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<PartyMember, 'id' | 'created_at'>>) =>
      req<PartyMember>(`/party/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/party/${id}`, { method: 'DELETE' }),
    uploadPortrait: (id: number, file: File) =>
      upload<{ portrait_url: string }>(`/party/${id}/portrait`, file),
    deletePortrait: (id: number) =>
      req<{ ok: boolean }>(`/party/${id}/portrait`, { method: 'DELETE' }),
  },
  factions: {
    list: () => req<Faction[]>('/factions'),
    create: (data: Omit<Faction, 'id' | 'created_at'>) =>
      req<Faction>('/factions', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<Faction, 'id' | 'created_at'>>) =>
      req<Faction>(`/factions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) =>
      req<{ deleted: number }>(`/factions/${id}`, { method: 'DELETE' }),
    uploadImage: (id: number, file: File) =>
      upload<{ image_url: string }>(`/factions/${id}/image`, file),
    deleteImage: (id: number) =>
      req<{ ok: boolean }>(`/factions/${id}/image`, { method: 'DELETE' }),
  },
  campaign: {
    get: () => req<CampaignSettings>('/campaign'),
    update: (data: Partial<Omit<CampaignSettings, 'id'>>) =>
      req<CampaignSettings>('/campaign', { method: 'PUT', body: JSON.stringify(data) }),
  },
  calendar: {
    get: () => req<CalendarConfig>('/calendar-config'),
    update: (data: Partial<Omit<CalendarConfig, 'id'>>) =>
      req<CalendarConfig>('/calendar-config', { method: 'PUT', body: JSON.stringify(data) }),
  },
  characterPaths: {
    listAll: () => req<CharacterPathEntry[]>('/character-paths'),
    list: (memberId: number) => req<CharacterPathEntry[]>(`/character-paths/${memberId}`),
    add: (memberId: number, locationId: number, travelType = 'foot') =>
      req<CharacterPathEntry>(`/character-paths/${memberId}`, { method: 'POST', body: JSON.stringify({ location_id: locationId, travel_type: travelType }) }),
    remove: (entryId: number) =>
      req<{ deleted: number }>(`/character-paths/entry/${entryId}`, { method: 'DELETE' }),
    reorder: (memberId: number, order: number[]) =>
      req<CharacterPathEntry[]>(`/character-paths/${memberId}/reorder`, { method: 'PUT', body: JSON.stringify({ order }) }),
    clear: (memberId: number) =>
      req<{ cleared: number }>(`/character-paths/${memberId}/clear`, { method: 'DELETE' }),
    updateEntry: (entryId: number, data: { travel_type?: string; distance?: number | null; distance_unit?: string | null; direction?: string; waypoints?: string | null; travel_time?: number | null; travel_time_unit?: string | null }) =>
      req<CharacterPathEntry>(`/character-paths/entry/${entryId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },
  fog: {
    get: () => req<{ data: string }>('/fog'),
    update: (data: string) =>
      req<{ ok: boolean }>('/fog', { method: 'PUT', body: JSON.stringify({ data }) }),
    revealAll: () => req<{ ok: boolean }>('/fog/reveal-all', { method: 'POST' }),
    hideAll:   () => req<{ ok: boolean }>('/fog/hide-all',   { method: 'POST' }),
  },
  search: (q: string) =>
    req<SearchResults>(`/search?q=${encodeURIComponent(q)}`),
  handouts: {
    upload: (file: File) => upload<{ url: string; name: string }>('/handouts/upload', file),
  },
  library: {
    list: () => req<{ name: string; url: string }[]>('/library-list'),
  },
  data: {
    export: () => req<object>('/export'),
    import: (file: File) => upload<{ imported: boolean }>('/import', file, 'file'),
  },
  campaigns: {
    list:   () => req<CampaignMeta[]>('/campaigns'),
    create: (name: string) => req<CampaignMeta>('/campaigns', { method: 'POST', body: JSON.stringify({ name }) }),
    rename: (slug: string, name: string) => req<CampaignMeta>(`/campaigns/${slug}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
    remove: (slug: string) => req<{ deleted: string }>(`/campaigns/${slug}`, { method: 'DELETE' }),
  },
};

export { API_BASE };
