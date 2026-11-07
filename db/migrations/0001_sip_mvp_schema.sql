-- Phase 8C shared runtime schema. Apply only through a reviewed migration process.
-- Version 0001 contains schema only; no production data is seeded.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.assistant_budget_windows (
  budget_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  budget_limit_tokens bigint NOT NULL DEFAULT 100000 CHECK (budget_limit_tokens = 100000),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  PRIMARY KEY (budget_key, window_start),
  CHECK (window_end > window_start)
);

CREATE TABLE IF NOT EXISTS app.assistant_token_reservations (
  reservation_id uuid PRIMARY KEY,
  budget_key text NOT NULL,
  window_start timestamptz NOT NULL,
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
  settled_tokens bigint CHECK (settled_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  FOREIGN KEY (budget_key, window_start)
    REFERENCES app.assistant_budget_windows (budget_key, window_start),
  CHECK ((settled_tokens IS NULL) = (settled_at IS NULL))
);

CREATE TABLE IF NOT EXISTS app.action_sessions (
  session_id uuid PRIMARY KEY,
  scenario text NOT NULL CHECK (scenario IN ('BASE', 'PAUSED_RESTART')),
  state_version bigint NOT NULL CHECK (state_version >= 0),
  session_data jsonb NOT NULL,
  cookie_hash bytea NOT NULL CHECK (octet_length(cookie_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (session_data ? 'sessionId'),
  CHECK (session_data->>'sessionId' IS NOT NULL),
  CHECK ((session_data->>'sessionId')::uuid = session_id),
  CHECK (session_data ? 'stateVersion'),
  CHECK (session_data->>'stateVersion' IS NOT NULL),
  CHECK ((session_data->>'stateVersion')::bigint = state_version),
  CHECK (session_data ? 'expiresAt'),
  CHECK (session_data->>'expiresAt' IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS action_sessions_expiry_idx
  ON app.action_sessions (expires_at);

CREATE TABLE IF NOT EXISTS app.action_previews (
  preview_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES app.action_sessions (session_id),
  state_version bigint NOT NULL CHECK (state_version >= 0),
  preview_data jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (preview_data ? 'previewId'),
  CHECK (preview_data->>'previewId' IS NOT NULL),
  CHECK ((preview_data->>'previewId')::uuid = preview_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS action_previews_one_active_per_session_idx
  ON app.action_previews (session_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS action_previews_expiry_idx
  ON app.action_previews (expires_at);

CREATE TABLE IF NOT EXISTS app.evidence_registry (
  evidence_id text PRIMARY KEY,
  tier text NOT NULL CHECK (tier IN ('demo_policy', 'general_education', 'official_groww')),
  title text NOT NULL,
  excerpt text NOT NULL,
  source_url text NOT NULL,
  source_date date,
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (review_status <> 'approved' OR verified_at IS NOT NULL)
);

ALTER TABLE app.assistant_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.assistant_token_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.action_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.action_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evidence_registry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;

COMMENT ON TABLE app.evidence_registry IS
  'Evidence requires independent review before approval. This migration intentionally inserts no evidence records.';
