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
    20261109090000_surveys.sql
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

-- ================================================================
-- 20261109090000_surveys.sql
-- ================================================================
/*
# Pre/post questionnaires

1. `surveys`: questionnaire definitions created by researchers.
   - `kind`: 'pre' (shown before the first task), 'post' (shown once all
     assigned tasks are completed) or 'other' (always available).
   - `required_before_tasks`: for 'pre' surveys, students cannot start a task
     until they have submitted it.
   - `items`: JSON array of questions:
       { "id": "q1", "text": "...", "type": "likert5" | "likert7" | "choice" | "text",
         "options": ["..."] (choice only), "required": true,
         "scale": "sus" (optional, used to compute SUS scores in exports) }
   - Only `active` surveys are shown to students.

2. `survey_responses`: one submission per student per survey.
   - `answers`: JSON object { item id: value }.
   - `participant_id` is always copied from the student's profile by a trigger,
     so it cannot be forged from the browser.
   - Students can insert and read only their own response, cannot change it
     after submitting, and cannot see other students' responses. Researchers
     can read all responses.
*/

CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'pre' CHECK (kind IN ('pre', 'post', 'other')),
  required_before_tasks boolean NOT NULL DEFAULT false,
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  active boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "surveys_read_active_or_researcher" ON public.surveys;
CREATE POLICY "surveys_read_active_or_researcher" ON public.surveys FOR SELECT
  TO authenticated USING (active OR public.is_current_user_researcher());

DROP POLICY IF EXISTS "surveys_researcher_insert" ON public.surveys;
CREATE POLICY "surveys_researcher_insert" ON public.surveys FOR INSERT
  TO authenticated WITH CHECK (public.is_current_user_researcher());

DROP POLICY IF EXISTS "surveys_researcher_update" ON public.surveys;
CREATE POLICY "surveys_researcher_update" ON public.surveys FOR UPDATE
  TO authenticated USING (public.is_current_user_researcher()) WITH CHECK (public.is_current_user_researcher());

DROP POLICY IF EXISTS "surveys_researcher_delete" ON public.surveys;
CREATE POLICY "surveys_researcher_delete" ON public.surveys FOR DELETE
  TO authenticated USING (public.is_current_user_researcher());

CREATE TABLE IF NOT EXISTS public.survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL DEFAULT '',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  started_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (survey_id, student_id)
);

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- participant_id always comes from the profile, never from the browser.
CREATE OR REPLACE FUNCTION public.set_survey_response_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT participant_id INTO NEW.participant_id FROM public.profiles WHERE id = NEW.student_id;
  IF NEW.participant_id IS NULL THEN
    RAISE EXCEPTION 'No profile for this user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS survey_responses_set_participant ON public.survey_responses;
CREATE TRIGGER survey_responses_set_participant
  BEFORE INSERT ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_survey_response_participant();

DROP POLICY IF EXISTS "survey_responses_insert_own" ON public.survey_responses;
CREATE POLICY "survey_responses_insert_own" ON public.survey_responses FOR INSERT
  TO authenticated WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.active)
  );

DROP POLICY IF EXISTS "survey_responses_select_own_or_researcher" ON public.survey_responses;
CREATE POLICY "survey_responses_select_own_or_researcher" ON public.survey_responses FOR SELECT
  TO authenticated USING (student_id = auth.uid() OR public.is_current_user_researcher());

-- No UPDATE or DELETE policies: a submitted questionnaire cannot be changed
-- from the app (researchers can correct data in the SQL editor if needed).

COMMIT;
