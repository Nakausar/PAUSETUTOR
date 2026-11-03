export type UserRole = 'student' | 'researcher';

export type PausePhase = 'plan' | 'attempt' | 'use_ai' | 'scrutinise' | 'edit' | 'evaluate' | 'completed';

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

export type PlanConfidence = 1 | 2 | 3 | 4 | 5;

export type AccuracyJudgment = 'correct' | 'mostly_correct' | 'partly_correct' | 'incorrect' | 'unsure';

export type IntendedAction = 'test' | 'modify' | 'use_part' | 'own_version' | 'clarify' | 'reject';

export type DifficultyChoice =
  | 'understanding_problem'
  | 'planning'
  | 'writing_code'
  | 'debugging'
  | 'understanding_ai'
  | 'checking_ai'
  | 'testing'
  | 'nothing_difficult';

export type PerceivedIndependence = 'almost_all' | 'most' | 'about_half' | 'small_part' | 'very_little';

export type AiDisagreement = 'yes' | 'partly' | 'no' | 'unsure';

export type PerceivedIndependentAbility = 'definitely_yes' | 'probably_yes' | 'not_sure' | 'probably_no' | 'definitely_no';

export type EventType =
  // Plan
  | 'PLAN_STARTED'
  | 'PROBLEM_ANALYSIS'
  | 'GOAL_SET'
  | 'PLAN_CREATED'
  | 'PSEUDOCODE_CREATED'
  | 'PLAN_COMPLETED'
  | 'PLAN_EDITED'
  | 'PLAN_SUBMITTED'
  | 'PLAN_REVISED'
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
  | 'AI_ACCURACY_RATING'
  | 'INTENDED_AI_UPTAKE'
  | 'AI_CRITIQUE_TEXT'
  | 'SCRUTINISE_SUBMITTED'
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
  | 'REFLECTION_SUBMITTED'
  | 'TASK_COMPLETED'
  // Assignment and session lifecycle
  | 'TASK_ASSIGNED'
  | 'SESSION_STARTED'
  // Transitions
  | 'PHASE_TRANSITION'
  | 'PHASE_ENTERED'
  | 'PHASE_EXITED';

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
  /** Hidden tests are never sent to students; researchers run them during assessment. */
  hidden?: boolean;
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
  plan_text: string;
  confidence: PlanConfidence | null;
  version: number | null;
  created_after_ai: boolean | null;
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
  accuracy_judgment: AccuracyJudgment | '';
  intended_action: IntendedAction | '';
  critique_text: string;
  action_taken: ScrutinyAction;
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
  difficulty: DifficultyChoice | '';
  perceived_independence: PerceivedIndependence | '';
  ai_help_reflection: string;
  ai_disagreement: AiDisagreement | '';
  ai_disagreement_text: string;
  perceived_independent_ability: PerceivedIndependentAbility | '';
  most_important_learning: string;
  next_time_strategy: string;
  confidence: PlanConfidence | null;
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

export type MetacognitiveRating =
  | 'excellent'
  | 'good'
  | 'needs_improvement'
  | 'not_observed'
  | 'not_applicable';

export type AssessmentStatus = 'pending' | 'approved';

export interface Assessment {
  id: string;
  session_id: string;
  task_id: string | null;
  student_id: string | null;
  participant_id: string;
  status: AssessmentStatus;
  ai_suggested_at: string | null;
  ai_suggested_mark: number | null;
  ai_suggested_correctness: number | null;
  ai_suggested_approach: number | null;
  ai_suggested_quality: number | null;
  ai_suggested_testing: number | null;
  ai_programming_feedback: string | null;
  ai_suggested_planning: MetacognitiveRating | null;
  ai_suggested_monitoring: MetacognitiveRating | null;
  ai_suggested_scrutiny: MetacognitiveRating | null;
  ai_suggested_evaluation: MetacognitiveRating | null;
  approved_mark: number | null;
  approved_correctness: number | null;
  approved_approach: number | null;
  approved_quality: number | null;
  approved_testing: number | null;
  programming_feedback: string | null;
  metacog_planning: MetacognitiveRating | null;
  metacog_monitoring: MetacognitiveRating | null;
  metacog_scrutiny: MetacognitiveRating | null;
  metacog_evaluation: MetacognitiveRating | null;
  evidence_refs: Record<string, unknown>;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}
