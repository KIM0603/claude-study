import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import {
  upsertUser, createSession, destroySession, userFromRequest, publicUser,
  setCookie, clearCookie, readCookie, SESSION_COOKIE, STATE_COOKIE,
} from '../lib/auth.js';
import { publicRoles, myStores, myProducts, DEFAULT_SCOPE, ROLES } from '../lib/roles.js';
import { collections, mutate } from '../lib/store.js';
import { staleEnvNotice } from '../lib/staleenv.js';

import {
  hashPassword, verifyPassword, checkLoginId, checkPassword, normalizeLoginId,
} from '../lib/password.js';

/** 힌트를 여러 줄로 남길 때 씁니다. */
const NL_HINT = String.fromCharCode(10) + '           ';

export const router = express.Router();

/**
 * 카카오 로그인 (Authorization Code 방식).
 *
 *   /api/auth/kakao           -> 카카오 인가 페이지로 보냄
 *   /api/auth/kakao/callback  -> 코드를 토큰으로 바꾸고 세션 발급
 *
 * REST API 키와 액세스 토큰은 서버에만 둡니다. 브라우저에는 세션 쿠키만 갑니다.
 */
const KAKAO_AUTH = 'https://kauth.kakao.com/oauth/authorize';
const KAKAO_TOKEN = 'https://kauth.kakao.com/oauth/token';
const KAKAO_ME = 'https://kapi.kakao.com/v2/user/me';

const redirectUri = (req) => `${appOrigin(req)}/api/auth/kakao/callback`;

/**
 * 이 서비스의 공개 주소.
 *
 * redirect_uri 는 카카오에 등록한 문자열과 **완전히** 같아야 합니다.
 * 카카오는 localhost 와 127.0.0.1 을 다른 주소로 봅니다. 그래서 주소창에
 * 127.0.0.1 로 들어오면 등록해 둔 localhost 와 어긋나 "리다이렉트 URI 설정을
 * 확인하세요" 가 뜹니다. 같은 컴퓨터를 가리키므로 localhost 로 눕힙니다.
 */
function appOrigin(req) {
  if (config.appOrigin) return config.appOrigin.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = String(req.headers.host || '')
    .replace(/^127\.0\.0\.1(?=$|:)/, 'localhost')
    .replace(/^\[::1\](?=$|:)/, 'localhost');
  return `${proto}://${host}`;
}

/**
 * 이 주소로 카카오 로그인이 될 것 같은가.
 *
 * 사설 IP 나 다른 포트로 들어오면 등록해 둔 값과 어긋납니다. 막지는 않고
 * (배포 주소일 수도 있으니) 무엇이 어긋나는지 알려 주기만 합니다.
 */
function redirectHint(req) {
  const uri = redirectUri(req);
  const host = new URL(appOrigin(req)).hostname;
  const isLocal = host === 'localhost';
  const isPrivate = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host);
  if (isPrivate) {
    return `사설 IP(${host}) 로 접속하셨습니다. 카카오에 등록한 주소와 다르면 실패합니다.`
      + ` 브라우저 주소창을 localhost 로 바꿔 보세요.`;
  }
  if (isLocal && !config.appOrigin) return '';
  return `카카오 개발자 콘솔에 이 값이 그대로 등록돼 있어야 합니다: ${uri}`;
}

/** GET /api/auth/config - 프론트가 로그인 버튼을 보여줄지 판단합니다. */
router.get('/config', (req, res) => {
  const providers = [];
  if (config.kakaoRestKey) providers.push('kakao');
  res.json({
    kakao: !!config.kakaoRestKey,
    devLogin: config.allowDevLogin,
    redirectUri: redirectUri(req),
    // 이 주소로 카카오 로그인이 될지. 비어 있으면 문제없습니다.
    redirectWarning: redirectHint(req),
    staleEnv: staleEnvNotice(),
    providers,
  });
});

/** GET /api/auth/me */
router.get('/me', (req, res) => {
  res.json({ user: publicUser(userFromRequest(req)) });
});

/** POST /api/auth/logout */
router.post('/logout', async (req, res) => {
  await destroySession(readCookie(req, SESSION_COOKIE));
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});

/**
 * POST /api/auth/dev-login  { nickname? }
 *
 * OAuth 키가 없어도 로컬에서 로그인 이후 화면을 확인할 수 있게 하는 통로입니다.
 * 배포(VERCEL)에서는 config.allowDevLogin 이 false 라 항상 404 입니다.
 */
router.post('/dev-login', async (req, res) => {
  if (!config.allowDevLogin) return res.status(404).json({ error: 'Not found' });

  const nickname = String((req.body && req.body.nickname) || '테스트 여행자').slice(0, 30);
  const user = await upsertUser({
    provider: 'dev',
    providerId: 'dev:' + nickname,
    nickname,
    email: 'dev@happylocal.local',
  });

  // 로컬에서만: 역할·범위를 바로 붙여 매장/농가 화면을 확인할 수 있게 합니다.
  // 배포(VERCEL)에서는 이 라우트 자체가 404 라 노출되지 않습니다.
  const { roles, scope } = req.body || {};
  if (Array.isArray(roles) && roles.length) {
    await mutate((db) => {
      const u = db.users.find((x) => x.id === user.id);
      if (!u) return;
      u.roles = roles.filter((r) => ROLES.includes(r));
      if (!u.roles.length) u.roles = ['customer'];
      u.scope = {
        storeKeys: Array.isArray(scope?.storeKeys) ? scope.storeKeys : [],
        productIds: Array.isArray(scope?.productIds) ? scope.productIds : [],
        regions: Array.isArray(scope?.regions) ? scope.regions : [],
      };
      for (const p of db.products) {
        if (u.scope.productIds.includes(p.id)) p.producerId = u.id;
      }
      user.roles = u.roles;
      user.scope = u.scope;
    });
  }
  const { token, maxAgeSec } = await createSession(user.id);
  setCookie(res, SESSION_COOKIE, token, { maxAgeSec });
  res.json({ user: publicUser(user), dev: true });
});

/**
 * GET /api/auth/roles - 내 역할과 담당 범위.
 * 관리자 화면이 어떤 메뉴를 띄울지 이걸로 정합니다.
 */
router.get('/roles', (req, res) => {
  if (!req.user) return res.json({ roles: [], scope: DEFAULT_SCOPE, status: 'guest', can: {} });
  const base = publicRoles(req.user);
  const places = collections.content().PLACES || {};
  res.json({
    ...base,
    user: publicUser(req.user),
    stores: myStores(req.user).map((s) => ({
      key: s.key, name: (places[s.key] || {}).nm || s.key, addr: s.addr || '',
    })),
    products: myProducts(req.user).map((p) => ({
      id: p.id, name: p.name, farm: p.farm, stock: p.stock, placeKey: p.placeKey || null,
    })),
  });
});

// ================================================================
// 아이디 · 비밀번호 로그인
//
// 소셜 로그인만 있으면 카카오 계정이 없는 사람은 들어올 수 없고,
// 배포에서는 개발용 로그인이 막혀 있어 확인할 길이 없습니다.
// ================================================================

/** 로그인 시도 제한. 같은 아이디를 무차별로 두드리는 것을 늦춥니다. */
const attempts = new Map();
const MAX_TRIES = 8;
const WINDOW_MS = 10 * 60 * 1000;

function tooManyTries(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_TRIES;
}
function noteFail(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else rec.count += 1;
}
const clearTries = (key) => attempts.delete(key);

/**
 * POST /api/auth/register  { loginId, password, nickname?, email?, ref? }
 * 가입은 언제나 일반 사용자입니다. 역할은 최고관리자만 올려줍니다.
 */
router.post('/register', async (req, res) => {
  const { loginId, password, nickname = '', email = '', ref = '' } = req.body || {};

  const idCheck = checkLoginId(loginId);
  if (!idCheck.ok) return res.status(400).json({ error: idCheck.error, field: 'loginId' });
  const pwCheck = checkPassword(password);
  if (!pwCheck.ok) return res.status(400).json({ error: pwCheck.error, field: 'password' });

  const taken = collections.users().some(
    (u) => u.provider === 'local' && u.providerId === idCheck.id);
  if (taken) {
    return res.status(409).json({ error: '이미 쓰이는 아이디입니다.', code: 'ID_TAKEN', field: 'loginId' });
  }

  const user = await upsertUser({
    provider: 'local',
    providerId: idCheck.id,
    nickname: String(nickname).trim().slice(0, 20) || idCheck.id,
    email: String(email).trim().slice(0, 100),
    ref,
  });

  const hash = await hashPassword(password);
  await mutate((db) => {
    const u = db.users.find((x) => x.id === user.id);
    if (u) { u.passwordHash = hash; u.passwordSetAt = new Date().toISOString(); }
  });

  const { token, maxAgeSec } = await createSession(user.id);
  setCookie(res, SESSION_COOKIE, token, { maxAgeSec });
  res.status(201).json({ user: publicUser(user) });
});

/** POST /api/auth/login  { loginId, password } */
router.post('/login', async (req, res) => {
  const { loginId, password } = req.body || {};
  const id = normalizeLoginId(loginId);
  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' });
  }
  if (tooManyTries(id)) {
    return res.status(429).json({
      error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', code: 'TOO_MANY_TRIES',
    });
  }

  const user = collections.users().find(
    (u) => u.provider === 'local' && u.providerId === id);

  // 아이디가 없는 것과 비밀번호가 틀린 것을 구분해 주지 않습니다.
  // (구분해 주면 어떤 아이디가 존재하는지 알려주는 셈입니다.)
  const ok = user && await verifyPassword(password, user.passwordHash);
  if (!ok) {
    noteFail(id);
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.', code: 'BAD_CREDENTIALS' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: '정지된 계정입니다.', code: 'SUSPENDED' });
  }

  clearTries(id);
  const fresh = await upsertUser({
    provider: 'local', providerId: id, nickname: user.nickname, email: user.email,
  });
  const { token, maxAgeSec } = await createSession(fresh.id);
  setCookie(res, SESSION_COOKIE, token, { maxAgeSec });
  res.json({ user: publicUser(fresh) });
});

/** POST /api/auth/password  { current, next } - 비밀번호 변경 */
router.post('/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
  if (req.user.provider !== 'local') {
    return res.status(400).json({ error: '소셜 로그인 계정은 비밀번호가 없습니다.' });
  }
  const { current, next } = req.body || {};
  if (!await verifyPassword(current, req.user.passwordHash)) {
    return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  }
  const chk = checkPassword(next);
  if (!chk.ok) return res.status(400).json({ error: chk.error });

  const hash = await hashPassword(next);
  await mutate((db) => {
    const u = db.users.find((x) => x.id === req.user.id);
    if (u) { u.passwordHash = hash; u.passwordSetAt = new Date().toISOString(); }
  });
  res.json({ ok: true });
});

/** GET /api/auth/kakao - 인가 페이지로 리다이렉트 */
router.get('/kakao', (req, res) => {
  // 값을 고치고 재시작을 안 했으면 여기서 잡힙니다. 카카오까지 갔다 와서
  // "설정이 맞지 않다" 를 보는 것보다 먼저 아는 편이 낫습니다.
  const stale = staleEnvNotice();
  if (stale) console.warn(`[auth] ${stale}`);
  const hint = redirectHint(req);
  if (hint) console.warn(`[auth] ${hint}`);
  if (!config.kakaoRestKey) {
    return res.status(503).json({
      error: '카카오 로그인이 설정되지 않았습니다.',
      hint: 'server/.env 에 KAKAO_REST_KEY 를 넣고, 카카오 개발자 콘솔에서 카카오 로그인 활성화와 Redirect URI 등록을 해주세요.',
    });
  }
  // CSRF 방지용 state 를 쿠키에 심고 콜백에서 대조합니다.
  const state = crypto.randomBytes(16).toString('base64url');
  setCookie(res, STATE_COOKIE, state, { maxAgeSec: 600 });

  const url = new URL(KAKAO_AUTH);
  url.searchParams.set('client_id', config.kakaoRestKey);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

/** GET /api/auth/kakao/callback */
router.get('/kakao/callback', async (req, res) => {
  const fail = (msg, hint, code) => {
    const u = new URL(`${appOrigin(req)}/happylocal_v2.html`);
    u.searchParams.set('login', 'error');
    u.searchParams.set('reason', msg);
    // 카카오 오류코드를 화면까지 넘겨, 무엇을 고쳐야 하는지 바로 보이게 합니다.
    if (code) u.searchParams.set('code', String(code));
    if (hint) console.warn(`[auth] ${msg} — ${hint}`);
    res.redirect(u.toString());
  };

  if (req.query.error) {
    return fail(String(req.query.error_description || req.query.error));
  }

  const expected = readCookie(req, STATE_COOKIE);
  clearCookie(res, STATE_COOKIE);
  if (!expected || req.query.state !== expected) {
    return fail('state_mismatch', 'CSRF 방지용 state 가 맞지 않습니다. 쿠키가 차단됐거나 요청이 위조됐습니다.');
  }

  const code = String(req.query.code || '');
  if (!code) return fail('no_code');

  try {
    // 1) 코드 -> 토큰
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.kakaoRestKey,
      redirect_uri: redirectUri(req),
      code,
    });
    if (config.kakaoClientSecret) body.set('client_secret', config.kakaoClientSecret);

    const tokenRes = await fetch(KAKAO_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body,
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      // 카카오 오류코드마다 고칠 곳이 다릅니다. 예전에는 무엇이든 "Redirect URI
      // 를 확인하세요" 라고만 해서, 실제로는 Client Secret 문제인데 엉뚱한 곳만
      // 계속 들여다보게 만들었습니다.
      const code = tokenJson.error_code || '';
      const why = {
        // 보안 > Client Secret 을 "사용함" 으로 켰는데 값을 안 보낸 경우가 대부분입니다.
        KOE010: config.kakaoClientSecret
          ? 'REST API 키 또는 Client Secret 값이 콘솔과 다릅니다.'
          : '콘솔에서 Client Secret 을 "사용함" 으로 켜 두셨다면 그 값을 '
            + 'server/.env 의 KAKAO_CLIENT_SECRET 에 넣어야 합니다 (또는 콘솔에서 끄세요).',
        KOE006: `등록된 Redirect URI 와 다릅니다. 콘솔에 이 값이 그대로 있어야 합니다: ${redirectUri(req)}`,
        KOE320: '인가 코드가 만료됐거나 이미 쓰였습니다. 다시 시도해 주세요.',
        KOE303: 'Redirect URI 가 인가 요청 때와 다릅니다.',
      }[code] || 'REST API 키와 Redirect URI 등록을 확인하세요.';

      const stale = staleEnvNotice();
      return fail('token_exchange_failed',
        `${tokenRes.status} ${code || tokenJson.error} — ${why}`
        + (stale ? `${NL_HINT}${stale}` : ''), code);
    }

    // 2) 토큰 -> 사용자 정보
    const meRes = await fetch(KAKAO_ME, {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me.id) {
      return fail('userinfo_failed', `${meRes.status} ${JSON.stringify(me).slice(0, 200)}`);
    }

    const acc = me.kakao_account || {};
    const prof = acc.profile || {};
    const user = await upsertUser({
      provider: 'kakao',
      providerId: me.id,
      nickname: prof.nickname || '여행자',
      email: acc.email || '',
      avatar: prof.thumbnail_image_url || '',
    });

    // 3) 세션 발급
    const { token, maxAgeSec } = await createSession(user.id);
    setCookie(res, SESSION_COOKIE, token, { maxAgeSec });

    const u = new URL(`${appOrigin(req)}/happylocal_v2.html`);
    u.searchParams.set('login', 'ok');
    res.redirect(u.toString());
  } catch (e) {
    console.error('[auth] callback error', e);
    fail('server_error', e.message);
  }
});
