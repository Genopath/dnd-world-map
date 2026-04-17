export type LocationType = 'city' | 'dungeon' | 'wilderness' | 'landmark' | 'hazard' | 'shop' | 'inn' | 'temple' | 'port' | 'bridge' | 'gate' | 'portal';

export interface Location {
  id: number;
  name: string;
  type: LocationType;
  subtitle: string;
  description: string;
  quest_hooks: string[];
  handouts: string[];
  dm_notes: string;
  discovered: boolean;
  x: number;
  y: number;
  icon_url?: string | null;
  image_url?: string | null;
  parent_id?: number | null;
  submap_image_url?: string | null;
  pin_size?:    'sm' | 'md' | 'lg';
  pin_style?:   'default' | 'flame' | 'frost' | 'cursed' | 'divine' | 'storm' | 'shadow' | 'lair' | 'arcane' | 'swords' | 'arrows' | 'quake';
  pin_border?:  'none' | 'siege' | 'blessed' | 'warded' | 'cursed' | 'haunted' | 'plague' | 'frozen' | 'burning';
  is_visible?:  boolean;
  scale_value?: number | null;
  scale_unit?:  string | null;
  created_at?: string;
}

export interface PathEntry {
  id: number;
  location_id: number;
  position: number;
  travel_type?: string;
  distance?: number | null;
  distance_unit?: string | null;
  travel_time?: number | null;
  travel_time_unit?: string | null;
  direction?: 'forward' | 'backward' | 'both';
  waypoints?: string | null;  // JSON "[[x,y],...]"
  visited_at?: string;
  location?: Location;
}

export interface MapConfig {
  image_url:   string | null;
  scale_value?: number | null;
  scale_unit?:  string | null;
}

export interface NPC {
  id: number;
  location_id: number | null;
  name: string;
  role: string;
  status: 'alive' | 'dead' | 'unknown';
  notes: string;
  portrait_url: string | null;
  is_visible?: boolean;
  linked_quest_ids?: number[];
  created_at?: string;
}

export type QuestTier = 'main' | 'side' | 'rumour';

export interface QuestObjective {
  id: number;
  text: string;
  done: boolean;
}

export interface Quest {
  id: number;
  title: string;
  status: 'active' | 'completed' | 'failed';
  tier: QuestTier;
  description: string;
  location_id: number | null;
  notes: string;
  image_url?: string | null;
  linked_npc_ids?: number[];
  objectives?: QuestObjective[];
  quest_giver_id?: number | null;
  reward_gold?: number;
  reward_notes?: string;
  deadline?: string;
  tags?: string[];
  parent_quest_id?: number | null;
  faction_id?: number | null;
  started_session_id?: number | null;
  completed_session_id?: number | null;
  is_visible?: boolean;
  created_at?: string;
}

export interface CharacterPathEntry {
  id: number;
  party_member_id: number;
  location_id: number;
  position: number;
  travel_type?: string;
  distance?: number | null;
  distance_unit?: string | null;
  travel_time?: number | null;
  travel_time_unit?: string | null;
  direction?: 'forward' | 'backward' | 'both';
  waypoints?: string | null;
  visited_at?: string;
}

export interface SessionEntry {
  id: number;
  session_number: number;
  title: string;
  in_world_date: string;
  real_date: string;
  summary: string;
  xp_awarded: number;
  loot_notes: string;
  image_url?: string | null;
  is_visible?: boolean;
  created_at?: string;
}

export interface SearchResults {
  locations: Location[];
  npcs: NPC[];
  quests: Quest[];
}

export interface PartyMember {
  id: number;
  name: string;
  player_name: string;
  class_name: string;
  race: string;
  level: number;
  hp_current: number;
  hp_max: number;
  ac: number;
  conditions: string[];
  notes: string;
  portrait_url?: string | null;
  path_color: string;
  created_at?: string;
}

export interface Faction {
  id: number;
  name: string;
  description: string;
  reputation: number;
  notes: string;
  color: string;
  image_url?: string | null;
  is_visible?: boolean;
  created_at?: string;
}

export interface CampaignSettings {
  id: number;
  world_name: string;
  in_world_date: string;
  in_world_time: string;
  weather: string;
  season: string;
  notes: string;
  cal_day: number;
  cal_month: number;
  cal_year: number;
}

export interface CalendarConfig {
  id: number;
  months: string;    // JSON: [{name: string, days: number}]
  weekdays: string;  // JSON: [string]
  year_name: string;
}

export interface CampaignMeta {
  slug: string;
  name: string;
}

export type SidebarTab =
  | 'location' | 'npcs' | 'quests' | 'sessions'
  | 'party' | 'factions' | 'calendar' | 'path';
