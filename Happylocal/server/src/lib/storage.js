import fs from 'node:fs';
import { config } from '../config.js';

/**
 * 저장 백엔드 추상화.
 *
 * 로컬/컨테이너: JSON 파일 (server/data/db.json)
 * Vercel:        Vercel KV (Redis)
 *
 * Vercel 함수는 **읽기 전용 파일시스템**이고 /tmp 만 쓸 수 있는데 그마저
 * 호출 간에 유지되지 않습니다. 그래서 파일 저장을 그대로 쓰면 주문·후기가
 * 사라집니다. KV_REST_API_URL 이 있으면 자동으로 KV 로 전환합니다.
 *
 * 데이터가 작아서(상품 30 · 주문 수십) DB 전체를 KV 키 하나에 담습니다.
 * 레코드가 수천 건으로 늘면 컬렉션별로 쪼개야 합니다.
 */

const KV_KEY = 'happylocal:db';

export const backendName = () =>
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ? 'kv' : 'file';

let kvClient = null;
async function kv() {
  if (kvClient) return kvClient;
  try {
    const mod = await import('@vercel/kv');
    kvClient = mod.kv;
    return kvClient;
  } catch {
    throw new Error(
      'KV 환경변수는 있는데 @vercel/kv 를 불러오지 못했습니다. `npm i @vercel/kv` 를 확인하세요.'
    );
  }
}

/** 저장된 DB 를 읽습니다. 없으면 null. */
export async function readDb() {
  if (backendName() === 'kv') {
    const client = await kv();
    const v = await client.get(KV_KEY);
    if (!v) return null;
    // KV 는 JSON 을 객체로 돌려주지만, 문자열로 저장된 경우도 방어합니다.
    return typeof v === 'string' ? JSON.parse(v) : v;
  }
  try {
    return JSON.parse(fs.readFileSync(config.dbFile, 'utf8'));
  } catch {
    return null;
  }
}

/** DB 를 저장합니다. */
export async function writeDb(db) {
  if (backendName() === 'kv') {
    const client = await kv();
    await client.set(KV_KEY, db);
    return;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = config.dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, config.dbFile);   // 같은 볼륨에서는 원자적
}

/** 시드 파일은 배포 산출물에 포함되므로 어느 백엔드든 파일에서 읽습니다. */
export function readSeed() {
  try {
    return JSON.parse(fs.readFileSync(config.seedFile, 'utf8'));
  } catch {
    return null;
  }
}
