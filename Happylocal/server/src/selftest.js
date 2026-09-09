/**
 * 부트스트랩 응답의 정합성 검사.
 *
 *   node src/selftest.js            # 서버가 떠 있어야 합니다
 *   PORT=8787 node src/selftest.js
 *
 * 왜 필요한가:
 * 프론트의 코스 생성기는 POOL 의 키로 PLACES[k].type 을 바로 읽습니다.
 * POOL 이 참조하는 키가 PLACES 에 없으면 그 자리에서 TypeError 로 앱 전체가
 * 멈춥니다. TourAPI 응답이 지역별로 비거나 좌표 없는 항목이 섞이면 실제로
 * 일어날 수 있는 일이라, 매 배포 전에 자동으로 확인합니다.
 */
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

const main = async () => {
  const me = await loginForTests(BASE, '검사 계정');
  console.log(`
  로그인: ${me.nickname}`);

  let d;
  try {
    const r = await fetch(`${BASE}/api/bootstrap`);
    d = await r.json();
  } catch (e) {
    console.error(`서버에 연결할 수 없습니다 (${BASE}). 먼저 \`npm start\` 를 실행하세요.`);
    process.exit(1);
  }

  console.log(`\n  bootstrap source = ${d.source}`);
  if (d.warnings?.length) d.warnings.forEach((w) => console.log(`  ! ${w}`));
  console.log('');

  // --- 1. 필수 컬렉션이 비어 있지 않은가 ---
  for (const k of ['PLACES', 'GEO', 'PL', 'STORES', 'MAP_PDAY', 'POOL']) {
    const v = d[k];
    const n = Array.isArray(v) ? v.length : Object.keys(v || {}).length;
    check(n > 0, `${k} 비어있지 않음 (${n})`);
  }

  // --- 2. POOL 이 참조하는 모든 키가 PLACES 에 존재하는가 (코스 생성기 크래시 방지) ---
  const missingInPlaces = [];
  for (const [region, P] of Object.entries(d.POOL || {})) {
    for (const key of [P.ic, ...(P.pk || []), ...(P.tour || []), ...(P.food || [])]) {
      if (!key) continue;
      if (!d.PLACES[key]) missingInPlaces.push(`${region}: ${key}`);
    }
    check((P.pk || []).length > 0, `POOL[${region}].pk 비어있지 않음`);
    check((P.tour || []).length > 0, `POOL[${region}].tour 비어있지 않음`);
    check((P.food || []).length > 0, `POOL[${region}].food 비어있지 않음`);
  }
  check(missingInPlaces.length === 0, 'POOL 의 모든 키가 PLACES 에 존재',
    missingInPlaces.slice(0, 8).join(', '));

  // --- 3. 지도에 찍히는 항목은 좌표가 있어야 한다 ---
  const noGeo = Object.keys(d.PLACES).filter((k) => {
    const g = d.GEO[k];
    return !Array.isArray(g) || g.length !== 2 || !Number.isFinite(g[0]) || !Number.isFinite(g[1]);
  });
  check(noGeo.length === 0, 'PLACES 전 항목에 유효한 GEO 좌표 존재',
    `좌표 없음: ${noGeo.slice(0, 8).join(', ')}`);

  // --- 4. 좌표가 강원도 범위 안인가 (시군구 코드 오설정 조기 발견) ---
  // 축제는 강원 전역에서 오므로 도 전체를 덮는 상자를 씁니다.
  // (127.3 으로 잡았더니 철원(127.27)이 범위 밖으로 걸렸습니다.)
  const outOfRange = Object.entries(d.GEO).filter(([, g]) =>
    !(g[0] > 36.9 && g[0] < 38.7 && g[1] > 127.0 && g[1] < 129.5));
  check(outOfRange.length === 0, '좌표가 강원권 범위 내',
    `범위 밖: ${outOfRange.slice(0, 5).map(([k, g]) => `${k}(${g})`).join(', ')}`);

  // --- 5. STORES 의 키가 PLACES/GEO 에 있는가 (지도 마커가 사라지는 원인) ---
  const storeNoGeo = d.STORES.filter((s) => !d.GEO[s.key]);
  check(storeNoGeo.length === 0, 'STORES 전 항목에 GEO 좌표 존재',
    storeNoGeo.slice(0, 8).map((s) => s.key).join(', '));

  // --- 6. 상품 가격/재고 정합성 ---
  const badPrice = d.PL.filter((p) => !p.was || !p.now);
  check(badPrice.length === 0, 'PL 전 항목에 가격 존재', badPrice.slice(0, 5).map((p) => p.prod).join(', '));

  // --- 7. 주문 API 왕복 (재고 차감 -> 복구) ---
  const target = d.PL.find((p) => p.stock > 0);
  if (target) {
    const before = target.stock;
    const created = await fetch(`${BASE}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: target.fid, qty: 1 }),
    }).then((r) => r.json());

    check(created?.order?.code?.startsWith('HL-'), '주문 생성 및 예약코드 발급');
    check(created?.product?.stock === before - 1, `재고 차감 (${before} -> ${before - 1})`,
      `실제: ${created?.product?.stock}`);

    const cancelled = await fetch(`${BASE}/api/orders/${created.order.id}/cancel`, { method: 'POST' })
      .then((r) => r.json());
    check(cancelled?.product?.stock === before, `취소 시 재고 복구 (-> ${before})`,
      `실제: ${cancelled?.product?.stock}`);
  } else {
    check(false, '재고가 있는 상품이 하나 이상 존재');
  }

  console.log('');
  // ---------------------------------------------------------------
  // 서비스키 유출 검사
  //
  // 공모전 공식 강의가 가장 강조한 지점입니다: 서비스키가 브라우저로 새면
  // 개발자도구에서 그대로 보이고, 탈취당하면 한도 소진·계정 정지로 이어집니다.
  // 리팩터링 중에 실수로 키를 응답에 실어보내는 일이 없도록 고정해 둡니다.
  // ---------------------------------------------------------------
  console.log('');
  const envPath = new URL('../.env', import.meta.url);
  let tourKey = '';
  try {
    const env = (await import('node:fs')).readFileSync(envPath, 'utf8');
    // \s 는 개행도 먹어서, 키가 비어 있으면 다음 줄(주석)을 키로 잡습니다.
    // 그러면 검사가 의미 없이 통과하므로 같은 줄로 한정합니다.
    tourKey = (/^TOUR_API_KEY[ 	]*=[ 	]*(\S.*)$/m.exec(env) || [])[1]?.trim() || '';
  } catch { /* .env 없음 */ }

  if (!tourKey) {
    console.log('  SKIP  서비스키 유출 검사 (.env 에 TOUR_API_KEY 가 비어 있음)');
  } else {
    const endpoints = [
      '/api/bootstrap', '/api/health', '/api/tour/status', '/api/products',
      '/api/stores', '/api/orders', '/api/tour/places?region=%ED%9A%A1%EC%84%B1&type=tour',
      '/happylocal_v2.html',
    ];
    const leaked = [];
    for (const ep of endpoints) {
      try {
        const body = await fetch(`${BASE}${ep}`).then((r) => r.text());
        if (body.includes(tourKey)) leaked.push(ep);
      } catch { /* 무시 */ }
    }
    check(leaked.length === 0,
      `서비스키가 응답에 노출되지 않음 (${endpoints.length}개 경로 검사)`,
      '유출: ' + leaked.join(', '));
  }

  // ---------------------------------------------------------------
  // 예약 내역이 서버에 남는가 (새로고침 후에도 보이는가)
  //
  // 이전에는 결제 시 프론트 배열에만 밀어넣어서, 새로고침하면 주문이
  // 사라진 것처럼 보였습니다. 서버가 정본이 되도록 고친 뒤의 회귀 방지입니다.
  // ---------------------------------------------------------------
  console.log('');
  const before = (await fetch(`${BASE}/api/bootstrap`).then((r) => r.json())).MY_PICKUPS || [];
  const buyTarget = d.PL.find((p) => p.stock > 0);

  const placed = await fetch(`${BASE}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: buyTarget.fid, qty: 1 }),
  }).then((r) => r.json());

  // "새로고침" = 부트스트랩 재요청
  const afterBoot = (await fetch(`${BASE}/api/bootstrap`).then((r) => r.json())).MY_PICKUPS || [];
  check(afterBoot.length === before.length + 1,
    `주문 후 부트스트랩 예약 내역 증가 (${before.length} -> ${afterBoot.length})`);
  const mine = afterBoot.find((p) => p.code === placed.order.code);
  check(!!mine, '새로고침해도 방금 만든 예약이 보임', `code ${placed.order.code} 없음`);

  if (mine) {
    check(mine.prod === placed.order.productName, '상품명 일치', mine.prod);
    check(typeof mine.disc === 'number' && mine.disc > 0, `할인율 계산됨 (${mine.disc}%)`);
    check(mine.status === '결제완료', '상태 표기', mine.status);
    check(!!mine.orderId, '취소에 필요한 orderId 포함');
  }

  // /api/mypickups 는 부트스트랩과 같은 내용을 줘야 합니다 (결제 후 갱신 경로).
  const light = (await fetch(`${BASE}/api/mypickups`).then((r) => r.json())).MY_PICKUPS || [];
  check(light.length === afterBoot.length, '/api/mypickups 가 부트스트랩과 일치',
    `${light.length} vs ${afterBoot.length}`);

  // 취소하면 목록에서 빠져야 합니다.
  await fetch(`${BASE}/api/orders/${placed.order.id}/cancel`, { method: 'POST' });
  const afterCancel = (await fetch(`${BASE}/api/mypickups`).then((r) => r.json())).MY_PICKUPS || [];
  check(afterCancel.length === before.length,
    `취소 후 목록에서 제거 (${afterCancel.length} == ${before.length})`);
  check(!afterCancel.find((p) => p.code === placed.order.code), '취소된 예약은 안 보임');

  // ---------------------------------------------------------------
  // 제철 캘린더가 실제 상품과 맞물리는가
  //
  // 캘린더에만 있고 주문할 수 없는 "유령 상품" 이 생기지 않도록,
  // 그리고 캘린더에 뜬 가격이 주문 화면 가격과 어긋나지 않도록 확인합니다.
  // ---------------------------------------------------------------
  console.log('');
  const calMonths = Object.keys(d.cal || {});
  check(calMonths.length > 0, `제철 캘린더 월 수 (${calMonths.length})`);

  const calItems = calMonths.flatMap((m) => d.cal[m]);
  const notLive = calItems.filter((it) => !it.live);
  check(notLive.length === 0,
    `캘린더 전 항목이 실제 상품과 연결 (${calItems.length}건)`,
    '미연결: ' + notLive.slice(0, 5).map((i) => i.prod).join(', '));

  const noPid = calItems.filter((it) => !it.productId);
  check(noPid.length === 0, '캘린더 전 항목에 productId 존재',
    noPid.slice(0, 5).map((i) => i.prod).join(', '));

  // 캘린더 가격 == 상품 목록 가격
  const priceMismatch = [];
  for (const it of calItems) {
    const pl = d.PL.find((p) => p.fid === it.productId);
    if (!pl) continue;
    const plNow = Number(String(pl.now).replace(/[^0-9]/g, ''));
    if (plNow !== it.nowN) priceMismatch.push(`${it.prod}: 캘린더 ${it.nowN} vs 목록 ${plNow}`);
  }
  check(priceMismatch.length === 0, '캘린더 가격이 상품 목록과 일치',
    priceMismatch.slice(0, 3).join(' | '));

  // 재고 0 인 항목을 "오늘 픽업" 으로 표시하면 안 됩니다.
  const badStatus = calItems.filter((it) => it.stock === 0 && /오늘 픽업/.test(it.status || ''));
  check(badStatus.length === 0, '품절 항목을 픽업 가능으로 표시하지 않음',
    badStatus.slice(0, 3).map((i) => i.prod).join(', '));

  // 캘린더에서 고른 상품이 실제로 주문되는가
  const orderable = calItems.find((it) => it.productId && it.stock > 0);
  if (orderable) {
    const r = await fetch(`${BASE}/api/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: orderable.productId, qty: 1 }),
    }).then((x) => x.json());
    check(!!r.order, `캘린더 상품 주문 가능 (${orderable.prod})`, JSON.stringify(r).slice(0, 80));
    if (r.order) await fetch(`${BASE}/api/orders/${r.order.id}/cancel`, { method: 'POST' });
  } else {
    check(false, '주문 가능한 캘린더 항목이 존재');
  }

  if (failures) {
    console.log(`  ${failures}건 실패\n`);
    process.exit(1);
  }
  console.log('  전부 통과\n');
};

main();
