-- Records when the retention cron last completed so readiness can surface a
-- stale/failed cron instead of it failing silently for weeks.
ALTER TABLE app_installation ADD COLUMN last_retention_run_at TEXT;
