# 코-Kagi 뉴스 (Ko-KagiNews)

> [!IMPORTANT]
> **This is an unofficial fork of [kagisearch/kite-public](https://github.com/kagisearch/kite-public), the open-source front-end of [Kagi News](https://kite.kagi.com) developed by [Kagi](https://kagi.com).**
> All news data and the original application are produced by Kagi — this fork only adds a Korean-language layer on top. It is **not affiliated with or endorsed by Kagi**. If you are looking for the official project, use the upstream repository.
>
> **이 저장소는 Kagi가 만든 [Kagi News](https://kite.kagi.com) 오픈소스 프론트엔드([kagisearch/kite-public](https://github.com/kagisearch/kite-public))의 비공식 포크입니다.** 뉴스 데이터와 원본 앱은 모두 Kagi가 제작하며, 이 포크는 그 위에 한국어 레이어를 얹은 것뿐입니다. Kagi와는 무관한 개인 프로젝트입니다.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

**Live: <https://ko-kaginews.vercel.app>** — Kagi News, in Korean by default.

Kagi News publishes one immutable news batch per day (12:00 UTC), curated from community RSS feeds and summarized by language models. This fork serves that same content **in Korean**: stories are pre-translated with Gemini shortly after each batch publishes and overlaid at serve time, so Korean readers get the daily digest without waiting on live translation.

## What this fork adds

- **Korean by default** — new visitors get Korean UI and Korean content; the language selector still switches to English or any other supported language at any time.
- **Pre-translated daily content** — the `world`, `usa`, `business`, `tech`, `science`, and `ai` categories are translated to Korean every day by an automated pipeline (details below). Untranslated categories and batches gracefully fall back to the English original.
- **Fast translation after publish** — wait-mode cron ticks start polling *before* the 12:00 UTC publish, so translation begins within seconds of the new batch appearing instead of hours later.
- **코-Kagi 뉴스 branding** — a distinct wordmark, favicon, and app icons so the fork is never mistaken for the official Kagi News app.
- **Korean UI locale** — `src/lib/locales/ko.json`, generated from `en.json` (upstream had 16 UI languages but no Korean).
- **Hideable Sources section** — the 출처 (Sources) section can be toggled off in settings like any other section (it was hard-pinned on upstream).

Full design rationale lives in [`docs/korean-translation-spec.md`](docs/korean-translation-spec.md).

## How the Korean translation works

There is no on-demand/live translation. Content is translated ahead of time and overlaid at serve time:

1. **Translate** — [`scripts/translate-batch.ts`](scripts/translate-batch.ts) (`npm run translate:batch`) fetches the latest batch from `kite.kagi.com`, translates the configured categories' stories with Gemini, and writes one JSON **sidecar** file per category to `data/translations/<batchId>/`. Sidecars are committed to this repository.
2. **Serve** — the SvelteKit server intercepts the story/chaos API proxy routes: for `lang=ko` requests it fetches the same upstream English JSON it always would, then overlays the translated fields by `story.id` from the sidecar. Citation chips (`[1]`, `[2]`, …) are preserved as-is.
3. **Fall back** — if no sidecar exists for a batch/category (cron hasn't run yet, an untranslated category, or a time-traveled old batch), the server silently serves the English original. No errors, just English content.
4. **UI strings** — translated separately as a static locale file (`src/lib/locales/ko.json`), regenerated with `npm run translate:locale` whenever `en.json` changes.

A shared, framework-free module ([`src/lib/translation/translatable.ts`](src/lib/translation/translatable.ts)) implements segment extraction/merging and validation, and is used by both the translation script and the server overlay so the two stay in sync.

### The translation pipeline (GitHub Actions)

Production runs entirely on GitHub Actions — see [`.github/workflows/translate.yml`](.github/workflows/translate.yml):

- **Wait ticks** at 10:03, 10:33, 11:03, 11:33, and 12:03 UTC each start a runner that polls `/batches/latest` (via `--wait-minutes`) and translates the moment the new 12:00 UTC batch appears. Multiple staggered ticks compensate for GitHub's scheduled-run delivery delays (60–90+ min in practice); a concurrency group collapses them so only one effectively runs.
- **Catch-up runs** at 14:00 and 16:00 UTC are plain idempotent re-runs in case every wait tick was dropped.
- Finished sidecars are **committed to `data/translations/`** and pushed, which triggers a Vercel redeploy — that's how translations reach production. Old batches are pruned to the newest 7 (`scripts/prune-translations.ts`).
- The only required secret is `GEMINI_API_KEY`. Exit codes: `0` success (including idempotent no-op), `1` unexpected error, `2` no fresh upstream batch, `3` failure rate over threshold, `4` config error.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | *(required for scripts)* | Gemini API key. Not needed by the server at runtime. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Model id override. |
| `TRANSLATIONS_DIR` | `./data/translations` | Sidecar storage path, shared by the scripts and the server. |
| `KITE_API_BASE` | `https://kite.kagi.com/api` | Upstream override (used in tests). |
| `TRANSLATIONS_ENABLED` | `true` | Serving kill switch. Set to `'false'` to force all content to English regardless of sidecar availability — no file deletion or code revert needed. Does not affect the scripts. |

### Self-hosting notes

If you deploy outside Vercel/GitHub Actions (e.g. your own node server + crontab), two silent failure modes are worth knowing — both manifest only as "`lang=ko` keeps returning English" with clean logs, because missing sidecars fall back to English by design:

- **`.env` is not auto-loaded by the production server.** `@sveltejs/adapter-node`'s build (`node build`) doesn't load `.env`; run `node -r dotenv/config build` or inject env via systemd `EnvironmentFile=`. The `bun` scripts *do* auto-load `.env` from their working directory.
- **`TRANSLATIONS_DIR` is resolved relative to `process.cwd()`.** If the cron and the server run with different working directories they silently disagree on where sidecars live. Always set `TRANSLATIONS_DIR` to an absolute path in production, and pin `WorkingDirectory=` on systemd units.
- Cron schedules should be anchored to **UTC** (the batch publishes at 12:00 UTC); wire up at least one alert consumer (`MAILTO`, healthchecks.io, …) before relying on a cron in production.

## Run this fork locally

```bash
git clone https://github.com/Laeyoung/Ko-KagiNews.git
cd Ko-KagiNews

# Node.js LTS for the app, bun for the standalone scripts/*.ts utilities
npm install
npm run dev
```

Recent translated batches are committed under `data/translations/`, so `lang=ko` content works out of the box for those batches — no API key needed unless you want to generate new translations.

---

# Original README — Kagi News: News. Elevated.

*The remainder of this document is the upstream [kagisearch/kite-public](https://github.com/kagisearch/kite-public) README, kept for reference. Contributions to feeds, media data, and content filters should generally go upstream so the whole community benefits.*

This repository contains public files for [Kagi News](https://kite.kagi.com), news app for people who want a healthy news diet, developed by [Kagi](https://kagi.com).

Kagi News is designed for people who want to stay informed without getting overwhelmed. We provide daily updates of the most important news stories, from carefully curated sources and summarized by advanced language models to give you the essential information you need. We strive for diversity and transparency of resources and welcome your contributions to widen perspectives. This multi-source approach helps reveal the full picture beyond any single viewpoint.

Most of what powers Kagi News is open sourced and is found in this repository.

This includes

- Kagi News web app
- Community curated feeds
- Media information

## Core Principles

- Updated only once per day - no endless scrolling (12PM UTC)
- Facts and perspectives, opinion-free
- Zero tracking, zero ads
- Pure signal, no noise
- Quality over quantity
- Complete news diet in 5 minutes

You can read more about core principles behind Kagi News

- [Avoid News: Towards a Healthy News Diet](https://www.gwern.net/docs/culture/2010-dobelli.pdf) ([HN discussion](https://news.ycombinator.com/item?id=21430337))
- [News is bad for you](http://www.theguardian.com/media/2013/apr/12/news-is-bad-rolf-dobelli) ([HN discussion](https://news.ycombinator.com/item?id=6894244))
- [Stop reading news](https://fs.blog/2013/12/stop-reading-news/) ([HN discussion](https://news.ycombinator.com/item?id=19084099))

If you prefer to watch a short video, check this Ted talk: [Four reasons you should stop watching the news | Rolf Dobelli](https://www.youtube.com/watch?v=-miTTiaqFlI).

# Install & run Kagi News front-end

Kagi News front end is a statically served app and is fully open source.

Here is how to run it locally:

```bash
# Clone the repository
git clone https://github.com/kagisearch/kite-public.git
cd kite-public

# Make sure you have the Node.js LTS version installed.
node -v

# Install dependencies
npm install

# Run development server
npm run dev
```

Check out the Vite documentation on how a production build works: https://vite.dev/guide/static-deploy.html

Kagi News front-end uses Kagi News application data that can be found at [kite.kagi.com/kite.json](https://kite.kagi.com/kite.json) (explore other files from there). Note that kite.json and files referenced by it are licensed under [CC BY-NC license](https://creativecommons.org/licenses/by-nc/4.0/). This means that this data can be used free of charge (with attribution and for non-commercial use). If you would like to license this data for commercial use let us know through support@kagi.com.

Kagi News web app is just one example front-end that one can run on top of the Kagi News data. We encourage others to contribute improvements to the Kagi News frontend.

**We would also love to see what kind of custom front-ends you can create on top of Kagi News data!** Feel free to share them with us and others by editing this Readme file.

## Editing categories

To edit community curated categories, submit a pull request editing `kite_feeds.json`. If you do not know how to do that, you can [open an issue](https://github.com/kagisearch/kite-public/issues/new/choose) and share the feeds you want to add there.

This file contains RSS feeds for various categories.

To add a new category or modify existing ones, follow this structure:

```jsonc
{
  "Category Name": {
    "feeds": [
      "https://example.com/rss-feed-1",
      "https://example.com/rss-feed-2",
      // ...
    ],
  },
  "Another Category": {
    "feeds": [
      "https://another-example.com/rss-feed-1",
      "https://another-example.com/rss-feed-2",
      // ...
    ],
  },
}
```

### Adding a new category

1. Create a new object with the category name as the key
2. Add a "feeds" array containing the RSS feed URLs for that category
3. Ensure proper JSON formatting (commas between objects, no trailing comma)

All categories are created equal and will appear as top level categories in the Kagi News app.

Ideas for categories:

- Local news (city/state level)
- Regional news (country/region)
- Topical news (health, machine learning, aviation ...)

### Guidelines for adding RSS feeds

Kagi News does not scrape websites, but only publicly available RSS feeds.

When adding an RSS feed make sure to:

- Check that feed is working and has recent (daily) content.
- Choose sources that have high quality content. Do not use low quality/gossip/SEO content.
- **Feeds can be in any language.** Kagi News translates all content automatically, so a single category can (and should) contain feeds in multiple languages. Do not create separate categories for different languages (e.g. "Switzerland (DE)" and "Switzerland (FR)") — keep everything in one category. The `source_language` field in `kite_feeds.json` should be set to the language used by the majority of feeds; its exact value is not critical.

### Important

We require at least **25 feeds** for a category in order to surface it in Kagi News. This is to make sure we maintain high level of quality of events covered in the app. The more high quality feeds exist for a category, the better Kagi News coverage will be.

Kagi News does not scrape news websites, it only uses publicly available information in RSS feeds.

## Core Feeds

Kagi News's official core feeds are fully open source and available in `core_feeds.py`. These feeds cover essential news categories and form the foundation of Kagi News's coverage. While primarily maintained by the Kagi team for quality and consistency, they are open to community contributions - you can submit pull requests to suggest improvements or additions to these core feeds.

Core categories include:
- World News
- Business
- Technology
- Science
- Sports
- Culture
- Politics
- And many more specialized topics

The combination of these core feeds and community-curated feeds ensures comprehensive, diverse news coverage from multiple perspectives.

## Guidelines for editing Media information

Kagi News uses contents of `media_data.json` to show additional information about sources of information. Initial information has been sources from https://statemediamonitor.com/ and the classification methodology is explained here https://statemediamonitor.com/methodology/

Feel free to add additional information (by editing `media_data.json`) both for privately owned and state funded media organization. Add your sources of information in the pull request.

## Guidelines for editing Content Filters

Kagi News allows users to blur or hide articles on topics they prefer not to see. These personal content filters are defined in `src/lib/data/contentFilters.json` and are open source and community editable.

To edit content filters, submit a pull request editing `contentFilters.json`. Each filter follows this structure:

```json
{
  "id": "filter_id",
  "label": "Display Name",
  "keywords": {
    "default": ["keyword1", "keyword2"],
    "en": ["keyword1", "keyword2"],
    "pt": ["palavra1", "palavra2"],
    // ... other languages
  }
}
```

When adding or modifying filters:
- Use lowercase for all keywords
- Include translations for all supported languages
- Choose descriptive, clear labels for filter categories
- Test that keywords accurately match the intended topic

Feel free to add new filter categories or improve existing ones by adding relevant keywords in multiple languages.

## Custom front-ends

### Raycast
<a title="Install kagi-news Raycast Extension" href="https://www.raycast.com/mickaphd/kagi-news"><img src="https://www.raycast.com/mickaphd/kagi-news/install_button@2x.png?v=1.1" height="64" style="height: 64px;" alt=""></a>

### Pebble
<a title="Install Kagi News Pebble Application" href="https://apps.rebble.io/en_US/application/692b3f0549be450009b545ce"><img src="https://assets2.rebble.io/720x320/692d3f44d7dcba0009f1b174" height="100" alt=""></a>
