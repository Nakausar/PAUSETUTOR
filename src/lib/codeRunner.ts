
export interface RunResult {
  output: string;
  error: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
  systemError: boolean;
}

/**
 * Executes Python code by calling the `run-python` edge function.
 * The edge function forwards to the Piston sandboxed execution API.
 * Returns combined stdout/stderr and a structured result.
 *
 * `systemError` is true when the failure is infrastructure (HTTP 500, network),
 * not a student code error. Callers should log EXECUTION_ERROR instead of ERROR
 * in that case so research analytics don't conflate the two.
 */
export async function runPythonCode(code: string, stdin: string = ''): Promise<RunResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${supabaseUrl}/functions/v1/run-python`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ code, stdin }),
    });

    const data = await response.json().catch(() => null) as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      error?: string;
      systemError?: boolean;
    } | null;

    // System/infrastructure failure — not a student code error
    if (!response.ok && (!data || data.systemError)) {
      const text = data?.stderr || `Execution service unavailable (HTTP ${response.status})`;
      return {
        output: 'Code execution service is temporarily unavailable. Please try again.',
        error: text,
        exitCode: 1,
        stdout: '',
        stderr: text,
        systemError: true,
      };
    }

    // Student code error or success
    const stdout = data?.stdout ?? '';
    const stderr = data?.stderr ?? '';
    const error = data?.error ?? (stderr ? stderr : null);
    const combined = [stdout, stderr].filter(Boolean).join('\n');

    return {
      output: combined || (error ? error : '(no output)'),
      error,
      exitCode: data?.exitCode ?? 0,
      stdout,
      stderr,
      systemError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      output: 'Code execution service is temporarily unavailable. Please try again.',
      error: message,
      exitCode: 1,
      stdout: '',
      stderr: message,
      systemError: true,
    };
  }
}

/**
 * Runs a set of test cases against student code by injecting a test harness.
 * Returns per-case results.
 */
export interface TestCaseResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  error: string | null;
}

export async function runTestCases(
  code: string,
  testCases: { input: string; expected: string }[],
): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  for (const tc of testCases) {
    const result = await runPythonCode(code, tc.input || '');
    const actual = result.stdout.trim();
    const expected = tc.expected.trim();
    results.push({
      passed: actual === expected && !result.error,
      input: tc.input,
      expected,
      actual,
      error: result.error,
    });
  }

  return results;
}
