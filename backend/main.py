"""
D&D World Map — FastAPI backend
SQLite persistence via SQLAlchemy
"""

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import List, Optional, Set

from passlib.context import CryptContext

from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response as _Response
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

# Maps dir: lives alongside campaign DBs in DATA_DIR so it shares the same
# persistence characteristics — survives redeployments when DATA_DIR is on
# a persistent volume.
MAPS_DIR = _DATA_DIR / "maps"
MAPS_DIR.mkdir(parents=True, exist_ok=True)

# Library: committed to git next to main.py — survives redeployments
LIBRARY_DIR  = Path(__file__).parent / "library"
LIBRARY_DIR.mkdir(exist_ok=True)

logger = logging.getLogger(__name__)
_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

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

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/map-files", StaticFiles(directory=str(MAPS_DIR)), name="map-files")
app.mount("/library", StaticFiles(directory=str(LIBRARY_DIR)), name="library")


# ── WebSocket broadcast ───────────────────────────────────────────────────────

_ws_clients: Set[WebSocket] = set()

async def _broadcast(event: dict):
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception as exc:
            logger.debug("WebSocket send failed, dropping client: %s", exc)
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
        skip = ("/search", "/export", "/map-config", "/ws", "/handouts/push")
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
        icon_url=loc.icon_url,
        image_url=loc.image_url,
        parent_id=loc.parent_id,
        submap_image_url=loc.submap_image_url,
        pin_size=loc.pin_size or "md",
        pin_style=loc.pin_style or "default",
        pin_border=loc.pin_border or "none",
        pin_shape=loc.pin_shape or "circle",
        pin_glow=bool(loc.pin_glow),
        is_visible=bool(loc.is_visible) if loc.is_visible is not None else True,
        created_at=loc.created_at,
    )


def _quest_out(quest: models.Quest, db: Session, *, links: Optional[List[int]] = None) -> schemas.QuestOut:
    if links is None:
        links = [l.npc_id for l in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.quest_id == quest.id).all()]
    data = {col.name: getattr(quest, col.name) for col in models.Quest.__table__.columns}
    data['objectives']     = json.loads(data.get('objectives') or '[]')
    data['tags']           = json.loads(data.get('tags') or '[]')
    data['linked_npc_ids'] = links
    return schemas.QuestOut.model_validate(data)


def _npc_out(npc: models.NPC, db: Session, *, links: Optional[List[int]] = None) -> schemas.NPCOut:
    if links is None:
        links = [l.quest_id for l in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.npc_id == npc.id).all()]
    out = schemas.NPCOut.model_validate(npc)
    out.linked_quest_ids = links
    return out


def _path_out(entry: models.PlayerPathEntry, db: Session, *, loc: Optional[models.Location] = None) -> schemas.PathEntryOut:
    if loc is None:
        loc = db.query(models.Location).filter(models.Location.id == entry.location_id).first()
    return schemas.PathEntryOut(
        id=entry.id,
        location_id=entry.location_id,
        position=entry.position,
        travel_type=entry.travel_type or "foot",
        distance=entry.distance,
        distance_unit=entry.distance_unit,
        direction=entry.direction or "forward",
        waypoints=entry.waypoints,
        travel_time=entry.travel_time,
        travel_time_unit=entry.travel_time_unit,
        visited_at=entry.visited_at,
        location=_loc_out(loc) if loc else None,
    )


# ── Health check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


# ── DB-backed image storage ───────────────────────────────────────────────────
# Images are stored as binary blobs in the campaign SQLite DB so they survive
# redeployments without needing a persistent filesystem volume.

async def _store_image(file: UploadFile, slug: str, db: Session) -> str:
    """Read the uploaded file and persist it in the campaign DB. Returns serve URL."""
    image_id = uuid.uuid4().hex
    data = await file.read()
    content_type = file.content_type or "image/png"
    img = models.StoredImage(id=image_id, content_type=content_type, data=data)
    db.add(img)
    db.commit()
    return f"/img/{slug}/{image_id}"


def _delete_stored_image(url: str | None, db: Session) -> None:
    """If the url points to a DB-stored image, delete the blob."""
    if url and url.startswith("/img/"):
        parts = url.split("/")   # ['', 'img', slug, image_id]
        if len(parts) == 4:
            db.query(models.StoredImage).filter(models.StoredImage.id == parts[3]).delete()
            db.commit()


@app.get("/img/{slug}/{image_id}")
def serve_stored_image(slug: str, image_id: str):
    """Serve an image that was stored as a blob in the campaign DB."""
    from sqlalchemy.orm import sessionmaker as _sm
    engine = database.get_engine_for_campaign(slug)
    factory = _sm(autocommit=False, autoflush=False, bind=engine)
    db = factory()
    try:
        img = db.query(models.StoredImage).filter(models.StoredImage.id == image_id).first()
        if not img:
            raise HTTPException(status_code=404, detail="Image not found")
        return _Response(content=bytes(img.data), media_type=img.content_type)
    finally:
        db.close()


# ── Image library ─────────────────────────────────────────────────────────────

_IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico'}

@app.get("/library-list")
def list_library():
    """Return all image files committed to backend/library/."""
    try:
        files = sorted(
            [f for f in LIBRARY_DIR.iterdir() if f.is_file() and f.suffix.lower() in _IMAGE_EXTS],
            key=lambda f: f.name.lower(),
        )
    except OSError as exc:
        logger.warning("Failed to list library directory: %s", exc)
        files = []
    return [{"name": f.name, "url": f"/library/{f.name}"} for f in files]


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
        except Exception as exc:
            logger.warning("Could not read campaign name for %s: %s", slug, exc)
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

    # Collect all location IDs to delete (the location + all descendants)
    def _collect_ids(parent_id: int) -> list[int]:
        ids = [parent_id]
        children = db.query(models.Location.id).filter(models.Location.parent_id == parent_id).all()
        for (child_id,) in children:
            ids.extend(_collect_ids(child_id))
        return ids

    all_ids = _collect_ids(loc_id)

    # Clean up stored images for every location being deleted
    for lid in all_ids:
        doomed = db.query(models.Location).filter(models.Location.id == lid).first()
        if doomed:
            for url in (doomed.icon_url, doomed.image_url, doomed.submap_image_url):
                _delete_stored_image(url, db)

    # Cascade: path entries, character paths, NPC nullify location reference
    db.query(models.PlayerPathEntry).filter(
        models.PlayerPathEntry.location_id.in_(all_ids)
    ).delete(synchronize_session=False)
    db.query(models.CharacterPath).filter(
        models.CharacterPath.location_id.in_(all_ids)
    ).delete(synchronize_session=False)
    db.query(models.NPC).filter(
        models.NPC.location_id.in_(all_ids)
    ).update({"location_id": None}, synchronize_session=False)
    db.query(models.Quest).filter(
        models.Quest.location_id.in_(all_ids)
    ).update({"location_id": None}, synchronize_session=False)

    # Delete all the locations (children first via reverse order to satisfy any FK)
    for lid in reversed(all_ids):
        db.query(models.Location).filter(models.Location.id == lid).delete()

    db.commit()
    return {"deleted": loc_id}


# ── Location images & sub-maps ────────────────────────────────────────────────

@app.post("/locations/{loc_id}/image")
async def upload_location_image(loc_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.image_url, db)
    loc.image_url = await _store_image(file, slug, db)
    db.commit()
    return {"image_url": loc.image_url}


@app.delete("/locations/{loc_id}/image")
def delete_location_image(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.image_url, db)
    loc.image_url = None
    db.commit()
    return {"ok": True}


@app.post("/locations/{loc_id}/submap")
async def upload_location_submap(loc_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.submap_image_url, db)
    loc.submap_image_url = await _store_image(file, slug, db)
    db.commit()
    return {"submap_image_url": loc.submap_image_url}


@app.delete("/locations/{loc_id}/submap")
def delete_location_submap(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.submap_image_url, db)
    loc.submap_image_url = None
    db.commit()
    return {"ok": True}


# ── Location icon upload ──────────────────────────────────────────────────────

@app.post("/locations/{loc_id}/icon")
async def upload_location_icon(loc_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.icon_url, db)
    loc.icon_url = await _store_image(file, slug, db)
    db.commit()
    return {"icon_url": loc.icon_url}


@app.delete("/locations/{loc_id}/icon")
def delete_location_icon(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    _delete_stored_image(loc.icon_url, db)
    loc.icon_url = None
    db.commit()
    return {"ok": True}


# ── Player Path ───────────────────────────────────────────────────────────────

@app.get("/player-path", response_model=List[schemas.PathEntryOut])
def get_player_path(db: Session = Depends(get_db)):
    entries = db.query(models.PlayerPathEntry).order_by(models.PlayerPathEntry.position).all()
    if not entries:
        return []
    loc_ids = list({e.location_id for e in entries})
    locs = {l.id: l for l in db.query(models.Location).filter(models.Location.id.in_(loc_ids)).all()}
    return [_path_out(e, db, loc=locs.get(e.location_id)) for e in entries]


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


@app.patch("/player-path/{entry_id}", response_model=schemas.PathEntryOut)
def update_path_entry(entry_id: int, data: schemas.PathEntryUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.PlayerPathEntry).filter(models.PlayerPathEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Path entry not found")
    for field in data.model_fields_set:
        setattr(entry, field, getattr(data, field))
    db.commit()
    db.refresh(entry)
    return _path_out(entry, db)


@app.put("/player-path/reorder", response_model=List[schemas.PathEntryOut])
def reorder_path(data: schemas.PathReorder, db: Session = Depends(get_db)):
    for i, entry_id in enumerate(data.order):
        entry = db.query(models.PlayerPathEntry).filter(models.PlayerPathEntry.id == entry_id).first()
        if entry:
            entry.position = i
    db.commit()
    entries = db.query(models.PlayerPathEntry).order_by(models.PlayerPathEntry.position).all()
    if not entries:
        return []
    loc_ids = list({e.location_id for e in entries})
    locs = {l.id: l for l in db.query(models.Location).filter(models.Location.id.in_(loc_ids)).all()}
    return [_path_out(e, db, loc=locs.get(e.location_id)) for e in entries]


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
def update_char_path_entry(entry_id: int, data: schemas.CharacterPathEntryUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.CharacterPath).filter(models.CharacterPath.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    for field in data.model_fields_set:
        setattr(entry, field, getattr(data, field))
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

def _map_config_out(config: models.MapConfig) -> dict:
    """Build the map-config response dict from a MapConfig row."""
    fn = config.image_filename or ""
    if not fn:
        image_url = None
    elif fn.startswith("/img/"):
        image_url = fn
    elif (MAPS_DIR / fn).exists():
        image_url = f"/map-files/{fn}"
    elif (UPLOADS_DIR / fn).exists():
        image_url = f"/uploads/{fn}"
    else:
        image_url = None
    return {
        "image_url":   image_url,
        "scale_value": config.scale_value,
        "scale_unit":  config.scale_unit,
    }


@app.get("/map-config")
def get_map_config(slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    config = db.query(models.MapConfig).first()
    if not config:
        config = models.MapConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return _map_config_out(config)


@app.patch("/map-config")
def patch_map_config(data: schemas.MapConfigUpdate, db: Session = Depends(get_db)):
    config = db.query(models.MapConfig).first()
    if not config:
        config = models.MapConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    for field in data.model_fields_set:
        setattr(config, field, getattr(data, field))
    db.commit()
    return _map_config_out(config)


@app.post("/map-config/upload")
async def upload_map(file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    config = db.query(models.MapConfig).first()
    if config:
        _delete_stored_image(
            config.image_filename if config.image_filename and config.image_filename.startswith("/img/") else None,
            db,
        )
    url = await _store_image(file, slug, db)
    if not config:
        config = models.MapConfig(image_filename=url)
        db.add(config)
    else:
        config.image_filename = url
    db.commit()
    return _map_config_out(config)


# ── NPCs ──────────────────────────────────────────────────────────────────────

@app.get("/npcs", response_model=List[schemas.NPCOut])
def list_npcs(location_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.NPC)
    if location_id is not None:
        q = q.filter(models.NPC.location_id == location_id)
    npcs = q.order_by(models.NPC.name).all()
    if not npcs:
        return []
    npc_ids = [n.id for n in npcs]
    links_by_npc: dict[int, List[int]] = {}
    for lnk in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.npc_id.in_(npc_ids)).all():
        links_by_npc.setdefault(lnk.npc_id, []).append(lnk.quest_id)
    return [_npc_out(n, db, links=links_by_npc.get(n.id, [])) for n in npcs]


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
async def upload_portrait(npc_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    _delete_stored_image(npc.portrait_url, db)
    npc.portrait_url = await _store_image(file, slug, db)
    db.commit()
    return {"portrait_url": npc.portrait_url}

@app.delete("/npcs/{npc_id}/portrait")
def delete_npc_portrait(npc_id: int, db: Session = Depends(get_db)):
    npc = db.query(models.NPC).filter(models.NPC.id == npc_id).first()
    if not npc:
        raise HTTPException(status_code=404, detail="NPC not found")
    _delete_stored_image(npc.portrait_url, db)
    npc.portrait_url = None
    db.commit()
    return {"ok": True}


# ── Quests ────────────────────────────────────────────────────────────────────

@app.get("/quests", response_model=List[schemas.QuestOut])
def list_quests(db: Session = Depends(get_db)):
    quests = db.query(models.Quest).order_by(models.Quest.created_at).all()
    if not quests:
        return []
    quest_ids = [q.id for q in quests]
    links_by_quest: dict[int, List[int]] = {}
    for lnk in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.quest_id.in_(quest_ids)).all():
        links_by_quest.setdefault(lnk.quest_id, []).append(lnk.npc_id)
    return [_quest_out(q, db, links=links_by_quest.get(q.id, [])) for q in quests]


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
async def upload_quest_image(quest_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    _delete_stored_image(quest.image_url, db)
    quest.image_url = await _store_image(file, slug, db)
    db.commit()
    return {"image_url": quest.image_url}


@app.delete("/quests/{quest_id}/image")
def delete_quest_image(quest_id: int, db: Session = Depends(get_db)):
    quest = db.query(models.Quest).filter(models.Quest.id == quest_id).first()
    if not quest:
        raise HTTPException(status_code=404, detail="Quest not found")
    _delete_stored_image(quest.image_url, db)
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
async def upload_session_image(session_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    _delete_stored_image(entry.image_url, db)
    entry.image_url = await _store_image(file, slug, db)
    db.commit()
    return {"image_url": entry.image_url}


@app.delete("/sessions/{session_id}/image")
def delete_session_image(session_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.SessionLog).filter(models.SessionLog.id == session_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Session not found")
    _delete_stored_image(entry.image_url, db)
    entry.image_url = None
    db.commit()
    return {"ok": True}


# ── Search ────────────────────────────────────────────────────────────────────

@app.get("/search")
def search(q: str = Query(..., min_length=1, max_length=100), db: Session = Depends(get_db)):
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
    npc_ids = [n.id for n in npcs]
    quest_ids = [qr.id for qr in quests]
    npc_links: dict[int, List[int]] = {}
    quest_links: dict[int, List[int]] = {}
    if npc_ids:
        for lnk in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.npc_id.in_(npc_ids)).all():
            npc_links.setdefault(lnk.npc_id, []).append(lnk.quest_id)
    if quest_ids:
        for lnk in db.query(models.QuestNPCLink).filter(models.QuestNPCLink.quest_id.in_(quest_ids)).all():
            quest_links.setdefault(lnk.quest_id, []).append(lnk.npc_id)
    return {
        "locations": [_loc_out(l) for l in locations],
        "npcs":      [_npc_out(n, db, links=npc_links.get(n.id, [])) for n in npcs],
        "quests":    [_quest_out(qr, db, links=quest_links.get(qr.id, [])) for qr in quests],
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

@app.post("/campaign/camp-map")
async def upload_camp_map(file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    _delete_stored_image(c.camp_map_url, db)
    c.camp_map_url = await _store_image(file, slug, db)
    db.commit()
    return {"camp_map_url": c.camp_map_url}

@app.delete("/campaign/camp-map")
def delete_camp_map(db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    _delete_stored_image(c.camp_map_url, db)
    c.camp_map_url = None
    db.commit()
    return {"ok": True}


# ── DM Passcode (server-side, shared across all devices) ─────────────────────

@app.get("/dm-passcode-status")
def dm_passcode_status(db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    return {"has_passcode": bool(c.dm_passcode)}

@app.post("/verify-dm-passcode")
def verify_dm_passcode(data: schemas.PasscodeVerify, db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    if not c.dm_passcode:
        return {"ok": True}
    stored = c.dm_passcode
    # Migrate legacy plaintext passcodes to bcrypt on first successful verify
    if stored.startswith("$2b$") or stored.startswith("$2a$"):
        ok = _pwd.verify(data.passcode, stored)
    else:
        ok = data.passcode == stored
        if ok:
            c.dm_passcode = _pwd.hash(data.passcode)
            db.commit()
    if ok:
        return {"ok": True}
    raise HTTPException(status_code=401, detail="Incorrect passcode")

@app.post("/set-dm-passcode")
def set_dm_passcode(data: schemas.PasscodeSet, db: Session = Depends(get_db)):
    c = _get_or_create_campaign(db)
    passcode = data.passcode.strip()
    c.dm_passcode = _pwd.hash(passcode) if passcode else None
    db.commit()
    return {"ok": True}


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
async def upload_party_portrait(member_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    _delete_stored_image(m.portrait_url, db)
    m.portrait_url = await _store_image(file, slug, db)
    db.commit()
    return {"portrait_url": m.portrait_url}


@app.delete("/party/{member_id}/portrait")
def delete_party_portrait(member_id: int, db: Session = Depends(get_db)):
    m = db.query(models.PartyMember).filter(models.PartyMember.id == member_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Party member not found")
    _delete_stored_image(m.portrait_url, db)
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
async def upload_faction_image(faction_id: int, file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    _delete_stored_image(f.image_url, db)
    f.image_url = await _store_image(file, slug, db)
    db.commit()
    return {"image_url": f.image_url}


@app.delete("/factions/{faction_id}/image")
def delete_faction_image(faction_id: int, db: Session = Depends(get_db)):
    f = db.query(models.Faction).filter(models.Faction.id == faction_id).first()
    if not f:
        raise HTTPException(status_code=404, detail="Faction not found")
    _delete_stored_image(f.image_url, db)
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


# ── Per-location (submap) fog ─────────────────────────────────────────────────

_FOG_REVEALED = "1" * 10000

@app.get("/locations/{loc_id}/fog")
def get_location_fog(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"data": getattr(loc, "fog_data", None) or _FOG_REVEALED}

@app.put("/locations/{loc_id}/fog")
def update_location_fog(loc_id: int, payload: schemas.FogUpdate, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.fog_data = payload.data
    db.commit()
    return {"ok": True}

@app.post("/locations/{loc_id}/fog/reveal-all")
def reveal_location_fog(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.fog_data = _FOG_REVEALED
    db.commit()
    return {"ok": True}

@app.post("/locations/{loc_id}/fog/hide-all")
def hide_location_fog(loc_id: int, db: Session = Depends(get_db)):
    loc = db.query(models.Location).filter(models.Location.id == loc_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    loc.fog_data = "0" * 10000
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
DEFAULT_WEEKDAYS = json.dumps(["Firstday", "Secondday", "Thirdday", "Fourthday", "Fifthday", "Sixthday", "Sevenday"])

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
async def upload_handout(file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    original_name = file.filename or "handout"
    url = await _store_image(file, slug, db)
    return {"url": url, "name": original_name}


@app.post("/handouts/push")
async def push_handout(data: schemas.HandoutPush, slug: str = Depends(database.get_campaign_slug)):
    await _broadcast({"type": "handout", "url": data.url, "name": data.name})
    return {"ok": True}


# ── Export / Import ───────────────────────────────────────────────────────────

@app.get("/export")
def export_data(db: Session = Depends(get_db)):
    from datetime import datetime as _dt

    def _enc(url: str | None) -> str | None:
        """Return image bytes as 'content_type,base64'. Reads from DB blob or filesystem."""
        if not url:
            return None
        # DB-stored image: /img/{slug}/{id}
        if url.startswith("/img/"):
            parts = url.split("/")
            if len(parts) == 4:
                img = db.query(models.StoredImage).filter(models.StoredImage.id == parts[3]).first()
                if img:
                    return img.content_type + "," + base64.b64encode(bytes(img.data)).decode()
            return None
        # Legacy filesystem image
        path = _DATA_DIR / url.lstrip("/")
        try:
            ext = Path(url).suffix.lower()
            ct = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                  "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"}.get(ext.lstrip("."), "image/png")
            return ct + "," + base64.b64encode(path.read_bytes()).decode()
        except OSError as exc:
            logger.warning("Could not read image file for export %s: %s", url, exc)
            return None

    def _row(obj, model) -> dict:
        return {col.name: getattr(obj, col.name) for col in model.__table__.columns}

    # Locations
    locations_out = []
    for l in db.query(models.Location).all():
        d = _row(l, models.Location)
        d['quest_hooks'] = json.loads(d.get('quest_hooks') or '[]')
        d['handouts']    = json.loads(d.get('handouts')    or '[]')
        d['created_at']  = l.created_at.isoformat() if l.created_at else None
        d['_icon_data']   = _enc(l.icon_url)
        d['_image_data']  = _enc(l.image_url)
        d['_submap_data'] = _enc(l.submap_image_url)
        locations_out.append(d)

    # Player path
    player_path_out = []
    for e in db.query(models.PlayerPathEntry).order_by(models.PlayerPathEntry.position).all():
        d = _row(e, models.PlayerPathEntry)
        d['visited_at'] = e.visited_at.isoformat() if e.visited_at else None
        player_path_out.append(d)

    # NPCs
    npcs_out = []
    for n in db.query(models.NPC).all():
        d = _row(n, models.NPC)
        d['created_at']     = n.created_at.isoformat() if n.created_at else None
        d['_portrait_data'] = _enc(n.portrait_url)
        npcs_out.append(d)

    # Quests
    quests_out = []
    for q in db.query(models.Quest).all():
        d = _row(q, models.Quest)
        d['objectives'] = json.loads(d.get('objectives') or '[]')
        d['tags']       = json.loads(d.get('tags')       or '[]')
        d['created_at'] = q.created_at.isoformat() if q.created_at else None
        d['_image_data'] = _enc(q.image_url)
        quests_out.append(d)

    # Quest↔NPC links
    links_out = [
        {'quest_id': l.quest_id, 'npc_id': l.npc_id}
        for l in db.query(models.QuestNPCLink).all()
    ]

    # Sessions
    sessions_out = []
    for s in db.query(models.SessionLog).all():
        d = _row(s, models.SessionLog)
        d['created_at']  = s.created_at.isoformat() if s.created_at else None
        d['_image_data'] = _enc(s.image_url)
        sessions_out.append(d)

    # Party members
    party_out = []
    for p in db.query(models.PartyMember).all():
        d = _row(p, models.PartyMember)
        d['conditions']     = json.loads(d.get('conditions') or '[]')
        d['created_at']     = p.created_at.isoformat() if p.created_at else None
        d['_portrait_data'] = _enc(p.portrait_url)
        party_out.append(d)

    # Factions
    factions_out = []
    for f in db.query(models.Faction).all():
        d = _row(f, models.Faction)
        d['created_at']  = f.created_at.isoformat() if f.created_at else None
        d['_image_data'] = _enc(f.image_url)
        factions_out.append(d)

    # Character paths
    char_paths_out = []
    for c in db.query(models.CharacterPath).order_by(
        models.CharacterPath.party_member_id, models.CharacterPath.position
    ).all():
        d = _row(c, models.CharacterPath)
        d['visited_at'] = c.visited_at.isoformat() if c.visited_at else None
        char_paths_out.append(d)

    # Campaign settings
    camp = db.query(models.CampaignSettings).first()
    campaign_out = _row(camp, models.CampaignSettings) if camp else {}
    if camp:
        campaign_out['_camp_map_data'] = _enc(getattr(camp, 'camp_map_url', None))

    # Calendar config
    cal = db.query(models.CalendarConfig).first()
    calendar_out = _row(cal, models.CalendarConfig) if cal else {}

    # Fog of war
    fog = db.query(models.FogOfWar).first()
    fog_out = fog.data if fog else ""

    # Map config — image_filename may now be a /img/ URL or a legacy filename
    map_cfg = db.query(models.MapConfig).first()
    map_filename = (map_cfg.image_filename or "") if map_cfg else ""
    map_url_for_enc = map_filename if map_filename.startswith("/img/") else (
        f"/maps/{map_filename}" if map_filename and (MAPS_DIR / map_filename).exists() else
        f"/uploads/{map_filename}" if map_filename and (UPLOADS_DIR / map_filename).exists() else None
    )
    map_out = {
        "image_filename": map_filename,
        "_image_data":    _enc(map_url_for_enc),
        "scale_value":    getattr(map_cfg, "scale_value", None) if map_cfg else None,
        "scale_unit":     getattr(map_cfg, "scale_unit",  None) if map_cfg else None,
    }

    return {
        "_version": 2,
        "_exported_at": _dt.utcnow().isoformat() + "Z",
        "campaign_settings": campaign_out,
        "calendar_config":   calendar_out,
        "map_config":        map_out,
        "fog_of_war":        fog_out,
        "locations":         locations_out,
        "npcs":              npcs_out,
        "quests":            quests_out,
        "quest_npc_links":   links_out,
        "sessions":          sessions_out,
        "party_members":     party_out,
        "factions":          factions_out,
        "player_path":       player_path_out,
        "character_paths":   char_paths_out,
    }


@app.post("/import")
async def import_data(file: UploadFile = File(...), slug: str = Depends(database.get_campaign_slug), db: Session = Depends(get_db)):
    payload: dict = json.loads(await file.read())
    def _restore(encoded: str | None) -> str | None:
        """Store exported image data as a DB blob. Returns new /img/ URL, or None."""
        if not encoded:
            return None
        # Format: "content_type,base64data"
        if "," in encoded:
            ct, b64 = encoded.split(",", 1)
        else:
            ct, b64 = "image/png", encoded
        try:
            data = base64.b64decode(b64)
        except ValueError as exc:
            logger.warning("Invalid base64 image data during import: %s", exc)
            return None
        new_id = uuid.uuid4().hex
        db.add(models.StoredImage(id=new_id, content_type=ct, data=data))
        return f"/img/{slug}/{new_id}"

    # ── Wipe all tables (dependency-safe order) ────────────────────────────────
    db.query(models.QuestNPCLink).delete()
    db.query(models.CharacterPath).delete()
    db.query(models.PlayerPathEntry).delete()
    db.query(models.Quest).delete()
    db.query(models.NPC).delete()
    db.query(models.SessionLog).delete()
    db.query(models.Faction).delete()
    db.query(models.Location).delete()
    db.query(models.PartyMember).delete()
    db.query(models.FogOfWar).delete()
    db.query(models.MapConfig).delete()
    db.query(models.CampaignSettings).delete()
    db.query(models.CalendarConfig).delete()
    db.query(models.StoredImage).delete()
    db.commit()

    # ── Campaign settings ──────────────────────────────────────────────────────
    cs = payload.get("campaign_settings") or {}
    if cs:
        cols = {c.name for c in models.CampaignSettings.__table__.columns}
        cs_filtered = {k: v for k, v in cs.items() if k in cols}
        camp_map_restored = _restore(cs.get("_camp_map_data"))
        if camp_map_restored:
            cs_filtered['camp_map_url'] = camp_map_restored
        db.add(models.CampaignSettings(**cs_filtered))

    # ── Calendar config ────────────────────────────────────────────────────────
    cal = payload.get("calendar_config") or {}
    if cal:
        cols = {c.name for c in models.CalendarConfig.__table__.columns}
        db.add(models.CalendarConfig(**{k: v for k, v in cal.items() if k in cols}))

    # ── Map config ─────────────────────────────────────────────────────────────
    map_raw = payload.get("map_config") or {}
    map_url = _restore(map_raw.get("_image_data"))
    if map_url is None and map_raw.get("image_filename"):
        fn = map_raw["image_filename"]
        # Only preserve legacy filesystem filenames; /img/ URLs belong to the
        # source campaign's DB and are meaningless in the destination campaign.
        if not fn.startswith("/img/"):
            map_url = fn
    if map_url or map_raw.get("scale_value") is not None:
        db.add(models.MapConfig(
            image_filename=map_url or "",
            scale_value=map_raw.get("scale_value"),
            scale_unit=map_raw.get("scale_unit"),
        ))

    # ── Fog of war ─────────────────────────────────────────────────────────────
    fog_str = payload.get("fog_of_war") or ""
    if fog_str:
        db.add(models.FogOfWar(data=fog_str))

    # ── Locations ─────────────────────────────────────────────────────────────
    for d in payload.get("locations", []):
        icon_url     = _restore(d.get("_icon_data"))
        image_url    = _restore(d.get("_image_data"))
        submap_url   = _restore(d.get("_submap_data"))
        db.add(models.Location(
            id=d["id"],
            name=d["name"],
            type=d.get("type", "city"),
            subtitle=d.get("subtitle", ""),
            description=d.get("description", ""),
            quest_hooks=json.dumps(d.get("quest_hooks", [])),
            handouts=json.dumps(d.get("handouts", [])),
            dm_notes=d.get("dm_notes", ""),
            discovered=d.get("discovered", False),
            x=d["x"], y=d["y"],
            icon_url=icon_url,
            image_url=image_url,
            parent_id=d.get("parent_id"),
            submap_image_url=submap_url,
            fog_data=d.get("fog_data"),
            pin_size=d.get("pin_size") or "md",
            pin_style=d.get("pin_style") or "default",
            pin_border=d.get("pin_border") or "none",
            pin_shape=d.get("pin_shape") or "circle",
            pin_glow=bool(d.get("pin_glow", False)),
            is_visible=d.get("is_visible", True),
            scale_value=d.get("scale_value"),
            scale_unit=d.get("scale_unit"),
        ))

    # ── Party members ──────────────────────────────────────────────────────────
    for d in payload.get("party_members", []):
        portrait_url = _restore(d.get("_portrait_data"))
        db.add(models.PartyMember(
            id=d["id"],
            name=d["name"],
            player_name=d.get("player_name", ""),
            class_name=d.get("class_name", ""),
            race=d.get("race", ""),
            level=d.get("level", 1),
            hp_current=d.get("hp_current", 0),
            hp_max=d.get("hp_max", 0),
            ac=d.get("ac", 10),
            conditions=json.dumps(d.get("conditions", [])),
            notes=d.get("notes", ""),
            portrait_url=portrait_url,
            path_color=d.get("path_color", "#c9a84c"),
        ))

    # ── NPCs ───────────────────────────────────────────────────────────────────
    for d in payload.get("npcs", []):
        portrait_url = _restore(d.get("_portrait_data"))
        db.add(models.NPC(
            id=d["id"],
            location_id=d.get("location_id"),
            name=d["name"],
            role=d.get("role", ""),
            status=d.get("status", "alive"),
            notes=d.get("notes", ""),
            portrait_url=portrait_url,
            is_visible=d.get("is_visible", True),
        ))

    # ── Factions ───────────────────────────────────────────────────────────────
    for d in payload.get("factions", []):
        image_url = _restore(d.get("_image_data"))
        db.add(models.Faction(
            id=d["id"],
            name=d["name"],
            description=d.get("description", ""),
            reputation=d.get("reputation", 0),
            notes=d.get("notes", ""),
            color=d.get("color", "#888888"),
            image_url=image_url,
            is_visible=d.get("is_visible", True),
        ))

    # ── Sessions ───────────────────────────────────────────────────────────────
    for d in payload.get("sessions", []):
        image_url = _restore(d.get("_image_data"))
        db.add(models.SessionLog(
            id=d["id"],
            session_number=d["session_number"],
            title=d.get("title", ""),
            in_world_date=d.get("in_world_date", ""),
            real_date=d.get("real_date", ""),
            summary=d.get("summary", ""),
            xp_awarded=d.get("xp_awarded", 0),
            loot_notes=d.get("loot_notes", ""),
            image_url=image_url,
            is_visible=d.get("is_visible", True),
        ))

    db.flush()  # IDs must exist before quest foreign keys resolve

    # ── Quests ─────────────────────────────────────────────────────────────────
    for d in payload.get("quests", []):
        image_url = _restore(d.get("_image_data"))
        db.add(models.Quest(
            id=d["id"],
            title=d["title"],
            status=d.get("status", "active"),
            tier=d.get("tier", "side"),
            description=d.get("description", ""),
            location_id=d.get("location_id"),
            notes=d.get("notes", ""),
            image_url=image_url,
            objectives=json.dumps(d.get("objectives", [])),
            quest_giver_id=d.get("quest_giver_id"),
            reward_gold=d.get("reward_gold", 0),
            reward_notes=d.get("reward_notes", ""),
            deadline=d.get("deadline", ""),
            tags=json.dumps(d.get("tags", [])),
            parent_quest_id=d.get("parent_quest_id"),
            faction_id=d.get("faction_id"),
            started_session_id=d.get("started_session_id"),
            completed_session_id=d.get("completed_session_id"),
            is_visible=d.get("is_visible", True),
        ))

    db.flush()

    # ── Quest↔NPC links ────────────────────────────────────────────────────────
    for d in payload.get("quest_npc_links", []):
        db.add(models.QuestNPCLink(quest_id=d["quest_id"], npc_id=d["npc_id"]))

    # ── Player path ────────────────────────────────────────────────────────────
    for d in payload.get("player_path", []):
        db.add(models.PlayerPathEntry(
            id=d["id"],
            location_id=d["location_id"],
            position=d["position"],
            travel_type=d.get("travel_type", "foot"),
            distance=d.get("distance"),
            distance_unit=d.get("distance_unit"),
            direction=d.get("direction", "forward"),
            waypoints=d.get("waypoints"),
            travel_time=d.get("travel_time"),
            travel_time_unit=d.get("travel_time_unit"),
        ))

    # ── Character paths ────────────────────────────────────────────────────────
    for d in payload.get("character_paths", []):
        db.add(models.CharacterPath(
            id=d["id"],
            party_member_id=d["party_member_id"],
            location_id=d["location_id"],
            position=d["position"],
            travel_type=d.get("travel_type", "foot"),
            distance=d.get("distance"),
            distance_unit=d.get("distance_unit"),
            direction=d.get("direction", "forward"),
            waypoints=d.get("waypoints"),
            travel_time=d.get("travel_time"),
            travel_time_unit=d.get("travel_time_unit"),
        ))

    db.commit()
    return {"imported": True}


# ── Loot Items ────────────────────────────────────────────────────────────────

@app.get("/loot", response_model=List[schemas.LootItemOut])
def list_loot(db: Session = Depends(get_db)):
    return db.query(models.LootItem).order_by(models.LootItem.created_at).all()


@app.post("/loot", response_model=schemas.LootItemOut, status_code=201)
def create_loot(data: schemas.LootItemCreate, db: Session = Depends(get_db)):
    item = models.LootItem(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@app.put("/loot/{item_id}", response_model=schemas.LootItemOut)
def update_loot(item_id: int, data: schemas.LootItemUpdate, db: Session = Depends(get_db)):
    item = db.query(models.LootItem).filter(models.LootItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Loot item not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@app.delete("/loot/{item_id}")
def delete_loot(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.LootItem).filter(models.LootItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Loot item not found")
    db.delete(item)
    db.commit()
    return {"deleted": item_id}


# ── Rumours ───────────────────────────────────────────────────────────────────

@app.get("/rumours", response_model=List[schemas.RumourOut])
def list_rumours(db: Session = Depends(get_db)):
    return db.query(models.Rumour).order_by(models.Rumour.created_at).all()


@app.post("/rumours", response_model=schemas.RumourOut, status_code=201)
def create_rumour(data: schemas.RumourCreate, db: Session = Depends(get_db)):
    rumour = models.Rumour(**data.model_dump())
    db.add(rumour)
    db.commit()
    db.refresh(rumour)
    return rumour


@app.put("/rumours/{rumour_id}", response_model=schemas.RumourOut)
def update_rumour(rumour_id: int, data: schemas.RumourUpdate, db: Session = Depends(get_db)):
    rumour = db.query(models.Rumour).filter(models.Rumour.id == rumour_id).first()
    if not rumour:
        raise HTTPException(status_code=404, detail="Rumour not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(rumour, k, v)
    db.commit()
    db.refresh(rumour)
    return rumour


@app.delete("/rumours/{rumour_id}")
def delete_rumour(rumour_id: int, db: Session = Depends(get_db)):
    rumour = db.query(models.Rumour).filter(models.Rumour.id == rumour_id).first()
    if not rumour:
        raise HTTPException(status_code=404, detail="Rumour not found")
    db.delete(rumour)
    db.commit()
    return {"deleted": rumour_id}


# ── Relationship Web ──────────────────────────────────────────────────────────

@app.get("/relationships/edges", response_model=list[schemas.RelationshipEdgeOut])
def list_relationship_edges(db: Session = Depends(get_db)):
    return db.query(models.RelationshipEdge).all()

@app.post("/relationships/edges", response_model=schemas.RelationshipEdgeOut, status_code=201)
def create_relationship_edge(data: schemas.RelationshipEdgeCreate, db: Session = Depends(get_db)):
    edge = models.RelationshipEdge(**data.model_dump())
    db.add(edge)
    db.commit()
    db.refresh(edge)
    return edge

@app.patch("/relationships/edges/{edge_id}", response_model=schemas.RelationshipEdgeOut)
def patch_relationship_edge(edge_id: int, data: dict, db: Session = Depends(get_db)):
    edge = db.query(models.RelationshipEdge).filter(models.RelationshipEdge.id == edge_id).first()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    if "active" in data:
        edge.active = data["active"]
    if "label" in data:
        edge.label = data["label"]
    db.commit()
    db.refresh(edge)
    return edge

@app.delete("/relationships/edges/{edge_id}")
def delete_relationship_edge(edge_id: int, db: Session = Depends(get_db)):
    edge = db.query(models.RelationshipEdge).filter(models.RelationshipEdge.id == edge_id).first()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    db.delete(edge)
    db.commit()
    return {"deleted": edge_id}

@app.get("/relationships/positions", response_model=list[schemas.RelationshipNodePosOut])
def list_relationship_positions(db: Session = Depends(get_db)):
    return db.query(models.RelationshipNodePos).all()

@app.post("/relationships/positions", response_model=schemas.RelationshipNodePosOut)
def upsert_relationship_position(data: schemas.RelationshipNodePosUpsert, db: Session = Depends(get_db)):
    pos = db.query(models.RelationshipNodePos).filter(
        models.RelationshipNodePos.entity_type == data.entity_type,
        models.RelationshipNodePos.entity_id   == data.entity_id,
    ).first()
    if pos:
        pos.x = data.x
        pos.y = data.y
    else:
        pos = models.RelationshipNodePos(**data.model_dump())
        db.add(pos)
    db.commit()
    db.refresh(pos)
    return pos

@app.delete("/relationships/positions/{entity_type}/{entity_id}")
def delete_relationship_position(entity_type: str, entity_id: int, db: Session = Depends(get_db)):
    pos = db.query(models.RelationshipNodePos).filter(
        models.RelationshipNodePos.entity_type == entity_type,
        models.RelationshipNodePos.entity_id   == entity_id,
    ).first()
    if pos:
        db.delete(pos)
        db.commit()
    return {"deleted": True}
