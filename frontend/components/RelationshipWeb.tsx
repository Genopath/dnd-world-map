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

interface EdgeMenu  { edge: RelationshipEdge; x: number; y: number; }
interface NodeCtx   { type: NodeKind; id: number; name: string; x: number; y: number; }
interface EditLabel { edgeId: number; currentLabel: string; x: number; y: number; }

interface Props {
  npcs:      NPC[];
  factions:  Faction[];
  party:     PartyMember[];
  isDMMode:  boolean;
}

export default function RelationshipWeb({ npcs, factions, party, isDMMode }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [edges,     setEdges]     = useState<RelationshipEdge[]>([]);
  // positions = source of truth for what's on canvas; entities NOT in positions go to roster
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading,   setLoading]   = useState(true);

  // Transform
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const xfRef = useRef({ tx: 0, ty: 0, scale: 1 });
  xfRef.current = { tx, ty, scale };

  // Interaction
  const mode      = useRef<'idle' | 'pan' | 'drag'>('idle');
  const panOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const dragState = useRef<{ key: string; origX: number; origY: number; startCx: number; startCy: number } | null>(null);
  const movedPx   = useRef(0);

  // UI state
  const [selecting,   setSelecting]   = useState<{ type: NodeKind; id: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ from: { type: NodeKind; id: number }; to: { type: NodeKind; id: number }; screenX: number; screenY: number } | null>(null);
  const [labelDraft,  setLabelDraft]  = useState('');
  const [hoveredKey,  setHoveredKey]  = useState<string | null>(null);
  const [edgeMenu,    setEdgeMenu]    = useState<EdgeMenu | null>(null);
  const [editLabel,   setEditLabel]   = useState<EditLabel | null>(null);
  const [nodeCtx,     setNodeCtx]     = useState<NodeCtx | null>(null);
  const [showRoster,  setShowRoster]  = useState(false);
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

  // entities on canvas = those with a saved position
  const isOnCanvas = (type: NodeKind, id: number) => nodeKey(type, id) in positions;
  const getPos     = useCallback((type: NodeKind, id: number) =>
    positions[nodeKey(type, id)] ?? defaultPos(type, id), [positions]);

  const canvasNpcs     = npcs.filter(n => isOnCanvas('npc',     n.id));
  const canvasFactions = factions.filter(f => isOnCanvas('faction', f.id));
  const canvasParty    = party.filter(m => isOnCanvas('party',   m.id));

  const rosterNpcs     = npcs.filter(n => !isOnCanvas('npc',     n.id));
  const rosterFactions = factions.filter(f => !isOnCanvas('faction', f.id));
  const rosterParty    = party.filter(m => !isOnCanvas('party',   m.id));

  const q = rosterSearch.toLowerCase();
  const filteredRosterNpcs     = rosterNpcs.filter(n => n.name.toLowerCase().includes(q));
  const filteredRosterFactions = rosterFactions.filter(f => f.name.toLowerCase().includes(q));
  const filteredRosterParty    = rosterParty.filter(m => m.name.toLowerCase().includes(q));
  const rosterEmpty = filteredRosterNpcs.length + filteredRosterFactions.length + filteredRosterParty.length === 0;

  // ── Add entity to canvas ──────────────────────────────────────────────────
  const addToCanvas = (type: NodeKind, id: number) => {
    const pos = defaultPos(type, id);
    api.relationships.upsertPosition({ entity_type: type, entity_id: id, x: pos.x, y: pos.y });
    setPositions(prev => ({ ...prev, [nodeKey(type, id)]: pos }));
  };

  // ── Remove entity from canvas (back to roster) ────────────────────────────
  const removeFromCanvas = async (type: NodeKind, id: number) => {
    await api.relationships.deletePosition(type, id);
    const key = nodeKey(type, id);
    setPositions(prev => { const n = { ...prev }; delete n[key]; return n; });
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
    setTx(rect.width  / 2 - (W / 2) * s);
    setTy(rect.height / 2 - (H / 2) * s);
  }, []);

  useEffect(() => { if (!loading) requestAnimationFrame(fitView); }, [loading, fitView]);

  // ── Wheel + pinch (SVG always in DOM — no conditional render) ─────────────
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    };
    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2)
        lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      if (lastDist > 0) applyZoom(dist / lastDist, midX, midY);
      lastDist = dist;
    };
    svg.addEventListener('wheel',      onWheel,      { passive: false });
    svg.addEventListener('touchstart', onTouchStart, { passive: true });
    svg.addEventListener('touchmove',  onTouchMove,  { passive: false });
    svg.addEventListener('touchend',   () => { lastDist = 0; });
    return () => {
      svg.removeEventListener('wheel',      onWheel);
      svg.removeEventListener('touchstart', onTouchStart);
      svg.removeEventListener('touchmove',  onTouchMove);
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
  const connectedKeys    = hoveredKey ? new Set<string>([hoveredKey]) : null;
  const connectedEdgeIds = hoveredKey ? new Set<number>() : null;
  if (hoveredKey && connectedKeys && connectedEdgeIds) {
    edges.forEach(e => {
      const fk = nodeKey(e.from_type as NodeKind, e.from_id);
      const tk = nodeKey(e.to_type   as NodeKind, e.to_id);
      if (fk === hoveredKey || tk === hoveredKey) {
        connectedEdgeIds.add(e.id); connectedKeys.add(fk); connectedKeys.add(tk);
      }
    });
  }
  const nodeOpacity = (key: string) => hoveredKey && !connectedKeys!.has(key) ? 0.1 : 1;
  const edgeOpacity = (e: RelationshipEdge) =>
    (e.active ? 1 : 0.35) * (hoveredKey && !connectedEdgeIds!.has(e.id) ? 0.06 : 1);

  // ── Event handlers ────────────────────────────────────────────────────────
  const dismissAll = () => { setEdgeMenu(null); setNodeCtx(null); setEditLabel(null); };

  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    movedPx.current = 0; dismissAll();
    mode.current = 'pan';
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx, ty };
  };
  const onSvgClick = () => { if (movedPx.current < 6) { setSelecting(null); dismissAll(); } };

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
    setEdgeMenu(null); setEditLabel(null);
  };

  const onEdgeClick = (e: React.MouseEvent, edge: RelationshipEdge) => {
    e.stopPropagation();
    if (!isDMMode) return;
    const rect = svgRef.current!.getBoundingClientRect();
    setEdgeMenu({ edge, x: e.clientX - rect.left, y: e.clientY - rect.top });
    setNodeCtx(null); setEditLabel(null); setSelecting(null);
  };

  // ── Edge CRUD ─────────────────────────────────────────────────────────────
  const confirmEdge = async (label: string) => {
    if (!pendingEdge || !label.trim()) { setPendingEdge(null); return; }
    const edge = await api.relationships.createEdge({
      from_type: pendingEdge.from.type, from_id: pendingEdge.from.id,
      to_type:   pendingEdge.to.type,   to_id:   pendingEdge.to.id, label: label.trim(),
    });
    setEdges(prev => [...prev, edge]); setPendingEdge(null);
  };

  // Clicking same preset as current label = delete the edge (toggle off)
  const confirmLabelEdit = async (label: string) => {
    if (!editLabel) return;
    if (label.trim() === editLabel.currentLabel) {
      // toggle off — delete the edge
      await api.relationships.deleteEdge(editLabel.edgeId);
      setEdges(prev => prev.filter(e => e.id !== editLabel.edgeId));
    } else {
      const updated = await api.relationships.patchEdge(editLabel.edgeId, { label: label.trim() });
      setEdges(prev => prev.map(e => e.id === editLabel.edgeId ? updated : e));
    }
    setEditLabel(null);
  };

  const toggleEdge = async () => {
    if (!edgeMenu) return;
    const updated = await api.relationships.patchEdge(edgeMenu.edge.id, { active: !edgeMenu.edge.active });
    setEdges(prev => prev.map(e => e.id === edgeMenu.edge.id ? updated : e));
    setEdgeMenu(null);
  };

  const deleteEdge = async () => {
    if (!edgeMenu) return;
    await api.relationships.deleteEdge(edgeMenu.edge.id);
    setEdges(prev => prev.filter(e => e.id !== edgeMenu.edge.id));
    setEdgeMenu(null);
  };

  // ── Position helpers ──────────────────────────────────────────────────────
  const anyPos = (type: string, id: number) => getPos(type as NodeKind, id);
  const edgeEndpoints = (e: RelationshipEdge) => ({
    x1: anyPos(e.from_type, e.from_id).x, y1: anyPos(e.from_type, e.from_id).y,
    x2: anyPos(e.to_type,   e.to_id).x,   y2: anyPos(e.to_type,   e.to_id).y,
  });
  const toPad = (type: string) => type === 'npc' ? NPC_R + 6 : type === 'party' ? PARTY_R + 6 : FACT_H / 2 + 6;

  const selectedKey = selecting ? nodeKey(selecting.type, selecting.id) : null;

  // Active label picker — new edge or edit existing
  const activePicker = pendingEdge
    ? { x: pendingEdge.screenX, y: pendingEdge.screenY, currentLabel: '', onConfirm: confirmEdge, onCancel: () => setPendingEdge(null) }
    : editLabel
    ? { x: editLabel.x, y: editLabel.y, currentLabel: editLabel.currentLabel, onConfirm: confirmLabelEdit, onCancel: () => setEditLabel(null) }
    : null;

  // ── Render helpers ────────────────────────────────────────────────────────
  const Shield = ({ r }: { r: number }) => (
    <circle r={r} fill="transparent"
      onMouseEnter={() => setHoveredKey(null)} onMouseLeave={() => setHoveredKey(null)} />
  );

  return (
    <div className="rel-web-wrap">

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div className="rel-toolbar">
        {isDMMode && (
          <button className={`rel-tb-btn ${showRoster ? 'rel-tb-active' : 'rel-tb-add'}`}
            onClick={() => { setShowRoster(v => !v); dismissAll(); setSelecting(null); }}>
            {showRoster ? '✕ Close Roster' : '＋ Roster'}
          </button>
        )}
        <div className="rel-tb-spacer" />
        <button className="rel-tb-btn" onClick={() => zoomBy(1.25)} title="Zoom in">＋</button>
        <button className="rel-tb-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">－</button>
        <button className="rel-tb-btn" onClick={fitView} title="Fit view">⊡</button>
      </div>

      {/* ── Roster panel ─────────────────────────────────────────────────── */}
      {showRoster && isDMMode && (
        <div className="rel-roster">
          <input className="rel-label-input rel-roster-search" placeholder="Search…"
            value={rosterSearch} onChange={e => setRosterSearch(e.target.value)} />
          {rosterEmpty && <div className="rel-roster-empty">All entities are on the canvas</div>}

          {filteredRosterParty.length > 0 && (
            <div className="rel-roster-section">
              <div className="rel-roster-heading">Party Members</div>
              {filteredRosterParty.map(m => (
                <button key={m.id} className="rel-roster-item" onClick={() => addToCanvas('party', m.id)}>
                  {m.portrait_url
                    ? <img src={API_BASE + m.portrait_url} className="rel-roster-avatar" alt="" />
                    : <span className="rel-roster-initial" style={{ background: m.path_color || '#c9a84c' }}>{m.name[0]}</span>}
                  <span className="rel-roster-name">{m.name}</span>
                  <span className="rel-roster-sub">{m.class_name}</span>
                </button>
              ))}
            </div>
          )}

          {filteredRosterNpcs.length > 0 && (
            <div className="rel-roster-section">
              <div className="rel-roster-heading">NPCs</div>
              {filteredRosterNpcs.map(n => (
                <button key={n.id} className="rel-roster-item" onClick={() => addToCanvas('npc', n.id)}>
                  {n.portrait_url
                    ? <img src={API_BASE + n.portrait_url} className="rel-roster-avatar" alt="" />
                    : <span className="rel-roster-initial">{n.name[0]}</span>}
                  <span className="rel-roster-name">{n.name}</span>
                  <span className="rel-roster-sub">{n.role}</span>
                </button>
              ))}
            </div>
          )}

          {filteredRosterFactions.length > 0 && (
            <div className="rel-roster-section">
              <div className="rel-roster-heading">Factions</div>
              {filteredRosterFactions.map(f => (
                <button key={f.id} className="rel-roster-item" onClick={() => addToCanvas('faction', f.id)}>
                  <span className="rel-roster-color-chip" style={{ background: f.color || '#666' }} />
                  <span className="rel-roster-name">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Hint ──────────────────────────────────────────────────────────── */}
      {isDMMode && !showRoster && (
        <div className="rel-web-hint">
          {selecting
            ? '🔗 Click second node to link · click background to cancel'
            : canvasNpcs.length + canvasFactions.length + canvasParty.length === 0
              ? 'Open "＋ Roster" to add entities to the canvas'
              : 'Click node to link · click edge to manage · drag to move · hover to highlight · right-click to remove'}
        </div>
      )}

      {/* ── SVG — always in DOM so wheel listener attaches correctly ─────── */}
      <svg ref={svgRef} className="rel-web-svg"
        onMouseDown={onSvgMouseDown} onClick={onSvgClick}
        onKeyDown={e => { if (e.key === 'Escape') { setSelecting(null); dismissAll(); } }}
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
              // only render edges where both ends are on canvas
              if (!isOnCanvas(edge.from_type as NodeKind, edge.from_id) || !isOnCanvas(edge.to_type as NodeKind, edge.to_id)) return null;
              const { x1, y1, x2, y2 } = edgeEndpoints(edge);
              const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
              const color = edge.active ? edgeColor(edge.label) : '#555566';
              const lk = edge.label.toLowerCase();
              const markerId = edge.active && EDGE_COLORS[lk] ? `arrow-${lk}` : 'arrow-default';
              const dxx = x2 - x1; const dyy = y2 - y1;
              const len = Math.sqrt(dxx * dxx + dyy * dyy) || 1;
              const ux = dxx / len; const uy = dyy / len;
              const pad = toPad(edge.to_type);
              const isOpen = edgeMenu?.edge.id === edge.id;
              return (
                <g key={edge.id} className="rel-edge" style={{ opacity: edgeOpacity(edge) }}
                  onClick={e => onEdgeClick(e, edge)}>
                  <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                    stroke={color} strokeWidth={isOpen ? 3.5 : 2.5} strokeOpacity={0.9}
                    strokeDasharray={edge.active ? undefined : '8 5'}
                    markerEnd={`url(#${markerId})`} />
                  <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                    stroke="transparent" strokeWidth={18}
                    style={{ cursor: isDMMode ? 'pointer' : 'default' }} />
                  {edge.label && (
                    <text x={mx} y={my - 9} textAnchor="middle" className="rel-edge-label" fill={color}>
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Faction nodes */}
            {canvasFactions.map(f => {
              const pos = getPos('faction', f.id);
              const key = nodeKey('faction', f.id);
              const isSel = key === selectedKey;
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'faction', f.id)}
                  onClick={e => onNodeClick(e, 'faction', f.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'faction', f.id, f.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {isSel && <rect x={-FACT_W/2-6} y={-FACT_H/2-6} width={FACT_W+12} height={FACT_H+12} rx={10}
                    fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7}
                    fill={f.color || '#555577'} fillOpacity={0.9}
                    stroke={isSel ? '#e8c870' : '#ffffff44'} strokeWidth={isSel ? 2.5 : 1} />
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
              const isSel = key === selectedKey;
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'party', m.id)}
                  onClick={e => onNodeClick(e, 'party', m.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'party', m.id, m.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {isSel && <circle r={PARTY_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <circle r={PARTY_R} fill="#1a2236" stroke={m.path_color || '#c9a84c'} strokeWidth={isSel ? 3.5 : 2.5} />
                  {m.portrait_url ? (
                    <><defs><clipPath id={`clip-party-${m.id}`}><circle r={PARTY_R-3} /></clipPath></defs>
                      <image href={API_BASE + m.portrait_url} x={-(PARTY_R-3)} y={-(PARTY_R-3)}
                        width={(PARTY_R-3)*2} height={(PARTY_R-3)*2}
                        clipPath={`url(#clip-party-${m.id})`} preserveAspectRatio="xMidYMid slice" /></>
                  ) : <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{m.name[0].toUpperCase()}</text>}
                  <text x={0} y={PARTY_R+17} textAnchor="middle" className="rel-node-label">{m.name.length > 14 ? m.name.slice(0, 13) + '…' : m.name}</text>
                  <text x={0} y={PARTY_R+30} textAnchor="middle" className="rel-node-sublabel">{m.class_name || 'Party'}</text>
                  <Shield r={PARTY_R} />
                </g>
              );
            })}

            {/* NPC nodes */}
            {canvasNpcs.map(n => {
              const pos = getPos('npc', n.id);
              const key = nodeKey('npc', n.id);
              const isSel = key === selectedKey;
              const ringColor = n.status === 'dead' ? '#d46060' : n.status === 'unknown' ? '#8a8098' : '#72b86e';
              return (
                <g key={key} className="rel-node" style={{ opacity: nodeOpacity(key), transition: 'opacity 0.15s' }}
                  transform={`translate(${pos.x},${pos.y})`}
                  onMouseDown={e => onNodeMouseDown(e, 'npc', n.id)}
                  onClick={e => onNodeClick(e, 'npc', n.id)}
                  onContextMenu={e => onNodeContextMenu(e, 'npc', n.id, n.name)}
                  onMouseEnter={() => setHoveredKey(key)} onMouseLeave={() => setHoveredKey(null)}>
                  {isSel && <circle r={NPC_R+9} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                  <circle r={NPC_R} fill="#1c1b32" stroke={ringColor} strokeWidth={isSel ? 3.5 : 2.5} />
                  {n.portrait_url ? (
                    <><defs><clipPath id={`clip-npc-${n.id}`}><circle r={NPC_R-3} /></clipPath></defs>
                      <image href={API_BASE + n.portrait_url} x={-(NPC_R-3)} y={-(NPC_R-3)}
                        width={(NPC_R-3)*2} height={(NPC_R-3)*2}
                        clipPath={`url(#clip-npc-${n.id})`} preserveAspectRatio="xMidYMid slice" /></>
                  ) : <text x={0} y={7} textAnchor="middle" className="rel-node-initial">{n.name[0].toUpperCase()}</text>}
                  <text x={0} y={NPC_R+17} textAnchor="middle" className="rel-node-label">{n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}</text>
                  {n.role && <text x={0} y={NPC_R+30} textAnchor="middle" className="rel-node-sublabel">{n.role.length > 18 ? n.role.slice(0, 17) + '…' : n.role}</text>}
                  <Shield r={NPC_R} />
                </g>
              );
            })}

          </g>
        )}
      </svg>

      {/* Edge action menu */}
      {edgeMenu && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">{edgeMenu.edge.label || '(unlabelled)'}</div>
          <button className="rel-ctx-item" onClick={() => {
            setEditLabel({ edgeId: edgeMenu.edge.id, currentLabel: edgeMenu.edge.label, x: edgeMenu.x, y: edgeMenu.y });
            setEdgeMenu(null);
          }}>✏️ Change label</button>
          <button className="rel-ctx-item" onClick={toggleEdge}>
            {edgeMenu.edge.active ? '○ Disable' : '● Enable'}
          </button>
          <button className="rel-ctx-item rel-ctx-danger" onClick={deleteEdge}>🗑 Delete edge</button>
        </div>
      )}

      {/* Node context menu */}
      {nodeCtx && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: nodeCtx.x, top: nodeCtx.y }} onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">{nodeCtx.name}</div>
          <button className="rel-ctx-item" onClick={() => { removeFromCanvas(nodeCtx.type, nodeCtx.id); setNodeCtx(null); }}>
            ← Remove from canvas
          </button>
        </div>
      )}

      {/* Label picker */}
      {activePicker && (
        <div className="rel-label-picker" style={{ left: activePicker.x, top: activePicker.y }}>
          <div className="rel-label-picker-title">
            {editLabel ? 'Change label · click current to remove' : 'Relationship type'}
          </div>
          <div className="rel-label-presets">
            {PRESET_LABELS.map(l => (
              <button key={l} className={`rel-label-preset ${l === activePicker.currentLabel ? 'rel-label-preset--current' : ''}`}
                style={{ '--preset-color': edgeColor(l) } as React.CSSProperties}
                onClick={() => { setLabelDraft(l); activePicker.onConfirm(l); }}>
                {l}{l === activePicker.currentLabel ? ' ✕' : ''}
              </button>
            ))}
          </div>
          <div className="rel-label-custom">
            <input className="rel-label-input" placeholder="custom label…" autoFocus
              defaultValue={activePicker.currentLabel}
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') activePicker.onConfirm(labelDraft);
                if (e.key === 'Escape') activePicker.onCancel();
              }} />
            <button className="rel-label-ok" onClick={() => activePicker.onConfirm(labelDraft)}>✓</button>
          </div>
          <button className="rel-label-cancel" onClick={activePicker.onCancel}>Cancel</button>
        </div>
      )}

      {/* Legend */}
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
