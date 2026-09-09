/**
 * Vercel(서버리스) 모드 검증.
 *
 *   node src/vercetest.js
 *
 * 실제 Vercel 에 올리기 전에, 로컬에서 다음을 확인합니다:
 *   1) VERCEL 환경변수가 있으면 포트를 열지 않는다 (열면 함수가 타임아웃 납니다)
 *   2) export 된 Express 앱이 핸들러로 그대로 동작한다
 *   3) 저장소 백엔드가 환경변수에 따라 file <-> kv 로 바뀐다
 *   4) 콜드 스타트(메모리 비어있음)에서도 첫 요청이 정상 처리된다
 */
process.env.VERCEL = '1';
process.env.PORT = process.env.PORT || '8799';

import http from 'node:http';

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};

const main = async () => {
  console.log('');

  // --- 저장소 백엔드 전환 ---
  const storage = await import('./lib/storage.js');
  check(storage.backendName() === 'file', 'KV 환경변수 없으면 file 백엔드');

  process.env.KV_REST_API_URL = 'https://example.invalid';
  process.env.KV_REST_API_TOKEN = 'dummy';
  check(storage.backendName() === 'kv', 'KV 환경변수 있으면 kv 백엔드');
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  check(storage.backendName() === 'file', '환경변수 제거하면 file 로 복귀');

  // --- 서버리스 모드에서 listen 하지 않는가 ---
  const mod = await import('./index.js');
  const app = mod.default;
  check(typeof app === 'function', 'Express 앱이 default export 됨', typeof app);

  // VERCEL=1 이므로 위 import 는 포트를 열지 않아야 합니다.
  const portBusy = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', () => resolve(true));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(Number(process.env.PORT));
  });
  check(portBusy === false, `서버리스 모드에서 포트를 열지 않음 (${process.env.PORT})`);

  // --- export 된 앱을 핸들러로 붙여 실제 요청 처리 ---
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  check(health.ok === true, '핸들러로 /api/health 처리', JSON.stringify(health).slice(0, 100));
  check(health.counts && health.counts.products > 0,
    `콜드 스타트에서 저장소 로드됨 (상품 ${health.counts?.products})`);

  const boot = await fetch(`${base}/api/bootstrap`).then((r) => r.json());
  check(Object.keys(boot.PLACES || {}).length > 0,
    `부트스트랩 동작 (장소 ${Object.keys(boot.PLACES || {}).length})`);
  check(Array.isArray(boot.MY_PICKUPS), '예약 내역 포함');

  // 운영(서버리스)에서는 개발 로그인이 막혀 있어야 합니다.
  const devTry = await fetch(`${base}/api/auth/dev-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check(devTry.status === 404, '운영 모드에서 개발 로그인 차단', `HTTP ${devTry.status}`);

  // 로그인 없이 주문하면 거부돼야 합니다.
  const target = (boot.PL || []).find((p) => p.stock > 0);
  check(!!target, `재고 있는 상품 존재 (${target?.prod})`);

  const noAuth = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId: target.fid, qty: 1 }),
  });
  check(noAuth.status === 401, '비로그인 주문 거부', `HTTP ${noAuth.status}`);

  // 세션이 있으면 서버리스에서도 쓰기가 되어야 합니다.
  // (개발 로그인이 막혀 있으므로 저장소를 통해 직접 세션을 만듭니다.)
  const { upsertUser, createSession, SESSION_COOKIE } = await import('./lib/auth.js');
  const u = await upsertUser({ provider: 'test', providerId: 'vercel-test', nickname: '서버리스 검사' });
  const { token } = await createSession(u.id);
  const cookie = `${SESSION_COOKIE}=${token}`;

  const made = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ productId: target.fid, qty: 1 }),
  }).then((r) => r.json());
  check(!!made.order, '세션이 있으면 서버리스에서 주문 생성', JSON.stringify(made).slice(0, 90));

  if (made.order) {
    const mine = await fetch(`${base}/api/mypickups`, { headers: { Cookie: cookie } }).then((r) => r.json());
    check((mine.MY_PICKUPS || []).some((x) => x.code === made.order.code),
      '내 예약 목록에 반영');
    await fetch(`${base}/api/orders/${made.order.id}/cancel`, {
      method: 'POST', headers: { Cookie: cookie },
    });
  }

  // --- 배포 모드의 역할 기능 ---
  //
  // 개발 로그인이 막혀 있어서, 배포에서 운영 화면에 들어갈 수 있는 길은
  // SUPER_ADMIN_EMAILS + 소셜 로그인뿐입니다. 그 길이 실제로 열려 있는지,
  // 그리고 아무나 들어올 수는 없는지 확인합니다.
  const roles = await fetch(`${base}/api/auth/roles`, { headers: { Cookie: cookie } })
    .then((r) => r.json());
  check(roles.roles.length === 1 && roles.roles[0] === 'customer',
    `일반 계정의 역할 (${roles.roles.join(',')})`);
  check(roles.can['order:complete'] === false, '일반 계정에 매장 권한 없음');

  for (const [p, label] of [
    ['/api/store/pickups', '매장'],
    ['/api/producer/products', '생산자'],
    ['/api/admin/users', '계정 관리'],
    ['/api/admin/content/NOTICE_DATA', '콘텐츠'],
  ]) {
    const r = await fetch(`${base}${p}`, { headers: { Cookie: cookie } });
    check(r.status === 403, `${label} API 차단 (HTTP ${r.status})`);
  }

  // 비로그인은 401, DB 초기화는 배포에서 아예 없는 경로여야 합니다.
  const anon = await fetch(`${base}/api/store/pickups`);
  check(anon.status === 401, `비로그인 매장 API 401 (HTTP ${anon.status})`);
  const reset = await fetch(`${base}/api/admin/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirm: 'RESET' }),
  });
  check(reset.status === 404, `배포 모드에서 DB 초기화 경로 없음 (HTTP ${reset.status})`);

  // 최고관리자 부트스트랩이 실제로 붙는가 (환경변수 → 로그인 시 자동 부여).
  const { config } = await import('./config.js');
  config.superAdminEmails.push('vercel-admin@example.com');
  const admin = await upsertUser({
    provider: 'test', providerId: 'vercel-admin',
    nickname: '서버리스 관리자', email: 'vercel-admin@example.com',
  });
  const adminSession = await createSession(admin.id);
  const adminCookie = `${SESSION_COOKIE}=${adminSession.token}`;
  const adminRoles = await fetch(`${base}/api/auth/roles`, { headers: { Cookie: adminCookie } })
    .then((r) => r.json());
  check(adminRoles.roles.includes('super_admin'),
    `SUPER_ADMIN_EMAILS 로 최고관리자 부여 (${adminRoles.roles.join(',')})`);
  const adminUsers = await fetch(`${base}/api/admin/users`, { headers: { Cookie: adminCookie } });
  check(adminUsers.status === 200, `최고관리자는 계정 관리 접근 (HTTP ${adminUsers.status})`);
  config.superAdminEmails.pop();

  // 정적 파일은 Vercel CDN 이 서빙하지만, 함수로 와도 동작해야 합니다(폴백).
  const html = await fetch(`${base}/happylocal_v2.html`);
  check(html.status === 200, '정적 HTML 폴백 서빙', `HTTP ${html.status}`);
  const adminHtml = await fetch(`${base}/admin.html`);
  check(adminHtml.status === 200, `운영 화면 서빙 (HTTP ${adminHtml.status})`);

  // undici(fetch)가 keep-alive 연결을 유지해서 close 가 안 끝납니다.
  // 열린 연결을 먼저 끊습니다.
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((r) => server.close(r));

  console.log('');
  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  전부 통과\n');
  process.exit(0);
};

main().catch((e) => { console.error(e); process.exit(1); });
