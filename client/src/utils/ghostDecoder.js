import pako from 'pako';

/**
 * Decode a ghostData field:
 *   Base64 string → Uint8Array → gzip decompress (pako) → JSON.parse
 *
 * The ghostData in the DB is the same format used in the Telemetria HTML tool:
 * a base64-encoded, gzip-compressed JSON object.
 *
 * @param {string|null} base64Data
 * @returns {object|null} parsed ghost metadata or null on error
 */
export function decodeGhostData(base64Data) {
  if (!base64Data) return null;
  try {
    // Trim any whitespace / newlines the DB may include
    const cleaned = String(base64Data).trim();

    // Step 1: Base64 → binary
    const binaryString = atob(cleaned);
    const len = binaryString.length;
    const compressedData = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      compressedData[i] = binaryString.charCodeAt(i);
    }

    // Step 2: gzip decompress → JSON string
    const jsonString = pako.inflate(compressedData, { to: 'string' });

    // Step 3: Parse JSON
    return JSON.parse(jsonString);
  } catch (err) {
    console.warn('decodeGhostData error:', err.message);
    return null;
  }
}

/**
 * Extract lapTime from decoded ghost metadata and convert to milliseconds.
 * The JSON stores lapTime in SECONDS (float).
 *
 * @param {object|null} ghostMeta
 * @returns {number|null} lap time in milliseconds, or null
 */
export function getGhostLapTimeMs(ghostMeta) {
  if (!ghostMeta || typeof ghostMeta.lapTime !== 'number') return null;
  return Math.round(ghostMeta.lapTime * 1000);
}

/**
 * Extract intermediates from decoded ghost metadata and convert to milliseconds.
 *
 * Compatible with both ghost standards:
 *  - Standard1 (legacy, current DB): top-level `intermediates` array
 *      e.g. { intermediates: [22.274, 54.339], events: [] }
 *  - Standard2 (new): cumulative times stored as entries inside `events[]`
 *      e.g. events: [{ name: "Intermediate", value: 15.444, extra: 1 }, ...]
 *
 * Returns an array of cumulative intermediate times in milliseconds, ordered
 * by sector index (1, 2, 3 …).
 *
 * @param {object|null} ghostMeta
 * @returns {number[]} array of intermediate times in ms
 */
export function getIntermediatesMs(ghostMeta) {
  if (!ghostMeta) return [];

  // 1) Standard1 — top-level `intermediates` array (preferred when present & non-empty)
  if (Array.isArray(ghostMeta.intermediates) && ghostMeta.intermediates.length > 0) {
    return ghostMeta.intermediates
      .map((t) => (typeof t === 'number' ? Math.round(t * 1000) : null))
      .filter((v) => v != null);
  }

  // 2) Standard2 — derive from events[] filtering by name === "Intermediate"
  // Notes on real-world variants observed in production ghosts:
  //   • `name` may carry a trailing space ("Intermediate ")
  //   • the cumulative time may live in `time` (most common) and `value` may be 0
  //   • `extra` may be 0- or 1-indexed across exporters
  if (Array.isArray(ghostMeta.events) && ghostMeta.events.length > 0) {
    const inter = ghostMeta.events
      .filter((e) => e && typeof e.name === 'string' && e.name.trim() === 'Intermediate')
      .slice()
      .sort((a, b) => Number(a.extra ?? 0) - Number(b.extra ?? 0))
      .map((e) => {
        const t = (typeof e.time === 'number' && e.time > 0)
          ? e.time
          : (typeof e.value === 'number' ? e.value : null);
        return t != null ? Math.round(t * 1000) : null;
      })
      .filter((v) => v != null);
    if (inter.length > 0) return inter;
  }

  return [];
}
