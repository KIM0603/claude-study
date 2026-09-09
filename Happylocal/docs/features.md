# 기능 목록

각 기능이 **어느 역할의 것인지**, **어느 화면에서 하는지**, **어느 API 가
받는지**, **무엇이 검증하는지** 를 한 줄에 묶었습니다.

표기: ● 구현 완료 · ○ 미구현 · — 해당 없음

---

## 1. 인증 · 계정

| # | 기능 | 역할 | 화면 | API | 검증 |
|---|---|---|---|---|---|
| A1 | 카카오 소셜 로그인 | 전체 | `s-login` | `GET /api/auth/kakao` → `/callback` | 수동 |
| A2 | 아이디·비밀번호 가입 | 전체 | `s-login` | `POST /api/auth/register` | `accounttest` `logintest` |
| A3 | 아이디·비밀번호 로그인 | 전체 | `s-login` · `admin.html` | `POST /api/auth/login` | `accounttest` `logintest` |
| A4 | 비밀번호 변경 | 전체 | — (API) | `POST /api/auth/password` | `accounttest` |
| A5 | 로그아웃 | 전체 | `s-my` · 운영 사이드바 | `POST /api/auth/logout` | `browsertest` |
| A6 | 로그인 시도 제한 (8회/10분) | — | — | 로그인 라우트 내부 | `accounttest` |
| A7 | 세션 유지 (httpOnly 쿠키) | 전체 | — | `lib/auth.js` | `logintest` |
| A8 | 내 역할·범위 조회 | 전체 | 운영 사이드바 | `GET /api/auth/roles` | `roletest` |
| A9 | 계정 정지 · 해제 | 최고관리자 | `users` | `PUT /api/admin/users/:id/status` | `accounttest` |

**A3 를 만든 이유**: 소셜만 있으면 카카오 계정이 없는 사람이 들어올 수 없고,
배포에서는 개발용 로그인이 막혀 있어 확인할 길이 없습니다.

---

## 2. 일반 사용자 `customer`

### 2.1 둘러보기

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| C1 | 지역별 세일 상품 목록 | `s-home` | `/api/bootstrap` | `uilogictest` |
| C2 | 지역 필터 (횡성·평창·정선) | `s-home` | 클라이언트 | `uilogictest` |
| C3 | 정렬 (마감임박 · 할인율) | `s-home` | 클라이언트 | `uilogictest` |
| C4 | 더 보기 (끝에서 멈춤) | `s-home` | 클라이언트 | `uilogictest` |
| C5 | 지도에서 매장·축제 함께 보기 | `s-map` | `/api/bootstrap` | `browsertest` |
| C6 | 지도 지역 × 카테고리 필터 | `s-map` | 클라이언트 | `browsertest` |
| C7 | 로컬루트 코스 추천 | `s-route` `s-routebuild` | `POOL` | `e2etest` |
| C8 | 코스 상세 · 스팟 상세 | `s-route-detail` `s-avail-detail` | — | `browsertest` |
| C9 | 제철 캘린더 (월별) | `s-cal` `s-seasonal` | `cal` `CAL2_*` | `uilogictest` |
| C10 | 축제 일정 (실제 연도) | `s-cal` | 전국문화축제표준데이터 | `selftest` |
| C11 | 내 주변 매장 목록 | `s-stores` | `/api/stores` | `uilogictest` |
| C12 | 매장 검색 · 정렬 | `s-stores` | 클라이언트 | `uilogictest` |
| C13 | 상품 · 매장 상세 | `s-store-detail` `s-place` | `/api/tour/detail` | `fronttest` |

### 2.2 예약 · 결제

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| C14 | 수량 선택 (재고 상한) | `s-store-detail` | — | `uilogictest` |
| C15 | 쿠폰 선택 · 자동 최적 선택 | `cpsheet` | `GET /api/coupons/usable` | `logictest` |
| C16 | 결제 (재고 차감) | `s-pay` | `POST /api/orders` | `logictest` `scenariotest` |
| C17 | 예약 취소 (재고·쿠폰 복구) | `s-cart` | `POST /api/orders/:id/cancel` | `logictest` |
| C18 | 예약 내역 | `s-cart` `s-mycourse` | `GET /api/mypickups` | `uilogictest` |
| C19 | **픽업 코드 제시** | `pvsheet` | — | `logintest` |
| C20 | 장바구니 배지 | 앱바 | — | `uilogictest` |

### 2.3 남기기 · 설정

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| C21 | 후기 작성 (평점 가중 재계산) | `wrsheet` | `POST /api/reviews` | `logictest` |
| C22 | 내 후기 목록 · 삭제 | `s-reviews` | `GET /api/reviews?mine=1` | `uilogictest` |
| C23 | 쿠폰함 | `s-coupons` | `/api/coupons` | `browsertest` |
| C24 | 여행 코스 저장 (중복 방지) | `s-mycourse` | `/api/plans` | `uilogictest` |
| C25 | 알림 설정 (계정 저장) | `s-notif` | `GET/PUT /api/settings` | `browsertest` |
| C26 | 친구 초대 (계정별 코드·링크) | `s-invite` | `GET /api/invite` | `browsertest` |
| C27 | 화면 테마 (라이트/다크) | `s-my` | localStorage | `browsertest` |
| C28 | 공지 · FAQ · 문의 · 약관 | `s-notice` `s-faq` `s-inquiry` `s-terms` `s-privacy` | `/api/bootstrap` | `browsertest` |
| C29 | 입점 신청 | — (API) | `POST /api/admin/apply` | `scenariotest` |

---

## 3. 생산자 `producer`

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| P1 | **오늘 출하 등록** | `shipping` | `POST /api/producer/products/:id/restock` | `scenariotest` |
| P2 | 담당 상품 목록 (재고·대기) | `shipping` | `GET /api/producer/products` | `admintest` |
| P3 | 가격 수정 (판매가 ≤ 정가) | — (API) | `PATCH /api/producer/products/:id` | `roletest` |
| P4 | 픽업 시간 · 요일 수정 | — (API) | `PATCH /api/producer/products/:id` | `roletest` |
| P5 | 내 상품 주문 현황 | `sales` | `GET /api/producer/orders` | `admintest` |
| P6 | 판매 집계 (완료만 매출) | `sales` | `GET /api/producer/summary` | `scenariotest` |
| P7 | 내 정산서 | `mysettle` | `GET /api/producer/settlement` | `scenariotest` |
| P8 | 재고 변동 이력 | — (API) | `GET /api/producer/stocklogs` | `roletest` |
| P9 | 상품 사진 관리 | — | — | ○ |

**P1 이 이 서비스의 심장입니다.** 재고를 채울 경로가 없으면 주문으로 줄어들기만
해서 며칠 안에 전 상품이 품절됩니다.

---

## 4. 매장 관리인 `store_manager`

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| S1 | **오늘 픽업 목록** | `pickups` | `GET /api/store/pickups` | `admintest` |
| S2 | **예약코드 조회** (대소문자 무관) | `pickups` | `GET /api/store/pickups/lookup` | `logintest` |
| S3 | **수령 확인** | `pickups` | `POST .../complete` | `scenariotest` |
| S4 | 노쇼 처리 (재고 복구 선택) | `pickups` | `POST .../noshow` | `scenariotest` |
| S5 | 재고 조정 (사유 필수) | `mystores` | `POST /api/store/products/:id/adjust` | `scenariotest` |
| S6 | 매장 운영시간 · 휴무 | `mystores` | `PATCH /api/store/:storeKey` | `admintest` |
| S7 | 입점 상품 목록 (여러 농가) | `mystores` | `GET /api/store/mine` | `admintest` |
| S8 | 일일 마감 | `closing` | `GET /api/store/summary` | `scenariotest` |

**S3 가 없으면 `completed` 가 생기지 않아 정산과 통계가 전부 0으로 남습니다.**

---

## 5. 운영자 `operator`

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| O1 | 콘텐츠 편집 (20개 키) | `content` | `GET/PUT /api/admin/content/:key` | `scenariotest` |
| O2 | 빈 값 덮어쓰기 방지 | `content` | 서버 가드 | `scenariotest` |
| O3 | 쿠폰 캠페인 발행 | `coupons` | `POST /api/admin/coupons/issue` | `scenariotest` |
| O4 | 후기 숨김 · 재노출 | `reviews` | `POST /api/admin/reviews/:id/hide` | `roletest` |
| O5 | 전체 통계 (지역별·재고 회전) | `stats` | `GET /api/admin/stats` | `admintest` |
| O6 | TourAPI 상태 · 캐시 비우기 | — (API) | `/api/tour/status` `/cache/clear` | `roletest` |
| O7 | 1:1 문의 응대 | — | — | ○ |

O1 이 다루는 20개 키는 `CONTENT_KEYS` 입니다 — 공지·FAQ·약관·코스 구성·제철
캘린더·축제·매장 사진 등, 공공 API 로 대체할 수 없어 사람이 관리해야 하는 것들.

---

## 6. 최고관리자 `super_admin`

| # | 기능 | 화면 | API | 검증 |
|---|---|---|---|---|
| M1 | 계정 목록 · 검색 | `users` | `GET /api/admin/users` | `admintest` |
| M2 | **역할 · 범위 부여** | `users` | `PUT /api/admin/users/:id/roles` | `accounttest` |
| M3 | 마지막 관리자 보호 | — | 서버 가드 | `scenariotest` |
| M4 | 입점 심사 (승인 시 역할 부여) | `apply` | `POST /api/admin/applications/:id/decide` | `scenariotest` |
| M5 | 정산 집행 (이중지급 방지) | `settle` | `POST /api/admin/settlement/pay` | `scenariotest` |
| M6 | 감사 로그 | `audit` | `GET /api/admin/audit` | `admintest` |
| M7 | 전체 재고 이력 | — (API) | `GET /api/admin/stocklogs` | — |
| M8 | DB 초기화 (로컬·확인값 필수) | — (API) | `POST /api/admin/reset` | `roletest` |
| M9 | 운영자의 모든 권한 | 전체 | — | `accounttest` |

---

## 7. 시스템 · 데이터

| # | 기능 | 위치 | 검증 |
|---|---|---|---|
| Y1 | TourAPI 연동 (관광지·맛집·축제) | `lib/tourapi.js` | `mocktest` `fronttest` |
| Y2 | 전국문화축제표준데이터 연동 | `lib/festival.js` | `selftest` |
| Y3 | 서비스키 서버 보관 (브라우저 노출 0) | 프록시 구조 | `browsertest` (누출 카나리아) |
| Y4 | 응답 캐시 (일일 한도 절약) | `lib/tourapi.js` | `mocktest` |
| Y5 | 저장소 백엔드 전환 (file ↔ KV) | `lib/storage.js` | `vercetest` |
| Y6 | 스키마 마이그레이션 (v9) | `lib/store.js` | 기동 로그 |
| Y7 | 예약코드 유일성 보장 | `routes/orders.js` | `logictest` |
| Y8 | 재고 원자적 차감 (동시 주문) | `routes/orders.js` | `logictest` `scenariotest` |
| Y9 | 서버리스 모드 (Vercel) | `api/index.js` | `vercetest` |
| Y10 | 역할별 테스트 계정 생성 | `seed-accounts.mjs` | `accounttest` |
| Y11 | 매뉴얼 캡처 재생성 | `manual.mjs` | 수동 |

---

## 8. 미구현

| # | 기능 | 왜 뒤로 미뤘나 |
|---|---|---|
| ○ P9 | 상품 사진 업로드 | 파일 저장소가 필요합니다. 현재는 내장 이미지 인덱스를 씁니다. |
| ○ O7 | 1:1 문의 응대 화면 | 문의를 받는 화면(`s-inquiry`)은 있으나 답변 흐름이 없습니다. |
| ○ 정산 이체 | 실제 송금 | PG · 펌뱅킹 연동이 필요합니다. 현재는 지급 **기록**까지입니다. |
| ○ 알림 발송 | 푸시 · 문자 | 설정만 저장하고 실제 발송은 하지 않습니다. |

---

## 9. 검증 요약

| 스위트 | 보는 것 |
|---|---|
| `test:mock` | TourAPI 파싱 · 오류 · 캐시 (서버 불필요) |
| `test:api` | 부트스트랩 정합성 · 주문 · 후기 |
| `test:front` | 브라우저 없이 앱 스크립트 실행 |
| `test:vercel` | 서버리스 모드 + 배포 시 권한 |
| `test:browser` | 실제 Chrome 렌더링 · 콘솔 오류 · 조작 지점 |
| `test:e2e` | 사용자 여정 통합 |
| `test:logic` | 서버 계산이 수학적으로 맞는가 |
| `test:ui-logic` | 화면 값이 실제 데이터와 맞는가 |
| `test:role` | 역할 · 범위 격리, 권한 차단 |
| `test:admin` | 운영 화면 14종 |
| `test:account` | 실제 로그인으로 역할별 검증 |
| `test:login` | 브라우저에서 로그인 폼 |
| `test:scenario` | 업무흐름 W2~W6 · 연계 L1~L8 |

```bash
npm run seed:accounts
npm run test:all
```
