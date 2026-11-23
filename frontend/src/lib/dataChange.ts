/**
 * Mutations notify mounted views immediately, including other tabs of this same origin.
 * Never send row data or credentials over this bus; receivers refetch with their own auth.
 */
export const DATA_CHANGED = 'studytogether:data-changed';
export const DATA_CHANNEL = 'studytogether:data-changed-tabs';

export interface DataChange {
  path: string;
  method: string;
}

export function emitDataChange(change: DataChange): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<DataChange>(DATA_CHANGED, { detail: change }));
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(DATA_CHANNEL);
  try {
    channel.postMessage(change);
  } finally {
    channel.close();
  }
}

export function isDataChange(value: unknown): value is DataChange {
  return !!value && typeof value === 'object'
    && 'path' in value && typeof value.path === 'string'
    && value.path.startsWith('/') && value.path.length <= 512
    && 'method' in value && typeof value.method === 'string'
    && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(value.method);
}
