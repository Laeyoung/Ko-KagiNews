# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Kagi News (kite.kagi.com) front-end — a SvelteKit static/SSR app that presents a once-daily, curated news digest. This fork (`Laeyoung/Ko-KagiNews`) adds Korean translation support; see `docs/korean-translation-spec.md` for that ongoing work.

**The front-end holds no news data of its own.** Every `src/routes/api/**/+server.ts` route is a thin proxy to `https://kite.kagi.com/api` via `createProxy()` in `src/lib/server/proxy.ts`. There is no database of stories and no generation/translation pipeline in this repo — the upstream Kagi backend produces the content. (Drizzle/postgres deps exist but are not the story source.)

## Commands

Tooling is split: **npm** for app scripts, **bun** for the standalone `scripts/*.ts` utilities (matches CI, which uses `oven-sh/setup-bun`).

```bash
npm run dev              # Vite dev server
npm run build            # Production build (@sveltejs/adapter-node → ./build)
npm start                # node build  (run the built server)

npm run check            # svelte-kit sync + svelte-check (types)
npm run lint             # Biome lint          / lint:fix to autofix
npm run format           # Biome format --write / format:check to verify
npm run biome:check      # Biome lint+format together / biome:fix to apply

npm test                 # Vitest watch
npm run test:unit        # Unit tests only  (vitest.config.unit.ts, jsdom)
npm run test:integration # Integration tests (vitest.config.integration.ts, node, hits live API)
npm run test:all         # Everything
```

Run a single test file / test:
```bash
npx vitest run --config vitest.config.unit.ts src/lib/utils/urlEncoder.test.ts
npx vitest run --config vitest.config.unit.ts -t "name of the test"
```

- **Unit tests** (`*.test.ts`) run in jsdom; `$app/environment` is aliased to `src/app.ts` and `$lib` to `src/lib`. `*.integration.test.ts` are excluded here.
- **Integration tests** (`*.integration.test.ts`) run in node with `pool: 'forks'` and a 10s timeout — they make real network calls to the API, so expect flakiness offline.
- Formatting is **Biome**, but the CI quality workflow also runs **Prettier** (with import + tailwind sorting plugins) on changed files. Biome config: tabs, width 100, `useTemplate` enforced, `noNonNullAssertion` off.

## Data flow (read this before touching data loading)

The content model is one immutable "batch" per day (published 12:00 UTC). Three-step load, all going through the local proxy to the Kagi backend:

1. `GET /api/batches/latest?lang=` → resolves the latest batch id (`batchService.loadInitialData`)
2. `GET /api/batches/{batchId}/categories` → category list (maps slug ↔ UUID)
3. `GET /api/batches/{batchId}/categories/{categoryUuid}/stories?lang=` → stories (`storiesService.loadStories`)

The front-end resolves "latest" once, then always navigates via the `[batchId]` route; the `latest/...` story routes are for external consumers. `chaos` data is fetched two ways — `batchService` uses `/batches/{batchId}/chaos`, while `chaosIndexService` falls back to `/batches/latest/chaos` when no current batch is set.

Route params are validated by matchers in `src/params/` (`batchId` accepts UUID, `YYYY-MM-DD.N` slug, or legacy `YYYY-MM-DD`). `getApiBaseUrl()` in `src/lib/utils/apiUrl.ts` returns relative `/api` in the browser and an absolute URL server/test-side.

## Architecture layers

- `src/routes/api/**/+server.ts` — proxy endpoints (see above). Widgets (`/api/widgets/{crypto,f1,nfl,nhl,weather}`) and helpers like `image-proxy`, `favicon-proxy`, `geocode`, `shorten` are the non-trivial ones.
- `src/lib/services/` — data-fetching + domain logic (`batchService`, `storiesService`, `mediaService`, `chaosIndexService`, `onThisDayService`, search under `services/search/`). `dataService.ts` is a facade + a reload pub/sub (`onReload`/`beforeReload`).
- `src/lib/stores/*.svelte.ts` — Svelte 5 runes-based state (theme, language, settings, timeTravel, etc.).
- `src/lib/data/settings.svelte.ts` — the **authoritative** settings source (localStorage-backed). `settings.language` (UI) and `settings.dataLanguage` (content `lang` param via `getLanguageForAPI()`) live here. The parallel `stores/language.svelte.ts` / `dataLanguage.svelte.ts` are secondary and sync asymmetrically — changing a language default requires editing both places (see spec §2.2).
- `src/lib/components/` — Svelte 5 components (feature-grouped: `contribute/`, `crypto/`, `f1/`, `nfl/`, `nhl/`, `common/`).
- `src/lib/data/migrations/` — versioned localStorage/settings migrations.
- `src/lib/locales/*.json` — UI i18n (16 languages; no `ko.json` yet). `src/lib/constants/languages.ts` lists `SUPPORTED_LANGUAGES` (`ko` already declared).

## Community data files (edited via PR, validated in CI)

- `kite_feeds.json` — community RSS feeds by category. Feeds may be any language (backend auto-translates); keep one category per topic regardless of feed language. Validated/sorted by `scripts/{validate,sort}-feeds.ts`.
- `core_feeds.py` — Kagi's official core feeds (Python). Sorted by `scripts/sort-core-feeds.py`.
- `media_data.json` — source/publisher metadata. Validated by `scripts/validate-media.ts`.
- `src/lib/data/contentFilters.json` — user-facing keyword blur/hide filters (multi-language keywords, lowercase).

The `quality.yml` CI workflow runs the matching validator only when the corresponding file changes, and posts suggestions via reviewdog.

## CI

- `ci.yml` — svelte-kit sync + `svelte-check` (uses `tsconfig.svelte-check.json`).
- `build-test.yml` — build, unit tests w/ coverage, then boots the preview server, smoke-tests `/` and `/latest`, runs Lighthouse, then `test:all`.
- `quality.yml` — Prettier + Biome + JSON/data-file validation on changed files (advisory, reviewdog).
- `sort-feeds.yml` — feed sorting automation.
