// Network graph construction from real temporal data.
// Every node is a recorded event category; every edge is an observed
// chronological transition between consecutive recorded events in a session.
// No node, frequency, edge or pathway is invented.

import type { EventLog, AIInteraction, ScrutinyResponse } from '../types';
import { orderEvents, type StepToken } from './analysis';

export interface NetNode {
  id: string;
  label: string;
  color: string;
  frequency: number;
  kind: 'phase' | 'activity' | 'ai_option';
}

export interface NetEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  probability: number; // normalised over the source node's outgoing edges
}

export interface NetworkGraph {
  nodes: NetNode[];
  edges: NetEdge[];
}

export interface NetworkDataset {
  events: EventLog[];
  interactions: AIInteraction[];
  scrutiny: ScrutinyResponse[];
}

interface Unit {
  id: string;
  label: string;
  color: string;
  kind: NetNode['kind'];
  /** Which event types / categories map into this node. */
  match: (e: EventLog) => boolean;
}

const TYPE_COLORS: Record<string, string> = {
  PLAN: '#2563EB', IND_CODE: '#16A34A', AI_REQ: '#F59E0B', SCRUTINY: '#8B5CF6',
  REVISION: '#0EA5E9', TEST: '#EC4899', EVAL: '#DC2626',
};

export const UNIT_COLORS = TYPE_COLORS;

/** Classify a raw event into a pathway step token (shared semantics with sequence discovery). */
export function classifyEvent(e: EventLog): StepToken | null {
  if (e.event_type.startsWith('PLAN_')) return 'PLAN';
  if (e.event_type === 'CODE_REVISED' || e.event_type === 'INDEPENDENT_REVISION') return 'REVISION';
  if (e.event_type === 'CODE_RUN' && e.pause_phase === 'scrutinise') return 'TEST';
  if (['CODE_RUN', 'CODE_EDIT', 'ATTEMPT_STARTED', 'ATTEMPT_SAVED'].includes(e.event_type) && (e.pause_phase === 'attempt' || e.pause_phase === 'edit')) return 'IND_CODE';
  if (e.event_type === 'REFLECTION_SUBMITTED' || e.event_type === 'REFLECTION_COMPLETED') return 'EVAL';
  if (e.event_type === 'SCRUTINY_STARTED' || e.event_type.startsWith('AI_SUGGESTION_') || e.event_type === 'SCRUTINISE_SUBMITTED') return 'SCRUTINY';
  return null;
}

const ACTIVITY_UNITS: Unit[] = [
  { id: 'PLAN', label: 'Plan', color: TYPE_COLORS.PLAN, kind: 'activity', match: (e) => e.event_type.startsWith('PLAN_') },
  { id: 'IND_CODE', label: 'Independent coding', color: TYPE_COLORS.IND_CODE, kind: 'activity', match: (e) => classifyEvent(e) === 'IND_CODE' },
  { id: 'AI_REQ', label: 'AI request', color: TYPE_COLORS.AI_REQ, kind: 'activity', match: (e) => classifyEvent(e) === 'AI_REQ' },
  { id: 'SCRUTINY', label: 'Scrutiny', color: TYPE_COLORS.SCRUTINY, kind: 'activity', match: (e) => classifyEvent(e) === 'SCRUTINY' },
  { id: 'REVISION', label: 'Code revision', color: TYPE_COLORS.REVISION, kind: 'activity', match: (e) => classifyEvent(e) === 'REVISION' },
  { id: 'TEST', label: 'Code test', color: TYPE_COLORS.TEST, kind: 'activity', match: (e) => classifyEvent(e) === 'TEST' },
  { id: 'EVAL', label: 'Evaluation reflection', color: TYPE_COLORS.EVAL, kind: 'activity', match: (e) => classifyEvent(e) === 'EVAL' },
];

/** Phase-level network: nodes are the five PAUSE phases (+ archived Edit), edges are observed phase-to-phase moves. */
export function buildPhaseNetwork(data: NetworkDataset): NetworkGraph {
  return buildNetwork(data, [
    { id: 'plan', label: 'Plan', color: TYPE_COLORS.PLAN, kind: 'phase', match: (e) => e.pause_phase === 'plan' },
    { id: 'attempt', label: 'Attempt', color: TYPE_COLORS.IND_CODE, kind: 'phase', match: (e) => e.pause_phase === 'attempt' },
    { id: 'use_ai', label: 'Use AI', color: TYPE_COLORS.AI_REQ, kind: 'phase', match: (e) => e.pause_phase === 'use_ai' },
    { id: 'scrutinise', label: 'Scrutinise', color: TYPE_COLORS.SCRUTINY, kind: 'phase', match: (e) => e.pause_phase === 'scrutinise' },
    { id: 'edit', label: 'Scrutinise (Edit, archived)', color: '#A78BFA', kind: 'phase', match: (e) => e.pause_phase === 'edit' },
    { id: 'evaluate', label: 'Evaluate', color: TYPE_COLORS.EVAL, kind: 'phase', match: (e) => e.pause_phase === 'evaluate' },
  ]);
}

/** Activity-level network: nodes are concrete learning activities. */
export function buildActivityNetwork(data: NetworkDataset): NetworkGraph {
  return buildNetwork(data, ACTIVITY_UNITS);
}

export interface AiNetworkOptions {
  events: EventLog[];
  interactions: AIInteraction[];
  scrutiny: ScrutinyResponse[];
  labels: Record<string, string>;
  /** When set, only events from sessions containing this AI option are included. */
  optionFilter?: string | null;
}

/**
 * AI pathway network: independent coding, one node per exact AI assistance option
 * (labels straight from the database's ai_interactions.category), scrutiny, revisions,
 * tests and evaluation. Interactions are spliced into the event stream at their
 * recorded timestamps so edges reflect real chronological order.
 */
export function buildAiNetwork({ events, interactions, scrutiny, labels, optionFilter }: AiNetworkOptions): NetworkGraph {
  const sessionsWithOption = optionFilter
    ? new Set(interactions.filter((i) => i.category === optionFilter).map((i) => i.session_id))
    : null;

  const aiUnits: Unit[] = [];
  const seenCats = new Set(interactions.map((i) => i.category));
  for (const cat of seenCats) {
    aiUnits.push({
      id: `AI:${cat}`,
      label: labels[cat] ?? cat,
      color: TYPE_COLORS.AI_REQ,
      kind: 'ai_option',
      match: () => false, // AI events come from the interactions table, not event_logs
    });
  }
  const units: Unit[] = [
    { id: 'IND_CODE', label: 'Independent coding', color: TYPE_COLORS.IND_CODE, kind: 'activity', match: (e) => classifyEvent(e) === 'IND_CODE' },
    ...aiUnits,
    { id: 'SCRUTINY', label: 'Scrutiny', color: TYPE_COLORS.SCRUTINY, kind: 'activity', match: (e) => classifyEvent(e) === 'SCRUTINY' },
    { id: 'REVISION', label: 'Code revision', color: TYPE_COLORS.REVISION, kind: 'activity', match: (e) => classifyEvent(e) === 'REVISION' },
    { id: 'TEST', label: 'Code test', color: TYPE_COLORS.TEST, kind: 'activity', match: (e) => classifyEvent(e) === 'TEST' },
    { id: 'EVAL', label: 'Evaluation reflection', color: TYPE_COLORS.EVAL, kind: 'activity', match: (e) => classifyEvent(e) === 'EVAL' },
  ];

  const freq = new Map<string, number>();
  const edgeWeight = new Map<string, number>();
  const bumpEdge = (a: string, b: string) => {
    if (a === b) return;
    const key = `${a}\u0000${b}`;
    edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
  };

  // Group per session, merge interactions into the ordered event stream.
  const sessionIds = new Set<string>();
  for (const i of interactions) {
    if (sessionsWithOption && i.session_id !== undefined && !sessionsWithOption.has(i.session_id)) continue;
    sessionIds.add(i.session_id);
  }
  const eventsBySession = new Map<string, EventLog[]>();
  for (const e of events) {
    if (!sessionIds.has(e.session_id)) continue;
    if (sessionsWithOption && !sessionsWithOption.has(e.session_id)) continue;
    if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
    eventsBySession.get(e.session_id)!.push(e);
  }

  for (const sessionId of sessionIds) {
    const evs = orderEvents(eventsBySession.get(sessionId) ?? []);
    const sessInts = interactions.filter((i) => i.session_id === sessionId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const sessScrs = scrutiny.filter((s) => s.session_id === sessionId);
    const scTs = new Map<string, string[]>();
    for (const s of sessScrs) {
      const key = s.ai_interaction_id ?? 'unknown';
      if (!scTs.has(key)) scTs.set(key, []);
      scTs.get(key)!.push(s.created_at);
    }

    interface Stamp { ts: number; unit: string }
    const stamps: Stamp[] = [];
    for (const e of evs) {
      for (const u of units) {
        if (u.kind === 'ai_option') continue;
        if (u.match(e)) { stamps.push({ ts: new Date(e.timestamp).getTime(), unit: u.id }); break; }
      }
    }
    for (const i of sessInts) {
      stamps.push({ ts: new Date(i.created_at).getTime(), unit: `AI:${i.category}` });
      for (const ts of scTs.get(i.id) ?? []) {
        stamps.push({ ts: new Date(ts).getTime(), unit: 'SCRUTINY' });
      }
    }
    stamps.sort((a, b) => a.ts - b.ts);
    let prev: string | null = null;
    for (const st of stamps) {
      if (st.unit === prev) continue; // consecutive same-unit collapses, matching sequence semantics
      freq.set(st.unit, (freq.get(st.unit) ?? 0) + 1);
      if (prev) bumpEdge(prev, st.unit);
      prev = st.unit;
    }
  }

  return assemble(units, freq, edgeWeight);
}

function buildNetwork(data: NetworkDataset, units: Unit[]): NetworkGraph {
  const freq = new Map<string, number>();
  const edgeWeight = new Map<string, number>();
  const bumpEdge = (a: string, b: string) => {
    if (a === b) return;
    const key = `${a}\u0000${b}`;
    edgeWeight.set(key, (edgeWeight.get(key) ?? 0) + 1);
  };

  const eventsBySession = new Map<string, EventLog[]>();
  for (const e of data.events) {
    if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
    eventsBySession.get(e.session_id)!.push(e);
  }
  for (const evs of eventsBySession.values()) {
    let prev: string | null = null;
    for (const e of orderEvents(evs)) {
      let unitId: string | null = null;
      for (const u of units) {
        if (u.match(e)) { unitId = u.id; break; }
      }
      if (!unitId) continue;
      freq.set(unitId, (freq.get(unitId) ?? 0) + 1);
      if (prev && prev !== unitId) bumpEdge(prev, unitId);
      prev = unitId;
    }
  }
  return assemble(units, freq, edgeWeight);
}

function assemble(units: Unit[], freq: Map<string, number>, edgeWeight: Map<string, number>): NetworkGraph {
  const nodes: NetNode[] = units
    .filter((u) => (freq.get(u.id) ?? 0) > 0)
    .map((u) => ({ id: u.id, label: u.label, color: u.color, kind: u.kind, frequency: freq.get(u.id) ?? 0 }));
  const nodeIds = new Set(nodes.map((n) => n.id));
  const outTotal = new Map<string, number>();
  for (const [key, w] of edgeWeight) {
    const src = key.split('\u0000')[0];
    if (!nodeIds.has(src) || !nodeIds.has(key.split('\u0000')[1])) continue;
    outTotal.set(src, (outTotal.get(src) ?? 0) + w);
  }
  const edges: NetEdge[] = [];
  for (const [key, w] of edgeWeight) {
    const [source, target] = key.split('\u0000');
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    edges.push({ id: key.replace('\u0000', '->'), source, target, weight: w, probability: (outTotal.get(source) ?? 0) > 0 ? w / (outTotal.get(source) ?? 1) : 0 });
  }
  return { nodes, edges };
}

/** Reconstruct the concrete event pairs behind an edge, for the supporting-evidence drill-down. */
export function supportingTransitions(
  data: NetworkDataset,
  sourceId: string,
  targetId: string,
  resolve: (e: EventLog) => string | null,
): { sessionId: string; participantId: string; fromTs: string; toTs: string }[] {
  const rows: { sessionId: string; participantId: string; fromTs: string; toTs: string }[] = [];
  const eventsBySession = new Map<string, EventLog[]>();
  for (const e of data.events) {
    if (!eventsBySession.has(e.session_id)) eventsBySession.set(e.session_id, []);
    eventsBySession.get(e.session_id)!.push(e);
  }
  for (const evs of eventsBySession.values()) {
    const ordered = orderEvents(evs);
    let prev: { id: string; unit: string; ts: string; participantId: string } | null = null;
    for (const e of ordered) {
      const unit = resolve(e);
      if (!unit) continue;
      if (prev && prev.unit === sourceId && unit === targetId && prev.unit !== unit) {
        rows.push({ sessionId: e.session_id, participantId: e.participant_id, fromTs: prev.ts, toTs: e.timestamp });
      }
      prev = { id: e.id, unit, ts: e.timestamp, participantId: e.participant_id };
    }
  }
  return rows;
}
