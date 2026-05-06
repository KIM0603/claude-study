# 🤖 Claude Learn Studio

> Claude를 활용한 실전 AI 교육 플랫폼 — 에이전트가 함께 단계적으로 안내합니다

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-7c6fff)](https://claude.ai/code)
[![Status](https://img.shields.io/badge/Status-Building-00d4aa)](.)

---

## 📚 커리큘럼 목록

| # | 과정명 | 난이도 | 소요 시간 | 상태 |
|---|--------|--------|-----------|------|
| 01 | [Claude Code로 탄탄한 기획서 완성하기](./curricula/01-planning-with-claude-code/) | 입문~중급 | 3~4시간 | ✅ 완성 |
| 02 | 비개발자도 되는 Claude Code 바이브 코딩 입문 | 입문 | 2~3시간 | 🚧 준비중 |
| 03 | CLAUDE.md 메모리 시스템 완전 정복 | 중급 | 2시간 | 🚧 준비중 |
| 04 | Figma MCP 연결 · 디자인→코드 자동화 | 중급 | 2~3시간 | 🚧 준비중 |
| 05 | Claude Cowork로 업무 자동화 (비개발자용) | 입문 | 2시간 | 🚧 준비중 |
| 06 | Agent Teams · 멀티 에이전트 팀 협업 | 고급 | 3~4시간 | 🚧 준비중 |
| 07 | Claude in Excel · PPT 업무 자동화 | 입문 | 1~2시간 | 🚧 준비중 |
| 08 | 0→1 웹서비스 빌드 · Supabase · Vercel 배포 | 중급 | 4~5시간 | 🚧 준비중 |
| 09 | Skills · 플러그인 · 커스텀 자동화 설계 | 중급 | 2~3시간 | 🚧 준비중 |

---

## 🏗️ 레포 구조

```
claude-learn-studio/
│
├── README.md                          # 이 파일
│
├── curricula/                         # 커리큘럼별 폴더
│   └── 01-planning-with-claude-code/
│       ├── README.md                  # 커리큘럼 전체 가이드
│       ├── STEP1-setup.md             # 1단계: 기반 세팅
│       ├── STEP2-structure.md         # 2단계: 구조 설계
│       ├── STEP3-writing.md           # 3단계: 본문 작성
│       ├── STEP4-validation.md        # 4단계: 검증·보완
│       ├── STEP5-automation.md        # 5단계: 스킬화·자동화
│       └── examples/                  # 완성 기획서 예시
│
├── .claude/                           # Claude Code 설정
│   └── skills/
│       └── planning/                  # 기획서 작성 스킬
│           ├── SKILL.md               # 스킬 메인 파일
│           ├── template.md            # 기획서 템플릿
│           ├── cpo-prompts.md         # CPO 검증 프롬프트 모음
│           └── examples/              # 잘 쓴 기획서 예시
│
└── docs/                              # 추가 문서
    └── agent-team.md                  # 에이전트 팀 구성 설명
```

---

## 🚀 빠른 시작

### 사전 준비
- Claude 계정 (Pro 이상 권장)
- Claude Code 설치 ([설치 가이드](https://claude.ai/code))
- Node.js 18+ (Claude Code 의존성)

### 설치
```bash
git clone https://github.com/YOUR_USERNAME/claude-learn-studio.git
cd claude-learn-studio
```

### 첫 번째 커리큘럼 시작
```bash
cd curricula/01-planning-with-claude-code
# README.md 를 읽고 STEP1부터 따라가세요
```

---

## 🤖 에이전트 팀 구성

이 플랫폼은 5개의 Claude 에이전트가 협력하여 학습을 지원합니다.

| 에이전트 | 역할 |
|---------|------|
| 리서치 에이전트 | 최신 Claude 정보 수집·분류 |
| 커리큘럼 에이전트 | 학습 단계 구조화·난이도 설계 |
| 실습 에이전트 | 코드 실행·디버깅·결과 검증 |
| 평가 에이전트 | 진도 추적·맞춤 피드백 |
| 멘토 에이전트 | Q&A·심화 가이드 |

---

## 📖 참고 소스

이 커리큘럼은 다음 소스들을 조사하여 만들었습니다.

**국내**
- [컬리 기술블로그](https://helloworld.kurly.com) — 바이브 코딩 전략, 테크스펙 + AI
- [브런치](https://brunch.co.kr) — Cowork 실사용기, Claude Blue, AI 기획서
- [오빠두엑셀](https://oppadu.com) — Claude in Excel 실전 예제
- [highoutputclub](https://blog.highoutputclub.com) — 비개발자 Claude Code 플레이북
- [selfishclub 워크샵](https://selfishclub.xyz) — Claude Code 웹서비스 빌드 워크샵
- [wikidocs](https://wikidocs.net/329792) — Claude Code 입문서
- [스파르타 AI 블로그](https://b2b.spartaclub.kr) — 기획 역량 프롬프트 가이드

**해외**
- [Anthropic 공식 문서](https://docs.anthropic.com)
- [Claude Code 공식 문서](https://code.claude.com/docs)
- [DeepLearning.ai](https://deeplearning.ai) — Anthropic 직강 Claude Code
- [Medium - Kozyrkov](https://kozyrkov.medium.com) — Claude 신기능 딥다이브
- [The AI Corner](https://the-ai-corner.com) — 2026년 Claude 출시 완전 정리

---

## 🤝 기여하기

커리큘럼 개선, 새로운 주제 제안, 오류 수정 모두 환영합니다!

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/new-curriculum`)
3. Commit your changes (`git commit -m 'Add new curriculum: XXX'`)
4. Push to the branch (`git push origin feature/new-curriculum`)
5. Open a Pull Request

---

## 📄 라이선스

MIT License — 자유롭게 사용, 수정, 배포하세요.
