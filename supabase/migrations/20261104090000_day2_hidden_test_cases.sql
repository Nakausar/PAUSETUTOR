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
