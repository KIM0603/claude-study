/**
 * 역할과 범위(scope).
 *
 * 역할만으로는 부족합니다. "매장 관리인" 이 아니라 "pk_local 의 매장 관리인"
 * 이어야 A 매장 관리인이 B 매장 주문을 건드리지 못합니다. 그래서 이 모듈은
 * 권한(무엇을 할 수 있는가)과 범위(어느 대상에)를 따로 봅니다.
 *
 * 설계는 docs/roles.md 를 따릅니다.
 */
import { collections } from './store.js';

export const ROLES = ['customer', 'producer', 'store_manager', 'operator', 'super_admin'];

/** 역할이 가진 행위. super_admin 은 전부 가집니다. */
const GRANTS = {
  customer: ['order:read:own', 'order:cancel:own', 'review:write:own'],
  producer: [
    'order:read:product', 'product:write', 'product:restock', 'producer:stats',
  ],
  store_manager: [
    'order:read:store', 'order:complete', 'order:noshow',
    'product:restock', 'store:write', 'store:stats',
  ],
  operator: [
    'content:write', 'coupon:issue', 'review:moderate', 'stats:read', 'tour:admin',
  ],
  super_admin: ['*'],
};

export const DEFAULT_SCOPE = { storeKeys: [], productIds: [], regions: [] };

/**
 * 화면이 물어볼 수 있는 행위 전부.
 *
 * 이 목록을 손으로 관리하다 매장 관리인 메뉴가 사라진 적이 있습니다.
 * (publicRoles 가 일부 행위를 안 실어 보내 화면이 권한 없음으로 봤습니다.)
 * 이제 GRANTS 에서 뽑아 쓰므로 역할에 행위를 더하면 자동으로 따라옵니다.
 */
export const ACTIONS = Array.from(new Set(
  Object.values(GRANTS).flat().filter((a) => a !== '*')
)).concat(['user:role:write', 'store:approve', 'audit:read']).sort();

/** 사용자에게 붙은 역할. 값이 없거나 이상하면 customer 하나로 봅니다. */
export function rolesOf(user) {
  if (!user) return [];
  const list = Array.isArray(user.roles) ? user.roles.filter((r) => ROLES.includes(r)) : [];
  return list.length ? list : ['customer'];
}

export function scopeOf(user) {
  const s = (user && user.scope) || {};
  return {
    storeKeys: Array.isArray(s.storeKeys) ? s.storeKeys : [],
    productIds: Array.isArray(s.productIds) ? s.productIds : [],
    regions: Array.isArray(s.regions) ? s.regions : [],
  };
}

export const hasRole = (user, role) => rolesOf(user).includes(role);
export const isSuperAdmin = (user) => hasRole(user, 'super_admin');

/** 이 사용자가 그 행위를 할 수 있는가. 범위는 보지 않습니다. */
export function can(user, action) {
  if (!user || user.status === 'suspended') return false;
  for (const r of rolesOf(user)) {
    const g = GRANTS[r] || [];
    if (g.includes('*') || g.includes(action)) return true;
  }
  return false;
}

// ---------------------------------------------------------------
// 범위 검사
//
// 권한이 있어도 대상이 내 담당이 아니면 막습니다. 존재 여부까지 숨기려고
// 라우트에서는 403 이 아니라 404 로 응답합니다.
// ---------------------------------------------------------------

/** 이 상품이 내 담당인가. 생산자는 담당 상품, 매장 관리인은 담당 거점의 상품. */
export function ownsProduct(user, product) {
  if (!product) return false;
  if (isSuperAdmin(user)) return true;
  const sc = scopeOf(user);
  if (hasRole(user, 'producer')) {
    if (product.producerId && product.producerId === user.id) return true;
    if (sc.productIds.includes(product.id)) return true;
  }
  if (hasRole(user, 'store_manager') && product.placeKey) {
    if (sc.storeKeys.includes(product.placeKey)) return true;
  }
  return false;
}

/** 이 거점이 내 담당인가. */
export function ownsStore(user, storeKey) {
  if (!storeKey) return false;
  if (isSuperAdmin(user)) return true;
  return scopeOf(user).storeKeys.includes(storeKey);
}

/**
 * 이 주문이 내 담당인가.
 *   - 본인 주문                  → 언제나
 *   - 담당 상품의 주문           → 생산자
 *   - 담당 거점에서 찾아갈 주문   → 매장 관리인
 */
export function ownsOrder(user, order) {
  if (!order) return false;
  if (isSuperAdmin(user)) return true;
  if (order.userId === user.id) return true;

  const product = collections.products().find((p) => p.id === order.productId);
  if (!product) return false;

  if (hasRole(user, 'producer') && ownsProduct(user, product)) return true;
  if (hasRole(user, 'store_manager') && product.placeKey && ownsStore(user, product.placeKey)) {
    return true;
  }
  return false;
}

/** 내가 담당하는 상품들. 생산자·매장 관리인 화면의 기본 목록입니다. */
export function myProducts(user) {
  const all = collections.products();
  if (isSuperAdmin(user)) return all;
  return all.filter((p) => ownsProduct(user, p));
}

/** 내가 담당하는 거점들. */
export function myStores(user) {
  const all = collections.stores();
  if (isSuperAdmin(user)) return all;
  const keys = scopeOf(user).storeKeys;
  return all.filter((s) => keys.includes(s.key));
}

// ---------------------------------------------------------------
// 미들웨어
// ---------------------------------------------------------------

/** 로그인 + 그 행위 권한이 있어야 통과합니다. */
export function requireCan(action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
    }
    if (req.user.status === 'suspended') {
      return res.status(403).json({ error: '정지된 계정입니다.', code: 'SUSPENDED' });
    }
    if (!can(req.user, action)) {
      return res.status(403).json({ error: '권한이 없습니다.', code: 'FORBIDDEN', need: action });
    }
    next();
  };
}

/** 역할 하나라도 가지고 있으면 통과. 화면 진입용입니다. */
export function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
    }
    const mine = rolesOf(req.user);
    if (!roles.some((r) => mine.includes(r)) && !mine.includes('super_admin')) {
      return res.status(403).json({ error: '권한이 없습니다.', code: 'FORBIDDEN', need: roles });
    }
    next();
  };
}

/** 화면에 내려보내는 역할 정보. */
export function publicRoles(user) {
  if (!user) return { roles: [], scope: DEFAULT_SCOPE, status: 'guest' };
  return {
    roles: rolesOf(user),
    scope: scopeOf(user),
    status: user.status || 'active',
    can: Object.fromEntries(ACTIONS.map((a) => [a, can(user, a)])),
  };
}
