import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, mutate } from './store.js';

/**
 * 세션 기반 인증.
 *
 * 소셜 로그인(카카오)으로 받은 신원을 users 에 저장하고, 브라우저에는
 * httpOnly 쿠키로 세션 토큰만 내려보냅니다. 액세스 토큰은 서버에만 두고
 * 클라이언트로 내보내지 않습니다 (TourAPI 서비스키와 같은 원칙).
 */

const SESSION_COOKIE = 'hl_session';
const STATE_COOKIE = 'hl_oauth_state';
const SESSION_DAYS = 30;

export const cookieNames = { session: SESSION_COOKIE, state: STATE_COOKIE };

/** express 는 쿠키를 파싱하지 않아서 직접 읽습니다 (의존성 추가를 피합니다). */
export function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

export function setCookie(res, name, value, { maxAgeSec, httpOnly = true } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',                       // OAuth 리다이렉트로 돌아올 때 쿠키가 실려야 합니다
  ];
  if (httpOnly) bits.push('HttpOnly');
  if (config.secureCookies) bits.push('Secure');
  if (maxAgeSec != null) bits.push(`Max-Age=${maxAgeSec}`);
  appendSetCookie(res, bits.join('; '));
}

export function clearCookie(res, name) {
  appendSetCookie(res, `${name}=; Path=/; Max-Age=0; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`);
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', value);
  else res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, value] : [prev, value]);
}

const token = () => crypto.randomBytes(32).toString('base64url');

/** provider 신원으로 사용자를 찾거나 새로 만듭니다. */
/** 사람이 읽고 말하기 쉬운 초대코드. 혼동되는 글자(0/O/1/I)는 뺍니다. */
function makeInviteCode(db) {
  const AB = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let t = 0; t < 50; t++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += AB[crypto.randomInt(AB.length)];
    if (!(db.users || []).some((u) => u.inviteCode === c)) return c;
  }
  return 'HL' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

/** 환경변수로 지정한 첫 최고관리자인가. 없으면 아무도 역할을 줄 수 없습니다. */
function isBootstrapAdmin(email) {
  const e = String(email || '').trim().toLowerCase();
  return !!e && config.superAdminEmails.includes(e);
}

export async function upsertUser({ provider, providerId, nickname, email, avatar, ref }) {
  return mutate((db) => {
    if (!db.users) db.users = [];
    let user = db.users.find((u) => u.provider === provider && u.providerId === String(providerId));
    if (user) {
      if (!user.inviteCode) user.inviteCode = makeInviteCode(db);
      user.nickname = nickname || user.nickname;
      user.email = email || user.email;
      user.avatar = avatar || user.avatar;
      if (!Array.isArray(user.roles) || !user.roles.length) user.roles = ['customer'];
      if (isBootstrapAdmin(user.email) && !user.roles.includes('super_admin')) {
        user.roles = [...user.roles, 'super_admin'];
      }
      if (!user.scope) user.scope = { storeKeys: [], productIds: [], regions: [] };
      if (!user.status) user.status = 'active';
      user.lastLoginAt = new Date().toISOString();
      return user;
    }
    // 초대 링크(?ref=CODE)로 들어왔으면 추천인을 연결합니다.
    const inviter = ref ? (db.users || []).find((u) => u.inviteCode === String(ref).toUpperCase()) : null;

    user = {
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      inviteCode: makeInviteCode(db),
      invitedBy: inviter ? inviter.id : null,
      provider,
      providerId: String(providerId),
      nickname: nickname || '여행자',
      email: email || '',
      avatar: avatar || '',
      // 가입은 언제나 일반 사용자입니다. 역할은 최고관리자만 올려줄 수 있습니다.
      roles: isBootstrapAdmin(email) ? ['customer', 'super_admin'] : ['customer'],
      scope: { storeKeys: [], productIds: [], regions: [] },
      status: 'active',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    };
    db.users.push(user);

    // 신규 가입 쿠폰: 시드 쿠폰을 이 계정 것으로 복사해 줍니다.
    // (쿠폰도 계정별이라, 로그인하지 않으면 아무 쿠폰도 보이지 않습니다.)
    const seedCoupons = (db.coupons || []).filter((c) => !c.userId);
    seedCoupons.forEach((c, i) => {
      db.coupons.push({
        ...c,
        id: `${c.id}_${user.id}_${i}`,
        userId: user.id,
        used: false,
        grantedAt: new Date().toISOString(),
      });
    });
    return user;
  });
}

export async function createSession(userId) {
  const t = token();
  await mutate((db) => {
    if (!db.sessions) db.sessions = [];
    // 만료된 세션은 이때 함께 걷어냅니다.
    const now = Date.now();
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
    db.sessions.push({
      token: t,
      userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(now + SESSION_DAYS * 864e5).toISOString(),
    });
  });
  return { token: t, maxAgeSec: SESSION_DAYS * 86400 };
}

export async function destroySession(t) {
  if (!t) return;
  await mutate((db) => {
    db.sessions = (db.sessions || []).filter((s) => s.token !== t);
  });
}

/** 요청의 세션 쿠키로 사용자를 찾습니다. 없으면 null (비로그인). */
export function userFromRequest(req) {
  const t = readCookie(req, SESSION_COOKIE);
  if (!t) return null;
  const db = get();
  const s = (db.sessions || []).find((x) => x.token === t);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() <= Date.now()) return null;
  return (db.users || []).find((u) => u.id === s.userId) || null;
}

/** 클라이언트로 내보내도 되는 필드만 추립니다. */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, nickname: u.nickname, email: maskEmail(u.email),
    avatar: u.avatar, provider: u.provider, inviteCode: u.inviteCode || '',
    roles: Array.isArray(u.roles) && u.roles.length ? u.roles : ['customer'],
    status: u.status || 'active',
  };
}

function maskEmail(e) {
  if (!e || !e.includes('@')) return '';
  const [id, domain] = e.split('@');
  const keep = Math.min(4, Math.max(1, id.length - 2));
  return id.slice(0, keep) + '*'.repeat(Math.max(2, id.length - keep)) + '@' + domain;
}

/** 로그인이 필요한 라우트에 답니다. */
export function requireAuth(req, res, next) {
  const u = userFromRequest(req);
  if (!u) {
    return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
  }
  req.user = u;
  next();
}

/** 로그인했으면 req.user 를 채우고, 아니어도 통과시킵니다. */
export function attachUser(req, _res, next) {
  req.user = userFromRequest(req);
  next();
}

export { SESSION_COOKIE, STATE_COOKIE };
