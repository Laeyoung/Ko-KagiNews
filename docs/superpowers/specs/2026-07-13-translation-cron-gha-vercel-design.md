# 번역 Cron GitHub Actions + Vercel 배포 — Design Spec

날짜: 2026-07-13
상태: 승인됨 (사용자 확인)
관련: `docs/korean-translation-spec.md` §4.3(크론), 구현 계획 Task 20(크론 배포 게이트)

## 목적

Task 20의 서버 crontab 기반 번역 크론을 **GitHub Actions**로 대체하고, 프론트엔드를
**Vercel**에 배포할 수 있게 한다. 사이드카 전달은 **repo 커밋 + Vercel 자동 재배포**
방식(사용자 선택)을 쓴다. 임시(preview) 주소로 전체 경로를 검증한다.

## 전체 데이터 흐름

```
GitHub Actions (매일 14:00 / 16:00 UTC)
  → bun scripts/translate-batch.ts   (GEMINI_API_KEY = GitHub Secret)
  → data/translations/<batchId>/*.json 생성
  → 오래된 배치 정리(최근 7일 유지) 후 git commit + push
  → Vercel이 push를 감지해 자동 재배포
  → 새 배포의 서버 번들에 사이드카 포함 → 한국어 오버레이 서빙
```

- 배치는 12:00 UTC 발행이므로 14:00 본 실행 + 16:00 캐치업(§4.3의 crontab 시각과 동일).
- `schedule` 트리거는 GitHub 규칙상 **기본 브랜치(main)에 머지된 후에만** 발동한다.
  머지 전 테스트는 `workflow_dispatch`로 수행한다.

## 구성 요소

### 1. 서버 번들 읽기 경로 — `src/lib/server/translations.ts`

Vercel 서버리스 함수는 정적으로 참조되지 않은 repo 파일을 `fs`로 읽을 수 없다
(nft 트레이싱에 포함되지 않음). 해결:

- `import.meta.glob('/data/translations/**/*.json')` (lazy) 맵을 모듈에 추가해
  빌드 시 사이드카가 서버 번들에 포함되도록 강제한다.
- 읽기 우선순위: **기존 fs 경로 먼저**(로컬 dev, adapter-node 배포에서 동작) →
  fs에 파일이 없으면 **번들 글롭 맵**에서 읽는다.
- 기존 mtime 재검증 캐시는 fs 경로에만 적용(번들은 배포 단위로 불변이므로 단순
  메모리 캐시면 충분). freshness 가드·`TRANSLATIONS_ENABLED` kill-switch는 두 경로
  모두에 동일 적용.

### 2. 어댑터 분기 — `svelte.config.js`

- `@sveltejs/adapter-vercel` devDependency 추가.
- `process.env.VERCEL ? vercelAdapter() : nodeAdapter()` 조건 분기.
- 기존 CI(`npm run build` → `node build` 스모크)는 adapter-node 경로 그대로 유지.

### 3. `.gitignore`

- `data/translations/*` 제외 규칙 제거 → 사이드카를 버전 관리에 포함.
- 크론 임시 파일(`*.lock` 등 실행 중 생성물)은 계속 제외.

### 4. GitHub Actions — `.github/workflows/translate.yml`

- 트리거: `schedule: 0 14 * * *`, `0 16 * * *`, `workflow_dispatch`.
- `concurrency: translate` (cancel 없음 — 락 파일 로직이 자체 처리).
- 단계: checkout → `oven-sh/setup-bun` → `bun install --frozen-lockfile` →
  `bun scripts/translate-batch.ts` (env: `GEMINI_API_KEY`, `TRANSLATIONS_DIR`,
  선택적 `GEMINI_MODEL`) → 7일 초과 배치 디렉토리 삭제 → 변경 있으면
  `chore(translations): <date>` 커밋 + push.
- push 권한: 기본 `GITHUB_TOKEN` + `permissions: contents: write`.
- 스크립트 exit code가 0이 아니면 잡 실패 → GitHub 알림이 §4.3의 MAILTO 역할 대체.

### 5. 시크릿 / 환경 변수

- GitHub Secrets: `GEMINI_API_KEY` (사용자 제공 키). 커밋 금지, 로그 출력 금지.
- 로컬 `.env`(untracked): 동일 키 — 로컬 실행 테스트용.
- Vercel env: `TRANSLATIONS_ENABLED=true`만 필요(서빙은 Gemini 호출 없음).

### 6. 임시 주소 테스트 절차

1. 로컬에서 실제 키로 `translate-batch` 실행 → 사이드카 생성·검증 → 커밋.
2. `vercel link`로 프로젝트 생성 → `vercel`(preview) 배포 → 임시 URL에서
   스토리 API 한국어 오버레이 + 사이드카 없는 배치의 영어 폴백 확인.
3. `workflow_dispatch`로 이 브랜치에서 Actions 실행 → 시크릿→번역→커밋 E2E 확인.

## 에러 처리

- 번역 실패율 임계 초과·API 오류 → 스크립트가 비 0 exit → Actions 잡 실패 알림.
  기존 사이드카는 남아 있으므로 서빙은 마지막 성공분 + 영어 폴백으로 동작.
- Vercel 재배포 실패 → 이전 배포가 그대로 서빙(사이드카만 하루 늦음).
- 글롭 맵에 파일이 없고 fs에도 없으면 기존과 동일하게 영어 폴백.

## 트레이드오프 (사용자 승인됨)

- 매일 번역 커밋이 히스토리에 누적된다(파일 수는 7일 정리로 제한).
- 번역 반영이 Vercel 재배포 시간(수 분)만큼 지연된다 — 일 1회 콘텐츠라 허용.

## 범위 제외

- main 머지, 프로덕션 도메인 연결, 크론 2일 soak(Task 24 Step 4)는 별도 작업.
