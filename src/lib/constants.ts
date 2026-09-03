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

export const PLAN_FIELDS = [
  { key: 'problem_summary', label: 'What is the problem asking you to do?', placeholder: 'Describe the problem in your own words...' },
  { key: 'expected_inputs', label: 'What are the expected inputs?', placeholder: 'What data will the program receive?' },
  { key: 'expected_outputs', label: 'What are the expected outputs?', placeholder: 'What should the program produce?' },
  { key: 'concepts_needed', label: 'What programming concepts might you need?', placeholder: 'e.g. loops, conditionals, functions, lists...' },
  { key: 'approach_description', label: 'Describe your proposed solution approach', placeholder: 'How do you plan to solve this step by step?' },
  { key: 'pseudocode', label: 'Write pseudocode or step-by-step logic', placeholder: 'Write pseudocode here if helpful...' },
  { key: 'expected_difficulty', label: 'What part of the problem do you expect to be difficult?', placeholder: 'Which part do you think will be hardest?' },
] as const;

export const REFLECTION_FIELDS = [
  { key: 'solution_explanation', label: 'Briefly explain your final solution in your own words.', placeholder: 'Describe how your solution works...' },
  { key: 'what_was_learned', label: 'What did you learn from this task?', placeholder: 'What new understanding did you gain?' },
  { key: 'most_difficult_part', label: 'What was the most difficult part?', placeholder: 'Where did you struggle most?' },
  { key: 'useful_ai_assistance', label: 'What AI assistance was useful?', placeholder: 'Which AI help was genuinely helpful?' },
  { key: 'ai_issue_identified', label: 'Did you identify any AI suggestion that was incorrect, incomplete, or needed modification?', placeholder: 'Did the AI get anything wrong or incomplete?' },
  { key: 'changes_after_ai', label: 'What did you change after receiving AI assistance?', placeholder: 'How did you modify your code after AI help?' },
  { key: 'do_differently_next_time', label: 'What would you do differently next time?', placeholder: 'How would you approach a similar problem differently?' },
] as const;

export const SCRUTINY_FIELDS = [
  { key: 'ai_summary', label: 'What does the AI suggestion recommend?', placeholder: 'Summarise the AI recommendation...' },
  { key: 'is_correct_assessment', label: 'Do you think this suggestion is correct? Why?', placeholder: 'Assess whether the suggestion is right and why...' },
  { key: 'testing_plan', label: 'How will you test it?', placeholder: 'What test cases will you use?' },
  { key: 'changes_description', label: 'What did you change?', placeholder: 'Describe the modifications you made...' },
] as const;

export const DEFAULT_SYSTEM_PROMPT = `You are the PAUSE AI Tutor, an educational programming assistant. Your purpose is to support student learning without unnecessarily replacing student reasoning.

Use the student's existing plan, independent attempt, code, errors, and previous interactions as context.

Prefer explanations, questions, hints, debugging guidance, and feedback over immediately providing complete solutions.

Encourage the learner to reason about the problem, modify their own code, test suggestions, verify outputs, and explain their understanding.

Do not falsely claim that AI output is correct. Encourage verification.

The learner remains responsible for the final solution.`;
