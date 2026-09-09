import express from 'express';
import crypto from 'node:crypto';
import { mutate, collections } from '../lib/store.js';
import { productToPL } from '../lib/adapt.js';
import { requireAuth } from '../lib/auth.js';
import { evaluate as evalCoupon } from '../lib/coupon.js';

export const router = express.Router();

/**
 * 예약코드.
 *
 * 원래는 'HL-' + 1000~9999 를 중복 검사 없이 뽑았습니다. 9,000개뿐이라
 * 주문이 쌓이면 반드시 겹치고(실제 237건에서 3쌍이 겹쳤습니다), 매장에서
 * 코드로 조회하면 다른 손님의 예약이 나올 수 있었습니다.
 * 자릿수를 늘리고, 기존 주문과 겹치지 않을 때까지 다시 뽑습니다.
 */
function makeCode(db) {
  const used = new Set((db.orders || []).map((o) => String(o.code).toUpperCase()));
  for (let i = 0; i < 60; i++) {
    const c = 'HL-' + crypto.randomInt(100000, 999999);
    if (!used.has(c)) return c;
  }
  // 여기까지 왔다면 공간이 좁아진 것입니다. 겹칠 수 없는 값으로 물러납니다.
  return 'HL-' + Date.now().toString(36).toUpperCase();
}
const id = () => 'od_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/** GET /api/orders */
router.get('/', requireAuth, async (req, res) => {
  res.json({ orders: collections.orders().filter((o) => o.userId === req.user.id) });
});

/**
 * POST /api/orders
 * body: { productId, qty, pickupDate?, buyerName?, phone? }
 *
 * 재고 확인과 차감을 하나의 mutate 안에서 처리합니다. Node 는 단일 스레드라
 * 이 콜백 내부에는 다른 요청이 끼어들 수 없어, 재고가 음수로 내려가지 않습니다.
 */
router.post('/', requireAuth, async (req, res) => {
  const { productId, qty = 1, pickupDate = null, buyerName = '', phone = '', couponId = null } = req.body || {};
  const n = Number(qty);

  if (!productId) return res.status(400).json({ error: 'productId 가 필요합니다.' });
  if (!Number.isInteger(n) || n < 1) return res.status(400).json({ error: 'qty 는 1 이상의 정수여야 합니다.' });

  const result = await mutate((db) => {
    const p = db.products.find((x) => x.id === productId);
    if (!p) return { status: 404, body: { error: `상품을 찾을 수 없습니다: ${productId}` } };
    if (p.stock < n) {
      return { status: 409, body: { error: '재고가 부족합니다.', available: p.stock, requested: n } };
    }

    // 쿠폰 검증은 재고 차감 전에 합니다. 실패하면 아무것도 바꾸지 않습니다.
    let coupon = null, discount = 0;
    if (couponId) {
      coupon = db.coupons.find((c) => c.id === couponId && c.userId === req.user.id);
      if (!coupon) return { status: 404, body: { error: '쿠폰을 찾을 수 없습니다.' } };
      const ev = evalCoupon(coupon, { amount: p.priceNow * n, region: p.region });
      if (!ev.usable) return { status: 409, body: { error: ev.reason || '이 쿠폰은 쓸 수 없습니다.' } };
      discount = ev.discount;
    }

    p.stock -= n;

    const order = {
      id: id(),
      code: makeCode(db),
      userId: req.user.id,
      productId: p.id,
      productName: p.name,
      farm: p.farm,
      region: p.region,
      qty: n,
      unitPrice: p.priceNow,
      unitPriceWas: p.priceWas,      // 화면에서 할인율을 계산하는 데 씁니다
      total: Math.max(0, p.priceNow * n - discount),
      couponId: coupon ? coupon.id : null,
      couponName: coupon ? String(coupon.nm || '').replace(/<br>/g, ' ') : '',
      couponDiscount: discount,
      saved: (p.priceWas - p.priceNow) * n,
      pickupDate: pickupDate || p.pickupDate || p.pickupDay || '오늘',
      hours: p.hours,
      buyerName: buyerName || req.user.nickname,
      phone,
      status: 'reserved',
      createdAt: new Date().toISOString(),
    };
    if (coupon) { coupon.used = true; coupon.usedAt = order.createdAt; coupon.orderId = order.id; }
    db.orders.push(order);
    return { status: 201, body: { order, product: productToPL(p) } };
  });

  res.status(result.status).json(result.body);
});

/** POST /api/orders/:id/cancel - 재고를 되돌립니다. */
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const result = await mutate((db) => {
    const o = db.orders.find((x) => x.id === req.params.id && x.userId === req.user.id);
    if (!o) return { status: 404, body: { error: '주문을 찾을 수 없습니다.' } };
    if (o.status === 'cancelled') return { status: 409, body: { error: '이미 취소된 주문입니다.' } };

    o.status = 'cancelled';
    o.cancelledAt = new Date().toISOString();

    // 쿠폰도 되돌려 줍니다. 안 그러면 취소했는데 쿠폰만 날아갑니다.
    if (o.couponId) {
      const c = db.coupons.find((x) => x.id === o.couponId);
      if (c) { c.used = false; delete c.usedAt; delete c.orderId; }
    }

    const p = db.products.find((x) => x.id === o.productId);
    if (p) p.stock += o.qty;                 // 재고 복구

    return { status: 200, body: { order: o, product: p ? productToPL(p) : null } };
  });

  res.status(result.status).json(result.body);
});

/** POST /api/orders/:id/complete - 픽업 완료 처리 */
router.post('/:id/complete', requireAuth, async (req, res) => {
  const result = await mutate((db) => {
    const o = db.orders.find((x) => x.id === req.params.id && x.userId === req.user.id);
    if (!o) return { status: 404, body: { error: '주문을 찾을 수 없습니다.' } };
    o.status = 'completed';
    o.completedAt = new Date().toISOString();
    return { status: 200, body: { order: o } };
  });
  res.status(result.status).json(result.body);
});
