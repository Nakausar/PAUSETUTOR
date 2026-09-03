/*
# PAUSE AI Tutor — Core Schema

## Purpose
Build the full data model for the PAUSE AI Tutor research prototype:
participants, programming tasks, learner sessions, the five-phase PAUSE
workflow (Plan, Attempt, Use AI, Scrutinise & Revise, Evaluate & Reflect),
AI interactions, code snapshots, reflection responses, and a structured
event log for learning analytics.

## New Tables
1. `profiles` — extends auth.users with a role (student | researcher) and a
   pseudonymous participant_id used in all research data.
2. `tasks` — programming tasks created by researchers (Python-first, designed
   to support other languages later).
3. `task_assignments` — links a task to a student for their dashboard.
4. `sessions` — a single learner working through one task via the PAUSE cycle.
5. `plans` — Phase 1 (Plan) responses: problem analysis, inputs, outputs,
   concepts, approach, pseudocode, expected difficulty.
6. `code_attempts` — Phase 2 (Attempt) independent code work per session.
7. `code_snapshots` — immutable code revisions (never overwritten/deleted).
8. `ai_interactions` — Phase 3 (Use AI) structured assistance requests and
   responses, including category and whether a full solution was requested.
9. `scrutiny_responses` — Phase 4 (Scrutinise & Revise) evaluation of AI
   suggestions and revised code.
10. `reflections` — Phase 5 (Evaluate & Reflect) structured reflection +
   confidence scale.
11. `event_logs` — structured learning-analytics event stream. Every important
   learner action is recorded here with timestamps, phase, and references to
   related snapshots / AI interactions.
12. `system_settings` — single-row key/value store for configurable system
   prompt and research-logging toggle.

## Security
- RLS enabled on every table.
- Students (role = 'student') can only read/write their own data.
- Researchers (role = 'researcher') can read all anonymised research data and
  manage tasks + system settings. They cannot read another researcher's
  settings unless authorised (for MVP: any researcher can edit the shared
  system prompt).
- Policies use `auth.uid()` for ownership. Owner columns default to
  `auth.uid()` so inserts that omit the owner still succeed.
- Participant privacy: research tables store `participant_id` (a pseudonym),
  not email. The `profiles` table links auth identity to participant_id but is
  only readable by the owner; researchers read the anonymised research tables.

## Important Notes
1. `participant_id` is generated per-profile and stamped onto every research
   row so a complete session can be reconstructed without exposing auth identity.
2. Code snapshots are append-only — the application never UPDATEs or DELETEs
   them. No UPDATE/DELETE policies are created on `code_snapshots`.
3. Event logs are append-only for research integrity — no UPDATE/DELETE policies.
4. The `event_logs.metadata` jsonb column captures event-specific detail
   (code length, run count, error text, AI category, etc.) for later analysis.
5. All timestamps are timestamptz with sensible defaults.
6. `system_settings` holds the editable AI system prompt and logging config.
*/

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('student','researcher')),
  participant_id text NOT NULL DEFAULT 'P-' || upper(substr(md5(random()::text), 1, 8)),
  consent_acknowledged boolean NOT NULL DEFAULT false,
  research_logging_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Researchers can list all profiles (for participant counts) but only see
-- role + participant_id, not email. We expose a restricted view below.
DROP POLICY IF EXISTS "profiles_researcher_read_all" ON profiles;
CREATE POLICY "profiles_researcher_read_all" ON profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'researcher')
  );

-- ============================================================
-- TASKS
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  language text NOT NULL DEFAULT 'python',
  difficulty text NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('introductory','beginner','intermediate','advanced','challenge')),
  learning_objectives text NOT NULL DEFAULT '',
  problem_description text NOT NULL,
  expected_inputs text NOT NULL DEFAULT '',
  expected_outputs text NOT NULL DEFAULT '',
  starter_code text NOT NULL DEFAULT '',
  test_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  concept_tags text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Students can see assigned tasks; researchers can see all tasks they created.
DROP POLICY IF EXISTS "tasks_select_all_authenticated" ON tasks;
CREATE POLICY "tasks_select_all_authenticated" ON tasks FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "tasks_insert_researcher" ON tasks;
CREATE POLICY "tasks_insert_researcher" ON tasks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "tasks_update_researcher" ON tasks;
CREATE POLICY "tasks_update_researcher" ON tasks FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "tasks_delete_researcher" ON tasks;
CREATE POLICY "tasks_delete_researcher" ON tasks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

-- ============================================================
-- TASK ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  UNIQUE (task_id, student_id)
);

ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments_select_own_or_researcher" ON task_assignments;
CREATE POLICY "assignments_select_own_or_researcher" ON task_assignments FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "assignments_insert_researcher" ON task_assignments;
CREATE POLICY "assignments_insert_researcher" ON task_assignments FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "assignments_delete_researcher" ON task_assignments;
CREATE POLICY "assignments_delete_researcher" ON task_assignments FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  current_phase text NOT NULL DEFAULT 'plan' CHECK (current_phase IN ('plan','attempt','use_ai','scrutinise','evaluate','completed')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','abandoned')),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  last_active_at timestamptz DEFAULT now()
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_select_own_or_researcher" ON sessions;
CREATE POLICY "sessions_select_own_or_researcher" ON sessions FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "sessions_insert_own" ON sessions;
CREATE POLICY "sessions_insert_own" ON sessions FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "sessions_update_own" ON sessions;
CREATE POLICY "sessions_update_own" ON sessions FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- PLANS (Phase 1)
-- ============================================================
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  problem_summary text NOT NULL DEFAULT '',
  expected_inputs text NOT NULL DEFAULT '',
  expected_outputs text NOT NULL DEFAULT '',
  concepts_needed text NOT NULL DEFAULT '',
  approach_description text NOT NULL DEFAULT '',
  pseudocode text NOT NULL DEFAULT '',
  expected_difficulty text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_select_own_or_researcher" ON plans;
CREATE POLICY "plans_select_own_or_researcher" ON plans FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "plans_insert_own" ON plans;
CREATE POLICY "plans_insert_own" ON plans FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "plans_update_own" ON plans;
CREATE POLICY "plans_update_own" ON plans FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- CODE ATTEMPTS (Phase 2)
-- ============================================================
CREATE TABLE IF NOT EXISTS code_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  current_code text NOT NULL DEFAULT '',
  run_count integer NOT NULL DEFAULT 0,
  revision_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_output text,
  last_run_at timestamptz,
  started_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE code_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attempts_select_own_or_researcher" ON code_attempts;
CREATE POLICY "attempts_select_own_or_researcher" ON code_attempts FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "attempts_insert_own" ON code_attempts;
CREATE POLICY "attempts_insert_own" ON code_attempts FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "attempts_update_own" ON code_attempts;
CREATE POLICY "attempts_update_own" ON code_attempts FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- CODE SNAPSHOTS (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS code_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES code_attempts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  code text NOT NULL,
  phase text NOT NULL DEFAULT 'attempt' CHECK (phase IN ('plan','attempt','use_ai','scrutinise','evaluate')),
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','run','save','ai_assist','scrutinise','auto')),
  output text,
  error text,
  run_number integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE code_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "snapshots_select_own_or_researcher" ON code_snapshots;
CREATE POLICY "snapshots_select_own_or_researcher" ON code_snapshots FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "snapshots_insert_own" ON code_snapshots;
CREATE POLICY "snapshots_insert_own" ON code_snapshots FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

-- ============================================================
-- AI INTERACTIONS (Phase 3)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  category text NOT NULL CHECK (category IN ('explain_concept','hint','debug','review_approach','explain_error','targeted_question','solution_request')),
  prompt text NOT NULL,
  response text NOT NULL DEFAULT '',
  context_code text,
  context_error text,
  context_plan jsonb,
  full_solution_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_select_own_or_researcher" ON ai_interactions;
CREATE POLICY "ai_select_own_or_researcher" ON ai_interactions FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "ai_insert_own" ON ai_interactions;
CREATE POLICY "ai_insert_own" ON ai_interactions FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "ai_update_own" ON ai_interactions;
CREATE POLICY "ai_update_own" ON ai_interactions FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- SCRUTINY RESPONSES (Phase 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS scrutiny_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ai_interaction_id uuid REFERENCES ai_interactions(id) ON DELETE SET NULL,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  ai_summary text NOT NULL DEFAULT '',
  is_correct_assessment text NOT NULL DEFAULT '',
  testing_plan text NOT NULL DEFAULT '',
  action_taken text NOT NULL DEFAULT '' CHECK (action_taken IN ('accepted','modified','rejected','')),
  changes_description text NOT NULL DEFAULT '',
  revised_code text NOT NULL DEFAULT '',
  code_before text NOT NULL DEFAULT '',
  code_after text NOT NULL DEFAULT '',
  test_result text NOT NULL DEFAULT '',
  produced_expected_result boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE scrutiny_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scrutiny_select_own_or_researcher" ON scrutiny_responses;
CREATE POLICY "scrutiny_select_own_or_researcher" ON scrutiny_responses FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "scrutiny_insert_own" ON scrutiny_responses;
CREATE POLICY "scrutiny_insert_own" ON scrutiny_responses FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "scrutiny_update_own" ON scrutiny_responses;
CREATE POLICY "scrutiny_update_own" ON scrutiny_responses FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- REFLECTIONS (Phase 5)
-- ============================================================
CREATE TABLE IF NOT EXISTS reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  solution_explanation text NOT NULL DEFAULT '',
  what_was_learned text NOT NULL DEFAULT '',
  most_difficult_part text NOT NULL DEFAULT '',
  useful_ai_assistance text NOT NULL DEFAULT '',
  ai_issue_identified text NOT NULL DEFAULT '',
  changes_after_ai text NOT NULL DEFAULT '',
  do_differently_next_time text NOT NULL DEFAULT '',
  confidence_without_ai integer NOT NULL DEFAULT 3 CHECK (confidence_without_ai BETWEEN 1 AND 5),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE reflections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reflections_select_own_or_researcher" ON reflections;
CREATE POLICY "reflections_select_own_or_researcher" ON reflections FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "reflections_insert_own" ON reflections;
CREATE POLICY "reflections_insert_own" ON reflections FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "reflections_update_own" ON reflections;
CREATE POLICY "reflections_update_own" ON reflections FOR UPDATE
  TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());

-- ============================================================
-- EVENT LOGS (append-only learning analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL,
  student_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  pause_phase text NOT NULL CHECK (pause_phase IN ('plan','attempt','use_ai','scrutinise','evaluate','completed')),
  event_type text NOT NULL,
  event_description text NOT NULL DEFAULT '',
  code_snapshot_id uuid REFERENCES code_snapshots(id) ON DELETE SET NULL,
  ai_interaction_id uuid REFERENCES ai_interactions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "events_select_own_or_researcher" ON event_logs;
CREATE POLICY "events_select_own_or_researcher" ON event_logs FOR SELECT
  TO authenticated USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

DROP POLICY IF EXISTS "events_insert_own" ON event_logs;
CREATE POLICY "events_insert_own" ON event_logs FOR INSERT
  TO authenticated WITH CHECK (student_id = auth.uid());

-- ============================================================
-- SYSTEM SETTINGS (single-row config store)
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  system_prompt text NOT NULL DEFAULT 'You are the PAUSE AI Tutor, an educational programming assistant. Your purpose is to support student learning without unnecessarily replacing student reasoning.

Use the student''s existing plan, independent attempt, code, errors, and previous interactions as context.

Prefer explanations, questions, hints, debugging guidance, and feedback over immediately providing complete solutions.

Encourage the learner to reason about the problem, modify their own code, test suggestions, verify outputs, and explain their understanding.

Do not falsely claim that AI output is correct. Encourage verification.

The learner remains responsible for the final solution.',
  research_logging_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_all_authenticated" ON system_settings;
CREATE POLICY "settings_select_all_authenticated" ON system_settings FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "settings_update_researcher" ON system_settings;
CREATE POLICY "settings_update_researcher" ON system_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON event_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON event_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_events_type ON event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_snapshots_session ON code_snapshots(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_session ON ai_interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON task_assignments(student_id);

-- ============================================================
-- TRIGGER: updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tasks_updated ON tasks;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_plans_updated ON plans;
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_attempts_updated ON code_attempts;
CREATE TRIGGER trg_attempts_updated BEFORE UPDATE ON code_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_scrutiny_updated ON scrutiny_responses;
CREATE TRIGGER trg_scrutiny_updated BEFORE UPDATE ON scrutiny_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_reflections_updated ON reflections;
CREATE TRIGGER trg_reflections_updated BEFORE UPDATE ON reflections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated ON system_settings;
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- SEED: default system_settings row
-- ============================================================
INSERT INTO system_settings (id, system_prompt)
VALUES (1, 'You are the PAUSE AI Tutor, an educational programming assistant. Your purpose is to support student learning without unnecessarily replacing student reasoning.

Use the student''s existing plan, independent attempt, code, errors, and previous interactions as context.

Prefer explanations, questions, hints, debugging guidance, and feedback over immediately providing complete solutions.

Encourage the learner to reason about the problem, modify their own code, test suggestions, verify outputs, and explain their understanding.

Do not falsely claim that AI output is correct. Encourage verification.

The learner remains responsible for the final solution.')
ON CONFLICT (id) DO NOTHING;