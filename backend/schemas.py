from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class LocationCreate(BaseModel):
    name: str
    type: str = "city"
    subtitle: str = ""
    description: str = ""
    quest_hooks: List[str] = []
    handouts: List[str] = []
    dm_notes: str = ""
    discovered: bool = False
    x: float
    y: float
    parent_id: Optional[int] = None


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    subtitle: Optional[str] = None
    description: Optional[str] = None
    quest_hooks: Optional[List[str]] = None
    handouts: Optional[List[str]] = None
    dm_notes: Optional[str] = None
    discovered: Optional[bool] = None
    x: Optional[float] = None
    y: Optional[float] = None
    parent_id: Optional[int] = None
    icon_url: Optional[str] = None
    image_url: Optional[str] = None
    submap_image_url: Optional[str] = None
    pin_size: Optional[str] = None


class LocationOut(BaseModel):
    id: int
    name: str
    type: str
    subtitle: str
    description: str
    quest_hooks: List[str]
    handouts: List[str]
    dm_notes: str
    discovered: bool
    x: float
    y: float
    icon_url: Optional[str] = None
    image_url: Optional[str] = None
    parent_id: Optional[int] = None
    submap_image_url: Optional[str] = None
    pin_size: str = 'md'
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PathEntryCreate(BaseModel):
    location_id: int
    travel_type: str = "foot"


class PathEntryUpdate(BaseModel):
    travel_type:   Optional[str]   = None
    distance:      Optional[float] = None
    distance_unit: Optional[str]   = None


class PathEntryOut(BaseModel):
    id: int
    location_id: int
    position: int
    travel_type: str = "foot"
    distance: Optional[float] = None
    distance_unit: Optional[str] = None
    visited_at: Optional[datetime] = None
    location: Optional[LocationOut] = None

    model_config = {"from_attributes": True}


class PathReorder(BaseModel):
    order: List[int]


# ── NPC ───────────────────────────────────────────────────────────────────────

class NPCCreate(BaseModel):
    location_id: Optional[int] = None
    name: str
    role: str = ""
    status: str = "alive"
    notes: str = ""

class NPCUpdate(BaseModel):
    location_id: Optional[int] = None
    name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    is_visible: Optional[bool] = None
    portrait_url: Optional[str] = None

class NPCOut(BaseModel):
    id: int
    location_id: Optional[int] = None
    name: str
    role: str
    status: str
    notes: str
    portrait_url: Optional[str] = None
    is_visible: bool = True
    linked_quest_ids: List[int] = []
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Quest ─────────────────────────────────────────────────────────────────────

class QuestCreate(BaseModel):
    title: str
    status: str = "active"
    tier:   str = "side"
    description: str = ""
    location_id: Optional[int] = None
    notes: str = ""
    objectives:           List[dict] = []
    quest_giver_id:       Optional[int] = None
    reward_gold:          int = 0
    reward_notes:         str = ""
    deadline:             str = ""
    tags:                 List[str] = []
    parent_quest_id:      Optional[int] = None
    faction_id:           Optional[int] = None
    started_session_id:   Optional[int] = None
    completed_session_id: Optional[int] = None
    is_visible:           bool = True

class QuestUpdate(BaseModel):
    title:       Optional[str] = None
    status:      Optional[str] = None
    tier:        Optional[str] = None
    description: Optional[str] = None
    location_id: Optional[int] = None
    notes:       Optional[str] = None
    objectives:           Optional[List[dict]] = None
    quest_giver_id:       Optional[int] = None
    reward_gold:          Optional[int] = None
    reward_notes:         Optional[str] = None
    deadline:             Optional[str] = None
    tags:                 Optional[List[str]] = None
    parent_quest_id:      Optional[int] = None
    faction_id:           Optional[int] = None
    started_session_id:   Optional[int] = None
    completed_session_id: Optional[int] = None
    is_visible:           Optional[bool] = None
    image_url:            Optional[str] = None

class QuestOut(BaseModel):
    id: int
    title: str
    status: str
    tier:   str = "side"
    description: str
    location_id: Optional[int] = None
    notes: str
    image_url: Optional[str] = None
    linked_npc_ids: List[int] = []
    objectives:           List[dict] = []
    quest_giver_id:       Optional[int] = None
    reward_gold:          int = 0
    reward_notes:         str = ""
    deadline:             str = ""
    tags:                 List[str] = []
    parent_quest_id:      Optional[int] = None
    faction_id:           Optional[int] = None
    started_session_id:   Optional[int] = None
    completed_session_id: Optional[int] = None
    is_visible:           bool = True
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Session ───────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    session_number: int
    title: str = ""
    in_world_date: str = ""
    real_date: str = ""
    summary: str = ""
    xp_awarded: int = 0
    loot_notes: str = ""

class SessionUpdate(BaseModel):
    session_number: Optional[int] = None
    title: Optional[str] = None
    in_world_date: Optional[str] = None
    real_date: Optional[str] = None
    summary: Optional[str] = None
    xp_awarded: Optional[int] = None
    loot_notes: Optional[str] = None
    is_visible: Optional[bool] = None
    image_url: Optional[str] = None

class SessionOut(BaseModel):
    id: int
    session_number: int
    title: str
    in_world_date: str
    real_date: str
    summary: str
    xp_awarded: int
    loot_notes: str
    image_url: Optional[str] = None
    is_visible: bool = True
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Campaign Settings ─────────────────────────────────────────────────────────

class CampaignUpdate(BaseModel):
    world_name: Optional[str] = None
    in_world_date: Optional[str] = None
    in_world_time: Optional[str] = None
    weather: Optional[str] = None
    season: Optional[str] = None
    notes: Optional[str] = None
    cal_day:   Optional[int] = None
    cal_month: Optional[int] = None
    cal_year:  Optional[int] = None

class CampaignOut(BaseModel):
    id: int
    world_name: str
    in_world_date: str
    in_world_time: str
    weather: str
    season: str
    notes: str
    cal_day:   int
    cal_month: int
    cal_year:  int
    model_config = {"from_attributes": True}


# ── Party Members ─────────────────────────────────────────────────────────────

class PartyMemberCreate(BaseModel):
    name: str
    player_name: str = ""
    class_name: str = ""
    race: str = ""
    level: int = 1
    hp_current: int = 0
    hp_max: int = 0
    ac: int = 10
    conditions: List[str] = []
    notes: str = ""
    path_color: str = "#c9a84c"

class PartyMemberUpdate(BaseModel):
    name: Optional[str] = None
    player_name: Optional[str] = None
    class_name: Optional[str] = None
    race: Optional[str] = None
    level: Optional[int] = None
    hp_current: Optional[int] = None
    hp_max: Optional[int] = None
    ac: Optional[int] = None
    conditions: Optional[List[str]] = None
    notes: Optional[str] = None
    path_color: Optional[str] = None
    portrait_url: Optional[str] = None

class PartyMemberOut(BaseModel):
    id: int
    name: str
    player_name: str
    class_name: str
    race: str
    level: int
    hp_current: int
    hp_max: int
    ac: int
    conditions: List[str]
    notes: str
    portrait_url: Optional[str] = None
    path_color: str = "#c9a84c"
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Factions ──────────────────────────────────────────────────────────────────

class FactionCreate(BaseModel):
    name: str
    description: str = ""
    reputation: int = 0
    notes: str = ""
    color: str = "#888888"

class FactionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reputation: Optional[int] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    is_visible: Optional[bool] = None
    image_url: Optional[str] = None

class FactionOut(BaseModel):
    id: int
    name: str
    description: str
    reputation: int
    notes: str
    color: str
    image_url: Optional[str] = None
    is_visible: bool = True
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Fog of War ────────────────────────────────────────────────────────────────

class FogUpdate(BaseModel):
    data: str


# ── Character Paths ───────────────────────────────────────────────────────────

class CharacterPathEntryCreate(BaseModel):
    location_id: int
    travel_type: str = "foot"

class CharacterPathReorder(BaseModel):
    order: List[int]

class CharacterPathEntryUpdate(BaseModel):
    travel_type:   Optional[str]   = None
    distance:      Optional[float] = None
    distance_unit: Optional[str]   = None

class CharacterPathEntryOut(BaseModel):
    id: int
    party_member_id: int
    location_id: int
    position: int
    travel_type: str = "foot"
    distance: Optional[float] = None
    distance_unit: Optional[str] = None
    visited_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Calendar Config ───────────────────────────────────────────────────────────

class CalendarConfigUpdate(BaseModel):
    months:    Optional[str] = None   # JSON string: [{name, days}, ...]
    weekdays:  Optional[str] = None   # JSON string: [name, ...]
    year_name: Optional[str] = None

class CalendarConfigOut(BaseModel):
    id: int
    months:    str
    weekdays:  str
    year_name: str
    model_config = {"from_attributes": True}
