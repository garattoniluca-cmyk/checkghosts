import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale, Filler,
  Tooltip as ChartTooltip,
} from 'chart.js';
import './Dashboard.css';

ChartJS.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, ChartTooltip);

// ── Date utilities ─────────────────────────────────────────────────────
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function daysInRange(from, to) {
  const days = [];
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) { days.push(toDateStr(cur)); cur.setDate(cur.getDate() + 1); }
  return days;
}

// ── Mini line chart ────────────────────────────────────────────────────
function MiniLineChart({ labels, data }) {
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
      type: 'line',
      data: { labels, datasets: [{ data, borderColor: '#F5C518', backgroundColor: 'rgba(245,197,24,0.09)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false, callbacks: { label: item => ` ${item.raw} registrations` } } },
        scales: {
          x: { ticks: { color: '#444', font: { size: 9 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: '#181818' } },
          y: { ticks: { color: '#444', font: { size: 9 } }, grid: { color: '#181818' }, beginAtZero: true },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, data]);

  return <div ref={containerRef} style={{ height: 110 }} />;
}

// ── Card components ────────────────────────────────────────────────────
function Card({ icon, title, desc, active, onClick }) {
  return (
    <div className={`db-card ${active ? 'active' : 'disabled'}`} onClick={active ? onClick : undefined}>
      <div className="db-card-icon">{icon}</div>
      <div className="db-card-title">{title}</div>
      {desc && <div className="db-card-desc">{desc}</div>}
      {active && <div className="db-card-arrow">Open →</div>}
    </div>
  );
}

function SubCard({ icon, title, desc, active, onClick }) {
  return (
    <div className={`db-subcard ${active ? 'active' : 'disabled'}`} onClick={active ? onClick : undefined}>
      <div className="db-subcard-icon">{icon}</div>
      <div className="db-subcard-title">{title}</div>
      {desc && <div className="db-subcard-desc">{desc}</div>}
      {active && <div className="db-subcard-arrow">Open →</div>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
export default function Dashboard() {
  const go = (hash) => { window.location.hash = hash; };

  // ── Driver data ──────────────────────────────────────────────────────
  const [drivers, setDrivers]   = useState([]);
  const [loading, setLoading]   = useState(false);

  const fetchDrivers = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/stats/drivers');
      const data = await res.json();
      if (data.success) setDrivers(data.drivers);
    } catch (err) {
      console.error('Failed to load drivers:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDrivers(); }, [fetchDrivers]);

  // ── Registration chart: last 30 days ─────────────────────────────────
  const regChart = useMemo(() => {
    const to   = toDateStr(new Date());
    const from = toDateStr(new Date(Date.now() - 29 * 86400000));
    const periods = daysInRange(from, to);
    const map = {};
    for (const d of drivers) {
      if (!d.creationDate) continue;
      const dt = new Date(d.creationDate);
      const key = toDateStr(dt);
      if (map[key] !== undefined || periods.includes(key)) map[key] = (map[key] || 0) + 1;
    }
    return {
      labels: periods.map(fmtDate),
      data:   periods.map(p => map[p] || 0),
    };
  }, [drivers]);

  // ── Active players ────────────────────────────────────────────────────
  const activeData = useMemo(() => {
    if (!drivers.length) return { total: 0, d1: 0, d2: 0, d3: 0, d7: 0 };
    const now   = Date.now();
    const total = drivers.length;
    const countActive = days => drivers.filter(d => {
      if (!d.lastLoginDateTime) return false;
      return (now - new Date(d.lastLoginDateTime).getTime()) <= days * 86400000;
    }).length;
    return { total, d1: countActive(1), d2: countActive(2), d3: countActive(3), d7: countActive(7) };
  }, [drivers]);

  const pct = (n) => activeData.total > 0 ? ((n / activeData.total) * 100).toFixed(1) : '0.0';

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="db-root">

      {/* Header */}
      <header className="db-header">
        <div className="db-logo">
          <span className="db-logo-icon">🏎</span>
          <span className="db-logo-text">Race<span>Club</span> Intelligence</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={fetchDrivers}
            disabled={loading}
            style={{
              background: 'none',
              border: `1px solid ${loading ? '#222' : '#F5C51860'}`,
              color: loading ? '#444' : '#F5C518',
              fontSize: '0.72rem',
              padding: '0.25rem 0.6rem',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              letterSpacing: '0.04em',
              opacity: loading ? 0.5 : 1,
              transition: 'border-color 0.2s, color 0.2s',
            }}
          >
            {loading ? '…' : '⟳ Reload'}
          </button>
          <div className="db-badge">Alpha</div>
        </div>
      </header>

      <main className="db-main">

        {/* AI + Live Stats */}
        <div className="db-section-label">Artificial Intelligence</div>
        <div className="db-ai-row">

          {/* AI card */}
          <Card icon="🤖" title="RaceClub AI" desc="AI assistant for advanced analysis, driving tips and race predictions." active={false} />

          {/* Live platform snapshot */}
          <div className="db-live-panel">
            <div className="db-live-top">

              {/* Player count */}
              <div className="db-live-players">
                <div className="db-live-count">{loading && !drivers.length ? '…' : drivers.length.toLocaleString('en-US')}</div>
                <div className="db-live-count-label">Players</div>
              </div>

              {/* Divider */}
              <div className="db-live-divider" />

              {/* Active metrics */}
              <div className="db-active-grid">
                {[
                  { label: '24h',     count: activeData.d1 },
                  { label: '2 days',  count: activeData.d2 },
                  { label: '3 days',  count: activeData.d3 },
                  { label: '7 days',  count: activeData.d7 },
                ].map(({ label, count }) => (
                  <div key={label} className="db-active-card">
                    <div className="db-active-pct">{pct(count)}%</div>
                    <div className="db-active-abs">{count.toLocaleString('en-US')}</div>
                    <div className="db-active-label">Last {label}</div>
                    <div className="db-active-bar">
                      <div className="db-active-bar-fill" style={{ width: `${pct(count)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Registration chart */}
            <div className="db-reg-chart">
              <div className="db-reg-chart-title">New Registrations — last 30 days</div>
              {drivers.length > 0
                ? <MiniLineChart labels={regChart.labels} data={regChart.data} />
                : <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '0.8rem' }}>{loading ? 'Loading…' : 'No data'}</div>
              }
            </div>
          </div>
        </div>

        {/* Statistiche */}
        <div className="db-section-label">Statistiche</div>
        <div className="db-grid">
          <Card icon="📊" title="General Statistics" desc="Global overview of all data collected by the platform." active={true} onClick={() => go('/stats')} />
          <Card icon="🧠" title="Behavioral Statistics" desc="Analysis of driving patterns, recurring errors and progression over time." active={true} onClick={() => go('/behavioral')} />
          <Card icon="🔍" title="Single User Deep Analysis" desc="In-depth analysis of a single driver across all sessions." active={false} />
        </div>

        {/* Game Modes */}
        <div className="db-section-label">Game Modes Stats</div>
        <div className="db-gamemodes">
          <div className="db-gamemodes-title"><span>🎮</span> Game Modes</div>
          <div className="db-gamemodes-grid">
            <SubCard icon="🏎" title="Hotlap" desc="Fast lap analysis, rankings and ghost comparison for each track/class combination." active={true} onClick={() => go('/hotlap')} />
            <SubCard icon="⚔️" title="Duel" desc="Statistics and comparisons for 1v1 duel sessions." active={true} onClick={() => go('/duel')} />
            <SubCard icon="🏁" title="Races" desc="Results, lap times and analysis of multi-driver races." active={false} />
          </div>
        </div>

        {/* Live */}
        <div className="db-section-label">Live</div>
        <div className="db-grid">
          <Card icon="📡" title="Live Dashboard" desc="Real-time monitoring of active sessions, live rankings and instant updates." active={false} />
        </div>

        {/* Ecosystem */}
        <div className="db-section-label">Ecosystem</div>
        <div className="db-grid">
          <Card icon="📱" title="User Mobile APP" desc="Mobile app to follow real-time statistics from the paddock." active={false} />
        </div>

      </main>

      <footer className="db-footer">
        RaceClub Intelligence · All rights reserved
      </footer>

    </div>
  );
}
