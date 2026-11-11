import { test, expect } from '@playwright/test';

// Run the production bundle in Chromium. Only Google endpoints are replaced;
// React, localStorage, timers, navigation and user interactions are real.
async function setup(page, { preload = true } = {}) {
  const state = { snapshots: [], writes: [], backups: [], unauthorized: false, apiDisabled: false, corruptReads: false, failUpload: false, listFailure: 0, hold: null };
  await page.route('https://www.googleapis.com/**', async route => {
    if (state.unauthorized) return route.fulfill({ status: 401, body: '{}' });
    if (state.apiDisabled) return route.fulfill({ status: 403, json: { error: { code: 403, details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'drive.googleapis.com' } }] } } });
    const url = new URL(route.request().url());
    if (state.listFailure && route.request().method() === 'GET') return route.fulfill({ status: state.listFailure, body: '{}' });
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
      return route.fulfill({ json: { id: String(state.snapshots.length - 1) } });
    }
    if (url.searchParams.get('alt') === 'media') {
      const id = url.pathname.split('/').pop();
      if (state.corruptReads) {
        if (!id.startsWith('backup-')) return route.fulfill({ json: { version: 1, entries: [] } });
        const backup = structuredClone(state.backups[Number(id.slice(7))]);
        backup.recipes[0].name = 'Different saved content';
        return route.fulfill({ json: backup });
      }
      return route.fulfill({ json: id.startsWith('backup-') ? state.backups[Number(id.slice(7))] : state.snapshots[Number(id)] });
    }
    if (url.searchParams.get('q')?.includes('appProperties')) return route.fulfill({ json: { files: state.backups.map((_, id) => ({ id: `backup-${id}`, name: 'Backup', createdTime: new Date().toISOString() })) } });
    if (state.hold) await state.hold;
    return route.fulfill({ json: { files: state.snapshots.map((_, id) => ({ id: String(id) })) } });
  });
  const sdk = `window.__oauthRequests=0;window.google={accounts:{oauth2:{initTokenClient: config => ({requestAccessToken: () => {window.__oauthRequests++;config.callback({access_token:'test-token', expires_in:3600});}}),hasGrantedAllScopes:()=>true,revoke: (token,cb) => cb()}}};`;
  if (preload) await page.addInitScript(sdk);
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: sdk }));
  await page.goto('/pour-guide/');
  for (const name of ['Google Drive 동기화', 'Google Drive 백업']) {
    await expect(page.getByRole('region', { name, exact: true }).locator('details')).toHaveJSProperty('open', false);
  }
  await expandDrive(page);
  return state;
}
async function expandDrive(page) {
  for (const name of ['Google Drive 동기화', 'Google Drive 백업']) {
    const section = page.getByRole('region', { name, exact: true });
    if (await section.locator('details').getAttribute('open') === null) await section.locator('summary').click();
  }
}
async function connect(page) {
  await expandDrive(page);
  await page.getByRole('button', { name: 'Google Drive 연결', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Drive와 현재 레시피가 다릅니다' });
  await expect(page.getByRole('status').filter({ hasText: '동기화 완료' }).or(review)).toBeVisible();
  if (await review.isVisible()) await review.getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
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
  await page.getByRole('dialog').getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(r => r.name === 'Remote recipe')).toBe(true);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expandDrive(page);
  await expect(page.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
  expect(await page.evaluate(() => window.__oauthRequests)).toBe(0);
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
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
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
  await page.getByRole('dialog').getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(r => r.name === 'Deferred recipe')).toBe(true);
});

test('manual backups preserve conflicting recipes and skip repeated imports', async ({ page }) => {
  const state = await setup(page);
  const initial = await localRecipes(page);
  await page.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Drive에 저장', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Drive에 저장', exact: true }).click();
  await expect.poll(() => state.backups.length).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Drive에 저장하고 다시 읽어 확인했습니다' })).toBeVisible();
  state.backups[0].recipes[0].name = 'Conflicting backup';
  await page.getByRole('button', { name: '선택한 백업 가져오기', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).length).toBe(initial.length + 1);
  await page.getByRole('button', { name: '선택한 백업 가져오기', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '백업을 가져왔습니다' })).toBeVisible();
  expect((await localRecipes(page)).length).toBe(initial.length + 1);
  await page.getByRole('button', { name: '추출 시작', exact: true }).click();
  await expect(page.getByRole('button', { name: '선택한 백업 가져오기', exact: true })).toBeDisabled();
});

test('automatic connection check verifies Drive without changing recipes or uploading', async ({ page }) => {
  const state = await setup(page);
  const section = page.getByRole('region', { name: 'Google Drive 동기화', exact: true });
  await expect(section.getByRole('status').filter({ hasText: 'Drive 미연결' })).toBeVisible();
  await connect(page);
  await remoteEdit(page, state, 'Unapplied server edit');
  const recipes = await localRecipes(page);
  const writes = state.writes.length;
  await section.getByRole('button', { name: '자동 동기화 연결 확인', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: '연결 확인 완료' })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toContainText('최근 확인:');
  expect(await localRecipes(page)).toEqual(recipes);
  expect(state.writes.length).toBe(writes);
  state.unauthorized = true;
  await section.getByRole('button', { name: '자동 동기화 연결 확인', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인 실패' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toHaveCount(0);
});

test('manual connection check requires a Drive response, handles errors and recovers', async ({ page }) => {
  const state = await setup(page);
  const section = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  state.unauthorized = true;
  await section.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인 실패' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Drive에 저장', exact: true })).toHaveCount(0);
  state.unauthorized = false;
  await section.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toBeVisible();
  const recipes = await localRecipes(page);
  await section.getByRole('button', { name: '백업 연결 확인', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: '연결 확인 완료' })).toBeVisible();
  expect(state.backups).toHaveLength(0);
  expect(await localRecipes(page)).toEqual(recipes);
  state.listFailure = 503;
  await section.getByRole('button', { name: '백업 연결 확인', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인 실패' })).toBeVisible();
  await expect(section.getByRole('alert')).toContainText('503');
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toHaveCount(0);
  state.listFailure = 0;
  await section.getByRole('button', { name: '백업 연결 확인', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /레시피 선택/ }).click();
  await section.scrollIntoViewIfNeeded();
  const bounds = await section.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await section.screenshot({ path: 'output/playwright/drive-connection-mobile.png' });
  await section.getByRole('button', { name: '이 기기 연결 해제', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 미연결' })).toBeVisible();
});

test('disabled Drive API shows the project setting cause and recovers without signing in again', async ({ page }) => {
  const state = await setup(page);
  state.apiDisabled = true;
  const section = page.getByRole('region', { name: 'Google Drive 동기화', exact: true });
  await section.getByRole('button', { name: 'Google Drive 연결', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive API가 꺼져' })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인 실패' })).toBeVisible();
  await expect(section.getByRole('button', { name: '지금 동기화', exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  state.apiDisabled = false;
  await section.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('manual backup connection, selection and verified receipt survive a reload', async ({ page }) => {
  const state = await setup(page);
  const section = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  await section.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await section.getByRole('button', { name: 'Drive에 저장', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toBeVisible();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expandDrive(page);
  await expect(section.getByRole('status').filter({ hasText: '저장된 Google 연결과 Drive 백업 목록을 복원했습니다' })).toBeVisible();
  expect(await page.evaluate(() => window.__oauthRequests)).toBe(0);
  await expect(section.getByRole('button', { name: '선택한 백업 가져오기', exact: true })).toBeEnabled();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toContainText('3개 레시피');
  expect(state.backups).toHaveLength(1);
  await section.getByRole('button', { name: '이 기기 연결 해제', exact: true }).click();
  await page.reload();
  await expandDrive(page);
  await expect(section.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toHaveCount(0);
});

test('expired saved credentials retain the sync preference but never claim a live connection', async ({ page }) => {
  await setup(page);
  await connect(page);
  await page.evaluate(() => {
    const key = 'pour-guide.drive.session.v2';
    for (const storage of [localStorage, sessionStorage]) {
      const session = JSON.parse(storage.getItem(key));
      session.expiresAt = Date.now() - 1;
      storage.setItem(key, JSON.stringify(session));
    }
  });
  await page.reload();
  await expandDrive(page);
  const section = page.getByRole('region', { name: 'Google Drive 동기화', exact: true });
  await expect(section.getByRole('status').filter({ hasText: '자동 동기화 설정은 저장되어 있습니다' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  await expect(section.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('pour-guide.drive.session.v2'))).toBeNull();
  await section.getByRole('button', { name: '연결 해제', exact: true }).click();
  await page.reload();
  await expect(section.getByRole('status').filter({ hasText: '자동 동기화 설정은 저장되어 있습니다' })).toHaveCount(0);
});

test('new device retrieves the actual uploaded recipe from Drive', async ({ page, browser }) => {
  const state = await setup(page);
  await connect(page);
  await page.getByRole('button', { name: '새 레시피', exact: true }).click();
  await page.getByLabel('레시피 이름', { exact: true }).fill('Cloud round trip recipe');
  await page.getByRole('button', { name: '레시피 저장', exact: true }).click();
  await expect.poll(() => state.snapshots.at(-1).entries.some(entry => entry.recipe?.name === 'Cloud round trip recipe')).toBe(true);
  await expect(page.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toContainText('4개 레시피');
  const freshContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const other = await freshContext.newPage();
    const remote = await setup(other);
    remote.snapshots = state.snapshots;
    await connect(other);
    expect((await localRecipes(other)).some(recipe => recipe.name === 'Cloud round trip recipe')).toBe(true);
  } finally { await freshContext.close(); }
});

test('a successful upload response with different downloaded content is not reported as a saved backup', async ({ page }) => {
  const state = await setup(page);
  const section = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  await section.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  state.corruptReads = true;
  await section.getByRole('button', { name: 'Drive에 저장', exact: true }).click();
  await expect(section.getByRole('alert')).toContainText('일치하지 않습니다');
  await expect(section.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toHaveCount(0);
  expect((await localRecipes(page))[0].name).toBe('데일리 V60');
});

test('an existing device connection resumes in a newly created tab without Google authentication', async ({ page, context }) => {
  const state = await setup(page);
  await connect(page);
  const other = await context.newPage();
  try {
    const remote = await setup(other);
    remote.snapshots = state.snapshots;
    await expect(other.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
    expect(await other.evaluate(() => window.__oauthRequests)).toBe(0);
    await expect(other.getByRole('button', { name: '지금 동기화', exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test('remote changes wait for confirmation and declining leaves both sides untouched', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const original = await localRecipes(page);
  const writes = state.writes.length;
  await remoteEdit(page, state, 'Other device recipe');
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Drive와 현재 레시피가 다릅니다' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('이름');
  expect(await localRecipes(page)).toEqual(original);
  expect(state.writes).toHaveLength(writes);
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: 'output/playwright/drive-review-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.getByRole('button', { name: '지금은 덮어쓰지 않기', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('status').filter({ hasText: '덮어쓰기를 보류했습니다' })).toBeVisible();
  expect(await localRecipes(page)).toEqual(original);
  expect(state.writes).toHaveLength(writes);
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(recipe => recipe.name === 'Other device recipe')).toBe(true);
  expect(state.writes).toHaveLength(writes);
});

test('choosing local content replaces the Drive state including cloud-only recipes', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const local = await localRecipes(page);
  await remoteEdit(page, state, 'Cloud edit');
  state.snapshots.at(-1).entries.push({ id: 'cloud-only', recipe: { ...local[0], id: 'cloud-only', name: 'Cloud only' }, revision: `${String(Date.now() + 2000).padStart(16, '0')}-cloud` });
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Drive에만 있음');
  await dialog.getByRole('button', { name: '현재 기기 내용으로 Drive 갱신', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
  expect(await localRecipes(page)).toEqual(local);
  const saved = state.snapshots.at(-1).entries;
  expect(saved.find(entry => entry.id === 'cloud-only').recipe).toBeNull();
  expect(saved.find(entry => entry.id === local[0].id).recipe.name).toBe(local[0].name);
});

test('a second cloud change during the comparison requires a new confirmation', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const before = await localRecipes(page);
  await remoteEdit(page, state, 'First remote edit');
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('First remote edit');
  await remoteEdit(page, state, 'Second remote edit');
  await dialog.getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('다시 변경되었습니다');
  await expect(dialog).toContainText('Second remote edit');
  expect(await localRecipes(page)).toEqual(before);
  await dialog.getByRole('button', { name: 'Drive 내용으로 현재 기기 교체', exact: true }).click();
  await expect.poll(async () => (await localRecipes(page)).some(recipe => recipe.name === 'Second remote edit')).toBe(true);
});

test('reloading an unanswered comparison does not apply changes automatically', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const original = await localRecipes(page);
  await remoteEdit(page, state, 'Awaiting confirmation');
  await page.getByRole('button', { name: '지금 동기화', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await localRecipes(page)).toEqual(original);
  await page.getByRole('dialog').getByRole('button', { name: '지금은 덮어쓰지 않기', exact: true }).click();
});

test('automatic sync login also connects manual backups and logout clears both', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const backup = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  await expect(backup.getByRole('button', { name: 'Drive에 저장', exact: true })).toBeVisible();
  await expect(backup.getByRole('button', { name: 'Google 계정 연결', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__oauthRequests)).toBe(1);
  await backup.getByRole('button', { name: 'Drive에 저장', exact: true }).click();
  await expect(backup.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toBeVisible();
  expect(state.backups).toHaveLength(1);
  await backup.getByRole('button', { name: '이 기기 연결 해제', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  await expect(backup.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
  await page.reload();
  await expandDrive(page);
  await expect(page.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  await expect(backup.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
});

test('manual backup login shares authentication without starting automatic uploads', async ({ page }) => {
  const state = await setup(page);
  const backup = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  await backup.getByRole('button', { name: 'Google 계정 연결', exact: true }).click();
  await expect(backup.getByRole('button', { name: 'Drive에 저장', exact: true })).toBeVisible();
  const sync = page.getByRole('region', { name: 'Google Drive 동기화', exact: true });
  await expect(sync.getByRole('button', { name: '자동 동기화 시작', exact: true })).toBeVisible();
  await expect(sync.getByRole('status').filter({ hasText: 'Drive 연결 확인됨' })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(state.backups).toHaveLength(0);
  expect(await page.evaluate(() => window.__oauthRequests)).toBe(1);
  await sync.getByRole('button', { name: '자동 동기화 시작', exact: true }).click();
  await expect(sync.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
  expect(await page.evaluate(() => window.__oauthRequests)).toBe(1);
  await sync.getByRole('button', { name: '연결 해제', exact: true }).click();
  await expect(backup.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
});

test('authorization failure in backups invalidates the shared sync connection', async ({ page }) => {
  const state = await setup(page);
  await connect(page);
  const backup = page.getByRole('region', { name: 'Google Drive 백업', exact: true });
  state.unauthorized = true;
  await backup.getByRole('button', { name: '백업 연결 확인', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
  await expect(backup.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pour-guide.drive.session.v2'))).toBeNull();
  await page.getByRole('button', { name: '연결 해제', exact: true }).click();
  await expect(page.getByRole('button', { name: '연결 해제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Drive 저장·다시 읽기 확인:' })).toHaveCount(0);
});

test('shared logout propagates to another tab without resurrecting cached tokens', async ({ page, context }) => {
  const state = await setup(page);
  await connect(page);
  const other = await context.newPage();
  try {
    const remote = await setup(other);
    remote.snapshots = state.snapshots;
    await expect(other.getByRole('status').filter({ hasText: '동기화 완료' })).toBeVisible();
    await page.getByRole('button', { name: '연결 해제', exact: true }).click();
    await expect(other.getByRole('button', { name: 'Google Drive 연결', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Google 계정 연결', exact: true })).toBeVisible();
    expect(await other.evaluate(() => sessionStorage.getItem('pour-guide.drive.session.v2'))).toBeNull();
  } finally { await other.close(); }
});
