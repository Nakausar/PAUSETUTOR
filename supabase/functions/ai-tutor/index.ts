import { corsHeaders } from "./cors.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

interface AIRequest {
  systemPrompt: string;
  category: string;
  userPrompt: string;
  contextCode?: string;
  contextError?: string;
  contextPlan?: Record<string, unknown>;
  taskDescription?: string;
  taskTitle?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json() as AIRequest;

    if (!body.userPrompt) {
      return new Response(
        JSON.stringify({ error: "Missing userPrompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = body.systemPrompt || "You are the PAUSE AI Tutor, an educational programming assistant.";

    // Build context section
    const contextParts: string[] = [];
    if (body.taskTitle) contextParts.push(`Task: ${body.taskTitle}`);
    if (body.taskDescription) contextParts.push(`Problem: ${body.taskDescription}`);
    if (body.contextPlan) contextParts.push(`Student's plan: ${JSON.stringify(body.contextPlan)}`);
    if (body.contextCode) contextParts.push(`Student's current code:\n\`\`\`python\n${body.contextCode}\n\`\`\``);
    if (body.contextError) contextParts.push(`Last error:\n${body.contextError}`);

    // Category-specific instructions
    const categoryInstructions: Record<string, string> = {
      explain_concept: "The student wants to understand a programming concept. Explain it clearly with examples. Do NOT solve their specific task for them.",
      hint: "Provide a small, targeted hint. Do NOT give the complete solution. Point them in the right direction.",
      debug: "Guide the student in identifying the bug in their code. Explain what might be wrong and why, but let them make the fix.",
      review_approach: "Evaluate the student's proposed approach. Give feedback on its strengths and weaknesses. Do NOT replace their strategy with your own.",
      explain_error: "Explain what the error message means and why it occurred. Help the student understand the cause without fixing it for them.",
      targeted_question: "Answer the student's specific question. Stay focused on what they asked. Prefer guidance over complete solutions.",
      solution_request: "The student has explicitly requested a complete solution. You may provide one, but also explain your reasoning so they can learn from it.",
    };

    const categoryInstruction = categoryInstructions[body.category] || "Provide educational guidance without replacing student reasoning.";

    const fullSystemPrompt = `${systemPrompt}

## Assistance Category
${categoryInstruction}

## Student Context
${contextParts.join("\n\n") || "No additional context provided."}`;

    // If no API key, return a placeholder response (interface works, AI not connected)
    if (!OPENAI_API_KEY) {
      const placeholderResponse = `[AI Tutor Placeholder — No API key configured]

The PAUSE AI Tutor interface is working correctly. To connect a real AI model, an OPENAI_API_KEY secret needs to be added to the Supabase project.

Category: ${body.category}
Your question: ${body.userPrompt}

This response is logged for research purposes. In a pilot deployment, this would be replaced with a real AI-generated pedagogical response that follows the PAUSE framework guidelines.`;

      return new Response(
        JSON.stringify({ response: placeholderResponse, placeholder: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: fullSystemPrompt },
          { role: "user", content: body.userPrompt },
        ],
        max_tokens: 1000,
        temperature: 0.7,
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
    const aiResponse = aiData.choices?.[0]?.message?.content ?? "No response generated.";

    return new Response(
      JSON.stringify({ response: aiResponse, placeholder: false }),
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
