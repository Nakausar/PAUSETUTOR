/*
# Fix recursive profile access during authentication

1. Problem
- The researcher profile policy queried `profiles` from inside a `profiles` policy.
- That caused PostgreSQL to recurse indefinitely whenever the signed-in app loaded its profile.
- New accounts could be created but could not reach either dashboard.

2. Policy change
- Removes the recursive `profiles_researcher_read_all` policy.
- Keeps the owner-only profile policy, allowing each signed-in person to load their own role, participant ID, consent status, and account profile.

3. Security
- Profiles remain protected by RLS.
- A user cannot read another user's profile or email through the profiles table.
- Researchers continue to access anonymised research records through the existing research-table policies, without needing private profiles.

4. Data safety
- No rows, columns, roles, participant IDs, consent records, or research data are changed or deleted.
*/

DROP POLICY IF EXISTS "profiles_researcher_read_all" ON public.profiles;
