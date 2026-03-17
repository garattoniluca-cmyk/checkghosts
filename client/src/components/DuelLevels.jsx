import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js';

// Register bar chart components (idempotent alongside RankingTelemetry registrations)
ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, ChartTooltip);

// ── Constants ─────────────────────────────────────────────────────────
const LB_PAGE_SIZE    = 25;
const COMBO_PAGE_SIZE = 25;

// ── Helpers ───────────────────────────────────────────────────────────

function levelColor(level) {
  if (level >= 26) return '#FFD700';
  if (level >= 21) return '#F5C518';
  if (level >= 16) return '#c9a000';
  if (level >= 11) return '#8a6e00';
  return '#444444';
}

function levelBg(level) {
  if (level >= 26) return 'rgba(255,215,0,0.18)';
  if (level >= 21) return 'rgba(245,197,24,0.14)';
  if (level >= 16) return 'rgba(201,160,0,0.10)';
  if (level >= 11) return 'rgba(138,110,0,0.08)';
  return 'rgba(80,80,80,0.08)';
}

function formatDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildDistribution(rows) {
  const dist = Array.from({ length: 30 }, (_, i) => ({ level: i + 1, count: 0 }));
  for (const r of rows) {
    if (r.level >= 1 && r.level <= 30) dist[r.level - 1].count++;
  }
  return dist;
}

function buildDistStats(distribution) {
  const nonZero = distribution.filter(d => d.count > 0);
  if (!nonZero.length) return { mostCommon: '—', median: '—' };
  const mostCommon = nonZero.reduce((a, b) => b.count > a.count ? b : a);
  const total = nonZero.reduce((s, d) => s + d.count, 0);
  let cum = 0, median = nonZero[0].level;
  for (const d of distribution) {
    cum += d.count;
    if (cum >= total / 2) { median = d.level; break; }
  }
  return { mostCommon: mostCommon.level, median };
}

// ── Pagination sub-component ──────────────────────────────────────────
function Pagination({ page, total, pageSize, onChange }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="dl-pagination">
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>← Prev</button>
      <span className="dl-pag-info">
        Page {page} / {totalPages}
        <span className="dl-pag-total"> ({total} total)</span>
      </span>
      <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next →</button>
    </div>
  );
}

// ── Bar chart component ───────────────────────────────────────────────
function LevelBarChart({ distribution, height = 220 }) {
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
      data: {
        labels: distribution.map(d => `Lv ${d.level}`),
        datasets: [{
          data: distribution.map(d => d.count),
          backgroundColor: distribution.map(d => levelColor(d.level)),
          borderColor:     distribution.map(d => levelColor(d.level)),
          borderWidth: 1, borderRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `Level ${distribution[items[0].dataIndex].level}`,
              label: (item)  => ` ${item.raw} record${item.raw !== 1 ? 's' : ''}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: '#666', font: { size: 10 }, maxRotation: 0 }, grid: { color: '#1e1e1e' } },
          y: { ticks: { color: '#666', font: { size: 11 }, stepSize: 1, precision: 0 }, grid: { color: '#1e1e1e' }, beginAtZero: true },
        },
      },
    });
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [distribution, height]);

  return <div ref={containerRef} style={{ height }} />;
}

// ── LevelBar: small horizontal progress bar ──────────────────────────
function LevelBar({ level, max = 30 }) {
  const pct = Math.min(100, (level / max) * 100).toFixed(1);
  return (
    <div className="dl-level-bar-track">
      <div className="dl-level-bar-fill" style={{ width: `${pct}%`, background: levelColor(level) }} />
      <span className="dl-level-bar-label">{level}/{max}</span>
    </div>
  );
}

// ── ClassFilter: pill-style class filter buttons ─────────────────────
function ClassFilter({ classes, value, onChange }) {
  return (
    <div className="dl-class-filter">
      <span className="dl-class-filter-label">Filter:</span>
      <button className={`dl-class-pill${value === '' ? ' active' : ''}`} onClick={() => onChange('')}>All classes</button>
      {classes.map(c => (
        <button
          key={c.id}
          className={`dl-class-pill${String(value) === String(c.id) ? ' active' : ''}`}
          onClick={() => onChange(String(c.id))}
        >{c.name}</button>
      ))}
    </div>
  );
}

// ── Main DuelLevels component ─────────────────────────────────────────
export default function DuelLevels({ drivers = [], classes = [], tracks = [], duelLevels = [], loading, onReload }) {

  // ── Global filter (shared by Leaderboard + Distribution) ─────────
  const [filterClassId, setFilterClassId] = useState('');

  // ── Leaderboard pagination ────────────────────────────────────────
  const [lbPage, setLbPage] = useState(1);

  // ── Player Level Search ───────────────────────────────────────────
  const [playerSearch, setPlayerSearch] = useState('');

  // ── Combo Detail module ───────────────────────────────────────────
  const [comboClassId, setComboClassId] = useState('');
  const [comboTrackId, setComboTrackId] = useState('');
  const [comboPage,    setComboPage]    = useState(1);

  // Reset helpers
  const handleFilterClass = (val) => { setFilterClassId(val); setLbPage(1); };
  const handleComboClass  = (val) => { setComboClassId(val); setComboPage(1); setComboTrackId(''); };
  const handleComboTrack  = (val) => { setComboTrackId(val); setComboPage(1); };

  // ── Lookup maps ───────────────────────────────────────────────────
  const driverMap = useMemo(() => new Map(drivers.map(d => [Number(d.id), d])),  [drivers]);
  const classMap  = useMemo(() => new Map(classes.map(c => [Number(c.id), c])),  [classes]);
  const trackMap  = useMemo(() => new Map(tracks.map(t => [Number(t.id), t])),   [tracks]);

  // ── Normalize rows ────────────────────────────────────────────────
  const rows = useMemo(() =>
    duelLevels.map(r => ({
      ...r,
      idDriver: Number(r.idDriver),
      idTrack:  Number(r.idTrack),
      idClass:  Number(r.idClass),
      level:    Number(r.level),
    })),
    [duelLevels]
  );

  // ── Rows filtered by global class filter ─────────────────────────
  const filteredRows = useMemo(() =>
    filterClassId ? rows.filter(r => String(r.idClass) === filterClassId) : rows,
    [rows, filterClassId]
  );

  // ── Summary stats (all rows) ──────────────────────────────────────
  const stats = useMemo(() => {
    if (!rows.length) return { uniqueDrivers: 0, maxLevel: 0, avgLevel: '0.0', uniqueCombos: 0 };
    return {
      uniqueDrivers: new Set(rows.map(r => r.idDriver)).size,
      maxLevel:      Math.max(...rows.map(r => r.level)),
      avgLevel:      (rows.reduce((s, r) => s + r.level, 0) / rows.length).toFixed(1),
      uniqueCombos:  new Set(rows.map(r => `${r.idTrack}-${r.idClass}`)).size,
    };
  }, [rows]);

  // ── Leaderboard (from filteredRows, with atMax count) ────────────
  const leaderboard = useMemo(() => {
    const map = {};
    for (const r of filteredRows) {
      if (!map[r.idDriver]) map[r.idDriver] = { maxLevel: 0, totalLevel: 0, count: 0, lastDate: null };
      const e = map[r.idDriver];
      if (r.level > e.maxLevel) e.maxLevel = r.level;
      e.totalLevel += r.level;
      e.count++;
      const d = r.lastUpdateDateTime ? new Date(r.lastUpdateDateTime) : null;
      if (d && (!e.lastDate || d > e.lastDate)) e.lastDate = d;
    }
    // Second pass: count combos where player reached their max level
    return Object.entries(map)
      .map(([id, e]) => {
        const driverId = Number(id);
        const atMax = filteredRows.filter(r => r.idDriver === driverId && r.level === e.maxLevel).length;
        return {
          driver:   driverMap.get(driverId),
          driverId,
          maxLevel: e.maxLevel,
          avgLevel: (e.totalLevel / e.count).toFixed(1),
          combos:   e.count,
          atMax,
          lastDate: e.lastDate,
        };
      })
      .sort((a, b) => b.maxLevel - a.maxLevel || b.atMax - a.atMax || b.avgLevel - a.avgLevel);
  }, [filteredRows, driverMap]);

  const lbSlice = leaderboard.slice((lbPage - 1) * LB_PAGE_SIZE, lbPage * LB_PAGE_SIZE);

  // ── Distribution (from filteredRows) ─────────────────────────────
  const distribution = useMemo(() => buildDistribution(filteredRows), [filteredRows]);
  const distStats    = useMemo(() => buildDistStats(distribution),    [distribution]);

  // ── Track × Class grid (all rows, extended with max+maxCount) ────
  const uniqueTracks  = useMemo(() =>
    tracks.filter(t => rows.some(r => r.idTrack === Number(t.id))),  [tracks, rows]);
  const uniqueClasses = useMemo(() =>
    classes.filter(c => rows.some(r => r.idClass === Number(c.id))), [classes, rows]);

  const gridData = useMemo(() => {
    const map = {};
    for (const r of rows) {
      const key = `${r.idTrack}-${r.idClass}`;
      if (!map[key]) map[key] = { total: 0, count: 0, max: 0, maxCount: 0 };
      const cell = map[key];
      cell.total += r.level;
      cell.count++;
      if (r.level > cell.max)        { cell.max = r.level; cell.maxCount = 1; }
      else if (r.level === cell.max) { cell.maxCount++; }
    }
    return map;
  }, [rows]);

  // ── Player Level Search — only players with duel level records ────
  const duelPlayerIds = useMemo(() =>
    [...new Set(rows.map(r => r.idDriver))].sort((a, b) => {
      const na = driverMap.get(a)?.nickname ?? '';
      const nb = driverMap.get(b)?.nickname ?? '';
      return na.localeCompare(nb);
    }),
    [rows, driverMap]
  );

  // Resolve typed text → driver object (case-insensitive exact nickname match)
  const resolvedPlayer = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return null;
    for (const pid of duelPlayerIds) {
      const d = driverMap.get(pid);
      if (d && d.nickname.toLowerCase() === q) return d;
    }
    return null;
  }, [playerSearch, duelPlayerIds, driverMap]);

  const selectedPlayerRecords = useMemo(() => {
    if (!resolvedPlayer) return [];
    const pid = Number(resolvedPlayer.id);
    return rows
      .filter(r => r.idDriver === pid)
      .map(r => ({
        ...r,
        trackName: trackMap.get(r.idTrack)?.name  || `Track #${r.idTrack}`,
        className: classMap.get(r.idClass)?.name  || `Class #${r.idClass}`,
      }))
      .sort((a, b) => b.level - a.level);
  }, [resolvedPlayer, rows, trackMap, classMap]);

  // ── Combo Detail module ───────────────────────────────────────────
  const comboAvailTracks = useMemo(() =>
    comboClassId
      ? tracks.filter(t => rows.some(r => String(r.idClass) === comboClassId && r.idTrack === Number(t.id)))
      : tracks.filter(t => rows.some(r => r.idTrack === Number(t.id))),
    [tracks, rows, comboClassId]
  );

  const comboRows = useMemo(() =>
    (comboClassId && comboTrackId)
      ? rows
          .filter(r => String(r.idClass) === comboClassId && String(r.idTrack) === comboTrackId)
          .map(r => ({
            ...r,
            nickname:   driverMap.get(r.idDriver)?.nickname   || `#${r.idDriver}`,
            nationCode: driverMap.get(r.idDriver)?.nationCode || '',
          }))
          .sort((a, b) => b.level - a.level)
      : [],
    [rows, comboClassId, comboTrackId, driverMap]
  );

  const comboStats        = useMemo(() => {
    if (!comboRows.length) return null;
    return {
      players:  comboRows.length,
      maxLevel: comboRows[0].level,
      avgLevel: (comboRows.reduce((s, r) => s + r.level, 0) / comboRows.length).toFixed(1),
    };
  }, [comboRows]);
  const comboDistribution = useMemo(() => buildDistribution(comboRows), [comboRows]);
  const comboDistStats    = useMemo(() => buildDistStats(comboDistribution), [comboDistribution]);
  const comboSlice        = comboRows.slice((comboPage - 1) * COMBO_PAGE_SIZE, comboPage * COMBO_PAGE_SIZE);
  const comboClassName    = classMap.get(Number(comboClassId))?.name || '';
  const comboTrackName    = trackMap.get(Number(comboTrackId))?.name  || '';

  // ─────────────────────────────────────────────────────────────────
  if (loading && !rows.length) {
    return (
      <div className="duel-levels-section">
        <div className="dl-inner">
          <header className="app-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button className="btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
                onClick={() => { window.location.hash = ''; }}>← Home</button>
              <h1>⚔️ DUEL MODE <span>Progressions Analyzer</span></h1>
            </div>
          </header>
          <div className="global-stats-bar" style={{ justifyContent: 'center', color: '#666' }}>
            Loading Duel Level data…
          </div>
        </div>
      </div>
    );
  }

  if (!rows.length) return null;

  return (
    <div className="duel-levels-section">
      <div className="dl-inner">

        {/* ── Header ─────────────────────────────────────────── */}
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              className="btn"
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
              onClick={() => { window.location.hash = ''; }}
              title="Back to Dashboard"
            >← Home</button>
            <h1>⚔️ DUEL MODE <span>Progressions Analyzer</span></h1>
          </div>
          <button
            className="btn btn-primary"
            onClick={onReload}
            disabled={loading}
          >
            {loading ? 'Loading…' : '⟳ Reload'}
          </button>
        </header>

        {/* ── Stats bar ───────────────────────────────────────── */}
        <div className="global-stats-bar">
          <div className="global-stat">
            <span className="global-stat-value">{stats.uniqueDrivers}</span>
            <span className="global-stat-label">Drivers</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value" style={{ color: levelColor(stats.maxLevel) }}>
              Lv.{stats.maxLevel}
            </span>
            <span className="global-stat-label">Max Level</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{stats.avgLevel}</span>
            <span className="global-stat-label">Avg Level</span>
          </div>
          <div className="dl-stat-divider" />
          <div className="global-stat">
            <span className="global-stat-value">{stats.uniqueCombos}</span>
            <span className="global-stat-label">Track×Class</span>
          </div>
        </div>

        {/* ── Level Distribution ──────────────────────────────── */}
        <details className="overview-section dl-section" open>
          <summary className="overview-summary">
            Level Distribution — most common Lv.{distStats.mostCommon} · median Lv.{distStats.median}
            {filterClassId ? ` · ${classMap.get(Number(filterClassId))?.name}` : ''}
          </summary>
          <div className="overview-content">
            <ClassFilter classes={uniqueClasses} value={filterClassId} onChange={handleFilterClass} />
            <p className="dl-chart-note">
              Each bar = number of driver+track+class records at that level
              ({filteredRows.length} record{filteredRows.length !== 1 ? 's' : ''}
              {filterClassId ? ` in ${classMap.get(Number(filterClassId))?.name}` : ' across all classes'}).
            </p>
            <LevelBarChart distribution={distribution} />
          </div>
        </details>

        {/* ── Track × Class Grid ──────────────────────────────── */}
        <details className="overview-section dl-section" open>
          <summary className="overview-summary">
            Progress by Track & Class — avg · max · drivers at max per combination
          </summary>
          <div className="overview-content">
            <table className="dl-grid-table">
              <thead>
                <tr>
                  <th>Track</th>
                  {uniqueClasses.map(c => <th key={c.id}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {uniqueTracks.map(t => (
                  <tr key={t.id}>
                    <td className="dl-track-name">{t.name}</td>
                    {uniqueClasses.map(c => {
                      const cell = gridData[`${t.id}-${c.id}`];
                      if (!cell) return <td key={c.id} className="dl-grid-cell dl-grid-empty">—</td>;
                      const avg    = (cell.total / cell.count).toFixed(1);
                      const avgInt = Math.round(cell.total / cell.count);
                      return (
                        <td key={c.id} className="dl-grid-cell"
                            style={{ background: levelBg(cell.max), color: levelColor(cell.max) }}>
                          <span className="dl-grid-avg">avg Lv.{avg}</span>
                          <strong className="dl-grid-max">Max Lv.{cell.max}</strong>
                          <span className="dl-grid-players">
                            {cell.maxCount} driver{cell.maxCount !== 1 ? 's' : ''} at max · {cell.count} total
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        {/* ── Combo Detail ─────────────────────────────────────── */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Combo Detail — level distribution & players per track / class
          </summary>
          <div className="overview-content">
            <div className="selectors-bar" style={{ marginBottom: '1rem' }}>
              <label>Class:</label>
              <select value={comboClassId} onChange={e => handleComboClass(e.target.value)}>
                <option value="">— select class —</option>
                {uniqueClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <label>Track:</label>
              <select value={comboTrackId} onChange={e => handleComboTrack(e.target.value)}>
                <option value="">— select track —</option>
                {comboAvailTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {(!comboClassId || !comboTrackId) && (
                <span className="selector-hint">Select both class and track to see details.</span>
              )}
            </div>

            {comboClassId && comboTrackId && (
              comboRows.length === 0 ? (
                <p className="dl-chart-note">No data for <strong>{comboClassName}</strong> @ <strong>{comboTrackName}</strong>.</p>
              ) : (
                <>
                  <div className="dl-combo-stats-bar">
                    <div className="dl-combo-stat">
                      <span className="global-stat-value">{comboStats.players}</span>
                      <span className="global-stat-label">Players</span>
                    </div>
                    <div className="dl-stat-divider" />
                    <div className="dl-combo-stat">
                      <span className="global-stat-value" style={{ color: levelColor(comboStats.maxLevel) }}>Lv.{comboStats.maxLevel}</span>
                      <span className="global-stat-label">Max Level</span>
                    </div>
                    <div className="dl-stat-divider" />
                    <div className="dl-combo-stat">
                      <span className="global-stat-value">{comboStats.avgLevel}</span>
                      <span className="global-stat-label">Avg Level</span>
                    </div>
                    <div className="dl-stat-divider" />
                    <div className="dl-combo-stat">
                      <span className="global-stat-label" style={{ fontSize: '0.78rem', color: '#888' }}>
                        most common Lv.{comboDistStats.mostCommon} · median Lv.{comboDistStats.median}
                      </span>
                    </div>
                  </div>
                  <p className="dl-chart-note" style={{ marginTop: '0.75rem' }}>
                    Level distribution for <strong>{comboClassName}</strong> @ <strong>{comboTrackName}</strong>
                  </p>
                  <LevelBarChart distribution={comboDistribution} height={180} />
                  <h4 className="dl-combo-table-title">Players — {comboClassName} @ {comboTrackName}</h4>
                  <table className="dl-table" style={{ marginTop: '0.5rem' }}>
                    <thead>
                      <tr>
                        <th>#</th><th>Player</th><th>Nation</th><th>Level</th><th>Progress</th><th>Last Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comboSlice.map((r, i) => (
                        <tr key={r.id}>
                          <td className="dl-rank">{(comboPage - 1) * COMBO_PAGE_SIZE + i + 1}</td>
                          <td className="dl-player">{r.nickname}</td>
                          <td className="dl-nation">{r.nationCode?.toUpperCase() || '—'}</td>
                          <td className="dl-level" style={{ color: levelColor(r.level) }}>{r.level}</td>
                          <td style={{ minWidth: 120 }}><LevelBar level={r.level} /></td>
                          <td className="dl-date">{formatDate(r.lastUpdateDateTime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={comboPage} total={comboRows.length} pageSize={COMBO_PAGE_SIZE} onChange={setComboPage} />
                </>
              )
            )}
          </div>
        </details>

        {/* ── Player Level Search ──────────────────────────────── */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Player Level Search — progression by track & class
          </summary>
          <div className="overview-content">
            <div className="dl-search-row">
              <input
                className="dl-search-input"
                type="text"
                placeholder="Search nickname…"
                value={playerSearch}
                onChange={e => setPlayerSearch(e.target.value)}
                list="dl-players-datalist"
                autoComplete="off"
              />
              <datalist id="dl-players-datalist">
                {duelPlayerIds.map(pid => {
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

            {resolvedPlayer && selectedPlayerRecords.length > 0 && (
              <div className="dl-player-card">
                <div className="dl-player-card-header">
                  <span className="dl-player-name">{resolvedPlayer.nickname}</span>
                  <span className="dl-player-nation">{resolvedPlayer.nationCode?.toUpperCase()}</span>
                  <span className="dl-player-meta">
                    {selectedPlayerRecords.length} combo{selectedPlayerRecords.length !== 1 ? 's' : ''} · Max Lv.{Math.max(...selectedPlayerRecords.map(r => r.level))}
                  </span>
                </div>
                <table className="dl-table dl-player-table">
                  <thead>
                    <tr>
                      <th>Track</th><th>Class</th><th>Level</th><th>Progress</th><th>Last Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPlayerRecords.map(r => (
                      <tr key={r.id}>
                        <td>{r.trackName}</td>
                        <td>{r.className}</td>
                        <td style={{ color: levelColor(r.level), fontWeight: 700 }}>{r.level}</td>
                        <td style={{ minWidth: 120 }}><LevelBar level={r.level} /></td>
                        <td className="dl-date">{formatDate(r.lastUpdateDateTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!playerSearch && (
              <p className="dl-search-hint">Type a nickname to see their level progression across all track and class combinations.</p>
            )}
          </div>
        </details>

        {/* ── Leaderboard (last) ───────────────────────────────── */}
        <details className="overview-section dl-section">
          <summary className="overview-summary">
            Level Leaderboard — {leaderboard.length} active driver{leaderboard.length !== 1 ? 's' : ''}
            {filterClassId ? ` · ${classMap.get(Number(filterClassId))?.name}` : ''}
          </summary>
          <div className="overview-content">
            <ClassFilter classes={uniqueClasses} value={filterClassId} onChange={handleFilterClass} />
            <table className="dl-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Nation</th>
                  <th>Max Level</th>
                  <th>Progress</th>
                  <th>At Max</th>
                  <th>Avg Lv</th>
                  <th>Combos</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {lbSlice.map((entry, i) => (
                  <tr key={entry.driverId}>
                    <td className="dl-rank">{(lbPage - 1) * LB_PAGE_SIZE + i + 1}</td>
                    <td className="dl-player">{entry.driver?.nickname ?? `#${entry.driverId}`}</td>
                    <td className="dl-nation">{entry.driver?.nationCode?.toUpperCase() ?? '—'}</td>
                    <td className="dl-level" style={{ color: levelColor(entry.maxLevel) }}>{entry.maxLevel}</td>
                    <td style={{ minWidth: 120 }}><LevelBar level={entry.maxLevel} /></td>
                    <td className="dl-atmax" title="Combos where this max level was reached">
                      {entry.atMax === entry.combos
                        ? <span style={{ color: '#F5C518' }}>{entry.atMax}/{entry.combos}</span>
                        : <span>{entry.atMax}/{entry.combos}</span>}
                    </td>
                    <td className="dl-avg">{entry.avgLevel}</td>
                    <td className="dl-combos">{entry.combos}</td>
                    <td className="dl-date">{formatDate(entry.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={lbPage} total={leaderboard.length} pageSize={LB_PAGE_SIZE} onChange={setLbPage} />
          </div>
        </details>

      </div>{/* /.dl-inner */}
    </div>
  );
}
