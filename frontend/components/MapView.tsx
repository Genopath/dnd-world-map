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
};

const CHAR_COLORS = ['#e05c5c', '#5c9fe0', '#60cc78', '#c05ce0', '#e0a040', '#40d4c8', '#e07840', '#a0c840'];

type TravelType = 'foot' | 'horse' | 'boat' | 'fly';
const TRAVEL_STYLES: Record<TravelType, { color: string; dash: string; symbol: string }> = {
  foot:  { color: '#e8c05a', dash: '7,4',  symbol: '🥾' },
  horse: { color: '#d4884a', dash: '14,4', symbol: '🐴' },
  boat:  { color: '#5a9ae0', dash: '3,7',  symbol: '⛵' },
  fly:   { color: '#b090d0', dash: '2,9',  symbol: '🦅' },
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
  hiddenCharIds:      Set<number>;
  showPartyPath:      boolean;
  showLabels:         boolean;
  showDistLabels:     boolean;
  fitTrigger:         number;
  onSelectLocation:   (id: number) => void;
  onDeselect:         () => void;
  onAddPin:           (x: number, y: number) => void;
  onFogChange:        (data: string) => void;
  onExitSubmap:       () => void;
  onUpdateLocation?:  (id: number, data: Partial<Location>) => Promise<void>;
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
  showPartyPath,
  showLabels,
  showDistLabels,
  fitTrigger,
  onSelectLocation,
  onDeselect,
  onAddPin,
  onFogChange,
  onExitSubmap,
  onUpdateLocation,
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

  // ── Pin drag state ────────────────────────────────────────────────────────
  const pinDragRef     = useRef<{ id: number; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const pinJustDragged = useRef(false);
  const [dragOverrides, setDragOverrides] = useState<Map<number, { x: number; y: number }>>(new Map());

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

  // ── Pan ───────────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (fogPaintMode) return; // let FogCanvas handle it
    if (e.button !== 0) return;
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
  }, [dragOverrides, onUpdateLocation]);

  // ── Click (add pin or deselect) ───────────────────────────────────────────
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      if (fogPaintMode) return;
      if (hasDragged.current) return;

      const mapEl: HTMLElement | null = imgRef.current ?? placeholderRef.current;
      if (!mapEl) return;

      if (isAddingPin) {
        const rect = mapEl.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        if (x >= 0 && x <= 100 && y >= 0 && y <= 100) {
          onAddPin(x, y);
        }
      } else {
        onDeselect();
      }
    },
    [fogPaintMode, isAddingPin, onAddPin, onDeselect],
  );

  // ── Build ordered path for SVG ────────────────────────────────────────────
  // Use allLocations so path lines draw even when some waypoints are undiscovered
  const orderedSegments = [...playerPath]
    .sort((a, b) => a.position - b.position)
    .map(e => ({ loc: allLocations.find(l => l.id === e.location_id), travelType: e.travel_type, distance: e.distance, distance_unit: e.distance_unit }))
    .filter((s): s is { loc: Location; travelType: string | undefined; distance: number | null | undefined; distance_unit: string | null | undefined } => s.loc !== undefined);

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
        .map(e => ({ loc: allLocations.find(l => l.id === e.location_id), travelType: e.travel_type }))
        .filter((s): s is { loc: Location; travelType: string | undefined } => s.loc !== undefined);
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
      ].filter(Boolean).join(' ')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={e => { handleMouseUp(e); pinDragRef.current = null; setDragOverrides(new Map()); }}
      onClick={handleContainerClick}
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
            <filter id="glow">
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
              const prev = segments[i - 1];
              const style = travelStyle(seg.travelType);
              const mx = (prev.loc.x + seg.loc.x) / 2;
              const my = (prev.loc.y + seg.loc.y) / 2;
              return (
                <g key={`char-${member.id}-${i}`}>
                  <line
                    x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`}
                    x2={`${seg.loc.x}%`}  y2={`${seg.loc.y}%`}
                    stroke="#000" strokeWidth="3" strokeDasharray={style.dash} opacity="0.3"
                  />
                  <line
                    x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`}
                    x2={`${seg.loc.x}%`}  y2={`${seg.loc.y}%`}
                    stroke={color} strokeWidth="1.8" strokeDasharray={style.dash} opacity="0.85"
                  />
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
            const prev = orderedSegments[i - 1];
            const style = travelStyle(seg.travelType);
            const mx = (prev.loc.x + seg.loc.x) / 2;
            const my = (prev.loc.y + seg.loc.y) / 2;
            const distLabel = showDistLabels && seg.distance != null ? `${seg.distance}${seg.distance_unit ? ' ' + seg.distance_unit : ''}` : null;
            return (
              <g key={`path-line-${i}`}>
                <line
                  x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`}
                  x2={`${seg.loc.x}%`}  y2={`${seg.loc.y}%`}
                  stroke="#000" strokeWidth="4" strokeDasharray={style.dash} opacity="0.35"
                />
                <line
                  x1={`${prev.loc.x}%`} y1={`${prev.loc.y}%`}
                  x2={`${seg.loc.x}%`}  y2={`${seg.loc.y}%`}
                  stroke={style.color} strokeWidth="2.5" strokeDasharray={style.dash} opacity="0.9"
                  filter="url(#glow)"
                />
                <text x={`${mx}%`} y={`${my}%`} textAnchor="middle" dominantBaseline="middle"
                  fontSize="12" style={{ userSelect: 'none', pointerEvents: 'none' }}
                  filter="url(#glow)">
                  {style.symbol}
                  {distLabel && <tspan x={`${mx}%`} dy="13" fontSize="9" fill="#e8d9a0">{distLabel}</tspan>}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Pins */}
        {locations.map(loc => {
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
                <div className="pin-label">{loc.name}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
