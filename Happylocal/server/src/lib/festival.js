import { config, hasTourKey } from '../config.js';
import { normalizeServiceKey, TourApiError } from './tourapi.js';
import { TtlCache } from './cache.js';

/**
 * 전국문화축제표준데이터 (data.go.kr / 15013104).
 *
 * TourAPI 에는 횡성·평창·정선 축제가 한 건도 없습니다. 이 표준데이터는
 * 지자체 229곳이 직접 등록해서 대상 3개 군 축제가 실제로 들어 있습니다.
 * data.go.kr 서비스키는 계정 단위라 TOUR_API_KEY 를 그대로 씁니다.
 *
 * 주의: 지자체마다 갱신 시점이 달라 지난 연도 일정이 섞여 있습니다
 * (예: 횡성은 2023년에 멈춰 있음). 그래서 연도를 떼고 "매년 10월경" 형태로
 * 보여주고, 실제 마지막 개최 일정은 따로 남깁니다.
 */

const ENDPOINT = 'https://api.data.go.kr/openapi/tn_pubr_public_cltur_fstvl_api';
// 분기별 갱신이라 오래 캐시해도 됩니다.
const cache = new TtlCache(6 * 60 * 60 * 1000);

async function fetchPage(pageNo, numOfRows) {
  const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(normalizeServiceKey(config.tour.key))}`
    + `&type=json&pageNo=${pageNo}&numOfRows=${numOfRows}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  let text;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  let json;
  try { json = JSON.parse(text); } catch {
    throw new TourApiError('축제표준데이터 응답을 해석하지 못했습니다.', {
      code: 'BAD_JSON', endpoint: 'tn_pubr_public_cltur_fstvl_api',
      hint: `응답 앞부분: ${text.slice(0, 160)}`,
    });
  }

  // 이 API 는 TourAPI 와 달리 response 봉투가 없습니다.
  const gw = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gw) {
    const code = (gw.errMsg || gw.returnAuthMsg || 'UNKNOWN').trim();
    throw new TourApiError(`축제표준데이터 오류: ${code}`, {
      code, endpoint: 'tn_pubr_public_cltur_fstvl_api',
      hint: '공공데이터포털에서 "전국문화축제표준데이터" 활용신청이 승인됐는지 확인하세요.',
    });
  }
  if (json?.header?.resultCode && json.header.resultCode !== '00') {
    throw new TourApiError(`축제표준데이터 오류: ${json.header.resultMsg}`, {
      code: json.header.resultCode, endpoint: 'tn_pubr_public_cltur_fstvl_api',
    });
  }

  const body = json?.body || {};
  const item = body?.items?.item;
  return {
    items: !item ? [] : (Array.isArray(item) ? item : [item]),
    totalCount: Number(body.totalCount || 0),
  };
}

/** 전국 축제를 모두 받아옵니다 (1,300여 건, 캐시됨). */
export function allFestivals() {
  if (!hasTourKey()) {
    return Promise.reject(new TourApiError('TOUR_API_KEY 가 없습니다.', { code: 'NO_KEY' }));
  }
  return cache.wrap('all', async () => {
    const first = await fetchPage(1, 1000);
    let items = first.items;
    const pages = Math.ceil(first.totalCount / 1000);
    for (let p = 2; p <= pages && p <= 5; p++) {
      const next = await fetchPage(p, 1000);
      items = items.concat(next.items);
    }
    return items;
  });
}

const addrOf = (f) => `${f.rdnmadr || ''} ${f.lnmadr || ''} ${f.insttNm || ''}`;

/** 강원 축제만. region 을 주면 그 시군만. */
export async function gangwonFestivals(region) {
  const all = await allFestivals();
  const gw = all.filter((f) => /강원/.test(addrOf(f)));
  if (!region) return gw;
  return gw.filter((f) => addrOf(f).includes(region));
}

const MONTH_PART = (day) => (day <= 10 ? '초' : day <= 20 ? '중순' : '말');

/**
 * 지난 연도 일정을 그대로 보여주면 "2023년 축제" 가 앱에 뜹니다.
 * 연도를 떼고 매년 열리는 시기로 바꿔 표현합니다.
 */
export function periodLabel(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s) return '개최 시기 미정';
  if (e && e.month !== s.month) return `매년 ${s.month}~${e.month}월`;
  return `매년 ${s.month}월 ${MONTH_PART(s.day)}`;
}

/** 실제 마지막 개최 일정. 상세 화면에 그대로 보여줍니다. */
export function lastHeldLabel(start, end) {
  const s = parseDate(start);
  const e = parseDate(end);
  if (!s) return '';
  const f = (d) => `${d.year}.${String(d.month).padStart(2, '0')}.${String(d.day).padStart(2, '0')}`;
  return e ? `${f(s)}~${String(e.month).padStart(2, '0')}.${String(e.day).padStart(2, '0')}` : f(s);
}

function parseDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3] };
}

/** 표준데이터 항목 -> 앱의 PLACES/GEO shape */
export function toFestivalPlace(f) {
  const lat = Number(f.latitude);
  const lng = Number(f.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;

  const addr = (f.rdnmadr || f.lnmadr || '').trim();
  const m = /강원(?:특별자치)?도\s+([가-힣]+(?:시|군))/.exec(addr + ' ' + (f.insttNm || ''));
  const sigun = m ? m[1] : '';
  const dong = /([가-힣]+(?:읍|면|동))/.exec(addr);

  return {
    key: `cf${(f.fstvlNm || '').replace(/\s/g, '')}_${String(f.fstvlStartDate || '').slice(0, 7)}`,
    sigun,
    geo: [lat, lng],
    place: {
      ic: '🎪',
      nm: (f.fstvlNm || '').trim(),
      type: 'festival',
      lab: '축제',
      region: dong ? dong[1] : sigun,
      desc: (f.fstvlCo || '').trim(),
      period: periodLabel(f.fstvlStartDate, f.fstvlEndDate),
      lastHeld: lastHeldLabel(f.fstvlStartDate, f.fstvlEndDate),
      hours: '',
      feature: (f.opar || '').trim(),
      address: addr,
      tel: (f.phoneNumber || '').trim(),
      host: (f.mnnstNm || '').trim(),
      homepage: (f.homepageUrl || '').trim(),
      image: '',
      source: 'festival-std',
    },
  };
}
