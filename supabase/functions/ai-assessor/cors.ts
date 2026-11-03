/**
 * CORS: only the origins listed in the ALLOWED_ORIGIN secret may call this
 * function from a browser (comma-separated, e.g.
 * "https://pause-tutor.netlify.app,http://localhost:5173").
 * If the secret is not set yet, any origin is allowed so local setup still works;
 * every request must still carry a valid signed-in user token.
 */
const ALLOWED = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = ALLOWED.length === 0 ? "*" : ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}
