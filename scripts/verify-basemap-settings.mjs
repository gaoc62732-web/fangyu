// Synthetic credentials only; no screenshots, URL logging, environment or storage dumps.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
async function verifyUnavailableStorage() {
  const toModule = (source) =>
    'data:text/javascript;base64,' +
    Buffer.from(
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    ).toString('base64');
  const types = toModule(
    await readFile(new URL('../apps/web/src/features/maps/types.ts', import.meta.url), 'utf8'),
  );
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const source = (
    await readFile(
      new URL('../apps/web/src/features/maps/basemap-settings.ts', import.meta.url),
      'utf8',
    )
  )
    .replace("from 'vue'", 'from ' + JSON.stringify(pathToFileURL(require.resolve('vue')).href))
    .replace("from './types.js'", 'from ' + JSON.stringify(types))
    .replaceAll('import.meta.env.VITE_TIANDITU_KEY', "'synthetic_build_fallback'");
  globalThis.window = {};
  for (const name of ['localStorage', 'sessionStorage'])
    Object.defineProperty(window, name, {
      get() {
        throw new DOMException('Unavailable', 'SecurityError');
      },
    });
  try {
    const settings = await import(toModule(source));
    assert(settings.basemapProvider.value);
    assert.equal(settings.applyBasemapKey('synthetic_storage_test', false), false);
    assert.equal(settings.setBasemapEnabled(false), false);
    assert.equal(settings.basemapProvider.value, null);
    assert.equal(settings.setBasemapEnabled(true), false);
    assert(settings.basemapProvider.value);
    assert.equal(settings.clearBasemapKey(), false);
    assert.equal(settings.basemapProvider.value, null);
    assert.equal(settings.basemapCanEnable.value, false);
  } finally {
    delete globalThis.window;
  }
}
try {
  await verifyUnavailableStorage();
} catch {
  console.error('FAIL unavailable-storage checks; details suppressed.');
  process.exit(1);
}
if (process.env.SETTINGS_STATE_ONLY === '1') {
  console.log(
    'PASS unavailable-storage initialization, toggling and explicit clear without environment fallback.',
  );
  process.exit(0);
}
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'
);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
const helper = await context.newPage();
const data = await helper.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  return c.toDataURL();
});
const image = Buffer.from(data.split(',')[1], 'base64');
await helper.close();
const requestedLayers = new Set();
await context.route('https://t0.tianditu.gov.cn/**', (r) => {
  const layer = new URL(r.request().url()).searchParams.get('T');
  if (['vec_w', 'cva_w', 'img_w', 'cia_w'].includes(layer)) requestedLayers.add(layer);
  return r.fulfill({ status: 200, contentType: 'image/png', body: image });
});
const page = await context.newPage();
let errors = 0;
let stage = 'load';
page.setDefaultTimeout(12000);
page.on('pageerror', () => errors++);
const key = 'synthetic_browser_test';
const input = page.getByRole('textbox', { name: '天地图浏览器密钥' });
async function open() {
  await page.locator('.basemap-settings summary').click();
}
try {
  await page.goto((process.env.UI_BASE_URL || 'http://localhost:5190') + '/#/china');
  await open();
  const secret = page.locator('input[aria-label="天地图浏览器密钥"]');
  assert.equal(await secret.getAttribute('type'), 'password');
  assert.equal(await page.getByRole('checkbox', { name: '记住此浏览器' }).isChecked(), false);
  stage = 'fill synthetic';
  await secret.fill(key);
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  stage = 'test success';
  await page.getByText('连接成功，可以应用。', { exact: true }).waitFor();
  assert(requestedLayers.has('vec_w') && requestedLayers.has('cva_w'));
  await page.getByRole('button', { name: '应用底图设置', exact: true }).click();
  assert.equal(await secret.inputValue(), '');
  stage = 'toggle off and resume';
  const enabled = page.getByRole('checkbox', { name: '启用天地图在线底图' });
  await enabled.uncheck();
  await page.getByText('行政区地图 · 在线底图未启用', { exact: true }).waitFor();
  assert(
    await page.evaluate(() =>
      Boolean(JSON.parse(sessionStorage.getItem('fangyu-private-basemap-v1')).key),
    ),
  );
  await enabled.check();
  await page.getByText('在线底图 · 天地图政区图', { exact: true }).waitFor();
  stage = 'satellite layers';
  await page.getByRole('combobox', { name: '底图类型' }).selectOption('satellite');
  await secret.fill(key);
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功，可以应用。', { exact: true }).waitFor();
  assert(requestedLayers.has('img_w') && requestedLayers.has('cia_w'));
  await secret.fill('');
  await page.getByText('在线底图 · 天地图卫星图', { exact: true }).waitFor();
  assert(
    await page.evaluate(
      () =>
        sessionStorage.getItem('fangyu-private-basemap-v1') !== null &&
        localStorage.getItem('fangyu-private-basemap-v1') === null,
    ),
  );
  stage = 'reload';
  await page.reload();
  await open();
  await page.getByText('当前：使用本机设置。', { exact: false }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: '底图类型' }).inputValue(), 'satellite');
  await page.getByRole('button', { name: '关闭在线底图（保留密钥）', exact: true }).click();
  await page.reload();
  await open();
  assert.equal(await enabled.isChecked(), false);
  assert.equal(await enabled.isDisabled(), false);
  await enabled.check();
  stage = 'fill synthetic';
  await secret.fill(key);
  await page.getByRole('checkbox', { name: '记住此浏览器' }).check();
  await page.getByRole('button', { name: '应用底图设置', exact: true }).click();
  assert(
    await page.evaluate(
      () =>
        localStorage.getItem('fangyu-private-basemap-v1') !== null &&
        sessionStorage.getItem('fangyu-private-basemap-v1') === null,
    ),
  );
  await page.getByRole('button', { name: '清除密钥', exact: true }).click();
  stage = 'reload';
  await page.reload();
  await open();
  await page.getByText('当前：已禁用。', { exact: false }).waitFor();
  assert.equal(await enabled.isDisabled(), true);
  assert(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('fangyu-private-basemap-v1')).mode === 'disabled' &&
        !JSON.parse(localStorage.getItem('fangyu-private-basemap-v1')).key,
    ),
  );
  await page.getByRole('button', { name: '使用构建配置', exact: true }).click();
  await page
    .locator('.basemap-settings [role="status"]')
    .filter({ hasText: /已明确切换为构建配置|构建配置未提供可用密钥/ })
    .waitFor();
  await context.unroute('https://t0.tianditu.gov.cn/**');
  await context.route('https://t0.tianditu.gov.cn/**', (r) =>
    r.fulfill({ status: 403, body: 'denied' }),
  );
  stage = 'fill synthetic';
  await secret.fill(key);
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接未成功，请检查密钥、域名授权和网络后重试。', { exact: true }).waitFor();
  assert.equal(errors, 0);
  console.log(
    'PASS password input; opt-in persistence; session reload; remembered browser; toggle retains key; vector/satellite layer pairs; kind persists; clear prevents reactivation; explicit environment restore; success/failure messages; no uncaught errors.',
  );
} catch {
  console.error('FAIL basemap settings test stage: ' + stage);
  console.log(
    await page
      .locator('.basemap-settings [role="status"]')
      .innerText()
      .catch(() => 'No safe status available.'),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
