import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CharacterPathEntry, Location, PartyMember, PathEntry, Quest } from '../types';
import { API_BASE } from '../lib/api';
import FogCanvas from './FogCanvas';

const TYPE_COLORS: Record<string, string> = {
  city:       'var(--pin-city)',
  dungeon:    'var(--pin-dungeon)',
  wilderness: 'var(--pin-wilderness)',
  landmark:   'var(--pin-landmark)',
  hazard:     'var(--pin-hazard)',
  shop:       'var(--pin-shop)',
  inn:        'var(--pin-inn)',
  temple:     'var(--pin-temple)',
  port:       'var(--pin-port)',
  bridge:     'var(--pin-bridge)',
  gate:       'var(--pin-gate)',
  portal:     'var(--pin-portal)',
};

const TYPE_DEFAULT_ICONS: Record<string, string> = {
  city:       '/game-icons/city.svg',
  dungeon:    '/game-icons/dungeon.svg',
  wilderness: '/game-icons/wilderness.svg',
  landmark:   '/game-icons/landmark.svg',
  hazard:     '/game-icons/hazard.svg',
  shop:       '/game-icons/shop.svg',
  inn:        '/game-icons/inn.svg',
  temple:     '/game-icons/temple.svg',
  port:       '/game-icons/port.svg',
  bridge:     '/game-icons/bridge.svg',
  gate:       '/game-icons/gate.svg',
  portal:     '/game-icons/portal.svg',
};

// Used in the type filter strip
const TYPE_ICONS_EMOJI: Record<string, string> = {
  city: '🏰', dungeon: '💀', wilderness: '🌲', landmark: '◈',
  hazard: '⚠', shop: '🪙', inn: '🍺', temple: '⛩', port: '⚓',
  bridge: '🌉', gate: '🚪', portal: '🌀',
};
const TYPE_LABELS_SHORT: Record<string, string> = {
  city: 'City', dungeon: 'Dungeon', wilderness: 'Wild.', landmark: 'Landmark',
  hazard: 'Hazard', shop: 'Shop', inn: 'Inn', temple: 'Temple', port: 'Port',
  bridge: 'Bridge', gate: 'Gate', portal: 'Portal',
};

const CHAR_COLORS = ['#e05c5c', '#5c9fe0', '#60cc78', '#c05ce0', '#e0a040', '#40d4c8', '#e07840', '#a0c840'];

type TravelType = 'foot' | 'horse' | 'boat' | 'fly' | 'portal';
const TRAVEL_STYLES: Record<TravelType, { color: string; dash: string; symbol: string }> = {
  foot:   { color: '#e8c05a', dash: '7,4',  symbol: '🥾' },
  horse:  { color: '#d4884a', dash: '14,4', symbol: '🐴' },
  boat:   { color: '#5a9ae0', dash: '3,7',  symbol: '⛵' },
  fly:    { color: '#b090d0', dash: '2,9',  symbol: '🦅' },
  portal: { color: '#c060e8', dash: '2,5,10,5', symbol: '🌀' },
};
function travelStyle(t?: string) {
  return TRAVEL_STYLES[(t ?? 'foot') as TravelType] ?? TRAVEL_STYLES.foot;
}

interface Props {
  locations:          Location[];   // visible pins (filtered by discovered in player mode)
  allLocations:       Location[];   // full list — used for path resolution
  selectedId:         number | null;
  playerPath:         PathEntry[];
  quests:             Quest[];
  isAddingPin:        boolean;
  mapImageUrl:        string | null;
  isDMMode:           boolean;
  fogData:            string;
  fogPaintMode:       boolean;
  fogBrushMode:       'reveal' | 'hide';
  fogBrushSize:       number;
  mapStack:           number[];
  characterPaths:     CharacterPathEntry[];
  party:              PartyMember[];
  hiddenCharIds:        Set<number>;
  hiddenSegmentIds?:    Set<number>;
  showPartyPath:        boolean;
  showLabels:         boolean;
  showDistLabels:     boolean;
  showTimeLabels:     boolean;
  fitTrigger:         number;
  onSelectLocation:   (id: number) => void;
  onDeselect:         () => void;
  onAddPin:           (x: number, y: number) => void;
  onFogChange:        (data: string) => void;
  onExitSubmap:       () => void;
  onUpdateLocation?:  (id: number, data: Partial<Location>) => Promise<void>;
  onDeleteLocation?:  (id: number) => void;
  onDuplicateLocation?: (loc: Location) => void;
  onAddToPath?:       (locationId: number) => void;
  onEnterSubmap?:     (id: number) => void;
  // Scale bar
  mapScale?:          { value: number; unit: string } | null;
  showScaleBar?:      boolean;
  onSetMapScale?:     (value: number, unit: string) => void;
  // Ruler tool
  rulerActive?:       boolean;
  // Waypoint drawing — freehand drag on map
  waypointMode?:      { entryId: number; isChar: boolean } | null;
  onSaveWaypoints?:   (entryId: number, pts: [number, number][], isChar: boolean) => void;
  onCancelWaypoints?: () => void;
}

// Parse waypoints JSON string to array of [x, y] pairs
function parseWaypoints(wp: string | null | undefined): [number, number][] {
  if (!wp) return [];
  try { return JSON.parse(wp) as [number, number][]; } catch { return []; }
}

// Convert % waypoints to SVG polyline points string (no smoothing — follows path exactly).
// mapEl.clientWidth/clientHeight gives the unscaled image size matching SVG user-space.
function ptsToPolyline(pts: [number, number][], mapEl: HTMLElement): string {
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h || pts.length < 2) return '';
  return pts.map(([x, y]) => `${((x / 100) * w).toFixed(1)},${((y / 100) * h).toFixed(1)}`).join(' ');
}

// Render arrowhead polygon(s) on a % path, in SVG pixel space.
// fwd arrow at 70% of path, rev arrow at 30% — offset from label at geometric midpoint.
function ArrowAtMid({ pts, mapEl, color, direction }: {
  pts:       [number, number][];
  mapEl:     HTMLElement;
  color:     string;
  direction: 'forward' | 'backward' | 'both';
}) {
  if (pts.length < 2) return null;
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h) return null;

  // Convert % → SVG px
  const px: [number, number][] = pts.map(([x, y]) => [x / 100 * w, y / 100 * h]);

  // Cumulative lengths along path
  const cuml = [0];
  for (let i = 1; i < px.length; i++) {
    const dx = px[i][0] - px[i - 1][0];
    const dy = px[i][1] - px[i - 1][1];
    cuml.push(cuml[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cuml[cuml.length - 1];
  if (total < 5) return null;

  const S = 10;
  const aPts = `0,0 ${-S},${(S * 0.45).toFixed(1)} ${-S},${(-S * 0.45).toFixed(1)}`;

  function arrowAt(frac: number, flip: boolean) {
    const target = total * frac;
    let si = 1;
    while (si < px.length - 1 && cuml[si] < target) si++;
    const t = (target - cuml[si - 1]) / (cuml[si] - cuml[si - 1]);
    const cx = px[si - 1][0] + t * (px[si][0] - px[si - 1][0]);
    const cy = px[si - 1][1] + t * (px[si][1] - px[si - 1][1]);
    const baseAngle = Math.atan2(px[si][1] - px[si - 1][1], px[si][0] - px[si - 1][0]) * 180 / Math.PI;
    const angle = flip ? baseAngle + 180 : baseAngle;
    return (
      <polygon key={`${frac}-${flip}`} points={aPts} fill={color} opacity={0.95}
        transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${angle.toFixed(1)})`}
        style={{ pointerEvents: 'none' }} />
    );
  }

  return (
    <>
      {direction !== 'backward'  && arrowAt(0.70, false)}
      {direction !== 'forward'   && arrowAt(0.30, true)}
    </>
  );
}

// ── Scale bar ─────────────────────────────────────────────────────────────────
const SCALE_UNITS = ['miles', 'km', 'leagues', 'feet', 'yards', 'meters', 'AU', 'hexes', 'squares'];
const NICE_SCALE  = [1,2,5,10,25,50,100,200,250,500,1000,2000,5000,10000,25000,50000];

function ScaleBar({ totalValue, unit, screenMapWidth, containerWidth, isDM, onSet }: {
  totalValue:     number;
  unit:           string;
  screenMapWidth: number; // on-screen px width of map image at current zoom
  containerWidth: number; // px width of the map viewport (not zoom-dependent)
  isDM:           boolean;
  onSet?:         (v: number, u: string) => void;
}) {
  const [editing,  setEditing]  = useState(false);
  const [editVal,  setEditVal]  = useState(String(totalValue));
  const [editUnit, setEditUnit] = useState(unit);

  // Keep edit fields in sync when external value changes
  useEffect(() => { setEditVal(String(totalValue)); setEditUnit(unit); }, [totalValue, unit]);

  // Paper-map-legend style: fixed label (≈20% of total), bar grows/shrinks with zoom.
  // Pick a nice reference distance close to 20% of the total map width.
  const target  = totalValue * 0.20;
  const refDist = NICE_SCALE.reduce((best, n) =>
    n <= totalValue && Math.abs(n - target) < Math.abs(best - target) ? n : best,
    NICE_SCALE[0]);
  // Bar width = proportional fraction of the on-screen map width, capped at 40% of viewport.
  const rawBarPx = screenMapWidth > 0 ? (refDist / totalValue) * screenMapWidth : 120;
  const maxBarPx = (containerWidth || 800) * 0.40;
  const barPx    = Math.max(20, Math.min(rawBarPx, maxBarPx));

  function save() {
    const v = parseFloat(editVal);
    if (!isNaN(v) && v > 0 && onSet) onSet(v, editUnit);
    setEditing(false);
  }

  const barStyle: React.CSSProperties = {
    position: 'absolute', bottom: 52, left: 16, zIndex: 20,
    userSelect: 'none', pointerEvents: 'all',
  };

  if (editing) {
    return (
      <div data-no-draw style={{ ...barStyle, background: '#1a2535e0', padding: '7px 10px', borderRadius: 6, display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #3a5070' }}>
        <span style={{ fontSize: 11, color: '#b8d0f0', flexShrink: 0 }}>Map width:</span>
        <input
          type="number" min="1" value={editVal} autoFocus
          style={{ width: 72, fontSize: 12, padding: '2px 4px', borderRadius: 3 }}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <select value={editUnit} style={{ fontSize: 12, padding: '2px 2px', borderRadius: 3 }}
          onChange={e => setEditUnit(e.target.value)}>
          {SCALE_UNITS.map(u => <option key={u}>{u}</option>)}
        </select>
        <button data-no-draw onClick={save}
          style={{ fontSize: 12, padding: '2px 8px', background: '#2a4a2a', border: '1px solid #4a8a4a', borderRadius: 3, color: '#8d8', cursor: 'pointer' }}>
          ✓
        </button>
        <button data-no-draw onClick={() => setEditing(false)}
          style={{ fontSize: 12, padding: '2px 8px', background: '#3a2a2a', border: '1px solid #8a4a4a', borderRadius: 3, color: '#d88', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div data-no-draw style={barStyle} onMouseDown={e => e.stopPropagation()}>
      {/* Bar — grows with zoom, capped at 40% of viewport width */}
      <div style={{
        width: barPx,
        height: 3, background: '#fff',
        borderLeft: '2px solid #fff', borderRight: '2px solid #fff', borderBottom: '2px solid #fff',
        boxShadow: '0 0 5px rgba(0,0,0,0.8)',
        marginBottom: 3,
      }} />
      {/* Label — fixed reference distance, never changes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#fff',
          textShadow: '0 0 4px #000, 0 0 4px #000',
        }}>
          {refDist.toLocaleString()} {unit}
        </span>
        {isDM && onSet && (
          <button data-no-draw
            onClick={() => setEditing(true)}
            style={{ fontSize: 10, padding: '1px 5px', background: '#1e2d4a90', border: '1px solid #3a5070', borderRadius: 3, color: '#7090c0', cursor: 'pointer' }}>
            ✏
          </button>
        )}
      </div>
    </div>
  );
}

// Shown in DM mode when no scale is set yet — just shows the "Set scale" edit button
function ScaleBarUnset({ onSet }: { onSet: (v: number, u: string) => void }) {
  const [editing,  setEditing]  = useState(false);
  const [editVal,  setEditVal]  = useState('');
  const [editUnit, setEditUnit] = useState('miles');

  function save() {
    const v = parseFloat(editVal);
    if (!isNaN(v) && v > 0) { onSet(v, editUnit); setEditing(false); }
  }

  const baseStyle: React.CSSProperties = {
    position: 'absolute', bottom: 52, left: 16, zIndex: 20,
    userSelect: 'none', pointerEvents: 'all',
  };

  if (editing) {
    return (
      <div data-no-draw style={{ ...baseStyle, background: '#1a2535e0', padding: '7px 10px', borderRadius: 6, display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #3a5070' }}>
        <span style={{ fontSize: 11, color: '#b8d0f0', flexShrink: 0 }}>Map width:</span>
        <input
          type="number" min="1" placeholder="e.g. 500" value={editVal} autoFocus
          style={{ width: 72, fontSize: 12, padding: '2px 4px', borderRadius: 3 }}
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <select value={editUnit} style={{ fontSize: 12, padding: '2px 2px', borderRadius: 3 }}
          onChange={e => setEditUnit(e.target.value)}>
          {SCALE_UNITS.map(u => <option key={u}>{u}</option>)}
        </select>
        <button data-no-draw onClick={save}
          style={{ fontSize: 12, padding: '2px 8px', background: '#2a4a2a', border: '1px solid #4a8a4a', borderRadius: 3, color: '#8d8', cursor: 'pointer' }}>
          ✓
        </button>
        <button data-no-draw onClick={() => setEditing(false)}
          style={{ fontSize: 12, padding: '2px 8px', background: '#3a2a2a', border: '1px solid #8a4a4a', borderRadius: 3, color: '#d88', cursor: 'pointer' }}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div data-no-draw style={baseStyle} onMouseDown={e => e.stopPropagation()}>
      <button data-no-draw onClick={() => setEditing(true)}
        style={{ fontSize: 11, padding: '3px 8px', background: '#1a2535c0', border: '1px solid #3a5070', borderRadius: 4, color: '#7090c0', cursor: 'pointer' }}>
        ✏ Set map scale
      </button>
    </div>
  );
}

export default function MapView({
  locations,
  allLocations,
  selectedId,
  playerPath,
  quests,
  isAddingPin,
  mapImageUrl,
  isDMMode,
  fogData,
  fogPaintMode,
  fogBrushMode,
  fogBrushSize,
  mapStack,
  characterPaths,
  party,
  hiddenCharIds,
  hiddenSegmentIds,
  showPartyPath,
  showLabels,
  showDistLabels,
  showTimeLabels,
  fitTrigger,
  onSelectLocation,
  onDeselect,
  onAddPin,
  onFogChange,
  onExitSubmap,
  onUpdateLocation,
  onDeleteLocation,
  onDuplicateLocation,
  onAddToPath,
  onEnterSubmap,
  mapScale,
  showScaleBar = true,
  onSetMapScale,
  rulerActive = false,
  waypointMode,
  onSaveWaypoints,
  onCancelWaypoints,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Count active quests per location for the indicator dot
  const activeQuestCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const q of quests) {
      if (q.status === 'active' && q.location_id != null) {
        counts.set(q.location_id, (counts.get(q.location_id) ?? 0) + 1);
      }
    }
    return counts;
  }, [quests]);
  const imgRef       = useRef<HTMLImageElement | null>(null);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging  = useRef(false);
  const hasDragged  = useRef(false);
  const dragStart   = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  // Keep a ref to transform for use in non-React event handlers
  const transformRef = useRef(transform);
  transformRef.current = transform;
  // Keep waypointMode in a ref so mouse-event callbacks always see current value
  // without needing waypointMode in their deps arrays (avoids stale closure bugs)
  const waypointModeRef = useRef(waypointMode);
  waypointModeRef.current = waypointMode;

  // ── Ruler tool ───────────────────────────────────────────────────────────
  const [rulerAnchor, setRulerAnchor] = useState<[number, number] | null>(null);
  const [rulerCursor, setRulerCursor] = useState<[number, number] | null>(null);
  const rulerActiveRef = useRef(rulerActive);
  rulerActiveRef.current = rulerActive;
  // Clear ruler state when tool is deactivated
  useEffect(() => { if (!rulerActive) { setRulerAnchor(null); setRulerCursor(null); } }, [rulerActive]);
  // Escape clears current anchor
  useEffect(() => {
    if (!rulerActive) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRulerAnchor(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rulerActive]);

  // ── Freehand waypoint drawing ─────────────────────────────────────────────
  const [freehandPts, setFreehandPts] = useState<[number, number][]>([]);
  const isDrawingWp   = useRef(false);
  const freehandBuf   = useRef<[number, number][]>([]);
  const lastSample    = useRef({ clientX: 0, clientY: 0 });
  // Reset freehand whenever drawing mode is activated for a new segment
  useEffect(() => { freehandBuf.current = []; setFreehandPts([]); }, [waypointMode?.entryId]);

  // ── Pin drag state ────────────────────────────────────────────────────────
  const pinDragRef     = useRef<{ id: number; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const pinJustDragged = useRef(false);
  const [dragOverrides, setDragOverrides] = useState<Map<number, { x: number; y: number }>>(new Map());

  // ── Context menu ──────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; loc: Location } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('contextmenu', close); };
  }, [contextMenu]);

  // ── Type visibility filter ────────────────────────────────────────────────
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const toggleType = useCallback((t: string) => {
    setHiddenTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });
  }, []);
  // Unique types present at this map level
  const presentTypes = useMemo(() => {
    const seen: Record<string, true> = {};
    for (const l of locations) seen[l.type] = true;
    return Object.keys(seen).sort();
  }, [locations]);
  // Filtered locations (apply type visibility)
  const visibleLocations = useMemo(
    () => locations.filter(l => !hiddenTypes.has(l.type)),
    [locations, hiddenTypes],
  );

  // ── Fit-to-pins ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fitTrigger) return;
    const mapEl    = imgRef.current ?? placeholderRef.current;
    const container = containerRef.current;
    if (!mapEl || !container) return;

    if (locations.length === 0) {
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }

    const xs = locations.map(l => l.x);
    const ys = locations.map(l => l.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const cw = container.offsetWidth;
    const ch = container.offsetHeight;
    const iw = mapEl.offsetWidth;
    const ih = mapEl.offsetHeight;

    const pad = 12; // extra padding in pct units around the bbox
    const bboxW = Math.max(1, (maxX - minX + pad * 2) / 100 * iw);
    const bboxH = Math.max(1, (maxY - minY + pad * 2) / 100 * ih);

    const newScale = Math.min(10, Math.max(0.25, Math.min(cw / bboxW, ch / bboxH)));
    const cx = ((minX + maxX) / 2) / 100 * iw;
    const cy = ((minY + maxY) / 2) / 100 * ih;

    setTransform({ x: cw / 2 - cx * newScale, y: ch / 2 - cy * newScale, scale: newScale });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTrigger]);

  // ── Wheel zoom (non-passive) ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (fogPaintMode) return; // don't zoom while painting fog
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform(prev => {
        const newScale = Math.max(0.25, Math.min(10, prev.scale * factor));
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratio = newScale / prev.scale;
        return {
          x: mx - (mx - prev.x) * ratio,
          y: my - (my - prev.y) * ratio,
          scale: newScale,
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fogPaintMode]);

  // ── Pan / waypoint drawing ───────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (fogPaintMode) return;
    if (e.button !== 0) return;

    // In waypoint mode: start freehand draw (unless clicking a UI button/control)
    if (waypointModeRef.current) {
      if ((e.target as HTMLElement).closest('button,[data-no-draw]')) return;
      const mapEl = imgRef.current ?? placeholderRef.current;
      if (mapEl) {
        const rect = mapEl.getBoundingClientRect();
        const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
        isDrawingWp.current = true;
        freehandBuf.current = [[x, y]];
        lastSample.current = { clientX: e.clientX, clientY: e.clientY };
        setFreehandPts([[x, y]]);
      }
      return; // don't start map pan
    }

    isDragging.current = true;
    hasDragged.current = false;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transformRef.current.x,
      ty: transformRef.current.y,
    };
    (e.currentTarget as HTMLElement).classList.add('is-dragging');
  }, [fogPaintMode]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // ── Ruler cursor tracking ──────────────────────────────────────────────
    if (rulerActiveRef.current) {
      const mapEl = imgRef.current ?? placeholderRef.current;
      if (mapEl) {
        const rect = mapEl.getBoundingClientRect();
        const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
        setRulerCursor([x, y]);
      }
    }

    // ── Freehand waypoint drawing ──────────────────────────────────────────
    if (isDrawingWp.current && waypointModeRef.current) {
      const dx = e.clientX - lastSample.current.clientX;
      const dy = e.clientY - lastSample.current.clientY;
      if (dx * dx + dy * dy >= 2 * 2) { // sample every ~2 screen px
        const mapEl = imgRef.current ?? placeholderRef.current;
        if (mapEl) {
          const rect = mapEl.getBoundingClientRect();
          const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
          const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
          freehandBuf.current = [...freehandBuf.current, [x, y]];
          setFreehandPts([...freehandBuf.current]);
          lastSample.current = { clientX: e.clientX, clientY: e.clientY };
        }
      }
      return; // block map pan while drawing
    }

    // ── Pin drag takes priority ────────────────────────────────────────────
    if (pinDragRef.current) {
      const pd = pinDragRef.current;
      const dx = e.clientX - pd.startX;
      const dy = e.clientY - pd.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        pd.moved = true;
        const mapEl = imgRef.current ?? placeholderRef.current;
        if (mapEl) {
          const scale = transformRef.current.scale;
          const newX = Math.max(0, Math.min(100, pd.origX + (dx / (mapEl.offsetWidth  * scale)) * 100));
          const newY = Math.max(0, Math.min(100, pd.origY + (dy / (mapEl.offsetHeight * scale)) * 100));
          setDragOverrides(new Map([[pd.id, { x: newX, y: newY }]]));
        }
      }
      return;
    }
    // ── Map pan ────────────────────────────────────────────────────────────
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) hasDragged.current = true;
    setTransform(prev => ({
      ...prev,
      x: dragStart.current.tx + dx,
      y: dragStart.current.ty + dy,
    }));
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // ── Finish freehand waypoint draw ─────────────────────────────────────
    if (isDrawingWp.current && waypointModeRef.current) {
      isDrawingWp.current = false;
      const pts = freehandBuf.current;
      const wm = waypointModeRef.current;
      // Add the final mouse position as the last point
      const mapEl2 = imgRef.current ?? placeholderRef.current;
      if (mapEl2) {
        const rect = mapEl2.getBoundingClientRect();
        const fx = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
        const fy = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
        pts.push([fx, fy]);
      }
      if (pts.length >= 2 && onSaveWaypoints) {
        // Keep max ~1500 points (downsample if over limit)
        const simplified = pts.length > 1500
          ? pts.filter((_, i) => i % Math.ceil(pts.length / 1500) === 0 || i === pts.length - 1)
          : pts;
        onSaveWaypoints(wm.entryId, simplified, wm.isChar);
      }
      freehandBuf.current = [];
      return;
    }
    // ── Finish pin drag ────────────────────────────────────────────────────
    if (pinDragRef.current) {
      const pd = pinDragRef.current;
      if (pd.moved) {
        pinJustDragged.current = true;
        const override = dragOverrides.get(pd.id);
        if (override && onUpdateLocation) {
          onUpdateLocation(pd.id, { x: override.x, y: override.y });
        }
      }
      pinDragRef.current = null;
      setDragOverrides(new Map());
      return;
    }
    isDragging.current = false;
    (e.currentTarget as HTMLElement).classList.remove('is-dragging');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragOverrides, onUpdateLocation, onSaveWaypoints]);

  // ── Click (add pin or deselect) ───────────────────────────────────────────
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (fogPaintMode) return;
      if (hasDragged.current) return;
      if (waypointMode) return; // drawing handled by mousedown/up

      const mapEl: HTMLElement | null = imgRef.current ?? placeholderRef.current;
      if (!mapEl) return;

      const rect = mapEl.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      if (x < 0 || x > 100 || y < 0 || y > 100) return;

      if (isAddingPin) {
        onAddPin(x, y);
      } else {
        onDeselect();
      }
    },
    [fogPaintMode, isAddingPin, onAddPin, onDeselect, waypointMode],
  );

  // ── Build ordered path for SVG ────────────────────────────────────────────
  // Use allLocations so path lines draw even when some waypoints are undiscovered
  const orderedSegments = [...playerPath]
    .sort((a, b) => a.position - b.position)
    .map(e => ({
      loc: allLocations.find(l => l.id === e.location_id),
      travelType: e.travel_type,
      distance: e.distance,
      distance_unit: e.distance_unit,
      travel_time: e.travel_time,
      travel_time_unit: e.travel_time_unit,
      direction: (e.direction ?? 'forward') as 'forward' | 'backward' | 'both',
      waypoints: parseWaypoints(e.waypoints),
      entryId: e.id,
    }))
    .filter((s): s is {
      loc: Location; travelType: string | undefined;
      distance: number | null | undefined; distance_unit: string | null | undefined;
      travel_time: number | null | undefined; travel_time_unit: string | null | undefined;
      direction: 'forward' | 'backward' | 'both'; waypoints: [number, number][];
      entryId: number;
    } => s.loc !== undefined);

  // Keep a flat ordered-path array for the pin position numbers (existing usage)
  const orderedPath = orderedSegments.map(s => s.loc);

  // Build character path lines: one ordered path per visible party member
  const charPathLines = party
    .filter(member => !hiddenCharIds.has(member.id))
    .map(member => {
      const color = member.path_color || '#c9a84c';
      const entries = characterPaths
        .filter(e => e.party_member_id === member.id)
        .sort((a, b) => a.position - b.position);
      const segments = entries
        .map(e => ({
          loc: allLocations.find(l => l.id === e.location_id),
          travelType: e.travel_type,
          direction: (e.direction ?? 'forward') as 'forward' | 'backward' | 'both',
          waypoints: parseWaypoints(e.waypoints),
          entryId: e.id,
        }))
        .filter((s): s is {
          loc: Location; travelType: string | undefined;
          direction: 'forward' | 'backward' | 'both'; waypoints: [number, number][];
          entryId: number;
        } => s.loc !== undefined);
      return { member, color, segments };
    })
    .filter(cp => cp.segments.length > 1);

  // Build a lookup: location id → path position (1-based)
  const pathPositions: Record<number, number> = {};
  [...playerPath]
    .sort((a, b) => a.position - b.position)
    .forEach((e, i) => { pathPositions[e.location_id] = i + 1; });

  const imgSrc = mapImageUrl
    ? `${API_BASE}${mapImageUrl}`
    : null;

  return (
    <div
      ref={containerRef}
      className={[
        'map-container',
        isAddingPin  ? 'adding-pin'   : '',
        fogPaintMode ? 'fog-painting' : '',
        showLabels   ? 'labels-on'    : '',
        waypointMode ? 'waypoint-drawing' : '',
        rulerActive  ? 'ruler-active'  : '',
      ].filter(Boolean).join(' ')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={e => {
        if (isDrawingWp.current) {
          isDrawingWp.current = false; // stop drawing; don't auto-save on accidental leave
        } else {
          handleMouseUp(e);
        }
        pinDragRef.current = null;
        setDragOverrides(new Map());
      }}
      onClick={handleContainerClick}
      // Ruler: capture-phase click so we intercept before pin stopPropagation
      onClickCapture={e => {
        if (!rulerActiveRef.current) return;
        if (hasDragged.current) return;
        if ((e.target as HTMLElement).closest('[data-no-draw]')) return;
        const mapEl: HTMLElement | null = imgRef.current ?? placeholderRef.current;
        if (!mapEl) return;
        const rect = mapEl.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        if (x < 0 || x > 100 || y < 0 || y > 100) return;
        setRulerAnchor([x, y]);
        e.stopPropagation(); // prevent pin selection / deselect while ruler is active
      }}
    >
      {mapStack.length > 0 && (
        <div className="map-breadcrumb">
          <button onClick={onExitSubmap}>← Back</button>
          {mapStack.map((id, i) => {
            const loc = allLocations.find(l => l.id === id);
            return <span key={id}>{i > 0 && ' › '}{loc?.name ?? `#${id}`}</span>;
          })}
        </div>
      )}
      {isAddingPin && (
        <div className="add-pin-hint">Click anywhere on the map to place the pin</div>
      )}
      {fogPaintMode && (
        <div className="add-pin-hint" style={{ background: fogBrushMode === 'reveal' ? '#2a6e3a' : '#4a2222' }}>
          {fogBrushMode === 'reveal' ? '☁ Revealing fog — click/drag on map' : '🌑 Hiding area — click/drag on map'}
        </div>
      )}
      {waypointMode && (
        <div
          data-no-draw
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
            background: '#1e2d4a', color: '#b8d0f0', fontSize: 13,
            padding: '7px 14px', display: 'flex', gap: 10, alignItems: 'center',
            borderBottom: '1px solid #3a5070', userSelect: 'none',
          }}
        >
          <span style={{ flex: 1 }}>
            {freehandPts.length < 2
              ? '✏ Hold and drag on the map to draw a curved path'
              : `✏ Path drawn (${freehandPts.length} pts) — drag again to redraw`}
          </span>
          {onCancelWaypoints && (
            <button
              data-no-draw
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onCancelWaypoints(); }}
              style={{ background: '#5a2a2a', border: 'none', color: '#f99', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
            >
              ✕ Cancel
            </button>
          )}
        </div>
      )}

      <div
        className="map-transform"
        style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}
      >
        {/* Map image or placeholder */}
        {imgSrc ? (
          <img
            ref={imgRef}
            className="map-img"
            src={imgSrc}
            alt="World Map"
            draggable={false}
          />
        ) : (
          <div ref={placeholderRef} className="map-placeholder">
            <span className="map-placeholder-icon">🗺</span>
            Upload a map image using the button above
          </div>
        )}

        {/* Fog of War canvas overlay */}
        <FogCanvas
          fogData={fogData}
          isDMMode={isDMMode}
          paintMode={fogPaintMode}
          brushMode={fogBrushMode}
          brushSize={fogBrushSize}
          onFogChange={onFogChange}
        />

        {/* SVG path lines overlay */}
        <svg
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 5,
          }}
        >
          <defs>
            {/* Filter region expanded so nothing at edges gets clipped */}
            <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Character individual paths */}
          {charPathLines.map(({ member, color, segments }) =>
            segments.map((seg, i) => {
              if (i === 0) return null;
              if (hiddenSegmentIds?.has(seg.entryId)) return null;
              const prev = segments[i - 1];
              const style = travelStyle(seg.travelType);
              const mapEl = imgRef.current ?? placeholderRef.current;
              const wp = (waypointMode?.entryId === seg.entryId && freehandPts.length >= 2)
                ? freehandPts : seg.waypoints;
              const allPts: [number, number][] = [[prev.loc.x, prev.loc.y], ...wp, [seg.loc.x, seg.loc.y]];
              const mx = (prev.loc.x + seg.loc.x) / 2;
              const my = (prev.loc.y + seg.loc.y) / 2;
              const pts = (mapEl && allPts.length >= 2) ? ptsToPolyline(allPts, mapEl) : null;
              return (
                <g key={`char-${member.id}-${i}`}>
                  {pts ? (
                    <>
                      <polyline points={pts} stroke="#000" strokeWidth="3" strokeDasharray={style.dash} fill="none" opacity="0.3" />
                      <polyline points={pts} stroke={color} strokeWidth="1.8" strokeDasharray={style.dash} fill="none" opacity="0.85" />
                    </>
                  ) : (
                    <>
                      <line x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`} x2={`${seg.loc.x}%`} y2={`${seg.loc.y}%`}
                        stroke="#000" strokeWidth="3" strokeDasharray={style.dash} opacity="0.3" />
                      <line x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`} x2={`${seg.loc.x}%`} y2={`${seg.loc.y}%`}
                        stroke={color} strokeWidth="1.8" strokeDasharray={style.dash} opacity="0.85" />
                    </>
                  )}
                  {mapEl && <ArrowAtMid pts={allPts} mapEl={mapEl} color={color} direction={seg.direction} />}
                  <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" dominantBaseline="middle"
                    fontSize="11" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                    {style.symbol}
                  </text>
                </g>
              );
            })
          )}

          {showPartyPath && orderedSegments.map((seg, i) => {
            if (i === 0) return null;
            if (hiddenSegmentIds?.has(seg.entryId)) return null;
            const prev = orderedSegments[i - 1];
            const style = travelStyle(seg.travelType);
            const mapEl = imgRef.current ?? placeholderRef.current;
            const wp = (waypointMode?.entryId === seg.entryId && freehandPts.length >= 2)
              ? freehandPts : seg.waypoints;
            const allPts: [number, number][] = [[prev.loc.x, prev.loc.y], ...wp, [seg.loc.x, seg.loc.y]];
            const mx = (prev.loc.x + seg.loc.x) / 2;
            const my = (prev.loc.y + seg.loc.y) / 2;
            const distLabel = showDistLabels && seg.distance != null
              ? `${seg.distance}${seg.distance_unit ? ' ' + seg.distance_unit : ''}` : null;
            const timeLabel = showTimeLabels && seg.travel_time != null
              ? `${seg.travel_time}${seg.travel_time_unit ? ' ' + seg.travel_time_unit : ''}` : null;
            const pts = (mapEl && allPts.length >= 2) ? ptsToPolyline(allPts, mapEl) : null;
            return (
              <g key={`path-line-${i}`}>
                {pts ? (
                  <>
                    <polyline points={pts} stroke="#000" strokeWidth="4" strokeDasharray={style.dash} fill="none" opacity="0.35" />
                    <polyline points={pts} stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} fill="none" opacity="0.9"
                      filter="url(#glow)"
                    />
                  </>
                ) : (
                  <>
                    <line x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`} x2={`${seg.loc.x}%`} y2={`${seg.loc.y}%`}
                      stroke="#000" strokeWidth="4" strokeDasharray={style.dash} opacity="0.35" />
                    <line x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`} x2={`${seg.loc.x}%`} y2={`${seg.loc.y}%`}
                      stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} opacity="0.9"
                      filter="url(#glow)"
                    />
                  </>
                )}
                {mapEl && <ArrowAtMid pts={allPts} mapEl={mapEl} color={style.color} direction={seg.direction} />}
                <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" dominantBaseline="middle"
                  fontSize="12" style={{ userSelect: 'none', pointerEvents: 'none' }}
                  filter="url(#glow)">
                  {style.symbol}
                  {distLabel && (
                    <tspan x={`${mx}%`} dy="14" fontSize="9"
                      style={{ fill: '#ffe58a', stroke: '#000', strokeWidth: '2.5', paintOrder: 'stroke' }}>{distLabel}</tspan>
                  )}
                  {timeLabel && (
                    <tspan x={`${mx}%`} dy={distLabel ? '12' : '14'} fontSize="9"
                      style={{ fill: '#80d8ff', stroke: '#000', strokeWidth: '2.5', paintOrder: 'stroke' }}>{timeLabel}</tspan>
                  )}
                </text>
              </g>
            );
          })}

          {/* Live freehand drawing preview (shown while user is actively drawing) */}
          {waypointMode && freehandPts.length >= 2 && (() => {
            const mapEl = imgRef.current ?? placeholderRef.current;
            if (!mapEl) return null;
            const pts = ptsToPolyline(freehandPts, mapEl);
            return pts ? (
              <polyline points={pts} stroke="#7ec8f0" strokeWidth="2" fill="none" opacity="0.8"
                strokeDasharray="4,4" />
            ) : null;
          })()}

          {/* ── Ruler overlay ──────────────────────────────────────────── */}
          {rulerActive && rulerAnchor && rulerCursor && (() => {
            const [ax, ay] = rulerAnchor;
            const [cx, cy] = rulerCursor;
            const mx = (ax + cx) / 2;
            const my = (ay + cy) / 2;
            // Compute real-world distance using map scale + image aspect ratio
            let distLabel = '';
            if (mapScale && mapScale.value > 0) {
              const mapEl = imgRef.current;
              const natW = mapEl?.naturalWidth  || mapEl?.offsetWidth  || 1;
              const natH = mapEl?.naturalHeight || mapEl?.offsetHeight || 1;
              const dx = (cx - ax) / 100 * mapScale.value;
              const dy = (cy - ay) / 100 * mapScale.value * (natH / natW);
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist >= 10000) distLabel = `${(dist / 1000).toFixed(1)}k ${mapScale.unit}`;
              else if (dist >= 10) distLabel = `${Math.round(dist).toLocaleString()} ${mapScale.unit}`;
              else if (dist >= 1)  distLabel = `${dist.toFixed(1)} ${mapScale.unit}`;
              else                 distLabel = `${dist.toFixed(2)} ${mapScale.unit}`;
            }
            return (
              <g>
                {/* Shadow line */}
                <line x1={`${ax}%`} y1={`${ay}%`} x2={`${cx}%`} y2={`${cy}%`}
                  stroke="#000" strokeWidth="3.5" strokeDasharray="10,5" opacity="0.5" />
                {/* Ruler line */}
                <line x1={`${ax}%`} y1={`${ay}%`} x2={`${cx}%`} y2={`${cy}%`}
                  stroke="#f0e060" strokeWidth="1.8" strokeDasharray="10,5" />
                {/* Anchor dot */}
                <circle cx={`${ax}%`} cy={`${ay}%`} r="5" fill="#f0e060" stroke="#000" strokeWidth="1.5" />
                {/* Cursor crosshair */}
                <circle cx={`${cx}%`} cy={`${cy}%`} r="4" fill="none" stroke="#f0e060" strokeWidth="1.8" />
                <circle cx={`${cx}%`} cy={`${cy}%`} r="1.5" fill="#f0e060" />
                {/* Distance label */}
                {distLabel && (
                  <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" dominantBaseline="auto"
                    fontSize="13" fontWeight="700"
                    style={{ fill: '#f0e060', stroke: '#000', strokeWidth: '3', paintOrder: 'stroke', userSelect: 'none', pointerEvents: 'none' }}>
                    {distLabel}
                  </text>
                )}
              </g>
            );
          })()}
        </svg>

        {/* Pins */}
        {visibleLocations.map(loc => {
          const pathNum  = pathPositions[loc.id];
          const override = dragOverrides.get(loc.id);
          const px = override?.x ?? loc.x;
          const py = override?.y ?? loc.y;
          return (
            <div
              key={loc.id}
              className={[
                'pin',
                `pin-${loc.type}`,
                loc.pin_size && loc.pin_size !== 'md' ? `pin-size-${loc.pin_size}` : '',
                loc.id === selectedId ? 'selected' : '',
                !loc.discovered && !isDMMode ? 'undiscovered' : '',
                override ? 'pin-dragging' : '',
              ].filter(Boolean).join(' ')}
              style={{ left: `${px}%`, top: `${py}%` }}
              onMouseDown={isDMMode && !isAddingPin && !fogPaintMode && onUpdateLocation ? e => {
                e.stopPropagation();
                pinDragRef.current = { id: loc.id, startX: e.clientX, startY: e.clientY, origX: loc.x, origY: loc.y, moved: false };
              } : undefined}
              onClick={e => {
                e.stopPropagation();
                if (pinJustDragged.current) { pinJustDragged.current = false; return; }
                if (!isAddingPin && !fogPaintMode) onSelectLocation(loc.id);
              }}
              onContextMenu={isDMMode ? e => {
                e.preventDefault();
                e.stopPropagation();
                if (pinJustDragged.current) return;
                setContextMenu({ x: e.clientX, y: e.clientY, loc });
              } : undefined}
            >
              <div className="pin-body">
                {loc.icon_url ? (
                  <img
                    src={`${API_BASE}${loc.icon_url}`}
                    className="pin-icon-img"
                    alt={loc.name}
                    draggable={false}
                  />
                ) : TYPE_DEFAULT_ICONS[loc.type] ? (
                  <div
                    className="pin-icon-default"
                    style={{ background: TYPE_COLORS[loc.type] ?? TYPE_COLORS.city }}
                  >
                    <img src={TYPE_DEFAULT_ICONS[loc.type]} className="pin-icon-svg" alt={loc.type} draggable={false} />
                  </div>
                ) : (
                  <div
                    className="pin-dot"
                    style={{ background: TYPE_COLORS[loc.type] ?? TYPE_COLORS.city }}
                  />
                )}
                {pathNum !== undefined && (
                  <div className="pin-path-num">{pathNum}</div>
                )}
                {activeQuestCounts.has(loc.id) && (
                  <div
                    className="pin-quest-dot"
                    title={`${activeQuestCounts.get(loc.id)} active quest${activeQuestCounts.get(loc.id)! > 1 ? 's' : ''}`}
                  >
                    {activeQuestCounts.get(loc.id)! > 1 ? activeQuestCounts.get(loc.id) : '!'}
                  </div>
                )}
                <div className="pin-label">
                  <span>{loc.name}</span>
                  {loc.subtitle && <span className="pin-label-subtitle">{loc.subtitle}</span>}
                </div>
              </div>
            </div>
          );
        })}

      </div>

      {/* ── Scale bar (fixed in map-container corner, outside map-transform) ── */}
      {showScaleBar && (() => {
        const mapEl = imgRef.current ?? placeholderRef.current;
        // getBoundingClientRect includes CSS transform scale → real on-screen pixels
        const screenMapWidth  = mapEl ? mapEl.getBoundingClientRect().width : 0;
        const containerWidth  = containerRef.current?.offsetWidth ?? 0;
        if (mapScale && mapScale.value > 0) {
          return (
            <ScaleBar
              totalValue={mapScale.value}
              unit={mapScale.unit}
              screenMapWidth={screenMapWidth}
              containerWidth={containerWidth}
              isDM={isDMMode}
              onSet={onSetMapScale}
            />
          );
        }
        if (isDMMode && onSetMapScale) {
          return <ScaleBarUnset onSet={onSetMapScale} />;
        }
        return null;
      })()}

      {/* ── Type filter strip ──────────────────────────────────────────────── */}
      {presentTypes.length > 1 && (
        <div className="pin-type-filter" onClick={e => e.stopPropagation()}>
          {presentTypes.map(t => (
            <button
              key={t}
              className={`pin-type-filter-btn${hiddenTypes.has(t) ? ' hidden' : ''}`}
              style={{ '--filter-color': TYPE_COLORS[t] ?? TYPE_COLORS.city } as React.CSSProperties}
              onClick={() => toggleType(t)}
              title={`${hiddenTypes.has(t) ? 'Show' : 'Hide'} ${t} pins`}
            >
              {TYPE_ICONS_EMOJI[t] ?? '◈'} <span>{TYPE_LABELS_SHORT[t] ?? t}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Right-click context menu ───────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="pin-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="pin-context-name">{contextMenu.loc.name}</div>
          <button onClick={() => { onSelectLocation(contextMenu.loc.id); setContextMenu(null); }}>
            ✏️ Edit
          </button>
          {onDuplicateLocation && (
            <button onClick={() => { onDuplicateLocation(contextMenu.loc); setContextMenu(null); }}>
              📋 Duplicate
            </button>
          )}
          {onAddToPath && (
            <button onClick={() => { onAddToPath(contextMenu.loc.id); setContextMenu(null); }}>
              🧭 Add to Path
            </button>
          )}
          {contextMenu.loc.submap_image_url && onEnterSubmap && (
            <button onClick={() => { onEnterSubmap(contextMenu.loc.id); setContextMenu(null); }}>
              🗺 Enter Submap
            </button>
          )}
          {onDeleteLocation && (
            <button
              className="pin-context-delete"
              onClick={() => {
                if (confirm(`Delete "${contextMenu.loc.name}"?`)) {
                  onDeleteLocation(contextMenu.loc.id);
                }
                setContextMenu(null);
              }}
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
