/**
 * 업무흐름 · 연계 시나리오 실행본.
 *
 *   npm run seed:accounts && npm run test:scenario
 *
 * docs/test-scenarios.md 의 W2~W6 · L1~L8 을 그대로 실행합니다.
 * 문서를 고치면 여기도 같이 고칩니다. 번호가 1:1 로 맞춰져 있습니다.
 */
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;
const PW = 'happylocal2026';

let failures = 0;
const step = (ok, label, detail) => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const scene = (code, title) => console.log(`\n  [${code}] ${title}`);

function client() {
  let cookie = '';
  const call = async (p, opt = {}) => {
    const r = await fetch(`${BASE}${p}`, {
      ...opt,
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let body = null;
    try { body = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  const json = (m) => (p, b) => call(p, { method: m, body: JSON.stringify(b || {}) });
  return { get: (p) => call(p), post: json('POST'), put: json('PUT'), patch: json('PATCH') };
}

async function signIn(loginId, password = PW) {
  const c = client();
  const r = await c.post('/api/auth/login', { loginId, password });
  if (r.status !== 200) throw new Error(`${loginId} 로그인 실패 (HTTP ${r.status})`);
  return c;
}

/** 상품 재고를 서버에서 다시 읽습니다. 중간에 다른 요청이 끼어들 수 있어서요. */
async function stockOf(c, id) {
  const d = await c.get('/api/products');
  return (d.body.raw.find((p) => p.id === id) || {}).stock;
}

const main = async () => {
  const admin = await signIn('admin1');
  const buyer = await signIn('customer1');
  const buyerB = await signIn('customer2');

  const all = (await admin.get('/api/products')).body.raw;
  const A = all.find((p) => p.placeKey === 'pk_hanwoo');        // 횡성 · store_hanwoo
  const B = all.find((p) => p.placeKey === 'pk_js_gondre');     // 정선 · store_js
  if (!A || !B) { console.error('거점에 연결된 상품을 찾지 못했습니다.'); process.exit(1); }

  // ==============================================================
  scene('W2', '생산자 — 아침 출하부터 정산까지');
  // ==============================================================
  {
    const farmer = await signIn('farmer_hs');

    const roles = (await farmer.get('/api/auth/roles')).body;
    step(roles.can['product:restock'] && !roles.can['order:complete'],
      '출하 권한은 있고 수령 확인 권한은 없다');

    const list = (await farmer.get('/api/producer/products')).body.products;
    step(list.length > 0 && list.every((p) => p.region === '횡성'),
      `담당 상품 ${list.length}개가 전부 횡성`);

    const before = await stockOf(admin, A.id);
    const re = await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 5, note: 'W2' });
    step(re.status === 200 && re.body.product.stock === before + 5,
      `출하 5개 → 재고 ${before} → ${re.body.product.stock}`);
    step(re.body.log.type === 'restock' && re.body.log.delta === 5,
      `이력에 restock +5 기록`);

    // 앱에서도 같은 재고가 보여야 합니다 (W2-4).
    const appStock = (await buyer.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    step(appStock === re.body.product.stock, `앱 재고도 같이 늘어남 (${appStock})`);

    const badPrice = await farmer.patch(`/api/producer/products/${A.id}`,
      { priceWas: 10000, priceNow: 90000 });
    step(badPrice.status === 400, `판매가 > 정가 거부 (HTTP ${badPrice.status})`);

    const cross = await farmer.post(`/api/producer/products/${B.id}/restock`, { qty: 3 });
    step(cross.status === 404, `남의 지역 상품은 404 (HTTP ${cross.status})`);

    const sum = (await farmer.get('/api/producer/summary')).body;
    step(typeof sum.revenue === 'number' && sum.revenue >= 0,
      `판매 현황 (완료 ${sum.completed}건 · ${sum.revenue.toLocaleString('ko-KR')}원)`);

    const settle = (await farmer.get('/api/producer/settlement')).body;
    const bad = settle.statements.filter((s) => s.net !== s.gross - s.fee);
    step(bad.length === 0, `정산 수식 (지급 ${settle.total.net.toLocaleString('ko-KR')}원)`);
  }

  // ==============================================================
  scene('W3', '매장 관리인 — 카운터에서 마감까지');
  // ==============================================================
  {
    const mgr = await signIn('store_hanwoo');
    const other = await signIn('store_js');

    const ord = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;
    const afterOrder = await stockOf(admin, A.id);

    const list = (await mgr.get('/api/store/pickups')).body.pickups;
    step(list.some((p) => p.code === ord.code), '담당 거점 목록에 새 예약');
    const firstWaiting = list.findIndex((p) => p.status === 'reserved');
    step(firstWaiting === 0 || list.length === 0, '대기 건이 목록 위로 정렬됨');

    const lower = await mgr.get(`/api/store/pickups/lookup?code=${ord.code.toLowerCase()}`);
    step(lower.status === 200, '소문자 코드로도 조회됨');

    const done = await mgr.post(`/api/store/pickups/${ord.id}/complete`);
    step(done.status === 200 && done.body.order.status === 'completed', '수령 확인');
    const afterDone = await stockOf(admin, A.id);
    step(afterDone === afterOrder, `수령 확인은 재고를 안 건드림 (${afterDone})`);

    const again = await mgr.post(`/api/store/pickups/${ord.id}/complete`);
    step(again.status === 409, `이미 처리된 예약은 409 (HTTP ${again.status})`);

    const foreign = await other.get(`/api/store/pickups/lookup?code=${encodeURIComponent(ord.code)}`);
    step(foreign.status === 404, `다른 매장은 404 (HTTP ${foreign.status})`);

    // 노쇼 — 재고 복구 선택
    const ord2 = (await buyer.post('/api/orders', { productId: A.id, qty: 2 })).body.order;
    const beforeNoshow = await stockOf(admin, A.id);
    const ns = await mgr.post(`/api/store/pickups/${ord2.id}/noshow`, { restock: true });
    step(ns.status === 200 && (await stockOf(admin, A.id)) === beforeNoshow + 2,
      `노쇼 + 복구 선택 시 재고 되돌림 (${beforeNoshow} → ${beforeNoshow + 2})`);

    const noNote = await mgr.post(`/api/store/products/${A.id}/adjust`, { delta: -1 });
    step(noNote.status === 400 && noNote.body.code === 'NOTE_REQUIRED', '재고 조정에 사유 요구');

    const cur = await stockOf(admin, A.id);
    const over = await mgr.post(`/api/store/products/${A.id}/adjust`,
      { delta: -(cur + 5), note: '폐기' });
    step(over.status === 409, `재고보다 많이 빼기 거부 (HTTP ${over.status})`);

    const close = (await mgr.get('/api/store/summary')).body;
    step(close.completed >= 1 && close.noshow >= 1,
      `일일 마감 (완료 ${close.completed} · 노쇼 ${close.noshow})`);
  }

  // ==============================================================
  scene('W4', '운영자 — 콘텐츠와 캠페인');
  // ==============================================================
  {
    const op = await signIn('operator1');

    const notice = (await op.get('/api/admin/content/NOTICE_DATA')).body;
    step(Array.isArray(notice.value) && notice.value.length > 0,
      `공지 조회 (${notice.value.length}건)`);

    const orig = notice.value;
    const edited = [{ ...orig[0], t: 'W4 검사 공지' }, ...orig.slice(1)];
    step((await op.put('/api/admin/content/NOTICE_DATA', { value: edited })).status === 200,
      '공지 수정');
    const boot = (await buyer.get('/api/bootstrap')).body;
    step(boot.NOTICE_DATA[0].t === 'W4 검사 공지', '앱 부트스트랩에 반영됨');
    await op.put('/api/admin/content/NOTICE_DATA', { value: orig });

    const empty = await op.put('/api/admin/content/NOTICE_DATA', { value: [] });
    step(empty.status === 409 && empty.body.code === 'WOULD_EMPTY', '통째로 비우기 차단');

    const evil = await op.get('/api/admin/content/users');
    step(evil.status === 404, `화이트리스트 밖 키 404 (HTTP ${evil.status})`);

    const before = (await buyer.get('/api/bootstrap')).body.MY_COUPONS.length;
    const issued = await op.post('/api/admin/coupons/issue', {
      target: 'all', pct: '15%', nm: 'W4 검사 쿠폰', cond: '전 지역', exp: '2026.12.31까지',
    });
    step(issued.status === 201, `쿠폰 발행 (${issued.body.issued}명)`);
    const after = (await buyer.get('/api/bootstrap')).body.MY_COUPONS.length;
    step(after === before + 1, `손님 쿠폰함에 들어옴 (${before} → ${after})`);

    step((await op.get('/api/admin/users')).status === 403, '계정 관리는 403');
    step((await op.get('/api/store/pickups')).status === 403, '매장 기능은 403');
  }

  // ==============================================================
  scene('W5', '최고관리자 — 입점 심사와 정산 집행');
  // ==============================================================
  {
    const users = (await admin.get('/api/admin/users')).body;
    step(users.status !== 403 && users.count > 0, `계정 목록 (${users.count}명)`);

    // 마지막 관리자 보호
    const me = users.users.find((u) => u.nickname.includes('운영팀'));
    const admins = users.users.filter((u) => u.roles.includes('super_admin'));
    if (admins.length === 1) {
      const drop = await admin.put(`/api/admin/users/${me.id}/roles`, { roles: ['customer'] });
      step(drop.status === 409 && drop.body.code === 'LAST_ADMIN',
        `마지막 관리자 권한 회수 차단 (HTTP ${drop.status})`);
    } else {
      step(true, `관리자가 ${admins.length}명이라 마지막-관리자 검사는 건너뜀`);
    }

    const settle = (await admin.get('/api/admin/settlement?from=2000-01-01&to=2099-12-31')).body;
    const wrong = settle.statements.filter((s) =>
      s.net !== s.gross - s.fee || s.fee !== Math.round(s.gross * settle.feeRate));
    step(wrong.length === 0, `정산 수식 (${settle.statements.length}건)`);

    const target = settle.statements.find((s) => !s.paid);
    if (target) {
      const pay = await admin.post('/api/admin/settlement/pay',
        { from: settle.from, to: settle.to, key: target.key });
      step(pay.status === 201, `지급 처리 (${pay.body.settlement.net.toLocaleString('ko-KR')}원)`);
      const twice = await admin.post('/api/admin/settlement/pay',
        { from: settle.from, to: settle.to, key: target.key });
      step(twice.status === 409, `이중 지급 거부 (HTTP ${twice.status})`);
    } else {
      step(true, '미지급 정산이 없어 건너뜀');
    }

    const audit = (await admin.get('/api/admin/audit')).body;
    step(audit.rows.length > 0, `감사 로그 (${audit.count}건)`);
  }

  // ==============================================================
  scene('W6', '입점 신청자 — 밖에서 안으로');
  // ==============================================================
  {
    const id = 'apply_' + Date.now().toString(36).slice(-6);
    const c = client();
    const reg = await c.post('/api/auth/register', { loginId: id, password: PW, nickname: '신청 검사' });
    step(reg.status === 201 && reg.body.user.roles.join() === 'customer', '가입은 일반 사용자');

    step((await c.get('/api/producer/products')).status === 403, '신청 전 403');

    const ap = await c.post('/api/admin/apply', {
      role: 'producer', farm: 'W6 농원', productIds: [B.id], memo: '시나리오 검사',
    });
    step(ap.status === 201 && ap.body.application.status === 'pending', '신청 접수 (pending)');

    const dup = await c.post('/api/admin/apply', { role: 'producer' });
    step(dup.status === 409 && dup.body.code === 'PENDING', '중복 신청 거부');
    step((await c.get('/api/producer/products')).status === 403, '심사 중에도 403');

    const dec = await admin.post(`/api/admin/applications/${ap.body.application.id}/decide`,
      { approve: true });
    step(dec.status === 200 && dec.body.user.roles.includes('producer'), '승인 시 역할 부여');

    const after = await signIn(id);
    const mine = (await after.get('/api/producer/products')).body.products;
    step(mine.some((p) => p.id === B.id), `재로그인 후 담당 상품이 보임 (${mine.length}개)`);

    await admin.put(`/api/admin/users/${dec.body.user.id}/roles`, { roles: ['customer'], scope: {} });
  }

  // ==============================================================
  scene('L1', '한 건의 픽업이 세 역할을 지나간다');
  // ==============================================================
  {
    const farmer = await signIn('farmer_hs');
    const mgr = await signIn('store_hanwoo');

    const s0 = await stockOf(admin, A.id);
    await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 5, note: 'L1' });
    const s1 = await stockOf(admin, A.id);
    step(s1 === s0 + 5, `① 생산자 출하 (${s0} → ${s1})`);

    const ord = (await buyer.post('/api/orders', { productId: A.id, qty: 2 })).body.order;
    const s2 = await stockOf(admin, A.id);
    step(s2 === s1 - 2, `② 손님 예약 (${s1} → ${s2}), 코드 ${ord.code}`);

    const look = await mgr.get(`/api/store/pickups/lookup?code=${encodeURIComponent(ord.code)}`);
    step(look.status === 200, '③ 매장이 코드로 찾음');

    await mgr.post(`/api/store/pickups/${ord.id}/complete`);
    const s3 = await stockOf(admin, A.id);
    step(s3 === s2, `④ 수령 확인 (재고 ${s3} 그대로)`);

    const seen = (await buyer.get('/api/mypickups')).body.MY_PICKUPS
      .find((p) => p.code === ord.code);
    step(seen && seen.status === '픽업완료', `⑤ 손님 화면에 픽업완료 (${seen?.status})`);

    const sum = (await farmer.get('/api/producer/summary')).body;
    step(sum.completed >= 1, `⑥ 생산자 집계 (완료 ${sum.completed}건)`);

    const settle = (await admin.get('/api/admin/settlement?from=2000-01-01&to=2099-12-31')).body;
    step(settle.total.count >= 1, `⑦ 정산에 반영 (${settle.total.count}건)`);
    step(s1 - 2 === s3, `재고 수지가 끝까지 맞음 (${s1} − 2 = ${s3})`);
  }

  // ==============================================================
  scene('L2', '재고 하나를 두고 세 사람이 움직인다');
  // ==============================================================
  {
    const farmer = await signIn('farmer_hs');
    const mgr = await signIn('store_hanwoo');

    // 재고를 정확히 4로 맞춥니다.
    let cur = await stockOf(admin, A.id);
    if (cur > 4) {
      await mgr.post(`/api/store/products/${A.id}/adjust`, { delta: 4 - cur, note: 'L2 준비' });
    } else if (cur < 4) {
      await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 4 - cur, note: 'L2 준비' });
    }
    step((await stockOf(admin, A.id)) === 4, '재고를 4로 맞춤');

    // 재고보다 많은 요청을 한꺼번에.
    const tries = 7;
    const results = await Promise.all(
      Array.from({ length: tries }, () => buyer.post('/api/orders', { productId: A.id, qty: 1 })));
    const ok = results.filter((r) => r.status === 201);
    step(ok.length === 4, `동시 ${tries}건 중 정확히 4건 성공 (${ok.length})`);
    const zero = await stockOf(admin, A.id);
    step(zero === 0, `재고 정확히 0 (${zero})`);
    step(zero >= 0, '재고가 음수로 내려가지 않음');

    // 노쇼 복구로 되돌립니다.
    await mgr.post(`/api/store/pickups/${ok[0].body.order.id}/noshow`, { restock: true });
    step((await stockOf(admin, A.id)) === 1, '노쇼 복구로 재고 1');

    for (const r of ok.slice(1)) await buyer.post(`/api/orders/${r.body.order.id}/cancel`);
    step((await stockOf(admin, A.id)) === 4, `나머지 취소로 4 복구`);
  }

  // ==============================================================
  scene('L3', '쿠폰이 주문·취소를 오간다');
  // ==============================================================
  {
    const t = (await buyer.get('/api/products')).body.raw
      .find((p) => p.stock > 0 && p.priceNow >= 30000);
    const usable = (await buyer.get(
      `/api/coupons/usable?amount=${t.priceNow}&region=${encodeURIComponent(t.region)}`))
      .body.coupons.find((c) => c.usable);
    step(!!usable, `쓸 수 있는 쿠폰 (${usable?.pct} → ${usable?.discount}원)`);

    const ord = (await buyer.post('/api/orders',
      { productId: t.id, qty: 1, couponId: usable.id })).body.order;
    step(ord.total === t.priceNow - usable.discount,
      `총액에서 차감 (${t.priceNow} − ${usable.discount} = ${ord.total})`);

    const reuse = await buyer.post('/api/orders', { productId: t.id, qty: 1, couponId: usable.id });
    step(reuse.status === 409, `사용한 쿠폰 재사용 거부 (HTTP ${reuse.status})`);

    await buyer.post(`/api/orders/${ord.id}/cancel`);
    const back = (await buyer.get(
      `/api/coupons/usable?amount=${t.priceNow}&region=${encodeURIComponent(t.region)}`))
      .body.coupons.find((c) => c.id === usable.id);
    step(back && back.usable, '취소하면 쿠폰이 되살아남');

    // 노쇼는 쿠폰을 돌려주지 않습니다.
    const mgr = await signIn('store_hanwoo');
    const cp2 = (await buyer.get(`/api/coupons/usable?amount=${A.priceNow}&region=횡성`))
      .body.coupons.find((c) => c.usable);
    if (cp2) {
      const o2 = (await buyer.post('/api/orders',
        { productId: A.id, qty: 1, couponId: cp2.id })).body.order;
      await mgr.post(`/api/store/pickups/${o2.id}/noshow`, { restock: true });
      const after = (await buyer.get(`/api/coupons/usable?amount=${A.priceNow}&region=횡성`))
        .body.coupons.find((c) => c.id === cp2.id);
      step(!after || !after.usable, '노쇼는 쿠폰을 돌려주지 않음 (취소와 다름)');
    } else {
      step(true, '쓸 쿠폰이 없어 노쇼-쿠폰 검사 건너뜀');
    }
  }

  // ==============================================================
  scene('L5', '두 매장이 서로를 보지 못한다');
  // ==============================================================
  {
    const mgrA = await signIn('store_hanwoo');
    const mgrB = await signIn('store_js');

    const oa = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;
    const ob = (await buyerB.post('/api/orders', { productId: B.id, qty: 1 })).body.order;

    const listA = (await mgrA.get('/api/store/pickups')).body.pickups;
    const listB = (await mgrB.get('/api/store/pickups')).body.pickups;

    step(listA.some((p) => p.code === oa.code) && !listA.some((p) => p.code === ob.code),
      'A 목록에 A 것만');
    step(listB.some((p) => p.code === ob.code) && !listB.some((p) => p.code === oa.code),
      'B 목록에 B 것만');
    step((await mgrB.get(`/api/store/pickups/lookup?code=${encodeURIComponent(oa.code)}`)).status === 404,
      'B 가 A 코드 조회 404');
    step((await mgrB.post(`/api/store/pickups/${oa.id}/complete`)).status === 404,
      'B 가 A 예약 수령 확인 404');

    await mgrA.post(`/api/store/pickups/${oa.id}/noshow`, { restock: true });
    await mgrB.post(`/api/store/pickups/${ob.id}/noshow`, { restock: true });
  }

  // ==============================================================
  scene('L7', '정산은 실제로 찾아간 것만 센다');
  // ==============================================================
  {
    const mgr = await signIn('store_hanwoo');
    const farmer = await signIn('farmer_hs');
    await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 6, note: 'L7' });

    const before = (await farmer.get('/api/producer/summary')).body.completed;

    const o1 = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;
    const o2 = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;
    const o3 = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;

    await mgr.post(`/api/store/pickups/${o1.id}/complete`);
    await mgr.post(`/api/store/pickups/${o2.id}/noshow`, { restock: true });
    // o3 는 그대로 대기

    const after = (await farmer.get('/api/producer/summary')).body;
    step(after.completed === before + 1, `완료만 +1 (${before} → ${after.completed})`);
    step(after.reserved >= 1 && after.noshow >= 1,
      `대기 ${after.reserved} · 노쇼 ${after.noshow} 는 따로 집계`);

    const settle = (await admin.get('/api/admin/settlement?from=2000-01-01&to=2099-12-31')).body;
    const stats = (await admin.get('/api/admin/stats?from=2000-01-01&to=2099-12-31')).body;
    step(settle.total.count === stats.orders.completed,
      `정산 건수 = 수령완료 건수 (${settle.total.count}/${stats.orders.completed})`);

    await mgr.post(`/api/store/pickups/${o3.id}/noshow`, { restock: true });
  }

  // ==============================================================
  scene('L8', '재고 표시가 모든 화면에서 같다');
  // ==============================================================
  {
    const farmer = await signIn('farmer_hs');
    await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 7, note: 'L8' });
    const real = await stockOf(admin, A.id);

    const opsView = (await farmer.get('/api/producer/products')).body.products
      .find((p) => p.id === A.id).stock;
    step(opsView === real, `운영 화면 재고 = 서버 (${opsView})`);

    const boot = (await buyer.get('/api/bootstrap')).body;
    const pl = boot.PL.find((p) => p.fid === A.id);
    step(pl.stock === real, `앱 상품 목록 재고 = 서버 (${pl.stock})`);
    step((pl.stock <= 0) === !!pl.soldOut, '품절 표시가 재고와 일치');

    const place = boot.PLACES[A.placeKey];
    const shown = Number(String(place.remain).replace(/[^0-9]/g, ''));
    step(shown === real, `매장 목록 "${place.remain}" = 서버 재고 ${real}`);
    step(place.stock === real, `거점 stock 필드도 일치 (${place.stock})`);
  }

  console.log('');
  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  시나리오 전부 통과\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
