import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, ClipboardCheck, Download,
  FileCode2, Filter, Layers, ListChecks, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react';
import { loadResearchData, filterBundle, hasActiveFilters, EMPTY_FILTERS, type ResearchBundle, type ResearchFilters } from '@/lib/researchData';
import { findIndicator, type IndicatorDoc } from '@/lib/researchIndicators';
import { RESEARCH_QUESTIONS, dataQuality, sessionIndicatorRows, bundleAllIndicators } from '@/lib/researchQuestions';
import { buildSessionTrace, rqDataset } from '@/lib/researchTraces';
import { exportAsCSV } from '@/lib/exporter';
import { CardHeader, GroupedBarChart, EmptyChart, CHART_COLORS } from '@/components/charts';
import { AI_CATEGORY_LABELS, PHASE_LABELS } from '@/lib/constants';
import type { MetacognitiveRating, AICategory } from '@/lib/types';

const TABS = [
  { key: 'overview', label: 'Three-Panel Dashboard', icon: BarChart3 },
  { key: 'review', label: 'Assessment Review', icon: ClipboardCheck },
  { key: 'traces', label: 'Participant Learning Traces', icon: Layers },
  { key: 'rq', label: 'Research Question Explorer', icon: Search },
  { key: 'quality', label: 'Data Quality & Exports', icon: ShieldCheck },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export default function ResearcherDashboard() {
  const [bundle, setBundle] = useState<ResearchBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [filters, setFilters] = useState<ResearchFilters>(EMPTY_FILTERS);

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
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold text-amber-600 uppercase tracking-widest">Research platform</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">PAUSE learning analytics</h1>
          <p className="text-sm text-slate-500 mt-1">Descriptive analytics for engagement, programming assessment and metacognitive process — no causal or predictive claims.</p>
        </div>
        <button onClick={() => void reload()} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <ResearchFiltersBar bundle={bundle} filters={filters} setFilters={setFilters} />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 mb-5" role="tablist">
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

      {tab === 'overview' && <ThreePanelTab bundle={filtered} onOpenReview={() => setTab('review')} />}
      {tab === 'review' && <AssessmentReviewTab bundle={filtered} />}
      {tab === 'traces' && <TracesTab bundle={filtered} />}
      {tab === 'rq' && <RQExplorerTab bundle={filtered} />}
      {tab === 'quality' && <QualityExportsTab bundle={filtered} />}
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <label className="text-xs text-slate-500">Participant
          <select value={filters.participantId} onChange={(e) => set({ participantId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All</option>
            {bundle.participants.map((p) => <option key={p.id} value={p.id}>{p.participant_id}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Task
          <select value={filters.taskId} onChange={(e) => set({ taskId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All</option>
            {bundle.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">Session
          <select value={filters.sessionId} onChange={(e) => set({ sessionId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All</option>
            {bundle.sessions.map((s) => <option key={s.id} value={s.id}>{`${s.participant_id} · ${(s.task_title ?? 'Task').slice(0, 18)}`}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">From
          <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">To
          <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">Assessment status
          <select value={filters.status} onChange={(e) => set({ status: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="all">All</option>
            <option value="approved">Approved assessments</option>
            <option value="pending">Pending assessments</option>
            <option value="none">No assessment</option>
          </select>
        </label>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">No study-group field exists in the database; group assignment would require a schema addition before this filter can be offered.</p>
      {active && <button onClick={() => setFilters(EMPTY_FILTERS)} className="mt-2 text-xs text-slate-500 hover:text-slate-900 underline">Clear all filters</button>}
    </div>
  );
}

/* ------------------------- Panel helpers ------------------------- */

function PanelHeading({ id, icon: Icon, title, tone }: { id: string; icon: typeof BarChart3; title: string; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${tone}`} />
      <h2 id={id} className="text-base font-bold text-slate-900">{title}</h2>
    </div>
  );
}

function IndicatorNote({ doc }: { doc?: IndicatorDoc }) {
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

/* ------------------------- Tab 1: three-panel dashboard ------------------------- */

function ThreePanelTab({ bundle, onOpenReview }: { bundle: ResearchBundle; onOpenReview: () => void }) {
  const ind = useMemo(() => bundleAllIndicators(bundle), [bundle]);
  const approved = bundle.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null);
  const pending = bundle.assessments.filter((a) => a.status === 'pending');
  const ratingByTask = useMemo(() => ratingsByTask(bundle), [bundle]);
  const metaByParticipant = useMemo(() => metacogByParticipant(bundle), [bundle]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* PANEL 1 — Cohort Learning Engagement */}
      <section aria-labelledby="p1-title" className="space-y-5">
        <PanelHeading id="p1-title" icon={BarChart3} title="Cohort Learning Engagement" tone="text-blue-600" />

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Cohort at a glance" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Participants</div><div className="text-xl font-bold text-slate-900">{ind.cohort_engagement.participants}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Sessions</div><div className="text-xl font-bold text-slate-900">{ind.task_completion.total}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Completed tasks</div><div className="text-xl font-bold text-slate-900">{ind.task_completion.completed}</div></div>
            <div className="bg-slate-50 rounded-lg p-3"><div className="text-xs text-slate-500">Events recorded</div><div className="text-xl font-bold text-slate-900">{ind.cohort_engagement.events}</div></div>
          </div>
          <IndicatorNote doc={findIndicator('cohort_engagement')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="PAUSE phase participation" subtitle="Share of sessions with recorded activity in each phase" />
          <div className="space-y-3">
            {ind.phase_participation.map((p) => (
              <div key={p.phase}>
                <div className="flex justify-between text-xs mb-1"><span className="font-medium text-slate-700">{PHASE_LABELS[p.phase as keyof typeof PHASE_LABELS] ?? p.phase}</span><span className="text-slate-500">{p.sessionsWith} · {p.share.toFixed(0)}%</span></div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(p.share, 100)}%`, backgroundColor: CHART_COLORS.student }} /></div>
              </div>
            ))}
          </div>
          <IndicatorNote doc={findIndicator('phase_participation')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Attempt-first vs AI-first" subtitle="Independent code activity before first AI request" />
          <div className="flex h-6 rounded-lg overflow-hidden mb-2" role="img" aria-label="attempt-first versus ai-first sessions">
            <div className="bg-blue-500 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${ind.attempt_first_vs_ai_first.denom ? (ind.attempt_first_vs_ai_first.attemptFirst / ind.attempt_first_vs_ai_first.denom) * 100 : 0}%` }}>{ind.attempt_first_vs_ai_first.attemptFirst || ''}</div>
            <div className="bg-amber-400 flex items-center justify-center text-[10px] text-white font-medium" style={{ width: `${ind.attempt_first_vs_ai_first.denom ? (ind.attempt_first_vs_ai_first.aiFirst / ind.attempt_first_vs_ai_first.denom) * 100 : 0}%` }}>{ind.attempt_first_vs_ai_first.aiFirst || ''}</div>
          </div>
          <div className="flex gap-4 text-[11px] text-slate-600"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Attempt-first {ind.attempt_first_vs_ai_first.attemptFirst}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />AI-first {ind.attempt_first_vs_ai_first.aiFirst}</span><span className="text-slate-400">not classifiable {ind.attempt_first_vs_ai_first.excluded}</span></div>
          <IndicatorNote doc={findIndicator('attempt_first_vs_ai_first')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="AI assistance frequency and categories" subtitle={`${bundle.aiInteractions.length} requests in scope`} />
          {ind.ai_request_frequency.categories.length === 0 ? <EmptyChart height={90} message="No AI interactions in scope." /> : (
            <div className="space-y-2">
              {ind.ai_request_frequency.categories.map((c) => (
                <div key={c.category}>
                  <div className="flex justify-between text-xs mb-0.5"><span className="text-slate-700">{AI_CATEGORY_LABELS[c.category as AICategory] ?? c.category}</span><span className="text-slate-500">{c.n}</span></div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-400 rounded-full" style={{ width: `${c.share}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <IndicatorNote doc={findIndicator('ai_request_frequency')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Scrutiny and code revision activity" subtitle="Judgment recordings and pre/post-AI code changes" />
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500">Scrutiny responses</div><div className="text-lg font-bold text-slate-900">{bundle.scrutiny.length}</div></div>
            <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500">Code changed</div><div className="text-lg font-bold text-slate-900">{ind.prepost_code.changed}</div></div>
            <div className="bg-slate-50 rounded-lg p-2.5"><div className="text-[10px] text-slate-500">Mean rubric</div><div className="text-lg font-bold text-slate-900">{bundle.scrutiny.length ? `${ind.scrutiny_quality.mean.toFixed(1)}/4` : '—'}</div></div>
          </div>
          <IndicatorNote doc={findIndicator('prepost_code')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Learning sequence: phase transitions" subtitle="Most frequent movements between phases" />
          {ind.phase_transitions.pairs.length === 0 ? <EmptyChart height={80} message="No transitions in scope." /> : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {ind.phase_transitions.pairs.slice(0, 8).map(([pair, n]) => (
                <div key={pair} className="flex items-center justify-between text-xs"><span className="font-mono text-slate-600">{pair}</span><span className="font-semibold text-slate-900">{n}</span></div>
              ))}
            </div>
          )}
          <IndicatorNote doc={findIndicator('phase_transitions')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Time in each PAUSE phase" subtitle="Median minutes between phase entry and exit" />
          {ind.phase_durations.perPhase.length === 0 ? <EmptyChart height={80} message="No complete phase pairs in scope." /> : (
            <div className="space-y-2">
              {ind.phase_durations.perPhase.map((d) => (
                <div key={d.phase} className="flex items-center justify-between text-xs">
                  <span className="text-slate-700">{PHASE_LABELS[d.phase as keyof typeof PHASE_LABELS] ?? d.phase}</span>
                  <span className="text-slate-900 font-semibold">{d.medianMinutes !== null ? `${d.medianMinutes.toFixed(1)} min` : '—'} <span className="text-slate-400 font-normal">n={d.n}</span></span>
                </div>
              ))}
            </div>
          )}
          <IndicatorNote doc={findIndicator('phase_durations')} />
        </div>
      </section>

      {/* PANEL 2 — Programming Assessment */}
      <section aria-labelledby="p2-title" className="space-y-5">
        <PanelHeading id="p2-title" icon={FileCode2} title="Programming Assessment" tone="text-purple-600" />

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Assignment marks (approved)" subtitle="Researcher-approved marks out of 100" />
          {approved.length === 0 ? <EmptyChart height={80} message="No approved assessments in scope." /> : (
            <GroupedBarChart
              data={approved.map((a) => ({ label: `${a.participant_id.slice(-4)}`, values: { mark: a.approved_mark as number } }))}
              series={[{ key: 'mark', label: 'Approved mark', color: CHART_COLORS.student }]}
              height={110}
            />
          )}
          {approved.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
              {[['Mean', ind.programming_outcomes.mean], ['Median', ind.programming_outcomes.median], ['Min', ind.programming_outcomes.min], ['Max', ind.programming_outcomes.max]].map(([label, v]) => (
                <div key={String(label)} className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">{label}</div><div className="text-sm font-bold text-slate-900">{v !== null ? (v as number).toFixed(0) : '—'}</div></div>
              ))}
            </div>
          )}
          <IndicatorNote doc={findIndicator('programming_outcomes')} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="AI-suggested vs researcher-approved" subtitle="Where the researcher changed the AI draft mark" />
          {approved.length === 0 && pending.length === 0 ? <EmptyChart height={80} message="No assessments in scope." /> : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {[...approved, ...pending].map((a) => {
                const changed = a.approved_mark !== null && a.ai_suggested_mark !== null && a.approved_mark !== a.ai_suggested_mark;
                return (
                  <div key={a.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg px-3 py-2">
                    <span className="font-mono text-slate-500">{a.participant_id}</span>
                    <span className="text-slate-400">AI {a.ai_suggested_mark ?? '—'} → approved {a.approved_mark ?? 'pending'}</span>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${a.status === 'approved' ? (changed ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-slate-300'}`} title={changed ? 'Researcher modified the AI mark' : a.status === 'approved' ? 'Approved as suggested' : 'Pending'} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Pending assessment queue" subtitle="AI drafts awaiting researcher approval" legend={<button onClick={onOpenReview} className="text-xs text-slate-500 hover:text-slate-900 underline">review all</button>} />
          {pending.length === 0 ? <p className="text-xs text-slate-400">No pending assessments. Nothing is published without approval.</p> : (
            <div className="space-y-2">
              {pending.map((a) => {
                const s = bundle.sessions.find((x) => x.id === a.session_id);
                return (
                  <Link key={a.id} to={`/researcher/session/${a.session_id}/assessment`} className="block border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 text-xs hover:border-amber-400">
                    <span className="font-mono text-slate-600">{a.participant_id}</span> · {s?.task_title ?? 'Task'}
                    <span className="float-right text-amber-700 font-medium">AI draft {a.ai_suggested_mark ?? '—'}/100</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Performance by task" subtitle="Approved marks grouped per task" />
          {approved.length === 0 ? <EmptyChart height={80} message="No approved marks in scope." /> : (
            <div className="space-y-2.5">
              {marksByTask(approved, bundle).map((t) => (
                <div key={t.task}>
                  <div className="flex justify-between text-xs mb-0.5"><span className="text-slate-700 truncate max-w-[70%]">{t.task}</span><span className="text-slate-500">mean {t.mean.toFixed(0)} (n={t.n})</span></div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${t.mean}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Approved programming feedback" subtitle="Latest approved feedback per participant" />
          {approved.length === 0 ? <p className="text-xs text-slate-400">No approved feedback yet.</p> : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto">
              {latestFeedbackPerParticipant(approved).map((f) => (
                <div key={f.participant} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex justify-between text-xs mb-1"><span className="font-mono text-slate-500">{f.participant}</span><span className="font-semibold text-slate-700">{f.mark}/100</span></div>
                  <p className="text-[11px] text-slate-600 leading-5">{(f.feedback ?? '').slice(0, 220)}{(f.feedback ?? '').length > 220 ? '…' : ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* PANEL 3 — Metacognitive Analytics and Interpretation */}
      <section aria-labelledby="p3-title" className="space-y-5">
        <PanelHeading id="p3-title" icon={BrainCircuit} title="Metacognitive Analytics" tone="text-teal-600" />

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Rating distributions" subtitle="Approved qualitative metacognitive ratings" />
          <MetacogDistribution bundle={bundle} />
          <p className="text-[11px] text-slate-400 mt-3">Qualitative categories only — never converted to numbers, composites or comments. Phase completion is not treated as evidence of metacognitive quality.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Rating patterns by task" subtitle="Which tasks carry which approved ratings" />
          {ratingByTask.length === 0 ? <p className="text-xs text-slate-400">No approved metacognitive ratings in scope.</p> : (
            <div className="space-y-2.5 max-h-56 overflow-y-auto">
              {ratingByTask.map((t) => (
                <div key={t.task} className="border border-slate-100 rounded-lg p-2.5">
                  <div className="text-xs font-medium text-slate-700 mb-1 truncate">{t.task}</div>
                  <div className="flex flex-wrap gap-1">
                    {t.ratings.map((row, ri) => row.map((r, i) => <RatingBadge key={`${ri}-${i}`} rating={r} />))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Changes across successive tasks" subtitle="Per participant, approved ratings in session order" />
          {metaByParticipant.length === 0 ? <p className="text-xs text-slate-400">Participants with one or more approved assessments appear here.</p> : (
            <div className="space-y-2.5 max-h-56 overflow-y-auto">
              {metaByParticipant.map((p) => (
                <div key={p.participant} className="border border-slate-100 rounded-lg p-2.5">
                  <div className="text-[11px] font-mono text-slate-500 mb-1">{p.participant}</div>
                  {p.rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] text-slate-400 w-8">#{i + 1}</span>
                      {r.ratings.map((v, j) => <span key={j} className={`w-1.5 h-4 rounded-sm ${ratingColor(v)}`} title={`${META_DIMS[j].label}: ${v ?? 'not rated'}`} />)}
                      <span className="text-[10px] text-slate-500 truncate">{r.task}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Ratings and programming outcomes" subtitle="Descriptive side-by-side view — no composite scores, no causal claims" />
          <RatingOutcomeMatrix bundle={bundle} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <CardHeader title="Participant-level ratings" subtitle="Latest approved rating per participant" />
          {metaByParticipant.length === 0 ? <p className="text-xs text-slate-400">No approved ratings yet.</p> : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {metaByParticipant.map((p) => {
                const latest = p.rows[p.rows.length - 1];
                return (
                  <div key={p.participant} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-slate-500 shrink-0">{p.participant}</span>
                    <div className="flex flex-wrap gap-1 justify-end">{latest.ratings.map((r, i) => <RatingBadge key={i} rating={r} small />)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ------------------------- Panel 3 helpers ------------------------- */

const META_DIMS: { key: 'metacog_planning' | 'metacog_monitoring' | 'metacog_scrutiny' | 'metacog_evaluation'; label: string }[] = [
  { key: 'metacog_planning', label: 'Planning' },
  { key: 'metacog_monitoring', label: 'Monitoring and Attempt' },
  { key: 'metacog_scrutiny', label: 'Critical Scrutiny of AI' },
  { key: 'metacog_evaluation', label: 'Evaluation' },
];
const RATING_ORDER: MetacognitiveRating[] = ['excellent', 'good', 'needs_improvement', 'not_observed', 'not_applicable'];
const RATING_LABELS: Record<MetacognitiveRating, string> = { excellent: 'Excellent', good: 'Good', needs_improvement: 'Needs Improvement', not_observed: 'Not Observed', not_applicable: 'Not Applicable' };
const RATING_STYLES: Record<MetacognitiveRating, string> = {
  excellent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  good: 'bg-sky-100 text-sky-800 border-sky-200',
  needs_improvement: 'bg-amber-100 text-amber-800 border-amber-200',
  not_observed: 'bg-slate-100 text-slate-600 border-slate-200',
  not_applicable: 'bg-slate-50 text-slate-400 border-slate-200',
};

function ratingColor(r: MetacognitiveRating | null): string {
  if (!r) return 'bg-slate-100';
  return { excellent: 'bg-emerald-400', good: 'bg-sky-400', needs_improvement: 'bg-amber-400', not_observed: 'bg-slate-300', not_applicable: 'bg-slate-100' }[r];
}

function RatingBadge({ rating, small }: { rating: MetacognitiveRating | null; small?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-md border font-medium ${small ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'} ${rating ? RATING_STYLES[rating] : 'bg-white text-slate-300 border-slate-100'}`}>
      {rating ? RATING_LABELS[rating] : '—'}
    </span>
  );
}

/** Latest approved assessment per participant carrying metacognitive ratings. */
function metacogRows(bundle: ResearchBundle) {
  return bundle.assessments
    .filter((a) => a.status === 'approved')
    .map((a) => ({ a, session: bundle.sessions.find((s) => s.id === a.session_id) }))
    .filter(({ a }) => META_DIMS.some(({ key }) => a[key]))
    .sort((x, y) => (x.a.approved_at ?? '').localeCompare(y.a.approved_at ?? ''));
}

function MetacogDistribution({ bundle }: { bundle: ResearchBundle }) {
  const rows = metacogRows(bundle);
  if (rows.length === 0) return <EmptyChart height={80} message="No approved metacognitive ratings in scope." />;
  return (
    <div className="space-y-3">
      {META_DIMS.map((dim) => {
        const counts = new Map<MetacognitiveRating, number>();
        for (const { a } of rows) {
          const v = a[dim.key];
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        const total = [...counts.values()].reduce((s, v) => s + v, 0);
        const missing = rows.length - total;
        return (
          <div key={dim.key}>
            <div className="text-xs font-medium text-slate-700 mb-1">{dim.label} <span className="text-slate-400 font-normal">({total} rated{missing > 0 ? `, ${missing} not rated` : ''})</span></div>
            <div className="flex gap-1 flex-wrap">
              {RATING_ORDER.map((r) => {
                const n = counts.get(r) ?? 0;
                if (n === 0) return null;
                return <span key={r} className={`px-2 py-0.5 rounded-md border text-[11px] ${RATING_STYLES[r]}`}>{RATING_LABELS[r]} {n}</span>;
              })}
              {total === 0 && <span className="text-[11px] text-slate-400">recorded as missing, not 'Not Applicable'</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ratingsByTask(bundle: ResearchBundle) {
  const byTask = new Map<string, (MetacognitiveRating | null)[][]>();
  for (const { a, session } of metacogRows(bundle)) {
    const task = session?.task_title ?? 'Task';
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task)!.push(META_DIMS.map((d) => a[d.key]));
  }
  return [...byTask.entries()].map(([task, ratings]) => ({ task, ratings }));
}

function metacogByParticipant(bundle: ResearchBundle) {
  const byParticipant = new Map<string, { task: string; ratings: (MetacognitiveRating | null)[] }[]>();
  for (const { a, session } of metacogRows(bundle)) {
    const pid = a.participant_id;
    if (!byParticipant.has(pid)) byParticipant.set(pid, []);
    byParticipant.get(pid)!.push({ task: session?.task_title ?? 'Task', ratings: META_DIMS.map((d) => a[d.key]) });
  }
  return [...byParticipant.entries()].map(([participant, rows]) => ({ participant, rows }));
}

function RatingOutcomeMatrix({ bundle }: { bundle: ResearchBundle }) {
  const rows = bundle.assessments
    .filter((a) => a.status === 'approved' && a.approved_mark !== null && META_DIMS.some((d) => a[d.key]))
    .map((a) => ({ mark: a.approved_mark as number, ratings: META_DIMS.map((d) => a[d.key]) }));
  if (rows.length === 0) return <p className="text-xs text-slate-400">Appears once approved assessments carry both a mark and ratings.</p>;
  // Descriptive mean mark per rating value per dimension — observed co-occurrence only.
  return (
    <div className="space-y-3">
      {META_DIMS.map((dim, di) => {
        const perRating = RATING_ORDER.map((r) => {
          const marks = rows.filter((row) => row.ratings[di] === r).map((row) => row.mark);
          return { rating: r, n: marks.length, mean: marks.length ? marks.reduce((s, v) => s + v, 0) / marks.length : null };
        }).filter((x) => x.n > 0);
        if (perRating.length === 0) return null;
        return (
          <div key={dim.key}>
            <div className="text-xs font-medium text-slate-700 mb-1">{dim.label}</div>
            <div className="flex flex-wrap gap-2">
              {perRating.map((x) => (
                <span key={x.rating} className={`px-2 py-0.5 rounded-md border text-[11px] ${RATING_STYLES[x.rating]}`}>
                  {RATING_LABELS[x.rating]}: mean mark {x.mean!.toFixed(0)} (n={x.n})
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-slate-400">Mean approved mark co-occurring with each rating. Co-occurrence is not causal evidence and ratings are never composited into marks.</p>
    </div>
  );
}

/* ------------------------- Tab 2: Assessment Review ------------------------- */

function AssessmentReviewTab({ bundle }: { bundle: ResearchBundle }) {
  const rows = bundle.assessments
    .map((a) => ({ a, session: bundle.sessions.find((s) => s.id === a.session_id) }))
    .sort((x, y) => (x.a.status === y.a.status ? (y.a.updated_at ?? '').localeCompare(x.a.updated_at ?? '') : x.a.status === 'pending' ? -1 : 1));
  const rubricTotals = (a: typeof rows[number]['a']) => {
    const parts = [a.approved_correctness, a.approved_approach, a.approved_quality, a.approved_testing];
    return parts.every((p) => p !== null) ? parts.reduce((s, v) => s + (v ?? 0), 0) : null;
  };
  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Assessment records" subtitle="AI drafts, researcher sub-scores (correctness 40 / approach 20 / quality 20 / testing 20), approval state and timestamps. Unapproved rows are never visible to students." />
        {rows.length === 0 ? <EmptyChart message="No assessments in scope." /> : (
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500"><tr className="text-left">
                {['participant', 'task', 'state', 'AI draft', 'rubric (C/A/Q/T)', 'approved', 'rubric total', 'approved at', ''].map((h) => <th key={h} className="py-2 px-2 border-b border-slate-100 font-medium whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map(({ a, session }) => (
                  <tr key={a.id} className="text-slate-700">
                    <td className="py-2 px-2 font-mono">{a.participant_id}</td>
                    <td className="py-2 px-2 max-w-40 truncate">{session?.task_title ?? 'Task'}</td>
                    <td className="py-2 px-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${a.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{a.status}</span></td>
                    <td className="py-2 px-2">{a.ai_suggested_mark ?? '—'}</td>
                    <td className="py-2 px-2 font-mono">{[a.approved_correctness, a.approved_approach, a.approved_quality, a.approved_testing].map((v) => v ?? '–').join('/')}</td>
                    <td className="py-2 px-2 font-bold">{a.approved_mark ?? '—'}</td>
                    <td className="py-2 px-2">{rubricTotals(a) ?? '—'}</td>
                    <td className="py-2 px-2 text-slate-400">{a.approved_at ? new Date(a.approved_at).toLocaleString() : '—'}</td>
                    <td className="py-2 px-2"><Link to={`/researcher/session/${a.session_id}/assessment`} className="text-slate-500 hover:text-slate-900 underline">review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400">AI suggestion drafts, researcher-approved values and approval timestamps are stored as separate columns, so the record of what the AI proposed and what the researcher published is always preserved.</p>
    </div>
  );
}

/* ------------------------- Tab 3: Traces ------------------------- */

function TracesTab({ bundle }: { bundle: ResearchBundle }) {
  const [selected, setSelected] = useState<string | null>(bundle.sessions[0]?.id ?? null);
  const trace = useMemo(() => (selected ? buildSessionTrace(bundle, selected) : null), [bundle, selected]);
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
        <CardHeader title="AI-to-Code Traceability viewer" subtitle="Plans, code snapshots, AI interactions, scrutiny, revisions, evaluations and final outcomes connected in one chain" />
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
                  <div key={i} className={`border rounded-lg p-3 ${style.bg}`}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold" style={{ color: style.color }}>{s.label}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{new Date(s.ts).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-5 whitespace-pre-wrap font-mono">{s.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Per-session derived indicators" subtitle="One row per session" legend={
          <button onClick={() => exportAsCSV(indicatorRows, 'pause_session_indicators')} className="flex items-center gap-1.5 text-xs border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
        } />
        {indicatorRows.length === 0 ? <EmptyChart message="No sessions in scope." /> : (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="text-xs w-full">
              <thead className="text-slate-500 sticky top-0 bg-white"><tr className="text-left">
                {['participant', 'task', 'status', 'events', 'AI req', 'scrutiny', 'rubric mean', 'behaviour'].map((h) => <th key={h} className="py-2 px-2 border-b border-slate-100 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {indicatorRows.map((r) => (
                  <tr key={r.session_id} className="text-slate-700">
                    <td className="py-1.5 px-2 font-mono">{r.participant_id}</td>
                    <td className="py-1.5 px-2 max-w-32 truncate">{r.task}</td>
                    <td className="py-1.5 px-2 capitalize">{r.status.replace('_', ' ')}</td>
                    <td className="py-1.5 px-2">{r.events}</td>
                    <td className="py-1.5 px-2">{r.ai_requests}</td>
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
    </div>
  );
}

/* ------------------------- Tab 4: RQ Explorer ------------------------- */

function RQExplorerTab({ bundle }: { bundle: ResearchBundle }) {
  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Research Question Evidence Explorer" subtitle="Evidence matrix: which indicators can inform each research question" />
        <div className="grid lg:grid-cols-2 gap-3">
          {RESEARCH_QUESTIONS.map((q) => {
            let rows: Record<string, unknown>[] = [];
            try { rows = rqDataset(bundle, q.id); } catch { rows = []; }
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
                <p className="text-xs text-slate-600 leading-5 mt-1.5 italic">{q.question}</p>
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
        <p className="text-[11px] text-slate-400 mt-4 flex gap-1.5"><ListChecks className="w-3.5 h-3.5 shrink-0 mt-px" />Mappings are descriptive — they identify which data can address each question, not findings. Correlations are never presented as causal evidence and no statistical significance is asserted.</p>
      </div>
    </div>
  );
}

/* ------------------------- Tab 5: Data Quality & Exports ------------------------- */

function QualityExportsTab({ bundle }: { bundle: ResearchBundle }) {
  const quality = useMemo(() => dataQuality(bundle), [bundle]);
  const checks: { label: string; n: number; detail: string; severity: 'ok' | 'warn' }[] = [
    { label: 'Events with empty description or metadata', n: quality.eventIssues.length, detail: 'Still counted in engagement metrics', severity: quality.eventIssues.length > 0 ? 'warn' : 'ok' },
    { label: 'Incomplete sessions', n: quality.incompleteSessions.length, detail: 'In-progress or abandoned', severity: 'ok' },
    { label: 'Sessions with no recorded events', n: quality.sessionsWithNoEvents.length, detail: 'No analytics rows produced', severity: quality.sessionsWithNoEvents.length > 0 ? 'warn' : 'ok' },
    { label: 'Likely duplicate events', n: quality.duplicateEvents.length, detail: 'Same session, type, description within 2 seconds', severity: quality.duplicateEvents.length > 0 ? 'warn' : 'ok' },
    { label: 'Timestamp inconsistencies', n: quality.tsIssues.length, detail: 'Events before session start, completions before start', severity: quality.tsIssues.length > 0 ? 'warn' : 'ok' },
    { label: 'Completed sessions missing TASK_COMPLETED event', n: quality.sessionsWithoutCompletionEvent.length, detail: 'Status completed without terminal event', severity: quality.sessionsWithoutCompletionEvent.length > 0 ? 'warn' : 'ok' },
    { label: 'Scrutiny responses with empty fields', n: quality.scrutinyEmptyFields.length, detail: 'Empty fields excluded from rubric items', severity: quality.scrutinyEmptyFields.length > 0 ? 'warn' : 'ok' },
    { label: 'Reflections missing confidence', n: quality.reflectionsMissingConfidence.length, detail: 'Excluded from confidence-change stats', severity: quality.reflectionsMissingConfidence.length > 0 ? 'warn' : 'ok' },
  ];
  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Data quality panel" subtitle={`Scope: ${quality.totals.sessions} sessions, ${quality.totals.events} events, ${quality.totals.scrutiny} scrutiny, ${quality.totals.reflections} reflections, ${quality.totals.aiInteractions} AI interactions`} legend={
          <button onClick={() => exportAsCSV(checks.map((c) => ({ check: c.label, count: c.n, status: c.severity })), 'pause_data_quality')} className="flex items-center gap-1.5 text-xs border border-slate-300 px-2.5 py-1.5 rounded-lg hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export CSV</button>
        } />
        <div className="grid sm:grid-cols-2 gap-3">
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5 border rounded-lg p-3">
              {c.severity === 'ok' ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{c.label} <span className="font-bold text-slate-900">{c.n}</span></div>
                <div className="text-[11px] text-slate-500 mt-0.5">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <CardHeader title="Research exports" subtitle="All exports are pseudonymous (participant IDs only) and respect the active filters" />
        <div className="grid sm:grid-cols-2 gap-3">
          <ExportCard label="Session-level derived indicators" description="One row per session: events, AI use, scrutiny rubric, behaviour class" onClick={() => exportAsCSV(sessionIndicatorRows(bundle), 'pause_session_indicators')} />
          <ExportCard label="Raw event logs" description="Full chronological event stream" onClick={async () => {
            const { fetchExportData } = await import('@/lib/exporter');
            exportAsCSV(await fetchExportData('event_logs'), 'pause_event_logs');
          }} />
          <ExportCard label="Scrutiny responses with rubric" description="Per-response structural quality coding" onClick={() => exportAsCSV(bundle.scrutiny.map((s) => ({
            participant_id: s.participant_id, session_id: s.session_id,
            accuracy_judgment: s.accuracy_judgment, intended_action: s.intended_action, action_taken: s.action_taken,
            test_result: s.test_result, produced_expected_result: s.produced_expected_result,
            rubric_score: [(s.accuracy_judgment || '').trim() !== '', (s.intended_action || '').trim() !== '', (s.action_taken || '') !== '', (s.test_result || '').trim() !== ''].filter(Boolean).length,
          })), 'pause_scrutiny_rubric')} />
          <ExportCard label="Approved assessments" description="Marks, rubric sub-scores, ratings, approval timestamps" onClick={() => exportAsCSV(bundle.assessments.filter((a) => a.status === 'approved').map((a) => ({
            participant_id: a.participant_id, session_id: a.session_id,
            approved_mark: a.approved_mark, approved_correctness: a.approved_correctness, approved_approach: a.approved_approach, approved_quality: a.approved_quality, approved_testing: a.approved_testing,
            metacog_planning: a.metacog_planning, metacog_monitoring: a.metacog_monitoring, metacog_scrutiny: a.metacog_scrutiny, metacog_evaluation: a.metacog_evaluation,
            ai_suggested_mark: a.ai_suggested_mark, approved_at: a.approved_at,
          })), 'pause_approved_assessments')} />
          <ExportCard label="RQ datasets (all five)" description="Flat per-unit datasets for each research question" onClick={() => {
            for (const q of RESEARCH_QUESTIONS) exportAsCSV(rqDataset(bundle, q.id), `pause_rq_${q.id.toLowerCase()}`);
          }} />
          <ExportCard label="Full export page" description="All raw tables in CSV or JSON" onClick={async () => {
            const { fetchExportData, exportAsCSV: csv } = await import('@/lib/exporter');
            csv(await fetchExportData('sessions'), 'pause_sessions');
          }} />
        </div>
        <p className="text-[11px] text-slate-400 mt-4 flex gap-1.5"><X className="w-3.5 h-3.5 shrink-0 mt-px" />Exports never include emails, auth user ids or unapproved AI-suggested marks.</p>
      </div>
    </div>
  );
}

function ExportCard({ label, description, onClick }: { label: string; description: string; onClick: () => void | Promise<void> }) {
  return (
    <button onClick={() => void onClick()} className="text-left border border-slate-200 rounded-lg p-4 hover:border-slate-400 transition-colors">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Download className="w-3.5 h-3.5 text-slate-400" /> {label}</div>
      <div className="text-xs text-slate-500 mt-1">{description}</div>
    </button>
  );
}

/* ------------------------- shared helpers ------------------------- */

function marksByTask(approved: { approved_mark: number | null; session_id: string }[], bundle: ResearchBundle) {
  const byTask = new Map<string, number[]>();
  for (const a of approved) {
    const s = bundle.sessions.find((x) => x.id === a.session_id);
    const task = s?.task_title ?? 'Task';
    if (!byTask.has(task)) byTask.set(task, []);
    byTask.get(task)!.push(a.approved_mark as number);
  }
  return [...byTask.entries()].map(([task, marks]) => ({ task, n: marks.length, mean: marks.reduce((s, v) => s + v, 0) / marks.length }));
}

function latestFeedbackPerParticipant(approved: { participant_id: string; approved_mark: number | null; programming_feedback: string | null }[]) {
  const byParticipant = new Map<string, { participant: string; mark: number | null; feedback: string | null }>();
  for (const a of approved) {
    if (a.programming_feedback && a.programming_feedback.trim() !== '') byParticipant.set(a.participant_id, { participant: a.participant_id, mark: a.approved_mark, feedback: a.programming_feedback });
  }
  return [...byParticipant.values()];
}