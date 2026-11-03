// Unit tests for paste provenance, diff stats and the TNA codebook.
// Run: npx tsx src/lib/researchLogging.test.ts

import { classifyPaste, diffStats, extractCodeBlocks, lineSimilarity } from './provenance';
import { buildLongSequences, buildRelianceSummary, buildWideSequences, toAction, type EventRow } from './tnaCodebook';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
  else console.log(`ok   ${name}`);
}

// ---- Paste provenance --------------------------------------------------------
const aiResponse = 'Try this:\n```python\nfor i in range(n):\n    if i % 2 == 0:\n        print(i)\n```\nIt prints even numbers.';
const responses = [{ id: 'ai-1', response: 'Use a loop.' }, { id: 'ai-2', response: aiResponse }];

check('exact AI paste (whitespace differences ignored)',
  classifyPaste('for i in range(n):\n  if i % 2 == 0:\n      print(i)', responses, null).match, 'exact_ai');
check('exact AI paste names the interaction',
  classifyPaste('for i in range(n):\n    if i % 2 == 0:', responses, null).interaction_id, 'ai-2');
check('partial AI paste (2 of 3 lines from AI)',
  classifyPaste('for i in range(n):\n    if i % 2 == 0:\n        total += i', responses, null),
  { match: 'partial_ai', interaction_id: 'ai-2', line_overlap: 0.67 });
check('own code is not AI',
  classifyPaste('total = 0\nfor x in data:\n    total += x', responses, null).match, 'none');
check('short paste only matches via the copy record',
  classifyPaste('print(i)', responses, null).match, 'none');
check('paste equal to text copied from AI',
  classifyPaste('print(i)', responses, { text: 'print(i)', interactionId: 'ai-2', at: 0 }),
  { match: 'copied_from_ai', interaction_id: 'ai-2', line_overlap: 1 });

// ---- Diff stats --------------------------------------------------------------
check('diff: insertion in the middle', diffStats('abcdef', 'abcXYdef'), { chars_added: 2, chars_removed: 0, lines_before: 1, lines_after: 1 });
check('diff: replacement', diffStats('x = 1\ny = 2', 'x = 1\ny = 3\nz = 4'), { chars_added: 7, chars_removed: 1, lines_before: 2, lines_after: 3 });
check('diff: deletion to empty', diffStats('abc', ''), { chars_added: 0, chars_removed: 3, lines_before: 1, lines_after: 0 });
check('diff: repeated characters', diffStats('aaa', 'aaaa'), { chars_added: 1, chars_removed: 0, lines_before: 1, lines_after: 1 });

// ---- Similarity --------------------------------------------------------------
check('code blocks extracted from AI response', extractCodeBlocks(aiResponse), 'for i in range(n):\n    if i % 2 == 0:\n        print(i)\n');
check('identical code similarity 1', lineSimilarity('a\nb\nc', 'a\nb\nc'), 1);
check('half-shared code similarity', lineSimilarity('a\nb\nc\nd', 'a\nb\nx\ny'), 0.5);
check('no AI code block → empty', extractCodeBlocks('Think about the loop condition.'), '');

// ---- TNA codebook ------------------------------------------------------------
const ev = (id: string, session: string, t: string, type: string, metadata: Record<string, unknown> = {}): EventRow =>
  ({ id, session_id: session, participant_id: `P-${session}`, task_id: 'task', timestamp: `2026-11-05T10:00:${t}Z`, pause_phase: 'attempt', event_type: type, metadata });

check('paste into code from AI → PasteAI', toAction(ev('1', 's', '00', 'TEXT_PASTED', { field: 'code', provenance: 'exact_ai' })), 'PasteAI');
check('paste into code from elsewhere → Paste', toAction(ev('1', 's', '00', 'TEXT_PASTED', { field: 'code', provenance: 'none' })), 'Paste');
check('paste into plan is not an action', toAction(ev('1', 's', '00', 'TEXT_PASTED', { field: 'plan', provenance: 'none' })), null);
check('system bookkeeping dropped', toAction(ev('1', 's', '00', 'AI_RESPONSE')), null);
check('test with system error dropped', toAction(ev('1', 's', '00', 'TEST', { system_error: true })), null);

const events: EventRow[] = [
  ev('a3', 's1', '30', 'CODE_RUN'),
  ev('a1', 's1', '10', 'PLAN_SUBMITTED'),
  ev('a2', 's1', '20', 'CODE_AUTOSAVED', { chars_added: 120 }),
  ev('a4', 's1', '40', 'PHASE_TRANSITION'),
  ev('a5', 's1', '50', 'HINT_REQUEST'),
  ev('a6', 's1', '55', 'TEXT_PASTED', { field: 'code', provenance: 'exact_ai', length: 40 }),
  ev('a7', 's1', '59', 'TEST', { passed: 2, total: 3 }),
  ev('b1', 's2', '05', 'PLAN_SUBMITTED'),
  ev('b2', 's2', '06', 'FOCUS_LOST'),
  ev('b3', 's2', '07', 'FOCUS_RETURNED', { away_ms: 30000 }),
  ev('b4', 's2', '08', 'ERROR'),
];
const long = buildLongSequences(events);
check('long: ordered, bookkeeping dropped', long.filter((s) => s.session_id === 's1').map((s) => s.action), ['Plan', 'Edit', 'Run', 'AskHint', 'PasteAI', 'Test']);
check('long: order numbers per session', long.filter((s) => s.session_id === 's2').map((s) => s.order), [1, 2, 3]);
const wide = buildWideSequences(long);
check('wide: padded to the longest session', wide.find((r) => r.session_id === 's2'), { session_id: 's2', participant_id: 'P-s2', task_id: 'task', length: 3, T1: 'Plan', T2: 'Away', T3: 'Error', T4: '', T5: '', T6: '' });

const reliance = buildRelianceSummary(events, new Map([['s1', 'for i in range(n):\n    print(i)']]), new Map([['s1', [aiResponse]]]));
const r1 = reliance.find((r) => r.session_id === 's1')!;
check('reliance: counts', [r1.ai_requests, r1.code_pastes_from_ai, r1.pasted_chars_from_ai, r1.runs, r1.test_runs, r1.last_test_pass_rate], [1, 1, 40, 1, 1, 0.67]);
check('reliance: typing estimate excludes pasted characters', r1.chars_typed_estimate, 80);
check('reliance: final code similarity to AI code', r1.final_code_ai_similarity, 0.67);
const r2 = reliance.find((r) => r.session_id === 's2')!;
check('reliance: away time and error runs', [r2.away_count, r2.away_total_seconds, r2.runs, r2.errors, r2.final_code_ai_similarity], [1, 30, 1, 1, '']);

console.log(failures === 0 ? '\nAll research logging tests passed.' : `\n${failures} test(s) FAILED.`);
if (failures > 0) process.exit(1);
