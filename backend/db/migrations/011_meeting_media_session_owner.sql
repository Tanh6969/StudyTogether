-- Durable media ownership, distinct from room membership/presence.
-- Private schema: never exposed through Supabase PostgREST or Realtime.
-- Must be applied to the chosen coordinator database BEFORE enabling strict
-- meeting-session mode. For shared-production preview it goes ONLY to the
-- private local preview PostgreSQL, not the live Supabase database.
BEGIN;
CREATE SCHEMA IF NOT EXISTS meeting_internal;
REVOKE ALL ON SCHEMA meeting_internal FROM PUBLIC;
CREATE TABLE IF NOT EXISTS meeting_internal.media_session (
    room_id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_session_id uuid NOT NULL,
    generation bigint NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (room_id, user_id)
);
REVOKE ALL ON meeting_internal.media_session FROM PUBLIC;
COMMIT;
