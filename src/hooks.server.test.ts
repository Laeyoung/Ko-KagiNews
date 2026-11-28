import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

const run = (
	url: string,
	response: Response,
	init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> =>
	// Only `request`/`url` are read by the hook; the rest of RequestEvent is irrelevant here.
	Promise.resolve(
		handle({
			event: {
				request: new Request(url, { method: init.method ?? 'GET', headers: init.headers }),
				url: new URL(url),
			} as any,
			resolve: async () => response,
		} as any),
	);

describe('hooks.server handle', () => {
	it('overrides upstream no-store on cacheable API 200s', async () => {
		const res = await run(
			'https://x.test/api/batches/latest?lang=ko',
			new Response('{}', {
				status: 200,
				headers: { 'cache-control': 'no-cache, no-store' },
			}),
		);
		expect(res.headers.get('cache-control')).toContain('s-maxage=300');
	});

	it('leaves non-200 responses untouched', async () => {
		const res = await run(
			'https://x.test/api/batches/latest',
			new Response('nope', {
				status: 502,
				headers: { 'cache-control': 'no-store' },
			}),
		);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('leaves responses that set cookies untouched', async () => {
		const res = await run(
			'https://x.test/api/batches/latest',
			new Response('{}', {
				status: 200,
				headers: { 'set-cookie': 'session=abc', 'cache-control': 'private' },
			}),
		);
		expect(res.headers.get('cache-control')).toBe('private');
	});

	it('leaves non-cacheable routes untouched', async () => {
		const res = await run('https://x.test/api/sync', new Response('{}', { status: 200 }));
		expect(res.headers.get('cache-control')).toBeNull();
	});

	it('never makes credentialed requests shared-cacheable (cookie)', async () => {
		const res = await run(
			'https://x.test/api/batches/latest',
			new Response('{}', {
				status: 200,
				headers: { 'cache-control': 'no-store' },
			}),
			{ headers: { cookie: 'kagi_session=abc' } },
		);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('never makes credentialed requests shared-cacheable (authorization)', async () => {
		const res = await run(
			'https://x.test/api/batches/latest',
			new Response('{}', { status: 200 }),
			{ headers: { authorization: 'Bearer token' } },
		);
		expect(res.headers.get('cache-control')).toBeNull();
	});
});

it('caches anonymous public batches with only Clarity cookies', async () => {
	const response = await run('https://x.test/api/batches/latest', new Response('{}'), {
		headers: { cookie: '_clck=analytics; _clsk=analytics' },
	});
	expect(response.headers.get('cache-control')).toContain('s-maxage=300');
});
it('still protects sessions mixed with analytics cookies', async () => {
	const response = await run(
		'https://x.test/api/batches/latest',
		new Response('{}', { headers: { 'cache-control': 'private' } }),
		{
			headers: { cookie: '_clck=analytics; session=secret' },
		},
	);
	expect(response.headers.get('cache-control')).toBe('private');
});
it('does not ignore analytics-named cookies on SSR pages', async () => {
	const response = await run('https://x.test/', new Response('page'), {
		headers: { cookie: '_clck=value' },
	});
	expect(response.headers.get('cache-control')).toBeNull();
});
