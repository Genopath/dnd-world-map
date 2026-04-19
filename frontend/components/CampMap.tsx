import React, { useCallback, useRef, useState } from 'react';
import { CampaignSettings, PartyMember } from '../types';
import { API_BASE, api } from '../lib/api';

interface Props {
  campaign: CampaignSettings | null;
  party: PartyMember[];
  isDMMode: boolean;
  onClose: () => void;
  onUpdateCampaign: (data: Partial<CampaignSettings>) => Promise<void>;
  onUpdateMember: (id: number, data: Partial<PartyMember>) => Promise<void>;
}

export default function CampMap({ campaign, party, isDMMode, onClose, onUpdateCampaign, onUpdateMember }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Track which token is being dragged
  const draggingRef = useRef<{ memberId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({});

  const campUrl = campaign?.camp_map_url ? API_BASE + campaign.camp_map_url : null;

  function getPos(m: PartyMember) {
    const local = positions[m.id];
    if (local) return local;
    return { x: m.camp_x ?? 50, y: m.camp_y ?? 50 };
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.campaign.uploadCampMap(file);
      await onUpdateCampaign({ camp_map_url: res.camp_map_url });
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

  const onTokenMouseDown = useCallback((e: React.MouseEvent, member: PartyMember) => {
    if (!isDMMode) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos(member);
    draggingRef.current = {
      memberId: member.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !mapRef.current) return;
      const rect = mapRef.current.getBoundingClientRect();
      const dx = ev.clientX - draggingRef.current.startX;
      const dy = ev.clientY - draggingRef.current.startY;
      const newX = Math.max(0, Math.min(100, draggingRef.current.origX + (dx / rect.width) * 100));
      const newY = Math.max(0, Math.min(100, draggingRef.current.origY + (dy / rect.height) * 100));
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
  }, [isDMMode, positions, onUpdateMember]);

  const toggleVisible = async (m: PartyMember) => {
    await onUpdateMember(m.id, { camp_visible: !(m.camp_visible ?? true) });
  };

  const visibleParty = isDMMode ? party : party.filter(m => m.camp_visible !== false);

  return (
    <div className="camp-overlay" onClick={onClose}>
      <div className="camp-panel" onClick={e => e.stopPropagation()}>
        <div className="camp-header">
          <span className="camp-title">⛺ Camp Battlemap</span>
          <div className="camp-header-actions">
            {isDMMode && (
              <>
                <button className="camp-btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : campUrl ? '🗺 Replace Map' : '🗺 Upload Map'}
                </button>
                {campUrl && (
                  <button className="camp-btn-sm camp-btn-danger" onClick={handleDeleteMap}>✕ Remove</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
              </>
            )}
            <button className="camp-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="camp-body">
          {campUrl ? (
            <div className="camp-map-wrap" ref={mapRef}>
              <img src={campUrl} alt="Camp battlemap" className="camp-map-img" draggable={false} />

              {/* Party tokens */}
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
            <span className="camp-hint">Drag tokens to reposition · 👁 toggles player visibility</span>
          </div>
        )}
      </div>
    </div>
  );
}
