/**
 * 실제 로그인으로 하는 역할별 검증.
 *
 *   npm run seed:accounts && npm run test:account
 *
 * 지금까지의 역할 검증은 개발용 로그인(dev-login)으로 역할을 꽂아 넣고
 * 확인했습니다. 그건 배포에서 막혀 있는 통로라, 실제 사용자가 겪는 경로를
 * 검증한 게 아닙니다. 여기서는 아이디·비밀번호로 진짜 로그인해서 봅니다.
 */
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;
const PW = 'happylocal2026';

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
      headers: { 'Content-Type': 'application/json', ...(opt.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let body = null;
    try { body = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  const json = (m) => (p, b) => call(p, { method: m, body: JSON.stringify(b || {}) });
  return {
    get: (p) => call(p),
    post: json('POST'),
    put: json('PUT'),
    patch: json('PATCH'),
    login: (loginId, password = PW) => json('POST')('/api/auth/login', { loginId, password }),
    hasCookie: () => !!cookie,
  };
}

/** 로그인해서 역할 정보까지 받아 옵니다. */
async function signIn(loginId) {
  const c = client();
  const r = await c.login(loginId);
  if (r.status !== 200) throw new Error(`${loginId} 로그인 실패 (HTTP ${r.status}) ${r.body?.error || ''}`);
  const roles = (await c.get('/api/auth/roles')).body;
  return { c, roles, user: r.body.user };
}

const main = async () => {
  // =============================================================
  group('회원가입 · 로그인');
  // =============================================================
  {
    const c = client();
    const id = 'test_' + Date.now().toString(36).slice(-6);

    const short = await c.post('/api/auth/register', { loginId: 'ab', password: PW });
    check(short.status === 400, `짧은 아이디 거부 (HTTP ${short.status})`);

    const weak = await c.post('/api/auth/register', { loginId: id, password: '1234' });
    check(weak.status === 400, `짧은 비밀번호 거부 (HTTP ${weak.status})`);

    const digits = await c.post('/api/auth/register', { loginId: id, password: '12345678' });
    check(digits.status === 400, `숫자만인 비밀번호 거부 (HTTP ${digits.status})`);

    const bad = await c.post('/api/auth/register', { loginId: 'BAD ID!', password: PW });
    check(bad.status === 400, `허용되지 않은 문자 거부 (HTTP ${bad.status})`);

    const made = await c.post('/api/auth/register', {
      loginId: id, password: PW, nickname: '가입 검사',
    });
    check(made.status === 201, `가입 (HTTP ${made.status})`);
    check(made.body.user.roles.join() === 'customer', '가입은 언제나 일반 사용자');
    check(!('passwordHash' in made.body.user), '응답에 비밀번호 해시가 없음');
    check(c.hasCookie(), '가입과 동시에 로그인됨');

    const dup = await client().post('/api/auth/register', { loginId: id, password: PW });
    check(dup.status === 409 && dup.body.code === 'ID_TAKEN', `아이디 중복 거부 (HTTP ${dup.status})`);

    // 가입 혜택이 실제로 붙는가
    const boot = (await c.get('/api/bootstrap')).body;
    check((boot.MY_COUPONS || []).length > 0, `가입 쿠폰 지급 (${(boot.MY_COUPONS || []).length}장)`);

    // 로그인
    const fresh = client();
    const wrong = await fresh.login(id, 'wrongpassword');
    check(wrong.status === 401 && wrong.body.code === 'BAD_CREDENTIALS',
      `틀린 비밀번호 거부 (HTTP ${wrong.status})`);
    check(!/없는|존재하지/.test(wrong.body.error || ''),
      '아이디 존재 여부를 알려주지 않음', wrong.body.error);

    const nobody = await client().login('nosuchuser_zz', PW);
    check(nobody.status === 401 && nobody.body.error === wrong.body.error,
      '없는 아이디와 틀린 비밀번호의 응답이 같음');

    const ok = await fresh.login(id);
    check(ok.status === 200, `로그인 (HTTP ${ok.status})`);

    const upper = await client().login(id.toUpperCase());
    check(upper.status === 200, '아이디 대소문자를 가리지 않음');

    // 비밀번호 변경
    const chg = await fresh.post('/api/auth/password', { current: PW, next: 'newpassword2026' });
    check(chg.status === 200, `비밀번호 변경 (HTTP ${chg.status})`);
    check((await client().login(id, PW)).status === 401, '옛 비밀번호로는 못 들어감');
    check((await client().login(id, 'newpassword2026')).status === 200, '새 비밀번호로 들어감');
  }

  // =============================================================
  group('로그인 시도 제한');
  // =============================================================
  {
    const id = 'ratelimit_' + Date.now().toString(36).slice(-5);
    await client().post('/api/auth/register', { loginId: id, password: PW });

    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      const r = await client().login(id, 'wrong' + i);
      if (r.status === 429) blocked += 1;
    }
    check(blocked > 0, `연속 실패 시 차단됨 (429 ${blocked}회)`);
  }

  // =============================================================
  group('일반 사용자 계정');
  // =============================================================
  {
    const { c, roles } = await signIn('customer1');
    check(roles.roles.join() === 'customer', `역할 (${roles.roles.join(',')})`);
    check(roles.stores.length === 0 && roles.products.length === 0, '담당 범위 없음');

    for (const [p, label] of [
      ['/api/store/pickups', '매장'], ['/api/producer/products', '생산자'],
      ['/api/admin/users', '계정 관리'], ['/api/admin/content/NOTICE_DATA', '콘텐츠'],
      ['/api/admin/applications', '입점 심사'],
    ]) {
      const r = await c.get(p);
      check(r.status === 403, `${label} API 차단 (HTTP ${r.status})`);
    }

    // 일반 기능은 되어야 합니다.
    const t = (await c.get('/api/products')).body.raw.find((p) => p.stock > 0);
    const ord = await c.post('/api/orders', { productId: t.id, qty: 1 });
    check(ord.status === 201, `예약은 정상 동작 (HTTP ${ord.status})`);
    await c.post(`/api/orders/${ord.body.order.id}/cancel`);

    // 다른 일반 사용자와 격리되는가
    const other = await signIn('customer2');
    const mine = (await c.get('/api/mypickups')).body.MY_PICKUPS;
    const theirs = (await other.c.get('/api/mypickups')).body.MY_PICKUPS;
    const overlap = mine.filter((m) => theirs.some((t2) => t2.code === m.code));
    check(overlap.length === 0, `두 계정의 예약이 섞이지 않음 (${mine.length} / ${theirs.length})`);
  }

  // =============================================================
  group('생산자 계정 (지역별)');
  // =============================================================
  {
    const hs = await signIn('farmer_hs');
    const pc = await signIn('farmer_pc');
    const js = await signIn('farmer_js');

    for (const [who, name, region] of [[hs, 'farmer_hs', '횡성'], [pc, 'farmer_pc', '평창'], [js, 'farmer_js', '정선']]) {
      const list = (await who.c.get('/api/producer/products')).body.products;
      check(list.length > 0, `${name} 담당 상품 ${list.length}개`);
      check(list.every((p) => p.region === region),
        `${name} 은 ${region} 상품만 봄 (${[...new Set(list.map((p) => p.region))].join(',')})`);
    }

    // 남의 지역 상품에는 손댈 수 없어야 합니다.
    const pcFirst = (await pc.c.get('/api/producer/products')).body.products[0];
    const cross = await hs.c.post(`/api/producer/products/${pcFirst.id}/restock`, { qty: 5 });
    check(cross.status === 404, `횡성 농가가 평창 상품에 출하 불가 (HTTP ${cross.status})`);

    // 자기 상품 출하는 되어야 합니다.
    const mine = (await hs.c.get('/api/producer/products')).body.products[0];
    const before = mine.stock;
    const re = await hs.c.post(`/api/producer/products/${mine.id}/restock`, { qty: 4, note: '계정 검사' });
    check(re.status === 200 && re.body.product.stock === before + 4,
      `자기 상품 출하 (${before} → ${re.body.product.stock})`);

    // 생산자는 매장 기능을 못 씁니다.
    check((await hs.c.get('/api/store/pickups')).status === 403, '생산자는 매장 API 차단');
    check((await hs.c.get('/api/admin/users')).status === 403, '생산자는 계정 관리 차단');
  }

  // =============================================================
  group('매장 관리인 계정 (거점별)');
  // =============================================================
  {
    const hanwoo = await signIn('store_hanwoo');
    const local = await signIn('store_local');
    const jsStore = await signIn('store_js');

    check(hanwoo.roles.stores.length === 2, `store_hanwoo 담당 거점 ${hanwoo.roles.stores.length}곳`);
    check(local.roles.stores.length === 3, `store_local 담당 거점 ${local.roles.stores.length}곳`);

    // 손님이 예약을 하나 만듭니다.
    const buyer = await signIn('customer1');
    const products = (await buyer.c.get('/api/products')).body.raw;
    const hanwooProduct = products.find((p) => p.placeKey === 'pk_hanwoo' && p.stock > 0);
    check(!!hanwooProduct, `pk_hanwoo 상품 존재 (${hanwooProduct?.name})`);

    const ord = (await buyer.c.post('/api/orders', { productId: hanwooProduct.id, qty: 1 })).body.order;

    // 담당 매장은 보이고, 다른 매장은 안 보여야 합니다.
    const mine = (await hanwoo.c.get('/api/store/pickups')).body.pickups;
    check(mine.some((p) => p.code === ord.code), '담당 매장 목록에 새 예약이 뜸');

    const notMine = (await jsStore.c.get('/api/store/pickups')).body.pickups;
    check(!notMine.some((p) => p.code === ord.code), '다른 매장 목록에는 안 뜸');

    const look = await jsStore.c.get(`/api/store/pickups/lookup?code=${encodeURIComponent(ord.code)}`);
    check(look.status === 404, `다른 매장은 코드 조회 불가 (HTTP ${look.status})`);

    const steal = await jsStore.c.post(`/api/store/pickups/${ord.id}/complete`);
    check(steal.status === 404, `다른 매장은 수령 확인 불가 (HTTP ${steal.status})`);

    const done = await hanwoo.c.post(`/api/store/pickups/${ord.id}/complete`);
    check(done.status === 200 && done.body.order.status === 'completed', '담당 매장은 수령 확인 가능');

    // 매장 관리인은 콘텐츠·계정을 못 만집니다.
    check((await hanwoo.c.get('/api/admin/content/NOTICE_DATA')).status === 403,
      '매장 관리인은 콘텐츠 차단');
    check((await hanwoo.c.get('/api/admin/users')).status === 403, '매장 관리인은 계정 관리 차단');
  }

  // =============================================================
  group('겸직 계정 (농가 + 매장)');
  // =============================================================
  {
    const both = await signIn('farmstore_pc');
    check(both.roles.roles.includes('producer') && both.roles.roles.includes('store_manager'),
      `두 역할 (${both.roles.roles.join(',')})`);
    check(both.roles.products.length > 0, `담당 상품 ${both.roles.products.length}개`);
    check(both.roles.stores.length > 0, `담당 거점 ${both.roles.stores.length}곳`);

    check((await both.c.get('/api/producer/products')).status === 200, '생산자 기능 사용 가능');
    check((await both.c.get('/api/store/pickups')).status === 200, '매장 기능 사용 가능');
    check((await both.c.get('/api/admin/users')).status === 403, '계정 관리는 여전히 차단');
  }

  // =============================================================
  group('운영자 계정');
  // =============================================================
  {
    const op = await signIn('operator1');
    check(op.roles.roles.includes('operator'), `역할 (${op.roles.roles.join(',')})`);

    check((await op.c.get('/api/admin/content/NOTICE_DATA')).status === 200, '콘텐츠 조회 가능');
    check((await op.c.get('/api/admin/reviews')).status === 200, '후기 관리 가능');
    check((await op.c.get('/api/admin/stats')).status === 200, '통계 조회 가능');

    check((await op.c.get('/api/store/pickups')).status === 403, '매장 기능은 차단');
    check((await op.c.get('/api/producer/products')).status === 403, '생산자 기능은 차단');
    check((await op.c.get('/api/admin/users')).status === 403, '계정 관리는 차단');
    check((await op.c.get('/api/admin/applications')).status === 403, '입점 심사는 차단');
  }

  // =============================================================
  group('최고관리자 계정');
  // =============================================================
  {
    const admin = await signIn('admin1');
    check(admin.roles.roles.includes('super_admin'), `역할 (${admin.roles.roles.join(',')})`);

    for (const [p, label] of [
      ['/api/admin/users', '계정 관리'], ['/api/admin/audit', '감사 로그'],
      ['/api/admin/applications', '입점 심사'], ['/api/admin/stats', '통계'],
      ['/api/store/pickups', '매장'], ['/api/producer/products', '생산자'],
      ['/api/admin/content/NOTICE_DATA', '콘텐츠'],
    ]) {
      check((await admin.c.get(p)).status === 200, `${label} 접근 가능`);
    }

    // 실제 역할 부여가 되는가 — 일반 계정을 운영자로 올렸다가 되돌립니다.
    const users = (await admin.c.get('/api/admin/users?q=customer2')).body.users;
    const target = users.find((u) => u.nickname.includes('박서준'));
    check(!!target, `대상 계정 조회 (${target?.nickname})`);

    const before = await signIn('customer2');
    check((await before.c.get('/api/admin/reviews')).status === 403, '부여 전에는 차단');

    const grant = await admin.c.put(`/api/admin/users/${target.id}/roles`,
      { roles: ['customer', 'operator'], scope: {} });
    check(grant.status === 200, `역할 부여 (HTTP ${grant.status})`);

    const after = await signIn('customer2');
    check(after.roles.roles.includes('operator'), '다시 로그인하면 새 역할이 붙음');
    check((await after.c.get('/api/admin/reviews')).status === 200, '부여 후에는 접근 가능');

    await admin.c.put(`/api/admin/users/${target.id}/roles`, { roles: ['customer'], scope: {} });
    const reverted = await signIn('customer2');
    check(!reverted.roles.roles.includes('operator'), '회수하면 역할이 사라짐');
    check((await reverted.c.get('/api/admin/reviews')).status === 403, '회수 후 다시 차단');

    // 계정 정지
    const susp = await admin.c.put(`/api/admin/users/${target.id}/status`, { status: 'suspended' });
    check(susp.status === 200, '계정 정지');
    const blocked = await client().login('customer2');
    check(blocked.status === 403 && blocked.body.code === 'SUSPENDED',
      `정지된 계정은 로그인 불가 (HTTP ${blocked.status})`);
    await admin.c.put(`/api/admin/users/${target.id}/status`, { status: 'active' });
    check((await client().login('customer2')).status === 200, '정지 해제 후 로그인 가능');
  }

  console.log('');
  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  계정 검증 전부 통과\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
