import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Service-role client: bypasses RLS. Only use after checking who the caller is. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  user: User;
  role: "student" | "researcher";
  participantId: string;
}

/**
 * Resolves the signed-in user from the request's bearer token.
 * The public anon key is itself a valid JWT, so `verify_jwt = true` alone does
 * NOT prove a user is signed in. This check does.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || token === SUPABASE_ANON_KEY) return null;

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await adminClient()
    .from("profiles")
    .select("role, participant_id")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile) return null;

  return { user: data.user, role: profile.role, participantId: profile.participant_id };
}
