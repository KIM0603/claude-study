/**
 * 실제 브라우저에서 로그인 폼을 눌러 보는 검증.
 *
 *   npm run test:login
 *
 * accounttest 는 API 로만 확인합니다. 폼이 실제로 제출되는지, 로그인 뒤
 * 화면에 내 데이터가 실리는지, 역할에 맞는 메뉴가 뜨는지는 브라우저로만
 * 알 수 있습니다.
 */
import fs from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('\n  playwright-core 가 없어 건너뜁니다.\n'); process.exit(0); }

const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;
const APP = `${BASE}/happylocal_v2.html`;
const ADMIN = `${BASE}/admin.html`;
const PW = 'happylocal2026';

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
const pageErrors = [];

/** 앱을 열고 로그인 화면까지 갑니다. 컨텍스트를 새로 만들어 쿠키를 분리합니다. */
async function appPage() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(700);
  return { ctx, page };
}

// =================================================================
group('앱 - 로그인 폼');
// =================================================================
{
  const { ctx, page } = await appPage();

  const loggedOut = await page.evaluate('typeof hlLoggedIn === "function" && !hlLoggedIn()');
  check(loggedOut === true, '처음에는 비로그인 상태');

  await page.evaluate("go('login')");
  await page.waitForTimeout(500);

  const formShown = await page.isVisible('#lg-form');
  check(formShown, '로그인 화면에 아이디·비밀번호 폼이 있음');
  const kakaoShown = await page.isVisible('#lg-kakao');
  check(kakaoShown, '카카오 버튼도 함께 있음');

  // 틀린 비밀번호
  await page.fill('#lg-id', 'customer1');
  await page.fill('#lg-pw', 'wrong-password');
  await page.click('#lg-submit');
  await page.waitForTimeout(900);
  const err = await page.textContent('#lg-err');
  check(/올바르지 않/.test(err || ''), `틀린 비밀번호에 오류 표시 (${(err || '').trim()})`);
  const stillOut = await page.evaluate('!hlLoggedIn()');
  check(stillOut, '실패하면 로그인되지 않음');

  // 맞는 비밀번호
  await page.fill('#lg-pw', PW);
  await page.click('#lg-submit');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(900);

  const me = await page.evaluate('(HL_USER || {}).nickname || ""');
  check(/김하늘/.test(me), `로그인 후 내 이름이 실림 (${me})`);
  const loggedIn = await page.evaluate('hlLoggedIn()');
  check(loggedIn === true, '로그인 상태로 바뀜');

  // 새로고침해도 유지되는가 (세션 쿠키)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(800);
  check(await page.evaluate('hlLoggedIn()'), '새로고침해도 로그인 유지');

  // 내 데이터가 실리는가
  const mine = await page.evaluate('({coupons: MY_COUPONS.length, picks: MY_PICKUPS.length})');
  check(mine.coupons > 0, `내 쿠폰이 실림 (${mine.coupons}장)`);

  await ctx.close();
}

// =================================================================
group('앱 - 회원가입 폼');
// =================================================================
{
  const { ctx, page } = await appPage();
  const id = 'br_' + Date.now().toString(36).slice(-6);

  await page.evaluate("go('login')");
  await page.waitForTimeout(400);
  await page.click('#lg-swap-btn');
  await page.waitForTimeout(300);

  const nickShown = await page.isVisible('#lg-nick');
  check(nickShown, '가입 모드로 바꾸면 닉네임 칸이 나타남');
  const label = await page.textContent('#lg-submit');
  check(/가입/.test(label), `버튼이 가입으로 바뀜 (${label.trim()})`);

  await page.fill('#lg-id', id);
  await page.fill('#lg-pw', '1234');
  await page.fill('#lg-nick', '브라우저 가입');
  await page.click('#lg-submit');
  await page.waitForTimeout(900);
  const err = await page.textContent('#lg-err');
  check(/8자/.test(err || ''), `약한 비밀번호에 안내 (${(err || '').trim()})`);

  await page.fill('#lg-pw', PW);
  await page.click('#lg-submit');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(900);

  const me = await page.evaluate('(HL_USER || {}).nickname || ""');
  check(/브라우저 가입/.test(me), `가입 즉시 로그인됨 (${me})`);
  const coupons = await page.evaluate('MY_COUPONS.length');
  check(coupons > 0, `가입 쿠폰이 화면에 실림 (${coupons}장)`);

  await ctx.close();
}

// =================================================================
group('앱 - 예약 후 픽업 코드');
// =================================================================
{
  const { ctx, page } = await appPage();
  await page.evaluate("go('login')");
  await page.waitForTimeout(400);
  await page.fill('#lg-id', 'customer1');
  await page.fill('#lg-pw', PW);
  await page.click('#lg-submit');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(900);

  const made = await page.evaluate(`(async function(){
    var p = PL.find(function (x) { return x.stock > 0 && x.fid; });
    openStoreByFid(p.fid); sdQtyVal = 1; payQty = 1; openPay();
    document.getElementById('pay-agree').classList.add('on');
    await payDo();
    await new Promise(function (r) { setTimeout(r, 1200); });
    openCart();
    await new Promise(function (r) { setTimeout(r, 400); });
    var b = document.querySelector('#cart-list .mc-pass-btn');
    if (b) b.click();
    await new Promise(function (r) { setTimeout(r, 400); });
    return {
      code: (document.getElementById('pv-code') || {}).textContent || '',
      open: document.getElementById('pvsheet').classList.contains('show'),
      real: (MY_PICKUPS[0] || {}).code || '',
    };
  })()`);
  check(made.open, '픽업 코드 화면이 열림');
  check(made.code === made.real && /^HL-/.test(made.code),
    `화면 코드 = 실제 예약코드 (${made.code})`);

  await ctx.close();
}

// =================================================================
group('운영 화면 - 역할별 로그인');
// =================================================================
{
  const cases = [
    ['store_hanwoo', ['오늘 픽업', '일일 마감', '매장 정보'], ['오늘 출하', '계정 · 역할']],
    ['farmer_hs', ['오늘 출하', '판매 현황', '정산'], ['오늘 픽업', '계정 · 역할']],
    ['operator1', ['콘텐츠 편집', '쿠폰 발행', '후기 관리'], ['오늘 픽업', '계정 · 역할']],
    ['admin1', ['계정 · 역할', '감사 로그', '입점 심사', '정산 집행'], []],
    ['farmstore_pc', ['오늘 픽업', '오늘 출하'], ['계정 · 역할']],
  ];

  for (const [id, want, notWant] of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${id}: ${e.message}`));

    await page.goto(ADMIN, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    await page.fill('#lg-id', id);
    await page.fill('#lg-pw', PW);
    await page.click('form.devbox button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(1200);

    const opened = await page.$eval('#app', (el) => !el.hidden).catch(() => false);
    const nav = await page.$$eval('#nav button', (els) => els.map((e) => e.textContent.trim()));
    check(opened, `${id} 로그인 → 운영 화면 열림`);

    const missing = want.filter((w) => !nav.includes(w));
    check(missing.length === 0, `${id} 메뉴 (${nav.length}개)`, '없는 메뉴: ' + missing.join(', '));

    const leaked = notWant.filter((w) => nav.includes(w));
    check(leaked.length === 0, `${id} 에게 남의 메뉴가 안 보임`, '샌 메뉴: ' + leaked.join(', '));

    await ctx.close();
  }
}

// =================================================================
group('운영 화면 - 일반 사용자는 못 들어감');
// =================================================================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(ADMIN, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.fill('#lg-id', 'customer1');
  await page.fill('#lg-pw', PW);
  await page.click('form.devbox button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);

  const appHidden = await page.$eval('#app', (el) => el.hidden);
  check(appHidden === true, '일반 사용자에게 운영 화면이 안 열림');
  const msg = await page.textContent('#gate-msg').catch(() => '');
  check(/권한/.test(msg || ''), `안내 문구가 뜸 (${(msg || '').trim()})`);
  await ctx.close();
}

// =================================================================
group('매장 관리인 - 실제 수령 확인');
// =================================================================
{
  // 손님이 앱에서 예약하고, 매장이 운영 화면에서 코드로 찾아 확인합니다.
  const buyer = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const bp = await buyer.newPage();
  await bp.goto(APP, { waitUntil: 'domcontentloaded' });
  await bp.evaluate('window.HL_READY');
  await bp.waitForTimeout(600);
  await bp.evaluate("go('login')");
  await bp.waitForTimeout(400);
  await bp.fill('#lg-id', 'customer2');
  await bp.fill('#lg-pw', PW);
  await bp.click('#lg-submit');
  await bp.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await bp.evaluate('window.HL_READY');
  await bp.waitForTimeout(900);

  const ord = await bp.evaluate(`(async function(){
    var d = await fetch('/api/products').then(function (r) { return r.json(); });
    var p = d.raw.find(function (x) { return x.placeKey === 'pk_hanwoo' && x.stock > 0; });
    var r = await fetch('/api/orders', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: p.id, qty: 1 }) }).then(function (x) { return x.json(); });
    return r.order;
  })()`);
  check(!!ord && !!ord.code, `손님이 예약 (${ord?.code})`);

  const mgr = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mp = await mgr.newPage();
  await mp.goto(ADMIN, { waitUntil: 'domcontentloaded' });
  await mp.waitForTimeout(500);
  await mp.fill('#lg-id', 'store_hanwoo');
  await mp.fill('#lg-pw', PW);
  await mp.click('form.devbox button[type="submit"]');
  await mp.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await mp.waitForTimeout(1200);

  await mp.fill('#lk', ord.code);
  await mp.click('.lookup .btn.pri');
  await mp.waitForTimeout(800);
  const hit = await mp.textContent('#hit');
  check(/한우/.test(hit), `매장이 코드로 찾음 (${hit.trim().slice(0, 24)}…)`);

  await mp.click('#hit .btn.pri');
  await mp.waitForTimeout(1200);

  const status = await mp.evaluate((code) => fetch('/api/store/pickups')
    .then((r) => r.json())
    .then((d) => (d.pickups.find((p) => p.code === code) || {}).status), ord.code);
  check(status === 'completed', `수령 확인 반영 (${status})`);

  // 손님 앱에도 반영되는가
  await bp.reload({ waitUntil: 'domcontentloaded' });
  await bp.evaluate('window.HL_READY');
  await bp.waitForTimeout(900);
  const seen = await bp.evaluate((code) =>
    (MY_PICKUPS.find((p) => p.code === code) || {}).status, ord.code);
  check(seen === '픽업완료', `손님 화면에도 픽업완료로 보임 (${seen})`);

  await buyer.close(); await mgr.close();
}

// =================================================================
group('콘솔');
// =================================================================
check(pageErrors.length === 0, '자바스크립트 예외 없음', pageErrors.slice(0, 3).join(' | '));

console.log('');
await browser.close();
if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
console.log('  로그인 화면 검증 전부 통과\n');
