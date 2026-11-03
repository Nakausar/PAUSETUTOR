import { buildCorsHeaders } from "./cors.ts";
import { getCaller } from "./auth.ts";

const JUDGE0_URL = "https://ce.judge0.com";
const PYTHON_LANG_ID = 71;

interface Judge0Submission {
  source_code?: string;
  language_id?: number;
  stdin?: string;
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  status?: { id: number; description: string };
  time?: string | null;
  memory?: number | null;
  token?: string;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Only signed-in users may execute code.
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(
        JSON.stringify({ stdout: "", stderr: "Please sign in again.", exitCode: 1, error: "UNAUTHORIZED", systemError: true }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { code, stdin } = await req.json() as { code: string; stdin?: string };
    if (typeof code === "string" && code.length > 50000) {
      return new Response(
        JSON.stringify({ stdout: "", stderr: "Code is too long to run (max 50,000 characters).", exitCode: 1, error: "CODE_TOO_LONG", systemError: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing 'code' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stdinData = stdin ?? "";

    // Submit code to Judge0
    const submitRes = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=false`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_code: code,
        language_id: PYTHON_LANG_ID,
        stdin: stdinData,
      }),
    });

    if (!submitRes.ok) {
      return new Response(
        JSON.stringify({
          stdout: "",
          stderr: "Code execution service is temporarily unavailable. Please try again.",
          exitCode: 1,
          error: "EXECUTION_SERVICE_UNAVAILABLE",
          systemError: true,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const submission = (await submitRes.json()) as Judge0Submission;
    const token = submission.token;

    if (!token) {
      return new Response(
        JSON.stringify({
          stdout: "",
          stderr: "Code execution service is temporarily unavailable. Please try again.",
          exitCode: 1,
          error: "EXECUTION_SERVICE_UNAVAILABLE",
          systemError: true,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Poll for result (Judge0 is async). Max ~30 seconds.
    let result: Judge0Submission | null = null;
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(
        `${JUDGE0_URL}/submissions/${token}?base64_encoded=false`,
      );
      if (!pollRes.ok) continue;
      const pollData = (await pollRes.json()) as Judge0Submission;
      // status.id 1-2 = in queue/processing; 3+ = done
      if (pollData.status && pollData.status.id > 2) {
        result = pollData;
        break;
      }
    }

    if (!result) {
      return new Response(
        JSON.stringify({
          stdout: "",
          stderr: "Code execution timed out. Please try again.",
          exitCode: 1,
          error: "EXECUTION_TIMEOUT",
          systemError: true,
        }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Determine if this is a student code error vs system error
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const compileOutput = result.compile_output ?? "";
    const statusId = result.status?.id ?? 0;
    const statusDesc = result.status?.description ?? "Unknown";

    // Compile error = student code error (e.g. syntax error)
    if (compileOutput) {
      return new Response(
        JSON.stringify({
          stdout: "",
          stderr: compileOutput,
          exitCode: 1,
          error: compileOutput,
          systemError: false,
          executionTime: result.time,
          memory: result.memory,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Runtime error (status 4-12) = student code error
    // Accepted (status 3) = success
    // Other statuses = could be system issue
    const isStudentError = statusId >= 4 && statusId <= 12;
    const isError = isStudentError || (stderr.length > 0 && !stdout);

    return new Response(
      JSON.stringify({
        stdout,
        stderr,
        exitCode: isError ? 1 : 0,
        error: isError ? (stderr || statusDesc) : null,
        systemError: false,
        executionTime: result.time,
        memory: result.memory,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(
      JSON.stringify({
        stdout: "",
        stderr: "Code execution service is temporarily unavailable. Please try again.",
        exitCode: 1,
        error: "EXECUTION_SERVICE_UNAVAILABLE",
        systemError: true,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
