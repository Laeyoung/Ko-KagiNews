# 모바일 플로팅 "닫기" 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모바일에서 펼쳐진 뉴스 글을 어디서든 한 번의 탭으로 닫고 제목 위치로 부드럽게 스크롤시키는 플로팅 닫기 버튼을 추가한다.

**Architecture:** `StoryCard.svelte`에 모바일 전용 `position:fixed` 원형 닫기 버튼을 추가한다. 여러 글이 동시에 펼쳐져도 버튼이 겹치지 않도록, 모듈 rune 상태(`activeFloatingStoryId`)로 "지금 보고 있는" 카드 하나만 활성으로 두고 그 카드만 버튼을 렌더한다. 활성 판정은 두 개의 IntersectionObserver(뷰포트 세로 중앙선 교차 + 완전 가시)로 하고, 닫기는 기존 `handleStoryClick` 경로를 재사용한다.

**Tech Stack:** SvelteKit, Svelte 5 runes (`$state`/`$derived`/`$effect`/`untrack`/`onDestroy`), Tailwind CSS v4(임의 변형 `max-[768px]:`, 커스텀 z-index 유틸), `@tabler/icons-svelte`, Vitest(jsdom).

**Spec:** `docs/superpowers/specs/2026-07-17-mobile-floating-close-design.md` (8회 리뷰 통과)

## Global Constraints

- **데스크톱 무변경**: 버튼은 `width ≤ 768px`에서만 노출. 앱 기존 기준 `window.innerWidth <= 768`(768 포함)과 정확히 일치시켜야 하며, Tailwind `md:hidden`(≥768) 대신 **`hidden max-[768px]:flex`** 로 구현한다.
- **z-index 토큰**: 커스텀 스케일 사용 — 버튼은 `z-fixed`(=30). (`z-modal`=60, `z-notification`=90)
- **하단 카테고리 바 회피**: `displaySettings.categoryHeaderPosition === "bottom"`(기본값)이면 하단 전폭 바(`z-modal`, `bottom-0`)가 상주하므로 버튼 `bottom` 오프셋을 `calc(5rem+env(safe-area-inset-bottom))`, 그 외(`"top"`)는 `calc(1.5rem+env(safe-area-inset-bottom))`. `CategoryHeaderPosition` 타입은 `'top' | 'bottom'` 둘뿐이다.
- **공유뷰 제외**: `isSharedView`일 때 버튼 미렌더(닫기 비활성 정책 유지).
- **신규 i18n 금지**: aria-label은 기존 패턴 `ss("article.closeStory.aria") || "Close story and return to category list"` 그대로 사용(키는 로케일 JSON에 없어 JS 폴백으로 해석됨 — 의도된 동작).
- **반응성 규칙**: 활성 상태를 **쓰는** `$effect` 안에서는 rune을 `untrack()`로 읽어 무한 루프(`effect_update_depth_exceeded`)를 피하고, 버튼 **표시**는 `$derived`/템플릿에서 반응적으로 읽는다.
- **커밋**: 각 Task 끝에서 커밋. 브랜치가 `main`이면 먼저 피처 브랜치를 판다.

---

## File Structure

- **Create** `src/lib/stores/activeFloatingStory.svelte.ts` — 여러 StoryCard가 공유하는 "활성 플로팅 카드" 단일 진실 원천(모듈 rune + claim/set/release + 인스턴스 id 발급).
- **Create** `src/lib/stores/activeFloatingStory.test.ts` — 위 store 단위 테스트.
- **Create** `src/lib/utils/storyScroll.ts` — `.category-label`을 sticky 헤더 아래로 맞추는 목표 scrollTop 계산 헬퍼(열기/닫기 공용).
- **Create** `src/lib/utils/storyScroll.test.ts` — 위 헬퍼 단위 테스트.
- **Modify** `src/lib/components/story/StoryHeader.svelte` — 제목 토글 버튼에 포커스 조회용 `data-story-title-button` 속성 추가.
- **Modify** `src/lib/components/story/StoryCard.svelte` — 인스턴스 id, 두 Observer/claim/cleanup `$effect`, `onDestroy` 타이머 정리, `handleFloatingClose`, 플로팅 버튼 마크업 추가. 기존 열기 스크롤 `$effect`(165-207)를 공용 헬퍼로 정리.

---

## Task 1: activeFloatingStory 모듈 스토어

한 번에 하나의 카드만 활성이 되도록 하는 공유 상태와 인스턴스 id 발급기를 만든다. 순수 로직이라 TDD로 검증한다.

**Files:**
- Create: `src/lib/stores/activeFloatingStory.svelte.ts`
- Test: `src/lib/stores/activeFloatingStory.test.ts`

**Interfaces:**
- Produces:
  - `nextFloatingStoryId(): string` — 호출마다 유일한 id.
  - `activeFloatingStoryId(): string | null` — 현재 활성 id(반응 읽기).
  - `claimFloatingStoryIfFree(id: string): void` — 활성이 `null`일 때만 `id`로 선점.
  - `setActiveFloatingStory(id: string): void` — 무조건 `id`를 활성으로.
  - `releaseFloatingStory(id: string): void` — 현재 활성이 `id`일 때만 `null`로.

- [ ] **Step 1: Write the failing test**

`src/lib/stores/activeFloatingStory.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
	activeFloatingStoryId,
	claimFloatingStoryIfFree,
	nextFloatingStoryId,
	releaseFloatingStory,
	setActiveFloatingStory,
} from './activeFloatingStory.svelte.js';

beforeEach(() => {
	const cur = activeFloatingStoryId();
	if (cur) releaseFloatingStory(cur);
});

describe('activeFloatingStory store', () => {
	it('nextFloatingStoryId returns unique ids', () => {
		const a = nextFloatingStoryId();
		const b = nextFloatingStoryId();
		expect(a).not.toBe(b);
	});

	it('claimFloatingStoryIfFree only claims when free', () => {
		expect(activeFloatingStoryId()).toBeNull();
		claimFloatingStoryIfFree('a');
		expect(activeFloatingStoryId()).toBe('a');
		claimFloatingStoryIfFree('b'); // occupied → no-op
		expect(activeFloatingStoryId()).toBe('a');
	});

	it('setActiveFloatingStory overrides unconditionally', () => {
		claimFloatingStoryIfFree('a');
		setActiveFloatingStory('b');
		expect(activeFloatingStoryId()).toBe('b');
	});

	it('releaseFloatingStory clears only when id matches', () => {
		setActiveFloatingStory('a');
		releaseFloatingStory('b'); // not active → no-op
		expect(activeFloatingStoryId()).toBe('a');
		releaseFloatingStory('a'); // active → cleared
		expect(activeFloatingStoryId()).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/stores/activeFloatingStory.test.ts`
Expected: FAIL — cannot resolve `./activeFloatingStory.svelte.js` (module not created yet).

- [ ] **Step 3: Write minimal implementation**

`src/lib/stores/activeFloatingStory.svelte.ts`:
```ts
// Single source of truth for which expanded StoryCard currently owns the
// mobile floating close button. At most one card is "active" at a time, so
// only one fixed-position button is ever rendered.

let seq = 0;

/** Unique id per StoryCard instance (SSR-safe monotonic counter). */
export function nextFloatingStoryId(): string {
	seq += 1;
	return `floating-story-${seq}`;
}

const state = $state<{ activeId: string | null }>({ activeId: null });

/** Reactive read for templates/$derived. */
export function activeFloatingStoryId(): string | null {
	return state.activeId;
}

/** Claim active only if currently free (null). First-expand short-content fallback. */
export function claimFloatingStoryIfFree(id: string): void {
	if (state.activeId === null) state.activeId = id;
}

/** Unconditionally become the active card (IntersectionObserver hit). */
export function setActiveFloatingStory(id: string): void {
	state.activeId = id;
}

/** Release active back to null, but only if this id currently holds it. */
export function releaseFloatingStory(id: string): void {
	if (state.activeId === id) state.activeId = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/stores/activeFloatingStory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/activeFloatingStory.svelte.ts src/lib/stores/activeFloatingStory.test.ts
git commit -m "feat(story): add activeFloatingStory shared store"
```

---

## Task 2: computeCategoryScrollTop 헬퍼 + 열기 스크롤 정리

닫을 때(그리고 열 때) `.category-label`을 sticky 헤더 아래로 맞추는 목표 scrollTop을 계산하는 공용 헬퍼를 만들고, 기존 열기 스크롤 `$effect`가 이를 쓰도록 정리한다.

**Files:**
- Create: `src/lib/utils/storyScroll.ts`
- Test: `src/lib/utils/storyScroll.test.ts`
- Modify: `src/lib/components/story/StoryCard.svelte:165-207` (열기 스크롤 `$effect`)

**Interfaces:**
- Produces: `computeCategoryScrollTop(storyElement: HTMLElement): number | null` — `.category-label`이 없으면 `null`, 있으면 0 이상으로 클램프된 목표 scrollTop.
- Consumes (later tasks): Task 4의 `handleFloatingClose`가 이 함수를 호출.

- [ ] **Step 1: Write the failing test**

`src/lib/utils/storyScroll.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'vitest';
import { computeCategoryScrollTop } from './storyScroll.js';

function fakeStory(labelTop: number | null): HTMLElement {
	return {
		querySelector: (sel: string) =>
			sel === '.category-label' && labelTop !== null
				? ({ getBoundingClientRect: () => ({ top: labelTop }) })
				: null,
	} as unknown as HTMLElement;
}

afterEach(() => {
	Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
});

describe('computeCategoryScrollTop', () => {
	it('returns null when there is no .category-label', () => {
		expect(computeCategoryScrollTop(fakeStory(null))).toBeNull();
	});

	it('computes pageYOffset + rect.top - 28 - headerHeight(60) - extraOffset(12)', () => {
		// jsdom: no <header>/<nav> → headerHeight 60; innerWidth 1024 → desktop → extraOffset 12
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 500 });
		// 500 + 300 - 28 - 60 - 12 = 700
		expect(computeCategoryScrollTop(fakeStory(300))).toBe(700);
	});

	it('clamps negative results to 0', () => {
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
		// 0 + 10 - 28 - 60 - 12 = -90 → 0
		expect(computeCategoryScrollTop(fakeStory(10))).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/utils/storyScroll.test.ts`
Expected: FAIL — cannot resolve `./storyScroll.js`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/utils/storyScroll.ts`:
```ts
/**
 * Compute the target window scrollTop that positions a story's `.category-label`
 * just below the sticky header. Returns null if the label is not found.
 * Shared by StoryCard's open auto-scroll and the mobile floating-close scroll.
 */
export function computeCategoryScrollTop(storyElement: HTMLElement): number | null {
	const headerEl = document.querySelector('header') || document.querySelector('nav');
	const headerHeight = headerEl ? (headerEl as HTMLElement).offsetHeight : 60;
	const isMobile = window.innerWidth <= 768;
	const extraOffset = isMobile ? 8 : 12;

	const categoryElement = storyElement.querySelector('.category-label');
	if (!categoryElement) return null;

	const rect = categoryElement.getBoundingClientRect();
	const elementTop = window.pageYOffset + rect.top - 28;
	return Math.max(0, elementTop - headerHeight - extraOffset);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.unit.ts src/lib/utils/storyScroll.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor the open-scroll `$effect` to use the helper**

`src/lib/components/story/StoryCard.svelte` — 먼저 상단 import에 헬퍼를 추가한다(스크립트 상단 import 블록):
```ts
import { computeCategoryScrollTop } from '$lib/utils/storyScroll';
```
그리고 기존 열기 스크롤 `$effect`(현재 165-207) 본문을 아래로 교체한다. `.category-label`이 없으면 예외를 던지던 동작을 조용히 반환으로 바꾸고, 목표 계산은 헬퍼로 위임한다(정위치면 스크롤 생략 가드는 유지):
```ts
// Scroll to story when expanded
$effect(() => {
	if (isExpanded && browser && storyElement && shouldAutoScroll) {
		setTimeout(() => {
			const categoryElement = storyElement.querySelector('.category-label');
			if (!categoryElement) return;

			const headerEl = document.querySelector('header') || document.querySelector('nav');
			const headerHeight = headerEl ? (headerEl as HTMLElement).offsetHeight : 60;
			const isMobile = window.innerWidth <= 768;
			const extraOffset = isMobile ? 8 : 12;

			// Skip if the category is already correctly positioned below the header.
			const rect = categoryElement.getBoundingClientRect();
			const requiredMargin = headerHeight + extraOffset;
			const isProperlyVisible = rect.top >= requiredMargin && rect.top <= requiredMargin + 20;
			if (isProperlyVisible) return;

			const target = computeCategoryScrollTop(storyElement);
			if (target !== null) {
				window.scrollTo({ top: target, behavior: 'smooth' });
			}
		}, 150);
	}
});
```

- [ ] **Step 6: Verify types + lint**

Run: `npm run check && npm run lint`
Expected: no new errors introduced by the changed effect/import.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/storyScroll.ts src/lib/utils/storyScroll.test.ts src/lib/components/story/StoryCard.svelte
git commit -m "feat(story): extract computeCategoryScrollTop and reuse in open-scroll"
```

---

## Task 3: StoryHeader 제목 버튼에 포커스 훅 추가

`handleFloatingClose`가 닫은 뒤 포커스를 옮길 대상(제목 토글 버튼)을 안정적으로 조회하도록 데이터 속성을 붙인다.

**Files:**
- Modify: `src/lib/components/story/StoryHeader.svelte` (제목 버튼, 현재 약 393-404행)

**Interfaces:**
- Produces: DOM 셀렉터 `[data-story-title-button]` — Task 4가 `storyElement.querySelector('[data-story-title-button]')`로 사용.

- [ ] **Step 1: 제목 버튼에 속성 추가**

`src/lib/components/story/StoryHeader.svelte`에서 제목 토글 `<button>`(현재 `onclick={onTitleClick}` 가 달린 버튼)의 여는 태그에 `data-story-title-button` 속성을 추가한다:
```svelte
<button
  data-story-title-button
  class="dark:text-dark-text mb-2 flex cursor-pointer items-center text-xl text-gray-800 text-start w-full bg-transparent border-none p-0 focus-visible-ring rounded"
  class:font-semibold={!isRead}
  onclick={onTitleClick}
  aria-label="Expand story"
  aria-expanded="false"
>
```

- [ ] **Step 2: Verify types**

Run: `npm run check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/story/StoryHeader.svelte
git commit -m "feat(story): mark story title button for focus targeting"
```

---

## Task 4: StoryCard에 플로팅 닫기 버튼 통합

인스턴스 id, 두 Observer/claim/cleanup `$effect`, 언마운트 타이머 정리, `handleFloatingClose`, 버튼 마크업을 추가한다. IntersectionObserver 기반 시각 동작은 jsdom에서 콜백이 발화하지 않으므로(단위 테스트 불가), 타입/린트/빌드 + 수동 브라우저 검증으로 확인한다.

**Files:**
- Modify: `src/lib/components/story/StoryCard.svelte`

**Interfaces:**
- Consumes: `activeFloatingStoryId` / `claimFloatingStoryIfFree` / `setActiveFloatingStory` / `releaseFloatingStory` / `nextFloatingStoryId` (Task 1), `computeCategoryScrollTop` (Task 2), `[data-story-title-button]` (Task 3), 기존 `handleStoryClick`/`storyElement`/`ss`.

- [ ] **Step 1: import 추가**

`src/lib/components/story/StoryCard.svelte` 스크립트 상단 import 블록에 추가한다(Task 2에서 `computeCategoryScrollTop`는 이미 추가됨):
```ts
import { onDestroy, untrack } from 'svelte';
import { IconX } from '@tabler/icons-svelte';
import { displaySettings } from '$lib/data/settings.svelte';
import {
	activeFloatingStoryId,
	claimFloatingStoryIfFree,
	nextFloatingStoryId,
	releaseFloatingStory,
	setActiveFloatingStory,
} from '$lib/stores/activeFloatingStory.svelte';
```

- [ ] **Step 2: 인스턴스 상태 + 표시 파생 추가**

`storyElement` 선언(현재 65행 부근) 아래에 추가한다:
```ts
// Mobile floating close button — unique per instance so duplicate titles never collide.
const floatingId = nextFloatingStoryId();
let closeScrollTimer: ReturnType<typeof setTimeout> | undefined;

// Reactive: does this card currently own the (single) floating close button?
const showFloatingClose = $derived(
	isExpanded &&
		!isBlurred &&
		!isSharedView &&
		!showSourceOverlay &&
		activeFloatingStoryId() === floatingId,
);
```

- [ ] **Step 3: 두 Observer + claim + cleanup `$effect` 추가**

기존 열기 스크롤 `$effect` 아래에 추가한다:
```ts
// Decide which expanded card owns the floating close button.
$effect(() => {
	if (!isExpanded || !browser || !storyElement) return;

	// First-expand fallback: take over only if no card is active yet.
	untrack(() => claimFloatingStoryIfFree(floatingId));

	const el = storyElement;

	// 1) Centerline crossing (works regardless of article height).
	const centerObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) setActiveFloatingStory(floatingId);
			}
		},
		{ root: null, rootMargin: '-50% 0px -50% 0px', threshold: 0 },
	);

	// 2) Full visibility (short-content handoff when another long card is active).
	const fullObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.intersectionRatio >= 1) setActiveFloatingStory(floatingId);
			}
		},
		{ root: null, threshold: [0, 1] },
	);

	centerObserver.observe(el);
	fullObserver.observe(el);

	return () => {
		centerObserver.disconnect();
		fullObserver.disconnect();
		// Release only if we still hold it (untracked so this effect never depends on the rune).
		untrack(() => releaseFloatingStory(floatingId));
	};
});

// Unmount-only cleanup for the delayed close-scroll timer.
// NOTE: do NOT clear this timer in the effect cleanup above — closing flips
// isExpanded, which runs that cleanup and would cancel the close's own scroll.
onDestroy(() => {
	if (closeScrollTimer) clearTimeout(closeScrollTimer);
});
```

- [ ] **Step 4: `handleFloatingClose` 추가**

기존 `handleStoryClick` 함수(현재 127-156행) 아래에 추가한다:
```ts
// Mobile floating close: close from anywhere, then scroll back to the story header.
function handleFloatingClose() {
	// Compute the scroll target BEFORE collapsing, while .category-label is still in place.
	const target = browser ? computeCategoryScrollTop(storyElement) : null;

	// Reuse the existing close path (TTS/simplification/flashcards cleanup + toggle + URL).
	handleStoryClick();

	// Keep keyboard focus on the story's title toggle (the floating button unmounts on close).
	// preventScroll avoids a native focus jump fighting the smooth scroll below.
	storyElement
		?.querySelector<HTMLElement>('[data-story-title-button]')
		?.focus({ preventScroll: true });

	// After layout settles, smooth-scroll to the closed story's header.
	if (closeScrollTimer) clearTimeout(closeScrollTimer);
	closeScrollTimer = setTimeout(() => {
		closeScrollTimer = undefined;
		// Skip if another story became active meanwhile (user opened something else):
		// closing released our id → active is null unless a new card claimed it.
		if (target !== null && activeFloatingStoryId() === null) {
			window.scrollTo({ top: target, behavior: 'smooth' });
		}
	}, 150);
}
```

- [ ] **Step 5: 버튼 마크업 추가**

`<article>` 내부, blurrable content `<div>`가 닫힌 직후(현재 293행 `</div>` 다음, blur 경고 오버레이 `{#if isBlurred ...}` 앞)에 추가한다. `position:fixed`라 DOM 위치는 무관하다:
```svelte
  {#if showFloatingClose}
    <button
      type="button"
      onclick={handleFloatingClose}
      aria-label={ss("article.closeStory.aria") || "Close story and return to category list"}
      class="hidden max-[768px]:flex fixed left-1/2 -translate-x-1/2 z-fixed size-12 items-center justify-center rounded-full bg-black text-white shadow-lg transition-colors duration-200 hover:bg-gray-800 focus-visible-ring {displaySettings.categoryHeaderPosition === 'bottom' ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(1.5rem+env(safe-area-inset-bottom))]'}"
    >
      <IconX class="size-6" aria-hidden="true" />
    </button>
  {/if}
```

- [ ] **Step 6: Verify types + lint**

Run: `npm run check && npm run lint`
Expected: PASS, no new errors/warnings from StoryCard.

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: build succeeds (adapter-node → ./build).

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/story/StoryCard.svelte
git commit -m "feat(story): add mobile floating close button"
```

---

## Task 5: 수동 검증 (모바일 동작)

IntersectionObserver/스크롤/고정 위치 동작은 실제 뷰포트에서만 확인 가능하다. 프리뷰 서버를 띄우고 모바일 폭(≤768px, 예: DevTools iPhone/iPad 프리셋)에서 확인한다.

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: 프리뷰 실행**

Run: `npm run build && npm run preview`
브라우저에서 `/` 접속 → DevTools device toolbar로 모바일 폭(≤768px) 설정.

- [ ] **Step 2: 체크리스트 확인 (스펙 §검증)**

- [ ] 긴 글 펼침 → 중간까지 스크롤 → 우측 하단이 아닌 **하단 중앙** 플로팅 ✕ 버튼 탭 → 글이 접히고 제목 위치로 부드럽게 스크롤.
- [ ] **짧은 글**(화면 절반 미만) 펼침 시 스크롤 없이도 버튼 노출.
- [ ] 데스크톱 폭(≥769px)에서 버튼이 **전혀 안 보이고** 기존 동작 그대로. 정확히 768px에서는 보임.
- [ ] 여러 글 펼침(카테고리 헤더 더블클릭 등 expand-all): 스크롤하며 읽는 글이 바뀌면 버튼이 **하나만**, 현재 글 것으로. 카드 사이 간격에서도 안 사라짐.
- [ ] 긴 글 A 활성 상태에서 짧은 글 B로 스크롤해 들어가면 버튼이 B로 넘어감.
- [ ] 기본 설정(하단 카테고리 바)에서 버튼이 바 **위로 떠서 안 가려짐**. 설정을 "top"으로 바꿔도 자연스러움.
- [ ] 활성 카드를 **제목 재탭 / 펼친 본문 맨 아래 "닫기" 버튼**으로 닫으면, 남은 다른 펼침 카드로 플로팅 버튼이 넘어감.
- [ ] 활성 카드를 **접지 않고 언마운트**(카테고리 전환 / 새로고침·리로드)한 뒤에도, 다른 펼침 카드나 재펼침에서 버튼이 정상 표시(댕글링 id 없음).
- [ ] **공유뷰**(isSharedView)에서는 버튼이 아예 안 뜸.
- [ ] 소스 오버레이 열면 버튼 숨고, 닫으면 다시 뜸.
- [ ] 콘텐츠 필터로 펼친 글이 블러되면 버튼이 사라지고 오작동 없음.
- [ ] 닫은 직후 빠르게 다른 글을 펼치면 화면이 이전 앵커로 튀지 않음.
- [ ] 키보드로 플로팅 버튼 포커스 후 Enter로 닫으면 포커스가 제목 토글로 이동(스크롤 점프 없이).

- [ ] **Step 3: 회귀 확인**

Run: `npm run test:unit`
Expected: 신규 테스트 포함 전체 통과.

- [ ] **Step 4: (문제 없으면) 완료**

수동 체크에서 발견된 문제는 해당 Task로 돌아가 수정 후 재검증한다.

---

## Self-Review Notes

- **Spec coverage**: 렌더 조건(Task 4 `showFloatingClose`), 두 Observer 활성 판정(Task 4), 히스테리시스/완전가시/널 폴백(Task 1 helpers + Task 4 effect), 인스턴스 id 충돌 방지(Task 1), 반응성 루프 회피(Task 4 `untrack`), 탭 동작 닫기+`preventScroll` 포커스+취소 가능 지연 스크롤(Task 4), 하단 바 오프셋/z-index/`max-[768px]`(Task 4 마크업 + Global Constraints), 언마운트 정리(Task 4 `onDestroy` + effect cleanup), 로케일 폴백(Task 4 마크업) — 모두 태스크로 매핑됨.
- **타이머-클린업 상호작용(스펙 대비 정밀화)**: 닫기가 `isExpanded`를 false로 만들어 Observer `$effect` cleanup을 유발하므로, 지연 스크롤 타이머를 그 cleanup에서 지우면 닫기 자신의 스크롤이 취소된다. 그래서 타이머 취소는 (a) `onDestroy`(언마운트)와 (b) `handleFloatingClose` 진입 시 재설정으로 처리하고, "다른 글을 펼침" 취소는 타이머 콜백의 `activeFloatingStoryId() === null` 가드로 달성한다.
- **테스트 한계**: jsdom의 IntersectionObserver는 no-op(콜백 미발화)이라 Observer 시각 동작은 단위 테스트 불가 → Task 5 수동 검증으로 커버. 순수 로직(store, 스크롤 계산)은 Task 1·2에서 TDD.
