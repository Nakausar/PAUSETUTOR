/*
# Create assessments table (programming marks + metacognitive ratings)

1. Purpose
- Stores per-session assessment records for the PAUSE AI Tutor.
- Each record links a student session to:
  a) A programming mark (0-100) with written programming feedback.
  b) Four qualitative metacognitive ratings (Planning, Monitoring/Attempt,
     Critical Scrutiny of AI, Evaluation).
- AI may SUGGEST marks and ratings (ai_suggested_*), but nothing is visible
  to students until a researcher explicitly approves it (status='approved').

2. New Tables
- `assessments`
  - id (uuid PK)
  - session_id (uuid, references sessions) — the assessed session
  - task_id (uuid, references tasks) — the task being assessed
  - student_id (uuid, references profiles) — the student assessed
  - participant_id (text) — pseudonymous research ID
  - status (text: 'pending' | 'approved') — approval gate; students only see 'approved'
  - ai_suggested_at (timestamptz) — when AI produced its suggestion
  - ai_suggested_mark (integer, 0-100) — AI's suggested programming mark
  - ai_programming_feedback (text) — AI's suggested programming feedback
  - ai_suggested_planning (text rating) — AI's suggested rating
  - ai_suggested_monitoring (text rating)
  - ai_suggested_scrutiny (text rating)
  - ai_suggested_evaluation (text rating)
  - approved_mark (integer, 0-100) — researcher-approved programming mark
  - programming_feedback (text) — researcher-approved programming feedback
  - metacog_planning (text rating) — researcher-approved rating
  - metacog_monitoring (text rating)
  - metacog_scrutiny (text rating)
  - metacog_evaluation (text rating)
  - evidence_refs (jsonb) — evidence references (plan ids, snapshot ids,
    interaction ids, event ids) supporting the metacognitive ratings
  - approved_at (timestamptz) — when the researcher approved
  - approved_by (uuid, references profiles) — which researcher approved
  - created_at / updated_at (timestamptz)
- Rating values (for all rating columns): 'excellent' | 'good' |
  'needs_improvement' | 'not_observed' | 'not_applicable'.
- One assessment per session (UNIQUE(session_id)).

3. Security (RLS)
- RLS enabled.
- Researchers (role='researcher' in profiles): full read access, and
  insert/update for managing assessment records.
- Students: SELECT only, and only rows for their own sessions AND only
  when status='approved' (nothing unapproved is ever visible to students).
- Unauthenticated/anon: no access.
*/

CREATE TABLE IF NOT EXISTS assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  student_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  participant_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved')),
  ai_suggested_at timestamptz,
  ai_suggested_mark integer
    CHECK (ai_suggested_mark IS NULL OR (ai_suggested_mark >= 0 AND ai_suggested_mark <= 100)),
  ai_programming_feedback text,
  ai_suggested_planning text,
  ai_suggested_monitoring text,
  ai_suggested_scrutiny text,
  ai_suggested_evaluation text,
  approved_mark integer
    CHECK (approved_mark IS NULL OR (approved_mark >= 0 AND approved_mark <= 100)),
  programming_feedback text,
  metacog_planning text,
  metacog_monitoring text,
  metacog_scrutiny text,
  metacog_evaluation text,
  evidence_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_session_id ON assessments(session_id);
CREATE INDEX IF NOT EXISTS idx_assessments_student_id ON assessments(student_id);

ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

-- Researchers: full read access
DROP POLICY IF EXISTS "researcher_select_assessments" ON assessments;
CREATE POLICY "researcher_select_assessments"
ON assessments FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Researchers: insert (create pending assessment records from AI suggestions)
DROP POLICY IF EXISTS "researcher_insert_assessments" ON assessments;
CREATE POLICY "researcher_insert_assessments"
ON assessments FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Researchers: update (approve/modify marks and ratings)
DROP POLICY IF EXISTS "researcher_update_assessments" ON assessments;
CREATE POLICY "researcher_update_assessments"
ON assessments FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Researchers: delete
DROP POLICY IF EXISTS "researcher_delete_assessments" ON assessments;
CREATE POLICY "researcher_delete_assessments"
ON assessments FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Students: read ONLY their own APPROVED assessments
DROP POLICY IF EXISTS "student_select_approved_own_assessments" ON assessments;
CREATE POLICY "student_select_approved_own_assessments"
ON assessments FOR SELECT
TO authenticated
USING (
  status = 'approved'
  AND student_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'student'
  )
);