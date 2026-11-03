/** A browser session pins the first identity it actually displayed. Do not
 * silently adopt a new identity/epoch when background refetches cross a cutover.
 * A hard reload is required; list responses never authorize detail mutations.
 */
let epoch: string | null | undefined;
const records = new Map<number, { recordKey: string; migrationEpoch: string } | null>();

export function observeSharedEpoch(value: string | null): void {
  if (epoch === undefined && value) epoch = value === "legacy" ? null : value;
}

export function sharedIdentityHeaders(url: string, method: string, body?: BodyInit | null): Headers {
  const headers = new Headers();
  const path = new URL(url, "http://identity.local").pathname;
  const match = path.match(/\/eto-requests\/([1-9][0-9]*)(?:\/|$)/);
  const upload = path.endsWith("/storage/uploads/request-url");
  const requestArea = /\/eto-requests(?:\/|$)/.test(path);
  const remappedArea = /\/(?:users|admin|dashboard)(?:\/|$)/.test(path);
  if (!requestArea && !upload && !remappedArea) return headers;
  let id = match ? Number(match[1]) : undefined;
  if (upload && typeof body === "string") {
    try { id = JSON.parse(body).etoRequestId; } catch { /* Server validates. */ }
  }
  const writing = !["GET", "HEAD", "OPTIONS"].includes(method);
  const identity = id ? records.get(id) : undefined;
  if (identity) headers.set("x-eto-record-key", identity.recordKey);
  if (writing && (identity?.migrationEpoch ?? epoch)) {
    headers.set("x-eto-migration-epoch", identity?.migrationEpoch ?? epoch!);
  }
  // Stable links disambiguate duplicate numbers and remapped numeric URLs.
  if (!writing && match && typeof window !== "undefined"
      && window.location.pathname.endsWith(`/eto-requests/${id}`)) {
    const key = new URLSearchParams(window.location.search).get("recordKey");
    if (key) headers.set("x-eto-record-key", key);
  }
  return headers;
}

export function observeSharedIdentity(url: string, method: string, value: unknown): void {
  if (!value || typeof value !== "object") return;
  const path = new URL(url, "http://identity.local").pathname;
  const creation = method === "POST" && /\/eto-requests\/?$/.test(path);
  if (method !== "GET" && !creation) return;
  const data = value as { id?: number; recordKey?: string; migrationEpoch?: string | null };
  if (!/\/eto-requests(?:\/|$)/.test(path)) return;
  if (epoch === undefined && Object.hasOwn(data, "migrationEpoch")) epoch = data.migrationEpoch ?? null;
  const match = path.match(/\/eto-requests\/([1-9][0-9]*)\/?$/);
  if ((!creation && (!match || data.id !== Number(match[1]))) || !data.id || records.has(data.id)) return;
  records.set(data.id, data.recordKey && data.migrationEpoch
    ? { recordKey: data.recordKey, migrationEpoch: data.migrationEpoch } : null);
}
