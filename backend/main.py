"""
D&D World Map — FastAPI backend
SQLite persistence via SQLAlchemy
"""

import asyncio
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import List, Optional, Set

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel as _BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

import models
import schemas
import database
from database import get_db

# ── Startup ───────────────────────────────────────────────────────────────────
# Migrations now run automatically per-campaign in database.py when a DB is
# first accessed. No global startup migration needed.

_DATA_DIR    = Path(os.environ.get("DATA_DIR", "."))
UPLOADS_DIR  = _DATA_DIR / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
HANDOUTS_DIR = UPLOADS_DIR / "handouts";  HANDOUTS_DIR.mkdir(exist_ok=True)
PORTRAITS_DIR = UPLOADS_DIR / "portraits"; PORTRAITS_DIR.mkdir(exist_ok=True)
ICONS_DIR    = UPLOADS_DIR / "icons";     ICONS_DIR.mkdir(exist_ok=True)
IMAGES_DIR   = UPLOADS_DIR / "images";    IMAGES_DIR.mkdir(exist_ok=True)
SUBMAPS_DIR  = UPLOADS_DIR / "submaps";   SUBMAPS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="D&D World Map API")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


# ── WebSocket broadcast ───────────────────────────────────────────────────────

_ws_clients: Set[WebSocket] = set()

async def _broadcast(event: dict):
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            data = await websocket.receive()
            if data.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(websocket)


# Middleware: broadcast "refresh" after any mutating request
@app.middleware("http")
async def broadcast_on_mutation(request, call_next):
    response = await call_next(request)
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        path = request.url.path
        # Skip read-only-ish endpoints and the WS endpoint itself
        skip = ("/search", "/export", "/map-config", "/ws")
        if not any(path.startswith(s) for s in skip) and _ws_clients:
            asyncio.create_task(_broadcast({"type": "refresh"}))
    return response


# ── Helpers ───────────────────────────────────────────────────────────────────

def _loc_out(loc: models.Location) -> schemas.LocationOut:
    return schemas.LocationOut(
        id=loc.id,
        name=loc.name,
        type=loc.type,
        subtitle=loc.subtitle or "",
        description=loc.description or "",
        quest_hooks=json.loads(loc.quest_hooks or "[]"),
        handouts=json.loads(loc.handouts or "[]"),
        dm_notes=loc.dm_notes or "",
        discovered=bool(loc.discovered),
        x=loc.x,
        y=loc.y,
        icon_url=getattr(loc, "icon_url", None),
        image_url=getattr(loc, "image_url", None),
        parent_id=getattr(loc, "parent_id", None),
        submap_image_url=getattr(loc, "submap_image_url", None),
        created_at=loc.created_at,
    )


def _quest_out(quest: models.Quest, db: Session) -> schemas.QuestOut:
    links = db.query(models.QuestNPCLink).filter(models.QuestNPCLink.quest_id == quest.id).all()
    data = {col.name: getattr(quest, col.name) for col in models.Quest.__table__.columns}
    data['objectives']     = json.loads(data.get('objectives') or '[]')
    data['tags']           = json.loads(data.get('tags') or '[]')
    data['linked_npc_ids'] = [l.npc_id for l in links]
    return schemas.QuestOut.model_validate(data)


def _npc_out(npc: models.NPC, db: Session) -> schemas.NPCOut:
    links = db.query(models.QuestNPCLink).filter(models.QuestNPCLink.npc_id == npc.id).all()
    out = schemas.NPCOut.model_validate(npc)
    out.linked_quest_ids = [l.quest_id for l in links]
    return out


def _path_out(entry: models.PlayerPathEntry, db: Session) -> schemas.PathEntryOut:
    loc = db.query(models.Location).filter(models.Location.id == entry.location_id).first()
    return schemas.PathEntryOut(
        id=entry.id,
        location_id=entry.location_id,
        position=entry.position,
        travel_type=getattr(entry, "travel_type", None) or "foot",
        visited_at=entry.visited_at,
        location=_loc_out(loc) if loc else None,
    )


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── Campaign management ───────────────────────────────────────────────────────

class _CampaignIn(_BaseModel):
    name: str

class _CampaignOut(_BaseModel):
    slug: str
    name: str

@app.get("/campaigns", response_model=List[_CampaignOut])
def list_campaigns():
    results = []
    for db_file in sorted(database.CAMPAIGNS_DIR.glob("*.db")):
        slug = db_file.stem
        try:
            eng = database.get_engine_for_campaign(slug)
            with eng.connect() as conn:
                row = conn.execute(text("SELECT world_name FROM campaign_settings LIMIT 1")).fetchone()
                name = (row[0] or '').strip() or slug.replace('-', ' ').title()
        except Exception:
            name = slug.replace('-', ' ').title()
        results.append(_CampaignOut(slug=slug, name=name))
    return results

@app.post("/campaigns", response_model=_CampaignOut, status_code=201)
def create_campaign(data: _CampaignIn):
    slug = database.sanitize_slug(data.name)
    eng  = database.get_engine_for_campaign(slug)   # creates DB + runs migrations
    factory = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    db = factory()
    try:
        if not db.query(models.CampaignSettings).first():
            db.add(models.CampaignSettings(world_name=data.name))
            db.commit()
    finally:
        db.close()
    return _CampaignOut(slug=slug, name=data.name)

@app.put("/campaigns/{slug}/name", response_model=_CampaignOut)
def rename_campaign(slug: str, data: _CampaignIn):
    db_path = database.CAMPAIGNS_DIR / f"{slug}.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Campaign not found")
    eng = database.get_engine_for_campaign(slug)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    db = factory()
    try:
        c = db.query(models.CampaignSettings).first()
        if not c:
            c = models.CampaignSettings(world_name=data.name.strip())
            db.add(c)
        else:
            c.world_name = data.name.strip()
        db.commit()
    finally:
        db.close()
    return _CampaignOut(slug=slug, name=data.name.strip())


@app.delete("/campaigns/{slug}")
def delete_campaign(slug: str):
    if slug == 'default':
        raise HTTPException(status_code=400, detail="Cannot delete the default campaign")
    db_path = database.CAMPAIGNS_DIR / f"{slug}.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Campaign not found")
    database.invalidate_engine(slug)
    db_path.unlink()
    return {"deleted": slug}


# ── Locations ─────────────────────────────────────────────────────────────────

@app.get("/locations", response_model=List[schemas.LocationOut])
def list_locations(db: Session = Depends(get_db)):
    return [_loc_out(l) for l in db.query(models.Location).all()]


@app.post("/locations", response_model=schemas.LocationOut, status_code=201)
def create_location(data: schemas.LocationCreate, db: Session = Depends(get_db)):
    loc = models.Location(
        name=data.name,
        type=data.type,
        subtitle=data.subtitle,
        description=data.description,
        quest_hooks=json.dumps(data.quest_hooks),
        handouts=json.dumps(data.handouts),
        dm_notes=data.dm_notes,
        discovered=data.discovered,
        x=data.x,
        y=data.y,
        parent_id=data.parent_id,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return _loc_out(loc)


@app.put("/locations/{loc_id}", response_model=schemas.LocationOut)
def update_location(loc_id: int, data: schemas.LocationUpdate, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(loc, key, json.dumps(value) if key in ("quest_hooks", "handouts") else value)
    db.commit()
    db.refresh(loc)
    return _loc_out(loc)


@app.delete("/locations/{loc_id}")
def delete_location(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    db.delete(loc)
    db.query(models.PlayerPathEntry).filter(
        models.PlayerPathEntry.location_id == loc_id
    ).delete()
    db.commit()
    return {"deleted": loc_id}


# ── Location images & sub-maps ────────────────────────────────────────────────

@app.post("/locations/{loc_id}/image")
async def upload_location_image(loc_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    ext = Path(file.filename or "image").suffix or ".png"
    filename = f"loc_{loc_id}_img{ext}"
    with open(IMAGES_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    loc.image_url = f"/uploads/images/{filename}"
    db.commit()
    return {"image_url": loc.image_url}


@app.delete("/locations/{loc_id}/image")
def delete_location_image(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.image_url = None
    db.commit()
    return {"ok": True}


@app.post("/locations/{loc_id}/submap")
async def upload_location_submap(loc_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    ext = Path(file.filename or "submap").suffix or ".png"
    filename = f"submap_{loc_id}{ext}"
    with open(SUBMAPS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    loc.submap_image_url = f"/uploads/submaps/{filename}"
    db.commit()
    return {"submap_image_url": loc.submap_image_url}


@app.delete("/locations/{loc_id}/submap")
def delete_location_submap(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.submap_image_url = None
    db.commit()
    return {"ok": True}


# ── Location icon upload ──────────────────────────────────────────────────────

@app.post("/locations/{loc_id}/icon")
async def upload_location_icon(loc_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    ext = Path(file.filename or "icon").suffix or ".png"
    filename = f"loc_{loc_id}{ext}"
    with open(ICONS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    loc.icon_url = f"/uploads/icons/{filename}"
    db.commit()
    return {"icon_url": loc.icon_url}


@app.delete("/locations/{loc_id}/icon")
def delete_location_icon(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.icon_url = None
    db.commit()
    return {"ok": True}


# ── Player Path ───────────────────────────────────────────────────────────────

@app.get("/player-path", response_model=List[schemas.PathEntryOut])
def get_player_path(db: Session = Depends(get_db)):
    entries = (
        db.query(models.PlayerPathEntry)
        .order_by(models.PlayerPathEntry.position)
        .all()
    )
    return [_path_out(e, db) for e in entries]


@app.post("/player-path", response_model=schemas.PathEntryOut, status_code=201)
def add_to_path(data: schemas.PathEntryCreate, db: Session = Depends(get_db)):
    if not db.query(models.Location).filter(models.Location.id == data.location_id).first():
        raise HTTPException(status_code=404, detail="Location not found")
    pos = db.query(models.PlayerPathEntry).count()
    entry = models.PlayerPathEntry(location_id=data.location_id, position=pos, travel_type=data.travel_type)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _path_out(entry, db)


@app.delete("/player-path/{entry_id}")
def remove_from_path(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.PlayerPathEntry).filter(models.PlayerPathEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Path entry not found")
    db.delete(entry)
    db.commit()
    for i, e in enumerate(
        db.query(models.PlayerPathEntry).order_by(models.PlayerPathEntry.position).all()
    ):
        e.position = i
    db.commit()
    return {"deleted": entry_id}


class _TravelTypeUpdate(_BaseModel):
    travel_type: str

@app.patch("/player-path/{entry_id}", response_model=schemas.PathEntryOut)
def update_path_travel_type(entry_id: int, data: _TravelTypeUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.PlayerPathEntry).filter(models.PlayerPathEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Path entry not found")
    entry.travel_type = data.travel_type
    db.commit()
    db.refresh(entry)
    return _path_out(entry, db)


@app.put("/player-path/reorder", response_model=List[schemas.PathEntryOut])
def reorder_path(data: schemas.PathReorder, db: Session = Depends(get_db)):
    for i, entry_id in enumerate(data.order):
        entry = db.query(models.PlayerPathEntry).filter(
            models.PlayerPathEntry.id == entry_id
        ).first()
        if entry:
            entry.position = i
    db.commit()
    entries = (
        db.query(models.PlayerPathEntry)
        .order_by(models.PlayerPathEntry.position)
        .all()
    )
    return [_path_out(e, db) for e in entries]


# ── Character Paths ───────────────────────────────────────────────────────────

@app.get("/character-paths", response_model=List[schemas.CharacterPathEntryOut])
def list_all_character_paths(db: Session = Depends(get_db)):
    return db.query(models.CharacterPath).order_by(
        models.CharacterPath.party_member_id,
        models.CharacterPath.position,
    ).all()


@app.get("/character-paths/{member_id}", response_model=List[schemas.CharacterPathEntryOut])
def list_character_path(member_id: int, db: Session = Depends(get_db)):
    return db.query(models.CharacterPath).filter(
        models.CharacterPath.party_member_id == member_id
    ).order_by(models.CharacterPath.position).all()


@app.post("/character-paths/{member_id}", response_model=schemas.CharacterPathEntryOut, status_code=201)
def add_to_character_path(member_id: int, data: schemas.CharacterPathEntryCreate, db: Session = Depends(get_db)):
    max_pos = db.query(models.CharacterPath).filter(
        models.CharacterPath.party_member_id == member_id
    ).count()
    entry = models.CharacterPath(party_member_id=member_id, location_id=data.location_id, position=max_pos, travel_type=data.travel_type)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.patch("/character-paths/entry/{entry_id}", response_model=schemas.CharacterPathEntryOut)
def update_char_path_travel_type(entry_id: int, data: _TravelTypeUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.CharacterPath).filter(models.CharacterPath.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    entry.travel_type = data.travel_type
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/character-paths/entry/{entry_id}")
def remove_from_character_path(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.CharacterPath).filter(models.CharacterPath.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    member_id = entry.party_member_id
    db.delete(entry)
    db.commit()
    # Recompact positions
    for i, e in enumerate(
        db.query(models.CharacterPath)
        .filter(models.CharacterPath.party_member_id == member_id)
        .order_by(models.CharacterPath.position).all()
    ):
        e.position = i
    db.commit()
    return {"deleted": entry_id}


@app.put("/character-paths/{member_id}/reorder", response_model=List[schemas.CharacterPathEntryOut])
def reorder_character_path(member_id: int, data: schemas.CharacterPathReorder, db: Session = Depends(get_db)):
    for i, entry_id in enumerate(data.order):
        entry = db.query(models.CharacterPath).filter(models.CharacterPath.id == entry_id).first()
        if entry:
            entry.position = i
    db.commit()
    return db.query(models.CharacterPath).filter(
        models.CharacterPath.party_member_id == member_id
    ).order_by(models.CharacterPath.position).all()


@app.delete("/character-paths/{member_id}/clear")
def clear_character_path(member_id: int, db: Session = Depends(get_db)):
    db.query(models.CharacterPath).filter(
        models.CharacterPath.party_member_id == member_id
    ).delete()
    db.commit()
    return {"cleared": member_id}


# ── Map Config / Upload ───────────────────────────────────────────────────────

@app.get("/map-config")
def get_map_config(db: Session = Depends(get_db)):
    config = db.query(models.MapConfig).first()
    if not config:
        config = models.MapConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    has_file = config.image_filename and (UPLOADS_DIR / config.image_filename).exists()
    return {"image_url": f"/uploads/{config.image_filename}" if has_file else None}


@app.post("/map-config/upload")
async def upload_map(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    ext = Path(file.filename or "map.png").suffix or ".png"
    filename = f"world_map{ext}"
    with open(UPLOADS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    config = db.query(models.MapConfig).first()
    if not config:
        config = models.MapConfig(image_filename=filename)
        db.add(config)
    else:
        config.image_filename = filename
    db.commit()
    return {"image_url": f"/uploads/{filename}"}


# ── NPCs ──────────────────────────────────────────────────────────────────────

@app.get("/npcs", response_model=List[schemas.NPCOut])
def list_npcs(location_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.NPC)
    if location_id is not None:
        q = q.filter(models.NPC.location_id == location_id)
    return [_npc_out(n, db) for n in q.order_by(models.NPC.name).all()]


@app.post("/npcs", response_model=schemas.NPCOut, status_code=201)
def create_npc(data: schemas.NPCCreate, db: Session = Depends(get_db)):
    npc = models.NPC(**data.model_dump())
    db.add(npc)
    db.commit()
    db.refresh(npc)
    return _npc_out(npc, db)


@app.put("/npcs/{npc_id}", response_model=schemas.NPCOut)
def update_npc(npc_id: int, data: schemas.NPCUpdate, db: Session = Depends(get_db)):
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(npc, k, v)
    db.commit()
    db.refresh(npc)
    return _npc_out(npc, db)


@app.delete("/npcs/{npc_id}")
def delete_npc(npc_id: int, db: Session = Depends(get_db)):
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    # Remove all quest links for this NPC
    db.query(models.QuestNPCLink).filter(models.QuestNPCLink.npc_id == npc_id).delete()
    db.delete(npc)
    db.commit()
    return {"deleted": npc_id}


@app.post("/npcs/{npc_id}/portrait")
async def upload_portrait(npc_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    ext = Path(file.filename or "portrait").suffix or ".png"
    filename = f"npc_{npc_id}{ext}"
    with open(PORTRAITS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    npc.portrait_url = f"/uploads/portraits/{filename}"
    db.commit()
    return {"portrait_url": npc.portrait_url}


# ── Quests ────────────────────────────────────────────────────────────────────

@app.get("/quests", response_model=List[schemas.QuestOut])
def list_quests(db: Session = Depends(get_db)):
    return [_quest_out(q, db) for q in db.query(models.Quest).order_by(models.Quest.created_at).all()]


_QUEST_JSON_COLS = {"objectives", "tags"}

@app.post("/quests", response_model=schemas.QuestOut, status_code=201)
def create_quest(data: schemas.QuestCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    for col in _QUEST_JSON_COLS:
        d[col] = json.dumps(d.get(col) or [])
    quest = models.Quest(**d)
    db.add(quest)
    db.commit()
    db.refresh(quest)
    return _quest_out(quest, db)


@app.put("/quests/{quest_id}", response_model=schemas.QuestOut)
def update_quest(quest_id: int, data: schemas.QuestUpdate, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(quest, k, json.dumps(v) if k in _QUEST_JSON_COLS else v)
    db.commit()
    db.refresh(quest)
    return _quest_out(quest, db)


@app.delete("/quests/{quest_id}")
def delete_quest(quest_id: int, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    # Remove all NPC links for this quest
    db.query(models.QuestNPCLink).filter(models.QuestNPCLink.quest_id == quest_id).delete()
    db.delete(quest)
    db.commit()
    return {"deleted": quest_id}


# ── Quest ↔ NPC links ─────────────────────────────────────────────────────────

@app.post("/quests/{quest_id}/link-npc/{npc_id}", response_model=schemas.QuestOut)
def link_npc_to_quest(quest_id: int, npc_id: int, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    existing = db.query(models.QuestNPCLink).filter(
        models.QuestNPCLink.quest_id == quest_id,
        models.QuestNPCLink.npc_id == npc_id,
    ).first()
    if not existing:
        db.add(models.QuestNPCLink(quest_id=quest_id, npc_id=npc_id))
        db.commit()
    return _quest_out(quest, db)


@app.delete("/quests/{quest_id}/link-npc/{npc_id}", response_model=schemas.QuestOut)
def unlink_npc_from_quest(quest_id: int, npc_id: int, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    db.query(models.QuestNPCLink).filter(
        models.QuestNPCLink.quest_id == quest_id,
        models.QuestNPCLink.npc_id == npc_id,
    ).delete()
    db.commit()
    return _quest_out(quest, db)


@app.post("/quests/{quest_id}/image")
async def upload_quest_image(quest_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    ext = Path(file.filename or "image").suffix or ".png"
    filename = f"quest_{quest_id}_img{ext}"
    with open(IMAGES_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    quest.image_url = f"/uploads/images/{filename}"
    db.commit()
    return {"image_url": quest.image_url}


@app.delete("/quests/{quest_id}/image")
def delete_quest_image(quest_id: int, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    quest.image_url = None
    db.commit()
    return {"ok": True}


# ── Sessions ──────────────────────────────────────────────────────────────────

@app.get("/sessions", response_model=List[schemas.SessionOut])
def list_sessions(db: Session = Depends(get_db)):
    return db.query(models.SessionLog).order_by(models.SessionLog.session_number).all()


@app.post("/sessions", response_model=schemas.SessionOut, status_code=201)
def create_session(data: schemas.SessionCreate, db: Session = Depends(get_db)):
    entry = models.SessionLog(**data.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@app.put("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: int, data: schemas.SessionUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    db.commit()
    db.refresh(entry)
    return entry


@app.delete("/sessions/{session_id}")
def delete_session(session_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(entry)
    db.commit()
    return {"deleted": session_id}


@app.post("/sessions/{session_id}/image")
async def upload_session_image(session_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    ext = Path(file.filename or "image").suffix or ".png"
    filename = f"session_{session_id}_{uuid.uuid4().hex[:8]}{ext}"
    with open(IMAGES_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    entry.image_url = f"/uploads/images/{filename}"
    db.commit()
    return {"image_url": entry.image_url}


@app.delete("/sessions/{session_id}/image")
def delete_session_image(session_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    entry.image_url = None
    db.commit()
    return {"ok": True}


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/search")
def search(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    term = f"%{q}%"
    locations = (
        db.query(models.Location)
        .filter(models.Location.name.ilike(term) | models.Location.description.ilike(term))
        .limit(8).all()
    )
    npcs = (
        db.query(models.NPC)
        .filter(models.NPC.name.ilike(term) | models.NPC.role.ilike(term))
        .limit(8).all()
    )
    quests = (
        db.query(models.Quest)
        .filter(models.Quest.title.ilike(term) | models.Quest.description.ilike(term))
        .limit(8).all()
    )
    return {
        "locations": [_loc_out(l) for l in locations],
        "npcs": npcs,
        "quests": quests,
    }


# ── Campaign Settings ─────────────────────────────────────────────────────────

def _get_or_create_campaign(db: Session) -> models.CampaignSettings:
    c = db.query(models.CampaignSettings).first()
    if not c:
        c = models.CampaignSettings()
        db.add(c)
        db.commit()
        db.refresh(c)
    return c

@app.get("/campaign", response_model=schemas.CampaignOut)
def get_campaign(db: Session = Depends(get_db)):
    return _get_or_create_campaign(db)

@app.put("/campaign", response_model=schemas.CampaignOut)
def update_campaign(data: schemas.CampaignUpdate, db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


# ── Party Members ─────────────────────────────────────────────────────────────

@app.get("/party", response_model=List[schemas.PartyMemberOut])
def list_party(db: Session = Depends(get_db)):
    members = db.query(models.PartyMember).order_by(models.PartyMember.created_at).all()
    for m in members:
        m.conditions = json.loads(m.conditions or "[]")
    return members

@app.post("/party", response_model=schemas.PartyMemberOut, status_code=201)
def create_party_member(data: schemas.PartyMemberCreate, db: Session = Depends(get_db)):
    d = data.model_dump()
    d["conditions"] = json.dumps(d["conditions"])
    m = models.PartyMember(**d)
    db.add(m)
    db.commit()
    db.refresh(m)
    m.conditions = json.loads(m.conditions or "[]")
    return m

@app.put("/party/{member_id}", response_model=schemas.PartyMemberOut)
def update_party_member(member_id: int, data: schemas.PartyMemberUpdate, db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, json.dumps(v) if k == "conditions" else v)
    db.commit()
    db.refresh(m)
    m.conditions = json.loads(m.conditions or "[]")
    return m

@app.delete("/party/{member_id}")
def delete_party_member(member_id: int, db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    db.delete(m)
    db.commit()
    return {"deleted": member_id}


@app.post("/party/{member_id}/portrait")
async def upload_party_portrait(member_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    ext = Path(file.filename or "portrait").suffix or ".png"
    filename = f"party_{member_id}_{uuid.uuid4().hex[:8]}{ext}"
    with open(PORTRAITS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    m.portrait_url = f"/uploads/portraits/{filename}"
    db.commit()
    return {"portrait_url": m.portrait_url}


@app.delete("/party/{member_id}/portrait")
def delete_party_portrait(member_id: int, db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    m.portrait_url = None
    db.commit()
    return {"ok": True}


# ── Factions ──────────────────────────────────────────────────────────────────

@app.get("/factions", response_model=List[schemas.FactionOut])
def list_factions(db: Session = Depends(get_db)):
    return db.query(models.Faction).order_by(models.Faction.name).all()

@app.post("/factions", response_model=schemas.FactionOut, status_code=201)
def create_faction(data: schemas.FactionCreate, db: Session = Depends(get_db)):
    f = models.Faction(**data.model_dump())
    db.add(f)
    db.commit()
    db.refresh(f)
    return f

@app.put("/factions/{faction_id}", response_model=schemas.FactionOut)
def update_faction(faction_id: int, data: schemas.FactionUpdate, db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    db.refresh(f)
    return f

@app.delete("/factions/{faction_id}")
def delete_faction(faction_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    db.delete(f)
    db.commit()
    return {"deleted": faction_id}


@app.post("/factions/{faction_id}/image")
async def upload_faction_image(faction_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    ext = Path(file.filename or "image").suffix or ".png"
    filename = f"faction_{faction_id}_{uuid.uuid4().hex[:8]}{ext}"
    with open(IMAGES_DIR / filename, "wb") as f_file:
        shutil.copyfileobj(file.file, f_file)
    f.image_url = f"/uploads/images/{filename}"
    db.commit()
    return {"image_url": f.image_url}


@app.delete("/factions/{faction_id}/image")
def delete_faction_image(faction_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    f.image_url = None
    db.commit()
    return {"ok": True}


# ── Fog of War ────────────────────────────────────────────────────────────────

REVEALED_DEFAULT = "1" * 10000

def _get_or_create_fog(db: Session) -> models.FogOfWar:
    fog = db.query(models.FogOfWar).first()
    if not fog:
        fog = models.FogOfWar(data=REVEALED_DEFAULT)
        db.add(fog)
        db.commit()
        db.refresh(fog)
    return fog

@app.get("/fog")
def get_fog(db: Session = Depends(get_db)):
    fog = _get_or_create_fog(db)
    return {"data": fog.data or REVEALED_DEFAULT}

@app.put("/fog")
def update_fog(payload: schemas.FogUpdate, db: Session = Depends(get_db)):
    fog = _get_or_create_fog(db)
    fog.data = payload.data
    db.commit()
    return {"ok": True}

@app.post("/fog/reveal-all")
def fog_reveal_all(db: Session = Depends(get_db)):
    fog = _get_or_create_fog(db)
    fog.data = REVEALED_DEFAULT
    db.commit()
    return {"ok": True}

@app.post("/fog/hide-all")
def fog_hide_all(db: Session = Depends(get_db)):
    fog = _get_or_create_fog(db)
    fog.data = "0" * 10000
    db.commit()
    return {"ok": True}


# ── Calendar Config ───────────────────────────────────────────────────────────

DEFAULT_MONTHS = json.dumps([
    {"name": "Deepwinter",  "days": 30},
    {"name": "Alturiak",    "days": 30},
    {"name": "Ches",        "days": 30},
    {"name": "Tarsakh",     "days": 30},
    {"name": "Mirtul",      "days": 30},
    {"name": "Kythorn",     "days": 30},
    {"name": "Flamerule",   "days": 30},
    {"name": "Eleasis",     "days": 30},
    {"name": "Eleint",      "days": 30},
    {"name": "Marpenoth",   "days": 30},
    {"name": "Uktar",       "days": 30},
    {"name": "Nightal",     "days": 30},
])
DEFAULT_WEEKDAYS = json.dumps(["Firstday", "Secondday", "Thirday", "Fourthday", "Fifthday", "Sixthday", "Sevenday"])

def _get_or_create_calendar(db: Session) -> models.CalendarConfig:
    cal = db.query(models.CalendarConfig).first()
    if not cal:
        cal = models.CalendarConfig(
            months=DEFAULT_MONTHS,
            weekdays=DEFAULT_WEEKDAYS,
            year_name="DR",
        )
        db.add(cal)
        db.commit()
        db.refresh(cal)
    return cal

@app.get("/calendar-config", response_model=schemas.CalendarConfigOut)
def get_calendar_config(db: Session = Depends(get_db)):
    return _get_or_create_calendar(db)

@app.put("/calendar-config", response_model=schemas.CalendarConfigOut)
def update_calendar_config(data: schemas.CalendarConfigUpdate, db: Session = Depends(get_db)):
    cal = _get_or_create_calendar(db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(cal, k, v)
    db.commit()
    db.refresh(cal)
    return cal


# ── Handout upload ────────────────────────────────────────────────────────────

@app.post("/handouts/upload")
async def upload_handout(file: UploadFile = File(...)):
    stem = Path(file.filename or "handout").stem
    ext = Path(file.filename or "handout").suffix or ""
    safe_stem = re.sub(r"[^\w\-]", "_", stem)[:40]
    filename = f"{uuid.uuid4().hex[:8]}_{safe_stem}{ext}"
    with open(HANDOUTS_DIR / filename, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/uploads/handouts/{filename}", "name": file.filename or filename}


# ── Export / Import ───────────────────────────────────────────────────────────

@app.get("/export")
def export_data(db: Session = Depends(get_db)):
    locs = db.query(models.Location).all()
    path = (
        db.query(models.PlayerPathEntry)
        .order_by(models.PlayerPathEntry.position)
        .all()
    )
    return {
        "locations": [_loc_out(l).model_dump() for l in locs],
        "player_path": [
            {"id": e.id, "location_id": e.location_id, "position": e.position}
            for e in path
        ],
    }


@app.post("/import")
def import_data(payload: dict, db: Session = Depends(get_db)):
    db.query(models.PlayerPathEntry).delete()
    db.query(models.Location).delete()
    db.commit()

    id_map: dict[int, int] = {}
    for raw in payload.get("locations", []):
        old_id = raw.pop("id", None)
        raw.pop("created_at", None)
        loc = models.Location(
            **{
                k: json.dumps(v) if k in ("quest_hooks", "handouts") else v
                for k, v in raw.items()
            }
        )
        db.add(loc)
        db.flush()
        if old_id is not None:
            id_map[old_id] = loc.id

    for raw in payload.get("player_path", []):
        new_loc_id = id_map.get(raw.get("location_id"), raw.get("location_id"))
        db.add(models.PlayerPathEntry(location_id=new_loc_id, position=raw.get("position", 0)))

    db.commit()
    return {"imported": True}
