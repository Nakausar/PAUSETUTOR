/*
  PAUSE AI Tutor: November 2026 updates (days 1–5), all in one file
  ===================================================================

  For Supabase projects created by Bolt, where the earlier migrations are
  already applied. Paste this whole file into Supabase → SQL Editor → New query
  and click Run. It runs as one transaction: either everything is applied or
  nothing is. It is safe to run again.

  Contents (identical to these files in supabase/migrations/):
    20261103090000_day1_security_hardening.sql
    20261104090000_day2_hidden_test_cases.sql
    20261105090000_day3_activity_event_types.sql
    20261106090000_day4_ai_followups_and_solution_gate.sql
    20261107090000_day5_revision_snapshots.sql

  After it succeeds, run the checks at the very bottom (separately).
*/

BEGIN;

-- ================================================================
-- 20261103090000_day1_security_hardening.sql
-- ================================================================
/*
# Day 1 security hardening (before any participant uses the system)

1. Roles can no longer be self-assigned
   - `handle_new_user()` always creates a `student` profile. The `role` value a
     browser sends in sign-up metadata is ignored.
   - Researchers are promoted manually by the study team (see bottom of file).
   - The new `protect_profile_fields` trigger stops a signed-in user from changing
     their own `role` or `participant_id` through the public API.

2. Consent is actually stored
   - The sign-up form sent `consent_acknowledged` in metadata, but the old trigger
     never copied it into `profiles`, so every profile showed `false`.

3. AI interactions are written by the server only
   - The `ai-tutor` edge function now inserts `ai_interactions` rows with the
     service role. Students can no longer insert, edit or fake AI logs.

4. Email confirmation is re-enabled at the database level
   - Removes the temporary `on_auth_user_auto_confirm` trigger. Also switch on
     "Confirm email" in Supabase Dashboard → Authentication → Sign In / Providers → Email.
*/

-- 1 + 2. Sign-up trigger: always student, store consent ------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, consent_acknowledged)
  VALUES (
    NEW.id,
    NEW.email,
    'student',
    COALESCE((NEW.raw_user_meta_data->>'consent_acknowledged')::boolean, false)
  );
  RETURN NEW;
END;
$$;

-- 1. Block self-service changes to role and participant_id ---------------------
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Requests from the app carry an `authenticated` (or `anon`) JWT. The SQL
  -- editor (no JWT) and the service role (edge functions) may still change these.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'profiles.role cannot be changed from the application';
    END IF;
    IF NEW.participant_id IS DISTINCT FROM OLD.participant_id THEN
      RAISE EXCEPTION 'profiles.participant_id cannot be changed from the application';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_fields ON public.profiles;
CREATE TRIGGER profiles_protect_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- Profiles may only be created by the sign-up trigger, never by the client.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

-- 3. AI interactions: server-side writes only -----------------------------------
DROP POLICY IF EXISTS "ai_insert_own" ON public.ai_interactions;
DROP POLICY IF EXISTS "ai_update_own" ON public.ai_interactions;

-- Reproducibility metadata for each AI response.
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS prompt_hash text;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_interactions_student_created_idx
  ON public.ai_interactions (student_id, created_at DESC);

-- 4. Re-enable email confirmation ------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
DROP FUNCTION IF EXISTS public.auto_confirm_new_user();

/*
## Promoting a researcher (run manually in the Supabase SQL editor)

  UPDATE public.profiles SET role = 'researcher' WHERE email = 'name@uef.fi';

## Checking for accounts that self-assigned researcher before this fix

  SELECT email, role, created_at FROM public.profiles WHERE role = 'researcher';
*/

-- ================================================================
-- 20261104090000_day2_hidden_test_cases.sql
-- ================================================================
/*
# Day 2: hidden test cases

Visible test cases stay in `tasks.test_cases` (students can see and run them).
Hidden test cases live in a separate table that only researchers can read, so
students cannot look them up through the API and hard-code the answers.
Researchers run them against the final code on the Session Assessment page.
*/

CREATE TABLE IF NOT EXISTS public.task_hidden_tests (
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  test_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.task_hidden_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hidden_tests_researcher_all" ON public.task_hidden_tests;
CREATE POLICY "hidden_tests_researcher_all" ON public.task_hidden_tests FOR ALL
  TO authenticated
  USING (public.is_current_user_researcher())
  WITH CHECK (public.is_current_user_researcher());

-- ================================================================
-- 20261105090000_day3_activity_event_types.sql
-- ================================================================
/*
# Day 3: fine-grained activity events (logging schema v2)

Adds event types; every previously allowed value stays allowed.

| Event               | Meaning                                                              |
|---------------------|----------------------------------------------------------------------|
| CODE_AUTOSAVED      | Code changed since the last snapshot; saved every 15 s while editing |
| TEXT_PASTED         | Any paste; metadata.field and metadata.provenance (AI match)         |
| AI_RESPONSE_COPIED  | Student copied text from an AI response                              |
| FOCUS_LOST          | Left the tab/window for >= 5 s (metadata.reason)                     |
| FOCUS_RETURNED      | Came back; metadata.away_ms                                          |
| IDLE_STARTED        | No activity for 60 s while the page was in focus                     |
| IDLE_ENDED          | Activity resumed; metadata.idle_ms                                   |
| AI_FOLLOWUP_REQUEST | Follow-up question within one AI interaction (used from day 4)       |

These are separate from CODE_EDIT so the existing temporal analysis
(which treats CODE_EDIT as an independent-coding step) is unchanged.
*/

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
    'TASK_COMPLETED','TASK_ASSIGNED','SESSION_STARTED',
    'CODE_AUTOSAVED','TEXT_PASTED','AI_RESPONSE_COPIED','FOCUS_LOST','FOCUS_RETURNED','IDLE_STARTED','IDLE_ENDED','AI_FOLLOWUP_REQUEST'
  ])
);

-- ================================================================
-- 20261106090000_day4_ai_followups_and_solution_gate.sql
-- ================================================================
/*
# Day 4: follow-up questions and the "complete solution" gate

1. Follow-up questions
   - A follow-up is a new `ai_interactions` row pointing at the original
     (root) interaction through `parent_interaction_id`. It shares the root's
     category, and `turn_index` orders the thread (root = 0).
   - Scrutiny stays per root interaction: the student scrutinises the whole
     conversation about one request.
   - The temporal analysis keeps treating only root interactions as AI requests,
     so earlier results are unchanged. Follow-ups appear in the TNA export as
     the `FollowUp` action.

2. Complete-solution gate (configurable on the Tutor configuration page)
   - `solution_min_runs`: code runs required before a complete solution can be requested.
   - `solution_min_minutes`: minutes of work on the code required first.
   - `solution_requires_reason`: the student must say why they need a full solution.
   - `max_followups`: follow-up questions allowed per AI interaction.
   The ai-tutor edge function enforces these, so they cannot be bypassed from the browser.
*/

ALTER TABLE public.ai_interactions
  ADD COLUMN IF NOT EXISTS parent_interaction_id uuid REFERENCES public.ai_interactions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS turn_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS solution_reason text;

CREATE INDEX IF NOT EXISTS ai_interactions_parent_idx ON public.ai_interactions (parent_interaction_id);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS solution_min_runs integer NOT NULL DEFAULT 1 CHECK (solution_min_runs >= 0),
  ADD COLUMN IF NOT EXISTS solution_min_minutes integer NOT NULL DEFAULT 3 CHECK (solution_min_minutes >= 0),
  ADD COLUMN IF NOT EXISTS solution_requires_reason boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_followups integer NOT NULL DEFAULT 5 CHECK (max_followups >= 0);

-- ================================================================
-- 20261107090000_day5_revision_snapshots.sql
-- ================================================================
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

COMMIT;

/*
  ---------------------------------------------------------------
  CHECKS: select the lines below and run them after the update.
  ---------------------------------------------------------------

  -- 1. Who currently has researcher access? (Before the update, anyone could
  --    choose "Researcher" at sign-up. Demote anyone who should not be one.)
  SELECT email, role, created_at FROM public.profiles WHERE role = 'researcher' ORDER BY created_at;

  -- 2. Make yourself a researcher (use your own email):
  UPDATE public.profiles SET role = 'researcher' WHERE email = 'your.name@uef.fi';

  -- 3. Demote an account that should not be a researcher:
  UPDATE public.profiles SET role = 'student' WHERE email = 'someone@example.com';

  -- 4. Confirm the new columns and table exist (should return 5 rows):
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND (
    (table_name = 'ai_interactions' AND column_name IN ('model', 'parent_interaction_id', 'solution_reason'))
    OR (table_name = 'system_settings' AND column_name = 'solution_min_runs')
    OR (table_name = 'task_hidden_tests' AND column_name = 'task_id'));
*/
