-- Authentication tables are managed by Better Auth's migration API.
-- Structured record snapshots are stored transactionally in the first round.
-- Public catalog and map assets are versioned files; spatial ingestion is deferred.
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS record_snapshots (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 0),
  catalog_version text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS archives (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS archives_user_created_at ON archives (user_id, created_at DESC);
COMMIT;

