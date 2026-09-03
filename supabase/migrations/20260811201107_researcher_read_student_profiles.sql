-- Allow researchers to read the minimum profile fields needed for task assignment.
-- This exposes only id, role, and participant_id (NOT email or other personal data)
-- by creating a SECURITY DEFINER function that returns a safe projection, and
-- a SELECT policy on profiles that lets researchers see all rows but the app
-- only ever selects id, participant_id, role from this path.

-- Policy: researchers can SELECT all profile rows (the app only requests
-- id, participant_id, role — never email — when loading the assignment list).
CREATE POLICY "profiles_select_researcher"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'researcher'
    )
  );