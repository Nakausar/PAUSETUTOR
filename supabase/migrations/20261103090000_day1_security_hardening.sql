/*
# Day 1 security hardening (before any participant uses the system)

1. Roles can no longer be self-assigned
   - `handle_new_user()` always creates a `student` profile. The `role` value a
     browser sends in sign-up metadata is ignored.
   - Researchers are promoted manually by the study team (see bottom of file).
   - The new `protect_profile_fields` trigger stops a signed-in user from changing
     their own `role` or `participant_id` through the public API.

2. Consent is actually stored
   - The sign-up form sent `consent_acknowledged` in metadata, but the old trigger
     never copied it into `profiles`, so every profile showed `false`.

3. AI interactions are written by the server only
   - The `ai-tutor` edge function now inserts `ai_interactions` rows with the
     service role. Students can no longer insert, edit or fake AI logs.

4. Email confirmation is re-enabled at the database level
   - Removes the temporary `on_auth_user_auto_confirm` trigger. Also switch on
     "Confirm email" in Supabase Dashboard → Authentication → Sign In / Providers → Email.
*/

-- 1 + 2. Sign-up trigger: always student, store consent ------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, consent_acknowledged)
  VALUES (
    NEW.id,
    NEW.email,
    'student',
    COALESCE((NEW.raw_user_meta_data->>'consent_acknowledged')::boolean, false)
  );
  RETURN NEW;
END;
$$;

-- 1. Block self-service changes to role and participant_id ---------------------
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Requests from the app carry an `authenticated` (or `anon`) JWT. The SQL
  -- editor (no JWT) and the service role (edge functions) may still change these.
  IF coalesce(auth.role(), '') IN ('authenticated', 'anon') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'profiles.role cannot be changed from the application';
    END IF;
    IF NEW.participant_id IS DISTINCT FROM OLD.participant_id THEN
      RAISE EXCEPTION 'profiles.participant_id cannot be changed from the application';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_fields ON public.profiles;
CREATE TRIGGER profiles_protect_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- Profiles may only be created by the sign-up trigger, never by the client.
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

-- 3. AI interactions: server-side writes only -----------------------------------
DROP POLICY IF EXISTS "ai_insert_own" ON public.ai_interactions;
DROP POLICY IF EXISTS "ai_update_own" ON public.ai_interactions;

-- Reproducibility metadata for each AI response.
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS prompt_hash text;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE public.ai_interactions ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ai_interactions_student_created_idx
  ON public.ai_interactions (student_id, created_at DESC);

-- 4. Re-enable email confirmation ------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
DROP FUNCTION IF EXISTS public.auto_confirm_new_user();

/*
## Promoting a researcher (run manually in the Supabase SQL editor)

  UPDATE public.profiles SET role = 'researcher' WHERE email = 'name@uef.fi';

## Checking for accounts that self-assigned researcher before this fix

  SELECT email, role, created_at FROM public.profiles WHERE role = 'researcher';
*/
