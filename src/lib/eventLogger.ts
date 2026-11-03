import { supabase } from './supabase';
import type { EventType, PausePhase } from './types';

interface LogEventParams {
  sessionId: string;
  taskId: string;
  participantId: string;
  phase: PausePhase;
  eventType: EventType;
  description?: string;
  codeSnapshotId?: string | null;
  aiInteractionId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Stable identifier for the logical student action. Retries of the same action
   * (e.g. a re-run effect or retry after a dropped connection) must reuse the same
   * key; distinct actions get different keys. Enforced at the database level by a
   * partial unique index on event_logs (metadata->>'idem_key').
   */
  idempotencyKey?: string;
}

// Client-side exactly-once window: the same action signature logged twice within
// DUPLICATE_WINDOW_MS inserts once. This is what absorbs React StrictMode's
// development double-mount and double-firing effects for every call site,
// including ones without a natural idempotency key.
const DUPLICATE_WINDOW_MS = 1500;
export const LOG_SCHEMA_VERSION = 2;
const recentSignatures = new Map<string, number>();

function sweepRecentSignatures(now: number) {
  for (const [sig, ts] of recentSignatures) {
    if (now - ts > DUPLICATE_WINDOW_MS) recentSignatures.delete(sig);
  }
}

/**
 * Inserts a structured event into the event_logs table.
 * Events are append-only for research integrity.
 * Returns the inserted row id, or null on failure or when the action was
 * already recorded (duplicate key responses are handled gracefully, never retried).
 */
// "Research logging enabled" on the Tutor configuration page. Read at most
// once a minute; if the setting can't be read, logging stays on.
let loggingEnabled: { value: boolean; at: number } | null = null;
async function isLoggingEnabled(): Promise<boolean> {
  if (loggingEnabled && Date.now() - loggingEnabled.at < 60000) return loggingEnabled.value;
  const { data, error } = await supabase.from('system_settings').select('research_logging_enabled').eq('id', 1).maybeSingle();
  const value = error || !data ? true : (data as { research_logging_enabled: boolean }).research_logging_enabled !== false;
  loggingEnabled = { value, at: Date.now() };
  return value;
}

export async function logEvent(params: LogEventParams): Promise<string | null> {
  if (!(await isLoggingEnabled())) return null;
  const signature = `${params.sessionId}|${params.eventType}|${params.description ?? ''}|${params.aiInteractionId ?? ''}|${params.idempotencyKey ?? ''}`;
  const now = Date.now();
  sweepRecentSignatures(now);
  if (recentSignatures.has(signature)) return null;
  recentSignatures.set(signature, now);

  // log_schema 2 = events recorded after the day 3 logging update
  // (autosave snapshots, paste provenance, focus and idle events).
  const metadata = params.idempotencyKey
    ? { ...params.metadata, idem_key: params.idempotencyKey, log_schema: LOG_SCHEMA_VERSION }
    : { ...params.metadata, log_schema: LOG_SCHEMA_VERSION };
  const { data, error } = await supabase
    .from('event_logs')
    .insert({
      participant_id: params.participantId,
      student_id: (await supabase.auth.getUser()).data.user?.id,
      session_id: params.sessionId,
      task_id: params.taskId,
      pause_phase: params.phase,
      event_type: params.eventType,
      event_description: params.description ?? '',
      code_snapshot_id: params.codeSnapshotId ?? null,
      ai_interaction_id: params.aiInteractionId ?? null,
      metadata,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return null; // action already recorded — exactly-once semantics
    console.error('Failed to log event:', error.message, params.eventType);
    return null;
  }
  return data?.id ?? null;
}
