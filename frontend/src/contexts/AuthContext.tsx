import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { ApiError, setAccessTokenProvider, setSessionRefresher } from '../lib/apiClient';
import { fetchCurrentUser } from '../lib/auth.api';
import { createProfile, fetchProfile } from '../lib/profile.api';
import type { BanResponse } from '../lib/moderation.types';
import { AuthContext } from './auth-context';
import type { AuthProfile } from './auth-context';
import { USE_MOCK } from '../mocks/config';
import { getDb } from '../mocks/db';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  // The MVP backend has no moderation module (no GET /moderation/bans/me), so this stays
  // empty; kept in the context so restriction-aware UI keeps compiling unchanged.
  const [bans, setBans] = useState<BanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  const verifiedUserIdRef = useRef<string | null>(null);
  // Guards against getSession() and onAuthStateChange's INITIAL_SESSION both firing on
  // mount and racing to fetch-or-create the same user's profile concurrently (see
  // fetchOrCreateProfile). Keyed by user id so it only dedupes truly overlapping calls
  // for the same user, not unrelated/later refreshes.
  const inflightProfileFetchRef = useRef<{ userId: string; promise: Promise<AuthProfile | null> } | null>(null);

  const fetchOrCreateProfile = async (userId: string, activeSession: Session): Promise<AuthProfile | null> => {
    try {
      const data = await fetchProfile(userId);
      if (sessionRef.current?.user.id !== userId) return null;
      const nextProfile: AuthProfile = {
        id: data.id,
        username: data.username,
        displayName: data.display_name || data.username || activeSession.user.email || 'Người dùng',
        avatarUrl: data.avatar_url,
        bio: data.bio,
        organization: data.organization,
        role: data.role,
      };
      setProfile(nextProfile);
      return nextProfile;
    } catch (err) {
      // A newly registered account has no profile row yet -- signUp only creates one
      // immediately when email confirmation is disabled, and this app requires it. The
      // first session this account ever gets (right after confirming) lands here instead,
      // so create the row now rather than leaving the account profile-less forever.
      if (err instanceof ApiError && err.status === 404) {
        try {
          const created = await createProfile(
            { id: userId, display_name: (activeSession.user.user_metadata?.full_name as string | undefined) || null },
            activeSession.access_token,
          );
          if (sessionRef.current?.user.id !== userId) return null;
          const nextProfile: AuthProfile = {
            id: created.id,
            username: created.username,
            displayName: created.display_name || created.username || activeSession.user.email || 'Người dùng',
            avatarUrl: created.avatar_url,
            bio: created.bio,
            organization: created.organization,
            role: created.role,
          };
          setProfile(nextProfile);
          return nextProfile;
        } catch (createErr) {
          console.error('Failed to auto-create profile after email confirmation', createErr);
          setProfile(null);
          return null;
        }
      }
      console.error('Failed to fetch profile from the backend', err);
      setProfile(null);
      return null;
    }
  };

  const refreshProfile = (): Promise<AuthProfile | null> => {
    const activeSession = sessionRef.current;
    const userId = activeSession?.user.id;
    if (!userId) {
      setProfile(null);
      return Promise.resolve(null);
    }

    // A fetch-or-create for this same user is already in flight -- return that promise
    // instead of starting a second one. Without this, two concurrent callers can both see
    // "no profile yet" and both attempt to create it; only one create can win the row (the
    // other 400s on the primary key), but without dedup the loser's own catch block still
    // calls setProfile(null), which can clobber the winner's state if it settles later.
    const inflight = inflightProfileFetchRef.current;
    if (inflight && inflight.userId === userId) {
      return inflight.promise;
    }

    const entry: { userId: string; promise: Promise<AuthProfile | null> } = {
      userId,
      promise: fetchOrCreateProfile(userId, activeSession).finally(() => {
        if (inflightProfileFetchRef.current === entry) {
          inflightProfileFetchRef.current = null;
        }
      }),
    };
    inflightProfileFetchRef.current = entry;
    return entry.promise;
  };

  useEffect(() => {
    setAccessTokenProvider(() => sessionRef.current?.access_token ?? null);
    // A 401 from the backend usually means the access token expired while the tab slept;
    // refresh once and let apiClient re-send. The TOKEN_REFRESHED event below also updates
    // sessionRef, this just makes the new token available to the waiting request right away.
    setSessionRefresher(async () => {
      if (USE_MOCK || localStorage.getItem('dev_session')) return null;
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) return null;
      sessionRef.current = data.session;
      return data.session.access_token;
    });
    const applySession = async (nextSession: Session | null) => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      const userId = nextSession?.user?.id ?? null;
      if (userId) {
        await refreshProfile();
        if (verifiedUserIdRef.current !== userId) {
          verifiedUserIdRef.current = userId;
          fetchCurrentUser().catch((err) => console.error('Failed to verify session with GET /auth/me', err));
        }
      } else {
        setProfile(null);
        setBans([]);
        verifiedUserIdRef.current = null;
      }
    };
    const getDevSession = (): Session | null => {
      const stored = localStorage.getItem('dev_session');
      if (!stored) return null;
      try { return JSON.parse(stored) as Session; } catch { return null; }
    };
    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session ?? getDevSession()).finally(() => setLoading(false));
    }).catch(() => {
      void applySession(getDevSession()).finally(() => setLoading(false));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) localStorage.removeItem('dev_session');
      void applySession(nextSession ?? getDevSession());
    });
    const handleDevAuthChange = () => { void applySession(getDevSession()); };
    window.addEventListener('dev_auth_changed', handleDevAuthChange);
    return () => {
      listener.subscription.unsubscribe();
      window.removeEventListener('dev_auth_changed', handleDevAuthChange);
      setSessionRefresher(null);
    };
  }, []);

  const setDevSession = (nextSession: Session | null) => {
    if (nextSession) localStorage.setItem('dev_session', JSON.stringify(nextSession));
    else localStorage.removeItem('dev_session');
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (USE_MOCK && nextSession) {
      const user = getDb().users.find((item) => item.id === nextSession.user.id);
      setProfile(user ? {
        id: user.id,
        username: user.username,
        displayName: user.display_name || user.username || user.email,
        avatarUrl: user.avatar_url,
        bio: user.bio,
        organization: user.organization,
        role: user.role,
      } : null);
      setBans([]);
    } else if (!nextSession) {
      setProfile(null);
      setBans([]);
    }
  };

  return <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, bans, loading, setDevSession, refreshProfile }}>{children}</AuthContext.Provider>;
}
