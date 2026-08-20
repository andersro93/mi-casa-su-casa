-- Audit events are scoped to a household where applicable so owners can
-- review what happened in theirs. Installation-level events keep NULL.
ALTER TABLE audit_events ADD COLUMN household_id TEXT;
CREATE INDEX idx_audit_events_household_created ON audit_events(household_id, created_at DESC);
