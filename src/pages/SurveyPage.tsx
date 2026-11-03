import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { LIKERT_LABELS, validateAnswers, type Survey } from '@/lib/surveys';

/** A student fills in one questionnaire. Each questionnaire can be submitted once. */
export default function SurveyPage() {
  const { surveyId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitted' | 'already' | 'missing'>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const startedAt = useRef(new Date().toISOString());

  useEffect(() => {
    if (!surveyId || !profile) return;
    (async () => {
      const [s, r] = await Promise.all([
        supabase.from('surveys').select('*').eq('id', surveyId).eq('active', true).maybeSingle(),
        supabase.from('survey_responses').select('id').eq('survey_id', surveyId).eq('student_id', profile.id).maybeSingle(),
      ]);
      if (!s.data) { setStatus('missing'); return; }
      setSurvey(s.data as Survey);
      setStatus(r.data ? 'already' : 'ready');
    })();
  }, [surveyId, profile]);

  async function submit() {
    if (!survey || !profile) return;
    const problems = validateAnswers(survey.items, answers);
    setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setSaveError(`Please answer the ${Object.keys(problems).length} highlighted question(s).`);
      document.getElementById(`item-${Object.keys(problems)[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSaving(true); setSaveError('');
    const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => !(typeof v === 'string' && v.trim() === '')).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    const { error } = await supabase.from('survey_responses').insert({ survey_id: survey.id, student_id: profile.id, answers: clean, started_at: startedAt.current });
    setSaving(false);
    if (error) {
      setSaveError(error.code === '23505' ? 'You have already submitted this questionnaire.' : 'Your answers could not be saved. Please try again.');
      return;
    }
    setStatus('submitted');
  }

  const back = <button onClick={() => navigate('/dashboard')} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"><ArrowLeft className="w-4 h-4" /> Back to dashboard</button>;

  if (status === 'loading') return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-slate-400">Loading questionnaire...</div>;
  if (status === 'missing') return <div className="max-w-3xl mx-auto px-4 py-6">{back}<p className="text-sm text-slate-600">This questionnaire is not available.</p></div>;
  if (status === 'submitted' || status === 'already') {
    return <div className="max-w-3xl mx-auto px-4 py-6">{back}
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
        <h1 className="text-xl font-semibold text-slate-900 mt-3">{status === 'submitted' ? 'Thank you!' : 'Already submitted'}</h1>
        <p className="text-sm text-slate-600 mt-1">{status === 'submitted' ? 'Your answers have been saved.' : 'You have already completed this questionnaire.'}</p>
        <button onClick={() => navigate('/dashboard')} className="mt-5 bg-slate-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium">Back to dashboard</button>
      </div>
    </div>;
  }
  if (!survey) return null;

  return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
    {back}
    <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-7">
      <div className="flex gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0"><ClipboardList className="w-5 h-5" /></div>
        <div><h1 className="text-xl font-semibold text-slate-900">{survey.title}</h1>{survey.description && <p className="text-sm text-slate-600 mt-1">{survey.description}</p>}</div>
      </div>
      <ol className="space-y-6">
        {survey.items.map((item, idx) => {
          const value = answers[item.id];
          const err = errors[item.id];
          const set = (v: string | number) => { setAnswers((a) => ({ ...a, [item.id]: v })); setErrors((e) => { const { [item.id]: _removed, ...rest } = e; void _removed; return rest; }); };
          return <li key={item.id} id={`item-${item.id}`} className={`rounded-lg ${err ? 'ring-2 ring-red-300 p-3 -m-3' : ''}`}>
            <fieldset>
              <legend className="text-sm font-medium text-slate-800">{idx + 1}. {item.text}{item.required !== false ? <span className="text-red-600" aria-hidden="true"> *</span> : <span className="font-normal text-slate-400"> (optional)</span>}</legend>
              {(item.type === 'likert5' || item.type === 'likert7') && <div className={`grid gap-2 mt-2 ${item.type === 'likert5' ? 'grid-cols-5' : 'grid-cols-7'}`}>
                {LIKERT_LABELS[item.type].map((label, i) => <button key={label} type="button" aria-pressed={value === i + 1} onClick={() => set(i + 1)} className={`rounded-lg border px-1 py-2 text-xs sm:text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 ${value === i + 1 ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500'}`}><span className="block font-semibold">{i + 1}</span><span className="block leading-tight mt-0.5">{label}</span></button>)}
              </div>}
              {item.type === 'choice' && <div className="flex flex-wrap gap-2 mt-2">
                {(item.options ?? []).map((opt) => <button key={opt} type="button" aria-pressed={value === opt} onClick={() => set(opt)} className={`rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 ${value === opt ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300 text-slate-700 hover:border-slate-500'}`}>{opt}</button>)}
              </div>}
              {item.type === 'text' && <textarea value={typeof value === 'string' ? value : ''} onChange={(e) => set(e.target.value)} rows={3} data-track="survey" aria-label={item.text} className="w-full mt-2 border border-slate-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-slate-400" />}
            </fieldset>
            {err && <p className="text-xs text-red-700 mt-1.5">{err}</p>}
          </li>;
        })}
      </ol>
      {saveError && <p className="text-sm text-red-700 mt-6">{saveError}</p>}
      <button onClick={() => void submit()} disabled={saving} className="mt-6 flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Submit answers</button>
      <p className="text-xs text-slate-500 mt-2">You can submit each questionnaire once.</p>
    </div>
  </div>;
}
