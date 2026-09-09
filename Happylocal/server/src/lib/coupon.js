/**
 * 쿠폰 할인 계산.
 *
 * 화면에는 "20%", "5,000원" 처럼 사람이 읽는 문자열만 있었고,
 * 결제는 PAY_COUPON=3000 이라는 고정값을 빼고 있었습니다.
 * 보유 쿠폰과 무관하게 늘 3,000원이 빠지던 것을 실제 계산으로 바꿉니다.
 */

const num = (s) => Number(String(s || '').replace(/[^0-9.]/g, '')) || 0;

/** "20%" -> {type:'percent', value:20} · "5,000원" -> {type:'amount', value:5000} */
export function parseRule(coupon) {
  const pct = String(coupon.pct || '').trim();
  if (pct.includes('%')) return { type: 'percent', value: num(pct) };
  if (pct) return { type: 'amount', value: num(pct) };
  return { type: 'amount', value: 0 };
}

/**
 * 조건 문자열에서 상한·최소금액을 읽습니다.
 *   "전 지역 · 최대 8,000원 할인"      -> max 8000
 *   "5,000원 즉시 할인 · 3만원 이상"   -> min 30000
 *   "횡성 매장 전용"                   -> region '횡성'
 */
export function parseCondition(coupon) {
  const c = String(coupon.cond || '');
  const out = { max: 0, min: 0, region: '' };

  const max = /최대\s*([\d,]+)\s*원/.exec(c);
  if (max) out.max = num(max[1]);

  const minMan = /([\d,]+)\s*만원\s*이상/.exec(c);
  if (minMan) out.min = num(minMan[1]) * 10000;
  else {
    const minWon = /([\d,]+)\s*원\s*이상/.exec(c);
    if (minWon) out.min = num(minWon[1]);
  }

  const rg = /(횡성|평창|정선)\s*(?:지역|매장)/.exec(c);
  if (rg) out.region = rg[1];

  return out;
}

/**
 * 이 쿠폰을 지금 주문에 쓸 수 있는지, 쓰면 얼마가 빠지는지.
 * @param {object} coupon
 * @param {{amount:number, region?:string}} order
 */
export function evaluate(coupon, order) {
  const amount = Number(order.amount) || 0;
  const rule = parseRule(coupon);
  const cond = parseCondition(coupon);

  if (coupon.used) return { usable: false, discount: 0, reason: '이미 사용한 쿠폰이에요.' };
  if (cond.min && amount < cond.min) {
    return { usable: false, discount: 0, reason: `${cond.min.toLocaleString('ko-KR')}원 이상 주문에만 쓸 수 있어요.` };
  }
  if (cond.region && order.region && order.region !== cond.region) {
    return { usable: false, discount: 0, reason: `${cond.region} 매장에서만 쓸 수 있어요.` };
  }

  let discount = rule.type === 'percent'
    ? Math.floor(amount * rule.value / 100)
    : rule.value;

  if (cond.max) discount = Math.min(discount, cond.max);
  discount = Math.min(discount, amount);          // 결제액보다 많이 깎을 수 없습니다

  if (discount <= 0) return { usable: false, discount: 0, reason: '이 주문에는 할인이 적용되지 않아요.' };
  return { usable: true, discount, reason: '' };
}

/** 주문 금액 기준으로 쿠폰 목록에 사용 가능 여부와 할인액을 붙입니다. */
export function annotate(coupons, order) {
  return coupons.map((c) => {
    const e = evaluate(c, order);
    return { ...c, usable: e.usable, discount: e.discount, reason: e.reason };
  });
}

/** 가장 많이 깎이는 쿠폰을 고릅니다. */
export function bestCoupon(coupons, order) {
  const ok = annotate(coupons, order).filter((c) => c.usable);
  if (!ok.length) return null;
  return ok.sort((a, b) => b.discount - a.discount)[0];
}
