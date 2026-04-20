import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction, NPC, PartyMember, RelationshipEdge } from '../types';

const W = 1000;
const H = 700;
const NPC_R   = 30;
const PARTY_R = 28;
const FACT_W  = 110;
const FACT_H  = 40;

const PRESET_LABELS = ['ally', 'enemy', 'rival', 'family', 'serves', 'knows', 'neutral'];
const EDGE_COLORS: Record<string, string> = {
  ally: '#72b86e', enemy: '#d46060', rival: '#cc8844',
  family: '#9a70cc', serves: '#c9a84c', knows: '#6ab0cc', neutral: '#666688',
};
const edgeColor = (label: string) => EDGE_COLORS[label.toLowerCase()] ?? '#8a8098';

type NodeKind = 'npc' | 'faction' | 'party';
function nodeKey(type: NodeKind, id: number) { return `${type}-${id}`; }

const GOLDEN = 2.399963;
function defaultPos(type: NodeKind, id: number) {
  const angle = (id * GOLDEN) % (2 * Math.PI) - Math.PI / 2;
  const r = type === 'faction' ? 120 : type === 'party' ? 210 : 310;
  return { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
}

interface LabelPicker { edgeId?: number; currentLabel: string; x: number; y: number; from?: { type: NodeKind; id: number }; to?: { type: NodeKind; id: number }; }
interface NodeCtx     { type: NodeKind; id: number; name: string; x: number; y: number; }

interface Props {
  npcs:     NPC[];
  factions: Faction[];
  party:    PartyMember[];
  isDMMode: boolean;
}

export default function RelationshipWeb({ npcs, factions, party, isDMMode }: Props) {
  const svgRef  = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [edges,     setEdges]     = useState<RelationshipEdge[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading,   setLoading]   = useState(true);

  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const xfRef = useRef({ tx: 0, ty: 0, scale: 1 });
  xfRef.current = { tx, ty, scale };

  const mode      = useRef<'idle' | 'pan' | 'drag'>('idle');
  const panOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const dragState = useRef<{ key: string; origX: number; origY: number; startCx: number; startCy: number } | null>(null);
  const movedPx   = useRef(0);

  const [selecting,    setSelecting]    = useState<{ type: NodeKind; id: number } | null>(null);
  const [picker,       setPicker]       = useState<LabelPicker | null>(null);
  const [labelDraft,   setLabelDraft]   = useState('');
  const [hoveredKey,   setHoveredKey]   = useState<string | null>(null);
  const [selectedKey,  setSelectedKey]  = useState<string | null>(null); // for bottom panel detail
  const [nodeCtx,      setNodeCtx]      = useState<NodeCtx | null>(null);
  const [rosterSearch, setRosterSearch] = useState('');

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

  const isOnCanvas = (type: NodeKind, id: number) => nodeKey(type, id) in positions;
  const getPos = useCallback((type: NodeKind, id: number) =>
    positions[nodeKey(type, id)] ?? defaultPos(type, id), [positions]);

  const canvasNpcs     = npcs.filter(n => isOnCanvas('npc',     n.id));
  const canvasFactions = factions.filter(f => isOnCanvas('faction', f.id));
  const canvasParty    = party.filter(m => isOnCanvas('party',   m.id));
  const rosterNpcs     = npcs.filter(n => !isOnCanvas('npc',     n.id));
  const rosterFactions = factions.filter(f => !isOnCanvas('faction', f.id));
  const rosterParty    = party.filter(m => !isOnCanvas('party',   m.id));

  const q = rosterSearch.toLowerCase();
  const filtRosterNpcs     = rosterNpcs.filter(n => n.name.toLowerCase().includes(q) || (n.role||'').toLowerCase().includes(q));
  const filtRosterFactions = rosterFactions.filter(f => f.name.toLowerCase().includes(q));
  const filtRosterParty    = rosterParty.filter(m => m.name.toLowerCase().includes(q) || (m.class_name||'').toLowerCase().includes(q));

  // ── Add / remove from canvas ──────────────────────────────────────────────
  const addToCanvas = (type: NodeKind, id: number) => {
    const pos = defaultPos(type, id);
    api.relationships.upsertPosition({ entity_type: type, entity_id: id, x: pos.x, y: pos.y });
    setPositions(prev => ({ ...prev, [nodeKey(type, id)]: pos }));
  };
  const removeFromCanvas = async (type: NodeKind, id: number) => {
    await api.relationships.deletePosition(type, id);
    const key = nodeKey(type, id);
    setPositions(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (selectedKey === key) setSelectedKey(null);
  };

  // ── Fit / zoom ────────────────────────────────────────────────────────────
  const applyZoom = useCallback((factor: number, cx: number, cy: number) => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { tx, ty, scale } = xfRef.current;
    const mx = cx - rect.left; const my = cy - rect.top;
    const ns = Math.max(0.1, Math.min(6, scale * factor));
    const r = ns / scale;
    setScale(ns); setTx(mx - (mx - tx) * r); setTy(my - (my - ty) * r);
  }, []);

  const fitView = useCallback(() => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const s = Math.min(rect.width / W, rect.height / H) * 0.88;
    setScale(s);
    setTx(rect.width / 2 - (W / 2) * s);
    setTy(rect.height / 2 - (H / 2) * s);
  }, []);

  useEffect(() => { if (!loading) requestAnimationFrame(fitView); }, [loading, fitView]);

  // ── Wheel + pinch + single-finger pan (SVG always in DOM) ───────────────
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
    let lastDist = 0;
    let panTx = 0, panTy = 0, panActive = false;

    const onTS = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        panTx = e.touches[0].clientX;
        panTy = e.touches[0].clientY;
        panActive = true;
        lastDist = 0;
      } else if (e.touches.length === 2) {
        panActive = false;
        lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    };
    const onTM = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && panActive) {
        const dx = e.touches[0].clientX - panTx;
        const dy = e.touches[0].clientY - panTy;
        panTx = e.touches[0].clientX;
        panTy = e.touches[0].clientY;
        setTx(prev => prev + dx);
        setTy(prev => prev + dy);
      } else if (e.touches.length === 2) {
        panActive = false;
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastDist > 0) applyZoom(dist / lastDist, mx, my);
        lastDist = dist;
      }
    };
    const onTE = () => { lastDist = 0; panActive = false; };

    svg.addEventListener('wheel',      onWheel, { passive: false });
    svg.addEventListener('touchstart', onTS,    { passive: false });
    svg.addEventListener('touchmove',  onTM,    { passive: false });
    svg.addEventListener('touchend',   onTE);
    return () => {
      svg.removeEventListener('wheel',      onWheel);
      svg.removeEventListener('touchstart', onTS);
      svg.removeEventListener('touchmove',  onTM);
      svg.removeEventListener('touchend',   onTE);
    };
  }, [applyZoom]);

  const zoomBy = (f: number) => {
    const svg = svgRef.current; if (!svg) return;
    const r = svg.getBoundingClientRect();
    applyZoom(f, r.left + r.width / 2, r.top + r.height / 2);
  };

  // ── Global mouse ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      movedPx.current += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (mode.current === 'pan') {
        const { mx, my, tx: otx, ty: oty } = panOrigin.current;
        setTx(otx + e.clientX - mx); setTy(oty + e.clientY - my);
      } else if (mode.current === 'drag' && dragState.current) {
        const { key, origX, origY, startCx, startCy } = dragState.current;
        const dx = (e.clientX - startCx) / xfRef.current.scale;
        const dy = (e.clientY - startCy) / xfRef.current.scale;
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

  // ── Hover highlight ───────────────────────────────────────────────────────
  const hk = hoveredKey || selectedKey;
  const connectedKeys    = hk ? new Set<string>([hk]) : null;
  const connectedEdgeIds = hk ? new Set<number>() : null;
  if (hk && connectedKeys && connectedEdgeIds) {
    edges.forEach(e => {
      const fk = nodeKey(e.from_type as NodeKind, e.from_id);
      const tk = nodeKey(e.to_type as NodeKind, e.to_id);
      if (fk === hk || tk === hk) { connectedEdgeIds.add(e.id); connectedKeys.add(fk); connectedKeys.add(tk); }
    });
  }
  const nodeOp = (key: string) => hk && !connectedKeys!.has(key) ? 0.1 : 1;
  const edgeOp = (e: RelationshipEdge) => (e.active ? 1 : 0.35) * (hk && !connectedEdgeIds!.has(e.id) ? 0.06 : 1);

  // ── Bottom panel: connections for selected node ───────────────────────────
  const detailEntity = selectedKey ? (() => {
    const [t, idStr] = selectedKey.split('-');
    const id = Number(idStr);
    if (t === 'npc')     return { kind: 'npc'     as NodeKind, id, entity: npcs.find(n => n.id === id) };
    if (t === 'faction') return { kind: 'faction' as NodeKind, id, entity: factions.find(f => f.id === id) };
    if (t === 'party')   return { kind: 'party'   as NodeKind, id, entity: party.find(m => m.id === id) };
    return null;
  })() : null;

  const detailEdges = selectedKey ? edges.filter(e =>
    (nodeKey(e.from_type as NodeKind, e.from_id) === selectedKey) ||
    (nodeKey(e.to_type   as NodeKind, e.to_id)   === selectedKey)
  ) : [];

  const resolveEntity = (type: string, id: number) => {
    if (type === 'npc')     return npcs.find(n => n.id === id);
    if (type === 'faction') return factions.find(f => f.id === id);
    if (type === 'party')   return party.find(m => m.id === id);
    return undefined;
  };

  // ── Position helpers for overlays (relative to wrap, clamped) ───────────
  const getPickerPos = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 200, y: 150 };
    const r = wrap.getBoundingClientRect();
    // picker uses transform: translate(-50%,-50%), so center it on click and clamp half-dims
    return {
      x: Math.min(Math.max(115, clientX - r.left), r.width  - 115),
      y: Math.min(Math.max(130, clientY - r.top),  r.height - 130),
    };
  }, []);

  const getCtxPos = useCallback((clientX: number, clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    // ctx menu top-left at click point — clamp so it doesn't overflow
    return {
      x: Math.min(clientX - r.left, r.width  - 190),
      y: Math.min(clientY - r.top,  r.height - 90),
    };
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const dismissAll = () => { setPicker(null); setNodeCtx(null); };

  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    movedPx.current = 0; dismissAll();
    mode.current = 'pan';
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx, ty };
  };
  const onSvgClick = () => {
    if (movedPx.current < 6) {
      if (selecting) {
        setSelecting(null); // cancel link mode but keep bottom panel selection
      } else {
        setSelectedKey(null);
      }
      dismissAll();
    }
  };

  const onNodeMouseDown = (e: React.MouseEvent, type: NodeKind, id: number) => {
    if (e.button !== 0 || !isDMMode) return;
    e.stopPropagation(); movedPx.current = 0;
    const pos = getPos(type, id);
    mode.current = 'drag';
    dragState.current = { key: nodeKey(type, id), origX: pos.x, origY: pos.y, startCx: e.clientX, startCy: e.clientY };
  };

  const onNodeClick = (e: React.MouseEvent, type: NodeKind, id: number) => {
    e.stopPropagation();
    if (movedPx.current > 6) return;
    dismissAll();
    const key = nodeKey(type, id);
    // Always select for bottom panel detail
    setSelectedKey(prev => prev === key ? null : key);

    if (!isDMMode) return;
    if (!selecting) {
      setSelecting({ type, id });
    } else {
      if (selecting.type === type && selecting.id === id) { setSelecting(null); return; }
      const { x: px, y: py } = getPickerPos(e.clientX, e.clientY);
      setPicker({ currentLabel: '', x: px, y: py, from: selecting, to: { type, id } });
      setLabelDraft(''); setSelecting(null);
    }
  };

  const onNodeContextMenu = (e: React.MouseEvent, type: NodeKind, id: number, name: string) => {
    if (!isDMMode) return;
    e.preventDefault(); e.stopPropagation();
    const { x, y } = getCtxPos(e.clientX, e.clientY);
    setNodeCtx({ type, id, name, x, y });
    setPicker(null);
  };

  const onEdgeClick = (e: React.MouseEvent, edge: RelationshipEdge) => {
    e.stopPropagation();
    if (!isDMMode) return;
    const { x, y } = getPickerPos(e.clientX, e.clientY);
    setPicker({ edgeId: edge.id, currentLabel: edge.label, x, y });
    setNodeCtx(null); setSelecting(null);
  };

  // ── Edge CRUD ─────────────────────────────────────────────────────────────
  const confirmPicker = async (label: string) => {
    if (!picker) return;
    const trimmed = label.trim();

    if (picker.edgeId !== undefined) {
      // Editing existing edge
      if (trimmed === picker.currentLabel || !trimmed) {
        // Same label or empty = remove the edge
        await api.relationships.deleteEdge(picker.edgeId);
        setEdges(prev => prev.filter(e => e.id !== picker.edgeId));
      } else {
        const updated = await api.relationships.patchEdge(picker.edgeId, { label: trimmed });
        setEdges(prev => prev.map(e => e.id === picker.edgeId ? updated : e));
      }
    } else if (picker.from && picker.to && trimmed) {
      // Creating new edge
      const edge = await api.relationships.createEdge({
        from_type: picker.from.type, from_id: picker.from.id,
        to_type: picker.to.type, to_id: picker.to.id, label: trimmed,
      });
      setEdges(prev => [...prev, edge]);
    }
    setPicker(null);
  };

  const removeEdge = async () => {
    if (!picker?.edgeId) return;
    await api.relationships.deleteEdge(picker.edgeId);
    setEdges(prev => prev.filter(e => e.id !== picker.edgeId));
    setPicker(null);
  };

  // ── Position helpers ──────────────────────────────────────────────────────
  const anyPos = (type: string, id: number) => getPos(type as NodeKind, id);
  const toPad = (type: string) => type === 'npc' ? NPC_R + 6 : type === 'party' ? PARTY_R + 6 : FACT_H / 2 + 6;

  // Group visible edges by normalized pair key for multi-edge curved rendering
  const edgePairGroups = new Map<string, RelationshipEdge[]>();
  edges.forEach(edge => {
    if (!isOnCanvas(edge.from_type as NodeKind, edge.from_id) || !isOnCanvas(edge.to_type as NodeKind, edge.to_id)) return;
    const fk = nodeKey(edge.from_type as NodeKind, edge.from_id);
    const tk = nodeKey(edge.to_type as NodeKind, edge.to_id);
    const pairKey = fk < tk ? `${fk}|${tk}` : `${tk}|${fk}`;
    if (!edgePairGroups.has(pairKey)) edgePairGroups.set(pairKey, []);
    edgePairGroups.get(pairKey)!.push(edge);
  });

  const edgePairIndex = new Map<number, { groupSize: number; groupIdx: number }>();
  edgePairGroups.forEach(group => {
    group.forEach((edge, idx) => edgePairIndex.set(edge.id, { groupSize: group.length, groupIdx: idx }));
  });

  const selNodeKey = selecting ? nodeKey(selecting.type, selecting.id) : null;

  return (
    <div className="rel-web-wrap" ref={wrapRef}>

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="rel-toolbar">
        <div className="rel-tb-spacer" />
        <button className="rel-tb-btn" onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
        <button className="rel-tb-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">－</button>
        <button className="rel-tb-btn" onClick={fitView} title="Fit view">⊡</button>
      </div>

      {/* ── Hint ──────────────────────────────────────────────────────────── */}
      {isDMMode && (
        <div className="rel-web-hint">
          {selecting
            ? '🔗 Click second node to link · click background to cancel'
            : 'Click node to link or view · click edge to change label · drag to move · right-click to remove'}
        </div>
      )}

      {/* ── SVG ───────────────────────────────────────────────────────────── */}
      <svg ref={svgRef} className="rel-web-svg"
        onMouseDown={onSvgMouseDown} onClick={onSvgClick}
        onKeyDown={e => { if (e.key === 'Escape') { setSelecting(null); setSelectedKey(null); dismissAll(); } }}
        tabIndex={0}
      >
        {loading && <text x="50%" y="50%" textAnchor="middle" fill="#666" fontSize={13} dominantBaseline="middle">Loading…</text>}
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

        {!loading && (
          <g transform={`translate(${tx},${ty}) scale(${scale})`}>
            {/* Edges */}
            {edges.map(edge => {
              if (!isOnCanvas(edge.from_type as NodeKind, edge.from_id) || !isOnCanvas(edge.to_type as NodeKind, edge.to_id)) return null;
              const p1 = anyPos(edge.from_type, edge.from_id);
              const p2 = anyPos(edge.to_type,   edge.to_id);
              const x1 = p1.x; const y1 = p1.y;
              const x2 = p2.x; const y2 = p2.y;
              const color = edge.active ? edgeColor(edge.label) : '#555566';
              const lk = edge.label.toLowerCase();
              const markerId = edge.active && EDGE_COLORS[lk] ? `arrow-${lk}` : 'arrow-default';
              const dx = x2 - x1; const dy = y2 - y1;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len; const uy = dy / len;
              const pad = toPad(edge.to_type);
              // adjusted endpoint backed off from node center
              const ex = x2 - ux * pad; const ey = y2 - uy * pad;
              // curve offset for multi-edge pairs (perpendicular to line)
              const { groupSize = 1, groupIdx = 0 } = edgePairIndex.get(edge.id) ?? {};
              const offset = (groupIdx - (groupSize - 1) / 2) * 52;
              // perpendicular unit vector
              const nx = -uy; const ny = ux;
              const cpx = (x1 + ex) / 2 + nx * offset;
              const cpy = (y1 + ey) / 2 + ny * offset;
              // bezier midpoint at t=0.5 for label placement
              const lx = 0.25 * x1 + 0.5 * cpx + 0.25 * ex;
              const ly = 0.25 * y1 + 0.5 * cpy + 0.25 * ey;
              const pathD = `M ${x1} ${y1} Q ${cpx} ${cpy} ${ex} ${ey}`;
              const isEditing = picker?.edgeId === edge.id;
              return (
                <g key={edge.id} className="rel-edge" style={{ opacity: edgeOp(edge) }}
                  onClick={e => onEdgeClick(e, edge)}>
                  <path d={pathD} fill="none"
                    stroke={color} strokeWidth={isEditing ? 3.5 : 2.5} strokeOpacity={0.9}
                    strokeDasharray={edge.active ? undefined : '8 5'}
                    markerEnd={`url(#${markerId})`} />
                  <path d={pathD} fill="none"
                    stroke="transparent" strokeWidth={18} style={{ cursor: isDMMode ? 'pointer' : 'default' }} />
                  {edge.label && (
                    <text x={lx} y={ly - 9} textAnchor="middle" className="rel-edge-label" fill={color}>{edge.label}</text>
                  )}
                </g>
              );
            })}

            {/* Faction nodes */}
            {canvasFactions.map(f => {
              const pos = getPos('faction', f.id);
              const key = nodeKey('faction', f.id);
              const isSel = key === selNodeKey;
              const isDetail = key === selectedKey;
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOp(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'faction', f.id)}
                  onClick={e => onNodeClick(e, 'faction', f.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'faction', f.id, f.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {(isSel || isDetail) && <rect x={-FACT_W/2-6} y={-FACT_H/2-6} width={FACT_W+12} height={FACT_H+12} rx={10}
                    fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7}
                    fill={f.color || '#555577'} fillOpacity={0.9}
                    stroke={(isSel || isDetail) ? '#e8c870' : '#ffffff44'} strokeWidth={(isSel || isDetail) ? 2.5 : 1} />
                  <text x={0} y={6} textAnchor="middle" className="rel-node-label rel-node-label--faction">
                    {f.name.length > 13 ? f.name.slice(0, 12) + '…' : f.name}
                  </text>
                  <text x={0} y={-FACT_H/2-8} textAnchor="middle" className="rel-node-sublabel">Faction</text>
                  <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7} fill="transparent" />
                </g>
              );
            })}

            {/* Party nodes */}
            {canvasParty.map(m => {
              const pos = getPos('party', m.id);
              const key = nodeKey('party', m.id);
              const isSel = key === selNodeKey;
              const isDetail = key === selectedKey;
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOp(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'party', m.id)}
                  onClick={e => onNodeClick(e, 'party', m.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'party', m.id, m.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {(isSel || isDetail) && <circle r={PARTY_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <circle r={PARTY_R} fill="#1a2236" stroke={m.path_color || '#c9a84c'} strokeWidth={(isSel || isDetail) ? 3.5 : 2.5} />
                  {m.portrait_url
                    ? <><defs><clipPath id={`clip-party-${m.id}`}><circle r={PARTY_R-3} /></clipPath></defs>
                        <image href={API_BASE + m.portrait_url} x={-(PARTY_R-3)} y={-(PARTY_R-3)} width={(PARTY_R-3)*2} height={(PARTY_R-3)*2} clipPath={`url(#clip-party-${m.id})`} preserveAspectRatio="xMidYMid slice" /></>
                    : <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{m.name[0].toUpperCase()}</text>}
                  <text x={0} y={PARTY_R+17} textAnchor="middle" className="rel-node-label">{m.name.length > 14 ? m.name.slice(0, 13) + '…' : m.name}</text>
                  <text x={0} y={PARTY_R+30} textAnchor="middle" className="rel-node-sublabel">{m.class_name || 'Party'}</text>
                  <circle r={PARTY_R} fill="transparent" />
                </g>
              );
            })}

            {/* NPC nodes */}
            {canvasNpcs.map(n => {
              const pos = getPos('npc', n.id);
              const key = nodeKey('npc', n.id);
              const isSel = key === selNodeKey;
              const isDetail = key === selectedKey;
              const ringColor = n.status === 'dead' ? '#d46060' : n.status === 'unknown' ? '#8a8098' : '#72b86e';
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOp(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'npc', n.id)}
                  onClick={e => onNodeClick(e, 'npc', n.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'npc', n.id, n.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {(isSel || isDetail) && <circle r={NPC_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <circle r={NPC_R} fill="#1c1b32" stroke={ringColor} strokeWidth={(isSel || isDetail) ? 3.5 : 2.5} />
                  {n.portrait_url
                    ? <><defs><clipPath id={`clip-npc-${n.id}`}><circle r={NPC_R-3} /></clipPath></defs>
                        <image href={API_BASE + n.portrait_url} x={-(NPC_R-3)} y={-(NPC_R-3)} width={(NPC_R-3)*2} height={(NPC_R-3)*2} clipPath={`url(#clip-npc-${n.id})`} preserveAspectRatio="xMidYMid slice" /></>
                    : <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{n.name[0].toUpperCase()}</text>}
                  <text x={0} y={NPC_R+17} textAnchor="middle" className="rel-node-label">{n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}</text>
                  {n.role && <text x={0} y={NPC_R+30} textAnchor="middle" className="rel-node-sublabel">{n.role.length > 18 ? n.role.slice(0, 17) + '…' : n.role}</text>}
                  <circle r={NPC_R} fill="transparent" />
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* ── Label picker (new edge or edit) ───────────────────────────────── */}
      {picker && isDMMode && (
        <div className="rel-label-picker" style={{ left: picker.x, top: picker.y }}>
          <div className="rel-label-picker-title">
            {picker.edgeId !== undefined
              ? picker.currentLabel ? `Editing: "${picker.currentLabel}"` : 'Set label'
              : 'Relationship type'}
          </div>
          <div className="rel-label-presets">
            {PRESET_LABELS.map(l => (
              <button key={l}
                className={`rel-label-preset ${l === picker.currentLabel ? 'rel-label-preset--current' : ''}`}
                style={{ '--preset-color': edgeColor(l) } as React.CSSProperties}
                onClick={() => confirmPicker(l)}>
                {l}{l === picker.currentLabel ? ' ✕' : ''}
              </button>
            ))}
          </div>
          <div className="rel-label-custom">
            <input className="rel-label-input" placeholder="custom label…" autoFocus
              defaultValue={picker.currentLabel}
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmPicker(labelDraft); if (e.key === 'Escape') setPicker(null); }} />
            <button className="rel-label-ok" onClick={() => confirmPicker(labelDraft)}>✓</button>
          </div>
          {picker.edgeId !== undefined && (
            <button className="rel-label-remove" onClick={removeEdge}>✕ Remove this connection</button>
          )}
          <button className="rel-label-cancel" onClick={() => setPicker(null)}>Cancel</button>
        </div>
      )}

      {/* ── Node context menu (right-click) ───────────────────────────────── */}
      {nodeCtx && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: nodeCtx.x, top: nodeCtx.y }} onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">{nodeCtx.name}</div>
          <button className="rel-ctx-item" onClick={() => { removeFromCanvas(nodeCtx.type, nodeCtx.id); setNodeCtx(null); }}>
            ← Remove from canvas
          </button>
        </div>
      )}

      {/* ── Bottom panel: detail or roster ───────────────────────────────── */}
      <div className="rel-bottom-panel">
        {detailEntity ? (
          // ── Selected node detail view ──────────────────────────────────
          <div className="rel-detail-wrap">
            <div className="rel-detail-header">
              {detailEntity.entity && 'portrait_url' in detailEntity.entity && (detailEntity.entity as NPC | PartyMember).portrait_url
                ? <img src={API_BASE + (detailEntity.entity as NPC | PartyMember).portrait_url!} className="rel-detail-portrait" alt="" />
                : 'color' in (detailEntity.entity || {})
                  ? <span className="rel-detail-portrait" style={{ background: (detailEntity.entity as Faction).color || '#555' }} />
                  : <span className="rel-detail-portrait rel-detail-portrait--initial">
                      {detailEntity.entity?.name?.[0]?.toUpperCase()}
                    </span>}
              <div className="rel-detail-info">
                <div className="rel-detail-name">{detailEntity.entity?.name}</div>
                <div className="rel-detail-sub">
                  {'role' in (detailEntity.entity || {}) ? (detailEntity.entity as NPC).role : ''}
                  {'class_name' in (detailEntity.entity || {}) ? (detailEntity.entity as PartyMember).class_name : ''}
                  {'description' in (detailEntity.entity || {}) && detailEntity.kind === 'faction' ? (detailEntity.entity as Faction).description?.slice(0, 80) : ''}
                </div>
              </div>
              <button className="rel-detail-close" onClick={() => setSelectedKey(null)}>✕</button>
            </div>
            <div className="rel-detail-connections">
              {detailEdges.length === 0
                ? <span className="rel-detail-none">No connections yet — click another node while this one is selected to link them.</span>
                : detailEdges.map(edge => {
                  const isFrom = nodeKey(edge.from_type as NodeKind, edge.from_id) === selectedKey;
                  const otherType = isFrom ? edge.to_type : edge.from_type;
                  const otherId   = isFrom ? edge.to_id   : edge.from_id;
                  const other = resolveEntity(otherType, otherId);
                  const color = edge.active ? edgeColor(edge.label) : '#555566';
                  return (
                    <div key={edge.id} className="rel-detail-edge" style={{ opacity: edge.active ? 1 : 0.45 }}>
                      <span className="rel-detail-edge-dot" style={{ background: color }} />
                      <span className="rel-detail-edge-label" style={{ color }}>{edge.label || '—'}</span>
                      <span className="rel-detail-edge-arrow">{isFrom ? '→' : '←'}</span>
                      <span className="rel-detail-edge-name">{other?.name ?? '(unknown)'}</span>
                      {isDMMode && (
                        <button className="rel-detail-edge-edit" onClick={() => {
                          const wrap = wrapRef.current;
                          const svg  = svgRef.current;
                          if (!wrap || !svg) return;
                          const wr = wrap.getBoundingClientRect();
                          const sr = svg.getBoundingClientRect();
                          const x = sr.left - wr.left + sr.width  / 2;
                          const y = sr.top  - wr.top  + sr.height / 2;
                          setPicker({ edgeId: edge.id, currentLabel: edge.label, x, y });
                        }}>✏</button>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ) : (
          // ── Roster view ────────────────────────────────────────────────
          <div className="rel-roster-wrap">
            <div className="rel-roster-top">
              <span className="rel-roster-title">Roster — click to add to canvas</span>
              <input className="rel-label-input rel-roster-search-sm" placeholder="Search…"
                value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} />
            </div>
            {(filtRosterParty.length + filtRosterNpcs.length + filtRosterFactions.length) === 0
              ? <div className="rel-roster-all-on">All entities are on the canvas</div>
              : (
                <div className="rel-roster-list">
                  {filtRosterParty.length > 0 && (
                    <>
                      <div className="rel-roster-section-hdr">Party</div>
                      {filtRosterParty.map(m => (
                        <button key={`party-${m.id}`} className="rel-roster-row" onClick={() => addToCanvas('party', m.id)}>
                          {m.portrait_url
                            ? <img src={API_BASE + m.portrait_url} className="rel-roster-row-avatar" alt="" />
                            : <span className="rel-roster-row-initial" style={{ background: m.path_color || '#c9a84c' }}>{m.name[0]}</span>}
                          <span className="rel-roster-row-name">{m.name}</span>
                          <span className="rel-roster-row-sub">{m.class_name}</span>
                          <span className="rel-roster-row-add">＋</span>
                        </button>
                      ))}
                    </>
                  )}
                  {filtRosterNpcs.length > 0 && (
                    <>
                      <div className="rel-roster-section-hdr">NPCs</div>
                      {filtRosterNpcs.map(n => (
                        <button key={`npc-${n.id}`} className="rel-roster-row" onClick={() => addToCanvas('npc', n.id)}>
                          {n.portrait_url
                            ? <img src={API_BASE + n.portrait_url} className="rel-roster-row-avatar" alt="" />
                            : <span className="rel-roster-row-initial">{n.name[0]}</span>}
                          <span className="rel-roster-row-name">{n.name}</span>
                          <span className="rel-roster-row-sub">{n.role}</span>
                          <span className="rel-roster-row-add">＋</span>
                        </button>
                      ))}
                    </>
                  )}
                  {filtRosterFactions.length > 0 && (
                    <>
                      <div className="rel-roster-section-hdr">Factions</div>
                      {filtRosterFactions.map(f => (
                        <button key={`faction-${f.id}`} className="rel-roster-row" onClick={() => addToCanvas('faction', f.id)}>
                          <span className="rel-roster-row-initial" style={{ background: f.color || '#555', borderRadius: 4 }}>{f.name[0]}</span>
                          <span className="rel-roster-row-name">{f.name}</span>
                          <span className="rel-roster-row-sub">Faction</span>
                          <span className="rel-roster-row-add">＋</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
