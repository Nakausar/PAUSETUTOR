import { useEffect, useState } from 'react';
import { CheckCircle2, EyeOff, Loader2, Play, Plus, Save, Trash2, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { runTestCases, type TestCaseResult } from '@/lib/codeRunner';
import CodeEditor from '@/components/CodeEditor';
import type { Task, TestCase } from '@/lib/types';

interface Props {
  task: Task;
  onClose: () => void;
  onSaved: () => void;
}

type Row = TestCase & { hidden: boolean };

/**
 * Researcher tool for a task's test cases.
 * Visible tests are stored on the task (students can run them).
 * Hidden tests are stored in task_hidden_tests (researchers only).
 */
export default function TestCaseManager({ task, onClose, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [reference, setReference] = useState(task.starter_code || '');
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<TestCaseResult[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('task_hidden_tests').select('test_cases').eq('task_id', task.id).maybeSingle();
      if (cancelled) return;
      if (error) setMessage({ kind: 'error', text: 'Could not load hidden tests. Has the day 2 database update been applied?' });
      const visible = (task.test_cases ?? []).map((t) => ({ input: t.input ?? '', expected: t.expected ?? '', hidden: false }));
      const hidden = ((data?.test_cases ?? []) as TestCase[]).map((t) => ({ input: t.input ?? '', expected: t.expected ?? '', hidden: true }));
      setRows([...visible, ...hidden]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [task]);

  function update(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setResults(null);
  }

  async function checkReference() {
    setChecking(true);
    setResults(await runTestCases(reference, rows));
    setChecking(false);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const clean = rows.filter((r) => r.input.trim() !== '' || r.expected.trim() !== '');
    const visible = clean.filter((r) => !r.hidden).map(({ input, expected }) => ({ input, expected }));
    const hidden = clean.filter((r) => r.hidden).map(({ input, expected }) => ({ input, expected }));
    const [taskResult, hiddenResult] = await Promise.all([
      supabase.from('tasks').update({ test_cases: visible }).eq('id', task.id),
      supabase.from('task_hidden_tests').upsert({ task_id: task.id, test_cases: hidden, updated_at: new Date().toISOString() }),
    ]);
    setSaving(false);
    if (taskResult.error || hiddenResult.error) {
      setMessage({ kind: 'error', text: 'Could not save the test cases. Please try again.' });
      return;
    }
    setMessage({ kind: 'ok', text: `Saved ${visible.length} visible and ${hidden.length} hidden test case(s).` });
    onSaved();
  }

  const passed = results?.filter((r) => r.passed).length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 px-4 py-8 overflow-y-auto" role="presentation">
      <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-200 shadow-xl p-5" role="dialog" aria-modal="true" aria-labelledby="tests-title">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="tests-title" className="text-lg font-semibold text-slate-900">Test cases</h2>
            <p className="text-sm text-slate-500 mt-1">Task: <span className="font-medium text-slate-700">{task.title}</span></p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <p className="text-sm text-slate-600 mb-4">
          Each test runs the student's program with <strong>Input</strong> as stdin and compares what it prints with <strong>Expected output</strong> (trailing spaces ignored; <code>input()</code> prompts are not printed during tests).
          Students can see and run visible tests. <strong>Hidden</strong> tests are only used by researchers on the assessment page.
        </p>

        {loading ? <div className="text-sm text-slate-500 py-6 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div> : (
          <div className="space-y-3">
            {rows.length === 0 && <p className="text-sm text-slate-500">No test cases yet.</p>}
            {rows.map((row, i) => {
              const r = results?.[i];
              return (
                <div key={i} className={`border rounded-lg p-3 ${row.hidden ? 'border-slate-300 bg-slate-50' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                      Test {i + 1}
                      {row.hidden && <span className="flex items-center gap-1 normal-case text-slate-600"><EyeOff className="w-3.5 h-3.5" /> hidden</span>}
                      {r && (r.passed
                        ? <span className="flex items-center gap-1 normal-case text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> reference passes</span>
                        : <span className="flex items-center gap-1 normal-case text-red-600"><XCircle className="w-3.5 h-3.5" /> reference fails</span>)}
                    </span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={row.hidden} onChange={(e) => update(i, { hidden: e.target.checked })} className="h-3.5 w-3.5" /> Hidden
                      </label>
                      <button onClick={() => { setRows(rows.filter((_, j) => j !== i)); setResults(null); }} aria-label={`Delete test ${i + 1}`} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <label className="block"><span className="block text-xs text-slate-500 mb-1">Input (stdin, one value per line)</span>
                      <textarea value={row.input} onChange={(e) => update(i, { input: e.target.value })} rows={3} className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" /></label>
                    <label className="block"><span className="block text-xs text-slate-500 mb-1">Expected output</span>
                      <textarea value={row.expected} onChange={(e) => update(i, { expected: e.target.value })} rows={3} className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" /></label>
                  </div>
                  {r && !r.passed && (
                    <pre className="mt-2 text-xs bg-red-50 text-red-800 rounded p-2 whitespace-pre-wrap max-h-32 overflow-auto">{r.error ? r.error : `Reference printed:\n${r.actual || '(nothing)'}`}</pre>
                  )}
                </div>
              );
            })}
            <button onClick={() => setRows([...rows, { input: '', expected: '', hidden: false }])} className="flex items-center gap-2 text-sm text-slate-700 border border-dashed border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 w-full justify-center">
              <Plus className="w-4 h-4" /> Add test case
            </button>

            <details className="border border-slate-200 rounded-lg p-3">
              <summary className="text-sm font-medium text-slate-700 cursor-pointer">Check tests against a reference solution (recommended)</summary>
              <p className="text-xs text-slate-500 my-2">Paste a correct solution. Every test should pass; if one fails, its expected output is probably wrong. The reference solution is not saved.</p>
              <CodeEditor value={reference} onChange={setReference} height="12rem" onRun={() => void checkReference()} ariaLabel="Reference solution" />
              <button onClick={() => void checkReference()} disabled={checking || rows.length === 0} className="mt-2 flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run all tests
              </button>
              {results && <p className={`text-sm mt-2 ${passed === results.length ? 'text-emerald-700' : 'text-red-700'}`}>{passed} of {results.length} tests pass with the reference solution.</p>}
            </details>
          </div>
        )}

        {message && <div className={`mt-4 rounded-lg p-3 text-sm border ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>{message.text}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">Close</button>
          <button onClick={() => void save()} disabled={saving || loading} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save test cases
          </button>
        </div>
      </div>
    </div>
  );
}
