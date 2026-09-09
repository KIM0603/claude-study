/**
 * 사용자 매뉴얼 캡처 갱신.
 *
 *   npm run manual
 *
 * 매뉴얼(happylocal-manual.html)의 화면 캡처를 실제 앱에서 다시 찍어 갈아끼우고,
 * 새로 생긴 화면(픽업 코드 제시 · 운영 화면)의 절을 붙입니다.
 *
 * 처음에는 캡처를 손으로 찍어 붙였는데, 화면이 바뀔 때마다 매뉴얼이 낡아도
 * 알 방법이 없었습니다. 다시 돌릴 수 있게 스크립트로 남깁니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('\n  playwright-core 가 없어 건너뜁니다.\n'); process.exit(0); }

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dir, '..', '..');
const MANUAL = path.join(ROOT, 'happylocal-manual.html');
const PORT = process.env.PORT || 8787;
const APP = `http://localhost:${PORT}/happylocal_v2.html`;
const ADMIN = `http://localhost:${PORT}/admin.html`;

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
if (!fs.existsSync(MANUAL)) { console.error('매뉴얼 파일이 없습니다:', MANUAL); process.exit(1); }

/**
 * 절 id -> 그 절의 캡처들.
 * 순서가 매뉴얼의 <img> 순서와 1:1 로 맞아야 합니다.
 */
const SHOTS = [
  { id: 'home',     steps: ["goTab('home')"] },
  { id: 'map',      steps: ['openMap()', "openMap();setTimeout(function(){mapListToggle&&mapListToggle()},300)"] },
  { id: 'route',    steps: ["goTab('route')", "goTab('route')"] },
  { id: 'cal',      steps: ["goTab('cal')"] },
  { id: 'stores',   steps: ['openStores()', "openStores();stToggleSearch&&stToggleSearch()"] },
  { id: 'detail',   steps: ['__openFirstProduct()'] },
  { id: 'pay',      steps: ['__openPay()'] },
  { id: 'mypickup', steps: ['openCart()'] },
  { id: 'review',   steps: ["go('reviews')", "go('reviews')"] },
  { id: 'coupon',   steps: ["go('coupons')"] },
  { id: 'my',       steps: ["goTab('my')", "goTab('my')"] },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// 캡처에 쓸 계정. 로그인 상태여야 예약·쿠폰 화면이 채워집니다.
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.evaluate(`fetch('/api/auth/dev-login',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'해피로컬 이용자'})})`);
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.evaluate('window.HL_READY');
await page.waitForTimeout(1200);

// 캡처용 보조 함수. 매뉴얼에 쓰기 좋은 상태를 만들어 줍니다.
await page.evaluate(`
  window.__openFirstProduct = function () {
    var p = PL.find(function (x) { return x.stock > 0; });
    openStoreByFid(p.fid);
  };
  window.__openPay = function () {
    var p = PL.find(function (x) { return x.stock > 1; });
    openStoreByFid(p.fid); sdQtyVal = 2; payQty = 2; openPay();
  };
  window.__openPass = function () {
    openCart();
    var b = document.querySelector('#cart-list .mc-pass-btn');
    if (b) b.click();
  };
`);

// 예약이 하나는 있어야 장바구니·픽업 코드 화면이 비지 않습니다.
await page.evaluate(`(async function(){
  if ((MY_PICKUPS || []).some(function (p) { return p.status === '결제완료'; })) return;
  var p = PL.find(function (x) { return x.stock > 0; });
  openStoreByFid(p.fid); sdQtyVal = 1; payQty = 1; openPay();
  document.getElementById('pay-agree').classList.add('on');
  await payDo();
})()`);
await page.waitForTimeout(1500);

const shot = async (pg, run, wait = 900) => {
  if (run) await pg.evaluate(`(function(){ try { ${run}; } catch (e) { console.warn(e); } })()`);
  await pg.waitForTimeout(wait);
  const buf = await pg.screenshot({ type: 'jpeg', quality: 82 });
  return 'data:image/jpeg;base64,' + buf.toString('base64');
};

console.log('');
const captured = new Map();
for (const s of SHOTS) {
  const imgs = [];
  for (const step of s.steps) imgs.push(await shot(page, step, s.id === 'map' ? 2200 : 900));
  captured.set(s.id, imgs);
  console.log(`  캡처 ${s.id} (${imgs.length}장)`);
}

// 새 화면: 픽업 코드 제시
const passShot = await shot(page, '__openPass()', 1100);
console.log('  캡처 pass (1장)');

// 새 화면: 운영 화면 (매장 관리인 · 생산자)
const wide = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2 });
const ap = await wide.newPage();
await ap.goto(ADMIN, { waitUntil: 'domcontentloaded' });
const adminShots = [];
for (const [role, scopeKey, view] of [
  ['store_manager', 'storeKeys', 'pickups'],
  ['producer', 'productIds', 'shipping'],
]) {
  await ap.evaluate(([r, k]) => fetch('/api/bootstrap').then((x) => x.json()).then((b) => {
    const scope = { storeKeys: [], productIds: [], regions: [] };
    scope[k] = k === 'storeKeys'
      ? Object.keys(b.PLACES).filter((x) => b.PLACES[x].type === 'pickup')
      : (b.PL || []).map((p) => p.fid);
    return fetch('/api/auth/dev-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '매뉴얼 운영자', roles: [r], scope }),
    });
  }), [role, scopeKey]);
  await ap.goto(ADMIN, { waitUntil: 'domcontentloaded' });
  await ap.waitForTimeout(1100);
  await ap.click(`#nav button[data-view="${view}"]`).catch(() => {});
  await ap.waitForTimeout(900);
  adminShots.push(await shot(ap, null, 300));
}
console.log(`  캡처 admin (${adminShots.length}장)`);
await browser.close();

// ---------------------------------------------------------------
// 매뉴얼 갈아끼우기
// ---------------------------------------------------------------
let html = fs.readFileSync(MANUAL, 'utf8');

/** 한 절 안의 <img src="data:..."> 를 순서대로 새 캡처로 바꿉니다. */
function swapSection(id, imgs) {
  const open = html.indexOf(`<section class="feature" id="${id}"`);
  if (open < 0) { console.log(`  ! 절을 찾지 못했습니다: ${id}`); return 0; }
  const close = html.indexOf('</section>', open);
  let seg = html.slice(open, close);

  let i = 0;
  seg = seg.replace(/src="data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"/g,
    (m) => (i < imgs.length ? `src="${imgs[i++]}"` : m));

  html = html.slice(0, open) + seg + html.slice(close);
  return i;
}

let swapped = 0;
for (const [id, imgs] of captured) swapped += swapSection(id, imgs);
console.log(`\n  캡처 ${swapped}장 교체`);

// ---- 새 절: 픽업 코드 제시 ----
if (!html.includes('id="pass"')) {
  const anchor = '<section class="feature" id="review"';
  const section = `<section class="feature" id="pass">
        <figure class="shot">
          <img src="${passShot}" alt="픽업 코드 화면. 예약코드가 크게 표시되고 상품과 매장이 아래에 있습니다.">
          <figcaption>픽업 코드</figcaption>
        </figure>
        <div>
          <h3>픽업 코드 보여주기</h3>
          <p class="where">장바구니 &rsaquo; 예약 카드 &rsaquo; 픽업 코드 보기</p>
          <p class="intro">
            매장에서는 예약코드로 본인 확인을 합니다. 카운터에서 한 번에 읽히도록
            코드만 크게 띄우는 화면입니다.
          </p>
          <ol class="steps">
            <li>장바구니에서 예약 카드의 <b>픽업 코드 보기</b>를 누릅니다.</li>
            <li>매장 직원에게 화면을 보여주면 수령 확인이 됩니다.</li>
            <li>픽업 시간 안에 찾아가지 않으면 <b>노쇼</b>로 처리됩니다.</li>
          </ol>
          <div class="note">
            신선식품은 노쇼로 처리되면 재고로 되돌리지 않습니다. 못 가게 되면
            미리 <b>예약 취소</b>를 눌러 주세요.
          </div>
        </div>
      </section>

      `;
  html = html.replace(anchor, section + anchor);
  console.log('  절 추가: 픽업 코드 제시');
}

// ---- 새 절: 운영 화면 ----
if (!html.includes('id="ops"')) {
  const last = html.lastIndexOf('</section>');
  const section = `</section>

      <section class="feature" id="ops">
        <div class="shot-pair">
          <figure class="shot">
            <img src="${adminShots[0]}" alt="운영 화면의 오늘 픽업. 예약코드 입력창과 예약 목록이 있습니다.">
            <figcaption>오늘 픽업</figcaption>
          </figure>
          <figure class="shot">
            <img src="${adminShots[1]}" alt="운영 화면의 오늘 출하. 상품별 재고와 수량 입력칸이 있습니다.">
            <figcaption>오늘 출하</figcaption>
          </figure>
        </div>
        <div>
          <h3>운영 화면 (농가 · 매장)</h3>
          <p class="where">/admin.html — 여행자 앱과 별도 주소입니다</p>
          <p class="intro">
            농가가 오늘 낼 물량을 넣고, 매장이 수령을 확인해야 서비스가 매일 돌아갑니다.
            로그인한 계정의 역할에 따라 보이는 메뉴가 달라집니다.
          </p>
          <ol class="steps">
            <li><b>농가</b>는 오늘 출하에서 수량을 넣습니다. 앱의 재고에 바로 더해집니다.</li>
            <li><b>매장</b>은 손님이 댄 예약코드를 조회해 수령 확인을 찍습니다.</li>
            <li>안 찾아간 예약은 <b>노쇼</b>로 정리하고, 다시 팔 수 있으면 재고를 되돌립니다.</li>
            <li>정산은 실제로 찾아간 주문만 셉니다.</li>
          </ol>
          <div class="keys">
            <span class="key">오늘 픽업</span><span class="key">오늘 출하</span>
            <span class="key">일일 마감</span><span class="key">정산</span>
            <span class="key">입점 심사</span>
          </div>
          <div class="note">
            역할은 최고관리자가 부여합니다. 농가·매장은 <b>입점 신청</b>을 하고,
            승인되면 그 자리에서 담당 상품·거점이 연결됩니다.
          </div>
        </div>
      `;
  html = html.slice(0, last) + section + html.slice(last);
  console.log('  절 추가: 운영 화면');
}

// ---- 목차 ----
if (!html.includes('href="#pass"')) {
  html = html.replace(/(<a href="#review")/, '<a href="#pass">픽업 코드</a>\n            $1');
}
if (!html.includes('href="#ops"')) {
  html = html.replace(/(<a href="#my"[^>]*>[^<]*<\/a>)/, '$1\n            <a href="#ops">운영 화면</a>');
}

fs.writeFileSync(MANUAL, html);
const mb = (fs.statSync(MANUAL).size / 1024 / 1024).toFixed(2);
console.log(`\n  매뉴얼 갱신 완료 (${mb}MB)\n`);
