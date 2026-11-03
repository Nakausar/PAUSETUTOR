/*
  PAUSE AI Tutor: research additions (second update, November 2026)
  ===================================================================

  For a project that already has the PAUSE tables, i.e. set up with
  full_setup.sql or apply_2026-11_updates.sql before 2026-11-08.
  (A new, empty project only needs full_setup.sql, which already includes this.)

  Paste this whole file into Supabase → SQL Editor → New query and click Run.
  It runs as one transaction and is safe to run again.

  Contents (identical to these files in supabase/migrations/):
    20261108090000_no_ai_tasks.sql
*/

BEGIN;

-- ================================================================
-- 20261108090000_no_ai_tasks.sql
-- ================================================================
/*
# Tasks without the AI tutor

`tasks.ai_allowed` (default true). When false, the student works
Plan → Attempt → Evaluate: the Use AI and Scrutinise phases stay locked and
the ai-tutor function refuses requests for the task. Use it for an unaided
final task (a learning-outcome measure) or for a comparison condition.
Only researchers can change it (existing tasks_update_researcher policy).
*/

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS ai_allowed boolean NOT NULL DEFAULT true;

COMMIT;
