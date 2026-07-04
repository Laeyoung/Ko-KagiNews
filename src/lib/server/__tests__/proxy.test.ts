import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUpstreamJSON } from '$lib/server/proxy';

afterEach(() => vi.unstubAllGlobals());

const url = new URL('http://localhost/api/x?lang=ko');

describe('fetchUpstreamJSON', () => {
	it('ok:false when fetch throws (network failure)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		const r = await fetchUpstreamJSON('/batches/latest', {}, url);
		expect(r.ok).toBe(false);
	});
	it('ok:false on non-2xx upstream', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		const r = await fetchUpstreamJSON('/batches/latest', {}, url);
		expect(r.ok).toBe(false);
		expect(r.status).toBe(404);
	});
	it('ok:false when body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.reject(new SyntaxError('bad json')),
			}),
		);
		const r = await fetchUpstreamJSON('/batches/latest', {}, url);
		expect(r.ok).toBe(false);
	});
	it('ok:true with parsed body on success', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ id: 'abc' }) }),
		);
		const r = await fetchUpstreamJSON('/batches/latest', {}, url);
		expect(r).toEqual({ status: 200, body: { id: 'abc' }, ok: true });
	});
});
