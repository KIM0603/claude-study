/**
 * 실제 브라우저(설치된 Chrome)로 앱을 띄워 검증합니다.
 * 지금까지는 DOM 스텁으로만 확인해서, 진짜 렌더링·콘솔 오류는 못 보고 있었습니다.
 */
import fs from 'node:fs';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('\n  playwright-core 가 없어 브라우저 검증을 건너뜁니다.');
  console.log('  실행하려면: npm i -D playwright-core\n');
  process.exit(0);
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const URL = `http://localhost:${PORT}/happylocal_v2.html`;
const OUT = path.join(__dir, '..', 'shots');

/** 설치된 Chrome / Edge 를 찾습니다. playwright 브라우저를 따로 받지 않아도 됩니다. */
function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  const cands = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return cands.find((p) => fs.existsSync(p)) || null;
}

const CHROME = findBrowser();
if (!CHROME) {
  console.log('\n  Chrome/Edge 를 찾지 못해 브라우저 검증을 건너뜁니다.');
  console.log('  BROWSER_PATH 환경변수로 직접 지정할 수 있습니다.\n');
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });

const consoleErrors = [];
const pageErrors = [];
const failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error') { const l = m.location() || {}; consoleErrors.push(m.text() + ' @ ' + (l.url || '?')); } });
page.on('pageerror', (e) => pageErrors.push(e.message));
const notFound = [];
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
page.on('requestfailed', (r) => {
  const u = r.url();
  // 외부 타일/폰트 실패는 앱 결함이 아니므로 로컬 요청만 셉니다.
  if (u.includes('localhost')) failedReqs.push(u + ' :: ' + (r.failure()?.errorText || ''));
});

// 후기 작성 등은 로그인이 필요합니다. 먼저 세션을 만듭니다.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(`fetch('/api/auth/dev-login',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:'브라우저 검사 계정'})})
  .then(function(){
    // 이 계정의 예약·후기 화면을 확인하려면 자기 데이터가 있어야 합니다.
    // 시드 데이터는 주인이 없어 어느 계정에도 보이지 않습니다.
    return fetch('/api/products').then(function(r){return r.json();});
  })
  .then(function(d){
    var t = (d.raw||[]).find(function(p){ return p.stock > 0; });
    return fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({productId:t.id, qty:1})});
  })
  .then(function(){
    return fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({shop:'횡성한우 등심 — 김성호 농가', prod:'횡성한우 등심 500g',
        stars:5, txt:'브라우저 검사용 후기입니다'})});
  })`);
await page.waitForTimeout(900);

await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
// 부팅(서버 데이터 반영) 완료까지 기다립니다.
await page.waitForFunction('window.HL_READY !== undefined', { timeout: 10000 }).catch(() => {});
await page.evaluate(() => window.HL_READY).catch(() => {});
await page.waitForTimeout(1200);

console.log('');
check(pageErrors.length === 0, '치명적 JS 오류 없음', pageErrors.slice(0, 3).join(' | '));
check(consoleErrors.length === 0, '콘솔 error 없음', consoleErrors.slice(0, 3).join(' | '));
check(notFound.length === 0, '404 리소스 없음', notFound.slice(0, 5).join(' | '));
check(failedReqs.length === 0, '로컬 요청 실패 없음', failedReqs.slice(0, 3).join(' | '));

// 서버 데이터가 실제로 반영됐는지
const state = await page.evaluate(`({
  places: Object.keys(PLACES).length,
  pl: PL.length,
  stores: STORES.length,
  pickups: MY_PICKUPS.length,
  reviews: MY_REVIEWS.length,
  coupons: MY_COUPONS.length,
  courses: Object.keys(COURSES).length,
  source: HL_SOURCE,
  mapBackend: hlMapBackend(),
})`);
console.log('');
console.log('  상태:', JSON.stringify(state));
check(state.places > 0 && state.pl > 0 && state.stores > 0, '서버 데이터 반영됨');
check(state.courses > 0, `코스 생성됨 (${state.courses})`);
check(state.pickups > 0, `예약 내역 표시 (${state.pickups})`);
check(state.coupons > 0, `쿠폰 표시 (${state.coupons})`);
check(state.mapBackend !== null, `지도 백엔드 (${state.mapBackend})`);

// 홈 화면이 실제로 그려졌는지
const homeCards = await page.locator('#s-home .pcard, #s-home .scard, #s-home .hs-sale-card, #s-home .mcard').count();
check(homeCards > 0, `홈 카드 렌더 (${homeCards}개)`);

// 지도 화면으로 이동해서 마커가 실제로 찍히는지
await page.evaluate(`openMap()`);
await page.waitForTimeout(2500);
await page.waitForFunction(`document.querySelectorAll('#map-cards .mcard').length > 0`, { timeout: 8000 }).catch(() => {});
const markers = await page.locator('#smap .mk').count();
const mapCards = await page.locator('#map-cards .mcard').count();
const catChips = await page.locator('#map-cats .map-cat').count();
check(markers > 0, `지도 마커 렌더 (${markers}개)`);
check(mapCards > 0, `지도 하단 카드 (${mapCards}개)`);
check(catChips > 0, `카테고리 칩 (${catChips}개)`);
await page.screenshot({ path: OUT + '/shot-map.png' });

// 축제 필터가 실제로 동작하는지
if (catChips > 0) {
  const before = mapCards;
  await page.evaluate(`pickMapCat('festival')`);
  await page.waitForTimeout(1200);
  const after = await page.locator('#map-cards .mcard').count();
  check(after > 0 && after <= before, `축제 필터 동작 (${before} -> ${after})`);
  await page.evaluate(`pickMapCat('전체')`);
  await page.waitForTimeout(600);
}

// 테마 전환
const t0 = await page.evaluate(() => document.getElementById('phone').getAttribute('data-theme'));
await page.evaluate(`toggleTheme()`);
await page.waitForTimeout(300);
const t1 = await page.evaluate(() => document.getElementById('phone').getAttribute('data-theme'));
check(t0 !== t1, `테마 전환 동작 (${t0} -> ${t1})`);
await page.screenshot({ path: OUT + '/shot-dark.png' });
await page.evaluate(`toggleTheme()`);

// 내 후기 화면 + 쓰기 시트
await page.evaluate(`go('reviews')`);
await page.waitForTimeout(700);
const rvCards = await page.locator('#myrv-list .myrv-card').count();
check(rvCards > 0, `후기 카드 렌더 (${rvCards}개)`);
await page.evaluate(`openWriteReview()`);
await page.waitForTimeout(500);
const sheetOpen = await page.locator('#wrsheet.show').count();
const starCount = await page.locator('#wr-stars .wr-star').count();
check(sheetOpen === 1, '후기 작성 시트 열림');
check(starCount === 5, `별점 5개 렌더 (${starCount})`);
await page.screenshot({ path: OUT + '/shot-review.png' });


// ---------------------------------------------------------------
// 전 화면 스윕
//
// 이 앱은 go(id) 와 렌더 함수를 쌍으로 호출합니다. go() 만 부르면 빈 화면이
// 나오는 게 정상이라, 반드시 UI 가 실제로 쓰는 진입 경로로 확인해야 합니다.
// ---------------------------------------------------------------
console.log('');
const SCREENS = [
  ['home', "go('home')", null],
  ['cal', "goTab('cal')", null],
  ['mycourse', "goTab('mycourse')", null],
  ['my', "goTab('my')", null],
  ['routebuild', "goTab('route')", null],
  ['cart', 'openCart()', null],
  ['coupons', "go('coupons')", 'mycp-list'],
  ['faq', "renderFAQ('전체');go('faq')", 'faq-list'],
  ['notice', 'renderNotice();go(SCREEN_NOTICE)', 'ntc-list'],
  ['terms', "renderLegal('terms');go('terms')", null],
  ['privacy', "renderLegal('privacy');go('privacy')", null],
  ['notif', "go('notif')", null],
  ['support', "go('support')", null],
  ['inquiry', "go('inquiry')", null],
  ['invite', "go('invite')", null],
];

const screenProblems = [];
for (const [id, code, host] of SCREENS) {
  const src = code.replace('SCREEN_NOTICE', "'notice'");
  const navErr = await page.evaluate(
    '(function(){ try { ' + src + '; return ""; } catch(e){ return e.message; } })()'
  );
  await page.waitForTimeout(400);
  const info = await page.evaluate(
    '(function(){' +
    '  var el = document.getElementById("s-" + ' + JSON.stringify(id) + ');' +
    '  if (!el) return { missing: true };' +
    '  var h = ' + JSON.stringify(host) + ' ? document.getElementById(' + JSON.stringify(host) + ') : null;' +
    '  return { active: el.classList.contains("active"),' +
    '           textLen: (el.innerText||"").trim().length,' +
    '           hostCount: h ? h.children.length : -1 };' +
    '})()'
  );
  const bad = [];
  if (info.missing) bad.push('섹션 없음');
  if (navErr) bad.push('진입 오류: ' + navErr);
  if (!info.missing && !info.active) bad.push('활성화 안 됨');
  if (host && info.hostCount === 0) bad.push('컨테이너 비어있음(' + host + ')');
  if (!info.missing && info.textLen < 20) bad.push('내용 없음(' + info.textLen + '자)');
  if (bad.length) screenProblems.push(id + ': ' + bad.join(', '));
}
check(screenProblems.length === 0,
  '전 화면 진입 및 렌더 (' + SCREENS.length + '개)',
  screenProblems.slice(0, 4).join(' | '));


// ---------------------------------------------------------------
// 내 주변 매장 (정렬 탭 + 검색)
//
// CSS 와 렌더 로직만 있고 화면 마크업이 없어 동작하지 않던 기능입니다.
// ---------------------------------------------------------------
console.log('');
await page.evaluate('openStores()');
await page.waitForTimeout(700);

const stTabs = await page.locator('#s-stores .st-tab').count();
const stNear = await page.locator('#st-list .st-card').count();
check(stTabs === 3, `정렬 탭 3개 (${stTabs})`);
check(stNear > 0, `매장 목록 렌더 (${stNear}개)`);

const stCount = (await page.locator('#st-count').textContent()) || '';
check(stCount.includes(String(stNear)), '개수 표시가 실제 목록과 일치', stCount);

// 가까운 순: 거리가 오름차순인가
const km = await page.evaluate(
  "[...document.querySelectorAll('#st-list .st-dist')].slice(0,6)" +
  ".map(e => parseFloat(e.textContent) || 999)"
);
const sortedNear = km.every((v, i) => i === 0 || km[i - 1] <= v);
check(sortedNear, '가까운 순 정렬 (' + km.join(', ') + ')');

// 마감 임박: 남은 수량이 적은 순
await page.evaluate("pickStTab(document.querySelectorAll('#s-stores .st-tab')[1],'soon')");
await page.waitForTimeout(500);
const remains = await page.evaluate(
  "[...document.querySelectorAll('#st-list .st-status')].slice(0,5)" +
  ".map(e => { var m = e.textContent.match(/(\\d+)/); return m ? Number(m[1]) : 1e9; })"
);
const sortedSoon = remains.every((v, i) => i === 0 || remains[i - 1] <= v);
check(sortedSoon, '마감 임박 정렬 (' + remains.join(', ') + ')');

// 평점 높은 순: 목록이 줄지 않아야 합니다 (필터가 아니라 정렬)
await page.evaluate("pickStTab(document.querySelectorAll('#s-stores .st-tab')[2],'rate')");
await page.waitForTimeout(500);
const stRate = await page.locator('#st-list .st-card').count();
check(stRate === stNear, `평점 탭은 걸러내지 않고 정렬만 (${stRate}/${stNear})`);

// 검색
await page.evaluate("pickStTab(document.querySelectorAll('#s-stores .st-tab')[0],'near')");
await page.waitForTimeout(300);
await page.evaluate('toggleStSearch()');
await page.waitForTimeout(300);
check((await page.locator('#st-searchbar.show').count()) === 1, '검색바 열림');

await page.fill('#st-search', '한우');
await page.waitForTimeout(600);
const stSearch = await page.locator('#st-list .st-card').count();
check(stSearch > 0 && stSearch < stNear, `검색 결과 좁혀짐 (${stNear} -> ${stSearch})`);

// 검색을 닫으면 검색어가 지워지고 전체가 돌아와야 합니다.
await page.evaluate('toggleStSearch()');
await page.waitForTimeout(600);
const stAfter = await page.locator('#st-list .st-card').count();
check(stAfter === stNear, `검색 닫으면 초기화 (${stAfter}/${stNear})`);

// 없는 검색어 -> 빈 상태 문구
await page.evaluate('toggleStSearch()');
await page.waitForTimeout(300);
await page.fill('#st-search', 'zzz없는매장zzz');
await page.waitForTimeout(600);
const emptyMsg = (await page.locator('#st-list .st-empty').textContent().catch(() => '')) || '';
check(emptyMsg.includes('검색 결과'), '검색 결과 없음 안내', emptyMsg);
await page.evaluate('toggleStSearch()');
await page.waitForTimeout(400);


// ---------------------------------------------------------------
// 서버가 관리하는 데이터가 실제로 화면에 반영됐는가
//
// 서버는 보내는데 프론트가 무시하던 키가 13개 있었습니다.
// 상수 선언은 그대로 두고 내용만 갈아끼우는 방식이라, 실제로 바뀌었는지 봅니다.
// ---------------------------------------------------------------
console.log('');
const adopted = await page.evaluate('HL_ADOPTED || []');
check(adopted.length >= 18, `서버 관리 데이터 채택 (${adopted.length}종)`, adopted.join(', '));

const today = await page.evaluate('JSON.stringify(CAL2_TODAY)');
const now = new Date();
check(JSON.parse(today).year === now.getFullYear(),
  `캘린더 기준일이 실제 오늘 (${today})`);

// 축제는 두 API 에서 옵니다: 전국문화축제표준데이터(festival-std) + TourAPI.
const fests = await page.evaluate(`({
  total: STORES.filter(s=>s.type==='festival').length,
  std: STORES.filter(s=>s.type==='festival' && s.source==='festival-std').length,
  tour: STORES.filter(s=>s.type==='festival' && s.source==='tourapi').length,
  sample: STORES.filter(s=>s.type==='festival' && s.sample).length
})`);
check(fests.std > 0, `축제표준데이터 연동 (${fests.std}곳)`);
check(fests.total === fests.std + fests.tour + fests.sample,
  `축제 출처가 모두 분류됨 (표준 ${fests.std} + TourAPI ${fests.tour} + 샘플 ${fests.sample} = ${fests.total})`);

// 대상 3개 군에 실제 축제가 들어왔는가 (TourAPI 로는 0건이던 지역)
const localFest = await page.evaluate(
  "['횡성','평창','정선'].map(function(r){ return r + ':' + " +
  "STORES.filter(function(s){return s.type==='festival' && s.rg===r;}).length; }).join(' ')"
);
check(/횡성:[1-9]/.test(localFest), `대상 지역 축제 확보 (${localFest})`);

// 지난 연도 일정을 그대로 노출하지 않고 "매년 N월" 로 표기하는가
const periods = await page.evaluate(
  "STORES.filter(function(s){return s.source==='festival-std';}).slice(0,8)" +
  ".map(function(s){ return (PLACES[s.key]||{}).period || ''; })"
);
check(periods.every((p) => /^매년/.test(p) || p === '개최 시기 미정'),
  `축제 기간이 연도 없이 표기됨 (${periods.slice(0, 3).join(' / ')})`);

// 샘플 항목에는 배지가 보여야 합니다.
await page.evaluate("openMap()");
await page.waitForTimeout(2200);
await page.evaluate("pickMapCat('festival')");
await page.waitForTimeout(1200);
const badges = await page.locator('#map-cards .smp-tag').count();
check(badges === fests.sample, `샘플 배지 표시 (${badges}/${fests.sample})`);

const stats = await page.evaluate('JSON.stringify(MY_STATS)');
check(!/"completed":14/.test(stats), `픽업 완료 수가 실제 주문 기준 (${stats})`);


// 캘린더 축제도 실데이터인가 (지도만 바꾸고 캘린더를 빠뜨린 적이 있습니다)
const cal2 = await page.evaluate(`({
  n: CAL2_FESTIVAL.length,
  std: CAL2_FESTIVAL.filter(function(f){return f.source==='festival-std';}).length,
  dated: CAL2_FESTIVAL.filter(function(f){
    return typeof f.start === 'string' && f.start.length === 10
      && f.start.indexOf('-') === 4 && !isNaN(Date.parse(f.start));
  }).length,
  month: cal2State.month, year: cal2State.year
})`);
check(cal2.std === cal2.n && cal2.n > 0,
  `캘린더 축제가 모두 실데이터 (${cal2.std}/${cal2.n})`);
check(cal2.dated === cal2.n, `모든 축제에 실제 날짜 존재 (${cal2.dated})`);
const nowD = new Date();
check(cal2.year === nowD.getFullYear() && cal2.month === nowD.getMonth() + 1,
  `캘린더가 이번 달로 열림 (${cal2.year}.${cal2.month})`);


// MY 프로필 행 - 화살표만 있고 눌러도 아무 일이 없던 자리입니다.
// 앞 검사가 후기 시트를 열어둔 채 끝나면 스크림이 클릭을 가로챕니다.
await page.evaluate("typeof closeWriteReview==='function' && closeWriteReview()");
await page.waitForTimeout(400);
await page.evaluate("goTab('my')");
await page.waitForTimeout(500);
const prow = await page.locator('.my2-prow').count();
check(prow === 1, '프로필 행 존재');
check(await page.evaluate("!!document.querySelector('.my2-prow').getAttribute('onclick')"),
  '프로필 행에 클릭 핸들러 연결됨');

await page.click('.my2-prow');
await page.waitForTimeout(700);
const sheetOn = await page.locator('#acsheet.show').count();
check(sheetOn === 1, '프로필 행 클릭 -> 계정 시트 열림');
const acRows = await page.locator('#ac-rows .ac-row').count();
check(acRows >= 4, `계정 정보 항목 표시 (${acRows}행)`);
const acName = (await page.locator('#ac-name').textContent()) || '';
check(acName.includes('님'), '계정 이름 표시', acName);
await page.evaluate('closeProfile()');
await page.waitForTimeout(300);
check((await page.locator('#acsheet.show').count()) === 0, '계정 시트 닫힘');


// ---------------------------------------------------------------
// 조작 지점 스모크
//
// 화면마다 눌리는 요소가 100개 가까이 되는데 개별 검사는 없었습니다.
// 각 화면을 열고 그 안의 클릭 가능한 요소를 모두 눌러, JS 오류가 나는지 봅니다.
// (결과의 옳고 그름이 아니라 "누르면 깨지는가" 를 봅니다.)
// ---------------------------------------------------------------
console.log('');
const SMOKE = [
  ["go('home')", 'home'],
  ['openMap()', 'map'],
  ["goTab('route')", 'routebuild'],
  ["goTab('cal')", 'cal'],
  ['openStores()', 'stores'],
  ["goTab('mycourse')", 'mycourse'],
  ["goTab('my')", 'my'],
  ["go('reviews')", 'reviews'],
  ["go('coupons')", 'coupons'],
  ["go('invite')", 'invite'],
  ["go('notif')", 'notif'],
  ["go('support')", 'support'],
  ["renderFAQ('전체');go('faq')", 'faq'],
  ["go('inquiry')", 'inquiry'],
  ['renderNotice();go(\'notice\')', 'notice'],
  ['openCart()', 'cart'],
];

const smokeErrors = [];
let clicked = 0;
const errMark = consoleErrors.length + pageErrors.length;

for (const [entry, id] of SMOKE) {
  await page.evaluate(`(function(){ try { ${entry}; } catch(e){} })()`);
  await page.waitForTimeout(id === 'map' ? 2000 : 450);

  // 화면 안의 onclick 핸들러를 직접 실행합니다.
  // 실제 클릭은 스크림·시트가 가려 불안정해서, 핸들러를 호출해 예외만 봅니다.
  const res = await page.evaluate(`(function(){
    var root = document.getElementById('s-' + ${JSON.stringify(id)});
    if (!root) return { n: 0, errs: [] };
    var nodes = root.querySelectorAll('[onclick]');
    var errs = [], n = 0;
    for (var i = 0; i < nodes.length && i < 40; i++) {
      var el = nodes[i];
      var code = el.getAttribute('onclick') || '';
      // 화면을 벗어나거나 새로고침하는 것은 제외합니다.
      var SKIP = ['goBack', 'location', 'doLogout', 'loginWith', 'loginDev', 'go('];
      var skip = false;
      for (var k = 0; k < SKIP.length; k++) { if (code.indexOf(SKIP[k]) >= 0) { skip = true; break; } }
      if (skip) continue;
      n++;
      try { new Function('event', code).call(el, { stopPropagation: function(){}, preventDefault: function(){}, key: '' }); }
      catch (e) { errs.push(code.slice(0, 40) + ' -> ' + e.message.slice(0, 60)); }
    }
    // 열렸을 수 있는 시트를 닫아 다음 화면에 영향이 없게 합니다.
    document.querySelectorAll('.sheet.show, .scrim.show').forEach(function (x) { x.classList.remove('show'); });
    return { n: n, errs: errs };
  })()`);

  clicked += res.n;
  res.errs.forEach((e) => smokeErrors.push(id + ': ' + e));
  await page.waitForTimeout(150);
}

check(smokeErrors.length === 0,
  `조작 지점 ${clicked}개 실행 시 예외 없음`,
  smokeErrors.slice(0, 5).join(' | '));

const newErrs = (consoleErrors.length + pageErrors.length) - errMark;
check(newErrs === 0, '스모크 중 콘솔 오류 없음',
  consoleErrors.slice(-3).concat(pageErrors.slice(-3)).join(' | '));

// 쿠폰·알림·초대는 새로 붙인 기능이라 결과까지 확인합니다.
console.log('');
await page.evaluate(`(function(){ var it = PL.find(function(p){return p.stock>0;});
  sdItem = it; sdMax = it.stock; sdQtyVal = 1; payQty = 1; openPay(); })()`);
await page.waitForTimeout(1500);
const couponRow = (await page.locator('#s-pay .pay-coupon-val').textContent()) || '';
check(/원|쿠폰/.test(couponRow), `결제 화면 쿠폰 표시 (${couponRow.trim()})`);

const payState = await page.evaluate(`({
  picked: HL_PICKED_COUPON ? HL_PICKED_COUPON.discount : 0,
  applied: PAY_COUPON,
  total: (document.getElementById('pay-total')||{}).textContent
})`);
check(payState.applied === payState.picked,
  `선택 쿠폰이 결제에 반영됨 (-${payState.applied}, ${payState.total})`);
check(payState.applied !== 3000 || payState.picked === 3000,
  '고정 3,000원 할인이 아님');

await page.evaluate("go('notif')");
await page.waitForTimeout(800);
const ntfKeys = await page.locator('#s-notif .ntf-row[data-ntf]').count();
check(ntfKeys === 5, `알림 항목이 설정 키와 연결됨 (${ntfKeys})`);

await page.evaluate("go('invite')");
await page.waitForTimeout(900);
const invCode = ((await page.locator('#inv-code').textContent()) || '').trim();
check(invCode.length >= 4 && invCode !== 'HAPPY-9F82K',
  `초대코드가 계정별로 발급됨 (${invCode})`);

console.log('');
if (consoleErrors.length) {
  console.log('  --- 콘솔 오류 전체 ---');
  consoleErrors.slice(0, 10).forEach((e) => console.log('   ', e.slice(0, 160)));
}
if (pageErrors.length) {
  console.log('  --- 페이지 예외 전체 ---');
  pageErrors.slice(0, 10).forEach((e) => console.log('   ', e.slice(0, 200)));
}

await browser.close();
console.log('');
console.log(`  스크린샷: ${OUT}`);
if (failures) { console.log(`  ${failures}건 실패`); process.exit(1); }
console.log('  전부 통과');
