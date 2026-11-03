import { expect, test } from '@playwright/test';

test('sign-up offers no researcher role and requires consent', async ({ page }) => {
  await page.route('http://localhost:54321/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText(/Researcher/i)).toHaveCount(0);
  await expect(page.getByText(/Account Type/i)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toBeVisible();
});
