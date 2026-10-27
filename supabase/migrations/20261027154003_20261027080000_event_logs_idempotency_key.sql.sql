-- Phase 1 of the data-integrity fix: database-enforced exactly-once logging.
-- Historical rows all have metadata without 'idem_key', so the partial index
-- never conflicts with existing records; only new inserts carrying a key are constrained.
-- No rows are modified or deleted.
CREATE UNIQUE INDEX IF NOT EXISTS event_logs_idem_key_unique
  ON event_logs ((metadata->>'idem_key'))
  WHERE metadata->>'idem_key' IS NOT NULL;
