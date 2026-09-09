/**
 * 역할별 운영 매뉴얼 생성.
 *
 *   npm run seed:accounts && npm run manual:ops
 *
 * 각 역할로 실제 로그인해서 화면을 찍고, 그 캡처로 매뉴얼을 만듭니다.
 * 손으로 붙이면 화면이 바뀔 때마다 낡아도 알 방법이 없어서 스크립트로 둡니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.log('\n  playwright-core 가 없어 건너뜁니다.\n'); process.exit(0); }

const __dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dir, '..', '..', 'happylocal-ops-manual.html');
const PORT = process.env.PORT || 8787;
const ADMIN = `http://localhost:${PORT}/admin.html`;
const PW = 'happylocal2026';

function findBrowser() {
  if (process.env.BROWSER_PATH) return process.env.BROWSER_PATH;
  return [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((p) => fs.existsSync(p)) || null;
}
const CHROME = findBrowser();
if (!CHROME) { console.log('\n  Chrome/Edge 를 찾지 못해 건너뜁니다.\n'); process.exit(0); }

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------
// 매뉴얼 내용
// ---------------------------------------------------------------
const ROLES = [
  {
    id: 'producer',
    account: 'farmer_hs',
    name: '생산자 (농가 · 작목반)',
    lead: '오늘 낼 물량을 넣어 앱의 재고를 채웁니다. 이 일을 하지 않으면 재고는 '
      + '주문으로 줄어들기만 해서 며칠 안에 전 상품이 품절됩니다.',
    daily: [
      '아침에 로그인해 <b>오늘 출하</b>를 엽니다.',
      '준비한 수량을 상품마다 넣고 <b>출하</b>를 누릅니다. 앱 재고에 바로 더해집니다.',
      '재고가 3개 이하인 상품은 위에 붉은 줄로 알려 줍니다.',
      '오후에 <b>판매 현황</b>에서 오늘 얼마나 나갔는지 봅니다.',
      '달마다 <b>정산</b>에서 지급 예정액을 확인합니다.',
    ],
    shots: [
      { view: 'shipping', cap: '오늘 출하', alt: '상품별 재고와 수량 입력칸이 있는 오늘 출하 화면' },
      { view: 'sales', cap: '판매 현황', alt: '판매 건수와 매출, 상품별 표가 있는 판매 현황 화면' },
      { view: 'mysettle', cap: '정산', alt: '기간별 판매액과 수수료, 지급액을 보여주는 정산 화면' },
    ],
    faq: [
      ['출하 수량을 잘못 넣었어요.',
        '출하는 재고에 더하기만 합니다. 빼야 한다면 매장 관리인에게 <b>재고 조정</b>을 '
        + '요청하세요. 사유가 함께 기록됩니다.'],
      ['다른 지역 상품이 안 보여요.',
        '담당으로 지정된 상품만 보입니다. 범위를 넓히려면 최고관리자에게 요청하세요.'],
      ['매출이 예약 건수보다 적어요.',
        '정산은 손님이 <b>실제로 찾아간</b> 주문만 셉니다. 예약만 하고 안 온 건과 '
        + '취소·노쇼는 빠집니다.'],
      ['판매가를 정가보다 높게 넣을 수 없어요.',
        '할인 서비스라 판매가는 정가 이하여야 합니다. 정가를 먼저 올리세요.'],
    ],
  },
  {
    id: 'store',
    account: 'store_hanwoo',
    name: '매장 관리인 (픽업 거점)',
    lead: '손님이 예약코드를 대면 조회해서 수령 확인을 찍습니다. 이 확인이 없으면 '
      + '거래가 완료로 잡히지 않아 정산과 통계가 전부 0으로 남습니다.',
    daily: [
      '문을 열면 <b>오늘 픽업</b>을 띄워 둡니다. 대기 건이 목록 위에 모입니다.',
      '손님이 코드를 대면 큰 입력칸에 넣고 <b>조회</b>를 누릅니다. 대소문자는 상관없습니다.',
      '상품과 수량을 확인하고 <b>수령 확인</b>을 누릅니다.',
      '마감 후 안 찾아간 예약은 <b>노쇼</b>로 정리합니다. 다시 팔 수 있으면 재고를 되돌립니다.',
      '<b>일일 마감</b>에서 오늘 실적을 확인합니다.',
    ],
    shots: [
      { view: 'pickups', cap: '오늘 픽업', alt: '예약코드 입력칸과 예약 목록이 있는 오늘 픽업 화면' },
      { view: 'closing', cap: '일일 마감', alt: '대기 수령 취소 노쇼 건수와 매출을 보여주는 마감 화면' },
      { view: 'mystores', cap: '매장 정보', alt: '운영시간과 입점 상품 재고를 관리하는 매장 정보 화면' },
    ],
    faq: [
      ['코드를 넣었는데 못 찾는다고 나와요.',
        '<b>담당 거점의 예약만</b> 조회됩니다. 다른 매장에서 받을 상품이면 그 매장에서 '
        + '확인해야 합니다. 코드를 잘못 들었을 수도 있으니 예약자 이름으로도 확인해 보세요.'],
      ['수령 확인을 눌렀는데 재고가 안 줄어요.',
        '맞습니다. 재고는 손님이 <b>예약할 때</b> 이미 빠졌습니다. 수령 확인에서 또 빼면 '
        + '두 번 차감됩니다.'],
      ['노쇼 처리할 때 재고를 되돌려야 하나요?',
        '다시 팔 수 있으면 되돌리고, 신선식품이라 폐기해야 하면 되돌리지 마세요. '
        + '되돌리면 팔 수 없는 물건이 재고에 잡힙니다.'],
      ['상품이 파손됐어요.',
        '<b>매장 정보</b> 화면의 입점 상품 표에서 <b>재고 조정</b>을 누르고 음수를 넣습니다. '
        + '사유는 반드시 적어야 합니다.'],
      ['이미 처리한 예약을 되돌릴 수 있나요?',
        '없습니다. 수령완료·노쇼는 종착 상태입니다. 잘못 눌렀다면 최고관리자에게 문의하세요.'],
    ],
  },
  {
    id: 'operator',
    account: 'operator1',
    name: '운영자 (지자체 · 재단)',
    lead: '앱이 보여주는 편집 정보를 관리합니다. 공지·FAQ·약관, 축제와 코스 구성, '
      + '제철 캘린더, 쿠폰 캠페인, 후기 조치가 여기 속합니다.',
    daily: [
      '<b>콘텐츠 편집</b>에서 공지나 FAQ 를 고칩니다. 저장하면 앱에 바로 반영됩니다.',
      '제철이 바뀌면 캘린더와 코스 구성을 손봅니다.',
      '행사 기간에 <b>쿠폰 발행</b>으로 캠페인을 돌립니다.',
      '신고된 후기를 <b>후기 관리</b>에서 확인하고 숨깁니다.',
      '<b>전체 통계</b>에서 지역별 거래와 재고 회전을 봅니다.',
    ],
    shots: [
      { view: 'content', cap: '콘텐츠 편집', alt: '왼쪽 키 목록과 오른쪽 JSON 편집기가 있는 콘텐츠 편집 화면' },
      { view: 'coupons', cap: '쿠폰 발행', alt: '할인 이름 조건 유효기간을 넣는 쿠폰 발행 화면' },
      { view: 'stats', cap: '전체 통계', alt: '가입자 매출 재고와 지역별 표를 보여주는 통계 화면' },
    ],
    faq: [
      ['콘텐츠는 JSON 으로 고치나요?',
        '네. 구조를 그대로 두고 값만 바꾸세요. 형식이 틀리면 저장 전에 알려 줍니다.'],
      ['실수로 다 지웠어요.',
        '통째로 비우는 저장은 서버가 막습니다. 저장 전이라면 <b>되돌리기</b>를 누르세요.'],
      ['쿠폰 조건은 어떻게 쓰나요?',
        '문구가 곧 규칙입니다. "최대 8,000원"은 할인 상한, "3만원 이상"은 최소 주문액, '
        + '"횡성 매장"은 지역 제한으로 읽힙니다.'],
      ['전체 재고가 계속 줄기만 해요.',
        '농가의 출하가 멈춘 신호입니다. 담당 농가에 연락하세요.'],
      ['계정 관리가 안 보여요.',
        '운영자 권한 밖입니다. 역할 부여는 최고관리자만 합니다.'],
    ],
  },
  {
    id: 'admin',
    account: 'admin1',
    name: '최고관리자',
    lead: '계정과 권한, 입점 심사, 정산 집행을 맡습니다. 되돌리기 어려운 일이 모여 '
      + '있어 운영자와 나눠 두었습니다.',
    daily: [
      '<b>입점 심사</b>에서 신청을 확인하고 승인합니다. 승인하면 그 자리에서 역할과 '
      + '담당 범위가 붙습니다.',
      '<b>계정 · 역할</b>에서 직접 역할을 주거나 회수합니다. 담당 거점·상품을 '
      + '함께 지정해야 실제로 쓸 수 있습니다.',
      '달마다 <b>정산 집행</b>에서 농가별 지급을 처리합니다.',
      '<b>감사 로그</b>에서 누가 무엇을 바꿨는지 확인합니다.',
    ],
    shots: [
      { view: 'apply', cap: '입점 심사', alt: '신청자와 역할, 승인 반려 버튼이 있는 입점 심사 화면' },
      { view: 'users', cap: '계정 · 역할', alt: '계정 목록과 역할 칩, 담당 범위를 보여주는 계정 관리 화면' },
      { view: 'settle', cap: '정산 집행', alt: '농가별 판매액 수수료 지급액과 지급 버튼이 있는 정산 화면' },
      { view: 'audit', cap: '감사 로그', alt: '시각 실행자 행위 대상이 나열된 감사 로그 화면' },
    ],
    faq: [
      ['역할만 주면 되나요?',
        '아닙니다. <b>담당 범위</b>를 함께 줘야 합니다. 매장 관리인에게 거점을 안 주면 '
        + '로그인해도 빈 목록만 보입니다.'],
      ['부여한 역할이 언제 적용되나요?',
        '즉시 적용됩니다. 다만 화면 메뉴는 로그인할 때 한 번 읽으므로 새로고침이 필요합니다.'],
      ['제 관리자 권한을 회수할 수 있나요?',
        '관리자가 저 혼자라면 막힙니다. 아무도 되돌릴 수 없게 되기 때문입니다.'],
      ['지급 처리를 취소할 수 있나요?',
        '없습니다. 같은 기간·같은 농가는 한 번만 지급됩니다. 감사 로그에 남습니다.'],
      ['첫 관리자는 어떻게 만드나요?',
        '<code>SUPER_ADMIN_EMAILS</code> 환경변수에 이메일을 넣고 그 계정으로 로그인합니다. '
        + '카카오 동의항목에 이메일이 켜져 있어야 합니다.'],
    ],
  },
];

// ---------------------------------------------------------------
// 캡처
// ---------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
console.log('');

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(ADMIN, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.fill('#lg-id', role.account);
  await page.fill('#lg-pw', PW);
  await page.click('form.devbox button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1200);

  for (const s of role.shots) {
    await page.click(`#nav button[data-view="${s.view}"]`).catch(() => {});
    await page.waitForTimeout(900);
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
    s.img = 'data:image/jpeg;base64,' + buf.toString('base64');
  }
  console.log(`  ${role.name} — 캡처 ${role.shots.length}장 (${role.account})`);
  await ctx.close();
}
await browser.close();

// ---------------------------------------------------------------
// 문서 조립
// ---------------------------------------------------------------
const section = (r) => `
      <section class="role" id="${r.id}">
        <header class="role-head">
          <span class="role-tag">${esc(r.name)}</span>
          <p class="role-lead">${r.lead}</p>
        </header>

        <div class="role-body">
          <div class="daily">
            <h3>하루의 흐름</h3>
            <ol>${r.daily.map((d) => `<li>${d}</li>`).join('')}</ol>
          </div>

          <div class="shots">
            ${r.shots.map((s) => `<figure>
              <img src="${s.img}" alt="${esc(s.alt)}" loading="lazy">
              <figcaption>${esc(s.cap)}</figcaption>
            </figure>`).join('')}
          </div>

          <div class="faq">
            <h3>자주 묻는 것</h3>
            <dl>${r.faq.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${a}</dd>`).join('')}</dl>
          </div>
        </div>
      </section>`;

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>해피로컬 운영 매뉴얼</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='26' font-size='26'>📗</text></svg>">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@300;400;500;600;700&display=swap">
<style>
  :root{
    --ground:#F7F8F5; --surface:#fff; --surface-2:#F1F4EF; --line:#DEE4DB;
    --ink:#1B211C; --ink-2:#3D473F; --muted:#5F6B61;
    --brand:#2F9E4F; --brand-deep:#1F7A3B; --brand-soft:#E8F4EC;
    --accent:#C2610F; --accent-soft:#FBEEE1;
    --shadow:0 1px 2px rgba(27,33,28,.05), 0 10px 30px rgba(27,33,28,.08);
    --radius:14px;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#12150F; --surface:#1A1E17; --surface-2:#222720; --line:#333A31;
      --ink:#E8EEE6; --ink-2:#C3CCBF; --muted:#94A08F;
      --brand:#5FC77C; --brand-deep:#8FDCA4; --brand-soft:#1D2A21;
      --accent:#E9A25B; --accent-soft:#2B2117;
      --shadow:0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.28);
    }
  }
  :root[data-theme="dark"]{
    --ground:#12150F; --surface:#1A1E17; --surface-2:#222720; --line:#333A31;
    --ink:#E8EEE6; --ink-2:#C3CCBF; --muted:#94A08F;
    --brand:#5FC77C; --brand-deep:#8FDCA4; --brand-soft:#1D2A21;
    --accent:#E9A25B; --accent-soft:#2B2117;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);
    font-family:'IBM Plex Sans KR',system-ui,sans-serif;font-size:15px;line-height:1.75;
    -webkit-font-smoothing:antialiased}
  .wrap{max-width:1000px;margin:0 auto;padding:0 22px 90px}

  header.top{padding:64px 0 30px;border-bottom:1px solid var(--line);margin-bottom:38px}
  .eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;color:var(--brand-deep);
    text-transform:uppercase;margin:0 0 12px}
  h1{font-family:'Gowun Batang',serif;font-size:40px;font-weight:700;margin:0 0 14px;
    letter-spacing:-.02em;text-wrap:balance;line-height:1.25}
  .top p{margin:0;color:var(--muted);font-size:15.5px;max-width:62ch}

  nav.toc{display:flex;flex-wrap:wrap;gap:8px;margin:26px 0 0}
  nav.toc a{padding:8px 15px;border-radius:999px;border:1px solid var(--line);
    background:var(--surface);color:var(--ink-2);text-decoration:none;
    font-size:13.5px;font-weight:600}
  nav.toc a:hover{border-color:var(--brand);color:var(--brand-deep)}

  .role{margin:0 0 56px;scroll-margin-top:20px}
  .role-head{margin-bottom:22px}
  .role-tag{display:inline-block;padding:5px 14px;border-radius:999px;
    background:var(--brand-soft);color:var(--brand-deep);font-size:13px;font-weight:700}
  .role-lead{margin:14px 0 0;font-size:17px;color:var(--ink-2);max-width:66ch;
    text-wrap:pretty}

  .role-body{display:grid;gap:22px}
  .daily,.faq{background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius);padding:22px 26px;box-shadow:var(--shadow)}
  h3{font-family:'Gowun Batang',serif;font-size:20px;font-weight:700;margin:0 0 14px}

  ol{counter-reset:s;list-style:none;margin:0;padding:0}
  ol li{position:relative;padding:0 0 0 38px;margin-bottom:11px;color:var(--ink-2)}
  ol li::before{counter-increment:s;content:counter(s);position:absolute;left:0;top:2px;
    width:24px;height:24px;border-radius:50%;background:var(--brand-soft);
    color:var(--brand-deep);font-size:12.5px;font-weight:700;
    display:flex;align-items:center;justify-content:center}
  ol li:last-child{margin-bottom:0}

  .shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
  figure{margin:0;background:var(--surface);border:1px solid var(--line);
    border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
  figure img{display:block;width:100%;height:auto}
  figcaption{padding:11px 15px;font-size:13px;font-weight:600;color:var(--muted);
    border-top:1px solid var(--line);background:var(--surface-2)}

  dl{margin:0}
  dt{font-weight:700;color:var(--ink);margin-top:16px}
  dt:first-child{margin-top:0}
  dd{margin:5px 0 0;color:var(--ink-2)}
  code{background:var(--surface-2);padding:2px 6px;border-radius:5px;font-size:.9em}

  .note{margin-top:22px;padding:16px 20px;border-radius:var(--radius);
    background:var(--accent-soft);color:var(--ink-2);font-size:14px;
    border-left:3px solid var(--accent)}
  .note b{color:var(--ink)}

  footer{margin-top:60px;padding-top:26px;border-top:1px solid var(--line);
    color:var(--muted);font-size:13.5px}
  footer table{border-collapse:collapse;margin-top:14px;font-size:13px}
  footer td{padding:5px 16px 5px 0;vertical-align:top}
  footer td:first-child{font-weight:700;color:var(--ink-2);white-space:nowrap}
  @media (max-width:640px){ h1{font-size:30px} .wrap{padding:0 16px 60px} }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">해피로컬 운영 매뉴얼</p>
    <h1>농가와 매장이<br>매일 하는 일</h1>
    <p>여행자 앱은 예약을 받는 곳이고, 운영 화면은 그 예약이 실제로 물건이 되어
      손님 손에 가게 하는 곳입니다. 역할마다 하는 일이 다르니 자기 절만 읽으면 됩니다.</p>
    <nav class="toc">
      ${ROLES.map((r) => `<a href="#${r.id}">${esc(r.name)}</a>`).join('')}
    </nav>
  </header>

  ${ROLES.map(section).join('')}

  <footer>
    <p><b>운영 화면 주소</b> — 여행자 앱과 별도입니다. 로그인 계정은 같습니다.</p>
    <table>
      <tr><td>여행자 앱</td><td>/happylocal_v2.html</td></tr>
      <tr><td>운영 화면</td><td>/admin.html</td></tr>
    </table>
    <div class="note">
      <b>역할은 최고관리자가 부여합니다.</b> 로그인했는데 메뉴가 보이지 않으면
      아직 역할이 없는 것입니다. 운영 화면에서 <b>입점 신청</b>을 하거나
      담당자에게 요청하세요. 역할과 함께 <b>담당 거점·상품</b>이 지정되어야
      실제로 화면에 내용이 채워집니다.
    </div>
    <p style="margin-top:22px">이 매뉴얼의 캡처는 실제 화면에서 자동으로 찍습니다
      (<code>npm run manual:ops</code>). 화면이 바뀌면 다시 돌려 주세요.</p>
  </footer>
</div>
</body>
</html>`;

fs.writeFileSync(OUT, html);
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`\n  운영 매뉴얼 생성 완료 (${mb}MB)`);
console.log(`  ${OUT}\n`);
