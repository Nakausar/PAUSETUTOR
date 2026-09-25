/*
# Add confidence column to reflections

1. Overview
Fixes the runtime error "Could not find the 'confidence' column of 'reflections' in the schema cache".
The updated REFLECT (Evaluate & Reflect) form saves a 1-5 confidence rating, but the reflections table
never received that column. Every other field written by the REFLECT form already exists in the table.

2. New columns
reflections:
- `confidence` (integer, nullable): student's self-reported confidence (1-5) that they could solve a
  similar problem independently. Nullable because it is only written by the new REFLECT form; rows
  created by the previous form (which used `confidence_without_ai`) keep NULL here.
- Constraint: CHECK (confidence BETWEEN 1 AND 5), named `reflections_confidence_check`, so only
  valid 1-5 ratings can be stored. NULL is allowed by the constraint.

3. Modified tables
- `reflections` only. No other tables are touched.

4. Security
- No RLS or policy changes: the new column inherits the existing owner-or-researcher policies
  already defined on `reflections`.

5. Important notes
1. Fully additive: no columns are dropped, renamed or retyped. The historical `confidence_without_ai`
   column and all existing research data are preserved untouched.
2. Idempotent: safe to re-run; the column is added only if missing.
*/ 

ALTER TABLE reflections
  ADD COLUMN IF NOT EXISTS confidence integer
  CONSTRAINT reflections_confidence_check CHECK (confidence BETWEEN 1 AND 5);