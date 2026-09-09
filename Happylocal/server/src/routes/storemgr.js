import express from 'express';
import { mutate, collections } from '../lib/store.js';
import { requireCan, myStores, ownsStore, ownsOrder, isSuperAdmin, scopeOf } from '../lib/roles.js';
import { pushStockLog, dayOf, today } from './producer.js';

export const router = express.Router();

/**
 * 매장 관리인 API.
 *
 * 이 시스템에서 유일하게 "매장에서 실제로 쓰이는" 기능입니다.
 * 손님이 예약코드를 대면 수령 확인을 찍고, 마감 후 안 온 건은 노쇼로 정리합니다.
 * 수령 확인이 없으면 completed 가 생기지 않아 정산과 통계가 전부 0으로 남습니다.
 *
 * 인터페이스는 docs/roles.md §6 을 따릅니다.
 */

/** 담당 거점에서 찾아갈 주문인가. 주문 → 상품 → placeKey 로 이어집니다. */
function storeKeyOfOrder(order, products) {
  const p = products.find((x) => x.id === order.productId);
  return p ? (p.placeKey || null) : null;
}

/** 매장 화면이 쓰는 모양. 연락처는 여기서만 열립니다 (수령 확인에 필요). */
function toPickup(o, products) {
  const p = products.find((x) => x.id === o.productId);
  return {
    orderId: o.id,
    code: o.code,
    storeKey: p ? p.placeKey : null,
    productId: o.productId,
    productName: o.productName,
    farm: o.farm,
    qty: o.qty,
    unitPrice: o.unitPrice,
    total: o.total,
    couponDiscount: o.couponDiscount || 0,
    status: o.status,
    buyerName: o.buyerName,
    phone: o.phone || '',
    pickupDate: o.pickupDate,
    hours: o.hours,
    createdAt: o.createdAt,
    completedAt: o.completedAt || null,
  };
}

/** 내 담당 거점 키들. */
function myKeys(user) {
  if (isSuperAdmin(user)) {
    return new Set(collections.products().map((p) => p.placeKey).filter(Boolean));
  }
  return new Set(scopeOf(user).storeKeys);
}

/** GET /api/store/pickups?storeKey=&date=&status= */
router.get('/pickups', requireCan('order:read:store'), (req, res) => {
  const products = collections.products();
  const keys = myKeys(req.user);
  const { storeKey, date, status } = req.query;

  if (storeKey && !ownsStore(req.user, String(storeKey))) {
    return res.status(404).json({ error: '매장을 찾을 수 없습니다.' });
  }

  let list = collections.orders().filter((o) => {
    const k = storeKeyOfOrder(o, products);
    return k && keys.has(k);
  });

  if (storeKey) list = list.filter((o) => storeKeyOfOrder(o, products) === String(storeKey));
  if (date) list = list.filter((o) => dayOf(o.createdAt) === String(date));
  if (status) list = list.filter((o) => o.status === String(status));

  const pickups = list.map((o) => toPickup(o, products));
  // 아직 안 찾아간 것을 먼저, 그 다음 최신순.
  pickups.sort((a, b) =>
    (a.status === 'reserved' ? 0 : 1) - (b.status === 'reserved' ? 0 : 1)
    || String(b.createdAt).localeCompare(String(a.createdAt)));

  res.json({ count: pickups.length, pickups });
});

/** GET /api/store/pickups/lookup?code=HL-1234 - 손님이 댄 코드 한 건 */
router.get('/pickups/lookup', requireCan('order:read:store'), (req, res) => {
  const code = String(req.query.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: '예약코드를 입력해 주세요.' });

  const products = collections.products();

  // 같은 코드가 여럿일 수 있으니(과거 데이터) 내 담당 것만 남기고 봅니다.
  // 아무거나 집으면 다른 손님의 예약을 수령 확인해 줄 수 있습니다.
  const hits = collections.orders()
    .filter((x) => String(x.code).toUpperCase() === code)
    .filter((x) => ownsOrder(req.user, x));

  // 없는 코드와 남의 매장 코드를 구분해 주지 않습니다.
  if (!hits.length) {
    return res.status(404).json({ error: '해당 예약을 찾을 수 없습니다.', code: 'NOT_FOUND' });
  }

  // 아직 안 찾아간 건이 하나뿐이면 그것으로 확정합니다.
  const waiting = hits.filter((x) => x.status === 'reserved');
  if (waiting.length > 1) {
    return res.status(409).json({
      error: '같은 코드의 예약이 여러 건입니다. 예약자 이름으로 확인해 주세요.',
      code: 'AMBIGUOUS',
      pickups: waiting.map((x) => toPickup(x, products)),
    });
  }
  res.json({ pickup: toPickup(waiting[0] || hits[0], products) });
});

/** POST /api/store/pickups/:orderId/complete - 수령 확인 */
router.post('/pickups/:orderId/complete', requireCan('order:complete'), async (req, res) => {
  const result = await mutate((db) => {
    const o = db.orders.find((x) => x.id === req.params.orderId);
    if (!o || !ownsOrder(req.user, o)) {
      return { status: 404, body: { error: '예약을 찾을 수 없습니다.' } };
    }
    if (o.status !== 'reserved') {
      return {
        status: 409,
        body: { error: `이미 처리된 예약입니다 (${o.status}).`, code: 'ALREADY_SETTLED' },
      };
    }
    o.status = 'completed';
    o.completedAt = new Date().toISOString();
    o.completedBy = req.user.id;
    // 재고는 예약 시점에 이미 빠졌으므로 여기서는 건드리지 않습니다.
    return { status: 200, body: { order: o } };
  });

  res.status(result.status).json(result.body);
});

/**
 * POST /api/store/pickups/:orderId/noshow  { restock: boolean, note? }
 *
 * 재고 복구는 관리인이 정합니다. 신선식품은 하루 지나면 폐기라 되돌리면
 * 팔 수 없는 물건이 재고에 잡힙니다.
 */
router.post('/pickups/:orderId/noshow', requireCan('order:noshow'), async (req, res) => {
  const { restock = false, note = '' } = req.body || {};

  const result = await mutate((db) => {
    const o = db.orders.find((x) => x.id === req.params.orderId);
    if (!o || !ownsOrder(req.user, o)) {
      return { status: 404, body: { error: '예약을 찾을 수 없습니다.' } };
    }
    if (o.status !== 'reserved') {
      return {
        status: 409,
        body: { error: `이미 처리된 예약입니다 (${o.status}).`, code: 'ALREADY_SETTLED' },
      };
    }
    o.status = 'noshow';
    o.noshowAt = new Date().toISOString();
    o.noshowBy = req.user.id;
    o.noshowRestocked = !!restock;

    let product = null;
    if (restock) {
      product = db.products.find((x) => x.id === o.productId);
      if (product) {
        const before = product.stock;
        product.stock = before + o.qty;
        pushStockLog(db, {
          productId: product.id, actorId: req.user.id, type: 'noshow',
          before, after: product.stock, note: note || `노쇼 복구 (${o.code})`,
        });
      }
    }
    // 노쇼는 손님 사정이라 쿠폰은 돌려주지 않습니다 (취소와 다른 점).
    return { status: 200, body: { order: o, product } };
  });

  res.status(result.status).json(result.body);
});

/** POST /api/store/products/:id/adjust  { delta, note } - 파손·폐기 등 (사유 필수) */
router.post('/products/:id/adjust', requireCan('product:restock'), async (req, res) => {
  const delta = Number((req.body || {}).delta);
  const note = String((req.body || {}).note || '').trim();

  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: '조정 수량은 0 이 아닌 정수여야 합니다.' });
  }
  if (!note) {
    return res.status(400).json({ error: '조정 사유를 적어 주세요.', code: 'NOTE_REQUIRED' });
  }

  const result = await mutate((db) => {
    const p = db.products.find((x) => x.id === req.params.id);
    if (!p || !p.placeKey || !ownsStore(req.user, p.placeKey)) {
      return { status: 404, body: { error: '상품을 찾을 수 없습니다.' } };
    }
    const before = p.stock;
    const after = before + delta;
    if (after < 0) {
      return {
        status: 409,
        body: { error: `재고보다 많이 뺄 수 없습니다. 현재 ${before}개.`, available: before },
      };
    }
    p.stock = after;
    const log = pushStockLog(db, {
      productId: p.id, actorId: req.user.id, type: 'adjust', before, after, note,
    });
    return { status: 200, body: { product: p, log } };
  });

  res.status(result.status).json(result.body);
});

/** GET /api/store/summary?storeKey=&date= - 일일 마감 */
router.get('/summary', requireCan('store:stats'), (req, res) => {
  const products = collections.products();
  const keys = myKeys(req.user);
  const d = String(req.query.date || today());
  const storeKey = req.query.storeKey ? String(req.query.storeKey) : null;

  if (storeKey && !ownsStore(req.user, storeKey)) {
    return res.status(404).json({ error: '매장을 찾을 수 없습니다.' });
  }

  const list = collections.orders().filter((o) => {
    const k = storeKeyOfOrder(o, products);
    if (!k || !keys.has(k)) return false;
    if (storeKey && k !== storeKey) return false;
    return dayOf(o.createdAt) === d;
  });

  const done = list.filter((o) => o.status === 'completed');
  res.json({
    date: d,
    storeKey,
    reserved: list.filter((o) => o.status === 'reserved').length,
    completed: done.length,
    cancelled: list.filter((o) => o.status === 'cancelled').length,
    noshow: list.filter((o) => o.status === 'noshow').length,
    revenue: done.reduce((a, o) => a + o.total, 0),
    qty: done.reduce((a, o) => a + o.qty, 0),
  });
});

/** GET /api/store/mine - 내가 맡은 거점과 그 안의 상품 */
router.get('/mine', requireCan('order:read:store'), (req, res) => {
  const places = (collections.content && collections.content().PLACES) || {};
  const products = collections.products();
  const stores = myStores(req.user);

  res.json({
    stores: stores.map((s) => {
      const pl = places[s.key] || {};
      return {
        key: s.key,
        name: pl.nm || s.key,
        addr: s.addr || '',
        region: s.rg || '',
        hours: pl.hours || '',
        closed: !!s.off,
        products: products.filter((p) => p.placeKey === s.key)
          .map((p) => ({ id: p.id, name: p.name, farm: p.farm, stock: p.stock })),
      };
    }),
  });
});

/** PATCH /api/store/:storeKey - 운영시간 · 휴무 */
router.patch('/:storeKey', requireCan('store:write'), async (req, res) => {
  const key = String(req.params.storeKey);
  if (!ownsStore(req.user, key)) {
    return res.status(404).json({ error: '매장을 찾을 수 없습니다.' });
  }
  const { hours, closed, notice } = req.body || {};

  const result = await mutate((db) => {
    const s = db.stores.find((x) => x.key === key);
    if (!s) return { status: 404, body: { error: '매장을 찾을 수 없습니다.' } };
    if (closed !== undefined) s.off = !!closed;
    if (notice !== undefined) s.notice = String(notice).slice(0, 200);

    if (hours !== undefined) {
      // 운영시간은 화면이 PLACES 에서 읽으므로 그쪽도 같이 고칩니다.
      if (!db.content) db.content = {};
      if (!db.content.PLACES) db.content.PLACES = {};
      const pl = db.content.PLACES[key];
      if (pl) db.content.PLACES[key] = { ...pl, hours: String(hours).slice(0, 40) };
    }
    return { status: 200, body: { store: s } };
  });

  res.status(result.status).json(result.body);
});
