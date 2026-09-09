# 해피로컬 (HappyLocal)

강원 횡성·평창·정선의 로컬 픽업 + 여행 코스 앱.
프론트 디자인만 있던 프로토타입에 **한국관광공사 TourAPI** 연동과 **주문·재고 백엔드**를 붙인 상태입니다.

---

## 빠른 시작

```bash
cd server
npm install
cp .env.example .env      # Windows PowerShell: copy .env.example .env
npm start
```

브라우저에서 **http://localhost:8787/happylocal_v2.html**

> `.env` 의 `TOUR_API_KEY` 가 비어 있어도 그대로 실행됩니다 (시드 데이터로 동작).
> 화면 하단에 현재 데이터 출처 배지가 잠깐 뜹니다.

### 키 없이 실연동 흐름 보기

```bash
npm run mock
```

TourAPI 응답과 동일한 형태의 내장 픽스처로 동작합니다. 실제 키를 넣었을 때
관광지·맛집·축제가 어떻게 병합되는지 미리 확인할 수 있습니다.

### 테스트

```bash
npm run test:all    # 아래 전부
npm test            # 브라우저 검증을 뺀 3종
npm run test:mock   # TourAPI 파싱/오류/캐시 (서버 불필요)
npm run test:api    # 부트스트랩 정합성 + 주문·후기·캘린더 (서버 필요)
npm run test:front  # 브라우저 없이 앱 스크립트 실행 (서버 필요)
npm run test:vercel # 서버리스 모드 검증 (서버 불필요)
npm run test:browser# 실제 Chrome 으로 렌더링·콘솔오류 확인 (서버 필요)
npm run test:e2e    # 사용자 여정 통합 시나리오 (서버 필요)
npm run test:logic  # 서버 계산이 수학적으로 맞는가 (서버 필요)
npm run test:ui-logic # 화면에 찍힌 값이 실제 데이터와 맞는가 (서버 필요)
npm run test:role   # 역할·범위 격리, 권한 차단 (서버 필요)
npm run test:admin  # 운영 화면 14종 (서버 필요)
npm run test:account# 실제 로그인으로 역할별 검증 (서버 필요)
npm run test:login  # 브라우저에서 로그인 폼을 눌러 확인 (서버 필요)
```

`test:browser` 는 설치된 Chrome/Edge 를 찾아 씁니다(별도 다운로드 없음).
브라우저나 `playwright-core` 가 없으면 조용히 건너뜁니다.
스크린샷은 `server/shots/` 에 저장됩니다.

앞의 셋은 "깨지지 않는가", 뒤의 넷은 **"결과가 옳은가"** 를 봅니다.
전자만으로는 멀쩡해 보이면서 틀린 값을 보여주는 결함을 잡지 못합니다.

```bash
npm run manual      # 매뉴얼 캡처를 실제 화면에서 다시 찍어 갈아끼움
```

---

## API 키 발급

### 한국관광공사 TourAPI

1. [공공데이터포털](https://www.data.go.kr) 회원가입
2. **한국관광공사_국문 관광정보 서비스_GW** 활용신청 (개발계정은 즉시 승인, 일 1,000건)
3. 마이페이지 → 오픈API → 개발계정 → **일반 인증키(Decoding)** 복사
4. `server/.env` 의 `TOUR_API_KEY=` 뒤에 붙여넣기
5. 서버 재시작

> **Decoding 키를 넣으세요.** `%2B`, `%3D` 가 섞인 Encoding 키를 넣으면 서버가
> 한 번 더 인코딩해서 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 가 납니다.
> 이 오류가 나면 서버 콘솔에 조치 방법이 함께 출력됩니다.

> **활용신청 승인 직후에는 키가 바로 동작하지 않습니다. 약 30분 기다리세요.**
> 공모전 공식 강의에서 짚어준 사항입니다. 승인 직후 호출이 실패해도 설정이
> 잘못된 게 아니니, 30분 뒤에 `npm run test:api` 로 다시 확인하세요.

개발계정 한도는 **API 당 일 1,000건**입니다. 부족하면 포털에서 증량 신청할 수 있습니다.
이 앱은 지역 3곳 × 3카테고리 = 부팅당 9콜이고 1시간 캐시가 걸려 있어 한도에 여유가 있습니다.

`KorService2` 가 기본값이고, 이걸 그대로 쓰면 됩니다.

> **`KorService1` 은 폐지됐습니다.** (2026-09-02 실측: 구 버전의 모든 오퍼레이션이
> HTTP 400 `NO_OPENAPI_SERVICE_ERROR`) 오래된 블로그·강의 자료에 `KorService1`
> 예제가 남아 있는데 지금은 동작하지 않으니 `TOUR_API_BASE` 를 바꾸지 마세요.

같은 방법으로 `KorService2` 의 오퍼레이션 존재를 확인했습니다 (잘못된 키로 호출하면,
있는 오퍼레이션은 키 검사 단계까지 도달해 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 를,
없는 오퍼레이션은 `NO_OPENAPI_SERVICE_ERROR` 를 돌려줍니다):

| 오퍼레이션 | 상태 | 이 앱에서 |
|---|---|---|
| `areaBasedList2` | 존재 | 지역기반 관광지·맛집·축제 조회 |
| `searchFestival2` | 존재 | 축제 기간 조회 |
| `detailCommon2` | 존재 | 상세 공통정보 |
| `detailIntro2` | 존재 | 운영시간·메뉴 등 |
| `detailImage2` | 존재 | 추가 이미지 |
| `areaCode2` | 존재 | 시군구 코드 검증 |
| `searchKeyword2` | 존재 | 미사용 |
| `locationBasedList2` | 존재 | 미사용 |
| `categoryCode2` | 존재 | 미사용 |

> 폴백 타일은 **OpenStreetMap** 입니다. 원래 쓰던 CARTO 베이스맵이 API 키를
> 요구하도록 바뀌어, 키 없이 쓰면 지도 위에 "API KEY REQUIRED" 워터마크가
> 깔립니다(실제 브라우저 검증에서 발견). OSM 은 키가 필요 없고 한글 지명도 나옵니다.

### 카카오 로그인 (소셜 로그인)

지도용 JavaScript 키와 **다른 키**입니다.

1. developers.kakao.com > 내 애플리케이션 > (앱) > **앱 설정 > 앱 키 > REST API 키** 복사
   → `server/.env` 의 `KAKAO_REST_KEY=`
2. **제품 설정 > 카카오 로그인 > 활성화 설정 ON**
3. **제품 설정 > 카카오 로그인 > Redirect URI** 등록:
   `http://localhost:8787/api/auth/kakao/callback`
   (배포 후에는 배포 URL로도 추가 등록)
4. **제품 설정 > 카카오 로그인 > 동의항목**에서 닉네임(필수), 이메일(선택)
5. 보안 > Client Secret 을 켰다면 `KAKAO_CLIENT_SECRET=` 에도 입력

키가 없으면 로그인 버튼이 "준비 중"으로 비활성화되고, 로컬에서는
**둘러보기용 임시 로그인**으로 로그인 이후 화면을 확인할 수 있습니다
(`ALLOW_DEV_LOGIN`, 배포 환경에서는 자동으로 차단됩니다).

#### 카카오 로그인이 안 될 때

증상만 보면 원인을 알기 어렵습니다. **서버 콘솔의 `[auth]` 줄에 카카오가 준
오류코드가 그대로 남습니다.** 그것부터 보세요.

| 오류코드 | 원인 | 고칠 곳 |
|---|---|---|
| `KOE010` | Client Secret 을 콘솔에서 켜 뒀는데 값을 안 보냄 | `.env` 의 `KAKAO_CLIENT_SECRET` 채우기, 또는 콘솔에서 끄기 |
| `KOE006` | 등록된 Redirect URI 와 다름 | 주소창을 확인 — `127.0.0.1` 로 접속하면 `localhost` 등록과 어긋납니다 |
| `KOE320` | 인가 코드 만료 · 재사용 | 다시 시도 |

`redirect_uri` 는 **접속한 주소 그대로** 만들어집니다. 카카오는 `localhost` 와
`127.0.0.1` 을 다른 주소로 보므로, 등록한 것과 같은 주소로 접속해야 합니다
(`127.0.0.1` 은 서버가 `localhost` 로 눕혀 줍니다).

지금 서버가 어떤 값을 보낼지는 이걸로 확인합니다.

```bash
curl -s http://localhost:8787/api/auth/config
```

### 카카오맵

1. [Kakao Developers](https://developers.kakao.com) > 내 애플리케이션 > 애플리케이션 추가
2. **제품 설정 > 카카오맵 > 활성화 설정 ON** ← **가장 빠뜨리기 쉬운 단계**
3. **앱 설정 > 앱 > 플랫폼 키** > JavaScript 키 선택 > **JavaScript SDK 도메인**에
   `http://localhost:8787` 등록
4. JavaScript 키를 `server/.env` 의 `KAKAO_JS_KEY=` 에 붙여넣기
5. 서버 재시작

> 2024년 12월부터 카카오맵 API 는 **앱마다 명시적으로 활성화**해야 합니다.
> 활성화하지 않으면 키가 맞아도 SDK 가 403 을 돌려줍니다:
> `{"errorType":"NotAuthorizedError","message":"App(...) disabled OPEN_MAP_AND_LOCAL service."}`
> 공식 지도 가이드 문서에는 아직 이 단계가 없어 찾기 어렵습니다.
>
> 도메인 등록 위치도 콘솔 개편으로 **"플랫폼"이 아니라 "플랫폼 키"** 안에 있습니다.

키를 넣으면 앱의 지도 4개(홈·장소상세·코스·지도화면)가 모두 카카오맵으로 뜹니다.
키가 없거나 SDK 로드에 실패하면 **자동으로 기존 Leaflet 으로 폴백**하므로 지도는 항상 동작합니다.
현재 어느 백엔드가 쓰였는지는 부팅 직후 화면 하단 배지에 표시됩니다.

카카오 JS 키는 도메인 제한으로 보호되는 *클라이언트* 키라 브라우저 노출이 정상입니다
(TourAPI 서비스키와 달리 서버에 숨길 필요가 없습니다).

---

## 구조

```
Happylocal/
├── happylocal_v2.html        프론트 (단일 파일 SPA)
├── happylocal_v2.html.bak    연동 전 원본 백업
├── images/farms/             농가·상품 이미지
└── server/
    ├── .env                  ← 직접 만드는 파일 (git 제외)
    ├── extract-seed.mjs      HTML 내 목업 데이터 → seed.json 추출기
    ├── data/
    │   ├── seed.json         추출된 원본 목업 (읽기 전용)
    │   └── db.json           주문·재고·리뷰 (런타임에 변경됨)
    └── src/
        ├── index.js          Express 진입점 + 정적 서빙
        ├── config.js         .env 로딩, 지역/콘텐츠 코드
        ├── lib/
        │   ├── tourapi.js    TourAPI 클라이언트 (오류·캐시·정규화)
        │   │   (지도 추상화 HLMapCreate 는 happylocal_v2.html 안에 있습니다)
        │   ├── fixtures.js   TOUR_MOCK=1 용 내장 픽스처
        │   ├── adapt.js      TourAPI → 프론트 shape 변환  ★핵심
        │   ├── store.js      JSON 파일 영속 저장소
        │   └── cache.js      TTL 캐시 + 동시요청 합치기
        └── routes/
            ├── catalog.js    /api/bootstrap  ★핵심
            ├── tour.js       /api/tour/*
            ├── orders.js     /api/orders
            └── reviews.js    /api/reviews
```

### 지도 화면: 지역 × 카테고리

지도에서 **지역별로 가게와 축제를 한 번에** 볼 수 있습니다.

- 상단 칩: `전체 / 픽업 / 맛집 / 관광 / 축제` (각 칩에 해당 지역의 개수 표시)
- 하단 좌측 원형 버튼: 지역 (`전체 / 횡성 / 평창 / 정선`)
- `오늘 / 내일` 픽업일 필터는 **픽업 상품에만** 적용됩니다.
  관광지·축제까지 걸면 목록이 통째로 비어버리기 때문입니다.
  그래서 카테고리가 `관광`·`축제`일 때는 이 줄이 숨겨집니다.

마커 색이 갈래를 구분합니다 — 픽업/맛집 초록, 관광 보라, 축제 주황.

TourAPI 는 평점을 제공하지 않으므로, TourAPI 에서 온 항목은 `★ 0.0 (0)` 대신
축제는 행사 기간을, 관광·맛집은 소재지를 카드에 표시합니다.

지역당 표시 개수 — 시드 12곳 내외, TourAPI 연동 시 30곳 이상.

### 로그인과 계정별 데이터

예전에는 `MY_USER` 상수가 `isLoggedIn:true` 로 박혀 있어 **항상 로그인 상태로 보였습니다.**
지금은 서버 세션이 정본이고 **비로그인이 기본**입니다.

- 로그인: 카카오 OAuth (Authorization Code). REST 키와 액세스 토큰은 **서버에만** 있고,
  브라우저에는 httpOnly 세션 쿠키만 내려갑니다. CSRF 방지용 `state` 를 대조합니다.
- 계정별로 분리되는 것: **예약 · 후기 · 쿠폰 · 저장한 여행 계획**
- 공용으로 남는 것: 상품 재고, 매장 평점 (여러 사람의 후기가 합산되어야 하므로)
- 신규 가입 시 쿠폰 3장이 자동 지급됩니다.
- 로그인 없이 예약·후기 작성을 시도하면 **왜 필요한지 설명하는 로그인 화면**으로 안내합니다.

| 동작 | 비로그인 | 로그인 |
|---|---|---|
| 둘러보기(지도·코스·캘린더·매장) | 가능 | 가능 |
| 예약·결제 | `401` + 로그인 유도 | 가능 |
| 후기 작성 | 로그인 유도 | 가능 |
| 여행 계획 저장 | 로그인 유도 | 가능 |
| 내 예약·쿠폰·코스 | 빈 목록 | 내 것만 |

### 여행 계획 저장

`addToPlan()` 은 원래 **토스트만 띄우고 아무것도 저장하지 않았습니다.**
지금은 로그인한 계정의 계획으로 서버에 저장되고, 같은 코스를 두 번 담으면 중복을 막습니다.
`내 코스 > 저장한 코스` 에서 확인·삭제합니다.

### 통합 시나리오 (`npm run test:e2e`)

단위 테스트가 부품을 보는 반면, 이건 **사용자 여정을 UI 로 끝까지** 밟습니다.
화면 → API → 저장소 → 다시 화면까지 이어지는지, 그리고 **새로고침 후에도 남아있는지**를 봅니다.

| 시나리오 | 확인하는 것 |
|---|---|
| 1. 픽업 예약 | 결제 → 예약 생성 → 재고 차감 → **새로고침 유지** → 취소 → 재고 복구 |
| 2. 지도 탐색 | 갈래 필터(191→7) → 지역 필터(7→3) → 마커·카드 개수 일치 → 가짜 평점 없음 |
| 3. 후기 작성 | 작성 → 서버 저장 → 목록 갱신 → 매장 평점 가중 합산 → 새로고침 유지 |
| 4. 매장 탐색 | 거리순·마감임박순 정렬 검증 → 검색(191→17) → 상세 진입 |
| 5. 재고 경계 | 전량 예약 → 초과 요청 409 거부 → 화면 품절 표시 → 정리 후 복구 |
| 6. 로그인·격리 | 비로그인 차단(401) → 로그인 유도 → 가입 쿠폰 지급 → **다른 계정 데이터 안 보임** |

각 시나리오는 만든 데이터를 스스로 정리해서 **연속 실행해도 결과가 같습니다**
(3회 연속 33/33 통과, 실행 후 예약 2·후기 3·상품 30 으로 원상복구 확인).

### 내 주변 매장

제철 캘린더 화면 우상단의 목록 아이콘으로 들어갑니다.

- 정렬 탭: `가까운 순` / `마감 임박` / `평점 높은 순` — 셋 다 **정렬**이라 목록이 줄지 않습니다
- 우상단 돋보기로 검색바 토글 (매장명·주소·업종). 닫으면 검색어가 초기화됩니다

원래 이 화면은 CSS(`.st-*`)와 렌더 로직(`renderCalStores`)만 있고 마크업이 없어
`renderCalStores()` 가 매번 조용히 빠져나가고 있었습니다. 화면을 만들어 연결했습니다.

> 기존 `fav` 탭은 "즐겨찾기" 라는 이름으로 평점 4.7 미만을 **걸러내고** 있었습니다.
> 즐겨찾기 기능이 없는데다 191개 중 188개가 소리 없이 사라져서, 실제 동작에 맞게
> `평점 높은 순` **정렬**로 바꿨습니다.

### 역할과 운영 화면

여행자만 쓰는 앱이 아닙니다. 농가가 오늘 낼 물량을 넣고 매장이 수령을
확인해야 매일 돌아갑니다. 역할은 다섯입니다.

| 역할 | 담당 범위 | 주로 쓰는 화면 |
|---|---|---|
| `customer` | 자기 것만 | 앱 전체 |
| `producer` | 담당 상품 | 오늘 출하 · 판매 현황 · 정산 |
| `store_manager` | 담당 거점 | 오늘 픽업 · 일일 마감 · 매장 정보 |
| `operator` | 담당 지역 | 콘텐츠 편집 · 쿠폰 발행 · 후기 관리 |
| `super_admin` | 전체 | 계정·역할 · 입점 심사 · 정산 집행 · 감사 로그 |

운영 화면은 여행자 앱과 **별도 주소** `/admin.html` 입니다. 로그인 세션은
같은 쿠키를 공유하므로 계정은 하나입니다. 역할에 따라 메뉴가 달라집니다.

**권한과 범위는 별개입니다.** `order:complete` 를 가졌다고 아무 예약이나
확인할 수 있는 게 아니라, 그 예약의 거점이 내 담당이어야 합니다. 범위 밖은
`403` 이 아니라 `404` 로 응답해 존재 여부까지 숨깁니다.

첫 최고관리자는 환경변수로 지정합니다. 아무도 `super_admin` 이 아니면
역할을 줄 사람이 없기 때문입니다.

```
SUPER_ADMIN_EMAILS=you@example.com
```

로컬에서는 `/admin.html` 의 개발용 로그인 상자로 역할을 골라 바로 확인할 수
있고, 배포(`VERCEL`)에서는 그 상자가 나오지 않습니다.

**로그인은 두 가지입니다.** 카카오 소셜 로그인과 아이디·비밀번호 로그인.
후자를 둔 이유는, 소셜만 있으면 카카오 계정이 없는 사람이 들어올 수 없고
배포에서는 개발용 로그인이 막혀 있어 확인할 길이 없기 때문입니다.
비밀번호는 Node 내장 scrypt 로 해시합니다 (`server/src/lib/password.js`).

역할별 테스트 계정을 만들어 두면 카카오 없이 전 역할을 확인할 수 있습니다.

```bash
npm run seed:accounts
```

| 아이디 | 역할 |
|---|---|
| `customer1` · `customer2` | 일반 |
| `farmer_hs` · `farmer_pc` · `farmer_js` | 생산자 (지역별) |
| `store_hanwoo` · `store_local` · `store_js` | 매장 관리인 (거점별) |
| `farmstore_pc` | 생산자 + 매장 관리인 (겸직) |
| `operator1` | 운영자 |
| `admin1` | 최고관리자 |

비밀번호는 모두 `happylocal2026`. **운영 환경에서는 만들지 마세요**
(`NODE_ENV=production` 이면 스크립트가 거부합니다).

설계 전문은 [docs/roles.md](docs/roles.md) 에 있습니다.

### 핵심 설계

프론트의 렌더링 코드는 5,400줄입니다. 이걸 다시 쓰지 않기 위해,
**서버가 기존 목업 상수와 똑같은 필드 이름·모양으로 응답합니다.**

```js
// 프론트에서 바뀐 것은 사실상 이것뿐입니다
const PLACES = {...}   →   let PLACES = {...}   // 리터럴은 오프라인 폴백으로 유지
// 부팅 시 /api/bootstrap 응답으로 덮어쓰고 buildCourses() 재실행
```

`adapt.js` 가 TourAPI 응답을 `PLACES`/`GEO`/`STORES` 모양으로 변환하고,
`catalog.js` 가 그것을 자체 DB(픽업·재고)와 병합합니다.

---

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/bootstrap` | 프론트가 부팅 시 1회 호출. 모든 데이터를 목업과 같은 shape 으로 반환 |
| GET | `/api/health` | 상태 + 레코드 수 |
| GET | `/api/tour/status` | 키 설정 여부, 캐시 통계 |
| GET | `/api/tour/sigungu` | 실제 시군구 코드표 (설정값 검증용) |
| GET | `/api/tour/places?region=횡성&type=tour` | 지역기반 관광정보 |
| GET | `/api/tour/festivals?region=평창&from=20260101` | 축제 |
| GET | `/api/tour/detail/:contentId?contentTypeId=12` | 상세 + 소개 + 이미지 |
| GET | `/api/products?region=횡성` | 실시간 재고 반영 픽업 상품 |
| GET | `/api/mypickups` | 예약 내역 (결제 후 화면 갱신용) |
| GET | `/api/reviews?shop=...` | 후기 목록 |
| DELETE | `/api/reviews/:id` | 후기 삭제 |
| POST | `/api/orders` | 주문 생성 (재고 차감) |
| POST | `/api/orders/:id/cancel` | 취소 (재고 복구) |
| POST | `/api/reviews` | 리뷰 작성 (매장 평점 재계산) |
| POST | `/api/admin/reset` | db.json 초기화 (로컬 전용 · `super_admin` · `{"confirm":"RESET"}`) |

역할별 API (권한과 담당 범위를 각 라우트가 스스로 검사합니다):

| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/api/auth/register` | 아이디·비밀번호 가입 (언제나 일반 사용자) |
| POST | `/api/auth/login` | 아이디·비밀번호 로그인 |
| POST | `/api/auth/password` | 비밀번호 변경 |
| GET | `/api/auth/roles` | 내 역할·범위·담당 목록 |
| GET | `/api/producer/products` | `producer` 담당 상품과 오늘 상황 |
| POST | `/api/producer/products/:id/restock` | `producer` 오늘 출하 등록 |
| PATCH | `/api/producer/products/:id` | `producer` 가격·픽업시간 |
| GET | `/api/producer/settlement` | `producer` 내 정산서 |
| GET | `/api/store/pickups` | `store_manager` 오늘 픽업 목록 |
| GET | `/api/store/pickups/lookup?code=` | `store_manager` 예약코드 조회 |
| POST | `/api/store/pickups/:id/complete` | `store_manager` 수령 확인 |
| POST | `/api/store/pickups/:id/noshow` | `store_manager` 노쇼 (재고 복구 선택) |
| POST | `/api/store/products/:id/adjust` | `store_manager` 재고 조정 (사유 필수) |
| POST | `/api/admin/apply` | 누구나 입점 신청 |
| POST | `/api/admin/applications/:id/decide` | `super_admin` 승인 → 역할 부여 |
| GET/PUT | `/api/admin/content/:key` | `operator` 콘텐츠 편집 |
| POST | `/api/admin/coupons/issue` | `operator` 쿠폰 캠페인 |
| GET | `/api/admin/settlement` | 정산 집계 |
| POST | `/api/admin/settlement/pay` | `super_admin` 지급 처리 |
| PUT | `/api/admin/users/:id/roles` | `super_admin` 역할·범위 부여 |
| GET | `/api/admin/audit` | `super_admin` 감사 로그 |

```bash
# 주문 예시
curl -X POST http://localhost:8787/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"productId":"01","qty":2}'
```

---

## 공모전 강의 권고사항과의 대조

공식 강의 [2. 한국관광공사 Open API](https://youtu.be/RqWrko9HwZw) 의 결론은
**"서비스키를 브라우저에 두면 안 된다 → 내 서버에 키를 숨기고 서버가 대신 호출한다"** 입니다.
강의에서는 이걸 보안 사고 시연(개발자도구에서 키가 그대로 보이는 장면)으로 강조합니다.

이 프로젝트는 처음부터 그 구조입니다.

| 강의 권고 | 이 프로젝트 |
|---|---|
| 서비스키를 브라우저에 노출하지 말 것 | `TOUR_API_KEY` 는 `server/.env` 에만 있고 응답에 실리지 않음 |
| 내 서버가 대신 관광공사 서버로 요청 | `server/src/lib/tourapi.js` 가 유일한 호출 지점 |
| 서버 배포 필요 | 프론트를 같은 오리진에서 서빙 (`express.static`) — CORS 문제도 함께 해소 |
| `KorService2` / `areaBasedList2` 사용 | 동일 |
| `MobileOS`·`MobileApp`·`_type=json` 필수 파라미터 | 동일 |
| `arrange` 로 대표이미지 있는 항목 우선 | `arrange=O` 사용 (이미지 있는 항목만, 제목순) |
| 에러코드 확인해서 원인 파악 | 오류를 `hint` 와 함께 서버 콘솔·앱 양쪽에 출력 |

키가 응답에 새지 않는지는 이렇게 확인할 수 있습니다:

```bash
curl -s http://localhost:8787/api/bootstrap | grep -c "$(grep TOUR_API_KEY server/.env | cut -d= -f2)"
# 0 이면 안전 (키가 응답에 없음)
```

### 아직 안 쓴 API

강의는 한국관광공사가 제공하는 **27종** API를 훑습니다. 이 앱은 그중 국문 관광정보 서비스
(`KorService2`) 하나만 씁니다. 공모전 차별화에 쓸 만한 것들:

- **무장애 여행 정보** — 휠체어·점자블록·수유실·엘리베이터 접근성
- **관광지 혼잡도 예측** — 향후 30일 방문 집중도
- **빅데이터 지역별 방문자수** — 이동통신·카드·내비 기반 현지인/외지인/외국인
- **고캠핑**, **반려동물 동반여행**, **두루누비(길·코스)**, **오디오 가이드**
- **다국어 관광정보** (영/중/일/독/불/서/노) — 국제화

각각 별도로 활용신청이 필요하고, 붙이는 방법은 지금 구조 그대로입니다
(`tourapi.js` 에 함수 추가 → `adapt.js` 에서 프론트 shape 으로 변환).

---

## 무엇이 실데이터이고 무엇이 아닌가

| 영역 | 출처 | 상태 |
|---|---|---|
| 관광명소·축제·맛집 | 한국관광공사 TourAPI | 실데이터 (키 필요) |
| 좌표·주소·전화·이미지·운영시간 | TourAPI | 실데이터 (키 필요) |
| 여행 코스 자동 생성 | TourAPI 장소로 조합 | 실데이터 기반 |
| 지도 | 카카오맵 (폴백: Leaflet + OpenStreetMap) | 카카오는 JS 키 필요 · 폴백은 키 불필요 |
| 픽업 농가·상품·가격 | 자체 DB (`db.json`) | 시드에서 출발, 서버가 관리 |
| 재고·주문·예약코드 | 자체 DB | **실제 동작** — 차감·복구·영속, 새로고침해도 유지 |
| 예약 내역 | 자체 DB (주문에서 생성) | **실제 동작** |
| 후기 작성·평점 | 자체 DB | **실제 동작** — 기존 평점에 가중 합산 |
| 관광지 상세(운영시간·전화·사진) | TourAPI `detailCommon`/`detailIntro`/`detailImage` | 실데이터 (키 필요) |
| 결제 | 없음 | 화면 흐름만. PG 연동은 별도 |
| FAQ·공지·약관·제철 캘린더 | 프론트 상수 | 목업 |

> 농가 직거래 픽업·가격·재고는 이에 해당하는 공공 API가 없습니다.
> 그래서 TourAPI 로 관광 데이터를 채우고, 픽업 도메인은 자체 백엔드로 구현했습니다.

---

## 알려진 제약

- **실제 TourAPI 키 / 카카오 JS 키로는 아직 검증하지 못했습니다.** 키 발급 전이라
  목 픽스처와 스텁 기반 테스트로만 확인했습니다. 카카오 경로는 SDK 를 스텁으로 심어
  마커·폴리라인·바운즈·이동 호출까지 실제로 실행해 검증했지만, 실제 SDK 의 렌더링
  결과는 브라우저에서 확인해야 합니다. 키를 넣고 `npm test` 를 돌리면 재검증됩니다.
- 시군구 코드(횡성 18 / 평창 15 / 정선 11)는 `.env` 에 하드코딩되어 있고,
  서버 기동 시 실제 코드표와 대조해 다르면 경고를 출력합니다.
- `db.json` 은 단일 프로세스 기준입니다. 여러 인스턴스를 띄우면 실제 DB 가 필요합니다.
- 결제는 UI 흐름만 있고 PG 연동은 없습니다.
- **Vercel 실배포는 하지 않았습니다.** 계정이 필요합니다. 대신 서버리스 모드를
  로컬에서 검증했습니다 — `VERCEL=1` 일 때 포트를 열지 않고, export 된 Express 앱이
  핸들러로 동작하며, 콜드 스타트에서 저장소가 로드되고 주문 쓰기까지 됩니다.
  KV 백엔드는 환경변수 전환만 확인했고 **실제 KV 인스턴스로는 검증하지 못했습니다.**
- 루트 `package.json` 과 `server/package.json` 의 dependencies 는 **수동으로 맞춰야 합니다**
  (Vercel 은 루트에서 설치, 로컬 개발은 server/ 에서 설치).
- 배포 설정(`Dockerfile`, `render.yaml`)은 준비했지만 **실제 배포는 하지 않았습니다.**
  플랫폼 계정이 필요합니다. Docker 데몬이 꺼져 있어 이미지 빌드도 검증하지 못했고,
  대신 컨테이너와 같은 조건(작업 디렉터리·CMD·헬스체크·정적 경로)을 로컬에서 확인했습니다.
- 여행코스 추천(`LR_DATA`)·FAQ·공지·약관은 여전히 프론트 상수입니다.
  앞의 것은 TourAPI 축제 정보와 일부 겹치지만, 손으로 쓴 설명·동선 데이터가 많아
  기계적으로 대체하면 내용이 빈약해집니다.

## 배포

강의가 강조한 대로, 서비스키를 숨기려면 서버가 떠 있어야 합니다.
프론트와 서버를 한 컨테이너로 묶어 뒀으므로 어느 플랫폼이든 같은 방식입니다.

```bash
docker build -t happylocal .
docker run -p 8787:8787 --env-file server/.env happylocal
```

### Vercel (무료 플랜)

`vercel.json` · `api/index.js` · 루트 `package.json` 이 준비돼 있습니다.

1. 저장소를 GitHub 에 올립니다 (`server/.env` 는 `.gitignore` 로 제외됨)
2. vercel.com → Add New → Project → 저장소 선택 → Root Directory 는 `Happylocal`
3. **Storage → Create Database → KV** 생성 후 프로젝트에 연결
   (`KV_REST_API_URL`·`KV_REST_API_TOKEN` 이 자동 주입됩니다)
4. Settings → Environment Variables 에 아래를 추가
   - `TOUR_API_KEY` · `KAKAO_JS_KEY` · `KAKAO_REST_KEY`
   - `APP_ORIGIN` = 배포 URL (예: `https://happylocal.vercel.app`)
   - **`SUPER_ADMIN_EMAILS`** = 첫 최고관리자 이메일 — 안 넣으면 운영 화면에
     아무도 들어갈 수 없습니다 (배포에서는 개발용 로그인이 막힙니다)
5. 배포 후 **카카오 플랫폼 키에 배포 URL 도 등록** (도메인마다 별도 등록)
6. 카카오 로그인 Redirect URI 에 `https://<배포URL>/api/auth/kakao/callback` 추가
7. 운영 화면은 `https://<배포URL>/admin.html` 입니다

> **KV 없이 배포하면 주문·후기가 저장되지 않습니다.** Vercel 함수는 읽기 전용
> 파일시스템이라 `db.json` 쓰기가 실패합니다. `KV_REST_API_URL` 이 있으면
> 자동으로 KV 백엔드로 전환되고, 없으면 파일 백엔드를 씁니다 (`server/src/lib/storage.js`).

### Render (무료 플랜 가능)

`render.yaml` 이 준비돼 있습니다.

1. 저장소를 GitHub 에 올립니다 (`server/.env` 는 `.gitignore` 로 제외됨)
2. render.com → New → Blueprint → 저장소 선택
3. 대시보드에서 `TOUR_API_KEY`, `KAKAO_JS_KEY`, `KAKAO_REST_KEY`,
   `SUPER_ADMIN_EMAILS` 입력
4. 배포 후 **카카오 개발자 콘솔의 사이트 도메인에 배포 URL 추가** (안 하면 지도가 안 뜹니다)

Railway·Fly.io·Cloud Run 도 같은 `Dockerfile` 로 됩니다.

### 배포 전 확인

| 항목 | 이유 |
|---|---|
| `server/.env` 가 커밋되지 않았는지 | 서비스키 유출 |
| 카카오 사이트 도메인에 배포 URL 추가 | 안 하면 지도 미표시 |
| 카카오 Redirect URI 에 배포 URL 추가 | 안 하면 로그인 실패 |
| `SUPER_ADMIN_EMAILS` 설정 | 안 하면 운영 화면에 아무도 못 들어감 |
| 카카오 동의항목에 **이메일** 켜기 | 이메일이 없으면 최고관리자 매칭이 안 됨 |
| TourAPI 일일 한도 (개발계정 1,000건) | 공개 후 트래픽이 늘면 증량 신청 |

> **무료 플랜은 디스크가 휘발성입니다.** 재배포하면 `db.json`(주문·후기)이
> 초기화됩니다. 유지가 필요하면 영구 디스크를 `server/data` 에 마운트하거나
> 실제 DB 로 옮기세요. 심사 시연 중에는 문제되지 않지만, 시연 직전 재배포는 피하세요.

---

## 부팅 순서 주의

`hlBoot()` 는 스크립트 로드 시 자동 실행되고, 끝나면 `PLACES`/`PL`/`STORES` 를
서버 값으로 **통째로 교체**합니다. 부팅 전에 이 값들을 만지면 덮어써지므로,
외부에서 손댈 일이 있으면 `window.HL_READY` 프라미스를 먼저 기다리세요.

```js
await window.HL_READY;   // 서버 데이터 반영 완료
```
