# 모바일 플로팅 "닫기" 버튼 — Design Spec

날짜: 2026-07-17
대상: `Laeyoung/Ko-KagiNews` (kite.kagi.com 프론트엔드 포크)

## 문제 (Problem)

모바일에서 사용자가 글을 탭해 펼치고 본문을 읽다가, 중간에 그 글을 닫고 다른 글을 읽으려면 방법이 두 가지뿐이다:

1. 펼쳐진 본문을 **끝까지 스크롤**해서 맨 아래 "닫기" 버튼을 누르거나
2. 화면을 **위로 스크롤**해 제목을 다시 탭하거나

둘 다 화면 이동을 강제하므로 긴 글일수록 불편하다. 또한 현재는 **닫을 때 스크롤 보정이 전혀 없어서**, 본문 중간에서 닫으면 콘텐츠가 사라지며 화면이 엉뚱한 위치로 튀는 문제도 있다.

데스크톱은 개선 대상이 아니다. 모바일에서만 개선한다.

## 목표 (Goals)

- 모바일에서 글을 읽는 도중 **어디서든 한 번의 탭으로** 현재 글을 닫을 수 있게 한다.
- 닫은 뒤 방금 읽던 글의 **제목 위치로 부드럽게 스크롤**해, 목록 내 위치를 잃지 않고 다음 글로 이어 읽을 수 있게 한다.
- 데스크톱 UI/동작은 **전혀 변경하지 않는다.**

## 비목표 (Non-Goals)

- 제목 sticky 고정, 스와이프 제스처 등 다른 닫기 방식은 도입하지 않는다.
- 여러 글이 동시에 펼쳐지는 정책(single/multiple open mode) 자체는 변경하지 않는다.
- 기존 하단 "닫기" 버튼(펼친 본문 맨 아래)은 **그대로 유지**한다 (데스크톱/공유뷰 포함). 플로팅 버튼은 모바일 전용 추가 요소다.

## 설계 (Design)

### 개요

`StoryCard.svelte`에, 글이 펼쳐졌을 때만 렌더되는 **모바일 전용 플로팅 닫기 버튼**을 추가한다. `position: fixed`로 화면 **하단 중앙**에 고정되며(하단 카테고리 바를 피하도록 오프셋을 준다 — §시각 디자인 참조), 탭하면 기존 닫기 경로(`handleStoryClick`)를 그대로 호출한 뒤 해당 글의 제목 위치로 스크롤한다.

여러 글이 동시에 펼쳐진 경우 플로팅 버튼이 겹치지 않도록, **화면 중앙에 걸쳐 있는(=지금 읽고 있는) 글의 버튼 하나만** 표시한다.

### 렌더 조건

플로팅 버튼은 다음을 모두 만족할 때만 DOM에 존재/표시된다:

- `isExpanded === true`
- `!isBlurred` (블러 오버레이가 떠 있으면 미표시 — 아래 "블러 재동기화" 참조)
- `!isSharedView` (공유뷰에서는 닫기 자체가 비활성)
- `!showSourceOverlay` (소스 오버레이가 떠 있는 동안은 숨김)
- 모바일 뷰포트 — 앱의 기존 모바일 기준 `window.innerWidth <= 768`(768 포함)과 **정확히** 일치시킨다. Tailwind `md:hidden`은 `min-width:768px`(즉 ≥768) 기준이라 **정확히 768px에서 어긋난다**(md:hidden은 768을 데스크톱으로 취급 → iPad 세로 등 768px 기기에서 버튼이 안 뜸). 따라서 `md:hidden` 대신 **`max-[768px]` 미디어쿼리로 표시**한다: 기본 `hidden` + `max-[768px]:flex`(또는 `:block`) → `width ≤ 768`에서만 노출. (스크롤 오프셋 계산의 기존 `isMobile = innerWidth <= 768`과 경계가 일치.)
- 이 카드가 **현재 활성(active) 펼침 카드일 때** (아래 "활성 카드 선택" 참조)

### 활성 카드 선택 (겹침 방지 + 짧은 본문 대응)

플로팅 버튼은 `position: fixed`이므로 여러 카드가 동시에 렌더하면 겹친다. 이를 막기 위해 **동시에 딱 하나의 카드만** "활성"으로 두고, 그 카드만 버튼을 그린다.

- **단일 진실 원천**: 작은 모듈 상태 파일 `src/lib/stores/activeFloatingStory.svelte.ts`에 `activeFloatingStoryId: string | null` rune을 둔다. 버튼은 `activeFloatingStoryId === thisInstanceId`일 때만 렌더한다 → 구조적으로 항상 최대 1개.
- **인스턴스 고유 id (충돌 방지)**: 활성 키로 story 데이터(`story.id`/`cluster_number`/`title`)를 쓰지 않는다. 그 폴백 체인은 `cluster_number`가 없으면 `title`로 떨어져, expand-all에서 제목이 같은 두 카드가 동시에 활성 조건을 만족할 수 있다. 대신 **각 StoryCard 인스턴스가 초기화 시 1회 생성하는 고유 id**(모듈 스코프 증가 카운터 또는 `crypto.randomUUID()`)를 `thisInstanceId`로 쓴다. 마운트된 인스턴스마다 유일하므로 절대 겹치지 않는다.
- **활성 판정 (두 개의 IntersectionObserver)**: 각 펼쳐진 카드가 자신의 **article 루트(`storyElement`, `#story-{cluster_number}`)** 를 아래 두 Observer로 관찰하고, 둘 중 하나라도 활성 조건을 만족하면 `activeFloatingStoryId = thisInstanceId`로 **설정(set)만** 한다. (둘 다 "사용자가 지금 이 카드를 보고 있다"는 신호.) 두 조건은 기하가 달라 **단일 Observer로는 안 되고**(아래 주의), 서로 다른 옵션의 Observer가 각각 필요하다.
  1. **중앙선 교차** — `{ root: null, rootMargin: '-50% 0px -50% 0px', threshold: 0 }`. 뷰포트를 세로 중앙의 **한 줄로 접은** root이므로, article이 이 줄에 걸치기 시작/끝나는 순간(`entry.isIntersecting` 토글)이 곧 중앙선 교차다. `isIntersecting === true`가 되면 claim. **article 높이와 무관하게** 동작한다(긴 본문의 일반적 경우).
  2. **완전 가시(짧은 본문 핸드오프)** — `{ root: null, threshold: [0, 1] }`(rootMargin 없음). `entry.intersectionRatio >= 1`(= article 전체가 뷰포트 안)일 때 claim. 화면 절반보다 짧아 중앙선을 절대 못 지나는 카드도 이 조건으로 활성을 가져온다. (article이 뷰포트보다 크면 ratio가 1에 도달하지 않아 발화하지 않지만, 그 경우는 Observer 1이 담당하므로 문제없다.)
  - **주의(단일 Observer 금지)**: `threshold: [0,1]`만으로 중앙선 교차를 감지하려 하면, **뷰포트보다 큰 긴 article은 본문 중간을 스크롤하는 동안 `intersectionRatio`가 `뷰포트높이/article높이`로 고정**돼 어떤 threshold도 넘지 않아 콜백이 발화하지 않는다. 그러면 긴 글 사이에서 활성이 넘어가지 않는다. 그래서 중앙선 교차는 반드시 `-50%` rootMargin(1번)으로 감지한다.
- **히스테리시스**: 두 조건이 모두 거짓이 될 때(스크롤로 벗어남)는 값을 **지우지 않는다**. 다른 카드가 새로 set 할 때까지 마지막 활성 카드가 유지된다 → 펼쳐진 카드들 사이 간격을 스크롤하는 순간에도 버튼이 사라지지 않는다.
- **짧은 본문 폴백(첫 펼침)**: 펼친 카드가 **처음부터** 화면 절반보다 짧고 스크롤도 필요 없는 경우, 위 "완전 가시" 조건이 곧 발화하지만, 확실히 하기 위해 카드가 펼쳐질 때 **`activeFloatingStoryId`가 `null`이면 `thisInstanceId`로 즉시 선점(claim)** 한다. 다른 카드가 이미 활성인 다중 펼침에서의 짧은-본문 핸드오프는 위 "완전 가시" 조건이 담당한다(널 폴백은 그 경우 발화하지 않아 A에 고정되던 문제를 완전 가시가 해소).
- **정리(collapse/unmount)**: 카드가 접히거나(`isExpanded`→false) 언마운트될 때, `activeFloatingStoryId === thisInstanceId`이면 `activeFloatingStoryId = null`로 되돌린다(자신이 활성이었을 때만). 컴포넌트 언마운트 시에도 반드시 수행해, 언마운트된 인스턴스 id를 가리키는 **댕글링 활성 id로 버튼이 영영 안 뜨는 상태**를 막는다. 다른 펼쳐진 카드가 있으면 다음 Observer 발화(또는 그 카드의 폴백 선점)가 곧 다시 채운다.
- **두 Observer** 모두 `isExpanded && browser`일 때 생성하고, 접히거나 컴포넌트가 정리될 때 각각 `disconnect()`한다 (`$effect`의 cleanup 반환 사용). 모듈 상태 정리와 지연 스크롤 타이머 취소(§탭 동작 4단계)도 같은 cleanup에서 수행한다.
- **반응성 루프 회피 (필수)**: claim/observer/cleanup을 담당하는 `$effect`는 `activeFloatingStoryId`를 **추적 의존성으로 읽어선 안 된다**. 이 effect가 rune을 읽고(claim 판정) 동시에 rune에 쓰면(claim/clear), 쓰기가 effect를 재실행시키고 → 재실행 전 cleanup이 `=== thisInstanceId`를 보고 다시 `null`로 지웠다가 → 다시 `null`을 읽어 재선점하는 무한 루프(`effect_update_depth_exceeded`)가 된다. 따라서 effect 내부의 claim 판정 읽기와 cleanup의 비교 읽기는 **`untrack()`**(또는 비반응 헬퍼)로 감싸 rune을 의존성에서 제외한다. effect는 `isExpanded`/`storyElement`에만 의존하게 한다.
- **버튼 표시용 반응 읽기**: 반대로 버튼 렌더 조건(`activeFloatingStoryId === thisInstanceId`)은 템플릿/`$derived`에서 **반응적으로** 읽어야 다른 카드가 활성을 가져갈 때 이 버튼이 즉시 사라진다. 즉 "쓰는 effect 안에서는 untrack, 보여주는 파생/템플릿에서는 반응 읽기"로 역할을 분리한다.
- single-open 모드에서는 펼쳐진 카드가 하나뿐이라 폴백 선점만으로 항상 그 카드가 활성이 된다. expand-all(다중 펼침)에서도 중앙선 규칙 + 히스테리시스로 "지금 보고 있는" 카드가 활성이 된다.

### 탭 동작 (닫기 + 스크롤)

플로팅 버튼 `onclick` 핸들러(`handleFloatingClose`)는:

1. 스크롤 목표 지점을 **먼저 계산해 둔다** (닫기 전에, 아직 `.category-label`이 원래 위치에 있을 때):
   - 앵커: 이 카드 루트(`storyElement`, `#story-{cluster_number}`) 내부의 `.category-label`.
   - 목표 top = `.category-label`의 절대 위치 − (sticky 헤더 높이 + 오프셋).
   - 계산식은 기존 열기 스크롤 `$effect`(StoryCard.svelte:165-207)의 로직을 그대로 재사용한다 (헤더 높이 동적 측정, 모바일 오프셋 8px).
2. `handleStoryClick()`을 호출한다 → 기존 닫기 경로. TTS 정지, simplification/flashcards reset, `onToggle()`(맵에서 제거 + URL 갱신)까지 전부 재사용된다. (버튼은 `!isBlurred`일 때만 보이므로 `handleStoryClick` 내부의 블러 해제 분기로 새지 않고 항상 닫기 분기로 들어간다.)
3. **포커스 이동**: 버튼은 `{#if}`로 즉시 언마운트되므로, 닫기 직후 포커스가 `<body>`로 유실되지 않도록 이 카드의 제목 토글 버튼(StoryHeader 내부, `storyElement`에서 조회)으로 포커스를 옮긴다. 반드시 **`.focus({ preventScroll: true })`** 로 호출한다 — 화면 밖으로 스크롤된 제목에 기본 `focus()`를 걸면 브라우저가 sticky 헤더 오프셋을 무시한 채 즉시 스크롤 점프를 일으켜, 4단계의 계산된 부드러운 스크롤과 "점프 후 슬라이드" 이중 이동을 만든다.
4. 콘텐츠가 접힌 뒤 레이아웃이 안정되도록 짧은 지연(기존 열기 로직과 동일한 `setTimeout(..., 150)`) 후 `window.scrollTo({ top, behavior: 'smooth' })`로 이동한다.
   - 접히면 `.category-label`은 헤더에 그대로 남아 있으므로(헤더는 항상 렌더), 미리 계산한 목표값으로 안정적으로 스크롤된다.
   - **타이머 취소**: 이 `setTimeout` 핸들을 저장해 두고 `clearTimeout`으로 취소한다 — (a) 그 사이 사용자가 다른 글을 다시 펼치거나 상태가 바뀔 때, **그리고 (b) 이 `StoryCard` 인스턴스가 언마운트될 때**(카테고리 전환/배치·데이터 리로드/목록 가상화). 컴포넌트 정리 cleanup(§활성 카드 선택의 Observer/모듈 상태 정리와 동일한 cleanup)에서 반드시 함께 취소한다. 취소하지 않으면, 닫은 직후 빠르게 다른 글을 펼치거나 페이지를 벗어났을 때 지연된 스크롤이 뒤늦게 실행돼 이전 앵커로 화면이 튄다.

> 참고: 기존 하단 "닫기" 버튼(`StoryActions`)은 이번 스코프에서 스크롤 보정을 추가하지 않는다(현행 유지). 플로팅 버튼이 모바일의 주 경로가 된다. 필요하면 후속 작업으로 통합 가능.

### 시각 디자인

- **위치**: `fixed`, **하단 중앙** (`left-1/2 -translate-x-1/2`). 하단 `bottom` 오프셋은 **모바일 카테고리 바를 반드시 피해야 한다** — 기본 설정 `categoryHeaderPosition: "bottom"`(`src/lib/data/settings.svelte.ts:79-84`, 권위 있는 설정 소스)에서 `CategoryNavigation`이 `fixed z-modal(60) bottom-0` 전폭 바로 하단에 상주하기 때문이다(`CategoryNavigation.svelte:304-316`). `BackToTop.svelte:73-84`가 이미 이 바를 피하려고 오프셋을 특수 처리하므로 **같은 패턴을 그대로 따른다**:
  - `categoryHeaderPosition === "bottom"` → `bottom-[calc(5rem+env(safe-area-inset-bottom))]`
  - 그 외(`else`, 즉 `"top"`) → `bottom-[calc(1.5rem+env(safe-area-inset-bottom))]`
  - `CategoryHeaderPosition` 타입은 `'top' | 'bottom'` 둘뿐이다(`src/lib/data/settings.svelte.ts:42`). `"integrated"`는 이 설정값이 아니라 `CategoryNavigation`의 파생 `mobilePosition` 레이아웃 모드이므로 여기서 분기 대상이 아니다. BackToTop도 `"bottom"` vs `else`로만 분기한다.
  - (구현 시 `displaySettings.categoryHeaderPosition` 값으로 분기. 값 미확정 시 안전하게 큰 오프셋(5rem)을 기본으로.)
- **형태**: **원형 아이콘 버튼(FAB)**. `✕` 아이콘. 시각 라벨 텍스트는 없고 `aria-label`로만 제공한다.
- **접근성 라벨**: 기존 `StoryActions.svelte:81`과 동일한 패턴 `storyLocalizer("article.closeStory.aria") || "Close story and return to category list"`를 사용한다. (해당 키는 로케일 JSON에 없어 실제로는 JS 폴백 문자열로 해석됨 — "영향 파일" 참조. 신규 i18n 없이 기존 코드와 동일하게 동작.)
- **z-index**: `z-fixed`(=30). 본문 콘텐츠 위, 토스트(`z-notification`=90)·모달류·하단 카테고리 바(`z-modal`=60) 아래. 하단 바와는 위 오프셋으로 **공간이 분리**되므로 z가 낮아도 겹치지 않는다(BackToTop도 동일하게 바보다 낮은 z를 쓰되 위로 띄워 회피). 소스 오버레이는 z 경쟁 대신 **표시 조건(`!showSourceOverlay`)으로 아예 숨긴다.**
- **Toast 겹침**: 공유/신고 토스트(`z-notification`=90)는 더 높은 z에서 수 초간 떴다 사라진다. 잠시 버튼을 덮는 것은 허용한다(기능 영향 없음). BackToTop처럼 토스트 유무로 오프셋을 더 키우는 처리는 이번 스코프에서 생략한다.
- 다크모드 대응 (기존 버튼들과 동일한 톤).
- 등장/퇴장에 가벼운 fade/scale 트랜지션(선택).

## 영향 파일 (Affected Files)

- `src/lib/components/story/StoryCard.svelte` — 플로팅 버튼 마크업(하단 중앙, `categoryHeaderPosition` 기반 오프셋) + 인스턴스 고유 id 생성 + `IntersectionObserver`/claim/cleanup `$effect`(rune 읽기는 `untrack()`로 감싸 반응성 루프 회피) + `handleFloatingClose`(닫기+`preventScroll` 포커스+취소 가능한 지연 스크롤) 추가. 버튼 표시 조건은 `$derived`/템플릿에서 반응적으로 읽는다. (기존 `handleStoryClick`, 열기 스크롤 로직 재사용. `displaySettings.categoryHeaderPosition` 참조.)
- `src/lib/stores/activeFloatingStory.svelte.ts` (신규) — `activeFloatingStoryId: string | null` 모듈 rune 상태 + set/claim(null일 때만)/clear(자신이 활성일 때만) 헬퍼. 여러 카드가 공유하는 단일 진실 원천.
- (선택) 스크롤 계산이 길어지면 작은 헬퍼로 추출해 열기/닫기 양쪽에서 공유. 과도한 리팩터링은 지양.

**로케일**: 신규 i18n 키는 추가하지 않는다. `article.closeStory.aria`는 로케일 JSON에 존재하지 않으며(현재 코드도 `StoryActions.svelte:81`에서 이 키를 호출해 JS 폴백 문자열 `"Close story and return to category list"`로 해석됨), 플로팅 버튼도 동일한 `키 호출 || 폴백` 패턴을 그대로 사용한다. 시각 텍스트(`article.closeStory`)는 아이콘 버튼이라 렌더하지 않는다.

## 엣지 케이스 (Edge Cases)

- **공유뷰(`isSharedView`)**: 버튼 미렌더 (닫기 비활성 정책 유지).
- **소스 오버레이 열림(`showSourceOverlay`)**: 표시 조건에서 제외 → 오버레이가 떠 있는 동안 버튼을 **숨긴다** (z 경쟁 없이 확정 규칙). 오버레이가 닫히면 다시 나타난다.
- **블러 재동기화(`isBlurred`)**: `StoryCard.svelte:75-80`의 `$effect`는 매 반응 업데이트마다 `isBlurred = isFilteredProp`로 재동기화하므로, **이미 펼쳐진 글도** 콘텐츠 필터 변화로 다시 블러될 수 있다. 이 상태에서 `handleStoryClick`은 닫기 대신 블러 해제 분기로 빠진다. 따라서 버튼을 `!isBlurred` 조건으로 게이트해, 블러가 걸리면 버튼이 사라지고 오작동하지 않도록 한다.
- **짧은 본문(단독)**: 화면 절반보다 짧아 중앙선을 지나지 않는 글은 펼침 시 널 폴백 + "완전 가시" 조건으로 활성이 되어 버튼을 띄운다(활성 카드 선택 참조).
- **짧은 본문(다중 펼침 핸드오프)**: 긴 글 A가 활성인 상태에서 짧은 글 B를 펼쳐 스크롤해 들어가면, B는 중앙선을 못 지나고 널 폴백도 A 때문에 발화하지 않는다 → **B가 뷰포트에 완전히 들어오는 순간 "완전 가시" 조건으로 활성을 가져와** 버튼이 B로 넘어간다(A에 영구 고정되지 않음).
- **카드 사이 간격 스크롤**: 다중 펼침에서 두 펼쳐진 카드 사이(접힌 카드/여백)를 지날 때 중앙선이 어느 펼침 콘텐츠도 안 지날 수 있다 → 히스테리시스(값을 지우지 않음)로 마지막 활성 버튼이 유지된다.
- **다른 경로로 닫힘**: 제목 재탭 / 하단 "닫기" 버튼으로 활성 카드가 접히면, 그 카드의 cleanup이 `activeFloatingStoryId`를 `null`로 되돌리고 다른 펼쳐진 카드가 곧 재선점한다.
- **언마운트 중 활성**: 카테고리 전환 / 배치·데이터 리로드(dataService 리로드 pub/sub) / 목록 가상화 등으로 활성 카드가 **접힘 없이 언마운트**될 수 있다. 언마운트 정리에서 `activeFloatingStoryId === thisInstanceId`이면 `null`로 되돌려, 사라진 인스턴스를 가리키는 댕글링 id로 버튼이 안 뜨는 상태를 방지한다("활성 카드 선택" 정리 규칙).
- **인스턴스 id 충돌**: 활성 키를 story 데이터가 아닌 인스턴스 고유 id로 두므로, `cluster_number` 부재로 `title` 폴백이 겹치는 두 카드가 동시에 활성이 되는 문제가 없다.
- **빠른 재탭 / 지연 스크롤 / 언마운트**: 닫은 직후 다른 글을 빠르게 펼치거나, 150ms 내에 카드가 언마운트(카테고리 전환/리로드/가상화)되면, 닫기의 지연된 `scrollTo`(150ms)를 `clearTimeout`으로 취소해 화면이 이전 앵커로 튀지 않게 한다("탭 동작" 4단계, 정리 cleanup에서 취소).
- **포커스 유실**: 버튼 클릭으로 닫으면 버튼이 언마운트되므로 제목 토글로 `focus({ preventScroll: true })` 이동한다("탭 동작" 3단계).
- **뷰포트 리사이즈/회전**: `max-[768px]` 미디어쿼리(CSS)가 처리. Observer는 뷰포트 기준이라 회전 시 자동 재평가.
- **하단 카테고리 바 충돌**: 기본값 `categoryHeaderPosition: "bottom"`에서 하단 전폭 카테고리 바(`z-modal`=60)와 버튼이 겹치지 않도록 `bottom` 오프셋을 바 위로 띄운다(§시각 디자인, BackToTop 패턴).
- **Toast 겹침**: 토스트(`z-notification`=90 > 버튼 `z-fixed`=30)가 수 초 후 사라지므로 잠시 덮는 것은 허용한다.

## 검증 (Verification)

- 모바일 뷰포트(≤768px)에서: 긴 글 펼침 → 중간까지 스크롤 → 플로팅 버튼 탭 → 글이 접히고 제목 위치로 부드럽게 스크롤되는지.
- **짧은 글**(화면 절반 미만) 펼침 시: 스크롤 없이도 버튼이 뜨는지(폴백 선점).
- 데스크톱(≥769px)에서: 플로팅 버튼이 **전혀 보이지 않고** 기존 동작 그대로인지. (정확히 768px에서는 모바일로 취급되어 버튼이 보여야 함.)
- 여러 글 펼침(멀티/expand-all): 스크롤하며 읽는 글이 바뀔 때 버튼이 **하나만**, 현재 보는 글 것으로 표시되는지. 카드 사이 간격에서도 버튼이 사라지지 않는지(히스테리시스).
- 활성 카드를 제목 재탭/하단 버튼으로 닫았을 때 다른 펼쳐진 카드로 버튼이 넘어가는지.
- 기본 설정(`categoryHeaderPosition: "bottom"`)에서 버튼이 하단 카테고리 바 **위로 떠서 가려지지 않는지**. `"top"` 설정에서도 위치가 자연스러운지.
- 활성 카드를 접지 않고 언마운트(카테고리 전환/리로드)한 뒤에도, 남은 다른 펼침 카드나 재펼침에서 버튼이 정상 표시되는지(댕글링 id 없음).
- 닫은 직후 다른 글을 빠르게 펼쳤을 때 화면이 이전 앵커로 튀지 않는지(지연 스크롤 취소).
- 공유뷰: 버튼 미표시.
- 소스뷰 오버레이 열림 시 버튼이 숨는지, 닫으면 다시 뜨는지.
- 펼쳐진 글에 콘텐츠 필터가 걸려 블러 처리될 때 버튼이 사라지고 오작동하지 않는지.
- 플로팅 버튼으로 닫은 뒤 키보드 포커스가 제목 토글로 이동하는지.
- `npm run check`, `npm run lint` 통과.
