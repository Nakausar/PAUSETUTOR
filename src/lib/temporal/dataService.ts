// Read-only Supabase retrieval for the Temporal Analysis module.
// Paginates past the 1000-row default so analyses cover all matching records.

import { supabase } from '../supabase';
import { dedupeEvents, ANALYSIS_VERSION } from './analysis';
import type { EventLog, AIInteraction, ScrutinyResponse, Assessment, Session, Task, Plan } from '../types';

const PAGE_SIZE = 1000;

async function fetchAll<T extends { id?: string }>(table: string, columns: string, orderBy: string, ascending: boolean): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to load ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export const CACHE_TTL_MS = 60_000;

export interface TemporalDataset {
  sessions: Session[];
  tasks: Task[];
  events: EventLog[];
  aiInteractions: AIInteraction[];
  scrutiny: ScrutinyResponse[];
  plans: Plan[];
  assessments: Assessment[];
  fetchedAt: string;
  duplicateEventsRemoved: number;
  /** Ids of event rows excluded from the derived analytical dataset (exclusion audit trail). */
  excludedEventIds: string[];
  analysisVersion: string;
}

interface CacheEntry {
  dataset: TemporalDataset;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

export function invalidateCache() {
  cache = null;
}

export async function loadTemporalDataset(force = false): Promise<TemporalDataset> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.dataset;
  }
  const [sessions, tasks, events, aiInteractions, scrutiny, plans, assessments] = await Promise.all([
    fetchAll<Session>('sessions', '*', 'started_at', true),
    fetchAll<Task>('tasks', 'id, title, language, difficulty', 'title', true),
    fetchAll<EventLog>('event_logs', 'id, participant_id, student_id, session_id, task_id, timestamp, pause_phase, event_type, event_description, code_snapshot_id, ai_interaction_id, metadata', 'timestamp', true),
    // '*' so this works before and after the day 4 migration (parent_interaction_id).
    fetchAll<AIInteraction>('ai_interactions', '*', 'created_at', true),
    fetchAll<ScrutinyResponse>('scrutiny_responses', 'id, participant_id, student_id, session_id, ai_interaction_id, accuracy_judgment, intended_action, action_taken, test_result, produced_expected_result, code_before, code_after, created_at', 'created_at', true),
    fetchAll<Plan>('plans', 'id, participant_id, session_id, student_id, plan_text, confidence, version, created_after_ai, created_at', 'created_at', true),
    fetchAll<Assessment>('assessments', '*', 'updated_at', true),
  ]);
  const { kept, duplicateCount, excludedIds } = dedupeEvents(events);
  const dataset: TemporalDataset = {
    sessions,
    tasks,
    events: kept,
    // Follow-up questions belong to their root request; the temporal analysis
    // counts root requests only (follow-ups appear as FollowUp in the TNA export).
    aiInteractions: aiInteractions.filter((i) => !i.parent_interaction_id),
    scrutiny,
    plans,
    assessments,
    fetchedAt: new Date().toISOString(),
    duplicateEventsRemoved: duplicateCount,
    excludedEventIds: excludedIds,
    analysisVersion: ANALYSIS_VERSION,
  };
  cache = { dataset, fetchedAt: Date.now() };
  return dataset;
}
