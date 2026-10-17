import { useMemo, useState } from 'react';
import { BracketHeading, WeeklyLineChart, MarksLineChart, BoxPlotChart, F3_TEAL } from '@/components/Figure3Charts';
import {
  weeklyEngagement, weeklyResources, weeklyAIInteractions,
  approvedMarksSeries, assessmentBoxGroups, assessmentSummaries,
} from '@/lib/figure3Data';
import type { ResearchBundle } from '@/lib/researchData';
import type { MetacognitiveRating, Assessment } from '@/lib/types';
import { RatingBadge, RATING_LABELS } from '@/components/RatingBadge';

function ThreePanelTab({ bundle }: { bundle: ResearchBundle }) {
  const participants = bundle.participants;
  const [selectedId, setSelectedId] = useState<string>(participants[0]?.id ?? '');
  const selected = participants.find((p) => p.id === selectedId) ?? null;
  const selPid = selected?.participant_id ?? null;

  const engagement = useMemo(() => weeklyEngagement(bundle, selPid), [bundle, selPid]);
  const resources = useMemo(() => weeklyResources(bundle, selPid), [bundle, selPid]);
  const aiWeekly = useMemo(() => weeklyAIInteractions(bundle, selPid), [bundle, selPid]);
  const marksSeries = useMemo(() => approvedMarksSeries(bundle, selPid), [bundle, selPid]);
  const boxGroups = useMemo(() => assessmentBoxGroups(bundle), [bundle]);
  const summaries = useMemo(() => assessmentSummaries(bundle, selPid), [bundle, selPid]);
  const meta = useApprovedMetaRatings(bundle, selPid);
  const partSessions = useMemo(
    () => bundle.sessions.filter((s) => !selPid || s.participant_id === selPid),
    [bundle, selPid],
  );
  const completedSessions = partSessions.filter((s) => s.status === 'completed');
  const latestApproved = useLatestApproved(bundle, selPid);
  const feedback = latestApproved?.programming_feedback?.trim() || null;

  return (
    <div className="min-w-[1024px]">
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">
        {/* ============ PANEL 1 — Engagement ============ */}
        <section aria-labelledby="p1-title" className="space-y-3">
          <BracketHeading label="Panel 1" sub="Learning Engagement" />

          <FigureCard title="Weekly Engagement">
            <WeeklyLineChart data={engagement} legendStudent={selPid ? `${selPid} events` : 'Cohort events'} legendCohort="Cohort average" />
          </FigureCard>

          <FigureCard title="Resources Over Weeks">
            <WeeklyLineChart data={resources} legendStudent={selPid ? `${selPid} activities` : 'PAUSE activities'} legendCohort="Cohort average" />
          </FigureCard>

          <FigureCard title="AI Interactions Over Weeks">
            <WeeklyLineChart data={aiWeekly} legendStudent={selPid ? `${selPid} requests` : 'AI requests'} legendCohort="Cohort average" />
          </FigureCard>
        </section>

        {/* ============ PANEL 2 — Assessment ============ */}
        <section aria-labelledby="p2-title" className="space-y-3">
          <BracketHeading label="Panel 2" sub="Assessment" />

          <FigureCard title="Assignment Marks">
            <MarksLineChart data={marksSeries} legendStudent={selPid ? `${selPid} marks` : 'Approved marks'} legendCohort="Cohort average" />
          </FigureCard>

          <FigureCard title="Assessment Marks Distribution">
            <BoxPlotChart groups={boxGroups} />
          </FigureCard>

          <div className="grid grid-cols-2 gap-2">
            <SummaryBox label="Latest approved mark" value={summaries.latestMark !== null ? `${summaries.latestMark}/100` : '—'} note={summaries.latestTask ?? 'No approved assessment'} />
            <SummaryBox label="Participant mean" value={summaries.ownMean !== null ? summaries.ownMean.toFixed(1) : '—'} note={summaries.assessmentsCount > 0 ? `${summaries.assessmentsCount} approved` : 'none yet'} />
            <SummaryBox label="Cohort mean" value={summaries.cohortMean !== null ? summaries.cohortMean.toFixed(1) : '—'} note={`${summaries.cohortCount} approved marks`} />
            <SummaryBox label="Completion" value={`${completedSessions.length}/${partSessions.length}`} note="sessions completed" />
          </div>
          <p className="text-[10px] text-slate-400 leading-4">Marks are researcher-approved only. Unapproved AI drafts are never displayed.</p>
        </section>

        {/* ============ PANEL 3 — Learning Analytics ============ */}
        <section aria-labelledby="p3-title" className="space-y-3">
          <BracketHeading label="Panel 3" sub="Learning Analytics" />

          <FigureCard title="A. Learning Progress">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-[10px] text-slate-500">Participant
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white">
                  {participants.map((p) => <option key={p.id} value={p.id}>{p.participant_id}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate-500">Task
                <select className="mt-0.5 w-full border border-slate-300 rounded px-1.5 py-1 text-[11px] bg-white" defaultValue="all">
                  <option value="all">All tasks</option>
                  {bundle.tasks.map((t) => <option key={t.id} value={t.id}>{t.title.slice(0, 22)}</option>)}
                </select>
              </label>
            </div>
            <div className="text-[11px] text-slate-600 space-y-1">
              <div className="flex justify-between"><span>Sessions</span><span className="font-semibold">{partSessions.length}</span></div>
              <div className="flex justify-between"><span>Completed</span><span className="font-semibold">{completedSessions.length}</span></div>
              <div className="flex justify-between"><span>Events recorded</span><span className="font-semibold">{selPid ? bundle.events.filter((e) => e.participant_id === selPid).length : bundle.events.length}</span></div>
            </div>
          </FigureCard>

          <FigureCard title="B. Key Learning Indicators">
            <IndicatorBars bundle={bundle} selPid={selPid} />
          </FigureCard>

          <FigureCard title="C. Learning Behaviour Explanation">
            <BehaviourExplanation
              events={selPid ? bundle.events.filter((e) => e.participant_id === selPid).length : bundle.events.length}
              ai={selPid ? bundle.aiInteractions.filter((a) => a.participant_id === selPid).length : bundle.aiInteractions.length}
              scrutiny={selPid ? bundle.scrutiny.filter((s) => s.participant_id === selPid).length : bundle.scrutiny.length}
              revisions={countRevisions(bundle, selPid)}
              reflections={selPid ? bundle.reflections.filter((r) => r.participant_id === selPid).length : bundle.reflections.length}
            />
          </FigureCard>

          <FigureCard title="D. Recommended Learning Actions">
            {feedback ? (
              <ul className="text-[11px] text-slate-600 leading-5 list-disc list-inside space-y-1">
                <li>{feedback.slice(0, 200)}{feedback.length > 200 ? '…' : ''}</li>
                <li>Re-read the approved feedback for &ldquo;{summaries.latestTask ?? 'your latest task'}&rdquo; and re-run the test cases it names.</li>
              </ul>
            ) : (
              <p className="text-[11px] text-slate-400">Recommendations appear once an approved assessment with programming feedback exists for the selected participant.</p>
            )}
          </FigureCard>

          {meta.count > 0 && (
            <FigureCard title="Metacognitive rating distribution (approved)">
              <MetaDistribution bundle={bundle} />
            </FigureCard>
          )}

          {meta.latest && (
            <FigureCard title="Metacognitive ratings (approved)">
              <MetaRatingStrip
                ratings={[meta.latest.metacog_planning, meta.latest.metacog_monitoring, meta.latest.metacog_scrutiny, meta.latest.metacog_evaluation]}
                count={meta.count}
              />
            </FigureCard>
          )}
        </section>
      </div>
    </div>
  );
}

function useLatestApproved(bundle: ResearchBundle, selPid: string | null): Assessment | null {
  return useMemo(() => {
    if (!selPid) return null;
    const rows = bundle.assessments
      .filter((a) => a.status === 'approved' && a.participant_id === selPid && a.approved_mark !== null)
      .sort((a, b) => (a.approved_at ?? a.updated_at).localeCompare(b.approved_at ?? b.updated_at));
    return rows.length ? rows[rows.length - 1] : null;
  }, [bundle, selPid]);
}

function countRevisions(bundle: ResearchBundle, selPid: string | null): number {
  return bundle.scrutiny
    .filter((s) => !selPid || s.participant_id === selPid)
    .filter((s) => (s.code_before ?? '').trim() !== '' && (s.code_after ?? '').trim() !== '' && (s.code_before ?? '').trim() !== (s.code_after ?? '').trim()).length;
}

function FigureCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 bg-white">
      <div className="text-[11px] font-semibold text-slate-700 px-2.5 pt-2 pb-1 border-b border-slate-100">{title}</div>
      <div className="px-1.5 py-1.5">{children}</div>
    </div>
  );
}

function SummaryBox({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border border-slate-200 px-2.5 py-2">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-900 leading-tight">{value}</div>
      <div className="text-[10px] text-slate-400 truncate">{note}</div>
    </div>
  );
}

function IndicatorBars({ bundle, selPid }: { bundle: ResearchBundle; selPid: string | null }) {
  const own = <T extends { participant_id: string }>(rows: T[]) => (selPid ? rows.filter((r) => r.participant_id === selPid) : rows);
  const bars = [
    { label: 'Planning', n: own(bundle.plans).length },
    { label: 'Independent attempts', n: own(bundle.codeSnapshots).length },
    { label: 'AI scrutiny', n: own(bundle.scrutiny).length },
    { label: 'Code revisions', n: countRevisions(bundle, selPid) },
    { label: 'Evaluation', n: own(bundle.reflections).length },
  ];
  const max = Math.max(...bars.map((b) => b.n), 1);
  return (
    <div className="space-y-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-[10px] text-slate-600 w-24 shrink-0 text-right">{b.label}</span>
          <div className="flex-1 h-3 bg-slate-100">
            <div className="h-full transition-all duration-500" style={{ width: `${(b.n / max) * 100}%`, backgroundColor: b.n > 0 ? F3_TEAL : 'transparent' }} />
          </div>
          <span className="text-[10px] text-slate-500 w-6">{b.n}</span>
        </div>
      ))}
    </div>
  );
}

function BehaviourExplanation(props: { events: number; ai: number; scrutiny: number; revisions: number; reflections: number }) {
  const parts: string[] = [];
  parts.push(`${props.events} learning events recorded across the PAUSE phases.`);
  if (props.ai > 0) parts.push(`${props.ai} AI assistance requests were made.`);
  else parts.push('No AI assistance requests were recorded.');
  if (props.scrutiny > 0) parts.push(`${props.scrutiny} AI responses were critically scrutinised, leading to ${props.revisions} recorded code revisions.`);
  else parts.push('No critical scrutiny of AI responses has been recorded yet.');
  if (props.reflections > 0) parts.push(`${props.reflections} evaluation reflections were submitted after task completion.`);
  else parts.push('No evaluation reflections submitted yet.');
  return <ul className="text-[11px] text-slate-600 leading-5 list-disc list-inside space-y-0.5">{parts.map((p, i) => <li key={i}>{p}</li>)}</ul>;
}

function useApprovedMetaRatings(bundle: ResearchBundle, selPid: string | null) {
  const rows = bundle.assessments
    .filter((a) => a.status === 'approved' && (!selPid || a.participant_id === selPid))
    .sort((a, b) => (a.approved_at ?? a.updated_at).localeCompare(b.approved_at ?? b.updated_at));
  const latest = rows.length ? rows[rows.length - 1] : null;
  return { count: rows.length, latest };
}

function MetaRatingStrip({ ratings, count }: { ratings: (MetacognitiveRating | null)[]; count: number }) {
  const labels = ['Planning', 'Monitoring', 'Scrutiny', 'Evaluation'];
  return (
    <div>
      <div className="space-y-1">
        {labels.map((l, i) => (
          <div key={l} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-600">{l}</span>
            {ratings[i] ? <RatingBadge rating={ratings[i]} small /> : <span className="text-slate-300">not rated</span>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">Latest approved assessment of {count} in scope. Qualitative categories only — never converted to numbers or comments.</p>
    </div>
  );
}

export default ThreePanelTab;

function MetaDistribution({ bundle }: { bundle: ResearchBundle }) {
  const dims: { label: string; key: 'metacog_planning' | 'metacog_monitoring' | 'metacog_scrutiny' | 'metacog_evaluation' }[] = [
    { label: 'Planning', key: 'metacog_planning' },
    { label: 'Monitoring', key: 'metacog_monitoring' },
    { label: 'Scrutiny', key: 'metacog_scrutiny' },
    { label: 'Evaluation', key: 'metacog_evaluation' },
  ];
  const rows = bundle.assessments.filter((a) => a.status === 'approved');
  const order: MetacognitiveRating[] = ['excellent', 'good', 'needs_improvement', 'not_observed', 'not_applicable'];
  return (
    <div className="space-y-1.5">
      {dims.map((d) => {
        const counts = new Map<MetacognitiveRating, number>();
        for (const a of rows) {
          const v = a[d.key];
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        const total = [...counts.values()].reduce((x, y) => x + y, 0);
        return (
          <div key={d.key} className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-600 w-16 shrink-0 text-right">{d.label}</span>
            <div className="flex-1 flex gap-px h-3">
              {order.map((r) => {
                const n = counts.get(r) ?? 0;
                if (n === 0) return null;
                const colors: Record<MetacognitiveRating, string> = {
                  excellent: 'bg-emerald-300', good: 'bg-sky-300', needs_improvement: 'bg-amber-300',
                  not_observed: 'bg-slate-200', not_applicable: 'bg-slate-100',
                };
                return (
                  <div key={r} className={`${colors[r]} flex items-center justify-center`}
                    style={{ width: `${(n / rows.length) * 100}%` }}
                    title={`${RATING_LABELS[r]}: ${n}`}>
                    {n >= 2 && <span className="text-[8px] text-slate-700">{n}</span>}
                  </div>
                );
              })}
            </div>
            {total === 0 && <span className="text-[9px] text-slate-400">not rated</span>}
          </div>
        );
      })}
      <p className="text-[9px] text-slate-400 pt-0.5">Share of {rows.length} approved assessments per qualitative category. Unrated dimensions shown as missing, never as &ldquo;Not Applicable&rdquo;.</p>
    </div>
  );
}
