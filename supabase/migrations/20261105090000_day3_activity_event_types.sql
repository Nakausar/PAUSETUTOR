/*
# Day 3: fine-grained activity events (logging schema v2)

Adds event types; every previously allowed value stays allowed.

| Event               | Meaning                                                              |
|---------------------|----------------------------------------------------------------------|
| CODE_AUTOSAVED      | Code changed since the last snapshot; saved every 15 s while editing |
| TEXT_PASTED         | Any paste; metadata.field and metadata.provenance (AI match)         |
| AI_RESPONSE_COPIED  | Student copied text from an AI response                              |
| FOCUS_LOST          | Left the tab/window for >= 5 s (metadata.reason)                     |
| FOCUS_RETURNED      | Came back; metadata.away_ms                                          |
| IDLE_STARTED        | No activity for 60 s while the page was in focus                     |
| IDLE_ENDED          | Activity resumed; metadata.idle_ms                                   |
| AI_FOLLOWUP_REQUEST | Follow-up question within one AI interaction (used from day 4)       |

These are separate from CODE_EDIT so the existing temporal analysis
(which treats CODE_EDIT as an independent-coding step) is unchanged.
*/

ALTER TABLE event_logs DROP CONSTRAINT IF EXISTS event_logs_event_type_check;
ALTER TABLE event_logs ADD CONSTRAINT event_logs_event_type_check CHECK (
  event_type = ANY (ARRAY[
    'PLAN_STARTED','PROBLEM_ANALYSIS','GOAL_SET','PLAN_CREATED','PSEUDOCODE_CREATED','PLAN_COMPLETED',
    'PLAN_EDITED','PLAN_SUBMITTED','PLAN_REVISED',
    'ATTEMPT_STARTED','CODE_EDIT','CODE_RUN','ERROR','EXECUTION_ERROR','INDEPENDENT_REVISION','ATTEMPT_SAVED','ATTEMPT_COMPLETED',
    'AI_HELP_STARTED','HINT_REQUEST','EXPLANATION_REQUEST','DEBUG_REQUEST','APPROACH_REVIEW_REQUEST','ERROR_EXPLANATION_REQUEST','TARGETED_QUESTION','SOLUTION_REQUEST',
    'AI_RESPONSE','AI_HELP_COMPLETED',
    'SCRUTINY_STARTED','SCRUTINISE_SUBMITTED','AI_ACCURACY_RATING','INTENDED_AI_UPTAKE','AI_CRITIQUE_TEXT',
    'AI_OUTPUT_REVIEWED','TEST','VERIFY','COMPARE','AI_SUGGESTION_ACCEPTED','AI_SUGGESTION_MODIFIED','AI_SUGGESTION_REJECTED',
    'CODE_REVISED','ERROR_FIXED','SCRUTINY_COMPLETED',
    'REFLECTION_STARTED','REFLECTION_SUBMITTED','SOLUTION_EXPLAINED','LEARNING_REFLECTION','AI_HELP_EVALUATED','SELF_EVALUATION','CONFIDENCE_RECORDED','REFLECTION_COMPLETED',
    'PHASE_TRANSITION','PHASE_ENTERED','PHASE_EXITED',
    'TASK_COMPLETED','TASK_ASSIGNED','SESSION_STARTED',
    'CODE_AUTOSAVED','TEXT_PASTED','AI_RESPONSE_COPIED','FOCUS_LOST','FOCUS_RETURNED','IDLE_STARTED','IDLE_ENDED','AI_FOLLOWUP_REQUEST'
  ])
);
