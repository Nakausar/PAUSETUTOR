import { useEffect, useState } from 'react';
import { RotateCcw, Save, Settings } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_SYSTEM_PROMPT, RECOMMENDED_SYSTEM_PROMPT } from '@/lib/constants';

interface SettingsForm {
  system_prompt: string;
  research_logging_enabled: boolean;
  solution_min_runs: number;
  solution_min_minutes: number;
  solution_requires_reason: boolean;
  max_followups: number;
}

const DEFAULTS: SettingsForm = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  research_logging_enabled: true,
  solution_min_runs: 1,
  solution_min_minutes: 3,
  solution_requires_reason: true,
  max_followups: 5,
};

export default function SystemSettingsPage() {
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('system_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => {
      if (data) setForm({ ...DEFAULTS, ...(data as Partial<SettingsForm>) });
    });
  }, []);

  async function save() {
    setSaving(true);
    const { error } = await supabase.from('system_settings').update(form).eq('id', 1);
    setSaving(false);
    setMessage(error ? { kind: 'error', text: `Could not save: ${error.message}` } : { kind: 'ok', text: 'Settings saved. They apply to the next AI request.' });
  }

  const numberField = (key: 'solution_min_runs' | 'solution_min_minutes' | 'max_followups', label: string, help: string, max: number) => (
    <label className="block">
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      <span className="block text-xs text-slate-500 mb-1.5">{help}</span>
      <input type="number" min={0} max={max} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) })} className="w-28 border border-slate-300 rounded-lg p-2 text-sm" />
    </label>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center"><Settings className="w-5 h-5" /></div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tutor configuration</h1>
          <p className="text-sm text-slate-500 mt-1">Refine the pedagogical behaviour used by the PAUSE AI Tutor.</p>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <label htmlFor="system-prompt" className="text-sm font-semibold text-slate-800">System prompt</label>
          <button type="button" onClick={() => setForm({ ...form, system_prompt: RECOMMENDED_SYSTEM_PROMPT })} className="flex items-center gap-1.5 text-xs font-medium border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700 hover:bg-slate-50">
            <RotateCcw className="w-3.5 h-3.5" /> Use recommended prompt (v2)
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-2">The server adds the task, the student's plan, code and last error, and the instruction for the chosen kind of help. Review the recommended prompt before using it, then press Save.</p>
        <textarea id="system-prompt" value={form.system_prompt} onChange={(e) => setForm({ ...form, system_prompt: e.target.value })} rows={16} className="w-full border border-slate-300 rounded-lg p-3 text-sm font-mono leading-6 focus:ring-2 focus:ring-slate-900 outline-none" />
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-slate-800">"Request complete solution" gate</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">Students can only request a complete solution after working on the problem themselves. The server enforces these rules. Set a value to 0 to switch that rule off.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {numberField('solution_min_runs', 'Minimum code runs', 'How many times the student must run their code first.', 50)}
          {numberField('solution_min_minutes', 'Minimum minutes of work', 'Counted from when the student starts writing code.', 120)}
        </div>
        <label className="flex items-center gap-2 mt-4 text-sm text-slate-700">
          <input type="checkbox" checked={form.solution_requires_reason} onChange={(e) => setForm({ ...form, solution_requires_reason: e.target.checked })} />
          Student must explain why they need a complete solution (stored with the request)
        </label>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Follow-up questions and logging</h2>
        {numberField('max_followups', 'Follow-up questions per AI response', 'The tutor remembers the conversation. 0 turns follow-ups off.', 20)}
        <label className="flex items-center gap-2 mt-4 text-sm text-slate-700">
          <input type="checkbox" checked={form.research_logging_enabled} onChange={(e) => setForm({ ...form, research_logging_enabled: e.target.checked })} />
          Research logging enabled (when off, no interaction events are recorded; plans, code and AI conversations are still saved)
        </label>
      </section>

      <button onClick={() => void save()} disabled={saving} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"><Save className="w-4 h-4" /> Save configuration</button>
      {message && <p className={`text-sm mt-3 ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</p>}
      <div className="mt-5 text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded-lg p-3">Changes affect future AI tutor requests. This prototype does not make claims about learning outcomes or automatic regulatory compliance.</div>
    </div>
  );
}
