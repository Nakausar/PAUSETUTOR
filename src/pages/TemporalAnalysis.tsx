import { useEffect, useMemo, useState } from 'react';
import { Clock, Download, RefreshCw, Filter } from 'lucide-react';
import { loadTemporalDataset, invalidateCache, type TemporalDataset } from '@/lib/temporal/dataService';
import {
  ANALYSIS_VERSION, PHASE_COLORS, PHASE_DISPLAY, fmtDuration,
  buildPhaseSequence, computeTransitionMatrix, computeSessionDurations, computeSessionIntervals,
  buildStepTokens, discoverSequences, aiOptionFrequency, repeatedAiPerSession, compareByGradeBand,
  type StepToken, type SessionDurations, type SessionIntervals,
} from '@/lib/temporal/analysis';
import { AI_CATEGORIES } from '@/lib/constants';
import { exportAsCSV } from '@/lib/exporter';
import NetworkGraphView, { type NetworkSelection } from '@/components/NetworkGraphView';
import { buildPhaseNetwork, buildActivityNetwork, buildAiNetwork, supportingTransitions, classifyEvent, type NetworkGraph, type NetworkDataset } from '@/lib/temporal/network';
import type { EventLog, Session, AIInteraction, ScrutinyResponse } from '@/lib/types';

interface Scoped { sessions: Session[]; events: EventLog[]; interactions: AIInteraction[]; scrutiny: ScrutinyResponse[]; approved: Map<string, number> }
interface Computed { durations: Map<string, SessionDurations>; intervals: Map<string, SessionIntervals>; eventsBySession: Map<string, EventLog[]>; netData: NetworkDataset }

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

function Section({ n, title, subtitle, children }: { n: number; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-0.5">{n}</span>
        <h2 className="text-base font-bold text-navy-900">{title}</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">{subtitle}</p>
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
  const [minFreq, setMinFreq] = useState(2);
  const [seqMinLen, setSeqMinLen] = useState(2);
  const [seqMaxLen, setSeqMaxLen] = useState(4);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [minEdgeWeight, setMinEdgeWeight] = useState(1);
  const [edgeProbabilityMode, setEdgeProbabilityMode] = useState(false);
  const [netSelection, setNetSelection] = useState<NetworkSelection | null>(null);
  const [netSource, setNetSource] = useState<'phase' | 'activity' | 'ai'>('phase');
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
    const transitions = computeTransitionMatrix(eventsBySession);
    const patterns = discoverSequences(tokensBySession, seqMinLen, seqMaxLen, minFreq);
    const bandComparison = compareByGradeBand(scoped.sessions, data!.assessments, durations, intervals);
    const netData: NetworkDataset = { events: scoped.events, interactions: scoped.interactions, scrutiny: scoped.scrutiny };
    const phaseNet = buildPhaseNetwork(netData);
    const activityNet = buildActivityNetwork(netData);
    const aiNet = buildAiNetwork({ events: scoped.events, interactions: scoped.interactions, scrutiny: scoped.scrutiny, labels: AI_LABELS, optionFilter: aiNetOption === 'all' ? null : aiNetOption });
    return { eventsBySession, durations, intervals, tokensBySession, transitions, patterns, bandComparison, phaseNet, activityNet, aiNet, netData };
  }, [scoped, seqMinLen, seqMaxLen, minFreq, aiNetOption]);

  if (loading && !data) return <div className="max-w-7xl mx-auto px-4 py-8 text-slate-400 text-sm flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading research data...</div>;

  const tasks = data?.tasks ?? [];
  const participants = Array.from(new Set((data?.sessions ?? []).map((s) => s.participant_id))).sort();
  const allSessions = data?.sessions ?? [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2"><Clock className="w-6 h-6 text-blue-600" /> Temporal Learning Analysis</h1>
          <p className="text-sm text-slate-500 mt-1">Explore learning pathways, AI assistance choices, phase transitions, and temporal patterns in programming education.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-slate-400">analysis v{ANALYSIS_VERSION}{data ? ` · loaded ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
          <button onClick={refresh} disabled={loading} className="flex items-center gap-1.5 text-sm border border-slate-300 px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Analysis</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 p-3">{error}</div>}
      {data && data.duplicateEventsRemoved > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700 p-3">{data.duplicateEventsRemoved} duplicate log entries (same session, type and description within 2 seconds) were suppressed so transition counts are not inflated. Raw exports retain every record.</div>
      )}

      {/* Filters */}
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
          <button onClick={() => { setFilters(EMPTY_FILTERS); setNetSelection(null); }} className="text-xs text-slate-500 hover:text-slate-900 underline">Clear filters</button>
          {scoped && <span className="text-xs text-slate-400">{scoped.sessions.length} sessions · {scoped.events.length} events · {scoped.interactions.length} AI requests in scope</span>}
        </div>
      </div>

      {!scoped || !computed ? null : (
        <>
          {/* ---------- 1. Learning Pathways ---------- */}
          <Section n={1} title="Learning Pathways" subtitle="Chronological phase sequence per session, reconstructed from actual event records. Historical 'edit' events from the previous six-phase framework are preserved as their own node.">
            <div className="flex flex-wrap gap-3 mb-3">
              {['plan', 'attempt', 'use_ai', 'scrutinise', 'edit', 'evaluate'].map((p) => (
                <span key={p} className="flex items-center gap-1.5 text-xs text-slate-600"><span className="w-3 h-3 rounded" style={{ backgroundColor: PHASE_COLORS[p] }} />{PHASE_DISPLAY[p]}</span>
              ))}
            </div>
            {scoped.sessions.length === 0 ? <EmptyState>No sessions match the current filters.</EmptyState> : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {scoped.sessions.slice(0, 40).map((s) => {
                  const steps = buildPhaseSequence(computed.eventsBySession.get(s.id) ?? [], s.completed_at);
                  return (
                    <button key={s.id} onClick={() => setSelectedSession(selectedSession === s.id ? null : s.id)} className={`w-full text-left border rounded-lg px-3 py-2 hover:border-blue-300 transition-colors ${selectedSession === s.id ? 'border-blue-400 bg-blue-50/40' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-medium text-slate-700">{s.participant_id}</span>
                        <span className="text-slate-400">{tasks.find((t) => t.id === s.task_id)?.title ?? 'Task'} · {steps.length} phase visit{steps.length === 1 ? '' : 's'}{s.status === 'completed' ? ' · completed' : ''}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        {steps.length === 0 ? <span className="text-xs text-slate-400">No phase events recorded</span> : steps.map((st, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="text-slate-300">→</span>}
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white" style={{ backgroundColor: PHASE_COLORS[st.phase] }}>{PHASE_DISPLAY[st.phase]}</span>
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
                {scoped.sessions.length > 40 && <p className="text-xs text-slate-400">Showing the first 40 sessions — refine filters to see others.</p>}
              </div>
            )}
            {selectedSession && <SessionDetail session={scoped.sessions.find((s) => s.id === selectedSession)!} events={computed.eventsBySession.get(selectedSession) ?? []} interactions={scoped.interactions} scrutiny={scoped.scrutiny} durations={computed.durations.get(selectedSession) ?? null} intervals={computed.intervals.get(selectedSession) ?? null} />}
          </Section>

          {/* ---------- 2. AI Assistance Behaviour ---------- */}
          <Section n={2} title="AI Assistance Behaviour" subtitle="Exactly which AI assistance option each student selected, when, and what happened next. Options are the seven built into the Use AI phase.">
            {scoped.interactions.length === 0 ? <EmptyState>No AI requests in scope. Students who never use AI are shown here as an empty result — that is a valid outcome, not missing data.</EmptyState> : (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">A. AI option frequency</h3>
                  <table className="text-xs w-full max-w-2xl">
                    <thead className="text-slate-500"><tr><Th>AI assistance option</Th><Th right>Requests</Th><Th right>Students</Th><Th right>% of requests</Th></tr></thead>
                    <tbody>
                      {aiOptionFrequency(scoped.interactions, AI_LABELS).map((r) => (
                        <tr key={r.category}><td className="py-1.5 px-2 text-slate-700">{r.label}</td><td className="py-1.5 px-2 text-right font-mono">{r.requests}</td><td className="py-1.5 px-2 text-right font-mono">{r.students}</td><td className="py-1.5 px-2 text-right font-mono">{r.pctOfRequests.toFixed(1)}%</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">B. Request detail and follow-up activity</h3>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead className="text-slate-500"><tr><Th>Student</Th><Th>Option</Th><Th>Requested</Th><Th>Prompt</Th><Th>Scrutinised</Th><Th>Request → scrutiny</Th><Th>Scrutiny → code</Th></tr></thead>
                      <tbody>
                        {scoped.interactions.slice(0, 50).map((i) => {
                          const sc = scoped.scrutiny.filter((s) => s.ai_interaction_id === i.id).sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
                          const sessionEvents = (computed.eventsBySession.get(i.session_id) ?? []).filter((e) => new Date(e.timestamp).getTime() >= new Date(i.created_at).getTime() && (e.event_type === 'CODE_RUN' || e.event_type === 'CODE_REVISED'));
                          const nextCode = sessionEvents[0]?.timestamp ?? null;
                          const gap1 = sc ? new Date(sc.created_at).getTime() - new Date(i.created_at).getTime() : null;
                          const gap2 = sc && nextCode ? new Date(nextCode).getTime() - new Date(sc.created_at).getTime() : null;
                          return (
                            <tr key={i.id}>
                              <td className="py-1.5 px-2 font-mono">{i.participant_id}</td>
                              <td className="py-1.5 px-2 text-slate-700 whitespace-nowrap">{AI_LABELS[i.category] ?? i.category}</td>
                              <td className="py-1.5 px-2 whitespace-nowrap text-slate-500">{new Date(i.created_at).toLocaleString()}</td>
                              <td className="py-1.5 px-2 max-w-52 truncate text-slate-500" title={i.prompt}>{i.prompt.slice(0, 80) || '—'}</td>
                              <td className="py-1.5 px-2">{sc ? <span className="text-emerald-600">yes</span> : <span className="text-slate-300">no</span>}</td>
                              <td className="py-1.5 px-2 font-mono">{fmtDuration(gap1)}</td>
                              <td className="py-1.5 px-2 font-mono">{fmtDuration(gap2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {scoped.interactions.length > 50 && <p className="text-xs text-slate-400 mt-2">Showing the first 50 requests — export for the full set.</p>}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">C. Repeated AI assistance</h3>
                  <table className="text-xs w-full max-w-3xl">
                    <thead className="text-slate-500"><tr><Th>Student</Th><Th right>Requests</Th><Th right>Distinct options</Th><Th>Repeated option</Th><Th right>Scrutiny cycles</Th></tr></thead>
                    <tbody>
                      {repeatedAiPerSession(scoped.interactions, scoped.scrutiny, AI_LABELS).slice(0, 20).map((r) => (
                        <tr key={r.sessionId}><td className="py-1.5 px-2 font-mono">{r.participantId}</td><td className="py-1.5 px-2 text-right font-mono">{r.totalRequests}</td><td className="py-1.5 px-2 text-right font-mono">{r.optionsUsed}</td><td className="py-1.5 px-2">{r.repeatedOption ? `${r.repeatedOption} ×${r.repeatedOptionCount}` : '—'}</td><td className="py-1.5 px-2 text-right font-mono">{r.scrutinyCycles}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Section>

          {/* ---------- 3. Phase Transitions ---------- */}
          <Section n={3} title="Phase Transitions" subtitle="Movement between PAUSE phases, from PHASE_ENTERED/PHASE_EXITED/PHASE_TRANSITION records. Duplicate log entries are suppressed; backward moves are expected under flexible navigation.">
            {computed.transitions.rowTotals.every((t) => t === 0) ? <EmptyState>No phase transitions recorded in scope.</EmptyState> : (
              <div className="grid lg:grid-cols-2 gap-5">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Transition frequency</h3>
                  <TransitionTable phases={computed.transitions.phases} counts={computed.transitions.counts} rowTotals={computed.transitions.rowTotals} />
                  <p className="text-xs text-slate-500 mt-2">Forward movements: {computed.transitions.forward} · Backward movements: {computed.transitions.backward}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Transition probability (row-normalised)</h3>
                  <TransitionTable phases={computed.transitions.phases} counts={computed.transitions.probabilities.map((r) => r.map((v) => Math.round(v * 100)))} rowTotals={null} percent />
                  <div className="mt-3">
                    <h3 className="text-sm font-semibold text-slate-700 mb-1.5">Diagram (edges ≥ 10% of row)</h3>
                    <div className="flex flex-wrap gap-2">
                      {computed.transitions.phases.flatMap((a, ai2) => computed.transitions.phases.map((b, bi2) => ({ a, b, p: computed.transitions.probabilities[ai2][bi2] })))
                        .filter(({ a, b, p }) => a !== b && p >= 0.1 && computed.transitions.rowTotals[computed.transitions.phases.indexOf(a)] > 0)
                        .sort((x, y) => y.p - x.p).slice(0, 12)
                        .map(({ a, b, p }, k) => (
                          <span key={k} className="text-[11px] border border-slate-200 rounded px-2 py-1"><span style={{ color: PHASE_COLORS[a] }}>{PHASE_DISPLAY[a]}</span> → <span style={{ color: PHASE_COLORS[b] }}>{PHASE_DISPLAY[b]}</span> <span className="font-mono text-slate-500">{Math.round(p * 100)}%</span></span>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ---------- 4. Timing and Help-Seeking ---------- */}
          <Section n={4} title="Timing and Help-Seeking" subtitle="Temporal intervals computed from record timestamps. Times are observed elapsed (wall-clock) time; active estimates cap each silent gap at 5 minutes. Missing timestamps are excluded, never estimated.">
            {scoped.sessions.length === 0 ? <EmptyState>No sessions in scope.</EmptyState> : (
              <div className="space-y-4">
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {(() => {
                    const durs = scoped.sessions.map((s) => computed.durations.get(s.id)).filter(Boolean) as SessionDurations[];
                    const ivs = scoped.sessions.map((s) => computed.intervals.get(s.id)).filter(Boolean) as SessionIntervals[];
                    const sum = (arr: number[]) => arr.reduce((s2, v) => s2 + v, 0);
                    const allFirstAi = ivs.map((i) => i.firstCodeToFirstAiMs).filter((v): v is number => v !== null && v >= 0);
                    return (
                      <>
                        <MetricCard label="Sessions with recorded activity" value={String(durs.length)} />
                        <MetricCard label="Total observed time" value={fmtDuration(sum(durs.map((d) => d.observedMs ?? 0)) || null)} />
                        <MetricCard label="Total estimated active time" value={fmtDuration(sum(durs.map((d) => d.activeMs)) || null)} />
                        <MetricCard label="Median time to first AI request (after first code)" value={fmtDuration(medianOf(allFirstAi))} />
                      </>
                    );
                  })()}
                </div>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead className="text-slate-500"><tr>
                      <Th>Student</Th><Th>Session</Th><Th right>Plan → first code</Th><Th right>First code → first AI</Th><Th right>AI requests</Th><Th right>Median gap between AI requests</Th><Th right>Median request → scrutiny</Th><Th right>Median scrutiny → code</Th><Th right>Observed duration</Th><Th right>Estimated active</Th>
                    </tr></thead>
                    <tbody>
                      {scoped.sessions.slice(0, 30).map((s) => {
                        const d = computed.durations.get(s.id);
                        const iv = computed.intervals.get(s.id);
                        const med = (arr: number[]) => (arr.length ? medianOf(arr) : null);
                        return (
                          <tr key={s.id}>
                            <td className="py-1.5 px-2 font-mono">{s.participant_id}</td>
                            <td className="py-1.5 px-2 font-mono text-slate-400">{s.id.slice(0, 8)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(iv?.planToFirstCodeMs ?? null)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(iv?.firstCodeToFirstAiMs ?? null)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{iv?.aiRequestCount ?? 0}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(med(iv?.aiRequestGapsMs ?? []))}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(med(iv?.scrutinyAfterRequestMs ?? []))}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(med(iv?.codeAfterScrutinyMs ?? []))}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{fmtDuration(d?.observedMs ?? null)}</td>
                            <td className="py-1.5 px-2 text-right font-mono">{d ? fmtDuration(d.activeMs) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">A student who never requested AI shows "—" for AI columns; that is a genuine outcome, not missing data. Page-open time is never assumed to be engagement.</p>
              </div>
            )}
          </Section>

          {/* ---------- 5. Temporal Patterns and Performance ---------- */}
          <Section n={5} title="Temporal Patterns and Performance" subtitle="Frequent step sequences (descriptive n-gram counts over session pathways) and their relation to approved grades. Descriptive only — no statistical significance is asserted.">
            <div className="flex flex-wrap items-end gap-4 mb-4">
              <label className="text-xs text-slate-500">Min sequence length
                <input type="number" min={2} max={8} value={seqMinLen} onChange={(e) => setSeqMinLen(Math.max(2, Number(e.target.value)))} className="mt-1 w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-500">Max sequence length
                <input type="number" min={2} max={8} value={seqMaxLen} onChange={(e) => setSeqMaxLen(Math.min(8, Number(e.target.value)))} className="mt-1 w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <label className="text-xs text-slate-500">Minimum frequency
                <input type="number" min={1} max={50} value={minFreq} onChange={(e) => setMinFreq(Math.max(1, Number(e.target.value)))} className="mt-1 w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              </label>
              <span className="text-[11px] text-slate-400">Steps: {Object.entries(STEP_LABELS).map(([k, v]) => <span key={k} className="mr-2" style={{ color: STEP_COLORS[k as StepToken] }}>{v}</span>)}</span>
            </div>
            <div className="grid lg:grid-cols-2 gap-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Frequent sequences</h3>
                {computed.patterns.length === 0 ? <EmptyState>No sequences reach the current minimum frequency. Lower the threshold or widen the filters.</EmptyState> : (
                  <table className="text-xs w-full">
                    <thead className="text-slate-500"><tr><Th>Sequence</Th><Th right>Count</Th><Th right>Students</Th><Th right>Sessions</Th></tr></thead>
                    <tbody>
                      {computed.patterns.slice(0, 15).map((p) => (
                        <tr key={p.sequence}><td className="py-1.5 px-2 text-slate-700">{p.sequence}</td><td className="py-1.5 px-2 text-right font-mono">{p.count}</td><td className="py-1.5 px-2 text-right font-mono">{p.participants}</td><td className="py-1.5 px-2 text-right font-mono">{p.sessions}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Temporal metrics by approved grade band</h3>
                <table className="text-xs w-full">
                  <thead className="text-slate-500"><tr><Th>Approved grade band</Th><Th right>Sessions</Th><Th right>Students</Th><Th right>Avg AI requests</Th><Th right>Avg scrutiny cycles</Th><Th right>Avg active min</Th><Th right>Median min to first AI</Th></tr></thead>
                  <tbody>
                    {computed.bandComparison.rows.map((r) => (
                      <tr key={r.band}>
                        <td className="py-1.5 px-2 text-slate-700">{r.band}</td><td className="py-1.5 px-2 text-right font-mono">{r.sessions}</td><td className="py-1.5 px-2 text-right font-mono">{r.participants}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.avgAiRequests !== null ? r.avgAiRequests.toFixed(1) : '—'}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.avgScrutinyCycles !== null ? r.avgScrutinyCycles.toFixed(1) : '—'}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.avgActiveMinutes !== null ? r.avgActiveMinutes.toFixed(1) : '—'}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{r.medianMinutesToFirstAi !== null ? r.medianMinutesToFirstAi.toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-slate-400 mt-2">Based on {computed.bandComparison.gradedCount} graded and {computed.bandComparison.ungradedCount} ungraded sessions. Only researcher-approved marks are used; ungraded work is excluded, never counted as zero. AI draft marks are never used. No causal claim is made or implied.</p>
              </div>
            </div>
          </Section>

          {/* ---------- 6. Interactive Networks ---------- */}
          <Section n={6} title="Interactive Learning Networks" subtitle="Force-directed maps of observed activity. Every node is a recorded event category, every arrow an observed chronological transition between consecutive events in a session. Network proximity is a layout artefact, not evidence of learning effectiveness.">
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                {([['phase', 'Phase network'], ['activity', 'Activity network'], ['ai', 'AI pathway network']] as const).map(([key, lbl]) => (
                  <button key={key} onClick={() => { setNetSource(key); setNetSelection(null); }} className={`px-3 py-1.5 font-medium transition-colors ${netSource === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{lbl}</button>
                ))}
              </div>
              <label className="text-xs text-slate-500">Min edge weight
                <input type="number" min={1} max={50} value={minEdgeWeight} onChange={(e) => setMinEdgeWeight(Math.max(1, Number(e.target.value)))} className="ml-2 w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={edgeProbabilityMode} onChange={(e) => setEdgeProbabilityMode(e.target.checked)} className="rounded" />
                Show normalised probabilities instead of raw counts
              </label>
              {netSource === 'ai' && (
                <label className="text-xs text-slate-500">Inspect AI option
                  <select value={aiNetOption} onChange={(e) => { setAiNetOption(e.target.value); setNetSelection(null); }} className="ml-2 border border-slate-300 rounded-lg px-2 py-1 text-sm">
                    <option value="all">All options</option>
                    {AI_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            {(() => {
              const net: NetworkGraph = netSource === 'phase' ? computed.phaseNet : netSource === 'activity' ? computed.activityNet : computed.aiNet;
              const emptyMsg = netSource === 'ai' && scoped.interactions.length === 0
                ? 'No AI requests in scope. Sessions without AI assistance are a valid outcome — the AI pathway network is empty by observation, not by error.'
                : net.nodes.length === 0 ? 'No recorded activity in scope for this network.' : null;
              if (emptyMsg) return <EmptyState>{emptyMsg}</EmptyState>;
              return (
                <div className="grid lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2">
                    <NetworkGraphView
                      graph={net}
                      selection={netSelection}
                      onSelect={setNetSelection}
                      minEdgeWeight={minEdgeWeight}
                      probabilityMode={edgeProbabilityMode}
                      filename={`temporal_${netSource}_network`}
                    />
                  </div>
                  <NetworkInspector
                    net={net}
                    selection={netSelection}
                    scoped={scoped}
                    computed={computed}
                    netSource={netSource}
                    onClose={() => setNetSelection(null)}
                  />
                </div>
              );
            })()}
            <p className="text-[11px] text-slate-400 mt-3">Legend — phase network: nodes are the five PAUSE phases (Plan blue, Attempt green, Use AI orange, Scrutinise purple, Evaluate red; archived Edit shown separately). Activity network: nodes are concrete recorded activities. AI pathway network: orange option nodes carry the exact AI assistance labels stored in the database. Edge labels show the raw transition count or row-normalised probability. Frequencies and counts here are computed from the same event set as the tables above, so the network and table views agree under identical filters.</p>
          </Section>

          {/* ---------- Exports ---------- */}
          <Section n={0} title="Research Data Exports" subtitle={`CSV exports matching the current filters. Analysis version ${ANALYSIS_VERSION}; exported ${new Date().toISOString().slice(0, 10)}. See the data dictionary note below for field definitions.`}>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <ExportCard label="Raw event records" desc="Timestamped events with stable ids, participant, task, session, phase and type" onClick={() => exportAsCSV(scoped.events.map(toRawEventRow), 'temporal_raw_events')} />
              <ExportCard label="Learning sequences" desc="Ordered phase steps per session with event counts and spans" onClick={() => exportAsCSV(exportSequences(scoped, computed.eventsBySession), 'temporal_learning_sequences')} />
              <ExportCard label="AI option selections" desc="Every AI request with option id, label, timestamps and scrutiny linkage" onClick={() => exportAsCSV(exportAiSelections(scoped), 'temporal_ai_option_selections')} />
              <ExportCard label="Phase transition frequencies" desc="from → to counts and row probabilities" onClick={() => { const t = computed.transitions; exportAsCSV(t.phases.flatMap((a, ai2) => t.phases.map((b, bi2) => ({ from_phase: a, to_phase: b, count: t.counts[ai2][bi2], row_probability: t.probabilities[ai2][bi2].toFixed(4) }))).filter((r: { count: number }) => r.count > 0), 'temporal_phase_transitions'); }} />
              <ExportCard label="Temporal duration metrics" desc="Observed vs estimated active time per session and phase" onClick={() => exportAsCSV(exportDurations(scoped.sessions, computed.durations), 'temporal_durations')} />
              <ExportCard label="Frequent sequence counts" desc="Discovered n-grams with frequency controls applied" onClick={() => exportAsCSV(computed.patterns.map((p) => ({ sequence: p.sequence, length: p.length, count: p.count, participants: p.participants, sessions: p.sessions })), 'temporal_sequence_patterns')} />
              <ExportCard label="Participant temporal summaries" desc="Per participant: sessions, AI requests, scrutiny cycles, observed and active time" onClick={() => exportAsCSV(exportParticipantSummaries(scoped, computed), 'temporal_participant_summaries')} />
              <ExportCard label="Grades linked to temporal metrics" desc="Approved marks joined with temporal intervals per session" onClick={() => exportAsCSV(exportGradesLinked(scoped, computed), 'temporal_grades_linked')} />
            </div>
            <p className="text-[11px] text-slate-400 mt-3">Data dictionary — event rows: id, participant_id, task_id, session_id, timestamp, pause_phase (raw label, including historical 'edit'), event_type, description; sequence rows: session_id, participant_id, step_index, phase, step_start, step_end, event_count; AI rows: interaction id, category (option id), option_label, prompt, created_at, scrutinised, seconds_to_scrutiny, seconds_scrutiny_to_code; duration rows: session_id, phase, observed_ms, active_ms (gaps &gt; 5 min capped at 5 min); participant rows: participant_id, session_count, ai_requests, scrutiny_cycles, observed_ms, active_ms; grade rows: session_id, participant_id, approved_mark, band, ai_request_count, scrutiny_cycles, minutes_to_first_ai. Deduplication note: analysis uses near-identical-entry suppression (≤ 2 s); raw exports keep every stored record. Historical compatibility: the 'edit' phase from the earlier six-phase framework is kept as a separate sequence node and label in all outputs; it is never merged into 'scrutinise'.</p>
          </Section>
        </>
      )}
    </div>
  );
}

function medianOf(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</div>
      <div className="text-lg font-bold text-navy-900 mt-0.5">{value}</div>
    </div>
  );
}

function TransitionTable({ phases, counts, rowTotals, percent = false }: { phases: string[]; counts: (number | number)[][]; rowTotals: number[] | null; percent?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px]">
        <thead className="text-slate-500"><tr><th className="px-2 py-1">from \ to</th>{phases.map((p) => <th key={p} className="px-2 py-1" style={{ color: PHASE_COLORS[p] }}>{PHASE_DISPLAY[p]}</th>)}</tr></thead>
        <tbody>
          {phases.map((a, i) => (
            <tr key={a}>
              <td className="px-2 py-1 font-medium" style={{ color: PHASE_COLORS[a] }}>{PHASE_DISPLAY[a]}</td>
              {phases.map((b, j) => (
                <td key={b} className={`px-2 py-1 text-right font-mono ${a === b ? 'text-slate-300' : counts[i][j] === 0 ? 'text-slate-300' : 'text-slate-800'}`}>{percent ? `${counts[i][j] as number}%` : counts[i][j]}</td>
              ))}
              {rowTotals && <td className="px-2 py-1 text-right font-mono text-slate-400">{rowTotals[i]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionDetail({ session, events, interactions, scrutiny, durations, intervals }: { session: Session; events: EventLog[]; interactions: AIInteraction[]; scrutiny: ScrutinyResponse[]; durations: SessionDurations | null; intervals: SessionIntervals | null }) {
  const ordered = events.slice().sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return (
    <div className="border border-blue-200 bg-blue-50/30 rounded-lg p-4 mt-3">
      <div className="text-sm font-semibold text-navy-900 mb-2">Session detail — {session.participant_id} · {session.id.slice(0, 8)}</div>
      <div className="grid sm:grid-cols-4 gap-2 text-xs mb-3">
        <MetricCard label="Events" value={String(ordered.length)} />
        <MetricCard label="AI requests" value={String(interactions.filter((i) => i.session_id === session.id).length)} />
        <MetricCard label="Observed" value={fmtDuration(durations?.observedMs ?? null)} />
        <MetricCard label="Est. active" value={fmtDuration(durations?.activeMs ?? null)} />
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {ordered.map((e) => (
          <div key={e.id} className="flex items-start gap-2 text-xs border-b border-blue-100/60 pb-1">
            <span className="font-mono text-slate-400 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-white shrink-0" style={{ backgroundColor: PHASE_COLORS[e.pause_phase] ?? '#64748B' }}>{PHASE_DISPLAY[e.pause_phase] ?? e.pause_phase}</span>
            <span className="font-mono text-slate-600 shrink-0">{e.event_type}</span>
            <span className="text-slate-500 truncate" title={e.event_description}>{e.event_description}{e.ai_interaction_id ? ' · AI-linked' : ''}{e.code_snapshot_id ? ' · snapshot' : ''}</span>
          </div>
        ))}
        {ordered.length === 0 && <p className="text-xs text-slate-400">No events recorded for this session.</p>}
      </div>
      {intervals && intervals.aiRequestGapsMs.length > 0 && (
        <p className="text-[11px] text-slate-500 mt-2">Gaps between this student's AI requests: {intervals.aiRequestGapsMs.map((g) => fmtDuration(g)).join(', ')} · {scrutiny.filter((s) => s.session_id === session.id).length} scrutiny cycle(s).</p>
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
    rows.push({ session_id: s.id, participant_id: s.participant_id, phase: 'TOTAL', observed_ms: d.observedMs ?? '', active_ms: d.activeMs });
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

// Scoped and Computed interfaces declared above the default export.

function NetworkInspector({ net, selection, scoped, computed, netSource, onClose }: {
  net: NetworkGraph;
  selection: NetworkSelection | null;
  scoped: Scoped;
  computed: Computed;
  netSource: 'phase' | 'activity' | 'ai';
  onClose: () => void;
}) {
  const node = selection?.type === 'node' ? net.nodes.find((n) => n.id === selection.id) ?? null : null;
  const edge = selection?.type === 'edge' ? net.edges.find((e) => e.id === selection.id) ?? null : null;

  const labelFor = (id: string) => net.nodes.find((n) => n.id === id)?.label ?? id;
  const resolveUnit = (e: EventLog): string | null => {
    if (netSource === 'phase') return e.pause_phase ?? null;
    if (netSource === 'activity') return classifyEvent(e);
    return null; // AI-network edges splice interactions, so event-only resolution doesn't apply
  };

  function exportEdgeCsv() {
    if (!edge) return;
    let rows: Record<string, unknown>[];
    if (netSource === 'ai') {
      // Supporting AI-network transitions: rebuild per-session unit streams.
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
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs">
      {!selection && (
        <div className="text-slate-400">
          <p className="font-medium text-slate-500 mb-1">Inspector</p>
          Click a node to see its recorded event frequency, or an edge to inspect the underlying transitions. Drag nodes to rearrange; scroll to zoom.
        </div>
      )}
      {node && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: node.color }} />
              <span className="font-semibold text-slate-800">{node.label}</span>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">clear</button>
          </div>
          <dl className="space-y-1 text-slate-600">
            <div className="flex justify-between"><dt>Recorded events in node</dt><dd className="font-mono">{node.frequency}</dd></div>
            <div className="flex justify-between"><dt>Node type</dt><dd>{node.kind === 'ai_option' ? 'AI assistance option' : node.kind}</dd></div>
            <div className="flex justify-between"><dt>Outgoing transitions</dt><dd className="font-mono">{net.edges.filter((e) => e.source === node.id).reduce((s, e) => s + e.weight, 0)}</dd></div>
            <div className="flex justify-between"><dt>Incoming transitions</dt><dd className="font-mono">{net.edges.filter((e) => e.target === node.id).reduce((s, e) => s + e.weight, 0)}</dd></div>
          </dl>
        </div>
      )}
      {edge && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-800">{labelFor(edge.source)} → {labelFor(edge.target)}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">clear</button>
          </div>
          <dl className="space-y-1 text-slate-600 mb-3">
            <div className="flex justify-between"><dt>Observed transitions</dt><dd className="font-mono">{edge.weight}</dd></div>
            <div className="flex justify-between"><dt>Probability (of outgoing from {labelFor(edge.source)})</dt><dd className="font-mono">{(edge.probability * 100).toFixed(1)}%</dd></div>
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
          {netSource === 'ai' && <p className="text-slate-400 mb-2">For the AI pathway network, sequences are reconstructed from merged AI-interaction and event timestamps (see export for the full list).</p>}
          <button onClick={exportEdgeCsv} className="flex items-center gap-1.5 border border-slate-300 bg-white rounded-lg px-2.5 py-1.5 hover:bg-slate-100"><Download className="w-3.5 h-3.5" /> Export supporting transitions (CSV)</button>
        </div>
      )}
    </div>
  );
}
