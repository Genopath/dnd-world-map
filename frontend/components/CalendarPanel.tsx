import React, { useState } from 'react';
import type { CalendarConfig, CampaignSettings } from '../types';
import MarkdownText from './MarkdownText';

interface MonthDef { name: string; days: number; }

function parseMonths(raw: string): MonthDef[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through */ }
  // Default: 12 generic months × 30 days
  return Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 }));
}

function parseWeekdays(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch { /* fall through */ }
  return [];
}

const WEATHER_OPTIONS = ['Clear', 'Cloudy', 'Rainy', 'Stormy', 'Foggy', 'Snowing', 'Blizzard', 'Scorching', ''];
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter', ''];

interface Props {
  campaign:        CampaignSettings | null;
  calendarConfig:  CalendarConfig | null;
  isDMMode:        boolean;
  onUpdateCampaign:  (data: Partial<Omit<CampaignSettings, 'id'>>) => Promise<void>;
  onUpdateCalendar:  (data: Partial<Omit<CalendarConfig, 'id'>>) => Promise<void>;
}

export default function CalendarPanel({ campaign, calendarConfig, isDMMode, onUpdateCampaign, onUpdateCalendar }: Props) {
  const [editingInfo,   setEditingInfo]   = useState(false);
  const [editingCal,    setEditingCal]    = useState(false);
  const [saving,        setSaving]        = useState(false);

  // Info edit state
  const [infoState, setInfoState] = useState({ world_name: '', in_world_time: '', weather: '', season: '', notes: '' });
  // Calendar config edit state
  const [calState, setCalState] = useState({ months: '', weekdays: '', year_name: '' });

  const months   = calendarConfig ? parseMonths(calendarConfig.months)   : parseMonths('[]');
  const weekdays = calendarConfig ? parseWeekdays(calendarConfig.weekdays) : [];
  const yearName = calendarConfig?.year_name || '';

  const currentMonth  = Math.max(1, Math.min(months.length, campaign?.cal_month ?? 1));
  const currentDay    = Math.max(1, Math.min(months[currentMonth - 1]?.days ?? 30, campaign?.cal_day ?? 1));
  const currentYear   = campaign?.cal_year ?? 1;
  const currentMonthDef = months[currentMonth - 1] ?? { name: 'Unknown', days: 30 };
  const cols = weekdays.length > 0 ? weekdays.length : 7;

  // Navigate date
  const setDate = async (day: number, month: number, year: number) => {
    const m = Math.max(1, Math.min(months.length, month));
    const maxDay = months[m - 1]?.days ?? 30;
    const d = Math.max(1, Math.min(maxDay, day));
    await onUpdateCampaign({ cal_day: d, cal_month: m, cal_year: year });
  };

  const prevDay = () => {
    let d = currentDay - 1, m = currentMonth, y = currentYear;
    if (d < 1) {
      m -= 1;
      if (m < 1) { m = months.length; y -= 1; }
      d = months[m - 1]?.days ?? 30;
    }
    setDate(d, m, y);
  };

  const nextDay = () => {
    let d = currentDay + 1, m = currentMonth, y = currentYear;
    const maxDay = months[m - 1]?.days ?? 30;
    if (d > maxDay) {
      d = 1; m += 1;
      if (m > months.length) { m = 1; y += 1; }
    }
    setDate(d, m, y);
  };

  const prevMonth = () => {
    let m = currentMonth - 1, y = currentYear;
    if (m < 1) { m = months.length; y -= 1; }
    setDate(Math.min(currentDay, months[m - 1]?.days ?? 30), m, y);
  };

  const nextMonth = () => {
    let m = currentMonth + 1, y = currentYear;
    if (m > months.length) { m = 1; y += 1; }
    setDate(Math.min(currentDay, months[m - 1]?.days ?? 30), m, y);
  };

  const startEditInfo = () => {
    setInfoState({
      world_name:    campaign?.world_name    ?? '',
      in_world_time: campaign?.in_world_time ?? '',
      weather:       campaign?.weather       ?? '',
      season:        campaign?.season        ?? '',
      notes:         campaign?.notes         ?? '',
    });
    setEditingInfo(true);
  };

  const saveInfo = async () => {
    setSaving(true);
    try { await onUpdateCampaign(infoState); setEditingInfo(false); }
    finally { setSaving(false); }
  };

  const startEditCal = () => {
    setCalState({
      months:    calendarConfig?.months    ?? '[]',
      weekdays:  calendarConfig?.weekdays  ?? '[]',
      year_name: calendarConfig?.year_name ?? '',
    });
    setEditingCal(true);
  };

  const saveCal = async () => {
    setSaving(true);
    try { await onUpdateCalendar(calState); setEditingCal(false); }
    finally { setSaving(false); }
  };

  if (!campaign) {
    return <div className="no-sel"><div>Loading campaign data…</div></div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── World info section ─────────────────────────────────────── */}
      <div>
        {editingInfo ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-group"><label className="form-label">World Name</label>
              <input value={infoState.world_name} onChange={e => setInfoState(s => ({ ...s, world_name: e.target.value }))} placeholder="e.g. The Forgotten Realms" />
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Time of Day</label>
                <input value={infoState.in_world_time} onChange={e => setInfoState(s => ({ ...s, in_world_time: e.target.value }))} placeholder="e.g. Evening" />
              </div>
              <div className="form-group"><label className="form-label">Season</label>
                <select value={infoState.season} onChange={e => setInfoState(s => ({ ...s, season: e.target.value }))}>
                  {SEASONS.map(x => <option key={x} value={x}>{x || '— unset —'}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Weather</label>
              <select value={infoState.weather} onChange={e => setInfoState(s => ({ ...s, weather: e.target.value }))}>
                {WEATHER_OPTIONS.map(x => <option key={x} value={x}>{x || '— unset —'}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Campaign Notes</label>
              <textarea value={infoState.notes} onChange={e => setInfoState(s => ({ ...s, notes: e.target.value }))} rows={4} placeholder="General notes (supports **bold**, - lists)" />
            </div>
            <div className="form-actions">
              <button className="btn btn-primary btn-sm" onClick={saveInfo} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn btn-sm" onClick={() => setEditingInfo(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
                {campaign.world_name || <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 14 }}>Unnamed World</span>}
              </div>
              {isDMMode && <button className="btn btn-sm btn-ghost" onClick={startEditInfo}>✏ Edit</button>}
            </div>
            <div className="campaign-info-grid">
              {campaign.in_world_time && <div className="campaign-field"><div className="campaign-label">🕐 Time</div><div className="campaign-value">{campaign.in_world_time}</div></div>}
              {campaign.season        && <div className="campaign-field"><div className="campaign-label">🍂 Season</div><div className="campaign-value">{campaign.season}</div></div>}
              {campaign.weather       && <div className="campaign-field"><div className="campaign-label">🌤 Weather</div><div className="campaign-value">{campaign.weather}</div></div>}
            </div>
            {campaign.notes && <div><div className="section-label">Notes</div><MarkdownText>{campaign.notes}</MarkdownText></div>}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        {/* ── Calendar section ──────────────────────────────────────── */}

        {/* Month/Year header */}
        <div className="calendar-header">
          <button className="btn btn-sm btn-ghost btn-icon" onClick={prevMonth} title="Previous month">◀</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{currentMonthDef.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Year {currentYear}{yearName ? ` ${yearName}` : ''}</div>
          </div>
          <button className="btn btn-sm btn-ghost btn-icon" onClick={nextMonth} title="Next month">▶</button>
        </div>

        {/* Weekday headers */}
        {weekdays.length > 0 && (
          <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, marginBottom: 4 }}>
            {weekdays.map(wd => (
              <div key={wd} className="calendar-weekday">{wd.slice(0, 3)}</div>
            ))}
          </div>
        )}

        {/* Day grid */}
        <div className="calendar-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: currentMonthDef.days }, (_, i) => {
            const day = i + 1;
            const isToday = day === currentDay && currentMonth === campaign.cal_month && currentYear === campaign.cal_year;
            return (
              <div
                key={day}
                className={`calendar-day${isToday ? ' today' : ''}`}
                onClick={isDMMode ? () => setDate(day, currentMonth, currentYear) : undefined}
                style={{ cursor: isDMMode ? 'pointer' : 'default' }}
                title={isDMMode ? `Set to day ${day}` : undefined}
              >
                {day}
              </div>
            );
          })}
        </div>

        {/* Current date + day navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          {isDMMode
            ? <button className="btn btn-sm btn-ghost" onClick={prevDay} title="Previous day">← Day</button>
            : <div />}
          <div style={{ textAlign: 'center', fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: 'var(--accent)' }}>Day {currentDay}, {currentMonthDef.name}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Year {currentYear}{yearName ? ` ${yearName}` : ''}</div>
          </div>
          {isDMMode
            ? <button className="btn btn-sm btn-ghost" onClick={nextDay} title="Next day">Day →</button>
            : <div />}
        </div>

        {/* DM: year controls */}
        {isDMMode && (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 6 }}>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setDate(currentDay, currentMonth, currentYear - 1)} title="Previous year">◀◀</button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Year</span>
            <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setDate(currentDay, currentMonth, currentYear + 1)} title="Next year">▶▶</button>
          </div>
        )}
      </div>

      {/* ── Calendar config (DM only) ─────────────────────────────── */}
      {isDMMode && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {editingCal ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Configure Calendar</div>
              <div className="form-group">
                <label className="form-label">Year Suffix (e.g. "DR")</label>
                <input value={calState.year_name} onChange={e => setCalState(s => ({ ...s, year_name: e.target.value }))} placeholder="DR, AH, etc." />
              </div>
              <div className="form-group">
                <label className="form-label">Months (JSON)</label>
                <textarea value={calState.months} onChange={e => setCalState(s => ({ ...s, months: e.target.value }))} rows={5}
                  placeholder='[{"name":"Deepwinter","days":30},...]' style={{ fontFamily: 'monospace', fontSize: 11 }} />
                <span className="form-hint">Array of {'{'}name, days{'}'} objects</span>
              </div>
              <div className="form-group">
                <label className="form-label">Weekday Names (JSON)</label>
                <textarea value={calState.weekdays} onChange={e => setCalState(s => ({ ...s, weekdays: e.target.value }))} rows={2}
                  placeholder='["Sunday","Monday",...]' style={{ fontFamily: 'monospace', fontSize: 11 }} />
                <span className="form-hint">Leave empty to hide weekday headers</span>
              </div>
              <div className="form-actions">
                <button className="btn btn-primary btn-sm" onClick={saveCal} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button className="btn btn-sm" onClick={() => setEditingCal(false)} disabled={saving}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={startEditCal} style={{ fontSize: 11 }}>⚙ Configure Calendar</button>
          )}
        </div>
      )}
    </div>
  );
}
