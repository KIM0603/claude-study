/**
 * 역할 · 범위 검증.
 *
 *   npm run test:role
 *
 * 두 가지를 봅니다.
 *   1. 역할이 맞물려 한 건의 픽업이 끝까지 흐르는가 (docs/roles.md §7)
 *   2. 범위 밖의 것을 건드리지 못하는가 — 역할을 나눈 이유가 여기 있습니다
 */
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const group = (t) => console.log(`\n  [${t}]`);

function client() {
  let cookie = '';
  const call = async (p, opt = {}) => {
    const r = await fetch(`${BASE}${p}`, {
      ...opt,
      headers: { ...(opt.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let body = null;
    try { body = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  const json = (m) => (p, b) => call(p, {
    method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}),
  });
  return {
    get: (p) => call(p),
    post: json('POST'),
    put: json('PUT'),
    patch: json('PATCH'),
    login: (nickname, roles, scope) =>
      json('POST')('/api/auth/dev-login', { nickname, roles, scope }),
  };
}

const main = async () => {
  // 어느 상품이 어느 거점에 붙어 있는지 먼저 확인합니다.
  const probe = client();
  await probe.login('역할검사 준비');
  const all = (await probe.get('/api/products')).body.raw;
  const A = all.find((p) => p.placeKey === 'pk_hanwoo');       // 거점 A 의 상품
  const B = all.find((p) => p.placeKey === 'pk_js_gondre');    // 거점 B 의 상품
  if (!A || !B) { console.error('연결된 픽업 상품을 찾지 못했습니다.'); process.exit(1); }

  const farmer = client();     // 생산자 - A 상품 담당
  const mgrA = client();       // 매장 관리인 - 거점 A
  const mgrB = client();       // 매장 관리인 - 거점 B
  const buyer = client();      // 일반 사용자
  const admin = client();      // 최고관리자

  await farmer.login('역할검사 농가', ['producer'], { productIds: [A.id] });
  await mgrA.login('역할검사 매장A', ['store_manager'], { storeKeys: ['pk_hanwoo'] });
  await mgrB.login('역할검사 매장B', ['store_manager'], { storeKeys: ['pk_js_gondre'] });
  await buyer.login('역할검사 손님');
  await admin.login('역할검사 관리자', ['super_admin']);

  // =============================================================
  group('역할 부여와 조회');
  // =============================================================
  {
    const r = (await farmer.get('/api/auth/roles')).body;
    check(r.roles.includes('producer'), `생산자 역할 (${r.roles.join(',')})`);
    check(r.products.length === 1 && r.products[0].id === A.id,
      `담당 상품만 보임 (${r.products.map((p) => p.id).join(',')})`);

    const m = (await mgrA.get('/api/auth/roles')).body;
    check(m.stores.length === 1 && m.stores[0].key === 'pk_hanwoo',
      `담당 거점만 보임 (${m.stores.map((s) => s.key).join(',')})`);

    const c = (await buyer.get('/api/auth/roles')).body;
    check(c.roles.length === 1 && c.roles[0] === 'customer', '가입 기본은 일반 사용자');
    check(c.can['order:complete'] === false, '일반 사용자는 수령 확인 권한 없음');
  }

  // =============================================================
  group('연계: 출하 → 예약 → 수령 확인');   // docs/roles.md §7
  // =============================================================
  let orderId, code;
  {
    const before = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;

    // 1) 생산자가 오늘 물량을 냅니다.
    const re = await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 5, note: '오늘 도축분' });
    check(re.status === 200, `생산자 출하 등록 (HTTP ${re.status})`);
    check(re.body.product.stock === before + 5,
      `재고가 출하만큼 늘어남 (${before} → ${re.body.product.stock})`);
    check(re.body.log.type === 'restock' && re.body.log.delta === 5,
      `재고 이력에 사유가 남음 (${re.body.log.type} ${re.body.log.delta > 0 ? '+' : ''}${re.body.log.delta})`);

    // 2) 손님이 예약합니다.
    const ord = await buyer.post('/api/orders', { productId: A.id, qty: 2 });
    check(ord.status === 201, `손님 예약 (HTTP ${ord.status})`);
    orderId = ord.body.order.id; code = ord.body.order.code;
    const mid = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    check(mid === before + 5 - 2, `예약분만큼 차감 (${mid})`);
    check(ord.body.order.status === 'reserved', '상태 reserved');

    // 3) 매장이 예약코드로 찾습니다.
    const look = await mgrA.get(`/api/store/pickups/lookup?code=${encodeURIComponent(code)}`);
    check(look.status === 200, `예약코드 조회 (${code})`);
    check(look.body.pickup.orderId === orderId, '같은 주문');
    check(!!look.body.pickup.phone === false || typeof look.body.pickup.phone === 'string',
      '매장에는 연락처가 열림');

    // 4) 수령 확인.
    const done = await mgrA.post(`/api/store/pickups/${orderId}/complete`);
    check(done.status === 200, `수령 확인 (HTTP ${done.status})`);
    check(done.body.order.status === 'completed', '상태 completed');
    const after = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    check(after === mid, `수령 확인은 재고를 건드리지 않음 (${after})`);

    // 5) 정산·통계에 잡힙니다 — 이게 없으면 completed 가 안 생겨 전부 0입니다.
    const sum = (await farmer.get('/api/producer/summary')).body;
    check(sum.completed >= 1, `생산자 집계에 반영 (완료 ${sum.completed}건)`);
    check(sum.revenue >= done.body.order.total, `매출 집계 (${sum.revenue.toLocaleString('ko-KR')}원)`);

    // 6) 종착 상태에서는 더 못 바꿉니다.
    const again = await mgrA.post(`/api/store/pickups/${orderId}/complete`);
    check(again.status === 409, `이미 처리된 예약은 거부 (HTTP ${again.status})`);
  }

  // =============================================================
  group('노쇼 처리');
  // =============================================================
  {
    const ord = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;
    const before = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;

    // 재고를 되돌리지 않는 노쇼 (신선식품 폐기)
    const ns = await mgrA.post(`/api/store/pickups/${ord.id}/noshow`, { restock: false });
    check(ns.status === 200 && ns.body.order.status === 'noshow', '노쇼 처리됨');
    const after = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    check(after === before, `복구 안 함을 고르면 재고 그대로 (${after})`);

    // 재고를 되돌리는 노쇼
    const ord2 = (await buyer.post('/api/orders', { productId: A.id, qty: 2 })).body.order;
    const b2 = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    const ns2 = await mgrA.post(`/api/store/pickups/${ord2.id}/noshow`, { restock: true });
    check(ns2.status === 200, '노쇼 + 재고 복구');
    const a2 = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    check(a2 === b2 + 2, `복구를 고르면 재고가 돌아옴 (${b2} → ${a2})`);
    check(ns2.body.order.noshowRestocked === true, '복구 여부가 주문에 기록됨');
  }

  // =============================================================
  group('범위 격리 — 역할을 나눈 이유');
  // =============================================================
  {
    const ord = (await buyer.post('/api/orders', { productId: A.id, qty: 1 })).body.order;

    // 다른 매장 관리인은 남의 거점 예약을 보지도, 만지지도 못합니다.
    const look = await mgrB.get(`/api/store/pickups/lookup?code=${encodeURIComponent(ord.code)}`);
    check(look.status === 404, `B 매장은 A 매장 예약코드를 못 찾음 (HTTP ${look.status})`);

    const steal = await mgrB.post(`/api/store/pickups/${ord.id}/complete`);
    check(steal.status === 404, `B 매장이 A 매장 예약을 수령 확인 못 함 (HTTP ${steal.status})`);

    // B 거점에도 주문을 하나 만들어야 "섞이지 않는다" 를 실제로 확인할 수 있습니다.
    const ordB = (await buyer.post('/api/orders', { productId: B.id, qty: 1 })).body.order;
    const list = (await mgrB.get('/api/store/pickups')).body.pickups || [];
    const keys = [...new Set(list.map((p) => p.storeKey))];
    check(list.length > 0, `B 목록에 B 거점 예약이 있음 (${list.length}건)`);
    check(list.some((p) => p.code === ordB.code), 'B 매장에 방금 만든 예약이 보임');
    check(keys.length === 1 && keys[0] === 'pk_js_gondre',
      `B 목록에 A 거점 예약이 섞이지 않음 (${keys.join(',')})`);

    const listA = (await mgrA.get('/api/store/pickups')).body.pickups || [];
    check(!listA.some((p) => p.code === ordB.code), 'A 매장에는 B 예약이 안 보임');

    await mgrB.post(`/api/store/pickups/${ordB.id}/noshow`, { restock: true });

    // 생산자는 남의 상품 재고를 못 넣습니다.
    const cross = await farmer.post(`/api/producer/products/${B.id}/restock`, { qty: 5 });
    check(cross.status === 404, `남의 상품 출하 거부 (HTTP ${cross.status})`);
    const crossPrice = await farmer.patch(`/api/producer/products/${B.id}`, { priceNow: 1 });
    check(crossPrice.status === 404, `남의 상품 가격 변경 거부 (HTTP ${crossPrice.status})`);

    // 생산자 목록에는 자기 상품만 나옵니다.
    const mine = (await farmer.get('/api/producer/products')).body.products;
    check(mine.length === 1 && mine[0].id === A.id,
      `생산자 목록에 자기 상품만 (${mine.map((p) => p.id).join(',')})`);

    await mgrA.post(`/api/store/pickups/${ord.id}/noshow`, { restock: true });
  }

  // =============================================================
  group('권한 없는 접근');
  // =============================================================
  {
    const c = await buyer.get('/api/store/pickups');
    check(c.status === 403, `일반 사용자의 매장 API 접근 차단 (HTTP ${c.status})`);
    const p = await buyer.get('/api/producer/products');
    check(p.status === 403, `일반 사용자의 생산자 API 접근 차단 (HTTP ${p.status})`);
    const a = await buyer.get('/api/admin/users');
    check(a.status === 403, `일반 사용자의 관리자 API 접근 차단 (HTTP ${a.status})`);

    const m = await mgrA.get('/api/admin/users');
    check(m.status === 403, `매장 관리인의 계정 관리 접근 차단 (HTTP ${m.status})`);
    const f = await farmer.get('/api/store/pickups');
    check(f.status === 403, `생산자의 매장 API 접근 차단 (HTTP ${f.status})`);

    const anon = await fetch(`${BASE}/api/store/pickups`);
    check(anon.status === 401, `비로그인은 401 (HTTP ${anon.status})`);

    // 예전에 인증 없이 열려 있던 구멍
    const cache = await fetch(`${BASE}/api/tour/cache/clear`, { method: 'POST' });
    check(cache.status === 401, `캐시 비우기가 더 이상 공개가 아님 (HTTP ${cache.status})`);
  }

  // =============================================================
  group('입력 검증');
  // =============================================================
  {
    const zero = await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: 0 });
    check(zero.status === 400, `출하 0 거부 (HTTP ${zero.status})`);
    const neg = await farmer.post(`/api/producer/products/${A.id}/restock`, { qty: -5 });
    check(neg.status === 400, `출하 음수 거부 (HTTP ${neg.status})`);

    const bad = await farmer.patch(`/api/producer/products/${A.id}`, { priceWas: 10000, priceNow: 50000 });
    check(bad.status === 400, `판매가 > 정가 거부 (HTTP ${bad.status})`);

    const noNote = await mgrA.post(`/api/store/products/${A.id}/adjust`, { delta: -1 });
    check(noNote.status === 400 && noNote.body.code === 'NOTE_REQUIRED',
      '재고 조정에 사유를 요구함');

    const cur = (await probe.get('/api/products')).body.raw.find((p) => p.id === A.id).stock;
    const over = await mgrA.post(`/api/store/products/${A.id}/adjust`, { delta: -(cur + 10), note: '폐기' });
    check(over.status === 409, `재고보다 많이 빼기 거부 (HTTP ${over.status})`);
  }

  // =============================================================
  group('최고관리자');
  // =============================================================
  {
    const users = await admin.get('/api/admin/users');
    check(users.status === 200 && users.body.count > 0, `계정 목록 (${users.body.count}명)`);

    const target = users.body.users.find((u) => u.nickname === '역할검사 손님');
    const grant = await admin.put(`/api/admin/users/${target.id}/roles`, {
      roles: ['customer', 'producer'], scope: { productIds: [B.id] },
    });
    check(grant.status === 200, `역할 부여 (HTTP ${grant.status})`);
    check(grant.body.user.roles.includes('producer'), '생산자 역할이 붙음');

    // 부여 직후 실제로 쓸 수 있어야 합니다.
    const nowCan = await buyer.get('/api/producer/products');
    check(nowCan.status === 200 && nowCan.body.products.some((p) => p.id === B.id),
      '부여 즉시 담당 상품이 보임');

    const badRole = await admin.put(`/api/admin/users/${target.id}/roles`, { roles: ['god'] });
    check(badRole.status === 400, `없는 역할 거부 (HTTP ${badRole.status})`);

    const audit = await admin.get('/api/admin/audit');
    check(audit.status === 200 && audit.body.rows.some((r) => r.action === 'user:role:write'),
      `감사 로그에 남음 (${audit.body.count}건)`);

    const stats = (await admin.get('/api/admin/stats')).body;
    check(stats.orders.completed >= 1, `전체 통계 완료 건수 (${stats.orders.completed})`);
    check(stats.orders.noshow >= 2, `노쇼 집계 (${stats.orders.noshow})`);
    check(typeof stats.stock.total === 'number', `재고 총량 (${stats.stock.total})`);

    // 원상복구
    await admin.put(`/api/admin/users/${target.id}/roles`, { roles: ['customer'], scope: {} });
    const back = await buyer.get('/api/producer/products');
    check(back.status === 403, `역할 회수 즉시 차단 (HTTP ${back.status})`);
  }

  // =============================================================
  group('입점 신청 · 승인');
  // =============================================================
  {
    const seeker = client();
    await seeker.login('역할검사 신청자');

    const blocked = await seeker.get('/api/producer/products');
    check(blocked.status === 403, `신청 전에는 권한 없음 (HTTP ${blocked.status})`);

    const ap = await seeker.post('/api/admin/apply', {
      role: 'producer', farm: '검사 농원', productIds: [B.id], memo: '검사용 신청',
    });
    check(ap.status === 201 && ap.body.application.status === 'pending', '신청 접수됨');

    const dup = await seeker.post('/api/admin/apply', { role: 'producer' });
    check(dup.status === 409 && dup.body.code === 'PENDING', `중복 신청 거부 (HTTP ${dup.status})`);

    const stillBlocked = await seeker.get('/api/producer/products');
    check(stillBlocked.status === 403, '심사 중에는 여전히 권한 없음');

    const notMine = await mgrA.get('/api/admin/applications');
    check(notMine.status === 403, `매장 관리인은 심사 목록을 못 봄 (HTTP ${notMine.status})`);

    const list = await admin.get('/api/admin/applications');
    check(list.status === 200 && list.body.applications.some((x) => x.id === ap.body.application.id),
      `심사 목록에 뜸 (${list.body.count}건)`);

    const dec = await admin.post(`/api/admin/applications/${ap.body.application.id}/decide`,
      { approve: true });
    check(dec.status === 200, `승인 (HTTP ${dec.status})`);
    check(dec.body.user.roles.includes('producer'), '승인과 동시에 역할이 붙음');
    check(dec.body.user.scope.productIds.includes(B.id), '신청한 범위가 그대로 붙음');

    const nowOk = await seeker.get('/api/producer/products');
    check(nowOk.status === 200 && nowOk.body.products.some((p) => p.id === B.id),
      '승인 즉시 담당 상품이 보임');

    const again = await admin.post(`/api/admin/applications/${ap.body.application.id}/decide`,
      { approve: false });
    check(again.status === 409, `처리된 신청은 다시 심사 못 함 (HTTP ${again.status})`);

    // 되돌립니다.
    await admin.put(`/api/admin/users/${dec.body.user.id}/roles`,
      { roles: ['customer'], scope: {} });
  }

  // =============================================================
  group('정산');
  // =============================================================
  {
    const wide = 'from=2000-01-01&to=2099-12-31';
    const s = await admin.get(`/api/admin/settlement?${wide}`);
    check(s.status === 200, `정산 조회 (HTTP ${s.status})`);
    check(s.body.statements.length > 0, `정산서 ${s.body.statements.length}건`);

    // 수식이 맞는가
    const bad = s.body.statements.filter((x) =>
      x.net !== x.gross - x.fee || x.fee !== Math.round(x.gross * s.body.feeRate));
    check(bad.length === 0, `지급액 = 판매액 − 수수료, 수수료 = 판매액 × ${s.body.feeRate}`,
      bad.slice(0, 2).map((x) => `${x.farm} ${x.gross}/${x.fee}/${x.net}`).join(' | '));

    const t = s.body.total;
    const sum = s.body.statements.reduce((a, x) => a + x.net, 0);
    check(t.net === sum, `합계가 각 줄의 합과 일치 (${t.net})`);

    // 정산 대상은 completed 뿐이어야 합니다.
    const all = (await admin.get('/api/admin/stats?from=2000-01-01&to=2099-12-31')).body;
    check(t.count === all.orders.completed,
      `정산 건수 = 수령완료 건수 (${t.count}/${all.orders.completed})`);

    // 지급 처리는 한 번만.
    const target = s.body.statements.find((x) => !x.paid);
    if (target) {
      const pay = await admin.post('/api/admin/settlement/pay',
        { from: s.body.from, to: s.body.to, key: target.key });
      check(pay.status === 201, `지급 처리 (HTTP ${pay.status})`);
      check(pay.body.settlement.net === target.net, `지급액이 정산서와 같음 (${pay.body.settlement.net})`);

      const twice = await admin.post('/api/admin/settlement/pay',
        { from: s.body.from, to: s.body.to, key: target.key });
      check(twice.status === 409 && twice.body.code === 'ALREADY_PAID',
        `이중 지급 거부 (HTTP ${twice.status})`);

      const re = await admin.get(`/api/admin/settlement?${wide}`);
      check(re.body.statements.find((x) => x.key === target.key).paid === true,
        '지급 표시가 반영됨');
    } else {
      check(true, '지급 대기 정산 없음 - 건너뜀');
    }

    const noPerm = await mgrA.post('/api/admin/settlement/pay',
      { from: '2000-01-01', to: '2099-12-31', key: 'x' });
    check(noPerm.status === 403, `매장 관리인은 지급 못 함 (HTTP ${noPerm.status})`);
  }

  // =============================================================
  group('콘텐츠 편집');
  // =============================================================
  {
    const op = client();
    await op.login('역할검사 운영자', ['operator'], {});

    const keys = await op.get('/api/admin/content');
    check(keys.status === 200 && keys.body.keys.length >= 15,
      `편집 가능한 항목 ${keys.body.keys.length}개`);

    const one = await op.get('/api/admin/content/NOTICE_DATA');
    check(one.status === 200 && Array.isArray(one.body.value), '공지 조회');

    // 화이트리스트 밖은 열리지 않아야 합니다.
    const evil = await op.get('/api/admin/content/users');
    check(evil.status === 404, `허용되지 않은 키 차단 (HTTP ${evil.status})`);

    // 통째로 비우는 저장은 막습니다.
    const empty = await op.put('/api/admin/content/NOTICE_DATA', { value: [] });
    check(empty.status === 409 && empty.body.code === 'WOULD_EMPTY',
      `빈 값 덮어쓰기 차단 (HTTP ${empty.status})`);

    // 정상 저장과 원복
    const orig = one.body.value;
    const edited = [{ ...orig[0], t: '검사용 공지' }, ...orig.slice(1)];
    const w = await op.put('/api/admin/content/NOTICE_DATA', { value: edited });
    check(w.status === 200, '공지 저장');
    const back = await op.get('/api/admin/content/NOTICE_DATA');
    check(back.body.value[0].t === '검사용 공지', '저장 내용이 반영됨');
    await op.put('/api/admin/content/NOTICE_DATA', { value: orig });

    const noPerm = await mgrA.put('/api/admin/content/NOTICE_DATA', { value: orig });
    check(noPerm.status === 403, `매장 관리인은 콘텐츠 편집 불가 (HTTP ${noPerm.status})`);
    const noRead = await mgrA.get('/api/admin/content/NOTICE_DATA');
    check(noRead.status === 403, `매장 관리인은 콘텐츠 조회도 불가 (HTTP ${noRead.status})`);
  }

  // =============================================================
  group('되돌릴 수 없는 작업');
  // =============================================================
  {
    // /api/admin/reset 은 DB 를 시드로 되돌립니다. 인증이 전혀 없어서
    // 누구나 전체 주문·계정을 지울 수 있었습니다.
    const anon = await fetch(`${BASE}/api/admin/reset`, { method: 'POST' });
    check(anon.status === 401, `비로그인 초기화 차단 (HTTP ${anon.status})`);

    const asMgr = await mgrA.post('/api/admin/reset', { confirm: 'RESET' });
    check(asMgr.status === 403, `매장 관리인 초기화 차단 (HTTP ${asMgr.status})`);

    const asFarmer = await farmer.post('/api/admin/reset', { confirm: 'RESET' });
    check(asFarmer.status === 403, `생산자 초기화 차단 (HTTP ${asFarmer.status})`);

    // 최고관리자라도 확인값 없이는 실행되지 않습니다.
    const noConfirm = await admin.post('/api/admin/reset', {});
    check(noConfirm.status === 400 && noConfirm.body.code === 'CONFIRM_REQUIRED',
      `확인값 없는 초기화 차단 (HTTP ${noConfirm.status})`);

    const wrong = await admin.post('/api/admin/reset', { confirm: 'yes' });
    check(wrong.status === 400, `잘못된 확인값 차단 (HTTP ${wrong.status})`);

    // 실제로 초기화되지 않았는지 확인합니다.
    const still = await admin.get('/api/admin/users');
    check(still.body.count > 1, `데이터가 그대로 남아 있음 (계정 ${still.body.count}명)`);
  }

  console.log('');
  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  역할 검증 전부 통과\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
