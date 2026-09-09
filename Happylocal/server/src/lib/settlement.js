/**
 * 정산.
 *
 * 지금까지는 "얼마 팔렸다" 는 집계만 있고, 그 돈을 누구에게 언제 얼마나
 * 주는지가 없었습니다. 로컬푸드 직매장은 수수료를 떼고 농가에 정산하는 구조라
 * 이게 없으면 실제로 운영할 수 없습니다.
 *
 * 정산 대상은 손님이 실제로 찾아간 주문(completed)뿐입니다.
 * 예약만 하고 안 찾아간 것(reserved · noshow)과 취소는 돈이 오가지 않습니다.
 */

/** 기본 수수료율. 지역 로컬푸드 직매장 통상 범위(8~12%) 안에서 잡았습니다. */
export const DEFAULT_FEE_RATE = 0.1;

const day = (iso) => String(iso || '').slice(0, 10);

/** 정산 대상 주문인가. */
export const isSettleable = (o) => o.status === 'completed';

/**
 * 기간 안의 completed 주문을 생산자별로 묶습니다.
 * @param {object[]} orders
 * @param {object[]} products
 * @param {{from:string, to:string, feeRate?:number}} opt
 */
export function buildStatements(orders, products, opt) {
  const from = String(opt.from || '0000-00-00');
  const to = String(opt.to || '9999-99-99');
  const feeRate = Number.isFinite(opt.feeRate) ? opt.feeRate : DEFAULT_FEE_RATE;

  const byProduct = new Map(products.map((p) => [p.id, p]));
  const groups = new Map();

  for (const o of orders) {
    if (!isSettleable(o)) continue;
    const d = day(o.completedAt || o.createdAt);
    if (d < from || d > to) continue;

    const p = byProduct.get(o.productId);
    // 생산자 계정이 아직 안 붙었으면 농가 이름으로 묶어 둡니다.
    // 그래야 나중에 계정을 연결했을 때 과거 정산이 비어 있지 않습니다.
    const key = (p && p.producerId) || `farm:${o.farm || (p && p.farm) || '미지정'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        producerId: (p && p.producerId) || null,
        farm: o.farm || (p && p.farm) || '미지정',
        placeKey: (p && p.placeKey) || null,
        orders: [],
      });
    }
    groups.get(key).orders.push(o);
  }

  return Array.from(groups.values()).map((g) => {
    // 쿠폰 할인은 플랫폼 부담이라 농가 몫에서 빼지 않습니다.
    // (그러지 않으면 쿠폰을 쓸수록 농가가 손해를 봅니다.)
    const gross = g.orders.reduce((a, o) => a + o.unitPrice * o.qty, 0);
    const coupon = g.orders.reduce((a, o) => a + (o.couponDiscount || 0), 0);
    const fee = Math.round(gross * feeRate);
    return {
      ...g,
      from, to, feeRate,
      count: g.orders.length,
      qty: g.orders.reduce((a, o) => a + o.qty, 0),
      gross,                       // 판매가 합계 (쿠폰 적용 전)
      coupon,                      // 플랫폼이 부담한 할인
      fee,                         // 수수료
      net: gross - fee,            // 농가에 지급할 금액
      paid: g.orders.reduce((a, o) => a + o.total, 0),   // 손님이 실제로 낸 돈
      orderIds: g.orders.map((o) => o.id),
    };
  }).sort((a, b) => b.net - a.net);
}

/** 여러 정산서를 한 줄로 합칩니다. 관리자 화면 상단 요약용입니다. */
export function totals(statements) {
  return statements.reduce((a, s) => ({
    count: a.count + s.count,
    qty: a.qty + s.qty,
    gross: a.gross + s.gross,
    coupon: a.coupon + s.coupon,
    fee: a.fee + s.fee,
    net: a.net + s.net,
    paid: a.paid + s.paid,
  }), { count: 0, qty: 0, gross: 0, coupon: 0, fee: 0, net: 0, paid: 0 });
}

/** 지난달 1일 ~ 말일. 정산 주기의 기본값입니다. */
export function lastMonthRange(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();               // 0-based
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { from: fmt(start), to: fmt(end) };
}

/** 이번 달 1일 ~ 오늘. */
export function thisMonthRange(now = new Date()) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    from: fmt(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))),
    to: fmt(now),
  };
}
