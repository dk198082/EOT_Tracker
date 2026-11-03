/**
 * Express 5 types route params as `string | string[]`.
 * This helper extracts a single string value safely.
 */
export function parseIntParam(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  return n;
}
