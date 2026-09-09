import { config } from '../config.js';
import { readDb, writeDb, readSeed, backendName } from './storage.js';
import crypto from 'node:crypto';

/**
 * JSON 파일 기반 영속 저장소.
 *
 * SQLite(better-sqlite3)는 Windows 에서 네이티브 빌드가 필요해 설치가 깨질 수 있어
 * 의존성 없는 파일 저장소로 갑니다. 이 앱 규모(수백 레코드)에서는 충분하고,
 * 나중에 실제 DB 로 바꿀 때는 이 모듈의 인터페이스만 맞추면 됩니다.
 *
 * 쓰기는 임시파일 + rename 으로 원자적으로 처리해, 도중에 죽어도
 * db.json 이 반쯤 쓰인 상태로 남지 않게 합니다.
 */

const EMPTY = {
  stores: [],      // 픽업 거점 / 농가
  products: [],    // 상품 (가격, 재고)
  orders: [],      // 주문 / 예약   (userId 로 소유자 구분)
  reviews: [],     // 리뷰          (userId)
  coupons: [],     // 쿠폰          (userId - 비로그인 시드는 userId 없음)
  plans: [],       // 저장한 여행 코스 (userId)
  content: {},     // 운영 콘텐츠 (FAQ·공지·약관·코스구성·제철 등)
  users: [],       // 소셜 로그인 계정 (roles / scope 로 역할 구분)
  sessions: [],    // 로그인 세션
  stockLogs: [],   // 재고 변동 이력 (누가 왜 바꿨는지)
  audit: [],       // 감사 로그 (권한·콘텐츠 변경)
  settlements: [],  // 정산 지급 기록
  applications: [], // 입점 신청 (생산자 · 매장 관리인)
  meta: {},
};

let db = null;

export function loadSeed() {
  const seed = readSeed();
  if (!seed) {
    throw new Error(
      `시드 파일이 없습니다: ${config.seedFile}. 먼저 npm run seed 를 실행하세요.`
    );
  }
  return seed;
}

/**
 * DB 로 승격되는 운영 콘텐츠 키.
 * 공공 API 가 없어 직접 관리해야 하는 것들입니다.
 */
export const CONTENT_KEYS = [
  'PLACES', 'GEO', 'POOL', 'cal', 'RV', 'RV_PHOTOS',
  'FAQ_DATA', 'NOTICE_DATA', 'LEGAL_DATA', 'LR_DATA',
  'CAL2_FESTIVAL', 'CAL2_SEASONAL', 'CAL2_SHOP_LISTS',
  // CAT_MATCH 는 값이 함수라 JSON 으로 저장·전송할 수 없어 제외합니다.
  'VIC', 'FARM_SHOTS', 'STORE_SHOTS',
  'HS_REGION_GROUP', 'STYLE_DESC', 'ADJ', 'REGIONS',
];

/** Turns "89,000원" / "52,000" / 52000 into a number. */
export function wonToNumber(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Seeds products/stores from the extracted mock data on first boot. */
function buildInitial(seed) {
  const next = structuredClone(EMPTY);

  // --- 픽업 거점 (STORES + PLACES 의 pickup 항목) ---
  const places = seed.PLACES || {};
  const geo = seed.GEO || {};

  next.stores = (seed.STORES || []).map((s) => ({
    key: s.key,
    name: places[s.key]?.nm || s.key,
    category: s.cat,
    region: s.rg,
    address: s.addr,
    distance: s.dist,
    tags: s.tags || [],
    closed: !!s.off,
    tile: s.tile,
    rating: Number(s.rate) || 0,
    reviewCount: Number(s.rev) || 0,
    // 기존 누적 평점을 기준선으로 보존합니다. 사용자가 후기를 쓰면
    // 이 기준선에 합산해서 평균을 냅니다 (덮어쓰면 4.8/124건이
    // 5.0/1건으로 바뀌어 오히려 정보가 사라집니다).
    baseRating: Number(s.rate) || 0,
    baseCount: Number(s.rev) || 0,
    lat: geo[s.key]?.[0] ?? null,
    lng: geo[s.key]?.[1] ?? null,
    pickupDay: (seed.MAP_PDAY || {})[s.key] || 'both',
    hours: places[s.key]?.hours || '',
    source: 'seed',
  }));

  // --- 상품: PL(픽업 리스트) 이 실제 판매 단위입니다 ---
  next.products = (seed.PL || []).map((p, i) => {
    const wasN = wonToNumber(p.was);
    const nowN = wonToNumber(p.now);
    // 목업의 "오늘 7팩 예약가능" 같은 문자열에서 초기 재고를 뽑아냅니다.
    const stockMatch = /(\d+)\s*(팩|개|박스|세트|인분)/.exec(p.tag || '');
    return {
      id: p.fid || String(i + 1).padStart(2, '0'),
      name: p.prod,
      farm: p.name,
      region: p.region,
      category: p.cat,
      priceWas: wasN,
      priceNow: nowN,
      discount: wasN > 0 ? Math.round((1 - nowN / wasN) * 100) : 0,
      stock: stockMatch ? Number(stockMatch[1]) : 10,
      initialStock: stockMatch ? Number(stockMatch[1]) : 10,
      mode: p.mode,                 // 'now' = 당일픽업 / 'pre' = 선예약
      pickupDay: p.day || null,
      pickupDate: p.predate || null,
      hours: p.hours || '',
      distance: p.dist,
      rateCount: p.rate,
      seasonal: !!p.seasonal,
      tile: [p.t1, p.t2],
      source: 'seed',
    };
  });

  // 제철 캘린더에만 있고 상품 목록에는 없던 항목들을 실제 상품으로 승격시킵니다.
  // 그대로 두면 캘린더에서 눌러도 주문할 수 없는 유령 상품이 됩니다.
  // 가격·매장·지역은 캘린더 데이터에 이미 있으므로 새로 지어내지 않습니다.
  let calSeq = 0;
  for (const items of Object.values(seed.cal || {})) {
    for (const it of items) {
      // 이름만 비교하면 "곤드레나물"과 "곤드레 햇나물"이 다른 상품이 됩니다.
      // 같은 농가가 같은 가격으로 파는 것은 같은 물건으로 봅니다.
      const exists = next.products.some((p) =>
        p.name === it.prod
        || (p.farm === it.store && p.priceWas === it.wasN && p.priceNow === it.nowN));
      if (exists) continue;
      calSeq += 1;
      next.products.push({
        id: 'c' + String(calSeq).padStart(2, '0'),
        name: it.prod,
        farm: it.store,
        region: it.region,
        category: '제철',
        priceWas: it.wasN,
        priceNow: it.nowN,
        discount: it.wasN > 0 ? Math.round((1 - it.nowN / it.wasN) * 100) : 0,
        stock: 10,
        initialStock: 10,
        mode: it.pre ? 'pre' : 'now',
        pickupDay: it.pre ? null : (it.status || '오늘'),
        pickupDate: it.pre ? it.status : null,
        hours: '10:00 ~ 17:00',
        distance: '',
        rateCount: 0,
        seasonal: true,
        tile: [it.tile || '#5e5236', it.tile || '#6a5a3a'],
        source: 'seed-cal',
      });
    }
  }

  // --- 픽업 거점(PLACES 의 type:'pickup')을 상품과 연결합니다 ---
  //
  // 거점에는 "오늘 12팩 남음" 같은 문자열이 박혀 있었는데, 실제 재고와 이어져
  // 있지 않아 다 팔린 뒤에도 그대로 남았습니다. 게다가 상품이 없는 거점은
  // 예약해도 서버에 주문이 만들어지지 않고 화면만 바뀌었습니다.
  // 거점마다 상품을 붙여, 가격·재고·주문이 한 곳에서 나오게 합니다.
  const PLACE_LINK = {
    pk_hanwoo: '01', pk_bread: '05', pk_pc_potato: '07', pk_pc_trout: '09',
    pk_pc_buck: '10', pk_js_hwanggi: '15', pk_js_surichi: '16', pk_js_gondre: '19',
  };
  for (const [placeKey, productId] of Object.entries(PLACE_LINK)) {
    const p = next.products.find((x) => x.id === productId);
    if (p && places[placeKey]) p.placeKey = placeKey;
  }

  // 상품이 아예 없던 거점은 거점 정보 그대로 상품을 만듭니다.
  let placeSeq = 0;
  for (const [key, pl] of Object.entries(places)) {
    if (!pl || pl.type !== 'pickup' || !pl.now) continue;
    if (next.products.some((p) => p.placeKey === key)) continue;
    placeSeq += 1;
    const wasN = wonToNumber(pl.was) || wonToNumber(pl.now);
    const nowN = wonToNumber(pl.now);
    const st = /(\d+)\s*(팩|개|박스|세트|인분)/.exec(pl.remain || '');
    const store = next.stores.find((x) => x.key === key);
    next.products.push({
      id: 'p' + String(placeSeq).padStart(2, '0'),
      placeKey: key,
      name: pl.product || pl.nm,
      farm: pl.nm,
      region: (store && store.rg) || '',
      category: '픽업 거점',
      priceWas: wasN,
      priceNow: nowN,
      discount: wasN > 0 ? Math.round((1 - nowN / wasN) * 100) : 0,
      stock: st ? Number(st[1]) : 10,
      initialStock: st ? Number(st[1]) : 10,
      mode: /선예약/.test(pl.remain || '') ? 'pre' : 'now',
      pickupDay: '오늘',
      pickupDate: null,
      hours: pl.hours || '',
      distance: (store && store.dist) || '',
      rateCount: pl.rev || 0,
      seasonal: false,
      tile: ['#5e5236', '#6a5a3a'],
      source: 'seed-place',
    });
  }

  // 시드의 "내 픽업" 2건을 실제 주문 레코드로 만들어 둡니다.
  // 이렇게 해야 화면의 예약 내역이 서버 데이터 한 곳에서만 나오고,
  // 새로고침해도 유지됩니다 (기존에는 프론트 상수라 새로고침 시 되돌아갔습니다).
  next.orders = (seed.MY_PICKUPS || []).map((p, i) => {
    const prod = next.products.find((x) => x.name === p.prod)
      || next.products.find((x) => x.farm === p.shop);
    const now = wonToNumber(p.now);
    const was = wonToNumber(p.was);
    return {
      id: `od_seed_${i + 1}`,
      code: p.code,
      productId: prod ? prod.id : null,
      productName: p.prod,
      farm: p.shop,
      region: prod ? prod.region : '',
      qty: 1,
      unitPrice: now,
      unitPriceWas: was,
      total: now,
      saved: Math.max(0, was - now),
      pickupDate: p.group || '오늘 픽업',
      hours: prod ? prod.hours : '',
      buyerName: '',
      phone: '',
      status: p.status === '픽업완료' ? 'completed' : 'reserved',
      createdAt: new Date().toISOString(),
      source: 'seed',
    };
  });

  next.reviews = (seed.MY_REVIEWS || []).map((r, i) => {
    // 시드 후기는 매장명만 있어서, 이름으로 거점 키를 찾아 붙여 둡니다.
    const st = next.stores.find((s) => s.name === r.shop)
      || next.stores.find((s) => (s.name || '').includes(r.shop));
    return {
      id: `rv_seed_${i + 1}`,
      storeKey: st ? st.key : null,
      ...r,
      photos: r.photos || [],
      createdAt: new Date().toISOString(),
    };
  });

  next.coupons = (seed.MY_COUPONS || []).map((c, i) => ({
    id: `cp_seed_${i + 1}`, ...c, used: false,
  }));

  // 운영 콘텐츠를 DB 로 승격합니다.
  // 이전에는 요청마다 seed.json 을 읽어 넘겼습니다. 그러면 파일로 자리만 옮긴 것이지
  // 운영 중 수정이 불가능합니다. 이제 seed.json 은 **최초 설치 시에만** 쓰입니다.
  next.content = {};
  for (const k of CONTENT_KEYS) {
    if (seed[k] !== undefined) next.content[k] = structuredClone(seed[k]);
  }

  // 스키마를 바꾸면 이 숫자를 올리세요. 기존 db.json 이 자동으로 재생성됩니다.
  next.stockLogs = [];
  next.settlements = [];
  next.applications = [];
  next.audit = [];
  next.meta = { seededAt: new Date().toISOString(), version: SCHEMA_VERSION };
  migrate(next);
  return next;
}

const SCHEMA_VERSION = 9;

/**
 * 기존 db.json 을 새 스키마로 올립니다.
 *
 * 버전을 올릴 때마다 통째로 재생성하면 그동안 쌓인 주문·후기·계정이 날아갑니다.
 * 역할 도입은 필드를 더하는 변경이라 마이그레이션으로 충분합니다.
 * 반환값은 "바뀐 게 있었는가" 입니다.
 */
export function migrate(d) {
  let changed = false;
  const ensure = (key, val) => {
    if (d[key] === undefined) { d[key] = val; changed = true; }
  };

  ensure('stockLogs', []);
  ensure('settlements', []);
  ensure('applications', []);
  ensure('audit', []);

  for (const u of d.users || []) {
    if (!Array.isArray(u.roles) || !u.roles.length) { u.roles = ['customer']; changed = true; }
    if (!u.scope) { u.scope = { storeKeys: [], productIds: [], regions: [] }; changed = true; }
    if (!u.status) { u.status = 'active'; changed = true; }
  }
  for (const p of d.products || []) {
    if (p.producerId === undefined) { p.producerId = null; changed = true; }
  }
  for (const st of d.stores || []) {
    if (!Array.isArray(st.managerIds)) { st.managerIds = []; changed = true; }
  }

  if (!d.meta) d.meta = {};
  const from = Number(d.meta.version) || 0;

  // --- v9: 한 번만 도는 데이터 정리 ---
  if (from < 9) {
    changed = dedupeOrderCodes(d) || changed;
    changed = mergeTwinProducts(d) || changed;
  }

  if (d.meta.version !== SCHEMA_VERSION) { d.meta.version = SCHEMA_VERSION; changed = true; }
  return changed;
}

/**
 * 겹친 예약코드를 풉니다.
 *
 * 코드를 'HL-' + 1000~9999 로 중복 검사 없이 뽑던 시절의 주문이 남아 있습니다.
 * 같은 코드가 둘이면 매장에서 조회했을 때 어느 쪽인지 알 수 없습니다.
 * 가장 먼저 만들어진 것만 코드를 지키고 나머지는 새로 받습니다.
 */
function dedupeOrderCodes(d) {
  const orders = d.orders || [];
  const seen = new Set();
  const used = new Set(orders.map((o) => String(o.code).toUpperCase()));
  let fixed = 0;

  for (const o of orders.slice().sort((a, b) =>
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')))) {
    const c = String(o.code).toUpperCase();
    if (!seen.has(c)) { seen.add(c); continue; }

    let next = null;
    for (let i = 0; i < 200 && !next; i++) {
      const cand = 'HL-' + crypto.randomInt(100000, 999999);
      if (!used.has(cand)) next = cand;
    }
    if (!next) next = 'HL-' + Date.now().toString(36).toUpperCase() + fixed;
    o.codeWas = o.code;                       // 예전 코드로 문의가 올 수 있습니다
    o.code = next;
    used.add(next); seen.add(next);
    fixed += 1;
  }
  if (fixed) console.log(`[store] 겹친 예약코드 ${fixed}건을 새로 발급했습니다.`);
  return fixed > 0;
}

/**
 * 같은 농가가 같은 가격으로 파는 쌍둥이 상품을 합칩니다.
 *
 * 제철 캘린더 항목을 상품으로 승격할 때 이름이 조금만 달라도(곤드레나물 /
 * 곤드레 햇나물) 새 상품을 만들어서, 홈 목록에 같은 물건이 두 번 실렸습니다.
 * 재고도 둘로 갈려 실제보다 많아 보입니다.
 * 캘린더는 매장 이름으로도 상품을 찾으므로 합쳐도 화면은 그대로입니다.
 */
function mergeTwinProducts(d) {
  const products = d.products || [];
  const groups = new Map();
  for (const p of products) {
    if (!p.farm || !p.priceNow) continue;
    const key = `${p.farm}|${p.priceWas}|${p.priceNow}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const drop = new Set();
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // 픽업 거점에 연결된 것 > 시드 상품 > 캘린더 파생 순으로 남깁니다.
    const rank = (p) => (p.placeKey ? 0 : (p.source === 'seed' ? 1 : 2));
    const keep = list.slice().sort((a, b) => rank(a) - rank(b)
      || String(a.id).localeCompare(String(b.id)))[0];

    for (const p of list) {
      if (p.id === keep.id) continue;
      // 재고와 주문을 남는 쪽으로 옮깁니다. 버리면 팔린 기록이 사라집니다.
      keep.stock = (keep.stock || 0) + (p.stock || 0);
      keep.initialStock = Math.max(keep.initialStock || 0, keep.stock);
      for (const o of d.orders || []) if (o.productId === p.id) o.productId = keep.id;
      for (const l of d.stockLogs || []) if (l.productId === p.id) l.productId = keep.id;
      drop.add(p.id);
      merged += 1;
      console.log(`[store] 쌍둥이 상품 병합: ${p.id} ${p.name} → ${keep.id} ${keep.name}`);
    }
  }
  if (!merged) return false;
  d.products = products.filter((p) => !drop.has(p.id));
  return true;
}

let loading = null;

/**
 * DB 를 메모리에 올립니다. 여러 번 불려도 한 번만 실행됩니다.
 * 요청을 처리하기 전에 반드시 거쳐야 get() 이 유효합니다.
 */
export async function ensureLoaded() {
  if (db) return db;
  if (loading) return loading;

  loading = (async () => {
    const existing = await readDb();
    // 7 이상은 필드를 더하는 변경이라 마이그레이션으로 올립니다.
    // 그보다 낮거나 파일이 없으면 시드에서 새로 만듭니다.
    if (existing && existing.meta && existing.meta.version >= 7) {
      db = existing;
      if (migrate(db)) await writeDb(db);
    } else {
      db = buildInitial(loadSeed());
      await writeDb(db);
    }
    return db;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export const init = ensureLoaded;

export async function persist() {
  await writeDb(db);
}

/** 메모리에 올라온 DB. ensureLoaded() 이후에만 유효합니다. */
export function get() {
  if (!db) {
    throw new Error('저장소가 아직 로드되지 않았습니다. ensureLoaded() 를 먼저 호출하세요.');
  }
  return db;
}

/** DB 를 fn 으로 변경하고 저장합니다. fn 의 반환값을 그대로 돌려줍니다. */
export async function mutate(fn) {
  const d = get();
  const result = fn(d);
  await persist();
  return result;
}

export async function reset() {
  db = buildInitial(loadSeed());
  await writeDb(db);
  return db;
}

export { backendName };

export const collections = {
  stores: () => get().stores,
  products: () => get().products,
  stockLogs: () => get().stockLogs || [],
  audit: () => get().audit || [],
  settlements: () => get().settlements || [],
  applications: () => get().applications || [],
  orders: () => get().orders,
  reviews: () => get().reviews,
  coupons: () => get().coupons,
  plans: () => get().plans || [],
  content: () => get().content || {},
  users: () => get().users || [],
  sessions: () => get().sessions || [],
};
