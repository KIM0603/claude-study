/**
 * 통합 시나리오 테스트 (End-to-End).
 *
 *   npm run test:e2e        # 서버가 떠 있어야 합니다
 *
 * 기존 테스트와의 차이:
 *   test:api     - 엔드포인트 하나씩
 *   test:front   - DOM 스텁 위에서 스크립트 실행
 *   test:browser - 화면이 그려지는지
 *   test:e2e     - **실제 사용자 여정**을 UI 로 끝까지 밟습니다.
 *                  화면 -> API -> 저장소 -> 다시 화면까지 한 줄로 이어지는지,
 *                  그리고 새로고침 후에도 남아있는지를 봅니다.
 *
 * 각 시나리오는 자기가 만든 데이터를 스스로 정리합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('\n  playwright-core 가 없어 통합 시나리오를 건너뜁니다.');
  console.log('  실행하려면: npm i -D playwright-core\n');
  process.exit(0);
}

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;
const APP = `${BASE}/happylocal_v2.html`;
const SHOTS = path.join(__dir, '..', 'shots', 'e2e');

function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => fs.existsSync(p)) || null;
}

const CHROME = findBrowser();
if (!CHROME) {
  console.log('\n  Chrome/Edge 를 찾지 못해 통합 시나리오를 건너뜁니다.\n');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
let currentScenario = '';
const step = (ok, label, detail) => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const scenario = (name) => {
  currentScenario = name;
  console.log(`\n  [시나리오] ${name}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });

const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(`${currentScenario}: ${e.message.slice(0, 140)}`));
page.on('console', (m) => {
  if (m.type() === 'error') jsErrors.push(`${currentScenario}: ${m.text().slice(0, 140)}`);
});

/** 페이지를 새로 열고 부팅이 끝날 때까지 기다립니다 (= 새로고침). */
async function reload() {
  await page.goto(APP, { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(() => window.HL_READY).catch(() => {});
  await page.waitForTimeout(900);
}
const ev = (code) => page.evaluate(code);
const count = (sel) => page.locator(sel).count();

/** 조건이 참이 될 때까지 기다립니다. 고정 sleep 은 부하에 따라 흔들립니다. */
async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* 재시도 */ }
    await page.waitForTimeout(80);
  }
  return false;
}

// 브라우저와 Node 쪽 요청이 **같은 세션**을 써야 합니다.
// 안 그러면 화면에서는 로그인돼 있는데 검증용 API 호출은 비로그인이라 0건으로 보입니다.
let SESSION = '';
const __rawFetch = globalThis.fetch;
globalThis.fetch = (url, opt = {}) => __rawFetch(url, {
  ...opt,
  headers: { ...(opt.headers || {}), ...(SESSION ? { Cookie: SESSION } : {}) },
});
const api = (p, opt) => fetch(`${BASE}${p}`, opt).then((r) => r.json());

// 주문·후기·계획은 계정이 있어야 합니다.
// Node 에서 로그인해 세션을 만들고, 같은 쿠키를 브라우저에도 심습니다.
{
  const r = await __rawFetch(`${BASE}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'E2E 여행자' }),
  });
  if (!r.ok) { console.error('개발 로그인 실패: HTTP ' + r.status); process.exit(1); }
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  SESSION = sc.map((c) => c.split(';')[0]).join('; ');
  const me = (await r.json()).user;

  const pair = SESSION.split('=');
  await page.context().addCookies([{
    name: pair[0], value: pair.slice(1).join('='),
    domain: 'localhost', path: '/',
  }]);
  console.log(`
  로그인: ${me.nickname}`);
}

await reload();

// =================================================================
scenario('1. 픽업 상품을 예약하고 새로고침해도 남아있다');
// =================================================================
{
  const before = await api('/api/mypickups');
  const products = (await api('/api/products')).raw;
  const target = products.find((p) => p.stock > 1);
  step(!!target, `재고 있는 상품 확보 (${target?.name})`);

  const stockBefore = target.stock;

  // 상품 상세를 열고 예약 -> 동의 -> 결제까지 실제 UI 로 진행
  await ev(`openStoreByKey(${JSON.stringify(
    (await api('/api/stores')).stores.find((s) => s.key.startsWith('pk_'))?.key || 'pk_hanwoo'
  )})`);
  await page.waitForTimeout(600);

  // 상품 목록에서 대상 상품을 직접 골라 결제 화면으로 갑니다.
  await ev(`(function(){
    var it = PL.find(function(p){ return p.fid === ${JSON.stringify(target.id)}; });
    sdItem = it; sdMax = it.stock || 1; sdQtyVal = 1; payQty = 1;
    openPay();
  })()`);
  await page.waitForTimeout(500);
  step(await count('#s-pay.active') === 1, '결제 화면 진입');

  const agreeOn = await ev(`document.getElementById('pay-agree').classList.contains('on')`);
  if (!agreeOn) { await ev('payAgreeToggle()'); await page.waitForTimeout(200); }

  await page.click('.pay-cta-main');
  const paid = await until(async () =>
    (await page.locator('.pay-cta-main').textContent()).includes('완료'));
  step(paid, '결제 완료 표시');

  // 서버에 주문이 생겼는가
  const after = await api('/api/mypickups');
  step(after.MY_PICKUPS.length === before.MY_PICKUPS.length + 1,
    `예약 내역 증가 (${before.MY_PICKUPS.length} -> ${after.MY_PICKUPS.length})`);

  const made = after.MY_PICKUPS.find((p) => p.productId === target.id);
  step(!!made, '내 예약에서 방금 주문을 찾음');

  // 재고가 실제로 줄었는가
  const p2 = (await api('/api/products')).raw.find((p) => p.id === target.id);
  step(p2.stock === stockBefore - 1, `재고 차감 (${stockBefore} -> ${p2.stock})`);

  // 새로고침해도 남아있는가  <- 예전에 여기서 사라졌습니다
  await reload();
  const shown = await ev(`MY_PICKUPS.filter(function(p){ return p.code === ${JSON.stringify(made.code)}; }).length`);
  step(shown === 1, '새로고침 후에도 예약이 화면에 남아있음');

  await page.screenshot({ path: path.join(SHOTS, '1-reserved.png') });

  // 취소하면 재고가 돌아오는가
  await fetch(`${BASE}/api/orders/${made.orderId}/cancel`, { method: 'POST' });
  const p3 = (await api('/api/products')).raw.find((p) => p.id === target.id);
  step(p3.stock === stockBefore, `취소 시 재고 복구 (${p3.stock})`);

  const restored = await api('/api/mypickups');
  step(restored.MY_PICKUPS.length === before.MY_PICKUPS.length, '취소된 예약은 목록에서 사라짐');
}

// =================================================================
scenario('2. 지도에서 지역·갈래로 여행지를 좁혀본다');
// =================================================================
{
  await reload();
  await ev('openMap()');
  await until(async () => (await count('#map-cards .mcard')) > 0);

  const all = await count('#map-cards .mcard');
  step(all > 0, `전체 장소 표시 (${all}곳)`);

  const chips = await ev(`[...document.querySelectorAll('#map-cats .map-cat')].map(function(c){return c.textContent;})`);
  step(chips.length === 5, `카테고리 칩 (${chips.join(' / ')})`);

  // 축제만
  await ev(`pickMapCat('festival')`);
  await page.waitForTimeout(900);
  const fest = await count('#map-cards .mcard');
  step(fest > 0 && fest < all, `축제만 보기 (${all} -> ${fest})`);

  // 축제 카드에 평점 대신 기간이 나와야 합니다 (TourAPI 는 평점을 안 줍니다)
  const meta = await ev(`(document.querySelector('#map-cards .mcard .mc-rate')||{}).textContent||''`);
  step(!meta.includes('0.0'), '축제 카드에 가짜 평점(0.0)이 없음', meta);

  // 지역까지 좁히기.
  // 함수명을 틀리면 조용히 아무 일도 안 하고 지나가므로, 존재부터 확인합니다.
  const hasSel = await ev(`typeof selectRegion === 'function'`);
  step(hasSel, '지역 선택 함수 존재 (selectRegion)');
  await ev(`selectRegion('횡성')`);
  await page.waitForTimeout(1000);
  const hs = await count('#map-cards .mcard');
  const expected = await ev(`STORES.filter(function(s){return s.rg==='횡성'&&s.type==='festival';}).length`);
  step(hs === expected && hs < fest,
    `횡성 축제로 좁힘 (${fest} -> ${hs}, 기대 ${expected})`);
  await page.screenshot({ path: path.join(SHOTS, '2-map-filter.png') });

  // 마커 수와 카드 수가 일치해야 합니다
  const markers = await count('#smap .mk');
  step(markers === hs, `마커와 카드 개수 일치 (마커 ${markers} / 카드 ${hs})`);
}

// =================================================================
scenario('3. 후기를 쓰면 목록과 매장 평점에 반영된다');
// =================================================================
{
  await reload();
  const storesBefore = (await api('/api/stores')).stores;
  const target = storesBefore.find((s) => s.reviewCount > 0);
  const rvBefore = (await api('/api/reviews?mine=1')).count;

  await ev(`go('reviews')`);
  await page.waitForTimeout(500);
  const cardsBefore = await count('#myrv-list .myrv-card');

  await ev('openWriteReview()');
  await page.waitForTimeout(400);
  step(await count('#wrsheet.show') === 1, '후기 작성 시트 열림');

  // 대상 매장을 고르고 별점 5, 내용 입력
  const picked = await ev(`(function(){
    var sel = document.getElementById('wr-shop');
    var opts = sel._opts || [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].shop === ${JSON.stringify(target.name)}) { sel.value = String(i); return opts[i].shop; }
    }
    sel.value = '0';
    return opts.length ? opts[0].shop : '';
  })()`);
  step(!!picked, `매장 선택 (${picked})`);

  await page.click('#wr-stars .wr-star:nth-child(5)');
  await page.fill('#wr-text', 'E2E 시나리오에서 작성한 후기입니다');
  await page.click('#wr-submit');

  const saved = await until(async () => (await api('/api/reviews?mine=1')).count === rvBefore + 1);
  step(saved, '서버에 후기 저장');

  // 서버 저장과 화면 갱신은 시점이 다릅니다. 화면이 따라올 때까지 기다립니다.
  const listUpdated = await until(async () =>
    (await count('#myrv-list .myrv-card')) === cardsBefore + 1);
  const cardsAfter = await count('#myrv-list .myrv-card');
  step(listUpdated, `내 후기 목록 갱신 (${cardsBefore} -> ${cardsAfter})`);
  await page.screenshot({ path: path.join(SHOTS, '3-review.png') });

  // 매장 평점이 기존 누적에 합산됐는가 (덮어쓰기가 아니라)
  const after = (await api('/api/stores')).stores.find((s) => s.key === picked && s.name === picked)
    || (await api('/api/stores')).stores.find((s) => s.name === picked);
  if (after) {
    step(after.reviewCount > (storesBefore.find((s) => s.name === picked)?.reviewCount ?? 0),
      `매장 후기 수 증가 (${after.reviewCount})`);
    step(after.rating >= 1 && after.rating <= 5, `평점이 범위 안 (${after.rating})`);
  }

  // 새로고침 후에도 남아있는가
  await reload();
  const persisted = await ev(`MY_REVIEWS.filter(function(r){ return r.txt.indexOf('E2E 시나리오') >= 0; }).length`);
  step(persisted === 1, '새로고침 후에도 후기가 남아있음');

  // 정리
  const mine = (await api('/api/reviews?mine=1')).reviews.find((r) => r.txt.includes('E2E 시나리오'));
  if (mine) await fetch(`${BASE}/api/reviews/${mine.id}`, { method: 'DELETE' });
}

// =================================================================
scenario('4. 내 주변 매장에서 검색하고 정렬해 매장을 찾는다');
// =================================================================
{
  await reload();
  await ev('openStores()');
  await page.waitForTimeout(700);

  const total = await count('#st-list .st-card');
  step(total > 0, `매장 목록 (${total}곳)`);

  // 가까운 순
  const km = await ev(`[...document.querySelectorAll('#st-list .st-dist')].slice(0,5).map(function(e){return parseFloat(e.textContent)||999;})`);
  step(km.every((v, i) => i === 0 || km[i - 1] <= v), `가까운 순 (${km.join(', ')})`);

  // 마감 임박
  await page.click('#s-stores .st-tab:nth-child(2)');
  await page.waitForTimeout(500);
  const remains = await ev(`[...document.querySelectorAll('#st-list .st-status')].slice(0,5).map(function(e){var m=e.textContent.match(/(\\d+)/);return m?Number(m[1]):1e9;})`);
  step(remains.every((v, i) => i === 0 || remains[i - 1] <= v), `마감 임박 순 (${remains.join(', ')})`);

  // 검색
  await page.click('#s-stores .st-tab:nth-child(1)');
  await page.waitForTimeout(300);
  await ev('toggleStSearch()');
  await page.fill('#st-search', '한우');
  await page.waitForTimeout(600);
  const found = await count('#st-list .st-card');
  step(found > 0 && found < total, `"한우" 검색 (${total} -> ${found})`);
  await page.screenshot({ path: path.join(SHOTS, '4-stores.png') });

  // 검색 결과에서 매장 상세로 진입
  await page.click('#st-list .st-card:first-child');
  await page.waitForTimeout(700);
  const detailOpen = await ev(`!!document.querySelector('#s-store-detail.active, .phone.storedetail')`);
  step(detailOpen, '검색 결과에서 매장 상세 진입');
}

// =================================================================
scenario('5. 재고가 소진되면 더 예약할 수 없다');
// =================================================================
{
  const products = (await api('/api/products')).raw;
  const t = products.find((p) => p.stock > 0 && p.stock <= 12);
  step(!!t, `테스트용 소량 재고 상품 (${t?.name}, ${t?.stock}개)`);

  const orderIds = [];
  // 남은 재고를 전부 예약
  for (let i = 0; i < t.stock; i++) {
    const r = await api('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: t.id, qty: 1 }),
    });
    if (r.order) orderIds.push(r.order.id);
  }
  step(orderIds.length === t.stock, `재고 전량 예약 (${orderIds.length}건)`);

  // 한 건 더 시도하면 거부돼야 합니다
  const over = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: t.id, qty: 1 }),
  });
  const overBody = await over.json();
  step(over.status === 409, `초과 예약 거부 (HTTP ${over.status})`);
  step(overBody.available === 0, '남은 수량 0 으로 안내', JSON.stringify(overBody));

  // 화면에도 품절로 보여야 합니다
  await reload();
  const pl = await ev(`(PL.find(function(p){return p.fid===${JSON.stringify(t.id)};})||{})`);
  step(pl.soldOut === true, '상품 목록에 품절 표시', JSON.stringify(pl.tag));

  // 정리 - 만든 주문을 모두 취소
  for (const id of orderIds) {
    await fetch(`${BASE}/api/orders/${id}/cancel`, { method: 'POST' });
  }
  const restored = (await api('/api/products')).raw.find((p) => p.id === t.id);
  step(restored.stock === t.stock, `정리 후 재고 복구 (${restored.stock})`);
}


// =================================================================
scenario('6. 로그인 전에는 막히고, 로그인하면 내 것만 보인다');
// =================================================================
{
  // --- 비로그인 상태로 되돌립니다 ---
  const keep = SESSION;
  SESSION = '';
  await page.context().clearCookies();
  await reload();

  step((await ev('HL_USER')) === null, '비로그인으로 시작');

  await ev("goTab('my')");
  await page.waitForTimeout(500);
  const nameOut = (await page.locator('#my2-name').textContent()) || '';
  step(nameOut.includes('로그인'), 'MY 화면이 로그인 안내를 보여줌', nameOut);
  step((await page.locator('#my2-authbtn').textContent()).includes('로그인'),
    '로그인 버튼 노출');

  // 비로그인 상태에서는 개인 데이터가 하나도 없어야 합니다.
  const empty = await ev(`({p:MY_PICKUPS.length, r:MY_REVIEWS.length, c:MY_COUPONS.length, k:MY_COURSES.length})`);
  step(empty.p === 0 && empty.r === 0 && empty.c === 0 && empty.k === 0,
    '비로그인이면 예약·후기·쿠폰·코스가 모두 비어있음', JSON.stringify(empty));

  // 서버도 거부해야 합니다.
  const denied = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: '01', qty: 1 }),
  });
  step(denied.status === 401, '비로그인 주문을 서버가 거부', `HTTP ${denied.status}`);

  // 예약을 시도하면 로그인 화면으로 안내해야 합니다.
  await ev(`(function(){ var it = PL.find(function(p){return p.stock>0;});
    sdItem = it; sdMax = it.stock; payQty = 1; openPay(); })()`);
  await page.waitForTimeout(400);
  await ev(`document.getElementById('pay-agree').classList.add('on')`);
  await page.click('.pay-cta-main');
  await page.waitForTimeout(700);
  step((await page.locator('#s-login.active').count()) === 1, '예약 시도 -> 로그인 화면으로 유도');
  const reason = (await page.locator('#lg-reason').textContent()) || '';
  step(reason.includes('예약'), '왜 로그인이 필요한지 안내', reason.slice(0, 30));
  await page.screenshot({ path: path.join(SHOTS, '6-login.png') });

  // --- 새 계정으로 로그인 ---
  //
  // dev-login 은 닉네임으로 계정을 찾아 재사용합니다. 고정 닉네임을 쓰면
  // 두 번째 실행부터는 "신규 가입" 이 아니게 되고, 그 사이 운영자가 돌린
  // 쿠폰 캠페인 같은 것이 쌓여 가입 혜택 검사가 어긋납니다.
  const NEW_NICK = '두번째 여행자 ' + Date.now().toString(36).slice(-5);
  const r2 = await __rawFetch(`${BASE}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: NEW_NICK }),
  });
  const sc2 = r2.headers.getSetCookie ? r2.headers.getSetCookie() : [];
  SESSION = sc2.map((c) => c.split(';')[0]).join('; ');
  const pair2 = SESSION.split('=');
  await page.context().addCookies([{
    name: pair2[0], value: pair2.slice(1).join('='), domain: 'localhost', path: '/',
  }]);
  await reload();

  const u2 = await ev('HL_USER && HL_USER.nickname');
  step(u2 === NEW_NICK, `새 계정으로 로그인 (${u2})`);

  const fresh = await ev(`({p:MY_PICKUPS.length, r:MY_REVIEWS.length, c:MY_COUPONS.length, k:MY_COURSES.length})`);
  // 시드 쿠폰(userId 없는 것)이 그대로 복사됩니다. 개수는 시드에 달렸으므로
  // 고정값 대신 서버가 가진 시드 쿠폰 수와 대조합니다.
  const seedCount = (await __rawFetch(`${BASE}/api/health`).then((r) => r.json())).seedCoupons;
  step(fresh.c === (seedCount ?? 3),
    `신규 가입 쿠폰 지급 (${fresh.c}장 / 시드 ${seedCount ?? 3}장)`);
  step(fresh.p === 0 && fresh.k === 0,
    '다른 계정이 만든 예약·코스는 보이지 않음', JSON.stringify(fresh));

  await ev("goTab('my')");
  await page.waitForTimeout(500);
  step(((await page.locator('#my2-name').textContent()) || '').includes('두번째'),
    'MY 화면에 내 이름 표시');
  step(((await page.locator('#my2-authbtn').textContent()) || '').includes('로그아웃'),
    '로그아웃 버튼으로 바뀜');

  // --- 원래 계정으로 되돌립니다 (뒤 시나리오에 영향 없게) ---
  SESSION = keep;
  await page.context().clearCookies();
  const pair3 = keep.split('=');
  await page.context().addCookies([{
    name: pair3[0], value: pair3.slice(1).join('='), domain: 'localhost', path: '/',
  }]);
  await reload();
  step((await ev('HL_USER && HL_USER.nickname')) === 'E2E 여행자', '원래 계정으로 복귀');
}

// =================================================================
console.log('');
step(jsErrors.length === 0, '모든 시나리오에서 JS 오류 없음', jsErrors.slice(0, 3).join(' | '));

await browser.close();
console.log('');
console.log(`  스크린샷: ${SHOTS}`);
if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
console.log('  전 시나리오 통과\n');
