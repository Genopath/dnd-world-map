import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CampaignSettings, CharacterPathEntry, Location, PartyMember, PathEntry, Quest } from '../types';
import { API_BASE } from '../lib/api';
import { playRulerTick } from '../lib/sounds';
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
  // Grid overlay
  showGrid?:          boolean;
  gridCellSize?:      number | null;   // how many map-units per grid cell
  onSetGridCell?:     (size: number) => void;
  // Ruler tool
  rulerActive?:       boolean;
  // Waypoint drawing — freehand drag on map
  waypointMode?:      { entryId: number; isChar: boolean } | null;
  onSaveWaypoints?:   (entryId: number, pts: [number, number][], isChar: boolean) => void;
  onCancelWaypoints?: () => void;
  // Party / character map tokens
  campaign?:             CampaignSettings | null;
  onUpdatePartyMarker?:  (x: number | null, y: number | null) => void;
  onUpdateCharMarker?:   (memberId: number, x: number | null, y: number | null) => void;
  onNavigateToParty?:    (memberId?: number) => void;
  onOpenCampMap?:        () => void;
  hasCampMap?:           boolean;
  pingTarget?:           { kind: 'party' | 'char'; memberId?: number; seq: number } | null;
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
  showGrid = false,
  gridCellSize,
  onSetGridCell,
  rulerActive = false,
  waypointMode,
  onSaveWaypoints,
  onCancelWaypoints,
  campaign,
  onUpdatePartyMarker,
  onUpdateCharMarker,
  onNavigateToParty,
  onOpenCampMap,
  hasCampMap,
  pingTarget,
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
  const lastPinchDist = useRef<number | null>(null);
  // Keep a ref to transform for use in non-React event handlers
  const transformRef = useRef(transform);
  transformRef.current = transform;
  // Keep waypointMode in a ref so mouse-event callbacks always see current value
  // without needing waypointMode in their deps arrays (avoids stale closure bugs)
  const waypointModeRef = useRef(waypointMode);
  waypointModeRef.current = waypointMode;

  // ── Ruler tool ───────────────────────────────────────────────────────────
  const [rulerPoints, setRulerPoints] = useState<[number, number][]>([]);
  const [rulerCursor, setRulerCursor] = useState<[number, number] | null>(null);
  const rulerActiveRef = useRef(rulerActive);
  rulerActiveRef.current = rulerActive;
  // Clear all ruler state when tool is deactivated
  useEffect(() => { if (!rulerActive) { setRulerPoints([]); setRulerCursor(null); } }, [rulerActive]);
  // Escape removes last placed point (undo), double-Escape clears all
  useEffect(() => {
    if (!rulerActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRulerPoints(prev => prev.slice(0, -1));
    };
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

  // ── Token drag state (party / char markers) ───────────────────────────────
  const tokenDragRef = useRef<{
    kind: 'party' | 'char'; memberId?: number;
    startX: number; startY: number;
    origX: number;  origY: number;
    moved: boolean;
    curX?: number;  curY?: number;
  } | null>(null);
  const [tokenDragPos, setTokenDragPos] = useState<{ kind: 'party' | 'char'; memberId?: number; x: number; y: number } | null>(null);

  // ── Token hover popup ─────────────────────────────────────────────────────
  const [tokenHover, setTokenHover] = useState<{
    screenX: number; screenY: number;
    kind: 'party' | 'char'; memberId?: number;
    partyX?: number | null; partyY?: number | null;
  } | null>(null);
  const tokenHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTokenHover = useCallback((
    kind: 'party' | 'char', memberId: number | undefined,
    partyX: number | null | undefined, partyY: number | null | undefined,
    e: React.MouseEvent,
  ) => {
    if (tokenHoverTimer.current) clearTimeout(tokenHoverTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTokenHover({ screenX: rect.left + rect.width / 2, screenY: rect.top, kind, memberId, partyX, partyY });
  }, []);
  const hideTokenHoverSoon = useCallback(() => {
    tokenHoverTimer.current = setTimeout(() => setTokenHover(null), 150);
  }, []);
  const cancelHide = useCallback(() => {
    if (tokenHoverTimer.current) clearTimeout(tokenHoverTimer.current);
  }, []);

  // ── Ping: pan to marker + pulse it ───────────────────────────────────────
  const [pingedToken, setPingedToken] = useState<string | null>(null);
  useEffect(() => {
    if (!pingTarget) return;
    const mapEl = imgRef.current ?? placeholderRef.current;
    const container = containerRef.current;
    let mx: number | null | undefined;
    let my: number | null | undefined;
    if (pingTarget.kind === 'party') {
      mx = campaign?.party_marker_x;
      my = campaign?.party_marker_y;
    } else {
      const m = party.find(p => p.id === pingTarget.memberId);
      mx = m?.marker_x;
      my = m?.marker_y;
    }
    if (mx != null && my != null && mapEl && container) {
      const cw = container.offsetWidth;
      const ch = container.offsetHeight;
      const iw = mapEl.offsetWidth;
      const ih = mapEl.offsetHeight;
      const scale = transformRef.current.scale;
      setTransform(prev => ({
        ...prev,
        x: cw / 2 - (mx! / 100) * iw * scale,
        y: ch / 2 - (my! / 100) * ih * scale,
      }));
    }
    const key = pingTarget.kind === 'party' ? 'party' : `char-${pingTarget.memberId}`;
    setPingedToken(key);
    const t = setTimeout(() => setPingedToken(null), 2000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingTarget]);

  // Always-current ref so document listeners can call the latest callbacks / data
  const updateMarkersRef = useRef({ onUpdatePartyMarker, onUpdateCharMarker });
  updateMarkersRef.current = { onUpdatePartyMarker, onUpdateCharMarker };
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  // Document-level drag — more reliable than relying on React synthetic mousemove
  const startTokenDrag = useCallback((
    kind: 'party' | 'char', memberId: number | undefined,
    origX: number, origY: number,
    startClientX: number, startClientY: number,
  ) => {
    tokenDragRef.current = { kind, memberId, startX: startClientX, startY: startClientY, origX, origY, moved: false };

    const move = (clientX: number, clientY: number) => {
      const td = tokenDragRef.current;
      if (!td) return;
      const dx = clientX - td.startX;
      const dy = clientY - td.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        td.moved = true;
        const mapEl = imgRef.current ?? placeholderRef.current;
        if (mapEl) {
          const scale = transformRef.current.scale;
          const newX = Math.max(0, Math.min(100, td.origX + (dx / (mapEl.offsetWidth  * scale)) * 100));
          const newY = Math.max(0, Math.min(100, td.origY + (dy / (mapEl.offsetHeight * scale)) * 100));
          td.curX = newX;
          td.curY = newY;
          setTokenDragPos({ kind: td.kind, memberId: td.memberId, x: newX, y: newY });
        }
      }
    };

    const onMove      = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY); };

    const SNAP_PX_THRESHOLD = 3.5; // % units — snap if dropped within this distance of a pin
    const onUp = () => {
      const td = tokenDragRef.current;
      if (td?.moved && td.curX != null && td.curY != null) {
        const { onUpdatePartyMarker, onUpdateCharMarker } = updateMarkersRef.current;
        let finalX = td.curX;
        let finalY = td.curY;
        for (const loc of locationsRef.current) {
          if (Math.abs(loc.x - finalX) <= SNAP_PX_THRESHOLD && Math.abs(loc.y - finalY) <= SNAP_PX_THRESHOLD) {
            finalX = loc.x;
            finalY = loc.y;
            break;
          }
        }
        if (td.kind === 'party') onUpdatePartyMarker?.(finalX, finalY);
        else if (td.kind === 'char' && td.memberId != null) onUpdateCharMarker?.(td.memberId, finalX, finalY);
      }
      tokenDragRef.current = null;
      setTokenDragPos(null);
      document.removeEventListener('mousemove',  onMove);
      document.removeEventListener('mouseup',    onUp);
      document.removeEventListener('touchmove',  onTouchMove);
      document.removeEventListener('touchend',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false } as AddEventListenerOptions);
    document.addEventListener('touchend',  onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Map context menu (right-click on empty map / tokens) ─────────────────
  const [mapCtxMenu, setMapCtxMenu] = useState<{ screenX: number; screenY: number; mapX: number; mapY: number; tokenKind?: 'party' | 'char'; memberId?: number } | null>(null);
  useEffect(() => {
    if (!mapCtxMenu) return;
    const close = () => setMapCtxMenu(null);
    document.addEventListener('click', close);
    // Do NOT close on contextmenu — that would kill the menu the instant it opens
    return () => { document.removeEventListener('click', close); };
  }, [mapCtxMenu]);

  // Refs so the native listener always reads current props/state without re-registering
  const _ctxStateRef = useRef({ isDMMode, fogPaintMode, isAddingPin });
  _ctxStateRef.current = { isDMMode, fogPaintMode, isAddingPin };

  // Native contextmenu listener — more reliable than React synthetic for <img> elements
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: MouseEvent) => {
      const { isDMMode, fogPaintMode, isAddingPin } = _ctxStateRef.current;
      if (!isDMMode || fogPaintMode || isAddingPin) return;
      // Let pins & tokens handle their own right-click via React synthetic events
      const target = e.target as HTMLElement;
      if (target.closest('.pin') || target.closest('.party-token')) return;
      e.preventDefault();
      const mapEl = imgRef.current ?? placeholderRef.current;
      if (!mapEl) return;
      const rect = mapEl.getBoundingClientRect();
      const mapX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const mapY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      setMapCtxMenu({ screenX: e.clientX, screenY: e.clientY, mapX, mapY });
    };
    container.addEventListener('contextmenu', handler);
    return () => container.removeEventListener('contextmenu', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Filtered locations (type visibility + player visibility toggle)
  const visibleLocations = useMemo(
    () => locations.filter(l =>
      !hiddenTypes.has(l.type) &&
      (isDMMode || l.is_visible !== false)
    ),
    [locations, hiddenTypes, isDMMode],
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
          distance: e.distance,
          distance_unit: e.distance_unit,
          travel_time: e.travel_time,
          travel_time_unit: e.travel_time_unit,
        }))
        .filter((s): s is {
          loc: Location; travelType: string | undefined;
          direction: 'forward' | 'backward' | 'both'; waypoints: [number, number][];
          entryId: number;
          distance: number | null | undefined; distance_unit: string | null | undefined;
          travel_time: number | null | undefined; travel_time_unit: string | null | undefined;
        } => s.loc !== undefined);
      return { member, color, segments };
    })
    .filter(cp => cp.segments.length > 1);

  // Build a lookup: location id → path position (1-based)
  const pathPositions: Record<number, number> = {};
  [...playerPath]
    .sort((a, b) => a.position - b.position)
    .forEach((e, i) => { pathPositions[e.location_id] = i + 1; });

  // ── Touch: pan (1 finger) + pinch-zoom (2 fingers) ─────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (fogPaintMode) return;
    if ((e.target as HTMLElement).closest('.party-token, .party-bauble')) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      isDragging.current  = true;
      hasDragged.current  = false;
      lastPinchDist.current = null;
      dragStart.current = { x: t.clientX, y: t.clientY, tx: transformRef.current.x, ty: transformRef.current.y };
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, [fogPaintMode]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (fogPaintMode) return;
    if (e.touches.length === 1 && isDragging.current) {
      const t   = e.touches[0];
      const dx  = t.clientX - dragStart.current.x;
      const dy  = t.clientY - dragStart.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
      setTransform(prev => ({ ...prev, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }));
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX;
      const dy   = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / lastPinchDist.current;
      lastPinchDist.current = dist;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const el   = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setTransform(prev => {
          const newScale = Math.max(0.25, Math.min(10, prev.scale * factor));
          const mx = midX - rect.left;
          const my = midY - rect.top;
          const ratio = newScale / prev.scale;
          return { x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio, scale: newScale };
        });
      }
    }
  }, [fogPaintMode]);

  const handleTouchEnd = useCallback(() => {
    isDragging.current    = false;
    lastPinchDist.current = null;
  }, []);

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
      style={{ touchAction: 'none' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
        setRulerPoints(prev => [...prev, [x, y] as [number, number]]);
        playRulerTick();
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

        {/* ── Grid overlay ─────────────────────────────────────────────── */}
        {showGrid && mapScale && mapScale.value > 0 && gridCellSize && gridCellSize > 0 && (() => {
          const mapEl = imgRef.current;
          if (!mapEl) return null;
          // Cell size as % of map width (x) and % of map height (y, aspect-ratio-corrected)
          const natW = mapEl.naturalWidth  || mapEl.offsetWidth  || 1;
          const natH = mapEl.naturalHeight || mapEl.offsetHeight || 1;
          const cellPctX = (gridCellSize / mapScale.value) * 100;
          const cellPctY = cellPctX * (natW / natH); // correct for non-square maps
          const cols = Math.ceil(100 / cellPctX) + 1;
          const rows = Math.ceil(100 / cellPctY) + 1;
          const lines: React.ReactNode[] = [];
          for (let c = 0; c <= cols; c++) {
            const x = c * cellPctX;
            lines.push(<line key={`gc${c}`} x1={`${x}%`} y1="0%" x2={`${x}%`} y2="100%"
              stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />);
          }
          for (let r = 0; r <= rows; r++) {
            const y = r * cellPctY;
            lines.push(<line key={`gr${r}`} x1="0%" y1={`${y}%`} x2="100%" y2={`${y}%`}
              stroke="rgba(255,255,255,0.45)" strokeWidth="0.8" />);
          }
          return (
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3, overflow: 'visible' }}>
              {lines}
            </svg>
          );
        })()}

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
              const midPt = allPts[Math.floor(allPts.length / 2)];
              const mx = midPt[0];
              const my = midPt[1];
              const distLabel = showDistLabels && seg.distance != null
                ? `${seg.distance}${seg.distance_unit ? ' ' + seg.distance_unit : ''}` : null;
              const timeLabel = showTimeLabels && seg.travel_time != null
                ? `${seg.travel_time}${seg.travel_time_unit ? ' ' + seg.travel_time_unit : ''}` : null;
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
                    {distLabel && (
                      <tspan x={`${mx}%`} dy="13" fontSize="9"
                        style={{ fill: '#ffe58a', stroke: '#000', strokeWidth: '2.5', paintOrder: 'stroke' }}>{distLabel}</tspan>
                    )}
                    {timeLabel && (
                      <tspan x={`${mx}%`} dy={distLabel ? '12' : '13'} fontSize="9"
                        style={{ fill: '#80d8ff', stroke: '#000', strokeWidth: '2.5', paintOrder: 'stroke' }}>{timeLabel}</tspan>
                    )}
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
            const midPt = allPts[Math.floor(allPts.length / 2)];
            const mx = midPt[0];
            const my = midPt[1];
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
          {rulerActive && rulerPoints.length > 0 && (() => {
            const mapEl = imgRef.current;
            const natW = mapEl?.naturalWidth  || mapEl?.offsetWidth  || 1;
            const natH = mapEl?.naturalHeight || mapEl?.offsetHeight || 1;

            function segDist(x1: number, y1: number, x2: number, y2: number): number {
              if (!mapScale || mapScale.value <= 0) return 0;
              const dx = (x2 - x1) / 100 * mapScale.value;
              const dy = (y2 - y1) / 100 * mapScale.value * (natH / natW);
              return Math.sqrt(dx * dx + dy * dy);
            }
            function fmtDist(d: number): string {
              if (!mapScale) return '';
              if (d >= 10000) return `${(d / 1000).toFixed(1)}k ${mapScale.unit}`;
              if (d >= 10)    return `${Math.round(d).toLocaleString()} ${mapScale.unit}`;
              if (d >= 1)     return `${d.toFixed(1)} ${mapScale.unit}`;
              return `${d.toFixed(2)} ${mapScale.unit}`;
            }

            // Accumulate distance across all placed segments
            let totalDist = 0;
            for (let i = 1; i < rulerPoints.length; i++) {
              const [x1, y1] = rulerPoints[i - 1];
              const [x2, y2] = rulerPoints[i];
              totalDist += segDist(x1, y1, x2, y2);
            }
            // Preview segment from last placed point to cursor
            const last = rulerPoints[rulerPoints.length - 1];
            const previewDist = rulerCursor ? segDist(last[0], last[1], rulerCursor[0], rulerCursor[1]) : 0;
            const grandTotal = totalDist + previewDist;

            const textStyle: React.CSSProperties = {
              fill: '#f0e060', stroke: '#000', strokeWidth: '3',
              paintOrder: 'stroke', userSelect: 'none', pointerEvents: 'none',
            };

            return (
              <g>
                {/* Placed segments */}
                {rulerPoints.map((pt, i) => {
                  if (i === 0) return null;
                  const prev = rulerPoints[i - 1];
                  const mx = (prev[0] + pt[0]) / 2;
                  const my = (prev[1] + pt[1]) / 2;
                  const d = segDist(prev[0], prev[1], pt[0], pt[1]);
                  return (
                    <g key={`rs${i}`}>
                      <line x1={`${prev[0]}%`} y1={`${prev[1]}%`} x2={`${pt[0]}%`} y2={`${pt[1]}%`}
                        stroke="#000" strokeWidth="3.5" opacity="0.5" />
                      <line x1={`${prev[0]}%`} y1={`${prev[1]}%`} x2={`${pt[0]}%`} y2={`${pt[1]}%`}
                        stroke="#f0e060" strokeWidth="1.8" />
                      {mapScale && d > 0 && (
                        <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" dominantBaseline="auto"
                          fontSize="11" fontWeight="700" style={textStyle}>
                          {fmtDist(d)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Waypoint dots */}
                {rulerPoints.map((pt, i) => (
                  <g key={`rd${i}`}>
                    <circle cx={`${pt[0]}%`} cy={`${pt[1]}%`} r="5" fill="#f0e060" stroke="#000" strokeWidth="1.5" />
                    {i === 0 && (
                      <text x={`${pt[0]}%`} y={`${pt[1] - 1.5}%`} textAnchor="middle" dominantBaseline="auto"
                        fontSize="9" style={textStyle}>START</text>
                    )}
                  </g>
                ))}

                {/* Live preview segment */}
                {rulerCursor && (
                  <>
                    <line x1={`${last[0]}%`} y1={`${last[1]}%`} x2={`${rulerCursor[0]}%`} y2={`${rulerCursor[1]}%`}
                      stroke="#000" strokeWidth="3.5" strokeDasharray="10,5" opacity="0.5" />
                    <line x1={`${last[0]}%`} y1={`${last[1]}%`} x2={`${rulerCursor[0]}%`} y2={`${rulerCursor[1]}%`}
                      stroke="#f0e060" strokeWidth="1.8" strokeDasharray="10,5" opacity="0.75" />
                    {/* Cursor dot */}
                    <circle cx={`${rulerCursor[0]}%`} cy={`${rulerCursor[1]}%`} r="4"
                      fill="none" stroke="#f0e060" strokeWidth="1.8" />
                    <circle cx={`${rulerCursor[0]}%`} cy={`${rulerCursor[1]}%`} r="1.5" fill="#f0e060" />
                    {/* Total distance near cursor */}
                    {mapScale && grandTotal > 0 && (
                      <text x={`${rulerCursor[0]}%`} y={`${rulerCursor[1] - 2}%`}
                        textAnchor="middle" dominantBaseline="auto"
                        fontSize="13" fontWeight="700" style={textStyle}>
                        {rulerPoints.length > 1 ? `Total: ${fmtDist(grandTotal)}` : fmtDist(grandTotal)}
                      </text>
                    )}
                  </>
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
                {/* Border ring — animated ring around the pin icon */}
                {loc.pin_border && loc.pin_border !== 'none' && (
                  <div className={`pin-border-ring pin-border-ring--${loc.pin_border}`} />
                )}
                {/* Style badge — floats above the pin icon, doesn't replace it */}
                {loc.pin_style && loc.pin_style !== 'default' && (
                  <div className={`pin-style-badge pin-style-badge--${loc.pin_style}`}>
                    {loc.pin_style === 'arcane' ? (
                      <>
                        <div className="pin-arcane-ring" />
                        <div className="pin-arcane-ring pin-arcane-ring--2" />
                        <svg viewBox="0 0 24 24" fill="none">
                          <ellipse cx="12" cy="12" rx="9" ry="5.5" stroke="currentColor" strokeWidth="1.5"/>
                          <circle cx="12" cy="12" r="2.8" fill="currentColor"/>
                          <ellipse cx="12" cy="12" rx="1.1" ry="2.8" fill="#07070d"/>
                        </svg>
                      </>
                    ) : loc.pin_style === 'flame' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 2C10 6 7 9 7 13C7 17.4 9.1 21 12 21C14.9 21 17 17.4 17 13C17 9 14 6 12 2Z" fill="currentColor"/>
                        <path d="M12 11C11 13 11 15 12 16.5C13 15 13 13 12 11Z" fill="rgba(0,0,0,0.35)"/>
                      </svg>
                    ) : loc.pin_style === 'frost' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
                      </svg>
                    ) : loc.pin_style === 'cursed' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 4C8.7 4 6 6.7 6 10C6 12.3 7.2 14.3 9 15.4V17C9 17.6 9.4 18 10 18H14C14.6 18 15 17.6 15 17V15.4C16.8 14.3 18 12.3 18 10C18 6.7 15.3 4 12 4Z" fill="currentColor"/>
                        <rect x="9.5" y="18" width="5" height="2" rx="1" fill="currentColor"/>
                        <circle cx="9.5" cy="10" r="1.5" fill="#07070d"/>
                        <circle cx="14.5" cy="10" r="1.5" fill="#07070d"/>
                      </svg>
                    ) : loc.pin_style === 'divine' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="3.5" fill="currentColor"/>
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    ) : loc.pin_style === 'storm' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M13 2L4 14h7l-2 8 11-12h-7z" fill="currentColor"/>
                      </svg>
                    ) : loc.pin_style === 'shadow' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M12 2C8.1 2 5 5.1 5 9V19L7 17.5L9 19L11 17.5L12 19L13 17.5L15 19L17 17.5L19 19V9C19 5.1 15.9 2 12 2Z" fill="currentColor"/>
                        <circle cx="9.5" cy="9" r="1.5" fill="rgba(0,0,0,0.4)"/>
                        <circle cx="14.5" cy="9" r="1.5" fill="rgba(0,0,0,0.4)"/>
                      </svg>
                    ) : loc.pin_style === 'lair' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M7 5L8.5 9M17 5L15.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M12 5C8.7 5 6 7.7 6 11C6 13.3 7.2 15.3 9 16.4V18H15V16.4C16.8 15.3 18 13.3 18 11C18 7.7 15.3 5 12 5Z" fill="currentColor"/>
                        <circle cx="9.5" cy="11" r="1.5" fill="#07070d"/>
                        <circle cx="14.5" cy="11" r="1.5" fill="#07070d"/>
                        <path d="M10 14.5C10.5 15.5 11.2 16 12 16C12.8 16 13.5 15.5 14 14.5" stroke="#07070d" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
                      </svg>
                    ) : loc.pin_style === 'swords' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        {/* Blade 1: NW→SE */}
                        <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        {/* Guard 1 */}
                        <line x1="13" y1="15" x2="17" y2="11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        {/* Blade 2: NE→SW */}
                        <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        {/* Guard 2 */}
                        <line x1="7" y1="11" x2="11" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                        {/* Crosspoint gem */}
                        <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
                      </svg>
                    ) : loc.pin_style === 'arrows' ? (
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        {/* N */}
                        <path d="M12 2L9 7h6z"/>
                        {/* S */}
                        <path d="M12 22L9 17h6z"/>
                        {/* W */}
                        <path d="M2 12L7 9v6z"/>
                        {/* E */}
                        <path d="M22 12L17 9v6z"/>
                        {/* Center */}
                        <circle cx="12" cy="12" r="2"/>
                      </svg>
                    ) : loc.pin_style === 'quake' ? (
                      <svg viewBox="0 0 24 24" fill="none">
                        {/* Main fissure zigzag */}
                        <path d="M12 2L8 9L13 12L7 22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        {/* Side cracks */}
                        <path d="M8 9L4 8M13 12L17 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.75"/>
                        <path d="M7 22L4 21M7 22L9 23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
                      </svg>
                    ) : null}
                  </div>
                )}
                {/* Normal pin icon — always rendered */}
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
              {/* ── Party / char baubles snapped to this pin ─────────────── */}
              {(() => {
                const baubles: React.ReactNode[] = [];
                const partyDragging = tokenDragPos?.kind === 'party';
                if (campaign &&
                    !partyDragging &&
                    campaign.party_marker_x === loc.x && campaign.party_marker_y === loc.y &&
                    (isDMMode || campaign.party_marker_visible !== false)) {
                  baubles.push(
                    <div key="party" className={`party-bauble party-bauble--party${pingedToken === 'party' ? ' token-pinged' : ''}${hasCampMap ? ' party-token--has-camp' : ''}`}
                      onMouseDown={isDMMode ? e => { e.stopPropagation(); startTokenDrag('party', undefined, loc.x, loc.y, e.clientX, e.clientY); } : undefined}
                      onTouchStart={isDMMode ? e => { e.stopPropagation(); startTokenDrag('party', undefined, loc.x, loc.y, e.touches[0].clientX, e.touches[0].clientY); } : undefined}
                      onMouseEnter={e => showTokenHover('party', undefined, loc.x, loc.y, e)}
                      onMouseLeave={hideTokenHoverSoon}
                      onClick={e => { e.stopPropagation(); if (hasCampMap && onOpenCampMap) { onOpenCampMap(); } else { onNavigateToParty?.(); } }}
                      title={hasCampMap ? 'Click to open camp map' : 'Party marker'}
                      data-no-draw
                    >⚔</div>
                  );
                }
                for (const m of party) {
                  const charDragging = tokenDragPos?.kind === 'char' && tokenDragPos.memberId === m.id;
                  if (!charDragging && m.marker_x === loc.x && m.marker_y === loc.y &&
                      (isDMMode || m.marker_visible !== false)) {
                    const bpingKey = `char-${m.id}`;
                    baubles.push(
                      <div key={`char-${m.id}`} className={`party-bauble party-bauble--char${pingedToken === bpingKey ? ' token-pinged' : ''}`}
                        style={{ '--bauble-color': m.path_color } as React.CSSProperties}
                        onMouseDown={isDMMode ? e => { e.stopPropagation(); startTokenDrag('char', m.id, loc.x, loc.y, e.clientX, e.clientY); } : undefined}
                        onTouchStart={isDMMode ? e => { e.stopPropagation(); startTokenDrag('char', m.id, loc.x, loc.y, e.touches[0].clientX, e.touches[0].clientY); } : undefined}
                        onMouseEnter={e => showTokenHover('char', m.id, undefined, undefined, e)}
                        onMouseLeave={hideTokenHoverSoon}
                        onContextMenu={isDMMode ? e => { e.preventDefault(); e.stopPropagation(); setMapCtxMenu({ screenX: e.clientX, screenY: e.clientY, mapX: loc.x, mapY: loc.y, tokenKind: 'char', memberId: m.id }); } : undefined}
                        onClick={e => { e.stopPropagation(); onNavigateToParty?.(m.id); }}
                        data-no-draw
                      >{m.name[0]?.toUpperCase()}</div>
                    );
                  }
                }
                return baubles.length > 0 ? <div className="pin-baubles">{baubles}</div> : null;
              })()}
            </div>
          );
        })}

        {/* ── Floating party token (not snapped to any pin) ──────────────── */}
        {campaign != null && (() => {
          const partyDragging = tokenDragPos?.kind === 'party';
          const mx = partyDragging ? tokenDragPos!.x : campaign.party_marker_x;
          const my = partyDragging ? tokenDragPos!.y : campaign.party_marker_y;
          if (mx == null || my == null) return null;
          if (!isDMMode && campaign.party_marker_visible === false) return null;
          // If snapped to a visible pin and not mid-drag, render as bauble there instead
          if (!partyDragging && visibleLocations.some(l => l.x === campaign.party_marker_x && l.y === campaign.party_marker_y)) return null;
          return (
            <div
              className={`party-token${pingedToken === 'party' ? ' token-pinged' : ''}${hasCampMap ? ' party-token--has-camp' : ''}`}
              style={{ left: `${mx}%`, top: `${my}%` }}
              onMouseDown={isDMMode ? e => { e.stopPropagation(); startTokenDrag('party', undefined, mx, my, e.clientX, e.clientY); } : undefined}
              onTouchStart={isDMMode ? e => { e.stopPropagation(); startTokenDrag('party', undefined, mx, my, e.touches[0].clientX, e.touches[0].clientY); } : undefined}
              onMouseEnter={e => showTokenHover('party', undefined, mx, my, e)}
              onMouseLeave={hideTokenHoverSoon}
              onClick={e => { e.stopPropagation(); if (hasCampMap && onOpenCampMap) { onOpenCampMap(); } else { onNavigateToParty?.(); } }}
              data-no-draw
              title={hasCampMap ? 'Click to open camp map' : 'Party marker'}
            >⚔</div>
          );
        })()}

        {/* ── Floating char tokens (not snapped to any pin) ─────────────── */}
        {party.map(member => {
          const charDragging = tokenDragPos?.kind === 'char' && tokenDragPos.memberId === member.id;
          const mx = charDragging ? tokenDragPos!.x : member.marker_x;
          const my = charDragging ? tokenDragPos!.y : member.marker_y;
          if (mx == null || my == null) return null;
          if (!isDMMode && member.marker_visible === false) return null;
          if (!charDragging && visibleLocations.some(l => l.x === member.marker_x && l.y === member.marker_y)) return null;
          const pingKey = `char-${member.id}`;
          return (
            <div key={`char-token-${member.id}`}
              className={`party-token party-token--char${pingedToken === pingKey ? ' token-pinged' : ''}`}
              style={{ left: `${mx}%`, top: `${my}%`, '--token-color': member.path_color } as React.CSSProperties}
              onMouseDown={isDMMode ? e => { e.stopPropagation(); startTokenDrag('char', member.id, mx, my, e.clientX, e.clientY); } : undefined}
              onTouchStart={isDMMode ? e => { e.stopPropagation(); startTokenDrag('char', member.id, mx, my, e.touches[0].clientX, e.touches[0].clientY); } : undefined}
              onMouseEnter={e => showTokenHover('char', member.id, undefined, undefined, e)}
              onMouseLeave={hideTokenHoverSoon}
              onClick={e => { e.stopPropagation(); onNavigateToParty?.(member.id); }}
              onContextMenu={isDMMode ? e => { e.preventDefault(); e.stopPropagation(); setMapCtxMenu({ screenX: e.clientX, screenY: e.clientY, mapX: mx, mapY: my, tokenKind: 'char', memberId: member.id }); } : undefined}
              data-no-draw
            >{member.name[0]?.toUpperCase()}</div>
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
          {/* ── Party / char token snap-to-pin (toggle place/remove) ─────── */}
          {(onUpdatePartyMarker || onUpdateCharMarker) && (
            <div className="pin-context-sep" />
          )}
          {onUpdatePartyMarker && (() => {
            const isHere = campaign?.party_marker_x === contextMenu.loc.x && campaign?.party_marker_y === contextMenu.loc.y;
            return (
              <button
                className={isHere ? 'pin-context-delete' : undefined}
                onClick={() => { onUpdatePartyMarker(isHere ? null : contextMenu.loc.x, isHere ? null : contextMenu.loc.y); setContextMenu(null); }}
              >{isHere ? '⚔ Remove Party' : '⚔ Party Here'}</button>
            );
          })()}
          {onUpdateCharMarker && party.map(m => {
            const isHere = m.marker_x === contextMenu.loc.x && m.marker_y === contextMenu.loc.y;
            return (
              <button key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                className={isHere ? 'pin-context-delete' : undefined}
                onClick={() => { onUpdateCharMarker(m.id, isHere ? null : contextMenu.loc.x, isHere ? null : contextMenu.loc.y); setContextMenu(null); }}>
                <span style={{ color: m.path_color, fontSize: 10 }}>●</span>
                {isHere ? `Remove ${m.name}` : m.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Token hover popup ─────────────────────────────────────────────── */}
      {tokenHover && (() => {
        const together = party.filter(m => m.marker_x == null && m.marker_y == null);
        const hoverMember = tokenHover.kind === 'char' ? party.find(m => m.id === tokenHover.memberId) : null;
        return (
          <div
            className="token-hover-popup"
            style={{ left: tokenHover.screenX, top: tokenHover.screenY }}
            onMouseEnter={cancelHide}
            onMouseLeave={hideTokenHoverSoon}
            onClick={e => e.stopPropagation()}
          >
            {tokenHover.kind === 'party' ? (
              <>
                <div className="thp-header">⚔ Party <span className="thp-count">({together.length})</span></div>
                {together.length === 0
                  ? <div className="thp-empty">Everyone separated</div>
                  : together.map(m => (
                    <div key={m.id} className="thp-member">
                      <span style={{ color: m.path_color }}>●</span>
                      <span className="thp-name">{m.name}</span>
                      {isDMMode && (
                        <button className="thp-action" title="Give them their own marker" onClick={() => {
                          onUpdateCharMarker?.(m.id, tokenHover.partyX ?? null, tokenHover.partyY ?? null);
                          setTokenHover(null);
                        }}>↗ Separate</button>
                      )}
                    </div>
                  ))
                }
                <div className="thp-sep" />
                <button className="thp-nav" onClick={() => { onNavigateToParty?.(); setTokenHover(null); }}>View party →</button>
              </>
            ) : (
              <>
                <div className="thp-header">
                  <span style={{ color: hoverMember?.path_color }}>●</span> {hoverMember?.name ?? 'Character'}
                </div>
                {hoverMember?.class_name && <div className="thp-sub">{hoverMember.class_name}</div>}
                {isDMMode && (
                  <button className="thp-action thp-rejoin" onClick={() => {
                    if (tokenHover.memberId != null) onUpdateCharMarker?.(tokenHover.memberId, null, null);
                    setTokenHover(null);
                  }}>↩ Rejoin Party</button>
                )}
                <div className="thp-sep" />
                <button className="thp-nav" onClick={() => { onNavigateToParty?.(tokenHover.memberId); setTokenHover(null); }}>View character →</button>
              </>
            )}
          </div>
        );
      })()}

      {/* ── Map / token context menu (outside map-transform to avoid CSS transform offset) ── */}
      {mapCtxMenu && (
        <div
          className="pin-context-menu"
          style={{ left: mapCtxMenu.screenX, top: mapCtxMenu.screenY }}
          onClick={e => e.stopPropagation()}
        >
          {mapCtxMenu.tokenKind === 'char' ? (
            <>
              <div className="pin-context-name">
                {party.find(m => m.id === mapCtxMenu.memberId)?.name ?? 'Character'} Marker
              </div>
              <button className="pin-context-delete" onClick={() => {
                if (mapCtxMenu.memberId != null) onUpdateCharMarker?.(mapCtxMenu.memberId, null, null);
                setMapCtxMenu(null);
              }}>🗑 Remove Marker</button>
            </>
          ) : (
            <>
              <div className="pin-context-name">Place Marker</div>
              {onUpdatePartyMarker && (
                <button onClick={() => { onUpdatePartyMarker(mapCtxMenu.mapX, mapCtxMenu.mapY); setMapCtxMenu(null); }}>
                  ⚔ Party Here
                </button>
              )}
              {onUpdateCharMarker && party.map(m => (
                <button key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => {
                  onUpdateCharMarker(m.id, mapCtxMenu.mapX, mapCtxMenu.mapY);
                  setMapCtxMenu(null);
                }}>
                  <span style={{ color: m.path_color, fontSize: 10 }}>●</span> {m.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
