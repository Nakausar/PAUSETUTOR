import type { WorkerRequest, WorkerResponse } from './pythonWorker';

/** Max wall-clock time for one program run before it is stopped. */
export const RUN_TIMEOUT_MS = 5000;
/** Max time to download and start Python (first visit can be slow on poor networks). */
const LOAD_TIMEOUT_MS = 90000;

export interface BrowserRunOutcome {
  stdout: string;
  stderr: string;
  /** Traceback / error text for student-code errors, '' on success. */
  error: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

export class PythonUnavailableError extends Error {}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let nextId = 1;
// Runs are serialised: one program at a time per tab.
let queue: Promise<unknown> = Promise.resolve();

function resetWorker() {
  worker?.terminate();
  worker = null;
  ready = null;
}

function ensureWorker(): Promise<void> {
  if (ready) return ready;
  const w = new Worker(new URL('./pythonWorker.ts', import.meta.url), { type: 'module' });
  worker = w;
  ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      resetWorker();
      reject(new PythonUnavailableError('Python took too long to load.'));
    }, LOAD_TIMEOUT_MS);
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === 'ready') {
        clearTimeout(timer); w.removeEventListener('message', onMessage); resolve();
      } else if (event.data.type === 'init-error') {
        clearTimeout(timer); w.removeEventListener('message', onMessage);
        const message = event.data.message;
        resetWorker();
        reject(new PythonUnavailableError(message));
      }
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', (e) => {
      clearTimeout(timer);
      resetWorker();
      reject(new PythonUnavailableError(e.message || 'Python worker failed to start.'));
    }, { once: true });
    w.postMessage({ type: 'init' } satisfies WorkerRequest);
  });
  return ready;
}

/** Start downloading Python in the background (call when the workspace opens). */
export function preloadPython(): void {
  ensureWorker().catch(() => { /* reported on first run */ });
}

function runOnce(code: string, stdin: string, timeoutMs: number, echoPrompts: boolean): Promise<BrowserRunOutcome> {
  return ensureWorker().then(() => new Promise<BrowserRunOutcome>((resolve, reject) => {
    const w = worker;
    if (!w) { reject(new PythonUnavailableError('Python worker is not running.')); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      w.removeEventListener('message', onMessage);
      // The only way to stop a running Python loop is to kill the worker.
      // The next run starts a fresh one (fast, the files are cached).
      resetWorker();
      resolve({
        stdout: '', stderr: '', exitCode: 1, timedOut: true, truncated: false, durationMs: timeoutMs,
        error: `TimeoutError: your program ran for more than ${timeoutMs / 1000} seconds and was stopped.\nCheck for a loop that never ends (for example, a while loop whose condition never becomes False).`,
      });
    }, timeoutMs);
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if ((msg.type !== 'result' && msg.type !== 'run-error') || msg.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      if (msg.type === 'run-error') { reject(new PythonUnavailableError(msg.message)); return; }
      resolve({ stdout: msg.stdout, stderr: msg.stderr, error: msg.error, exitCode: msg.exitCode, timedOut: false, truncated: msg.truncated, durationMs: msg.durationMs });
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'run', id, code, stdin, echoPrompts } satisfies WorkerRequest);
  }));
}

/**
 * Runs Python in the browser. Rejects with PythonUnavailableError only for
 * infrastructure problems (Python could not load); student-code errors and
 * timeouts resolve normally.
 */
export function runInBrowser(code: string, stdin = '', timeoutMs = RUN_TIMEOUT_MS, echoPrompts = true): Promise<BrowserRunOutcome> {
  const result = queue.then(() => runOnce(code, stdin, timeoutMs, echoPrompts));
  queue = result.catch(() => undefined);
  return result;
}
