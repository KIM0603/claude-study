import express from 'express';
import { config, CONTENT_TYPE, hasTourKey } from '../config.js';
import { areaBasedList, gangwonFestivals as tourFestivals, TourApiError } from '../lib/tourapi.js';
import { gangwonFestivals as stdFestivals, toFestivalPlace } from '../lib/festival.js';
import { toPlace, toStoreCard, productToPL, orderToPickup } from '../lib/adapt.js';
import { collections } from '../lib/store.js';
import { publicUser } from '../lib/auth.js';
import { planToCourse } from './plans.js';

export const router = express.Router();

const REGIONS = ['횡성', '평창', '정선'];

/**
 * 시드 장소 키가 어느 지역 것인지 찾습니다.
 * 시드 PLACES 에는 지역(군) 필드가 없고 읍/면만 있어서, POOL 의 지역별
 * 키 목록을 역인덱스로 씁니다.
 */
function regionOfSeedKey(key, seed) {
  for (const [region, P] of Object.entries(seed.POOL || {})) {
    const keys = [P.ic, ...(P.pk || []), ...(P.tour || []), ...(P.food || [])];
    if (keys.includes(key)) return region;
  }
  // POOL 어디에도 없는 항목(예: fest_bread)은 키 접미사로 추정합니다.
  // 지역이 비면 지역 필터에서 통째로 사라지므로 빈 값을 남기지 않습니다.
  if (/_pc(_|$)/.test(key)) return '평창';
  if (/_js(_|$)/.test(key)) return '정선';
  return '횡성';
}

/** 한 지역의 관광지/음식점/축제를 병렬로 가져옵니다. 실패한 카테고리는 건너뜁니다. */
async function fetchRegion(region) {
  const sigunguCode = config.tour.sigungu[region];
  // 지도에서 지역별로 한눈에 보려면 표본이 넉넉해야 합니다.
  // TourAPI 개발계정 한도(일 1,000건) 안에서 지역당 3콜이므로 여유가 있습니다.
  const wanted = [
    ['tour', CONTENT_TYPE.TOURIST, 50],
    ['food', CONTENT_TYPE.FOOD, 40],
    ['festival', CONTENT_TYPE.FESTIVAL, 30],
  ];

  const settled = await Promise.allSettled(
    wanted.map(([, contentTypeId, numOfRows]) =>
      areaBasedList({ sigunguCode, contentTypeId, numOfRows })
    )
  );

  const out = { region, tour: [], food: [], festival: [], errors: [] };
  settled.forEach((r, i) => {
    const [name] = wanted[i];
    if (r.status === 'fulfilled') {
      out[name] = r.value.items;
    } else {
      const e = r.reason;
      out.errors.push({
        category: name,
        message: e?.message || String(e),
        hint: e instanceof TourApiError ? e.hint : undefined,
      });
    }
  });
  return out;
}

/**
 * GET /api/bootstrap
 *
 * 프론트가 부팅 시 한 번 호출하는 엔드포인트입니다.
 * 목업 상수와 **완전히 같은 이름/모양**으로 응답하므로, 프론트는 상수 선언만
 * 이 응답으로 바꾸면 나머지 렌더링 코드를 그대로 쓸 수 있습니다.
 */
router.get('/bootstrap', async (req, res) => {
  // 운영 콘텐츠는 DB 에서 읽습니다. seed.json 은 최초 설치 때만 쓰입니다.
  const seed = collections.content();
  const warnings = [];

  // 1) 시드에서 출발합니다.
  //    픽업 농가(pk_*)와 출발지(ic_*)는 TourAPI 에 없는 자체 데이터라 반드시 남깁니다.
  //    코스 생성기(POOL)가 이 키들을 직접 참조하기 때문이기도 합니다.
  const PLACES = { ...seed.PLACES };
  const GEO = { ...seed.GEO };
  const POOL = structuredClone(seed.POOL || {});

  // 2) 픽업 상품/거점은 자체 DB(실재고)에서 가져옵니다.
  const products = collections.products();
  const dbStores = collections.stores();

  const PL = products.map(productToPL);

  // 픽업 거점(PLACES 의 pickup 항목)은 가격과 잔여 수량을 문자열로 갖고 있었습니다.
  // 시드에 박힌 값이라 실제로 팔려도 "오늘 12팩 남음" 그대로였고, 이 숫자가
  // 매장 목록 표시·마감임박 정렬·수량 상한까지 좌우했습니다.
  // 연결된 상품의 실시간 값으로 덮어씁니다.
  const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}`;
  for (const p of products) {
    const pl = p.placeKey && PLACES[p.placeKey];
    if (!pl) continue;
    const unit = /세트|인분|박스|팩|개/.exec(p.name)?.[0] || '팩';
    PLACES[p.placeKey] = {
      ...pl,
      productId: p.id,                       // 프론트가 곧바로 주문에 쓸 수 있게
      was: won(p.priceWas),
      now: won(p.priceNow),
      save: won(p.priceWas - p.priceNow),
      stock: p.stock,
      remain: p.stock > 0
        ? (p.mode === 'pre' ? `선예약 ${p.stock}${unit} 모집중` : `오늘 ${p.stock}${unit} 남음`)
        : '오늘 마감',
    };
  }
  // 상품이 연결되지 않은 거점에 남은 숫자는 근거가 없으므로 지웁니다.
  for (const [k, pl] of Object.entries(PLACES)) {
    if (!pl || pl.type !== 'pickup' || pl.productId) continue;
    if (pl.remain && /\d/.test(pl.remain)) PLACES[k] = { ...pl, remain: '방문 픽업 가능' };
  }

  // 예약 내역은 시드 상수가 아니라 실제 주문에서 만듭니다.
  // (이전에는 seed.MY_PICKUPS 를 그대로 내려줘서, 결제해도 새로고침하면
  //  주문이 사라진 것처럼 보였습니다.)
  const uid = req.user && req.user.id;
  const MY_PICKUPS = buildMyPickups(uid);

  // 후기도 서버 저장소가 정본입니다. 저장 형태를 프론트 렌더 shape 과
  // 동일하게 맞춰 뒀으므로 그대로 내려보냅니다.
  const MY_REVIEWS = collections.reviews().filter((r) => uid && r.userId === uid).map((r) => ({
    shop: r.shop, prod: r.prod, stars: r.stars, date: r.date,
    txt: r.txt, photos: r.photos || [], id: r.id,
  }));

  const STORES = dbStores.map((s) => ({
    key: s.key, cat: s.category, rate: String(s.rating), rev: s.reviewCount,
    off: s.closed, tile: s.tile, rg: s.region, dist: s.distance,
    addr: s.address, tags: s.tags, source: s.source,
    // 시드 거점은 PLACES 의 type(pickup/food/tour) 을 그대로 씁니다.
    type: (seed.PLACES[s.key] && seed.PLACES[s.key].type) || 'pickup',
  }));

  const MAP_PDAY = Object.fromEntries(dbStores.map((s) => [s.key, s.pickupDay]));

  // 시드 PLACES 에는 축제·관광지가 있는데 STORES 에는 픽업/맛집만 있었습니다.
  // 그대로 두면 TourAPI 키가 없을 때 지도에 축제가 하나도 뜨지 않습니다.
  // 좌표가 있는 축제·관광지를 지도 대상으로 함께 올립니다.
  const SEED_TILE = { festival: '#6a4733', tour: '#3f5142', food: '#5a4636', pickup: '#5e5236' };
  const SEED_LABEL = { festival: '축제', tour: '관광', food: '맛집', pickup: '픽업' };
  const already = new Set(STORES.map((s) => s.key));

  // 전국문화축제표준데이터에서 강원 축제를 먼저 받습니다.
  // 여기에 대상 3개 군 축제가 실제로 들어 있어, 시드 축제를 대체합니다.
  let stdFest = [];
  try {
    if (hasTourKey()) stdFest = await stdFestivals();
  } catch (e) {
    warnings.push(`[축제표준데이터] ${e.message}${e.hint ? ' — ' + e.hint : ''}`);
  }
  const haveRealFestivals = stdFest.length > 0;

  for (const [key, pl] of Object.entries(seed.PLACES)) {
    if (already.has(key)) continue;
    if (pl.type !== 'festival' && pl.type !== 'tour') continue;
    // 실제 축제 데이터를 받았으면 시드 축제는 지도에 올리지 않습니다.
    // (PLACES 에는 남겨둡니다. 코스 생성기가 이 키들을 참조합니다.)
    if (pl.type === 'festival' && haveRealFestivals) continue;
    if (!Array.isArray(seed.GEO[key])) continue;      // 좌표 없으면 지도에 못 올립니다

    STORES.push({
      key,
      cat: SEED_LABEL[pl.type] || pl.lab || '관광',
      type: pl.type,
      // TourAPI 에 없는 자체 수집 자료입니다. 화면에 '샘플' 로 표시합니다.
      sample: true,
      rate: '0.0',
      rev: 0,
      off: false,
      tile: SEED_TILE[pl.type] || '#3f5142',
      rg: regionOfSeedKey(key, seed),
      dist: '',
      addr: pl.region || '',
      tags: [pl.lab, pl.region].filter(Boolean),
      period: pl.period || '',
      source: 'seed',
    });
    MAP_PDAY[key] = 'both';
  }

  // 받아온 강원 축제를 지도에 올립니다. 같은 축제가 연도별로 중복 등록돼 있어
  // 이름 기준으로 가장 최근 회차만 남깁니다.
  const seenFest = new Map();
  for (const f of stdFest) {
    const conv = toFestivalPlace(f);
    if (!conv || !conv.place.nm) continue;
    const prev = seenFest.get(conv.place.nm);
    if (prev && String(prev.raw.fstvlStartDate) >= String(f.fstvlStartDate)) continue;
    seenFest.set(conv.place.nm, { conv, raw: f });
  }
  for (const { conv } of seenFest.values()) {
    PLACES[conv.key] = conv.place;
    GEO[conv.key] = conv.geo;
    STORES.push({
      key: conv.key,
      cat: '축제',
      type: 'festival',
      rate: '0.0',
      rev: 0,
      off: false,
      tile: '#6a4733',
      // 지도 지역 칩은 '횡성'/'평창'/'정선' 이라 '횡성군' 은 안 걸립니다.
      // 대상 3개 군만 칩과 같은 표기로 맞추고, 나머지 시군은 원래 이름을 씁니다.
      rg: REGIONS.find((r) => conv.sigun.startsWith(r)) || conv.sigun,
      dist: '',
      addr: conv.place.address,
      tags: ['축제', conv.place.region].filter(Boolean),
      period: conv.place.period,
      source: 'festival-std',
    });
    MAP_PDAY[conv.key] = 'both';
  }

  // 캘린더용: 실제 날짜를 유지한 형태로 따로 만듭니다.
  const cal2Festivals = [];
  for (const { conv, raw } of seenFest.values()) {
    if (!raw.fstvlStartDate) continue;
    cal2Festivals.push({
      id: conv.key,
      region: REGIONS.find((r) => conv.sigun.startsWith(r)) || conv.sigun,
      name: conv.place.nm,
      start: raw.fstvlStartDate,          // 실제 연도 그대로
      end: raw.fstvlEndDate || raw.fstvlStartDate,
      place: (raw.opar || conv.place.address || '').trim(),
      placeKey: conv.key,                  // 눌렀을 때 장소 상세로 연결
      host: (raw.mnnstNm || '').trim(),
      source: 'festival-std',
    });
  }
  cal2Festivals.sort((a, b) => a.start.localeCompare(b.start));

  let source = 'seed';

  // 3) TourAPI 키가 있으면 관광지/맛집/축제를 실데이터로 덮어씁니다.
  if (hasTourKey()) {
    const results = await Promise.all(REGIONS.map(fetchRegion));
    let added = 0;

    for (const r of results) {
      r.errors.forEach((e) =>
        warnings.push(`[${r.region}/${e.category}] ${e.message}${e.hint ? ' — ' + e.hint : ''}`)
      );

      const bucket = { tour: [], food: [], festival: [] };

      for (const cat of ['tour', 'food', 'festival']) {
        for (const item of r[cat]) {
          const conv = toPlace(item);
          if (!conv) continue;                 // 좌표 없는 항목 제외
          PLACES[conv.key] = conv.place;
          GEO[conv.key] = conv.geo;
          bucket[cat].push(conv.key);
          added++;

          // 관광지·맛집·축제 모두 지도 카드로 노출합니다.
          // (축제를 빼면 지도에서 "지역별로 가게와 축제를 한번에" 볼 수 없습니다.)
          STORES.push(toStoreCard(item, conv.place));
          MAP_PDAY[conv.key] = 'both';
        }
      }

      // 4) 코스 생성기 재구성: 픽업/출발지는 시드 키를 유지하고,
      //    볼거리·먹거리만 실제 TourAPI 장소로 교체합니다.
      if (POOL[r.region]) {
        if (bucket.tour.length || bucket.festival.length) {
          POOL[r.region].tour = [...bucket.tour.slice(0, 8), ...bucket.festival.slice(0, 3)];
        }
        if (bucket.food.length) {
          POOL[r.region].food = bucket.food.slice(0, 6);
        }
      }
    }

    // 대상 3개 군에 축제가 0건이라, 도 전체 축제를 따로 받아 함께 보여줍니다.
    try {
      const fes = await tourFestivals({});
      for (const item of fes.items) {
        const conv = toPlace({ ...item, contenttypeid: '15' });
        if (!conv || PLACES[conv.key]) continue;
        // 표준데이터에 이미 있는 축제면 건너뜁니다.
        if (seenFest.has(conv.place.nm)) continue;
        PLACES[conv.key] = conv.place;
        GEO[conv.key] = conv.geo;
        const card = toStoreCard(item, conv.place);
        // 시군 이름을 주소에서 뽑습니다 (횡성/평창/정선 밖이라 지역 칩에는 안 걸립니다).
        const m = /강원(?:특별자치)?도\s+([가-힣]+(?:시|군))/.exec(item.addr1 || '');
        card.rg = m ? m[1] : '';
        card.wide = true;                     // 도 전체 범위에서 온 항목
        STORES.push(card);
        MAP_PDAY[conv.key] = 'both';
        added++;
      }
    } catch (e) {
      warnings.push(`[강원 축제] ${e.message}${e.hint ? ' — ' + e.hint : ''}`);
    }

    source = added > 0 ? (warnings.length ? 'mixed' : 'tourapi') : 'seed';
    if (added === 0) {
      warnings.push('TourAPI 에서 좌표를 가진 항목을 하나도 받지 못해 시드 데이터로 표시합니다.');
    }
  } else {
    warnings.push('TOUR_API_KEY 가 설정되지 않아 시드(목업) 데이터로 동작합니다. server/.env 를 확인하세요.');
  }

  res.json({
    source,                    // 'tourapi' | 'mixed' | 'seed'
    generatedAt: new Date().toISOString(),
    warnings,
    // 프론트가 지도 백엔드를 고르는 데 씁니다. 키가 없으면 Leaflet 으로 폴백.
    clientConfig: { kakaoJsKey: config.kakaoJsKey },
    // --- 프론트 상수와 1:1 대응 ---
    PLACES, GEO, PL, STORES, MAP_PDAY, POOL,
    // --- TourAPI 로 대체 불가능해 시드를 그대로 쓰는 것들 ---
    cal: buildCal(seed),
    RV: buildRV(seed),
    MY_STATS: buildMyStats(uid),
    RV_PHOTOS: seed.RV_PHOTOS,

    LR_DATA: seed.LR_DATA,
    HS_REGION_GROUP: seed.HS_REGION_GROUP,
    VIC: seed.VIC,
    FARM_SHOTS: seed.FARM_SHOTS,
    STORE_SHOTS: seed.STORE_SHOTS,
    STYLE_DESC: seed.STYLE_DESC,
    ADJ: seed.ADJ,
    FAQ_DATA: seed.FAQ_DATA,
    NOTICE_DATA: seed.NOTICE_DATA,
    LEGAL_DATA: seed.LEGAL_DATA,
    // 캘린더 축제도 실데이터입니다. 달력 격자에 찍어야 해서 "매년 N월" 이 아니라
    // 실제 개최 연도·날짜를 그대로 씁니다 (지자체 갱신 시점이 달라 연도가 섞입니다).
    CAL2_FESTIVAL: cal2Festivals.length ? cal2Festivals : seed.CAL2_FESTIVAL,
    CAL2_SEASONAL: seed.CAL2_SEASONAL,
    CAL2_SHOP_LISTS: seed.CAL2_SHOP_LISTS,
    // 데모용 고정 날짜 대신 실제 오늘을 내려보냅니다.
    CAL2_TODAY: (() => {
      const d = new Date();
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    })(),
    // 로그인한 사람의 것만 내려갑니다. 비로그인이면 빈 배열입니다.
    user: publicUser(req.user),
    MY_COURSES: uid
      ? (collections.plans() || []).filter((p) => p.userId === uid).map(planToCourse)
      : [],
    MY_COUPONS: uid
      ? (collections.coupons() || []).filter((c) => c.userId === uid)
      : [],
    MY_PICKUPS,
    MY_REVIEWS,
    REGIONS: seed.REGIONS,
  });
});

/**
 * 제철 캘린더.
 *
 * "몇 월에 무엇이 제철인가" 는 편집 정보라 시드를 그대로 씁니다.
 * 대신 가격·재고·픽업 상태는 실제 상품 DB 에서 덮어써서, 캘린더에 뜬 값과
 * 실제 주문 화면의 값이 어긋나지 않게 합니다.
 */
function buildCal(seed) {   // seed = db.content
  const products = collections.products();
  const out = {};

  for (const [month, items] of Object.entries(seed.cal || {})) {
    out[month] = items.map((it) => {
      const prod = products.find((p) => p.name === it.prod)
        || products.find((p) => p.farm === it.store);
      if (!prod) return { ...it, live: false };

      return {
        ...it,
        wasN: prod.priceWas,
        nowN: prod.priceNow,
        // 재고가 없으면 "오늘 픽업" 이라고 표시하면 안 됩니다.
        status: prod.stock <= 0 ? '오늘 마감'
          : (prod.mode === 'pre' ? (prod.pickupDate || '선예약') : (it.status || '오늘 픽업')),
        pre: prod.mode === 'pre',
        stock: prod.stock,
        productId: prod.id,
        live: true,
      };
    });
  }
  return out;
}

/**
 * 매장 후기(RV) - 실제 작성된 후기에서 만듭니다.
 * 후기가 아직 적으면 시드 샘플로 채우고 sample 표시를 답니다.
 */
function buildRV(seed) {    // seed = db.content
  const TILE = ['#5a4636', '#6a4733', '#3f5142', '#5e5236', '#3c5560'];
  const real = collections.reviews()
    .filter((r) => r.userId)                      // 실제 사용자가 쓴 것만
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map((r, i) => ({
      n: r.nickname || '여행자',
      s: r.stars,
      m: `${r.date} · ${r.shop}`,
      c: TILE[i % TILE.length],
      p: 'comb',
      t: r.txt,
      real: true,
    }));

  const samples = (seed.RV || []).map((r) => ({ ...r, sample: true }));
  // 사진 뷰어가 최소 몇 건은 필요해서 부족한 만큼만 샘플로 채웁니다.
  return real.length >= 6 ? real : real.concat(samples).slice(0, Math.max(9, real.length));
}

/** 사용자 통계 - 고정값(픽업완료 14) 대신 실제 주문에서 셉니다. */
function buildMyStats(userId) {
  if (!userId) return { completed: 0, coupons: 0 };
  const orders = collections.orders().filter((o) => o.userId === userId);
  return {
    completed: orders.filter((o) => o.status === 'completed').length,
    coupons: collections.coupons().filter((c) => c.userId === userId && !c.used).length,
  };
}

/** 취소된 주문은 빼고, 최신순으로 프론트 shape 에 맞춰 돌려줍니다. */
function buildMyPickups(userId) {
  const products = collections.products();
  return collections.orders()
    .filter((o) => o.status !== 'cancelled')
    .filter((o) => (userId ? o.userId === userId : false))
    .slice()
    .reverse()
    .map((o) => orderToPickup(o, products.find((p) => p.id === o.productId)));
}

/** GET /api/mypickups - 예약 내역 (주문 후 화면 갱신용) */
router.get('/mypickups', (req, res) => {
  res.json({ MY_PICKUPS: buildMyPickups(req.user && req.user.id) });
});

/** GET /api/products - 실시간 재고가 반영된 픽업 상품 */
router.get('/products', (req, res) => {
  const region = req.query.region;
  let list = collections.products();
  if (region && region !== '전체') list = list.filter((p) => p.region === region);
  res.json({ count: list.length, products: list.map(productToPL), raw: list });
});

/** GET /api/stores */
router.get('/stores', (_req, res) => {
  res.json({ stores: collections.stores() });
});
