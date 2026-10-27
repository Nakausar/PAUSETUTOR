import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock, Download, RefreshCw, Filter, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { loadTemporalDataset, invalidateCache, type TemporalDataset } from '@/lib/temporal/dataService';
import { auditDataQuality, LONG_GAP_MS, type DataQualityReport } from '@/lib/temporal/dataQuality';
import {
  ANALYSIS_VERSION, PHASE_COLORS, PHASE_DISPLAY, FIVE_PHASES, fmtDuration, GAP_CAP_MINUTES,
  buildPhaseSequence, buildFivePhaseSteps, computeTransitionMatrix, computeFivePhaseTransitions, computeSessionDurations, computeSessionIntervals,
  buildStepTokens, discoverSequences, aiOptionFrequency, repeatedAiPerSession,
  type StepToken, type SessionDurations, type SessionIntervals,
} from '@/lib/temporal/analysis';
import { buildPhaseNetwork, buildAiNetwork, supportingTransitions, classifyEvent, type NetworkGraph, type NetworkDataset } from '@/lib/temporal/network';
import { AI_CATEGORIES } from '@/lib/constants';
import { exportAsCSV } from '@/lib/exporter';
import NetworkGraphView, { type NetworkSelection } from '@/components/NetworkGraphView';
import type { EventLog, Session, AIInteraction, ScrutinyResponse } from '@/lib/types';

const AI_LABELS: Record<string, string> = Object.fromEntries(AI_CATEGORIES.map((c) => [c.key, c.label]));

const STEP_LABELS: Record<StepToken, string> = {
  PLAN: 'Plan created', IND_CODE: 'Independent code', AI_REQ: 'AI request',
  SCRUTINY: 'Scrutiny', REVISION: 'Code revision', TEST: 'Code test', EVAL: 'Evaluation',
};
const STEP_COLORS: Record<StepToken, string> = {
  PLAN: '#2563EB', IND_CODE: '#16A34A', AI_REQ: '#F59E0B', SCRUTINY: '#8B5CF6',
  REVISION: '#0EA5E9', TEST: '#EC4899', EVAL: '#DC2626',
};

interface Filters {
  participantId: string; taskId: string; sessionId: string;
  from: string; to: string; aiOption: string; gradeMin: string; gradeMax: string;
}

const EMPTY_FILTERS: Filters = { participantId: 'all', taskId: 'all', sessionId: 'all', from: '', to: '', aiOption: 'all', gradeMin: '', gradeMax: '' };

type TabKey = 'overview' | 'pathways' | 'ai' | 'networks';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pathways', label: 'Learning Pathways' },
  { key: 'ai', label: 'AI Behaviour' },
  { key: 'networks', label: 'Network Visualisations' },
];

const PATHWAYS_PAGE_SIZE = 15;

function Section({ title, subtitle, children, actions }: { title: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
        {actions}
      </div>
      {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center text-sm text-slate-400">{children}</div>;
}

function Th({ children, onClick, right = false }: { children: React.ReactNode; onClick?: () => void; right?: boolean }) {
  return <th onClick={onClick} className={`py-2 px-2 border-b border-slate-100 font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${onClick ? 'cursor-pointer select-none hover:text-slate-900' : ''}`}>{children}</th>;
}

export default function TemporalAnalysis() {
  const [data, setData] = useState<TemporalDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [tab, setTab] = useState<TabKey>('overview');
  const [dqOpen, setDqOpen] = useState(false);
  const [seqMinLen] = useState(2);
  const [seqMaxLen] = useState(4);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [pathwaysPage, setPathwaysPage] = useState(0);
  const [showRequestDetails, setShowRequestDetails] = useState(false);
  const [showRepeated, setShowRepeated] = useState(false);
  const [rawTransitions, setRawTransitions] = useState(false);
  const [minEdgeWeight, setMinEdgeWeight] = useState(1);
  const [edgeProbabilityMode, setEdgeProbabilityMode] = useState(false);
  const [showNodeLabels, setShowNodeLabels] = useState(true);
  const [netSelection, setNetSelection] = useState<NetworkSelection | null>(null);
  const [netSource, setNetSource] = useState<'phase' | 'ai'>('phase');
  const [aiNetOption, setAiNetOption] = useState<string>('all');

  useEffect(() => { void reload(); }, []);
  async function reload() {
    setLoading(true); setError('');
    try {
      const d = await loadTemporalDataset();
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load research data.');
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    invalidateCache();
    void reload();
  }

  const scoped = useMemo(() => {
    if (!data) return null;
    const approved = new Map(data.assessments.filter((a) => a.status === 'approved' && a.approved_mark !== null).map((a) => [a.session_id, a.approved_mark!]));
    const sessions = data.sessions.filter((s) => {
      if (filters.participantId !== 'all' && s.participant_id !== filters.participantId) return false;
      if (filters.taskId !== 'all' && s.task_id !== filters.taskId) return false;
      if (filters.sessionId !== 'all' && s.id !== filters.sessionId) return false;
      if (filters.from && (s.started_at.slice(0, 10) < filters.from)) return false;
      if (filters.to && (s.started_at.slice(0, 10) > filters.to)) return false;
      const mark = approved.get(s.id);
      if (filters.gradeMin !== '' && (mark === undefined || mark < Number(filters.gradeMin))) return false;
      if (filters.gradeMax !== '' && (mark === undefined || mark > Number(filters.gradeMax))) return false;
      return true;
    });
    const sessionIds = new Set(sessions.map((s) => s.id));
    const events = data.events.filter((e) => sessionIds.has(e.session_id));
    const interactions = data.aiInteractions.filter((i) => {
      if (!sessionIds.has(i.session_id)) return false;
      if (filters.aiOption !== 'all' && i.category !== filters.aiOption) return false;
      return true;
    });
    const scrutiny = data.scrutiny.filter((s) => sessionIds.has(s.session_id));
    return { sessions, events, interactions, scrutiny, approved };
  }, [data, filters]);

  const dq = useMemo(() => {
    if (!data || !scoped) return null;
    return auditDataQuality(data.events, data.aiInteractions, data.scrutiny, scoped.sessions, data.assessments);
  }, [data, scoped]);

  const computed = useMemo(() => {
    if (!scoped) return null;
    const eventsBySession = new Map<string, EventLog[]>();
    for (const e of scoped.events) {
      if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
      eventsBySession.get(e.session_id)!.push(e);
    }
    const durations = new Map<string, SessionDurations>();
    const intervals = new Map<string, SessionIntervals>();
    const tokensBySession = new Map<string, { tokens: StepToken[]; participantId: string }>();
    for (const s of scoped.sessions) {
      const evs = eventsBySession.get(s.id) ?? [];
      durations.set(s.id, computeSessionDurations(s.id, evs, s.completed_at));
      intervals.set(s.id, computeSessionIntervals(s.id, evs, scoped.interactions.filter((i) => i.session_id === s.id), scoped.scrutiny.filter((sc) => sc.session_id === s.id)));
      tokensBySession.set(s.id, { tokens: buildStepTokens(evs, scoped.interactions.filter((i) => i.session_id === s.id), scoped.scrutiny.filter((sc) => sc.session_id === s.id)), participantId: s.participant_id });
    }
    const transitions = computeFivePhaseTransitions(eventsBySession);
    const rawTransitionMatrix = computeTransitionMatrix(eventsBySession);
    const patterns = discoverSequences(tokensBySession, seqMinLen, seqMaxLen, 2);
    const netData: NetworkDataset = { events: scoped.events, interactions: scoped.interactions, scrutiny: scoped.scrutiny };
    const phaseNet = buildPhaseNetwork(netData);
    const aiNet = buildAiNetwork({ events: scoped.events, interactions: scoped.interactions, scrutiny: scoped.scrutiny, labels: AI_LABELS, optionFilter: aiNetOption === 'all' ? null : aiNetOption });
    return { eventsBySession, durations, intervals, tokensBySession, transitions, rawTransitionMatrix, patterns, phaseNet, aiNet, netData };
  }, [scoped, seqMinLen, seqMaxLen, aiNetOption]);

  if (loading && !data) return <div className="max-w-7xl mx-auto px-4 py-8 text-slate-400 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading research data...</div>;

  const tasks = data?.tasks ?? [];
  const participants = Array.from(new Set((data?.sessions ?? []).map((s) => s.participant_id))).sort();
  const allSessions = data?.sessions ?? [];

  function clickAiOption(option: string) {
    setFilters((f) => ({ ...f, aiOption: f.aiOption === option ? 'all' : option }));
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2"><Clock className="w-6 h-6 text-blue-600" /> Temporal Learning Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">Explore learning pathways, AI assistance choices, phase transitions, and temporal patterns in programming education.</p>
        </div>
        <div className="flex items-center gap-3">
          {dq && <DataQualityPill report={dq} open={dqOpen} onToggle={() => setDqOpen(!dqOpen)} />}
          <span className="text-[11px] text-slate-400 hidden lg:inline">v{ANALYSIS_VERSION}{data ? ` · ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
          <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 p-3">{error}</div>}
      {dqOpen && dq && <DataQualityPanel report={dq} onClose={() => setDqOpen(false)} />}

      {/* Filters — shared across tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-900"><Filter className="w-4 h-4 text-slate-400" /> Filters</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <label className="text-xs text-slate-500">Participant
            <select value={filters.participantId} onChange={(e) => setFilters({ ...filters, participantId: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {participants.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Assignment
            <select value={filters.taskId} onChange={(e) => setFilters({ ...filters, taskId: e.target.value, sessionId: 'all' })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Session
            <select value={filters.sessionId} onChange={(e) => { setFilters({ ...filters, sessionId: e.target.value }); setSelectedSession(e.target.value === 'all' ? null : e.target.value); }} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {allSessions.filter((s) => filters.participantId === 'all' || s.participant_id === filters.participantId).map((s) => <option key={s.id} value={s.id}>{s.participant_id} · {s.id.slice(0, 8)}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">From
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-1.5 py-1.5 text-xs" />
          </label>
          <label className="text-xs text-slate-500">To
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-1.5 py-1.5 text-xs" />
          </label>
          <label className="text-xs text-slate-500">AI option
            <select value={filters.aiOption} onChange={(e) => setFilters({ ...filters, aiOption: e.target.value })} className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="all">All</option>
              {AI_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Grade min
            <input type="number" min={0} max={100} value={filters.gradeMin} onChange={(e) => setFilters({ ...filters, gradeMin: e.target.value })} placeholder="—" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-500">Grade max
            <input type="number" min={0} max={100} value={filters.gradeMax} onChange={(e) => setFilters({ ...filters, gradeMax: e.target.value })} placeholder="—" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex items-center justify-between mt-3">
          <button onClick={() => setFilters(EMPTY_FILTERS)} className="text-xs text-slate-500 hover:text-slate-900 underline">Clear filters</button>
          {scoped && <span className="text-xs text-slate-400">{scoped.sessions.length} sessions · {scoped.events.length} events · {scoped.interactions.length} AI requests in scope</span>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</button>
        ))}
      </div>

      {!scoped || !computed ? null : (
        <>
          {tab === 'overview' && <OverviewTab scoped={scoped} computed={computed} onGoTo={(t) => setTab(t)} rawTransitions={rawTransitions} setRawTransitions={setRawTransitions} excludedEventIds={data?.excludedEventIds ?? []} />}
          {tab === 'pathways' && <PathwaysTab scoped={scoped} computed={computed} tasks={tasks} selectedSession={selectedSession} setSelectedSession={setSelectedSession} page={pathwaysPage} setPage={setPathwaysPage} filters={filters} clickAiOption={clickAiOption} />}
          {tab === 'ai' && <AiBehaviourTab scoped={scoped} computed={computed} showRequestDetails={showRequestDetails} setShowRequestDetails={setShowRequestDetails} showRepeated={showRepeated} setShowRepeated={setShowRepeated} clickAiOption={clickAiOption} activeOption={filters.aiOption} />}
          {tab === 'networks' && <NetworksTab scoped={scoped} computed={computed} netSource={netSource} setNetSource={setNetSource} minEdgeWeight={minEdgeWeight} setMinEdgeWeight={setMinEdgeWeight} edgeProbabilityMode={edgeProbabilityMode} setEdgeProbabilityMode={setEdgeProbabilityMode} showNodeLabels={showNodeLabels} setShowNodeLabels={setShowNodeLabels} aiNetOption={aiNetOption} setAiNetOption={setAiNetOption} netSelection={netSelection} setNetSelection={setNetSelection} />}        </>
      )}
    </div>
  );
}

/* ================= Overview ================= */

function OverviewTab({ scoped, computed, onGoTo, rawTransitions, setRawTransitions, excludedEventIds }: { scoped: Scoped; computed: Computed; onGoTo: (t: TabKey) => void; rawTransitions: boolean; setRawTransitions: (v: boolean) => void; excludedEventIds: string[] }) {
  const completed = scoped.sessions.filter((s) => s.status === 'completed').length;
  const participantCount = new Set(scoped.sessions.map((s) => s.participant_id)).size;
  const activityCounts = new Map<string, number>();
  for (const e of scoped.events) {
    const u = classifyEvent(e);
    if (u) activityCounts.set(u, (activityCounts.get(u) ?? 0) + 1);
  }
  activityCounts.set('AI_REQ', (activityCounts.get('AI_REQ') ?? 0) + scoped.interactions.length);
  activityCounts.set('SCRUTINY', (activityCounts.get('SCRUTINY') ?? 0) + scoped.scrutiny.filter((s) => !scoped.events.some((e) => classifyEvent(e) === 'SCRUTINY' && e.session_id === s.session_id && e.timestamp === s.created_at)).length);
  const activityData = Array.from(activityCounts.entries()).map(([k, n]) => ({ name: STEP_LABELS[k as StepToken] ?? k, count: n, color: STEP_COLORS[k as StepToken] ?? '#64748B' })).filter((d) => d.count > 0).sort((a, b) => b.count - a.count);
  const activeMatrix = rawTransitions ? computed.rawTransitionMatrix : computed.transitions;
  const topTransitions = activeMatrix.phases.flatMap((a, i) => activeMatrix.phases.map((b, j) => ({ label: `${PHASE_DISPLAY[a] ?? a} → ${PHASE_DISPLAY[b] ?? b}`, count: activeMatrix.counts[i][j], color: PHASE_COLORS[a] ?? '#64748B' })))
    .filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Participants" value={String(participantCount)} />
        <MetricCard label="Sessions" value={String(scoped.sessions.length)} />
        <MetricCard label="Completed" value={String(completed)} />
        <MetricCard label="Recorded events" value={String(scoped.events.length)} />
        <MetricCard label="AI requests" value={String(scoped.interactions.length)} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Recorded learning activities" subtitle="Counts of each activity type across all events in scope.">
          {activityData.length === 0 ? <EmptyState>No recorded activities in scope.</EmptyState> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: '#334155' }} />
                  <ReTooltip wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
        <Section
          title="Most frequent phase transitions"
          subtitle={rawTransitions
            ? 'Historical raw view: original event labels including archived Edit and Completed, reconstructed from the same timestamped events.'
            : 'Five-phase PAUSE framework: historical Edit folded into Scrutinise, consecutive identical phases collapsed, completion tracked as session status. Reconstructed from timestamped events.'}
          actions={
            <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
              <input type="checkbox" checked={rawTransitions} onChange={(e) => setRawTransitions(e.target.checked)} className="rounded" />
              Historical raw transitions
            </label>
          }
        >
          {topTransitions.length === 0 ? <EmptyState>No phase transitions recorded in scope.</EmptyState> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topTransitions} layout="vertical" margin={{ left: 10, right: 20, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" width={190} tick={{ fontSize: 11, fill: '#334155' }} />
                  <ReTooltip wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
                    {topTransitions.map((t, i) => <Bar key={i} dataKey="count" fill={t.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
      </div>
      {!rawTransitions && computed.rawTransitionMatrix.counts.some((row) => row.some((c) => c > 0)) && (
        <p className="text-[11px] text-slate-400 -mt-2">Historical archived Edit events ({computed.rawTransitionMatrix.phases.includes('edit') ? 'present' : 'none'}) remain visible in raw exports and the historical raw view; they are folded into Scrutinise in this five-phase summary.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => onGoTo('pathways')} className="text-sm text-blue-600 hover:text-blue-800 underline">Explore learning pathways →</button>
        <button onClick={() => onGoTo('networks')} className="text-sm text-blue-600 hover:text-blue-800 underline">Open network visualisations →</button>
      </div>
      <Section title="Frequent learning sequences" subtitle="Descriptive n-gram counts over session pathways. No statistical significance is asserted.">
        {computed.patterns.length === 0 ? <EmptyState>No sequences reach the minimum frequency with the current filters.</EmptyState> : (
          <table className="text-xs w-full max-w-3xl">
            <thead className="text-slate-500"><tr><Th>Sequence</Th><Th right>Count</Th><Th right>Students</Th><Th right>Sessions</Th></tr></thead>
            <tbody>
              {computed.patterns.slice(0, 10).map((p) => (
                <tr key={p.sequence}><td className="py-1.5 px-2 text-slate-700">{p.sequence}</td><td className="py-1.5 px-2 text-right font-mono">{p.count}</td><td className="py-1.5 px-2 text-right font-mono">{p.participants}</td><td className="py-1.5 px-2 text-right font-mono">{p.sessions}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section title="Research data exports" subtitle={`CSV exports matching the current filters. Analysis version ${ANALYSIS_VERSION}; exported ${new Date().toISOString().slice(0, 10)}.`}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ExportCard label="Raw event records" desc="Timestamped events with stable ids, participant, task, session, phase and type" onClick={() => exportAsCSV(scoped.events.map(toRawEventRow), 'temporal_raw_events')} />
          <ExportCard label="Learning sequences" desc="Ordered phase steps per session with event counts and spans (raw labels, incl. archived Edit)" onClick={() => exportAsCSV(exportSequences(scoped, computed.eventsBySession), 'temporal_learning_sequences')} />
          <ExportCard label="AI option selections" desc="Every AI request with option id, label, timestamps and scrutiny linkage" onClick={() => exportAsCSV(exportAiSelections(scoped), 'temporal_ai_option_selections')} />
          <ExportCard label="Phase transition frequencies (five-phase)" desc="from → to counts and row probabilities in the derived five-phase view (Edit folded into Scrutinise, completion excluded)" onClick={() => { const t = computed.transitions; exportAsCSV(t.phases.flatMap((a, i) => t.phases.map((b, j) => ({ from_phase: a, to_phase: b, count: t.counts[i][j], row_probability: t.probabilities[i][j].toFixed(4) }))).filter((r: { count: number }) => r.count > 0), 'temporal_phase_transitions'); }} />
          <ExportCard label="Phase transitions (historical raw)" desc="Original event labels including archived Edit and Completed — for research inspection of six-phase history" onClick={() => { const t = computed.rawTransitionMatrix; exportAsCSV(t.phases.flatMap((a, i) => t.phases.map((b, j) => ({ from_phase: a, to_phase: b, count: t.counts[i][j], row_probability: t.probabilities[i][j].toFixed(4) }))).filter((r: { count: number }) => r.count > 0), 'temporal_phase_transitions_raw'); }} />
          <ExportCard label="Excluded duplicate events (audit)" desc="Every event id excluded from the derived analytical dataset, with the applied rule version" onClick={() => { exportAsCSV(excludedEventIds.map((id) => ({ event_id: id, rule: 'identical payload within 5s or same type+description within 2s', analysis_version: ANALYSIS_VERSION })), 'temporal_excluded_events'); }} />
          <ExportCard label="Temporal duration metrics" desc="Observed vs estimated active time per session and phase" onClick={() => exportAsCSV(exportDurations(scoped.sessions, computed.durations), 'temporal_durations')} />
          <ExportCard label="Frequent sequence counts" desc="Discovered n-grams with frequency controls applied" onClick={() => exportAsCSV(computed.patterns.map((p) => ({ sequence: p.sequence, length: p.length, count: p.count, participants: p.participants, sessions: p.sessions })), 'temporal_sequence_patterns')} />
          <ExportCard label="Participant temporal summaries" desc="Per participant: sessions, AI requests, scrutiny cycles, observed and active time" onClick={() => exportAsCSV(exportParticipantSummaries(scoped, computed), 'temporal_participant_summaries')} />
          <ExportCard label="Grades linked to temporal metrics" desc="Approved marks joined with temporal intervals per session" onClick={() => exportAsCSV(exportGradesLinked(scoped, computed), 'temporal_grades_linked')} />
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Data dictionary — event rows: id, participant_id, task_id, session_id, timestamp, pause_phase (raw label, incl. historical 'edit'), event_type, description; sequence rows: session_id, participant_id, step_index, phase, step_start, step_end, event_count; AI rows: interaction id, category (option id), option_label, prompt, created_at, scrutinised, seconds_to_scrutiny; duration rows: session_id, phase, observed_ms, active_ms (gaps &gt; {GAP_CAP_MINUTES} min capped at {GAP_CAP_MINUTES} min — documented analytical assumption); participant rows: participant_id, session_count, ai_requests, scrutiny_cycles, observed_ms, active_ms; grade rows: session_id, participant_id, approved_mark, band, ai_request_count, scrutiny_cycles, minutes_to_first_ai. Duplicate suppression (≤ 2 s, same type + description) applies to analysis only; raw exports keep every stored record. Historical compatibility: the archived 'edit' phase is kept as a separate label in all outputs, never merged into 'scrutinise'.</p>
      </Section>
    </div>
  );
}

/* ================= Learning Pathways ================= */

function PathwaysTab({ scoped, computed, tasks, selectedSession, setSelectedSession, page, setPage, filters, clickAiOption }: {
  scoped: Scoped; computed: Computed; tasks: { id: string; title: string }[];
  selectedSession: string | null; setSelectedSession: (id: string | null) => void;
  page: number; setPage: (p: number) => void; filters: Filters; clickAiOption: (o: string) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(scoped.sessions.length / PATHWAYS_PAGE_SIZE));
  const pageSessions = scoped.sessions.slice(page * PATHWAYS_PAGE_SIZE, (page + 1) * PATHWAYS_PAGE_SIZE);

  return (
    <Section title="Learning Pathways" subtitle="One compact row per session. Repeated consecutive phase visits collapse into a single badge with a repeat count; legitimate revisits remain visible. Archived Edit events appear inside their historical context. Click Expand Details for full event-level data.">
      <div className="flex flex-wrap gap-3 mb-3">
        {['plan', 'attempt', 'use_ai', 'scrutinise', 'evaluate', 'edit'].map((p) => (
          <span key={p} className="flex items-center gap-1.5 text-xs text-slate-600"><span className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS[p] }} />{PHASE_DISPLAY[p]}</span>
        ))}
      </div>
      {scoped.sessions.length === 0 ? <EmptyState>No sessions match the current filters.</EmptyState> : (
        <div className="space-y-1.5">
          {pageSessions.map((s) => {
            const steps = buildPhaseSequence(computed.eventsBySession.get(s.id) ?? [], s.completed_at);
            const aiOpts = Array.from(new Set(scoped.interactions.filter((i) => i.session_id === s.id).map((i) => i.category)));
            const expanded = selectedSession === s.id;
            return (
              <div key={s.id} className="border border-slate-200 rounded-lg">
                <button onClick={() => setSelectedSession(expanded ? null : s.id)} className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${expanded ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-mono font-medium text-slate-800 w-20 shrink-0">{s.participant_id}</span>
                    <span className="text-slate-500 max-w-52 truncate">{tasks.find((t) => t.id === s.task_id)?.title ?? 'Task'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : s.status === 'in_progress' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{s.status.replace('_', ' ')}</span>
                    <span className="text-slate-300">|</span>
                    <span className="flex flex-wrap items-center gap-1">
                      {steps.length === 0 ? <span className="text-slate-400">No phase events</span> : steps.map((st, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="text-slate-300 mr-0.5">→</span>}
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: PHASE_COLORS[st.phase] }}>
                            {PHASE_DISPLAY[st.phase]}{st.eventCount > 1 ? ` ×${st.eventCount}` : ''}
                          </span>
                        </span>
                      ))}
                    </span>
                    <span className="ml-auto flex items-center gap-1 text-slate-400 shrink-0">
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      <span className="text-[11px]">{expanded ? 'Hide details' : 'Expand details'}</span>
                    </span>
                  </div>
                </button>
                {expanded && (
                  <SessionDetail
                    session={s}
                    events={computed.eventsBySession.get(s.id) ?? []}
                    interactions={scoped.interactions}
                    scrutiny={scoped.scrutiny}
                    durations={computed.durations.get(s.id) ?? null}
                    intervals={computed.intervals.get(s.id) ?? null}
                    aiLabels={AI_LABELS}
                    clickAiOption={clickAiOption}
                    activeAiOption={filters.aiOption}
                  />
                )}
                {aiOpts.length > 0 && !expanded && (
                  <div className="px-3 pb-2 -mt-0.5 flex flex-wrap gap-1">
                    {aiOpts.map((o) => (
                      <button key={o} onClick={() => clickAiOption(o)} className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${filters.aiOption === o ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}>{AI_LABELS[o] ?? o}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {pageCount > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
          <span>Showing {page * PATHWAYS_PAGE_SIZE + 1}–{Math.min((page + 1) * PATHWAYS_PAGE_SIZE, scoped.sessions.length)} of {scoped.sessions.length} sessions</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-40">Prev</button>
            <span>Page {page + 1} / {pageCount}</span>
            <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} className="border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ================= AI Behaviour ================= */

function AiBehaviourTab({ scoped, computed, showRequestDetails, setShowRequestDetails, showRepeated, setShowRepeated, clickAiOption, activeOption }: {
  scoped: Scoped; computed: Computed;
  showRequestDetails: boolean; setShowRequestDetails: (v: boolean) => void;
  showRepeated: boolean; setShowRepeated: (v: boolean) => void;
  clickAiOption: (o: string) => void; activeOption: string;
}) {
  const freq = aiOptionFrequency(scoped.interactions, AI_LABELS);
  const sessionsWithAi = new Set(scoped.interactions.map((i) => i.session_id)).size;
  const ivs = scoped.sessions.map((s) => computed.intervals.get(s.id)).filter(Boolean) as SessionIntervals[];
  const allScGaps = ivs.flatMap((i) => i.scrutinyAfterRequestMs);
  const median = (arr: number[]) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const chartData = freq.map((r) => ({ name: r.label, requests: r.requests, id: r.category }));
  const activeFreq = activeOption !== 'all' ? freq.find((f) => f.category === activeOption) : null;

  return (
    <div className="space-y-4">
      <Section title="AI Assistance Behaviour" subtitle="Exactly which AI assistance option each student selected, and what happened next. Click a bar to filter requests and pathways to that option." actions={
        <div className="flex gap-2">
          <button onClick={() => { setShowRequestDetails(!showRequestDetails); if (!showRequestDetails) setShowRepeated(false); }} className={`text-xs border rounded-lg px-3 py-1.5 transition-colors ${showRequestDetails ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>View Request Details</button>
          <button onClick={() => { setShowRepeated(!showRepeated); if (!showRepeated) setShowRequestDetails(false); }} className={`text-xs border rounded-lg px-3 py-1.5 transition-colors ${showRepeated ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>Repeated AI Assistance</button>
        </div>
      }>
        {scoped.interactions.length === 0 ? <EmptyState>No AI requests in scope. Sessions without AI assistance are a valid outcome — that is an observation, not missing data.</EmptyState> : (
          <>
            {activeFreq && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center justify-between">
                <span>Filtered to <strong>{activeFreq.label}</strong> — {activeFreq.requests} requests by {activeFreq.students} student(s), {activeFreq.pctOfRequests.toFixed(1)}% of all requests.</span>
                <button onClick={() => clickAiOption(activeOption)} className="underline hover:text-amber-900">clear</button>
              </div>
            )}
            <div className="grid lg:grid-cols-2 gap-5">
              <div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ left: 0, right: 10, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} interval={0} angle={-18} textAnchor="end" height={54} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <ReTooltip wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="requests" cursor="pointer" onClick={(d: { payload?: { id?: string } }) => d?.payload?.id && clickAiOption(d.payload.id)} radius={[4, 4, 0, 0]} barSize={34}>
                        {chartData.map((d, i) => <Bar key={i} dataKey="requests" fill={activeOption === d.id ? '#d97706' : '#F59E0B'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 content-start">
                <MetricCard label="Total AI requests" value={String(scoped.interactions.length)} />
                <MetricCard label="Sessions using AI" value={`${sessionsWithAi} / ${scoped.sessions.length}`} />
                <MetricCard label="Most used option" value={freq[0]?.label ?? '—'} />
                <MetricCard label="Median request → scrutiny" value={fmtDuration(median(allScGaps))} />
              </div>
            </div>
            {showRequestDetails && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Request details</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="text-xs w-full">
                    <thead className="text-slate-500 sticky top-0 bg-white"><tr><Th>Student</Th><Th>Option</Th><Th>Requested</Th><Th>Prompt</Th><Th>Scrutinised</Th><Th right>Request → scrutiny</Th><Th right>Scrutiny → code</Th></tr></thead>
                    <tbody>
                      {scoped.interactions.slice(0, 100).map((i) => {
                        const sc = scoped.scrutiny.filter((s) => s.ai_interaction_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
                        const sessionEvents = (computed.eventsBySession.get(i.session_id) ?? []).filter((e) => new Date(e.timestamp).getTime() >= new Date(i.created_at).getTime() && (e.event_type === 'CODE_RUN' || e.event_type === 'CODE_REVISED'));
                        const nextCode = sessionEvents[0]?.timestamp ?? null;
                        const gap1 = sc ? new Date(sc.created_at).getTime() - new Date(i.created_at).getTime() : null;
                        const gap2 = sc && nextCode ? new Date(nextCode).getTime() - new Date(sc.created_at).getTime() : null;
                        const neg = (gap1 !== null && gap1 < 0) || (gap2 !== null && gap2 < 0);
                        return (
                          <tr key={i.id} className={neg ? 'bg-amber-50/60' : ''}>
                            <td className="py-1.5 px-2 font-mono">{i.participant_id}</td>
                            <td className="py-1.5 px-2 whitespace-nowrap"><button onClick={() => clickAiOption(i.category)} className={`hover:underline ${activeOption === i.category ? 'text-amber-700 font-medium' : 'text-slate-700'}`}>{AI_LABELS[i.category] ?? i.category}</button></td>
                            <td className="py-1.5 px-2 whitespace-nowrap text-slate-500">{new Date(i.created_at).toLocaleString()}</td>
                            <td className="py-1.5 px-2 max-w-52 truncate text-slate-500" title={i.prompt}>{i.prompt.slice(0, 80) || '—'}</td>
                            <td className="py-1.5 px-2">{sc ? <span className="text-emerald-600">yes</span> : <span className="text-slate-300">no</span>}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{gap1 !== null && gap1 < 0 ? <span className="text-amber-600" title="Scrutiny timestamp precedes the request — see Data Quality.">⚠ {fmtDuration(Math.abs(gap1))}</span> : fmtDuration(gap1)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{gap2 !== null && gap2 < 0 ? <span className="text-amber-600" title="Code run precedes scrutiny — see Data Quality.">⚠ {fmtDuration(Math.abs(gap2))}</span> : fmtDuration(gap2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {scoped.interactions.length > 100 && <p className="text-xs text-slate-400 mt-2">Showing the first 100 requests — export for the full set.</p>}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">Rows marked ⚠ have chronologically inconsistent timestamps; the raw records are preserved and listed under Data Quality.</p>
              </div>
            )}
            {showRepeated && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Repeated AI assistance</h3>
                <table className="text-xs w-full max-w-3xl">
                  <thead className="text-slate-500"><tr><Th>Student</Th><Th right>Requests</Th><Th right>Distinct options</Th><Th>Repeated option</Th><Th right>Scrutiny cycles</Th></tr></thead>
                  <tbody>
                    {repeatedAiPerSession(scoped.interactions, scoped.scrutiny, AI_LABELS).slice(0, 20).map((r) => (
                      <tr key={r.sessionId}><td className="py-1.5 px-2 font-mono">{r.participantId}</td><td className="py-1.5 px-2 text-right font-mono">{r.totalRequests}</td><td className="py-1.5 px-2 text-right font-mono">{r.optionsUsed}</td><td className="py-1.5 px-2">{r.repeatedOption ? `${r.repeatedOption} ×${r.repeatedOptionCount}` : '—'}</td><td className="py-1.5 px-2 text-right font-mono">{r.scrutinyCycles}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/* ================= Networks ================= */

function NetworksTab({ scoped, computed, netSource, setNetSource, minEdgeWeight, setMinEdgeWeight, edgeProbabilityMode, setEdgeProbabilityMode, showNodeLabels, setShowNodeLabels, aiNetOption, setAiNetOption, netSelection, setNetSelection }: {
  scoped: Scoped; computed: Computed;
  netSource: 'phase' | 'ai'; setNetSource: (v: 'phase' | 'ai') => void;
  minEdgeWeight: number; setMinEdgeWeight: (v: number) => void;
  edgeProbabilityMode: boolean; setEdgeProbabilityMode: (v: boolean) => void;
  showNodeLabels: boolean; setShowNodeLabels: (v: boolean) => void;
  aiNetOption: string; setAiNetOption: (v: string) => void;
  netSelection: NetworkSelection | null; setNetSelection: (s: NetworkSelection | null) => void;
}) {
  const net: NetworkGraph = netSource === 'phase' ? computed.phaseNet : computed.aiNet;
  const emptyMsg = netSource === 'ai' && scoped.interactions.length === 0
    ? 'No AI requests in scope — the AI pathway network is empty by observation, not by error.'
    : net.nodes.length === 0 ? 'No recorded activity in scope for this network.' : null;

  return (
    <Section title="Network Visualisations" subtitle="Force-directed maps of observed activity. Every node is a recorded event category; every arrow an observed chronological transition between consecutive events. Proximity is a layout artefact, not evidence of effectiveness.">
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          {([['phase', 'Phase Network'], ['ai', 'AI Pathway Network']] as const).map(([key, lbl]) => (
            <button key={key} onClick={() => { setNetSource(key); setNetSelection(null); }} className={`px-3 py-1.5 font-medium transition-colors ${netSource === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{lbl}</button>
          ))}
        </div>
        <label className="text-xs text-slate-500">Min edge frequency
          <input type="number" min={1} max={50} value={minEdgeWeight} onChange={(e) => setMinEdgeWeight(Math.max(1, Number(e.target.value)))} className="ml-2 w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={edgeProbabilityMode} onChange={(e) => setEdgeProbabilityMode(e.target.checked)} className="rounded" />
          Counts ↔ probabilities
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={showNodeLabels} onChange={(e) => setShowNodeLabels(e.target.checked)} className="rounded" />
          Node labels
        </label>
        {netSource === 'ai' && (
          <label className="text-xs text-slate-500">AI option
            <select value={aiNetOption} onChange={(e) => { setAiNetOption(e.target.value); setNetSelection(null); }} className="ml-2 border border-slate-300 rounded-lg px-2 py-1 text-sm">
              <option value="all">All options</option>
              {AI_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="relative">
        {emptyMsg ? <EmptyState>{emptyMsg}</EmptyState> : (
          <NetworkGraphView
            graph={net}
            selection={netSelection}
            onSelect={setNetSelection}
            minEdgeWeight={minEdgeWeight}
            probabilityMode={edgeProbabilityMode}
            showLabels={showNodeLabels}
            filename={`temporal_${netSource}_network`}
          />
        )}
        {/* Collapsible inspector drawer */}
        {netSelection && !emptyMsg && (
          <div className="absolute top-0 right-0 h-full w-80 max-w-[90%] bg-white border-l border-slate-200 shadow-xl rounded-r-lg overflow-y-auto z-20">
            <div className="sticky top-0 bg-white border-b border-slate-100 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Inspector</span>
              <button onClick={() => setNetSelection(null)} className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"><X className="w-3.5 h-3.5" /></button>
            </div>
            <div className="p-3">
              <NetworkInspector net={net} selection={netSelection} scoped={scoped} computed={computed} netSource={netSource} onClose={() => setNetSelection(null)} />
            </div>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Legend — Phase Network: the five PAUSE phases (Plan blue, Attempt green, Use AI orange, Scrutinise purple, Evaluate red). AI Pathway Network: orange option nodes carry the exact AI option labels stored in the database. Click a node or edge to open the inspector drawer.</p>
    </Section>
  );
}

/* ================= Data Quality ================= */

/* ================= Data Quality ================= */

function DataQualityPill({ report, open, onToggle }: { report: DataQualityReport; open: boolean; onToggle: () => void }) {
  const issueCount = report.duplicateCandidates + report.missingTimestamps + report.negativeIntervals.length + report.sessionsWithLongGaps.length + report.incompleteSessions + report.missingAiOptionIds;
  const ok = issueCount === 0;
  return (
    <button onClick={onToggle} className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-2 transition-colors ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
      Data quality {ok ? 'OK' : `· ${issueCount} notice${issueCount === 1 ? '' : 's'}`}
      {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
    </button>
  );
}

function DataQualityPanel({ report, onClose }: { report: DataQualityReport; onClose: () => void }) {
  const item = (label: string, count: number, detail?: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div>
        <div className="text-sm text-slate-700">{label}</div>
        {detail && <div className="text-[11px] text-slate-400 mt-0.5">{detail}</div>}
      </div>
      <span className={`font-mono text-sm shrink-0 ${count > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{count}</span>
    </div>
  );
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-bold text-navy-900">Data Quality</h2>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded hover:bg-slate-100"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-xs text-slate-500 mb-3">Descriptive audit of the records behind every figure on this page. Raw records are always preserved; analysis-time duplicate suppression never modifies stored data.</p>
      {item('Duplicate event candidates', report.duplicateCandidates, 'Same session, event type and description within 2 seconds — treated as one in analysis; verify no legitimate rapid events were suppressed.')}
      {item('Missing timestamps', report.missingTimestamps, 'Events without a parseable timestamp are excluded from all durations and sequences.')}
      {item('Negative or inconsistent intervals', report.negativeIntervals.length, report.negativeIntervals.length > 0 ? `e.g. ${report.negativeIntervals[0].kind} (${report.negativeIntervals[0].participantId}, ${new Date(report.negativeIntervals[0].fromTs).toLocaleString()})` : 'Scrutiny recorded before its linked AI request, or code activity preceding the scrutiny it should follow.')}
      {item('Sessions with long inactivity gaps', report.sessionsWithLongGaps.length, `Gaps over ${Math.round(LONG_GAP_MS / 60000)} minutes between consecutive events. Wall-clock time includes these; estimated active time does not.`)}
      {item('Incomplete sessions', report.incompleteSessions, 'Sessions not marked completed — durations cover only the observed event span.')}
      {item('Missing AI option IDs', report.missingAiOptionIds, 'AI requests without a stored option category.')}
      {item('Sessions missing approved grades', report.sessionsMissingApprovedGrades, `Of ${report.totalSessions} sessions. Ungraded work is excluded from performance comparisons, never counted as zero.`)}
      <p className="text-[11px] text-slate-400 mt-3">Analytical assumptions: inactivity cap {GAP_CAP_MINUTES} min per silent gap for estimated active time; long-gap threshold {Math.round(LONG_GAP_MS / 60000)} min; duplicate suppression window 2 s. All three are configurable in the temporal analysis code and are applied identically across every view.</p>
    </div>
  );
}

/* ================= Shared pieces ================= */

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
      <div className="text-lg font-bold text-navy-900 mt-0.5">{value}</div>
    </div>
  );
}

function SessionDetail({ session, events, interactions, scrutiny, durations, intervals, aiLabels, clickAiOption, activeAiOption }: {
  session: Session; events: EventLog[]; interactions: AIInteraction[]; scrutiny: ScrutinyResponse[];
  durations: SessionDurations | null; intervals: SessionIntervals | null;
  aiLabels: Record<string, string>; clickAiOption: (o: string) => void; activeAiOption: string;
}) {
  const ordered = events.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const sessInts = interactions.filter((i) => i.session_id === session.id);
  return (
    <div className="border-t border-slate-100 bg-slate-50/50 rounded-b-lg p-4">
      <div className="grid sm:grid-cols-4 gap-2 text-xs mb-3">
        <MetricCard label="Events" value={String(ordered.length)} />
        <MetricCard label="AI requests" value={String(sessInts.length)} />
        <MetricCard label="Observed" value={fmtDuration(durations?.observedMs ?? null)} />
        <MetricCard label="Est. active" value={fmtDuration(durations?.activeMs ?? null)} />
      </div>
      {durations?.interrupted && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
          Interrupted session: largest inactivity gap {fmtDuration(durations.maxGapMs)} — the observed span includes this idle time and is not continuous engagement.
        </p>
      )}
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {ordered.map((e) => (
          <div key={e.id} className="flex items-start gap-2 text-xs border-b border-slate-100 pb-1">
            <span className="font-mono text-slate-400 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white shrink-0" style={{ backgroundColor: PHASE_COLORS[e.pause_phase] ?? '#64748B' }}>{PHASE_DISPLAY[e.pause_phase] ?? e.pause_phase}</span>
            <span className="font-mono text-slate-600 shrink-0">{e.event_type}</span>
            <span className="text-slate-500 truncate" title={e.event_description}>{e.event_description}{e.ai_interaction_id ? ' · AI-linked' : ''}{e.code_snapshot_id ? ' · snapshot' : ''}</span>
          </div>
        ))}
        {ordered.length === 0 && <p className="text-xs text-slate-400">No events recorded for this session.</p>}
      </div>
      {sessInts.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-medium text-slate-500 mb-1">AI requests in this session</div>
          <div className="flex flex-wrap gap-1.5">
            {sessInts.map((i) => (
              <button key={i.id} onClick={() => clickAiOption(i.category)} className={`text-[10px] px-2 py-1 rounded border font-mono transition-colors ${activeAiOption === i.category ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-amber-50'}`} title={i.prompt}>
                {new Date(i.created_at).toLocaleTimeString()} · {aiLabels[i.category] ?? i.category}
              </button>
            ))}
          </div>
        </div>
      )}
      {intervals && intervals.aiRequestGapsMs.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">Gaps between AI requests: {intervals.aiRequestGapsMs.map((g) => fmtDuration(g)).join(', ')} · {scrutiny.filter((s) => s.session_id === session.id).length} scrutiny cycle(s).</p>
      )}
    </div>
  );
}

function ExportCard({ label, desc, onClick }: { label: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left border border-slate-200 rounded-lg p-3.5 hover:border-blue-300 transition-colors">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-900"><Download className="w-3.5 h-3.5 text-slate-400" /> {label}</div>
      <div className="text-xs text-slate-500 mt-1 leading-5">{desc}</div>
    </button>
  );
}

/* ---------------- CSV row builders ---------------- */

function toRawEventRow(e: EventLog) {
  return {
    event_id: e.id, participant_id: e.participant_id, task_id: e.task_id, session_id: e.session_id,
    timestamp: e.timestamp, pause_phase: e.pause_phase, event_type: e.event_type,
    event_description: e.event_description, code_snapshot_id: e.code_snapshot_id, ai_interaction_id: e.ai_interaction_id,
  };
}

function exportSequences(scoped: Scoped, eventsBySession: Map<string, EventLog[]>) {
  const rows: Record<string, unknown>[] = [];
  for (const s of scoped.sessions) {
    buildPhaseSequence(eventsBySession.get(s.id) ?? [], s.completed_at).forEach((st, idx) => {
      rows.push({ session_id: s.id, participant_id: s.participant_id, task_id: s.task_id, step_index: idx + 1, phase: st.phase, step_start: st.fromTs, step_end: st.toTs, event_count: st.eventCount });
    });
  }
  return rows;
}

function exportAiSelections(scoped: Scoped) {
  return scoped.interactions.map((i) => {
    const sc = scoped.scrutiny.filter((s) => s.ai_interaction_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
    return {
      interaction_id: i.id, session_id: i.session_id, participant_id: i.participant_id,
      option_id: i.category, option_label: AI_LABELS[i.category] ?? i.category,
      requested_at: i.created_at, prompt: i.prompt, full_solution_requested: i.full_solution_requested,
      scrutinised: sc ? 'yes' : 'no', scrutiny_at: sc?.created_at ?? '',
      seconds_to_scrutiny: sc ? Math.round((new Date(sc.created_at).getTime() - new Date(i.created_at).getTime()) / 1000) : '',
    };
  });
}

function exportDurations(sessions: Session[], durations: Map<string, SessionDurations>) {
  const rows: Record<string, unknown>[] = [];
  for (const s of sessions) {
    const d = durations.get(s.id);
    if (!d) continue;
    rows.push({
      session_id: s.id, participant_id: s.participant_id, phase: 'TOTAL',
      observed_ms: d.observedMs ?? '', active_ms: d.activeMs,
      max_inactivity_gap_ms: d.maxGapMs ?? '', interrupted: d.interrupted,
      note: d.interrupted ? 'observed span includes inactivity gap(s) exceeding the 5 min cap — not continuous engagement' : '',
    });
    for (const [phase, v] of Object.entries(d.perPhase)) rows.push({ session_id: s.id, participant_id: s.participant_id, phase, observed_ms: v.observedMs, active_ms: v.activeMs });
  }
  return rows;
}

function exportParticipantSummaries(scoped: Scoped, computed: Computed) {
  const byP = new Map<string, Record<string, number | string>>();
  for (const s of scoped.sessions) {
    const p = s.participant_id;
    if (!byP.has(p)) byP.set(p, { participant_id: p, session_count: 0, ai_requests: 0, scrutiny_cycles: 0, observed_ms: 0, active_ms: 0 });
    const row = byP.get(p)!;
    row.session_count = (row.session_count as number) + 1;
    row.ai_requests = (row.ai_requests as number) + scoped.interactions.filter((i) => i.session_id === s.id).length;
    row.scrutiny_cycles = (row.scrutiny_cycles as number) + scoped.scrutiny.filter((sc) => sc.session_id === s.id).length;
    const d = computed.durations.get(s.id);
    if (d) { row.observed_ms = (row.observed_ms as number) + (d.observedMs ?? 0); row.active_ms = (row.active_ms as number) + d.activeMs; }
  }
  return Array.from(byP.values());
}

function exportGradesLinked(scoped: Scoped, computed: Computed) {
  return scoped.sessions.map((s) => {
    const iv = computed.intervals.get(s.id);
    const d = computed.durations.get(s.id);
    const mark = scoped.approved.get(s.id);
    return {
      session_id: s.id, participant_id: s.participant_id, task_id: s.task_id,
      approved_mark: mark ?? '', grade_band: mark !== undefined ? gradeBandFor(mark) : '',
      ai_request_count: iv?.aiRequestCount ?? 0, scrutiny_cycles: iv?.scrutinyCycles ?? 0,
      minutes_first_code_to_first_ai: iv?.firstCodeToFirstAiMs != null ? (iv.firstCodeToFirstAiMs / 60000).toFixed(2) : '',
      observed_minutes: d?.observedMs != null ? (d.observedMs / 60000).toFixed(2) : '',
      active_minutes: d ? (d.activeMs / 60000).toFixed(2) : '',
    };
  });
}

function gradeBandFor(mark: number): string {
  if (mark < 50) return '0–49';
  if (mark < 70) return '50–69';
  if (mark < 85) return '70–84';
  return '85–100';
}

interface Scoped { sessions: Session[]; events: EventLog[]; interactions: AIInteraction[]; scrutiny: ScrutinyResponse[]; approved: Map<string, number> }
interface Computed {
  durations: Map<string, SessionDurations>;
  intervals: Map<string, SessionIntervals>;
  eventsBySession: Map<string, EventLog[]>;
  tokensBySession: Map<string, { tokens: StepToken[]; participantId: string }>;
  transitions: ReturnType<typeof computeFivePhaseTransitions>;
  rawTransitionMatrix: ReturnType<typeof computeTransitionMatrix>;
  patterns: ReturnType<typeof discoverSequences>;
  phaseNet: NetworkGraph;
  aiNet: NetworkGraph;
  netData: NetworkDataset;
}

function NetworkInspector({ net, selection, scoped, computed, netSource, onClose }: {
  net: NetworkGraph;
  selection: NetworkSelection | null;
  scoped: Scoped;
  computed: Computed;
  netSource: 'phase' | 'ai';
  onClose: () => void;
}) {
  const node = selection?.type === 'node' ? net.nodes.find((n) => n.id === selection.id) ?? null : null;
  const edge = selection?.type === 'edge' ? net.edges.find((e) => e.id === selection.id) ?? null : null;

  const labelFor = (id: string) => net.nodes.find((n) => n.id === id)?.label ?? id;
  const resolveUnit = (e: EventLog): string | null => {
    if (netSource === 'phase') return e.pause_phase ?? null;
    return null;
  };

  function exportEdgeCsv() {
    if (!edge) return;
    let rows: Record<string, unknown>[];
    if (netSource === 'ai') {
      const bySession = new Map<string, { unit: string; ts: string; participantId: string }[]>();
      for (const i of scoped.interactions) {
        if (!bySession.has(i.session_id)) bySession.set(i.session_id, []);
        bySession.get(i.session_id)!.push({ unit: `AI:${i.category}`, ts: i.created_at, participantId: i.participant_id });
        const sc = scoped.scrutiny.filter((s) => s.ai_interaction_id === i.id);
        for (const s of sc) bySession.get(i.session_id)!.push({ unit: 'SCRUTINY', ts: s.created_at, participantId: i.participant_id });
      }
      for (const e of scoped.events) {
        const u = classifyEvent(e);
        if (!u) continue;
        if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
        bySession.get(e.session_id)!.push({ unit: u, ts: e.timestamp, participantId: e.participant_id });
      }
      rows = [];
      for (const [sessionId, list] of bySession) {
        list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        let prev: { unit: string; ts: string; participantId: string } | null = null;
        for (const st of list) {
          if (st.unit === prev?.unit) continue;
          if (prev && prev.unit === edge.source && st.unit === edge.target) {
            rows.push({ session_id: sessionId, participant_id: st.participantId, from_unit: edge.source, to_unit: edge.target, from_timestamp: prev.ts, to_timestamp: st.ts });
          }
          prev = st;
        }
      }
    } else {
      rows = supportingTransitions(computed.netData, edge.source, edge.target, resolveUnit)
        .map((r) => ({ session_id: r.sessionId, participant_id: r.participantId, from_unit: edge.source, to_unit: edge.target, from_timestamp: r.fromTs, to_timestamp: r.toTs }));
    }
    exportAsCSV(rows, `temporal_network_edge_${edge.source}_${edge.target}`.replace(/[^a-zA-Z0-9_.]/g, '-'));
  }

  const supporting = edge
    ? (netSource === 'ai' ? [] : supportingTransitions(computed.netData, edge.source, edge.target, resolveUnit).slice(0, 12))
    : [];

  return (
    <div className="text-xs">
      {!node && !edge && <div className="text-slate-400">Select a node or edge on the graph.</div>}
      {node && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-3 h-3 rounded-full" style={{ backgroundColor: node.color }} />
            <span className="font-semibold text-slate-800">{node.label}</span>
          </div>
          <dl className="space-y-1 text-slate-600">
            <div className="flex justify-between"><dt>Recorded events</dt><dd className="font-mono">{node.frequency}</dd></div>
            <div className="flex justify-between"><dt>Node type</dt><dd>{node.kind === 'ai_option' ? 'AI assistance option' : node.kind}</dd></div>
            <div className="flex justify-between"><dt>Outgoing transitions</dt><dd className="font-mono">{net.edges.filter((e) => e.source === node.id).reduce((s, e) => s + e.weight, 0)}</dd></div>
            <div className="flex justify-between"><dt>Incoming transitions</dt><dd className="font-mono">{net.edges.filter((e) => e.target === node.id).reduce((s, e) => s + e.weight, 0)}</dd></div>
          </dl>
        </div>
      )}
      {edge && (
        <div>
          <div className="font-semibold text-slate-800 mb-2">{labelFor(edge.source)} → {labelFor(edge.target)}</div>
          <dl className="space-y-1 text-slate-600 mb-3">
            <div className="flex justify-between"><dt>Observed transitions</dt><dd className="font-mono">{edge.weight}</dd></div>
            <div className="flex justify-between"><dt>Probability of outgoing</dt><dd className="font-mono">{(edge.probability * 100).toFixed(1)}%</dd></div>
          </dl>
          {supporting.length > 0 && (
            <>
              <p className="font-medium text-slate-500 mb-1">Supporting sequences (first {supporting.length}):</p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto mb-2">
                {supporting.map((r, k) => (
                  <li key={k} className="text-slate-500"><span className="font-mono">{r.participantId}</span> · {new Date(r.fromTs).toLocaleString()} → {new Date(r.toTs).toLocaleTimeString()}</li>
                ))}
              </ul>
            </>
          )}
          {netSource === 'ai' && <p className="text-slate-400 mb-2">Sequences are reconstructed from merged AI-interaction and event timestamps (see CSV export for the full list).</p>}
          <button onClick={exportEdgeCsv} className="flex items-center gap-1.5 border border-slate-300 bg-white rounded-lg px-2.5 py-1.5 hover:bg-slate-100"><Download className="w-3.5 h-3.5" /> Export transitions (CSV)</button>
        </div>
      )}
      <button onClick={onClose} className="mt-3 text-slate-400 hover:text-slate-700 underline text-[11px]">close inspector</button>
    </div>
  );
}
