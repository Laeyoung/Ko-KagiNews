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

`StoryCard.svelte`에, 글이 펼쳐졌을 때만 렌더되는 **모바일 전용 플로팅 닫기 버튼**을 추가한다. `position: fixed`로 화면 우하단에 고정되며, 탭하면 기존 닫기 경로(`handleStoryClick`)를 그대로 호출한 뒤 해당 글의 제목 위치로 스크롤한다.

여러 글이 동시에 펼쳐진 경우 플로팅 버튼이 겹치지 않도록, **화면 중앙에 걸쳐 있는(=지금 읽고 있는) 글의 버튼 하나만** 표시한다.

### 렌더 조건

플로팅 버튼은 다음을 모두 만족할 때만 DOM에 존재/표시된다:

- `isExpanded === true`
- `!isSharedView` (공유뷰에서는 닫기 자체가 비활성)
- 모바일 뷰포트 — Tailwind `md:hidden`으로 처리 (≥768px에서 숨김). 기존 코드의 `window.innerWidth <= 768` 모바일 기준과 일치한다.
- 이 카드의 펼쳐진 콘텐츠가 **뷰포트 세로 중앙선에 걸쳐 있을 때** (아래 "겹침 방지" 참조)

### 겹침 방지 (다중 펼침 대응)

`IntersectionObserver`로 이 카드의 펼쳐진 콘텐츠 영역(`role="region"` div)을 관찰한다:

- 옵션: `{ root: null, rootMargin: '-50% 0px -50% 0px', threshold: 0 }`
- 이 설정은 "요소가 뷰포트의 **세로 중앙선**을 가로지르는가"를 판정한다. 세로로 긴 본문 특성상 중앙선을 동시에 가로지르는 카드는 사실상 하나뿐이므로, 버튼도 하나만 뜬다.
- 관찰 결과를 로컬 rune 상태(`isCenteredInViewport`)로 두고, 버튼 표시 조건에 AND로 결합한다.
- Observer는 `isExpanded && browser`일 때 생성하고, 접히거나 컴포넌트가 정리될 때 `disconnect()`한다. (`$effect`의 cleanup 반환 사용)
- single-open 모드에서는 애초에 하나만 펼쳐지므로 이 로직은 자연히 no-op에 가깝게 동작한다.

### 탭 동작 (닫기 + 스크롤)

플로팅 버튼 `onclick` 핸들러(`handleFloatingClose`)는:

1. 스크롤 목표 지점을 **먼저 계산해 둔다** (닫기 전에, 아직 `.category-label`이 원래 위치에 있을 때):
   - 앵커: 이 카드 루트(`storyElement`, `#story-{cluster_number}`) 내부의 `.category-label`.
   - 목표 top = `.category-label`의 절대 위치 − (sticky 헤더 높이 + 오프셋).
   - 계산식은 기존 열기 스크롤 `$effect`(StoryCard.svelte:165-207)의 로직을 그대로 재사용한다 (헤더 높이 동적 측정, 모바일 오프셋 8px).
2. `handleStoryClick()`을 호출한다 → 기존 닫기 경로. TTS 정지, simplification/flashcards reset, `onToggle()`(맵에서 제거 + URL 갱신)까지 전부 재사용된다.
3. 콘텐츠가 접힌 뒤 레이아웃이 안정되도록 짧은 지연(기존 열기 로직과 동일한 `setTimeout(..., 150)`) 후 `window.scrollTo({ top, behavior: 'smooth' })`로 이동한다.
   - 접히면 `.category-label`은 헤더에 그대로 남아 있으므로(헤더는 항상 렌더), 미리 계산한 목표값으로 안정적으로 스크롤된다.

> 참고: 기존 하단 "닫기" 버튼(`StoryActions`)은 이번 스코프에서 스크롤 보정을 추가하지 않는다(현행 유지). 플로팅 버튼이 모바일의 주 경로가 된다. 필요하면 후속 작업으로 통합 가능.

### 시각 디자인

- 위치: `fixed`, 우하단. `bottom`/`right`는 `safe-area-inset`을 고려해 여백을 준다 (`env(safe-area-inset-bottom)`), 대략 `bottom: calc(1rem + safe-area)`, `right: 1rem`.
- 형태: 원형 또는 알약형 아이콘 버튼. `✕` 아이콘 + 접근성 라벨. 라벨은 기존 `storyLocalizer("article.closeStory.aria")` / `"article.closeStory"` 재사용.
- z-index: 헤더/오버레이보다 위지만 모달류보다는 아래. 프로젝트의 z-index 스케일(`z-dropdown` 등 Tailwind 커스텀) 중 적절한 값을 사용하고, 소스뷰 오버레이(`showSourceOverlay`)가 떠 있을 땐 가리지 않도록 확인한다.
- 다크모드 대응 (기존 버튼들과 동일한 톤).
- 등장/퇴장에 가벼운 fade/scale 트랜지션(선택).

## 영향 파일 (Affected Files)

- `src/lib/components/story/StoryCard.svelte` — 플로팅 버튼 마크업 + `IntersectionObserver` `$effect` + `handleFloatingClose` 추가. (기존 `handleStoryClick`, 열기 스크롤 로직 재사용)
- (선택) 스크롤 계산이 길어지면 작은 헬퍼로 추출해 열기/닫기 양쪽에서 공유. 과도한 리팩터링은 지양.

로케일 키(`article.closeStory`, `article.closeStory.aria`)는 이미 존재하므로 신규 i18n 불필요.

## 엣지 케이스 (Edge Cases)

- **공유뷰(`isSharedView`)**: 버튼 미렌더 (닫기 비활성 정책 유지).
- **소스 오버레이 열림(`showSourceOverlay`)**: 플로팅 버튼이 오버레이를 가리거나, 반대로 오버레이에 가리지 않도록 z-index/표시 조건 확인. 필요 시 오버레이 열림 동안 버튼 숨김.
- **블러 필터 상태(`isBlurred`)**: 블러 상태에서는 펼쳐지지 않으므로 버튼도 안 뜸 — 별도 처리 불필요.
- **뷰포트 리사이즈/회전**: `md:hidden`(CSS)이 처리. Observer는 뷰포트 기준이라 회전 시 자동 재평가.
- **매우 짧은 본문**: 중앙선을 동시에 가로지르는 카드가 둘 이상일 가능성은 낮지만, 발생해도 각자 자기 카드를 닫으므로 기능적 오류는 없다(시각적으로 순간 겹칠 수 있는 정도).

## 검증 (Verification)

- 모바일 뷰포트(≤768px)에서: 긴 글 펼침 → 중간까지 스크롤 → 플로팅 버튼 탭 → 글이 접히고 제목 위치로 부드럽게 스크롤되는지.
- 데스크톱(≥768px)에서: 플로팅 버튼이 **전혀 보이지 않고** 기존 동작 그대로인지.
- 여러 글 펼침(멀티 오픈 모드): 스크롤하며 읽는 글이 바뀔 때 버튼이 하나만, 현재 글 것으로 표시되는지.
- 공유뷰: 버튼 미표시.
- 소스뷰 오버레이 열림 시 버튼이 방해되지 않는지.
- `npm run check`, `npm run lint` 통과.
