import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, ClipboardList, Clock3, Download, FileCode2, Filter, Layers, ListChecks, RefreshCw, Search, ShieldCheck, Sparkles, Table2, Users } from 'lucide-react';
import { loadResearchData, filterBundle, hasActiveFilters, EMPTY_FILTERS, type ResearchBundle, type ResearchFilters } from '@/lib/researchData';
import { INDICATORS, findIndicator } from '@/lib/researchIndicators';
import { RESEARCH_QUESTIONS, dataQuality, sessionIndicatorRows } from '@/lib/researchQuestions';
import { buildSessionTrace, rqDataset } from '@/lib/researchTraces';
import { exportAsCSV } from '@/lib/exporter';
import { CardHeader, BarCompare, GroupedBarChart, EmptyChart } from '@/components/charts';
import { AI_CATEGORY_LABELS, PHASE_LABELS } from '@/lib/constants';
import type { AICategory } from '@/lib/types';

const TABS = [
  { key: 'overview', label: 'Research Overview', icon: BarChart3 },
  { key: 'srl', label: 'SRL & Metacognition', icon: BrainCircuit },
  { key: 'ai', label: 'AI Behaviour & Uptake', icon: Sparkles },
  { key: 'outcomes', label: 'Programming Outcomes', icon: FileCode2 },
  { key: 'traces', label: 'Participant Learning Traces', icon: Layers },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function ResearcherDashboard() {
  const [bundle, setBundle] = useState<ResearchBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [filters, setFilters] = useState<ResearchFilters>(EMPTY_FILTERS);
  const [showRQ, setShowRQ] = useState(false);
  const [showQuality, setShowQuality] = useState(false);

  useEffect(() => { void reload(); }, []);
  async function reload() {
    setLoading(true);
    setBundle(await loadResearchData());
    setLoading(false);
  }

  const filtered = useMemo(() => (bundle ? filterBundle(bundle, filters) : null), [bundle, filters]);

  if (loading || !bundle || !filtered) {
    return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6"><div className="text-slate-400 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading research data...</div></div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest">Research platform</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">PAUSE learning analytics</h1>
          <p className="text-sm text-slate-500 mt-1">Descriptive analytics for self-regulated learning, AI scrutiny and programming outcomes.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowRQ(!showRQ)} className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${showRQ ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}><Search className="w-4 h-4" /> Research Questions</button>
          <button onClick={() => setShowQuality(!showQuality)} className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${showQuality ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}><ShieldCheck className="w-4 h-4" /> Data Quality</button>
          <button onClick={() => void reload()} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <Link to="/researcher/export" className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50"><Download className="w-4 h-4" /> Exports</Link>
        </div>
      </div>

      <ResearchFiltersBar bundle={bundle} filters={filters} setFilters={setFilters} />

      {showRQ && <RQExplorer bundle={filtered} />}
      {showQuality && <DataQualityPanel bundle={filtered} />}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 mb-5 mt-1" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${active ? 'border-amber-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab bundle={filtered} />}
      {tab === 'srl' && <SrlTab bundle={filtered} />}
      {tab === 'ai' && <AiTab bundle={filtered} />}
      {tab === 'outcomes' && <OutcomesTab bundle={filtered} />}
      {tab === 'traces' && <TracesTab bundle={filtered} />}
    </div>
  );
}

/* ------------------------- Filters ------------------------- */

function ResearchFiltersBar({ bundle, filters, setFilters }: { bundle: ResearchBundle; filters: ResearchFilters; setFilters: (f: ResearchFilters) => void }) {
  const set = (patch: Partial<ResearchFilters>) => setFilters({ ...filters, ...patch });
  const active = hasActiveFilters(filters);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
      <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-slate-400" /><span className="text-sm font-semibold text-slate-900">Research filters</span>{active && <span className="text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">active</span>}</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="text-xs text-slate-500">Participant
          <select value={filters.participantId} onChange={(e) => set({ participantId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All participants</option>
            {bundle.participants.map((p) => <option key={p.id} value={p.id}>{p.participant_id}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Task
          <select value={filters.taskId} onChange={(e) => set({ taskId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All tasks</option>
            {bundle.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">From date
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">To date
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">Session status
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="abandoned">Abandoned</option>
          </select>
        </label>
      </div>
      {active && <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-3 text-xs text-slate-500 hover:text-slate-900 underline">Clear all filters</button>}
    </div>
  );
}

/* ------------------------- Overview ------------------------- */

function OverviewTab({ bundle }: { bundle: ResearchBundle }) {
  const { bundleAllIndicators } = require('@/lib/researchQuestions') as typeof import('@/lib/researchQuestions');
  const ind = useMemo(() => bundleAllIndicators(bundle), [bundle]);
  const overviewCards = [
    { label: 'Participants', value: ind.cohort_engagement.participants, icon: Users },
    { label: 'Sessions', value: ind.task_completion.total, icon: Layers },
    { label: 'Completed tasks', value: ind.task_completion.completed, icon: CheckCircle2 },
    { label: 'AI interactions', value: bundle.aiInteractions.length, icon: Sparkles },
    { label: 'Scrutiny responses', value: bundle.scrutiny.length, icon: ListChecks },
    { label: 'Recorded events', value: ind.cohort_engagement.events, icon: Clock3 },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {overviewCards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-lg p-4"><Icon className="w-4 h-4 text-slate-400 mb-3" /><div className="text-2xl font-bold text-slate-900">{value}</div><div className="text-xs text-slate-500 mt-1">{label}</div></div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Task completion rate" subtitle={`${ind.task_completion.completed}/${ind.task_completion.total} sessions completed`} />
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${ind.task_completion.rate}%` }} />
          </div>
          <div className="text-2xl font-bold text-slate-900">{ind.task_completion.rate.toFixed(1)}%</div>
          <IndicatorNote id="task_completion_rate" />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Engagement per participant" subtitle={`Average recorded events per active participant`} />
          <div className="text-2xl font-bold text-slate-900">{ind.cohort_engagement.eventsPerParticipant.toFixed(1)}</div>
          <div className="text-xs text-slate-500 mt-1">events per participant ({ind.cohort_engagement.events} events)</div>
          <IndicatorNote id="cohort_engagement" />
        </div>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Recent sessions" subtitle="Open a session for its timeline or assessment" />
        {bundle.sessions.length === 0 ? <EmptyChart message="No sessions match the current filters." /> : (
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {bundle.sessions.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">{s.participant_id}</span><span className="text-sm font-medium text-slate-900 truncate">{s.task_title ?? 'Task'}</span></div>
                  <div className="text-xs text-slate-400 mt-0.5">{new Date(s.started_at).toLocaleString()} · {PHASE_LABELS[s.current_phase as keyof typeof PHASE_LABELS] ?? s.current_phase}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs capitalize ${s.status === 'completed' ? 'text-emerald-600' : 'text-amber-600'}`}>{s.status.replace('_', ' ')}</span>
                  <Link to={`/researcher/session/${s.id}`} className="text-xs text-slate-400 hover:text-slate-900"><ArrowRight className="w-3.5 h-3.5" /></Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- SRL tab ------------------------- */

function SrlTab({ bundle }: { bundle: ResearchBundle }) {
  const { bundleAllIndicators } = require('@/lib/researchQuestions') as typeof import('@/lib/researchQuestions');
  const ind = useMemo(() => bundleAllIndicators(bundle), [bundle]);
  const confChange = ind.confidence_change;
  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="PAUSE phase participation" subtitle="Share of sessions with recorded activity in each phase" />
        <div className="space-y-3">
          {ind.phase_participation.map((p) => (
            <div key={p.phase}>
              <div className="flex justify-between text-xs mb-1"><span className="font-medium text-slate-700">{PHASE_LABELS[p.phase as keyof typeof PHASE_LABELS] ?? p.phase}</span><span className="text-slate-500">{p.sessionsWith} sessions · {p.share.toFixed(0)}%</span></div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(p.share, 100)}%` }} /></div>
            </div>
          ))}
        </div>
        <IndicatorNote id="phase_participation" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Time in each PAUSE phase" subtitle="Median minutes between phase entry and exit" />
          {ind.phase_durations.perPhase.length === 0 ? <EmptyChart message="No complete phase entry/exit pairs recorded in scope." /> : (
            <div className="space-y-3">
              {ind.phase_durations.perPhase.map((d) => (
                <div key={d.phase} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{PHASE_LABELS[d.phase as keyof typeof PHASE_LABELS] ?? d.phase}</span>
                  <span className="text-slate-900 font-semibold">{d.medianMinutes !== null ? `${d.medianMinutes.toFixed(1)} min` : '—'} <span className="text-slate-400 font-normal text-xs">n={d.n}</span></span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400 mt-3">{ind.phase_durations.openPairs} unmatched phase entry events excluded. Wall-clock time includes idle periods.</p>
          <IndicatorNote id="phase_durations" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Phase transitions" subtitle="Most frequent movements between phases" />
          {ind.phase_transitions.pairs.length === 0 ? <EmptyChart message="No phase transitions recorded in scope." /> : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {ind.phase_transitions.pairs.slice(0, 10).map(([pair, n]) => (
                <div key={pair} className="flex items-center justify-between text-sm"><span className="font-mono text-xs bg-slate-50 rounded px-2 py-1 text-slate-700">{pair}</span><span className="font-semibold text-slate-900">{n}</span></div>
              ))}
            </div>
          )}
          <IndicatorNote id="phase_transitions" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Evaluation responses and confidence" subtitle="Self-reported confidence and perceived independence" />
        <div className="grid sm:grid-cols-3 gap-5">
          {(['confidence', 'independence', 'difficulty'] as const).map((field) => {
            const data = ind.evaluation_responses[field];
            return (
              <div key={field}>
                <div className="text-xs font-medium text-slate-500 mb-2 capitalize">{field === 'independence' ? 'Perceived independence' : field === 'difficulty' ? 'Hardest part reported' : 'Confidence (1-5)'}</div>
                {data.total === 0 ? <div className="text-xs text-slate-400">No responses recorded.</div> : data.distribution.map(({ value, n, share }) => (
                  <div key={value} className="mb-1.5">
                    <div className="flex justify-between text-xs"><span className="text-slate-600">{String(value).replace(/_/g, ' ')}</span><span className="text-slate-400">{n} · {share.toFixed(0)}%</span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${share}%` }} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <IndicatorNote id="evaluation_confidence" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Within-participant confidence change" subtitle="Latest minus earliest confidence across repeated tasks" />
        {confChange.length === 0 ? <EmptyChart message="No participant has two or more reflections with confidence recorded." /> : (
          <div className="space-y-2">
            {confChange.map((r) => (
              <div key={r.participant} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-slate-500">{r.participant}</span>
                <span className="text-slate-600 text-xs">first {r.first} → latest {r.latest} (n={r.n})</span>
                <span className={`font-semibold ${r.delta > 0 ? 'text-emerald-600' : r.delta < 0 ? 'text-amber-600' : 'text-slate-400'}`}>{r.delta > 0 ? '+' : ''}{r.delta}</span>
              </div>
            ))}
          </div>
        )}
        <IndicatorNote id="confidence_change" />
      </div>
    </div>
  );
}

/* ------------------------- AI tab ------------------------- */

function AiTab({ bundle }: { bundle: ResearchBundle }) {
  const { bundleAllIndicators } = require('@/lib/researchQuestions') as typeof import('@/lib/researchQuestions');
  const ind = useMemo(() => bundleAllIndicators(bundle), [bundle]);
  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Attempt-first vs AI-first behaviour" subtitle="Did independent code activity precede the first AI request?" />
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Attempt-first</div><div className="text-xl font-bold text-slate-900">{ind.attempt_first_vs_ai_first.attemptFirst}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">AI-first</div><div className="text-xl font-bold text-slate-900">{ind.attempt_first_vs_ai_first.aiFirst}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Not classifiable</div><div className="text-xl font-bold text-slate-400">{ind.attempt_first_vs_ai_first.excluded}</div></div>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${ind.attempt_first_vs_ai_first.denom ? (ind.attempt_first_vs_ai_first.attemptFirst / ind.attempt_first_vs_ai_first.denom) * 100 : 0}%` }} />
          </div>
          <p className="text-[11px] text-slate-500">{ind.attempt_first_vs_ai_first.denom} sessions classifiable; {ind.attempt_first_vs_ai_first.excluded} had neither independent activity nor AI use.</p>
          <IndicatorNote id="attempt_first_vs_ai_first" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="AI request categories" subtitle="All AI assistance requests in scope by category" />
          {ind.ai_request_frequency.categories.length === 0 ? <EmptyChart message="No AI interactions recorded in scope." /> : (
            <div className="space-y-2.5">
              {ind.ai_request_frequency.categories.map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-xs mb-1"><span className="text-slate-700">{AI_CATEGORY_LABELS[c.category as AICategory] ?? c.category}</span><span className="text-slate-500">{c.n} · {c.share.toFixed(0)}%</span></div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${c.share}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <IndicatorNote id="ai_request_frequency" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Scrutiny accuracy judgments" subtitle="Student judgments of AI response accuracy" />
        {ind.scrutiny_judgments.total === 0 ? <EmptyChart message="No scrutiny judgments recorded in scope." /> : (
          <div className="space-y-2.5">
            {ind.scrutiny_judgments.distribution.map(({ judgment, n, share }) => (
              <div key={judgment}>
                <div className="flex justify-between text-xs mb-1"><span className="text-slate-700 capitalize">{judgment.replace(/_/g, ' ')}</span><span className="text-slate-500">{n} · {share.toFixed(0)}%</span></div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${share}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        <IndicatorNote id="scrutiny_judgments" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Coded scrutiny quality (structural rubric)" subtitle="1 point each: judgment recorded, intended action stated, code change made, test result recorded" />
        {ind.scrutiny_quality.perResponse.length === 0 ? <EmptyChart message="No scrutiny responses in scope." /> : (
          <div className="grid sm:grid-cols-2 gap-5">
            <GroupedBarChart
              data={ind.scrutiny_quality.dist.map((d) => ({ label: `${d.score}/4`, values: { n: d.n } }))}
              series={[{ key: 'n', label: 'responses', color: '#0D9488' }]}
              height={130}
            />
            <div className="text-sm">
              <div className="text-2xl font-bold text-slate-900">{ind.scrutiny_quality.mean.toFixed(2)}<span className="text-sm text-slate-400 font-normal"> / 4 mean</span></div>
              <p className="text-xs text-slate-500 mt-2 leading-5">A structural rubric over observable actions. It does <strong>not</strong> measure reasoning quality and requires researcher qualitative validation.</p>
            </div>
          </div>
        )}
        <IndicatorNote id="scrutiny_quality" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Pre-AI vs post-AI code" subtitle="Whether code changed between the snapshot before AI assistance and after scrutiny" />
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Comparable pairs</div><div className="text-xl font-bold text-slate-900">{ind.prepost_code.evaluated}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Changed</div><div className="text-xl font-bold text-slate-900">{ind.prepost_code.changed}</div></div>
          <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Mean size delta</div><div className="text-xl font-bold text-slate-900">{ind.prepost_code.meanAbsDelta.toFixed(0)}<span className="text-sm font-normal text-slate-400"> chars</span></div></div>
        </div>
        <IndicatorNote id="prepost_code" />
      </div>
    </div>
  );
}

/* ------------------------- Outcomes tab ------------------------- */

function OutcomesTab({ bundle }: { bundle: ResearchBundle }) {
  const { bundleAllIndicators } = require('@/lib/researchQuestions') as typeof import('@/lib/researchQuestions');
  const ind = useMemo(() => bundleAllIndicators(bundle), [bundle]);
  const approved = bundle.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null);
  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Programming outcomes (approved marks)" subtitle="Distribution of researcher-approved marks out of 100" />
        {ind.programming_outcomes.n === 0 ? <EmptyChart message="No approved assessments in scope. Unapproved AI-suggested marks are never displayed." /> : (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {[['Mean', ind.programming_outcomes.mean], ['Median', ind.programming_outcomes.median], ['Q1', ind.programming_outcomes.q1], ['Q3', ind.programming_outcomes.q3], ['Min', ind.programming_outcomes.min], ['Max', ind.programming_outcomes.max]].map(([label, v]) => (
              <div key={String(label)} className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-lg font-bold text-slate-900">{v !== null ? (typeof v === 'number' ? v.toFixed(0) : v) : '—'}</div></div>
            ))}
          </div>
        )}
        <IndicatorNote id="programming_outcomes" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Within-participant progression" subtitle="Approved marks per participant across their sessions, ordered by session start" />
        {ind.within_progression.length === 0 ? <EmptyChart message="No participant has an approved assessment in scope." /> : (
          <div className="space-y-4">
            {ind.within_progression.map((p) => (
              <div key={p.participant}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-xs text-slate-500">{p.participant}</span>
                  {p.slope !== null && <span className={`text-xs font-medium ${p.slope > 0 ? 'text-emerald-600' : p.slope < 0 ? 'text-amber-600' : 'text-slate-400'}`}>slope {p.slope > 0 ? '+' : ''}{p.slope.toFixed(1)} marks/task</span>}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {p.sequence.map((r, i) => (
                    <span key={r.sessionId} className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700" title={`${r.taskTitle ?? 'Task'} · mark ${r.mark}`}>#{i + 1}: {r.mark}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <IndicatorNote id="within_progression" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Assessment records in scope" subtitle="Marks are only visible here after researcher approval" />
        {approved.length === 0 ? <EmptyChart message="No approved assessments in scope." /> : (
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {approved.map((a) => {
              const s = bundle.sessions.find((x) => x.id === a.session_id);
              return (
                <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0"><span className="font-mono text-xs text-slate-500">{a.participant_id}</span> <span className="text-slate-700 ml-2 truncate">{s?.task_title ?? 'Task'}</span></div>
                  <div className="flex items-center gap-2 shrink-0"><span className="font-bold text-slate-900">{a.approved_mark}/100</span><Link to={`/researcher/session/${a.session_id}/assessment`} className="text-xs text-slate-400 hover:text-slate-900">review</Link></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Traces tab ------------------------- */

function TracesTab({ bundle }: { bundle: ResearchBundle }) {
  const [selected, setSelected] = useState<string | null>(bundle.sessions[0]?.id ?? null);
  const [rq, setRq] = useState<string>('RQ1');
  const trace = useMemo(() => (selected ? buildSessionTrace(bundle, selected) : null), [bundle, selected]);
  const rqRows = useMemo(() => rqDataset(bundle, rq), [bundle, rq]);
  const indicatorRows = useMemo(() => sessionIndicatorRows(bundle), [bundle]);

  const kindStyles: Record<string, { label: string; color: string; bg: string }> = {
    plan: { label: 'Plan', color: '#2563EB', bg: 'bg-blue-50 border-blue-200' },
    initial_code: { label: 'Initial code', color: '#7C3AED', bg: 'bg-violet-50 border-violet-200' },
    ai_request: { label: 'AI request', color: '#F59E0B', bg: 'bg-amber-50 border-amber-200' },
    scrutiny: { label: 'Scrutiny', color: '#0D9488', bg: 'bg-teal-50 border-teal-200' },
    revised_code: { label: 'Revised code', color: '#16A34A', bg: 'bg-green-50 border-green-200' },
    final_outcome: { label: 'Final outcome', color: '#4F46E5', bg: 'bg-indigo-50 border-indigo-200' },
    evaluation: { label: 'Evaluation', color: '#64748B', bg: 'bg-slate-50 border-slate-200' },
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="AI-to-Code Traceability viewer" subtitle="Plan → initial code → AI request & response → scrutiny → revised code → outcome → evaluation" />
        <div className="flex flex-wrap gap-2 mb-4">
          {bundle.sessions.map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${selected === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
              <span className="font-mono">{s.participant_id}</span> · {s.task_title?.slice(0, 18)}
            </button>
          ))}
        </div>
        {!trace ? <EmptyChart message="No sessions in scope." /> : (
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {trace.steps.map((s, i) => {
                const style = kindStyles[s.kind];
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${style.bg}`} style={{ color: style.color }}>{style.label}</div>
                    {i < trace.steps.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-slate-300" />}
                  </div>
                );
              })}
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {trace.steps.map((s, i) => {
                const style = kindStyles[s.kind];
                return (
                  <div key={i} className={`border rounded-lg p-3 ${style.bg}`} role="listitem">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold" style={{ color: style.color }}>{s.label}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{new Date(s.ts).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-5 whitespace-pre-wrap font-mono">{s.detail}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Each step links the underlying record (plan, snapshot, AI interaction, scrutiny, reflection). Unapproved assessments are never displayed.</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Per-session derived indicators" subtitle="One row per session: events, AI use, scrutiny rubric, behaviour class" legend={
          <button onClick={() => exportAsCSV(indicatorRows, 'pause_session_indicators')} className="flex items-center gap-1.5 text-xs border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
        } />
        {indicatorRows.length === 0 ? <EmptyChart message="No sessions in scope." /> : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500 sticky top-0 bg-white"><tr className="text-left">
                {['participant', 'task', 'status', 'events', 'AI req', 'AI categories', 'scrutiny', 'rubric mean', 'behaviour'].map((h) => <th key={h} className="py-2 px-2 border-b border-slate-100 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {indicatorRows.map((r) => (
                  <tr key={r.session_id} className="text-slate-700">
                    <td className="py-1.5 px-2 font-mono">{r.participant_id}</td>
                    <td className="py-1.5 px-2 max-w-32 truncate">{r.task}</td>
                    <td className="py-1.5 px-2 capitalize">{r.status.replace('_', ' ')}</td>
                    <td className="py-1.5 px-2">{r.events}</td>
                    <td className="py-1.5 px-2">{r.ai_requests}</td>
                    <td className="py-1.5 px-2 max-w-40 truncate">{r.ai_categories || '—'}</td>
                    <td className="py-1.5 px-2">{r.scrutiny_responses}</td>
                    <td className="py-1.5 px-2">{r.scrutiny_quality_mean !== null ? r.scrutiny_quality_mean.toFixed(1) : '—'}</td>
                    <td className="py-1.5 px-2">{r.behaviour_class || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Research-question datasets" subtitle="Flat per-unit datasets suitable for statistical analysis" />
        <div className="flex flex-wrap gap-2 mb-4">
          {RESEARCH_QUESTIONS.map((q) => (
            <button key={q.id} onClick={() => setRq(q.id)} className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${rq === q.id ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-600 border-slate-200 hover:border-slate-400'}`}>{q.id}: {q.title}</button>
          ))}
          <button onClick={() => exportAsCSV(rqRows, `pause_rq_${rq.toLowerCase()}`)} className="ml-auto flex items-center gap-1.5 text-xs border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export {rq} CSV</button>
        </div>
        {rqRows.length === 0 ? <EmptyChart message="No records in scope for this research question." /> : (
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500 sticky top-0 bg-white"><tr className="text-left">
                {Object.keys(rqRows[0]).slice(0, 10).map((h) => <th key={h} className="py-2 px-2 border-b border-slate-100 font-medium whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {rqRows.slice(0, 50).map((row, i) => (
                  <tr key={i} className="text-slate-700">
                    {Object.keys(rqRows[0]).slice(0, 10).map((h) => <td key={h} className="py-1.5 px-2 border-b border-slate-50 max-w-40 truncate">{String(row[h] ?? '—')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------- RQ Explorer ------------------------- */

function RQExplorer({ bundle }: { bundle: ResearchBundle }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
      <CardHeader title="Research Question Explorer" subtitle="Evidence matrix: which indicators can inform each approved research question" />
      <div className="grid lg:grid-cols-2 gap-3">
        {RESEARCH_QUESTIONS.map((q) => {
          const rows = qDatasetSafe(bundle, q.id);
          return (
            <div key={q.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{q.id}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400">{rows.length} records</span>
                  <button onClick={() => exportAsCSV(rows, `pause_rq_${q.id.toLowerCase()}`)} className="text-[11px] text-slate-500 hover:text-slate-900 underline">export</button>
                </div>
              </div>
              <h3 className="text-sm font-semibold text-slate-900">{q.title}</h3>
              <p className="text-xs text-slate-600 leading-5 mt-1.5">{q.question}</p>
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium mb-1">Evidence indicators</div>
                <div className="flex flex-wrap gap-1.5">
                  {q.indicators.map((iid) => {
                    const doc = findIndicator(iid);
                    return doc ? <span key={iid} className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-0.5 text-slate-600" title={`${doc.definition} — source: ${doc.source}`}>{doc.label}</span> : null;
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-4 flex gap-1.5"><ClipboardList className="w-3.5 h-3.5 shrink-0 mt-px" />Mappings are descriptive — they identify which data can address each question, not findings. No statistical significance or causal claims are asserted.</p>
    </div>
  );
}

function qDatasetSafe(bundle: ResearchBundle, rqId: string) {
  try { return rqDataset(bundle, rqId); } catch { return []; }
}

/* ------------------------- Data Quality ------------------------- */

function DataQualityPanel({ bundle }: { bundle: ResearchBundle }) {
  const quality = useMemo(() => dataQuality(bundle), [bundle]);
  const checks: { label: string; n: number; detail: string; severity: 'ok' | 'warn' }[] = [
    { label: 'Events with empty description or metadata', n: quality.eventIssues.length, detail: 'Events still count toward engagement metrics', severity: quality.eventIssues.length > 0 ? 'warn' : 'ok' },
    { label: 'Incomplete sessions', n: quality.incompleteSessions.length, detail: 'In-progress or abandoned sessions in scope', severity: 'ok' },
    { label: 'Sessions with no recorded events', n: quality.sessionsWithNoEvents.length, detail: 'Session exists but produced no analytics rows', severity: quality.sessionsWithNoEvents.length > 0 ? 'warn' : 'ok' },
    { label: 'Likely duplicate events', n: quality.duplicateEvents.length, detail: 'Same session, type and description within 2 seconds', severity: quality.duplicateEvents.length > 0 ? 'warn' : 'ok' },
    { label: 'Timestamp inconsistencies', n: quality.tsIssues.length, detail: 'Events preceding session start or completions before start', severity: quality.tsIssues.length > 0 ? 'warn' : 'ok' },
    { label: 'Completed sessions missing TASK_COMPLETED event', n: quality.sessionsWithoutCompletionEvent.length, detail: 'Status completed but no terminal event logged', severity: quality.sessionsWithoutCompletionEvent.length > 0 ? 'warn' : 'ok' },
    { label: 'Scrutiny responses with empty fields', n: quality.scrutinyEmptyFields.length, detail: 'Empty fields excluded from rubric items', severity: quality.scrutinyEmptyFields.length > 0 ? 'warn' : 'ok' },
    { label: 'Reflections missing confidence', n: quality.reflectionsMissingConfidence.length, detail: 'Excluded from confidence-change calculations', severity: quality.reflectionsMissingConfidence.length > 0 ? 'warn' : 'ok' },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
      <CardHeader title="Data quality panel" subtitle={`Scope: ${quality.totals.sessions} sessions, ${quality.totals.events} events, ${quality.totals.scrutiny} scrutiny, ${quality.totals.reflections} reflections, ${quality.totals.aiInteractions} AI interactions`} legend={
        <button onClick={() => exportAsCSV(checks.map((c) => ({ check: c.label, count: c.n, status: c.severity })), 'pause_data_quality')} className="flex items-center gap-1.5 text-xs border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
      } />
      <div className="grid sm:grid-cols-2 gap-3">
        {checks.map((c) => (
          <div key={c.label} className="flex items-start gap-2.5 border rounded-lg p-3">
            {c.severity === 'ok'
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-800">{c.label} <span className="font-bold text-slate-900">{c.n}</span></div>
              <div className="text-[11px] text-slate-500 mt-0.5">{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        {[['Approved assessments', quality.totals.assessmentsApproved], ['Pending assessments', quality.totals.assessmentsPending], ['Plans', quality.totals.plans], ['AI interactions', quality.totals.aiInteractions]].map(([label, v]) => (
          <div key={String(label)} className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</div><div className="text-sm font-bold text-slate-900">{v}</div></div>
        ))}
      </div>
      <p className="text-[11px] text-slate-400 mt-4">Data-quality issues are reported for transparency. Records are never silently dropped: each indicator documents how missing values are handled.</p>
    </div>
  );
}

/* ------------------------- Shared ------------------------- */

function IndicatorNote({ id }: { id: string }) {
  const doc = findIndicator(id);
  if (!doc) return null;
  return (
    <details className="mt-3 group">
      <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-600 list-none flex items-center gap-1">
        <span className="w-1 h-1 rounded-full bg-slate-300 group-open:bg-slate-500 transition-colors" />
        Indicator documentation: {doc.label}
      </summary>
      <div className="mt-2 bg-slate-50 rounded-lg p-3 text-[11px] text-slate-600 leading-5 grid sm:grid-cols-2 gap-x-4 gap-y-1">
        <div><span className="font-medium text-slate-700">Definition:</span> {doc.definition}</div>
        <div><span className="font-medium text-slate-700">Data source:</span> {doc.source}</div>
        <div><span className="font-medium text-slate-700">Formula:</span> {doc.formula}</div>
        <div><span className="font-medium text-slate-700">Unit:</span> {doc.unit}</div>
        <div><span className="font-medium text-slate-700">Denominator:</span> {doc.denominator}</div>
        <div><span className="font-medium text-slate-700">Missing-data rule:</span> {doc.missingRule}</div>
        <div className="sm:col-span-2"><span className="font-medium text-slate-700">Limitation:</span> {doc.limitation}</div>
      </div>
    </details>
  );
}