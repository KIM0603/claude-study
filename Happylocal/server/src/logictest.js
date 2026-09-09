/**
 * 논리 검증 (Invariant tests).
 *
 *   npm run test:logic       # 서버가 떠 있어야 합니다
 *
 * 다른 테스트가 "동작하는가" 를 본다면, 여기서는 "결과가 옳은가" 를 봅니다.
 * 금액 계산, 재고 수지, 쿠폰 규칙, 평점 가중평균, 계정 격리처럼
 * 틀려도 화면은 멀쩡해 보이는 것들을 숫자로 따집니다.
 */
const PORT = process.env.PORT || 8787;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
let section = '';
const check = (ok, label, detail) => {
  console.log(`    ${ok ? '✓' : '✗'} ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};
const group = (t) => { section = t; console.log(`\n  [${t}]`); };

/** 계정마다 별도 쿠키를 들고 다닙니다. */
function makeClient() {
  let cookie = '';
  const call = async (p, opt = {}) => {
    const r = await fetch(`${BASE}${p}`, {
      ...opt,
      headers: { ...(opt.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    let body = null;
    try { body = await r.json(); } catch { /* 본문 없음 */ }
    return { status: r.status, body };
  };
  return {
    get: (p) => call(p),
    post: (p, b) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }),
    put: (p, b) => call(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }),
    del: (p) => call(p, { method: 'DELETE' }),
    login: (nickname) => call('/api/auth/dev-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname }),
    }),
  };
}

const won = (s) => Number(String(s ?? '').replace(/[^0-9.-]/g, '')) || 0;

const main = async () => {
  const A = makeClient();
  const rA = await A.login('논리검사 A');
  if (rA.status !== 200) { console.error('개발 로그인 실패'); process.exit(1); }

  const boot = (await A.get('/api/bootstrap')).body;
  const products = (await A.get('/api/products')).body.raw;

  // =============================================================
  group('금액 계산');
  // =============================================================
  {
    const t = products.find((p) => p.stock > 2);
    const qty = 2;
    const made = (await A.post('/api/orders', { productId: t.id, qty })).body;
    const o = made.order;

    check(o.unitPrice === t.priceNow, `단가가 상품가와 일치 (${o.unitPrice})`);
    check(o.total === o.unitPrice * qty - (o.couponDiscount || 0),
      `총액 = 단가×수량 − 쿠폰 (${o.unitPrice}×${qty}−${o.couponDiscount || 0}=${o.total})`);
    check(o.saved === (t.priceWas - t.priceNow) * qty,
      `절약액 = (정가−할인가)×수량 (${o.saved})`);
    check(o.total >= 0, '총액이 음수가 아님');

    // 화면에 내려가는 값과 서버 계산이 같은가
    const pick = (await A.get('/api/mypickups')).body.MY_PICKUPS.find((p) => p.code === o.code);
    check(won(pick.now) === o.unitPrice, `화면 단가와 서버 단가 일치 (${pick.now})`);
    check(won(pick.was) === t.priceWas, `화면 정가와 상품 정가 일치 (${pick.was})`);
    const expectedDisc = Math.round((1 - t.priceNow / t.priceWas) * 100);
    check(pick.disc === expectedDisc, `할인율 표시가 실제와 일치 (${pick.disc}% = ${expectedDisc}%)`);

    await A.post(`/api/orders/${o.id}/cancel`);
  }

  // =============================================================
  group('재고 수지');
  // =============================================================
  {
    const t = products.find((p) => p.stock >= 3);
    const before = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;

    const ids = [];
    for (const q of [1, 2]) {
      const r = await A.post('/api/orders', { productId: t.id, qty: q });
      if (r.body.order) ids.push(r.body.order.id);
    }
    const mid = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;
    check(mid === before - 3, `주문 수량만큼 정확히 차감 (${before} → ${mid})`);

    for (const id of ids) await A.post(`/api/orders/${id}/cancel`);
    const after = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;
    check(after === before, `취소 후 정확히 복구 (${after})`);

    // 재고보다 많이 주문하면 거부되고, 재고는 그대로여야 합니다.
    const over = await A.post('/api/orders', { productId: t.id, qty: before + 5 });
    const afterOver = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;
    check(over.status === 409, `초과 주문 거부 (HTTP ${over.status})`);
    check(afterOver === before, '거부된 주문이 재고를 건드리지 않음');
  }

  // =============================================================
  group('동시 주문 (초과 판매 방지)');
  // =============================================================
  {
    const t = (await A.get('/api/products')).body.raw.find((p) => p.stock >= 4);
    const before = t.stock;
    // 재고보다 많은 요청을 한꺼번에 던집니다.
    const tries = before + 3;
    const results = await Promise.all(
      Array.from({ length: tries }, () => A.post('/api/orders', { productId: t.id, qty: 1 }))
    );
    const ok = results.filter((r) => r.status === 201);
    const after = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;

    check(ok.length === before, `성공 주문 수 = 초기 재고 (${ok.length}/${before}, 시도 ${tries})`);
    check(after === 0, `재고 정확히 0 (${after})`);
    check(after >= 0, '재고가 음수로 내려가지 않음');

    for (const r of ok) await A.post(`/api/orders/${r.body.order.id}/cancel`);
    const restored = (await A.get('/api/products')).body.raw.find((p) => p.id === t.id).stock;
    check(restored === before, `정리 후 복구 (${restored})`);
  }

  // =============================================================
  group('쿠폰 규칙');
  // =============================================================
  {
    const t = products.find((p) => p.stock > 0 && p.priceNow >= 30000);
    const amount = t.priceNow;
    const list = (await A.get(`/api/coupons/usable?amount=${amount}&region=${encodeURIComponent(t.region)}`)).body.coupons;

    for (const c of list.filter((x) => x.usable)) {
      const pct = /%/.test(c.pct) ? Number(String(c.pct).replace(/[^0-9]/g, '')) : 0;
      const cap = /최대\s*([\d,]+)\s*원/.exec(c.cond || '');
      const expected = pct
        ? Math.min(Math.floor(amount * pct / 100), cap ? won(cap[1]) : Infinity)
        : won(c.pct);
      check(c.discount === Math.min(expected, amount),
        `${c.pct} 할인 계산 (${c.discount} = 기대 ${Math.min(expected, amount)})`);
      check(c.discount <= amount, '할인액이 주문액을 넘지 않음');
    }

    // 최소 주문금액 조건이 실제로 걸리는가
    const small = (await A.get('/api/coupons/usable?amount=1000')).body.coupons;
    const minCoupon = small.find((c) => /만원\s*이상|원\s*이상/.test(c.cond || ''));
    if (minCoupon) {
      check(!minCoupon.usable, `최소금액 미달 시 사용 불가 (${minCoupon.cond})`, minCoupon.reason);
    }

    // 지역 전용 쿠폰이 다른 지역에서 거부되는가
    const wrongRegion = (await A.get(`/api/coupons/usable?amount=${amount}&region=평창`)).body.coupons
      .find((c) => /횡성/.test(c.cond || ''));
    if (wrongRegion) check(!wrongRegion.usable, '지역 전용 쿠폰이 타 지역에서 거부됨', wrongRegion.reason);

    // 사용한 쿠폰은 다시 쓸 수 없어야 합니다.
    const usable = list.find((c) => c.usable);
    const ord = (await A.post('/api/orders', { productId: t.id, qty: 1, couponId: usable.id })).body;
    check(ord.order.couponDiscount === usable.discount,
      `주문에 쿠폰이 그대로 적용 (${ord.order.couponDiscount})`);
    check(ord.order.total === t.priceNow - usable.discount,
      `총액에서 차감 (${t.priceNow}−${usable.discount}=${ord.order.total})`);

    const reuse = await A.post('/api/orders', { productId: t.id, qty: 1, couponId: usable.id });
    check(reuse.status === 409, `사용한 쿠폰 재사용 거부 (HTTP ${reuse.status})`);

    await A.post(`/api/orders/${ord.order.id}/cancel`);
    const back = (await A.get(`/api/coupons/usable?amount=${amount}&region=${encodeURIComponent(t.region)}`))
      .body.coupons.find((c) => c.id === usable.id);
    check(back && back.usable, '취소하면 쿠폰이 되살아남');
  }

  // =============================================================
  group('평점 가중평균');
  // =============================================================
  {
    const stores = (await A.get('/api/stores')).body.stores;
    const st = stores.find((s) => s.reviewCount > 0 && s.baseCount > 0);
    const before = { rating: st.rating, count: st.reviewCount };

    const stars = 1;                       // 낮은 점수로 평균이 내려가야 합니다
    const res = await A.post('/api/reviews', {
      shop: st.name, prod: '논리검사', stars, txt: '논리 검증용 후기',
    });
    check(res.status === 201, '후기 작성됨');

    const after = (await A.get('/api/stores')).body.stores.find((s) => s.key === st.key);
    const expectedCount = before.count + 1;
    const expectedRating = Math.round(
      ((st.baseRating * st.baseCount + stars) / (st.baseCount + 1)) * 10
    ) / 10;

    check(after.reviewCount === expectedCount, `후기 수 +1 (${after.reviewCount})`);
    check(after.rating === expectedRating,
      `가중평균이 수식과 일치 (${after.rating} = ${expectedRating})`);
    check(after.rating <= before.rating, `1점 후기로 평점이 내려감 (${before.rating} → ${after.rating})`);
    check(after.rating >= 1 && after.rating <= 5, `평점이 1~5 범위 (${after.rating})`);

    await A.del(`/api/reviews/${res.body.review.id}`);
    const restored = (await A.get('/api/stores')).body.stores.find((s) => s.key === st.key);
    check(restored.rating === before.rating && restored.reviewCount === before.count,
      `후기 삭제 시 평점 원복 (${restored.rating}/${restored.reviewCount})`);
  }

  // =============================================================
  group('계정 격리');
  // =============================================================
  {
    const B = makeClient();
    await B.login('논리검사 B');

    const t = (await A.get('/api/products')).body.raw.find((p) => p.stock > 0);
    const mine = (await A.post('/api/orders', { productId: t.id, qty: 1 })).body.order;

    const bPicks = (await B.get('/api/mypickups')).body.MY_PICKUPS;
    check(!bPicks.some((p) => p.code === mine.code), 'B 에게 A 의 예약이 보이지 않음');

    const steal = await B.post(`/api/orders/${mine.id}/cancel`);
    check(steal.status === 404, `B 가 A 의 주문을 취소할 수 없음 (HTTP ${steal.status})`);

    const stillThere = (await A.get('/api/mypickups')).body.MY_PICKUPS.some((p) => p.code === mine.code);
    check(stillThere, 'A 의 주문이 그대로 남아있음');

    // 쿠폰도 계정별이어야 합니다.
    const aCoupons = (await A.get('/api/bootstrap')).body.MY_COUPONS.map((c) => c.id);
    const bCoupons = (await B.get('/api/bootstrap')).body.MY_COUPONS.map((c) => c.id);
    check(aCoupons.length > 0 && bCoupons.length > 0, '두 계정 모두 쿠폰 보유');
    check(!aCoupons.some((id) => bCoupons.includes(id)), '쿠폰이 계정 간에 겹치지 않음');

    // B 가 A 의 쿠폰으로 결제할 수 없어야 합니다.
    const aCoupon = (await A.get('/api/bootstrap')).body.MY_COUPONS[0];
    const cross = await B.post('/api/orders', { productId: t.id, qty: 1, couponId: aCoupon.id });
    check(cross.status === 404, `남의 쿠폰으로 결제 불가 (HTTP ${cross.status})`);

    // 초대코드는 계정마다 달라야 합니다.
    const aCode = (await A.get('/api/invite')).body.code;
    const bCode = (await B.get('/api/invite')).body.code;
    check(aCode && bCode && aCode !== bCode, `초대코드가 서로 다름 (${aCode} / ${bCode})`);

    // 설정도 섞이면 안 됩니다.
    await A.put('/api/settings', { key: 'couponEvent', value: true });
    const bSet = (await B.get('/api/settings')).body.settings;
    check(bSet.couponEvent === false, 'A 의 설정 변경이 B 에게 영향 없음');

    await A.post(`/api/orders/${mine.id}/cancel`);
  }

  // =============================================================
  group('예약코드');
  // =============================================================
  {
    // 코드가 겹치면 매장에서 다른 손님의 예약을 수령 확인해 줄 수 있습니다.
    // 예전에는 'HL-' + 1000~9999 를 중복 검사 없이 뽑아 실제로 겹쳤습니다.
    const t = (await A.get('/api/products')).body.raw.find((p) => p.stock >= 5);
    const made = [];
    for (let i = 0; i < 5; i++) {
      const r = await A.post('/api/orders', { productId: t.id, qty: 1 });
      if (r.body.order) made.push(r.body.order);
    }
    check(made.length === 5, `주문 ${made.length}건 생성`);

    const codes = made.map((o) => o.code);
    check(new Set(codes).size === codes.length, `새 코드끼리 겹치지 않음 (${codes.join(', ')})`);

    const all = (await A.get('/api/orders')).body.orders.map((o) => o.code);
    const dup = all.filter((c, i) => all.indexOf(c) !== i);
    check(dup.length === 0, `내 주문 전체에서 코드 중복 없음 (${all.length}건)`,
      dup.slice(0, 4).join(', '));

    // 공간이 넓어졌는지 (4자리면 9,000개뿐이라 곧 겹칩니다)
    const digits = codes.map((c) => (c.replace(/[^0-9]/g, '') || '').length);
    check(digits.every((n) => n >= 6), `코드 자릿수가 충분함 (${digits.join(',')})`);

    for (const o of made) await A.post(`/api/orders/${o.id}/cancel`);
  }

  // =============================================================
  group('데이터 정합성');
  // =============================================================
  {
    const d = (await A.get('/api/bootstrap')).body;

    const noPlace = d.STORES.filter((s) => !d.PLACES[s.key]);
    check(noPlace.length === 0, 'STORES 의 모든 키가 PLACES 에 존재',
      noPlace.slice(0, 3).map((s) => s.key).join(', '));

    const badGeo = Object.entries(d.GEO).filter(([, g]) =>
      !Array.isArray(g) || g.length !== 2 || !Number.isFinite(g[0]) || !Number.isFinite(g[1]));
    check(badGeo.length === 0, '모든 좌표가 유효한 [위도, 경도]');

    // 축제 기간은 시작 <= 종료여야 합니다.
    const badPeriod = (d.CAL2_FESTIVAL || []).filter((f) => f.start > f.end);
    check(badPeriod.length === 0, '축제 시작일이 종료일보다 늦지 않음',
      badPeriod.slice(0, 3).map((f) => `${f.name} ${f.start}~${f.end}`).join(', '));

    // 캘린더 가격이 상품 가격과 어긋나면 안 됩니다.
    const calItems = Object.values(d.cal || {}).flat();
    const priceGap = calItems.filter((it) => {
      const pl = d.PL.find((p) => p.fid === it.productId);
      return pl && won(pl.now) !== it.nowN;
    });
    check(priceGap.length === 0, '캘린더 가격 = 상품 목록 가격',
      priceGap.slice(0, 3).map((i) => i.prod).join(', '));

    // 코스의 모든 경유지가 실제로 존재해야 합니다.
    const missing = [];
    for (const [rg, P] of Object.entries(d.POOL || {})) {
      for (const k of [P.ic, ...(P.pk || []), ...(P.tour || []), ...(P.food || [])]) {
        if (k && !d.PLACES[k]) missing.push(`${rg}:${k}`);
      }
    }
    check(missing.length === 0, '코스 구성의 모든 장소가 존재', missing.slice(0, 5).join(', '));

    // 할인율 표시가 실제 가격과 맞는가
    const badDisc = d.PL.filter((p) => {
      const w = won(p.was), n = won(p.now);
      return w > 0 && n > w;                    // 할인가가 정가보다 비싸면 이상합니다
    });
    check(badDisc.length === 0, '할인가가 정가를 넘지 않음',
      badDisc.slice(0, 3).map((p) => p.prod).join(', '));

    // 재고와 품절 표시가 어긋나면 안 됩니다.
    const badSold = d.PL.filter((p) => (p.stock <= 0) !== !!p.soldOut);
    check(badSold.length === 0, '재고 0 과 품절 표시가 일치',
      badSold.slice(0, 3).map((p) => `${p.prod}(${p.stock}/${p.soldOut})`).join(', '));
  }

  console.log('');
  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  논리 검증 전부 통과\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
