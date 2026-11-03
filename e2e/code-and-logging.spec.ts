import { expect, test } from '@playwright/test';
import { eventTypes, installMockSupabase, studentFixture } from './mockSupabase';

const user = { id: 'student-1', email: 'student@example.org' };

/** Replaces the editor content. CodeMirror auto-indents after a colon, so type lines without leading spaces. */
async function typeCode(page: import('@playwright/test').Page, lines: string[]) {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(lines.join('\n'));
}

test('student runs Python in the browser and runs the visible tests', async ({ page }) => {
  const db = studentFixture('attempt');
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await expect(page.locator('.cm-content')).toBeVisible();

  // CodeMirror indents after "for ...:" automatically, so the loop body needs no spaces.
  await typeCode(page, ['n = int(input())', 'for i in range(0, n, 2):']);
  await page.keyboard.press('Enter');
  await page.keyboard.type('print(i)');
  await page.locator('textarea[data-track="stdin"]').fill('7');
  await page.getByRole('button', { name: 'Run code' }).click();
  await expect(page.locator('pre').filter({ hasText: '0\n2\n4\n6' })).toBeVisible({ timeout: 60_000 });

  // Tests only run after the student predicts the outcome.
  await page.getByRole('button', { name: /Run tests \(1\)/ }).click();
  const prediction = page.getByRole('group', { name: 'Predict the test result' });
  await expect(prediction.getByText('how many of the 1 test do you expect to pass?')).toBeVisible();
  const runButton = prediction.getByRole('button', { name: 'Run tests' });
  await expect(runButton).toBeDisabled();
  await prediction.getByRole('button', { name: '1', exact: true }).first().click();
  await expect(runButton).toBeDisabled(); // confidence still missing
  await prediction.getByRole('button', { name: '4', exact: true }).click();
  await runButton.click();
  await expect(page.getByText('1 of 1 tests passed')).toBeVisible();
  await expect(prediction).toHaveCount(0);

  await expect.poll(() => db.event_logs.find((e) => e.event_type === 'CODE_RUN')?.metadata).toMatchObject({ runner: 'browser', timed_out: false });
  await expect.poll(() => db.event_logs.find((e) => e.event_type === 'TEST')?.metadata).toMatchObject({
    passed: 1, total: 1, all_passed: true, prediction: { predicted_passed: 1, confidence: 4, error: 0 },
  });
});

test('an infinite loop is stopped and reported as a student error', async ({ page }) => {
  const db = studentFixture('attempt', { code: 'while True:\n    pass\n' });
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await page.getByRole('button', { name: 'Run code' }).click();
  await expect(page.getByText(/ran for more than 5 seconds and was stopped/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => db.event_logs.find((e) => e.event_type === 'ERROR')?.metadata).toMatchObject({ timed_out: true, system_error: false });
});

test('pasting AI code into the editor is logged with its provenance', async ({ page }) => {
  const ai = { id: 'ai-9', session_id: 'sess-1', participant_id: 'P-TEST01', category: 'hint', prompt: 'help', parent_interaction_id: null, turn_index: 0, created_at: '2026-11-06T09:30:00Z',
    response: 'Try this:\n```python\nfor i in range(0, n, 2):\n    print(i)\n```' };
  const db = studentFixture('scrutinise', { aiInteractions: [ai] });
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'for i in range(0, n, 2):\n    print(i)');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => db.event_logs.find((e) => e.event_type === 'TEXT_PASTED')?.metadata).toMatchObject({ field: 'code', provenance: 'exact_ai', interaction_id: 'ai-9' });
});

test('edits are autosaved every 15 seconds as snapshots', async ({ page }) => {
  test.slow();
  const db = studentFixture('attempt');
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('print("hello")');
  await expect.poll(() => eventTypes(db).includes('CODE_AUTOSAVED'), { timeout: 25_000 }).toBe(true);
  const snapshot = db.code_snapshots.find((s) => s.trigger === 'auto');
  expect(snapshot?.code).toContain('print("hello")');
  expect(db.event_logs.find((e) => e.event_type === 'CODE_AUTOSAVED')?.metadata).toMatchObject({ chars_added: 14, chars_removed: 0 });
  // Only one code_attempts row for the session (no duplicate created by autosave).
  expect(db.code_attempts.filter((a) => a.session_id === 'sess-1')).toHaveLength(1);
});

test('saving a revision in Scrutinise stores a revision snapshot and logs CODE_REVISED', async ({ page }) => {
  const ai = { id: 'ai-3', session_id: 'sess-1', participant_id: 'P-TEST01', category: 'debug', prompt: 'help', response: 'Check your range start.', parent_interaction_id: null, turn_index: 0, created_at: '2026-11-06T09:30:00Z' };
  const db = studentFixture('scrutinise', { aiInteractions: [ai] });
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('print(0)');
  await page.getByRole('button', { name: 'Save revision', exact: true }).click();
  await expect(page.getByText(/Revision saved/)).toBeVisible();
  expect(db.code_snapshots.find((s) => s.trigger === 'revision')?.code).toContain('print(0)');
  await expect.poll(() => eventTypes(db)).toContain('CODE_REVISED');
  expect(eventTypes(db)).not.toContain('ATTEMPT_SAVED');
});

test('"Save revisions and continue to Evaluate" saves unsaved code before moving on', async ({ page }) => {
  const ai = { id: 'ai-4', session_id: 'sess-1', participant_id: 'P-TEST01', category: 'debug', prompt: 'help', response: 'Check your range start.', parent_interaction_id: null, turn_index: 0, created_at: '2026-11-06T09:30:00Z' };
  const db = studentFixture('scrutinise', { aiInteractions: [ai] });
  await installMockSupabase(page, db, { user });
  await page.goto('/#/task/sess-1');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('print("last edit")');
  await page.getByRole('button', { name: 'Save revisions and continue to Evaluate' }).click();
  await expect.poll(() => db.code_snapshots.some((s) => s.trigger === 'revision' && String(s.code).includes('last edit'))).toBe(true);
  await expect.poll(() => db.sessions[0].current_phase).toBe('evaluate');
});
