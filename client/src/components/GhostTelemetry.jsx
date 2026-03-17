import { useEffect, useRef, useMemo, Fragment } from 'react';
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import {
  enrichFramesWithDistance,
  calculateDerivedData,
  calculateAdvancedMetrics,
  calculateDistanceSectors,
  calculateFrequency,
  formatLapTimeSec,
} from '../utils/ghostAnalysis';
import './GhostTelemetry.css';

// Register Chart.js modules once
ChartJS.register(LineController, LineElement, PointElement, LinearScale, Tooltip, Legend, Filler, zoomPlugin);

const COLOR_G1 = '#63b3ed';
const COLOR_G2 = '#f6ad55';
const MAX_FRAMES_DISPLAY = 3000;

// ── Helpers ──────────────────────────────────────────────────────────

function fmtVec(v) {
  if (!v || typeof v.x !== 'number') return '—';
  const y = v.y != null ? v.y : 0;
  return `(${v.x.toFixed(2)}, ${y.toFixed(2)}, ${(v.z ?? 0).toFixed(2)})`;
}
function fmtQuat(q) {
  if (!q || typeof q.x !== 'number') return '—';
  return `(${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}, ${q.w.toFixed(2)})`;
}

function deltaClass(val) {
  if (val > 1e-6) return 'delta-red';
  if (val < -1e-6) return 'delta-green';
  return 'delta-yellow';
}

function deltaClassInv(val) {
  if (val > 1e-6) return 'delta-green';
  if (val < -1e-6) return 'delta-red';
  return 'delta-yellow';
}

function fmtDelta(v, dec = 3) {
  if (v === null || v === undefined || isNaN(v)) return 'N/A';
  return `${v > 0 ? '+' : ''}${v.toFixed(dec)}`;
}

// ── JSON Headers sub-component ───────────────────────────────────────

function JsonHeaders({ decoded, label, colorClass }) {
  if (!decoded) return null;
  const entries = Object.entries(decoded).filter(([k]) => k !== 'frames');
  if (!entries.length) return null;
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div className="gt-section-title" style={{ fontSize: '0.82rem' }}>
        JSON Headers — <span className={colorClass}>{label}</span>
      </div>
      <div className="gt-json-headers">
        {entries.map(([key, val]) => (
          <div key={key} className="gt-json-field">
            <div className="gt-jf-key">{key}</div>
            <div className="gt-jf-val">
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

// ── Frames Table sub-component ───────────────────────────────────────

function FramesTable({ frames, derivedData, label, colorClass }) {
  if (!frames || frames.length === 0) return null;
  const shown = frames.slice(0, MAX_FRAMES_DISPLAY);
  return (
    <details className="gt-frames-details">
      <summary>
        Recorded Frames — <span className={colorClass}>{label}</span> ({frames.length} frame)
      </summary>
      <div className="gt-frames-scroll">
        <table className="gt-frames-table">
          <thead>
            <tr>
              <th>#</th><th>Time (s)</th><th>Progress</th>
              <th>Position (x,y,z)</th><th>Rotation (x,y,z,w)</th><th>Velocity (x,y,z)</th>
              <th>Steering</th><th>Gas</th><th>Brake</th>
              <th>RPM</th><th>Gear</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f, i) => (
              <tr key={i}>
                <td>{i}</td>
                <td>{f.time?.toFixed(3) ?? '—'}</td>
                <td>{f.progress?.toFixed(4) ?? '—'}</td>
                <td className="gt-vec">{fmtVec(f.position)}</td>
                <td className="gt-vec">{fmtQuat(f.rotation)}</td>
                <td className="gt-vec">{fmtVec(f.velocity)}</td>
                <td>{derivedData?.steer?.[i]?.toFixed(2) ?? '—'}</td>
                <td>{derivedData?.gas?.[i]?.toFixed(2) ?? '—'}</td>
                <td>{derivedData?.brake?.[i]?.toFixed(2) ?? '—'}</td>
                <td>{f.rpm ?? '—'}</td>
                <td>{f.gear ?? '—'}</td>
              </tr>
            ))}
            {frames.length > MAX_FRAMES_DISPLAY && (
              <tr>
                <td colSpan={11} style={{ textAlign: 'center', color: '#718096', fontStyle: 'italic' }}>
                  … and {frames.length - MAX_FRAMES_DISPLAY} more frames not shown
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── Chart wrapper ────────────────────────────────────────────────────
// Uses a container div and creates/destroys the <canvas> dynamically
// inside useEffect so React StrictMode can't cause Chart.js collisions.

function TelemetryChart({ id, data1, data2, yLabel, yMin, yMax, lbl1 = 'Ghost 1', lbl2 = 'Ghost 2' }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create a fresh canvas each mount
    const canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    const datasets = [];
    if (data1) {
      datasets.push({
        label: lbl1,
        data: data1.y.map((y, i) => ({ x: data1.x[i], y })),
        borderColor: COLOR_G1,
        backgroundColor: COLOR_G1 + '33',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
      });
    }
    if (data2) {
      datasets.push({
        label: lbl2,
        data: data2.y.map((y, i) => ({ x: data2.x[i], y })),
        borderColor: COLOR_G2,
        backgroundColor: COLOR_G2 + '33',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0.1,
      });
    }
    if (datasets.length === 0) {
      container.removeChild(canvas);
      return;
    }

    const yAxisOpts = {
      title: { display: true, text: yLabel, color: '#a0aec0' },
      ticks: { color: '#a0aec0', precision: 2 },
      grid: { color: '#4a5568' },
    };
    if (yMin !== undefined) yAxisOpts.min = yMin;
    if (yMax !== undefined) yAxisOpts.max = yMax;

    chartRef.current = new ChartJS(ctx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: 'Lap Progress [0-1]', color: '#a0aec0' },
            ticks: { color: '#a0aec0' },
            grid: { color: '#4a5568' },
          },
          y: yAxisOpts,
        },
        plugins: {
          legend: {
            display: true,
            labels: { color: '#e2e8f0' },
            onHover: (e) => { if (e.native) e.native.target.style.cursor = 'pointer'; },
            onLeave: (e) => { if (e.native) e.native.target.style.cursor = 'default'; },
          },
          tooltip: { mode: 'index', intersect: false },
          zoom: {
            pan: { enabled: true, mode: 'xy' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'xy' },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [id, data1, data2, yLabel, yMin, yMax]);

  return (
    <div className="gt-chart-box" ref={containerRef} />
  );
}

// ── 2D Map (canvas) ──────────────────────────────────────────────────

function LapMap({ frames1, frames2 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const allFrames = [].concat(frames1 || [], frames2 || []);
    if (allFrames.length < 2) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }

    // Set canvas size based on container
    const container = canvas.parentElement;
    const containerWidth = container.clientWidth;
    const height = Math.max(200, Math.min(containerWidth / (16 / 9), window.innerHeight * 0.5));
    canvas.width = containerWidth;
    canvas.height = height;

    // Bounds
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    allFrames.forEach(f => {
      if (f?.position && typeof f.position.x === 'number' && typeof f.position.z === 'number') {
        minX = Math.min(minX, f.position.x); maxX = Math.max(maxX, f.position.x);
        minZ = Math.min(minZ, f.position.z); maxZ = Math.max(maxZ, f.position.z);
      }
    });
    const worldW = maxX - minX, worldH = maxZ - minZ;
    if (worldW < 1e-6 && worldH < 1e-6) return;

    const pad = 20;
    const drawW = canvas.width - 2 * pad, drawH = canvas.height - 2 * pad;
    if (drawW <= 0 || drawH <= 0) return;
    const scX = worldW < 1e-6 ? Infinity : drawW / worldW;
    const scZ = worldH < 1e-6 ? Infinity : drawH / worldH;
    const sc = Math.min(scX, scZ);
    if (!isFinite(sc) || sc <= 0) return;
    const offX = pad + (drawW - worldW * sc) / 2;
    const offZ = pad + (drawH - worldH * sc) / 2;
    const mX = (wx) => offX + (wx - minX) * sc;
    const mZ = (wz) => canvas.height - (offZ + (wz - minZ) * sc);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.font = '10px system-ui';

    // Draw Ghost 1
    if (frames1 && frames1.length > 0) {
      ctx.strokeStyle = COLOR_G1;
      ctx.beginPath();
      let started = false;
      frames1.forEach(f => {
        if (f?.position && typeof f.position.x === 'number' && typeof f.position.z === 'number') {
          const cx = mX(f.position.x), cy = mZ(f.position.z);
          if (!started) { ctx.moveTo(cx, cy); ctx.fillStyle = '#48bb78'; ctx.fillRect(cx - 3, cy - 3, 6, 6); ctx.fillStyle = '#a0aec0'; ctx.fillText('Start G1', cx + 6, cy); started = true; }
          else ctx.lineTo(cx, cy);
        }
      });
      if (started) {
        ctx.stroke();
        const last = [...frames1].reverse().find(f => f?.position && typeof f.position.x === 'number');
        if (last) { const ex = mX(last.position.x), ey = mZ(last.position.z); ctx.fillStyle = '#f56565'; ctx.fillRect(ex - 3, ey - 3, 6, 6); ctx.fillStyle = '#a0aec0'; ctx.fillText('End G1', ex + 6, ey); }
      }
    }

    // Draw Ghost 2
    if (frames2 && frames2.length > 0) {
      ctx.strokeStyle = COLOR_G2;
      ctx.beginPath();
      let started = false;
      frames2.forEach(f => {
        if (f?.position && typeof f.position.x === 'number' && typeof f.position.z === 'number') {
          const cx = mX(f.position.x), cy = mZ(f.position.z);
          if (!started) { ctx.moveTo(cx, cy); ctx.fillStyle = '#38bdf8'; ctx.fillRect(cx - 3, cy - 3, 6, 6); ctx.fillStyle = '#a0aec0'; ctx.fillText('Start G2', cx + 6, cy - 10); started = true; }
          else ctx.lineTo(cx, cy);
        }
      });
      if (started) {
        ctx.stroke();
        const last = [...frames2].reverse().find(f => f?.position && typeof f.position.x === 'number');
        if (last) { const ex = mX(last.position.x), ey = mZ(last.position.z); ctx.fillStyle = '#fb7185'; ctx.fillRect(ex - 3, ey - 3, 6, 6); ctx.fillStyle = '#a0aec0'; ctx.fillText('End G2', ex + 6, ey - 10); }
      }
    }
  }, [frames1, frames2]);

  return (
    <div className="gt-map-container">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ── Comparison Map (microsectors) ────────────────────────────────────

function ComparisonMap({ frames1, sectorData }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frames1 || frames1.length < 2 || !sectorData || sectorData.length === 0) return;

    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    const containerWidth = container.clientWidth;
    const height = Math.max(200, Math.min(containerWidth / (16 / 9), window.innerHeight * 0.5));
    canvas.width = containerWidth;
    canvas.height = height;

    // Bounds (Ghost 1 only)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    frames1.forEach(f => {
      if (f?.position && typeof f.position.x === 'number' && typeof f.position.z === 'number') {
        minX = Math.min(minX, f.position.x); maxX = Math.max(maxX, f.position.x);
        minZ = Math.min(minZ, f.position.z); maxZ = Math.max(maxZ, f.position.z);
      }
    });
    const worldW = maxX - minX, worldH = maxZ - minZ;
    if (worldW < 1e-6 && worldH < 1e-6) return;

    const pad = 20;
    const drawW = canvas.width - 2 * pad, drawH = canvas.height - 2 * pad;
    if (drawW <= 0 || drawH <= 0) return;
    const scX = worldW < 1e-6 ? Infinity : drawW / worldW;
    const scZ = worldH < 1e-6 ? Infinity : drawH / worldH;
    const sc = Math.min(scX, scZ);
    if (!isFinite(sc) || sc <= 0) return;
    const offX = pad + (drawW - worldW * sc) / 2;
    const offZ = pad + (drawH - worldH * sc) / 2;
    const mXf = (wx) => offX + (wx - minX) * sc;
    const mZf = (wz) => canvas.height - (offZ + (wz - minZ) * sc);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;

    for (let i = 1; i < frames1.length; i++) {
      const prev = frames1[i - 1], curr = frames1[i];
      if (!(prev?.position && typeof prev.position.x === 'number' && curr?.position && typeof curr.position.x === 'number')) continue;

      const midProg = (prev.progress + curr.progress) / 2;
      let sector = sectorData.find(s => midProg >= s.startP && midProg <= s.endP);
      if (!sector && i === frames1.length - 1 && midProg > 1.0) sector = sectorData[sectorData.length - 1];

      ctx.beginPath();
      ctx.moveTo(mXf(prev.position.x), mZf(prev.position.z));
      ctx.lineTo(mXf(curr.position.x), mZf(curr.position.z));
      ctx.strokeStyle = sector && sector.fasterGhost !== 0
        ? (sector.fasterGhost === 1 ? COLOR_G1 : COLOR_G2)
        : '#718096';
      ctx.stroke();
    }
  }, [frames1, sectorData]);

  return (
    <div className="gt-map-container">
      <canvas ref={canvasRef} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// ══  MAIN COMPONENT  ════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════

export default function GhostTelemetry({ ghost1, ghost2, onClose }) {
  // ghost1/ghost2 = { id, decoded, lapMs, intermediates, lap }

  // ── Derived data (memoized) ────────────────────────────────────
  const analysis1 = useMemo(() => {
    if (!ghost1?.decoded?.frames?.length) return null;
    const frames = ghost1.decoded.frames;
    const totalLen = enrichFramesWithDistance(frames);
    const derived = calculateDerivedData(frames, totalLen);
    const advanced = calculateAdvancedMetrics(frames, derived);
    const freq = calculateFrequency(frames);
    return { frames, totalLen, derived, advanced, freq };
  }, [ghost1]);

  const analysis2 = useMemo(() => {
    if (!ghost2?.decoded?.frames?.length) return null;
    const frames = ghost2.decoded.frames;
    const totalLen = enrichFramesWithDistance(frames);
    const derived = calculateDerivedData(frames, totalLen);
    const advanced = calculateAdvancedMetrics(frames, derived);
    const freq = calculateFrequency(frames);
    return { frames, totalLen, derived, advanced, freq };
  }, [ghost2]);

  // Sector comparison
  const sectorData = useMemo(() => {
    if (!analysis1 || !analysis2) return null;
    return calculateDistanceSectors(analysis1.frames, analysis2.frames, analysis1.totalLen);
  }, [analysis1, analysis2]);

  const hasBoth = !!(analysis1 && analysis2);
  const meta1 = ghost1?.decoded;
  const meta2 = ghost2?.decoded;

  // Labels from DB row (driverNickname + className), fallback to generic
  const label1 = ghost1?.lap?.driverNickname
    ? `${ghost1.lap.driverNickname}${ghost1.lap.className ? ` (${ghost1.lap.className})` : ''}`
    : 'Ghost 1';
  const label2 = ghost2?.lap?.driverNickname
    ? `${ghost2.lap.driverNickname}${ghost2.lap.className ? ` (${ghost2.lap.className})` : ''}`
    : 'Ghost 2';

  // Converti intermediates CUMULATIVI (secondi da inizio giro) in tempi per SETTORE
  // cumul[0] = fine S1, cumul[1] = fine S2 → sector[i] = cumul[i] - cumul[i-1]
  // Aggiunge il settore finale: lapTime - cumul[last]
  const buildInter = (meta) => {
    if (!meta?.intermediates || meta.intermediates.length === 0) return [];
    const cumul = meta.intermediates;
    const sectors = cumul.map((v, i) => i === 0 ? v : v - cumul[i - 1]);
    if (meta.lapTime != null) {
      sectors.push(meta.lapTime - cumul[cumul.length - 1]);
    }
    return sectors;
  };
  const inter1 = buildInter(meta1);
  const inter2 = buildInter(meta2);

  // ── Chart data helpers ─────────────────────────────────────────
  const cd = (derived, channel) => derived ? { x: derived.progress, y: derived[channel] } : null;

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="ghost-telemetry">
      {/* Header bar */}
      <div className="gt-header">
        <h2>
          📊 Ghost Telemetry
          {hasBoth ? ' — Comparison' : ''}
        </h2>
        <button className="gt-close" onClick={onClose}>✕ Close</button>
      </div>

      {/* Legend */}
      {hasBoth && (
        <div className="gt-legend">
          <span><span className="gt-legend-dot g1" /> {label1}</span>
          <span><span className="gt-legend-dot g2" /> {label2}</span>
        </div>
      )}

      {/* ── JSON Headers ──────────────────────────────────────── */}
      <JsonHeaders decoded={meta1} label={label1} colorClass="g1-color" />
      {hasBoth && <JsonHeaders decoded={meta2} label={label2} colorClass="g2-color" />}

      {/* ── Ghost Info Cards ──────────────────────────────────── */}
      <div className={`gt-info-grid ${hasBoth ? '' : 'single'}`}>
        {analysis1 && meta1 && (
          <div className="gt-info-card">
            <h3 className="g1-color">{label1}</h3>
            <div className="gt-info-row"><strong>Track:</strong> <span className="gt-val">{meta1.trackName || 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Lap Time:</strong> <span className="gt-val">{formatLapTimeSec(meta1.lapTime)}</span></div>
            <div className="gt-info-row"><strong>Intermediates:</strong> <span className="gt-val">{inter1.length > 0 ? inter1.map((t, i) => `T${i + 1}: ${t.toFixed(3)}s`).join(' · ') : 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Frequency:</strong> <span className="gt-val">{analysis1.freq ? analysis1.freq.toFixed(2) + ' Hz' : 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Frames:</strong> <span className="gt-val">{analysis1.frames.length}</span></div>
            <div className="gt-info-row"><strong>Length:</strong> <span className="gt-val">{analysis1.totalLen.toFixed(1)} m</span></div>
          </div>
        )}
        {analysis2 && meta2 && (
          <div className="gt-info-card g2">
            <h3 className="g2-color">{label2}</h3>
            <div className="gt-info-row"><strong>Track:</strong> <span className="gt-val">{meta2.trackName || 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Lap Time:</strong> <span className="gt-val">{formatLapTimeSec(meta2.lapTime)}</span></div>
            <div className="gt-info-row"><strong>Intermediates:</strong> <span className="gt-val">{inter2.length > 0 ? inter2.map((t, i) => `T${i + 1}: ${t.toFixed(3)}s`).join(' · ') : 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Frequency:</strong> <span className="gt-val">{analysis2.freq ? analysis2.freq.toFixed(2) + ' Hz' : 'N/A'}</span></div>
            <div className="gt-info-row"><strong>Frames:</strong> <span className="gt-val">{analysis2.frames.length}</span></div>
            <div className="gt-info-row"><strong>Length:</strong> <span className="gt-val">{analysis2.totalLen.toFixed(1)} m</span></div>
          </div>
        )}
      </div>

      {/* ── Comparison Tables (only with 2 ghosts) ────────────── */}
      {hasBoth && meta1 && meta2 && (
        <>
          <div className="gt-section-title">Main Data Comparison</div>
          <table className="gt-compare-table">
            <thead>
              <tr><th>Metric</th><th>{label1}</th><th>{label2}</th><th>Delta</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Lap Time</strong></td>
                <td>{formatLapTimeSec(meta1.lapTime)}</td>
                <td>{formatLapTimeSec(meta2.lapTime)}</td>
                <td className={deltaClass(meta1.lapTime - meta2.lapTime)}>{fmtDelta(meta1.lapTime - meta2.lapTime)}</td>
              </tr>
              <tr>
                <td><strong>Length (m)</strong></td>
                <td>{analysis1.totalLen.toFixed(1)}</td>
                <td>{analysis2.totalLen.toFixed(1)}</td>
                <td>{fmtDelta(analysis1.totalLen - analysis2.totalLen, 1)}</td>
              </tr>
              {[0, 1, 2].map(idx => {
                const t1 = inter1[idx], t2 = inter2[idx];
                return (
                  <tr key={idx}>
                    <td><strong>Intermediate {idx + 1}</strong></td>
                    <td>{t1 != null ? t1.toFixed(3) : 'N/A'}</td>
                    <td>{t2 != null ? t2.toFixed(3) : 'N/A'}</td>
                    <td className={t1 != null && t2 != null ? deltaClass(t1 - t2) : ''}>
                      {t1 != null && t2 != null ? fmtDelta(t1 - t2) : 'N/A'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {analysis1.advanced && analysis2.advanced && (
            <>
              <div className="gt-section-title">Advanced Metrics Comparison</div>
              <table className="gt-compare-table">
                <thead>
                  <tr><th>Metric</th><th>{label1}</th><th>{label2}</th><th>Delta</th></tr>
                </thead>
                <tbody>
                  {[
                    ['% Full Throttle (≥99%)', 'pctFullGas', 1, '%', true],
                    ['% Full Brake (≥99%)', 'pctFullBrake', 1, '%', false],
                    ['Peak Braking (G)', 'peakBrakeG', 2, '', true],
                    ['Peak Lat. Acc. (G)', 'peakLatG', 2, '', true],
                    ['Peak Long. Acc. (G)', 'peakLongG', 2, '', true],
                  ].map(([label, key, dec, suffix, invert]) => {
                    const v1 = analysis1.advanced[key];
                    const v2 = analysis2.advanced[key];
                    const d = v1 - v2;
                    return (
                      <tr key={key}>
                        <td><strong>{label}</strong></td>
                        <td>{v1.toFixed(dec)}{suffix}</td>
                        <td>{v2.toFixed(dec)}{suffix}</td>
                        <td className={invert ? deltaClassInv(d) : deltaClass(d)}>
                          {fmtDelta(d, dec)}{suffix}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {/* ── 2D Map ────────────────────────────────────────────── */}
      <div className="gt-section-title">2D Lap Map (X-Z Plane)</div>
      {hasBoth && (
        <div className="gt-legend">
          <span><span className="gt-legend-dot g1" /> {label1}</span>
          <span><span className="gt-legend-dot g2" /> {label2}</span>
        </div>
      )}
      <LapMap frames1={analysis1?.frames} frames2={analysis2?.frames} />

      {/* ── Comparison Map (microsectors) ─────────────────────── */}
      {hasBoth && sectorData && (
        <>
          <div className="gt-section-title">
            Microsector Comparison Map (G1 Shape, Color = Faster)
          </div>
          <div className="gt-legend">
            <span><span className="gt-legend-dot g1" /> {label1} faster</span>
            <span><span className="gt-legend-dot g2" /> {label2} faster</span>
          </div>
          <ComparisonMap frames1={analysis1?.frames} sectorData={sectorData} />
        </>
      )}

      {/* ── Charts ────────────────────────────────────────────── */}
      <div className="gt-section-title">Charts vs Lap Progress</div>
      <div className="gt-chart-hint">
        Click legend labels to show/hide. Scroll to zoom, drag to pan.
      </div>
      <div className="gt-charts-grid">
        <TelemetryChart id="gt-curvature" data1={cd(analysis1?.derived, 'curvature')} data2={cd(analysis2?.derived, 'curvature')} yLabel="Curvature [1/m]" lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-speed" data1={cd(analysis1?.derived, 'speedKmh')} data2={cd(analysis2?.derived, 'speedKmh')} yLabel="Speed [km/h]" lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-latacc" data1={cd(analysis1?.derived, 'latAccG')} data2={cd(analysis2?.derived, 'latAccG')} yLabel="Lateral Acc. [G]" lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-longacc" data1={cd(analysis1?.derived, 'longAccG')} data2={cd(analysis2?.derived, 'longAccG')} yLabel="Longitudinal Acc. [G]" lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-steer" data1={cd(analysis1?.derived, 'steer')} data2={cd(analysis2?.derived, 'steer')} yLabel="Steering [-1, 1]" yMin={-1.05} yMax={1.05} lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-gas" data1={cd(analysis1?.derived, 'gas')} data2={cd(analysis2?.derived, 'gas')} yLabel="Gas [0, 1]" yMin={-0.05} yMax={1.05} lbl1={label1} lbl2={label2} />
        <TelemetryChart id="gt-brake" data1={cd(analysis1?.derived, 'brake')} data2={cd(analysis2?.derived, 'brake')} yLabel="Brake [0, 1]" yMin={-0.05} yMax={1.05} lbl1={label1} lbl2={label2} />
      </div>

      {/* ── Frames Tables ─────────────────────────────────────── */}
      {analysis1 && (
        <FramesTable
          frames={analysis1.frames}
          derivedData={analysis1.derived}
          label={label1}
          colorClass="g1-color"
        />
      )}
      {analysis2 && (
        <FramesTable
          frames={analysis2.frames}
          derivedData={analysis2.derived}
          label={label2}
          colorClass="g2-color"
        />
      )}
    </div>
  );
}
