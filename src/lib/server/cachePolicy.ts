// CDN cache policy, applied in src/hooks.server.ts. The upstream Kagi API sends
// `no-cache, no-store` on everything, so without an override every request —
// every story JSON, every proxied image — invokes a Vercel function and burns
// Fluid Active CPU quota. The content model makes most of it safely cacheable:
// one immutable batch per day, purged from the Vercel CDN on every production
// deploy (and the translation cron deploys right after each sidecar update).
//
// Vercel consumes `s-maxage`/`stale-while-revalidate` at the edge and strips
// them from the client response, so browsers only see the `max-age` part.

// Proxied images/favicons are immutable per URL: browsers keep them a day, the
// CDN a week.
const PROXIED_ASSET = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800';
// The "latest" pointer moves once a day at 12:00 UTC; ≤5 min staleness is fine.
const FIVE_MIN = 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=3600';
// Batch-scoped content is immutable apart from intra-day sidecar improvements,
// which arrive via a deploy that purges the CDN anyway.
const ONE_HOUR = 'public, max-age=0, must-revalidate, s-maxage=3600, stale-while-revalidate=86400';

const STATIC_EXT = /\.(js|css|map|png|jpe?g|gif|webp|ico|svg|xml|txt|json|webmanifest|woff2?)$/i;

export function cacheControlFor(method: string, pathname: string): string | null {
	if (method !== 'GET') return null;

	if (pathname.startsWith('/api/')) {
		if (pathname === '/api/image-proxy' || pathname === '/api/favicon-proxy') {
			return PROXIED_ASSET;
		}
		if (pathname === '/api/batches' || pathname.startsWith('/api/batches/latest')) {
			return FIVE_MIN;
		}
		if (pathname.startsWith('/api/batches/')) {
			// The chaos index updates intra-day upstream, unlike stories.
			return pathname.endsWith('/chaos') ? FIVE_MIN : ONE_HOUR;
		}
		if (pathname === '/api/chaos/history') return FIVE_MIN;
		if (
			pathname === '/api/categories/metadata' ||
			pathname === '/api/media' ||
			pathname.startsWith('/api/media/') ||
			pathname.startsWith('/api/locale/') ||
			pathname === '/api/openapi'
		) {
			return ONE_HOUR;
		}
		if (pathname.startsWith('/api/widgets/')) return FIVE_MIN;
		// Everything else (auth, sync, search, contribute, geocode, health, …)
		// is user-specific, write-adjacent, or too cheap to matter: hands off.
		return null;
	}

	// SvelteKit build assets and static files are CDN-served on Vercel already;
	// under `node build` they are handled by sirv. Leave both alone.
	if (pathname.startsWith('/_app/') || STATIC_EXT.test(pathname)) return null;

	// SSR pages: all data loading happens client-side, so the HTML shell is the
	// same for every visitor. Short CDN cache, browsers always revalidate.
	return FIVE_MIN;
}
