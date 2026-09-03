-- Add stdin column to code_snapshots to store program input per execution
ALTER TABLE public.code_snapshots ADD COLUMN IF NOT EXISTS stdin text;
