# Translation Cron via GitHub Actions + Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Task 20의 번역 크론을 GitHub Actions로 구현하고, 사이드카를 repo에 커밋해 Vercel 재배포로 서빙되게 한 뒤, preview(임시) URL로 검증한다.

**Architecture:** GH Actions(매일 14:00/16:00 UTC)가 `bun scripts/translate-batch.ts`를 실행해 `data/translations/<batchId>/`에 사이드카를 만들고 7일 초과분을 정리한 후 커밋·푸시한다. Vercel이 push를 감지해 재배포하며, 서버는 `import.meta.glob`으로 번들에 포함된 사이드카를 fs 폴백으로 읽는다.

**Tech Stack:** GitHub Actions(oven-sh/setup-bun), bun, SvelteKit(@sveltejs/adapter-vercel 분기), Vitest(unit), Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-07-13-translation-cron-gha-vercel-design.md`

## Global Constraints

- **API 키를 절대 커밋·로그 출력하지 않는다.** 키는 로컬 `.env`(untracked)와 GitHub Secrets `GEMINI_API_KEY`에만 존재한다.
- 읽기 우선순위는 **fs 먼저, 번들 글롭 폴백** — 로컬 dev/adapter-node 배포의 기존 동작 불변.
- 기존 CI(`node build` 스모크)는 깨지면 안 된다: adapter 분기는 `process.env.VERCEL`로만 발동.
- Biome 스타일(탭, width 100, useTemplate). 커밋 전 `npx biome check --write <files>`.
- 사이드카 보존 개수: **최신 7개 배치 디렉토리** (freshness 가드는 26h지만 롤백·디버깅 여유분).
- 유닛 테스트 실행 명령: `npx vitest run --config vitest.config.unit.ts <file>`.
- 기존 실패 테스트(BaseModal, batchService 13건)는 main에도 있는 무관한 실패 — 건드리지 않는다.

---

### Task 1: adapter-vercel 설치 + `svelte.config.js` 분기

**Files:**
- Modify: `svelte.config.js`
- Modify: `package.json` (devDependency 추가)

**Interfaces:**
- Produces: `VERCEL` env가 있으면 adapter-vercel, 없으면 adapter-node로 빌드되는 설정. 이후 Task 7의 Vercel 빌드가 이것에 의존.

- [ ] **Step 1: adapter-vercel 설치**

```bash
npm install -D @sveltejs/adapter-vercel
```

- [ ] **Step 2: `svelte.config.js` 분기 적용**

전체 파일을 다음으로 교체:

```js
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Vercel sets VERCEL=1 at build time; everywhere else (local, CI smoke
		// test via `node build`) keep the node adapter.
		adapter: process.env.VERCEL ? adapterVercel() : adapterNode(),
		csrf: {
			trustedOrigins: ['*'],
		},
	},
};

export default config;
```

- [ ] **Step 3: 기존 node 빌드가 그대로 동작하는지 확인**

Run: `npm run build && test -f build/index.js && echo NODE_BUILD_OK`
Expected: `NODE_BUILD_OK` (adapter-node 출력물 존재)

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json svelte.config.js
git commit -m "feat: conditional adapter-vercel for Vercel deploys"
```

---

### Task 2: 번들 사이드카 폴백 — `bundledSidecars.ts` + `translations.ts` (TDD)

**Files:**
- Create: `src/lib/server/bundledSidecars.ts`
- Modify: `src/lib/server/translations.ts:105-119` (readSidecar / readChaosSidecar)
- Test: `src/lib/server/__tests__/translations.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: 기존 `readJsonWithRevalidation`, `safeSidecarPath`, `Sidecar`/`ChaosSidecar` 타입.
- Produces: `bundledSidecars: Record<string, () => Promise<unknown>>` (키 형식 `/data/translations/<batchId>/<file>.json`), `readBundledSidecar<T>(batchId, file): Promise<T | null>`. `readSidecar`/`readChaosSidecar`는 fs 미스 시 번들에서 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/server/__tests__/translations.test.ts`의 기존 `vi.mock` 블록들 옆에 추가:

```ts
vi.mock('../bundledSidecars', () => ({
	bundledSidecars: {
		'/data/translations/2026-07-13.1/11111111-2222-3333-4444-555555555555.json': async () => ({
			version: 1,
			batchId: '2026-07-13.1',
			categoryUuid: '11111111-2222-3333-4444-555555555555',
			model: 'test-model',
			createdAt: '2026-07-13T14:00:00Z',
			stories: { s1: { title: '번들 제목' } },
		}),
		'/data/translations/2026-07-13.1/broken.json': async () => {
			throw new Error('chunk load failed');
		},
	},
}));
```

describe 블록 추가 (기존 import에 `readSidecar`가 이미 있으면 재사용):

```ts
describe('bundled sidecar fallback', () => {
	it('falls back to the bundled map when the file is not on disk', async () => {
		// TRANSLATIONS_DIR points at an empty tmp dir (기존 테스트 셋업 패턴 재사용)
		const sidecar = await readSidecar('2026-07-13.1', '11111111-2222-3333-4444-555555555555');
		expect(sidecar?.stories.s1.title).toBe('번들 제목');
	});

	it('returns null when neither fs nor bundle has the sidecar', async () => {
		const sidecar = await readSidecar('2026-07-13.1', '99999999-9999-9999-9999-999999999999');
		expect(sidecar).toBeNull();
	});

	it('prefers the fs copy over the bundled copy', async () => {
		// 기존 헬퍼로 tmp TRANSLATIONS_DIR에 같은 batchId/categoryUuid 사이드카를 쓰고
		// (stories: { s1: { title: 'fs 제목' } }), readSidecar가 'fs 제목'을 반환하는지 확인
		const sidecar = await readSidecar('2026-07-13.1', '11111111-2222-3333-4444-555555555555');
		expect(sidecar?.stories.s1.title).toBe('fs 제목');
	});

	it('readBundledSidecar returns null when the loader throws', async () => {
		const { readBundledSidecar } = await import('../translations');
		await expect(readBundledSidecar('2026-07-13.1', 'broken.json')).resolves.toBeNull();
	});
});
```

주의: 기존 테스트 파일의 tmp-dir 셋업/`$env/dynamic/private` 목 패턴을 그대로 따른다(파일을 먼저 읽고 그 유틸을 재사용할 것).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/server/__tests__/translations.test.ts`
Expected: FAIL — `Cannot find module '../bundledSidecars'` 또는 fallback 미구현으로 null

- [ ] **Step 3: 구현**

`src/lib/server/bundledSidecars.ts` 생성:

```ts
// Serverless (Vercel) deploys don't ship data/translations on the function
// filesystem — only statically referenced files survive nft tracing. This glob
// forces the committed sidecars into the server bundle as lazy chunks. Kept in
// its own module so tests can vi.mock the map.
export const bundledSidecars = import.meta.glob('/data/translations/*/*.json', {
	import: 'default',
}) as Record<string, () => Promise<unknown>>;
```

`src/lib/server/translations.ts` 수정 — import 추가:

```ts
import { bundledSidecars } from './bundledSidecars';
```

`safeSidecarPath` 아래에 추가:

```ts
export async function readBundledSidecar<T>(batchId: string, file: string): Promise<T | null> {
	const loader = bundledSidecars[`/data/translations/${batchId}/${file}`];
	if (!loader) return null;
	try {
		return (await loader()) as T;
	} catch {
		return null;
	}
}
```

`readSidecar` / `readChaosSidecar`의 마지막 return을 폴백 체인으로 교체:

```ts
export async function readSidecar(batchId: string, categoryUuid: string): Promise<Sidecar | null> {
	await logTranslationsDirOnce();
	if (!BATCH_ID.test(batchId) || !CATEGORY_UUID.test(categoryUuid)) return null;
	const file = `${categoryUuid}.json`;
	const abs = safeSidecarPath(batchId, file);
	const fromFs = abs ? await readJsonWithRevalidation<Sidecar>(abs) : null;
	return fromFs ?? readBundledSidecar<Sidecar>(batchId, file);
}

export async function readChaosSidecar(batchId: string): Promise<ChaosSidecar | null> {
	await logTranslationsDirOnce();
	if (!BATCH_ID.test(batchId)) return null;
	const abs = safeSidecarPath(batchId, 'chaos.json');
	const fromFs = abs ? await readJsonWithRevalidation<ChaosSidecar>(abs) : null;
	return fromFs ?? readBundledSidecar<ChaosSidecar>(batchId, 'chaos.json');
}
```

- [ ] **Step 4: 통과 확인 (전체 서버 테스트 포함)**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/server src/routes/api/batches/overlay-routes.test.ts`
Expected: PASS (기존 오버레이 라우트 테스트 포함 전부)

- [ ] **Step 5: 포맷 + 커밋**

```bash
npx biome check --write src/lib/server/bundledSidecars.ts src/lib/server/translations.ts src/lib/server/__tests__/translations.test.ts
git add src/lib/server
git commit -m "feat: bundled sidecar fallback for serverless deploys"
```

---

### Task 3: `.gitignore` — 사이드카 버전 관리 포함

**Files:**
- Modify: `.gitignore` (Translation sidecars 블록)

**Interfaces:**
- Produces: `data/translations/**/*.json` 커밋 가능. `.lock`/`.tmp.*`는 계속 제외. Task 5의 워크플로 커밋 단계와 Task 6이 의존.

- [ ] **Step 1: 규칙 교체**

`.gitignore`에서 아래 두 줄을:

```
# Translation sidecars (generated, not versioned)
data/translations/*
!data/translations/.gitkeep
```

다음으로 교체:

```
# Translation sidecars are versioned (Vercel bundling) — ignore only cron runtime files
data/translations/.lock
data/translations/**/*.tmp.*
```

- [ ] **Step 2: 동작 확인**

```bash
touch data/translations/.lock && mkdir -p data/translations/test-batch && touch data/translations/test-batch/a.json.tmp.123 data/translations/test-batch/a.json
git check-ignore -v data/translations/.lock data/translations/test-batch/a.json.tmp.123; git check-ignore data/translations/test-batch/a.json || echo "a.json TRACKED_OK"
rm -rf data/translations/.lock data/translations/test-batch
```

Expected: `.lock`과 `.tmp.123`은 ignore 매치, 마지막 줄에 `a.json TRACKED_OK`

- [ ] **Step 3: 커밋**

```bash
git add .gitignore
git commit -m "chore: version translation sidecars, ignore cron runtime files"
```

---

### Task 4: 사이드카 정리 스크립트 — `prune-translations.ts` (TDD)

**Files:**
- Create: `scripts/prune-helpers.ts`
- Create: `scripts/prune-translations.ts`
- Test: `scripts/prune-helpers.test.ts`

**Interfaces:**
- Produces: `selectBatchDirsToPrune(dirs: BatchDirInfo[], keep: number): string[]`, `BatchDirInfo = { name: string; newestCreatedAt: number | null }`. CLI: `bun scripts/prune-translations.ts` (env `TRANSLATIONS_DIR`, 기본 `./data/translations`, 최신 7개 유지). Task 5 워크플로가 호출.

- [ ] **Step 1: 실패하는 테스트 작성** — `scripts/prune-helpers.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { selectBatchDirsToPrune } from './prune-helpers';
import type { BatchDirInfo } from './prune-helpers';

function d(name: string, newestCreatedAt: number | null): BatchDirInfo {
	return { name, newestCreatedAt };
}

describe('selectBatchDirsToPrune', () => {
	it('keeps the N newest by createdAt and prunes the rest', () => {
		const dirs = [d('old', 1), d('mid', 2), d('new', 3)];
		expect(selectBatchDirsToPrune(dirs, 2).sort()).toEqual(['old']);
	});

	it('prunes nothing when at or under the keep limit', () => {
		expect(selectBatchDirsToPrune([d('a', 1), d('b', 2)], 7)).toEqual([]);
	});

	it('always prunes dirs with no parseable createdAt, even under the limit', () => {
		const dirs = [d('good', 5), d('garbage', null)];
		expect(selectBatchDirsToPrune(dirs, 7)).toEqual(['garbage']);
	});

	it('handles ties deterministically (keeps first-listed among equals)', () => {
		const dirs = [d('a', 1), d('b', 1), d('c', 2)];
		const pruned = selectBatchDirsToPrune(dirs, 2);
		expect(pruned).toHaveLength(1);
		expect(['a', 'b']).toContain(pruned[0]);
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run --config vitest.config.unit.ts scripts/prune-helpers.test.ts`
Expected: FAIL — `Cannot find module './prune-helpers'`
(주의: `vitest.config.unit.ts`의 include가 `scripts/`를 포함하는지 먼저 확인 — `generate-ko-locale.test.ts`가 이미 돌고 있으면 포함된 것)

- [ ] **Step 3: 구현** — `scripts/prune-helpers.ts`

```ts
export interface BatchDirInfo {
	name: string;
	newestCreatedAt: number | null;
}

/**
 * Returns batch dir names to delete: dirs with no parseable createdAt are
 * always pruned; of the rest, the `keep` newest (by createdAt) survive.
 */
export function selectBatchDirsToPrune(dirs: BatchDirInfo[], keep: number): string[] {
	const dated = dirs
		.filter((dir) => dir.newestCreatedAt !== null)
		.sort((a, b) => (b.newestCreatedAt as number) - (a.newestCreatedAt as number));
	const keepSet = new Set(dated.slice(0, keep).map((dir) => dir.name));
	return dirs.filter((dir) => !keepSet.has(dir.name)).map((dir) => dir.name);
}
```

`scripts/prune-translations.ts`:

```ts
// Prunes old batch sidecar dirs so the repo (and the Vercel server bundle)
// stays small. Keeps the KEEP newest batches by the max createdAt found in
// each dir's JSON files — git checkouts reset mtimes, so file times are
// useless here.
import fs from 'node:fs';
import path from 'node:path';
import { selectBatchDirsToPrune } from './prune-helpers';
import type { BatchDirInfo } from './prune-helpers';

const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR ?? './data/translations';
const KEEP = 7;

function newestCreatedAt(batchDir: string): number | null {
	let newest: number | null = null;
	for (const name of fs.readdirSync(batchDir)) {
		if (!name.endsWith('.json') || name.includes('.tmp.')) continue;
		try {
			const raw = JSON.parse(fs.readFileSync(path.join(batchDir, name), 'utf-8')) as {
				createdAt?: string;
			};
			const ts = raw.createdAt ? Date.parse(raw.createdAt) : Number.NaN;
			if (!Number.isNaN(ts) && (newest === null || ts > newest)) newest = ts;
		} catch {
			// unparseable file — ignore; dir may still be dated by its siblings
		}
	}
	return newest;
}

function main(): void {
	if (!fs.existsSync(TRANSLATIONS_DIR)) {
		console.log(`[prune-translations] ${TRANSLATIONS_DIR} missing — nothing to prune`);
		return;
	}
	const dirs: BatchDirInfo[] = fs
		.readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			newestCreatedAt: newestCreatedAt(path.join(TRANSLATIONS_DIR, entry.name)),
		}));
	const doomed = selectBatchDirsToPrune(dirs, KEEP);
	for (const name of doomed) {
		fs.rmSync(path.join(TRANSLATIONS_DIR, name), { recursive: true, force: true });
		console.log(`[prune-translations] removed ${name}`);
	}
	console.log(`[prune-translations] kept ${dirs.length - doomed.length}, removed ${doomed.length}`);
}

main();
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run --config vitest.config.unit.ts scripts/prune-helpers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 스크립트 스모크 실행 (빈 dir에서 no-op)**

Run: `bun scripts/prune-translations.ts`
Expected: `kept 0, removed 0` (data/translations에 배치 dir이 없을 때)

- [ ] **Step 6: 포맷 + 커밋**

```bash
npx biome check --write scripts/prune-helpers.ts scripts/prune-helpers.test.ts scripts/prune-translations.ts
git add scripts/prune-helpers.ts scripts/prune-helpers.test.ts scripts/prune-translations.ts
git commit -m "feat: prune old translation sidecar batches (keep 7)"
```

---

### Task 5: GitHub Actions 워크플로 + 시크릿 등록

**Files:**
- Create: `.github/workflows/translate.yml`
- Create(로컬 전용, untracked): `.env`

**Interfaces:**
- Consumes: `bun scripts/translate-batch.ts` (exit 0=성공/스킵), `bun scripts/prune-translations.ts`, Task 3의 gitignore 규칙.
- Produces: 매일 14:00/16:00 UTC 자동 실행 + `workflow_dispatch`. 사이드카 변경 시 `chore(translations): ...` 커밋을 실행 브랜치에 push.

- [ ] **Step 1: 워크플로 작성** — `.github/workflows/translate.yml`

```yaml
name: Translate daily batch

on:
  schedule:
    # Batch publishes 12:00 UTC; main run 14:00, catch-up 16:00 (spec §4.3).
    # NOTE: schedule only fires on the default branch (after merge to main).
    - cron: '0 14 * * *'
    - cron: '0 16 * * *'
  workflow_dispatch:

concurrency:
  group: translate
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  translate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Translate latest batch
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          TRANSLATIONS_DIR: ./data/translations
        run: bun scripts/translate-batch.ts

      - name: Prune batches older than the newest 7
        run: bun scripts/prune-translations.ts

      - name: Commit and push sidecars
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/translations
          if git diff --cached --quiet; then
            echo "No sidecar changes to commit"
          else
            git commit -m "chore(translations): daily sidecars $(date -u +%F)"
            git pull --rebase --autostash origin "${GITHUB_REF_NAME}"
            git push origin "HEAD:${GITHUB_REF_NAME}"
          fi
```

- [ ] **Step 2: GitHub Secret + 로컬 `.env` 등록 (키 값 출력 금지)**

사용자 제공 키를 사용:

```bash
gh secret set GEMINI_API_KEY --repo Laeyoung/Ko-KagiNews --body "<사용자 제공 키>"
printf 'GEMINI_API_KEY=%s\n' "<사용자 제공 키>" > .env
git check-ignore .env && echo ENV_IGNORED_OK
```

Expected: 시크릿 등록 성공, `ENV_IGNORED_OK` (커밋 대상 아님 확인)

- [ ] **Step 3: 워크플로 yml 문법 확인**

Run: `bun -e "const y=await Bun.file('.github/workflows/translate.yml').text(); const {load}=await import('js-yaml').catch(()=>({load:null})); if(load){load(y);console.log('YAML_OK')}else{console.log('SKIP: js-yaml 미설치 — actionlint 또는 push 후 확인')}"`
(js-yaml이 없으면 push 후 Actions 탭에서 문법 오류 여부로 확인해도 됨)

- [ ] **Step 4: 커밋**

```bash
git add .github/workflows/translate.yml
git commit -m "feat: daily translation cron via GitHub Actions"
```

---

### Task 6: 로컬 실제 번역 실행 → 사이드카 생성·커밋

**Files:**
- Create(생성물): `data/translations/<batchId>/*.json`

**Interfaces:**
- Consumes: Task 5의 `.env`(GEMINI_API_KEY), `translation.config.json`.
- Produces: 실제 한국어 사이드카가 repo에 커밋된 상태 — Task 7 preview 검증의 데이터.

- [ ] **Step 1: dry-run으로 파이프라인 확인 (Gemini 호출 없음)**

Run: `set -a && source .env && set +a && bun scripts/translate-batch.ts --dry-run`
Expected: exit 0, 처리 예정 배치/카테고리 로그
(참고: `--dry-run` 플래그가 없다면 `grep -n "dry" scripts/translate-batch.ts`로 실제 플래그명 확인; 없으면 이 스텝 생략)

- [ ] **Step 2: 실제 번역 실행**

Run: `set -a && source .env && set +a && bun scripts/translate-batch.ts`
Expected: exit 0, `data/translations/<오늘 batchId>/`에 카테고리별 `.json` + `chaos.json` + `index.json` 생성. 로그의 토큰/비용 요약 확인.

- [ ] **Step 3: 사이드카 내용 검증**

```bash
BATCH_DIR=$(ls -d data/translations/*/ | head -1)
ls "$BATCH_DIR"
node -e "const s=require('./'+process.argv[1]+'/'+require('fs').readdirSync(process.argv[1]).find(f=>f.endsWith('.json')&&f!=='index.json'&&f!=='chaos.json')); const first=Object.values(s.stories)[0]; console.log(JSON.stringify(first).slice(0,200))" "$BATCH_DIR"
```

Expected: 스토리 필드에 한국어 텍스트 확인

- [ ] **Step 4: 커밋**

```bash
git add data/translations
git commit -m "chore(translations): initial sidecars from local run"
git push -u origin claude/kaginews-korean-translation-bdwkbe
```

---

### Task 7: Vercel 프로젝트 생성 + preview 배포 + 임시 URL 검증

**Files:**
- Create(생성물): `.vercel/` (프로젝트 링크 — gitignore에 `.vercel` 추가)

**Interfaces:**
- Consumes: Task 1 어댑터 분기, Task 2 번들 폴백, Task 6 사이드카.
- Produces: preview URL (`https://<deployment>.vercel.app`) — 한국어 오버레이가 동작하는 임시 주소.

- [ ] **Step 1: `.vercel` gitignore 추가 + 프로젝트 링크**

```bash
printf '\n# Vercel project link\n.vercel\n' >> .gitignore
git add .gitignore && git commit -m "chore: ignore .vercel project link"
vercel link --yes --project ko-kaginews
```

Expected: `.vercel/project.json` 생성

- [ ] **Step 2: 환경 변수 설정**

```bash
printf 'true' | vercel env add TRANSLATIONS_ENABLED preview
printf 'true' | vercel env add TRANSLATIONS_ENABLED production
```

- [ ] **Step 3: preview 배포**

Run: `vercel deploy 2>&1 | tail -5`
Expected: `https://ko-kaginews-<hash>-<scope>.vercel.app` 형식의 preview URL 출력, 빌드 성공

- [ ] **Step 4: 임시 URL 검증**

```bash
URL=<preview URL>
# 401이면 Deployment Protection이 켜진 것 — vercel dashboard → Settings → Deployment Protection을 끄거나 bypass secret 사용 후 재시도
curl -s -o /dev/null -w "%{http_code}\n" "$URL/"
# 최신 배치 확인
curl -s "$URL/api/batches/latest?lang=ko" | head -c 300
# Task 6에서 만든 batchId/categoryUuid로 스토리 API 호출 → 한국어 + translationInfo 확인
curl -s "$URL/api/batches/<batchId>/categories/<categoryUuid>/stories?lang=ko" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const s=j.stories[0];console.log('title:',s.title.slice(0,60));console.log('translationInfo:',JSON.stringify(s.translationInfo))})"
# 폴백: lang=en은 영어 원문, 사이드카 없는 과거 배치는 ko여도 영어
curl -s "$URL/api/batches/<batchId>/categories/<categoryUuid>/stories?lang=en" | head -c 200
```

Expected: 200, 스토리 title 한국어, `translationInfo.model` 존재, en은 영어 원문

- [ ] **Step 5: 검증 결과 기록**

성공한 preview URL과 확인 내용을 최종 보고에 포함 (커밋 불필요)

---

### Task 8: `workflow_dispatch`로 Actions E2E 검증

**Files:** 없음 (실행 검증)

**Interfaces:**
- Consumes: Task 5 워크플로 + 시크릿, Task 6에서 push된 브랜치.
- Produces: Actions 러너에서 번역→정리→커밋 전체 경로 성공 확인 (idempotent 스킵도 성공으로 간주).

- [ ] **Step 1: 워크플로 수동 실행**

```bash
gh workflow run translate.yml --repo Laeyoung/Ko-KagiNews --ref claude/kaginews-korean-translation-bdwkbe
sleep 10 && gh run list --workflow=translate.yml --repo Laeyoung/Ko-KagiNews --limit 1
```

- [ ] **Step 2: 완료 대기 + 로그 확인**

```bash
gh run watch --repo Laeyoung/Ko-KagiNews <run-id> --exit-status
gh run view --repo Laeyoung/Ko-KagiNews <run-id> --log | grep -E "translate-batch|prune|commit|push|skip" | tail -20
```

Expected: exit 0. Task 6에서 이미 오늘 배치를 번역했으므로 **idempotent 스킵("No sidecar changes to commit")이 정상 결과**. 새 사이드카가 생겼다면 `chore(translations):` 커밋이 push되고 Vercel이 새 preview를 만드는 것까지 확인.

- [ ] **Step 3: 브랜치 동기화**

```bash
git pull --rebase origin claude/kaginews-korean-translation-bdwkbe
```

- [ ] **Step 4: 최종 리포트**

preview URL, Actions run URL, 남은 절차(main 머지 후 schedule 활성화, 2일 soak = Task 24 Step 4) 정리해 보고.

---

## Self-Review Notes

- **Spec coverage:** §1 번들 읽기(Task 2) · §2 어댑터(Task 1) · §3 gitignore(Task 3) · §4 워크플로+prune(Tasks 4-5) · §5 시크릿(Task 5 Step 2) · §6 테스트 절차(Tasks 6-8). 에러 처리(§에러)는 기존 스크립트 exit code + Actions 실패 알림으로 충족.
- **Type consistency:** `BatchDirInfo`/`selectBatchDirsToPrune`(Task 4 정의 = Task 5 소비), `readBundledSidecar(batchId, file)`(Task 2 정의·소비), `bundledSidecars` 키 형식 `/data/translations/<batchId>/<file>.json` 일관.
- **주의:** Task 2 Step 1의 fs-우선 테스트는 기존 테스트 파일의 tmp-dir 헬퍼를 읽고 맞춰 쓸 것(파일마다 셋업 패턴이 다를 수 있음). Task 6 Step 1의 `--dry-run` 플래그는 실행 전 존재 확인.
