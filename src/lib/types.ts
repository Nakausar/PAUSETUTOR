export type UserRole = 'student' | 'researcher';

export type PausePhase = 'plan' | 'attempt' | 'use_ai' | 'scrutinise' | 'evaluate' | 'completed';

export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

export type AICategory =
  | 'explain_concept'
  | 'hint'
  | 'debug'
  | 'review_approach'
  | 'explain_error'
  | 'targeted_question'
  | 'solution_request';

export type ScrutinyAction = 'accepted' | 'modified' | 'rejected' | '';

export type EventType =
  // Plan
  | 'PLAN_STARTED'
  | 'PROBLEM_ANALYSIS'
  | 'GOAL_SET'
  | 'PLAN_CREATED'
  | 'PSEUDOCODE_CREATED'
  | 'PLAN_COMPLETED'
  // Attempt
  | 'ATTEMPT_STARTED'
  | 'CODE_EDIT'
  | 'CODE_RUN'
  | 'ERROR'
  | 'EXECUTION_ERROR'
  | 'INDEPENDENT_REVISION'
  | 'ATTEMPT_SAVED'
  | 'ATTEMPT_COMPLETED'
  // Use AI
  | 'AI_HELP_STARTED'
  | 'HINT_REQUEST'
  | 'EXPLANATION_REQUEST'
  | 'DEBUG_REQUEST'
  | 'APPROACH_REVIEW_REQUEST'
  | 'ERROR_EXPLANATION_REQUEST'
  | 'TARGETED_QUESTION'
  | 'SOLUTION_REQUEST'
  | 'AI_RESPONSE'
  | 'AI_HELP_COMPLETED'
  // Scrutinise
  | 'SCRUTINY_STARTED'
  | 'AI_OUTPUT_REVIEWED'
  | 'TEST'
  | 'VERIFY'
  | 'COMPARE'
  | 'AI_SUGGESTION_ACCEPTED'
  | 'AI_SUGGESTION_MODIFIED'
  | 'AI_SUGGESTION_REJECTED'
  | 'CODE_REVISED'
  | 'ERROR_FIXED'
  | 'SCRUTINY_COMPLETED'
  // Evaluate
  | 'REFLECTION_STARTED'
  | 'SOLUTION_EXPLAINED'
  | 'LEARNING_REFLECTION'
  | 'AI_HELP_EVALUATED'
  | 'SELF_EVALUATION'
  | 'CONFIDENCE_RECORDED'
  | 'REFLECTION_COMPLETED'
  | 'TASK_COMPLETED'
  // Assignment and session lifecycle
  | 'TASK_ASSIGNED'
  | 'SESSION_STARTED'
  // Transitions
  | 'PHASE_TRANSITION';

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  participant_id: string;
  consent_acknowledged: boolean;
  research_logging_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  language: string;
  difficulty: string;
  learning_objectives: string;
  problem_description: string;
  expected_inputs: string;
  expected_outputs: string;
  starter_code: string;
  test_cases: TestCase[];
  concept_tags: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestCase {
  input: string;
  expected: string;
}

export type AssignmentStatus = 'not_started' | 'in_progress' | 'completed';

export interface TaskAssignment {
  id: string;
  task_id: string;
  student_id: string;
  participant_id: string | null;
  assigned_by: string | null;
  assigned_at: string;
  status: AssignmentStatus;
  started_at: string | null;
  completed_at: string | null;
  current_pause_phase: PausePhase | null;
  session_id: string | null;
  task?: Task;
}

export interface Session {
  id: string;
  task_id: string;
  student_id: string;
  participant_id: string;
  current_phase: PausePhase;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
  last_active_at: string;
  task?: Task;
}

export interface Plan {
  id: string;
  session_id: string;
  student_id: string;
  participant_id: string;
  problem_summary: string;
  expected_inputs: string;
  expected_outputs: string;
  concepts_needed: string;
  approach_description: string;
  pseudocode: string;
  expected_difficulty: string;
  created_at: string;
  updated_at: string;
}

export interface CodeAttempt {
  id: string;
  session_id: string;
  student_id: string;
  participant_id: string;
  current_code: string;
  run_count: number;
  revision_count: number;
  last_error: string | null;
  last_output: string | null;
  last_run_at: string | null;
  started_at: string;
  updated_at: string;
}

export interface CodeSnapshot {
  id: string;
  attempt_id: string;
  session_id: string;
  student_id: string;
  participant_id: string;
  code: string;
  phase: PausePhase;
  trigger: string;
  output: string | null;
  error: string | null;
  run_number: number | null;
  stdin: string | null;
  created_at: string;
}

export interface AIInteraction {
  id: string;
  session_id: string;
  student_id: string;
  participant_id: string;
  category: AICategory;
  prompt: string;
  response: string;
  context_code: string | null;
  context_error: string | null;
  context_plan: Record<string, unknown> | null;
  full_solution_requested: boolean;
  created_at: string;
}

export interface ScrutinyResponse {
  id: string;
  session_id: string;
  ai_interaction_id: string | null;
  student_id: string;
  participant_id: string;
  ai_summary: string;
  is_correct_assessment: string;
  testing_plan: string;
  action_taken: ScrutinyAction;
  changes_description: string;
  revised_code: string;
  code_before: string;
  code_after: string;
  test_result: string;
  produced_expected_result: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Reflection {
  id: string;
  session_id: string;
  student_id: string;
  participant_id: string;
  solution_explanation: string;
  what_was_learned: string;
  most_difficult_part: string;
  useful_ai_assistance: string;
  ai_issue_identified: string;
  changes_after_ai: string;
  do_differently_next_time: string;
  confidence_without_ai: number;
  created_at: string;
  updated_at: string;
}

export interface EventLog {
  id: string;
  participant_id: string;
  student_id: string;
  session_id: string;
  task_id: string;
  timestamp: string;
  pause_phase: PausePhase;
  event_type: EventType;
  event_description: string;
  code_snapshot_id: string | null;
  ai_interaction_id: string | null;
  metadata: Record<string, unknown>;
}

export interface SystemSettings {
  id: number;
  system_prompt: string;
  research_logging_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}
