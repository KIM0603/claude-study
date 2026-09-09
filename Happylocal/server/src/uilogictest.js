/**
 * 화면 논리 검증.
 *
 *   npm run test:ui-logic
 *
 * browsertest 는 "눌러도 안 깨진다" 를, e2etest 는 "흐름이 이어진다" 를 봅니다.
 * 여기서는 화면에 찍힌 숫자와 글자가 실제 데이터와 맞는지 봅니다.
 * 안 깨지면서 틀린 값을 보여주는 쪽이 더 위험합니다.
 */
import fs from 'node:fs';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('\n  playwright-core 가 없어 건너뜁니다.\n'); process.exit(0); }

const PORT = process.env.PORT || 8787;
const URL = `http://localhost:${PORT}/happylocal_v2.html`;

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
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const ev = (code) => page.evaluate(`(function(){ ${code} })()`);

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate('window.HL_READY');            // 서버 데이터 반영을 기다립니다
await page.waitForTimeout(600);
await ev(`return fetch('/api/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({nickname:'화면논리'})}).then(function(r){return r.ok;});`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.evaluate('window.HL_READY');
await page.waitForTimeout(600);

// =================================================================
group('재고 표시가 실제 재고와 일치');
// =================================================================
{
  // 매장 목록의 "N팩 남음" 은 그 매장의 실제 상품 재고여야 합니다.
  const rows = await ev(`
    var out = [];
    Object.keys(PLACES).forEach(function (k) {
      var p = PLACES[k]; if (!p || p.type !== 'pickup') return;
      var pl = p.productId ? PL.find(function (x) { return x.fid === p.productId; }) : null;
      if (!pl) { out.push({ key: k, nm: p.nm, shown: null, real: null, linked: false }); return; }
      var m = String(p.remain || '').match(/(\\d+)/);
      out.push({ key: k, nm: p.nm, shown: m ? Number(m[1]) : 0, real: pl.stock, linked: true });
    });
    return out;`);

  const linked = rows.filter((r) => r.linked);
  const wrong = linked.filter((r) => r.shown !== r.real);
  const orphanPlaces = rows.filter((r) => !r.linked);
  check(linked.length >= 13, `픽업 거점 ${linked.length}곳이 상품과 연결됨`,
    '미연결: ' + orphanPlaces.map((r) => r.nm).join(', '));
  check(orphanPlaces.length === 0, '상품 없는 픽업 거점이 없음',
    orphanPlaces.map((r) => r.nm).join(', '));
  check(wrong.length === 0, '매장 목록의 잔여 수량 = 실제 재고',
    wrong.slice(0, 4).map((r) => `${r.nm} 화면 ${r.shown} / 실제 ${r.real}`).join(' | '));

  // 재고 0 인 상품이 "재고 넉넉" 으로 뜨면 안 됩니다.
  const soldOutOk = await ev(`
    var bad = [];
    PL.filter(function (p) { return p.stock <= 0; }).forEach(function (p) {
      var key = Object.keys(PLACES).find(function (k) { return PLACES[k].productId === p.fid; });
      var s = key ? STORES.find(function (x) { return x.key === key; }) : null;
      if (!s) return;
      var t = _stock(s).t;
      if (!/마감|품절|종료|0/.test(t)) bad.push(p.name + ' → ' + t);
    });
    return bad;`);
  check(soldOutOk.length === 0, '품절 상품이 "넉넉" 으로 표시되지 않음', soldOutOk.join(' | '));
}

// =================================================================
group('수량 상한이 재고를 넘지 않음');
// =================================================================
{
  const caps = await ev(`
    var out = [];
    PL.slice(0, 12).forEach(function (p) {
      openStoreByFid(p.fid);
      out.push({ prod: p.prod, stock: p.stock, max: sdMax });
    });
    return out;`);
  const over = caps.filter((c) => c.max > c.stock);
  check(over.length === 0, `상품 목록 상세 ${caps.length}건의 상한 ≤ 재고`,
    over.slice(0, 4).map((c) => `${c.prod} 상한 ${c.max} / 재고 ${c.stock}`).join(' | '));

  const storeCaps = await ev(`
    var out = [];
    STORES.forEach(function (s) {
      var p = PLACES[s.key]; if (!p || p.type !== 'pickup' || !p.productId) return;
      var pl = PL.find(function (x) { return x.fid === p.productId; }); if (!pl) return;
      openStoreByKey(s.key);
      out.push({ nm: p.nm, stock: pl.stock, max: sdMax });
    });
    return out;`);
  const sOver = storeCaps.filter((c) => c.max > c.stock);
  check(sOver.length === 0, `매장 상세 ${storeCaps.length}건의 상한 ≤ 재고`,
    sOver.slice(0, 4).map((c) => `${c.nm} 상한 ${c.max} / 재고 ${c.stock}`).join(' | '));

  // 스테퍼가 상한을 넘지 못하는지
  const stepper = await ev(`
    var p = PL.find(function (x) { return x.stock > 0; });
    openStoreByFid(p.fid);
    for (var i = 0; i < sdMax + 5; i++) sdQty(1);
    var hi = sdQtyVal;
    for (var j = 0; j < 50; j++) sdQty(-1);
    return { hi: hi, lo: sdQtyVal, max: sdMax };`);
  check(stepper.hi === stepper.max, `+ 를 계속 눌러도 상한에서 멈춤 (${stepper.hi}/${stepper.max})`);
  check(stepper.lo === 1, `− 를 계속 눌러도 1 아래로 안 감 (${stepper.lo})`);
}

// =================================================================
group('결제 금액 계산');
// =================================================================
{
  const pay = await ev(`
    var p = PL.find(function (x) { return x.stock >= 3; });
    openStoreByFid(p.fid); sdQtyVal = 3; payQty = 3; PAY_COUPON = 0; openPay(); payRecalc();
    var num = function (id) { return _payNum(document.getElementById(id).textContent); };
    return { was: _payNum(p.was), now: _payNum(p.now), qty: payQty,
      goods: num('pay-goods'), sale: num('pay-sale'), total: num('pay-total'),
      cta: document.getElementById('pay-ctatxt').textContent };`);

  check(pay.goods === pay.was * pay.qty, `상품금액 = 정가×수량 (${pay.goods})`);
  check(pay.sale === (pay.was - pay.now) * pay.qty, `할인액 = (정가−판매가)×수량 (${pay.sale})`);
  check(pay.goods - pay.sale === pay.total, `상품금액 − 할인 = 결제금액 (${pay.total})`);
  check(_num(pay.cta) === pay.total, `버튼 금액 = 결제금액 (${pay.cta.trim()})`);

  // 쿠폰이 붙어도 등식이 유지되는가
  const withCp = await ev(`
    PAY_COUPON = 5000; payRecalc();
    var num = function (id) { return _payNum(document.getElementById(id).textContent); };
    return { goods: num('pay-goods'), sale: num('pay-sale'),
      coupon: num('pay-coupon'), total: num('pay-total') };`);
  check(withCp.goods - withCp.sale - withCp.coupon === withCp.total,
    `쿠폰 포함 등식 성립 (${withCp.goods}−${withCp.sale}−${withCp.coupon}=${withCp.total})`);

  // 쿠폰이 결제액보다 크면 음수가 되면 안 됩니다.
  const huge = await ev(`
    PAY_COUPON = 99999999; payRecalc();
    return _payNum(document.getElementById('pay-total').textContent);`);
  check(huge === 0, `과대 쿠폰에도 결제금액이 0 이상 (${huge})`);
  await ev(`PAY_COUPON = 0; payRecalc(); return 1;`);
}

// =================================================================
group('날짜 표시');
// =================================================================
{
  const today = new Date();
  const dates = await ev(`
    var p = PL.find(function (x) { return x.stock > 0; });
    openStoreByFid(p.fid);
    var sd = (document.getElementById('sd-date') || {}).textContent || '';
    openPay();
    var visit = (document.getElementById('pay-visit') || {}).textContent || '';
    return { sd: sd.trim(), visit: visit.trim() };`);

  const mm = today.getMonth() + 1, dd = today.getDate();
  const m = /(\d{1,2})\s*[.월]\s*(\d{1,2})/.exec(dates.visit);
  check(!!m, `결제 화면에 방문일 표시 (${dates.visit})`);
  if (m) {
    check(Number(m[1]) === mm && Number(m[2]) === dd,
      `결제 방문일이 오늘 (${mm}.${dd})`, `화면: ${dates.visit}`);
  }
  const m2 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/.exec(dates.sd);
  check(!m2 || (Number(m2[1]) === mm && Number(m2[2]) === dd),
    `상세 픽업일이 오늘 (${mm}월 ${dd}일)`, `화면: ${dates.sd}`);

  const cal = await ev(`return CAL2_TODAY;`);
  check(cal.year === today.getFullYear() && cal.month === mm && cal.day === dd,
    `캘린더 기준일이 오늘 (${cal.year}.${cal.month}.${cal.day})`);
}

// =================================================================
group('목록 정렬·필터');
// =================================================================
{
  const soon = await ev(`
    goTab('cal'); openStores(); calTab = 'soon'; renderCalStores();
    var out = [];
    document.querySelectorAll('#st-list .st-card').forEach(function (c) {
      var t = (c.querySelector('.st-status') || {}).textContent || '';
      var m = t.match(new RegExp('([0-9]+)')); out.push(m ? Number(m[1]) : 1e9);
    });
    return out;`);
  const real = soon.filter((v) => v < 1e9);
  check(real.length > 0, `재고가 표시된 매장 ${real.length}곳으로 정렬 확인`);
  check(soon.every((v, i) => i === 0 || soon[i - 1] <= v),
    `마감 임박 정렬이 오름차순 (${real.join(', ')})`);

  const search = await ev(`
    var si = document.getElementById('st-search'); si.value = '한우'; renderCalStores();
    var cards = document.querySelectorAll('#st-list .st-card');
    var n = cards.length, miss = 0;
    cards.forEach(function (c) {
      var key = (c.getAttribute('onclick') || '').match(/'([^']+)'/);
      var p = key ? PLACES[key[1]] : null;
      var s = key ? STORES.find(function (x) { return x.key === key[1]; }) : null;
      if (!p || !s) return;
      if ((p.nm + s.addr + s.cat).indexOf('한우') < 0) miss++;
    });
    si.value = ''; renderCalStores();
    return { n: n, miss: miss, back: document.querySelectorAll('#st-list .st-card').length,
      total: STORES.length };`);
  check(search.n > 0 && search.n < search.total,
    `검색이 목록을 실제로 줄임 (${search.n}/${search.total})`);
  check(search.miss === 0, `검색 결과가 전부 검색어를 포함 (오탐 ${search.miss}건)`);
  check(search.back === search.total, `검색어를 지우면 전체 복원 (${search.back}/${search.total})`);

  // 홈 세일 목록의 지역 필터
  const region = await ev(`
    goTab('home');
    var out = {};
    ['횡성', '평창', '정선'].forEach(function (rg) {
      hsState.region = rg; hsSaleList();
      var items = window._hsList || [];
      out[rg] = { n: items.length,
        other: items.filter(function (i) { return (i.place || '').indexOf(rg) < 0; })
                    .map(function (i) { return i.name + ' / ' + i.place; }) };
    });
    return out;`);
  for (const rg of ['횡성', '평창', '정선']) {
    check(region[rg].n > 0, `${rg} 필터에 상품이 있음 (${region[rg].n})`);
    check(region[rg].other.length === 0, `${rg} 목록에 다른 지역이 섞이지 않음`,
      region[rg].other.slice(0, 3).join(' | '));
  }

  // 더 불러오기가 같은 상품을 되풀이하지 않는가
  for (const rg of ['횡성', '평창', '정선']) {
    const d = await ev(`
      hsState.region = ${JSON.stringify(rg)}; hsSaleList();
      var total = (window._hsBaseList || []).length;
      for (var i = 0; i < 10; i++) hsRenderBatch(false);
      var names = [];
      document.querySelectorAll('#hs-sale-list .hs-sale-card').forEach(function (c) {
        names.push(((c.querySelector('.hs-sale-nm') || {}).textContent || '') + '|'
          + ((c.querySelector('.hs-sale-prod') || {}).textContent || '')); });
      return { shown: names.length, uniq: new Set(names).size, total: total };`);
    check(d.shown === d.total,
      `${rg} 목록이 보유 상품 수만큼만 표시 (표시 ${d.shown} / 보유 ${d.total})`);
    check(d.shown === d.uniq,
      `${rg} 목록에 같은 상품이 중복되지 않음 (고유 ${d.uniq})`);
  }

  // 할인율순 정렬
  const disc = await ev(`
    hsState.sort = '할인율순'; hsSaleList();
    return (window._hsList || []).map(function (i) { return _hsDiscOf(i); });`);
  check(disc.every((v, i) => i === 0 || disc[i - 1] >= v),
    `할인율순이 내림차순 (${disc.slice(0, 6).join(', ')}…)`);
  await ev(`hsState.sort = '마감임박순'; hsSaleList(); return 1;`);
}

// =================================================================
group('장바구니 · 예약 내역');
// =================================================================
{
  const before = await ev(`return { badge: cartCount(), rows: MY_PICKUPS.length };`);

  const made = await ev(`
    var p = PL.find(function (x) { return x.stock > 0; });
    openStoreByFid(p.fid); sdQtyVal = 1; payQty = 1; openPay();
    document.getElementById('pay-agree').classList.add('on');
    return payDo().then(function () { return { prod: p.prod, fid: p.fid }; })
      || { prod: p.prod, fid: p.fid };`);
  await page.waitForTimeout(1200);

  const after = await ev(`
    openCart();
    return { badge: cartCount(), rows: MY_PICKUPS.length,
      cards: document.querySelectorAll('#cart-list .hs-sale-card').length,
      count: (document.getElementById('cart-total-count') || {}).textContent };`);

  check(after.rows === before.rows + 1, `주문하면 예약이 1건 늘어남 (${before.rows} → ${after.rows})`);
  check(after.badge === before.badge + 1, `장바구니 배지가 함께 증가 (${after.badge})`);
  check(Number(after.count) === after.badge, `화면 건수 = 배지 숫자 (${after.count})`);
  check(after.cards === after.badge, `카드 개수 = 건수 (${after.cards})`);

  // 새로고침해도 남아 있어야 합니다 (서버가 정본).
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate('window.HL_READY');
  await page.waitForTimeout(800);
  const reloaded = await ev(`return { rows: MY_PICKUPS.length, badge: cartCount() };`);
  check(reloaded.rows === after.rows, `새로고침 후에도 유지 (${reloaded.rows})`);

  // 취소하면 다시 줄어야 합니다.
  const cancelled = await ev(`
    var p = MY_PICKUPS.find(function (x) { return x.orderId; });
    if (!p) return { skip: true };
    return fetch('/api/orders/' + p.orderId + '/cancel', { method: 'POST' })
      .then(function () { return hlRefreshPickups(); })
      .then(function () { return { rows: MY_PICKUPS.length, badge: cartCount() }; });`);
  if (!cancelled.skip) {
    check(cancelled.rows === reloaded.rows - 1, `취소하면 1건 줄어듦 (${cancelled.rows})`);
    check(cancelled.badge === cancelled.rows, '배지도 함께 감소');
  }
}

// =================================================================
group('코스 담기');
// =================================================================
{
  const saved = await ev(`
    var n0 = MY_COURSES.length;
    window._lrCurAvail = { nm: '논리검사 스팟', type: '축제' };
    var btn = document.createElement('button');
    lrAddAvailCourse(btn);
    var n1 = MY_COURSES.length;
    var btn2 = document.createElement('button');
    lrAddAvailCourse(btn2);
    var n2 = MY_COURSES.length;
    var dup = MY_COURSES.filter(function (c) { return c.title === '논리검사 스팟'; }).length;
    return { n0: n0, n1: n1, n2: n2, dup: dup };`);
  check(saved.n1 === saved.n0 + 1, `스팟을 담으면 1건 늘어남 (${saved.n0} → ${saved.n1})`);
  check(saved.dup === 1, `같은 스팟을 또 담아도 중복되지 않음 (현재 ${saved.dup}건)`);

  const counts = await ev(`
    goTab('mycourse');
    return { pk: Number((document.getElementById('mc2-pk-count') || {}).textContent),
      co: Number((document.getElementById('mc2-co-count') || {}).textContent),
      rpk: MY_PICKUPS.length, rco: MY_COURSES.length };`);
  check(counts.pk === counts.rpk, `내 코스 탭의 픽업 수가 실제와 일치 (${counts.pk}/${counts.rpk})`);
  check(counts.co === counts.rco, `코스 수가 실제와 일치 (${counts.co}/${counts.rco})`);
}

// =================================================================
group('후기 · 평점');
// =================================================================
{
  const r = await ev(`
    return fetch('/api/stores').then(function (x) { return x.json(); }).then(function (d) {
      var bad = d.stores.filter(function (s) {
        var ui = STORES.find(function (u) { return u.key === s.key; });
        return ui && String(ui.rate) !== String(s.rating);
      });
      return bad.map(function (s) { return s.key; });
    });`);
  check(r.length === 0, '화면 평점 = 서버 평점', r.slice(0, 4).join(', '));

  const rv = await ev(`
    return fetch('/api/reviews', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop: STORES[0] && PLACES[STORES[0].key].nm,
        prod: '화면논리', stars: 5, txt: '화면 논리 검증용 후기' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        return hlRefreshReviews().then(function () { return d; }); })
      .then(function (d) {
        go('reviews');
        return { id: d.review && d.review.id, mine: MY_REVIEWS.length,
          shown: document.querySelectorAll('#s-reviews .myrv-card').length,
          empty: document.querySelectorAll('#s-reviews .lr-empty').length };
      });`);
  check(rv.mine > 0, `후기를 쓰면 내 후기 목록에 들어감 (${rv.mine}건)`);
  check(rv.shown === rv.mine,
    `화면 카드 수 = 내 후기 수 (${rv.shown}/${rv.mine})`, `빈 상태 ${rv.empty}`);
  if (rv.id) await ev(`return fetch('/api/reviews/${rv.id}', { method: 'DELETE' }).then(function(){return 1;});`);
}

function _num(s) { return Number(String(s || '').replace(/[^0-9]/g, '')) || 0; }

console.log('');
await browser.close();
if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
console.log('  화면 논리 검증 전부 통과\n');
