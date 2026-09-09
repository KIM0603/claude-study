/**
 * .env 를 서버보다 나중에 고쳤는지 알려 줍니다.
 *
 * .env 는 프로세스가 뜰 때 한 번만 읽힙니다. 값을 저장하고 재시작을 안 하면
 * 이미 떠 있는 서버는 옛 값을 그대로 들고 있습니다. 화면에는 "설정이 맞지
 * 않다" 고만 보여서, 콘솔 설정을 몇 번씩 다시 확인하며 헤매게 됩니다.
 * 실제로 카카오 Client Secret 에서 그렇게 됐습니다.
 *
 * 기동 시점에 검사하면 소용없습니다. 방금 뜬 프로세스가 언제나 더 새것이라
 * 절대 걸리지 않습니다. 그래서 **설정이 실제로 쓰이는 순간** 에 봅니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../config.js';

const ENV_FILE = path.join(APP_ROOT, 'server', '.env');
const STARTED_AT = Date.now() - process.uptime() * 1000;

let warned = false;
let lastCheck = 0;
let cached = null;

/**
 * 서버가 옛 설정을 쓰고 있으면 안내 문구를, 아니면 빈 문자열을 돌려줍니다.
 * 파일 stat 은 1초에 한 번만 합니다.
 */
export function staleEnvNotice() {
  const now = Date.now();
  if (cached !== null && now - lastCheck < 1000) return cached;
  lastCheck = now;

  try {
    if (!fs.existsSync(ENV_FILE)) { cached = ''; return cached; }
    const changed = fs.statSync(ENV_FILE).mtimeMs;
    if (changed <= STARTED_AT) { cached = ''; return cached; }

    const ago = Math.round((now - changed) / 1000);
    cached = `.env 가 서버 기동 뒤에 바뀌었습니다 (${ago}초 전). `
      + '지금 떠 있는 서버는 옛 설정을 쓰고 있으니 재시작하세요.';
    if (!warned) {
      warned = true;
      console.warn('');
      console.warn(`  ⚠ ${cached}`);
      console.warn('');
    }
    return cached;
  } catch {
    // 진단일 뿐이라 실패해도 요청을 막지 않습니다.
    cached = '';
    return cached;
  }
}
