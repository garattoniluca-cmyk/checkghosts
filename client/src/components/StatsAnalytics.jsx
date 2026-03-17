import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';

ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, ChartTooltip);

// ── Constants ─────────────────────────────────────────────────────────
const PAGE_SIZE = 25;

// ── Color helpers ─────────────────────────────────────────────────────
const MODE_COLORS = ['#F5C518', '#E91E63', '#00BCD4', '#8BC34A'];
const CLASS_COLORS = ['#F5C518', '#E91E63', '#00BCD4', '#8BC34A'];

function heatColor(ratio) {
  if (ratio >= 0.75) return { bg: 'rgba(245,197,24,0.22)', fg: '#F5C518' };
  if (ratio >= 0.50) return { bg: 'rgba(245,197,24,0.14)', fg: '#c9a000' };
  if (ratio >= 0.25) return { bg: 'rgba(245,197,24,0.08)', fg: '#8a6e00' };
  return { bg: 'rgba(80,80,80,0.08)', fg: '#555' };
}

function fmtN(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
function fmtKm(n) { return n == null ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

// ── Pagination ────────────────────────────────────────────────────────
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

// ── Chart component ───────────────────────────────────────────────────
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
          tooltip: {
            callbacks: {
              label: (item) => ` ${item.dataset.label || ''}: ${fmtN(item.raw)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#666', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#1e1e1e' } },
          y: { ticks: { color: '#666', font: { size: 11 }, callback: v => fmtN(v) }, grid: { color: '#1e1e1e' }, beginAtZero: true },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [labels, datasets, height]);

  return <div ref={containerRef} style={{ height }} />;
}

// ── Filter pills (class) ─────────────────────────────────────────────
function ClassFilter({ classes, value, onChange }) {
  return (
    <div className="dl-class-filter" style={{ display: 'inline-flex' }}>
      <button className={`dl-class-pill${value === '' ? ' active' : ''}`} onClick={() => onChange('')}>All</button>
      {classes.map(c => (
        <button key={c.id} className={`dl-class-pill${String(value) === String(c.id) ? ' active' : ''}`}
          onClick={() => onChange(String(c.id))}>{c.name}</button>
      ))}
    </div>
  );
}

// ── Filter pills (game mode) ─────────────────────────────────────────
function ModeFilter({ gameModes, value, onChange }) {
  return (
    <div className="dl-class-filter gs-mode-filter" style={{ display: 'inline-flex' }}>
      <button className={`gs-mode-pill${value === '' ? ' active' : ''}`} onClick={() => onChange('')}>All modes</button>
      {gameModes.map(g => (
        <button key={g.id} className={`gs-mode-pill${String(value) === String(g.id) ? ' active' : ''}`}
          onClick={() => onChange(String(g.id))}>{g.name}</button>
      ))}
    </div>
  );
}

// ── Horizontal bar row (CSS-based) ───────────────────────────────────
function HBar({ label, value, maxValue, unit = '' }) {
  const pct = maxValue > 0 ? ((value / maxValue) * 100).toFixed(1) : 0;
  return (
    <div className="gs-hbar-row">
      <span className="gs-hbar-label">{label}</span>
      <div className="gs-hbar-track">
        <div className="gs-hbar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="gs-hbar-value">{fmtN(value)}{unit ? ` ${unit}` : ''}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ── MAIN COMPONENT ───────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════
export default function StatsAnalytics({
  drivers = [], classes = [], tracks = [], gameModes = [], statsDetails = [],
  loading, onReload,
}) {
  // ── Filters ─────────────────────────────────────────────────────────
  const [filterModeId, setFilterModeId]     = useState('');
  const [filterClassId, setFilterClassId]   = useState('');
  const [filterTrackId, setFilterTrackId]   = useState('');

  // ── Top Drivers pages ───────────────────────────────────────────────
  const [globalPage, setGlobalPage]         = useState(1);
  const [perTrackId, setPerTrackId]         = useState('');
  const [perTrackPage, setPerTrackPage]     = useState(1);
  const [perModeId, setPerModeId]           = useState('');
  const [perModePage, setPerModePage]       = useState(1);

  // ── Driver search ───────────────────────────────────────────────────
  const [playerSearch, setPlayerSearch]     = useState('');

  // Reset helpers
  const resetGlobal = () => setGlobalPage(1);
  const handlePerTrack = (v) => { setPerTrackId(v); setPerTrackPage(1); };
  const handlePerMode  = (v) => { setPerModeId(v);  setPerModePage(1); };

  // ── Lookup maps ─────────────────────────────────────────────────────
  const driverMap   = useMemo(() => new Map(drivers.map(d => [Number(d.id), d])),    [drivers]);
  const classMap    = useMemo(() => new Map(classes.map(c => [Number(c.id), c])),     [classes]);
  const trackMap    = useMemo(() => new Map(tracks.map(t => [Number(t.id), t])),      [tracks]);
  const gameModeMap = useMemo(() => new Map(gameModes.map(g => [Number(g.id), g])),   [gameModes]);

  // ── Normalize rows ──────────────────────────────────────────────────
  const rows = useMemo(() =>
    statsDetails.map(r => ({
      ...r,
      idDriver:   Number(r.idDriver),
      idGameMode: Number(r.idGameMode),
      idTrack:    Number(r.idTrack),
      idClass:    Number(r.idClass),
      totalLaps:  Number(r.totalLaps)  || 0,
      totalKms:   Number(r.totalKms)   || 0,
    })),
    [statsDetails]
  );

  // ── Filtered rows (by mode + class + track) for global ranking ─────
  const filteredRows = useMemo(() => {
    let r = rows;
    if (filterModeId)  r = r.filter(x => String(x.idGameMode) === filterModeId);
    if (filterClassId) r = r.filter(x => String(x.idClass) === filterClassId);
    if (filterTrackId) r = r.filter(x => String(x.idTrack) === filterTrackId);
    return r;
  }, [rows, filterModeId, filterClassId, filterTrackId]);

  // ── Global stats ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!rows.length) return { totalLaps: 0, totalKms: 0, drivers: 0, modes: 0, combos: 0 };
    return {
      totalLaps: rows.reduce((s, r) => s + r.totalLaps, 0),
      totalKms:  rows.reduce((s, r) => s + r.totalKms, 0),
      drivers:   new Set(rows.map(r => r.idDriver)).size,
      modes:     new Set(rows.map(r => r.idGameMode)).size,
      combos:    new Set(rows.map(r => `${r.idTrack}-${r.idClass}`)).size,
    };
  }, [rows]);

  // ── Section 1: Activity by Game Mode ────────────────────────────────
  const modeStats = useMemo(() => {
    const map = {};
    for (const r of rows) {
      if (!map[r.idGameMode]) map[r.idGameMode] = { laps: 0, kms: 0, drivers: new Set(), tracks: new Set() };
      const e = map[r.idGameMode];
      e.laps += r.totalLaps; e.kms += r.totalKms;
      e.drivers.add(r.idDriver); e.tracks.add(r.idTrack);
    }
    return gameModes.map(g => {
      const e = map[Number(g.id)] || { laps: 0, kms: 0, drivers: new Set(), tracks: new Set() };
      return {
        id: Number(g.id), name: g.name,
        laps: e.laps, kms: e.kms,
        driverCount: e.drivers.size, trackCount: e.tracks.size,
        avgLapsPerDriver: e.drivers.size > 0 ? (e.laps / e.drivers.size).toFixed(0) : 0,
      };
    }).sort((a, b) => b.laps - a.laps);
  }, [rows, gameModes]);

  const modeLapsChart = useMemo(() => ({
    labels: modeStats.map(m => m.name),
    datasets: [{
      label: 'Total Laps',
      data: modeStats.map(m => m.laps),
      backgroundColor: modeStats.map((_, i) => MODE_COLORS[i % MODE_COLORS.length]),
      borderRadius: 4,
    }],
  }), [modeStats]);

  const modeKmsChart = useMemo(() => ({
    labels: modeStats.map(m => m.name),
    datasets: [{
      label: 'Total KMs',
      data: modeStats.map(m => m.kms),
      backgroundColor: modeStats.map((_, i) => MODE_COLORS[i % MODE_COLORS.length]),
      borderRadius: 4,
    }],
  }), [modeStats]);

  // ── Section 2: Activity by Track (filtered by mode+class) ──────────
  const [trackFilterMode, setTrackFilterMode]   = useState('');
  const [trackFilterClass, setTrackFilterClass] = useState('');

  const trackStats = useMemo(() => {
    let r = rows;
    if (trackFilterMode)  r = r.filter(x => String(x.idGameMode) === trackFilterMode);
    if (trackFilterClass) r = r.filter(x => String(x.idClass) === trackFilterClass);
    const map = {};
    for (const x of r) {
      if (!map[x.idTrack]) map[x.idTrack] = { laps: 0, kms: 0, drivers: new Set() };
      const e = map[x.idTrack]; e.laps += x.totalLaps; e.kms += x.totalKms; e.drivers.add(x.idDriver);
    }
    return tracks.map(t => {
      const e = map[Number(t.id)] || { laps: 0, kms: 0, drivers: new Set() };
      return {
        id: Number(t.id), name: t.name, trackKms: Number(t.trackKms) || 0,
        laps: e.laps, kms: e.kms, driverCount: e.drivers.size,
        avgLaps: e.drivers.size > 0 ? (e.laps / e.drivers.size).toFixed(0) : 0,
      };
    }).filter(t => t.laps > 0).sort((a, b) => b.laps - a.laps);
  }, [rows, tracks, trackFilterMode, trackFilterClass]);

  const trackMaxLaps = Math.max(1, ...trackStats.map(t => t.laps));

  // ── Section 3: Activity by Class (filtered by mode) ────────────────
  const [classFilterMode, setClassFilterMode] = useState('');

  const classStats = useMemo(() => {
    let r = rows;
    if (classFilterMode) r = r.filter(x => String(x.idGameMode) === classFilterMode);
    const map = {};
    for (const x of r) {
      if (!map[x.idClass]) map[x.idClass] = { laps: 0, kms: 0, drivers: new Set(), modes: new Set() };
      const e = map[x.idClass]; e.laps += x.totalLaps; e.kms += x.totalKms;
      e.drivers.add(x.idDriver); e.modes.add(x.idGameMode);
    }
    return classes.map(c => {
      const e = map[Number(c.id)] || { laps: 0, kms: 0, drivers: new Set(), modes: new Set() };
      return { id: Number(c.id), name: c.name, laps: e.laps, kms: e.kms, driverCount: e.drivers.size, modeCount: e.modes.size };
    }).filter(c => c.laps > 0).sort((a, b) => b.laps - a.laps);
  }, [rows, classes, classFilterMode]);

  const classChart = useMemo(() => ({
    labels: classStats.map(c => c.name),
    datasets: [{
      label: 'Total Laps',
      data: classStats.map(c => c.laps),
      backgroundColor: classStats.map((_, i) => CLASS_COLORS[i % CLASS_COLORS.length]),
      borderRadius: 4,
    }],
  }), [classStats]);

  // ── Section 4: Track × Class Heatmap (filtered by mode) ────────────
  const [heatmapMode, setHeatmapMode] = useState('');
  const heatmapData = useMemo(() => {
    let r = rows;
    if (heatmapMode) r = r.filter(x => String(x.idGameMode) === heatmapMode);
    const map = {};
    for (const x of r) {
      const key = `${x.idTrack}-${x.idClass}`;
      if (!map[key]) map[key] = { laps: 0, kms: 0, drivers: new Set() };
      const e = map[key]; e.laps += x.totalLaps; e.kms += x.totalKms; e.drivers.add(x.idDriver);
    }
    return map;
  }, [rows, heatmapMode]);

  const heatmapMax = useMemo(() =>
    Math.max(1, ...Object.values(heatmapData).map(c => c.laps)),
    [heatmapData]
  );

  const heatmapTracks  = useMemo(() => tracks.filter(t => rows.some(r => r.idTrack === Number(t.id))),  [tracks, rows]);
  const heatmapClasses = useMemo(() => classes.filter(c => rows.some(r => r.idClass === Number(c.id))), [classes, rows]);

  // ── Section 5: Top Drivers Global ───────────────────────────────────
  const globalRanking = useMemo(() => {
    const map = {};
    for (const r of filteredRows) {
      if (!map[r.idDriver]) map[r.idDriver] = { laps: 0, kms: 0, combos: 0, modes: new Set(), tracks: new Set() };
      const e = map[r.idDriver]; e.laps += r.totalLaps; e.kms += r.totalKms; e.combos++;
      e.modes.add(r.idGameMode); e.tracks.add(r.idTrack);
    }
    return Object.entries(map).map(([id, e]) => ({
      driverId: Number(id), driver: driverMap.get(Number(id)),
      laps: e.laps, kms: e.kms, combos: e.combos,
      modeCount: e.modes.size, trackCount: e.tracks.size,
    })).sort((a, b) => b.laps - a.laps);
  }, [filteredRows, driverMap]);

  const globalMaxLaps = globalRanking[0]?.laps || 1;
  const globalSlice   = globalRanking.slice((globalPage - 1) * PAGE_SIZE, globalPage * PAGE_SIZE);

  // ── Section 6: Top Drivers per Track ────────────────────────────────
  const [perTrackClassFilter, setPerTrackClassFilter] = useState('');
  const [perTrackModeFilter, setPerTrackModeFilter]   = useState('');

  const perTrackRanking = useMemo(() => {
    if (!perTrackId) return [];
    let r = rows.filter(x => String(x.idTrack) === perTrackId);
    if (perTrackClassFilter) r = r.filter(x => String(x.idClass) === perTrackClassFilter);
    if (perTrackModeFilter)  r = r.filter(x => String(x.idGameMode) === perTrackModeFilter);
    const map = {};
    for (const x of r) {
      if (!map[x.idDriver]) map[x.idDriver] = { laps: 0, kms: 0, classes: new Set() };
      const e = map[x.idDriver]; e.laps += x.totalLaps; e.kms += x.totalKms; e.classes.add(x.idClass);
    }
    return Object.entries(map).map(([id, e]) => ({
      driverId: Number(id), driver: driverMap.get(Number(id)),
      laps: e.laps, kms: e.kms, classCount: e.classes.size,
    })).sort((a, b) => b.laps - a.laps);
  }, [rows, perTrackId, perTrackClassFilter, perTrackModeFilter, driverMap]);

  const perTrackMaxLaps = perTrackRanking[0]?.laps || 1;
  const perTrackSlice   = perTrackRanking.slice((perTrackPage - 1) * PAGE_SIZE, perTrackPage * PAGE_SIZE);

  // ── Section 7: Top Drivers per Game Mode ────────────────────────────
  const [perModeClassFilter, setPerModeClassFilter] = useState('');
  const [perModeTrackFilter, setPerModeTrackFilter] = useState('');

  const perModeRanking = useMemo(() => {
    if (!perModeId) return [];
    let r = rows.filter(x => String(x.idGameMode) === perModeId);
    if (perModeClassFilter) r = r.filter(x => String(x.idClass) === perModeClassFilter);
    if (perModeTrackFilter) r = r.filter(x => String(x.idTrack) === perModeTrackFilter);
    const map = {};
    for (const x of r) {
      if (!map[x.idDriver]) map[x.idDriver] = { laps: 0, kms: 0, tracks: new Set(), classes: new Set() };
      const e = map[x.idDriver]; e.laps += x.totalLaps; e.kms += x.totalKms;
      e.tracks.add(x.idTrack); e.classes.add(x.idClass);
    }
    return Object.entries(map).map(([id, e]) => ({
      driverId: Number(id), driver: driverMap.get(Number(id)),
      laps: e.laps, kms: e.kms, trackCount: e.tracks.size, classCount: e.classes.size,
    })).sort((a, b) => b.laps - a.laps);
  }, [rows, perModeId, perModeClassFilter, perModeTrackFilter, driverMap]);

  const perModeMaxLaps = perModeRanking[0]?.laps || 1;
  const perModeSlice   = perModeRanking.slice((perModePage - 1) * PAGE_SIZE, perModePage * PAGE_SIZE);

  // ── Section 8: Driver search ────────────────────────────────────────
  const statsPlayerIds = useMemo(() =>
    [...new Set(rows.map(r => r.idDriver))].sort((a, b) => {
      const na = driverMap.get(a)?.nickname ?? '';
      const nb = driverMap.get(b)?.nickname ?? '';
      return na.localeCompare(nb);
    }),
    [rows, driverMap]
  );

  const resolvedPlayer = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return null;
    for (const pid of statsPlayerIds) {
      const d = driverMap.get(pid);
      if (d && d.nickname.toLowerCase() === q) return d;
    }
    return null;
  }, [playerSearch, statsPlayerIds, driverMap]);

  const playerRecords = useMemo(() => {
    if (!resolvedPlayer) return [];
    const pid = Number(resolvedPlayer.id);
    return rows
      .filter(r => r.idDriver === pid)
      .map(r => ({
        ...r,
        trackName: trackMap.get(r.idTrack)?.name || `Track #${r.idTrack}`,
        className: classMap.get(r.idClass)?.name || `Class #${r.idClass}`,
        modeName:  gameModeMap.get(r.idGameMode)?.name || `Mode #${r.idGameMode}`,
      }))
      .sort((a, b) => b.totalLaps - a.totalLaps);
  }, [resolvedPlayer, rows, trackMap, classMap, gameModeMap]);

  const playerTotals = useMemo(() => {
    if (!playerRecords.length) return null;
    return {
      laps:   playerRecords.reduce((s, r) => s + r.totalLaps, 0),
      kms:    playerRecords.reduce((s, r) => s + r.totalKms, 0),
      combos: playerRecords.length,
      modes:  new Set(playerRecords.map(r => r.idGameMode)).size,
      tracks: new Set(playerRecords.map(r => r.idTrack)).size,
    };
  }, [playerRecords]);

  // ── RENDER ──────────────────────────────────────────────────────────
  if (loading && !rows.length) {
    return (
      <div className="gs-section">
        <div className="gs-inner">
          <header className="app-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
                onClick={() => { window.location.hash = ''; }}>← Home</button>
              <h1>📊 GENERAL STATISTICS <span>Activity Analyzer</span></h1>
            </div>
          </header>
          <div className="global-stats-bar" style={{ justifyContent: 'center', color: '#666' }}>Loading statistics…</div>
        </div>
      </div>
    );
  }

  if (!rows.length) return null;

  return (
    <div className="gs-section">
      <div className="gs-inner">

        {/* ── Header ──────────────────────────────────────────── */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
              onClick={() => { window.location.hash = ''; }} title="Back to Dashboard">← Home</button>
            <h1>📊 GENERAL STATISTICS <span>Activity Analyzer</span></h1>
          </div>
          <button className="btn btn-primary" onClick={onReload} disabled={loading}>
            {loading ? 'Loading…' : '⟳ Reload'}
          </button>
        </header>

        {/* ── Stats bar ───────────────────────────────────────── */}
        <div className="global-stats-bar">
          <div className="global-stat">
            <span className="global-stat-value">{fmtN(stats.totalLaps)}</span>
            <span className="global-stat-label">Total Laps</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{fmtKm(stats.totalKms)}</span>
            <span className="global-stat-label">Total KMs</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{stats.drivers}</span>
            <span className="global-stat-label">Drivers</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{stats.modes}</span>
            <span className="global-stat-label">Game Modes</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{stats.combos}</span>
            <span className="global-stat-label">Track×Class</span>
          </div>
        </div>

        {/* ═══ Section 1: Activity by Game Mode ═══ */}
        <details className="overview-section dl-section" open>
          <summary className="overview-summary">
            Activity by Game Mode — {modeStats.length} mode{modeStats.length !== 1 ? 's' : ''}
          </summary>
          <div className="overview-content">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div><p className="dl-chart-note" style={{ margin: '0 0 0.4rem' }}>Laps per Game Mode</p><BarChart {...modeLapsChart} height={200} /></div>
              <div><p className="dl-chart-note" style={{ margin: '0 0 0.4rem' }}>KMs per Game Mode</p><BarChart {...modeKmsChart} height={200} /></div>
            </div>
            <table className="dl-table">
              <thead>
                <tr><th>Game Mode</th><th>Total Laps</th><th>Total KMs</th><th>Drivers</th><th>Tracks</th><th>Avg Laps/Driver</th></tr>
              </thead>
              <tbody>
                {modeStats.map(m => (
                  <tr key={m.id}>
                    <td className="dl-player">{m.name}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(m.laps)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(m.kms)}</td>
                    <td className="dl-combos">{m.driverCount}</td>
                    <td className="dl-combos">{m.trackCount}</td>
                    <td className="dl-avg">{fmtN(m.avgLapsPerDriver)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ═══ Section 2: Activity by Track ═══ */}
        <details className="overview-section dl-section" open>
          <summary className="overview-summary">
            Activity by Track — {trackStats.length} track{trackStats.length !== 1 ? 's' : ''} with activity
          </summary>
          <div className="overview-content">
            <div className="gs-filter-bar">
              <ModeFilter gameModes={gameModes} value={trackFilterMode} onChange={v => setTrackFilterMode(v)} />
              <ClassFilter classes={classes} value={trackFilterClass} onChange={v => setTrackFilterClass(v)} />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              {trackStats.map(t => (
                <HBar key={t.id} label={t.name} value={t.laps} maxValue={trackMaxLaps} />
              ))}
            </div>
            <table className="dl-table">
              <thead>
                <tr><th>Track</th><th>Laps</th><th>KMs</th><th>Drivers</th><th>Avg Laps/Driver</th></tr>
              </thead>
              <tbody>
                {trackStats.map(t => (
                  <tr key={t.id}>
                    <td className="dl-player">{t.name}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(t.laps)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(t.kms)}</td>
                    <td className="dl-combos">{t.driverCount}</td>
                    <td className="dl-avg">{fmtN(t.avgLaps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ═══ Section 3: Activity by Class ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Activity by Class — {classStats.length} class{classStats.length !== 1 ? 'es' : ''}
          </summary>
          <div className="overview-content">
            <ModeFilter gameModes={gameModes} value={classFilterMode} onChange={v => setClassFilterMode(v)} />
            <BarChart {...classChart} height={200} />
            <table className="dl-table" style={{ marginTop: '1rem' }}>
              <thead>
                <tr><th>Class</th><th>Laps</th><th>KMs</th><th>Drivers</th><th>Game Modes</th></tr>
              </thead>
              <tbody>
                {classStats.map(c => (
                  <tr key={c.id}>
                    <td className="dl-player">{c.name}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtN(c.laps)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(c.kms)}</td>
                    <td className="dl-combos">{c.driverCount}</td>
                    <td className="dl-combos">{c.modeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ═══ Section 4: Track × Class Heatmap ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Track × Class Heatmap — laps and drivers per combination
          </summary>
          <div className="overview-content">
            <ModeFilter gameModes={gameModes} value={heatmapMode} onChange={v => setHeatmapMode(v)} />
            <table className="dl-grid-table" style={{ marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th>Track</th>
                  {heatmapClasses.map(c => <th key={c.id}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatmapTracks.map(t => (
                  <tr key={t.id}>
                    <td className="dl-track-name">{t.name}</td>
                    {heatmapClasses.map(c => {
                      const cell = heatmapData[`${t.id}-${c.id}`];
                      if (!cell) return <td key={c.id} className="dl-grid-cell dl-grid-empty">—</td>;
                      const { bg, fg } = heatColor(cell.laps / heatmapMax);
                      return (
                        <td key={c.id} className="dl-grid-cell" style={{ background: bg, color: fg }}>
                          <strong style={{ display: 'block', fontSize: '0.9rem' }}>{fmtN(cell.laps)} laps</strong>
                          <span className="dl-grid-avg">{fmtKm(cell.kms)} km</span>
                          <span className="dl-grid-players">{cell.drivers.size} driver{cell.drivers.size !== 1 ? 's' : ''}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ═══ Section 5: Top Drivers — Global ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Top Drivers — Global Ranking — {globalRanking.length} driver{globalRanking.length !== 1 ? 's' : ''}
          </summary>
          <div className="overview-content">
            <div className="gs-filter-bar">
              <ModeFilter gameModes={gameModes} value={filterModeId} onChange={v => { setFilterModeId(v); resetGlobal(); }} />
              <ClassFilter classes={classes} value={filterClassId} onChange={v => { setFilterClassId(v); resetGlobal(); }} />
              <div className="dl-class-filter" style={{ display: 'inline-flex' }}>
                <span className="dl-class-filter-label">Track:</span>
                <button className={`dl-class-pill${filterTrackId === '' ? ' active' : ''}`} onClick={() => { setFilterTrackId(''); resetGlobal(); }}>All</button>
                {tracks.map(t => (
                  <button key={t.id} className={`dl-class-pill${String(filterTrackId) === String(t.id) ? ' active' : ''}`}
                    onClick={() => { setFilterTrackId(String(t.id)); resetGlobal(); }}>{t.name}</button>
                ))}
              </div>
            </div>
            <table className="dl-table">
              <thead>
                <tr><th>#</th><th>Player</th><th>Nation</th><th>Total Laps</th><th style={{ minWidth: 140 }}>Bar</th><th>Total KMs</th><th>Combos</th><th>Modes</th><th>Tracks</th></tr>
              </thead>
              <tbody>
                {globalSlice.map((e, i) => (
                  <tr key={e.driverId}>
                    <td className="dl-rank">{(globalPage - 1) * PAGE_SIZE + i + 1}</td>
                    <td className="dl-player">{e.driver?.nickname ?? `#${e.driverId}`}</td>
                    <td className="dl-nation">{e.driver?.nationCode?.toUpperCase() ?? '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#F5C518' }}>{fmtN(e.laps)}</td>
                    <td>
                      <div className="gs-hbar-track-inline">
                        <div className="gs-hbar-fill-inline" style={{ width: `${(e.laps / globalMaxLaps * 100).toFixed(1)}%` }} />
                      </div>
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(e.kms)}</td>
                    <td className="dl-combos">{e.combos}</td>
                    <td className="dl-combos">{e.modeCount}</td>
                    <td className="dl-combos">{e.trackCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={globalPage} total={globalRanking.length} pageSize={PAGE_SIZE} onChange={setGlobalPage} />
          </div>
        </details>

        {/* ═══ Section 6: Top Drivers per Track ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Top Drivers per Track{perTrackId ? ` — ${trackMap.get(Number(perTrackId))?.name}` : ''}
          </summary>
          <div className="overview-content">
            <div className="gs-filter-bar">
              <div className="selectors-bar" style={{ marginBottom: 0 }}>
                <label>Track:</label>
                <select value={perTrackId} onChange={e => handlePerTrack(e.target.value)}>
                  <option value="">— select track —</option>
                  {tracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <ModeFilter gameModes={gameModes} value={perTrackModeFilter} onChange={v => { setPerTrackModeFilter(v); setPerTrackPage(1); }} />
              <ClassFilter classes={classes} value={perTrackClassFilter} onChange={v => { setPerTrackClassFilter(v); setPerTrackPage(1); }} />
            </div>
            {!perTrackId && <p className="dl-search-hint">Select a track to see the driver ranking.</p>}
            {perTrackId && perTrackRanking.length === 0 && <p className="dl-chart-note">No data for this combination.</p>}
            {perTrackId && perTrackRanking.length > 0 && (
              <>
                <table className="dl-table">
                  <thead>
                    <tr><th>#</th><th>Player</th><th>Nation</th><th>Laps</th><th style={{ minWidth: 120 }}>Bar</th><th>KMs</th><th>Classes</th></tr>
                  </thead>
                  <tbody>
                    {perTrackSlice.map((e, i) => (
                      <tr key={e.driverId}>
                        <td className="dl-rank">{(perTrackPage - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="dl-player">{e.driver?.nickname ?? `#${e.driverId}`}</td>
                        <td className="dl-nation">{e.driver?.nationCode?.toUpperCase() ?? '—'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#F5C518' }}>{fmtN(e.laps)}</td>
                        <td><div className="gs-hbar-track-inline"><div className="gs-hbar-fill-inline" style={{ width: `${(e.laps / perTrackMaxLaps * 100).toFixed(1)}%` }} /></div></td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(e.kms)}</td>
                        <td className="dl-combos">{e.classCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={perTrackPage} total={perTrackRanking.length} pageSize={PAGE_SIZE} onChange={setPerTrackPage} />
              </>
            )}
          </div>
        </details>

        {/* ═══ Section 7: Top Drivers per Game Mode ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Top Drivers per Game Mode{perModeId ? ` — ${gameModeMap.get(Number(perModeId))?.name}` : ''}
          </summary>
          <div className="overview-content">
            <div className="gs-filter-bar">
              <div className="selectors-bar" style={{ marginBottom: 0 }}>
                <label>Game Mode:</label>
                <select value={perModeId} onChange={e => handlePerMode(e.target.value)}>
                  <option value="">— select mode —</option>
                  {gameModes.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <ClassFilter classes={classes} value={perModeClassFilter} onChange={v => { setPerModeClassFilter(v); setPerModePage(1); }} />
              <div className="dl-class-filter" style={{ display: 'inline-flex' }}>
                <span className="dl-class-filter-label">Track:</span>
                <button className={`dl-class-pill${perModeTrackFilter === '' ? ' active' : ''}`} onClick={() => { setPerModeTrackFilter(''); setPerModePage(1); }}>All</button>
                {tracks.map(t => (
                  <button key={t.id} className={`dl-class-pill${String(perModeTrackFilter) === String(t.id) ? ' active' : ''}`}
                    onClick={() => { setPerModeTrackFilter(String(t.id)); setPerModePage(1); }}>{t.name}</button>
                ))}
              </div>
            </div>
            {!perModeId && <p className="dl-search-hint">Select a game mode to see the driver ranking.</p>}
            {perModeId && perModeRanking.length === 0 && <p className="dl-chart-note">No data for this combination.</p>}
            {perModeId && perModeRanking.length > 0 && (
              <>
                <table className="dl-table">
                  <thead>
                    <tr><th>#</th><th>Player</th><th>Nation</th><th>Laps</th><th style={{ minWidth: 120 }}>Bar</th><th>KMs</th><th>Tracks</th><th>Classes</th></tr>
                  </thead>
                  <tbody>
                    {perModeSlice.map((e, i) => (
                      <tr key={e.driverId}>
                        <td className="dl-rank">{(perModePage - 1) * PAGE_SIZE + i + 1}</td>
                        <td className="dl-player">{e.driver?.nickname ?? `#${e.driverId}`}</td>
                        <td className="dl-nation">{e.driver?.nationCode?.toUpperCase() ?? '—'}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#F5C518' }}>{fmtN(e.laps)}</td>
                        <td><div className="gs-hbar-track-inline"><div className="gs-hbar-fill-inline" style={{ width: `${(e.laps / perModeMaxLaps * 100).toFixed(1)}%` }} /></div></td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(e.kms)}</td>
                        <td className="dl-combos">{e.trackCount}</td>
                        <td className="dl-combos">{e.classCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={perModePage} total={perModeRanking.length} pageSize={PAGE_SIZE} onChange={setPerModePage} />
              </>
            )}
          </div>
        </details>

        {/* ═══ Section 8: Driver Search ═══ */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Driver Search — activity breakdown per driver
          </summary>
          <div className="overview-content">
            <div className="dl-search-row">
              <input className="dl-search-input" type="text" placeholder="Search nickname…"
                value={playerSearch} onChange={e => setPlayerSearch(e.target.value)}
                list="gs-players-datalist" autoComplete="off" />
              <datalist id="gs-players-datalist">
                {statsPlayerIds.map(pid => {
                  const d = driverMap.get(pid);
                  return d ? <option key={pid} value={d.nickname} /> : null;
                })}
              </datalist>
              {playerSearch && (
                <button className="btn dl-search-clear" onClick={() => setPlayerSearch('')}>✕</button>
              )}
            </div>

            {playerSearch.trim() && !resolvedPlayer && (
              <p className="dl-search-empty">No driver found matching "<strong>{playerSearch.trim()}</strong>".</p>
            )}

            {resolvedPlayer && playerRecords.length > 0 && (
              <div className="dl-player-card">
                <div className="dl-player-card-header">
                  <span className="dl-player-name">{resolvedPlayer.nickname}</span>
                  <span className="dl-player-nation">{resolvedPlayer.nationCode?.toUpperCase()}</span>
                  <span className="dl-player-meta">
                    {fmtN(playerTotals.laps)} laps · {fmtKm(playerTotals.kms)} km · {playerTotals.combos} combo{playerTotals.combos !== 1 ? 's' : ''} · {playerTotals.modes} mode{playerTotals.modes !== 1 ? 's' : ''} · {playerTotals.tracks} track{playerTotals.tracks !== 1 ? 's' : ''}
                  </span>
                </div>
                <table className="dl-table dl-player-table">
                  <thead>
                    <tr><th>Game Mode</th><th>Track</th><th>Class</th><th>Laps</th><th>KMs</th></tr>
                  </thead>
                  <tbody>
                    {playerRecords.map(r => (
                      <tr key={r.id}>
                        <td>{r.modeName}</td>
                        <td>{r.trackName}</td>
                        <td>{r.className}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: '#F5C518' }}>{fmtN(r.totalLaps)}</td>
                        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKm(r.totalKms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!playerSearch && (
              <p className="dl-search-hint">Type a nickname to see their activity breakdown across all game modes, tracks and classes.</p>
            )}
          </div>
        </details>

      </div>{/* /.gs-inner */}
    </div>
  );
}
