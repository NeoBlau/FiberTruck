/* Сквозной тест трёх ролей в настоящем браузере.
   Нужны пользователи owner / boss / buh с паролем из FT_E2E_PASSWORD и импортированная история.
   Запуск:  BASE=http://localhost FT_E2E_PASSWORD=... node e2e/roles.test.js  */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost';
const PASSWORD = process.env.FT_E2E_PASSWORD;
if (!PASSWORD) { console.error('Задайте FT_E2E_PASSWORD'); process.exit(2); }

async function login(browser, user) {
  const pg = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  pg.errors = []; pg.on('pageerror', e => pg.errors.push(e.message));
  await pg.goto(BASE + '/login');
  await pg.fill('#login', user); await pg.fill('#password', PASSWORD);
  await Promise.all([pg.waitForNavigation(), pg.click('#go')]);
  await pg.waitForSelector('#nav a');
  return pg;
}
const nav = pg => pg.$$eval('#nav a', a => a.map(x => x.firstChild ? x.textContent.replace(/\d+$/, '').trim() : ''));

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const owner = await login(browser, 'owner');
    for (const p of ['dashboard', 'cars', 'car/885', 'heatmap', 'fuel', 'years', 'dynamics', 'recon', 'report', 'input', 'periods', 'fleet', 'review', 'settings']) {
      await owner.goto(`${BASE}/#/${p}`); await owner.waitForTimeout(400);
      assert.notEqual((await owner.textContent('h1')).trim(), 'Нет доступа', `владелец: ${p}`);
    }
    assert.deepEqual(owner.errors, [], 'ошибки в браузере у владельца');

    const boss = await login(browser, 'boss');
    assert.ok(!(await nav(boss)).includes('Настройки'));
    await boss.goto(`${BASE}/#/fleet`); await boss.waitForTimeout(400);
    assert.equal((await boss.$$('[data-fk] .btn')).length, 0, 'руководитель не редактирует справочник');
    await boss.goto(`${BASE}/#/periods`); await boss.waitForTimeout(300);
    assert.equal((await boss.textContent('h1')).trim(), 'Нет доступа');

    const buh = await login(browser, 'buh');
    assert.deepEqual(await nav(buh), ['Загрузка и ввод', 'Справочник машин', 'Проверить']);
    for (const p of ['dashboard', 'cars', 'car/885', 'report', 'settings', 'periods']) {
      await buh.goto(`${BASE}/#/${p}`); await buh.waitForTimeout(300);
      assert.equal((await buh.textContent('h1')).trim(), 'Нет доступа', `бухгалтер: ${p}`);
    }
    const leaked = await buh.evaluate(() => fetch('/api/bootstrap').then(r => r.json())
      .then(d => Object.keys(d.profit).length + Object.keys(d.shared).length + Object.keys(d.fuel_month).length));
    assert.equal(leaked, 0, 'бухгалтер не должен получать агрегаты');
    console.log('OK: три роли проверены');
  } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
