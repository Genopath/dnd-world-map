import os
import re
from pathlib import Path
from typing import Generator

from fastapi import Depends, Header
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker, DeclarativeBase


class Base(DeclarativeBase):
    pass


# ── Storage paths ─────────────────────────────────────────────────────────────

DATA_DIR      = Path(os.environ.get("DATA_DIR", "."))
CAMPAIGNS_DIR = DATA_DIR / "campaigns"
CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)

# ── Schema migrations — idempotent, run on every new campaign DB ──────────────

_MIGRATIONS = [
    "ALTER TABLE locations ADD COLUMN icon_url VARCHAR(500)",
    "ALTER TABLE locations ADD COLUMN image_url VARCHAR(500)",
    "ALTER TABLE locations ADD COLUMN parent_id INTEGER",
    "ALTER TABLE locations ADD COLUMN submap_image_url VARCHAR(500)",
    "ALTER TABLE quests ADD COLUMN image_url VARCHAR(500)",
    "ALTER TABLE quests ADD COLUMN tier VARCHAR(20) DEFAULT 'side'",
    "ALTER TABLE quests ADD COLUMN objectives TEXT DEFAULT '[]'",
    "ALTER TABLE quests ADD COLUMN quest_giver_id INTEGER",
    "ALTER TABLE quests ADD COLUMN reward_gold INTEGER DEFAULT 0",
    "ALTER TABLE quests ADD COLUMN reward_notes TEXT DEFAULT ''",
    "ALTER TABLE quests ADD COLUMN deadline VARCHAR(100) DEFAULT ''",
    "ALTER TABLE quests ADD COLUMN tags TEXT DEFAULT '[]'",
    "ALTER TABLE quests ADD COLUMN parent_quest_id INTEGER",
    "ALTER TABLE quests ADD COLUMN faction_id INTEGER",
    "ALTER TABLE quests ADD COLUMN started_session_id INTEGER",
    "ALTER TABLE quests ADD COLUMN completed_session_id INTEGER",
    "ALTER TABLE quests ADD COLUMN is_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE campaign_settings ADD COLUMN cal_day INTEGER DEFAULT 1",
    "ALTER TABLE campaign_settings ADD COLUMN cal_month INTEGER DEFAULT 1",
    "ALTER TABLE campaign_settings ADD COLUMN cal_year INTEGER DEFAULT 1",
    "ALTER TABLE sessions ADD COLUMN image_url VARCHAR(500)",
    "ALTER TABLE party_members ADD COLUMN portrait_url VARCHAR(500)",
    "ALTER TABLE party_members ADD COLUMN path_color VARCHAR(7) DEFAULT '#c9a84c'",
    "ALTER TABLE factions ADD COLUMN image_url VARCHAR(500)",
    "ALTER TABLE player_path ADD COLUMN travel_type VARCHAR(50) DEFAULT 'foot'",
    "ALTER TABLE character_paths ADD COLUMN travel_type VARCHAR(50) DEFAULT 'foot'",
    "ALTER TABLE npcs ADD COLUMN is_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE factions ADD COLUMN is_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE sessions ADD COLUMN is_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE player_path ADD COLUMN distance REAL",
    "ALTER TABLE player_path ADD COLUMN distance_unit VARCHAR(50)",
    "ALTER TABLE character_paths ADD COLUMN distance REAL",
    "ALTER TABLE character_paths ADD COLUMN distance_unit VARCHAR(50)",
    "ALTER TABLE locations ADD COLUMN fog_data TEXT",
    "ALTER TABLE locations ADD COLUMN pin_size VARCHAR(10) DEFAULT 'md'",
    "ALTER TABLE player_path ADD COLUMN direction VARCHAR(10) DEFAULT 'forward'",
    "ALTER TABLE player_path ADD COLUMN waypoints TEXT",
    "ALTER TABLE character_paths ADD COLUMN direction VARCHAR(10) DEFAULT 'forward'",
    "ALTER TABLE character_paths ADD COLUMN waypoints TEXT",
    "ALTER TABLE player_path ADD COLUMN travel_time REAL",
    "ALTER TABLE player_path ADD COLUMN travel_time_unit VARCHAR(50)",
    "ALTER TABLE character_paths ADD COLUMN travel_time REAL",
    "ALTER TABLE character_paths ADD COLUMN travel_time_unit VARCHAR(50)",
    "ALTER TABLE map_config ADD COLUMN scale_value REAL",
    "ALTER TABLE map_config ADD COLUMN scale_unit VARCHAR(50)",
    "ALTER TABLE locations ADD COLUMN scale_value REAL",
    "ALTER TABLE locations ADD COLUMN scale_unit VARCHAR(50)",
    "ALTER TABLE campaign_settings ADD COLUMN dm_passcode VARCHAR(255)",
    "ALTER TABLE locations ADD COLUMN pin_style VARCHAR(20) DEFAULT 'default'",
    "ALTER TABLE locations ADD COLUMN is_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE locations ADD COLUMN pin_border VARCHAR(20) DEFAULT 'none'",
    "ALTER TABLE campaign_settings ADD COLUMN party_marker_x REAL",
    "ALTER TABLE campaign_settings ADD COLUMN party_marker_y REAL",
    "ALTER TABLE campaign_settings ADD COLUMN party_marker_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE party_members ADD COLUMN marker_x REAL",
    "ALTER TABLE party_members ADD COLUMN marker_y REAL",
    "ALTER TABLE party_members ADD COLUMN marker_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE rumours ADD COLUMN type VARCHAR(20) DEFAULT 'rumour'",
    "ALTER TABLE rumours ADD COLUMN archived BOOLEAN DEFAULT 0",
    "ALTER TABLE party_members ADD COLUMN gold INTEGER DEFAULT 0",
    "ALTER TABLE party_members ADD COLUMN silver INTEGER DEFAULT 0",
    "ALTER TABLE party_members ADD COLUMN copper INTEGER DEFAULT 0",
    "ALTER TABLE party_members ADD COLUMN electrum INTEGER DEFAULT 0",
    "ALTER TABLE campaign_settings ADD COLUMN pool_gold INTEGER DEFAULT 0",
    "ALTER TABLE campaign_settings ADD COLUMN pool_silver INTEGER DEFAULT 0",
    "ALTER TABLE campaign_settings ADD COLUMN pool_copper INTEGER DEFAULT 0",
    "ALTER TABLE campaign_settings ADD COLUMN pool_electrum INTEGER DEFAULT 0",
    "ALTER TABLE campaign_settings ADD COLUMN camp_map_url VARCHAR(500)",
    "ALTER TABLE party_members ADD COLUMN camp_x REAL",
    "ALTER TABLE party_members ADD COLUMN camp_y REAL",
    "ALTER TABLE party_members ADD COLUMN camp_visible BOOLEAN DEFAULT 1",
    "ALTER TABLE campaign_settings ADD COLUMN submap_party_markers TEXT DEFAULT '{}'",
    # ── Indexes ───────────────────────────────────────────────────────────────
    "CREATE INDEX IF NOT EXISTS ix_locations_parent_id ON locations (parent_id)",
    "CREATE INDEX IF NOT EXISTS ix_player_path_location_id ON player_path (location_id)",
    "CREATE INDEX IF NOT EXISTS ix_player_path_position ON player_path (position)",
    "CREATE INDEX IF NOT EXISTS ix_npcs_location_id ON npcs (location_id)",
    "CREATE INDEX IF NOT EXISTS ix_quests_location_id ON quests (location_id)",
    "CREATE INDEX IF NOT EXISTS ix_quests_status ON quests (status)",
    "CREATE INDEX IF NOT EXISTS ix_quest_npc_links_npc_id ON quest_npc_links (npc_id)",
    "CREATE INDEX IF NOT EXISTS ix_character_paths_location_id ON character_paths (location_id)",
    "CREATE INDEX IF NOT EXISTS ix_character_paths_position ON character_paths (position)",
    "CREATE INDEX IF NOT EXISTS ix_rel_edge_from ON relationship_edges (from_type, from_id)",
    "CREATE INDEX IF NOT EXISTS ix_rel_edge_to ON relationship_edges (to_type, to_id)",
    "CREATE INDEX IF NOT EXISTS ix_rel_node_pos_entity ON relationship_node_positions (entity_type, entity_id)",
]


def _set_sqlite_pragmas(dbapi_conn, _connection_record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA cache_size=-65536")   # 64 MB page cache
    cur.execute("PRAGMA temp_store=MEMORY")
    cur.execute("PRAGMA mmap_size=268435456") # 256 MB memory-mapped I/O
    cur.close()


def _run_migrations(engine) -> None:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for stmt in _MIGRATIONS:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists


# ── Per-campaign engine + sessionmaker cache ──────────────────────────────────

_engines:           dict[str, object]      = {}
_session_factories: dict[str, sessionmaker] = {}


def get_engine_for_campaign(slug: str):
    db_path = str(CAMPAIGNS_DIR / f"{slug}.db")
    if db_path not in _engines:
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        event.listen(engine, "connect", _set_sqlite_pragmas)
        _run_migrations(engine)
        _engines[db_path] = engine
    return _engines[db_path]


def invalidate_engine(slug: str) -> None:
    db_path = str(CAMPAIGNS_DIR / f"{slug}.db")
    _engines.pop(db_path, None)
    _session_factories.pop(db_path, None)


# ── Slug helpers ──────────────────────────────────────────────────────────────

def sanitize_slug(s: str) -> str:
    slug = re.sub(r'[^a-z0-9-]', '-', s.lower().strip())
    slug = re.sub(r'-+', '-', slug).strip('-')[:50]
    return slug or 'default'


# ── FastAPI dependency ────────────────────────────────────────────────────────

def get_campaign_slug(x_campaign: str = Header(default="default")) -> str:
    return sanitize_slug(x_campaign)


def get_db(slug: str = Depends(get_campaign_slug)) -> Generator[Session, None, None]:
    engine = get_engine_for_campaign(slug)
    db_path = str(CAMPAIGNS_DIR / f"{slug}.db")
    if db_path not in _session_factories:
        _session_factories[db_path] = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = _session_factories[db_path]()
    try:
        yield db
    finally:
        db.close()
