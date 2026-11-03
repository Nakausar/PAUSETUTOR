/*
# Day 5: allow revision snapshots

"Save revision" in the Scrutinise phase stores a code snapshot with
trigger = 'revision', but the original CHECK constraint did not allow that
value, so those snapshots were rejected. This adds 'revision' (all existing
values remain allowed). From now on, revisions are also logged as CODE_REVISED
(previously ATTEMPT_SAVED), which the temporal analysis already maps to its
REVISION step.
*/

ALTER TABLE public.code_snapshots DROP CONSTRAINT IF EXISTS code_snapshots_trigger_check;
ALTER TABLE public.code_snapshots ADD CONSTRAINT code_snapshots_trigger_check
  CHECK (trigger IN ('manual', 'run', 'save', 'ai_assist', 'scrutinise', 'auto', 'revision'));
