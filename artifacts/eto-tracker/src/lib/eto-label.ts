/** Display identity for unnumbered drafts without inventing an ETO number. */
export function etoLabel(request: { id: number; etoNumber?: string | null }): string {
  return request.etoNumber ?? `Draft #${request.id}`;
}