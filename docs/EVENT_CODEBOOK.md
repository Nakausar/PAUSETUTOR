# PAUSE event codebook

Every learner action is stored as one row in `event_logs`:

| Column | Meaning |
|---|---|
| `timestamp` | Server time when the event was stored (UTC) |
| `participant_id` | Pseudonymous ID (e.g. `P-3F9A21C0`); no names or emails |
| `session_id`, `task_id` | The task session the event belongs to |
| `pause_phase` | Phase the student was in: `plan`, `attempt`, `use_ai`, `scrutinise`, `evaluate` (`edit` only in data recorded before the Edit phase was merged into Scrutinise) |
| `event_type` | One of the types below |
| `ai_interaction_id`, `code_snapshot_id` | Links to the related AI interaction or code snapshot, where relevant |
| `metadata` | JSON with event-specific fields (below). Every event recorded after the logging update has `log_schema: 2` |

**Logging schema versions.** `log_schema: 2` (no value = version 1) marks events recorded after autosave, paste, focus and idle logging were added. When comparing participants, only compare sessions with the same schema version for the fine-grained measures.

**Duplicate protection.** The app suppresses identical events fired twice within 1.5 seconds, and the database rejects repeated events with the same `metadata.idem_key`. The in-app temporal analysis additionally removes analytical duplicates (see `dedupeEvents` in `src/lib/temporal/analysis.ts`) and reports how many it excluded.

## Session and phase navigation

| Event | When | Metadata |
|---|---|---|
| `SESSION_STARTED` | A student opens an assigned task for the first time | `assignment_task_id` |
| `PHASE_TRANSITION` | The student moves between phases | `from`, `to`, `source` |
| `PHASE_EXITED` / `PHASE_ENTERED` | Leaving / entering a phase (pairs with `PHASE_TRANSITION`) | `from_stage`, `to_stage`, `source` |
| `TASK_COMPLETED` | The task cycle is finished after the reflection | — |

## Plan

| Event | When | Metadata |
|---|---|---|
| `PLAN_STARTED` | The planning form is first shown | — |
| `PLAN_EDITED` | First edit of the plan text | — |
| `PLAN_SUBMITTED` | Plan and confidence saved | `version`, `confidence` (1–5), `plan_length`, `created_after_ai` |
| `PLAN_REVISED` | A later plan version saved | `version`, `created_after_ai`, `plan_length` |

## Attempt and coding

| Event | When | Metadata |
|---|---|---|
| `CODE_RUN` | Code ran without an error | `run_number`, `stdin`, `stdout`, `stderr`, `exit_code`, `output_length`, `runner` (`browser`/`server`), `timed_out`, `duration_ms` |
| `ERROR` | Code ran and the student's code raised an error (incl. a 5-second timeout) | same as `CODE_RUN`; `error` holds the traceback |
| `EXECUTION_ERROR` | Code could not run because of a system problem (not the student's fault) | same as `CODE_RUN`, `system_error: true` |
| `TEST` | The student ran the task's visible test cases (after predicting the result) | `passed`, `total`, `all_passed`, `results[]` (per test: `passed`, `timed_out`, `error`), `code`, `code_length`, `system_error`, `prediction` = { `predicted_passed` (0…total), `confidence` (1 = guessing … 5 = certain), `ms_to_predict`, `error` = predicted − actual } |
| `ATTEMPT_SAVED` | Attempt saved manually or before leaving Attempt | `code_length`, `run_count`, `revision_count`, `stdin`, `stdout`, `stderr` |
| `CODE_REVISED` | "Save revision" in Scrutinise (before day 5 this was logged as `ATTEMPT_SAVED` and its snapshot was rejected) | as `ATTEMPT_SAVED` |
| `CODE_AUTOSAVED` | Every 15 s while in Attempt or Scrutinise, if the code changed | `chars_added`, `chars_removed`, `lines_before`, `lines_after`, `code_length`; linked snapshot (trigger `auto`) |

## Use AI

| Event | When | Metadata |
|---|---|---|
| `HINT_REQUEST` | "Give me a hint" | `category`, `interaction_number` |
| `EXPLANATION_REQUEST` | "Explain a concept" | as above |
| `DEBUG_REQUEST` | "Help me debug" | as above |
| `APPROACH_REVIEW_REQUEST` | "Review my approach" | as above |
| `ERROR_EXPLANATION_REQUEST` | "Explain this error" | as above |
| `TARGETED_QUESTION` | "Ask a targeted question" | as above |
| `SOLUTION_REQUEST` | "Request complete solution" (only possible after the gate) | as above + `solution_reason` |
| `AI_FOLLOWUP_REQUEST` | Follow-up question about an AI response | `root_interaction_id`, `category`, `turn` |
| `AI_RESPONSE` | The tutor's answer arrived (system event) | `category`, `interaction_number` or `root_interaction_id` + `turn` |

Before day 4, concept, approach-review and error-explanation requests were all logged as `TARGETED_QUESTION`; use `ai_interactions.category` for those sessions.

The full prompt, response, model, prompt hash and token counts are in `ai_interactions` (written by the server, not the browser). Follow-ups have `parent_interaction_id` and `turn_index`.

## Scrutinise

| Event | When | Metadata |
|---|---|---|
| `AI_ACCURACY_RATING` | Student judged the AI response | `accuracy_judgment` (correct / mostly_correct / partly_correct / incorrect / unsure), `interaction_number` |
| `INTENDED_AI_UPTAKE` | Student chose what to do with it | `intended_action` (test / modify / use_part / own_version / clarify / reject) |
| `AI_CRITIQUE_TEXT` | Student wrote what the AI got wrong | `critique_length` |
| `SCRUTINISE_SUBMITTED` | Scrutiny form submitted | `accuracy_judgment`, `intended_action`, `action_taken`, `interaction_number` |
| `AI_SUGGESTION_ACCEPTED` / `_MODIFIED` / `_REJECTED` | Final decision on the suggestion | `test_passed`, `interaction_number` |

## Evaluate

| Event | When | Metadata |
|---|---|---|
| `REFLECTION_STARTED` | Reflection form first shown | — |
| `REFLECTION_SUBMITTED` | Reflection saved | `difficulty`, `perceived_independence`, `perceived_independent_ability`, `confidence`, `used_ai` |
| `REFLECTION_COMPLETED` | Reflection completed | `confidence` |

## Fine-grained activity (log_schema 2)

| Event | When | Metadata |
|---|---|---|
| `TEXT_PASTED` | Any paste in the workspace | `field` (code, plan, ai_question, ai_followup, critique, reflection, solution_reason, stdin, other), `length`, `lines`, `provenance`, `interaction_id`, `line_overlap`, `ms_since_ai_copy`, `text` (first 5,000 characters) |
| `AI_RESPONSE_COPIED` | Text copied from an AI response | `interaction_id`, `length`, `lines`, `text` (first 5,000 characters) |
| `FOCUS_LOST` | Away from the PAUSE tab/window for at least 5 s (logged 5 s after leaving) | `reason` (`tab_hidden` / `window_blur`), `started_at` |
| `FOCUS_RETURNED` | Back after a logged absence | `reason`, `away_ms`, `started_at` |
| `IDLE_STARTED` | No keyboard, mouse, scroll or touch activity for 60 s while in focus | `started_at`, `threshold_ms` |
| `IDLE_ENDED` | Activity resumed | `idle_ms`, `started_at` |

### Paste provenance (`TEXT_PASTED.metadata.provenance`)

Defined in `src/lib/provenance.ts`:

| Value | Rule |
|---|---|
| `copied_from_ai` | The pasted text equals (ignoring whitespace) text the student copied from an AI response in this session |
| `exact_ai` | The pasted text (at least 15 characters) appears verbatim, ignoring whitespace, in one of the session's AI responses |
| `partial_ai` | At least 60% of the pasted non-empty lines appear in a single AI response (`line_overlap`) |
| `none` | None of the above |

Limitations: pastes from outside the browser tab (e.g. another AI tool) are `none` unless the same text also appears in a PAUSE response; typing AI code by hand is not detected as a paste (see `final_code_ai_similarity` in the AI reliance export).

## Derived exports (Data Export page)

* **TNA sequences (long / wide):** events mapped to 21 actions by `src/lib/tnaCodebook.ts` (codebook version 1). Download **TNA action codebook** for the definition of each action.
* **Test prediction calibration:** one row per test run with a prediction (monitoring accuracy). `bias` = (predicted − actual) / total, so > 0 is over-confident and < 0 under-confident; `abs_error` = |predicted − actual| / total; plus `confidence`, `ms_to_predict`, `predicted_all_pass`, `actual_all_pass`. Test runs that failed for system reasons, and runs recorded before predictions were introduced, are excluded.
* **AI reliance per session:** counts and durations per session, plus `final_code_ai_similarity`: the share of identical non-empty lines between the final code and the code blocks in that session's AI responses (0–1).

### Reading the exports in R

```r
library(tna)
wide <- read.csv("pause_tna_wide.csv")
seq_cols <- grep("^T[0-9]+$", names(wide), value = TRUE)
seqs <- wide[, seq_cols]
seqs[seqs == ""] <- NA          # shorter sessions are padded with empty cells
model <- tna(seqs)
plot(model)
```
