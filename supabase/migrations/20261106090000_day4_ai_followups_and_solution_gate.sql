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
