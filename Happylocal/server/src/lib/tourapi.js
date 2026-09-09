import { config, hasTourKey } from '../config.js';
import { TtlCache } from './cache.js';
import { mockFor } from './fixtures.js';

const cache = new TtlCache(config.cacheTtlMs);

export class TourApiError extends Error {
  constructor(message, { code, status, endpoint, hint } = {}) {
    super(message);
    this.name = 'TourApiError';
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
    this.hint = hint;
  }
}

/**
 * data.go.kr 오류는 JSON 이 아니라 XML 봉투로 돌아옵니다 (_type=json 을 줘도).
 * 그래서 응답을 먼저 텍스트로 받아 형태를 판별해야 합니다.
 */
const XML_ERROR_HINTS = {
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR:
    '서비스키가 등록되지 않았습니다. .env 의 TOUR_API_KEY 가 Decoding 키인지, 활용신청이 승인됐는지 확인하세요.',
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR:
    '일일 호출 한도를 초과했습니다. 내일 초기화되거나, 운영계정으로 상향 신청이 필요합니다.',
  SERVICE_ACCESS_DENIED_ERROR:
    '해당 오퍼레이션에 접근 권한이 없습니다. 활용신청한 서비스가 맞는지 확인하세요.',
  UNKNOWN_ERROR:
    'TourAPI 내부 오류입니다. 잠시 후 재시도하세요.',
  NO_OPENAPI_SERVICE_ERROR:
    '존재하지 않는 오퍼레이션입니다. TOUR_API_BASE 가 KorService2 인지 확인하세요 (구 계정은 KorService1).',
};

function parseXmlErrorCode(text) {
  const m = /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/.exec(text)
    || /<errMsg>([^<]+)<\/errMsg>/.exec(text)
    || /<resultMsg>([^<]+)<\/resultMsg>/.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * TourAPI 는 결과가 0건이면 items 를 빈 문자열("")로, 1건이면 배열이 아닌
 * 객체 하나로 돌려줍니다. 호출부가 매번 방어하지 않도록 여기서 배열로 통일합니다.
 */
export function normalizeItems(body) {
  const items = body?.items;
  if (!items || typeof items === 'string') return [];
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * 서비스키를 Encoding / Decoding 어느 쪽으로 넣어도 동작하게 정규화합니다.
 *
 * 공공데이터포털은 두 형태를 함께 보여주는데, 어느 쪽인지 모르고 넣는 경우가 많습니다.
 * Encoding 키(%2B, %3D 포함)를 그대로 다시 인코딩하면 이중 인코딩이 되어
 * SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 납니다.
 * 그래서 항상 한 번 디코딩해서 원본(Decoding) 형태로 맞춘 뒤 한 번만 인코딩합니다.
 */
export function normalizeServiceKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return k;
  if (!/%[0-9a-fA-F]{2}/.test(k)) return k;      // 이미 Decoding 키
  try {
    const dec = decodeURIComponent(k);
    return dec || k;
  } catch {
    return k;                                     // %가 있지만 유효한 이스케이프가 아님
  }
}

function buildUrl(endpoint, params) {
  const url = new URL(`${config.tour.base}/${endpoint}`);
  // serviceKey 는 URLSearchParams 가 다시 인코딩하지 않도록 마지막에 직접 붙입니다.
  const sp = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'HappyLocal',
    _type: 'json',
    ...params,
  });
  url.search = sp.toString();
  return `${url.toString()}&serviceKey=${encodeURIComponent(normalizeServiceKey(config.tour.key))}`;
}

/**
 * Calls one TourAPI operation. Returns { items, totalCount, raw }.
 * Throws TourApiError with an actionable `hint` on upstream failure.
 */
export async function callTourApi(endpoint, params = {}, { signal } = {}) {
  if (!hasTourKey()) {
    throw new TourApiError('TOUR_API_KEY is not configured', {
      code: 'NO_KEY',
      endpoint,
      hint: 'server/.env 에 TOUR_API_KEY 를 넣으면 실데이터로 전환됩니다. 지금은 시드 데이터로 동작 중입니다.',
    });
  }

  const key = `${endpoint}?${JSON.stringify(params)}`;
  return cache.wrap(key, async () => {
    // TOUR_MOCK=1: 네트워크를 타지 않고 내장 픽스처로 응답합니다.
    if (config.tour.mock) {
      const m = mockFor(endpoint, params);
      return { items: m.items, totalCount: m.totalCount, raw: null, mocked: true };
    }

    const url = buildUrl(endpoint, params);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    let res, text;
    try {
      res = await fetch(url, { signal: signal ?? ctrl.signal, headers: { Accept: 'application/json' } });
      text = await res.text();
    } catch (e) {
      throw new TourApiError(`TourAPI 요청 실패: ${e.message}`, {
        code: e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
        endpoint,
        hint: '네트워크 또는 방화벽에서 apis.data.go.kr 접근이 막혀 있는지 확인하세요.',
      });
    } finally {
      clearTimeout(timer);
    }

    const trimmed = text.trimStart();

    // 상태 코드가 실패인데 본문이 파싱 가능한 경우가 있어, 본문 판별을 먼저 하되
    // 아래 어느 분기에도 안 걸리면 상태 코드로 최종 판단합니다.
    const httpFailed = !res.ok;

    // XML 오류 봉투
    if (trimmed.startsWith('<')) {
      const code = parseXmlErrorCode(text) || 'UNKNOWN';
      throw new TourApiError(`TourAPI 오류: ${code}`, {
        code,
        status: res.status,
        endpoint,
        hint: XML_ERROR_HINTS[code] || 'data.go.kr 마이페이지에서 해당 API 승인 상태를 확인하세요.',
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new TourApiError('TourAPI 응답을 JSON 으로 해석하지 못했습니다.', {
        code: 'BAD_JSON', status: res.status, endpoint,
        hint: `응답 앞부분: ${trimmed.slice(0, 160)}`,
      });
    }

    // data.go.kr 게이트웨이 오류는 XML 뿐 아니라 **JSON** 으로도 옵니다.
    //   { "OpenAPI_ServiceResponse": { "cmmMsgHeader": { "errMsg": "...", ... } } }
    // 이 모양은 response.header 가 없어서, 아래 resultCode 검사만으로는 통과해버리고
    // items 가 없으니 "정상 0건" 으로 둔갑합니다. 잘못된 키가 조용히 빈 화면이 되는
    // 가장 나쁜 실패 모드라 명시적으로 걸러냅니다.
    const gw = json?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (gw) {
      const code = (gw.errMsg || gw.returnAuthMsg || 'UNKNOWN_ERROR').trim();
      throw new TourApiError(
        `TourAPI 오류: ${code}${gw.returnAuthMsg && gw.returnAuthMsg !== code ? ` (${gw.returnAuthMsg})` : ''}`,
        {
          code, status: res.status, endpoint,
          hint: XML_ERROR_HINTS[code] || 'data.go.kr 마이페이지에서 해당 API 승인 상태를 확인하세요.',
        }
      );
    }

    const header = json?.response?.header;
    if (header && header.resultCode && header.resultCode !== '0000') {
      throw new TourApiError(`TourAPI 오류: ${header.resultMsg || header.resultCode}`, {
        code: header.resultCode, endpoint,
        hint: XML_ERROR_HINTS[header.resultMsg] || undefined,
      });
    }

    // 여기까지 왔는데 응답에 response 봉투 자체가 없으면, 우리가 모르는 형태의
    // 오류입니다. 조용히 빈 배열을 돌려주지 않고 드러냅니다.
    if (!json?.response) {
      throw new TourApiError('TourAPI 응답 형식을 알 수 없습니다.', {
        code: 'UNEXPECTED_SHAPE', status: res.status, endpoint,
        hint: `응답 앞부분: ${trimmed.slice(0, 200)}`,
      });
    }

    const body = json?.response?.body;
    if (httpFailed) {
      throw new TourApiError(`TourAPI HTTP ${res.status}`, {
        code: 'HTTP_' + res.status, status: res.status, endpoint,
        hint: '요청은 도달했지만 게이트웨이가 거부했습니다. 서비스키와 승인 상태를 확인하세요.',
      });
    }

    return {
      items: normalizeItems(body),
      totalCount: Number(body?.totalCount || 0),
      raw: json,
    };
  });
}

/** 지역기반 관광정보 조회 */
export function areaBasedList({ sigunguCode, contentTypeId, numOfRows = 30, pageNo = 1, arrange = 'O' }) {
  return callTourApi('areaBasedList2', {
    areaCode: config.tour.areaCode,
    ...(sigunguCode ? { sigunguCode } : {}),
    ...(contentTypeId ? { contentTypeId } : {}),
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
    arrange,
  });
}

/** 축제정보 조회 (기간 필터) */
export function searchFestival({ sigunguCode, eventStartDate, numOfRows = 30, pageNo = 1 }) {
  return callTourApi('searchFestival2', {
    areaCode: config.tour.areaCode,
    ...(sigunguCode ? { sigunguCode } : {}),
    eventStartDate,
    numOfRows: String(numOfRows),
    pageNo: String(pageNo),
    arrange: 'O',
  });
}

/**
 * 강원 전체 축제.
 *
 * 대상 3개 군(횡성·평창·정선)에는 TourAPI 축제가 한 건도 등록돼 있지 않습니다
 * (areaBasedList/searchFestival 모두 0건, 2024~2026 확인). 그래서 시군구를 풀고
 * 도 전체에서 받아옵니다.
 */
export function gangwonFestivals({ from, numOfRows = 50 } = {}) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  const def = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}01`;
  return searchFestival({ eventStartDate: from || def, numOfRows });
}

/** 공통 상세정보 */
export function detailCommon(contentId) {
  return callTourApi('detailCommon2', { contentId: String(contentId) });
}

/** 소개 상세정보 (운영시간, 휴무일 등 - contentTypeId 별로 필드가 다릅니다) */
export function detailIntro(contentId, contentTypeId) {
  return callTourApi('detailIntro2', {
    contentId: String(contentId),
    contentTypeId: String(contentTypeId),
  });
}

/** 이미지 목록 */
export function detailImages(contentId) {
  return callTourApi('detailImage2', {
    contentId: String(contentId),
    imageYN: 'Y',
  });
}

/** 시군구 코드표 - 하드코딩한 코드가 맞는지 기동 시 검증하는 데 씁니다. */
export function areaCodeList(areaCode) {
  return callTourApi('areaCode2', {
    ...(areaCode ? { areaCode } : {}),
    numOfRows: '50',
  });
}

export const tourCache = cache;
