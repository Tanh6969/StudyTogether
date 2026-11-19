import { useEffect, useRef, useState } from 'react';

/**
 * Phones suspend background tabs and drop the network without any unload event. While
 * the tab is hidden, the backend may close this user's membership (LiveKit
 * `participant_left` webhook). Re-check as soon as the user is back -- tab visible again
 * or network restored -- so the page shows the real state instead of a frozen call.
 */
export function useRoomConnectionWatch(onResume: () => void): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  const onResumeRef = useRef(onResume);
  onResumeRef.current = onResume;

  useEffect(() => {
    const resume = () => onResumeRef.current();
    const onOnline = () => {
      setIsOnline(true);
      resume();
    };
    const onOffline = () => setIsOnline(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // `pageshow` covers a phone restoring the page from the back/forward cache.
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return { isOnline };
}
