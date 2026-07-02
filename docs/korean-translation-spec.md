# Ko-KagiNews 한국어 번역 지원 개발 스펙

> 상태: Draft v1 (2026-07-02)
> 대상 저장소: `Laeyoung/Ko-KagiNews` (kagisearch/kite-public 포크)
> 번역 엔진: Google Gemini 3.1 Flash Lite API

---

## 1. 개요

### 1.1 문제 정의

Kagi News(kite.kagi.com)는 콘텐츠를 다국어로 제공하지만 **한국어는 사실상 지원하지 않는다**. 라이브 API로 검증한 사실:

- 스토리 API에 `lang=ko`를 넘겨도 **영어 원문**이 그대로 반환된다 (`selectedLanguage: 'ko'`, `translationAvailable: false`).
- 배치 언어 목록(`/api/batches/{id}/languages`)에서 `ko`는 **185개 카테고리 중 1개**(한국어 소스 카테고리)만 커버한다.
- UI 문자열도 마찬가지다. 이 저장소의 `src/lib/locales/`에는 16개 언어 로케일이 있지만 `ko.json`이 없고, 백엔드 `/api/locale/ko`는 200을 반환하지만 **내용이 영어 그대로**다.

### 1.2 목표

1. **뉴스 콘텐츠 한국어 번역**: 매일 발행되는 배치의 스토리를 Gemini 3.1 Flash Lite로 한국어 번역해 제공한다.
2. **UI 한국어화**: 설정 화면·버튼 등 UI 문자열(`en.json` 1,069개 키)을 한국어로 번역한 `ko.json`을 추가한다.
3. **한국어 기본값**: UI 언어와 콘텐츠 언어의 기본값을 한국어로 설정한다. 단, 기존 언어 선택 기능은 유지한다.

### 1.3 비목표 (Non-Goals)

- 온디맨드(요청 시) 번역 — 사전 일괄 번역 방식만 사용한다.
- 한국어 외 다른 언어의 자체 번역 추가.
- Kagi 백엔드가 이미 제공하는 기능(요약 생성, 다른 언어 번역)의 대체.
- 언어 선택 UI 제거 — 한국어는 "기본값"이며 사용자는 여전히 다른 언어를 선택할 수 있다.

### 1.4 운영 전제

- 이 앱은 `@sveltejs/adapter-node`로 빌드된 Node 서버로 **자체 호스팅**된다 (`npm run build` → `node build`).
- Kagi 배치는 매일 12:00 UTC(KST 21:00) 발행 후 후처리를 거쳐 **KST 22:00경** 안정화된다.
- 번역 크론은 **매일 KST 23:00(= 14:00 UTC)** 실행하며, `translation.config.json`에 **미리 선택된 카테고리만** 번역한다.
- 크론 프로세스와 웹 서버는 같은 호스트(또는 같은 볼륨)에서 번역 데이터 디렉토리를 공유한다.

---

## 2. 현황 분석 (코드로 검증된 사실)

### 2.1 아키텍처

- SvelteKit 2 + Svelte 5(runes), TypeScript, TailwindCSS 4, Vitest, Biome. 스크립트 실행은 **bun** (`bun.lock`, CI의 `oven-sh/setup-bun`).
- 이 저장소에는 뉴스 생성/번역 파이프라인이 **없다**. 모든 `src/routes/api/**/+server.ts`는 `src/lib/server/proxy.ts`의 `createProxy()`를 통해 `https://kite.kagi.com/api`로 단순 프록시한다.
- 콘텐츠 모델: 하루 1개의 불변(immutable) "배치". 프론트엔드 흐름(`src/lib/services/batchService.ts`):
  1. `GET /api/batches/latest?lang=` → 배치 id
  2. `GET /api/batches/{batchId}/categories` → 카테고리 목록 (slug ↔ UUID)
  3. `GET /api/batches/{batchId}/categories/{categoryUuid}/stories?lang=` → 스토리 목록
- **주의**: 프론트엔드는 latest를 해석한 뒤 항상 `[batchId]` 라우트를 사용한다. `latest/...` 스토리 라우트는 외부 소비자용이다.

### 2.2 언어 관련 상태

- `'ko'`는 이미 `src/lib/constants/languages.ts`의 `SUPPORTED_LANGUAGES`에 선언되어 있고 언어 선택 UI에도 노출된다.
- 언어 설정의 **실제 소스는 `src/lib/data/settings.svelte.ts`** 다:
  - `settings.language` (localStorage 키 `kiteLanguage`, 기본 `'en'`) → UI 언어
  - `settings.dataLanguage` (기본 `'default'`) → `getLanguageForAPI()`를 통해 콘텐츠 요청의 `lang` 파라미터가 됨
  - `src/lib/stores/language.svelte.ts` / `dataLanguage.svelte.ts`는 위 설정과 병행 존재하는 스토어로, `+layout.svelte`의 `$effect`로 동기화된다. **기본값 변경 시 양쪽 모두 수정 필요.**
- `getLanguageForAPI()`는 custom 모드에서 `'ko,en'` 같은 **쉼표 구분 목록**을 반환할 수 있다.
- 카테고리 표시명은 API가 아니라 **로케일 파일의 `category.*` 키(123개)** 에서 온다(`src/lib/utils/category.ts`의 `getCategoryDisplayName`). 즉 `ko.json`을 만들면 카테고리명 한국어화는 자동 해결된다.
- `translationAvailable` 필드는 현재 프론트엔드 어디서도 읽지 않으며 `Story` 타입에 선언조차 안 되어 있다. `selectedLanguage`는 `Footer.svelte`의 RSS URL 생성에서만 읽는다.

### 2.3 LLM 연동 상태

- `@google/genai` SDK가 이미 `package.json` 의존성에 있다 (현재 미사용).
- 환경변수는 `VITE_BASE_PATH`, `VITE_STATIC_PATH`만 존재하고, LLM API 키 처리는 없다. `dotenv`는 의존성에 있다.

### 2.4 선행 과제 (빌드 블로커)

`src/routes/[batchId=batchId]/[categoryId=categoryId]/+page.server.ts`가 저장소에 존재하지 않는 `$lib/server/db/queries`, `$lib/server/opengraph`를 임포트한다 (`src/lib/server/`에는 `proxy.ts`만 있음). **`vite build`가 실패하므로 구현 착수 전에 이 로더를 스텁 처리하거나 제거해야 한다** (OG 메타태그 생성 전용이라 제거해도 기능 손실은 메타태그뿐).

---

## 3. 전체 아키텍처

```
┌─────────────────────────────  매일 KST 23:00 (cron)  ─────────────────────────────┐
│                                                                                    │
│  scripts/translate-batch.ts (bun)                                                  │
│    1. GET kite.kagi.com/api/batches/latest            → batchId                    │
│    2. GET .../categories                              → slug → UUID 매핑           │
│    3. translation.config.json 의 선택 카테고리별:                                   │
│         GET .../stories?lang=en                                                    │
│         → 스토리당 1회 Gemini 3.1 Flash Lite 호출 (structured JSON output)         │
│         → 검증(인용 마커/경로/길이) → 실패 시 재시도                                │
│    4. 사이드카 저장: data/translations/<batchId>/<categoryUuid>.json (원자적 쓰기)  │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────  요청 시 (SvelteKit node 서버)  ──────────────────────┐
│                                                                                    │
│  GET /api/batches/{batchId}/categories/{catUuid}/stories?lang=ko                   │
│    1. 업스트림(kite.kagi.com)에서 원문 JSON 수신 (기존 프록시와 동일)               │
│    2. lang이 한국어면 사이드카 조회 → story.id 기준으로 번역 필드 오버레이           │
│    3. 사이드카 없음(미선택 카테고리/과거 배치/실패 스토리) → 영어 원문 그대로 통과    │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**핵심 설계 결정 — 사이드카 + 서빙 시 오버레이**

번역된 텍스트 필드만 story `id` 키로 저장하고, 서빙 시 업스트림 응답에 병합한다. "번역된 전체 페이로드를 저장해 그대로 서빙"하는 대안은 다음 이유로 기각한다:

- `readCount`, `timestamp` 등 라이브 카운터가 번역 시점 값으로 동결된다.
- 스토리당 번역 대상 텍스트는 ~8KB인데 articles/domains 등 비번역 페이로드 ~42KB를 중복 저장하게 된다.
- 업스트림이 필드를 추가/변경하면 저장본이 조용히 어긋난다(silent divergence).
- 오버레이 방식은 스토리 응답 본문에 `batchId`가 포함되므로 "latest 포인터" 관리도 불필요하다.

---

## 4. 콘텐츠 번역 파이프라인

### 4.1 설정 파일 — `translation.config.json` (저장소 루트)

`kite_feeds.json`, `media_data.json`과 같은 루트 설정 컨벤션을 따른다.

```json
{
	"categories": ["world", "usa", "business", "tech", "science", "korea"],
	"storyLimit": 12,
	"concurrency": 3,
	"maxRetries": 3,
	"failureThresholdPct": 20
}
```

- `categories`: 번역할 카테고리 **slug** 목록 (categories 응답의 `categoryId` 필드와 매칭. 미존재 slug는 경고 후 skip).
- `storyLimit`: 카테고리당 번역할 최대 스토리 수.
- `concurrency`: 동시 Gemini 호출 수 (세마포어).
- `failureThresholdPct`: 전체 실패율이 이를 초과하면 크론이 non-zero exit (모니터링 알림용).

### 4.2 사이드카 파일 스키마

경로: `data/translations/<batchId>/<categoryUuid>.json` (git 추적 제외 — `.gitignore`에 `data/translations/*` 추가, `.gitkeep`만 커밋). 배치는 불변이므로 사이드카도 완성 후 불변이다.

```jsonc
{
	"version": 1,
	"batchId": "d97781a5-53b2-4d41-a1af-26145afa1170",
	"categoryUuid": "824b8d47-5c9c-4ac2-ab55-f8b85f777bcb",
	"categorySlug": "world",
	"model": "gemini-3.1-flash-lite",
	"createdAt": "2026-07-01T14:03:11Z",
	"stories": {
		"<storyId(UUID)>": {
			// 번역된 leaf 필드만 담는 partial Story
			"title": "미 대법원, 트럼프 출생시민권 제한 제동",
			"short_summary": "…",
			"talking_points": ["…", "…"],
			"timeline": [{ "content": "…" }, { "content": "…" }],
			"perspectives": [{ "text": "…" }],
			"suggested_qna": [{ "question": "…", "answer": "…" }]
		}
	},
	"stats": {
		"storyCount": 12,
		"translated": 12,
		"failedStoryIds": [],
		"tokens": { "in": 0, "out": 0 }
	}
}
```

배열은 원문과 **인덱스 정렬(positional alignment)** 을 유지한다(번역 시 검증). 추가로 `data/translations/index.json`에 배치/카테고리별 처리 상태·토큰 누계를 기록한다(크론 북키핑 + 멱등성 판단용).

### 4.3 크론 스크립트 — `scripts/translate-batch.ts`

실행: `bun scripts/translate-batch.ts` (기존 `scripts/` 컨벤션: 플랫 디렉토리, `node:fs`, 상대 임포트). `package.json`에 `"translate:batch": "bun scripts/translate-batch.ts"` 추가.

**흐름**

1. `GET {KITE_API_BASE}/batches/latest` → `batchId`. `createdAt`이 26시간 이내인지 확인(아니면 exit 2 — 배치 미발행 알림).
2. `GET /batches/{batchId}/categories?lang=en` → 설정된 slug들을 카테고리 UUID로 해석.
3. 카테고리별 처리(카테고리 간 순차, 카테고리 내 스토리는 `concurrency` 세마포어로 병렬):
   - **멱등성**: 사이드카가 존재하고 `stats.translated === storyCount`이며 story id 집합이 일치하면 skip(`--force` 시 재번역). 부분 완료 상태면 누락/실패 스토리만 번역해 기존 사이드카에 병합. → 부분 실패 후 재실행이 안전하다.
   - `GET .../stories?limit={storyLimit}&lang=en`
   - 스토리별: `extractSegments(story)` → Gemini 호출(§4.4) → 검증(§4.6) → 사이드카 엔트리 구성.
   - **재시도**: 429/5xx/JSON 파싱 실패/스키마 불일치/인용 마커 검증 실패 시 `maxRetries`까지 지수 백오프(2s → 8s → 30s + jitter). 최종 실패 스토리는 `stats.failedStoryIds`에 기록 → 서빙 시 영어 폴백.
   - **원자적 쓰기**: `<categoryUuid>.json.tmp` 작성 후 `rename`.
4. `index.json` 갱신, 요약 출력(카테고리별 성공/실패 수, `usageMetadata` 토큰 누계, 예상 비용). 전체 실패율 > `failureThresholdPct`면 non-zero exit.

**CLI 플래그**

| 플래그 | 용도 |
|---|---|
| `--batch <id>` | 특정 배치 번역 (타임트래블/백필) |
| `--category <slug>` | 특정 카테고리만 |
| `--force` | 완료된 사이드카도 재번역 |
| `--dry-run` | API 호출 없이 세그먼트 추출 + 토큰/비용 추정만 출력 |
| `--limit <n>` | storyLimit 오버라이드 |

**crontab 예시** (KST 23:00 = 14:00 UTC 본실행 + 16:00 UTC 멱등 캐치업):

```cron
0 14 * * * cd /opt/ko-kaginews && /usr/local/bin/bun scripts/translate-batch.ts >> logs/translate.log 2>&1
0 16 * * * cd /opt/ko-kaginews && /usr/local/bin/bun scripts/translate-batch.ts >> logs/translate.log 2>&1
```

배치 발행(~KST 22:00)부터 크론 완료 전까지 `lang=ko` 요청은 영어 원문으로 폴백된다(요구사항상 허용).

### 4.4 Gemini 호출 설계

**스토리당 1회 호출, 플랫 세그먼트 목록, 스키마 강제 JSON 출력.** 중첩 JSON을 "같은 형태로 돌려달라"는 방식은 `responseSchema`로 강제할 수 없다. 플랫 목록은 스키마 강제가 가능하고 병합/검증이 단순하며, ~35개의 카테고리별 선택 필드에 대해 완전히 제네릭하다.

공용 모듈 `src/lib/translation/translatable.ts` (서버 병합과 bun 스크립트가 공유 — Svelte/SvelteKit 임포트 금지):

```ts
export type Segment = { path: string; text: string }; // 예: "timeline[2].content"

export function extractSegments(story: Story): Segment[];
export function applySegments(base: object, translated: Record<string, string>): object;
export function extractCitations(text: string): string[]; // /\[[^\]]+\]/g
```

Gemini 호출 (`scripts/gemini-client.ts` 래퍼 — 재시도/백오프/세마포어/토큰 집계 공용화):

```ts
import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const res = await ai.models.generateContent({
	model: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
	contents: JSON.stringify(segments), // Segment[]
	config: {
		systemInstruction: TRANSLATION_PROMPT,
		temperature: 0.2,
		maxOutputTokens: 8192,
		responseMimeType: 'application/json',
		responseSchema: {
			type: Type.ARRAY,
			items: {
				type: Type.OBJECT,
				properties: {
					path: { type: Type.STRING },
					ko: { type: Type.STRING },
				},
				required: ['path', 'ko'],
			},
		},
	},
});
```

> 모델 ID(`gemini-3.1-flash-lite`)와 단가는 구현 시점에 Google 공식 문서에서 재확인한다. `GEMINI_MODEL` 환경변수로 오버라이드 가능하게 한다.

### 4.5 번역 프롬프트 요구사항

시스템 프롬프트에 반드시 포함할 규칙:

1. **역할/문체**: 전문 뉴스 번역가. 본문은 한국 언론 표준 문체인 **평서형 '~다' 종결체**, `title`은 헤드라인 스타일(명사형/간결체).
2. **인용 마커 보존**: `[domain.com#N]`, `[common]` 형태의 인용 마커를 **원문 그대로**(철자·대소문자·개수 불변) 보존하되, 한국어 어순에 맞게 해당 주장 뒤로 위치는 조정 가능.
3. **고유명사**: 한국 언론 표기 관례를 따른 음차 표기. 생소한 인명/기관명은 첫 등장 시 원어 병기 — 예: "메릭 갈런드(Merrick Garland)". `Kagi`, 제품명 등 브랜드는 원문 유지.
4. **숫자/단위/날짜**: 값 변환 금지(단위 환산 금지), 표기만 한국어 관례.
5. **충실성**: 문장 추가/누락 금지, 의역 최소화.
6. **출력**: 지정된 JSON 스키마 외 어떤 텍스트도 출력 금지.

프롬프트 전문은 `scripts/gemini-client.ts`(또는 별도 `scripts/prompts.ts`)에 상수로 두고 버전 주석을 단다.

### 4.6 번역 필드 화이트리스트

`src/lib/types.ts`의 `Story` 인터페이스(49–108행) 기준. **블랙리스트가 아닌 화이트리스트** — 업스트림이 미래에 추가하는 미지의 필드는 병합을 오염시키지 않고 안전하게 영어로 남는다.

| 분류 | 필드 |
|---|---|
| 단순 문자열 | `title`, `short_summary`, `did_you_know`, `quote`, `quote_attribution`, `location`, `geopolitical_context`, `historical_background`, `humanitarian_impact`, `economic_implications`, `future_outlook`, `business_angle_text`, `league_standings`, `diy_tips`, `design_principles`, `user_experience_impact`, `destination_highlights`, `culinary_significance` |
| 문자열 배열 (인덱스 정렬 유지) | `talking_points`, `international_reactions`, `key_players`, `technical_details`, `business_angle_points`, `user_action_items`, `scientific_significance`, `travel_advisory`, `performance_statistics`, `gameplay_mechanics`, `industry_impact`, `gaming_industry_impact`, `technical_specifications` |
| 중첩 필드 | `perspectives[].text`, `timeline[].content` (`date`/`date_iso`는 유지), `suggested_qna[].question`, `suggested_qna[].answer`, `primary_image.caption`, `secondary_image.caption` |
| **제외** | `category`(그룹핑 키로 사용), `emoji`, `quote_author`(인명 — 프롬프트가 본문 내 인명은 처리), 모든 URL/`articles[]`/`domains[]`/숫자 필드 |

### 4.7 번역 결과 검증 (세그먼트 단위, 실패 시 해당 스토리 재시도)

1. **인용 마커 멀티셋 동등성**: 원문과 번역문에서 `/\[[^\]]+\]/g` 추출 결과가 멀티셋으로 일치 (프론트엔드 `citationUtils.ts`가 이 패턴을 파싱하므로 필수).
2. **경로 집합 일치**: 응답의 `path` 집합 === 요청한 `path` 집합.
3. **비어있지 않음**: 모든 `ko` 값이 non-empty.
4. **길이 비율**: 원문 대비 0.25–3.0배 (환각/누락 휴리스틱).

---

## 5. 서빙 계층 변경

### 5.1 신규 모듈 — `src/lib/server/translations.ts`

```ts
/** lang 파라미터가 한국어 요청인지 판별. 'ko' 또는 custom 모드의 'ko,en' 등 쉼표 목록의 첫 요소가 'ko'면 true */
export function wantsKorean(langParam: string | null): boolean;

/** 사이드카 파일 읽기. fs 읽기 + 메모리 Map 캐시 (불변 파일이므로 무기한, 항목 수 ~64 제한 LRU) */
export async function readSidecar(batchId: string, categoryUuid: string): Promise<Sidecar | null>;

/** 스토리 응답에 사이드카를 story.id 기준으로 병합 */
export function applyTranslations(body: BatchStoriesResponse, sidecar: Sidecar): BatchStoriesResponse;
```

`applyTranslations` 규칙:

- `sidecar.stories[story.id]`가 있는 스토리만 `applySegments`로 병합하고, **병합된 스토리에만** `selectedLanguage: 'ko'`, `translationAvailable: true`를 설정한다.
- 사이드카에 없는 스토리(번역 실패 포함)는 업스트림 값 그대로 (업스트림은 `selectedLanguage:'ko'`, `translationAvailable:false`를 에코함 — 라이브 검증됨).
- 사이드카 파일 자체가 없으면(미선택 카테고리, 과거 배치) 응답 무변경 통과 → **영어 폴백이 구조적으로 보장**된다.

번역 데이터 위치는 `TRANSLATIONS_DIR` 환경변수(기본 `path.join(process.cwd(), 'data/translations')`). 서버에서는 `$env/dynamic/private`, 스크립트에서는 `process.env`로 읽는다.

### 5.2 라우트 변경

`proxyGET` 단순 프록시를 JSON 인지 핸들러로 교체하는 라우트 (동일 핸들러 공유):

- `src/routes/api/batches/[batchId]/categories/[categoryId]/stories/+server.ts` — **주 인터셉트 지점** (앱이 실제 사용; 타임트래블도 이 라우트라 과거 배치는 자연히 사이드카 미존재 → 영어 폴백)
- `src/routes/api/batches/latest/categories/[categoryId]/stories/+server.ts` — 외부 소비자용. 응답 본문의 `batchId`로 사이드카 조회.

핸들러 로직:

```
if (!wantsKorean(lang)) → 기존 createProxy 경로 (바이트 동일 프록시 유지)
else → fetchUpstreamJSON() → readSidecar() → applyTranslations() → json 응답
```

이를 위해 `src/lib/server/proxy.ts`에 `KITE_API_BASE` export(환경변수 오버라이드 허용) + `fetchUpstreamJSON(endpoint, params, url)` 헬퍼를 추가한다.

**카테고리 목록 엔드포인트는 변경하지 않는다** — 카테고리 표시명은 로케일의 `category.*` 키로 렌더링되므로 `ko.json`이 해결한다 (§2.2).

---

## 6. UI 한국어화 (ko.json)

### 6.1 생성 스크립트 — `scripts/generate-ko-locale.ts`

`package.json`에 `"translate:locale": "bun scripts/generate-ko-locale.ts"` 추가.

- **증분식**: `src/lib/locales/en.json`(1,069키)과 기존 `ko.json`(있다면)을 읽어 **누락 키만** 번역 → 이후 en.json에 키가 추가될 때 저렴하게 재실행 가능.
- 청크당 ~40키(~27회 호출), 각 항목을 `{ key, text, translationContext }`로 전송 — 기존 `translationContext`에 "Kagi는 브랜드명, 번역 금지" 류의 지침이 이미 들어 있어 그대로 활용한다. §4.4와 동일한 `responseSchema`(`{key, ko}` 배열), temperature 0.2.
- **검증**: 요청 키 전수 반환 / `{{mustache}}` 플레이스홀더 멀티셋 보존(75개 키 해당) / `<`·`>` 태그 보존 / 브랜드 용어(`Kagi` 등) 생존. 실패 키는 1회 재큐잉 후 리포트.
- 출력 형식(기존 로케일과 동일): `{ "key": { "text": "<한국어>", "translationContext": "<기존 컨텍스트 유지>" } }`. 생성 후 `bun scripts/sort-locales.ts` 실행(정렬·중복 검사, 디렉토리 스캔 방식이라 신규 파일 자동 인식).
- **`ko.json`은 생성 산출물이지만 저장소에 커밋한다** (빌드 시 번들 포함 필요).

### 6.2 등록

1. `src/lib/locales/index.ts`: `import ko from './ko.json'` + `ko` 엔트리 추가.
2. `src/routes/api/locale/[lang]/+server.ts`: ko는 로컬 서빙, 나머지는 기존 프록시 유지.

```ts
import { json } from '@sveltejs/kit';
import locales from '$lib/locales';
import { GET as proxyGET } from '$lib/server/proxy';

const proxy = proxyGET('/locale/[lang]');
export const GET: RequestHandler = (event) =>
	event.params.lang === 'ko' ? json({ locale: 'ko', strings: locales.ko }) : proxy(event);
```

`{ locale, strings }` 형태는 `src/lib/stores/language.svelte.ts`의 `loadLocaleData()` 및 `storyLocalization.svelte.ts`의 `preloadAllLocales()`가 기대하는 응답 형식과 일치한다 (검증됨).

---

## 7. 한국어 기본값 (정확한 수정 지점)

localStorage에 저장된 사용자 선택이 항상 기본값보다 우선하므로(`Setting.load`, `loadLanguage`, `loadDataLanguage` 모두 저장값 우선), 아래 변경 후에도 언어 선택 기능은 그대로 동작한다.

| 파일 | 변경 |
|---|---|
| `src/routes/+layout.server.ts` | SSR 부트스트랩을 `{ locale: 'ko', strings: locales.ko }`로 — 서버 렌더 문자열이 처음부터 한국어(FOUC 없음) |
| `src/lib/data/settings.svelte.ts:63` | `language` Setting 기본값 `'en'` → `'ko'` (localStorage 키 `kiteLanguage`) |
| `src/lib/data/settings.svelte.ts:66` | `dataLanguage` Setting 기본값 `'default'` → `'ko'` — `getLanguageForAPI()`를 통해 모든 콘텐츠 요청이 `lang=ko`로 나감 |
| `src/lib/stores/language.svelte.ts` | `loadLanguage()` 폴백 `'default'` → `'ko'`; `initStrings()`의 기본 로케일 `'en'` → `'ko'` |
| `src/lib/stores/dataLanguage.svelte.ts:37` | `loadDataLanguage()` 폴백 `detectUserLanguage()` → `'ko'` |

`src/lib/utils/languageDetection.ts`는 공용 로직이므로 수정하지 않는다.

참고: `when_not_default` 저장 전략 때문에 사용자가 명시적으로 "한국어"를 선택해도 localStorage 키가 안 생기지만(이미 기본값), 다른 언어 선택은 정상 저장된다.

---

## 8. 타입/환경변수/부수 수정

### 8.1 타입 (`src/lib/types.ts`)

`Story`에 추가:

```ts
translationAvailable?: boolean;
translationInfo?: { model: string; translatedAt: string };
```

### 8.2 환경변수 (`.env.example` 신규)

| 변수 | 기본값 | 용도 |
|---|---|---|
| `GEMINI_API_KEY` | (필수, 크론/스크립트) | Gemini API 키. 서버 런타임에는 불필요 |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | 모델 ID 오버라이드 |
| `TRANSLATIONS_DIR` | `./data/translations` | 사이드카 저장 경로 (크론과 서버가 공유) |
| `KITE_API_BASE` | `https://kite.kagi.com/api` | 업스트림 오버라이드 (테스트용) |

### 8.3 부수 수정

- **(선행, 필수)** `src/routes/[batchId=batchId]/[categoryId=categoryId]/+page.server.ts`의 깨진 임포트 제거/스텁 (§2.4).
- **(권장)** `src/lib/components/Footer.svelte:39-43`: `selectedLanguage !== 'en'`이면 RSS URL을 `/{category}_ko.xml`로 만드는 기존 로직이 존재하지 않는 피드를 가리키게 됨 → `en` 피드로 고정하거나 알려진 피드 언어만 화이트리스트.
- **(선택)** `src/lib/components/story/StoryHeader.svelte`에 `story.translationAvailable` 기반 "Gemini AI 번역" 배지 + 로케일 키 `story.aiTranslated` 추가.

---

## 9. 구현 범위 — 파일 변경 목록

### 신규 파일

| 파일 | 내용 |
|---|---|
| `scripts/translate-batch.ts` | 일일 크론 번역기 (§4.3) |
| `scripts/generate-ko-locale.ts` | ko.json 생성기, 증분식 (§6.1) |
| `scripts/gemini-client.ts` | GoogleGenAI 래퍼: 재시도/백오프/세마포어/토큰 집계/프롬프트 |
| `src/lib/translation/translatable.ts` (+ `.test.ts`) | 세그먼트 화이트리스트, extract/apply, 인용 마커 검증 (src↔scripts 공용) |
| `src/lib/server/translations.ts` (+ `__tests__/translations.test.ts`) | 사이드카 읽기/캐시/병합, `wantsKorean` |
| `src/lib/locales/ko.json` | 생성 산출물 (커밋) |
| `translation.config.json` | 선택 카테고리 + 튜닝 값 |
| `data/translations/.gitkeep` | + `.gitignore`에 내용물 제외 규칙 |
| `.env.example` | §8.2 환경변수 |
| `docs/korean-translation-spec.md` | 본 문서 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/routes/api/batches/[batchId]/categories/[categoryId]/stories/+server.ts` | 오버레이 핸들러 (§5.2) |
| `src/routes/api/batches/latest/categories/[categoryId]/stories/+server.ts` | 동일 핸들러 |
| `src/routes/api/locale/[lang]/+server.ts` | ko 로컬 서빙 (§6.2) |
| `src/lib/server/proxy.ts` | `KITE_API_BASE` export + `fetchUpstreamJSON` |
| `src/lib/locales/index.ts` | ko 등록 |
| `src/routes/+layout.server.ts` | SSR 한국어 부트스트랩 |
| `src/lib/data/settings.svelte.ts` | 기본값 `'ko'` × 2 (§7) |
| `src/lib/stores/language.svelte.ts`, `src/lib/stores/dataLanguage.svelte.ts` | 폴백 `'ko'` |
| `src/lib/types.ts` | `translationAvailable`, `translationInfo` |
| `package.json` | `translate:batch`, `translate:locale` 스크립트 |
| `src/routes/[batchId=batchId]/[categoryId=categoryId]/+page.server.ts` | 깨진 임포트 수정 (선행) |
| (선택) `src/lib/components/Footer.svelte`, `story/StoryHeader.svelte` | §8.3 |

---

## 10. 비용 추정

Gemini Flash-Lite급 단가($0.10/1M input, $0.40/1M output) 기준 — **구현 시 3.1 Flash Lite 실제 단가 재확인 필요**.

- 실측: 스토리당 번역 대상 텍스트 ~6,100자 ≈ ~1.5k 토큰 → 호출당 ~2.5k in(프롬프트+경로 포함) / ~2.2k out(한국어는 토큰 1.1–1.4배).
- 일일: 6–10 카테고리 × 12 스토리 = 72–120 호출 → 0.2–0.3M in / 0.16–0.27M out → **일 $0.08–0.14, 월 약 $3–4.5** (재시도 여유 ~20% 포함).
- ko.json 일회성: 1,069키 ≈ 27 호출, ~80k in / ~60k out → **$0.05 미만**.

---

## 11. 테스트 전략

### 단위 테스트 (`vitest.config.unit.ts`, 소스 옆 colocate — `colonSplitter.test.ts` 선례)

- `src/lib/translation/translatable.test.ts`: 실제 API 응답을 다듬은 픽스처 스토리로 extract→apply 라운드트립, 배열 인덱스 정렬, 인용 마커 멀티셋 검증기, 경로 집합 검증.
- `src/lib/server/__tests__/translations.test.ts`: id 키 병합, 사이드카 부재 시 무변경 통과, `wantsKorean('ko,en') === true`, 플래그 설정 규칙.

### 통합 테스트 (`vitest.config.integration.ts`, dev 서버 :5173 필요)

- `/api/locale/ko`가 한국어 문자열 반환 (알려진 키가 비영어인지 assert).
- 임시 `TRANSLATIONS_DIR`에 픽스처 사이드카를 놓고 `lang=ko` 스토리 요청 → 한국어 병합 + `translationAvailable: true`; 사이드카 없으면 업스트림 원문 그대로.

### 스크립트/수동 검증

1. `bun scripts/translate-batch.ts --dry-run` — 세그먼트 추출·토큰 추정 (API 미호출, CI 가능).
2. `bun scripts/generate-ko-locale.ts` → `bun scripts/translate-batch.ts --category world --limit 2` (실 API, `GEMINI_API_KEY` 필요).
3. `bun run dev` → 확인: 첫 로드부터 한국어 UI(SSR), World 카테고리 스토리 본문 한국어 + 인용 칩 정상 렌더링, 언어 선택기로 영어 전환/복귀, 과거 배치(타임트래블)는 영어 폴백.

---

## 12. 구현 단계 제안

| Phase | 내용 | 완료 기준 |
|---|---|---|
| **P1. 선행 빌드 수정** | 깨진 `+page.server.ts` 임포트 정리 | `npm run build` 성공 |
| **P2. 공용 모듈 + 스크립트** | `translatable.ts`, `gemini-client.ts`, `translate-batch.ts`, `translation.config.json` | `--dry-run` 및 실 API로 1개 카테고리 사이드카 생성 |
| **P3. 서빙 오버레이** | `translations.ts`, 스토리 라우트 2개, `proxy.ts` 헬퍼 | 통합 테스트 통과, `lang=ko`에서 한국어 응답 |
| **P4. UI 한국어화** | `generate-ko-locale.ts`, `ko.json` 생성·커밋, locale 라우트/index 등록 | `/api/locale/ko` 한국어, 설정 UI 한국어 표시 |
| **P5. 기본값 전환** | §7의 5개 지점 | 신규 방문(localStorage 없음) 시 UI·콘텐츠 모두 한국어 |
| **P6. 마감** | 테스트 정리, crontab 배포, (선택) AI 번역 배지·Footer 수정, README 갱신 | 크론 2일 연속 정상 동작 |
