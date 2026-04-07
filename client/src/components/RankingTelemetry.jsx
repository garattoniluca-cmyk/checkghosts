import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import {
  Chart as ChartJS,
  PieController,
  ArcElement,
  Tooltip as ChartTooltip,
  Legend as ChartLegend,
} from 'chart.js';
import { decodeGhostData, getGhostLapTimeMs, getIntermediatesMs } from '../utils/ghostDecoder';
import { msToTime, formatDiff } from '../utils/timeFormat';
import GhostTelemetry from './GhostTelemetry';

// Register Pie chart components (idempotent, safe alongside GhostTelemetry registrations)
ChartJS.register(PieController, ArcElement, ChartTooltip, ChartLegend);

// ── Inline plugin: draw % labels inside pie slices ─────────────────────
ChartJS.register({
  id: 'pieSliceLabels',
  afterDraw(chart) {
    if (chart.config.type !== 'pie') return;
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      const total = dataset.data.reduce((a, b) => a + b, 0);
      if (!total) return;
      meta.data.forEach((el, i) => {
        const pct = Math.round((dataset.data[i] / total) * 100);
        if (pct < 3) return;
        const pos = el.tooltipPosition();
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Segoe UI, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 4;
        ctx.fillText(`${pct}%`, pos.x, pos.y);
        ctx.restore();
      });
    });
  },
});

// ── Constants ──────────────────────────────────────────────────────────
const CLOSE_THRESHOLD_MS = 2;    // ≤2 ms → giallo (vicino)
const RANKING_SIZE = 20;

// ── Flag column config (icon rendering) ────────────────────────────────
const FLAG_COLUMNS = {
  cameraStabilizer: {
    header: '📷',
    title: 'Camera Stabilizer: 1=ON, 0=OFF',
    render: v => v === 1
      ? <span title="Stabilizer ON" style={{ color: '#48bb78' }}>📷</span>
      : <span title="Stabilizer OFF" style={{ color: '#2a2a2a' }}>—</span>,
  },
  controlMode: {
    header: '🎮',
    title: 'Control: 0=Virtual Cockpit (wheel), 1=Stick',
    render: v => v === 1
      ? <span title="Stick / Controller" style={{ color: '#f6ad55' }}>🎮</span>
      : <span title="Virtual Cockpit (wheel)" style={{ color: '#F5C518' }}>⎈</span>,
  },
  autoTransmission: {
    header: '⚙',
    title: 'Transmission: 1=Auto, 0=Manual',
    render: v => v === 1
      ? <span title="Automatic" style={{ color: '#FFD700', fontWeight: 700 }}>A</span>
      : <span title="Manual" style={{ color: '#48bb78', fontWeight: 700 }}>M</span>,
  },
};

// Microsecond columns: need /1000 to get ms (divide by 1000 before display)
const MICRO_COLS = new Set(['lapValueI1Ms', 'lapValueI2Ms']);
// Intermediate time columns (ms, format as time)
const INTER_COLS = new Set(['lapValueI1Ms', 'lapValueI2Ms', 'lapValueI3Ms']);

// Column name constants — must match the checkGhosts view (adjust if needed)
const ID_COL    = 'id';
const CLASS_COL = 'idClass';
const TRACK_COL = 'idTrack';

// ── Pagination ──────────────────────────────────────────────────────────
const PAGE_SIZE = 10;

// ── Column display labels ───────────────────────────────────────────────
const COL_LABELS = {
  id:             'ID',
  driverNickname: 'Driver',
  lapValueMs:     'Time',
  lapValueI1Ms:   'S1',
  lapValueI2Ms:   'S2',
  lapValueI3Ms:   'S3',
  lapTimestamp:   'Date',
};

// ── Column fixed widths (for table-layout: fixed) ───────────────────────
const COL_WIDTHS = {
  id:             '52px',
  driverNickname: '150px',
  lapValueMs:     '108px',
  lapValueI1Ms:   '92px',
  lapValueI2Ms:   '92px',
  lapValueI3Ms:   '92px',
  lapTimestamp:   '115px',
};

// ── Format ISO timestamp to compact readable form ───────────────────────
function fmtTimestamp(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${mi}:${ss}`;
  } catch { return String(ts); }
}

// ── PieChart component ────────────────────────────────────────────────
function PieChart({ id, labels, data }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !data || data.length === 0) return;
    const canvas = document.createElement('canvas');
    canvas.id = id;
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    chartRef.current = new ChartJS(ctx, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: labels.map((_, i) =>
            `hsl(${(i * 360) / labels.length + 15}, 65%, 50%)`
          ),
          borderColor: '#111111',
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#E0E0E0', font: { size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed} laps` } },
        },
      },
    });
    return () => {
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [id, labels, data]);
  return <div ref={containerRef} style={{ width: '100%', maxWidth: '460px', margin: '0 auto' }} />;
}

// ── Helpers ───────────────────────────────────────────────────────────
function computeMatchStatus(diff) {
  if (diff === null || diff === undefined) return 'na';
  if (diff === 0) return 'match';
  if (Math.abs(diff) <= CLOSE_THRESHOLD_MS) return 'close';
  return 'mismatch';
}

function buildGhostInfo(rawGhostData) {
  const decoded = decodeGhostData(rawGhostData);
  const lapMs   = getGhostLapTimeMs(decoded);
  const intermediates = getIntermediatesMs(decoded);
  return { decoded, lapMs, intermediates, raw: rawGhostData };
}

// ── Speed Traps helpers ────────────────────────────────────────────────
// Speed at a given progress (Tao). For each ghost we either:
//  - Standard2: read the SpeedTrap event with matching `extra` index (m/s → km/h)
//  - Standard1 (or fallback): interpolate |velocity| at the closest progress
function vMagnitude(v) {
  if (!v) return 0;
  return Math.sqrt((v.x || 0) ** 2 + (v.y || 0) ** 2 + (v.z || 0) ** 2);
}

function speedKmhFromEvents(decoded, trapIndex) {
  if (!decoded || !Array.isArray(decoded.events)) return null;
  // Tolerate trailing spaces in name and 0/1-based extra indexing
  const isTrap = (e) => e && typeof e.name === 'string' && e.name.trim() === 'SpeedTrap';
  const target = Number(trapIndex);
  let ev = decoded.events.find(e => isTrap(e) && Number(e.extra) === target);
  if (!ev) ev = decoded.events.find(e => isTrap(e) && Number(e.extra) === target - 1);
  if (!ev || typeof ev.value !== 'number' || ev.value === 0) return null;
  return ev.value * 3.6; // value is m/s
}

function speedKmhAtProgress(frames, targetProgress) {
  if (!Array.isArray(frames) || frames.length < 2 || targetProgress == null) return null;
  // Find frame with closest progress (robust against wrap-around at lap end)
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const p = frames[i].progress;
    if (typeof p !== 'number') continue;
    const d = Math.abs(p - targetProgress);
    if (d < bestDiff) { bestDiff = d; bestIdx = i; }
  }
  if (bestIdx < 0) return null;
  // Linear interpolation with neighbour if possible
  const f = frames[bestIdx];
  const f1 = frames[bestIdx - 1];
  const f2 = frames[bestIdx + 1];
  let pair = null;
  if (f1 && typeof f1.progress === 'number' &&
      ((f1.progress <= targetProgress && targetProgress <= f.progress) ||
       (f.progress <= targetProgress && targetProgress <= f1.progress))) {
    pair = [f1, f];
  } else if (f2 && typeof f2.progress === 'number' &&
      ((f.progress <= targetProgress && targetProgress <= f2.progress) ||
       (f2.progress <= targetProgress && targetProgress <= f.progress))) {
    pair = [f, f2];
  }
  if (pair) {
    const [a, b] = pair;
    const dp = b.progress - a.progress;
    const t = Math.abs(dp) > 1e-9 ? (targetProgress - a.progress) / dp : 0;
    const sa = vMagnitude(a.velocity);
    const sb = vMagnitude(b.velocity);
    return (sa + (sb - sa) * t) * 3.6;
  }
  return vMagnitude(f.velocity) * 3.6;
}

// Aggregate min/avg/max from numeric array (ignores nulls)
function aggregateSpeeds(arr) {
  const valid = arr.filter(x => typeof x === 'number' && isFinite(x));
  if (!valid.length) return { count: 0, min: null, avg: null, max: null };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of valid) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { count: valid.length, min, avg: sum / valid.length, max };
}

// ── formatGap: formatta un delta in ms come +s.ms (es. +1.234) ────────
function formatGap(ms) {
  if (ms == null) return null;
  const sign = ms >= 0 ? '+' : '-';
  const abs  = Math.abs(Math.round(ms));
  const s    = Math.floor(abs / 1000);
  const m    = abs % 1000;
  return `${sign}${s}.${String(m).padStart(3, '0')}`;
}

// ── DiffCell ──────────────────────────────────────────────────────────
function DiffCell({ diff, matchStatus }) {
  return (
    <span className={`diff-cell ${matchStatus}`}>{formatDiff(diff)}</span>
  );
}

// ── MatchBadge ────────────────────────────────────────────────────────
function MatchBadge({ status }) {
  const map = {
    match:    ['badge badge-green',  '✓ Match'],
    close:    ['badge badge-yellow', '~ Close'],
    mismatch: ['badge badge-red',    '✗ Diff'],
    na:       ['badge badge-gray',   'N/A'],
  };
  const [cls, label] = map[status] ?? map.na;
  return <span className={cls}>{label}</span>;
}

// ── GhostHeaders — all top-level JSON fields except 'frames' ──────────
function GhostHeaders({ decoded }) {
  if (!decoded) return null;
  const entries = Object.entries(decoded).filter(([k]) => k !== 'frames');
  if (!entries.length) return null;
  return (
    <div className="analyze-section">
      <div className="section-title">Ghost JSON Headers</div>
      <div className="ghost-headers-grid">
        {entries.map(([key, val]) => (
          <div key={key} className="ghost-header-field">
            <div className="field-label">{key}</div>
            <div className="field-value mono">
              {Array.isArray(val)
                ? `[${val.length} items: ${val.slice(0, 3).map(v => typeof v === 'number' ? v.toFixed(3) : String(v)).join(', ')}${val.length > 3 ? '…' : ''}]`
                : val === null || val === undefined
                ? '—'
                : typeof val === 'object'
                ? JSON.stringify(val)
                : String(val)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ExpandRow — raw DB fields with readable times ─────────────────────
function ExpandRow({ lap, colCount }) {
  const fields = Object.entries(lap);
  return (
    <tr className="expand-row">
      <td colSpan={colCount}>
        <div className="expand-content">
          {fields.map(([key, val]) => {
            let displayVal;
            if (key === 'lapValueMs' && val != null) {
              const ms = Number(val);
              displayVal = `${ms} ms  →  ${msToTime(ms)}`;
            } else if (MICRO_COLS.has(key) && val != null) {
              const ms = Math.round(Number(val) / 1000);
              displayVal = `${ms} ms  →  ${msToTime(ms)}`;
            } else if (key === 'lapValueI3Ms' && val != null) {
              const ms = Number(val);
              displayVal = `${ms} ms  →  ${msToTime(ms)}`;
            } else if (key === 'lapTimestamp' && val != null) {
              displayVal = `${fmtTimestamp(val)}  (${val})`;
            } else {
              displayVal = val === null || val === undefined ? '—' : String(val);
            }
            return (
              <div key={key} className="expand-field">
                <div className="field-label">{key}</div>
                <div className="field-value mono">{displayVal}</div>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}

// ── AnalyzeRow — ghost telemetry detail ───────────────────────────────
function AnalyzeRow({ lap, ghost, colCount }) {
  const { decoded, lapMs, intermediates, raw } = ghost;
  const dbLapMs = lap.lapValueMs !== null && lap.lapValueMs !== undefined
    ? Number(lap.lapValueMs)
    : null;
  const diff = dbLapMs !== null && lapMs !== null ? dbLapMs - lapMs : null;
  const matchStatus = computeMatchStatus(diff);

  // DB intermediates (I1, I2 are in microseconds → /1000; I3 already in ms)
  const dbInterMs = [
    lap.lapValueI1Ms != null ? Math.round(Number(lap.lapValueI1Ms) / 1000) : null,
    lap.lapValueI2Ms != null ? Math.round(Number(lap.lapValueI2Ms) / 1000) : null,
    lap.lapValueI3Ms != null ? Number(lap.lapValueI3Ms) : null,
  ];
  // Ghost intermediates are CUMULATIVE from start → convert to per-sector
  const ghostSectors = intermediates.map((cumul, i) =>
    i === 0 ? cumul : Math.round(cumul - intermediates[i - 1])
  );
  // Add final sector: lapMs − last cumulative intermediate
  if (lapMs != null && intermediates.length > 0) {
    ghostSectors.push(Math.round(lapMs - intermediates[intermediates.length - 1]));
  }
  const hasInterData = dbInterMs.some(v => v != null) || ghostSectors.length > 0;
  const interCount = Math.max(
    dbInterMs.filter(v => v != null).length,
    ghostSectors.length
  );
  // Sampling frequency: frames per second
  const samplingHz = decoded?.frames?.length && lapMs
    ? (decoded.frames.length / (lapMs / 1000)).toFixed(1)
    : null;

  return (
    <tr className="analyze-row">
      <td colSpan={colCount}>
        <div className="analyze-content">
          <div className="analyze-header">
            Ghost Analysis — {ID_COL}: {lap[ID_COL]}
          </div>

          {/* Time comparison */}
          <div className="analyze-time-compare">
            <div className="time-compare-cell">
              <span className="tc-label">lapValueMs (DB)</span>
              <span className="tc-value time-value">{msToTime(dbLapMs)}</span>
            </div>
            <div className="time-compare-cell">
              <span className="tc-label">lapTime (Decoded Ghost)</span>
              <span className="tc-value time-value">{msToTime(lapMs)}</span>
            </div>
            <div className="time-compare-cell">
              <span className="tc-label">Difference (DB − Ghost)</span>
              <span className="tc-value">
                {diff !== null
                  ? <DiffCell diff={diff} matchStatus={matchStatus} />
                  : <span style={{ color: '#666666' }}>N/A</span>}
              </span>
            </div>
            <div className="time-compare-cell">
              <span className="tc-label">Status</span>
              <span className="tc-value"><MatchBadge status={matchStatus} /></span>
            </div>
          </div>

          {/* Intermediates comparison DB vs Ghost */}
          {hasInterData && (
            <div className="analyze-section">
              <div className="section-title">Sectors / Intermediates (DB vs Ghost)</div>
              <table className="inter-compare-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>DB (ms)</th>
                    <th>DB (time)</th>
                    <th>Ghost (ms)</th>
                    <th>Ghost (time)</th>
                    <th>Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: interCount }, (_, i) => {
                    const dMs = dbInterMs[i] ?? null;
                    const gMs = ghostSectors[i] ?? null;
                    const d = dMs !== null && gMs !== null ? dMs - gMs : null;
                    return (
                      <tr key={i}>
                        <td><strong>S{i + 1}</strong></td>
                        <td className="mono">{dMs != null ? `${dMs} ms` : '—'}</td>
                        <td className="time-value">{dMs != null ? msToTime(dMs) : '—'}</td>
                        <td className="mono">{gMs != null ? `${gMs} ms` : '—'}</td>
                        <td className="time-value">{gMs != null ? msToTime(gMs) : '—'}</td>
                        <td>{d !== null ? <DiffCell diff={d} matchStatus={computeMatchStatus(d)} /> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Ghost JSON headers (above frames) */}
          <GhostHeaders decoded={decoded} />

          {/* Frames + Sampling Frequency */}
          {decoded?.frames && (
            <div className="analyze-section">
              <div className="section-title">Recorded Frames</div>
              <div className="field-value mono">
                {decoded.frames.length} frame
                {samplingHz && (
                  <span style={{ color: '#F5C518', marginLeft: '0.75rem' }}>
                    — sampling: ~{samplingHz} Hz
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Download decoded ghost JSON + raw compressed payload */}
          {decoded && (
            <div style={{ marginTop: '1rem', textAlign: 'right', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: '0.78rem', padding: '0.35rem 0.9rem' }}
                onClick={() => {
                  const json = JSON.stringify(decoded, null, 2);
                  const blob = new Blob([json], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ghost_${lap[ID_COL]}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                ⬇ Download Ghost JSON
              </button>
              {raw && (
                <button
                  className="btn"
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.9rem', background: '#1a1a1a', color: '#F5C518', border: '1px solid #F5C518' }}
                  title="Raw gzip bytes exactly as stored in DB (base64-decoded)"
                  onClick={() => {
                    try {
                      const cleaned = String(raw).trim();
                      const bin = atob(cleaned);
                      const u8 = new Uint8Array(bin.length);
                      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                      const blob = new Blob([u8], { type: 'application/gzip' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `ghost_${lap[ID_COL]}.json.gz`;
                      a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) {
                      console.warn('Raw ghost download failed:', err.message);
                    }
                  }}
                >
                  ⬇ Download Ghost (gzip)
                </button>
              )}
            </div>
          )}

          {!decoded && (
            <div style={{ color: '#FF1744', marginTop: '0.5rem' }}>
              Ghost data decode error (invalid base64/gzip/JSON)
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Ranking + Telemetry Module ──────────────────────────────────
export default function RankingTelemetry({ tableName, pageTitle, pageSubtitle, pageIcon, onReload, hideControls = false, reloadTrigger = 0 }) {
  // Dropdown data
  const [classes, setClasss] = useState([]);
  const [tracks,  setTracks]  = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedTrackId, setSelectedTrackId] = useState('');

  // Main lap data (no ghostData)
  const [laps,    setLaps]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Ghost on-demand state
  // ghostMap: id → { decoded, lapMs, intermediates }
  const [ghostMap,     setGhostMap]     = useState(new Map());
  const [ghostLoading, setGhostLoading] = useState(new Set());
  const [ghostChecked, setGhostChecked] = useState(new Set()); // user-toggled checkboxes

  // Set of IDs for the top-RANKING_SIZE rows (auto-loaded)
  const [rankingIds, setRankingIds] = useState(new Set());

  // Expand / Analyze panels (keyed by row ID)
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [analyzeRows,  setAnalyzeRows]  = useState(new Set());

  // Filters & sort
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('all');
  const [sortKey,  setSortKey]  = useState('lapValueMs');
  const [sortDir,  setSortDir]  = useState('asc');
  const [sort2Key, setSort2Key] = useState('lapTimestamp'); // secondary sort
  const [sort2Dir, setSort2Dir] = useState('asc');

  // Bulk "Scarica tutti ghosts" progress
  const [bulkProgress, setBulkProgress] = useState({ active: false, done: 0, total: 0 });

  // Overview stats (global aggregates)
  const [overviewStats, setOverviewStats] = useState(null);
  // Flag comparison stats (global, per class/track)
  const [flagStats, setFlagStats] = useState(null);

  // Player coverage stats (global)
  const [playerCoverage, setPlayerCoverage] = useState(null);
  const [expandedPlayers, setExpandedPlayers] = useState(new Set());
  const [coverageMinPct, setCoverageMinPct] = useState(0);
  const [completistiPage, setCompletistiPage] = useState(1);
  const [comboPage, setComboPage] = useState(1);
  const [distribPage, setDistribPage] = useState(1);
  const [distribSearch, setDistribSearch] = useState('');

  // ── Speed Traps definitions (loaded once) ─────────────────────────
  const [speedTrapsDefs, setSpeedTrapsDefs] = useState([]);

  // ── Player profile search ─────────────────────────────────────────
  const [profileSearch, setProfileSearch] = useState('');
  const [profilePlayer, setProfilePlayer] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Telemetry comparison — up to 2 ghost IDs
  const [compareIds, setCompareIds] = useState([]);
  // Pagination
  const [page, setPage] = useState(1);
  const bulkAbort = useRef(false);

  // Ref to avoid double-fetching: tracks ids that are fetched OR in-progress
  const fetchedIds = useRef(new Set());

  // ── Load class & track dropdowns on mount ────────────────────────
  useEffect(() => {
    Promise.all([
      fetch('/api/classes').then(r => r.json()),
      fetch('/api/tracks').then(r => r.json()),
    ]).then(([cls, trk]) => {
      if (cls.success) setClasss(cls.data);
      if (trk.success) setTracks(trk.data);
    }).catch(err => console.error('Failed to load dropdowns:', err));

    // Load overview stats (global aggregates)
    fetch(`/api/stats/overview?table=${tableName}`).then(r => r.json())
      .then(json => { if (json.success) setOverviewStats(json.data); })
      .catch(err => console.error('Failed to load overview stats:', err));

    // Load flag comparison stats
    fetch(`/api/stats/flags?table=${tableName}`).then(r => r.json())
      .then(json => { if (json.success) setFlagStats(json); })
      .catch(err => console.error('Failed to load flag stats:', err));

    // Load speed-trap definitions (used by Speed Traps Analyzer)
    fetch('/api/speedtraps').then(r => r.json())
      .then(json => { if (json.success) setSpeedTrapsDefs(json.data || []); })
      .catch(err => console.error('Failed to load speed traps defs:', err));
  }, [tableName]);

  // ── Load player coverage stats on mount ─────────────────────────
  useEffect(() => {
    fetch(`/api/stats/player-coverage?table=${tableName}`).then(r => r.json())
      .then(json => { if (json.success) setPlayerCoverage(json); })
      .catch(err => console.error('Failed to load player coverage:', err));
  }, [tableName]);

  // ── Reset data when selection changes ────────────────────────────
  useEffect(() => {
    setLaps([]);
    setGhostMap(new Map());
    setGhostChecked(new Set());
    setRankingIds(new Set());
    setExpandedRows(new Set());
    setAnalyzeRows(new Set());
    setError(null);
    setBulkProgress({ active: false, done: 0, total: 0 });
    setCompareIds([]);
    setPage(1);
    bulkAbort.current = false;
    fetchedIds.current = new Set();
  }, [selectedClassId, selectedTrackId]);

  // ── Auto-load when both class and track are selected ─────────────
  useEffect(() => {
    if (selectedClassId && selectedTrackId) {
      handleLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedTrackId]);

  // ── Fetch a single ghost by ID (no-op if already fetched) ────────
  const fetchGhost = useCallback(async (id) => {
    if (!id || fetchedIds.current.has(id)) return;
    fetchedIds.current.add(id);
    setGhostLoading(prev => new Set([...prev, id]));
    try {
      const res  = await fetch(`/api/ghost/${id}?table=${tableName}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success && json.ghostData) {
        const info = buildGhostInfo(json.ghostData);
        setGhostMap(prev => new Map([...prev, [id, info]]));
      }
    } catch (err) {
      console.warn('fetchGhost failed for id', id, err.message);
      fetchedIds.current.delete(id); // allow retry
    } finally {
      setGhostLoading(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [tableName]); // stable — relies on ref, not state

  // ── Auto-fetch ghosts for top-20 per intermediate (Speed Traps per-intermediate analyzer)
  useEffect(() => {
    if (!laps.length) return;
    const trapDef = speedTrapsDefs.find(d =>
      Number(d.idTrack) === Number(selectedTrackId) &&
      Number(d.idClass) === Number(selectedClassId)
    );
    if (!trapDef) return;
    const interCols = ['lapValueI1Ms', 'lapValueI2Ms', 'lapValueI3Ms'];
    const ids = new Set();
    interCols.forEach(col => {
      const top = [...laps]
        .filter(r => r[col] != null && r.hasGhostData !== false)
        .sort((a, b) => Number(a[col]) - Number(b[col]))
        .slice(0, 20);
      top.forEach(r => { if (r[ID_COL]) ids.add(r[ID_COL]); });
    });
    ids.forEach(id => { if (!fetchedIds.current.has(id)) fetchGhost(id); });
  }, [laps, selectedTrackId, selectedClassId, speedTrapsDefs, fetchGhost]);

  // ── Auto-load ranking: top RANKING_SIZE by lapValueMs ────────────
  const autoLoadRanking = useCallback(async (data) => {
    if (!data?.length) return;
    const top = [...data]
      .filter(r => r.lapValueMs !== null && r.lapValueMs !== undefined)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs))
      .slice(0, RANKING_SIZE);
    const ids = new Set(top.map(r => r[ID_COL]).filter(Boolean));
    setRankingIds(ids);
    // fetch in parallel (20 rows max), skip rows without ghostData
    await Promise.all(top.filter(r => r.hasGhostData !== false).map(r => fetchGhost(r[ID_COL])));
  }, [fetchGhost]);

  // ── Fetch main lap list ───────────────────────────────────────────
  const fetchLaps = useCallback(async () => {
    if (!selectedClassId || !selectedTrackId) return [];
    setLoading(true);
    setError(null);
    setLaps([]);
    setGhostMap(new Map());
    setGhostChecked(new Set());
    setRankingIds(new Set());
    setExpandedRows(new Set());
    setAnalyzeRows(new Set());
    setBulkProgress({ active: false, done: 0, total: 0 });
    bulkAbort.current = false;
    fetchedIds.current = new Set();
    try {
      const res  = await fetch(`/api/ghosts?classId=${selectedClassId}&trackId=${selectedTrackId}&table=${tableName}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Server error');
      setLaps(json.data);
      return json.data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [selectedClassId, selectedTrackId, tableName]);

  // ── Load handler ──────────────────────────────────────────────────
  // reloadGlobal === true  → ricarica anche overview/flags (solo da "Ricarica")
  // default (false)        → solo laps per la combo selezionata
  const handleLoad = useCallback(async (reloadGlobal) => {
    const data = await fetchLaps();
    if (data?.length) autoLoadRanking(data);
    if (reloadGlobal === true) {
      fetch(`/api/stats/overview?table=${tableName}`, { cache: 'no-store' }).then(r => r.json())
        .then(json => { if (json.success) setOverviewStats(json.data); })
        .catch(err => console.error('overview reload failed:', err));
      fetch(`/api/stats/flags?table=${tableName}`, { cache: 'no-store' }).then(r => r.json())
        .then(json => { if (json.success) setFlagStats(json); })
        .catch(err => console.error('flags reload failed:', err));
    }
  }, [fetchLaps, autoLoadRanking]);

  // ── External reload trigger (from parent, e.g. DuelMode) ─────────
  // Keep a stable ref so the effect below doesn't re-run on every handleLoad change
  const handleLoadRef = useRef(null);
  useEffect(() => { handleLoadRef.current = handleLoad; });
  useEffect(() => {
    if (!reloadTrigger) return; // skip 0 / undefined (initial render)
    handleLoadRef.current?.(true);
  }, [reloadTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bulk: load all ghosts for ranking rows not yet fetched ───────
  const loadAllRankingGhosts = async () => {
    const toLoad = laps.filter(r =>
      rankingIds.has(r[ID_COL]) &&
      !ghostMap.has(r[ID_COL]) &&
      !ghostLoading.has(r[ID_COL])
    );
    if (!toLoad.length) return;
    bulkAbort.current = false;
    setBulkProgress({ active: true, done: 0, total: toLoad.length });
    let done = 0;
    for (const row of toLoad) {
      if (bulkAbort.current) break;
      await fetchGhost(row[ID_COL]);
      done++;
      setBulkProgress(p => ({ ...p, done }));
    }
    setBulkProgress(p => ({ ...p, active: false }));
  };

  // ── Toggle ghost checkbox ────────────────────────────────────────
  function toggleGhostCheck(lap) {
    const id = lap[ID_COL];
    if (!id || lap.hasGhostData === false) return;
    const wasChecked = ghostChecked.has(id);
    setGhostChecked(prev => {
      const n = new Set(prev);
      wasChecked ? n.delete(id) : n.add(id);
      return n;
    });
    if (!wasChecked) fetchGhost(id);
  }

  // ── Toggle expand / analyze panels ──────────────────────────────
  function toggleExpand(id) {
    setExpandedRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAnalyze(id) {
    setAnalyzeRows(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Toggle telemetry compare (max 2) ──────────────────────────
  function toggleCompare(id) {
    const lap = laps.find(r => r[ID_COL] === id);
    if (!lap || lap.hasGhostData === false) return;
    // Load ghost if not yet loaded
    if (!ghostMap.has(id)) fetchGhost(id);
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // replace oldest
      return [...prev, id];
    });
  }

  // ── Reset to page 1 when search or filter changes ────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [search, filter, laps]);

  // ── Sort ─────────────────────────────────────────────────────────
  // Click = primary sort   |   Shift+Click = secondary sort
  function handleSort(key, shiftKey = false) {
    if (shiftKey) {
      if (sort2Key === key) setSort2Dir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSort2Key(key); setSort2Dir('asc'); }
    } else {
      if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
      else { setSortKey(key); setSortDir('asc'); }
    }
    setPage(1);
  }
  // Reset to default: Tempo ASC + Data ASC (sportiva)
  function resetSort() {
    setSortKey('lapValueMs');
    setSortDir('asc');
    setSort2Key('lapTimestamp');
    setSort2Dir('asc');
    setPage(1);
  }
  function sortIcon(key) {
    if (sortKey === key)  return <span className="sort-icon sort-p">{sortDir  === 'asc' ? '↑' : '↓'}</span>;
    if (sort2Key === key) return <span className="sort-icon sort-s">{sort2Dir === 'asc' ? '↑' : '↓'}</span>;
    return <span className="sort-icon">⇅</span>;
  }

  // ── Derived: DB columns (from first row) ─────────────────────────
  const dbColumns = useMemo(() => {
    if (!laps.length) return [];
    const SKIP = new Set(['hasGhostData', 'idTrack', 'idClass', 'idDriver', 'trackName', 'className']);
    return Object.keys(laps[0]).filter(k => !SKIP.has(k));
  }, [laps]);

  // ── Derived: ranking positions (1 = fastest) ─────────────────────
  const rankingPositions = useMemo(() => {
    const pos = new Map();
    [...laps]
      .filter(r => rankingIds.has(r[ID_COL]))
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs))
      .forEach((r, i) => pos.set(r[ID_COL], i + 1));
    return pos;
  }, [laps, rankingIds]);

  // ── Derived: posizione sportiva assoluta (lapValueMs, su tutti i laps) ──
  // Indipendente dal sort corrente e dal filtro — il giro più veloce è sempre #1
  const absoluteRanks = useMemo(() => {
    if (!laps.length) return new Map();
    const m = new Map();
    [...laps]
      .filter(r => r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs))
      .forEach((r, i) => m.set(r[ID_COL], i + 1));
    return m;
  }, [laps]);

  // ── Derived: laps ordinati per lapValueMs (per tooltip gap) ──────────
  const lapsSortedByTime = useMemo(() => (
    [...laps].filter(r => r.lapValueMs != null)
             .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs))
  ), [laps]);

  // ── Derived: ranking di settore (S1/S2/S3) per tooltip ────────────────
  const sectorRanks = useMemo(() => {
    const cols = ['lapValueI1Ms', 'lapValueI2Ms', 'lapValueI3Ms'];
    const result = {};
    for (const col of cols) {
      const m = new Map();
      [...laps]
        .filter(r => r[col] != null)
        .sort((a, b) => {
          const aMs = MICRO_COLS.has(col) ? Math.round(Number(a[col]) / 1000) : Number(a[col]);
          const bMs = MICRO_COLS.has(col) ? Math.round(Number(b[col]) / 1000) : Number(b[col]);
          return aMs - bMs;
        })
        .forEach((r, i) => m.set(r[ID_COL], i + 1));
      result[col] = m;
    }
    return result;
  }, [laps]);

  // ── Derived: displayed rows (filtered + sorted) ──────────────────
  const displayed = useMemo(() => {
    let rows = laps;

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))
      );
    }

    // Status filter (only for rows that have a ghost loaded)
    if (filter !== 'all') {
      rows = rows.filter(r => {
        const g = ghostMap.get(r[ID_COL]);
        if (!g) return false;
        const dbMs = r.lapValueMs !== null ? Number(r.lapValueMs) : null;
        const diff = dbMs !== null && g.lapMs !== null ? dbMs - g.lapMs : null;
        return computeMatchStatus(diff) === filter;
      });
    }

    // Sort — primary key (user-selected) + secondary lapTimestamp ASC tiebreaker
    rows = [...rows].sort((a, b) => {
      let av, bv;
      if (sortKey === '_ghostLapMs') {
        av = ghostMap.get(a[ID_COL])?.lapMs ?? null;
        bv = ghostMap.get(b[ID_COL])?.lapMs ?? null;
      } else if (sortKey === '_diff') {
        const ag = ghostMap.get(a[ID_COL]);
        const bg = ghostMap.get(b[ID_COL]);
        av = ag ? Number(a.lapValueMs) - ag.lapMs : null;
        bv = bg ? Number(b.lapValueMs) - bg.lapMs : null;
      } else {
        av = a[sortKey];
        bv = b[sortKey];
      }
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      const primary = sortDir === 'asc' ? cmp : -cmp;
      if (primary !== 0) return primary;
      // Secondary: user-configurable (default: lapTimestamp ASC)
      if (sort2Key) {
        const av2 = a[sort2Key] ?? '';
        const bv2 = b[sort2Key] ?? '';
        if (av2 === null || av2 === undefined) return 1;
        if (bv2 === null || bv2 === undefined) return -1;
        const cmp2 = av2 < bv2 ? -1 : av2 > bv2 ? 1 : 0;
        return sort2Dir === 'asc' ? cmp2 : -cmp2;
      }
      return 0;
    });

    return rows;
  }, [laps, search, filter, sortKey, sortDir, sort2Key, sort2Dir, ghostMap]);

  // ── Derived: absolute best times (across ALL laps, page-independent) ──
  const bestTimes = useMemo(() => {
    if (!laps.length) return {};
    const minOf = vals => vals.length ? Math.min(...vals) : null;
    return {
      lapValueMs:   minOf(laps.map(r => r.lapValueMs   != null ? Number(r.lapValueMs)                        : null).filter(v => v != null)),
      lapValueI1Ms: minOf(laps.map(r => r.lapValueI1Ms != null ? Math.round(Number(r.lapValueI1Ms) / 1000)   : null).filter(v => v != null)),
      lapValueI2Ms: minOf(laps.map(r => r.lapValueI2Ms != null ? Math.round(Number(r.lapValueI2Ms) / 1000)   : null).filter(v => v != null)),
      lapValueI3Ms: minOf(laps.map(r => r.lapValueI3Ms != null ? Number(r.lapValueI3Ms)                      : null).filter(v => v != null)),
    };
  }, [laps]);

  // ── Derived: paginated rows (slice of displayed) ──────────────────────
  const totalPages = Math.max(1, Math.ceil(displayed.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pagedRows  = useMemo(
    () => displayed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [displayed, safePage]
  );

  // ── Derived: stats ───────────────────────────────────────────────
  const stats = useMemo(() => {
    let match = 0, close = 0, mismatch = 0, na = 0;
    for (const row of laps) {
      const g = ghostMap.get(row[ID_COL]);
      if (!g) continue;
      const dbMs = row.lapValueMs !== null ? Number(row.lapValueMs) : null;
      const diff = dbMs !== null && g.lapMs !== null ? dbMs - g.lapMs : null;
      const s    = computeMatchStatus(diff);
      if (s === 'match')    match++;
      else if (s === 'close')    close++;
      else if (s === 'mismatch') mismatch++;
      else na++;
    }
    return { total: laps.length, withGhost: ghostMap.size, match, close, mismatch, na };
  }, [laps, ghostMap]);

  // ── Overview aggregation ─────────────────────────────────────────
  const overviewAgg = useMemo(() => {
    if (!overviewStats) return null;
    const total = overviewStats.reduce((s, r) => s + Number(r.count), 0);
    const byTrack = {};
    const byClass = {};
    for (const r of overviewStats) {
      byTrack[r.trackName] = (byTrack[r.trackName] || 0) + Number(r.count);
      byClass[r.className] = (byClass[r.className] || 0) + Number(r.count);
    }
    return { total, byTrack, byClass, combos: overviewStats };
  }, [overviewStats]);

  // ── Global flag comparisons (per class/track, from /api/stats/flags) ──
  const globalComparisons = useMemo(() => {
    if (!flagStats) return null;
    const idx = (arr, flagField) => {
      const m = {};
      for (const r of arr) {
        const k = `${r.className}|||${r.trackName}`;
        if (!m[k]) m[k] = {};
        m[k][r[flagField]] = { bestLap: Number(r.bestLap), cnt: Number(r.cnt) };
      }
      return m;
    };
    const cmIdx = idx(flagStats.controlMode, 'controlMode');
    const atIdx = idx(flagStats.autoTransmission, 'autoTransmission');
    const csIdx = idx(flagStats.cameraStabilizer, 'cameraStabilizer');
    const allKeys = new Set([...Object.keys(cmIdx), ...Object.keys(atIdx), ...Object.keys(csIdx)]);
    const pct = (a, b) => (a && b) ? ((b / a - 1) * 100).toFixed(2) : null;
    const rows = [...allKeys].sort().map(key => {
      const [className, trackName] = key.split('|||');
      const cm = cmIdx[key] || {}; const at = atIdx[key] || {}; const cs = csIdx[key] || {};
      const vcMs     = cm[0]?.bestLap ?? null;
      const stickMs  = cm[1]?.bestLap ?? null;
      const autoMs   = at[1]?.bestLap ?? null;
      const manualMs = at[0]?.bestLap ?? null;
      const stabOnMs = cs[1]?.bestLap ?? null;
      const stabOffMs= cs[0]?.bestLap ?? null;
      return { className, trackName, vcMs, stickMs, cmPct: pct(vcMs, stickMs),
               autoMs, manualMs, atPct: pct(autoMs, manualMs),
               stabOnMs, stabOffMs, csPct: pct(stabOnMs, stabOffMs) };
    });
    const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
    const avgCm = avg(rows.filter(r => r.cmPct != null).map(r => parseFloat(r.cmPct)));
    const avgAt = avg(rows.filter(r => r.atPct != null).map(r => parseFloat(r.atPct)));
    const avgCs = avg(rows.filter(r => r.csPct != null).map(r => parseFloat(r.csPct)));
    return { rows, avgCm, avgAt, avgCs };
  }, [flagStats]);

  // ── Flag aggregate counts for pie charts ─────────────────────────
  const flagAgg = useMemo(() => {
    if (!flagStats) return null;
    const sum = (arr, key, val) => arr.filter(r => Number(r[key]) === val).reduce((s, r) => s + Number(r.cnt), 0);
    return {
      vc:     sum(flagStats.controlMode,      'controlMode',      0),
      stick:  sum(flagStats.controlMode,      'controlMode',      1),
      manual: sum(flagStats.autoTransmission, 'autoTransmission', 0),
      auto:   sum(flagStats.autoTransmission, 'autoTransmission', 1),
      stabOn: sum(flagStats.cameraStabilizer, 'cameraStabilizer', 1),
      stabOff:sum(flagStats.cameraStabilizer, 'cameraStabilizer', 0),
    };
  }, [flagStats]);

  // ── Player coverage aggregation ─────────────────────────────────
  const coverageData = useMemo(() => {
    if (!playerCoverage || !tracks.length || !classes.length) return null;
    const { matrix, playerCombos } = playerCoverage;
    const matrixMap = {};
    for (const r of matrix) matrixMap[`${r.idTrack}-${r.idClass}`] = r;
    const allCombos = [];
    for (const t of tracks) for (const c of classes) allCombos.push({ idTrack: t.id, trackName: t.name, idClass: c.id, className: c.name });
    const totalCombos = allCombos.length;
    const heatmap = allCombos.map(c => {
      const m = matrixMap[`${c.idTrack}-${c.idClass}`];
      return { ...c, uniquePlayers: m ? Number(m.uniquePlayers) : 0, totalLaps: m ? Number(m.totalLaps) : 0 };
    });
    const maxPlayers = Math.max(...heatmap.map(h => h.uniquePlayers), 1);
    const playerMap = {};
    for (const pc of playerCombos) {
      if (!playerMap[pc.driverNickname]) playerMap[pc.driverNickname] = { combos: new Set(), totalLaps: 0 };
      playerMap[pc.driverNickname].combos.add(`${pc.idTrack}-${pc.idClass}`);
      playerMap[pc.driverNickname].totalLaps += Number(pc.laps);
    }
    const players = Object.entries(playerMap)
      .map(([name, data]) => ({
        name, comboCount: data.combos.size, totalLaps: data.totalLaps,
        coverage: totalCombos > 0 ? (data.combos.size / totalCombos * 100) : 0,
        combos: data.combos,
        missing: allCombos.filter(c => !data.combos.has(`${c.idTrack}-${c.idClass}`)),
      }))
      .sort((a, b) => b.comboCount - a.comboCount || b.totalLaps - a.totalLaps);
    const combosByPop = [...heatmap].sort((a, b) => b.uniquePlayers - a.uniquePlayers);
    const combosByLeast = [...heatmap].sort((a, b) => a.uniquePlayers - b.uniquePlayers);
    const coveredCombos = heatmap.filter(h => h.uniquePlayers > 0).length;
    const coveragePct = totalCombos > 0 ? (coveredCombos / totalCombos * 100).toFixed(0) : 0;
    const avgPlayersPerCombo = heatmap.length > 0 ? (heatmap.reduce((s, h) => s + h.uniquePlayers, 0) / heatmap.length).toFixed(1) : '0';
    const emptyCombos = heatmap.filter(h => h.uniquePlayers === 0).length;
    const maxLaps = players.length > 0 ? Math.max(...players.map(p => p.totalLaps)) : 1;
    return { heatmap, maxPlayers, totalCombos, players, totalPlayers: players.length, combosByPop, combosByLeast, avgPlayersPerCombo, emptyCombos, coveredCombos, coveragePct, maxLaps };
  }, [playerCoverage, tracks, classes]);

  // ── Stick vs Virtual Cockpit comparison ──────────────────────────
  const controlModeComparison = useMemo(() => {
    if (!laps.length) return null;
    const vc = laps
      .filter(r => r.controlMode === 0 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const stick = laps
      .filter(r => r.controlMode === 1 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const fastVC = vc[0] || null;
    const fastStick = stick[0] || null;
    if (!fastVC && !fastStick) return null;
    const vcMs = fastVC ? Number(fastVC.lapValueMs) : null;
    const stickMs = fastStick ? Number(fastStick.lapValueMs) : null;
    const diffMs = (vcMs !== null && stickMs !== null) ? stickMs - vcMs : null;
    const pct = (vcMs !== null && stickMs !== null && vcMs > 0)
      ? ((stickMs / vcMs) * 100).toFixed(2) : null;
    return { fastVC, fastStick, vcMs, stickMs, diffMs, pct, vcCount: vc.length, stickCount: stick.length };
  }, [laps]);

  // ── Auto vs Manual Transmission comparison ────────────────────────
  const transmissionComparison = useMemo(() => {
    if (!laps.length) return null;
    const auto = laps
      .filter(r => r.autoTransmission === 1 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const manual = laps
      .filter(r => r.autoTransmission === 0 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const fastAuto = auto[0] || null;
    const fastManual = manual[0] || null;
    if (!fastAuto && !fastManual) return null;
    const autoMs = fastAuto ? Number(fastAuto.lapValueMs) : null;
    const manualMs = fastManual ? Number(fastManual.lapValueMs) : null;
    const diffMs = (autoMs !== null && manualMs !== null) ? manualMs - autoMs : null;
    const pct = (autoMs !== null && manualMs !== null && autoMs > 0)
      ? ((manualMs / autoMs) * 100).toFixed(2) : null;
    return { fastAuto, fastManual, autoMs, manualMs, diffMs, pct, autoCount: auto.length, manualCount: manual.length };
  }, [laps]);

  // ── Stabilizer ON vs OFF comparison ──────────────────────────────
  const stabilizerComparison = useMemo(() => {
    if (!laps.length) return null;
    const on = laps
      .filter(r => r.cameraStabilizer === 1 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const off = laps
      .filter(r => r.cameraStabilizer === 0 && r.lapValueMs != null)
      .sort((a, b) => Number(a.lapValueMs) - Number(b.lapValueMs));
    const fastOn = on[0] || null;
    const fastOff = off[0] || null;
    if (!fastOn && !fastOff) return null;
    const onMs = fastOn ? Number(fastOn.lapValueMs) : null;
    const offMs = fastOff ? Number(fastOff.lapValueMs) : null;
    const diffMs = (onMs !== null && offMs !== null) ? offMs - onMs : null;
    const pct = (onMs !== null && offMs !== null && onMs > 0)
      ? ((offMs / onMs) * 100).toFixed(2) : null;
    return { fastOn, fastOff, onMs, offMs, diffMs, pct, onCount: on.length, offCount: off.length };
  }, [laps]);

  // ── Top 3 per settore ────────────────────────────────────────────
  const sectorRankings = useMemo(() => {
    if (!laps.length) return null;
    const toMs = (val, isMicro) =>
      val != null ? (isMicro ? Math.round(Number(val) / 1000) : Number(val)) : null;
    const rank = (col, isMicro) => laps
      .map(r => ({ id: r.id, driverNickname: r.driverNickname, _sMs: toMs(r[col], isMicro) }))
      .filter(r => r._sMs != null)
      .sort((a, b) => a._sMs - b._sMs)
      .slice(0, 3);
    return {
      s1: rank('lapValueI1Ms', true),
      s2: rank('lapValueI2Ms', true),
      s3: rank('lapValueI3Ms', false),
    };
  }, [laps]);

  // ── UI helpers ───────────────────────────────────────────────────
  const canLoad = Boolean(selectedClassId && selectedTrackId);
  const selectedClassName = classes.find(c => String(c.id) === String(selectedClassId))?.name ?? '';
  const selectedTrackName = tracks.find(t => String(t.id) === String(selectedTrackId))?.name ?? '';
  const rankingGhostsDone = [...rankingIds].filter(id => ghostMap.has(id)).length;
  const allRankingLoaded  = rankingIds.size > 0 && rankingGhostsDone >= rankingIds.size;

  // Columns: expand + rank + DB cols + ghost ☑ + ghost time + diff + status + analyze btn
  const totalCols = 1 + 1 + dbColumns.length + 1 + 1 + 1 + 1 + 1;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!hideControls && (
            <button
              className="btn"
              style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem', opacity: 0.7 }}
              onClick={() => { window.location.hash = ''; }}
              title="Back to Dashboard"
            >
              ← Home
            </button>
          )}
          <h1>{pageIcon} {pageTitle} <span>{pageSubtitle}</span></h1>
        </div>
        {!hideControls && (
          <button
            className="btn btn-primary"
            onClick={() => { handleLoad(true); if (onReload) onReload(); }}
            disabled={loading}
          >
            {loading ? 'Loading…' : '⟳ Reload'}
          </button>
        )}
      </header>

      {/* ── Global quick-stats bar ──── */}
      {(overviewAgg || coverageData) && (
        <div className="global-stats-bar">
          {overviewAgg && (
            <div className="global-stat">
              <span className="global-stat-value">{overviewAgg.total}</span>
              <span className="global-stat-label">Laps in DB</span>
            </div>
          )}
          {coverageData && (
            <div className="global-stat">
              <span className="global-stat-value">{coverageData.totalPlayers}</span>
              <span className="global-stat-label">Players</span>
            </div>
          )}
          {coverageData && (
            <div className="global-stat">
              <span className="global-stat-value">{coverageData.totalCombos}</span>
              <span className="global-stat-label">Combinations</span>
            </div>
          )}
        </div>
      )}

      {/* ── Overview Stats (global aggregates) ──── */}
      {overviewAgg && (
        <details className="overview-section">
          <summary className="overview-summary">
            General Statistics — {overviewAgg.total} total laps in database
          </summary>
          <div className="overview-content">
            <div className="overview-charts">
              <div className="overview-chart-card">
                <h4>Laps by Track</h4>
                <PieChart
                  id="pie-tracks"
                  labels={Object.keys(overviewAgg.byTrack).map(k => `${k} (${overviewAgg.byTrack[k]})`)}
                  data={Object.values(overviewAgg.byTrack)}
                />
              </div>
              <div className="overview-chart-card">
                <h4>Laps by Class</h4>
                <PieChart
                  id="pie-classes"
                  labels={Object.keys(overviewAgg.byClass).map(k => `${k} (${overviewAgg.byClass[k]})`)}
                  data={Object.values(overviewAgg.byClass)}
                />
              </div>
              {flagAgg && (<>
                <div className="overview-chart-card">
                  <h4>🎮 Stick vs ⎈ Virtual Cockpit</h4>
                  <PieChart
                    id="pie-control"
                    labels={[`⎈ VC (${flagAgg.vc})`, `🎮 Stick (${flagAgg.stick})`]}
                    data={[flagAgg.vc, flagAgg.stick]}
                  />
                </div>
                <div className="overview-chart-card">
                  <h4>⚙ Auto vs M Manual</h4>
                  <PieChart
                    id="pie-transmission"
                    labels={[`A Auto (${flagAgg.auto})`, `M Manual (${flagAgg.manual})`]}
                    data={[flagAgg.auto, flagAgg.manual]}
                  />
                </div>
                <div className="overview-chart-card">
                  <h4>📷 Stabilizer ON vs OFF</h4>
                  <PieChart
                    id="pie-stabilizer"
                    labels={[`📷 ON (${flagAgg.stabOn})`, `— OFF (${flagAgg.stabOff})`]}
                    data={[flagAgg.stabOn, flagAgg.stabOff]}
                  />
                </div>
              </>)}
            </div>
            <details className="overview-combos">
              <summary>Detail by Class / Track Combination</summary>
              <table className="overview-combo-table">
                <thead>
                  <tr><th>Class</th><th>Track</th><th>Laps</th></tr>
                </thead>
                <tbody>
                  {[...overviewAgg.combos]
                    .sort((a, b) => Number(b.count) - Number(a.count))
                    .map((r, i) => (
                      <tr key={i}>
                        <td>{r.className}</td>
                        <td>{r.trackName}</td>
                        <td>{r.count}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </div>
        </details>
      )}

      {/* ── Global Flag Comparisons ──── */}
      {globalComparisons && (
        <details className="overview-section">
          <summary className="overview-summary">
            Global Comparisons — {globalComparisons.rows.length} class/track combinations
          </summary>
          <div className="overview-content">
            <table className="overview-combo-table global-flags-table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Class</th>
                  <th>⎈ VC</th>
                  <th>🎮 Stick</th>
                  <th>% Stick/VC</th>
                  <th><span style={{ color: '#48bb78', fontWeight: 700 }}>M</span> Manual</th>
                  <th><span style={{ color: '#ecc94b', fontWeight: 700 }}>A</span> Auto</th>
                  <th>% M/A</th>
                  <th>📷 ON</th>
                  <th>📷 OFF</th>
                  <th>% OFF/ON</th>
                </tr>
              </thead>
              <tbody>
                {globalComparisons.rows.map((r, i) => {
                  const fmtPct = (v) => v != null
                    ? <span style={{ color: parseFloat(v) > 0 ? '#FF1744' : parseFloat(v) < 0 ? '#68d391' : '#a0aec0' }}>
                        {parseFloat(v) > 0 ? '+' : ''}{v}%
                      </span>
                    : <span style={{ color: '#2a2a2a' }}>—</span>;
                  return (
                    <tr key={i}>
                      <td>{r.trackName}</td>
                      <td>{r.className}</td>
                      <td className="time-value">{r.vcMs ? msToTime(r.vcMs) : '—'}</td>
                      <td className="time-value">{r.stickMs ? msToTime(r.stickMs) : '—'}</td>
                      <td>{fmtPct(r.cmPct)}</td>
                      <td className="time-value">{r.manualMs ? msToTime(r.manualMs) : '—'}</td>
                      <td className="time-value">{r.autoMs ? msToTime(r.autoMs) : '—'}</td>
                      <td>{fmtPct(r.atPct)}</td>
                      <td className="time-value">{r.stabOnMs ? msToTime(r.stabOnMs) : '—'}</td>
                      <td className="time-value">{r.stabOffMs ? msToTime(r.stabOffMs) : '—'}</td>
                      <td>{fmtPct(r.csPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="global-flags-avg">
                  <td colSpan={2}>Global average</td>
                  <td colSpan={2} />
                  <td>{globalComparisons.avgCm != null
                    ? <strong style={{ color: parseFloat(globalComparisons.avgCm) > 0 ? '#FF1744' : '#68d391' }}>
                        {parseFloat(globalComparisons.avgCm) > 0 ? '+' : ''}{globalComparisons.avgCm}%
                      </strong> : '—'}</td>
                  <td colSpan={2} />
                  <td>{globalComparisons.avgAt != null
                    ? <strong style={{ color: parseFloat(globalComparisons.avgAt) > 0 ? '#FF1744' : '#68d391' }}>
                        {parseFloat(globalComparisons.avgAt) > 0 ? '+' : ''}{globalComparisons.avgAt}%
                      </strong> : '—'}</td>
                  <td colSpan={2} />
                  <td>{globalComparisons.avgCs != null
                    ? <strong style={{ color: parseFloat(globalComparisons.avgCs) > 0 ? '#FF1744' : '#68d391' }}>
                        {parseFloat(globalComparisons.avgCs) > 0 ? '+' : ''}{globalComparisons.avgCs}%
                      </strong> : '—'}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}

      {/* ── Player Coverage Analysis ──── */}
      {coverageData && (
        <details className="overview-section">
          <summary className="overview-summary">
            Player Coverage — {coverageData.totalPlayers} players · {coverageData.totalCombos} combinations · {coverageData.coveragePct}% covered
          </summary>
          <div className="overview-content">

            {/* A — Matrice di Copertura */}
            <details className="coverage-inner-details" open>
              <summary className="coverage-inner-summary">Coverage Matrix (Track x Class)</summary>
              <div className="coverage-matrix-scroll">
                <table className="coverage-matrix">
                  <thead>
                    <tr>
                      <th className="coverage-corner">Track \\ Class</th>
                      {classes.map(c => <th key={c.id} title={c.name}>{c.name}</th>)}
                      <th className="coverage-total-hdr">Tot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracks.map(t => {
                      const cells = classes.map(c => coverageData.heatmap.find(h => h.idTrack === t.id && h.idClass === c.id) || { uniquePlayers: 0, totalLaps: 0 });
                      const rowTot = cells.reduce((s, d) => s + d.uniquePlayers, 0);
                      return (
                        <tr key={t.id}>
                          <td className="coverage-track-name">{t.name}</td>
                          {cells.map((d, i) => {
                            const ratio = d.uniquePlayers / coverageData.maxPlayers;
                            const bg = d.uniquePlayers === 0 ? '#1a1a1a' : `hsl(${Math.round(120 * ratio)}, 55%, ${18 + Math.round(14 * ratio)}%)`;
                            return (
                              <td key={i} className="coverage-cell" style={{ background: bg }}
                                  title={`${t.name} / ${classes[i].name}\n${d.uniquePlayers} players - ${d.totalLaps} laps`}>
                                <span className="coverage-cell-main">{d.uniquePlayers}</span>
                                {d.totalLaps > 0 && <span className="coverage-cell-sub">{d.totalLaps}L</span>}
                              </td>
                            );
                          })}
                          <td className="coverage-total-cell">{rowTot}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="coverage-total-label">Tot</td>
                      {classes.map(c => {
                        const colTot = tracks.reduce((s, t) => {
                          const cell = coverageData.heatmap.find(h => h.idTrack === t.id && h.idClass === c.id);
                          return s + (cell ? cell.uniquePlayers : 0);
                        }, 0);
                        return <td key={c.id} className="coverage-total-cell">{colTot}</td>;
                      })}
                      <td className="coverage-total-cell coverage-grand-total">
                        {coverageData.heatmap.reduce((s, h) => s + h.uniquePlayers, 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>

            {/* B — Completionist Rankings */}
            <details className="coverage-inner-details">
              <summary className="coverage-inner-summary">Completionist Rankings ({coverageData.totalPlayers} players)</summary>
              <div className="coverage-filter-bar">
                <label>Minimum coverage:</label>
                <select value={coverageMinPct} onChange={e => { setCoverageMinPct(Number(e.target.value)); setCompletistiPage(1); }}>
                  <option value={0}>All</option>
                  <option value={25}>≥ 25%</option>
                  <option value={50}>≥ 50%</option>
                  <option value={75}>≥ 75%</option>
                  <option value={100}>100%</option>
                </select>
              </div>
              {(() => {
                const filtered = coverageData.players.filter(p => p.coverage >= coverageMinPct);
                const totalPg = Math.max(1, Math.ceil(filtered.length / 20));
                const safePg = Math.min(completistiPage, totalPg);
                const paged = filtered.slice((safePg - 1) * 20, safePg * 20);
                return (<>
                  <table className="coverage-players-table">
                    <thead>
                      <tr><th>#</th><th>Player</th><th>Combos</th><th>Coverage</th><th>Total Laps</th></tr>
                    </thead>
                    <tbody>
                      {paged.map((p, i) => {
                        const globalIdx = (safePg - 1) * 20 + i;
                        const pctColor = p.coverage >= 75 ? '#48bb78' : p.coverage >= 40 ? '#ecc94b' : '#FF1744';
                        const isOpen = expandedPlayers.has(p.name);
                        return (
                          <Fragment key={p.name}>
                            <tr className="coverage-player-row" onClick={() => setExpandedPlayers(prev => { const n = new Set(prev); n.has(p.name) ? n.delete(p.name) : n.add(p.name); return n; })}>
                              <td>{globalIdx + 1}</td>
                              <td className="coverage-player-name">{isOpen ? '▼' : '▶'} {p.name}</td>
                              <td>{p.comboCount}/{coverageData.totalCombos}</td>
                              <td>
                                <div className="coverage-progress-bar">
                                  <div className="coverage-progress-fill" style={{ width: `${p.coverage}%`, background: pctColor }} />
                                </div>
                                <span className="coverage-pct-label" style={{ color: pctColor }}>{p.coverage.toFixed(0)}%</span>
                              </td>
                              <td>{p.totalLaps}</td>
                            </tr>
                            {isOpen && p.missing.length > 0 && (
                              <tr className="coverage-missing-row">
                                <td colSpan={5}>
                                  <div className="coverage-missing-block">
                                    <span className="coverage-missing-title">Missing combinations ({p.missing.length}):</span>
                                    <div className="coverage-missing-chips">
                                      {p.missing.map((m, j) => (
                                        <span key={j} className="coverage-missing-chip">{m.trackName} / {m.className}</span>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                            {isOpen && p.missing.length === 0 && (
                              <tr className="coverage-missing-row">
                                <td colSpan={5}>
                                  <span style={{ color: '#48bb78', fontWeight: 600 }}>All combinations covered!</span>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  {totalPg > 1 && (
                    <div className="coverage-pagination">
                      <button className="coverage-page-btn" onClick={() => setCompletistiPage(pg => Math.max(1, pg - 1))} disabled={safePg === 1}>‹ Prev</button>
                      <span className="coverage-page-info">Page {safePg} / {totalPg} — {filtered.length} players</span>
                      <button className="coverage-page-btn" onClick={() => setCompletistiPage(pg => Math.min(totalPg, pg + 1))} disabled={safePg === totalPg}>Next ›</button>
                    </div>
                  )}
                </>);
              })()}
            </details>

            {/* C — Combinations Piu / Meno Popolari */}
            <details className="coverage-inner-details">
              <summary className="coverage-inner-summary">Most / Least Popular Combinations</summary>
              {(() => {
                const pgSize = 10;
                const totalPg = Math.max(1, Math.ceil(coverageData.combosByPop.length / pgSize));
                const safePg = Math.min(comboPage, totalPg);
                const topPaged = coverageData.combosByPop.slice((safePg - 1) * pgSize, safePg * pgSize);
                const botPaged = coverageData.combosByLeast.slice((safePg - 1) * pgSize, safePg * pgSize);
                const baseIdx = (safePg - 1) * pgSize;
                return (<>
                  <div className="coverage-popular-grid">
                    <div className="coverage-popular-card">
                      <h4 className="coverage-card-title" style={{ color: '#48bb78' }}>Top — Most Players</h4>
                      {topPaged.map((c, i) => (
                        <div key={i} className="coverage-popular-item">
                          <span className="coverage-pop-rank">{baseIdx + i + 1}</span>
                          <span className="coverage-pop-name">{c.trackName} / {c.className}</span>
                          <span className="coverage-pop-count">{c.uniquePlayers} players · {c.totalLaps} laps</span>
                        </div>
                      ))}
                    </div>
                    <div className="coverage-popular-card">
                      <h4 className="coverage-card-title" style={{ color: '#FF1744' }}>Bottom — Fewest Players</h4>
                      {botPaged.map((c, i) => (
                        <div key={i} className="coverage-popular-item">
                          <span className="coverage-pop-rank" style={{ background: c.uniquePlayers === 0 ? '#4a1010' : '#3a2800' }}>{baseIdx + i + 1}</span>
                          <span className="coverage-pop-name">{c.trackName} / {c.className}</span>
                          <span className="coverage-pop-count">{c.uniquePlayers === 0 ? 'No players' : `${c.uniquePlayers} players · ${c.totalLaps} laps`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {totalPg > 1 && (
                    <div className="coverage-pagination">
                      <button className="coverage-page-btn" onClick={() => setComboPage(pg => Math.max(1, pg - 1))} disabled={safePg === 1}>‹ Prev</button>
                      <span className="coverage-page-info">Page {safePg} / {totalPg} — {coverageData.combosByPop.length} combinations</span>
                      <button className="coverage-page-btn" onClick={() => setComboPage(pg => Math.min(totalPg, pg + 1))} disabled={safePg === totalPg}>Next ›</button>
                    </div>
                  )}
                  <div className="coverage-stats-summary">
                    <div className="coverage-stat-chip">Average: <strong>{coverageData.avgPlayersPerCombo}</strong> players/combo</div>
                    <div className="coverage-stat-chip">Combos covered: <strong>{coverageData.coveredCombos}/{coverageData.totalCombos}</strong></div>
                    <div className="coverage-stat-chip">Empty combos: <strong style={{ color: coverageData.emptyCombos > 0 ? '#FF1744' : '#48bb78' }}>{coverageData.emptyCombos}</strong></div>
                  </div>
                </>);
              })()}
            </details>

            {/* D — Distribuzione Giri per Player */}
            <details className="coverage-inner-details">
              <summary className="coverage-inner-summary">Lap Distribution by Player</summary>
              <div className="coverage-filter-bar">
                <label>Search player:</label>
                <input
                  type="text"
                  className="coverage-search-input"
                  placeholder="Filter by name..."
                  value={distribSearch}
                  onChange={e => { setDistribSearch(e.target.value); setDistribPage(1); }}
                />
                {distribSearch && (
                  <button className="coverage-clear-btn" onClick={() => { setDistribSearch(''); setDistribPage(1); }}>✕</button>
                )}
              </div>
              {(() => {
                const filtered = coverageData.players.filter(p =>
                  !distribSearch || p.name.toLowerCase().includes(distribSearch.toLowerCase())
                );
                const totalPg = Math.max(1, Math.ceil(filtered.length / 30));
                const safePg = Math.min(distribPage, totalPg);
                const paged = filtered.slice((safePg - 1) * 30, safePg * 30);
                const baseIdx = (safePg - 1) * 30;
                return (<>
                  <div className="coverage-bar-chart">
                    {paged.map((p, i) => (
                      <div key={p.name} className="coverage-bar-row">
                        <span className="coverage-bar-name" title={p.name}>{p.name}</span>
                        <div className="coverage-bar-track">
                          <div className="coverage-bar-fill" style={{
                            width: `${(p.totalLaps / coverageData.maxLaps * 100).toFixed(1)}%`,
                            background: `hsl(${210 + ((baseIdx + i) * 3) % 40}, 60%, ${45 + ((baseIdx + i) * 2) % 15}%)`
                          }} />
                        </div>
                        <span className="coverage-bar-value">{p.totalLaps}</span>
                      </div>
                    ))}
                  </div>
                  {totalPg > 1 && (
                    <div className="coverage-pagination">
                      <button className="coverage-page-btn" onClick={() => setDistribPage(pg => Math.max(1, pg - 1))} disabled={safePg === 1}>‹ Prev</button>
                      <span className="coverage-page-info">Page {safePg} / {totalPg} — {filtered.length} players</span>
                      <button className="coverage-page-btn" onClick={() => setDistribPage(pg => Math.min(totalPg, pg + 1))} disabled={safePg === totalPg}>Next ›</button>
                    </div>
                  )}
                  <div className="coverage-stats-summary">
                    <div className="coverage-stat-chip">Total players: <strong>{coverageData.totalPlayers}</strong></div>
                    <div className="coverage-stat-chip">Avg laps/player: <strong>{coverageData.totalPlayers > 0 ? (coverageData.players.reduce((s, p) => s + p.totalLaps, 0) / coverageData.totalPlayers).toFixed(1) : 0}</strong></div>
                    <div className="coverage-stat-chip">Most active: <strong style={{ color: '#F5C518' }}>{coverageData.players[0]?.name}</strong> ({coverageData.players[0]?.totalLaps} laps)</div>
                    <div className="coverage-stat-chip">With only 1 lap: <strong>{coverageData.players.filter(p => p.totalLaps === 1).length}</strong></div>
                  </div>
                </>);
              })()}
            </details>

          </div>
        </details>
      )}

      {/* ── Player Profile Search ──── */}
      {coverageData && (
        <details className="overview-section">
          <summary className="overview-summary">
            Player Search — positions and gaps for each combination
          </summary>
          <div className="overview-content">
            <div className="profile-search-bar">
              <input
                className="profile-search-input"
                type="text"
                placeholder="Search nickname…"
                value={profileSearch}
                onChange={e => setProfileSearch(e.target.value)}
                list="profile-players-list"
              />
              <datalist id="profile-players-list">
                {coverageData.players.map(p => (
                  <option key={p.name} value={p.name} />
                ))}
              </datalist>
              <button
                className="profile-search-btn"
                disabled={!profileSearch.trim() || profileLoading}
                onClick={() => {
                  const name = profileSearch.trim();
                  if (!name) return;
                  setProfilePlayer(name);
                  setProfileData(null);
                  setProfileLoading(true);
                  fetch(`/api/stats/player-profile?player=${encodeURIComponent(name)}&table=${tableName}`)
                    .then(r => r.json())
                    .then(json => { if (json.success) setProfileData(json); })
                    .catch(err => console.error('player-profile error:', err))
                    .finally(() => setProfileLoading(false));
                }}
              >
                {profileLoading ? '…' : 'Search'}
              </button>
              {profilePlayer && (
                <button
                  className="coverage-clear-btn"
                  onClick={() => { setProfileSearch(''); setProfilePlayer(null); setProfileData(null); }}
                >
                  ✕ Reset
                </button>
              )}
            </div>

            {/* Risultati */}
            {profileLoading && <p className="profile-loading">Loading profile…</p>}
            {profileData && !profileLoading && (
              <div className="profile-result">
                <h4 className="profile-name">
                  {profileData.player}
                  <span className="profile-sub">
                    {profileData.profile.length} combinations · {profileData.profile.reduce((s, r) => s + r.lapCount, 0)} total laps
                  </span>
                </h4>
                <table className="profile-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Track</th>
                      <th>Pos</th>
                      <th>/ Tot</th>
                      <th>Best Time</th>
                      <th>Gap to Leader</th>
                      <th>Laps</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileData.profile.map((r, i) => {
                      const isLeader = r.pos === 1;
                      const posColor = r.pos === 1 ? '#f6c90e' : r.pos === 2 ? '#c0c0c0' : r.pos === 3 ? '#cd7f32' : '#a0aec0';
                      const gapMs = r.gap;
                      const gapStr = gapMs === 0 ? '—' : `+${msToTime(gapMs)}`;
                      return (
                        <tr key={i} className={isLeader ? 'profile-row-leader' : ''}>
                          <td>{r.className}</td>
                          <td>{r.trackName}</td>
                          <td style={{ color: posColor, fontWeight: 700 }}>{r.pos}°</td>
                          <td className="profile-total">{r.total}</td>
                          <td className="profile-time">{msToTime(r.playerBest)}</td>
                          <td className={gapMs === 0 ? 'profile-gap-zero' : 'profile-gap'}>
                            {gapStr}
                          </td>
                          <td className="profile-laps">{r.lapCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {profilePlayer && !profileLoading && profileData && profileData.profile.length === 0 && (
              <p className="profile-empty">No laps found for <strong>{profilePlayer}</strong>.</p>
            )}
          </div>
        </details>
      )}

      {/* Selectors */}
      <div className="selectors-bar">
        <label>Class:</label>
        <select
          value={selectedClassId}
          onChange={e => setSelectedClassId(e.target.value)}
          disabled={loading}
        >
          <option value="">— select class —</option>
          {classes.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <label>Track:</label>
        <select
          value={selectedTrackId}
          onChange={e => setSelectedTrackId(e.target.value)}
          disabled={loading}
        >
          <option value="">— select track —</option>
          {tracks.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        {canLoad && !laps.length && !loading && (
          <button className="btn btn-primary" onClick={handleLoad}>
            Load Laps
          </button>
        )}

        {!canLoad && (
          <span className="selector-hint">
            Select both class and track to load laps
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <span>Loading laps for {selectedClassName} @ {selectedTrackName}…</span>
        </div>
      )}

      {/* Main content */}
      {!loading && laps.length > 0 && (
        <>
          {/* Stats */}
          <div className="stats-bar">
            <div className="stat-card blue">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">Total Laps</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-value">{stats.withGhost}</div>
              <div className="stat-label">Ghosts Loaded</div>
            </div>
            <div className="stat-card green">
              <div className="stat-value">{stats.match}</div>
              <div className="stat-label">Match (=0 ms)</div>
            </div>
            <div className="stat-card yellow">
              <div className="stat-value">{stats.close}</div>
              <div className="stat-label">Close (≤{CLOSE_THRESHOLD_MS} ms)</div>
            </div>
            <div className="stat-card red">
              <div className="stat-value">{stats.mismatch}</div>
              <div className="stat-label">Different</div>
            </div>
            {stats.na > 0 && (
              <div className="stat-card">
                <div className="stat-value">{stats.na}</div>
                <div className="stat-label">N/A ghost</div>
              </div>
            )}
          </div>

          {/* Filters + search + Scarica tutti ghosts */}
          <div className="filters">
            <label>Filter:</label>
            {['all', 'match', 'close', 'mismatch', 'na'].map(f => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`}
                style={filter !== f ? { background: '#1e1e1e', color: '#888888' } : {}}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}

            <label style={{ marginLeft: '0.5rem' }}>Search:</label>
            <input
              type="text"
              placeholder="name, track, id…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '180px' }}
            />

            {/* Scarica tutti ghosts — classifica */}
            {rankingIds.size > 0 && (
              <button
                className={`btn btn-sm ${bulkProgress.active ? '' : allRankingLoaded ? '' : 'btn-primary'}`}
                style={bulkProgress.active
                  ? { background: '#3a2800', color: '#F5C518' }
                  : allRankingLoaded
                  ? { background: '#22543d', color: '#9ae6b4' }
                  : {}}
                onClick={loadAllRankingGhosts}
                disabled={bulkProgress.active || allRankingLoaded}
                title={`Ranking: top ${rankingIds.size} — ${selectedClassName} @ ${selectedTrackName}`}
              >
                {bulkProgress.active
                  ? `⏳ Ranking ghosts ${bulkProgress.done}/${bulkProgress.total}…`
                  : allRankingLoaded
                  ? `✓ Ranking ghosts (${rankingGhostsDone}/${rankingIds.size})`
                  : `⬇ Download ranking ghosts (${rankingGhostsDone}/${rankingIds.size})`}
              </button>
            )}

            <span style={{ color: '#666666', fontSize: '0.78rem' }}>
              {displayed.length} / {laps.length} laps
            </span>
          </div>

          {/* ── Confronti Rapidi (collassabile) ──── */}
          {(controlModeComparison || transmissionComparison || stabilizerComparison) && (
            <details className="comparisons-section">
              <summary className="comparisons-summary">
                Quick Comparisons — 🎮 Stick/VC · ⚙ Auto/M · 📷 Stabilizer
              </summary>
              <div className="comparisons-content">

          {/* ── Stick vs Virtual Cockpit comparison ──── */}
          {controlModeComparison && (
            <div className="control-mode-banner">
              <div className="cm-title">🎮 Stick vs ⎈ Virtual Cockpit</div>
              <div className="cm-grid">
                <div className="cm-card">
                  <div className="cm-label">⎈ Virtual Cockpit ({controlModeComparison.vcCount} laps)</div>
                  <div className="cm-value">
                    {controlModeComparison.fastVC
                      ? <>
                          <span className="time-value">{msToTime(controlModeComparison.vcMs)}</span>
                          <span className="cm-driver">{controlModeComparison.fastVC.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                <div className="cm-card">
                  <div className="cm-label">🎮 Stick ({controlModeComparison.stickCount} laps)</div>
                  <div className="cm-value">
                    {controlModeComparison.fastStick
                      ? <>
                          <span className="time-value">{msToTime(controlModeComparison.stickMs)}</span>
                          <span className="cm-driver">{controlModeComparison.fastStick.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                {controlModeComparison.diffMs !== null && (
                  <div className="cm-card cm-diff">
                    <div className="cm-label">Difference (Stick − VC)</div>
                    <div className="cm-value">
                      <span className={`diff-cell ${controlModeComparison.diffMs > 0 ? 'mismatch' : controlModeComparison.diffMs === 0 ? 'match' : 'close'}`}>
                        {formatDiff(controlModeComparison.diffMs)}
                      </span>
                      {controlModeComparison.pct && (
                        <span className="cm-percentage">{controlModeComparison.pct}%</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Auto vs Manual Transmission comparison ──── */}
          {transmissionComparison && (
            <div className="control-mode-banner">
              <div className="cm-title">⚙ Automatic vs M Manual</div>
              <div className="cm-grid">
                <div className="cm-card">
                  <div className="cm-label">
                    <span style={{ color: '#ecc94b', fontWeight: 700 }}>A</span> Automatic ({transmissionComparison.autoCount} laps)
                  </div>
                  <div className="cm-value">
                    {transmissionComparison.fastAuto
                      ? <>
                          <span className="time-value">{msToTime(transmissionComparison.autoMs)}</span>
                          <span className="cm-driver">{transmissionComparison.fastAuto.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                <div className="cm-card">
                  <div className="cm-label">
                    <span style={{ color: '#48bb78', fontWeight: 700 }}>M</span> Manual ({transmissionComparison.manualCount} laps)
                  </div>
                  <div className="cm-value">
                    {transmissionComparison.fastManual
                      ? <>
                          <span className="time-value">{msToTime(transmissionComparison.manualMs)}</span>
                          <span className="cm-driver">{transmissionComparison.fastManual.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                {transmissionComparison.diffMs !== null && (
                  <div className="cm-card cm-diff">
                    <div className="cm-label">Difference (M − A)</div>
                    <div className="cm-value">
                      <span className={`diff-cell ${transmissionComparison.diffMs > 0 ? 'mismatch' : transmissionComparison.diffMs === 0 ? 'match' : 'close'}`}>
                        {formatDiff(transmissionComparison.diffMs)}
                      </span>
                      {transmissionComparison.pct && (
                        <span className="cm-percentage">{transmissionComparison.pct}%</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Stabilizer ON vs OFF comparison ──── */}
          {stabilizerComparison && (
            <div className="control-mode-banner">
              <div className="cm-title">📷 Stabilizer ON vs OFF</div>
              <div className="cm-grid">
                <div className="cm-card">
                  <div className="cm-label">📷 Stabilizer ON ({stabilizerComparison.onCount} laps)</div>
                  <div className="cm-value">
                    {stabilizerComparison.fastOn
                      ? <>
                          <span className="time-value">{msToTime(stabilizerComparison.onMs)}</span>
                          <span className="cm-driver">{stabilizerComparison.fastOn.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                <div className="cm-card">
                  <div className="cm-label">
                    <span style={{ color: '#2a2a2a' }}>—</span> Stabilizer OFF ({stabilizerComparison.offCount} laps)
                  </div>
                  <div className="cm-value">
                    {stabilizerComparison.fastOff
                      ? <>
                          <span className="time-value">{msToTime(stabilizerComparison.offMs)}</span>
                          <span className="cm-driver">{stabilizerComparison.fastOff.driverNickname}</span>
                        </>
                      : <span style={{ color: '#666666' }}>No laps</span>}
                  </div>
                </div>
                {stabilizerComparison.diffMs !== null && (
                  <div className="cm-card cm-diff">
                    <div className="cm-label">Difference (OFF − ON)</div>
                    <div className="cm-value">
                      <span className={`diff-cell ${stabilizerComparison.diffMs > 0 ? 'mismatch' : stabilizerComparison.diffMs === 0 ? 'match' : 'close'}`}>
                        {formatDiff(stabilizerComparison.diffMs)}
                      </span>
                      {stabilizerComparison.pct && (
                        <span className="cm-percentage">{stabilizerComparison.pct}%</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

              </div>
            </details>
          )}

          {/* ── Classifica Settori (collassabile, chiuso) ──── */}
          {sectorRankings && (
            <details className="comparisons-section">
              <summary className="comparisons-summary">
                Sector Rankings — Top 3 per S1 · S2 · S3
              </summary>
              <div className="comparisons-content sector-rankings">
                {[
                  { label: 'S1', data: sectorRankings.s1 },
                  { label: 'S2', data: sectorRankings.s2 },
                  { label: 'S3', data: sectorRankings.s3 },
                ].map(({ label, data }) => (
                  <div key={label} className="sector-rank-block">
                    <div className="cm-title">Sector {label}</div>
                    <table className="inter-compare-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Driver</th>
                          <th>Lap ID</th>
                          <th>Tempo</th>
                          <th>ms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.map((r, i) => (
                          <tr key={r.id}>
                            <td><strong>{i + 1}</strong></td>
                            <td>{r.driverNickname}</td>
                            <td style={{ color: '#666666' }}>{r.id}</td>
                            <td className="time-value">{msToTime(r._sMs)}</td>
                            <td className="mono">{r._sMs} ms</td>
                          </tr>
                        ))}
                        {data.length === 0 && (
                          <tr>
                            <td colSpan={5} style={{ color: '#666666', textAlign: 'center' }}>No data</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* ── Classifica (collassabile, aperta di default) ──── */}
          <details className="overview-section" open>
            <summary className="overview-summary">
              Rankings — {displayed.length} / {laps.length} laps
              {selectedClassName && (
                <span style={{ color: '#888888', fontWeight: 300, marginLeft: '0.5rem' }}>
                  | {selectedClassName} @ {selectedTrackName}
                </span>
              )}
            </summary>
            <div style={{ padding: '0 0 0.5rem' }}>

          {/* Sort controls bar */}
          {laps.length > 0 && (
            <div className="sort-controls">
              <span className="sort-ctl-item">
                <span className="sort-p" title="Primary sort (click on columns)">①</span>
                <span className="sort-ctl-label">{COL_LABELS[sortKey] ?? sortKey} {sortDir === 'asc' ? '↑' : '↓'}</span>
              </span>
              <span className="sort-sep">·</span>
              <span className="sort-ctl-item">
                <span className="sort-s" title="Secondary sort (tiebreaker)">②</span>
                <select
                  className="sort2-select"
                  value={sort2Key}
                  onChange={e => { setSort2Key(e.target.value); setPage(1); }}
                >
                  <option value="">— none —</option>
                  {[...dbColumns, '_ghostLapMs', '_diff'].map(col => (
                    <option key={col} value={col}>
                      {COL_LABELS[col] ?? (col === '_ghostLapMs' ? 'G.Time' : col === '_diff' ? 'Diff' : col)}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm sort2-dir-btn"
                  disabled={!sort2Key}
                  onClick={() => { setSort2Dir(d => d === 'asc' ? 'desc' : 'asc'); setPage(1); }}
                  title="Toggle secondary sort direction"
                >
                  {sort2Dir === 'asc' ? '↑' : '↓'}
                </button>
              </span>
              <button
                className="btn btn-sm sort-default-btn"
                onClick={resetSort}
                title="Reset to default ranking: Time ASC → Date ASC"
              >🏆 Default</button>
            </div>
          )}

          {/* Ranking info banner */}
          {rankingIds.size > 0 && (
            <div className="ranking-label" style={{ margin: '0.4rem 1rem 0.5rem' }}>
              Top {rankingIds.size} auto-ranked:{' '}
              <strong>{selectedClassName}</strong> @ <strong>{selectedTrackName}</strong>
              <span className="ranking-ghost-count">
                {' '}({rankingGhostsDone}/{rankingIds.size} ghosts loaded)
              </span>
            </div>
          )}

          {/* Table */}
          <div className="table-wrapper">
            <table className="ghost-table">
              <thead>
                <tr>
                  <th style={{ width: '32px' }} />
                  <th style={{ width: '36px' }} title="Click: primary sort ① | Shift+Click: secondary sort ②">#</th>
                  {dbColumns.map(col => {
                    const flag = FLAG_COLUMNS[col];
                    const colW = COL_WIDTHS[col];
                    const isSorted1 = sortKey  === col;
                    const isSorted2 = sort2Key === col;
                    return (
                    <th
                      key={col}
                      className={isSorted1 ? 'sorted sort-p-col' : isSorted2 ? 'sorted sort-s-col' : ''}
                      onClick={e => handleSort(col, e.shiftKey)}
                      title={flag ? flag.title : `Click: sort by ${COL_LABELS[col] ?? col} | Shift+Click: secondary sort`}
                      style={flag
                        ? { width: '36px', textAlign: 'center', padding: '0.4rem 0.2rem' }
                        : colW ? { width: colW } : undefined}
                    >
                      {flag
                        ? <>{flag.header} {sortIcon(col)}</>
                        : <>{COL_LABELS[col] ?? col} {sortIcon(col)}</>}
                    </th>
                    );
                  })}
                  <th style={{ width: '80px' }} title="Load ghost">Ghost</th>
                  <th
                    className={sortKey === '_ghostLapMs' ? 'sorted sort-p-col' : sort2Key === '_ghostLapMs' ? 'sorted sort-s-col' : ''}
                    onClick={e => handleSort('_ghostLapMs', e.shiftKey)}
                    style={{ width: '80px' }}
                    title="Click: sort by Ghost Time | Shift+Click: secondary sort"
                  >
                    G.Time {sortIcon('_ghostLapMs')}
                  </th>
                  <th
                    className={sortKey === '_diff' ? 'sorted sort-p-col' : sort2Key === '_diff' ? 'sorted sort-s-col' : ''}
                    onClick={e => handleSort('_diff', e.shiftKey)}
                    style={{ width: '58px' }}
                    title="Click: sort by Difference | Shift+Click: secondary sort"
                  >
                    Diff {sortIcon('_diff')}
                  </th>
                  <th style={{ width: '75px' }}>Status</th>
                  <th style={{ width: '100px' }} />
                </tr>
              </thead>

              <tbody>
                {displayed.length === 0 ? (
                  <tr>
                    <td colSpan={totalCols} className="empty-state">
                      No records match the current filters.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((lap, idx) => {
                    const id            = lap[ID_COL] ?? idx;
                    const isRanking     = rankingIds.has(id);
                    const rankPos       = rankingPositions.get(id);
                    const hasGhostInDB  = lap.hasGhostData !== false;
                    const ghostOn       = (ghostChecked.has(id) || isRanking || compareIds.includes(id) || ghostMap.has(id)) && hasGhostInDB;
                    const ghost         = ghostMap.get(id);
                    const isGhostLd     = ghostLoading.has(id);
                    const isExpanded    = expandedRows.has(id);
                    const isAnalyzed    = analyzeRows.has(id);

                    // Ghost-derived values
                    let ghostLapMs = null, diff = null, matchStatus = 'na';
                    if (ghostOn && ghost) {
                      ghostLapMs  = ghost.lapMs;
                      const dbMs  = lap.lapValueMs !== null ? Number(lap.lapValueMs) : null;
                      diff        = dbMs !== null && ghostLapMs !== null ? dbMs - ghostLapMs : null;
                      matchStatus = computeMatchStatus(diff);
                    }

                    return (
                      <Fragment key={id}>
                        <tr className={isRanking ? 'ranking-row' : ''}>

                          {/* Expand toggle */}
                          <td>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'transparent', color: '#F5C518', padding: '0 0.3rem', fontSize: '0.9rem' }}
                              onClick={() => toggleExpand(id)}
                              title="DB Details"
                            >
                              {isExpanded ? '▼' : '▶'}
                            </button>
                          </td>

                          {/* Rank — posizione sportiva assoluta (lapValueMs su tutti i laps) */}
                          <td>
                            <span className="rank-badge">{absoluteRanks.get(id) ?? '—'}</span>
                          </td>

                          {/* DB columns */}
                          {dbColumns.map(col => {
                            const flag = FLAG_COLUMNS[col];
                            if (flag) {
                              return (
                                <td key={col} style={{ textAlign: 'center', padding: '0.3rem 0.2rem' }}>
                                  {flag.render(lap[col])}
                                </td>
                              );
                            }
                            if (INTER_COLS.has(col)) {
                              const rawVal = lap[col];
                              const ms = rawVal != null
                                ? (MICRO_COLS.has(col) ? Math.round(Number(rawVal) / 1000) : Number(rawVal))
                                : null;
                              const isBest   = ms != null && bestTimes[col] != null && ms === bestTimes[col];
                              const secRank  = sectorRanks[col]?.get(id);
                              const bestMs   = bestTimes[col];
                              const gapBest  = ms != null && bestMs != null ? ms - bestMs : null;
                              const totalSec = sectorRanks[col]?.size ?? 0;
                              const sLabel   = col === 'lapValueI1Ms' ? 'S1' : col === 'lapValueI2Ms' ? 'S2' : 'S3';
                              return (
                                <td key={col}>
                                  <span
                                    className="time-value time-gap-anchor"
                                    style={isBest ? { color: '#9f7aea', fontWeight: 700 } : {}}
                                  >
                                    {ms != null ? msToTime(ms) : '—'}
                                    {ms != null && (
                                      <span className="time-gap-tooltip">
                                        <strong>{sLabel} — P{secRank} / {totalSec}</strong>
                                        {gapBest !== null && gapBest > 0 && (
                                          <span>
                                            <span className="tgt-label">from best</span>
                                            <span className="tgt-val">{formatGap(gapBest)}</span>
                                          </span>
                                        )}
                                        {gapBest === 0 && <span className="tgt-leader">🟣 Best sector</span>}
                                      </span>
                                    )}
                                  </span>
                                </td>
                              );
                            }
                            // lapTimestamp: compact readable format
                            if (col === 'lapTimestamp') {
                              return (
                                <td key={col} title={String(lap[col] ?? '')}
                                    style={{ fontFamily: 'Courier New, monospace', fontSize: '0.73rem' }}>
                                  {fmtTimestamp(lap[col])}
                                </td>
                              );
                            }
                            // lapValueMs: tempo + tooltip gap da leader e da posizione precedente
                            if (col === 'lapValueMs') {
                              const ms     = lap[col] != null ? Number(lap[col]) : null;
                              const isBest = ms != null && bestTimes.lapValueMs != null && ms === bestTimes.lapValueMs;
                              const rank   = absoluteRanks.get(id);
                              const leaderMs = lapsSortedByTime[0]?.lapValueMs != null ? Number(lapsSortedByTime[0].lapValueMs) : null;
                              const prevRow  = rank > 1 ? lapsSortedByTime[rank - 2] : null;
                              const prevMs   = prevRow?.lapValueMs != null ? Number(prevRow.lapValueMs) : null;
                              const gapLeader = ms != null && leaderMs != null ? ms - leaderMs : null;
                              const gapPrev   = ms != null && prevMs  != null ? ms - prevMs   : null;
                              return (
                                <td key={col}>
                                  <span
                                    className="time-value time-gap-anchor"
                                    style={isBest ? { color: '#9f7aea', fontWeight: 700 } : {}}
                                  >
                                    {ms != null ? msToTime(ms) : '—'}
                                    {ms != null && (
                                      <span className="time-gap-tooltip">
                                        <strong>P{rank}</strong>
                                        {gapLeader !== null && gapLeader > 0 && (
                                          <span>
                                            <span className="tgt-label">from leader</span>
                                            <span className="tgt-val">{formatGap(gapLeader)}</span>
                                          </span>
                                        )}
                                        {gapLeader === 0 && <span className="tgt-leader">🏆 Leader</span>}
                                        {gapPrev !== null && rank > 1 && (
                                          <span>
                                            <span className="tgt-label">from P{rank - 1}</span>
                                            <span className="tgt-val">{formatGap(gapPrev)}</span>
                                          </span>
                                        )}
                                      </span>
                                    )}
                                  </span>
                                </td>
                              );
                            }
                            return (
                              <td key={col}>
                                {lap[col] === null || lap[col] === undefined
                                  ? <span style={{ color: '#2a2a2a' }}>—</span>
                                  : String(lap[col])}
                              </td>
                            );
                          })}

                          {/* Ghost checkbox + 📊 compare button */}
                          <td style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {!hasGhostInDB
                              ? <span title="ghostData missing from DB" style={{ color: '#FF1744', fontSize: '0.85rem', lineHeight: 1 }}>∅</span>
                              : isGhostLd
                              ? <span className="ghost-loading-dot">⏳</span>
                              : <input
                                  type="checkbox"
                                  className="ghost-checkbox"
                                  checked={ghostChecked.has(id) || isRanking || ghostMap.has(id)}
                                  disabled={isRanking}
                                  onChange={() => toggleGhostCheck(lap)}
                                  title={isRanking
                                    ? 'Ghost auto-loaded (ranking top 20)'
                                    : ghost
                                    ? 'Ghost loaded — uncheck to hide'
                                    : 'Load ghost on-demand'}
                                />}
                            <button
                              className={`compare-btn ${compareIds[0] === id ? 'active-g1' : compareIds[1] === id ? 'active-g2' : ''}`}
                              onClick={() => toggleCompare(id)}
                              disabled={!hasGhostInDB}
                              title={hasGhostInDB ? 'Graphical telemetry comparison (max 2)' : 'ghostData missing'}
                            >📊</button>
                          </td>

                          {/* Ghost lap time */}
                          <td>
                            {ghostOn && ghost
                              ? ghostLapMs !== null
                                ? <span className="time-value">{msToTime(ghostLapMs)}</span>
                                : <span style={{ color: '#FF1744', fontSize: '0.72rem' }}>Err decode</span>
                              : ghostOn && isGhostLd
                              ? <span style={{ color: '#666666' }}>…</span>
                              : null}
                          </td>

                          {/* Diff */}
                          <td>
                            {ghostOn && ghost && matchStatus
                              ? <DiffCell diff={diff} matchStatus={matchStatus} />
                              : null}
                          </td>

                          {/* Status badge */}
                          <td>
                            {ghostOn && ghost && matchStatus
                              ? <MatchBadge status={matchStatus} />
                              : null}
                          </td>

                          {/* Analizza Ghost button */}
                          <td>
                            {ghost && ghostOn
                              ? <button
                                  className={`btn btn-sm ${isAnalyzed ? 'btn-primary' : ''}`}
                                  style={!isAnalyzed ? { background: '#1e1e1e', color: '#888888' } : {}}
                                  onClick={() => toggleAnalyze(id)}
                                  title="Full ghost analysis (telemetry)"
                                >
                                  {isAnalyzed ? '▽ Ghost' : '▷ Ghost'}
                                </button>
                              : null}
                          </td>

                        </tr>

                        {/* Expanded DB details row */}
                        {isExpanded && (
                          <ExpandRow lap={lap} colCount={totalCols} />
                        )}

                        {/* Ghost analysis row */}
                        {isAnalyzed && ghost && (
                          <AnalyzeRow lap={lap} ghost={ghost} colCount={totalCols} />
                        )}

                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-sm pagination-btn" onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
              <button className="btn btn-sm pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === '…'
                    ? <span key={`ellipsis-${i}`} className="page-ellipsis">…</span>
                    : <button
                        key={item}
                        className={`btn btn-sm pagination-btn ${item === safePage ? 'active' : ''}`}
                        onClick={() => setPage(item)}
                      >{item}</button>
                )}
              <button className="btn btn-sm pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>›</button>
              <button className="btn btn-sm pagination-btn" onClick={() => setPage(totalPages)} disabled={safePage === totalPages}>»</button>
              <span className="page-info">{displayed.length} laps · page {safePage}/{totalPages}</span>
            </div>
          )}

            </div>{/* end collapsible content */}
          </details>{/* end Classifica details */}

          {/* ── Speed Traps Analyzer (top-20 ghosts) ─────────────── */}
          {(() => {
            const trapDef = speedTrapsDefs.find(d =>
              Number(d.idTrack) === Number(selectedTrackId) &&
              Number(d.idClass) === Number(selectedClassId)
            );
            if (!trapDef) return null;
            const traps = [
              { idx: 1, tao: Number(trapDef.lapSt1Tao) },
              { idx: 2, tao: Number(trapDef.lapSt2Tao) },
              { idx: 3, tao: Number(trapDef.lapSt3Tao) },
            ].filter(t => isFinite(t.tao));
            if (!traps.length) return null;

            const rows = [];
            for (const id of rankingIds) {
              const info = ghostMap.get(id);
              if (!info?.decoded) continue;
              const lap = laps.find(r => r[ID_COL] === id);
              const frames = info.decoded.frames || [];
              const trapSpeeds = traps.map(t => {
                const fromEvt = speedKmhFromEvents(info.decoded, t.idx);
                if (fromEvt != null) return fromEvt;
                return speedKmhAtProgress(frames, t.tao);
              });
              rows.push({
                id,
                driver: lap?.driverNickname || `#${id}`,
                lapMs: info.lapMs,
                speeds: trapSpeeds,
              });
            }
            if (!rows.length) return null;
            // sort by lap time
            rows.sort((a, b) => (a.lapMs ?? 1e15) - (b.lapMs ?? 1e15));

            const aggregates = traps.map((_, i) =>
              aggregateSpeeds(rows.map(r => r.speeds[i]))
            );
            const fmt = v => v == null ? '—' : `${v.toFixed(1)} km/h`;

            return (
              <details open style={{ marginTop: '1.5rem', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 6, padding: '0.75rem 1rem' }}>
                <summary style={{ cursor: 'pointer', color: '#F5C518', fontWeight: 700, letterSpacing: '0.04em' }}>
                  ▼ Speed Traps Analyzer — top {rows.length} ghosts
                </summary>
                <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#888', textAlign: 'left' }}>
                        <th style={{ padding: '0.4rem 0.6rem' }}>#</th>
                        <th style={{ padding: '0.4rem 0.6rem' }}>Driver</th>
                        <th style={{ padding: '0.4rem 0.6rem' }}>Lap</th>
                        {traps.map(t => (
                          <th key={t.idx} style={{ padding: '0.4rem 0.6rem', color: '#E91E63' }}>
                            T{t.idx}<br /><span style={{ fontSize: '0.7rem', color: '#555' }}>τ {t.tao.toFixed(4)}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #181818' }}>
                          <td style={{ padding: '0.35rem 0.6rem', color: '#666' }}>{i + 1}</td>
                          <td style={{ padding: '0.35rem 0.6rem', color: '#eee' }}>{r.driver}</td>
                          <td style={{ padding: '0.35rem 0.6rem', color: '#aaa', fontFamily: 'monospace' }}>{r.lapMs ? msToTime(r.lapMs) : '—'}</td>
                          {r.speeds.map((s, j) => (
                            <td key={j} style={{ padding: '0.35rem 0.6rem', fontFamily: 'monospace', color: '#F5C518' }}>{fmt(s)}</td>
                          ))}
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid #2a2a2a', background: '#141414' }}>
                        <td colSpan={3} style={{ padding: '0.4rem 0.6rem', color: '#888', fontWeight: 700 }}>MIN</td>
                        {aggregates.map((a, j) => (
                          <td key={j} style={{ padding: '0.4rem 0.6rem', color: '#48bb78', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(a.min)}</td>
                        ))}
                      </tr>
                      <tr style={{ background: '#141414' }}>
                        <td colSpan={3} style={{ padding: '0.4rem 0.6rem', color: '#888', fontWeight: 700 }}>AVG</td>
                        {aggregates.map((a, j) => (
                          <td key={j} style={{ padding: '0.4rem 0.6rem', color: '#F5C518', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(a.avg)}</td>
                        ))}
                      </tr>
                      <tr style={{ background: '#141414' }}>
                        <td colSpan={3} style={{ padding: '0.4rem 0.6rem', color: '#888', fontWeight: 700 }}>MAX</td>
                        {aggregates.map((a, j) => (
                          <td key={j} style={{ padding: '0.4rem 0.6rem', color: '#E91E63', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(a.max)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#555' }}>
                    Source: SpeedTrap events (new ghost format) or velocity interpolation at trap τ (legacy format)
                  </div>
                </div>
              </details>
            );
          })()}

          {/* ── Speed Traps Analyzer — per intermediate top-20 ───── */}
          {(() => {
            const trapDef = speedTrapsDefs.find(d =>
              Number(d.idTrack) === Number(selectedTrackId) &&
              Number(d.idClass) === Number(selectedClassId)
            );
            if (!trapDef) return null;
            const traps = [
              { idx: 1, tao: Number(trapDef.lapSt1Tao), interCol: 'lapValueI1Ms', label: 'S1' },
              { idx: 2, tao: Number(trapDef.lapSt2Tao), interCol: 'lapValueI2Ms', label: 'S2' },
              { idx: 3, tao: Number(trapDef.lapSt3Tao), interCol: 'lapValueI3Ms', label: 'S3' },
            ].filter(t => isFinite(t.tao));
            if (!traps.length || !laps.length) return null;

            const fmt = v => v == null ? '—' : `${v.toFixed(1)} km/h`;
            let totalLoaded = 0;
            let totalRequested = 0;

            const blocks = traps.map(t => {
              const top = [...laps]
                .filter(r => r[t.interCol] != null && r.hasGhostData !== false)
                .sort((a, b) => Number(a[t.interCol]) - Number(b[t.interCol]))
                .slice(0, 20);
              totalRequested += top.length;
              const items = top.map(lap => {
                const id = lap[ID_COL];
                const info = ghostMap.get(id);
                let speed = null;
                if (info?.decoded) {
                  totalLoaded += 1;
                  const fromEvt = speedKmhFromEvents(info.decoded, t.idx);
                  speed = fromEvt != null ? fromEvt : speedKmhAtProgress(info.decoded.frames || [], t.tao);
                }
                return {
                  id,
                  driver: lap.driverNickname || `#${id}`,
                  interMs: Number(lap[t.interCol]),
                  speed,
                  loaded: !!info?.decoded,
                };
              });
              const agg = aggregateSpeeds(items.map(i => i.speed));
              return { trap: t, items, agg };
            });

            const allLoaded = totalLoaded >= totalRequested;
            const headerNote = allLoaded
              ? `${totalLoaded} ghosts analysed`
              : `${totalLoaded} / ${totalRequested} ghosts loaded — fetching…`;

            return (
              <details open style={{ marginTop: '1rem', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 6, padding: '0.75rem 1rem' }}>
                <summary style={{ cursor: 'pointer', color: '#E91E63', fontWeight: 700, letterSpacing: '0.04em' }}>
                  ▼ Speed Traps Analyzer — per intermediate (top 20 by S1 / S2 / S3) — {headerNote}
                </summary>
                <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1rem' }}>
                  {blocks.map(({ trap, items, agg }) => (
                    <div key={trap.idx} style={{ background: '#0a0a0a', border: '1px solid #1a1a1a', borderRadius: 4, padding: '0.5rem 0.6rem' }}>
                      <div style={{ marginBottom: '0.4rem', color: '#F5C518', fontWeight: 700, fontSize: '0.85rem' }}>
                        T{trap.idx} — top 20 by {trap.label} <span style={{ color: '#555', fontWeight: 400 }}>(τ {trap.tao.toFixed(4)})</span>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#777', textAlign: 'left' }}>
                            <th style={{ padding: '0.25rem 0.4rem' }}>#</th>
                            <th style={{ padding: '0.25rem 0.4rem' }}>Driver</th>
                            <th style={{ padding: '0.25rem 0.4rem', textAlign: 'right' }}>Speed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => (
                            <tr key={it.id} style={{ borderBottom: '1px solid #151515' }}>
                              <td style={{ padding: '0.2rem 0.4rem', color: '#555' }}>{i + 1}</td>
                              <td style={{ padding: '0.2rem 0.4rem', color: '#ddd' }}>{it.driver}</td>
                              <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontFamily: 'monospace', color: it.loaded ? '#F5C518' : '#444' }}>
                                {it.loaded ? fmt(it.speed) : '…'}
                              </td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: '2px solid #2a2a2a', background: '#141414' }}>
                            <td colSpan={2} style={{ padding: '0.3rem 0.4rem', color: '#888', fontWeight: 700 }}>MIN</td>
                            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: '#48bb78', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(agg.min)}</td>
                          </tr>
                          <tr style={{ background: '#141414' }}>
                            <td colSpan={2} style={{ padding: '0.3rem 0.4rem', color: '#888', fontWeight: 700 }}>AVG</td>
                            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: '#F5C518', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(agg.avg)}</td>
                          </tr>
                          <tr style={{ background: '#141414' }}>
                            <td colSpan={2} style={{ padding: '0.3rem 0.4rem', color: '#888', fontWeight: 700 }}>MAX</td>
                            <td style={{ padding: '0.3rem 0.4rem', textAlign: 'right', color: '#E91E63', fontFamily: 'monospace', fontWeight: 700 }}>{fmt(agg.max)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#555' }}>
                  Each column ranks the top 20 laps by that specific intermediate (S1/S2/S3). Ghosts are auto-fetched on demand.
                </div>
              </details>
            );
          })()}

          {/* ── Telemetry Comparison View (sotto la tabella) ──── */}
          {compareIds.length > 0 && (() => {
            const g1id = compareIds[0];
            const g2id = compareIds[1];
            const g1data = ghostMap.get(g1id);
            const g2data = g2id ? ghostMap.get(g2id) : null;
            const g1lap = laps.find(r => r[ID_COL] === g1id);
            const g2lap = g2id ? laps.find(r => r[ID_COL] === g2id) : null;
            if (!g1data) return null;
            return (
              <GhostTelemetry
                ghost1={{ id: g1id, decoded: g1data.decoded, lapMs: g1data.lapMs, intermediates: g1data.intermediates, lap: g1lap }}
                ghost2={g2data ? { id: g2id, decoded: g2data.decoded, lapMs: g2data.lapMs, intermediates: g2data.intermediates, lap: g2lap } : null}
                onClose={() => setCompareIds([])}
              />
            );
          })()}
        </>
      )}

      {/* Empty state after load */}
      {!loading && !error && laps.length === 0 && canLoad && (
        <div className="empty-state">
          <p>No laps found for <strong>{selectedClassName}</strong> @ <strong>{selectedTrackName}</strong>.</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={handleLoad}>
            Retry
          </button>
        </div>
      )}

      {/* Initial state */}
      {!loading && !error && laps.length === 0 && !canLoad && (
        <div className="empty-state">
          Select class and track to start ghost analysis.
        </div>
      )}

      {/* Footer */}
      <div className="footer-info">
        netSkeleton.{tableName} · {selectedClassName || '—'} @ {selectedTrackName || '—'} ·{' '}
        ghostData: base64 → gzip → JSON · lapTime in seconds → ms
      </div>
    </div>
  );
}
