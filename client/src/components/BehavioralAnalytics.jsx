import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Filler,
  Tooltip as ChartTooltip,
} from 'chart.js';

ChartJS.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, ChartTooltip);

// ── Constants ──────────────────────────────────────────────────────────
const ACCENT   = '#F5C518';
const MAGENTA  = '#E91E63';
const CYAN     = '#00BCD4';
const GREEN    = '#8BC34A';
const PAGE_SIZE = 20;

// ── Formatters ─────────────────────────────────────────────────────────
function fmtN(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function fmtDurationFull(seconds) {
  const s = Math.round(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h > 0 ? `${h}h` : null, `${String(m).padStart(2, '0')}m`, `${String(sec).padStart(2, '0')}s`]
    .filter(Boolean).join(' ');
}

// ── Pagination ─────────────────────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="dl-pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Prev</button>
      <span className="dl-pag-info">Page {page} / {totalPages}<span className="dl-pag-total"> ({total} total)</span></span>
      <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next →</button>
    </div>
  );
}

// ── Bar Chart ──────────────────────────────────────────────────────────
function BarChart({ labels, datasets, height = 220 }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    container.innerHTML = '';
    container.appendChild(canvas);
    chartRef.current = new ChartJS(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { display: datasets.length > 1, labels: { color: '#888', font: { size: 11 } } },
          tooltip: { callbacks: { label: (item) => ` ${item.dataset.label || ''}: ${item.raw}` } },
        },
        scales: {
          x: { ticks: { color: '#666', font: { size: 10 }, maxRotation: 45, maxTicksLimit: 20 }, grid: { color: '#1e1e1e' } },
          y: { ticks: { color: '#666', font: { size: 11 } }, grid: { color: '#1e1e1e' }, beginAtZero: true },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, datasets, height]);

  return <div ref={containerRef} style={{ height }} />;
}

// ── Horizontal bar row ─────────────────────────────────────────────────
function HBar({ label, value, maxValue, display, color = ACCENT }) {
  const pct = maxValue > 0 ? ((value / maxValue) * 100).toFixed(1) : 0;
  return (
    <div className="gs-hbar-row">
      <span className="gs-hbar-label" style={{ minWidth: 160 }}>{label}</span>
      <div className="gs-hbar-track">
        <div className="gs-hbar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="gs-hbar-value">{display ?? value}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
export default function BehavioralAnalytics({ sessions = [], loading, onReload }) {

  // ── Search state ─────────────────────────────────────────────────────
  const [search, setSearch]         = useState('');
  const [sortKey, setSortKey]       = useState('totalSec');
  const [sortDir, setSortDir]       = useState(-1);
  const [tablePage, setTablePage]   = useState(1);

  // ── Normalize rows ───────────────────────────────────────────────────
  const rows = useMemo(() =>
    sessions.map(s => ({
      idDriver:   Number(s.idDriver),
      nickname:   s.nickname || `Driver #${s.idDriver}`,
      sessions:   Number(s.NumSessioni) || 0,
      totalSec:   Number(s.TempoTotalegioco) || 0,
      avgSec:     Number(s.SessioneMedia)    || 0,
      maxSec:     Number(s.SessioneMaxLunga) || 0,
      lastLogin:  s.LastLogin ? new Date(s.LastLogin) : null,
    })),
    [sessions]
  );

  // ── Global KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!rows.length) return {};
    const totalSessions  = rows.reduce((s, r) => s + r.sessions, 0);
    const totalSec       = rows.reduce((s, r) => s + r.totalSec, 0);
    const avgSession     = totalSessions > 0 ? totalSec / totalSessions : 0;
    const topByTime      = [...rows].sort((a, b) => b.totalSec - a.totalSec)[0];
    const topBySessions  = [...rows].sort((a, b) => b.sessions - a.sessions)[0];
    const topByMax       = [...rows].sort((a, b) => b.maxSec - a.maxSec)[0];
    return { totalSessions, totalSec, avgSession, topByTime, topBySessions, topByMax, drivers: rows.length };
  }, [rows]);

  // ── Section 1: Top 20 by total time ──────────────────────────────────
  const top20Time = useMemo(() =>
    [...rows].sort((a, b) => b.totalSec - a.totalSec).slice(0, 20),
    [rows]
  );

  // ── Section 2: Top 20 by session count ───────────────────────────────
  const top20Sessions = useMemo(() =>
    [...rows].sort((a, b) => b.sessions - a.sessions).slice(0, 20),
    [rows]
  );

  // ── Section 3: Avg session duration distribution ─────────────────────
  const buckets = useMemo(() => {
    const defs = [
      { label: '< 2 min',    min: 0,    max: 120   },
      { label: '2–5 min',    min: 120,  max: 300   },
      { label: '5–10 min',   min: 300,  max: 600   },
      { label: '10–20 min',  min: 600,  max: 1200  },
      { label: '20–30 min',  min: 1200, max: 1800  },
      { label: '30–60 min',  min: 1800, max: 3600  },
      { label: '> 60 min',   min: 3600, max: Infinity },
    ];
    return defs.map(b => ({
      ...b,
      count: rows.filter(r => r.avgSec >= b.min && r.avgSec < b.max).length,
    }));
  }, [rows]);

  // ── Section 4: Longest single session top 20 ─────────────────────────
  const top20MaxSession = useMemo(() =>
    [...rows].sort((a, b) => b.maxSec - a.maxSec).slice(0, 20),
    [rows]
  );

  // ── Section 5: Full searchable table ─────────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const r = q ? rows.filter(x => x.nickname.toLowerCase().includes(q)) : rows;
    return [...r].sort((a, b) => sortDir * (Number(b[sortKey]) - Number(a[sortKey])));
  }, [rows, search, sortKey, sortDir]);

  const tableSlice = useMemo(() =>
    filteredRows.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE),
    [filteredRows, tablePage]
  );

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
    setTablePage(1);
  }

  function sortArrow(key) {
    if (sortKey !== key) return null;
    return <span style={{ color: ACCENT, marginLeft: 4 }}>{sortDir === -1 ? '↓' : '↑'}</span>;
  }

  // ── RENDER ───────────────────────────────────────────────────────────
  if (loading && !rows.length) {
    return (
      <div className="gs-section">
        <div className="gs-inner">
          <header className="app-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
                onClick={() => { window.location.hash = ''; }}>← Home</button>
              <h1>🧠 BEHAVIORAL STATISTICS <span>Session Analyzer</span></h1>
            </div>
          </header>
          <div className="global-stats-bar" style={{ justifyContent: 'center', color: '#666' }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!rows.length) return null;

  const maxTime     = top20Time[0]?.totalSec     || 1;
  const maxSessions = top20Sessions[0]?.sessions || 1;
  const maxBucket   = Math.max(...buckets.map(b => b.count), 1);
  const maxMaxSec   = top20MaxSession[0]?.maxSec || 1;

  return (
    <div className="gs-section">
      <div className="gs-inner">

        {/* ── Header ────────────────────────────────────────── */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
              onClick={() => { window.location.hash = ''; }} title="Back to Dashboard">← Home</button>
            <h1>🧠 BEHAVIORAL STATISTICS <span>Session Analyzer</span></h1>
          </div>
          <button className="btn btn-primary" onClick={onReload} disabled={loading}>
            {loading ? 'Loading…' : '⟳ Reload'}
          </button>
        </header>

        {/* ── KPI bar ───────────────────────────────────────── */}
        <div className="global-stats-bar">
          <div className="global-stat">
            <span className="global-stat-value">{fmtN(kpis.drivers)}</span>
            <span className="global-stat-label">Drivers</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{fmtN(kpis.totalSessions)}</span>
            <span className="global-stat-label">Total Sessions</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{fmtDuration(kpis.totalSec)}</span>
            <span className="global-stat-label">Total Play Time</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{fmtDuration(kpis.avgSession)}</span>
            <span className="global-stat-label">Avg Session</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value" style={{ fontSize: '0.95rem' }}>{kpis.topByTime?.nickname}</span>
            <span className="global-stat-label">Most Time</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value" style={{ fontSize: '0.95rem' }}>{kpis.topBySessions?.nickname}</span>
            <span className="global-stat-label">Most Sessions</span>
          </div>
        </div>

        {/* ═══ Section 1: Top 20 by Total Time ═══ */}
        <details className="overview-section dl-section" open>
          <summary className="overview-summary">Top 20 Drivers by Total Play Time</summary>
          <div className="overview-content">
            <p className="dl-chart-note" style={{ marginBottom: '0.5rem' }}>Hours spent in-game per driver (top 20)</p>
            <BarChart height={240}
              labels={top20Time.map(r => r.nickname.split(' ')[0])}
              datasets={[{
                label: 'Total Time (s)',
                data: top20Time.map(r => r.totalSec),
                backgroundColor: ACCENT,
                borderRadius: 4,
              }]}
            />
            <div style={{ marginTop: '1rem' }}>
              {top20Time.map((r, i) => (
                <HBar key={r.idDriver} label={`${i + 1}. ${r.nickname}`}
                  value={r.totalSec} maxValue={maxTime}
                  display={fmtDurationFull(r.totalSec)} />
              ))}
            </div>
          </div>
        </details>

        {/* ═══ Section 2: Top 20 by Session Count ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">Top 20 Drivers by Session Count</summary>
          <div className="overview-content">
            <p className="dl-chart-note" style={{ marginBottom: '0.5rem' }}>Number of game sessions opened per driver (top 20)</p>
            <BarChart height={240}
              labels={top20Sessions.map(r => r.nickname.split(' ')[0])}
              datasets={[{
                label: 'Sessions',
                data: top20Sessions.map(r => r.sessions),
                backgroundColor: MAGENTA,
                borderRadius: 4,
              }]}
            />
            <div style={{ marginTop: '1rem' }}>
              {top20Sessions.map((r, i) => (
                <HBar key={r.idDriver} label={`${i + 1}. ${r.nickname}`}
                  value={r.sessions} maxValue={maxSessions}
                  display={`${fmtN(r.sessions)} sessions`}
                  color={MAGENTA} />
              ))}
            </div>
          </div>
        </details>

        {/* ═══ Section 3: Avg Session Duration Distribution ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">Avg Session Duration — Player Distribution</summary>
          <div className="overview-content">
            <p className="dl-chart-note" style={{ marginBottom: '0.5rem' }}>How many drivers fall in each avg-session-length bucket</p>
            <BarChart height={220}
              labels={buckets.map(b => b.label)}
              datasets={[{
                label: 'Drivers',
                data: buckets.map(b => b.count),
                backgroundColor: buckets.map((_, i) => [ACCENT, MAGENTA, CYAN, GREEN, ACCENT, MAGENTA, CYAN][i]),
                borderRadius: 4,
              }]}
            />
            <div style={{ marginTop: '1rem' }}>
              {buckets.map(b => (
                <HBar key={b.label} label={b.label}
                  value={b.count} maxValue={maxBucket}
                  display={`${fmtN(b.count)} drivers (${rows.length > 0 ? ((b.count / rows.length) * 100).toFixed(1) : 0}%)`}
                  color={CYAN} />
              ))}
            </div>
          </div>
        </details>

        {/* ═══ Section 4: Longest Single Sessions ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">Longest Single Session Records — Top 20</summary>
          <div className="overview-content">
            <p className="dl-chart-note" style={{ marginBottom: '0.5rem' }}>Drivers with the longest single session ever recorded</p>
            <div style={{ marginTop: '0.5rem' }}>
              {top20MaxSession.map((r, i) => (
                <HBar key={r.idDriver} label={`${i + 1}. ${r.nickname}`}
                  value={r.maxSec} maxValue={maxMaxSec}
                  display={fmtDurationFull(r.maxSec)}
                  color={GREEN} />
              ))}
            </div>
          </div>
        </details>

        {/* ═══ Section 5: Full Driver Table ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">All Drivers — Full Session Stats ({fmtN(rows.length)} drivers)</summary>
          <div className="overview-content">
            <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="text"
                placeholder="Search driver…"
                value={search}
                onChange={e => { setSearch(e.target.value); setTablePage(1); }}
                style={{
                  background: '#111', border: '1px solid #333', color: '#ccc',
                  padding: '0.35rem 0.7rem', borderRadius: 4, fontSize: '0.85rem', width: 220,
                }}
              />
              {search && (
                <span className="dl-chart-note">{filteredRows.length} result{filteredRows.length !== 1 ? 's' : ''}</span>
              )}
            </div>
            <table className="dl-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>#</th>
                  <th>Driver</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('sessions')}>Sessions {sortArrow('sessions')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('totalSec')}>Total Time {sortArrow('totalSec')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('avgSec')}>Avg Session {sortArrow('avgSec')}</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('maxSec')}>Max Session {sortArrow('maxSec')}</th>
                  <th>Last Login</th>
                </tr>
              </thead>
              <tbody>
                {tableSlice.map((r, i) => (
                  <tr key={r.idDriver}>
                    <td className="dl-rank">{(tablePage - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="dl-player">{r.nickname}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(r.sessions)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', color: ACCENT }}>{fmtDurationFull(r.totalSec)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(r.avgSec)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', color: GREEN }}>{fmtDurationFull(r.maxSec)}</td>
                    <td style={{ fontSize: '0.78rem', color: '#666' }}>
                      {r.lastLogin ? r.lastLogin.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={tablePage} total={filteredRows.length} pageSize={PAGE_SIZE} onChange={setTablePage} />
          </div>
        </details>

      </div>
    </div>
  );
}
