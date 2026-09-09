/**
 * TourAPI 경로 검증 (키 없이).
 *
 *   node src/mocktest.js
 *
 * 실서비스 키가 없어도 TourAPI 연동 코드가 맞는지 확인해야 하므로,
 * global.fetch 를 가로채 실제 TourAPI 가 돌려주는 형태의 응답을 먹입니다.
 * 특히 다음 세 가지가 실제로 자주 터지는 지점이라 반드시 덮습니다:
 *   1) 결과 0건일 때 items 가 빈 문자열("")
 *   2) 결과 1건일 때 item 이 배열이 아닌 객체
 *   3) 오류가 JSON 이 아니라 XML 봉투로 오는 경우
 */
process.env.TOUR_API_KEY = process.env.TOUR_API_KEY || 'MOCK_KEY_FOR_TEST';

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) { failures++; if (detail) console.log(`        ${detail}`); }
};

const ok = (body) => JSON.stringify({
  response: { header: { resultCode: '0000', resultMsg: 'OK' }, body },
});

const ITEM = {
  contentid: '126508',
  contenttypeid: '12',
  title: '횡성호수길',
  addr1: '강원특별자치도 횡성군 갑천면 화전리',
  addr2: '',
  areacode: '32',
  sigungucode: '18',
  mapx: '128.0721234',
  mapy: '37.5851234',
  firstimage: 'https://tong.visitkorea.or.kr/a.jpg',
  firstimage2: 'https://tong.visitkorea.or.kr/a_s.jpg',
  tel: '033-340-2545',
  cat3: 'A01011200',
  overview: '<br>횡성호 둘레를 걷는 <b>생태 트레킹</b> 코스입니다.&nbsp;',
};

const FEST = {
  ...ITEM,
  contentid: '999001',
  contenttypeid: '15',
  title: '횡성한우축제',
  eventstartdate: '20251022',
  eventenddate: '20251026',
  mapx: '127.9850000',
  mapy: '37.4960000',
};

// --- fetch 스텁: URL 에 따라 다른 시나리오를 돌려줍니다 ---
const routes = [];
global.fetch = async (url) => {
  const u = String(url);
  const hit = routes.find((r) => u.includes(r.match));
  const payload = hit ? hit.body : ok({ items: { item: [ITEM] }, totalCount: 1 });
  return { ok: true, status: 200, text: async () => payload };
};
const route = (match, body) => routes.unshift({ match, body });

const main = async () => {
  const { normalizeItems, callTourApi, TourApiError, tourCache } = await import('./lib/tourapi.js');
  const { toPlace, enrichWithIntro, productToPL } = await import('./lib/adapt.js');

  console.log('\n  --- 응답 정규화 ---');
  check(normalizeItems({ items: '' }).length === 0, '결과 0건 (items 가 빈 문자열)');
  check(normalizeItems({ items: { item: ITEM } }).length === 1, '결과 1건 (item 이 객체)');
  check(normalizeItems({ items: { item: [ITEM, FEST] } }).length === 2, '결과 N건 (item 이 배열)');
  check(normalizeItems(undefined).length === 0, 'body 자체가 없을 때');

  console.log('\n  --- item -> PLACES 변환 ---');
  const conv = toPlace(ITEM);
  check(!!conv, '관광지 변환 성공');
  check(conv.geo[0] === 37.5851234 && conv.geo[1] === 128.0721234,
    'mapy=위도 / mapx=경도 순서', JSON.stringify(conv?.geo));
  check(conv.place.type === 'tour', 'contentTypeId 12 -> type=tour', conv?.place?.type);
  check(conv.place.region === '갑천면', '주소에서 읍/면 추출', conv?.place?.region);
  check(!/[<>]/.test(conv.place.desc) && conv.place.desc.includes('생태 트레킹'),
    'overview 의 HTML 태그 제거', conv?.place?.desc);
  check(conv.key === 't126508', '키 생성 규칙', conv?.key);

  const fconv = toPlace(FEST);
  check(fconv.place.type === 'festival', 'contentTypeId 15 -> type=festival');
  check(fconv.place.period === '2025.10.22~2025.10.26', '축제 기간 포맷', fconv?.place?.period);

  console.log('\n  --- 좌표 없는 항목은 제외 ---');
  check(toPlace({ ...ITEM, mapx: '', mapy: '' }) === null, '좌표 빈 문자열 -> null');
  check(toPlace({ ...ITEM, mapx: '0', mapy: '0' }) === null, '좌표 0 -> null');

  console.log('\n  --- detailIntro 병합 ---');
  const p = { ...conv.place };
  enrichWithIntro(p, { usetime: '09:00~18:00<br>연중무휴', restdate: '없음' }, '12');
  check(p.hours === '09:00~18:00 연중무휴', '운영시간 병합', p.hours);

  const food = { ...toPlace({ ...ITEM, contenttypeid: '39' }).place };
  enrichWithIntro(food, { opentimefood: '10:30~21:00', firstmenu: '한우정식' }, '39');
  check(food.hours === '10:30~21:00' && food.menu === '한우정식', '음식점 필드 병합');

  console.log('\n  --- 오류 처리 ---');
  tourCache.clear();
  route('areaBasedList2', '<?xml version="1.0"?><OpenAPI_ServiceResponse><cmmMsgHeader>'
    + '<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>');
  try {
    await callTourApi('areaBasedList2', { t: '1' });
    check(false, 'XML 오류 봉투를 예외로 변환');
  } catch (e) {
    check(e instanceof TourApiError && e.code === 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
      'XML 오류 봉투를 예외로 변환', `${e.name}/${e.code}`);
    check(!!e.hint && e.hint.includes('Decoding'), '키 오류에 조치 안내(hint) 포함', e.hint);
  }

  tourCache.clear();
  routes.length = 0;
  route('searchFestival2', ok({ items: '', totalCount: 0 }));
  const empty = await callTourApi('searchFestival2', { t: '2' });
  check(empty.items.length === 0 && empty.totalCount === 0, '0건 응답이 예외 없이 빈 배열로');

  console.log('\n  --- 캐시 ---');
  tourCache.clear();
  routes.length = 0;
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async (u) => { calls++; return realFetch(u); };
  await Promise.all([
    callTourApi('areaBasedList2', { c: '9' }),
    callTourApi('areaBasedList2', { c: '9' }),
    callTourApi('areaBasedList2', { c: '9' }),
  ]);
  check(calls === 1, '동일 질의 3회 동시 호출 -> 업스트림 1회', `실제 ${calls}회`);

  console.log('\n  --- 상품 -> PL 변환 ---');
  const pl = productToPL({
    id: '01', name: '횡성한우 등심 500g', farm: '청정한우 김성호 농가', region: '횡성',
    category: '한우·정육', priceWas: 89000, priceNow: 52000, stock: 0,
    mode: 'now', pickupDay: '오늘', hours: '14:00 ~ 18:00', distance: '12km',
    rateCount: 124, seasonal: true, tile: ['#5a4636', '#6a4733'],
  });
  check(pl.was === '89,000원' && pl.now === '52,000원', '가격 천단위 포맷', `${pl.was}/${pl.now}`);
  check(pl.tag === '오늘 마감' && pl.soldOut === true, '재고 0 -> 마감 표시', pl.tag);

  console.log('');
  console.log('\n  --- 게이트웨이 오류 형태 (실서비스에서 관측된 것) ---');

  // data.go.kr 은 오류를 XML 로도, JSON 으로도 돌려줍니다.
  // JSON 형태는 response 봉투가 없어서 "정상 0건" 으로 오인되기 쉽습니다.
  // 실제로 잘못된 키로 KorService2 를 호출해 확인한 응답 모양입니다.
  tourCache.clear();
  routes.length = 0;
  route('areaBasedList2', JSON.stringify({
    OpenAPI_ServiceResponse: {
      cmmMsgHeader: {
        errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
        returnAuthMsg: '등록되지 않은 서비스키',
        returnReasonCode: '30',
      },
    },
  }));
  try {
    const r = await callTourApi('areaBasedList2', { gw: '1' });
    check(false, 'JSON 게이트웨이 오류를 예외로 변환', `조용히 통과함 (totalCount=${r.totalCount})`);
  } catch (e) {
    check(e.code === 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
      'JSON 게이트웨이 오류를 예외로 변환', `${e.code}`);
    check(!!e.hint && e.hint.includes('Decoding'), 'JSON 오류에도 조치 안내 포함');
  }

  // 한도 초과도 같은 JSON 형태로 옵니다.
  tourCache.clear();
  routes.length = 0;
  route('areaBasedList2', JSON.stringify({
    OpenAPI_ServiceResponse: {
      cmmMsgHeader: {
        errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
        returnAuthMsg: '서비스 요청제한횟수 초과',
      },
    },
  }));
  try {
    await callTourApi('areaBasedList2', { gw: '2' });
    check(false, '일일 한도 초과를 예외로 변환');
  } catch (e) {
    check(e.code === 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
      '일일 한도 초과를 예외로 변환', e.code);
    check(!!e.hint && e.hint.includes('한도'), '한도 초과에 조치 안내 포함');
  }

  // 우리가 모르는 형태는 조용히 빈 배열로 넘기지 않고 드러내야 합니다.
  tourCache.clear();
  routes.length = 0;
  route('areaBasedList2', JSON.stringify({ something: 'unexpected' }));
  try {
    const r = await callTourApi('areaBasedList2', { gw: '3' });
    check(false, '알 수 없는 응답 형태를 예외로 변환', `조용히 통과함 (${r.totalCount})`);
  } catch (e) {
    check(e.code === 'UNEXPECTED_SHAPE', '알 수 없는 응답 형태를 예외로 변환', e.code);
  }

  // 정상 응답은 그대로 통과해야 합니다 (위 검사들이 과하지 않은지 확인).
  tourCache.clear();
  routes.length = 0;
  route('areaBasedList2', ok({ items: { item: [ITEM] }, totalCount: 1 }));
  const good = await callTourApi('areaBasedList2', { gw: '4' });
  check(good.items.length === 1 && good.totalCount === 1, '정상 응답은 영향 없음');

  if (failures) { console.log(`  ${failures}건 실패\n`); process.exit(1); }
  console.log('  전부 통과\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
