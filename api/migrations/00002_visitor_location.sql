-- +goose Up
-- Coarse location from a local GeoIP lookup (the IP itself is never stored),
-- and an index for per-visitor timelines.
ALTER TABLE events ADD COLUMN region TEXT, ADD COLUMN city TEXT;
CREATE INDEX events_site_visitor_ts_idx ON events (site_id, visitor_id, ts);

-- +goose Down
DROP INDEX events_site_visitor_ts_idx;
ALTER TABLE events DROP COLUMN city, DROP COLUMN region;
