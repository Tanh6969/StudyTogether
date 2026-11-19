import { useEffect, useState } from 'react';

/** Phone-sized viewport (portrait phones and small landscape phones). */
export const MOBILE_MEDIA_QUERY = '(max-width: 768px)';

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

export function useIsMobile(query: string = MOBILE_MEDIA_QUERY): boolean {
  const [isMobile, setIsMobile] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [query]);
  return isMobile;
}
