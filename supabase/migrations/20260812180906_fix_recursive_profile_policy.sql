-- Fix recursive RLS on profiles table.
-- The profiles_select_researcher policy queried profiles from within its own
-- RLS policy, causing infinite recursion that broke ALL profile reads.
--
-- Solution: drop the recursive policy and replace it with a SECURITY DEFINER
-- function that checks the caller's role (bypassing RLS on the inner query),
-- then use that function in a new non-recursive SELECT policy.

-- Drop the broken recursive policy
DROP POLICY IF EXISTS "profiles_select_researcher" ON public.profiles;

-- Create a SECURITY DEFINER function that safely checks if the calling user
-- is a researcher. This bypasses RLS on its inner query, avoiding recursion.
CREATE OR REPLACE FUNCTION public.is_current_user_researcher()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'researcher'
  );
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.is_current_user_researcher() TO authenticated;

-- New non-recursive SELECT policy: users can read their own profile OR
-- researchers can read all profiles (for task assignment participant lists).
CREATE POLICY "profiles_select_own_or_researcher"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id OR public.is_current_user_researcher()
  );