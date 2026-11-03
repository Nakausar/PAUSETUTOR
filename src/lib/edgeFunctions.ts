import { supabase } from './supabase';

/**
 * Calls a Supabase edge function as the signed-in user.
 * Sends the user's access token (not the public anon key), so the function can
 * check who is calling and what they are allowed to do.
 */
export async function callEdgeFunction(name: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });
}
