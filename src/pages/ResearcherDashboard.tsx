import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Download,
  Filter, Layers, ListChecks, RefreshCw, Search, ShieldCheck, X,
} from 'lucide-react';
import ThreePanelTab from './ThreePanelTab';
import { loadResearchData, filterBundle, hasActiveFilters, EMPTY_FILTERS, type ResearchBundle, type ResearchFilters } from '@/lib/researchData';
import { findIndicator } from '@/lib/researchIndicators';
import { RESEARCH_QUESTIONS, dataQuality, sessionIndicatorRows } from '@/lib/researchQuestions';
import { CardHeader, EmptyChart } from '@/components/charts';
import { buildSessionTrace, rqDataset } from '@/lib/researchTraces';
import { exportAsCSV } from '@/lib/exporter';

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

      {tab === 'overview' && <div className="overflow-x-auto -mx-4 px-4"><ThreePanelTab bundle={filtered} /></div>}
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

