/**
 * Convert milliseconds to a human-readable lap time string.
 * Format: MM:SS.mmm
 * @param {number|null} ms - time in milliseconds
 * @returns {string}
 */
export function msToTime(ms) {
  if (ms === null || ms === undefined || isNaN(ms)) return '--:--.---';
  const sign = ms < 0 ? '-' : '';
  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / 60000);
  const seconds = Math.floor((absMs % 60000) / 1000);
  const millis = Math.round(absMs % 1000);
  return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Format a difference in milliseconds with sign.
 * @param {number|null} diff
 * @returns {string}
 */
export function formatDiff(diff) {
  if (diff === null || diff === undefined || isNaN(diff)) return 'N/A';
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)} ms`;
}
