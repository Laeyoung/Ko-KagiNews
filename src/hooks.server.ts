import type { Handle } from '@sveltejs/kit';
import { cacheControlFor } from '$lib/server/cachePolicy';

// Overrides the upstream `no-cache, no-store` (see cachePolicy.ts) so the
// Vercel CDN can serve repeat reads without invoking a function. Only clean
// 200s without cookies are made cacheable; errors and personalized responses
// keep whatever headers the route produced.
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (response.status !== 200 || response.headers.has('set-cookie')) return response;
	const policy = cacheControlFor(event.request.method, event.url.pathname);
	if (policy) response.headers.set('cache-control', policy);
	return response;
};
