/**
 * Tab-local ownership hint used ONLY to avoid a stale tab leaving the shared
 * study-room membership on unload. The backend /meeting/owner is authoritative.
 * Deliberately not localStorage: other tabs must not inherit this identifier.
 */
const ownMediaSessions = new Map<string, string>();
export function setOwnedMediaSession(roomId: string, sessionId: string): void {
  ownMediaSessions.set(roomId, sessionId);
}
export function clearOwnedMediaSession(roomId: string, sessionId: string): void {
  if (ownMediaSessions.get(roomId) === sessionId) ownMediaSessions.delete(roomId);
}
export function getOwnedMediaSession(roomId: string): string | null {
  return ownMediaSessions.get(roomId) ?? null;
}
