import { describe, expect, it } from 'vitest';
import { cacheControlFor } from './cachePolicy';

const sMaxAge = (value: string | null): number | null => {
	const m = value?.match(/s-maxage=(\d+)/);
	return m ? Number(m[1]) : null;
};

describe('cacheControlFor', () => {
	it('returns null for non-GET methods', () => {
		expect(cacheControlFor('POST', '/api/batches/latest')).toBeNull();
		expect(cacheControlFor('PUT', '/api/image-proxy')).toBeNull();
		expect(cacheControlFor('DELETE', '/')).toBeNull();
	});

	it('caches proxied images long: browser a day, CDN a week', () => {
		const policy = cacheControlFor('GET', '/api/image-proxy');
		expect(policy).toContain('public');
		expect(policy).toContain('max-age=86400');
		expect(sMaxAge(policy)).toBe(604800);
		expect(cacheControlFor('GET', '/api/favicon-proxy')).toBe(policy);
	});

	it('caches the latest-batch pointer briefly so a new batch shows within minutes', () => {
		for (const path of [
			'/api/batches/latest',
			'/api/batches/latest/categories',
			'/api/batches/latest/categories/uuid-1/stories',
			'/api/batches/latest/chaos',
			'/api/batches/latest/onthisday',
			'/api/batches',
		]) {
			expect(sMaxAge(cacheControlFor('GET', path)), path).toBe(300);
		}
	});

	it('caches batch-scoped content for an hour (deploys purge the CDN anyway)', () => {
		for (const path of [
			'/api/batches/9f8d4986-8974-44e0-954a-b2640921d50a',
			'/api/batches/9f8d4986-8974-44e0-954a-b2640921d50a/categories',
			'/api/batches/9f8d4986-8974-44e0-954a-b2640921d50a/categories/uuid-1/stories',
			'/api/batches/2026-07-19.1/onthisday',
			'/api/batches/2026-07-19.1/languages',
		]) {
			expect(sMaxAge(cacheControlFor('GET', path)), path).toBe(3600);
		}
	});

	it('caches batch chaos briefly because the chaos index updates intra-day', () => {
		expect(sMaxAge(cacheControlFor('GET', '/api/batches/2026-07-19.1/chaos'))).toBe(300);
		expect(sMaxAge(cacheControlFor('GET', '/api/chaos/history'))).toBe(300);
	});

	it('caches slow-moving metadata for an hour', () => {
		for (const path of [
			'/api/categories/metadata',
			'/api/media',
			'/api/media/example.com',
			'/api/locale/ko',
			'/api/openapi',
		]) {
			expect(sMaxAge(cacheControlFor('GET', path)), path).toBe(3600);
		}
	});

	it('caches widget data briefly', () => {
		for (const path of [
			'/api/widgets/weather',
			'/api/widgets/crypto/price',
			'/api/widgets/nfl/scores',
		]) {
			expect(sMaxAge(cacheControlFor('GET', path)), path).toBe(300);
		}
	});

	it('never caches user-specific or write-adjacent API routes', () => {
		for (const path of [
			'/api/auth',
			'/api/sync',
			'/api/sync/read-history',
			'/api/search',
			'/api/contribute',
			'/api/reports',
			'/api/shorten',
			'/api/simplify',
			'/api/speech',
			'/api/vocabulary',
			'/api/geocode',
			'/api/feed-check',
			'/api/health',
		]) {
			expect(cacheControlFor('GET', path), path).toBeNull();
		}
	});

	it('caches SSR pages briefly at the CDN while keeping browsers revalidating', () => {
		for (const path of ['/', '/latest', '/2026-07-19.1', '/latest/world/some-story']) {
			const policy = cacheControlFor('GET', path);
			expect(policy, path).toContain('max-age=0');
			expect(sMaxAge(policy), path).toBe(300);
		}
	});

	it('leaves SvelteKit internals and static-looking assets alone', () => {
		expect(cacheControlFor('GET', '/_app/immutable/chunks/x.js')).toBeNull();
		expect(cacheControlFor('GET', '/favicon.png')).toBeNull();
		expect(cacheControlFor('GET', '/service-worker.js')).toBeNull();
	});
});
