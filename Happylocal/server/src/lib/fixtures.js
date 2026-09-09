import { config } from '../config.js';

/**
 * TOUR_MOCK=1 일 때 쓰는 내장 픽스처.
 *
 * 실제 TourAPI 응답과 같은 필드명·타입(전부 문자열)·좌표 순서(mapx=경도, mapy=위도)를
 * 따르므로, 키를 넣는 순간 코드 변경 없이 그대로 실데이터로 바뀝니다.
 * 좌표는 각 시군 실제 중심부 근방 값입니다.
 */

const REGION_SEED = {
  '18': { name: '횡성', lat: 37.49, lng: 127.98, dong: ['횡성읍', '우천면', '갑천면', '둔내면', '안흥면', '서원면'] },
  '15': { name: '평창', lat: 37.63, lng: 128.55, dong: ['평창읍', '대관령면', '진부면', '봉평면', '용평면'] },
  '11': { name: '정선', lat: 37.38, lng: 128.66, dong: ['정선읍', '북평면', '여량면', '임계면', '화암면'] },
};

const NAMES = {
  '12': ['호수길 둘레코스', '자연휴양림', '전망대', '수목원', '계곡 트레킹', '역사공원', '박물관', '출렁다리'],
  '39': ['한우마을', '막국수 본점', '곤드레밥집', '산채정식', '전통시장 먹거리', '숯불구이'],
  '15': ['한우축제', '메밀꽃축제', '아리랑제', '눈꽃축제'],
};

const OVERVIEW = {
  '12': '<br>사계절 <b>자연 경관</b>이 아름다운 곳으로, 가족 단위 방문객에게 인기가 많습니다.&nbsp;',
  '39': '지역 농산물로 차린 향토 음식을 맛볼 수 있는 식당입니다.',
  '15': '<br>지역 대표 <b>축제</b>로 매년 많은 방문객이 찾습니다.',
};

/** 결정적(deterministic) 난수 - 같은 입력이면 항상 같은 결과라 테스트가 흔들리지 않습니다. */
function rand(seed) {
  let x = seed * 9301 + 49297;
  return ((x % 233280) / 233280);
}

export function mockAreaBasedList({ sigunguCode, contentTypeId, numOfRows = 10 }) {
  const codes = sigunguCode ? [String(sigunguCode)] : Object.keys(REGION_SEED);
  const ct = String(contentTypeId || '12');
  const names = NAMES[ct] || NAMES['12'];
  const items = [];

  for (const code of codes) {
    const r = REGION_SEED[code];
    if (!r) continue;
    const n = Math.min(Number(numOfRows), names.length);
    for (let i = 0; i < n; i++) {
      const s = Number(code) * 100 + i;
      // 실제 응답을 흉내내기 위해 일부러 좌표가 빈 항목을 하나 섞습니다.
      const noCoord = (i === 2 && ct === '12');
      const item = {
        contentid: String(Number(code) * 100000 + Number(ct) * 100 + i),
        contenttypeid: ct,
        title: `${r.name} ${names[i]}`,
        addr1: `강원특별자치도 ${r.name}군 ${r.dong[i % r.dong.length]}`,
        addr2: '',
        areacode: config.tour.areaCode,
        sigungucode: code,
        mapx: noCoord ? '' : String(r.lng + (rand(s) - 0.5) * 0.18),
        mapy: noCoord ? '' : String(r.lat + (rand(s + 7) - 0.5) * 0.14),
        firstimage: '',
        firstimage2: '',
        tel: '033-000-0000',
        cat3: 'A0101',
        overview: OVERVIEW[ct] || '',
      };
      if (ct === '15') {
        item.eventstartdate = '20260901';
        item.eventenddate = '20260905';
      }
      items.push(item);
    }
  }
  return { items, totalCount: items.length };
}

export function mockAreaCodeList() {
  return {
    items: Object.entries(REGION_SEED).map(([code, r]) => ({ code, name: `${r.name}군` })),
    totalCount: 3,
  };
}

export function mockDetail(contentId) {
  return {
    items: [{
      contentid: String(contentId),
      contenttypeid: '12',
      title: '목업 상세',
      addr1: '강원특별자치도 횡성군 횡성읍',
      sigungucode: '18',
      mapx: '127.985', mapy: '37.496',
      overview: '목업 모드에서 반환되는 상세 정보입니다.',
      firstimage: '',
    }],
    totalCount: 1,
  };
}

/** endpoint 이름으로 알맞은 픽스처를 고릅니다. */
export function mockFor(endpoint, params) {
  if (endpoint.startsWith('areaBasedList')) return mockAreaBasedList(params);
  if (endpoint.startsWith('searchFestival')) {
    return mockAreaBasedList({ ...params, contentTypeId: '15' });
  }
  if (endpoint.startsWith('areaCode')) return mockAreaCodeList();
  if (endpoint.startsWith('detailCommon')) return mockDetail(params.contentId);
  if (endpoint.startsWith('detailIntro')) {
    return { items: [{ usetime: '09:00~18:00', restdate: '연중무휴' }], totalCount: 1 };
  }
  if (endpoint.startsWith('detailImage')) return { items: [], totalCount: 0 };
  return { items: [], totalCount: 0 };
}
