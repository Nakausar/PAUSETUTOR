import { callEdgeFunction } from './edgeFunctions';
import { PythonUnavailableError, runInBrowser } from './python/browserRunner';
import type { TestCase } from './types';

export interface RunResult {
  output: string;
  error: string | null;
  exitCode: number;
  stdout: string;
  stderr: string;
  /**
   * True when the failure is infrastructure (Python could not load, server
   * unreachable), not a student code error. Callers log EXECUTION_ERROR instead
   * of ERROR in that case so research analytics don't conflate the two.
   */
  systemError: boolean;
  /** Where the code ran: 'browser' (Pyodide) or 'server' (run-python edge function). */
  runner: 'browser' | 'server';
  timedOut: boolean;
  durationMs: number | null;
}

/**
 * VITE_CODE_RUNNER:
 * - 'browser' (default): run Python on the student's device with Pyodide;
 *   fall back to the run-python edge function if Python cannot load.
 * - 'browser-only': as above, but never send code to the server (no fallback).
 * - 'server': always use the run-python edge function.
 */
const RUNNER_SETTING = import.meta.env.VITE_CODE_RUNNER as string | undefined;
const RUNNER_MODE = RUNNER_SETTING === 'server' ? 'server' : 'browser';
const ALLOW_SERVER_FALLBACK = RUNNER_SETTING !== 'browser-only';
let browserUnavailable = false;

const UNAVAILABLE_MESSAGE = 'Code execution service is temporarily unavailable. Please try again.';

export async function runPythonCode(code: string, stdin: string = '', options: { echoPrompts?: boolean } = {}): Promise<RunResult> {
  if (RUNNER_MODE === 'browser' && !browserUnavailable) {
    try {
      const r = await runInBrowser(code, stdin, undefined, options.echoPrompts ?? true);
      const error = r.error ? r.error : null;
      const separator = r.stderr && r.error && !r.stderr.endsWith('\n') ? '\n' : '';
      const stderr = r.stderr + (r.error ? separator + r.error : '');
      const notice = r.truncated ? '\n[Output truncated: your program printed too much.]' : '';
      const combined = [r.stdout, stderr].filter(Boolean).join('\n') + notice;
      return {
        output: combined || '(no output)',
        error,
        exitCode: r.exitCode,
        stdout: r.stdout,
        stderr,
        systemError: false,
        runner: 'browser',
        timedOut: r.timedOut,
        durationMs: r.durationMs,
      };
    } catch (err) {
      if (!(err instanceof PythonUnavailableError)) throw err;
      if (!ALLOW_SERVER_FALLBACK) {
        return { output: 'Python could not start in this browser. Please reload the page or try an up-to-date Chrome, Edge, Firefox or Safari.', error: err.message, exitCode: 1, stdout: '', stderr: err.message, systemError: true, runner: 'browser', timedOut: false, durationMs: null };
      }
      console.warn('In-browser Python unavailable, falling back to server:', err.message);
      browserUnavailable = true;
    }
  }
  return runOnServer(code, stdin);
}

async function runOnServer(code: string, stdin: string): Promise<RunResult> {
  const base = { runner: 'server' as const, timedOut: false, durationMs: null };
  try {
    const response = await callEdgeFunction('run-python', { code, stdin });
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
      return { ...base, output: UNAVAILABLE_MESSAGE, error: text, exitCode: 1, stdout: '', stderr: text, systemError: true };
    }

    const stdout = data?.stdout ?? '';
    const stderr = data?.stderr ?? '';
    const error = data?.error ?? (stderr ? stderr : null);
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    return { ...base, output: combined || (error ? error : '(no output)'), error, exitCode: data?.exitCode ?? 0, stdout, stderr, systemError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, output: UNAVAILABLE_MESSAGE, error: message, exitCode: 1, stdout: '', stderr: message, systemError: true };
  }
}

export interface TestCaseResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  error: string | null;
  hidden: boolean;
  timedOut: boolean;
  systemError: boolean;
}

/** Compare outputs ignoring Windows line endings and trailing spaces on each line. */
export function normaliseOutput(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

/** Runs the student's program once per test case, feeding the case input as stdin. */
export async function runTestCases(code: string, testCases: TestCase[]): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];
  for (const tc of testCases) {
    const result = await runPythonCode(code, tc.input || '', { echoPrompts: false });
    const actual = normaliseOutput(result.stdout);
    const expected = normaliseOutput(tc.expected);
    results.push({
      passed: !result.error && actual === expected,
      input: tc.input,
      expected,
      actual,
      error: result.error,
      hidden: Boolean(tc.hidden),
      timedOut: result.timedOut,
      systemError: result.systemError,
    });
  }
  return results;
}
