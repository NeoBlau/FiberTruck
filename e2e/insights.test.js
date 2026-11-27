/* Read-only checks; requires imported financial months and an owner account.
   BASE=http://localhost FT_E2E_PASSWORD=... [FT_E2E_USER=owner] node e2e/insights.test.js */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost';
if (!process.env.FT_E2E_PASSWORD) throw new Error('Задайте FT_E2E_PASSWORD');

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/login');
    await page.fill('#login', process.env.FT_E2E_USER || 'owner');
    await page.fill('#password', process.env.FT_E2E_PASSWORD);
    await page.click('#go'); await page.waitForSelector('#nav a');
    const data = await page.evaluate(() => fetch('/api/bootstrap').then(r => r.json()));
    const months = Object.keys(data.fin || {}).filter(ym => Object.keys(data.fin[ym].cars).length).sort();
    assert.ok(months.length >= 2, 'Для проверки нужны два финансовых месяца');

    await page.goto(BASE + '/#/dashboard'); await page.selectOption('#selectedMonth', months.at(-1));
    const namesOnScreen = () => page.locator('#dashboardDetail tbody tr td:nth-child(2)').allTextContents();
    await page.selectOption('#dashboardSort', 'name');
    const names = await namesOnScreen();
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' })));
    await page.selectOption('#dashboardDirection', '-1'); assert.deepEqual(await namesOnScreen(), [...names].reverse());
    await page.reload(); await page.waitForSelector('#dashboardSort');
    assert.equal(await page.inputValue('#dashboardSort'), 'name');
    assert.equal(await page.inputValue('#dashboardDirection'), '-1');

    await page.goto(BASE + '/#/factors');
    for (const [key, value] of Object.entries({ baseFrom: months.at(-2), baseTo: months.at(-2), from: months.at(-1), to: months.at(-1) })) {
      await page.locator(`[data-insight="${key}"]`).fill(value);
    }
    await page.waitForSelector('#factorReconciliation');
    const number = s => Number(s.replace('−', '-').replace(/[^0-9,.-]/g, '').replace(',', '.'));
    for (const vat of ['asis', 'net']) for (const alloc of ['0', '1']) {
      await page.click(`[data-vat="${vat}"]`); await page.click(`[data-alloc="${alloc}"]`);
      assert.equal(await page.textContent('#factorReconciliation'), 'Сходится до копейки');
      const values = await page.locator('.factor-kpis .analytics-value').allTextContents();
      const effects = await page.locator('#factorEffectsTable tbody tr td:nth-child(2)>span').allTextContents();
      assert.ok(Math.abs(effects.reduce((s, e) => s + number(e), 0) - (number(values[1]) - number(values[0]))) < .011);
    }
    const factorDownload = page.waitForEvent('download'); await page.click('#factorExcel');
    assert.equal((await factorDownload).suggestedFilename(), 'FiberTrack_факторный_анализ.xlsx');

    await page.goto(BASE + '/#/business'); await page.waitForSelector('#businessFlow svg');
    assert.ok(await page.locator('#businessMonthsTable tbody tr').count() >= months.length);
    const original = await page.textContent('#scenarioProfit');
    await page.locator('#scenario-income').fill('10'); await page.locator('#scenario-income').dispatchEvent('input');
    assert.notEqual(await page.textContent('#scenarioProfit'), original);
    await page.click('#scenarioReset'); assert.equal(await page.textContent('#scenarioProfit'), original);
    // Transition must initialize the existing analytics search and sorting state.
    await page.selectOption('[data-insight="from"]', months.at(-1));
    await page.selectOption('[data-insight="to"]', months.at(-1));
    await page.click('[data-bnode="income"]'); await page.waitForSelector('#analyticsCarsTable tbody tr');
    assert.equal(await page.inputValue('#analyticsFrom'), months.at(-1));
    for (const route of ['factors', 'business']) {
      await page.goto(BASE + '/#/' + route); await page.waitForSelector('[data-insight="car"]');
      await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), route + ' на телефоне');
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.click('#theme'); await page.click('#theme');
    }
    assert.deepEqual(errors, [], 'Ошибки JavaScript');
    console.log('OK: сортировка, сохранение, сверка факторов, НДС/общие, сценарий, переходы и телефон');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
