import express from 'express';
import { mutate, collections } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';
import { annotate } from '../lib/coupon.js';

export const router = express.Router();

/**
 * 계정 부가 기능: 알림 설정 · 친구 초대 · 쿠폰 조회.
 *
 * 셋 다 화면만 있고 서버가 없었습니다.
 *   - 알림 설정은 클래스만 토글해서 화면을 벗어나면 초기화됐습니다.
 *   - 초대코드는 HTML 에 박힌 값이라 모든 사용자가 같았습니다.
 *   - 쿠폰은 목록만 보이고 결제에는 쓰이지 않았습니다.
 */

// 알림 설정 화면의 다섯 줄과 1:1 로 맞춘 키입니다.
const DEFAULT_SETTINGS = {
  pickupReminder: true,     // 픽업 임박 알림
  orderStatus: true,        // 예약 상태 변경
  saleAlert: true,          // 신규 세일 알림
  couponEvent: false,       // 쿠폰 · 이벤트
  nightMute: false,         // 21:00~08:00 알림 끄기
};

/** GET /api/settings */
router.get('/settings', requireAuth, (req, res) => {
  res.json({ settings: { ...DEFAULT_SETTINGS, ...(req.user.settings || {}) } });
});

/** PUT /api/settings  body: { key, value } 또는 { settings: {...} } */
router.put('/settings', requireAuth, async (req, res) => {
  const { key, value, settings } = req.body || {};

  const patch = settings && typeof settings === 'object'
    ? settings
    : (key !== undefined ? { [key]: value } : null);

  if (!patch) return res.status(400).json({ error: 'key/value 또는 settings 가 필요합니다.' });

  const unknown = Object.keys(patch).filter((k) => !(k in DEFAULT_SETTINGS));
  if (unknown.length) {
    return res.status(400).json({ error: `알 수 없는 설정: ${unknown.join(', ')}`, allowed: Object.keys(DEFAULT_SETTINGS) });
  }

  const result = await mutate((db) => {
    const u = db.users.find((x) => x.id === req.user.id);
    u.settings = { ...DEFAULT_SETTINGS, ...(u.settings || {}) };
    for (const [k, v] of Object.entries(patch)) u.settings[k] = !!v;
    return u.settings;
  });
  res.json({ settings: result });
});

/** GET /api/invite - 내 초대코드와 성과 */
router.get('/invite', requireAuth, (req, res) => {
  const invited = collections.users().filter((u) => u.invitedBy === req.user.id);
  res.json({
    code: req.user.inviteCode,
    invitedCount: invited.length,
    invited: invited.map((u) => ({ nickname: u.nickname, joinedAt: u.createdAt })),
    // 초대받은 사람이 이 링크로 들어오면 가입 시 나에게 연결됩니다.
    link: `${req.protocol}://${req.get('host')}/happylocal_v2.html?ref=${encodeURIComponent(req.user.inviteCode)}`,
    reward: '친구가 첫 픽업을 완료하면 5,000원 쿠폰을 드려요.',
  });
});

/** GET /api/coupons/usable?amount=52000&region=횡성 - 결제에 쓸 수 있는 쿠폰 */
router.get('/coupons/usable', requireAuth, (req, res) => {
  const amount = Number(req.query.amount) || 0;
  const region = String(req.query.region || '');
  const mine = collections.coupons().filter((c) => c.userId === req.user.id && !c.used);
  const list = annotate(mine, { amount, region });
  res.json({
    count: list.length,
    coupons: list.sort((a, b) => Number(b.usable) - Number(a.usable) || b.discount - a.discount),
  });
});

export { DEFAULT_SETTINGS };
