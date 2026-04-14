import React, { useState } from 'react';
import type { CampaignSettings } from '../types';
import MarkdownText from './MarkdownText';

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter', ''];
const WEATHER_OPTIONS = ['Clear', 'Cloudy', 'Rainy', 'Stormy', 'Foggy', 'Snowing', 'Blizzard', 'Scorching', ''];

interface EditState {
  world_name: string; in_world_date: string; in_world_time: string;
  weather: string; season: string; notes: string;
}

function toEdit(c: CampaignSettings): EditState {
  return { world_name: c.world_name, in_world_date: c.in_world_date, in_world_time: c.in_world_time, weather: c.weather, season: c.season, notes: c.notes };
}

interface Props {
  campaign: CampaignSettings | null;
  isDMMode: boolean;
  onUpdate: (data: Partial<Omit<CampaignSettings, 'id'>>) => Promise<void>;
}

export default function CampaignPanel({ campaign, isDMMode, onUpdate }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [saving,    setSaving]    = useState(false);

  const startEdit = () => {
    if (!campaign) return;
    setEditState(toEdit(campaign));
    setIsEditing(true);
  };

  const cancel = () => { setIsEditing(false); setEditState(null); };

  const save = async () => {
    if (!editState) return;
    setSaving(true);
    try {
      await onUpdate({
        world_name: editState.world_name.trim(),
        in_world_date: editState.in_world_date.trim(),
        in_world_time: editState.in_world_time.trim(),
        weather: editState.weather.trim(),
        season: editState.season.trim(),
        notes: editState.notes.trim(),
      });
      setIsEditing(false);
    } finally { setSaving(false); }
  };

  const set = (key: keyof EditState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setEditState(prev => prev ? { ...prev, [key]: e.target.value } : prev);

  if (!campaign) {
    return <div className="no-sel"><div>Loading campaign settings…</div></div>;
  }

  if (isEditing && editState) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="form-group"><label className="form-label">World Name</label><input value={editState.world_name} onChange={set('world_name')} placeholder="e.g. The Forgotten Realms" /></div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">In-World Date</label><input value={editState.in_world_date} onChange={set('in_world_date')} placeholder="e.g. 15th of Mirtul, 1492 DR" /></div>
          <div className="form-group"><label className="form-label">Time</label><input value={editState.in_world_time} onChange={set('in_world_time')} placeholder="e.g. Dusk" /></div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Season</label>
            <select value={editState.season} onChange={set('season')}>
              {SEASONS.map(s => <option key={s} value={s}>{s || '— unset —'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Weather</label>
            <select value={editState.weather} onChange={set('weather')}>
              {WEATHER_OPTIONS.map(w => <option key={w} value={w}>{w || '— unset —'}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group"><label className="form-label">Campaign Notes</label><textarea value={editState.notes} onChange={set('notes')} rows={5} placeholder="General campaign notes (supports **bold**, - lists)" /></div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button className="btn btn-sm" onClick={cancel} disabled={saving}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* World name */}
      <div>
        <div className="section-label">World</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{campaign.world_name || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>Unnamed World</span>}</div>
      </div>

      {/* Date / Time */}
      <div className="campaign-info-grid">
        {campaign.in_world_date && (
          <div className="campaign-field">
            <div className="campaign-label">📅 Date</div>
            <div className="campaign-value">{campaign.in_world_date}</div>
          </div>
        )}
        {campaign.in_world_time && (
          <div className="campaign-field">
            <div className="campaign-label">🕐 Time</div>
            <div className="campaign-value">{campaign.in_world_time}</div>
          </div>
        )}
        {campaign.season && (
          <div className="campaign-field">
            <div className="campaign-label">🍂 Season</div>
            <div className="campaign-value">{campaign.season}</div>
          </div>
        )}
        {campaign.weather && (
          <div className="campaign-field">
            <div className="campaign-label">🌤 Weather</div>
            <div className="campaign-value">{campaign.weather}</div>
          </div>
        )}
      </div>

      {/* Notes */}
      {campaign.notes && (
        <div>
          <div className="section-label">Campaign Notes</div>
          <MarkdownText>{campaign.notes}</MarkdownText>
        </div>
      )}

      {!campaign.in_world_date && !campaign.weather && !campaign.season && !campaign.notes && (
        <div style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>No campaign details set yet.</div>
      )}

      {isDMMode && (
        <button className="btn btn-sm" onClick={startEdit} style={{ alignSelf: 'flex-start', marginTop: 4 }}>✏ Edit Campaign Info</button>
      )}
    </div>
  );
}
