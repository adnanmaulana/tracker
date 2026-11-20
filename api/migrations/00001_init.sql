-- +goose Up
CREATE TABLE sites (
  id          TEXT PRIMARY KEY,               -- "portfolio", "reanimated-cookbook"
  domain      TEXT NOT NULL,                  -- "example.com" (subdomains allowed)
  name        TEXT NOT NULL,
  is_public   BOOLEAN NOT NULL DEFAULT false, -- public stats page toggle
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partitioned by month. Monthly partitions are created by the API on startup
-- (see internal/db/partitions.go); the default partition is a safety net.
CREATE TABLE events (
  id            BIGSERIAL,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id    TEXT NOT NULL,
  visitor_id    TEXT NOT NULL,
  path          TEXT,
  referrer      TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  country       TEXT,
  device        TEXT,
  browser       TEXT,
  os            TEXT,
  props         JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

CREATE TABLE events_default PARTITION OF events DEFAULT;

CREATE INDEX events_site_ts_idx      ON events (site_id, ts DESC);
CREATE INDEX events_site_name_ts_idx ON events (site_id, name, ts DESC);

-- Hourly rollups, filled by a background job (later step).
CREATE TABLE stats_hourly (
  site_id   TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hour      TIMESTAMPTZ NOT NULL,
  name      TEXT NOT NULL,
  path      TEXT NOT NULL DEFAULT '',
  count     INT NOT NULL,
  visitors  INT NOT NULL,
  PRIMARY KEY (site_id, hour, name, path)
);

-- +goose Down
DROP TABLE stats_hourly;
DROP TABLE events;
DROP TABLE sites;
