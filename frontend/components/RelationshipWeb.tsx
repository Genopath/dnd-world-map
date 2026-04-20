import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction, NPC, RelationshipEdge } from '../types';

// ── Canvas constants ──────────────────────────────────────────────────────────
const W = 1000;
const H = 680;
const NPC_R = 32;
const FACT_W = 110;
const FACT_H = 40;

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

type NodeKind = 'npc' | 'faction';
function nodeKey(type: NodeKind, id: number) { return `${type}-${id}`; }

// Stable placement using golden-angle distribution — doesn't shift when total changes
const GOLDEN = 2.399963; // radians ≈ 137.5°
function defaultPos(type: NodeKind, id: number): { x: number; y: number } {
  const angle = (id * GOLDEN) % (2 * Math.PI) - Math.PI / 2;
  const r = type === 'faction' ? 130 : 270;
  return { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
}

const FACTION_COLORS = ['#7b5ea7', '#5e8a7b', '#a7695e', '#5e7ba7', '#a79c5e', '#a75e7b'];
function randomFactionColor() { return FACTION_COLORS[Math.floor(Math.random() * FACTION_COLORS.length)]; }

interface CtxMenu { x: number; y: number; type: NodeKind; id: number; name: string; }

interface Props {
  npcs:             NPC[];
  factions:         Faction[];
  isDMMode:         boolean;
  onCreateNPC?:     (data: Omit<NPC, 'id' | 'created_at' | 'portrait_url'>) => Promise<NPC>;
  onCreateFaction?: (data: Omit<Faction, 'id' | 'created_at'>) => Promise<Faction>;
  onDeleteNPC?:     (id: number) => Promise<void>;
  onDeleteFaction?: (id: number) => Promise<void>;
}

export default function RelationshipWeb({
  npcs, factions, isDMMode,
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

  // ── Interaction ───────────────────────────────────────────────────────────
  const mode      = useRef<'idle' | 'pan' | 'drag'>('idle');
  const panOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });
  const dragState = useRef<{ key: string; origX: number; origY: number; startCx: number; startCy: number } | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selecting,   setSelecting]   = useState<{ type: NodeKind; id: number } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ from: { type: NodeKind; id: number }; to: { type: NodeKind; id: number }; screenX: number; screenY: number } | null>(null);
  const [labelDraft,  setLabelDraft]  = useState('');
  const [hoveredKey,  setHoveredKey]  = useState<string | null>(null);
  const [ctxMenu,     setCtxMenu]     = useState<CtxMenu | null>(null);

  // Quick-add
  const [showAdd,  setShowAdd]  = useState(false);
  const [addKind,  setAddKind]  = useState<NodeKind>('npc');
  const [addName,  setAddName]  = useState('');
  const [addBusy,  setAddBusy]  = useState(false);

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

  // ── Fit view ─────────────────────────────────────────────────────────────
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect = svg.getBoundingClientRect();
      const { tx, ty, scale } = xfRef.current;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ns = Math.max(0.1, Math.min(6, scale * factor));
      const r  = ns / scale;
      setScale(ns); setTx(mx - (mx - tx) * r); setTy(my - (my - ty) * r);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { tx, ty, scale } = xfRef.current;
    const mx = rect.width / 2; const my = rect.height / 2;
    const ns = Math.max(0.1, Math.min(6, scale * factor));
    const r  = ns / scale;
    setScale(ns); setTx(mx - (mx - tx) * r); setTy(my - (my - ty) * r);
  };

  // ── Global mouse ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
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
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Dismiss context menu on outside click ─────────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [ctxMenu]);

  // ── Hover: which edges connect to hovered node ────────────────────────────
  const connectedKeys = hoveredKey ? new Set<string>() : null;
  const connectedEdgeIds = hoveredKey ? new Set<number>() : null;
  if (hoveredKey && connectedKeys && connectedEdgeIds) {
    connectedKeys.add(hoveredKey);
    edges.forEach(e => {
      const fk = nodeKey(e.from_type, e.from_id);
      const tk = nodeKey(e.to_type, e.to_id);
      if (fk === hoveredKey || tk === hoveredKey) {
        connectedEdgeIds.add(e.id);
        connectedKeys.add(fk);
        connectedKeys.add(tk);
      }
    });
  }
  const dimNode  = (key: string)  => hoveredKey && !connectedKeys!.has(key)  ? 0.15 : 1;
  const dimEdge  = (id: number)   => hoveredKey && !connectedEdgeIds!.has(id) ? 0.08 : 1;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setCtxMenu(null);
    mode.current = 'pan';
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx, ty };
  };

  const onNodeMouseDown = (e: React.MouseEvent, type: NodeKind, id: number) => {
    if (e.button !== 0 || !isDMMode) return;
    e.stopPropagation();
    const key = nodeKey(type, id);
    const pos = getPos(type, id);
    mode.current = 'drag';
    dragState.current = { key, origX: pos.x, origY: pos.y, startCx: e.clientX, startCy: e.clientY };
  };

  const onNodeClick = (e: React.MouseEvent, type: NodeKind, id: number) => {
    e.stopPropagation();
    setCtxMenu(null);
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

  const onNodeRightClick = (e: React.MouseEvent, type: NodeKind, id: number, name: string) => {
    if (!isDMMode) return;
    e.preventDefault(); e.stopPropagation();
    const rect = svgRef.current!.getBoundingClientRect();
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type, id, name });
  };

  const deleteNode = async () => {
    if (!ctxMenu) return;
    const { type, id } = ctxMenu;
    setCtxMenu(null);
    // Remove edges that involve this node
    const toRemove = edges.filter(e =>
      (e.from_type === type && e.from_id === id) ||
      (e.to_type   === type && e.to_id   === id)
    );
    await Promise.all(toRemove.map(e => api.relationships.deleteEdge(e.id)));
    setEdges(prev => prev.filter(e =>
      !(e.from_type === type && e.from_id === id) &&
      !(e.to_type   === type && e.to_id   === id)
    ));
    if (type === 'npc') onDeleteNPC?.(id);
    else                onDeleteFaction?.(id);
  };

  // ── Edge creation / deletion ──────────────────────────────────────────────
  const confirmEdge = async (label: string) => {
    if (!pendingEdge || !label.trim()) { setPendingEdge(null); return; }
    const edge = await api.relationships.createEdge({
      from_type: pendingEdge.from.type, from_id: pendingEdge.from.id,
      to_type:   pendingEdge.to.type,   to_id:   pendingEdge.to.id,
      label:     label.trim(),
    });
    setEdges(prev => [...prev, edge]); setPendingEdge(null);
  };

  const deleteEdge = async (id: number) => {
    await api.relationships.deleteEdge(id);
    setEdges(prev => prev.filter(e => e.id !== id));
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
  const npcPos     = (id: number) => getPos('npc',     id);
  const factionPos = (id: number) => getPos('faction', id);
  const edgeEndpoints = (e: RelationshipEdge) => ({
    x1: e.from_type === 'npc' ? npcPos(e.from_id).x : factionPos(e.from_id).x,
    y1: e.from_type === 'npc' ? npcPos(e.from_id).y : factionPos(e.from_id).y,
    x2: e.to_type   === 'npc' ? npcPos(e.to_id).x   : factionPos(e.to_id).x,
    y2: e.to_type   === 'npc' ? npcPos(e.to_id).y   : factionPos(e.to_id).y,
  });

  if (loading) return <div className="rel-web-loading">Loading…</div>;

  const selectedKey = selecting ? nodeKey(selecting.type, selecting.id) : null;
  const hasNodes = npcs.length > 0 || factions.length > 0;

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
              ? 'Click to link · drag to move · hover to highlight · right-click node to delete'
              : 'Use "+ Add Node" to add NPCs or factions'}
        </div>
      )}

      {/* ── SVG canvas ────────────────────────────────────────────────────── */}
      <svg ref={svgRef} className="rel-web-svg"
        onMouseDown={onSvgMouseDown}
        onClick={() => { setSelecting(null); setCtxMenu(null); }}
        onKeyDown={e => { if (e.key === 'Escape') { setSelecting(null); setShowAdd(false); setCtxMenu(null); } }}
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
            const color = edgeColor(edge.label);
            const lk = edge.label.toLowerCase();
            const markerId = EDGE_COLORS[lk] ? `arrow-${lk}` : 'arrow-default';
            const dxx = x2 - x1; const dyy = y2 - y1;
            const len = Math.sqrt(dxx * dxx + dyy * dyy) || 1;
            const ux = dxx / len; const uy = dyy / len;
            const pad = edge.to_type === 'npc' ? NPC_R + 6 : FACT_H / 2 + 6;
            const opacity = dimEdge(edge.id);
            return (
              <g key={edge.id} className="rel-edge" style={{ opacity }}
                onContextMenu={isDMMode ? e => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); } : undefined}
              >
                <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                  stroke={color} strokeWidth={2.5} strokeOpacity={0.85}
                  markerEnd={`url(#${markerId})`} />
                <line x1={x1} y1={y1} x2={x2 - ux * pad} y2={y2 - uy * pad}
                  stroke="transparent" strokeWidth={16} />
                {edge.label && (
                  <text x={mx} y={my - 8} textAnchor="middle" className="rel-edge-label" fill={color}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Faction nodes ─────────────────────────────────────────── */}
          {factions.map(f => {
            const pos = getPos('faction', f.id);
            const key = nodeKey('faction', f.id);
            const isSel = key === selectedKey;
            const opacity = dimNode(key);
            return (
              <g key={key} className="rel-node" style={{ opacity }}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey(null)}
                onMouseDown={e => onNodeMouseDown(e, 'faction', f.id)}
                onClick={e => onNodeClick(e, 'faction', f.id)}
                onContextMenu={e => onNodeRightClick(e, 'faction', f.id, f.name)}
              >
                {isSel && <rect x={-FACT_W/2-5} y={-FACT_H/2-5} width={FACT_W+10} height={FACT_H+10} rx={9}
                  fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="5 3" />}
                <rect x={-FACT_W/2} y={-FACT_H/2} width={FACT_W} height={FACT_H} rx={7}
                  fill={f.color || '#555577'} fillOpacity={0.9}
                  stroke={isSel ? '#e8c870' : '#ffffff44'} strokeWidth={isSel ? 2.5 : 1} />
                <text x={0} y={6} textAnchor="middle" className="rel-node-label rel-node-label--faction">
                  {f.name.length > 13 ? f.name.slice(0, 12) + '…' : f.name}
                </text>
                <text x={0} y={-FACT_H/2-8} textAnchor="middle" className="rel-node-sublabel">Faction</text>
              </g>
            );
          })}

          {/* ── NPC nodes ─────────────────────────────────────────────── */}
          {npcs.map(n => {
            const pos = getPos('npc', n.id);
            const key = nodeKey('npc', n.id);
            const isSel = key === selectedKey;
            const opacity = dimNode(key);
            const ringColor = n.status === 'dead' ? '#d46060' : n.status === 'unknown' ? '#8a8098' : '#72b86e';
            return (
              <g key={key} className="rel-node" style={{ opacity }}
                transform={`translate(${pos.x},${pos.y})`}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey(null)}
                onMouseDown={e => onNodeMouseDown(e, 'npc', n.id)}
                onClick={e => onNodeClick(e, 'npc', n.id)}
                onContextMenu={e => onNodeRightClick(e, 'npc', n.id, n.name)}
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
                  <text x={0} y={8} textAnchor="middle" className="rel-node-initial">
                    {n.name.charAt(0).toUpperCase()}
                  </text>
                )}
                <text x={0} y={NPC_R+18} textAnchor="middle" className="rel-node-label">
                  {n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}
                </text>
                {n.role && (
                  <text x={0} y={NPC_R+32} textAnchor="middle" className="rel-node-sublabel">
                    {n.role.length > 18 ? n.role.slice(0, 17) + '…' : n.role}
                  </text>
                )}
              </g>
            );
          })}

        </g>
      </svg>

      {/* ── Node right-click context menu ─────────────────────────────────── */}
      {ctxMenu && isDMMode && (
        <div className="rel-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}>
          <div className="rel-ctx-title">{ctxMenu.name}</div>
          <button className="rel-ctx-item rel-ctx-danger" onClick={deleteNode}>
            🗑 Delete {ctxMenu.type === 'npc' ? 'NPC' : 'Faction'}
          </button>
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
