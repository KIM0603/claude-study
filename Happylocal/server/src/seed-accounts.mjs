/**
 * 역할별 테스트 계정 만들기.
 *
 *   npm run seed:accounts
 *
 * 카카오 계정 없이도 각 역할의 화면을 확인할 수 있게, 아이디·비밀번호
 * 계정을 역할별로 만들어 둡니다. 여러 번 돌려도 같은 결과입니다.
 *
 * 배포에서는 돌리지 마세요. 비밀번호가 공개된 계정이 남습니다.
 * (NODE_ENV=production 이면 거부합니다.)
 */
import * as store from './lib/store.js';
import { upsertUser } from './lib/auth.js';
import { hashPassword } from './lib/password.js';

if (process.env.NODE_ENV === 'production' && !process.env.FORCE_SEED_ACCOUNTS) {
  console.error('\n  운영 환경에서는 테스트 계정을 만들지 않습니다.');
  console.error('  정말 필요하면 FORCE_SEED_ACCOUNTS=1 을 붙이세요.\n');
  process.exit(1);
}

/** 모든 테스트 계정의 공통 비밀번호. 문서와 화면 안내에 같이 씁니다. */
export const TEST_PASSWORD = 'happylocal2026';

await store.ensureLoaded();
const db = store.get();

const products = db.products;
const places = (db.content && db.content.PLACES) || {};

/** 지역별로 그 지역 상품 id 를 모읍니다. */
const byRegion = (rg) => products.filter((p) => p.region === rg).map((p) => p.id);

/** 픽업 거점 키 전부. */
const pickupKeys = Object.keys(places).filter((k) => places[k] && places[k].type === 'pickup');

const ACCOUNTS = [
  // --- 일반 사용자 ---
  { id: 'customer1', nick: '여행자 김하늘', email: 'customer1@happylocal.test', roles: ['customer'] },
  { id: 'customer2', nick: '여행자 박서준', email: 'customer2@happylocal.test', roles: ['customer'] },

  // --- 생산자: 지역별 ---
  {
    id: 'farmer_hs', nick: '횡성 김성호 농가', email: 'farmer.hs@happylocal.test',
    roles: ['producer'], scope: { productIds: byRegion('횡성') },
  },
  {
    id: 'farmer_pc', nick: '대관령 고랭지 농원', email: 'farmer.pc@happylocal.test',
    roles: ['producer'], scope: { productIds: byRegion('평창') },
  },
  {
    id: 'farmer_js', nick: '아라리 산나물 조합', email: 'farmer.js@happylocal.test',
    roles: ['producer'], scope: { productIds: byRegion('정선') },
  },

  // --- 매장 관리인: 거점별 ---
  {
    id: 'store_hanwoo', nick: '횡성한우 픽업 담당', email: 'store.hanwoo@happylocal.test',
    roles: ['store_manager'], scope: { storeKeys: ['pk_hanwoo', 'pk_plaza'] },
  },
  {
    id: 'store_local', nick: '횡성 로컬푸드 직매장', email: 'store.local@happylocal.test',
    roles: ['store_manager'], scope: { storeKeys: ['pk_local', 'pk_bread', 'pk_potato'] },
  },
  {
    id: 'store_js', nick: '정선 픽업 담당', email: 'store.js@happylocal.test',
    roles: ['store_manager'], scope: { storeKeys: ['pk_js_gondre', 'pk_js_surichi', 'pk_js_hwanggi'] },
  },

  // --- 농가이면서 매장인 경우 (직거래) ---
  {
    id: 'farmstore_pc', nick: '오대천 양어장 (직판)', email: 'farmstore.pc@happylocal.test',
    roles: ['producer', 'store_manager'],
    scope: { storeKeys: ['pk_pc_trout'], productIds: ['09'] },
  },

  // --- 운영자 · 최고관리자 ---
  { id: 'operator1', nick: '횡성군 관광과', email: 'operator1@happylocal.test', roles: ['operator'] },
  { id: 'admin1', nick: '해피로컬 운영팀', email: 'admin1@happylocal.test', roles: ['super_admin'] },
];

const passwordHash = await hashPassword(TEST_PASSWORD);

console.log('');
let made = 0, updated = 0;

for (const a of ACCOUNTS) {
  const before = db.users.find((u) => u.provider === 'local' && u.providerId === a.id);
  const user = await upsertUser({
    provider: 'local', providerId: a.id, nickname: a.nick, email: a.email,
  });

  await store.mutate((d) => {
    const u = d.users.find((x) => x.id === user.id);
    if (!u) return;
    u.passwordHash = passwordHash;
    u.passwordSetAt = new Date().toISOString();
    u.roles = a.roles.includes('customer') ? a.roles : ['customer', ...a.roles];
    u.scope = {
      storeKeys: (a.scope && a.scope.storeKeys) || [],
      productIds: (a.scope && a.scope.productIds) || [],
      regions: (a.scope && a.scope.regions) || [],
    };
    u.status = 'active';
    u.isTestAccount = true;

    // 담당 관계를 반대 방향에서도 이어 둡니다.
    for (const p of d.products) {
      if (u.scope.productIds.includes(p.id)) p.producerId = u.id;
    }
    for (const st of d.stores) {
      const has = Array.isArray(st.managerIds) ? st.managerIds : [];
      st.managerIds = u.scope.storeKeys.includes(st.key)
        ? Array.from(new Set([...has, u.id]))
        : has.filter((x) => x !== u.id);
    }
  });

  if (before) updated += 1; else made += 1;
  const scope = [
    a.scope?.storeKeys?.length ? `거점 ${a.scope.storeKeys.length}` : '',
    a.scope?.productIds?.length ? `상품 ${a.scope.productIds.length}` : '',
  ].filter(Boolean).join(' · ') || '—';
  console.log(`  ${a.id.padEnd(14)} ${a.roles.join('+').padEnd(24)} ${scope}`);
}

console.log(`\n  새로 만듦 ${made}개 · 갱신 ${updated}개`);
console.log(`  비밀번호는 모두  ${TEST_PASSWORD}`);
console.log(`  픽업 거점 ${pickupKeys.length}곳 중 ${
  new Set(ACCOUNTS.flatMap((a) => a.scope?.storeKeys || [])).size}곳에 담당자가 있습니다.\n`);

process.exit(0);
