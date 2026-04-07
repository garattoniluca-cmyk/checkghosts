/**
 * Ghost telemetry analysis utilities.
 * Ported from Telemetria ok.html — calculates derived data,
 * advanced metrics, and distance-based sector comparisons.
 */

const GRAVITY_ACCEL = 9.81;

/**
 * Add cumulativeDistance to each frame (mutates the frames array).
 * Also returns totalTrackLength.
 */
export function enrichFramesWithDistance(frames) {
  if (!frames || frames.length === 0) return 0;
  let cumulativeDistance = 0;
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) {
      const p = frames[i].position;
      const pp = frames[i - 1].position;
      if (p && pp && typeof p.x === 'number' && typeof p.z === 'number' &&
          typeof pp.x === 'number' && typeof pp.z === 'number') {
        const dx = p.x - pp.x;
        const dz = p.z - pp.z;
        cumulativeDistance += Math.sqrt(dx * dx + dz * dz);
      }
    }
    frames[i].cumulativeDistance = cumulativeDistance;
  }
  return cumulativeDistance;
}

/**
 * Calculate derived telemetry channels from ghost frames.
 */
export function calculateDerivedData(frames, totalTrackLength) {
  const n = frames.length;
  if (n < 3) return null;

  const progress = frames.map(f => f.progress);
  const time = frames.map(f => f.time);
  const curvature = new Array(n).fill(0);
  const speedKmh = new Array(n).fill(0);
  const speedMps = new Array(n).fill(0);
  const latAccG = new Array(n).fill(0);
  const longAccG = new Array(n).fill(0);
  // Standard1 & Standard2: gas/brake are integer % [0..100], steer is integer [-50..+50]
  const steer = frames.map(f => (f.steer ?? 0) / 50.0);
  const gas = frames.map(f => (f.gas ?? 0) / 100.0);
  const brake = frames.map(f => (f.brake ?? 0) / 100.0);
  const rpm = frames.map(f => f.rpm ?? 0);
  const gear = frames.map(f => f.gear ?? 0);
  const trackLength = totalTrackLength ?? 0;

  // Speed (scalar)
  for (let i = 0; i < n; i++) {
    const vel = frames[i].velocity;
    if (vel && typeof vel.x === 'number' && typeof vel.y === 'number' && typeof vel.z === 'number') {
      speedMps[i] = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
      speedKmh[i] = speedMps[i] * 3.6;
    } else {
      speedMps[i] = NaN;
      speedKmh[i] = NaN;
    }
  }

  // Longitudinal acceleration
  for (let i = 0; i < n; i++) {
    const dt = i > 0 ? time[i] - time[i - 1] : (n > 1 ? time[1] - time[0] : 0);
    if (dt > 1e-6 && !isNaN(speedMps[i])) {
      if (i === 0 && n > 1 && !isNaN(speedMps[1])) {
        longAccG[i] = (speedMps[1] - speedMps[0]) / dt / GRAVITY_ACCEL;
      } else if (i > 0 && !isNaN(speedMps[i - 1])) {
        longAccG[i] = (speedMps[i] - speedMps[i - 1]) / dt / GRAVITY_ACCEL;
      }
    }
  }

  // Curvature and lateral acceleration
  for (let i = 1; i < n - 1; i++) {
    const pp = frames[i - 1].position;
    const pc = frames[i].position;
    const pn = frames[i + 1].position;
    const progPrev = progress[i - 1];
    const progCurr = progress[i];
    const progNext = progress[i + 1];

    if (!pp || !pc || !pn ||
        typeof pp.x !== 'number' || typeof pp.z !== 'number' ||
        typeof pc.x !== 'number' || typeof pc.z !== 'number' ||
        typeof pn.x !== 'number' || typeof pn.z !== 'number') continue;

    const dpFwd = progNext - progCurr;
    const dpBwd = progCurr - progPrev;
    const dpCen = progNext - progPrev;

    if (Math.abs(dpCen) < 1e-9 || Math.abs(dpFwd) < 1e-9 || Math.abs(dpBwd) < 1e-9) continue;

    const xPrime = (pn.x - pp.x) / dpCen;
    const zPrime = (pn.z - pp.z) / dpCen;
    const xDoublePrime = 2 * (((pn.x - pc.x) / dpFwd) - ((pc.x - pp.x) / dpBwd)) / dpCen;
    const zDoublePrime = 2 * (((pn.z - pc.z) / dpFwd) - ((pc.z - pp.z) / dpBwd)) / dpCen;

    const numerator = Math.abs(xPrime * zDoublePrime - zPrime * xDoublePrime);
    const denominator = (xPrime ** 2 + zPrime ** 2) ** 1.5;

    curvature[i] = denominator < 1e-9 ? 0 : numerator / denominator;
    latAccG[i] = !isNaN(speedMps[i]) ? (speedMps[i] ** 2 * curvature[i]) / GRAVITY_ACCEL : 0;
  }
  curvature[0] = curvature[1];
  curvature[n - 1] = curvature[n - 2];
  latAccG[0] = latAccG[1];
  latAccG[n - 1] = latAccG[n - 2];

  return { progress, curvature, speedKmh, latAccG, longAccG, steer, gas, brake, rpm, gear, trackLength };
}

/**
 * Calculate advanced comparison metrics.
 */
export function calculateAdvancedMetrics(frames, derivedData) {
  if (!frames || frames.length === 0 || !derivedData) return null;

  const n = frames.length;
  let fullGasFrames = 0;
  let fullBrakeFrames = 0;

  derivedData.gas.forEach(g => { if (g >= 0.99) fullGasFrames++; });
  derivedData.brake.forEach(b => { if (b >= 0.99) fullBrakeFrames++; });

  const pctFullGas = (fullGasFrames / n) * 100;
  const pctFullBrake = (fullBrakeFrames / n) * 100;

  const validLongG = derivedData.longAccG.filter(isFinite);
  const validLatG = derivedData.latAccG.filter(isFinite);

  const peakBrakeG = validLongG.length > 0 ? Math.abs(Math.min(0, ...validLongG)) : 0;
  const peakLatG = validLatG.length > 0 ? Math.max(0, ...validLatG.map(Math.abs)) : 0;
  const peakLongG = validLongG.length > 0 ? Math.max(0, ...validLongG) : 0;

  return { pctFullGas, pctFullBrake, peakBrakeG, peakLatG, peakLongG };
}

/**
 * Calculate average recording frequency.
 */
export function calculateFrequency(frames) {
  if (!frames || frames.length <= 1) return null;
  let totalTimeDiff = 0;
  let validIntervals = 0;
  for (let i = 1; i < frames.length; i++) {
    const t1 = frames[i - 1]?.time;
    const t2 = frames[i]?.time;
    if (typeof t1 === 'number' && typeof t2 === 'number') {
      const diff = t2 - t1;
      if (diff > 0.0001) { totalTimeDiff += diff; validIntervals++; }
    }
  }
  const avgInterval = validIntervals > 0 ? totalTimeDiff / validIntervals : 0;
  return avgInterval > 0 ? 1 / avgInterval : null;
}

/**
 * Linear interpolation helper.
 */
function interpolateValue(frames, targetX, xField, yField) {
  if (!frames || frames.length === 0) return NaN;
  if (targetX <= frames[0][xField]) return frames[0][yField];
  if (targetX >= frames[frames.length - 1][xField]) return frames[frames.length - 1][yField];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i][xField] >= targetX) {
      const f1 = frames[i - 1];
      const f2 = frames[i];
      const xDiff = f2[xField] - f1[xField];
      if (Math.abs(xDiff) < 1e-9) return f1[yField];
      const t = (targetX - f1[xField]) / xDiff;
      if (isNaN(f1[yField]) || isNaN(f2[yField])) return NaN;
      return f1[yField] + t * (f2[yField] - f1[yField]);
    }
  }
  return frames[frames.length - 1][yField];
}

function interpolateTime(frames, targetProgress) {
  return interpolateValue(frames, targetProgress, 'progress', 'time');
}

/**
 * Interpolate a field at a given cumulativeDistance in a frames array.
 * Uses linear interpolation between frames.
 */
function interpolateAtDist(frames, targetDist, field) {
  if (!frames || frames.length === 0) return NaN;
  if (targetDist <= frames[0].cumulativeDistance) return frames[0][field];
  const last = frames[frames.length - 1];
  if (targetDist >= last.cumulativeDistance) return last[field];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].cumulativeDistance >= targetDist) {
      const fa = frames[i - 1], fb = frames[i];
      const dDist = fb.cumulativeDistance - fa.cumulativeDistance;
      if (Math.abs(dDist) < 1e-9) return fa[field];
      const t = (targetDist - fa.cumulativeDistance) / dDist;
      return fa[field] + t * (fb[field] - fa[field]);
    }
  }
  return last[field];
}

/**
 * Calculate distance-based microsectors for comparison map.
 *
 * Confronto basato sulla DISTANZA FISICA (cumulativeDistance) percorsa da ciascun ghost.
 * Entrambi i ghost vengono misurati in secondi impiegati a coprire la stessa
 * porzione di tracciato, normalizzata rispetto alla lunghezza totale di ciascuno.
 */
export function calculateDistanceSectors(frames1, frames2, totalLength1) {
  if (!frames1 || !frames2 || frames1.length < 2 || frames2.length < 2 || !totalLength1 || totalLength1 <= 0) {
    return null;
  }
  // Require enrichFramesWithDistance to have been called for both
  if (frames1[0].cumulativeDistance === undefined || frames2[0].cumulativeDistance === undefined) {
    return null;
  }

  const totalLength2 = frames2[frames2.length - 1].cumulativeDistance;
  if (totalLength2 <= 0) return null;

  // Fattore di scala: normalizza le distanze di ghost2 rispetto a ghost1
  // (entrambi percorrono lo stesso tracciato, piccole differenze dovute al campionamento)
  const distScale = totalLength2 / totalLength1;

  const targetSegmentMeters = 100;
  const numSegments = Math.max(10, Math.round(totalLength1 / targetSegmentMeters));
  const segmentSize = totalLength1 / numSegments;

  const results = [];

  try {
    for (let i = 0; i < numSegments; i++) {
      const startDist = i * segmentSize;
      const endDist   = Math.min((i + 1) * segmentSize, totalLength1);

      // Progress per la mappa (usa i dati di ghost1)
      const startP = Math.max(0, Math.min(1, interpolateAtDist(frames1, startDist, 'progress')));
      const endP   = Math.max(0, Math.min(1, interpolateAtDist(frames1, endDist,   'progress')));

      // Tempo ghost1: interpolato per distanza
      const startTime1 = interpolateAtDist(frames1, startDist, 'time');
      const endTime1   = interpolateAtDist(frames1, endDist,   'time');
      const time1 = endTime1 - startTime1;

      // Tempo ghost2: stessa porzione di tracciato, scalata per la sua lunghezza totale
      const startTime2 = interpolateAtDist(frames2, startDist * distScale, 'time');
      const endTime2   = interpolateAtDist(frames2, endDist   * distScale, 'time');
      const time2 = endTime2 - startTime2;

      if (isNaN(time1) || isNaN(time2) || time1 < -1e-6 || time2 < -1e-6) {
        results.push({ segment: i, startP, endP, time1: NaN, time2: NaN, fasterGhost: 0 });
      } else {
        results.push({
          segment: i,
          startP,
          endP,
          time1,
          time2,
          fasterGhost: time1 < time2 ? 1 : time2 < time1 ? 2 : 0,
        });
      }
    }
  } catch (error) {
    console.error('Error calculating distance sectors:', error);
    return null;
  }
  return results;
}

/**
 * Format seconds → mm:ss.SSS
 */
export function formatLapTimeSec(totalSeconds) {
  if (isNaN(totalSeconds) || totalSeconds < 0) return 'N/A';
  const totalMs = Math.round(totalSeconds * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}
