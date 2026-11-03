/// <reference lib="webworker" />
/**
 * Web Worker that runs student Python code with Pyodide (CPython compiled to
 * WebAssembly). Code runs on the student's own device: no server, no
 * third-party execution service, and an infinite loop only freezes this worker,
 * which the main thread terminates after a timeout.
 */

interface PyProxyLike {
  toJs(options?: { dict_converter?: (entries: Iterable<[string, unknown]>) => unknown }): unknown;
  destroy(): void;
}
interface PyCallable extends PyProxyLike {
  (...args: unknown[]): PyProxyLike;
}
interface PyodideLike {
  runPython(code: string): unknown;
  globals: { get(name: string): PyCallable };
}

// Python-side harness: fresh namespace per run, stdin from a string, capped
// stdout/stderr, SystemExit handled, tracebacks trimmed to the student's file.
const HARNESS = String.raw`
import sys, io, traceback, linecache

class _PauseCappedWriter(io.TextIOBase):
    def __init__(self, limit):
        self.parts = []
        self.size = 0
        self.limit = limit
        self.truncated = False
    def writable(self):
        return True
    def write(self, s):
        if not isinstance(s, str):
            raise TypeError(f"write() argument must be str, not {type(s).__name__}")
        room = self.limit - self.size
        if room > 0:
            self.parts.append(s[:room])
            self.size += min(len(s), room)
        if len(s) > room:
            self.truncated = True
        return len(s)
    def getvalue(self):
        return "".join(self.parts)

def _pause_run(src, stdin_text, echo_prompts=True, limit=200000):
    out = _PauseCappedWriter(limit)
    err = _PauseCappedWriter(limit)
    saved = (sys.stdin, sys.stdout, sys.stderr)
    sys.stdin, sys.stdout, sys.stderr = io.StringIO(stdin_text), out, err
    exit_code = 0
    error = ""
    # Lets tracebacks show the student's source lines.
    linecache.cache["main.py"] = (len(src), None, src.splitlines(True), "main.py")

    def _input(prompt=""):
        # Test runs compare program output only, so prompts are not echoed then.
        if echo_prompts:
            sys.stdout.write(str(prompt))
        line = sys.stdin.readline()
        if not line:
            raise EOFError("EOF when reading a line")
        return line[:-1] if line.endswith("\n") else line

    namespace = {"__name__": "__main__", "__builtins__": __builtins__, "input": _input}
    try:
        exec(compile(src, "main.py", "exec"), namespace)
    except SystemExit as e:
        code = e.code
        if code is None or code == 0:
            exit_code = 0
        elif isinstance(code, int):
            exit_code = code
        else:
            exit_code = 1
            err.write(str(code) + "\n")
        if exit_code:
            error = err.getvalue() or f"Program exited with code {exit_code}"
    except BaseException as e:
        te = traceback.TracebackException.from_exception(e)
        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == "main.py"])
        error = "".join(te.format())
        exit_code = 1
    finally:
        sys.stdin, sys.stdout, sys.stderr = saved
    return {
        "stdout": out.getvalue(),
        "stderr": err.getvalue(),
        "error": error,
        "exit_code": exit_code,
        "truncated": out.truncated or err.truncated,
    }
`;

export type WorkerRequest =
  | { type: 'init' }
  | { type: 'run'; id: number; code: string; stdin: string; echoPrompts: boolean };

export type WorkerResponse =
  | { type: 'ready'; version: string }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; stdout: string; stderr: string; error: string; exitCode: number; truncated: boolean; durationMs: number }
  | { type: 'run-error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let pyodide: PyodideLike | null = null;

async function init() {
  const indexURL = new URL(`${import.meta.env.BASE_URL}pyodide/`, ctx.location.origin).href;
  const mod = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`) as {
    loadPyodide: (options: { indexURL: string }) => Promise<PyodideLike & { version: string }>;
  };
  const py = await mod.loadPyodide({ indexURL });
  py.runPython(HARNESS);
  pyodide = py;
  return py.version;
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      const version = await init();
      ctx.postMessage({ type: 'ready', version } satisfies WorkerResponse);
    } catch (err) {
      ctx.postMessage({ type: 'init-error', message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
    }
    return;
  }

  if (msg.type === 'run') {
    if (!pyodide) {
      ctx.postMessage({ type: 'run-error', id: msg.id, message: 'Python is not loaded yet.' } satisfies WorkerResponse);
      return;
    }
    const started = performance.now();
    const run = pyodide.globals.get('_pause_run');
    try {
      const proxy = run(msg.code, msg.stdin, msg.echoPrompts);
      const r = proxy.toJs({ dict_converter: Object.fromEntries }) as { stdout: string; stderr: string; error: string; exit_code: number; truncated: boolean };
      proxy.destroy();
      ctx.postMessage({
        type: 'result', id: msg.id, stdout: r.stdout, stderr: r.stderr, error: r.error,
        exitCode: r.exit_code, truncated: r.truncated, durationMs: Math.round(performance.now() - started),
      } satisfies WorkerResponse);
    } catch (err) {
      ctx.postMessage({ type: 'run-error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
    } finally {
      run.destroy();
    }
  }
};
