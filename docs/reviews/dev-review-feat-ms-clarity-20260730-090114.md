# dev-review report

> **스냅샷 노트 (사후 추가)** — 이 리포트는 커밋 `c342ce8` 시점의 코드를 검토한 결과이며, 본문은 원문 그대로 보존합니다. 이후 `feat/ms-clarity` 브랜치에서 다음 **4건을 제외한 전 항목이 반영**되었습니다: 동의 게이트(CRITICAL), CSP(MAJOR), 레이아웃 배선 테스트(MINOR), 개인정보 고지/PIPA Art.30(MINOR). 따라서 아래의 "수정 미적용", 라인 번호, 그리고 `$env/static/public` / `PUBLIC_CLARITY_PROJECT_ID` 권고(실제 채택은 `VITE_CLARITY_*`)는 현재 코드와 일치하지 않습니다. 미조치 항목의 최신 상태는 PR #6 본문의 "후속 작업" 절을 보세요.

- Branch: feat/ms-clarity ← main
- Date: 2026-07-30T09:01:14Z
- Min severity: minor
- Change summary: MS Clarity 애널리틱스 태그를 클라이언트 모듈로 주입 + 루트 레이아웃 연동 + 유닛 테스트 신규 (3 files, +97)

## Findings

### CRITICAL
- `src/lib/client/clarity.ts:27` — 가드가 `!browser || dev || !projectId` 뿐이라, 동의 없이 세션 리코딩과 `_clck`/`_clsk` 쿠키가 무조건 로드됨. 레포 전체에 consent/banner/doNotTrack 코드가 없어 GDPR Art.6 + ePrivacy 5(3), PIPA Art.15/22 및 국외이전(Art.28-8) 노출. 동일 가드 라인이 `dev`만 보기 때문에 Vercel preview 배포와 CI(build-test.yml의 preview 서버 + Lighthouse)까지 프로덕션 Clarity 프로젝트에 실제 세션을 기록하는 문제도 겹침
  Fix: `initClarity()`를 opt-in(기본 off) 동의 상태 뒤로 옮기고 동의 후 `clarity('consent')` 신호를 보낼 것. 동시에 프로덕션 전용 게이트(`$env/static/public`의 `PUBLIC_VERCEL_ENV` 또는 정식 호스트명 확인)를 `!dev`에 추가

### MAJOR
- `src/lib/components/search/SearchInput.svelte:149` — 검색창이 `<input>`이 아니라 `contenteditable` div라서, Clarity 기본 Balanced 마스킹(폼 필드만 대상)이 적용되지 않고 입력한 검색어가 일반 텍스트로 그대로 녹화됨
  Fix: contenteditable 요소와 칩 컨테이너에 `data-clarity-mask="true"` 추가
- `src/lib/client/clarity.ts:43` — CSP가 레포 어디에도 없음(`svelte.config.js`에 `csp` 없음, `vercel.json`에 `headers` 없음, `hooks.server.ts`에서도 설정 없음). 추가 Microsoft 스크립트를 스스로 주입하는 로더라 SRI도 쓸 수 없어, 허용 목록 없이 DOM·동일 출처 JS 전권을 갖게 됨
  Fix: `kit.csp` 또는 `vercel.json` 헤더로 `script-src`를 self + `*.clarity.ms`로 제한하고 `connect-src`도 맞춰 설정
- `src/lib/client/clarity.test.ts:5` — 파일 단위 `vi.mock`이 `browser: true, dev: false`로 못 박아 `!browser`/`dev` 두 가드가 한 번도 실행되지 않음. 모듈의 존재 이유인 dev·서버 no-op이 미검증이며, 조건을 `if (!browser && dev)`로 바꾸거나 `dev`를 지워도 4개 테스트가 전부 통과함
  Fix: 케이스별 `vi.doMock` + `vi.resetModules()` + `await import('./clarity')`로 `dev: true` / `browser: false` 변형을 추가해 스크립트 미주입과 `window.clarity` undefined를 각각 단정

### MINOR
- `src/lib/client/clarity.ts:10` — 프로젝트 ID가 env 오버라이드도 문서화도 없는 하드코딩 상수여서, 공개 레포를 포크·셀프호스트하면 세션 리코딩이 조용히 이 포크 소유자의 Clarity 프로젝트로 전송됨
  Fix: `$env/static/public`의 `PUBLIC_CLARITY_PROJECT_ID`를 읽고 현재 리터럴을 폴백으로 두며, `.env.example`과 CLAUDE.md에 서드파티 태그 사실을 기재
- `src/lib/client/clarity.ts:24` — JSDoc이 멱등 가드의 근거를 "client-side navigation re-running layout init"으로 설명하지만, 루트 레이아웃 컴포넌트는 클라이언트 네비게이션에서 재생성되지 않아 `onMount`가 다시 실행될 수 없음 — 명시된 근거가 사실과 다름
  Fix: 방어적 가드("repeat calls / 이미 존재하는 태그")로 문구를 고치거나 해당 괄호구를 삭제
- `src/lib/client/clarity.ts:26` — 마스킹 동작이 버전 관리 밖의 Clarity 대시보드 masking-mode 설정에 전적으로 의존해, Relaxed로 바꾸면 코드 리뷰 없이 폼 입력 수집이 시작됨
  Fix: 코드에서 strict 마스킹을 지정하거나, 요구되는 대시보드 모드를 `CLARITY_PROJECT_ID` 옆에 문서화
- `src/lib/client/clarity.ts:32` — `onerror` 경로가 없어 애드블로커 차단이나 로드 실패 시 스텁이 페이지 수명 동안 `window.clarity`에 남고 `clarity.q`가 상한·배출 없이 누적됨(현재 앱이 `window.clarity`를 호출하지 않아 무해할 뿐)
  Fix: `script.onerror = () => { delete window.clarity; }`를 추가하거나 `q.length` 상한을 둬 실패한 로드 뒤에 스텁이 남지 않게
- `src/lib/components/settings/SettingsContentFilter.svelte:338` — 사용자가 직접 입력한 콘텐츠 필터 키워드가 폼 필드가 아닌 평문 칩으로 렌더돼 마스킹 없이 캡처되며, 건강·정치·종교 성향(GDPR Art.9 특별범주)을 드러낼 수 있음
  Fix: active-filters 블록을 `data-clarity-mask="true"`로 감싸기
- `src/lib/components/IntroScreen.svelte:107` — "We respect your privacy" 문구가 있으나 `src/routes/about` 등 어디에도 애널리틱스·쿠키·수탁자 고지가 없어, 세션 리코딩을 미공개로 추가하면 해당 문구가 오인 소지가 있고 PIPA Art.30 고지 의무도 누락
  Fix: Microsoft Clarity, 수집 항목, 보관기간, 옵트아웃을 명시한 개인정보 처리방침을 추가하고 동의 배너에서 링크
- `src/lib/client/clarity.test.ts:26` — 멱등성 테스트가 happy path만 반복해 `if (!window.clarity)` 분기가 단독으로 커버되지 않음. 정작 중요한 "벤더 태그가 이미 `window.clarity`를 세팅했고 `#ms-clarity` 노드는 제거된" 경우가 미검증이며, 2회 호출이 기존 `q`를 보존하는지도 단정하지 않음
  Fix: (a) 노드 제거 + `window.clarity`에 sentinel → 스크립트는 재주입되지만 sentinel 동일성 유지, (b) 호출 1건 큐잉 후 재호출 시 `q` 길이 1 유지 — 두 케이스 추가
- `src/lib/client/clarity.test.ts:12` — 정리가 `beforeEach`에만 있어 파일 종료 시 살아 있는 `window.clarity` 스텁과 `<script src="https://www.clarity.ms/...">`가 `document.head`에 남음. `vitest.config.unit.ts`가 `isolate`/`pool`을 지정하지 않아 기본 `isolate: true`에만 의존하는 암묵적 보장
  Fix: 동일한 정리 두 줄을 `afterEach`에도 넣어 pool/isolation 설정과 무관하게 잔여물이 없게
- `src/routes/+layout.svelte:83` — `initClarity()`가 마운트 시 호출되는지 단정하는 테스트가 없어, 기능을 실제로 동작시키는 유일한 배선을 삭제해도 테스트가 하나도 깨지지 않음
  Fix: `vi.mock('$lib/client/clarity')`로 스파이를 걸어 레이아웃 스모크 테스트를 추가하거나, 루트 레이아웃 마운트 비용이 과하다면 이 공백을 PR에 명시
- `src/routes/+layout.svelte:84` — `initClarity()`가 루트 레이아웃 `onMount`의 첫 문장이라, Clarity 태그 fetch와 세션 리코딩 계측이 하이드레이션·설정/언어 초기화와 메인 스레드를 경합하는 시점에 시작됨(Lighthouse CI가 측정하는 구간)
  Fix: 호출을 `onMount` 끝으로 옮기고/또는 `requestIdleCallback(() => initClarity(), { timeout: 3000 })`(+`setTimeout` 폴백)으로 지연

## 통합 시 판정 보류한 항목

- `src/lib/client/clarity.test.ts:4` (runtime 에이전트, MINOR) — "vitest에서 `$app/environment`가 dev 모드를 보고한다"는 주석이 사실과 다르다는 지적. 그러나 이 브랜치 작업 중 mock 추가 **전에 실제로 3건이 실패**했고, tests 에이전트도 별도로 "plugin(alias 아님)이 `dev: true`를 공급했음이 확인된다"고 판정했습니다. 경험적 증거가 주석을 뒷받침하므로 findings에서 제외했습니다.
- `clarity.ts:27`은 세 에이전트가 각각 동의 게이트(CRITICAL)·preview/CI 오염(MAJOR/MINOR)으로 잡았습니다. 동일 `(file, line)`이라 규칙대로 최고 severity로 병합하고 두 사안을 본문에 함께 기술했습니다. 조치는 두 개(동의 게이트 + 프로덕션 전용 게이트)로 나뉩니다.

## Summary
- 1 CRITICAL / 3 MAJOR / 10 MINOR
- 수정 미적용 — 자동 수정 필요 시 `/dev-review-loop` 사용
