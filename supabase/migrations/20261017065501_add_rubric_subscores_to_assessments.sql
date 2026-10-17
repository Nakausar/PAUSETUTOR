/*
# Add 100-mark programming rubric sub-scores to assessments

1. Purpose
Implements the approved 100-mark programming rubric as four component
sub-scores alongside the total mark:
- Code correctness: 0-40
- Problem-solving approach: 0-20
- Code quality: 0-20
- Testing and debugging: 0-20
Both AI-suggested drafts and researcher-approved values are stored, so the
researcher dashboard can compare AI suggestions against approved outcomes
and preserve the researcher's changes and approval timestamps.

2. Modified tables
- `assessments` — new nullable integer columns:
  - ai_suggested_correctness (0-40), ai_suggested_approach (0-20),
    ai_suggested_quality (0-20), ai_suggested_testing (0-20)
  - approved_correctness (0-40), approved_approach (0-20),
    approved_quality (0-20), approved_testing (0-20)
  All nullable: existing rows and manual mark entry without sub-scores
  remain valid. CHECK constraints enforce the rubric ranges.

3. Security
- No policy changes: the existing researcher-only write policies and the
  student "own approved rows only" read policy continue to apply to the
  new columns.
*/

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_suggested_correctness integer CHECK (ai_suggested_correctness IS NULL OR (ai_suggested_correctness >= 0 AND ai_suggested_correctness <= 40));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_suggested_approach integer CHECK (ai_suggested_approach IS NULL OR (ai_suggested_approach >= 0 AND ai_suggested_approach <= 20));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_suggested_quality integer CHECK (ai_suggested_quality IS NULL OR (ai_suggested_quality >= 0 AND ai_suggested_quality <= 20));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS ai_suggested_testing integer CHECK (ai_suggested_testing IS NULL OR (ai_suggested_testing >= 0 AND ai_suggested_testing <= 20));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approved_correctness integer CHECK (approved_correctness IS NULL OR (approved_correctness >= 0 AND approved_correctness <= 40));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approved_approach integer CHECK (approved_approach IS NULL OR (approved_approach >= 0 AND approved_approach <= 20));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approved_quality integer CHECK (approved_quality IS NULL OR (approved_quality >= 0 AND approved_quality <= 20));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approved_testing integer CHECK (approved_testing IS NULL OR (approved_testing >= 0 AND approved_testing <= 20));