-- Use the same private coordinator database as migration 011.
BEGIN;

CREATE SCHEMA IF NOT EXISTS meeting_internal;
REVOKE ALL ON SCHEMA meeting_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS meeting_internal.capture (
    id uuid PRIMARY KEY,
    room_id uuid NOT NULL,
    livekit_sid text NOT NULL UNIQUE,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS meeting_capture_room_started
    ON meeting_internal.capture (room_id, started_at DESC);

CREATE TABLE IF NOT EXISTS meeting_internal.capture_member (
    capture_id uuid NOT NULL REFERENCES meeting_internal.capture(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    PRIMARY KEY (capture_id, user_id)
);

CREATE TABLE IF NOT EXISTS meeting_internal.transcript_line (
    id uuid PRIMARY KEY,
    capture_id uuid NOT NULL REFERENCES meeting_internal.capture(id) ON DELETE CASCADE,
    spoken_at timestamptz NOT NULL,
    speaker_name text NOT NULL,
    text text NOT NULL
);
CREATE INDEX IF NOT EXISTS meeting_transcript_capture_spoken
    ON meeting_internal.transcript_line (capture_id, spoken_at, id);

CREATE TABLE IF NOT EXISTS meeting_internal.recording (
    id uuid PRIMARY KEY,
    capture_id uuid NOT NULL REFERENCES meeting_internal.capture(id) ON DELETE CASCADE,
    egress_id text UNIQUE,
    status text NOT NULL CHECK (status IN ('starting', 'active', 'ending', 'complete', 'failed')),
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_recording_one_active
    ON meeting_internal.recording (capture_id)
    WHERE status IN ('starting', 'active', 'ending');
CREATE INDEX IF NOT EXISTS meeting_recording_capture_started
    ON meeting_internal.recording (capture_id, started_at DESC);

ALTER TABLE meeting_internal.capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_internal.capture_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_internal.transcript_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_internal.recording ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON meeting_internal.capture, meeting_internal.capture_member,
    meeting_internal.transcript_line, meeting_internal.recording FROM PUBLIC;

COMMIT;
