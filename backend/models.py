from sqlalchemy import Boolean, Column, DateTime, Float, Integer, LargeBinary, String, Text
from sqlalchemy.sql import func

from database import Base


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), default="city")
    subtitle = Column(String(500), default="")
    description = Column(Text, default="")
    quest_hooks = Column(Text, default="[]")   # JSON string
    handouts = Column(Text, default="[]")       # JSON string
    dm_notes = Column(Text, default="")
    discovered = Column(Boolean, default=False)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    icon_url = Column(String(500), nullable=True)
    image_url = Column(String(500), nullable=True)        # hero/banner image
    parent_id = Column(Integer, nullable=True)            # null = root map level
    submap_image_url = Column(String(500), nullable=True) # interior map image
    fog_data         = Column(Text, nullable=True)         # per-submap fog (10000-char '0'/'1')
    pin_size         = Column(String(10), default='md')    # 'sm' | 'md' | 'lg'
    pin_style        = Column(String(20), default='default') # 'default' | 'flame' | 'frost' | 'cursed' | 'divine' | 'storm' | 'shadow' | 'lair' | 'arcane'
    pin_border       = Column(String(20), default='none')    # 'none' | 'siege' | 'blessed' | 'warded' | 'cursed' | 'haunted' | 'plague' | 'frozen' | 'burning'
    is_visible       = Column(Boolean, default=True)         # shown to players?
    scale_value      = Column(Float, nullable=True)         # per-submap scale: map is X units wide
    scale_unit       = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PlayerPathEntry(Base):
    __tablename__ = "player_path"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, nullable=False)
    position = Column(Integer, nullable=False, default=0)
    travel_type = Column(String(50), default="foot")
    distance = Column(Float, nullable=True)
    distance_unit = Column(String(50), nullable=True)
    direction        = Column(String(10), default="forward")  # forward | backward | both
    waypoints        = Column(Text, nullable=True)             # JSON: [[x, y], ...]
    travel_time      = Column(Float, nullable=True)
    travel_time_unit = Column(String(50), nullable=True)
    visited_at = Column(DateTime(timezone=True), server_default=func.now())


class MapConfig(Base):
    __tablename__ = "map_config"

    id             = Column(Integer, primary_key=True, index=True)
    image_filename = Column(String(500), default="")
    scale_value    = Column(Float, nullable=True)
    scale_unit     = Column(String(50), nullable=True)


class NPC(Base):
    __tablename__ = "npcs"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, nullable=True)
    name = Column(String(255), nullable=False)
    role = Column(String(255), default="")
    status = Column(String(50), default="alive")   # alive / dead / unknown
    notes = Column(Text, default="")
    portrait_url = Column(String(500), nullable=True)
    is_visible = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Quest(Base):
    __tablename__ = "quests"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    status = Column(String(50), default="active")      # active / completed / failed
    tier   = Column(String(20),  default="side")       # main / side / rumour
    description = Column(Text, default="")
    location_id = Column(Integer, nullable=True)
    notes = Column(Text, default="")
    image_url = Column(String(500), nullable=True)
    # Objectives: JSON [{id, text, done}, ...]
    objectives = Column(Text, default="[]")
    # Enrichment
    quest_giver_id    = Column(Integer, nullable=True)   # FK → npcs.id
    reward_gold       = Column(Integer, default=0)
    reward_notes      = Column(Text, default="")
    deadline          = Column(String(100), default="")  # in-world date string
    tags              = Column(Text, default="[]")        # JSON [str, ...]
    # Relations
    parent_quest_id      = Column(Integer, nullable=True)  # quest chain
    faction_id           = Column(Integer, nullable=True)  # FK → factions.id
    started_session_id   = Column(Integer, nullable=True)  # FK → sessions.id
    completed_session_id = Column(Integer, nullable=True)  # FK → sessions.id
    # Visibility
    is_visible = Column(Boolean, default=True)             # shown to players?
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SessionLog(Base):
    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_number = Column(Integer, nullable=False)
    title = Column(String(255), default="")
    in_world_date = Column(String(100), default="")
    real_date = Column(String(20), default="")
    summary = Column(Text, default="")
    xp_awarded = Column(Integer, default=0)
    loot_notes = Column(Text, default="")
    image_url = Column(String(500), nullable=True)
    is_visible = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CampaignSettings(Base):
    __tablename__ = "campaign_settings"

    id = Column(Integer, primary_key=True, index=True)
    world_name = Column(String(255), default="")
    in_world_date = Column(String(100), default="")
    in_world_time = Column(String(50), default="")
    weather = Column(String(100), default="")
    season = Column(String(50), default="")
    notes = Column(Text, default="")
    cal_day   = Column(Integer, default=1)
    cal_month = Column(Integer, default=1)
    cal_year  = Column(Integer, default=1)
    dm_passcode = Column(String(255), nullable=True, default=None)


class PartyMember(Base):
    __tablename__ = "party_members"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    player_name = Column(String(255), default="")
    class_name = Column(String(100), default="")
    race = Column(String(100), default="")
    level = Column(Integer, default=1)
    hp_current = Column(Integer, default=0)
    hp_max = Column(Integer, default=0)
    ac = Column(Integer, default=10)
    conditions = Column(Text, default="[]")   # JSON array of strings
    notes = Column(Text, default="")
    portrait_url = Column(String(500), nullable=True)
    path_color = Column(String(7), default="#c9a84c")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Faction(Base):
    __tablename__ = "factions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    reputation = Column(Integer, default=0)   # -100 (hostile) to 100 (allied)
    notes = Column(Text, default="")
    color = Column(String(7), default="#888888")
    image_url = Column(String(500), nullable=True)
    is_visible = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FogOfWar(Base):
    __tablename__ = "fog_of_war"

    id = Column(Integer, primary_key=True, index=True)
    # 10 000-char string: '0'=fogged, '1'=revealed (100×100 grid, row-major)
    data = Column(Text, default="")


class CalendarConfig(Base):
    __tablename__ = "calendar_config"

    id        = Column(Integer, primary_key=True, index=True)
    months    = Column(Text, default="[]")   # JSON: [{name, days}, ...]
    weekdays  = Column(Text, default="[]")   # JSON: [name, ...]
    year_name = Column(String(100), default="")


class CharacterPath(Base):
    __tablename__ = "character_paths"

    id              = Column(Integer, primary_key=True, index=True)
    party_member_id = Column(Integer, nullable=False, index=True)
    location_id     = Column(Integer, nullable=False)
    position        = Column(Integer, nullable=False, default=0)
    travel_type     = Column(String(50), default="foot")
    distance        = Column(Float, nullable=True)
    distance_unit   = Column(String(50), nullable=True)
    direction        = Column(String(10), default="forward")
    waypoints        = Column(Text, nullable=True)
    travel_time      = Column(Float, nullable=True)
    travel_time_unit = Column(String(50), nullable=True)
    visited_at       = Column(DateTime(timezone=True), server_default=func.now())


class QuestNPCLink(Base):
    __tablename__ = "quest_npc_links"

    quest_id = Column(Integer, primary_key=True)
    npc_id   = Column(Integer, primary_key=True)


class StoredImage(Base):
    __tablename__ = "stored_images"

    id           = Column(String(64), primary_key=True)   # UUID hex
    content_type = Column(String(100), default="image/png")
    data         = Column(LargeBinary, nullable=False)
