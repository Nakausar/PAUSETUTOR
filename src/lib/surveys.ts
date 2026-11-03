/**
 * Pre/post questionnaires: types, templates, validation, scoring and export
 * shapes. Pure functions only (no React or database code), so they are unit-tested.
 */

export type SurveyKind = 'pre' | 'post' | 'other';
export type SurveyItemType = 'likert5' | 'likert7' | 'choice' | 'text';

export interface SurveyItem {
  id: string;
  text: string;
  type: SurveyItemType;
  /** Choice options (type 'choice' only). */
  options?: string[];
  required?: boolean;
  /** 'sus' marks System Usability Scale items; scaleIndex is the SUS item number (1–10). */
  scale?: 'sus';
  scaleIndex?: number;
}

export interface Survey {
  id: string;
  title: string;
  description: string;
  kind: SurveyKind;
  required_before_tasks: boolean;
  items: SurveyItem[];
  active: boolean;
  created_at?: string;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  student_id: string;
  participant_id: string;
  answers: Record<string, string | number>;
  started_at: string | null;
  submitted_at: string;
}

export const LIKERT_LABELS: Record<'likert5' | 'likert7', string[]> = {
  likert5: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
  likert7: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neutral', 'Somewhat agree', 'Agree', 'Strongly agree'],
};

export const ITEM_TYPE_LABELS: Record<SurveyItemType, string> = {
  likert5: 'Agree scale (1–5)',
  likert7: 'Agree scale (1–7)',
  choice: 'Multiple choice',
  text: 'Open text',
};

/** Returns a message per unanswered required item (empty object = valid). */
export function validateAnswers(items: SurveyItem[], answers: Record<string, string | number>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of items) {
    const value = answers[item.id];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (item.required !== false && empty) { errors[item.id] = 'Please answer this question.'; continue; }
    if (empty) continue;
    if (item.type === 'likert5' || item.type === 'likert7') {
      const max = item.type === 'likert5' ? 5 : 7;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) errors[item.id] = `Choose a value from 1 to ${max}.`;
    }
    if (item.type === 'choice' && !(item.options ?? []).includes(String(value))) errors[item.id] = 'Choose one of the options.';
  }
  return errors;
}

/**
 * System Usability Scale score (0–100; Brooke, 1996). Odd items contribute
 * (answer − 1), even items (5 − answer); the sum is multiplied by 2.5.
 * Returns null unless all ten SUS items were answered on the 1–5 scale.
 */
export function susScore(items: SurveyItem[], answers: Record<string, string | number>): number | null {
  const sus = items.filter((i) => i.scale === 'sus' && i.scaleIndex && i.scaleIndex >= 1 && i.scaleIndex <= 10);
  if (sus.length !== 10 || new Set(sus.map((i) => i.scaleIndex)).size !== 10) return null;
  let total = 0;
  for (const item of sus) {
    const v = answers[item.id];
    if (typeof v !== 'number' || v < 1 || v > 5) return null;
    total += item.scaleIndex! % 2 === 1 ? v - 1 : 5 - v;
  }
  return total * 2.5;
}

/** Makes a short unique item id for a new question. */
export function newItemId(existing: SurveyItem[]): string {
  const used = new Set(existing.map((i) => i.id));
  let n = existing.length + 1;
  while (used.has(`q${n}`)) n++;
  return `q${n}`;
}

const EXPERIENCE = ['None', 'Less than 6 months', '6–12 months', '1–2 years', 'More than 2 years'];

/** Ready-made questionnaires. Background and reflection items are examples, not validated instruments. */
export const SURVEY_TEMPLATES: { key: string; label: string; note: string; survey: Omit<Survey, 'id' | 'active'> }[] = [
  {
    key: 'background',
    label: 'Background (pre)',
    note: 'Example background questions (prior experience, AI use, confidence). Not a validated instrument: adapt or add the items of your chosen scale.',
    survey: {
      title: 'Before you start',
      description: 'A few questions about your experience. This takes about 2 minutes. There are no right or wrong answers.',
      kind: 'pre',
      required_before_tasks: true,
      items: [
        { id: 'prog_experience', text: 'How long have you been programming (in any language)?', type: 'choice', options: EXPERIENCE, required: true },
        { id: 'python_experience', text: 'How long have you been programming in Python?', type: 'choice', options: EXPERIENCE, required: true },
        { id: 'ai_use_frequency', text: 'How often do you use AI tools (such as ChatGPT or Copilot) when programming?', type: 'choice', options: ['Never', 'Rarely', 'A few times a month', 'Weekly', 'Daily'], required: true },
        { id: 'conf_independent', text: 'I feel confident writing a small Python program on my own.', type: 'likert5', required: true },
        { id: 'plan_before_coding', text: 'Before I start coding, I usually plan how I will solve the problem.', type: 'likert5', required: true },
        { id: 'check_ai_code', text: 'When I use AI-generated code, I check whether it is correct before using it.', type: 'likert5', required: true },
      ],
    },
  },
  {
    key: 'sus',
    label: 'System Usability Scale (post)',
    note: 'The standard 10-item SUS (Brooke, 1996), free to use. Exports include the 0–100 SUS score.',
    survey: {
      title: 'Using PAUSE',
      description: 'Please rate how much you agree with each statement about PAUSE ("the system").',
      kind: 'post',
      required_before_tasks: false,
      items: [
        'I think that I would like to use this system frequently.',
        'I found the system unnecessarily complex.',
        'I thought the system was easy to use.',
        'I think that I would need the support of a technical person to be able to use this system.',
        'I found the various functions in this system were well integrated.',
        'I thought there was too much inconsistency in this system.',
        'I would imagine that most people would learn to use this system very quickly.',
        'I found the system very cumbersome to use.',
        'I felt very confident using the system.',
        'I needed to learn a lot of things before I could get going with this system.',
      ].map((text, i) => ({ id: `sus${i + 1}`, text, type: 'likert5' as const, required: true, scale: 'sus' as const, scaleIndex: i + 1 })),
    },
  },
  {
    key: 'reflection',
    label: 'Study reflection (post)',
    note: 'Example post-study questions on perceived usefulness and regulation, plus AI use outside PAUSE. Not a validated instrument.',
    survey: {
      title: 'Looking back',
      description: 'A few final questions about working with PAUSE. Your answers are anonymous to other students.',
      kind: 'post',
      required_before_tasks: false,
      items: [
        { id: 'useful_plan', text: 'Planning before coding helped me solve the tasks.', type: 'likert5', required: true },
        { id: 'useful_scrutinise', text: 'Checking the AI responses made me think more carefully about my code.', type: 'likert5', required: true },
        { id: 'own_understanding', text: 'I understand the final solutions I submitted.', type: 'likert5', required: true },
        { id: 'outside_ai', text: 'During the tasks, did you use AI tools outside PAUSE (for example ChatGPT in another tab)?', type: 'choice', options: ['No', 'Once or twice', 'Several times', 'Prefer not to say'], required: true },
        { id: 'helped_most', text: 'What helped you most?', type: 'text', required: false },
        { id: 'got_in_way', text: 'What got in the way, or what would you change?', type: 'text', required: false },
      ],
    },
  },
];

type Row = Record<string, string | number>;

/** Long format: one row per answered item. */
export function responsesLong(surveys: Survey[], responses: SurveyResponse[]): Row[] {
  const byId = new Map(surveys.map((s) => [s.id, s]));
  const rows: Row[] = [];
  for (const r of responses) {
    const s = byId.get(r.survey_id);
    if (!s) continue;
    for (const item of s.items) {
      if (!(item.id in r.answers)) continue;
      rows.push({
        participant_id: r.participant_id, survey_id: s.id, survey_title: s.title, kind: s.kind,
        item_id: item.id, item_text: item.text, item_type: item.type, value: r.answers[item.id], submitted_at: r.submitted_at,
      });
    }
  }
  return rows;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'survey';
}

/**
 * Column name for an item in the wide export: the item id, prefixed with the
 * survey title when the same id is used in more than one survey.
 */
function columnNames(surveys: Survey[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const s of surveys) for (const i of s.items) count.set(i.id, (count.get(i.id) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const s of surveys) for (const i of s.items) names.set(`${s.id}:${i.id}`, (count.get(i.id) ?? 0) > 1 ? `${slug(s.title)}__${i.id}` : i.id);
  return names;
}

/** Wide format: one row per response, one column per item (+ SUS score and duration). All rows share the same columns. */
export function responsesWide(surveys: Survey[], responses: SurveyResponse[]): Row[] {
  const byId = new Map(surveys.map((s) => [s.id, s]));
  const names = columnNames(surveys);
  const columns = [...new Set(names.values())];
  const hasSus = surveys.some((s) => susScore(s.items, Object.fromEntries(s.items.map((i) => [i.id, 3]))) !== null);
  const rows: Row[] = [];
  for (const r of responses) {
    const s = byId.get(r.survey_id);
    if (!s) continue;
    const duration = r.started_at ? Math.round((new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime()) / 1000) : '';
    const row: Row = { participant_id: r.participant_id, survey_id: s.id, survey_title: s.title, kind: s.kind, submitted_at: r.submitted_at, duration_seconds: duration };
    if (hasSus) row.sus_score = susScore(s.items, r.answers) ?? '';
    for (const col of columns) row[col] = '';
    for (const item of s.items) row[names.get(`${s.id}:${item.id}`)!] = r.answers[item.id] ?? '';
    rows.push(row);
  }
  return rows;
}
