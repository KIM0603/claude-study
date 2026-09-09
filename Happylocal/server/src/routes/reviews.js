import express from 'express';
import crypto from 'node:crypto';
import { mutate, collections } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

export const router = express.Router();

const newId = () => 'rv_' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');

/** 저장 형태를 프론트가 렌더링하는 모양 그대로 씁니다 (shop/prod/stars/date/txt/photos). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/** 상점명으로 stores 레코드를 찾습니다. 리뷰 작성 시 매장 평점을 다시 계산하는 데 씁니다. */
function findStore(db, { storeKey, shop }) {
  if (storeKey) {
    const hit = db.stores.find((s) => s.key === storeKey);
    if (hit) return hit;
  }
  if (!shop) return null;
  return db.stores.find((s) => s.name === shop)
    || db.stores.find((s) => (s.name || '').includes(shop) || shop.includes(s.name || ''))
    || null;
}

/**
 * 매장 평점 = 기존 누적(baseRating/baseCount) + 이 앱에서 작성된 후기.
 *
 * 작성된 후기만으로 다시 계산하면 4.8(124건) 짜리 매장이 후기 하나에
 * 5.0(1건) 이 되어버립니다. 기준선을 가중 평균에 넣어 그걸 막습니다.
 */
function recalcStore(db, store) {
  if (!store) return;
  const mine = db.reviews.filter((r) => r.storeKey === store.key);
  const baseCount = Number(store.baseCount) || 0;
  const baseRating = Number(store.baseRating) || 0;

  const sum = baseRating * baseCount + mine.reduce((a, r) => a + (Number(r.stars) || 0), 0);
  const count = baseCount + mine.length;
  if (!count) return;

  store.rating = Math.round((sum / count) * 10) / 10;
  store.reviewCount = count;
}

/** GET /api/reviews?shop=... */
router.get('/', async (req, res) => {
  const { shop, storeKey, mine } = req.query;
  let list = collections.reviews();
  // mine=1 이면 내가 쓴 것만. 매장 후기 조회는 로그인 없이도 볼 수 있습니다.
  if (mine === '1') {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
    list = list.filter((r) => r.userId === req.user.id);
  }
  if (storeKey) list = list.filter((r) => r.storeKey === storeKey);
  if (shop) list = list.filter((r) => r.shop === shop);
  res.json({ count: list.length, reviews: list });
});

/**
 * POST /api/reviews
 * body: { shop, prod?, stars, txt, photos?, storeKey? }
 */
router.post('/', requireAuth, async (req, res) => {
  const { shop = '', prod = '', stars, txt = '', photos = [], storeKey = '' } = req.body || {};
  const n = Number(stars);

  if (!shop.trim()) return res.status(400).json({ error: '매장명(shop)이 필요합니다.' });
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    return res.status(400).json({ error: '별점(stars)은 1~5 사이의 정수여야 합니다.' });
  }
  if (!String(txt).trim()) return res.status(400).json({ error: '후기 내용이 비어 있습니다.' });

  const result = await mutate((db) => {
    const store = findStore(db, { storeKey, shop });
    const review = {
      id: newId(),
      userId: req.user.id,
      nickname: req.user.nickname,
      storeKey: store ? store.key : (storeKey || null),
      shop: shop.trim(),
      prod: String(prod).trim(),
      stars: n,
      date: today(),
      txt: String(txt).trim().slice(0, 1000),
      // 사진은 앱이 내장 이미지 인덱스를 쓰므로 숫자 배열을 그대로 받습니다.
      photos: Array.isArray(photos) ? photos.filter((x) => Number.isInteger(x)).slice(0, 6) : [],
      createdAt: new Date().toISOString(),
    };
    db.reviews.unshift(review);
    recalcStore(db, store);
    return { review, store: store ? { key: store.key, rating: store.rating, reviewCount: store.reviewCount } : null };
  });

  res.status(201).json(result);
});

/** DELETE /api/reviews/:id */
router.delete('/:id', requireAuth, async (req, res) => {
  const result = await mutate((db) => {
    const i = db.reviews.findIndex((r) => r.id === req.params.id && r.userId === req.user.id);
    if (i < 0) return { status: 404, body: { error: '후기를 찾을 수 없습니다.' } };
    const [removed] = db.reviews.splice(i, 1);
    recalcStore(db, findStore(db, { storeKey: removed.storeKey, shop: removed.shop }));
    return { status: 200, body: { removed } };
  });
  res.status(result.status).json(result.body);
});
