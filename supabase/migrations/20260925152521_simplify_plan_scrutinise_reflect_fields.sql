/*
# Simplify PLAN, SCRUTINISE and REFLECT research instruments

1. Overview
Adds new, lighter-weight response columns for the Plan, Scrutinise and Reflect stages of the PAUSE cycle.
All changes are additive: existing columns, historical rows and research data are preserved untouched.

2. New columns
plans:
- plan_text (text, not null, default ''): student free-text description of how they plan to solve the problem (captured before coding and before any AI assistance).
- confidence (integer, nullable): 1-5 confidence in the plan (1 = very unsure, 5 = very confident).

scrutiny_responses:
- accuracy_judgment (text, not null, default ''): student judgment of AI response accuracy (correct / mostly_correct / partly_correct / incorrect / unsure).
- intended_action (text, not null, default ''): student's intended next action (test / modify / use_part / own_version / clarify / reject). Intention only - observed behaviour stays in behavioural traces.
- critique_text (text, not null, default ''): short critique, required only when accuracy_judgment = 'incorrect'.

reflections:
- difficulty (text, default ''): most difficult part (single choice).
- perceived_independence (text, default ''): how much of the problem was solved independently (single choice).
- ai_help_reflection (text, default ''): comma-joined existing AI help category keys the student found useful (retrospective; empty when AI was not used).
- ai_disagreement (text, default ''): yes / partly / no / unsure.
- ai_disagreement_text (text, default ''): optional free text, shown only for yes/partly.
- perceived_independent_ability (text, default ''): self-reported ability to solve a similar problem without AI (definitely_yes ... definitely_no). This is a PERCEIVED measure, not an objective transfer assessment.
- most_important_learning (text, default ''): open response (1-3 sentences).
- next_time_strategy (text, default ''): open response (1-3 sentences).

3. Modified tables
plans, scrutiny_responses, reflections gain the columns above. No columns are removed, renamed or retyped.

4. Security
No RLS changes: new columns inherit the existing owner-or-researcher table policies already defined on each table.

5. Important notes
- Existing historical columns (problem_summary, pseudocode, concepts_needed, ai_summary, is_correct_assessment, testing_plan, solution_explanation, changes_after_ai, etc.) remain in place with all their data; the student-facing forms simply stop asking those questions.
- event_logs.event_type has no CHECK constraint, so the new event types (PLAN_STARTED, PLAN_EDITED, PLAN_SUBMITTED, AI_ACCURACY_RATING, INTENDED_AI_UPTAKE, AI_CRITIQUE_TEXT, SCRUTINISE_SUBMITTED, REFLECTION_STARTED, REFLECTION_SUBMITTED) need no schema change.
- Idempotent: safe to re-run; each column is added only if missing.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'plan_text') THEN
    ALTER TABLE plans ADD COLUMN plan_text text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'confidence') THEN
    ALTER TABLE plans ADD COLUMN confidence integer;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scrutiny_responses' AND column_name = 'accuracy_judgment') THEN
    ALTER TABLE scrutiny_responses ADD COLUMN accuracy_judgment text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scrutiny_responses' AND column_name = 'intended_action') THEN
    ALTER TABLE scrutiny_responses ADD COLUMN intended_action text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'scrutiny_responses' AND column_name = 'critique_text') THEN
    ALTER TABLE scrutiny_responses ADD COLUMN critique_text text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'difficulty') THEN
    ALTER TABLE reflections ADD COLUMN difficulty text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'perceived_independence') THEN
    ALTER TABLE reflections ADD COLUMN perceived_independence text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'ai_help_reflection') THEN
    ALTER TABLE reflections ADD COLUMN ai_help_reflection text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'ai_disagreement') THEN
    ALTER TABLE reflections ADD COLUMN ai_disagreement text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'ai_disagreement_text') THEN
    ALTER TABLE reflections ADD COLUMN ai_disagreement_text text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'perceived_independent_ability') THEN
    ALTER TABLE reflections ADD COLUMN perceived_independent_ability text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'most_important_learning') THEN
    ALTER TABLE reflections ADD COLUMN most_important_learning text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reflections' AND column_name = 'next_time_strategy') THEN
    ALTER TABLE reflections ADD COLUMN next_time_strategy text NOT NULL DEFAULT '';
  END IF;
END $$;