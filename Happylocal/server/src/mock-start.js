/**
 * 목 모드로 서버를 띄웁니다.  npm run mock
 *
 * Windows/macOS/Linux 어디서나 같은 명령으로 동작하도록,
 * 셸 환경변수 문법(TOUR_MOCK=1 ...) 대신 여기서 직접 설정합니다.
 */
process.env.TOUR_MOCK = '1';
await import('./index.js');
