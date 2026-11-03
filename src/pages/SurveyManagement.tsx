import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ITEM_TYPE_LABELS, SURVEY_TEMPLATES, newItemId, type Survey, type SurveyItem, type SurveyItemType, type SurveyKind } from '@/lib/surveys';

type Draft = Omit<Survey, 'id'> & { id?: string };

const KIND_LABELS: Record<SurveyKind, string> = {
  pre: 'Pre (before the first task)',
  post: 'Post (after all tasks are completed)',
  other: 'Other (always available)',
};

const blankDraft = (): Draft => ({ title: '', description: '', kind: 'pre', required_before_tasks: false, active: false, items: [] });

/** Researchers create, edit and activate questionnaires. */
export default function SurveyManagement() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    const [s, r] = await Promise.all([
      supabase.from('surveys').select('*').order('created_at', { ascending: true }),
      supabase.from('survey_responses').select('survey_id'),
    ]);
    if (s.error) { setLoadError('Could not load questionnaires. Has the latest database update (surveys) been applied?'); return; }
    setLoadError('');
    setSurveys((s.data ?? []) as Survey[]);
    const c: Record<string, number> = {};
    for (const row of (r.data ?? []) as { survey_id: string }[]) c[row.survey_id] = (c[row.survey_id] ?? 0) + 1;
    setCounts(c);
  }

  function validate(d: Draft): string | null {
    if (!d.title.trim()) return 'Give the questionnaire a title.';
    if (d.items.length === 0) return 'Add at least one question.';
    for (const [i, item] of d.items.entries()) {
      if (!item.text.trim()) return `Question ${i + 1} has no text.`;
      if (item.type === 'choice' && (item.options ?? []).filter((o) => o.trim()).length < 2) return `Question ${i + 1} needs at least two options.`;
    }
    if (new Set(d.items.map((i) => i.id)).size !== d.items.length) return 'Two questions have the same id.';
    return null;
  }

  async function save() {
    if (!draft) return;
    const problem = validate(draft);
    if (problem) { setMessage({ kind: 'error', text: problem }); return; }
    setSaving(true);
    const items = draft.items.map((i) => ({ ...i, text: i.text.trim(), ...(i.type === 'choice' ? { options: (i.options ?? []).map((o) => o.trim()).filter(Boolean) } : { options: undefined }) }));
    const payload = { title: draft.title.trim(), description: draft.description.trim(), kind: draft.kind, required_before_tasks: draft.kind === 'pre' && draft.required_before_tasks, active: draft.active, items, updated_at: new Date().toISOString() };
    const { error } = draft.id
      ? await supabase.from('surveys').update(payload).eq('id', draft.id)
      : await supabase.from('surveys').insert(payload);
    setSaving(false);
    if (error) { setMessage({ kind: 'error', text: `Could not save: ${error.message}` }); return; }
    setMessage({ kind: 'ok', text: `Saved "${payload.title}".${payload.active ? ' Students can see it now.' : ' It is not active yet: students cannot see it.'}` });
    setDraft(null);
    void load();
  }

  async function toggleActive(s: Survey) {
    const { error } = await supabase.from('surveys').update({ active: !s.active, updated_at: new Date().toISOString() }).eq('id', s.id);
    setMessage(error ? { kind: 'error', text: `Could not change it: ${error.message}` } : { kind: 'ok', text: `"${s.title}" is now ${s.active ? 'hidden from' : 'visible to'} students.` });
    void load();
  }

  async function remove(s: Survey) {
    const n = counts[s.id] ?? 0;
    if (!window.confirm(n > 0 ? `Delete "${s.title}" and its ${n} response(s)? This cannot be undone. Export the responses first.` : `Delete "${s.title}"?`)) return;
    const { error } = await supabase.from('surveys').delete().eq('id', s.id);
    setMessage(error ? { kind: 'error', text: `Could not delete: ${error.message}` } : { kind: 'ok', text: `Deleted "${s.title}".` });
    void load();
  }

  const updateItem = (index: number, patch: Partial<SurveyItem>) => setDraft((d) => d && { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  const moveItem = (index: number, delta: number) => setDraft((d) => {
    if (!d) return d;
    const items = [...d.items];
    const target = index + delta;
    if (target < 0 || target >= items.length) return d;
    [items[index], items[target]] = [items[target], items[index]];
    return { ...d, items };
  });

  return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
    <div className="flex flex-wrap justify-between items-start gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Questionnaires</h1>
        <p className="text-sm text-slate-500 mt-1">Pre- and post-study surveys, stored under each participant ID. Students see active questionnaires on their dashboard.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SURVEY_TEMPLATES.map((t) => <button key={t.key} onClick={() => { setMessage(null); setDraft({ ...structuredClone(t.survey), active: false }); }} title={t.note} className="flex items-center gap-1.5 border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50"><Plus className="w-4 h-4" />{t.label}</button>)}
        <button onClick={() => { setMessage(null); setDraft(blankDraft()); }} className="flex items-center gap-1.5 bg-slate-900 text-white px-3 py-2 rounded-lg text-sm font-medium"><Plus className="w-4 h-4" />Blank questionnaire</button>
      </div>
    </div>

    {loadError && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 p-3">{loadError}</div>}
    {message && !draft && <div className={`mb-4 rounded-lg border p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>}

    {surveys.length === 0 && !loadError && <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500"><ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-2" />No questionnaires yet. Start from a template above.</div>}
    <div className="space-y-3">
      {surveys.map((s) => <div key={s.id} className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-slate-900 flex flex-wrap items-center gap-2">{s.title}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{s.active ? 'Active' : 'Not active'}</span>
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{s.kind}{s.kind === 'pre' && s.required_before_tasks ? ' · required before tasks' : ''}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">{s.items.length} question(s) · {counts[s.id] ?? 0} response(s)</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => void toggleActive(s)} className="border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50">{s.active ? 'Deactivate' : 'Activate'}</button>
          <button onClick={() => { setMessage(null); setDraft(structuredClone(s)); }} className="border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50">Edit</button>
          <button onClick={() => void remove(s)} aria-label={`Delete ${s.title}`} className="border border-slate-300 text-slate-500 px-2.5 py-2 rounded-lg hover:text-red-600 hover:bg-slate-50"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>)}
    </div>

    {draft && <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 px-4 py-8 overflow-y-auto" role="presentation">
      <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-200 shadow-xl p-5" role="dialog" aria-modal="true" aria-labelledby="survey-editor-title">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 id="survey-editor-title" className="text-lg font-semibold text-slate-900">{draft.id ? 'Edit questionnaire' : 'New questionnaire'}</h2>
          <button onClick={() => setDraft(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        {draft.id && (counts[draft.id] ?? 0) > 0 && <p className="mb-4 text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 p-2.5">This questionnaire already has {counts[draft.id]} response(s). Changing or removing questions now makes responses inconsistent; consider creating a new questionnaire instead.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2"><span className="block text-sm font-medium text-slate-700 mb-1">Title (shown to students)</span><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" /></label>
          <label className="block sm:col-span-2"><span className="block text-sm font-medium text-slate-700 mb-1">Introduction (optional)</span><textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm" /></label>
          <label className="block"><span className="block text-sm font-medium text-slate-700 mb-1">When</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as SurveyKind })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white">{(Object.keys(KIND_LABELS) as SurveyKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}</select></label>
          <div className="space-y-2 pt-6">
            {draft.kind === 'pre' && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.required_before_tasks} onChange={(e) => setDraft({ ...draft, required_before_tasks: e.target.checked })} /> Required before starting tasks</label>}
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Active (visible to students)</label>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-slate-800 mt-6 mb-2">Questions</h3>
        <div className="space-y-3">
          {draft.items.map((item, i) => <div key={item.id} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Question {i + 1} <span className="font-mono normal-case">({item.id}{item.scale === 'sus' ? `, SUS item ${item.scaleIndex}` : ''})</span></span>
              <div className="flex items-center gap-1">
                <button onClick={() => moveItem(i, -1)} disabled={i === 0} aria-label={`Move question ${i + 1} up`} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                <button onClick={() => moveItem(i, 1)} disabled={i === draft.items.length - 1} aria-label={`Move question ${i + 1} down`} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                <button onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })} aria-label={`Delete question ${i + 1}`} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <textarea value={item.text} onChange={(e) => updateItem(i, { text: e.target.value })} rows={2} aria-label={`Question ${i + 1} text`} placeholder="Question or statement" className="w-full border border-slate-300 rounded-lg p-2 text-sm" />
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <select value={item.type} onChange={(e) => updateItem(i, { type: e.target.value as SurveyItemType })} aria-label={`Question ${i + 1} type`} className="border border-slate-300 rounded-lg p-2 text-sm bg-white">{(Object.keys(ITEM_TYPE_LABELS) as SurveyItemType[]).map((t) => <option key={t} value={t}>{ITEM_TYPE_LABELS[t]}</option>)}</select>
              <label className="flex items-center gap-1.5 text-sm text-slate-700"><input type="checkbox" checked={item.required !== false} onChange={(e) => updateItem(i, { required: e.target.checked })} /> Required</label>
            </div>
            {item.type === 'choice' && <label className="block mt-2"><span className="block text-xs text-slate-500 mb-1">Options, one per line</span><textarea value={(item.options ?? []).join('\n')} onChange={(e) => updateItem(i, { options: e.target.value.split('\n') })} rows={3} aria-label={`Question ${i + 1} options`} className="w-full border border-slate-300 rounded-lg p-2 text-sm font-mono" /></label>}
          </div>)}
          <button onClick={() => setDraft({ ...draft, items: [...draft.items, { id: newItemId(draft.items), text: '', type: 'likert5', required: true }] })} className="flex items-center gap-2 text-sm text-slate-700 border border-dashed border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 w-full justify-center"><Plus className="w-4 h-4" /> Add question</button>
        </div>

        {message && <div className={`mt-4 rounded-lg border p-3 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{message.text}</div>}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save questionnaire</button>
        </div>
      </div>
    </div>}
  </div>;
}
