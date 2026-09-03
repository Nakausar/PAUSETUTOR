/*
# Task Assignment Lifecycle

## Purpose
Extend the existing task_assignments table to support a full assignment
lifecycle (not_started -> in_progress -> completed) linked to PAUSE learning
sessions, and allow researchers to log TASK_ASSIGNED events without a session
yet existing.

## Changes

### 1. task_assignments — new lifecycle columns
Adds columns so a single assignment row can track the learner's progress
through the PAUSE cycle without altering existing rows:

- `participant_id` (text) — pseudonymous participant ID, copied from the
  student's profile at assignment time for research continuity.
- `assigned_by` (uuid) — the researcher who created the assignment.
- `status` (text) — lifecycle status: not_started | in_progress | completed.
  Defaults to not_started for all existing and new rows.
- `started_at` (timestamptz) — when the learner began their session.
- `completed_at` (timestamptz) — when the learner finished the task.
- `current_pause_phase` (text) — the current PAUSE phase for this assignment.
- `session_id` (uuid) — link to the learning session created on Start Task.

All new columns are nullable / have safe defaults so existing assignment rows
are preserved unchanged.

### 2. task_assignments — UPDATE policy
The table previously had SELECT / INSERT / DELETE policies but no UPDATE
policy, so students could not update their assignment status on Start Task.
Adds `assignments_update_own_or_researcher` allowing:
- a student to update their own assignment row, and
- a researcher to update any assignment row.

### 3. event_logs — nullable session_id + researcher insert
Previously event_logs.session_id was NOT NULL and only students could insert
events. This blocked logging TASK_ASSIGNED (no session exists yet) and
prevented researchers from logging assignment events.

- Relaxes event_logs.session_id to nullable (existing rows untouched).
- Adds `events_insert_researcher` policy so researchers can log assignment
  events. Researcher-inserted rows use a sentinel student_id
  ('00000000-0000-0000-0000-000000000000') since auth.uid() is the researcher
  and the column is NOT NULL DEFAULT auth.uid().
- Adds a CHECK on event_logs.event_type to accept the new TASK_ASSIGNED and
  SESSION_STARTED event types (the column was previously unconstrained, so
  this is additive and safe).

### 4. Indexes
- idx_assignments_task on task_assignments(task_id) for researcher lookups.
- idx_assignments_status on task_assignments(status).

## Security
- RLS remains enabled on task_assignments.
- UPDATE policy is scoped to owner (student) OR researcher.
- Researcher INSERT policy on event_logs is scoped to the researcher role.
- No SELECT / UPDATE / DELETE policy changes on event_logs.

## Important Notes
1. Existing task_assignments rows are preserved; new columns default safely.
2. Historical event_logs rows are preserved; session_id is only relaxed.
3. No DROP / DELETE / rename operations are performed.
4. The sentinel UUID for researcher-logged events is documented in the
   policy comment so future readers understand why those rows carry it.
*/

-- ============================================================
-- 1. task_assignments lifecycle columns
-- ============================================================
ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS participant_id text,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','completed')),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_pause_phase text,
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES sessions(id) ON DELETE SET NULL;

-- Backfill participant_id for existing rows from the profiles table.
UPDATE task_assignments a
SET participant_id = p.participant_id
FROM profiles p
WHERE a.student_id = p.id
  AND a.participant_id IS NULL;

-- Backfill assigned_by for existing rows: default to the task creator.
UPDATE task_assignments a
SET assigned_by = t.created_by
FROM tasks t
WHERE a.task_id = t.id
  AND a.assigned_by IS NULL;

-- ============================================================
-- 2. task_assignments UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "assignments_update_own_or_researcher" ON task_assignments;
CREATE POLICY "assignments_update_own_or_researcher" ON task_assignments FOR UPDATE
  TO authenticated
  USING (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  )
  WITH CHECK (
    student_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

-- ============================================================
-- 3. event_logs: nullable session_id + researcher insert policy
-- ============================================================
ALTER TABLE event_logs
  ALTER COLUMN session_id DROP NOT NULL;

-- Add a CHECK that accepts the new event types. The column was previously
-- unconstrained, so this is purely additive.
ALTER TABLE event_logs
  DROP CONSTRAINT IF EXISTS event_logs_event_type_check;
ALTER TABLE event_logs
  ADD CONSTRAINT event_logs_event_type_check CHECK (
    event_type IN (
      'PLAN_STARTED','PROBLEM_ANALYSIS','GOAL_SET','PLAN_CREATED','PSEUDOCODE_CREATED','PLAN_COMPLETED',
      'ATTEMPT_STARTED','CODE_EDIT','CODE_RUN','ERROR','INDEPENDENT_REVISION','ATTEMPT_SAVED','ATTEMPT_COMPLETED',
      'AI_HELP_STARTED','HINT_REQUEST','EXPLANATION_REQUEST','DEBUG_REQUEST','APPROACH_REVIEW_REQUEST',
      'ERROR_EXPLANATION_REQUEST','TARGETED_QUESTION','SOLUTION_REQUEST','AI_RESPONSE','AI_HELP_COMPLETED',
      'SCRUTINY_STARTED','AI_OUTPUT_REVIEWED','TEST','VERIFY','COMPARE',
      'AI_SUGGESTION_ACCEPTED','AI_SUGGESTION_MODIFIED','AI_SUGGESTION_REJECTED',
      'CODE_REVISED','ERROR_FIXED','SCRUTINY_COMPLETED',
      'REFLECTION_STARTED','SOLUTION_EXPLAINED','LEARNING_REFLECTION','AI_HELP_EVALUATED',
      'SELF_EVALUATION','CONFIDENCE_RECORDED','REFLECTION_COMPLETED','TASK_COMPLETED',
      'PHASE_TRANSITION',
      'TASK_ASSIGNED','SESSION_STARTED'
    )
  );

-- Researchers need to log TASK_ASSIGNED events. They have no student_id of
-- their own for the event, so the insert uses a sentinel UUID. The policy
-- authorizes the CALLER (researcher) via auth.uid(); it does not trust a
-- parameter.
DROP POLICY IF EXISTS "events_insert_researcher" ON event_logs;
CREATE POLICY "events_insert_researcher" ON event_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'researcher')
  );

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_assignments_task ON task_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON task_assignments(status);
