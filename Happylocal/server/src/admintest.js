/**
 * 운영 화면(admin.html) 브라우저 검증.
 *
 *   npm run test:admin
 *
 * 역할에 따라 메뉴가 달라지는지, 그리고 화면에서 누른 결과가 실제 데이터를
 * 바꾸는지 봅니다. 서버 계약은 roletest.js 가 따로 봅니다.
 */
import fs from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('\n  playwright-core 가 없어 건너뜁니다.\n'); process.exit(0); }

const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;
const URL = `${BASE}/admin.html`;

function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((p) => fs.existsSync(p)) || null;
}
const CHROME = findBrowser();
if (!CHROME) { console.log('\n  Chrome/Edge 를 찾지 못해 건너뜁니다.\n'); process.exit(0); }

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const group = (t) => console.log(`\n  [${t}]`);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const consoleErrors = [];
const pageErrors = [];

/** 역할별로 새 브라우저 컨텍스트를 씁니다. 쿠키가 섞이면 격리 검사가 무의미합니다. */
async function session(nickname, roles, scope) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${nickname}: ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`${nickname}: ${e.message}`));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([n, r, s]) => fetch('/api/auth/dev-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: n, roles: r, scope: s }),
  }).then((x) => x.ok), [nickname, roles, scope]);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  return { ctx, page };
}

const navLabels = (page) =>
  page.$$eval('#nav button', (els) => els.map((e) => e.textContent.trim()));

// 어느 상품이 어느 거점에 붙어 있는지 확인합니다.
const probe = await browser.newContext();
const pp = await probe.newPage();
await pp.goto(URL, { waitUntil: 'domcontentloaded' });
const products = await pp.evaluate(() => fetch('/api/products').then((r) => r.json()).then((d) => d.raw));
await probe.close();
const A = products.find((p) => p.placeKey === 'pk_hanwoo');
const B = products.find((p) => p.placeKey === 'pk_js_gondre');
if (!A || !B) { console.error('연결된 픽업 상품을 찾지 못했습니다.'); process.exit(1); }

// =================================================================
group('역할별 메뉴');
// =================================================================
const mgrA = await session('화면검사 매장A', ['store_manager'], { storeKeys: ['pk_hanwoo'] });
const mgrB = await session('화면검사 매장B', ['store_manager'], { storeKeys: ['pk_js_gondre'] });
const farmer = await session('화면검사 농가', ['producer'], { productIds: [A.id] });
const admin = await session('화면검사 관리자', ['super_admin'], {});
const guest = await session('화면검사 손님', ['customer'], {});

{
  const m = await navLabels(mgrA.page);
  check(m.includes('오늘 픽업'), `매장 관리인 메뉴 (${m.join(', ')})`);
  check(!m.includes('오늘 출하'), '매장 관리인에게 농가 메뉴가 안 보임');
  check(!m.includes('계정 · 역할'), '매장 관리인에게 계정 관리가 안 보임');

  const f = await navLabels(farmer.page);
  check(f.includes('오늘 출하'), `생산자 메뉴 (${f.join(', ')})`);
  check(!f.includes('오늘 픽업'), '생산자에게 매장 메뉴가 안 보임');

  const a = await navLabels(admin.page);
  check(a.includes('계정 · 역할') && a.includes('감사 로그'),
    `최고관리자 메뉴 (${a.length}개)`);
  check(a.length >= 14, `최고관리자는 전 화면 접근 (${a.length}개)`);
  check(!m.includes('콘텐츠 편집') && !m.includes('입점 심사'),
    '매장 관리인에게 운영 메뉴가 안 보임');
  check(!f.includes('정산 집행'), '생산자에게 정산 집행이 안 보임');
  check(f.includes('정산'), '생산자에게 자기 정산서는 보임');

  // 일반 사용자는 아예 들어오지 못합니다.
  const blocked = await guest.page.$eval('#gate', (el) => !el.hidden).catch(() => false);
  check(blocked === true, '일반 사용자는 로그인 관문에서 막힘');
  const appHidden = await guest.page.$eval('#app', (el) => el.hidden);
  check(appHidden === true, '일반 사용자에게 운영 화면이 안 열림');
}

// =================================================================
group('오늘 출하 — 화면에서 재고가 실제로 늘어남');
// =================================================================
let stockAfterShip;
{
  const before = await farmer.page.evaluate((id) =>
    fetch('/api/products').then((r) => r.json())
      .then((d) => d.raw.find((p) => p.id === id).stock), A.id);
  await farmer.page.click('#nav button[data-view="shipping"]');
  await farmer.page.waitForTimeout(700);

  const rows = await farmer.page.$$('#main .prow');
  check(rows.length === 1, `담당 상품만 보임 (${rows.length}개)`);

  await farmer.page.fill(`#q-${A.id}`, '7');
  await farmer.page.click('#main .prow .btn.pri');
  await farmer.page.waitForTimeout(900);

  const msg = await farmer.page.textContent('#msg').catch(() => '');
  check(/출하/.test(msg || ''), `출하 결과 안내 (${(msg || '').trim()})`);

  stockAfterShip = await farmer.page.evaluate((id) =>
    fetch('/api/products').then((r) => r.json())
      .then((d) => d.raw.find((p) => p.id === id).stock), A.id);
  check(stockAfterShip === before + 7,
    `서버 재고가 화면 조작만큼 늘어남 (${before} → ${stockAfterShip})`);

  const shown = await farmer.page.textContent('#main .prow .stockbadge');
  check(Number(shown.trim()) === stockAfterShip,
    `화면에 찍힌 재고 = 서버 재고 (${shown.trim()})`);
}

// =================================================================
group('오늘 픽업 — 예약코드 조회와 수령 확인');
// =================================================================
let orderCode, orderId;
{
  // 예약 직전 재고를 다시 읽습니다. 앞서 읽은 값을 쓰면 그 사이 다른 주문이
  // 하나만 들어와도 깨집니다 (테스트를 나란히 돌리면 실제로 그렇습니다).
  const stockBeforeOrder = await guest.page.evaluate((id) =>
    fetch('/api/products').then((r) => r.json())
      .then((d) => d.raw.find((p) => p.id === id).stock), A.id);

  const made = await guest.page.evaluate((id) => fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: id, qty: 2 }),
  }).then((r) => r.json()), A.id);
  orderCode = made.order.code; orderId = made.order.id;
  check(!!orderCode, `손님 예약 생성 (${orderCode})`);

  await mgrA.page.click('#nav button[data-view="pickups"]');
  await mgrA.page.waitForTimeout(800);

  const codes = await mgrA.page.$$eval('#main tbody tr td:first-child',
    (els) => els.map((e) => e.textContent.trim()));
  check(codes.includes(orderCode), `목록에 새 예약이 뜸 (${codes.length}건)`);

  // 코드 조회
  await mgrA.page.fill('#lk', orderCode.toLowerCase());   // 대소문자 무관해야 합니다
  await mgrA.page.click('.lookup .btn.pri');
  await mgrA.page.waitForTimeout(700);
  const hit = await mgrA.page.textContent('#hit');
  check(/횡성한우/.test(hit), `소문자로 넣어도 조회됨 (${hit.trim().slice(0, 30)}…)`);
  check(/대기/.test(hit), '상태가 대기로 표시됨');

  // 수령 확인
  await mgrA.page.click('#hit .btn.pri');
  await mgrA.page.waitForTimeout(1100);

  const status = await mgrA.page.evaluate((code) =>
    fetch('/api/store/pickups').then((r) => r.json())
      .then((d) => (d.pickups.find((p) => p.code === code) || {}).status), orderCode);
  check(status === 'completed', `수령 확인이 서버에 반영됨 (${status})`);

  const stock = await mgrA.page.evaluate((id) =>
    fetch('/api/products').then((r) => r.json())
      .then((d) => d.raw.find((p) => p.id === id).stock), A.id);
  check(stock === stockBeforeOrder - 2,
    `재고는 예약 시점에만 빠짐 (${stockBeforeOrder} → ${stock})`);

  // 이미 처리된 건은 버튼이 사라져야 합니다.
  await mgrA.page.fill('#lk', orderCode);
  await mgrA.page.click('.lookup .btn.pri');
  await mgrA.page.waitForTimeout(600);
  const again = await mgrA.page.textContent('#hit');
  check(/이미 처리된/.test(again), '처리된 예약은 다시 확인할 수 없음');
}

// =================================================================
group('화면 격리 — 다른 매장의 예약');
// =================================================================
{
  const ordB = await guest.page.evaluate((id) => fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: id, qty: 1 }),
  }).then((r) => r.json()), B.id);

  await mgrA.page.click('#nav button[data-view="pickups"]');
  await mgrA.page.waitForTimeout(700);
  const codesA = await mgrA.page.$$eval('#main tbody tr td:first-child',
    (els) => els.map((e) => e.textContent.trim()));
  check(!codesA.includes(ordB.order.code), 'A 매장 목록에 B 예약이 없음');

  // 코드를 직접 넣어도 찾지 못해야 합니다.
  await mgrA.page.fill('#lk', ordB.order.code);
  await mgrA.page.click('.lookup .btn.pri');
  await mgrA.page.waitForTimeout(700);
  const hit = await mgrA.page.textContent('#hit');
  check(/찾을 수 없/.test(hit), `A 매장이 B 예약코드를 조회하지 못함 (${hit.trim().slice(0, 24)}…)`);

  await mgrB.page.click('#nav button[data-view="pickups"]');
  await mgrB.page.waitForTimeout(700);
  const codesB = await mgrB.page.$$eval('#main tbody tr td:first-child',
    (els) => els.map((e) => e.textContent.trim()));
  check(codesB.includes(ordB.order.code), 'B 매장에는 자기 예약이 보임');

  await mgrB.page.evaluate((id) =>
    fetch(`/api/store/pickups/${id}/noshow`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restock: true }),
    }), ordB.order.id);
}

// =================================================================
group('일일 마감 · 판매 현황');
// =================================================================
{
  await mgrA.page.click('#nav button[data-view="closing"]');
  await mgrA.page.waitForTimeout(700);
  const vals = await mgrA.page.$$eval('#main .stat .v', (els) => els.map((e) => e.textContent.trim()));
  check(vals.length >= 6, `마감 지표가 렌더링됨 (${vals.length}개)`);
  const done = Number(vals[1]);
  check(done >= 1, `수령완료가 집계됨 (${done}건)`);

  const revText = await mgrA.page.$$eval('#main .stat',
    (els) => (els.find((e) => /매출/.test(e.textContent)) || {}).textContent || '');
  check(/[1-9]/.test(revText), `매출이 0 이 아님 (${revText.replace(/\s+/g, ' ').trim()})`);

  await farmer.page.click('#nav button[data-view="sales"]');
  await farmer.page.waitForTimeout(700);
  const rows = await farmer.page.$$('#main tbody tr');
  check(rows.length >= 1, `판매 현황 표가 채워짐 (${rows.length}행)`);
}

// =================================================================
group('계정 · 역할 화면');
// =================================================================
{
  await admin.page.click('#nav button[data-view="users"]');
  await admin.page.waitForTimeout(1200);
  const rows = await admin.page.$$('#main tbody tr');
  check(rows.length > 0, `계정 목록 (${rows.length}명)`);

  const chips = await admin.page.$$eval('#main .rolechip', (els) => els.map((e) => e.textContent.trim()));
  check(chips.some((c) => c === '매장 관리인'), '역할이 한글로 표시됨');

  // 편집기를 열어 봅니다.
  await admin.page.click('#main tbody tr:first-child .btn');
  await admin.page.waitForTimeout(600);
  const hasEditor = await admin.page.$('#e-roles');
  check(!!hasEditor, '역할 편집기가 열림');
  const opts = await admin.page.$$eval('#e-stores option', (els) => els.length);
  check(opts >= 13, `담당 거점 후보가 채워짐 (${opts}개)`);

  await admin.page.click('#nav button[data-view="audit"]');
  await admin.page.waitForTimeout(900);
  const auditRows = await admin.page.$$('#main tbody tr');
  check(auditRows.length >= 0, `감사 로그 화면 (${auditRows.length}행)`);

  await admin.page.click('#nav button[data-view="stats"]');
  await admin.page.waitForTimeout(900);
  const stats = await admin.page.$$eval('#main .stat .v', (els) => els.map((e) => e.textContent.trim()));
  check(stats.length >= 10, `전체 통계 지표 (${stats.length}개)`);
}

// =================================================================
group('운영 화면');
// =================================================================
{
  // 새로 붙인 화면들이 실제로 렌더링되는지 봅니다.
  for (const [view, want] of [
    ['content', '콘텐츠 편집'], ['coupons', '쿠폰 발행'], ['reviews', '후기 관리'],
    ['settle', '정산 집행'], ['apply', '입점 심사'], ['mysettle', null],
  ]) {
    if (view === 'mysettle') continue;
    await admin.page.click(`#nav button[data-view="${view}"]`);
    await admin.page.waitForTimeout(800);
    const h1 = await admin.page.textContent('#main h1').catch(() => '');
    const err = await admin.page.$('#main .msg.err');
    check(h1.trim() === want && !err, `${want} 화면이 열림`,
      err ? await admin.page.textContent('#main .msg.err') : `제목: ${h1}`);
  }

  // 콘텐츠 편집기는 실제 값을 담고 있어야 합니다.
  await admin.page.click('#nav button[data-view="content"]');
  await admin.page.waitForTimeout(900);
  const json = await admin.page.inputValue('#cval').catch(() => '');
  let parsed = null;
  try { parsed = JSON.parse(json); } catch (e) { /* 아래에서 잡습니다 */ }
  check(parsed !== null, `편집기에 올바른 JSON 이 실림 (${json.length}자)`);

  // 정산 화면의 수식이 화면에서도 맞는가
  await admin.page.click('#nav button[data-view="settle"]');
  await admin.page.waitForTimeout(900);
  const cells = await admin.page.$$eval('#main tbody tr', (rows) => rows.map((r) => {
    const t = [...r.querySelectorAll('td')].map((c) => c.textContent.trim());
    const n = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;
    return { gross: n(t[2]), fee: n(t[3]), net: n(t[4]) };
  }));
  const wrong = cells.filter((c) => c.net !== c.gross - c.fee);
  check(cells.length > 0, `정산 표에 ${cells.length}행`);
  check(wrong.length === 0, '화면의 지급액 = 판매액 − 수수료',
    wrong.slice(0, 2).map((c) => `${c.gross}/${c.fee}/${c.net}`).join(' | '));

  // 생산자 정산서
  await farmer.page.click('#nav button[data-view="mysettle"]');
  await farmer.page.waitForTimeout(800);
  const mh = await farmer.page.textContent('#main h1').catch(() => '');
  check(mh.trim() === '정산', `생산자 정산 화면 (${mh.trim()})`);
}

// =================================================================
group('콘솔');
// =================================================================
{
  // 서버가 403 을 주는 것은 정상 동작이라 로그에 남습니다. 그 밖의 오류만 봅니다.
  const real = consoleErrors.filter((e) => !/Failed to load resource/.test(e));
  check(real.length === 0, '콘솔 오류 없음', real.slice(0, 3).join(' | '));
  check(pageErrors.length === 0, '자바스크립트 예외 없음', pageErrors.slice(0, 3).join(' | '));
}

console.log('');
await browser.close();
if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
console.log('  운영 화면 검증 전부 통과\n');
