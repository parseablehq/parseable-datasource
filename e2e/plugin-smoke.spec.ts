import { expect, test } from '@grafana/plugin-e2e';

const pluginId = 'parseable-parseable-datasource';

test('Grafana loads the Parseable plugin', async ({ page, request }) => {
  const homeResponse = await page.goto('/');
  expect(homeResponse?.ok()).toBe(true);

  const settingsResponse = await request.get(`/api/plugins/${pluginId}/settings`);
  expect(settingsResponse.ok()).toBe(true);
  const settings = await settingsResponse.json();
  expect(settings.id).toBe(pluginId);
  expect(settings.type).toBe('datasource');

  const pluginResponse = await page.goto(`/plugins/${pluginId}`);
  expect(pluginResponse?.ok()).toBe(true);
  await expect(page.getByText('Parseable', { exact: true }).first()).toBeVisible();
});
