import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CampaignSettings, PartyMember } from '../types';
import { API_BASE, api } from '../lib/api';

interface Transform { x: number; y: number; scale: number; }

interface Props {
  campaign: CampaignSettings | null;
  party: PartyMember[];
  isDMMode: boolean;
  onClose: () => void;
  onUpdateCampaign: (data: Partial<CampaignSettings>) => Promise<void>;
  onUpdateMember: (id: number, data: Partial<PartyMember>) => Promise<void>;
}

export default function CampMap({ campaign, party, isDMMode, onClose, onUpdateCampaign, onUpdateMember }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Pan state
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const hasPanned = useRef(false);

  // Token drag state
  const draggingRef = useRef<{ memberId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({});

  const campUrl = campaign?.camp_map_url ? API_BASE + campaign.camp_map_url : null;

  function getPos(m: PartyMember) {
    return positions[m.id] ?? { x: m.camp_x ?? 50, y: m.camp_y ?? 50 };
  }

  // ── Wheel zoom ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform(prev => {
        const newScale = Math.max(0.2, Math.min(8, prev.scale * factor));
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratio = newScale / prev.scale;
        return { x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio, scale: newScale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Pan ───────────────────────────────────────────────────────────────────────
  const handlePanDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.camp-token')) return;
    isPanning.current = true;
    hasPanned.current = false;
    panStart.current = { x: e.clientX, y: e.clientY, tx: transformRef.current.x, ty: transformRef.current.y };
  }, []);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) hasPanned.current = true;
    setTransform(prev => ({ ...prev, x: panStart.current.tx + dx, y: panStart.current.ty + dy }));
  }, []);

  const handlePanUp = useCallback(() => { isPanning.current = false; }, []);

  // ── Upload / delete ──────────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.campaign.uploadCampMap(file);
      await onUpdateCampaign({ camp_map_url: res.camp_map_url });
      setTransform({ x: 0, y: 0, scale: 1 });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteMap = async () => {
    if (!confirm('Remove the camp battlemap image?')) return;
    await api.campaign.deleteCampMap();
    await onUpdateCampaign({ camp_map_url: null });
  };

  // ── Token drag ────────────────────────────────────────────────────────────────
  const onTokenMouseDown = useCallback((e: React.MouseEvent, member: PartyMember) => {
    if (!isDMMode) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos(member);
    draggingRef.current = { memberId: member.id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !imgRef.current) return;
      const imgEl = imgRef.current;
      const scale = transformRef.current.scale;
      const dx = ev.clientX - draggingRef.current.startX;
      const dy = ev.clientY - draggingRef.current.startY;
      const newX = Math.max(0, Math.min(100, draggingRef.current.origX + (dx / (imgEl.offsetWidth * scale)) * 100));
      const newY = Math.max(0, Math.min(100, draggingRef.current.origY + (dy / (imgEl.offsetHeight * scale)) * 100));
      setPositions(prev => ({ ...prev, [draggingRef.current!.memberId]: { x: newX, y: newY } }));
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      const id = draggingRef.current.memberId;
      const origX = draggingRef.current.origX;
      const origY = draggingRef.current.origY;
      draggingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setPositions(prev => {
        const finalPos = prev[id] ?? { x: origX, y: origY };
        onUpdateMember(id, { camp_x: finalPos.x, camp_y: finalPos.y });
        return prev;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isDMMode, onUpdateMember]);

  const toggleVisible = async (m: PartyMember) => {
    await onUpdateMember(m.id, { camp_visible: !(m.camp_visible ?? true) });
  };

  const visibleParty = isDMMode ? party : party.filter(m => m.camp_visible !== false);

  const zoomIn  = () => setTransform(prev => ({ ...prev, scale: Math.min(8, prev.scale * 1.25) }));
  const zoomOut = () => setTransform(prev => ({ ...prev, scale: Math.max(0.2, prev.scale * 0.8) }));
  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });

  return (
    <div className={`camp-overlay${isFullscreen ? ' camp-overlay--fullscreen' : ''}`} onClick={onClose}>
      <div className={`camp-panel${isFullscreen ? ' camp-panel--fullscreen' : ''}`} onClick={e => e.stopPropagation()}>

        <div className="camp-header">
          <span className="camp-title">⛺ Camp Battlemap</span>
          <div className="camp-header-actions">
            {campUrl && (
              <div className="camp-zoom-btns">
                <button className="camp-btn-sm" onClick={zoomOut} title="Zoom out">−</button>
                <button className="camp-btn-sm camp-btn-reset" onClick={resetView} title="Reset view">⤢</button>
                <button className="camp-btn-sm" onClick={zoomIn} title="Zoom in">+</button>
              </div>
            )}
            {isDMMode && (
              <>
                <button className="camp-btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : campUrl ? '🗺 Replace' : '🗺 Upload Map'}
                </button>
                {campUrl && (
                  <button className="camp-btn-sm camp-btn-danger" onClick={handleDeleteMap}>✕ Remove</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
              </>
            )}
            <button className="camp-btn-sm camp-btn-icon" onClick={() => setIsFullscreen(v => !v)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              {isFullscreen ? '⊡' : '⛶'}
            </button>
            <button className="camp-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="camp-body">
          {campUrl ? (
            <div
              className="camp-map-wrap"
              ref={containerRef}
              onMouseDown={handlePanDown}
              onMouseMove={handlePanMove}
              onMouseUp={handlePanUp}
              onMouseLeave={handlePanUp}
              style={{ cursor: isPanning.current && hasPanned.current ? 'grabbing' : 'grab' }}
            >
              <div
                className="camp-map-transform"
                style={{ transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})`, transformOrigin: '0 0' }}
              >
                <img ref={imgRef} src={campUrl} alt="Camp battlemap" className="camp-map-img" draggable={false} />

                {visibleParty.map(m => {
                  const pos = getPos(m);
                  const hidden = m.camp_visible === false;
                  return (
                    <div
                      key={m.id}
                      className={`camp-token${isDMMode ? ' camp-token--dm' : ''}${hidden ? ' camp-token--hidden' : ''}`}
                      style={{ left: `${pos.x}%`, top: `${pos.y}%`, borderColor: m.path_color }}
                      onMouseDown={e => onTokenMouseDown(e, m)}
                      title={m.name}
                    >
                      {m.portrait_url ? (
                        <img src={API_BASE + m.portrait_url} alt={m.name} className="camp-token-portrait" />
                      ) : (
                        <span className="camp-token-initial" style={{ background: m.path_color }}>
                          {m.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="camp-token-label">{m.name}</span>
                      {isDMMode && (
                        <button
                          className="camp-token-eye"
                          title={hidden ? 'Show to players' : 'Hide from players'}
                          onClick={e => { e.stopPropagation(); toggleVisible(m); }}
                        >
                          {hidden ? '🙈' : '👁'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="camp-empty">
              <div className="camp-empty-icon">⛺</div>
              <p>{isDMMode ? 'Upload a battlemap image to get started.' : 'No camp map set yet.'}</p>
              {isDMMode && (
                <button className="camp-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload Battlemap'}
                </button>
              )}
            </div>
          )}
        </div>

        {isDMMode && campUrl && (
          <div className="camp-footer">
            <span className="camp-hint">Scroll to zoom · Drag to pan · Drag tokens to reposition · 👁 toggles player visibility</span>
          </div>
        )}
      </div>
    </div>
  );
}
