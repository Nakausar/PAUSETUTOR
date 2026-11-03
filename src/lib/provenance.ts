/**
 * Pure helpers for research logging: where pasted text came from, and how
 * much code changed between snapshots. No React or database code here so the
 * logic is easy to test and to describe in a methods section.
 */

export type PasteMatch = 'copied_from_ai' | 'exact_ai' | 'partial_ai' | 'none';

export interface PasteProvenance {
  match: PasteMatch;
  /** AI interaction the text most likely came from, if any. */
  interaction_id: string | null;
  /** Share of the pasted non-empty lines that appear in that AI response (0–1). */
  line_overlap: number;
}

export interface CopyRecord {
  text: string;
  interactionId: string | null;
  at: number;
}

/** Collapses all whitespace so formatting differences don't hide a match. */
export function normaliseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function lineSet(text: string): Set<string> {
  return new Set(text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0));
}

/**
 * Classifies a paste:
 * - copied_from_ai: identical to text the student copied from an AI response in this session
 * - exact_ai: the pasted text appears verbatim (ignoring whitespace) in an AI response
 * - partial_ai: at least 60% of the pasted non-empty lines appear in one AI response
 * - none: no meaningful overlap (typed elsewhere, own code, or another source)
 * Very short pastes (< 15 characters) are only matched via the copy record.
 */
export function classifyPaste(
  pasted: string,
  responses: { id: string; response: string }[],
  lastCopy: CopyRecord | null,
): PasteProvenance {
  const norm = normaliseText(pasted);
  if (lastCopy && norm.length > 0 && normaliseText(lastCopy.text) === norm) {
    return { match: 'copied_from_ai', interaction_id: lastCopy.interactionId, line_overlap: 1 };
  }
  if (norm.length < 15) return { match: 'none', interaction_id: null, line_overlap: 0 };

  const pastedLines = lineSet(pasted);
  let best: PasteProvenance = { match: 'none', interaction_id: null, line_overlap: 0 };
  for (const r of responses) {
    if (normaliseText(r.response).includes(norm)) {
      return { match: 'exact_ai', interaction_id: r.id, line_overlap: 1 };
    }
    if (pastedLines.size === 0) continue;
    const responseLines = lineSet(r.response);
    let shared = 0;
    for (const line of pastedLines) if (responseLines.has(line)) shared++;
    const overlap = shared / pastedLines.size;
    if (overlap > best.line_overlap) {
      best = { match: overlap >= 0.6 ? 'partial_ai' : 'none', interaction_id: overlap >= 0.6 ? r.id : null, line_overlap: Math.round(overlap * 100) / 100 };
    }
  }
  return best;
}

/** Characters added/removed between two versions (single edited region via common prefix/suffix). */
export function diffStats(before: string, after: string): { chars_added: number; chars_removed: number; lines_before: number; lines_after: number } {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {
    chars_added: after.length - prefix - suffix,
    chars_removed: before.length - prefix - suffix,
    lines_before: before ? before.split('\n').length : 0,
    lines_after: after ? after.split('\n').length : 0,
  };
}

/** Line-based similarity (0–1) between two code texts — used to compare final code with AI code. */
export function lineSimilarity(a: string, b: string): number {
  const la = lineSet(a);
  const lb = lineSet(b);
  if (la.size === 0 || lb.size === 0) return 0;
  let shared = 0;
  for (const line of la) if (lb.has(line)) shared++;
  return Math.round((shared / Math.max(la.size, lb.size)) * 100) / 100;
}

/** Extracts fenced code blocks (```...```) from an AI response; falls back to the whole text. */
export function extractCodeBlocks(response: string): string {
  const blocks = [...response.matchAll(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length > 0 ? blocks.join('\n') : '';
}
