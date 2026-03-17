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
 * @param {object|null} ghostMeta
 * @returns {number[]} array of intermediate times in ms
 */
export function getIntermediatesMs(ghostMeta) {
  if (!ghostMeta || !Array.isArray(ghostMeta.intermediates)) return [];
  return ghostMeta.intermediates.map((t) => Math.round(t * 1000));
}
