// Unit tests for questionnaire validation, SUS scoring and export shapes.
// Run: npx tsx src/lib/surveys.test.ts

import { SURVEY_TEMPLATES, newItemId, responsesLong, responsesWide, susScore, validateAnswers, type Survey, type SurveyResponse } from './surveys';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`); }
  else console.log(`ok   ${name}`);
}

const sus = SURVEY_TEMPLATES.find((t) => t.key === 'sus')!.survey;
const answersFor = (odd: number, even: number) => Object.fromEntries(sus.items.map((i) => [i.id, i.scaleIndex! % 2 === 1 ? odd : even]));

// ---- SUS --------------------------------------------------------------------
check('SUS template has 10 items numbered 1–10', sus.items.map((i) => i.scaleIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
check('SUS: all neutral = 50', susScore(sus.items, answersFor(3, 3)), 50);
check('SUS: best possible = 100', susScore(sus.items, answersFor(5, 1)), 100);
check('SUS: worst possible = 0', susScore(sus.items, answersFor(1, 5)), 0);
// Hand-calculated: odd items (answer-1) 3+3+3+4+2 = 15; even items (5-answer) 3+4+3+3+2 = 15; (15+15) x 2.5 = 75.
check('SUS: mixed example = 75 (hand-calculated)', susScore(sus.items, { sus1: 4, sus2: 2, sus3: 4, sus4: 1, sus5: 4, sus6: 2, sus7: 5, sus8: 2, sus9: 3, sus10: 3 }), 75);
check('SUS: incomplete answers → null', susScore(sus.items, { sus1: 4 }), null);
check('SUS: not a SUS survey → null', susScore(SURVEY_TEMPLATES[0].survey.items, {}), null);

// ---- Validation ---------------------------------------------------------------
const items = [
  { id: 'a', text: 'Likert', type: 'likert5' as const, required: true },
  { id: 'b', text: 'Choice', type: 'choice' as const, options: ['Yes', 'No'], required: true },
  { id: 'c', text: 'Optional text', type: 'text' as const, required: false },
];
check('validation: required items missing', Object.keys(validateAnswers(items, {})), ['a', 'b']);
check('validation: optional text may be empty', validateAnswers(items, { a: 3, b: 'Yes', c: '  ' }), {});
check('validation: out-of-range Likert and unknown choice rejected', Object.keys(validateAnswers(items, { a: 6, b: 'Maybe' })), ['a', 'b']);
check('validation: whitespace-only text counts as unanswered', Object.keys(validateAnswers([{ id: 't', text: 'x', type: 'text', required: true }], { t: '   ' })), ['t']);

// ---- Item ids -------------------------------------------------------------------
check('new item ids skip used ones', newItemId([{ id: 'q1', text: '', type: 'text' }, { id: 'q2', text: '', type: 'text' }]), 'q3');
check('new item ids avoid collisions after deletes', newItemId([{ id: 'q2', text: '', type: 'text' }]), 'q3');

// ---- Exports -------------------------------------------------------------------------
const pre: Survey = { id: 's-pre', title: 'Before you start', description: '', kind: 'pre', required_before_tasks: true, active: true, items: [{ id: 'q1', text: 'Exp?', type: 'choice', options: ['None', 'Some'] }] };
const post: Survey = { id: 's-post', title: 'Using PAUSE', description: '', kind: 'post', required_before_tasks: false, active: true, items: [{ id: 'q1', text: 'Easy?', type: 'likert5' }, ...sus.items] };
const responses: SurveyResponse[] = [
  { id: 'r1', survey_id: 's-pre', student_id: 'u1', participant_id: 'P-1', answers: { q1: 'Some' }, started_at: '2026-11-09T10:00:00Z', submitted_at: '2026-11-09T10:02:30Z' },
  { id: 'r2', survey_id: 's-post', student_id: 'u1', participant_id: 'P-1', answers: { q1: 4, ...answersFor(5, 1) }, started_at: null, submitted_at: '2026-11-09T11:00:00Z' },
];
const long = responsesLong([pre, post], responses);
check('long: one row per answered item', long.length, 12);
check('long: carries survey and item details', long[0], { participant_id: 'P-1', survey_id: 's-pre', survey_title: 'Before you start', kind: 'pre', item_id: 'q1', item_text: 'Exp?', item_type: 'choice', value: 'Some', submitted_at: '2026-11-09T10:02:30Z' });
const wide = responsesWide([pre, post], responses);
check('wide: duplicate item ids are prefixed with the survey title', ['before_you_start__q1', 'using_pause__q1'].every((c) => c in wide[0]), true);
check('wide: every row has the same columns', JSON.stringify(Object.keys(wide[0])) === JSON.stringify(Object.keys(wide[1])), true);
check('wide: values, duration and SUS score', [wide[0].before_you_start__q1, wide[0].duration_seconds, wide[0].sus_score, wide[1].using_pause__q1, wide[1].sus_score, wide[1].sus1], ['Some', 150, '', 4, 100, 5]);

console.log(failures === 0 ? '\nAll survey tests passed.' : `\n${failures} test(s) FAILED.`);
if (failures > 0) process.exit(1);
