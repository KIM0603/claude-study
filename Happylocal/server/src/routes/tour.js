import express from 'express';
import { config, CONTENT_TYPE, hasTourKey } from '../config.js';
import {
  areaBasedList, searchFestival, detailCommon, detailIntro, detailImages,
  areaCodeList, TourApiError, tourCache,
} from '../lib/tourapi.js';
import { toPlace, enrichWithIntro } from '../lib/adapt.js';
import { requireCan } from '../lib/roles.js';

export const router = express.Router();

function fail(res, err) {
  if (err instanceof TourApiError) {
    return res.status(err.code === 'NO_KEY' ? 503 : 502).json({
      error: err.message, code: err.code, hint: err.hint, endpoint: err.endpoint,
    });
  }
  console.error(err);
  return res.status(500).json({ error: String(err?.message || err) });
}

/** GET /api/tour/status - 키 설정 여부와 캐시 상태 */
router.get('/status', (_req, res) => {
  res.json({
    configured: hasTourKey(),
    base: config.tour.base,
    areaCode: config.tour.areaCode,
    sigungu: config.tour.sigungu,
    cache: tourCache.stats(),
  });
});

/** GET /api/tour/sigungu - 실제 시군구 코드표 (하드코딩 검증용) */
router.get('/sigungu', async (_req, res) => {
  try {
    const { items } = await areaCodeList(config.tour.areaCode);
    res.json({
      areaCode: config.tour.areaCode,
      configured: config.tour.sigungu,
      actual: items.map((i) => ({ code: String(i.code), name: i.name })),
    });
  } catch (err) { fail(res, err); }
});

/**
 * GET /api/tour/places?region=횡성&type=tour|festival|food&limit=30
 * 지역기반 관광정보를 프론트 shape(PLACES/GEO)으로 변환해 돌려줍니다.
 */
router.get('/places', async (req, res) => {
  const region = String(req.query.region || '');
  const type = String(req.query.type || 'tour');
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const sigunguCode = config.tour.sigungu[region];
  if (region && !sigunguCode) {
    return res.status(400).json({
      error: `알 수 없는 지역: ${region}`,
      hint: `지원 지역: ${Object.keys(config.tour.sigungu).join(', ')}`,
    });
  }

  const contentTypeId = {
    tour: CONTENT_TYPE.TOURIST,
    festival: CONTENT_TYPE.FESTIVAL,
    food: CONTENT_TYPE.FOOD,
    culture: CONTENT_TYPE.CULTURE,
    leports: CONTENT_TYPE.LEPORTS,
    shopping: CONTENT_TYPE.SHOPPING,
  }[type];

  if (!contentTypeId) {
    return res.status(400).json({ error: `알 수 없는 type: ${type}` });
  }

  try {
    const { items, totalCount } = await areaBasedList({ sigunguCode, contentTypeId, numOfRows: limit });
    const PLACES = {};
    const GEO = {};
    let skipped = 0;

    for (const item of items) {
      const conv = toPlace(item);
      if (!conv) { skipped++; continue; }   // 좌표 없는 항목은 지도에 못 올립니다
      PLACES[conv.key] = conv.place;
      GEO[conv.key] = conv.geo;
    }

    res.json({ region, type, totalCount, count: Object.keys(PLACES).length, skipped, PLACES, GEO });
  } catch (err) { fail(res, err); }
});

/** GET /api/tour/festivals?region=평창&from=20250101 */
router.get('/festivals', async (req, res) => {
  const region = String(req.query.region || '');
  const sigunguCode = config.tour.sigungu[region];
  const from = String(req.query.from || new Date().toISOString().slice(0, 10).replace(/-/g, ''));

  try {
    const { items, totalCount } = await searchFestival({ sigunguCode, eventStartDate: from });
    const PLACES = {}, GEO = {};
    for (const item of items) {
      const conv = toPlace({ ...item, contenttypeid: CONTENT_TYPE.FESTIVAL });
      if (!conv) continue;
      PLACES[conv.key] = conv.place;
      GEO[conv.key] = conv.geo;
    }
    res.json({ region, from, totalCount, count: Object.keys(PLACES).length, PLACES, GEO });
  } catch (err) { fail(res, err); }
});

/** GET /api/tour/detail/:contentId?contentTypeId=12 - 상세 + 소개 + 이미지 */
router.get('/detail/:contentId', async (req, res) => {
  const { contentId } = req.params;
  const contentTypeId = String(req.query.contentTypeId || '');

  try {
    const [common, images] = await Promise.all([
      detailCommon(contentId),
      detailImages(contentId).catch(() => ({ items: [] })),
    ]);

    const item = common.items[0];
    if (!item) return res.status(404).json({ error: '해당 콘텐츠를 찾을 수 없습니다.', contentId });

    const conv = toPlace({ ...item, contenttypeid: contentTypeId || item.contenttypeid });
    const place = conv?.place || null;

    if (place && (contentTypeId || item.contenttypeid)) {
      try {
        const intro = await detailIntro(contentId, contentTypeId || item.contenttypeid);
        enrichWithIntro(place, intro.items[0], contentTypeId || item.contenttypeid);
      } catch {
        // detailIntro 는 일부 콘텐츠에서 비어 있습니다. 상세 자체는 계속 내려줍니다.
      }
    }

    res.json({
      contentId,
      place,
      geo: conv?.geo || null,
      images: images.items.map((i) => i.originimgurl).filter(Boolean),
    });
  } catch (err) { fail(res, err); }
});

/** POST /api/tour/cache/clear */
router.post('/cache/clear', requireCan('tour:admin'), (_req, res) => {
  tourCache.clear();
  res.json({ ok: true, cache: tourCache.stats() });
});
