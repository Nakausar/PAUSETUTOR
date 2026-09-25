import type { AICategory, PausePhase } from './types';

export const PHASES: { key: PausePhase; letter: string; label: string; full: string }[] = [
  { key: 'plan', letter: 'P', label: 'Plan', full: 'Plan' },
  { key: 'attempt', letter: 'A', label: 'Attempt', full: 'Attempt' },
  { key: 'use_ai', letter: 'U', label: 'Use AI', full: 'Use AI Strategically' },
  { key: 'scrutinise', letter: 'S', label: 'Scrutinise & Revise', full: 'Scrutinise & Revise' },
  { key: 'evaluate', letter: 'E', label: 'Evaluate & Reflect', full: 'Evaluate & Reflect' },
];

export const PHASE_LABELS: Record<PausePhase, string> = {
  plan: 'Plan',
  attempt: 'Attempt',
  use_ai: 'Use AI Strategically',
  scrutinise: 'Scrutinise & Revise',
  evaluate: 'Evaluate & Reflect',
  completed: 'Completed',
};

export const AI_CATEGORIES: { key: AICategory; label: string; description: string; icon: string }[] = [
  {
    key: 'explain_concept',
    label: 'Explain a concept',
    description: 'Help me understand the relevant programming concept.',
    icon: 'BookOpen',
  },
  {
    key: 'hint',
    label: 'Give me a hint',
    description: 'Provide a small hint without giving the complete solution.',
    icon: 'Lightbulb',
  },
  {
    key: 'debug',
    label: 'Help me debug',
    description: 'Guide me in identifying the problem in my existing code.',
    icon: 'Bug',
  },
  {
    key: 'review_approach',
    label: 'Review my approach',
    description: 'Evaluate my proposed strategy without replacing it.',
    icon: 'ClipboardCheck',
  },
  {
    key: 'explain_error',
    label: 'Explain this error',
    description: 'Help me understand an error message.',
    icon: 'AlertCircle',
  },
  {
    key: 'targeted_question',
    label: 'Ask a targeted question',
    description: 'Write a specific question for the AI tutor.',
    icon: 'MessageCircleQuestion',
  },
  {
    key: 'solution_request',
    label: 'Request complete solution',
    description: 'Ask the AI for a full solution. This is logged for research.',
    icon: 'FileCode',
  },
];

export const AI_CATEGORY_LABELS: Record<AICategory, string> = {
  explain_concept: 'Explain a concept',
  hint: 'Hint',
  debug: 'Debug help',
  review_approach: 'Approach review',
  explain_error: 'Error explanation',
  targeted_question: 'Targeted question',
  solution_request: 'Complete solution request',
};

export const AI_HELP_REFLECTION_OPTIONS = AI_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));

export const REFLECT_CONSTANTS = {
  difficulty: [
    { key: 'understanding_problem', label: 'Understanding the problem' },
    { key: 'planning', label: 'Planning' },
    { key: 'writing_code', label: 'Writing the code' },
    { key: 'debugging', label: 'Debugging' },
    { key: 'understanding_ai', label: 'Understanding the AI response' },
    { key: 'checking_ai', label: 'Checking whether the AI was correct' },
    { key: 'testing', label: 'Testing' },
    { key: 'nothing_difficult', label: 'Nothing particularly difficult' },
  ],
  perceived_independence: [
    { key: 'almost_all', label: 'Almost all' },
    { key: 'most', label: 'Most' },
    { key: 'about_half', label: 'About half' },
    { key: 'small_part', label: 'A small part' },
    { key: 'very_little', label: 'Very little' },
  ],
  ai_disagreement: [
    { key: 'yes', label: 'Yes' },
    { key: 'partly', label: 'Partly' },
    { key: 'no', label: 'No' },
    { key: 'unsure', label: 'Unsure' },
  ],
  perceived_independent_ability: [
    { key: 'definitely_yes', label: 'Definitely yes' },
    { key: 'probably_yes', label: 'Probably yes' },
    { key: 'not_sure', label: 'Not sure' },
    { key: 'probably_no', label: 'Probably no' },
    { key: 'definitely_no', label: 'Definitely no' },
  ],
} as const;

export const ACCURACY_JUDGMENT_OPTIONS = [
  { key: 'correct', label: 'Correct' },
  { key: 'mostly_correct', label: 'Mostly correct' },
  { key: 'partly_correct', label: 'Partly correct' },
  { key: 'incorrect', label: 'Incorrect' },
  { key: 'unsure', label: 'Unsure' },
] as const;

export const INTENDED_ACTION_OPTIONS = [
  { key: 'test', label: 'Test it' },
  { key: 'modify', label: 'Modify it' },
  { key: 'use_part', label: 'Use part of it' },
  { key: 'own_version', label: 'Write my own version' },
  { key: 'clarify', label: 'Ask for clarification' },
  { key: 'reject', label: 'Reject it' },
] as const;

export const DEFAULT_SYSTEM_PROMPT = `You are the PAUSE AI Tutor, an educational programming assistant. Your purpose is to support student learning without unnecessarily replacing student reasoning.

Use the student's existing plan, independent attempt, code, errors, and previous interactions as context.

Prefer explanations, questions, hints, debugging guidance, and feedback over immediately providing complete solutions.

Encourage the learner to reason about the problem, modify their own code, test suggestions, verify outputs, and explain their understanding.

Do not falsely claim that AI output is correct. Encourage verification.

The learner remains responsible for the final solution.`;
