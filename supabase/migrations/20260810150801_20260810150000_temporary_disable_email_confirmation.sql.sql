/*
# Temporarily disable email confirmation for the PAUSE research prototype

1. Purpose
- New password-based accounts become active immediately during prototype development.
- This removes the need to open an email confirmation link before the first sign-in.

2. Database changes
- Adds `public.auto_confirm_new_user()` as a trigger-only function.
- The function sets `auth.users.email_confirmed_at` and `auth.users.confirmed_at` when a new account is created and those values are not already present.
- Existing profiles, participant IDs, consent records, event logs, roles, and all PAUSE data remain unchanged.

3. Trigger changes
- Adds `on_auth_user_auto_confirm` before-insert trigger on `auth.users`.
- The existing profile trigger remains responsible for creating the role-based profile and pseudonymous participant ID.

4. Security
- The helper function uses a fixed `search_path` and is not callable through the public API.
- The behavior applies only to newly created accounts and does not expose profile or research data.

5. Re-enabling confirmation
- Before the real study, remove the `on_auth_user_auto_confirm` trigger and the helper function, then enable email confirmations in the Supabase Auth settings.
- No application data migration is required to restore the normal confirmation flow.
*/

CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
  NEW.confirmed_at := COALESCE(NEW.confirmed_at, NEW.email_confirmed_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_auto_confirm
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_new_user();

REVOKE EXECUTE ON FUNCTION public.auto_confirm_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_confirm_new_user() FROM authenticated;
