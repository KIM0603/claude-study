/**
 * 프론트엔드 스모크 테스트 (브라우저 없이).
 *
 *   node src/fronttest.js
 *
 * happylocal_v2.html 의 앱 스크립트를 최소 DOM 스텁 위에서 실제로 실행합니다.
 * 목적은 하나: 서버가 내려준 데이터로 hlApplyBootstrap() -> buildCourses() 가
 * 예외 없이 끝나는지 확인하는 것. 코스 생성기는 PLACES[k].type 을 직접 읽기 때문에
 * POOL 과 PLACES 가 어긋나면 앱 전체가 멈추는데, 그 조합은 TourAPI 응답 내용에
 * 따라 달라져서 브라우저를 열어봐야만 알 수 있는 종류의 버그입니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(__dir, '..', '..', 'happylocal_v2.html');
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;


// ---------------------------------------------------------------
// 로그인 지원: 주문·후기는 이제 계정이 있어야 합니다.
// node 의 fetch 는 쿠키를 자동으로 물고 다니지 않아서 직접 이어줍니다.
// ---------------------------------------------------------------
let __cookie = '';
const __rawFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  const headers = { ...(opt.headers || {}) };
  if (__cookie) headers.Cookie = __cookie;
  const r = await __rawFetch(url, { ...opt, headers });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) __cookie = sc.map((c) => c.split(';')[0]).join('; ');
  return r;
};

async function loginForTests(base, nickname) {
  const r = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: nickname || '테스트 계정' }),
  });
  if (!r.ok) throw new Error('개발 로그인 실패 (ALLOW_DEV_LOGIN 확인): HTTP ' + r.status);
  return (await r.json()).user;
}

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};

/** 앱이 건드리는 최소한의 DOM 만 흉내냅니다. */
function makeElement(tag = 'div') {
  const el = {
    tagName: tag, id: '', className: '', textContent: '', value: '',
    firstElementChild: null,
    style: new Proxy({}, { get: () => '', set: () => true }),
    dataset: {}, children: [], parentNode: null, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute: () => '',
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    scrollTo() {}, focus() {}, click() {}, insertAdjacentHTML() {},
    closest: () => null, remove() {},
  };
  // 지도 마커는 innerHTML 로 DOM 을 만든 뒤 firstElementChild 를 씁니다.
  // 그 경로를 테스트하려면 스텁도 최소한의 파싱은 해야 합니다.
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html || ''; },
    set(v) {
      this._html = v;
      const m = /^\s*<(\w+)([^>]*)>/.exec(v || '');
      if (m) {
        const child = makeElement(m[1]);
        const cm = /class="([^"]*)"/.exec(m[2]);
        if (cm) child.className = cm[1];
        this.children = [child];
        this.firstElementChild = child;
      } else {
        this.children = [];
        this.firstElementChild = null;
      }
    },
  });
  return el;
}

function makeDocument() {
  const body = makeElement('body');
  return {
    body,
    documentElement: makeElement('html'),
    createElement: (t) => makeElement(t),
    createElementNS: (_ns, t) => makeElement(t),
    getElementById: () => null,          // 렌더 함수들은 대부분 `if(!host)return;` 로 방어됩니다
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createTextNode: () => makeElement('#text'),
  };
}

/** 조건이 참이 될 때까지 폴링합니다. 고정 sleep 은 부하에 따라 흔들립니다. */
async function waitFor(fn, { timeout = 8000, step = 50 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* 계속 시도 */ }
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

const main = async () => {
  await loginForTests(BASE, '프론트 검사 계정');

  const html = fs.readFileSync(HTML, 'utf8');
  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const app = blocks[blocks.length - 1];
  check(app.length > 10000, '앱 스크립트 추출', `${app.length} chars`);

  const doc = makeDocument();
  const errors = [];

  const sandbox = {
    document: doc,
    console: { log() {}, warn(...a) { errors.push(['warn', a.join(' ')]); }, error(...a) { errors.push(['error', a.join(' ')]); } },
    location: { protocol: 'http:', host: `localhost:${PORT}`, href: `http://localhost:${PORT}/` },
    navigator: { clipboard: null, userAgent: 'node' },
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
      };
    })(),
    fetch: (p, o) => { sandbox.__fetchCount = (sandbox.__fetchCount || 0) + 1; return fetch(`http://localhost:${PORT}${p}`, o); },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    alert() {}, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp,
    Error, TypeError, Promise, Intl, isNaN, parseInt, parseFloat, encodeURIComponent,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    L: undefined,                       // Leaflet 은 없음 - buildStoreMap 은 스스로 방어합니다
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);

  try {
    vm.runInContext(app, ctx, { filename: 'happylocal_v2.html', timeout: 20000 });
    check(true, '앱 스크립트 최초 실행 (예외 없음)');
  } catch (e) {
    check(false, '앱 스크립트 최초 실행 (예외 없음)', `${e.name}: ${e.message}`);
    console.log('\n  스택:\n' + String(e.stack).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
    process.exit(1);
  }

  // 시드(내장) 상태 확인
  const seedPlaces = vm.runInContext('Object.keys(PLACES).length', ctx);
  const seedCourses = vm.runInContext('Object.keys(COURSES).length', ctx);
  check(seedPlaces > 0, `내장 시드 PLACES (${seedPlaces})`);
  check(seedCourses > 0, `내장 시드로 생성된 COURSES (${seedCourses})`);

  // 서버 부트스트랩 적용 -> 코스 재생성
  let d;
  try {
    d = await fetch(`http://localhost:${PORT}/api/bootstrap`).then((r) => r.json());
  } catch {
    console.log('\n  서버가 떠 있지 않아 부트스트랩 적용 단계를 건너뜁니다. (npm start 후 재실행)\n');
    process.exit(failures ? 1 : 0);
  }

  // 스크립트 로드 시 자동 실행된 hlBoot() 가 끝나기를 먼저 기다립니다.
  // 이게 나중에 완료되면 PLACES 를 새 객체로 교체해 버려서, 그 전에 채워둔
  // 상세정보가 사라집니다 (실제로 테스트가 간헐 실패한 원인이었습니다).
  await vm.runInContext('HL_READY', ctx).catch(() => {});

  ctx.__boot = d;
  try {
    vm.runInContext('hlApplyBootstrap(__boot)', ctx, { timeout: 20000 });
    check(true, 'hlApplyBootstrap + buildCourses (예외 없음)');
  } catch (e) {
    check(false, 'hlApplyBootstrap + buildCourses (예외 없음)', `${e.name}: ${e.message}`);
    console.log('\n  스택:\n' + String(e.stack).split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
    process.exit(1);
  }

  const n = (expr) => vm.runInContext(expr, ctx);
  check(n('Object.keys(PLACES).length') === Object.keys(d.PLACES).length,
    `PLACES 가 서버 데이터로 교체됨 (${n('Object.keys(PLACES).length')})`);
  check(n('PL.length') === d.PL.length, `PL 교체 (${n('PL.length')})`);
  check(n('STORES.length') === d.STORES.length, `STORES 교체 (${n('STORES.length')})`);
  check(n('Object.keys(COURSES).length') > 0, `코스 재생성 (${n('Object.keys(COURSES).length')})`);
  check(n('PL.every(p=>!!p.fid)'), '모든 PL 항목에 fid 부여');

  // 생성된 코스가 실제로 참조 가능한지 (렌더 시점에 터지는 것을 미리 잡습니다)
  const bad = n(`(function(){
    const out=[];
    for(const id in COURSES){
      for(const s of COURSES[id].seq){ if(!PLACES[s.k]) out.push(id+':'+s.k); }
    }
    return out.slice(0,5);
  })()`);
  check(bad.length === 0, '모든 코스의 경유지가 PLACES 에 존재', bad.join(', '));

  const noGeo = n(`(function(){
    const out=[];
    for(const id in COURSES){ for(const s of COURSES[id].seq){ if(!GEO[s.k]) out.push(id+':'+s.k); } }
    return out.slice(0,5);
  })()`);
  check(noGeo.length === 0, '모든 코스 경유지에 좌표 존재 (지도 렌더 가능)', noGeo.join(', '));

  // 렌더 함수들을 실제로 호출해봅니다 (DOM 이 비어 있어도 예외가 나면 안 됩니다)
  const renders = ['renderList', 'renderMonths', 'paintCal', 'renderCal2', 'renderMy',
    'renderCartBadge', 'renderMyReviews', 'renderMyCoupons', 'renderCalStores'];
  const renderErrs = [];
  for (const fn of renders) {
    try { vm.runInContext(`typeof ${fn}==='function' && ${fn}()`, ctx, { timeout: 10000 }); }
    catch (e) { renderErrs.push(`${fn}: ${e.message}`); }
  }
  check(renderErrs.length === 0, '렌더 함수 전체 호출', renderErrs.slice(0, 3).join(' | '));

  console.log('');
  // ---------------------------------------------------------------
  // 지도 카테고리 필터
  // ---------------------------------------------------------------
  console.log('');
  const setCat = (c) => vm.runInContext(`mapCat=${JSON.stringify(c)}; mapStores().length`, ctx);
  const setRegion = (r) => vm.runInContext(`mapRegion=${JSON.stringify(r)};`, ctx);

  setRegion('전체');
  const all = setCat('전체');
  const pk = setCat('pickup');
  const food = setCat('food');
  const tour = setCat('tour');
  const fest = setCat('festival');
  check(all === d.STORES.length, `카테고리 전체 = STORES 전량 (${all})`);
  check(pk + food + tour + fest === all,
    `유형별 합이 전체와 일치 (픽업 ${pk} + 맛집 ${food} + 관광 ${tour} + 축제 ${fest} = ${all})`);
  check(fest > 0, `축제가 지도에 노출됨 (${fest}곳)`);
  check(tour > 0, `관광명소가 지도에 노출됨 (${tour}곳)`);

  // 지역별로 모든 갈래가 보이는지 ("지역별로 가게, 축제정보를 한번에")
  for (const r of ['횡성', '평창', '정선']) {
    setRegion(r);
    const n = setCat('전체');
    const nf = setCat('festival');
    check(n > 0 && nf > 0, `${r}: 전체 ${n}곳 / 축제 ${nf}곳`);
  }
  setRegion('전체');
  setCat('전체');

  // 오늘/내일 필터가 관광·축제까지 지우면 안 됩니다.
  const dayAll = vm.runInContext('mapDay="전체"; mapCat="전체"; mapStores().length', ctx);
  const dayToday = vm.runInContext('mapDay="오늘"; mapStores().length', ctx);
  const todayFest = vm.runInContext('mapStores().filter(s=>s.type==="festival").length', ctx);
  check(todayFest === fest, `"오늘" 필터가 축제를 지우지 않음 (${todayFest}/${fest})`);
  check(dayToday <= dayAll, `"오늘" 필터는 픽업만 좁힘 (${dayAll} -> ${dayToday})`);
  vm.runInContext('mapDay="전체";', ctx);

  // 마커 아이콘 선택기
  const iconErrs = [];
  for (const t of ['pickup', 'food', 'tour', 'festival']) {
    try {
      const cls = vm.runInContext(`_mkCls({type:${JSON.stringify(t)},cat:'한우'})`, ctx);
      const ic = vm.runInContext(`_mapIcon({type:${JSON.stringify(t)},cat:'한우'})`, ctx);
      if (!cls || !ic.startsWith('<svg')) iconErrs.push(t);
    } catch (e) { iconErrs.push(`${t}: ${e.message}`); }
  }
  check(iconErrs.length === 0, '유형별 마커 아이콘 생성', iconErrs.join(', '));

  // ---------------------------------------------------------------
  // 지도 추상화 계층
  // ---------------------------------------------------------------
  console.log('');
  check(vm.runInContext('hlMapBackend()', ctx) === null, '지도 라이브러리 없을 때 backend=null');
  check(vm.runInContext('HLMapCreate(document.createElement("div"),{})', ctx) === null,
    '백엔드 없으면 HLMapCreate 가 null (예외 아님)');

  // 카카오 SDK 스텁을 심고 카카오 경로를 실제로 실행합니다.
  // 카카오 JS 키가 없어 브라우저로는 확인할 수 없는 부분이라 여기서 덮습니다.
  const calls = { marker: 0, polyline: 0, setBounds: 0, panTo: 0, relayout: 0 };
  ctx.__calls = calls;
  vm.runInContext(`
    kakao = {
      maps: {
        LatLng: function(a,b){ this.a=a; this.b=b; },
        LatLngBounds: function(){ this.pts=[]; this.extend=function(p){ this.pts.push(p); }; },
        Map: function(host, o){
          this.o=o;
          this.setBounds=function(){ __calls.setBounds++; };
          this.setCenter=function(){};
          this.setLevel=function(){};
          this.panTo=function(){ __calls.panTo++; };
          this.panBy=function(){};
          this.relayout=function(){ __calls.relayout++; };
        },
        CustomOverlay: function(o){
          __calls.marker++; this.o=o;
          this.setMap=function(){}; this.setZIndex=function(){};
        },
        Polyline: function(o){ __calls.polyline++; this.setMap=function(){}; }
      }
    };
  `, ctx);

  check(vm.runInContext('hlMapBackend()', ctx) === 'kakao', '카카오 SDK 감지 -> backend=kakao');

  // Leaflet 줌 -> 카카오 레벨 (방향이 반대라 틀리기 쉬운 지점)
  check(vm.runInContext('_hlZ2Level(13)', ctx) === 6, 'zoom 13 -> level 6');
  check(vm.runInContext('_hlZ2Level(10)', ctx) === 9, 'zoom 10 -> level 9');
  check(vm.runInContext('_hlZ2Level(18)', ctx) === 1, 'zoom 18 -> level 1 (하한 클램프)');
  check(vm.runInContext('_hlZ2Level(2)', ctx) === 14, 'zoom 2 -> level 14 (상한 클램프)');

  const kakaoOk = vm.runInContext(`(function(){
    var h = HLMapCreate(document.createElement('div'), {center:[37.5,128.0], zoom:10});
    if(!h || h.backend!=='kakao') return 'create failed';
    var clicked = 0;
    var mk = h.addMarker([37.5,128.0], '<div class="mk pk"><span>x</span></div>', function(){ clicked++; });
    if(!mk || !mk.el) return 'marker el missing';
    if(mk.el.className !== 'mk pk') return 'marker el wrong: ' + mk.el.className;
    mk.setZ(1000);
    h.addPolyline([[37.5,128.0],[37.6,128.1]], {color:'#3FC358'});
    h.fitBounds([[37.5,128.0],[37.6,128.1]], 60);
    h.panTo([37.5,128.0]);
    h.flyTo([37.5,128.0], 13);
    h.relayout();
    h.clear();
    return 'ok';
  })()`, ctx);
  check(kakaoOk === 'ok', '카카오 백엔드 전체 동작 (마커/폴리라인/바운즈/이동)', kakaoOk);
  check(calls.marker === 1, `CustomOverlay 로 마커 생성 (${calls.marker})`);
  check(calls.polyline === 1, `Polyline 으로 경로 생성 (${calls.polyline})`);
  check(calls.setBounds === 1, `setBounds 로 영역 맞춤 (${calls.setBounds})`);
  check(calls.panTo === 2, `panTo 호출 (${calls.panTo})`);
  check(calls.relayout === 1, `relayout 호출 (${calls.relayout})`);

  // 카카오가 있으면 실제 지도 빌더들이 그 위에서 동작해야 합니다.
  const builderErrs = [];
  for (const fn of ['buildStoreMap', 'initHomeMap']) {
    try { vm.runInContext(`typeof ${fn}==='function' && ${fn}()`, ctx, { timeout: 10000 }); }
    catch (e) { builderErrs.push(`${fn}: ${e.message}`); }
  }
  check(builderErrs.length === 0, '카카오 백엔드로 지도 빌더 실행', builderErrs.join(' | '));

  // ---------------------------------------------------------------
  // Leaflet 폴백 경로
  // 카카오 키가 없을 때 실제로 쓰이는 경로라 함께 검증합니다.
  // ---------------------------------------------------------------
  console.log('');
  const lcalls = { marker: 0, polyline: 0, fitBounds: 0, panTo: 0, invalidateSize: 0, tile: 0 };
  ctx.__lcalls = lcalls;
  vm.runInContext(`
    kakao = undefined;
    L = {
      map: function(host, o){
        return {
          setView: function(){ return this; },
          fitBounds: function(){ __lcalls.fitBounds++; },
          panTo: function(){ __lcalls.panTo++; },
          flyTo: function(){ __lcalls.panTo++; },
          panBy: function(){},
          invalidateSize: function(){ __lcalls.invalidateSize++; },
          getSize: function(){ return {x:390,y:600}; },
          getZoom: function(){ return 10; },
          attributionControl: { setPrefix: function(){} }
        };
      },
      tileLayer: function(){ __lcalls.tile++; return { addTo: function(){ return this; }, setUrl: function(){} }; },
      layerGroup: function(){ return { addTo: function(){ return this; }, clearLayers: function(){} }; },
      divIcon: function(o){ return o; },
      marker: function(g, o){
        __lcalls.marker++;
        var el = document.createElement('div');
        el.innerHTML = (o && o.icon && o.icon.html) || '';
        return {
          addTo: function(){ return this; },
          on: function(){ return this; },
          getElement: function(){ return el; },
          setZIndexOffset: function(){}
        };
      },
      polyline: function(){ __lcalls.polyline++; return { addTo: function(){ return this; } }; }
    };
  `, ctx);

  check(vm.runInContext('hlMapBackend()', ctx) === 'leaflet', '카카오 없으면 backend=leaflet');

  const llOk = vm.runInContext(`(function(){
    var h = HLMapCreate(document.createElement('div'), {center:[37.5,128.0], zoom:10});
    if(!h || h.backend!=='leaflet') return 'create failed';
    var mk = h.addMarker([37.5,128.0], '<div class="mk fest"><span>x</span></div>', function(){});
    if(!mk) return 'marker missing';
    if(!mk.el || mk.el.className !== 'mk fest') return 'marker el wrong: ' + (mk.el && mk.el.className);
    mk.setZ(1000);
    h.addPolyline([[37.5,128.0],[37.6,128.1]], {});
    h.fitBounds([[37.5,128.0],[37.6,128.1]], 60);
    h.panTo([37.5,128.0]);
    h.relayout();
    h.clear();
    return 'ok';
  })()`, ctx);
  check(llOk === 'ok', 'Leaflet 백엔드 전체 동작', llOk);
  check(lcalls.marker === 1, `L.marker 로 마커 생성 (${lcalls.marker})`);
  check(lcalls.polyline === 1, `L.polyline 로 경로 생성 (${lcalls.polyline})`);
  check(lcalls.fitBounds === 1, `fitBounds 호출 (${lcalls.fitBounds})`);
  check(lcalls.invalidateSize === 1, `invalidateSize 호출 (${lcalls.invalidateSize})`);

  // 두 백엔드가 같은 인터페이스를 노출하는지 (한쪽만 고치는 실수를 막습니다)
  const iface = vm.runInContext(`(function(){
    var need = ['clear','addMarker','addPolyline','fitBounds','setView','panTo','flyTo','panBy','relayout','size'];
    var h = HLMapCreate(document.createElement('div'), {});
    return need.filter(function(k){ return typeof h[k] !== 'function'; });
  })()`, ctx);
  check(iface.length === 0, '두 백엔드가 동일 인터페이스 노출', iface.join(', '));

  // ---------------------------------------------------------------
  // 예약 내역 / 장소 상세 보강
  // ---------------------------------------------------------------
  console.log('');
  check(n('Array.isArray(MY_PICKUPS)') && n('MY_PICKUPS.length') === (d.MY_PICKUPS || []).length,
    `MY_PICKUPS 가 서버 값으로 교체됨 (${n('MY_PICKUPS.length')})`);
  check(n('MY_PICKUPS.every(function(p){return !!p.code;})'), '예약 내역 전 항목에 예약코드 존재');

  check(n('typeof hlRefreshPickups==="function"'), '예약 내역 갱신 함수 존재');
  check(n('typeof hlCancelOrder==="function"'), '예약 취소 함수 존재');
  check(n('typeof hlEnrichPlace==="function"'), '장소 상세 보강 함수 존재');

  // TourAPI 장소를 골라 상세 보강이 실제로 값을 채우는지 확인합니다.
  const tkey = Object.keys(d.PLACES).find((k) => d.PLACES[k].source === 'tourapi');
  if (!tkey) {
    console.log('  SKIP  장소 상세 보강 (TourAPI 항목 없음 - 시드 모드)');
  } else {
    const beforeHours = n(`PLACES[${JSON.stringify(tkey)}].hours || ''`);
    await vm.runInContext(`hlEnrichPlace(${JSON.stringify(tkey)})`, ctx);
    // 완료 표시가 뜰 때까지 기다립니다 (성공 true / 실패 false 둘 다 종료 조건).
    await waitFor(() => n(`PLACES[${JSON.stringify(tkey)}]._detail`) !== 'loading');
    const afterHours = n(`PLACES[${JSON.stringify(tkey)}].hours || ''`);
    const flag = n(`PLACES[${JSON.stringify(tkey)}]._detail`);
    check(flag === true, '상세 보강 완료 표시', String(flag));
    check(afterHours.length > 0 && afterHours !== beforeHours,
      `운영시간이 채워짐 ("${beforeHours}" -> "${afterHours}")`);

    // 두 번째 호출은 캐시되어 네트워크를 타지 않아야 합니다.
    const callsBefore = ctx.__fetchCount || 0;
    await vm.runInContext(`hlEnrichPlace(${JSON.stringify(tkey)})`, ctx);
    await new Promise((r) => setTimeout(r, 250));
    check((ctx.__fetchCount || 0) === callsBefore, '이미 받은 상세는 다시 요청하지 않음');
  }

  // 시드 장소는 TourAPI 를 부르지 않아야 합니다 (contentId 가 없음).
  const skey = Object.keys(d.PLACES).find((k) => d.PLACES[k].source !== 'tourapi');
  if (skey) {
    const c0 = ctx.__fetchCount || 0;
    await vm.runInContext(`hlEnrichPlace(${JSON.stringify(skey)})`, ctx);
    await new Promise((r) => setTimeout(r, 200));
    check((ctx.__fetchCount || 0) === c0, '시드 장소는 상세 요청을 보내지 않음');
  }

  // ---------------------------------------------------------------
  // 후기 작성 (UI 흐름 + 서버 저장)
  // ---------------------------------------------------------------
  console.log('');
  // 후기 시트가 쓰는 요소만 스텁에 제공합니다.
  // 전체 id 에 대해 요소를 돌려주면 다른 렌더 함수들이 `if(!host)return` 가드를
  // 통과해 엉뚱한 경로로 들어가므로, 필요한 것만 화이트리스트로 둡니다.
  const wrIds = ['wr-shop', 'wr-text', 'wr-err', 'wr-stars', 'wr-submit', 'wrscrim', 'wrsheet'];
  const wrEls = {};
  wrIds.forEach((id) => { wrEls[id] = makeElement(id === 'wr-shop' ? 'select' : 'div'); });
  doc.getElementById = (id) => wrEls[id] || null;

  check(n('typeof openWriteReview==="function"'), '후기 작성 시트 열기 함수 존재');
  check(n('typeof submitReview==="function"'), '후기 등록 함수 존재');
  check(n('typeof setWrStars==="function"'), '별점 선택 함수 존재');

  vm.runInContext('openWriteReview()', ctx);
  check((wrEls['wr-shop']._opts || []).length > 0,
    `매장 선택지 채워짐 (${(wrEls['wr-shop']._opts || []).length}개)`);
  check(n('wrStars') === 0, '열 때 별점 초기화');

  // 별점 없이 등록 -> 오류 메시지
  wrEls['wr-shop'].value = '0';
  wrEls['wr-text'].value = '자동 테스트 후기';
  await vm.runInContext('submitReview()', ctx);
  await waitFor(() => !!wrEls['wr-err'].textContent);
  check(/별점/.test(wrEls['wr-err'].textContent || ''), '별점 없으면 등록 거부',
    wrEls['wr-err'].textContent);

  // 내용 없이 등록 -> 오류 메시지
  vm.runInContext('setWrStars(4)', ctx);
  wrEls['wr-text'].value = '   ';
  wrEls['wr-err'].textContent = '';
  await vm.runInContext('submitReview()', ctx);
  await waitFor(() => !!wrEls['wr-err'].textContent);
  check(/내용/.test(wrEls['wr-err'].textContent || ''), '내용 없으면 등록 거부',
    wrEls['wr-err'].textContent);

  // 정상 등록
  const rvBefore = (await fetch(`${BASE}/api/reviews?mine=1`).then((r) => r.json())).count;
  vm.runInContext('setWrStars(5)', ctx);
  wrEls['wr-text'].value = '자동 테스트로 남긴 후기입니다';
  await vm.runInContext('submitReview()', ctx);
  await waitFor(async () => {
    const c = await fetch(`${BASE}/api/reviews?mine=1`).then((r) => r.json());
    return c.count === rvBefore + 1;
  });

  const rvAfter = await fetch(`${BASE}/api/reviews?mine=1`).then((r) => r.json());
  check(rvAfter.count === rvBefore + 1, `서버에 후기 저장됨 (${rvBefore} -> ${rvAfter.count})`);
  const written = rvAfter.reviews.find((r) => r.txt === '자동 테스트로 남긴 후기입니다');
  check(!!written, '작성한 내용이 서버에 그대로 저장됨');
  if (written) {
    check(written.stars === 5, '별점 저장', String(written.stars));
    check(/^\d{4}\.\d{2}\.\d{2}$/.test(written.date), '작성일 형식', written.date);
  }
  check(n('MY_REVIEWS.length') === rvAfter.count, '화면 목록이 서버와 동기화됨',
    `${n('MY_REVIEWS.length')} vs ${rvAfter.count}`);
  check(!wrEls['wr-err'].textContent, '성공 시 오류 메시지 없음', wrEls['wr-err'].textContent);

  // 뒷정리 - 테스트로 만든 후기는 지웁니다.
  if (written) {
    await fetch(`${BASE}/api/reviews/${written.id}`, { method: 'DELETE' });
  }
  doc.getElementById = () => null;

  // ---------------------------------------------------------------
  // 화면 테마 전환
  //
  // CSS 는 라이트/다크를 모두 갖고 있었지만 전환 수단이 없었고,
  // toggleTheme() 은 존재하지 않는 #ttoggle 을 참조해 호출 즉시 죽었습니다.
  // ---------------------------------------------------------------
  console.log('');
  check(n('typeof toggleTheme==="function"'), '테마 전환 함수 존재');
  check(n('typeof initTheme==="function"'), '테마 초기화 함수 존재');

  // 요소가 없어도 예외 없이 넘어가야 합니다 (이전엔 여기서 TypeError).
  let threw = null;
  try { vm.runInContext('toggleTheme()', ctx); } catch (e) { threw = e.message; }
  check(threw === null, '요소가 없어도 예외 없이 동작', threw);

  // phone / ttoggle 을 붙이고 실제 전환을 확인합니다.
  const phoneEl = makeElement('div');
  const ttEl = makeElement('span');
  let themeAttr = 'light';
  phoneEl.setAttribute = (k, v) => { if (k === 'data-theme') themeAttr = v; };
  phoneEl.getAttribute = (k) => (k === 'data-theme' ? themeAttr : '');
  doc.getElementById = (id) => (id === 'phone' ? phoneEl : id === 'ttoggle' ? ttEl : null);

  vm.runInContext('toggleTheme()', ctx);
  check(themeAttr === 'dark', '라이트 -> 다크 전환', themeAttr);
  check(ttEl.textContent === '다크', '라벨 갱신', ttEl.textContent);

  vm.runInContext('toggleTheme()', ctx);
  check(themeAttr === 'light', '다크 -> 라이트 전환', themeAttr);
  check(ttEl.textContent === '라이트', '라벨 갱신(복귀)', ttEl.textContent);

  // 선택이 저장되고 다음 부팅에 복원되는지
  vm.runInContext('toggleTheme()', ctx);          // dark 로
  const storedTheme = ctx.localStorage.getItem('hl-theme');
  check(storedTheme === 'dark', '선택한 테마 저장', String(storedTheme));
  themeAttr = 'light';
  vm.runInContext('initTheme()', ctx);
  check(themeAttr === 'dark', '다음 부팅에 저장된 테마 복원', themeAttr);

  doc.getElementById = () => null;

  // ---------------------------------------------------------------
  // 쿠폰
  // ---------------------------------------------------------------
  console.log('');
  const srvCoupons = (await fetch(`${BASE}/api/coupons`).then((r) => r.json())).coupons || [];
  check(srvCoupons.length > 0, `서버 쿠폰 존재 (${srvCoupons.length}건)`);

  await vm.runInContext('hlRefreshCoupons()', ctx);
  check(n('MY_COUPONS.length') === srvCoupons.length,
    `쿠폰이 서버 값으로 교체됨 (${n('MY_COUPONS.length')})`);

  // 렌더러가 쓰는 필드가 서버 응답에 다 있는지 (하나라도 없으면 화면에 undefined 가 뜹니다)
  const missing = ['pct', 'nm', 'cond', 'exp'].filter((k) => !(k in (srvCoupons[0] || {})));
  check(missing.length === 0, '쿠폰 응답에 렌더 필드가 모두 존재', '누락: ' + missing.join(', '));

  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log(`  전부 통과  (source=${d.source})\n`);
};

main().catch((e) => { console.error(e); process.exit(1); });
