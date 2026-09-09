import express from 'express';
import crypto from 'node:crypto';
import { mutate, collections, CONTENT_KEYS } from '../lib/store.js';
import { requireCan, ROLES, rolesOf, scopeOf, publicRoles, can } from '../lib/roles.js';
import { dayOf } from './producer.js';
import { buildStatements, totals, lastMonthRange, thisMonthRange, DEFAULT_FEE_RATE } from '../lib/settlement.js';

export const router = express.Router();

/**
 * 운영자 · 최고관리자 API.
 *
 * 운영자는 콘텐츠를 바꿉니다(되돌릴 수 있음). 최고관리자는 계정과 권한을
 * 바꿉니다(되돌리기 어렵고 보안 사고로 직결). 그래서 나눠 두었습니다.
 *
 * 인터페이스는 docs/roles.md §6 을 따릅니다.
 */

const auditId = () => 'ad_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

/** 되돌리기 어려운 변경은 흔적을 남깁니다. */
function pushAudit(db, { actorId, action, targetType, targetId, before, after }) {
  const row = {
    id: auditId(), actorId, action, targetType, targetId,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    at: new Date().toISOString(),
  };
  if (!db.audit) db.audit = [];
  db.audit.push(row);
  return row;
}

// ================================================================
// 운영자 - 콘텐츠
// ================================================================

/** GET /api/admin/content - 편집 가능한 키 목록 */
router.get('/content', requireCan('content:write'), (_req, res) => {
  const content = collections.content();
  res.json({
    keys: CONTENT_KEYS.map((k) => {
      const v = content[k];
      return {
        key: k,
        type: Array.isArray(v) ? 'array' : typeof v,
        size: Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 1),
      };
    }),
  });
});

/** GET /api/admin/content/:key */
router.get('/content/:key', requireCan('content:write'), (req, res) => {
  const key = String(req.params.key);
  // 화이트리스트 밖의 키는 열지 않습니다. 임의 경로 읽기를 막습니다.
  if (!CONTENT_KEYS.includes(key)) {
    return res.status(404).json({ error: '편집할 수 없는 항목입니다.', allowed: CONTENT_KEYS });
  }
  res.json({ key, value: collections.content()[key] ?? null });
});

/** PUT /api/admin/content/:key  { value } */
router.put('/content/:key', requireCan('content:write'), async (req, res) => {
  const key = String(req.params.key);
  if (!CONTENT_KEYS.includes(key)) {
    return res.status(404).json({ error: '편집할 수 없는 항목입니다.', allowed: CONTENT_KEYS });
  }
  const { value } = req.body || {};
  if (value === undefined) return res.status(400).json({ error: 'value 가 필요합니다.' });

  const result = await mutate((db) => {
    if (!db.content) db.content = {};
    const before = db.content[key];
    // 비어 있는 값으로 통째로 덮어쓰면 화면이 빈 채로 배포됩니다.
    const emptyNow = Array.isArray(value) ? value.length === 0
      : (value && typeof value === 'object' ? Object.keys(value).length === 0 : false);
    const hadBefore = Array.isArray(before) ? before.length > 0
      : (before && typeof before === 'object' ? Object.keys(before).length > 0 : !!before);
    if (emptyNow && hadBefore) {
      return { status: 409, body: { error: '값을 비우려면 확인이 필요합니다.', code: 'WOULD_EMPTY' } };
    }
    db.content[key] = value;
    pushAudit(db, {
      actorId: req.user.id, action: 'content:write', targetType: 'content', targetId: key,
      before: null, after: null,          // 콘텐츠는 통째로 크므로 값은 남기지 않습니다
    });
    return { status: 200, body: { key, value } };
  });

  res.status(result.status).json(result.body);
});

/** POST /api/admin/coupons/issue - 쿠폰 캠페인 */
router.post('/coupons/issue', requireCan('coupon:issue'), async (req, res) => {
  const { target = 'all', userIds = [], pct, nm, cond = '', exp = '' } = req.body || {};
  if (!pct || !nm) return res.status(400).json({ error: 'pct 와 nm 이 필요합니다.' });

  const result = await mutate((db) => {
    let recipients = db.users || [];
    if (target === 'userIds') {
      const set = new Set(userIds.map(String));
      recipients = recipients.filter((u) => set.has(u.id));
    }
    if (!recipients.length) {
      return { status: 400, body: { error: '받을 사람이 없습니다.' } };
    }
    const batch = 'cp_' + Date.now().toString(36);
    const issuedAt = new Date().toISOString();
    recipients.forEach((u, i) => {
      db.coupons.push({
        id: `${batch}_${i}`, batch, userId: u.id,
        pct: String(pct), nm: String(nm), cond: String(cond), exp: String(exp),
        used: false, grantedAt: issuedAt, issuedBy: req.user.id,
      });
    });
    pushAudit(db, {
      actorId: req.user.id, action: 'coupon:issue', targetType: 'coupon', targetId: batch,
      after: { count: recipients.length, pct, nm },
    });
    return { status: 201, body: { batch, issued: recipients.length } };
  });

  res.status(result.status).json(result.body);
});

/** GET /api/admin/reviews - 후기 모더레이션 */
router.get('/reviews', requireCan('review:moderate'), (req, res) => {
  let list = collections.reviews();
  if (req.query.hidden === '1') list = list.filter((r) => r.hidden);
  res.json({ count: list.length, reviews: list.slice(0, 200) });
});

/** POST /api/admin/reviews/:id/hide  { reason, hidden? } */
router.post('/reviews/:id/hide', requireCan('review:moderate'), async (req, res) => {
  const { reason = '', hidden = true } = req.body || {};
  const result = await mutate((db) => {
    const r = db.reviews.find((x) => x.id === req.params.id);
    if (!r) return { status: 404, body: { error: '후기를 찾을 수 없습니다.' } };
    r.hidden = !!hidden;
    r.hiddenReason = String(reason).slice(0, 200);
    pushAudit(db, {
      actorId: req.user.id, action: 'review:moderate', targetType: 'review', targetId: r.id,
      after: { hidden: r.hidden, reason: r.hiddenReason },
    });
    return { status: 200, body: { review: r } };
  });
  res.status(result.status).json(result.body);
});

// ================================================================
// 입점 신청 · 승인
//
// 지금까지 역할은 최고관리자가 일방적으로 꽂아 넣는 것뿐이었습니다.
// 실제로는 농가·매장이 신청하고 지자체가 승인하는 순서입니다.
// 신청은 누구나 할 수 있고, 승인 전까지는 아무 권한도 생기지 않습니다.
// ================================================================

/** POST /api/admin/apply  { role, farm, storeKeys?, productIds?, memo? } - 입점 신청 */
router.post('/apply', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
  }
  const { role, farm = '', storeKeys = [], productIds = [], memo = '' } = req.body || {};
  if (!['producer', 'store_manager'].includes(role)) {
    return res.status(400).json({ error: '신청할 수 있는 역할은 생산자와 매장 관리인입니다.' });
  }

  const result = await mutate((db) => {
    if (!db.applications) db.applications = [];
    const pending = db.applications.find(
      (a) => a.userId === req.user.id && a.status === 'pending');
    if (pending) {
      return { status: 409, body: { error: '이미 심사 중인 신청이 있습니다.', code: 'PENDING' } };
    }
    const row = {
      id: 'ap_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
      userId: req.user.id,
      nickname: req.user.nickname,
      email: req.user.email || '',
      role,
      farm: String(farm).slice(0, 60),
      storeKeys: Array.isArray(storeKeys) ? storeKeys.slice(0, 20) : [],
      productIds: Array.isArray(productIds) ? productIds.slice(0, 50) : [],
      memo: String(memo).slice(0, 500),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    db.applications.push(row);
    return { status: 201, body: { application: row } };
  });

  res.status(result.status).json(result.body);
});

/** GET /api/admin/apply/mine - 내 신청 현황 */
router.get('/apply/mine', (req, res) => {
  if (!req.user) return res.json({ applications: [] });
  const mine = (collections.applications() || []).filter((a) => a.userId === req.user.id);
  res.json({ applications: mine.slice().reverse() });
});

/** GET /api/admin/applications?status= - 심사 목록 */
router.get('/applications', requireCan('store:approve'), (req, res) => {
  let list = collections.applications() || [];
  const status = String(req.query.status || 'pending');
  if (status !== 'all') list = list.filter((a) => (a.status || 'pending') === status);
  res.json({ count: list.length, applications: list.slice().reverse() });
});

/**
 * POST /api/admin/applications/:id/decide  { approve, scope?, note? }
 *
 * 승인하면 그 자리에서 역할과 범위를 붙입니다. 승인만 하고 범위를 안 주면
 * 로그인해도 아무것도 못 보는 상태가 되어 신청자가 헤맵니다.
 */
router.post('/applications/:id/decide', requireCan('store:approve'), async (req, res) => {
  const { approve, scope, note = '' } = req.body || {};
  if (typeof approve !== 'boolean') {
    return res.status(400).json({ error: 'approve 는 true 또는 false 여야 합니다.' });
  }

  const result = await mutate((db) => {
    const a = (db.applications || []).find((x) => x.id === req.params.id);
    if (!a) return { status: 404, body: { error: '신청을 찾을 수 없습니다.' } };
    if (a.status !== 'pending') {
      return { status: 409, body: { error: `이미 처리된 신청입니다 (${a.status}).` } };
    }
    const u = db.users.find((x) => x.id === a.userId);
    if (!u) return { status: 404, body: { error: '신청자 계정을 찾을 수 없습니다.' } };

    a.status = approve ? 'approved' : 'rejected';
    a.decidedBy = req.user.id;
    a.decidedAt = new Date().toISOString();
    a.note = String(note).slice(0, 300);

    if (approve) {
      // 심사자가 범위를 조정했으면 그것을, 아니면 신청한 대로 붙입니다.
      const sc = scope || {};
      const storeKeys = Array.isArray(sc.storeKeys) ? sc.storeKeys : a.storeKeys;
      const productIds = Array.isArray(sc.productIds) ? sc.productIds : a.productIds;

      const roles = rolesOf(u);
      if (!roles.includes(a.role)) roles.push(a.role);
      u.roles = roles;
      u.scope = {
        storeKeys: Array.from(new Set([...scopeOf(u).storeKeys, ...storeKeys])),
        productIds: Array.from(new Set([...scopeOf(u).productIds, ...productIds])),
        regions: scopeOf(u).regions,
      };
      u.status = 'active';
      u.roleGrantedBy = req.user.id;
      u.roleGrantedAt = a.decidedAt;

      for (const p of db.products) {
        if (u.scope.productIds.includes(p.id) && !p.producerId) p.producerId = u.id;
      }
      for (const st of db.stores) {
        if (u.scope.storeKeys.includes(st.key)) {
          st.managerIds = Array.from(new Set([...(st.managerIds || []), u.id]));
        }
      }
    }

    pushAudit(db, {
      actorId: req.user.id, action: 'application:decide',
      targetType: 'application', targetId: a.id,
      before: { role: a.role, userId: a.userId },
      after: { status: a.status, roles: approve ? rolesOf(u) : null },
    });
    return { status: 200, body: { application: a, user: approve ? { id: u.id, roles: u.roles, scope: u.scope } : null } };
  });

  res.status(result.status).json(result.body);
});

// ================================================================
// 최고관리자 - 계정과 권한
// ================================================================

/** GET /api/admin/users?role=&status=&q= */
router.get('/users', requireCan('user:role:write'), (req, res) => {
  const { role, status, q } = req.query;
  let list = collections.users();
  if (role) list = list.filter((u) => rolesOf(u).includes(String(role)));
  if (status) list = list.filter((u) => (u.status || 'active') === String(status));
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((u) =>
      String(u.nickname || '').toLowerCase().includes(s)
      || String(u.email || '').toLowerCase().includes(s));
  }
  res.json({
    count: list.length,
    users: list.map((u) => ({
      id: u.id, nickname: u.nickname, email: u.email, provider: u.provider,
      roles: rolesOf(u), scope: scopeOf(u), status: u.status || 'active',
      createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    })),
  });
});

/** PUT /api/admin/users/:id/roles  { roles: [], scope: {} } */
router.put('/users/:id/roles', requireCan('user:role:write'), async (req, res) => {
  const { roles, scope } = req.body || {};
  if (!Array.isArray(roles) || !roles.length) {
    return res.status(400).json({ error: 'roles 는 비어 있지 않은 배열이어야 합니다.' });
  }
  const bad = roles.filter((r) => !ROLES.includes(r));
  if (bad.length) {
    return res.status(400).json({ error: `알 수 없는 역할: ${bad.join(', ')}`, allowed: ROLES });
  }

  const result = await mutate((db) => {
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) return { status: 404, body: { error: '계정을 찾을 수 없습니다.' } };

    // 마지막 최고관리자가 스스로 권한을 내려놓으면 아무도 되돌릴 수 없습니다.
    const admins = db.users.filter((x) => rolesOf(x).includes('super_admin'));
    if (admins.length === 1 && admins[0].id === u.id && !roles.includes('super_admin')) {
      return {
        status: 409,
        body: { error: '마지막 최고관리자의 권한은 회수할 수 없습니다.', code: 'LAST_ADMIN' },
      };
    }

    const before = { roles: rolesOf(u), scope: scopeOf(u) };
    u.roles = roles;
    u.scope = {
      storeKeys: Array.isArray(scope?.storeKeys) ? scope.storeKeys : scopeOf(u).storeKeys,
      productIds: Array.isArray(scope?.productIds) ? scope.productIds : scopeOf(u).productIds,
      regions: Array.isArray(scope?.regions) ? scope.regions : scopeOf(u).regions,
    };
    u.roleGrantedBy = req.user.id;
    u.roleGrantedAt = new Date().toISOString();

    // 담당 상품·거점을 반대 방향에서도 이어 둡니다.
    for (const p of db.products) {
      if (u.scope.productIds.includes(p.id)) p.producerId = u.id;
      else if (p.producerId === u.id) p.producerId = null;
    }
    for (const st of db.stores) {
      const ids = Array.isArray(st.managerIds) ? st.managerIds : [];
      const should = u.scope.storeKeys.includes(st.key);
      st.managerIds = should
        ? Array.from(new Set([...ids, u.id]))
        : ids.filter((x) => x !== u.id);
    }

    pushAudit(db, {
      actorId: req.user.id, action: 'user:role:write', targetType: 'user', targetId: u.id,
      before, after: { roles: u.roles, scope: u.scope },
    });
    return { status: 200, body: { user: { id: u.id, roles: u.roles, scope: u.scope } } };
  });

  res.status(result.status).json(result.body);
});

/** PUT /api/admin/users/:id/status  { status } */
router.put('/users/:id/status', requireCan('user:role:write'), async (req, res) => {
  const status = String((req.body || {}).status || '');
  if (!['active', 'pending', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'status 는 active/pending/suspended 중 하나여야 합니다.' });
  }
  const result = await mutate((db) => {
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) return { status: 404, body: { error: '계정을 찾을 수 없습니다.' } };
    if (u.id === req.user.id && status === 'suspended') {
      return { status: 409, body: { error: '자기 계정은 정지할 수 없습니다.', code: 'SELF_SUSPEND' } };
    }
    const before = u.status || 'active';
    u.status = status;
    pushAudit(db, {
      actorId: req.user.id, action: 'user:status', targetType: 'user', targetId: u.id,
      before, after: status,
    });
    return { status: 200, body: { user: { id: u.id, status } } };
  });
  res.status(result.status).json(result.body);
});

/** GET /api/admin/stats - 전체 통계 */
router.get('/stats', requireCan('stats:read'), (req, res) => {
  const from = String(req.query.from || '0000-00-00');
  const to = String(req.query.to || '9999-99-99');
  const products = collections.products();
  const orders = collections.orders()
    .filter((o) => dayOf(o.createdAt) >= from && dayOf(o.createdAt) <= to);
  const done = orders.filter((o) => o.status === 'completed');

  const byRegion = {};
  for (const o of done) {
    const rg = o.region || '기타';
    if (!byRegion[rg]) byRegion[rg] = { region: rg, qty: 0, revenue: 0, orders: 0 };
    byRegion[rg].qty += o.qty;
    byRegion[rg].revenue += o.total;
    byRegion[rg].orders += 1;
  }

  res.json({
    from, to,
    users: collections.users().length,
    products: products.length,
    stores: collections.stores().length,
    orders: {
      total: orders.length,
      reserved: orders.filter((o) => o.status === 'reserved').length,
      completed: done.length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
      noshow: orders.filter((o) => o.status === 'noshow').length,
    },
    revenue: done.reduce((a, o) => a + o.total, 0),
    // 재고가 얼마나 도는지. 0 에 가까우면 출하가 멈춘 것입니다.
    stock: {
      total: products.reduce((a, p) => a + (p.stock || 0), 0),
      soldOut: products.filter((p) => (p.stock || 0) <= 0).length,
    },
    byRegion: Object.values(byRegion).sort((a, b) => b.revenue - a.revenue),
  });
});

/**
 * GET /api/admin/settlement?from=&to=&feeRate=
 * 기간 정산. 생산자별로 지급액을 뽑습니다.
 */
router.get('/settlement', requireCan('stats:read'), (req, res) => {
  const range = (req.query.from || req.query.to)
    ? { from: String(req.query.from || '0000-00-00'), to: String(req.query.to || '9999-99-99') }
    : thisMonthRange();
  const feeRate = req.query.feeRate !== undefined
    ? Math.min(Math.max(Number(req.query.feeRate), 0), 0.5)
    : DEFAULT_FEE_RATE;

  const list = buildStatements(collections.orders(), collections.products(), { ...range, feeRate });
  const paidSet = new Set((collections.settlements() || []).map((x) => x.id));

  res.json({
    ...range,
    feeRate,
    statements: list.map((s) => ({ ...s, settlementId: `${range.from}_${range.to}_${s.key}`,
      paid: paidSet.has(`${range.from}_${range.to}_${s.key}`) })),
    total: totals(list),
  });
});

/** POST /api/admin/settlement/pay  { from, to, key, memo? } - 지급 처리 */
router.post('/settlement/pay', requireCan('user:role:write'), async (req, res) => {
  const { from, to, key, memo = '' } = req.body || {};
  if (!from || !to || !key) {
    return res.status(400).json({ error: 'from, to, key 가 필요합니다.' });
  }
  const id = `${from}_${to}_${key}`;

  const result = await mutate((db) => {
    if (!db.settlements) db.settlements = [];
    if (db.settlements.some((x) => x.id === id)) {
      return { status: 409, body: { error: '이미 지급 처리된 정산입니다.', code: 'ALREADY_PAID' } };
    }
    const st = buildStatements(db.orders, db.products, { from, to })
      .find((x) => x.key === key);
    if (!st) return { status: 404, body: { error: '정산 대상을 찾을 수 없습니다.' } };

    const row = {
      id, from, to, key,
      producerId: st.producerId, farm: st.farm,
      gross: st.gross, fee: st.fee, net: st.net, count: st.count, qty: st.qty,
      memo: String(memo).slice(0, 200),
      paidBy: req.user.id, paidAt: new Date().toISOString(),
    };
    db.settlements.push(row);
    pushAudit(db, {
      actorId: req.user.id, action: 'settlement:pay',
      targetType: 'settlement', targetId: id, after: { net: st.net, farm: st.farm },
    });
    return { status: 201, body: { settlement: row } };
  });

  res.status(result.status).json(result.body);
});

/** GET /api/admin/audit?limit=&actorId= */
router.get('/audit', requireCan('user:role:write'), (req, res) => {
  let list = collections.audit();
  if (req.query.actorId) list = list.filter((a) => a.actorId === String(req.query.actorId));
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ count: list.length, rows: list.slice(-limit).reverse() });
});

/** GET /api/admin/stocklogs - 전체 재고 이력 */
router.get('/stocklogs', requireCan('stats:read'), (req, res) => {
  let list = collections.stockLogs();
  if (req.query.productId) list = list.filter((l) => l.productId === String(req.query.productId));
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ count: list.length, logs: list.slice(-limit).reverse() });
});
