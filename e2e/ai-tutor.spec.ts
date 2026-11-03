import { expect, test } from '@playwright/test';
import { eventTypes, installMockSupabase, studentFixture, type MockDb } from './mockSupabase';

const user = { id: 'student-1', email: 'student@example.org' };

/** Fake ai-tutor: answers requests and follow-ups, keeping parent/turn like the real function. */
function aiReply(body: Record<string, unknown>, db: MockDb) {
  const root = body.parentInteractionId as string | undefined;
  const thread = root ? db.ai_interactions.filter((i) => i.parent_interaction_id === root) : [];
  const n = db.ai_interactions.length + 1;
  return {
    interaction: {
      id: `ai-${n}`, session_id: 'sess-1', participant_id: 'P-TEST01', category: body.category, prompt: body.userPrompt,
      response: root ? `Follow-up answer ${thread.length + 1}: look at range(0, n, 2).` : 'Hint: which numbers does range(n) give you? Try printing them.',
      parent_interaction_id: root ?? null, turn_index: root ? thread.length + 1 : 0, created_at: new Date().toISOString(),
    },
  };
}

test('complete solution is locked until the student has worked on the code', async ({ page }) => {
  const db = studentFixture('use_ai', { runCount: 0, startedMinutesAgo: 0 });
  await installMockSupabase(page, db, { user, aiReply });
  await page.goto('/#/task/sess-1');
  await page.getByRole('button', { name: /Request complete solution/ }).click();
  await expect(page.getByText('A complete solution unlocks after you have worked on the problem yourself')).toBeVisible();
  await expect(page.getByText('Run your code at least 1 time (0/1)')).toBeVisible();
  await expect(page.getByText(/Keep working on your code for 3 more minutes/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request support' })).toBeDisabled();
});

test('hint with follow-up questions keeps the conversation and logs every request', async ({ page }) => {
  const db = studentFixture('use_ai');
  const log = await installMockSupabase(page, db, { user, aiReply });
  await page.goto('/#/task/sess-1');
  await page.getByRole('button', { name: /Give me a hint/ }).click();
  await page.locator('textarea[data-track="ai_question"]').fill('How do I get only even numbers?');
  await page.getByRole('button', { name: 'Request support' }).click();
  await expect(page.getByText('Hint: which numbers does range(n) give you?')).toBeVisible();

  for (const question of ['Why does range(n) include odd numbers?', 'Can range skip numbers?']) {
    await page.locator('textarea[data-track="ai_followup"]').fill(question);
    await page.getByRole('button', { name: 'Ask follow-up' }).click();
    await expect(page.getByText(question)).toBeVisible();
  }
  await expect(page.getByText('You have used all 2 follow-up questions for this response.')).toBeVisible();

  expect(log.functionCalls.map((c) => [c.category, c.parentInteractionId ?? null])).toEqual([['hint', null], ['hint', 'ai-1'], ['hint', 'ai-1']]);
  // The browser never sends a system prompt; the server builds it.
  expect(log.functionCalls.every((c) => !('systemPrompt' in c))).toBe(true);
  await expect.poll(() => eventTypes(db).filter((t) => t === 'AI_FOLLOWUP_REQUEST').length).toBe(2);
  expect(eventTypes(db)).toContain('HINT_REQUEST');
  expect(db.event_logs.every((e) => (e.metadata as Record<string, unknown>).log_schema === 2)).toBe(true);
});

test('unlocked complete-solution request requires and records a reason', async ({ page }) => {
  const db = studentFixture('use_ai', { runCount: 2, startedMinutesAgo: 10 });
  const log = await installMockSupabase(page, db, { user, aiReply });
  await page.goto('/#/task/sess-1');
  await page.getByRole('button', { name: /Request complete solution/ }).click();
  await expect(page.getByText('A complete solution unlocks after')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Request support' })).toBeDisabled();
  const reason = 'I tried two loops and both print odd numbers too.';
  await page.locator('textarea[data-track="solution_reason"]').fill(reason);
  await page.getByRole('button', { name: 'Request support' }).click();
  await expect(page.getByText('Hint: which numbers')).toBeVisible();
  expect(log.functionCalls[0]).toMatchObject({ category: 'solution_request', solutionReason: reason });
  await expect.poll(() => db.event_logs.find((e) => e.event_type === 'SOLUTION_REQUEST')?.metadata).toMatchObject({ solution_reason: reason });
});

test('server-side refusal is shown to the student', async ({ page }) => {
  const db = studentFixture('use_ai');
  await installMockSupabase(page, db, { user, aiReply: () => ({ status: 429, body: { error: "You have reached today's limit of 40 AI requests." } }) });
  await page.goto('/#/task/sess-1');
  await page.getByRole('button', { name: /Give me a hint/ }).click();
  await page.getByRole('button', { name: 'Request support' }).click();
  await expect(page.getByText("You have reached today's limit of 40 AI requests.")).toBeVisible();
});
