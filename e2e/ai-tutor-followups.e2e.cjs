// Browser test against a mocked Supabase. Start the app first:
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=dummy npx vite --port 5199
// then: node e2e/<file>.e2e.cjs  (day 5 turns these into a Playwright test suite)
const { chromium } = require('playwright');
const { installMock } = require('./mockSupabase.cjs');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 1600 } });
  const errs = []; p.on('pageerror', (e) => { errs.push(e.message); console.log('PAGEERROR', e.message, (e.stack||'').split('\n').slice(0,4).join(' | ')); }); p.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 300)); });
  const user = { id: 'student-1', email: 's@uef.fi', aud: 'authenticated', role: 'authenticated' };
  const db = {
    profiles: [{ id: 'student-1', email: 's@uef.fi', role: 'student', participant_id: 'P-TEST01', consent_acknowledged: true }],
    tasks: [{ id: 'task-1', language: 'python', difficulty: 'beginner', learning_objectives: 'loops', expected_inputs: 'n', expected_outputs: 'evens', concept_tags: 'loops', title: 'Even numbers', problem_description: 'Print the even numbers below n.', test_cases: [{ input: '5', expected: '0\n2\n4' }], starter_code: '' }],
    sessions: [{ id: 'sess-1', task_id: 'task-1', student_id: 'student-1', participant_id: 'P-TEST01', current_phase: 'use_ai', status: 'in_progress' }],
    plans: [{ id: 'plan-1', session_id: 'sess-1', plan_text: 'Loop and print evens', confidence: 3, version: 1, created_at: '2026-11-06T09:00:00Z' }],
    code_attempts: [{ id: 'att-1', session_id: 'sess-1', current_code: 'n = int(input())\n', run_count: 0, revision_count: 0, started_at: new Date().toISOString() }],
    ai_interactions: [], scrutiny_responses: [], event_logs: [], code_snapshots: [], task_assignments: [],
    system_settings: [{ id: 1, research_logging_enabled: true, solution_min_runs: 1, solution_min_minutes: 3, solution_requires_reason: true, max_followups: 2 }],
  };
  let turn = 0;
  const log = await installMock(p, db, {
    user,
    aiReply: (body) => {
      turn++;
      const root = body.parentInteractionId;
      const thread = root ? db.ai_interactions.filter((i) => i.parent_interaction_id === root) : [];
      return { interaction: { id: `ai-${turn}`, session_id: 'sess-1', participant_id: 'P-TEST01', category: body.category, prompt: body.userPrompt, response: root ? `Follow-up answer ${thread.length + 1}: check range(0, n, 2).` : 'Hint: which numbers does range(n) give you? Try printing them.', parent_interaction_id: root ?? null, turn_index: root ? thread.length + 1 : 0, created_at: new Date().toISOString() } };
    },
  });
  await p.goto('http://localhost:5199/#/task/sess-1');

  await p.waitForSelector('text=Use AI strategically', { timeout: 30000 });

  // 1. The complete-solution option is locked
  await p.click('button:has-text("Request complete solution")');
  const lockText = await p.locator('text=A complete solution unlocks after').count();
  const sendDisabled = await p.locator('button:has-text("Request support")').isDisabled();
  console.log('solution locked shown:', lockText === 1, '| request button disabled:', sendDisabled);
  console.log('gate items:', await p.locator('li:has(svg)').allInnerTexts());
  

  // 2. Ask for a hint
  await p.click('button:has-text("Give me a hint")');
  await p.fill('textarea[data-track="ai_question"]', 'How do I get only even numbers?');
  await p.click('button:has-text("Request support")');
  await p.waitForSelector('text=Hint: which numbers');

  // 3. Two follow-ups (limit is 2)
  for (const q of ['Why does range(n) include odd numbers?', 'Can range skip numbers?']) {
    await p.fill('textarea[data-track="ai_followup"]', q);
    await p.click('button:has-text("Ask follow-up")');
    await p.waitForSelector(`text=${q}`);
  }
  await p.waitForSelector('text=You have used all 2 follow-up questions');
  

  const calls = log.functionCalls.map((c) => ({ category: c.category, parent: c.parentInteractionId ?? null, prompt: c.userPrompt }));
  console.log('ai-tutor calls:', JSON.stringify(calls));
  const events = db.event_logs.map((e) => e.event_type);
  console.log('events:', events.join(', '));
  console.log('log_schema on all events:', db.event_logs.every((e) => e.metadata && e.metadata.log_schema === 2));
  console.log('page errors:', errs);
  await b.close();
})();
