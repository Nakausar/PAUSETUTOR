/*
# Tasks without the AI tutor

`tasks.ai_allowed` (default true). When false, the student works
Plan → Attempt → Evaluate: the Use AI and Scrutinise phases stay locked and
the ai-tutor function refuses requests for the task. Use it for an unaided
final task (a learning-outcome measure) or for a comparison condition.
Only researchers can change it (existing tasks_update_researcher policy).
*/

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS ai_allowed boolean NOT NULL DEFAULT true;
