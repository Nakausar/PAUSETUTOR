import { useEffect, useRef } from 'react';
import { classifyPaste, type CopyRecord } from './provenance';
import type { EventType } from './types';

/** Leaving the tab/window for less than this is not logged (avoids noise). */
export const AWAY_THRESHOLD_MS = 5000;
/** No keyboard/mouse/scroll activity for this long counts as idle. */
export const IDLE_THRESHOLD_MS = 60000;
/** Pasted/copied text stored in event metadata is capped at this many characters. */
const MAX_STORED_TEXT = 5000;

type Logger = (eventType: EventType, description: string, metadata: Record<string, unknown>) => void;

interface Options {
  enabled: boolean;
  log: Logger;
  /** AI responses in this session, used to classify where pasted text came from. */
  getResponses: () => { id: string; response: string }[];
}

/**
 * Which field an element belongs to, from the nearest `data-track` attribute
 * (e.g. data-track="code", "plan", "ai_question", "ai_response").
 */
function fieldOf(target: EventTarget | null): { field: string; interactionId: string | null } {
  const el = target instanceof Element ? target.closest<HTMLElement>('[data-track]') : null;
  return { field: el?.dataset.track ?? 'other', interactionId: el?.dataset.interactionId ?? null };
}

/**
 * Page-level activity logging for the PAUSE workspace:
 * - FOCUS_LOST / FOCUS_RETURNED: student left the tab or window (≥ 5 s)
 * - IDLE_STARTED / IDLE_ENDED: no activity for ≥ 60 s while the page is in focus
 * - TEXT_PASTED: any paste, with target field and AI provenance
 * - AI_RESPONSE_COPIED: text copied from an AI response
 */
export function useActivityTracking({ enabled, log, getResponses }: Options) {
  const logRef = useRef(log);
  const responsesRef = useRef(getResponses);
  logRef.current = log;
  responsesRef.current = getResponses;

  useEffect(() => {
    if (!enabled) return;
    const emit = (type: EventType, description: string, metadata: Record<string, unknown>) => logRef.current(type, description, metadata);

    // --- Away from the task (tab hidden or window not focused) ----------------
    let awaySince: number | null = null;
    let awayReason: 'tab_hidden' | 'window_blur' | null = null;
    let awayLogged = false;
    let awayTimer: ReturnType<typeof setTimeout> | null = null;

    const isPresent = () => document.visibilityState === 'visible' && document.hasFocus();

    const startAway = (reason: 'tab_hidden' | 'window_blur') => {
      if (awaySince !== null) {
        if (reason === 'tab_hidden') awayReason = 'tab_hidden';
        return;
      }
      awaySince = Date.now();
      awayReason = reason;
      awayLogged = false;
      awayTimer = setTimeout(() => {
        awayLogged = true;
        emit('FOCUS_LOST', awayReason === 'tab_hidden' ? 'Student switched away from the PAUSE tab.' : 'The PAUSE window lost focus (another window or app was used).', {
          reason: awayReason, started_at: new Date(awaySince ?? Date.now()).toISOString(),
        });
      }, AWAY_THRESHOLD_MS);
    };

    const endAway = () => {
      if (awaySince === null || !isPresent()) return;
      if (awayTimer) clearTimeout(awayTimer);
      if (awayLogged) {
        emit('FOCUS_RETURNED', 'Student returned to the PAUSE workspace.', {
          reason: awayReason, away_ms: Date.now() - awaySince, started_at: new Date(awaySince).toISOString(),
        });
      }
      awaySince = null; awayReason = null; awayLogged = false; awayTimer = null;
      markActive();
    };

    const onVisibility = () => (document.visibilityState === 'hidden' ? startAway('tab_hidden') : endAway());
    const onBlur = () => startAway('window_blur');
    const onFocus = () => endAway();

    // --- Idle detection -------------------------------------------------------
    let lastActivity = Date.now();
    let idleSince: number | null = null;
    const markActive = () => {
      const now = Date.now();
      if (idleSince !== null) {
        emit('IDLE_ENDED', 'Student activity resumed after an idle period.', { idle_ms: now - idleSince, started_at: new Date(idleSince).toISOString() });
        idleSince = null;
      }
      lastActivity = now;
    };
    const idleCheck = setInterval(() => {
      if (idleSince !== null || awaySince !== null || !isPresent()) return;
      if (Date.now() - lastActivity >= IDLE_THRESHOLD_MS) {
        idleSince = lastActivity;
        emit('IDLE_STARTED', 'No keyboard, mouse or scroll activity for 60 seconds.', { started_at: new Date(lastActivity).toISOString(), threshold_ms: IDLE_THRESHOLD_MS });
      }
    }, 5000);

    let lastMove = 0;
    const onMove = () => { const now = Date.now(); if (now - lastMove > 1000) { lastMove = now; markActive(); } };

    // --- Copy and paste -------------------------------------------------------
    let lastCopy: CopyRecord | null = null;

    const onCopy = (event: ClipboardEvent) => {
      const selection = document.getSelection()?.toString() ?? '';
      const { field, interactionId } = fieldOf(event.target);
      if (!selection || field !== 'ai_response') return;
      lastCopy = { text: selection, interactionId, at: Date.now() };
      emit('AI_RESPONSE_COPIED', 'Student copied text from an AI response.', {
        interaction_id: interactionId, length: selection.length, lines: selection.split('\n').length,
        text: selection.slice(0, MAX_STORED_TEXT), truncated: selection.length > MAX_STORED_TEXT,
      });
    };

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) return;
      const { field } = fieldOf(event.target);
      const provenance = classifyPaste(text, responsesRef.current(), lastCopy);
      emit('TEXT_PASTED', `Student pasted ${text.length} characters into ${field.replace('_', ' ')}.`, {
        field, length: text.length, lines: text.split('\n').length,
        provenance: provenance.match, interaction_id: provenance.interaction_id, line_overlap: provenance.line_overlap,
        ms_since_ai_copy: lastCopy ? Date.now() - lastCopy.at : null,
        text: text.slice(0, MAX_STORED_TEXT), truncated: text.length > MAX_STORED_TEXT,
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.addEventListener(type, markActive, { passive: true });
    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('paste', onPaste, true);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const) window.removeEventListener(type, markActive);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('paste', onPaste, true);
      clearInterval(idleCheck);
      if (awayTimer) clearTimeout(awayTimer);
    };
  }, [enabled]);
}
