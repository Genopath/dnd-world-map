import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, API_BASE } from '../lib/api';
import type { Faction, NPC, RelationshipEdge, RelationshipNodePos } from '../types';

// ── Canvas constants ──────────────────────────────────────────────────────────
const W = 1000;
const H = 680;
const NPC_R = 26;
const FACT_W = 90;
const FACT_H = 34;

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
interface NodeKey { type: NodeKind; id: number; }

function nodeKey(type: NodeKind, id: number) { return `${type}-${id}`; }

function defaultPos(type: NodeKind, index: number, total: number): { x: number; y: number } {
  const angle = (index / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2;
  const r = type === 'faction' ? 140 : 270;
  return { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
}

interface Props {
  npcs:     NPC[];
  factions: Faction[];
  isDMMode: boolean;
}

export default function RelationshipWeb({ npcs, factions, isDMMode }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  const [edges,     setEdges]     = useState<RelationshipEdge[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [loading,   setLoading]   = useState(true);

  // Pan / zoom
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(0.65);
  const transformRef = useRef({ tx: 0, ty: 0, scale: 0.65 });
  transformRef.current = { tx, ty, scale };
  const isPanning = useRef(false);
  const panStart  = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  // Node selection / edge creation
  const [selecting, setSelecting] = useState<NodeKey | null>(null);
  const [pendingEdge, setPendingEdge] = useState<{ from: NodeKey; to: NodeKey; screenX: number; screenY: number } | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // Node drag
  const dragging = useRef<{ key: string; startMx: number; startMy: number; origX: number; origY: number } | null>(null);

  // ── Center view on mount ─────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const s = 0.65;
    setScale(s);
    setTx(rect.width  / 2 - (W / 2) * s);
    setTy(rect.height / 2 - (H / 2) * s);
  }, []);

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

  const getPos = useCallback((type: NodeKind, id: number, index: number, total: number) => {
    return positions[nodeKey(type, id)] ?? defaultPos(type, index, total);
  }, [positions]);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.11;
      const rect = svg.getBoundingClientRect();
      const { tx, ty, scale } = transformRef.current;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const newScale = Math.max(0.25, Math.min(4, scale * factor));
      const ratio = newScale / scale;
      setScale(newScale);
      setTx(mx - (mx - tx) * ratio);
      setTy(my - (my - ty) * ratio);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ── SVG coords helper ─────────────────────────────────────────────────────
  const toSvg = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { tx, ty, scale } = transformRef.current;
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  };

  // ── Pan handlers ──────────────────────────────────────────────────────────
  const onBgDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { mx: e.clientX, my: e.clientY, tx, ty };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (isPanning.current) {
      setTx(panStart.current.tx + (e.clientX - panStart.current.mx));
      setTy(panStart.current.ty + (e.clientY - panStart.current.my));
    }
    if (dragging.current) {
      const { key, startMx, startMy, origX, origY } = dragging.current;
      const { scale } = transformRef.current;
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = (e.clientX - rect.left - startMx) / scale;
      const dy = (e.clientY - rect.top  - startMy) / scale;
      setPositions(prev => ({ ...prev, [key]: { x: origX + dx, y: origY + dy } }));
    }
  };
  const onMouseUp = useCallback(() => {
    isPanning.current = false;
    if (dragging.current) {
      const { key } = dragging.current;
      const [type, idStr] = key.split('-');
      setPositions(prev => {
        const p = prev[key];
        if (p) {
          api.relationships.upsertPosition({ entity_type: type as NodeKind, entity_id: Number(idStr), x: p.x, y: p.y });
        }
        return prev;
      });
      dragging.current = null;
    }
  }, []);

  // ── Node click ────────────────────────────────────────────────────────────
  const onNodeClick = (e: React.MouseEvent, type: NodeKind, id: number) => {
    e.stopPropagation();
    if (!isDMMode) return;
    if (!selecting) {
      setSelecting({ type, id });
    } else {
      if (selecting.type === type && selecting.id === id) { setSelecting(null); return; }
      const rect = svgRef.current!.getBoundingClientRect();
      setPendingEdge({ from: selecting, to: { type, id }, screenX: e.clientX - rect.left, screenY: e.clientY - rect.top });
      setLabelDraft('');
      setSelecting(null);
    }
  };

  const onNodeDragStart = (e: React.MouseEvent, type: NodeKind, id: number) => {
    if (!isDMMode) return;
    e.stopPropagation();
    const key = nodeKey(type, id);
    const index = type === 'npc' ? npcs.findIndex(n => n.id === id) : factions.findIndex(f => f.id === id);
    const total = type === 'npc' ? npcs.length : factions.length;
    const pos = getPos(type, id, index, total);
    const rect = svgRef.current!.getBoundingClientRect();
    const { tx, ty, scale } = transformRef.current;
    dragging.current = {
      key,
      startMx: (e.clientX - rect.left - tx) / scale,
      startMy: (e.clientY - rect.top  - ty) / scale,
      origX: pos.x, origY: pos.y,
    };
  };

  // ── Edge creation ─────────────────────────────────────────────────────────
  const confirmEdge = async (label: string) => {
    if (!pendingEdge || !label.trim()) { setPendingEdge(null); return; }
    const edge = await api.relationships.createEdge({
      from_type: pendingEdge.from.type, from_id: pendingEdge.from.id,
      to_type:   pendingEdge.to.type,   to_id:   pendingEdge.to.id,
      label:     label.trim(),
    });
    setEdges(prev => [...prev, edge]);
    setPendingEdge(null);
  };

  // ── Edge delete ───────────────────────────────────────────────────────────
  const deleteEdge = async (id: number) => {
    await api.relationships.deleteEdge(id);
    setEdges(prev => prev.filter(e => e.id !== id));
  };

  // ── Node position lookup ──────────────────────────────────────────────────
  const npcPos     = (id: number) => { const i = npcs.findIndex(n => n.id === id);     return getPos('npc',     id, i, npcs.length);     };
  const factionPos = (id: number) => { const i = factions.findIndex(f => f.id === id); return getPos('faction', id, i, factions.length); };
  const edgePos    = (e: RelationshipEdge) => ({
    x1: e.from_type === 'npc' ? npcPos(e.from_id).x : factionPos(e.from_id).x,
    y1: e.from_type === 'npc' ? npcPos(e.from_id).y : factionPos(e.from_id).y,
    x2: e.to_type   === 'npc' ? npcPos(e.to_id).x   : factionPos(e.to_id).x,
    y2: e.to_type   === 'npc' ? npcPos(e.to_id).y   : factionPos(e.to_id).y,
  });

  if (loading) return <div className="rel-web-loading">Loading…</div>;
  if (npcs.length === 0 && factions.length === 0) return (
    <div className="rel-web-empty">Add NPCs or Factions first to build a relationship web.</div>
  );

  const selectedKey = selecting ? nodeKey(selecting.type, selecting.id) : null;

  return (
    <div className="rel-web-wrap">
      {isDMMode && (
        <div className="rel-web-hint">
          {selecting ? '🔗 Click a second node to link · Esc to cancel' : 'Click a node to link · Drag to move · Right-click edge to delete'}
        </div>
      )}

      <svg
        ref={svgRef}
        className="rel-web-svg"
        onMouseDown={onBgDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={() => setSelecting(null)}
        onKeyDown={e => { if (e.key === 'Escape') setSelecting(null); }}
        tabIndex={0}
      >
        <defs>
          {Object.entries(EDGE_COLORS).map(([k, c]) => (
            <marker key={k} id={`arrow-${k}`} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={c} />
            </marker>
          ))}
          <marker id="arrow-default" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#8a8098" />
          </marker>
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {/* ── Edges ─────────────────────────────────────────────────── */}
          {edges.map(edge => {
            const { x1, y1, x2, y2 } = edgePos(edge);
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const color = edgeColor(edge.label);
            const labelKey = edge.label.toLowerCase();
            const markerId = EDGE_COLORS[labelKey] ? `arrow-${labelKey}` : 'arrow-default';
            // Shorten line to not overlap node
            const dx = x2 - x1; const dy = y2 - y1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / len; const uy = dy / len;
            const pad2 = edge.to_type === 'npc' ? NPC_R + 4 : FACT_H / 2 + 4;
            const ex2 = x2 - ux * pad2; const ey2 = y2 - uy * pad2;
            return (
              <g key={edge.id} className="rel-edge"
                onContextMenu={isDMMode ? e => { e.preventDefault(); e.stopPropagation(); deleteEdge(edge.id); } : undefined}
              >
                <line x1={x1} y1={y1} x2={ex2} y2={ey2}
                  stroke={color} strokeWidth={2} strokeOpacity={0.75}
                  markerEnd={`url(#${markerId})`}
                />
                {/* Wider invisible hit target */}
                <line x1={x1} y1={y1} x2={ex2} y2={ey2}
                  stroke="transparent" strokeWidth={14}
                />
                {edge.label && (
                  <text x={mx} y={my - 6} textAnchor="middle" className="rel-edge-label" fill={color}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Faction nodes ─────────────────────────────────────────── */}
          {factions.map((f, i) => {
            const pos = getPos('faction', f.id, i, factions.length);
            const key = nodeKey('faction', f.id);
            const isSelected = key === selectedKey;
            return (
              <g key={key} className="rel-node"
                transform={`translate(${pos.x},${pos.y})`}
                onClick={e => onNodeClick(e, 'faction', f.id)}
                onMouseDown={e => { if (e.button === 0) onNodeDragStart(e, 'faction', f.id); }}
              >
                <rect x={-FACT_W / 2} y={-FACT_H / 2} width={FACT_W} height={FACT_H} rx={6}
                  fill={f.color || '#555577'} fillOpacity={0.85}
                  stroke={isSelected ? '#fff' : (f.color || '#888')} strokeWidth={isSelected ? 3 : 1.5}
                />
                {isSelected && <rect x={-FACT_W / 2 - 3} y={-FACT_H / 2 - 3} width={FACT_W + 6} height={FACT_H + 6} rx={8}
                  fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="4 3" />}
                <text x={0} y={5} textAnchor="middle" className="rel-node-label rel-node-label--faction">
                  {f.name.length > 12 ? f.name.slice(0, 11) + '…' : f.name}
                </text>
                <text x={0} y={-FACT_H / 2 - 6} textAnchor="middle" className="rel-node-sublabel">Faction</text>
              </g>
            );
          })}

          {/* ── NPC nodes ─────────────────────────────────────────────── */}
          {npcs.map((n, i) => {
            const pos  = getPos('npc', n.id, i, npcs.length);
            const key  = nodeKey('npc', n.id);
            const isSelected = key === selectedKey;
            const ringColor = n.status === 'dead' ? '#d46060' : n.status === 'unknown' ? '#8a8098' : '#72b86e';
            return (
              <g key={key} className="rel-node"
                transform={`translate(${pos.x},${pos.y})`}
                onClick={e => onNodeClick(e, 'npc', n.id)}
                onMouseDown={e => { if (e.button === 0) onNodeDragStart(e, 'npc', n.id); }}
              >
                {isSelected && <circle r={NPC_R + 7} fill="none" stroke="#e8c870" strokeWidth={2} strokeDasharray="4 3" />}
                <circle r={NPC_R} fill="#1c1b32" stroke={ringColor} strokeWidth={isSelected ? 3 : 2} />
                {n.portrait_url
                  ? (
                    <>
                      <defs>
                        <clipPath id={`clip-npc-${n.id}`}>
                          <circle r={NPC_R - 2} />
                        </clipPath>
                      </defs>
                      <image href={API_BASE + n.portrait_url} x={-(NPC_R - 2)} y={-(NPC_R - 2)}
                        width={(NPC_R - 2) * 2} height={(NPC_R - 2) * 2}
                        clipPath={`url(#clip-npc-${n.id})`} preserveAspectRatio="xMidYMid slice" />
                    </>
                  ) : (
                    <text x={0} y={5} textAnchor="middle" className="rel-node-initial">{n.name.charAt(0).toUpperCase()}</text>
                  )
                }
                <text x={0} y={NPC_R + 14} textAnchor="middle" className="rel-node-label">{n.name.length > 14 ? n.name.slice(0, 13) + '…' : n.name}</text>
                {n.role && <text x={0} y={NPC_R + 25} textAnchor="middle" className="rel-node-sublabel">{n.role.length > 16 ? n.role.slice(0, 15) + '…' : n.role}</text>}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ── Edge label picker ──────────────────────────────────────────── */}
      {pendingEdge && (
        <div className="rel-label-picker" style={{ left: pendingEdge.screenX, top: pendingEdge.screenY }}>
          <div className="rel-label-picker-title">Relationship type</div>
          <div className="rel-label-presets">
            {PRESET_LABELS.map(l => (
              <button key={l} className="rel-label-preset" style={{ '--preset-color': edgeColor(l) } as React.CSSProperties}
                onClick={() => confirmEdge(l)}>{l}</button>
            ))}
          </div>
          <div className="rel-label-custom">
            <input
              className="rel-label-input"
              placeholder="or type custom…"
              value={labelDraft}
              autoFocus
              onChange={e => setLabelDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdge(labelDraft); if (e.key === 'Escape') setPendingEdge(null); }}
            />
            <button className="rel-label-ok" onClick={() => confirmEdge(labelDraft)}>✓</button>
          </div>
          <button className="rel-label-cancel" onClick={() => setPendingEdge(null)}>Cancel</button>
        </div>
      )}

      {isDMMode && (
        <div className="rel-legend">
          {Object.entries(EDGE_COLORS).map(([label, color]) => (
            <span key={label} className="rel-legend-item">
              <span className="rel-legend-dot" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
