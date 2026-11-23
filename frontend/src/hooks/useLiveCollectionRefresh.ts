import { useEffect, useId, useRef } from 'react';
import { DATA_CHANGED, DATA_CHANNEL, isDataChange } from '../lib/dataChange';
import { supabase } from '../lib/supabase';
import { USE_MOCK } from '../mocks/config';

interface LiveRefreshOptions {
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
  /** A table present in supabase_realtime; changes are validated by PostgreSQL RLS. */
  table?: string;
  filter?: string;
  /** REST mutations that should invalidate this view, even in another browser tab. */
  watchPaths?: string[];
  intervalMs?: number;
}

/** Keep a mounted list fresh without reloading the page.
 * Realtime is the fast path, cross-tab mutation messages cover own writes, and a
 * visibility-aware REST refresh is the safety net for missed events, reconnects,
 * soft-deletes and tables not yet published to Realtime.
 */
export function useLiveCollectionRefresh({
  enabled, onRefresh, table, filter, watchPaths = [], intervalMs = 15000,
}: LiveRefreshOptions): void {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const id = useId();
  const pathSignature = watchPaths.join('|');

  useEffect(() => {
    if (!enabled || USE_MOCK) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    const schedule = () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (active) void Promise.resolve(refreshRef.current()).catch((err) => {
          console.warn('[DataSync] refresh failed', err);
        });
      }, 120);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
    const onLocalChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (isDataChange(detail) && pathSignature.split('|').some((prefix) => prefix && detail.path.startsWith(prefix))) schedule();
    };
    let tabs: BroadcastChannel | undefined;
    if (typeof BroadcastChannel !== 'undefined') {
      tabs = new BroadcastChannel(DATA_CHANNEL);
      tabs.onmessage = (event) => {
        const detail = event.data;
        if (isDataChange(detail) && pathSignature.split('|').some((prefix) => prefix && detail.path.startsWith(prefix))) schedule();
      };
    }

    window.addEventListener(DATA_CHANGED, onLocalChange);
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') schedule();
    }, Math.max(5000, intervalMs));

    const realtime = table
      ? supabase.channel('data-sync:' + table + ':' + (filter ?? 'all') + ':' + id)
          .on('postgres_changes', {
            event: '*', schema: 'public', table, ...(filter ? { filter } : {}),
          }, schedule)
          .subscribe((status, err) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.warn('[DataSync] realtime reconnect/fallback', table, status, err);
            }
          })
      : null;

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      tabs?.close();
      window.removeEventListener(DATA_CHANGED, onLocalChange);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', onVisible);
      if (realtime) void supabase.removeChannel(realtime);
    };
  }, [enabled, table, filter, id, pathSignature, intervalMs]);
}
