import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, ClipboardCheck, FileCode, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { Assessment, MetacognitiveRating, Session, Task } from '@/lib/types';

const RATING_LABELS: Record<MetacognitiveRating, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_improvement: 'Needs Improvement',
  not_observed: 'Not Observed',
  not_applicable: 'Not Applicable',
};
const RATING_STYLES: Record<MetacognitiveRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good: 'bg-sky-100 text-sky-800 border-sky-200',
  needs_improvement: 'bg-amber-100 text-amber-800 border-amber-200',
  not_observed: 'bg-slate-100 text-slate-600 border-slate-200',
  not_applicable: 'bg-slate-50 text-slate-400 border-slate-200',
};

const META_CATEGORIES: { key: 'metacog_planning' | 'metacog_monitoring' | 'metacog_scrutiny' | 'metacog_evaluation'; label: string }[] = [
  { key: 'metacog_planning', label: 'Planning' },
  { key: 'metacog_monitoring', label: 'Monitoring and Attempt' },
  { key: 'metacog_scrutiny', label: 'Critical Scrutiny of AI' },
  { key: 'metacog_evaluation', label: 'Evaluation' },
];

export default function TaskResults() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { profile } = useAuth();
  const [session, setSession] = useState<(Session & { task?: Task }) | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!sessionId || !profile) return;
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*, task:tasks(*)')
        .eq('id', sessionId)
        .eq('student_id', profile.id)
        .maybeSingle();
      if (!sessionData) { setLoading(false); return; }
      setSession(sessionData as Session & { task?: Task });
      const { data: assessmentData } = await supabase
        .from('assessments')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'approved')
        .maybeSingle();
      setAssessment((assessmentData ?? null) as Assessment | null);
      setLoading(false);
    }
    void load();
  }, [sessionId, profile]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-8 text-slate-400 text-sm">Loading your results...</div>;

  const metaRatings = assessment
    ? META_CATEGORIES.map(({ key, label }) => ({ label, value: assessment[key] }))
    : [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-4"><ArrowLeft className="w-4 h-4" /> Back to my tasks</Link>
      <h1 className="text-2xl font-bold text-slate-900">Your results</h1>
      <p className="text-sm text-slate-500 mt-0.5 mb-6">{session?.task?.title ?? 'Task'}</p>

      {!assessment && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          <ClipboardCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          Your assessment for this task has not been published yet. Check back once your instructor has reviewed it.
        </div>
      )}

      {assessment && (
        <>
          <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
            <h2 className="font-semibold text-slate-900 mb-4 flex items-center gap-2"><FileCode className="w-4 h-4 text-slate-400" /> Programming assessment</h2>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-4xl font-bold text-slate-900">{assessment.approved_mark ?? '—'}</span>
              <span className="text-sm text-slate-500">/ 100</span>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-300 mb-4 h-2 overflow-hidden"><div className="h-full bg-slate-900 rounded-full" style={{ width: `${assessment.approved_mark ?? 0}%` }} /></div>
            {assessment.programming_feedback && (
              <div>
                <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Programming feedback</div>
                <p className="text-sm text-slate-700 leading-6 whitespace-pre-wrap">{assessment.programming_feedback}</p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="font-semibold text-slate-900 mb-1 flex items-center gap-2"><Brain className="w-4 h-4 text-slate-400" /> Metacognitive skills</h2>
            <p className="text-xs text-slate-500 mb-4">Qualitative ratings of your learning process. These carry no marks and no written comments.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {metaRatings.map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-lg p-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700">{label}</span>
                  <span className={`px-2.5 py-1 rounded-md border text-xs font-medium shrink-0 ${value ? RATING_STYLES[value] : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{value ? RATING_LABELS[value] : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}