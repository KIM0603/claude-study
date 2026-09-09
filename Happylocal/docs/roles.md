# 역할 · 권한 설계

해피로컬은 여행자만 쓰는 앱이 아닙니다. 농가가 오늘 낼 물량을 넣고, 직매장이
수령을 확인하고, 지자체가 축제·코스를 큐레이션해야 매일 돌아갑니다.
이 문서는 그 역할을 나누고, 서로 어떻게 맞물리는지 정의합니다.

구현은 이 문서를 따릅니다. 코드와 어긋나면 이 문서를 고치고 코드를 맞춥니다.

---

## 1. 역할

| 역할 | 코드 | 정체 | 담당 범위(scope) |
|---|---|---|---|
| 일반 사용자 | `customer` | 여행자 · 소비자 | 자기 것만 |
| 생산자 | `producer` | 농가 · 작목반 | 담당 상품 (`productIds`) |
| 매장 관리인 | `store_manager` | 픽업 거점 운영자 | 담당 거점 (`storeKeys`) |
| 운영자 | `operator` | 지자체 관광과 · 재단 | 담당 지역 (`regions`) |
| 최고관리자 | `super_admin` | 시스템 관리 | 전체 |

**역할은 배열입니다.** `roles: ['producer', 'store_manager']` — 김성호 농가처럼
자기 물건을 자기 자리에서 파는 곳은 두 역할을 함께 갖습니다. `pk_local`
횡성 로컬푸드 직매장은 여러 농가의 물건을 모아 팔기 때문에 `store_manager`
만 갖고, 그 안의 상품은 각 농가 `producer` 의 것입니다.

**역할만으로는 부족하고 범위가 있어야 합니다.** "매장 관리인" 이 아니라
"`pk_local` 의 매장 관리인" 이어야 A 매장 관리인이 B 매장 주문을 건드리지
못합니다. 범위 검사가 빠지면 역할을 나눈 의미가 없습니다.

로그인하지 않은 방문자는 역할이 아니라 권한 경계입니다. 둘러보기는 되고,
예약·후기·저장은 로그인이 필요합니다 (이미 구현되어 있습니다).

---

## 2. 역할별 기능 목록

우선순위: **P0** 없으면 서비스가 안 돌아감 · **P1** 운영에 필요 · **P2** 있으면 좋음

### 2.1 일반 사용자 `customer`

| 기능 | 상태 | 우선 |
|---|---|---|
| 지역·제철 상품 탐색, 지도, 코스 추천 | 구현됨 | — |
| 픽업 예약 · 결제 · 쿠폰 적용 | 구현됨 | — |
| 예약 취소 | 구현됨 | — |
| 후기 작성 · 삭제 | 구현됨 | — |
| 여행 코스 저장 | 구현됨 | — |
| 쿠폰함 · 알림 설정 · 친구 초대 | 구현됨 | — |
| **픽업 제시 화면** (예약코드를 크게, 매장에 보여주는 용도) | 신규 | P0 |
| 노쇼 안내 (미수령 시 어떻게 되는지) | 신규 | P1 |
| 후기 신고 | 신규 | P2 |

### 2.2 생산자 `producer`

| 기능 | 설명 | 우선 |
|---|---|---|
| **오늘 출하 등록** | 오늘 낼 수량 입력 → 재고에 더함 | **P0** |
| 내 상품 목록 | 재고 · 오늘 예약 수 · 남은 수량 | P0 |
| 가격 수정 | 정가 · 판매가 (할인율은 자동 계산) | P1 |
| 픽업 시간 · 요일 수정 | | P1 |
| 주문 현황 | 내 상품의 예약/수령/노쇼 | P1 |
| 상품 사진 관리 | `FARM_SHOTS` | P2 |
| 정산 내역 | 판매액 · 수수료 · 입금 예정 | P2 |

> **오늘 출하 등록이 가장 중요합니다.** 지금 재고는 시드값에서 시작해 주문으로
> 줄어들기만 하고 다시 채울 경로가 없습니다. 며칠이면 전 상품이 품절됩니다.
> 이것이 현재 시스템의 최대 구조적 결함입니다.

### 2.3 매장 관리인 `store_manager`

| 기능 | 설명 | 우선 |
|---|---|---|
| **오늘 픽업 목록** | 예약코드 · 상품 · 수량 · 상태 | **P0** |
| **예약코드 조회 → 수령 확인** | 손님이 코드를 대면 확인 | **P0** |
| 노쇼 처리 | 마감 후 미수령 → 재고 복구 여부 선택 | P0 |
| 매장 정보 수정 | 운영시간 · 휴무 · 사진 | P1 |
| 재고 조정 | 파손 · 폐기 등 (사유 필수) | P1 |
| 일일 마감 | 예약/수령/노쇼/매출 요약 | P1 |
| 입점 상품 목록 | 내 거점에서 파는 상품(여러 농가) | P1 |

> **오늘 픽업 목록이 이 시스템에서 유일하게 "매장에서 실제로 쓰이는" 화면입니다.**
> `POST /api/orders/:id/complete` 는 이미 서버에 있고 화면만 없습니다.

### 2.4 운영자 `operator`

| 기능 | 기존 자산 | 우선 |
|---|---|---|
| 공지 · FAQ · 약관 편집 | `NOTICE_DATA` `FAQ_DATA` `LEGAL_DATA` (DB에 있음) | P1 |
| 축제 큐레이션 (노출 · 숨김 · 샘플 표시) | `CAL2_FESTIVAL` | P1 |
| 코스 구성 편집 | `POOL` | P1 |
| 제철 캘린더 편집 | `cal` `CAL2_SEASONAL` | P1 |
| 쿠폰 캠페인 발행 | `coupons` + `lib/coupon.js` 파서 | P1 |
| 후기 신고 처리 (숨김 · 삭제) | 신규 | P2 |
| TourAPI 동기화 상태 · 캐시 비우기 | `/api/tour/status` `/cache/clear` (있음) | P1 |
| 1:1 문의 응대 | `s-inquiry` 화면이 이미 문의를 받음 | P2 |

> 7개 중 6개가 이미 서버에 있고 편집 화면만 없습니다. `CONTENT_KEYS` 20개를
> DB로 승격해 둔 작업이 여기서 값을 합니다.

### 2.5 최고관리자 `super_admin`

| 기능 | 설명 | 우선 |
|---|---|---|
| 계정 목록 · 역할 부여/회수 | 범위(scope)까지 지정 | P0 |
| 매장 · 생산자 입점 승인 | `status: pending → active` | P1 |
| 전체 통계 | 거래액 · 지역별 · 재고 회전 | P1 |
| 감사 로그 | 누가 무엇을 언제 바꿨는지 | P1 |
| 정산 집행 | | P2 |
| 운영자의 모든 권한 | 상위 집합 | — |

> 운영자와 나누는 이유: 운영자가 하는 일은 되돌릴 수 있지만(공지 수정),
> 최고관리자가 하는 일은 되돌리기 어렵습니다(권한 부여).

---

## 3. 데이터 모델

기존 컬렉션에 더하는 것만 적습니다.

```js
users[] {
  // 기존: id, provider, providerId, nickname, email, avatar, inviteCode, invitedBy, settings
  roles: ['customer'],          // 배열. 신규 가입은 customer 하나
  scope: {
    storeKeys: [],              // store_manager 담당 거점
    productIds: [],             // producer 담당 상품
    regions: [],                // operator 담당 지역. 빈 배열 = 전 지역
  },
  status: 'active',             // active | pending | suspended
  roleGrantedBy: null,          // 누가 역할을 줬는지
  roleGrantedAt: null,
}

products[] { producerId: null }      // 이 상품의 주인
stores[]   { managerIds: [] }        // 이 거점의 관리인들
orders[]   { status: 'reserved' | 'completed' | 'cancelled' | 'noshow' }

// 신규 컬렉션
stockLogs[] {
  id, productId, actorId,
  type: 'restock' | 'adjust' | 'order' | 'cancel' | 'noshow',
  delta, before, after, note, at,
}
audit[] { id, actorId, action, targetType, targetId, before, after, at }

settlements[] {                      // 지급 기록 (한 번만 지급되도록)
  id: '<from>_<to>_<key>', from, to, key,
  producerId, farm, gross, fee, net, count, qty,
  memo, paidBy, paidAt,
}
applications[] {                     // 입점 신청
  id, userId, nickname, email,
  role: 'producer' | 'store_manager',
  farm, storeKeys[], productIds[], memo,
  status: 'pending' | 'approved' | 'rejected',
  createdAt, decidedBy, decidedAt, note,
}
```

`stockLogs` 는 재고가 왜 그 숫자인지 설명합니다. 없으면 "어제 20개였는데 왜
오늘 3개죠?" 에 답할 수 없습니다.

---

## 4. 권한 매트릭스

라우트가 아니라 **행위(action)** 기준입니다. 라우트는 늘어나지만 행위는
안정적이라, 새 API 를 추가할 때 어느 권한을 붙일지 바로 정해집니다.

| 행위 | customer | producer | store_manager | operator | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|
| `order:read:own` | ✓ | | | | ✓ |
| `order:cancel:own` | ✓ | | | | ✓ |
| `order:read:product` | | ✓ 담당 상품 | | | ✓ |
| `order:read:store` | | | ✓ 담당 거점 | | ✓ |
| `order:complete` | | | ✓ 담당 거점 | | ✓ |
| `order:noshow` | | | ✓ 담당 거점 | | ✓ |
| `product:write` | | ✓ 담당 상품 | | | ✓ |
| `product:restock` | | ✓ 담당 상품 | ✓ 담당 거점 | | ✓ |
| `store:write` | | | ✓ 담당 거점 | | ✓ |
| `content:write` | | | | ✓ | ✓ |
| `coupon:issue` | | | | ✓ | ✓ |
| `review:moderate` | | | | ✓ | ✓ |
| `stats:read` | | | | ✓ 담당 지역 | ✓ |
| `user:role:write` | | | | | ✓ |
| `store:approve` | | | | | ✓ |
| `audit:read` | | | | | ✓ |

**범위 검사는 권한 검사와 별개입니다.** `order:complete` 를 가졌다고 아무
주문이나 완료할 수 있는 게 아니라, 그 주문의 거점이 내 `storeKeys` 안에
있어야 합니다.

---

## 5. 주문 상태 전이

```
                 ┌── cancel ────────→ cancelled   재고 +N, 쿠폰 복구
                 │   (customer, 픽업 시간 전)
   reserved ─────┤
                 ├── complete ──────→ completed   정산 대상
                 │   (store_manager)
                 └── noshow ────────→ noshow      재고 복구는 선택
                     (store_manager, 마감 후)
```

- 종착 상태(`completed` · `cancelled` · `noshow`)에서는 더 이상 전이하지 않습니다.
- `cancelled` 는 재고와 쿠폰을 **반드시** 되돌립니다 (이미 구현됨).
- `noshow` 의 재고 복구는 관리인이 정합니다. 신선식품은 폐기라 되돌리면 안 됩니다.
- 정산은 `completed` 만 셉니다.

---

## 6. API 인터페이스

모든 응답은 실패 시 `{ error, code }` 를 돌려줍니다.
권한 없음은 `403 { code: 'FORBIDDEN' }`, 범위 밖은 `404` (존재 여부도 숨깁니다).

### 공통

```
GET  /api/auth/roles
  → { roles: [], scope: {}, status, can: {행위:bool},
      user, stores: [{key,name,addr}], products: [{id,name,farm,stock,placeKey}] }
```

### 생산자 `/api/producer/*`

```
GET   /api/producer/products
  → { products: [{ id, name, stock, todayOrders, reserved, priceWas, priceNow, placeKey }] }

POST  /api/producer/products/:id/restock   { qty, note? }
  → { product, log }                       재고 += qty, stockLogs 기록

PATCH /api/producer/products/:id           { priceWas?, priceNow?, hours?, pickupDay? }
  → { product }

GET   /api/producer/orders?date=YYYY-MM-DD&status=
  → { orders: [...] }                      내 상품 주문만

GET   /api/producer/summary?from=&to=
  → { sold, revenue, noshow, byProduct: [...] }
```

### 매장 관리인 `/api/store/*`

```
GET   /api/store/pickups?storeKey=&date=&status=
  → { pickups: [{ orderId, code, productName, farm, qty, total, status, buyerName, phone }] }

GET   /api/store/pickups/lookup?code=HL-1234
  → { pickup }                             예약코드 한 건 조회

POST  /api/store/pickups/:orderId/complete
  → { order }                              reserved → completed

POST  /api/store/pickups/:orderId/noshow   { restock: boolean, note? }
  → { order, product }                     reserved → noshow

POST  /api/store/products/:id/adjust       { delta, note }   사유 필수
  → { product, log }

PATCH /api/store/:storeKey                 { hours?, closed?, notice? }
  → { store }

GET   /api/store/summary?storeKey=&date=
  → { reserved, completed, noshow, revenue }
```

### 운영자 `/api/admin/*`

```
GET   /api/admin/content/:key              키는 CONTENT_KEYS 화이트리스트
PUT   /api/admin/content/:key   { value }
POST  /api/admin/coupons/issue  { target: 'all'|'region'|'userIds', pct, nm, cond, exp }
GET   /api/admin/reviews?reported=1
POST  /api/admin/reviews/:id/hide  { reason }
```

### 입점 신청 · 승인

```
POST  /api/admin/apply            { role, farm?, storeKeys?, productIds?, memo? }
  → { application }               로그인만 하면 누구나. 심사 전에는 권한이 생기지 않습니다.
GET   /api/admin/apply/mine       → { applications }
GET   /api/admin/applications?status=pending|approved|rejected|all
POST  /api/admin/applications/:id/decide  { approve, scope?, note? }
  → { application, user }         승인과 동시에 역할·범위가 붙습니다.
```

### 정산

```
GET   /api/producer/settlement?from=&to=     내 정산서 (기본: 이번 달)
GET   /api/admin/settlement?from=&to=&feeRate=
  → { statements: [{ key, farm, count, qty, gross, coupon, fee, net, paid }], total }
POST  /api/admin/settlement/pay   { from, to, key, memo? }
  → { settlement }                같은 기간·같은 대상은 한 번만
```

수수료는 판매가 합계(쿠폰 적용 전)에 붙습니다. **쿠폰 할인은 플랫폼 부담이라
농가 몫에서 빼지 않습니다.** 그러지 않으면 쿠폰을 쓸수록 농가가 손해를 봅니다.

### 최고관리자 `/api/admin/*`

```
GET   /api/admin/users?role=&status=&q=
PUT   /api/admin/users/:id/roles   { roles: [], scope: {} }
PUT   /api/admin/users/:id/status  { status }
GET   /api/admin/stats?from=&to=
GET   /api/admin/audit?limit=&actorId=
POST  /api/admin/reset             { confirm: 'RESET' }   로컬 전용 · 되돌릴 수 없음
```

---

## 7. 연계 — 역할이 어디서 맞물리는가

한 건의 픽업이 세 역할을 지나갑니다. 이 흐름이 끊기면 시스템이 멈춥니다.

```
[생산자]  오늘 출하 등록 (한우 등심 5팩)
             │  POST /api/producer/products/01/restock
             │  products[01].stock 4 → 9,  stockLogs +restock
             ▼
[일반사용자] 앱에서 "오늘 9팩 남음" 을 보고 2팩 예약
             │  POST /api/orders
             │  stock 9 → 7,  order.status = reserved,  code = HL-2580
             ▼
[매장관리인] 손님이 HL-2580 을 제시 → 수령 확인
             │  POST /api/store/pickups/:id/complete
             │  order.status = completed  (재고는 이미 빠졌으므로 변화 없음)
             ▼
[생산자]    정산 집계에 잡힘 (completed 만)
[운영자]    통계 · 지역별 거래액에 반영
```

**끊기는 지점 세 곳:**

1. **출하가 없으면 재고가 0으로 수렴합니다.** 지금이 이 상태입니다.
2. **수령 확인이 없으면 `completed` 가 안 생겨 정산과 통계가 전부 0입니다.**
   지금은 `MY_STATS.completed` 가 항상 0으로 나옵니다.
3. **노쇼 처리가 없으면 예약만 하고 안 온 물건이 영원히 `reserved` 로 남아
   재고가 묶입니다.**

역할 간 데이터 소유권:

| 데이터 | 주인 | 읽을 수 있는 사람 |
|---|---|---|
| `products[].stock` | 생산자 | 전원 (앱 표시) |
| `products[].price` | 생산자 | 전원 |
| `orders[]` | 일반 사용자 | 본인, 담당 생산자, 담당 매장, 최고관리자 |
| `orders[].phone` | 일반 사용자 | 본인, 담당 매장(수령 확인용), 최고관리자 |
| `stores[].hours` | 매장 관리인 | 전원 |
| `content.*` | 운영자 | 전원 |
| `users[].roles` | 최고관리자 | 본인, 최고관리자 |

> 연락처는 매장 관리인에게만 열립니다. 생산자는 주문 수량만 보면 되고
> 손님 전화번호를 볼 이유가 없습니다.

---

## 8. 화면

관리자 화면은 기존 앱(`happylocal_v2.html`)이 아니라 **별도 페이지
`admin.html`** 에 둡니다.

이유:
1. 기존 앱은 420px 폰 목업 디자인 언어로 6,300줄이 짜여 있습니다.
2. 관리자 코드를 넣으면 일반 사용자에게도 배포됩니다.
3. 기존 359개 테스트를 건드리지 않습니다.
4. 로그인 세션은 같은 쿠키를 공유하므로 계정은 하나입니다.

`admin.html` 은 로그인한 계정의 역할에 따라 메뉴가 달라지는 단일 페이지입니다.

`admin.html` 의 14개 화면 (역할에 따라 메뉴가 달라집니다):

| 화면 | 역할 | 하는 일 |
|---|---|---|
| 오늘 픽업 | `store_manager` | 예약코드 조회 → 수령 확인 · 노쇼 |
| 일일 마감 | `store_manager` | 대기/수령/취소/노쇼 · 매출 |
| 매장 정보 | `store_manager` | 운영시간 · 휴무 · 입점 상품 재고 조정 |
| 오늘 출하 | `producer` | 오늘 낼 물량 등록 |
| 판매 현황 | `producer` | 상품별 판매·매출·재고 |
| 정산 | `producer` | 내 지급 예정액 |
| 콘텐츠 편집 | `operator` | `CONTENT_KEYS` 20개 JSON 편집 |
| 쿠폰 발행 | `operator` | 전체 회원 캠페인 |
| 후기 관리 | `operator` | 숨김 · 재노출 |
| 전체 통계 | `operator` | 거래액 · 지역별 · 재고 회전 |
| 정산 집행 | `super_admin` | 농가별 지급 처리 |
| 입점 심사 | `super_admin` | 승인 → 역할·범위 부여 |
| 계정 · 역할 | `super_admin` | 역할과 담당 범위 지정 |
| 감사 로그 | `super_admin` | 되돌리기 어려운 변경 이력 |

일반 사용자 앱에 추가할 것: **픽업 제시 화면** (예약코드를 크게 띄워 매장에
보여주는 용도). 이것만 기존 앱에 들어갑니다.

---

## 9. 구현 현황

| | 항목 | 상태 |
|---|---|---|
| 1 | 데이터 모델 확장 (스키마 v8 + 마이그레이션) | 완료 |
| 2 | `lib/roles.js` — 역할 · 범위 · `requireCan` | 완료 |
| 3 | 생산자 API (`/api/producer/*`) | 완료 |
| 4 | 매장 관리인 API (`/api/store/*`) | 완료 |
| 5 | 운영자 · 최고관리자 API (`/api/admin/*`) | 완료 |
| 6 | `admin.html` — 8개 화면 | 완료 |
| 7 | 앱의 픽업 제시 화면 | 완료 |
| 8 | 역할 격리 검증 (`roletest.js` · `admintest.js`) | 완료 |
| 9 | 운영자 화면 (콘텐츠 · 쿠폰 · 후기) | 완료 |
| 10 | 정산 (`settlements`) — 집계 · 지급 · 이중지급 방지 | 완료 |
| 11 | 입점 신청 · 승인 (`applications`) | 완료 |
| 12 | 아이디 · 비밀번호 로그인 (scrypt) | 완료 |
| 13 | 역할별 테스트 계정 11개 | 완료 |

### 작업 중 막은 권한 구멍

| 구멍 | 무엇이 가능했나 |
|---|---|
| `POST /api/tour/cache/clear` | 인증 없이 TourAPI 캐시를 비워 공공 API 호출 한도 소진 |
| `POST /api/admin/reset` | **인증 없이 DB 전체 초기화** — 주문·계정·후기 전부 삭제 |
| `GET/PUT /api/admin/content/*` (구 라우트) | `index.js` 에 남아 있던 `localOnly` 전용 라우트가 라우터보다 먼저 등록돼 역할 검사를 통째로 우회 |

세 건 모두 `roletest.js` 에 회귀 검사가 있습니다.

### 역할은 누가, 어디서 부여하는가

| | |
|---|---|
| **누가** | `super_admin` 만 (`requireCan('user:role:write')`) |
| **어디서** | `/admin.html` → **계정 · 역할** 화면에서 직접 부여 |
| **또는** | `/admin.html` → **입점 심사** 에서 신청을 승인하면 자동 부여 |
| **첫 관리자** | `SUPER_ADMIN_EMAILS` 환경변수 (아래) |

부여는 즉시 반영되지 않고 **다음 로그인부터** 적용됩니다. 세션에 담긴 사용자
레코드를 매 요청 다시 읽으므로 실제로는 바로 반영되지만, 화면 메뉴는
`/api/auth/roles` 를 부팅 시 한 번 읽으므로 새로고침이 필요합니다.

### 테스트 계정

카카오 계정 없이 각 역할을 확인할 수 있도록 아이디·비밀번호 계정을 둡니다.

```bash
npm run seed:accounts     # 여러 번 돌려도 같은 결과
```

| 아이디 | 역할 | 담당 범위 |
|---|---|---|
| `customer1` · `customer2` | 일반 | — |
| `farmer_hs` | 생산자 | 횡성 상품 전부 |
| `farmer_pc` | 생산자 | 평창 상품 전부 |
| `farmer_js` | 생산자 | 정선 상품 전부 |
| `store_hanwoo` | 매장 관리인 | `pk_hanwoo` · `pk_plaza` |
| `store_local` | 매장 관리인 | `pk_local` · `pk_bread` · `pk_potato` |
| `store_js` | 매장 관리인 | 정선 거점 3곳 |
| `farmstore_pc` | 생산자 + 매장 관리인 | 오대천 양어장 (직판) |
| `operator1` | 운영자 | — |
| `admin1` | 최고관리자 | 전체 |

비밀번호는 모두 `happylocal2026` 입니다.
**운영 환경에서는 만들지 마세요** — `NODE_ENV=production` 이면 스크립트가
거부합니다. 비밀번호가 공개된 계정이 남기 때문입니다.

`farmstore_pc` 는 한 계정이 두 역할을 갖는 경우를 확인하려고 둡니다.
자기 물건을 자기 자리에서 파는 농가가 실제로 이런 모양입니다.

### 첫 최고관리자

아무도 `super_admin` 이 아니면 역할을 줄 사람이 없습니다. 환경변수로 지정합니다.

```
SUPER_ADMIN_EMAILS=you@example.com,ops@example.com
```

카카오 로그인 계정의 이메일이 여기 있으면 로그인할 때 자동으로 붙습니다.
로컬에서는 `admin.html` 의 개발용 로그인 상자로 역할을 바로 골라 확인할 수 있고,
배포(`VERCEL`)에서는 그 상자가 나오지 않습니다.
