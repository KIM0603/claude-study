import express from 'express';
import crypto from 'node:crypto';
import { mutate, collections } from '../lib/store.js';
import { requireCan, myProducts, ownsProduct, isSuperAdmin } from '../lib/roles.js';
import { buildStatements, totals, lastMonthRange, thisMonthRange, DEFAULT_FEE_RATE } from '../lib/settlement.js';

export const router = express.Router();

/**
 * 생산자(농가) API.
 *
 * 지금까지 재고는 시드값에서 시작해 주문으로 줄어들기만 했습니다.
 * 다시 채울 경로가 없어서 며칠이면 전 상품이 품절됩니다.
 * 오늘 출하 등록이 그 구멍을 막습니다.
 *
 * 인터페이스는 docs/roles.md §6 을 따릅니다.
 */

const logId = () => 'sl_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/** 재고를 바꿀 때마다 이유를 남깁니다. 없으면 "왜 3개죠?" 에 답할 수 없습니다. */
function pushStockLog(db, { productId, actorId, type, before, after, note }) {
  const log = {
    id: logId(),
    productId, actorId, type,
    delta: after - before, before, after,
    note: String(note || '').slice(0, 200),
    at: new Date().toISOString(),
  };
  if (!db.stockLogs) db.stockLogs = [];
  db.stockLogs.push(log);
  return log;
}

/** 오늘(로컬 기준) 날짜 문자열. */
const dayOf = (iso) => String(iso || '').slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

/** GET /api/producer/products - 내 상품과 오늘 상황 */
router.get('/products', requireCan('product:write'), (req, res) => {
  const mine = myProducts(req.user);
  const orders = collections.orders();
  const d = String(req.query.date || today());

  const list = mine.map((p) => {
    const forP = orders.filter((o) => o.productId === p.id);
    const todays = forP.filter((o) => dayOf(o.createdAt) === d);
    return {
      id: p.id,
      name: p.name,
      farm: p.farm,
      region: p.region,
      placeKey: p.placeKey || null,
      priceWas: p.priceWas,
      priceNow: p.priceNow,
      discount: p.discount,
      stock: p.stock,
      initialStock: p.initialStock,
      hours: p.hours,
      pickupDay: p.pickupDay,
      mode: p.mode,
      // 오늘 들어온 예약과, 아직 안 찾아간 건수
      todayOrders: todays.filter((o) => o.status !== 'cancelled').length,
      todayQty: todays.filter((o) => o.status !== 'cancelled').reduce((a, o) => a + o.qty, 0),
      waiting: forP.filter((o) => o.status === 'reserved').length,
      waitingQty: forP.filter((o) => o.status === 'reserved').reduce((a, o) => a + o.qty, 0),
    };
  });

  res.json({ date: d, count: list.length, products: list });
});

/**
 * POST /api/producer/products/:id/restock  { qty, note? }
 * 오늘 낼 물량을 재고에 더합니다.
 */
router.post('/products/:id/restock', requireCan('product:restock'), async (req, res) => {
  const qty = Number((req.body || {}).qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) {
    return res.status(400).json({ error: '출하 수량은 1 이상 9999 이하의 정수여야 합니다.' });
  }

  const result = await mutate((db) => {
    const p = db.products.find((x) => x.id === req.params.id);
    // 범위 밖이면 존재 여부까지 숨깁니다.
    if (!p || !ownsProduct(req.user, p)) {
      return { status: 404, body: { error: '상품을 찾을 수 없습니다.' } };
    }
    const before = p.stock;
    p.stock = before + qty;
    // 오늘 낼 수 있는 최대치를 재고의 최고점으로 잡아 둡니다 (표시용).
    if (p.stock > (p.initialStock || 0)) p.initialStock = p.stock;

    const log = pushStockLog(db, {
      productId: p.id, actorId: req.user.id, type: 'restock',
      before, after: p.stock, note: (req.body || {}).note,
    });
    return { status: 200, body: { product: p, log } };
  });

  res.status(result.status).json(result.body);
});

/**
 * PATCH /api/producer/products/:id
 * 가격·픽업 시간만 바꿉니다. 재고는 restock/adjust 로만 움직입니다.
 */
router.patch('/products/:id', requireCan('product:write'), async (req, res) => {
  const { priceWas, priceNow, hours, pickupDay } = req.body || {};

  if (priceNow !== undefined && (!Number.isFinite(Number(priceNow)) || Number(priceNow) < 0)) {
    return res.status(400).json({ error: '판매가가 올바르지 않습니다.' });
  }
  if (priceWas !== undefined && (!Number.isFinite(Number(priceWas)) || Number(priceWas) < 0)) {
    return res.status(400).json({ error: '정가가 올바르지 않습니다.' });
  }

  const result = await mutate((db) => {
    const p = db.products.find((x) => x.id === req.params.id);
    if (!p || !ownsProduct(req.user, p)) {
      return { status: 404, body: { error: '상품을 찾을 수 없습니다.' } };
    }
    const was = priceWas !== undefined ? Number(priceWas) : p.priceWas;
    const now = priceNow !== undefined ? Number(priceNow) : p.priceNow;
    if (now > was) {
      return { status: 400, body: { error: '판매가가 정가보다 높을 수 없습니다.' } };
    }
    p.priceWas = was;
    p.priceNow = now;
    p.discount = was > 0 ? Math.round((1 - now / was) * 100) : 0;
    if (hours !== undefined) p.hours = String(hours).slice(0, 40);
    if (pickupDay !== undefined) p.pickupDay = String(pickupDay).slice(0, 20);
    return { status: 200, body: { product: p } };
  });

  res.status(result.status).json(result.body);
});

/** GET /api/producer/orders?date=&status= - 내 상품의 주문만 */
router.get('/orders', requireCan('order:read:product'), (req, res) => {
  const ids = new Set(myProducts(req.user).map((p) => p.id));
  const { date, status } = req.query;

  let list = collections.orders().filter((o) => ids.has(o.productId));
  if (date) list = list.filter((o) => dayOf(o.createdAt) === String(date));
  if (status) list = list.filter((o) => o.status === String(status));

  res.json({
    count: list.length,
    // 생산자는 수량만 알면 됩니다. 손님 연락처는 매장 관리인에게만 열립니다.
    orders: list.slice().reverse().map((o) => ({
      id: o.id, code: o.code, productId: o.productId, productName: o.productName,
      qty: o.qty, total: o.total, status: o.status,
      pickupDate: o.pickupDate, createdAt: o.createdAt,
    })),
  });
});

/** GET /api/producer/summary?from=&to= - 판매 집계 (정산은 completed 만) */
router.get('/summary', requireCan('producer:stats'), (req, res) => {
  const mine = myProducts(req.user);
  const ids = new Set(mine.map((p) => p.id));
  const from = String(req.query.from || '0000-00-00');
  const to = String(req.query.to || '9999-99-99');

  const list = collections.orders()
    .filter((o) => ids.has(o.productId))
    .filter((o) => dayOf(o.createdAt) >= from && dayOf(o.createdAt) <= to);

  const done = list.filter((o) => o.status === 'completed');
  const byProduct = mine.map((p) => {
    const d = done.filter((o) => o.productId === p.id);
    return {
      id: p.id, name: p.name,
      qty: d.reduce((a, o) => a + o.qty, 0),
      revenue: d.reduce((a, o) => a + o.total, 0),
      stock: p.stock,
    };
  }).sort((a, b) => b.revenue - a.revenue);

  res.json({
    from, to,
    reserved: list.filter((o) => o.status === 'reserved').length,
    completed: done.length,
    cancelled: list.filter((o) => o.status === 'cancelled').length,
    noshow: list.filter((o) => o.status === 'noshow').length,
    // 정산은 실제로 찾아간 것만 셉니다.
    revenue: done.reduce((a, o) => a + o.total, 0),
    qty: done.reduce((a, o) => a + o.qty, 0),
    byProduct,
  });
});

/**
 * GET /api/producer/settlement?from=&to=
 * 내 정산서. 손님이 실제로 찾아간 주문만 셉니다.
 */
router.get('/settlement', requireCan('producer:stats'), (req, res) => {
  const range = (req.query.from || req.query.to)
    ? { from: req.query.from, to: req.query.to }
    : thisMonthRange();

  const ids = new Set(myProducts(req.user).map((p) => p.id));
  const orders = collections.orders().filter((o) => ids.has(o.productId));
  const list = buildStatements(orders, collections.products(), range);

  // 내 것만 남깁니다 (계정이 안 붙은 농가 묶음도 담당 상품 기준이라 안전합니다).
  res.json({
    ...range,
    feeRate: DEFAULT_FEE_RATE,
    statements: list,
    total: totals(list),
  });
});

/** GET /api/producer/stocklogs?productId= - 재고가 왜 그 숫자인지 */
router.get('/stocklogs', requireCan('product:write'), (req, res) => {
  const ids = new Set(myProducts(req.user).map((p) => p.id));
  let list = collections.stockLogs().filter((l) => ids.has(l.productId));
  if (req.query.productId) list = list.filter((l) => l.productId === String(req.query.productId));
  res.json({ count: list.length, logs: list.slice(-100).reverse() });
});

export { pushStockLog, dayOf, today };
