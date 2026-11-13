"""Browser regression checks against a disposable synthetic 58-vehicle September fixture.
Requires Python playwright, openpyxl and system Chromium. Does not seed or modify financial data.
"""
from pathlib import Path
import json,io
import openpyxl
from playwright.sync_api import sync_playwright
OUT=Path(__file__).resolve().parents[1] / 'artifacts'; OUT.mkdir(exist_ok=True)
import os
assert os.environ.get('FT_E2E_SYNTHETIC') == '1', 'Run only on the disposable 58-vehicle synthetic fixture; set FT_E2E_SYNTHETIC=1'
BASE=os.environ.get('BASE','http://127.0.0.1:8000')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 ctx=b.new_context(viewport={'width':1680,'height':1050},device_scale_factor=1)
 page=ctx.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(BASE+'/login');page.fill('#login','owner');page.fill('#password',os.environ.get('FT_E2E_PASSWORD','Test-pass-123'));page.click('#go');page.wait_for_selector('#nav a')
 page.evaluate("localStorage.setItem('ft-ym','2026-09')")
 for mode in (['before','after'] if (OUT/'before/app.js').exists() else ['after']):
  if mode=='before':
   page.route('**/static/app.js*',lambda r:r.fulfill(path=str(OUT/'before/app.js'),content_type='application/javascript'))
   page.route('**/static/app.css*',lambda r:r.fulfill(path=str(OUT/'before/app.css'),content_type='text/css'))
  else:page.unroute_all()
  for route in ['dashboard','cars','fleet','report','settings','car/101']:
   page.goto(BASE+'/#/'+route);page.reload();page.wait_for_timeout(550)
   page.screenshot(path=str(OUT/f'{mode}-{route.replace("/","-")}.png'),full_page= route not in ['report'])
   if route=='report':
    page.pdf(path=str(OUT/f'{mode}-fleet-report.pdf'),print_background=True,prefer_css_page_size=True)
  if mode=='after':
   page.goto(BASE+'/#/dashboard');page.wait_for_timeout(300)
   assert page.locator('.full-detail tbody tr').count()==58
   page.locator('.full-detail').screenshot(path=str(OUT/'after-full-ranking.png'))
   page.goto(BASE+'/#/cars');page.wait_for_timeout(300)
   assert page.locator('#carsTable tbody tr').count()==58
   assert '20'==page.locator('#carsTable tbody tr').first.locator('td').nth(6).inner_text()
   with page.expect_download() as dl:page.click('#xls')
   dl.value.save_as(str(OUT/'full-export.xlsx'))
   w=openpyxl.load_workbook(OUT/'full-export.xlsx',data_only=True)
   assert w['Все показатели месяца'].max_row==60
   header=[c.value for c in w['Все показатели месяца'][2]]
   assert len(header)==28,header
   rows=list(w['Все показатели месяца'].values)[2:]
   assert sum(r[5] for r in rows)==580000
   assert sum(r[6] for r in rows)==1160
   assert all(r[header.index('Документ')]=='Тестовый акт №1' for r in rows)
   page.goto(BASE+'/#/report');page.wait_for_timeout(400)
   assert page.locator('.report-ranking tbody tr').count()==62 # 58 ranking + 4 shared
   assert page.locator('.report-car').count()==58
   page.select_option('#selectedMonth','2026-11');page.wait_for_timeout(200)
   assert page.locator('#selectedMonth').input_value()=='2026-11'
   assert 'Отчёт пока' in page.locator('#content').inner_text()
   page.select_option('#selectedMonth','2026-09');page.wait_for_timeout(200)
   page.click('[data-vat="net"]');page.wait_for_timeout(200)
   assert '1\xa0001\xa0000' in page.locator('.report-ranking tbody tr').first.inner_text()
   page.goto(BASE+'/#/settings');page.wait_for_timeout(200)
   with page.expect_download() as dl:page.click('#downloadBackup')
   dl.value.save_as(str(OUT/'test-full-backup.zip'))
   assert dl.value.failure() is None
   # All pages, same data, no uncaught browser exceptions.
   for route in ['dashboard','cars','car/101','heatmap','fuel','years','dynamics','recon','report','input','periods','fleet','review','settings']:
    page.goto(BASE+'/#/'+route);page.wait_for_timeout(150)
   print('browser errors',errors)
   assert not errors,errors
 b.close()
print('Browser pass: 58 rows, all columns, days, export, report, month selection, VAT, backup, all screens.')
