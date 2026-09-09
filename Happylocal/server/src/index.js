import express from 'express';
import path from 'node:path';
import { config, hasTourKey, APP_ROOT } from './config.js';
import * as store from './lib/store.js';
import { areaCodeList } from './lib/tourapi.js';
import { router as tourRouter } from './routes/tour.js';
import { router as catalogRouter } from './routes/catalog.js';
import { router as ordersRouter } from './routes/orders.js';
import { router as reviewsRouter } from './routes/reviews.js';
import { router as authRouter } from './routes/auth.js';
import { router as plansRouter } from './routes/plans.js';
import { router as accountRouter } from './routes/account.js';
import { router as producerRouter } from './routes/producer.js';
import { router as storeMgrRouter } from './routes/storemgr.js';
import { router as adminRouter } from './routes/admin.js';
import { attachUser } from './lib/auth.js';
import { requireCan } from './lib/roles.js';
import { collections, CONTENT_KEYS } from './lib/store.js';
import fs from 'node:fs';

const app = express();
app.use(express.json({ limit: '1mb' }));

// 프론트엔드를 같은 오리진에서 서빙합니다.
// 이렇게 하면 브라우저 CORS 문제가 아예 발생하지 않고,
// TourAPI 서비스키도 서버 밖으로 나가지 않습니다.
app.use(express.static(APP_ROOT, { extensions: ['html'] }));

// 요청을 처리하기 전에 저장소를 메모리에 올립니다.
// Vercel 함수는 호출마다 콜드 스타트일 수 있어, 매 요청에서 보장해야 합니다.
// (이미 로드됐으면 즉시 반환합니다.)
app.use(async (_req, _res, next) => {
  try {
    await store.ensureLoaded();
    next();
  } catch (e) {
    next(e);
  }
});

// 저장소가 올라온 뒤에 세션을 읽어 req.user 를 채웁니다 (비로그인이면 null).
app.use(attachUser);

app.get('/api/health', (_req, res) => {
  const db = store.get();
  res.json({
    ok: true,
    tourApiConfigured: hasTourKey(),
    counts: {
      stores: db.stores.length,
      products: db.products.length,
      orders: db.orders.length,
      reviews: db.reviews.length,
    },
    // 신규 가입 시 복사되는 시드 쿠폰 수. 테스트가 고정값 대신 이걸 씁니다.
    seedCoupons: (db.coupons || []).filter((c) => !c.userId).length,
  });
});

app.get('/api/coupons', (req, res) => {
  // 쿠폰은 계정별입니다. 비로그인이면 빈 목록입니다.
  const uid = req.user && req.user.id;
  res.json({ coupons: uid ? collections.coupons().filter((c) => c.userId === uid) : [] });
});

/**
 * 개발용 유틸.
 *
 * 콘텐츠 편집(/api/admin/content)은 예전에 여기 있었습니다. localOnly 하나로만
 * 막혀 있어서, 로컬에서는 로그인조차 없이 누구나 앱 데이터를 덮어쓸 수 있었고
 * 역할이 생긴 뒤에도 라우터보다 먼저 등록돼 권한 검사를 가로챘습니다.
 * 이제 routes/admin.js 가 requireCan('content:write') 로 관리합니다.
 */
function localOnly(_req, res, next) {
  if (!config.allowDevLogin) return res.status(404).json({ error: 'Not found' });
  next();
}

/**
 * DB 를 시드 상태로 되돌립니다. 주문·계정·후기가 전부 사라집니다.
 *
 * 인증이 전혀 없어서 누구나 호출할 수 있었습니다. 로컬 전용으로 막고,
 * 최고관리자만, 그리고 의도를 확인하는 값을 함께 보내야 실행됩니다.
 */
app.post('/api/admin/reset', localOnly, requireCan('user:role:write'), async (req, res) => {
  if ((req.body && req.body.confirm) !== 'RESET') {
    return res.status(400).json({
      error: '되돌릴 수 없는 작업입니다. body 에 { "confirm": "RESET" } 를 보내주세요.',
      code: 'CONFIRM_REQUIRED',
    });
  }
  const db = await store.reset();
  res.json({ ok: true, counts: { stores: db.stores.length, products: db.products.length } });
});

app.use('/api/auth', authRouter);
app.use('/api/plans', plansRouter);
app.use('/api', accountRouter);
// 역할별 API. 각 라우트가 권한과 범위를 스스로 검사합니다 (docs/roles.md).
app.use('/api/producer', producerRouter);
app.use('/api/store', storeMgrRouter);
app.use('/api/admin', adminRouter);
app.use('/api/tour', tourRouter);
app.use('/api', catalogRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reviews', reviewsRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: String(err?.message || err) });
});

/**
 * 시군구 코드는 .env 에 하드코딩되어 있습니다.
 * 기동 시 실제 코드표와 대조해서 틀렸으면 바로 알려줍니다.
 * (조용히 엉뚱한 지역 데이터를 보여주는 것이 가장 나쁜 실패 모드라서요.)
 */
async function verifySigungu() {
  if (!hasTourKey()) return;
  try {
    const { items } = await areaCodeList(config.tour.areaCode);
    const byCode = new Map(items.map((i) => [String(i.code), i.name]));
    for (const [region, code] of Object.entries(config.tour.sigungu)) {
      const actual = byCode.get(String(code));
      if (!actual) {
        console.warn(`  ! 시군구 코드 ${code}(${region}) 가 areaCode=${config.tour.areaCode} 코드표에 없습니다.`);
      } else if (!actual.includes(region)) {
        console.warn(`  ! 시군구 코드 불일치: ${code} 는 "${region}" 이 아니라 "${actual}" 입니다. .env 를 고치세요.`);
      }
    }
  } catch (e) {
    console.warn(`  ! 시군구 코드 검증 실패: ${e.message}`);
    if (e.hint) console.warn(`    ${e.hint}`);
  }
}

/**
 * Vercel 에서는 이 모듈이 서버리스 함수로 감싸이므로 listen 하지 않습니다.
 * 로컬/컨테이너에서만 포트를 엽니다.
 */
const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  const db = await store.ensureLoaded();

  app.listen(config.port, async () => {
    console.log('');
    console.log('  HappyLocal server');
    console.log(`  http://localhost:${config.port}/happylocal_v2.html`);
    console.log('');
    console.log(`  TourAPI    : ${hasTourKey() ? config.tour.base : '미설정 — 시드 데이터로 동작'}`);
    console.log(`  데이터     : 상품 ${db.products.length} · 거점 ${db.stores.length} · 주문 ${db.orders.length}`);
    console.log(`  저장소     : ${store.backendName() === ('kv') ? 'Vercel KV' : path.relative(process.cwd(), config.dbFile)}`);
    console.log(`  카카오     : 로그인 ${config.kakaoRestKey ? '설정됨' : '미설정'}`
      + `${config.kakaoRestKey ? ` (Client Secret ${config.kakaoClientSecret ? '있음' : '없음'})` : ''}`
      + ` · 지도 ${config.kakaoJsKey ? '설정됨' : '미설정'}`);
    console.log('');
    await verifySigungu();
  });
}

export default app;
