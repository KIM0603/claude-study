import { config, CONTENT_TYPE, TYPE_OF_CONTENT } from '../config.js';

/**
 * TourAPI 응답을 프론트엔드가 이미 렌더링하고 있는 shape 으로 변환합니다.
 *
 * 이 파일이 이 프로젝트의 핵심입니다. 프론트의 5,400줄짜리 렌더링 코드를
 * 건드리지 않기 위해, 서버가 기존 목업과 **동일한 필드 이름**으로 응답합니다.
 * (PLACES / GEO / STORES / PL …)
 */

const SIGUNGU_TO_REGION = Object.fromEntries(
  Object.entries(config.tour.sigungu).map(([name, code]) => [String(code), name])
);

export const regionOfSigungu = (code) => SIGUNGU_TO_REGION[String(code)] || '';

/** cat3 / 제목에서 적당한 이모지를 고릅니다. 목업이 쓰던 아이콘 톤을 유지합니다. */
function pickIcon(item, type) {
  const t = `${item.title || ''} ${item.cat3 || ''} ${item.cat2 || ''}`;
  const has = (...words) => words.some((w) => t.includes(w));

  if (type === 'festival') {
    if (has('메밀', '꽃')) return '🌸';
    if (has('송어', '낚시', '어')) return '🎣';
    if (has('아리랑', '음악', '공연')) return '🎶';
    return '🎪';
  }
  if (type === 'food') {
    if (has('한우', '고기', '갈비', '구이')) return '🥩';
    if (has('막국수', '국수', '냉면', '메밀')) return '🍜';
    if (has('시장', '장터')) return '🍲';
    if (has('카페', '커피', '디저트')) return '☕';
    return '🍚';
  }
  // tour
  if (has('사찰', '절', '사')) return '🛕';
  if (has('성당', '교회')) return '⛪';
  if (has('목장', '양떼')) return '🐑';
  if (has('케이블카', '전망', '스카이')) return '🚠';
  if (has('레일바이크', '체험')) return '🚲';
  if (has('시장')) return '🏮';
  if (has('휴양림', '숲', '수목')) return '🌲';
  if (has('호수', '강', '계곡')) return '🏞️';
  if (has('미술관', '박물관', '전시')) return '🎨';
  return '⛰️';
}

const LABEL = { tour: '관광', festival: '축제', food: '점심', pickup: '픽업' };

/** "20251022" -> "2025.10.22" */
function fmtDate(s) {
  const v = String(s || '');
  if (!/^\d{8}$/.test(v)) return '';
  return `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}`;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short address suffix the UI shows as `region` (e.g. "횡성읍", "우천면"). */
function shortRegion(item) {
  const addr = `${item.addr1 || ''}`;
  const m = /([가-힣]+(?:읍|면|동|리))/.exec(addr);
  if (m) return m[1];
  return regionOfSigungu(item.sigungucode) || addr.split(' ').slice(-1)[0] || '';
}

/** A stable, collision-free key for a TourAPI content item. */
export const keyOf = (item) => `t${item.contentid}`;

/**
 * TourAPI item -> PLACES entry (+ GEO coordinate).
 * Returns null when the item has no usable coordinate, since the map needs one.
 */
export function toPlace(item) {
  const type = TYPE_OF_CONTENT[String(item.contenttypeid)] || 'tour';
  const lat = Number(item.mapy);
  const lng = Number(item.mapx);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;

  const place = {
    ic: pickIcon(item, type),
    nm: item.title,
    type,
    lab: LABEL[type],
    region: shortRegion(item),
    desc: stripTags(item.overview) || `${item.addr1 || ''}`.trim(),
    hours: '',
    // --- 아래는 목업에 없던 추가 필드. 기존 렌더러는 무시하고, 새 상세화면이 씁니다.
    contentId: String(item.contentid),
    contentTypeId: String(item.contenttypeid),
    image: item.firstimage || item.firstimage2 || '',
    thumb: item.firstimage2 || item.firstimage || '',
    tel: item.tel || '',
    address: [item.addr1, item.addr2].filter(Boolean).join(' ').trim(),
    source: 'tourapi',
  };

  if (type === 'festival') {
    const from = fmtDate(item.eventstartdate);
    const to = fmtDate(item.eventenddate);
    place.period = from && to ? `${from}~${to}` : from || '행사 기간 운영';
  }
  return { key: keyOf(item), place, geo: [lat, lng] };
}

/** Merges detailIntro fields (운영시간/휴무/메뉴) into a place. */
export function enrichWithIntro(place, intro, contentTypeId) {
  if (!intro) return place;
  const ct = String(contentTypeId);
  const pick = (...keys) => {
    for (const k of keys) if (intro[k]) return stripTags(intro[k]);
    return '';
  };

  if (ct === CONTENT_TYPE.FOOD) {
    place.hours = pick('opentimefood');
    place.menu = pick('firstmenu', 'treatmenu');
    place.feature = pick('smoking', 'packing');
    place.restDate = pick('restdatefood');
  } else if (ct === CONTENT_TYPE.FESTIVAL) {
    place.hours = pick('playtime');
    place.feature = pick('eventplace', 'program');
    place.fee = pick('usetimefestival');
  } else {
    place.hours = pick('usetime', 'opentime');
    place.feature = pick('expguide', 'infocenter');
    place.restDate = pick('restdate');
    place.parking = pick('parking');
  }
  return place;
}

/**
 * TourAPI item -> STORES entry (지도 화면의 카드 + 마커).
 * 목업 STORES 와 동일한 필드로 맞춥니다.
 */
const STORE_TILE = { tour: '#3f5142', festival: '#6a4733', food: '#5a4636', pickup: '#5e5236' };

export function toStoreCard(item, place) {
  return {
    key: keyOf(item),
    // `cat` 은 프론트가 마커 아이콘을 고르는 데 쓰는 문자열입니다.
    // 관광/축제는 목업에 없던 갈래라 라벨을 그대로 넘겨 아이콘 매핑에 태웁니다.
    cat: place.type === 'festival' ? '축제'
       : place.type === 'tour' ? '관광'
       : place.lab || '관광',
    type: place.type,
    rate: '0.0',            // TourAPI 는 평점을 제공하지 않습니다
    rev: 0,
    off: false,
    tile: STORE_TILE[place.type] || '#3f5142',
    rg: regionOfSigungu(item.sigungucode) || '',
    dist: '',
    addr: place.address || '',
    tags: [place.lab, place.region].filter(Boolean),
    period: place.period || '',
    source: 'tourapi',
  };
}

/**
 * 주문 -> 프론트의 MY_PICKUPS 항목.
 * 목업이 쓰던 필드명을 그대로 맞춰서 렌더링 코드를 건드리지 않습니다.
 */
export function orderToPickup(order, product) {
  const fmtNum = (n) => Number(n || 0).toLocaleString('ko-KR');
  const was = order.unitPriceWas || (product ? product.priceWas : 0);
  const now = order.unitPrice || 0;
  const status = { reserved: '결제완료', completed: '픽업완료', cancelled: '취소' }[order.status] || '결제완료';

  return {
    shop: order.farm,
    prod: order.productName,
    disc: was > 0 ? Math.round((1 - now / was) * 100) : 0,
    now: fmtNum(now),
    was: fmtNum(was),
    stock: product ? (product.stock > 0 ? `${product.stock}팩 남음` : '마감') : '예약 완료',
    code: order.code,
    group: order.pickupDate || '오늘 픽업',
    status,
    // --- 목업에 없던 필드. 취소/완료 처리에 필요합니다.
    orderId: order.id,
    productId: order.productId,
    qty: order.qty,
  };
}

/** Our own pickup products -> the PL shape the list screen renders. */
export function productToPL(p) {
  const fmt = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
  const unit = /세트|인분|박스|팩|개/.exec(p.name)?.[0] || '팩';
  return {
    fid: p.id,
    name: p.farm,
    region: p.region,
    cat: p.category,
    prod: p.name,
    dist: p.distance,
    rate: p.rateCount,
    mode: p.mode,
    day: p.pickupDay,
    hours: p.hours,
    predate: p.pickupDate,
    was: fmt(p.priceWas),
    now: fmt(p.priceNow),
    t1: p.tile?.[0] || '#5a4636',
    t2: p.tile?.[1] || '#6a4733',
    tag: p.stock > 0
      ? `${p.pickupDay || '오늘'} ${p.stock}${unit} 예약가능`
      : '오늘 마감',
    seasonal: p.seasonal ? 1 : 0,
    stock: p.stock,
    soldOut: p.stock <= 0,
  };
}
