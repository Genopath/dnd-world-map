# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (run from `backend/`)
```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend (run from `frontend/`)
```bash
npm install
npm run dev          # starts on http://localhost:3000
```

Both must run simultaneously. Backend on 8000, frontend on 3000.

## Architecture

**Backend** (`backend/`) — FastAPI + SQLAlchemy + SQLite (`map.db`, auto-created):
- `database.py` — engine, `SessionLocal`, `Base`, `get_db` dependency
- `models.py` — three tables: `Location`, `PlayerPathEntry`, `MapConfig`
- `schemas.py` — Pydantic v2 models (request/response); `LocationCreate`/`LocationUpdate`/`LocationOut`, `PathEntryOut`, `PathReorder`
- `main.py` — all routes; JSON arrays (`quest_hooks`, `handouts`) are stored as JSON strings in SQLite and serialized/deserialized in `_loc_out()` helper

**Frontend** (`frontend/`) — Next.js 14 (pages router), TypeScript, no UI library:
- `types/index.ts` — shared `Location`, `PathEntry`, `MapConfig` interfaces
- `lib/api.ts` — all `fetch` calls; exports `API_BASE` (default `http://localhost:8000`)
- `pages/index.tsx` — single-page app; owns all state (`locations`, `playerPath`, `mapConfig`, `selectedId`, `isDMMode`, `isAddingPin`, `sidebarTab`)
- `components/MapView.tsx` — pan/zoom via CSS `transform: translate(x,y) scale(s)`; wheel zoom around cursor; pins are absolutely positioned at `{left: x%, top: y%}` with `transform: translate(-50%,-50%)`; SVG overlay draws dashed path lines using `x1="X%"` percentage attributes
- `components/Sidebar.tsx` — two tabs ("Location" / "Player Path"); location tab has view/edit toggle; edit form converts `quest_hooks`/`handouts` arrays to newline-separated textarea and back on save

**DM vs Player mode** — entirely client-side: player mode filters `!discovered` locations before passing to `MapView`; DM Notes section only rendered when `isDMMode` is true. No auth.

**Map image** — uploaded via `POST /map-config/upload`, stored in `backend/uploads/`, served as FastAPI `StaticFiles`. Frontend prefixes `API_BASE` to the returned `/uploads/...` path.

**Player path** — ordered by `position` integer in the DB. Reordering sends the new list of IDs to `PUT /player-path/reorder`. Path lines are drawn as SVG `<line>` elements over the map image using percentage coordinates.
