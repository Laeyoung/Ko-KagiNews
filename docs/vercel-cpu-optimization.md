# Vercel CPU reduction

## Implementation

- Browser requests retain same-origin cookies so authenticated Vercel previews work.
  For public GET `/api/batches` routes only, the server strips `_clck`/`_clsk`
  analytics cookies before upstream forwarding and cache-eligibility checks.
  Auth/unknown cookies and Authorization still prevent creating shared cache
  responses. Other routes keep their existing behavior.
- `scripts/generate-news-snapshots.ts` fetches anonymous English story responses
  (12 stories) and applies the same Korean merge function as the live API. It runs
  after daily translation/pruning in GitHub Actions, not on Vercel requests.
- Versioned snapshots in `data/news-snapshots` are keyed by batch/category. A SHA-256
  of the source sidecar skips unchanged work, including timestamp/read-count churn
  in the upstream response. Snapshots for pruned batches are removed. Changed
  sidecars whose fetch fails lose their old snapshot and fall back to the API;
  successful partial results are committed before the workflow reports failure.
- The offline `prebuild` step validates response identity/shape and sidecar hashes and emits content-addressed
  JSON files plus a manifest in `static/news`. Generated files are not committed.
  On Vercel these are static assets, not Function responses. Corrupt snapshots are
  skipped individually, so other categories still publish and the affected category
  falls back to the API. The generator repairs invalid cached snapshots on its next run.
- The browser checks the manifest at most once per five minutes and uses static
  content only for `lang=ko, limit=12`. Other languages/limits, absent snapshots,
  invalid responses, timeouts and unavailable files fall back to the existing API.
- The manifest revalidates; hashed files may be cached for a year. A changed news
  response gets a different URL. Old tabs can fall back to the API after a deploy.
- Existing index-only commit suppression is retained. Chaos updates intentionally
  still deploy because the upstream indicator can change throughout the day.

## Tradeoffs and controls

The snapshot's read count/timestamp reflect generation time, not live popularity.
Chaos and batch metadata remain on the live API. Snapshots are generated again when
translation content changes; they are not a continuously refreshed upstream mirror.

`TRANSLATIONS_ENABLED=false` at build time (including Vite mode-specific `.env`
files, with shell environment taking precedence) emits an empty static manifest. For a
Vercel deployment, change the environment setting and redeploy. For a self-hosted
build, rebuild when changing this flag: switching only the running Node process's
environment cannot retract already published static files.

Run `npm run snapshots:generate` to backfill existing translations (requires public
upstream network access, no Gemini key). `npm run build` then prepares static assets
offline. Previewing a raw `vite build` must first run `npm run prebuild`.

## Measure after deployment

Baseline screenshot: ko-kaginews Active CPU 6m02s, 34.9% of the team's CPU for the
selected partial billing period. This is not a quota-exhaustion percentage. A public
`/api/batches/latest?lang=ko` probe returned MISS then HIT before these changes.

Compare equal 24-hour windows in Vercel Observability, then a full week:

1. Filter to ko-kaginews, production, same duration and timezone.
2. Record Active CPU seconds, total requests, Function invocations, and memory usage.
3. Inspect paths: story APIs, image/favicon proxies, and SSR pages separately.
4. Confirm normal Korean category loads request `/news/<hash>.json` without a story
   API invocation. Confirm other languages still call the API successfully.
5. Compare CPU per 1,000 page visits alongside total CPU to account for traffic.
   Check cache MISS/HIT and error rates. Do not claim a savings percentage from
   local tests or merely from a lower-traffic day.

No Vercel account route-level CPU metrics have been collected in this change.
The reduction and hosting decision must be evaluated after production deployment.
