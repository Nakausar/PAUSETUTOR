import { buildCorsHeaders } from "./cors.ts";
import { getCaller } from "./auth.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_ASSESSOR_MODEL") ?? Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

const METACOG_RATINGS = ["excellent", "good", "needs_improvement", "not_observed", "not_applicable"];

interface AssessRequest {
  taskTitle?: string;
  taskDescription?: string;
  learningObjectives?: string;
  expectedInputs?: string;
  expectedOutputs?: string;
  testCases?: { input: string; expected: string }[];
  evidence: {
    plans?: { id: string; plan_text: string; confidence: number | null; version: number | null; created_after_ai: boolean | null }[];
    attempts?: { current_code: string; run_count: number; revision_count: number; last_error: string | null; last_output: string | null }[];
    snapshots?: { id: string; code: string; trigger: string; output: string | null; error: string | null; run_number: number | null }[];
    aiInteractions?: { id: string; category: string; prompt: string }[];
    scrutiny?: { id: string; accuracy_judgment: string; intended_action: string; critique_text: string; action_taken: string; produced_expected_result: boolean | null; ai_interaction_id: string | null }[];
    reflection?: { difficulty: string; perceived_independence: string; ai_help_reflection: string; perceived_independent_ability: string; most_important_learning: string; next_time_strategy: string; confidence: number | null } | null;
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Only signed-in researchers may request assessments.
    const caller = await getCaller(req);
    if (!caller || caller.role !== "researcher") {
      return new Response(
        JSON.stringify({ error: "Only signed-in researchers can generate assessments." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json() as AssessRequest;

    if (!body.evidence || typeof body.evidence !== "object") {
      return new Response(
        JSON.stringify({ error: "Missing evidence" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const e = body.evidence;

    // Build a compact, factual summary of the session's evidence.
    const sections: string[] = [];

    if (body.taskTitle) sections.push(`Task: ${body.taskTitle}`);
    if (body.taskDescription) sections.push(`Problem: ${body.taskDescription}`);
    if (body.learningObjectives) sections.push(`Learning objectives: ${body.learningObjectives}`);
    if (body.expectedInputs) sections.push(`Expected inputs: ${body.expectedInputs}`);
    if (body.expectedOutputs) sections.push(`Expected outputs: ${body.expectedOutputs}`);
    if (body.testCases?.length) {
      sections.push(
        `Test cases:\n${body.testCases.map((tc, i) => `  ${i + 1}. input=${JSON.stringify(tc.input)} expected=${JSON.stringify(tc.expected)}`).join("\n")}`,
      );
    }

    if (e.plans?.length) {
      sections.push(
        `Plans (${e.plans.length}) — first and latest:\n` +
        describePlan(e.plans[0]) + "\n" + (e.plans.length > 1 ? describePlan(e.plans[e.plans.length - 1]) : ""),
      );
    }

    if (e.attempts?.length) {
      const a = e.attempts[e.attempts.length - 1];
      sections.push(
        `Final attempt state: ${a.run_count} runs, ${a.revision_count} revisions.\nLast output: ${truncate(a.last_output ?? "(none)", 500)}\nLast error: ${truncate(a.last_error ?? "(none)", 300)}`,
      );
    }

    if (e.aiInteractions?.length) {
      sections.push(
        `AI interactions (${e.aiInteractions.length}): ${e.aiInteractions.map((ai) => ai.category).join(", ")}`,
      );
    }

    if (e.scrutiny?.length) {
      sections.push(
        `Scrutiny responses (${e.scrutiny.length}):\n` +
        e.scrutiny.map((s) =>
          `- judged AI as "${s.accuracy_judgment}", intended to "${s.intended_action}", took "${s.action_taken}", produced expected result: ${s.produced_expected_result === null ? "unknown" : s.produced_expected_result}${s.critique_text ? `, critique: "${truncate(s.critique_text, 400)}"` : ""}`,
        ).join("\n"),
      );
    }

    if (e.snapshots?.length) {
      sections.push(`Code snapshots recorded: ${e.snapshots.length}.`);
    }

    if (e.reflection) {
      sections.push(
        `Self-evaluation: difficulty="${e.reflection.difficulty}", independence="${e.reflection.perceived_independence}", independent ability="${e.reflection.perceived_independent_ability}", AI help used: "${e.reflection.ai_help_reflection}", learning: "${truncate(e.reflection.most_important_learning, 400)}", next time: "${truncate(e.reflection.next_time_strategy, 400)}", confidence=${e.reflection.confidence}`,
      );
    }

    const evidenceText = sections.join("\n\n") || "No evidence recorded.";

    const systemPrompt = `You are the assessment engine of the PAUSE AI Tutor, a research prototype for programming education. You assess a student's completed programming session from logged evidence.

You produce TWO independent assessments:

## 1. Programming assessment (100-mark rubric)
Consider:
- Correctness of the final code against the task's expected inputs/outputs and test cases
- Code quality and clarity
- Evidence of the learning objectives
Assign marks using this rubric and write constructive programming feedback (what works, what could improve, specific to the code). This feedback WILL be shown to the student after researcher approval.

RUBRIC (total 100):
- correctness: 0-40 (code correctness against expected inputs/outputs and test cases)
- approach: 0-20 (problem-solving approach: decomposition, algorithm choice, edge-case handling)
- quality: 0-20 (code quality: clarity, naming, structure, readability)
- testing: 0-20 (testing and debugging: runs recorded, errors investigated, test evidence)
Total mark must equal correctness + approach + quality + testing.
- mark: total (0-100)
- feedback: text

## 2. Metacognitive assessment (qualitative ONLY, no scores, no comments)
Rate FOUR dimensions, each exactly one of: excellent | good | needs_improvement | not_observed | not_applicable

- planning: Quality of the student's plan(s) — specificity, decomposition, consideration of edge cases, whether plans were revised meaningfully after AI help.
- monitoring_and_attempt: Evidence of monitoring during independent work — running code repeatedly, checking outputs, self-initiated revisions, persistence through errors.
- critical_scrutiny_of_ai: Whether the student evaluated AI responses — accuracy judgments, critiques, testing AI suggestions, deciding deliberately rather than copying.
- evaluation: Quality of the final self-evaluation — specificity and honesty of the reflection, awareness of what was learned and what to improve.

CRITICAL RATING RULES:
- Base ratings on the EVIDENCE ONLY. Do NOT infer quality from the mere completion of a phase.
- "not_observed" means the behaviour left no trace in the evidence, not that it was poor.
- "not_applicable" only when the dimension genuinely could not arise (e.g. no AI interaction occurred for critical_scrutiny_of_ai).
- Do NOT produce any written comments, explanations or recommendations for the metacognitive dimensions — only the rating.

Respond with STRICT JSON only, no markdown fences:
{
  "programming": { "mark": <0-100 integer>, "correctness": <0-40>, "approach": <0-20>, "quality": <0-20>, "testing": <0-20>, "feedback": "<programming feedback text>" },
  "metacognitive": {
    "planning": "<rating>",
    "monitoring_and_attempt": "<rating>",
    "critical_scrutiny_of_ai": "<rating>",
    "evaluation": "<rating>"
  },
  "evidence_refs": { "plans": [<plan ids>], "scrutiny": [<scrutiny ids>], "ai_interactions": [<ai interaction ids>], "snapshots": [<snapshot ids>], "reflection": <reflection id or null> }
}

In evidence_refs, list the identifiers of the records your ratings are based on.`;

    // If no API key, return placeholder suggestions so the interface works unconnected.
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({
          placeholder: true,
          programming: { mark: null, correctness: null, approach: null, quality: null, testing: null, feedback: "[AI assessor placeholder — no API key configured. Generate suggestion when the AI service is connected, or enter the mark and ratings manually.]" },
          metacognitive: { planning: null, monitoring_and_attempt: null, critical_scrutiny_of_ai: null, evaluation: null },
          evidence_refs: {},
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: evidenceText },
        ],
        max_tokens: 1200,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(() => "Unknown error");
      console.error(`OpenAI API error ${openaiResponse.status}:`, errorText);
      const safeMessage = openaiResponse.status === 401
        ? "AI service authentication failed. Please contact the system administrator."
        : openaiResponse.status === 429
          ? "AI service is busy. Please try again in a moment."
          : `AI service error: ${openaiResponse.status}`;
      return new Response(
        JSON.stringify({ error: safeMessage }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await openaiResponse.json();
    let parsed: Record<string, unknown>;
    try {
      const content = aiData.choices?.[0]?.message?.content ?? "{}";
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return new Response(
        JSON.stringify({ error: "AI returned an unparseable assessment. Please try again or rate manually." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate and clamp the shape before returning anything to the client.
    const prog = (parsed.programming ?? {}) as Record<string, unknown>;
    const meta = (parsed.metacognitive ?? {}) as Record<string, unknown>;
    const refs = (parsed.evidence_refs ?? {}) as Record<string, unknown>;

    let mark: number | null = null;
    if (typeof prog.mark === "number" && Number.isInteger(prog.mark)) {
      mark = Math.max(0, Math.min(100, prog.mark));
    }

    const sub = (v: unknown, max: number): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;

    // If sub-scores are present, derive the total from them for consistency.
    const correctness = sub(prog.correctness, 40);
    const approach = sub(prog.approach, 20);
    const quality = sub(prog.quality, 20);
    const testing = sub(prog.testing, 20);
    if (correctness !== null && approach !== null && quality !== null && testing !== null) {
      mark = correctness + approach + quality + testing;
    }

    const rating = (v: unknown) =>
      typeof v === "string" && METACOG_RATINGS.includes(v) ? v : null;

    return new Response(
      JSON.stringify({
        placeholder: false,
        programming: { mark, correctness, approach, quality, testing, feedback: typeof prog.feedback === "string" ? prog.feedback : null },
        metacognitive: {
          planning: rating(meta.planning),
          monitoring_and_attempt: rating(meta.monitoring_and_attempt),
          critical_scrutiny_of_ai: rating(meta.critical_scrutiny_of_ai),
          evaluation: rating(meta.evaluation),
        },
        evidence_refs: refs && typeof refs === "object" ? refs : {},
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function describePlan(p: { id: string; plan_text: string; confidence: number | null; version: number | null; created_after_ai: boolean | null }): string {
  return `- (id=${p.id}, version=${p.version ?? "?"}, after_AI=${p.created_after_ai === null ? "?" : p.created_after_ai}, confidence=${p.confidence ?? "?"}): ${truncate(p.plan_text, 800)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}