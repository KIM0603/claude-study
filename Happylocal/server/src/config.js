import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dir = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dir, '..');        // server/
export const APP_ROOT = path.resolve(ROOT, '..');     // Happylocal/

dotenv.config({ path: path.join(ROOT, '.env') });

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PORT, 8787),

  tour: {
    // Empty key is a supported mode: the server falls back to seed data.
    key: (process.env.TOUR_API_KEY || '').trim(),
    // TOUR_MOCK=1 이면 네트워크 대신 내장 픽스처를 씁니다.
    // 키 발급 전에 "실데이터 연동" 경로 전체를 그대로 돌려볼 수 있습니다.
    mock: /^(1|true|yes)$/i.test(process.env.TOUR_MOCK || ''),
    base: (process.env.TOUR_API_BASE || 'https://apis.data.go.kr/B551011/KorService2').replace(/\/+$/, ''),
    areaCode: (process.env.TOUR_AREA_CODE || '32').trim(),
    sigungu: {
      '횡성': (process.env.TOUR_SIGUNGU_HOENGSEONG || '18').trim(),
      '평창': (process.env.TOUR_SIGUNGU_PYEONGCHANG || '15').trim(),
      '정선': (process.env.TOUR_SIGUNGU_JEONGSEON || '11').trim(),
    },
  },

  // 카카오 로그인(REST API). 지도용 JavaScript 키와는 다른 키입니다.
  // 이 키와 액세스 토큰은 서버 밖으로 나가지 않습니다.
  kakaoRestKey: (process.env.KAKAO_REST_KEY || '').trim(),
  kakaoClientSecret: (process.env.KAKAO_CLIENT_SECRET || '').trim(),

  // 배포 시 OAuth Redirect URI 를 만들 기준 주소. 비우면 요청 헤더에서 추론합니다.
  appOrigin: (process.env.APP_ORIGIN || '').trim(),

  // 개발용 로그인. OAuth 키가 없어도 로컬에서 앱 전체를 시연·테스트할 수 있게 합니다.
  // 배포(VERCEL)에서는 항상 꺼집니다.
  // 최고관리자 부트스트랩. 아무도 super_admin 이 아니면 역할을 줄 사람이 없어서
  // 첫 관리자는 환경변수로 지정합니다 (쉼표로 여러 명).
  superAdminEmails: String(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),

  allowDevLogin: String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase() !== 'false'
    && !process.env.VERCEL,

  // https 환경에서 세션 쿠키에 Secure 를 붙입니다.
  secureCookies: String(process.env.SECURE_COOKIES || '').toLowerCase() === 'true'
    || !!process.env.VERCEL,

  // 카카오맵 JavaScript 키.
  // 도메인 제한으로 보호되는 *클라이언트* 키라 브라우저 노출이 정상입니다
  // (TourAPI 서비스키와 달리 서버에 숨길 필요가 없습니다).
  kakaoJsKey: (process.env.KAKAO_JS_KEY || '').trim(),

  cacheTtlMs: num(process.env.CACHE_TTL_SECONDS, 3600) * 1000,

  dataDir: path.join(ROOT, 'data'),
  seedFile: path.join(ROOT, 'data', 'seed.json'),
  dbFile: path.join(ROOT, 'data', 'db.json'),
};

export const hasTourKey = () => config.tour.mock || config.tour.key.length > 0;

/** TourAPI contentTypeId -> the `type` field the front-end already renders. */
export const CONTENT_TYPE = {
  TOURIST: '12',   // 관광지
  CULTURE: '14',   // 문화시설
  FESTIVAL: '15',  // 축제공연행사
  COURSE: '25',    // 여행코스
  LEPORTS: '28',   // 레포츠
  LODGING: '32',   // 숙박
  SHOPPING: '38',  // 쇼핑
  FOOD: '39',      // 음식점
};

export const TYPE_OF_CONTENT = {
  [CONTENT_TYPE.TOURIST]: 'tour',
  [CONTENT_TYPE.CULTURE]: 'tour',
  [CONTENT_TYPE.FESTIVAL]: 'festival',
  [CONTENT_TYPE.LEPORTS]: 'tour',
  [CONTENT_TYPE.SHOPPING]: 'pickup',
  [CONTENT_TYPE.FOOD]: 'food',
};
