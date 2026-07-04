# Kagi News - News. Elevated.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

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

## Korean translation

This fork (`Laeyoung/Ko-KagiNews`) adds Korean as a supported content and UI language. Korean is served by **default** for new visitors; users can switch back to English (or any other supported language) at any time via the language selector. Full design rationale lives in `docs/korean-translation-spec.md`.

### How it works

Kagi News publishes one immutable batch per day (12:00 UTC). Korean content is **pre-translated ahead of time and overlaid at serve time** — there is no on-demand/live translation:

1. A nightly cron script (`scripts/translate-batch.ts`, run via `npm run translate:batch` / `bun scripts/translate-batch.ts`) fetches the latest batch from `kite.kagi.com`, translates the configured categories' stories with Gemini, and writes one JSON **sidecar** file per category to `TRANSLATIONS_DIR/<batchId>/`.
2. The SvelteKit Node server intercepts the story/chaos API proxy routes: for `lang=ko` requests it fetches the same upstream English JSON it always would, then overlays the translated fields by `story.id` from the sidecar. Citation chips (`[1]`, `[2]`, ...) are preserved as-is.
3. If no sidecar exists yet for a given batch/category (e.g. the cron hasn't run yet, or a very old/time-traveled batch), the server silently falls back to the English original — there's no error, just English content.
4. UI strings are translated separately and shipped as a static locale file, `src/lib/locales/ko.json`, regenerated with `npm run translate:locale` (`bun scripts/generate-ko-locale.ts`) whenever `en.json` changes.

A shared, framework-free module (`src/lib/translation/translatable.ts`) implements segment extraction/merging and validation, and is used by both the cron script and the server overlay so the two stay in sync.

### Running the translation cron

Deploy `scripts/translate-batch.ts` as a cron job anchored to **UTC**, since the daily batch publishes at 12:00 UTC and cron interprets schedule times in the daemon's local timezone. The target schedule is **KST 23:00 (= 14:00 UTC)** for the main run, plus a **16:00 UTC** idempotent catch-up in case the main run misses a fresh batch:

```cron
CRON_TZ=UTC
MAILTO=ops@example.com
0 14 * * * cd /opt/ko-kaginews && mkdir -p logs && { /usr/local/bin/bun scripts/translate-batch.ts >> logs/translate.log 2>&1 || echo "translate-batch failed exit=$? — check logs/translate.log"; }
0 16 * * * cd /opt/ko-kaginews && mkdir -p logs && { /usr/local/bin/bun scripts/translate-batch.ts >> logs/translate.log 2>&1 || echo "translate-batch (catch-up) failed exit=$? — check logs/translate.log"; }
```

If your cron daemon doesn't support `CRON_TZ`, convert the times to the host's local timezone instead (e.g. Asia/Seoul → `0 23 * * *` and `0 1 * * *`). Getting this wrong doesn't fail loudly: on a KST host running the UTC times unconverted, the script would still exit 0 every day (because the previous day's batch is still "fresh" and already translated) while today's batch translation quietly lags by ~17 hours — always verify the first run's log shows a `createdAt` matching today's 12:00 UTC publish.

Other operational notes:

- `logs/` is gitignored and does not exist on a fresh checkout — the `mkdir -p logs` above is required, otherwise the shell can't open the log file and the script silently never runs (and since sidecar absence falls back to English with no error, this failure mode is invisible in the app).
- `logs/translate.log` grows without bound; configure `logrotate` for it in production.
- The script's exit code drives alerting: `0` = success (including idempotent no-op skips), `1` = unexpected error, `2` = no fresh upstream batch, `3` = failure rate over threshold, `4` = config error (e.g. unknown category slug). The crontab example above emails via `MAILTO` only on non-zero exit. A `healthchecks.io`-style approach (ping on success, alert on missed ping) works too — **at least one alert consumer must be wired up** before relying on the cron in production.
- A one-off manual `bun scripts/translate-batch.ts` run only backfills the current batch; it does **not** replace the cron. Without the cron running daily, the next day's freshly published batch has zero sidecars and visitors fall back to English again.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | *(required for cron/scripts)* | Gemini API key. Not needed by the server at runtime. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Model id override (reconfirm current id/pricing before relying on it). |
| `TRANSLATIONS_DIR` | `./data/translations` | Sidecar storage path, shared by the cron and the server. **Must be an absolute path in production** — see below. |
| `KITE_API_BASE` | `https://kite.kagi.com/api` | Upstream override (used in tests). |
| `TRANSLATIONS_ENABLED` | `true` | Serving kill switch. Set to `'false'` to force all content to English regardless of sidecar availability — no file deletion or code revert needed, just an env change + restart. Does not affect the cron/scripts. |

**`.env` is not auto-loaded by the production server.** `@sveltejs/adapter-node`'s build (`node build`) does not load `.env` automatically. In production, either run `node -r dotenv/config build`, or inject the environment via systemd `EnvironmentFile=` (or your container platform's env injection). The `bun` cron scripts do auto-load a `.env` in their working directory, so as long as the crontab `cd`'s into the app directory first (as in the example above), no extra step is needed there.

**`TRANSLATIONS_DIR` cwd trap:** the default value is resolved relative to `process.cwd()`, so if the cron and the server process have different working directories, they can silently disagree on where sidecars live — e.g. a systemd unit without `WorkingDirectory=` runs with cwd `/`, so the server looks for `./data/translations` under `/` while the cron writes elsewhere. Because a missing sidecar is a silent, logless fallback to English by design, this manifests only as "`lang=ko` requests keep returning English" with nothing obviously wrong in the logs. To avoid this: always set `TRANSLATIONS_DIR` to an **absolute path** in production, and if using systemd, set both `EnvironmentFile=` and `WorkingDirectory=` on the unit so the cron and server resolve the same path.

### Regenerating the UI locale file

Run `npm run translate:locale` (`bun scripts/generate-ko-locale.ts`) after changing `src/lib/locales/en.json` to regenerate `src/lib/locales/ko.json` via Gemini. This is a separate, on-demand script from the daily news-content cron.

## Custom front-ends

### Raycast
<a title="Install kagi-news Raycast Extension" href="https://www.raycast.com/mickaphd/kagi-news"><img src="https://www.raycast.com/mickaphd/kagi-news/install_button@2x.png?v=1.1" height="64" style="height: 64px;" alt=""></a>

### Pebble
<a title="Install Kagi News Pebble Application" href="https://apps.rebble.io/en_US/application/692b3f0549be450009b545ce"><img src="https://assets2.rebble.io/720x320/692d3f44d7dcba0009f1b174" height="100" alt=""></a>
