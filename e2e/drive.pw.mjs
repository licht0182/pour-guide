import { test, expect } from '@playwright/test';

// Run the production bundle in Chromium. Only Google endpoints are replaced;
// React, localStorage, timers, navigation and user interactions are real.
async function setup(page, { preload = true } = {}) {
  const state = { snapshots: [], writes: [], backups: [], unauthorized: false, failUpload: false, hold: null };
  await page.route('https://www.googleapis.com/**', async route => {
    if (state.unauthorized) return route.fulfill({ status: 401, body: '{}' });
    const url = new URL(route.request().url());
    if (route.request().method() === 'POST') {
      const body = route.request().postData();
      if (body.includes('"format":"pour-guide"')) {
        const backup = JSON.parse(body.split('Content-Type: application/json; charset=UTF-8\r\n\r\n').at(-1).split('\r\n--')[0]);
        state.backups.push(backup);
        return route.fulfill({ json: { id: `backup-${state.backups.length - 1}` } });
      }
      const snapshot = JSON.parse(body.split('Content-Type: application/json\r\n\r\n')[1].split('\r\n--')[0]);
      state.writes.push(snapshot);
      if (state.failUpload) return route.fulfill({ status: 503, body: '{}' });
      state.snapshots.push(snapshot);
      return route.fulfill({ json: { id: String(state.snapshots.length) } });
    }
    if (url.searchParams.get('alt') === 'media') {
      const id = url.pathname.split('/').pop();
      return route.fulfill({ json: id.startsWith('backup-') ? state.backups[Number(id.slice(7))] : state.snapshots[Number(id)] });
    }
    if (url.searchParams.get('q')?.includes('appProperties')) return route.fulfill({ json: { files: state.backups.map((_, id) => ({ id: `backup-${id}`, name: 'Backup', createdTime: new Date().toISOString() })) } });
    if (state.hold) await state.hold;
    return route.fulfill({ json: { files: state.snapshots.map((_, id) => ({ id: String(id) })) } });
  });
  const sdk = `window.google={accounts:{oauth2:{initTokenClient: config => ({requestAccessToken: () => config.callback({access_token:'test-token', expires_in:3600})}),hasGrantedAllScopes:()=>true,revoke: (token,cb) => cb()}}};`;
  if (preload) await page.addInitScript(sdk);
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
  await page.goto('/pour-guide/');
  return state;
}
async function connect(page) {
  await page.getByRole('button', { name: 'Google Drive 연결', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
}
async function localRecipes(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('pour-guide.library.v1')).recipes);
}
async function remoteEdit(page, state, name) {
  const recipes = await localRecipes(page);
  const recipe = { ...recipes[0], name };
  const entries = state.snapshots.at(-1).entries.map(entry => entry.id === recipe.id ? { ...entry, recipe, revision: `${String(Date.now() + 1000).padStart(16, '0')}-remote` } : entry);
  state.snapshots.push({ version: 1, entries });
  return recipe;
}
test('connects, uploads, applies remote edits and preserves them after reload', async ({ page }) => {
  const state = await setup(page, { preload: false });
  await connect(page);
  expect(state.writes).toHaveLength(1);
  await remoteEdit(page, state, 'Remote recipe');
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(r => r.name === 'Remote recipe')).toBe(true);
  await page.reload();
  await connect(page);
  expect((await localRecipes(page)).some(r => r.name === 'Remote recipe')).toBe(true);
});
test('expired authorization offers reconnect directly', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  state.unauthorized = true;
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  state.unauthorized = false;
  await connect(page);
});
test('fresh device does not resurrect a deleted preset', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const previous = state.snapshots.at(-1);
  const deletedId = previous.entries[0].id;
  state.snapshots.push({ version: 1, entries: previous.entries.map((e, i) => i === 0 ? { ...e, recipe: null, revision: `${String(Date.now()+1000).padStart(16,'0')}-deleted` } : e) });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await connect(page);
  expect((await localRecipes(page)).some(r => r.id === deletedId)).toBe(false);
});
test('offline changes upload after reconnect and failed uploads retry', async ({ page, context }) => {
  const state = await setup(page);
  await connect(page);
  await context.setOffline(true);
  await page.getByRole('button', { name: '새 레시피', exact: true }).click();
  await page.getByLabel('레시피 이름', { exact: true }).fill('Offline recipe');
  await page.getByRole('button', { name: '레시피 저장', exact: true }).click();
  state.failUpload = true;
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: '503' })).toBeVisible();
  expect((await localRecipes(page)).some(r => r.name === 'Offline recipe')).toBe(true);
  state.failUpload = false;
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect.poll(() => state.snapshots.at(-1).entries.some(e => e.recipe?.name === 'Offline recipe')).toBe(true);
});
test('remote changes wait while recipe editor is open', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  await remoteEdit(page, state, 'Deferred recipe');
  await page.getByRole('button', { name: '새 레시피', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(1500);
  expect((await localRecipes(page)).some(r => r.name === 'Deferred recipe')).toBe(false);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(r => r.name === 'Deferred recipe')).toBe(true);
});

test('manual backups preserve conflicting recipes and skip repeated imports', async ({ page }) => {
  const state = await setup(page);
  const initial = await localRecipes(page);
  await page.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drive에 저장', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Drive에 저장', exact: true }).click();
  await expect.poll(() => state.backups.length).toBe(1);
  state.backups[0].recipes[0].name = 'Conflicting backup';
  await page.getByRole('button', { name: '선택한 백업 가져오기', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).length).toBe(initial.length + 1);
  await page.getByRole('button', { name: '선택한 백업 가져오기', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '백업을 가져왔습니다' })).toBeVisible();
  expect((await localRecipes(page)).length).toBe(initial.length + 1);
  await page.getByRole('button', { name: '추출 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택한 백업 가져오기', exact: true })).toBeDisabled();
});
