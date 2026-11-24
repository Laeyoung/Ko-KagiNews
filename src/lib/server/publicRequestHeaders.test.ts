import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxy } from './proxy';
import { publicRequestHeaders } from './publicRequestHeaders';

const url = 'https://news.test/api/batches/latest';
const req = (cookie: string, method = 'GET') => new Request(url, { method, headers: { cookie } });
afterEach(() => vi.unstubAllGlobals());
describe('public batch cookie filtering', () => {
	it('removes only exact Clarity cookie names without mutating input', () => {
		const request = req('_clck=a; _clsk=b');
		expect(publicRequestHeaders(request, '/api/batches/latest').has('cookie')).toBe(false);
		expect(request.headers.get('cookie')).toBe('_clck=a; _clsk=b');
	});
	it('preserves session, platform auth and unknown cookies', () => {
		const request = req('_clck=a; session=x; _vercel_jwt=y; _clck_extra=z');
		expect(publicRequestHeaders(request, '/api/batches/latest').get('cookie')).toBe(
			'session=x; _vercel_jwt=y; _clck_extra=z',
		);
	});
	it('preserves authorization and never strips on private routes or writes', () => {
		for (const path of ['/api/auth', '/api/sync', '/', '/api/batches-private']) {
			expect(publicRequestHeaders(req('_clck=a'), path).get('cookie')).toBe('_clck=a');
		}
		expect(publicRequestHeaders(req('_clck=a', 'POST'), '/api/batches').get('cookie')).toBe(
			'_clck=a',
		);
		const request = new Request(url, {
			headers: { authorization: 'Bearer secret', cookie: '_clck=a' },
		});
		expect(publicRequestHeaders(request, '/api/batches/latest').get('authorization')).toBe(
			'Bearer secret',
		);
	});
	it('forwards sanitized batch cookies upstream, preserving other credentials', async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
		vi.stubGlobal('fetch', fetcher);
		await createProxy('/batches/latest')({
			request: req('_clck=a; session=x'),
			url: new URL(url),
			params: {},
		} as any);
		expect(fetcher.mock.calls[0][0].headers.get('cookie')).toBe('session=x');
	});
});
