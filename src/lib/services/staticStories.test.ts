import { afterEach, describe, expect, it, vi } from 'vitest';

const batch = 'example-batch';
const category = 'example-category';
const url = `/news/${'a'.repeat(64)}.json`;
const body = {
	batchId: batch,
	categoryId: category,
	categoryName: 'World',
	stories: [{ id: 'story', title: '한국어', short_summary: '요약', articles: [] }],
	readCount: 7,
	timestamp: 123,
	totalStories: 1,
	domains: [],
};
const json = (value: unknown) => new Response(JSON.stringify(value));
async function setup() {
	vi.resetModules();
	const fetcher = vi.fn();
	vi.stubGlobal('fetch', fetcher);
	const { loadStaticStories } = await import('./staticStories');
	return {
		fetcher,
		load: (lang = 'ko', limit = 12) => loadStaticStories(batch, category, limit, lang),
	};
}
afterEach(() => vi.unstubAllGlobals());

describe('static stories', () => {
	it('loads Korean snapshot with same-origin credentials for protected previews', async () => {
		const { fetcher, load } = await setup();
		fetcher
			.mockResolvedValueOnce(json({ [`${batch}/${category}`]: url }))
			.mockResolvedValueOnce(json(body));
		expect(await load()).toEqual(body);
		expect(fetcher).toHaveBeenCalledTimes(2);
		for (const call of fetcher.mock.calls) expect(call[1].credentials).toBe('same-origin');
	});
	it('bypasses snapshots for other languages and nonstandard limits', async () => {
		const { fetcher, load } = await setup();
		expect(await load('en')).toBeNull();
		expect(await load('ko', 6)).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it.each([
		'missing',
		'404',
		'network',
		'invalid',
		'wrong-batch',
		'wrong-category',
	])('falls back for %s', async (failure) => {
		const { fetcher, load } = await setup();
		fetcher.mockResolvedValueOnce(
			json(failure === 'missing' ? {} : { [`${batch}/${category}`]: url }),
		);
		if (failure === 'network') fetcher.mockRejectedValueOnce(new Error('offline'));
		else if (failure === '404') fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
		else if (failure === 'invalid') fetcher.mockResolvedValueOnce(new Response('<html>'));
		else if (failure === 'wrong-category')
			fetcher.mockResolvedValueOnce(json({ ...body, categoryId: 'other' }));
		else fetcher.mockResolvedValueOnce(json({ ...body, batchId: 'other' }));
		expect(await load()).toBeNull();
	});
	it.each([
		['timestamp', undefined],
		['timestamp', '123'],
		['timestamp', -1],
		['readCount', undefined],
		['readCount', '7'],
		['readCount', -1],
		['totalStories', undefined],
		['totalStories', -1],
		['categoryName', undefined],
		['domains', undefined],
		['stories', []],
		['stories', [null]],
		['stories', [{ title: 'Missing body' }]],
	])('falls back for invalid %s metadata (%s)', async (field, value) => {
		const { fetcher, load } = await setup();
		fetcher
			.mockResolvedValueOnce(json({ [`${batch}/${category}`]: url }))
			.mockResolvedValueOnce(json({ ...body, [field as string]: value }));
		expect(await load()).toBeNull();
	});
	it('does not fetch external URLs from a malformed manifest', async () => {
		const { fetcher, load } = await setup();
		fetcher.mockResolvedValueOnce(
			json({ [`${batch}/${category}`]: 'https://other.example/news.json' }),
		);
		expect(await load()).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it('shares the manifest request and refreshes after five minutes', async () => {
		const { fetcher, load } = await setup();
		const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
		fetcher.mockImplementation(async (path: string) =>
			json(path === '/news/manifest.json' ? {} : body),
		);
		await Promise.all([load(), load()]);
		expect(fetcher).toHaveBeenCalledTimes(1);
		now.mockReturnValue(301001);
		await load();
		expect(fetcher).toHaveBeenCalledTimes(2);
		now.mockRestore();
	});
});
