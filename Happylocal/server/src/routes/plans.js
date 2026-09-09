import express from 'express';
import crypto from 'node:crypto';
import { mutate, collections } from '../lib/store.js';
import { requireAuth } from '../lib/auth.js';

export const router = express.Router();

/**
 * 여행 계획(저장한 코스).
 *
 * 기존 addToPlan() 은 토스트만 띄우고 아무것도 저장하지 않았습니다.
 * 여기서 실제로 계정별로 저장하고, 일정 변경·삭제까지 다룹니다.
 */

const newId = () => 'pl_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const plansOf = (userId) => (collections.plans() || []).filter((p) => p.userId === userId);

/** 프론트의 MY_COURSES 항목 모양으로 바꿉니다. */
export function planToCourse(p) {
  return {
    id: p.id,
    kind: p.kind,                 // 'active' = 진행 중 여행, 그 외 = 예정
    title: p.title,
    region: p.region,
    dur: p.dur,
    date: p.date,
    price: p.price,
    sum: p.sum,
    stops: p.stops,               // [{ key, time }]
    courseId: p.courseId,
    createdAt: p.createdAt,
  };
}

/** GET /api/plans - 내 여행 계획 */
router.get('/', requireAuth, (req, res) => {
  const list = plansOf(req.user.id)
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ count: list.length, plans: list.map(planToCourse) });
});

/**
 * POST /api/plans
 * body: { courseId, title, region, dur, price, sum, stops[], date?, kind? }
 */
router.post('/', requireAuth, async (req, res) => {
  const {
    courseId = '', title = '', region = '', dur = '', price = '', sum = '',
    stops = [], date = '', kind = 'planned',
  } = req.body || {};

  if (!title.trim()) return res.status(400).json({ error: '코스 이름이 필요합니다.' });
  if (!Array.isArray(stops) || !stops.length) {
    return res.status(400).json({ error: '코스에 최소 한 곳 이상의 경유지가 필요합니다.' });
  }

  const result = await mutate((db) => {
    if (!db.plans) db.plans = [];
    // 같은 코스를 두 번 담으면 중복이 쌓입니다. 이미 있으면 그걸 돌려줍니다.
    const dup = db.plans.find((p) => p.userId === req.user.id && p.courseId && p.courseId === courseId);
    if (dup) return { status: 200, body: { plan: planToCourse(dup), duplicated: true } };

    const plan = {
      id: newId(),
      userId: req.user.id,
      courseId,
      title: title.trim(),
      region,
      dur,
      date,
      price,
      sum,
      kind,
      stops: stops.slice(0, 20).map((s) => ({ key: String(s.key || ''), time: String(s.time || '') })),
      createdAt: new Date().toISOString(),
    };
    db.plans.push(plan);
    return { status: 201, body: { plan: planToCourse(plan), duplicated: false } };
  });

  res.status(result.status).json(result.body);
});

/** PATCH /api/plans/:id - 날짜 변경, 진행중으로 전환 등 */
router.patch('/:id', requireAuth, async (req, res) => {
  const { date, kind, title } = req.body || {};
  const result = await mutate((db) => {
    const p = (db.plans || []).find((x) => x.id === req.params.id && x.userId === req.user.id);
    if (!p) return { status: 404, body: { error: '계획을 찾을 수 없습니다.' } };
    if (date !== undefined) p.date = String(date);
    if (title !== undefined && String(title).trim()) p.title = String(title).trim();
    if (kind !== undefined) {
      if (!['planned', 'active', 'done'].includes(kind)) {
        return { status: 400, body: { error: 'kind 는 planned/active/done 중 하나여야 합니다.' } };
      }
      // 진행 중인 여행은 하나만 둡니다.
      if (kind === 'active') {
        db.plans.forEach((x) => { if (x.userId === req.user.id && x.kind === 'active') x.kind = 'planned'; });
      }
      p.kind = kind;
    }
    return { status: 200, body: { plan: planToCourse(p) } };
  });
  res.status(result.status).json(result.body);
});

/** DELETE /api/plans/:id */
router.delete('/:id', requireAuth, async (req, res) => {
  const result = await mutate((db) => {
    const i = (db.plans || []).findIndex((x) => x.id === req.params.id && x.userId === req.user.id);
    if (i < 0) return { status: 404, body: { error: '계획을 찾을 수 없습니다.' } };
    const [removed] = db.plans.splice(i, 1);
    return { status: 200, body: { removed: planToCourse(removed) } };
  });
  res.status(result.status).json(result.body);
});
