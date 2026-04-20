import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction, NPC, PartyMember, RelationshipEdge } from '../types';

// ── Canvas constants ──────────────────────────────────────────────────────────
const W = 1000;
const H = 700;
const NPC_R    = 30;
const PARTY_R  = 28;
const FACT_W   = 110;
const FACT_H   = 40;

const PRESET_LABELS = ['ally', 'enemy', 'rival', 'family', 'serves', 'knows', 'neutral'];

const EDGE_COLORS: Record<string, string> = {
  ally:    '#72b86e',
  enemy:   '#d46060',
  rival:   '#cc8844',
  family:  '#9a70cc',
  serves:  '#c9a84c',
  knows:   '#6ab0cc',
  neutral: '#666688',
};
const edgeColor = (label: string) => EDGE_COLORS[label.toLowerCase()] ?? '#8a8098';

type NodeKind = 'npc' | 'faction' | 'party';
function nodeKey(type: NodeKind, id: number) { return `${type}-${id}`; }

// Stable golden-angle placement — position depends only on id, not list order
const GOLDEN = 2.399963;
function defaultPos(type: NodeKind, id: number): { x: number; y: number } {
  const angle = (id * GOLDEN) % (2 * Math.PI) - Math.PI / 2;
  const r = type === 'faction' ? 120 : type === 'party' ? 210 : 310;
  return { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
}

const FACTION_COLORS = ['#7b5ea7', '#5e8a7b', '#a7695e', '#5e7ba7', '#a79c5e', '#a75e7b'];
function randomFactionColor() { return FACTION_COLORS[Math.floor(Math.random() * FACTION_COLORS.length)]; }

interface EdgeMenu { edgeId: number; active: boolean; x: number; y: number; }
interface NodeCtx  { type: NodeKind; id: number; name: string; x: number; y: number; }

interface Props {
  npcs:             NPC[];
  factions:         Faction[];
  party:            PartyMember[];
  isDMMode:         boolean;
  onCreateNPC?:     (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>) => Promise<NPC>;
  onCreateFaction?: (data: Omit<Faction, 'id' | 'created_at'>) => Promise<Faction>;
  onDeleteNPC?:     (id: number) => Promise<void>;
  onDeleteFaction?: (id: number) => Promise<void>;
}

export default function RelationshipWeb({
  npcs, factions, party, isDMMode,
  onCreateNPC, onCreateFaction, onDeleteNPC, onDeleteFaction,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [edges,     setEdges]     = useState<RelationshipEdge[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading,   setLoading]   = useState(true);

  // ── Transform ─────────────────────────────────────────────────────────────
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const xfRef = useRef({ tx: 0, ty: 0, scale: 1 });
  xfRef.current = { tx, ty, scale };

  // ── Interaction mode ──────────────────────────────────────────────────────
  const mode      = useRef<'idle' | 'pan' | 'drag'>('idle');
  const panOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const dragState = useRef<{ key: string; origX: number; origY: number; startCx: number; startCy: number } | null>(null);
  // track mouse movement since mousedown to distinguish click vs drag
  const mouseMovedPx = useRef(0);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selecting,   setSelecting]   = useState<{ type: NodeKind; id: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ from: { type: NodeKind; id: number }; to: { type: NodeKind; id: number }; screenX: number; screenY: number } | null>(null);
  const [labelDraft,  setLabelDraft]  = useState('');
  const [hoveredKey,  setHoveredKey]  = useState<string | null>(null);
  const [edgeMenu,    setEdgeMenu]    = useState<EdgeMenu | null>(null);
  const [nodeCtx,     setNodeCtx]     = useState<NodeCtx | null>(null);

  // Quick-add
  const [showAdd, setShowAdd] = useState(false);
  const [addKind, setAddKind] = useState<'npc' | 'faction'>('npc');
  const [addName, setAddName] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([api.relationships.listEdges(), api.relationships.listPositions()])
      .then(([edgeList, posList]) => {
        setEdges(edgeList);
        const map: Record<string, { x: number; y: number }> = {};
        posList.forEach(p => { map[nodeKey(p.entity_type as NodeKind, p.entity_id)] = { x: p.x, y: p.y }; });
        setPositions(map);
      })
      .finally(() => setLoading(false));
  }, []);

  const getPos = useCallback((type: NodeKind, id: number) => {
    return positions[nodeKey(type, id)] ?? defaultPos(type, id);
  }, [positions]);

  // ── Fit view ──────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const s = Math.min(rect.width / W, rect.height / H) * 0.88;
    setScale(s);
    setTx(rect.width  / 2 - (W / 2) * s);
    setTy(rect.height / 2 - (H / 2) * s);
  }, []);
  useEffect(() => { requestAnimationFrame(fitView); }, [fitView]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const applyZoom = (factor: number, cx: number, cy: number) => {
      const rect = svg.getBoundingClientRect();
      const { tx, ty, scale } = xfRef.current;
      const mx = cx - rect.left; const my = cy - rect.top;
      const ns = Math.max(0.1, Math.min(6, scale * factor));
      const r = ns / scale;
      setScale(ns); setTx(mx - (mx - tx) * r); setTy(my - (my - ty) * r);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    };
    // Pinch-to-zoom via touch
    let lastDist = 0;
    let lastMidX = 0; let lastMidY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        lastDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        lastMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastDist > 0) applyZoom(dist / lastDist, midX, midY);
        lastDist = dist; lastMidX = midX; lastMidY = midY;
      }
    };
    const onTouchEnd = () => { lastDist = 0; };
    svg.addEventListener('wheel',      onWheel,      { passive: false });
    svg.addEventListener('touchstart', onTouchStart, { passive: true });
    svg.addEventListener('touchmove',  onTouchMove,  { passive: false });
    svg.addEventListener('touchend',   onTouchEnd);
    return () => {
      svg.removeEventListener('wheel',      onWheel);
      svg.removeEventListener('touchstart', onTouchStart);
      svg.removeEventListener('touchmove',  onTouchMove);
      svg.removeEventListener('touchend',   onTouchEnd);
    };
  }, []);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { tx, ty, scale } = xfRef.current;
    const mx = rect.width / 2; const my = rect.height / 2;
    const ns = Math.max(0.1, Math.min(6, scale * factor));
    const r = ns / scale;
    setScale(ns); setTx(mx - (mx - tx) * r); setTy(my - (my - ty) * r);
  };

  // ── Global mouse (pan + drag) ─────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseMovedPx.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (mode.current === 'pan') {
        const { mx, my, tx: otx, ty: oty } = panOrigin.current;
        setTx(otx + e.clientX - mx); setTy(oty + e.clientY - my);
      } else if (mode.current === 'drag' && dragState.current) {
        const { key, origX, origY, startCx, startCy } = dragState.current;
        const { scale } = xfRef.current;
        const dx = (e.clientX - startCx) / scale;
        const dy = (e.clientY - startCy) / scale;
        setPositions(prev => ({ ...prev, [key]: { x: origX + dx, y: origY + dy } }));
      }
    };
    const onUp = () => {
      if (mode.current === 'drag' && dragState.current) {
        const { key } = dragState.current;
        const [type, idStr] = key.split('-');
        setPositions(prev => {
          const p = prev[key];
          if (p) api.relationships.upsertPosition({ entity_type: type as NodeKind, entity_id: Number(idStr), x: p.x, y: p.y });
          return prev;
        });
        dragState.current = null;
      }
      mode.current = 'idle';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Hover: highlight connections ──────────────────────────────────────────
  const connectedKeys    = hoveredKey ? new Set<string>([hoveredKey]) : null;
  const connectedEdgeIds = hoveredKey ? new Set<number>() : null;
  if (hoveredKey && connectedKeys && connectedEdgeIds) {
    edges.forEach(e => {
      const fk = nodeKey(e.from_type as NodeKind, e.from_id);
      const tk = nodeKey(e.to_type   as NodeKind, e.to_id);
      if (fk === hoveredKey || tk === hoveredKey) {
        connectedEdgeIds.add(e.id);
        connectedKeys.add(fk); connectedKeys.add(tk);
      }
    });
  }
  const nodeOpacity = (key: string) => hoveredKey && !connectedKeys!.has(key) ? 0.12 : 1;
  const edgeOpacity = (edge: RelationshipEdge) => {
    const baseDim = hoveredKey && !connectedEdgeIds!.has(edge.id) ? 0.08 : 1;
    return (edge.active ? 1 : 0.35) * baseDim;
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const dismissAll = () => { setEdgeMenu(null); setNodeCtx(null); };

  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseMovedPx.current = 0;
    dismissAll();
    mode.current = 'pan';
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx, ty };
  };

  const onSvgClick = () => {
    if (mouseMovedPx.current < 6) { setSelecting(null); dismissAll(); }
  };

  const onNodeMouseDown = (e: React.MouseEvent, type: NodeKind, id: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    mouseMovedPx.current = 0;
    if (!isDMMode) return;
    const key = nodeKey(type, id);
    const pos = getPos(type, id);
    mode.current = 'drag';
    dragState.current = { key, origX: pos.x, origY: pos.y, startCx: e.clientX, startCy: e.clientY };
  };

  const onNodeClick = (e: React.MouseEvent, type: NodeKind, id: number) => {
    e.stopPropagation();
    if (mouseMovedPx.current > 6) return; // was a drag
    dismissAll();
    if (!isDMMode) return;
    if (!selecting) {
      setSelecting({ type, id });
    } else {
      if (selecting.type === type && selecting.id === id) { setSelecting(null); return; }
      const rect = svgRef.current!.getBoundingClientRect();
      setPendingEdge({ from: selecting, to: { type, id }, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
      setLabelDraft(''); setSelecting(null);
    }
  };

  const onNodeContextMenu = (e: React.MouseEvent, type: NodeKind, id: number, name: string) => {
    if (!isDMMode) return;
    e.preventDefault(); e.stopPropagation();
    const rect = svgRef.current!.getBoundingClientRect();
    setNodeCtx({ type, id, name, x: e.clientX - rect.left, y: e.clientY - rect.top });
    setEdgeMenu(null);
  };

  const onEdgeClick = (e: React.MouseEvent, edge: RelationshipEdge) => {
    e.stopPropagation();
    if (!isDMMode) return;
    const rect = svgRef.current!.getBoundingClientRect();
    setEdgeMenu({ edgeId: edge.id, active: edge.active, x: e.clientX - rect.left, y: e.clientY - rect.top });
    setNodeCtx(null);
    setSelecting(null);
  };

  // ── Edge CRUD ─────────────────────────────────────────────────────────────
  const confirmEdge = async (label: string) => {
    if (!pendingEdge || !label.trim()) { setPendingEdge(null); return; }
    const edge = await api.relationships.createEdge({
      from_type: pendingEdge.from.type, from_id: pendingEdge.from.id,
      to_type:   pendingEdge.to.type,   to_id:   pendingEdge.to.id,
      label: label.trim(),
    });
    setEdges(prev => [...prev, edge]); setPendingEdge(null);
  };

  const toggleEdge = async () => {
    if (!edgeMenu) return;
    const { edgeId, active } = edgeMenu;
    const updated = await api.relationships.toggleEdge(edgeId, !active);
    setEdges(prev => prev.map(e => e.id === edgeId ? updated : e));
    setEdgeMenu(null);
  };

  const deleteEdge = async () => {
    if (!edgeMenu) return;
    await api.relationships.deleteEdge(edgeMenu.edgeId);
    setEdges(prev => prev.filter(e => e.id !== edgeMenu.edgeId));
    setEdgeMenu(null);
  };

  // ── Node delete ───────────────────────────────────────────────────────────
  const deleteNode = async () => {
    if (!nodeCtx) return;
    const { type, id } = nodeCtx;
    setNodeCtx(null);
    const toRemove = edges.filter(e =>
      (e.from_type === type && e.from_id === id) ||
      (e.to_type   === type && e.to_id   === id)
    );
    await Promise.all(toRemove.map(e => api.relationships.deleteEdge(e.id)));
    setEdges(prev => prev.filter(e =>
      !(e.from_type === type && e.from_id === id) &&
      !(e.to_type   === type && e.to_id   === id)
    ));
    if (type === 'npc')     onDeleteNPC?.(id);
    if (type === 'faction') onDeleteFaction?.(id);
    // party members are not deletable from the web
  };

  // ── Quick-add ─────────────────────────────────────────────────────────────
  const submitAdd = async () => {
    if (!addName.trim()) return;
    setAddBusy(true);
    try {
      if (addKind === 'npc' && onCreateNPC)
        await onCreateNPC({ name: addName.trim(), role: '', status: 'alive', notes: '', location_id: null, is_visible: true, linked_quest_ids: [] });
      else if (addKind === 'faction' && onCreateFaction)
        await onCreateFaction({ name: addName.trim(), description: '', reputation: 0, notes: '', color: randomFactionColor(), is_visible: true });
      setAddName(''); setShowAdd(false);
    } finally { setAddBusy(false); }
  };

  // ── Position helpers ──────────────────────────────────────────────────────
  const anyPos = (type: string, id: number) => getPos(type as NodeKind, id);
  const edgeEndpoints = (e: RelationshipEdge) => ({
    x1: anyPos(e.from_type, e.from_id).x, y1: anyPos(e.from_type, e.from_id).y,
    x2: anyPos(e.to_type,   e.to_id).x,   y2: anyPos(e.to_type,   e.to_id).y,
  });
  const toPad = (type: string) => type === 'npc' ? NPC_R + 6 : type === 'party' ? PARTY_R + 6 : FACT_H / 2 + 6;

  if (loading) return <div className="rel-web-loading">Loading…</div>;

  const selectedKey = selecting ? nodeKey(selecting.type, selecting.id) : null;
  const hasNodes = npcs.length > 0 || factions.length > 0 || party.length > 0;

  return (
    <div className="rel-web-wrap">

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="rel-toolbar">
        {isDMMode && (
          <button className="rel-tb-btn rel-tb-add" onClick={() => { setShowAdd(v => !v); setSelecting(null); }}>
            + Add Node
          </button>
        )}
        <div className="rel-tb-spacer" />
        <button className="rel-tb-btn" onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
        <button className="rel-tb-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">－</button>
        <button className="rel-tb-btn" onClick={fitView} title="Fit view">⊡</button>
      </div>

      {/* ── Quick-add panel ───────────────────────────────────────────────── */}
      {showAdd && isDMMode && (
        <div className="rel-add-panel">
          <div className="rel-add-toggle">
            <button className={`rel-add-kind ${addKind === 'npc' ? 'active' : ''}`} onClick={() => setAddKind('npc')}>NPC</button>
            <button className={`rel-add-kind ${addKind === 'faction' ? 'active' : ''}`} onClick={() => setAddKind('faction')}>Faction</button>
          </div>
          <div className="rel-add-row">
            <input className="rel-label-input" placeholder={addKind === 'npc' ? 'NPC name…' : 'Faction name…'}
              value={addName} autoFocus
              onChange={e => setAddName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') setShowAdd(false); }} />
            <button className="rel-label-ok" onClick={submitAdd} disabled={addBusy || !addName.trim()}>{addBusy ? '…' : '✓'}</button>
            <button className="rel-add-x" onClick={() => setShowAdd(false)}>✕</button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
            Creates a bare {addKind === 'npc' ? 'NPC' : 'faction'} — edit details in the {addKind === 'npc' ? 'NPCs' : 'Factions'} tab.
          </div>
        </div>
      )}

      {/* ── Hint ──────────────────────────────────────────────────────────── */}
      {isDMMode && !showAdd && (
        <div className="rel-web-hint">
          {selecting
            ? '🔗 Click second node to link · click background to cancel'
            : hasNodes
              ? 'Click node to link · click edge to manage · drag to move · hover to highlight · right-click node to delete'
              : 'Use "+ Add Node" to add NPCs or factions'}
        </div>
      )}

      {/* ── SVG canvas ────────────────────────────────────────────────────── */}
      <svg ref={svgRef} className="rel-web-svg"
        onMouseDown={onSvgMouseDown}
        onClick={onSvgClick}
        onKeyDown={e => { if (e.key === 'Escape') { setSelecting(null); setShowAdd(false); dismissAll(); } }}
        tabIndex={0}
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto">
              <path d="M0,0 L0,7 L10,3.5 z" fill={c} />
            </marker>
          ))}
          <marker id="arrow-default" markerWidth="10" markerHeight="10" refX="8" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L10,3.5 z" fill="#8a8098" />
          </marker>
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>

          {/* ── Edges ─────────────────────────────────────────────────── */}
          {edges.map(edge => {
            const { x1, y1, x2, y2 } = edgeEndpoints(edge);
            const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
            const color = edge.active ? edgeColor(edge.label) : '#555566';
            const lk = edge.label.toLowerCase();
            const markerId = edge.active && EDGE_COLORS[lk] ? `arrow-${lk}` : 'arrow-default';
            const dxx = x2 - x1; const dyy = y2 - y1;
            const len = Math.sqrt(dxx * dxx + dyy * dyy) || 1;
            const ux = dxx / len; const uy = dyy / len;
            const pad = toPad(edge.to_type);
            const opacity = edgeOpacity(edge);
            const isMenuOpen = edgeMenu?.edgeId === edge.id;
            return (
              <g key={edge.id} className="rel-edge" style={{ opacity }}
                onClick={e => onEdgeClick(e, edge)}
              >
                <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                  stroke={color} strokeWidth={isMenuOpen ? 3.5 : 2.5} strokeOpacity={0.9}
                  strokeDasharray={edge.active ? undefined : '8 5'}
                  markerEnd={`url(#${markerId})`} />
                {/* wide invisible hit target */}
                <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                  stroke="transparent" strokeWidth={18} style={{ cursor: isDMMode ? 'pointer' : 'default' }} />
                {edge.label && (
                  <text x={mx} y={my - 9} textAnchor="middle" className="rel-edge-label" fill={color}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Faction nodes ─────────────────────────────────────────── */}
          {factions.map(f => {
            const pos  = getPos('faction', f.id);
            const key  = nodeKey('faction', f.id);
            const isSel = key === selectedKey;
            return (
              <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseDown={e => onNodeMouseDown(e, 'faction', f.id)}
                onClick={e => onNodeClick(e, 'faction', f.id)}
                onContextMenu={e => onNodeContextMenu(e, 'faction', f.id, f.name)}
              >
                {isSel && <rect x={-FACT_W/2-6} y={-FACT_H/2-6} width={FACT_W+12} height={FACT_H+12} rx={10}
                  fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7}
                  fill={f.color || '#555577'} fillOpacity={0.9}
                  stroke={isSel ? '#e8c870' : '#ffffff44'} strokeWidth={isSel ? 2.5 : 1} />
                <text x={0} y={6} textAnchor="middle" className="rel-node-label rel-node-label--faction">
                  {f.name.length > 13 ? f.name.slice(0, 12) + '…' : f.name}
                </text>
                <text x={0} y={-FACT_H/2-8} textAnchor="middle" className="rel-node-sublabel">Faction</text>
                {/* transparent hit shield — prevents flicker from child element boundaries */}
                <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7}
                  fill="transparent"
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)} />
              </g>
            );
          })}

          {/* ── Party member nodes ────────────────────────────────────── */}
          {party.map(m => {
            const pos  = getPos('party', m.id);
            const key  = nodeKey('party', m.id);
            const isSel = key === selectedKey;
            const ringColor = m.path_color || '#c9a84c';
            return (
              <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseDown={e => onNodeMouseDown(e, 'party', m.id)}
                onClick={e => onNodeClick(e, 'party', m.id)}
              >
                {isSel && <circle r={PARTY_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                <circle r={PARTY_R} fill="#1a2236" stroke={ringColor} strokeWidth={isSel ? 3.5 : 2.5} />
                {m.portrait_url ? (
                  <>
                    <defs><clipPath id={`clip-party-${m.id}`}><circle r={PARTY_R-3} /></clipPath></defs>
                    <image href={API_BASE + m.portrait_url}
                      x={-(PARTY_R-3)} y={-(PARTY_R-3)} width={(PARTY_R-3)*2} height={(PARTY_R-3)*2}
                      clipPath={`url(#clip-party-${m.id})`} preserveAspectRatio="xMidYMid slice" />
                  </>
                ) : (
                  <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{m.name.charAt(0).toUpperCase()}</text>
                )}
                <text x={0} y={PARTY_R+17} textAnchor="middle" className="rel-node-label">
                  {m.name.length > 14 ? m.name.slice(0, 13) + '…' : m.name}
                </text>
                <text x={0} y={PARTY_R+30} textAnchor="middle" className="rel-node-sublabel">
                  {m.class_name || 'Party'}
                </text>
                {/* hit shield */}
                <circle r={PARTY_R} fill="transparent"
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)} />
              </g>
            );
          })}

          {/* ── NPC nodes ─────────────────────────────────────────────── */}
          {npcs.map(n => {
            const pos  = getPos('npc', n.id);
            const key  = nodeKey('npc', n.id);
            const isSel = key === selectedKey;
            const ringColor = n.status === 'dead' ? '#d46060' : n.status === 'unknown' ? '#8a8098' : '#72b86e';
            return (
              <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseDown={e => onNodeMouseDown(e, 'npc', n.id)}
                onClick={e => onNodeClick(e, 'npc', n.id)}
                onContextMenu={e => onNodeContextMenu(e, 'npc', n.id, n.name)}
              >
                {isSel && <circle r={NPC_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                <circle r={NPC_R} fill="#1c1b32" stroke={ringColor} strokeWidth={isSel ? 3.5 : 2.5} />
                {n.portrait_url ? (
                  <>
                    <defs><clipPath id={`clip-npc-${n.id}`}><circle r={NPC_R-3} /></clipPath></defs>
                    <image href={API_BASE + n.portrait_url}
                      x={-(NPC_R-3)} y={-(NPC_R-3)} width={(NPC_R-3)*2} height={(NPC_R-3)*2}
                      clipPath={`url(#clip-npc-${n.id})`} preserveAspectRatio="xMidYMid slice" />
                  </>
                ) : (
                  <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{n.name.charAt(0).toUpperCase()}</text>
                )}
                <text x={0} y={NPC_R+17} textAnchor="middle" className="rel-node-label">
                  {n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}
                </text>
                {n.role && <text x={0} y={NPC_R+30} textAnchor="middle" className="rel-node-sublabel">
                  {n.role.length > 18 ? n.role.slice(0, 17) + '…' : n.role}
                </text>}
                {/* hit shield */}
                <circle r={NPC_R} fill="transparent"
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)} />
              </g>
            );
          })}

        </g>
      </svg>

      {/* ── Edge action menu ─────────────────────────────────────────────────── */}
      {edgeMenu && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }}
          onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">Edge</div>
          <button className="rel-ctx-item" onClick={toggleEdge}>
            {edgeMenu.active ? '○ Disable connection' : '● Enable connection'}
          </button>
          <button className="rel-ctx-item rel-ctx-danger" onClick={deleteEdge}>
            🗑 Delete permanently
          </button>
        </div>
      )}

      {/* ── Node right-click menu ─────────────────────────────────────────── */}
      {nodeCtx && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: nodeCtx.x, top: nodeCtx.y }}
          onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">{nodeCtx.name}</div>
          {nodeCtx.type !== 'party' && (
            <button className="rel-ctx-item rel-ctx-danger" onClick={deleteNode}>
              🗑 Delete {nodeCtx.type === 'npc' ? 'NPC' : 'Faction'}
            </button>
          )}
          {nodeCtx.type === 'party' && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '6px 10px' }}>
              Edit party members in the Party tab.
            </div>
          )}
        </div>
      )}

      {/* ── Edge label picker ──────────────────────────────────────────────── */}
      {pendingEdge && (
        <div className="rel-label-picker" style={{ left: pendingEdge.screenX, top: pendingEdge.screenY }}>
          <div className="rel-label-picker-title">Relationship type</div>
          <div className="rel-label-presets">
            {PRESET_LABELS.map(l => (
              <button key={l} className="rel-label-preset"
                style={{ '--preset-color': edgeColor(l) } as React.CSSProperties}
                onClick={() => confirmEdge(l)}>{l}</button>
            ))}
          </div>
          <div className="rel-label-custom">
            <input className="rel-label-input" placeholder="or type custom…" value={labelDraft} autoFocus
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdge(labelDraft); if (e.key === 'Escape') setPendingEdge(null); }} />
            <button className="rel-label-ok" onClick={() => confirmEdge(labelDraft)}>✓</button>
          </div>
          <button className="rel-label-cancel" onClick={() => setPendingEdge(null)}>Cancel</button>
        </div>
      )}

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="rel-legend">
        {Object.entries(EDGE_COLORS).map(([label, color]) => (
          <span key={label} className="rel-legend-item">
            <span className="rel-legend-dot" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
