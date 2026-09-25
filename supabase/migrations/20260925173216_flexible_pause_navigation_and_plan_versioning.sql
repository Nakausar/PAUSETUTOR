/*
# Flexible PAUSE navigation: plan versioning + navigation events + EDIT phase

1. Overview
Supports the redesigned student workspace:
(a) PLAN VERSIONING — a student may revisit Plan and revise it; every revision is stored as a NEW
    plan row (append-only) so the ORIGINAL PRE-AI PLAN (v1) is never overwritten.
(b) NEW EVENT TYPES — the frontend already emits PLAN_SUBMITTED, PLAN_REVISED, PLAN_EDITED,
    AI_ACCURACY_RATING, INTENDED_AI_UPTAKE, AI_CRITIQUE_TEXT, SCRUTINISE_SUBMITTED,
    REFLECTION_SUBMITTED, EXECUTION_ERROR and navigation events PHASE_ENTERED / PHASE_EXITED,
    but the event_logs CHECK constraint does not allow them, so those events are currently
    rejected at the database level. The constraint is replaced with a superset.
(c) EDIT PHASE — the EDIT / REVISE phase is added to the pause_phase CHECK on event_logs and the
    current_phase CHECK on sessions so revisiting code after scrutiny is a first-class phase.

2. New columns
plans:
- `version` (integer, nullable): 1-based version number of the plan; v1 = the original pre-AI
  plan. Nullable so historical single-plan rows (implicitly v1) stay valid.
- `created_after_ai` (boolean, not null, default false): whether the student had already used AI
  in this session when this plan version was submitted. Preserves the pre-AI/post-AI distinction.

3. Modified tables
- `event_logs`: CHECK `event_logs_event_type_check` replaced with a strict superset (every
  previously allowed value remains allowed; 13 new values added).
- `event_logs`: CHECK `event_logs_pause_phase_check` gains 'edit'.
- `sessions`: CHECK `sessions_current_phase_check` gains 'edit'.
- `plans`: new columns above (additive, no drops/renames).

4. Security
- No RLS/policy changes: new columns and values inherit existing owner-or-researcher policies.

5. Important notes
1. Fully additive. No columns dropped, renamed or retyped; no data deleted.
   All historical plans, events and sessions remain valid.
2. Existing plan rows keep version = NULL; the app treats NULL as version 1 (original plan).
   Widened CHECKs only permit an additional value; nothing is forced on existing rows.
3. PHASE_TRANSITION (pre-existing) remains allowed and in use; PHASE_ENTERED / PHASE_EXITED ADD
   per-boundary from_stage/to_stage metadata for transition-network analysis. Behavioural events
   are unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'version') THEN
    ALTER TABLE plans ADD COLUMN version integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'created_after_ai') THEN
    ALTER TABLE plans ADD COLUMN created_after_ai boolean NOT NULL DEFAULT false;
  END IF;
END $$;

ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_event_type_check;
ALTER TABLE event_logs ADD CONSTRAINT event_logs_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'PLAN_STARTED','PROBLEM_ANALYSIS','GOAL_SET','PLAN_CREATED','PSEUDOCODE_CREATED','PLAN_COMPLETED',
    'PLAN_EDITED','PLAN_SUBMITTED','PLAN_REVISED',
    'ATTEMPT_STARTED','CODE_EDIT','CODE_RUN','ERROR','EXECUTION_ERROR','INDEPENDENT_REVISION','ATTEMPT_SAVED','ATTEMPT_COMPLETED',
    'AI_HELP_STARTED','HINT_REQUEST','EXPLANATION_REQUEST','DEBUG_REQUEST','APPROACH_REVIEW_REQUEST','ERROR_EXPLANATION_REQUEST','TARGETED_QUESTION','SOLUTION_REQUEST',
    'AI_RESPONSE','AI_HELP_COMPLETED',
    'SCRUTINY_STARTED','SCRUTINISE_SUBMITTED','AI_ACCURACY_RATING','INTENDED_AI_UPTAKE','AI_CRITIQUE_TEXT',
    'AI_OUTPUT_REVIEWED','TEST','VERIFY','COMPARE','AI_SUGGESTION_ACCEPTED','AI_SUGGESTION_MODIFIED','AI_SUGGESTION_REJECTED',
    'CODE_REVISED','ERROR_FIXED','SCRUTINY_COMPLETED',
    'REFLECTION_STARTED','REFLECTION_SUBMITTED','SOLUTION_EXPLAINED','LEARNING_REFLECTION','AI_HELP_EVALUATED','SELF_EVALUATION','CONFIDENCE_RECORDED','REFLECTION_COMPLETED',
    'PHASE_TRANSITION','PHASE_ENTERED','PHASE_EXITED',
    'TASK_COMPLETED','TASK_ASSIGNED','SESSION_STARTED'
  ])
);

ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_pause_phase_check;
ALTER TABLE event_logs ADD CONSTRAINT event_logs_pause_phase_check CHECK (
  pause_phase = ANY (ARRAY['plan','attempt','use_ai','scrutinise','edit','evaluate','completed'])
);

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_current_phase_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_current_phase_check CHECK (
  current_phase = ANY (ARRAY['plan','attempt','use_ai','scrutinise','edit','evaluate','completed'])
);