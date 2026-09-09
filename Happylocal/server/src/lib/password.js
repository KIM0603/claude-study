/**
 * 비밀번호 해시.
 *
 * 소셜 로그인만 있으면 카카오 계정이 없는 심사위원·테스트 인력이 들어올 수
 * 없고, 배포에서는 개발용 로그인이 막혀 있어 확인할 길이 없습니다.
 * 그래서 아이디·비밀번호 로그인을 함께 둡니다.
 *
 * 의존성을 늘리지 않으려고 bcrypt 대신 Node 내장 scrypt 를 씁니다.
 * scrypt 는 메모리를 많이 쓰도록 설계돼 GPU 로 밀어붙이기 어렵습니다.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// OWASP 권고(2023) 기준입니다. N=2^16, r=8, p=1.
const N = 65536;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

// scrypt 는 N*r*p*128 바이트를 씁니다. 기본 한도(32MB)로는 부족해 늘립니다.
const OPTS = { N, r: R, p: P, maxmem: 256 * 1024 * 1024 };

/** "scrypt$N$r$p$salt$hash" 한 줄로 저장합니다. 나중에 파라미터를 바꿔도 검증됩니다. */
export async function hashPassword(plain) {
  const pw = String(plain || '');
  if (pw.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다.');
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(pw, salt, KEYLEN, OPTS);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * 저장된 해시와 대조합니다.
 * 실패해도 성공과 비슷한 시간이 걸리도록 timingSafeEqual 을 씁니다.
 */
export async function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const got = await scrypt(String(plain || ''), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

/**
 * 아이디 규칙. 이메일과 헷갈리지 않게 영문·숫자·밑줄만 받습니다.
 * 대소문자를 구분하지 않도록 소문자로 눕혀 저장합니다.
 */
export function normalizeLoginId(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function checkLoginId(raw) {
  const id = normalizeLoginId(raw);
  if (id.length < 4 || id.length > 20) return { ok: false, error: '아이디는 4~20자여야 합니다.' };
  if (!/^[a-z0-9_]+$/.test(id)) return { ok: false, error: '아이디는 영문 소문자·숫자·밑줄만 쓸 수 있습니다.' };
  return { ok: true, id };
}

/**
 * 비밀번호 규칙.
 *
 * 길이를 우선합니다. 특수문자를 강제하면 사람들이 "Password1!" 같은 것을
 * 쓰게 되어 오히려 예측하기 쉬워집니다.
 */
export function checkPassword(raw) {
  const pw = String(raw || '');
  if (pw.length < 8) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' };
  if (pw.length > 100) return { ok: false, error: '비밀번호가 너무 깁니다.' };
  if (/^\d+$/.test(pw)) return { ok: false, error: '숫자만으로는 만들 수 없습니다.' };
  if (/^(.)\1+$/.test(pw)) return { ok: false, error: '같은 문자만 반복할 수 없습니다.' };
  return { ok: true };
}
