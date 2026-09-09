/**
 * Vercel 서버리스 함수 진입점.
 *
 * server/src/index.js 는 VERCEL 환경변수가 있으면 listen 하지 않고
 * Express 앱만 export 합니다. 여기서 그 앱을 그대로 핸들러로 넘깁니다.
 *
 * 정적 파일(happylocal_v2.html, images/)은 vercel.json 의 라우팅에 따라
 * CDN 이 직접 서빙하므로 이 함수를 거치지 않습니다.
 */
export { default } from '../server/src/index.js';
