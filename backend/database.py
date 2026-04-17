import os
import re
from pathlib import Path
from typing import Generator

from fastapi import Depends, Header
from sqlalchemy import create_engine, text
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
]


def _run_migrations(engine) -> None:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for stmt in _MIGRATIONS:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists


# ── Per-campaign engine cache ─────────────────────────────────────────────────

_engines: dict[str, object] = {}


def get_engine_for_campaign(slug: str):
    db_path = str(CAMPAIGNS_DIR / f"{slug}.db")
    if db_path not in _engines:
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        _run_migrations(engine)
        _engines[db_path] = engine
    return _engines[db_path]


def invalidate_engine(slug: str) -> None:
    db_path = str(CAMPAIGNS_DIR / f"{slug}.db")
    _engines.pop(db_path, None)


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
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = factory()
    try:
        yield db
    finally:
        db.close()
