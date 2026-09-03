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
}

/**
 * Inserts a structured event into the event_logs table.
 * Events are append-only for research integrity.
 * Returns the inserted row id or null on failure.
 */
export async function logEvent(params: LogEventParams): Promise<string | null> {
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
      metadata: params.metadata ?? {},
    })
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to log event:', error.message, params.eventType);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Convenience helper that resolves the current user id inline.
 */
async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
