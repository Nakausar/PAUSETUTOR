import { expect, test } from '@playwright/test';
import { installMockSupabase, studentFixture, type MockDb } from './mockSupabase';

const student = { id: 'student-1', email: 'student@example.org' };

const preSurvey = {
  id: 'survey-pre', title: 'Before you start', description: 'Two quick questions.', kind: 'pre', required_before_tasks: true, active: true, created_at: '2026-11-09T08:00:00Z',
  items: [
    { id: 'exp', text: 'How long have you been programming?', type: 'choice', options: ['None', 'Less than 6 months', 'More'], required: true },
    { id: 'conf', text: 'I feel confident writing a small Python program on my own.', type: 'likert5', required: true },
    { id: 'note', text: 'Anything else?', type: 'text', required: false },
  ],
};
const postSurvey = { id: 'survey-post', title: 'Looking back', description: '', kind: 'post', required_before_tasks: false, active: true, created_at: '2026-11-09T08:01:00Z', items: [{ id: 'useful', text: 'PAUSE was useful.', type: 'likert5', required: true }] };

/** A student with one assigned, not-started task and the given questionnaires. */
function dashboardDb(surveys: Record<string, unknown>[], taskDone = false): MockDb {
  const db = studentFixture('plan');
  if (!taskDone) db.sessions = [];
  else db.sessions[0].status = 'completed';
  db.task_assignments = [{ id: 'asg-1', task_id: 'task-1', student_id: 'student-1', participant_id: 'P-TEST01', status: taskDone ? 'completed' : 'not_started', assigned_at: '2026-11-09T07:00:00Z' }];
  db.assessments = [];
  db.surveys = surveys;
  db.survey_responses = [];
  return db;
}

test('a required pre-survey blocks tasks until it is submitted', async ({ page }) => {
  const db = dashboardDb([preSurvey, postSurvey]);
  await installMockSupabase(page, db, { user: student });
  await page.goto('/#/dashboard');
  await expect(page.getByText('Questionnaires to complete')).toBeVisible();
  await expect(page.getByText('Please complete this before starting your tasks.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Looking back/ })).toHaveCount(0); // post survey not shown yet
  await expect(page.getByText('Questionnaire first')).toBeVisible();
  await expect(page.getByRole('link', { name: /Even numbers/ })).toHaveCount(0); // the task card is not a link

  // Opening the task address directly is blocked too.
  await page.goto('/#/task/start/task-1');
  await expect(page.getByText('Please complete the questionnaire "Before you start" on your dashboard before starting a task.')).toBeVisible();
  expect(db.sessions).toHaveLength(0);

  // Fill in the questionnaire; required questions are enforced.
  await page.goto('/#/survey/survey-pre');
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Please answer the 2 highlighted question(s).')).toBeVisible();
  await page.getByRole('button', { name: 'Less than 6 months' }).click();
  await page.getByRole('button', { name: /^4\s*Agree$/ }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Thank you!')).toBeVisible();
  expect(db.survey_responses).toHaveLength(1);
  expect(db.survey_responses[0]).toMatchObject({ survey_id: 'survey-pre', student_id: 'student-1', answers: { exp: 'Less than 6 months', conf: 4 } });
  expect(typeof db.survey_responses[0].started_at).toBe('string');

  // Back on the dashboard the task can be started.
  await page.getByRole('button', { name: 'Back to dashboard' }).last().click();
  await expect(page.getByText('Questionnaires to complete')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Even numbers/ })).toBeVisible();
});

test('the post-survey appears once all tasks are completed', async ({ page }) => {
  const db = dashboardDb([postSurvey], true);
  await installMockSupabase(page, db, { user: student });
  await page.goto('/#/dashboard');
  await expect(page.getByRole('link', { name: /Looking back/ })).toBeVisible();
  await page.getByRole('link', { name: /Looking back/ }).click();
  await page.getByRole('button', { name: /^5\s*Strongly agree$/ }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Thank you!')).toBeVisible();
  expect(db.survey_responses[0]).toMatchObject({ survey_id: 'survey-post', answers: { useful: 5 } });
});

test('a researcher creates the SUS questionnaire from the template', async ({ page }) => {
  const db: MockDb = { profiles: [{ id: 'res-1', email: 'res@example.org', role: 'researcher', participant_id: 'P-RES' }], surveys: [], survey_responses: [] };
  await installMockSupabase(page, db, { user: { id: 'res-1', email: 'res@example.org' } });
  await page.goto('/#/researcher/surveys');
  await page.getByRole('button', { name: 'System Usability Scale (post)' }).click();
  const editor = page.getByRole('dialog', { name: 'New questionnaire' });
  await expect(editor.getByText(/SUS item 10/)).toBeVisible();
  await editor.getByLabel('Active (visible to students)').check();
  await editor.getByRole('button', { name: 'Save questionnaire' }).click();
  await expect(page.getByText('Saved "Using PAUSE". Students can see it now.')).toBeVisible();
  expect(db.surveys).toHaveLength(1);
  expect(db.surveys[0]).toMatchObject({ title: 'Using PAUSE', kind: 'post', active: true });
  expect((db.surveys[0].items as unknown[]).length).toBe(10);
});

test('the questionnaire editor rejects incomplete questions', async ({ page }) => {
  const db: MockDb = { profiles: [{ id: 'res-1', email: 'res@example.org', role: 'researcher', participant_id: 'P-RES' }], surveys: [], survey_responses: [] };
  await installMockSupabase(page, db, { user: { id: 'res-1', email: 'res@example.org' } });
  await page.goto('/#/researcher/surveys');
  await page.getByRole('button', { name: 'Blank questionnaire' }).click();
  const editor = page.getByRole('dialog', { name: 'New questionnaire' });
  await editor.getByRole('button', { name: 'Save questionnaire' }).click();
  await expect(editor.getByText('Give the questionnaire a title.')).toBeVisible();
  await editor.getByLabel('Title (shown to students)').fill('Mid-study check');
  await editor.getByRole('button', { name: 'Add question' }).click();
  await editor.getByRole('button', { name: 'Save questionnaire' }).click();
  await expect(editor.getByText('Question 1 has no text.')).toBeVisible();
  await editor.getByLabel('Question 1 text').fill('Which phase helped most?');
  await editor.getByLabel('Question 1 type').selectOption('choice');
  await editor.getByRole('button', { name: 'Save questionnaire' }).click();
  await expect(editor.getByText('Question 1 needs at least two options.')).toBeVisible();
  await editor.getByLabel('Question 1 options').fill('Plan\nScrutinise');
  await editor.getByRole('button', { name: 'Save questionnaire' }).click();
  await expect(page.getByText(/Saved "Mid-study check"/)).toBeVisible();
  expect(db.surveys[0].items).toEqual([{ id: 'q1', text: 'Which phase helped most?', type: 'choice', required: true, options: ['Plan', 'Scrutinise'] }]);
});
