-- Audit trail for corrections to approved grades.
-- Each row records who changed what, in an approved assessment, and when.

CREATE TABLE IF NOT EXISTS assessment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  change_kind text NOT NULL DEFAULT 'correction'
    CHECK (change_kind IN ('correction')),
  previous_mark integer,
  new_mark integer,
  previous_rubric jsonb,
  new_rubric jsonb,
  previous_feedback text,
  new_feedback text,
  previous_status text,
  new_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_audit_assessment_id ON assessment_audit(assessment_id);

ALTER TABLE assessment_audit ENABLE ROW LEVEL SECURITY;

-- Researchers: read the audit trail
DROP POLICY IF EXISTS "researcher_select_assessment_audit" ON assessment_audit;
CREATE POLICY "researcher_select_assessment_audit"
ON assessment_audit FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Researchers: insert audit rows when correcting approved grades
DROP POLICY IF EXISTS "researcher_insert_assessment_audit" ON assessment_audit;
CREATE POLICY "researcher_insert_assessment_audit"
ON assessment_audit FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'researcher'
  )
);

-- Students: no access. anon: no access.
REVOKE ALL ON assessment_audit FROM anon;