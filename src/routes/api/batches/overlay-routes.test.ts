import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These 4 routes are the Korean-overlay layer's safety net: every branch must fall back
// to the plain upstream proxy response instead of ever 500ing or serving broken data.
// The only existing coverage was an integration test that needs a live :5173 dev server
// (see src/lib/server/__tests__/integration/translations.integration.test.ts), which is
// unrunnable in CI/sandbox. This file unit-tests the routes' own branch logic in isolation
// by mocking `$lib/server/proxy` and `$lib/server/translations` entirely — no real fetch,
// $env, or filesystem access happens here.

// `$lib/server/proxy` exports GET(endpoint) => handler. Each route file calls
// `proxyGET(ENDPOINT)` exactly once at module load time and stores the returned handler
// in a module-level `proxy` const. Because all 4 route modules resolve to the SAME mocked
// `$lib/server/proxy` module instance, `GET` (aliased below as `proxyGET`) is invoked once
// per route file, and every call returns the identical `proxyHandler` fixture — so we can
// assert against that one shared handler regardless of which route called it.
vi.mock('$lib/server/proxy', () => {
	const proxyHandler = vi.fn(async () => {
		return new Response(JSON.stringify({ __passthrough: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
	return {
		GET: vi.fn(() => proxyHandler),
		fetchUpstreamJSON: vi.fn(),
	};
});

vi.mock('$lib/server/translations', () => ({
	translationsEnabled: vi.fn(),
	wantsKorean: vi.fn(),
	readSidecar: vi.fn(),
	applyTranslations: vi.fn(),
	readChaosSidecar: vi.fn(),
	applyChaosTranslation: vi.fn(),
}));

import { fetchUpstreamJSON, GET as proxyGET } from '$lib/server/proxy';
import {
	applyChaosTranslation,
	applyTranslations,
	readChaosSidecar,
	readSidecar,
	translationsEnabled,
	wantsKorean,
} from '$lib/server/translations';

import { GET as storiesGET } from './[batchId]/categories/[categoryId]/stories/+server';
import { GET as chaosGET } from './[batchId]/chaos/+server';
import { GET as latestStoriesGET } from './latest/categories/[categoryId]/stories/+server';
import { GET as latestChaosGET } from './latest/chaos/+server';

// All 4 route modules loaded above resolve `proxyGET(ENDPOINT)` once each against the
// single mocked `$lib/server/proxy` module, so every call returns this same fixture.
const proxyHandler = vi.mocked(proxyGET).mock.results[0]!.value as ReturnType<typeof vi.fn>;

function makeEvent(pathAndQuery: string, params: Record<string, string>): RequestEvent {
	const url = new URL(`http://localhost${pathAndQuery}`);
	return { url, params } as unknown as RequestEvent;
}

async function isPassthrough(res: Response): Promise<boolean> {
	if (res.status !== 200) return false;
	const body = await res.clone().json();
	const isMarker = body?.__passthrough === true;
	// Belt-and-suspenders: a true marker must correspond to the shared proxy fixture
	// actually having been invoked, not just a coincidentally-shaped body.
	if (isMarker) expect(proxyHandler).toHaveBeenCalled();
	return isMarker;
}

beforeEach(() => {
	// Clears call history only (proxyHandler/proxyGET's factory-provided implementations
	// are preserved — only runtime .mockReturnValue/.mockImplementation calls set inline
	// per-test below are cleared for the translations mocks, which we re-arm every test).
	vi.clearAllMocks();
});

describe('GET /api/batches/[batchId]/categories/[categoryId]/stories', () => {
	const BATCH = '11111111-1111-1111-1111-111111111111';
	const CAT = '22222222-2222-2222-2222-222222222222';
	const event = () =>
		makeEvent(`/api/batches/${BATCH}/categories/${CAT}/stories?lang=ko`, {
			batchId: BATCH,
			categoryId: CAT,
		});

	it('kill switch: translationsEnabled() false -> passthrough, wantsKorean never evaluated', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(false);
		const res = await storiesGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(wantsKorean).not.toHaveBeenCalled();
		expect(fetchUpstreamJSON).not.toHaveBeenCalled();
	});

	it('non-Korean lang -> passthrough, upstream never fetched', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(false);
		const res = await storiesGET(
			makeEvent(`/api/batches/${BATCH}/categories/${CAT}/stories?lang=en`, {
				batchId: BATCH,
				categoryId: CAT,
			}),
		);
		expect(await isPassthrough(res)).toBe(true);
		expect(fetchUpstreamJSON).not.toHaveBeenCalled();
	});

	it('upstream not ok -> passthrough, sidecar never read', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 404, body: null, ok: false });
		const res = await storiesGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(readSidecar).not.toHaveBeenCalled();
	});

	it('overlay throws (readSidecar) -> caught, passthrough (no 500)', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({
			status: 200,
			body: { stories: [] },
			ok: true,
		});
		vi.mocked(readSidecar).mockRejectedValue(new Error('fs boom'));
		const res = await storiesGET(event());
		expect(res.status).not.toBe(500);
		expect(await isPassthrough(res)).toBe(true);
	});

	it('happy path: ko + upstream ok + sidecar present -> overlaid body via applyTranslations', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { stories: [{ id: 's1', title: 'Hello' }] };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		const sidecar = { version: 1, batchId: BATCH, categoryUuid: CAT } as any;
		vi.mocked(readSidecar).mockResolvedValue(sidecar);
		const overlaid = { stories: [{ id: 's1', title: '안녕하세요' }] };
		vi.mocked(applyTranslations).mockReturnValue(overlaid as any);

		const res = await storiesGET(event());

		expect(readSidecar).toHaveBeenCalledWith(BATCH, CAT);
		expect(applyTranslations).toHaveBeenCalledWith(upstreamBody, sidecar);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(overlaid);
		expect(proxyHandler).not.toHaveBeenCalled();
	});

	it('sidecar missing (null) -> upstream body returned unchanged, applyTranslations not called', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { stories: [{ id: 's1', title: 'Hello' }] };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		vi.mocked(readSidecar).mockResolvedValue(null);

		const res = await storiesGET(event());

		expect(applyTranslations).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});
});

describe('GET /api/batches/latest/categories/[categoryId]/stories', () => {
	const CAT = '33333333-3333-3333-3333-333333333333';
	const BATCH = '44444444-4444-4444-4444-444444444444';
	const event = (lang = 'ko') =>
		makeEvent(`/api/batches/latest/categories/${CAT}/stories?lang=${lang}`, { categoryId: CAT });

	it('kill switch -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(false);
		const res = await latestStoriesGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(wantsKorean).not.toHaveBeenCalled();
	});

	it('non-Korean lang -> passthrough, upstream never fetched', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(false);
		const res = await latestStoriesGET(event('en'));
		expect(await isPassthrough(res)).toBe(true);
		expect(fetchUpstreamJSON).not.toHaveBeenCalled();
	});

	it('upstream not ok -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 502, body: null, ok: false });
		const res = await latestStoriesGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(readSidecar).not.toHaveBeenCalled();
	});

	it('overlay throws -> caught, passthrough (no 500)', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({
			status: 200,
			body: { batchId: BATCH, stories: [] },
			ok: true,
		});
		vi.mocked(readSidecar).mockRejectedValue(new Error('fs boom'));
		const res = await latestStoriesGET(event());
		expect(res.status).not.toBe(500);
		expect(await isPassthrough(res)).toBe(true);
	});

	it('happy path: batchId resolved from upstream body + sidecar present -> overlaid via applyTranslations', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { batchId: BATCH, stories: [{ id: 's1', title: 'Hello' }] };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		const sidecar = { version: 1, batchId: BATCH, categoryUuid: CAT } as any;
		vi.mocked(readSidecar).mockResolvedValue(sidecar);
		const overlaid = { batchId: BATCH, stories: [{ id: 's1', title: '안녕하세요' }] };
		vi.mocked(applyTranslations).mockReturnValue(overlaid as any);

		const res = await latestStoriesGET(event());

		expect(readSidecar).toHaveBeenCalledWith(BATCH, CAT);
		expect(applyTranslations).toHaveBeenCalledWith(upstreamBody, sidecar);
		expect(await res.json()).toEqual(overlaid);
	});

	it('upstream body has no batchId -> sidecar never read, body returned unchanged', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { stories: [{ id: 's1', title: 'Hello' }] }; // no batchId field
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });

		const res = await latestStoriesGET(event());

		expect(readSidecar).not.toHaveBeenCalled();
		expect(applyTranslations).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});
});

describe('GET /api/batches/[batchId]/chaos', () => {
	const BATCH = '55555555-5555-5555-5555-555555555555';
	const event = (lang = 'ko') =>
		makeEvent(`/api/batches/${BATCH}/chaos?lang=${lang}`, { batchId: BATCH });

	it('kill switch -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(false);
		const res = await chaosGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(wantsKorean).not.toHaveBeenCalled();
	});

	it('non-Korean lang -> passthrough, upstream never fetched', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(false);
		const res = await chaosGET(event('en'));
		expect(await isPassthrough(res)).toBe(true);
		expect(fetchUpstreamJSON).not.toHaveBeenCalled();
	});

	it('upstream not ok -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 500, body: null, ok: false });
		const res = await chaosGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(readChaosSidecar).not.toHaveBeenCalled();
	});

	it('overlay throws (readChaosSidecar) -> caught, passthrough (no 500)', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({
			status: 200,
			body: { chaosLastUpdated: '2026-07-01T00:00:00Z' },
			ok: true,
		});
		vi.mocked(readChaosSidecar).mockRejectedValue(new Error('fs boom'));
		const res = await chaosGET(event());
		expect(res.status).not.toBe(500);
		expect(await isPassthrough(res)).toBe(true);
	});

	it('freshness guard MATCH -> applyChaosTranslation applied', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-01T00:00:00Z', chaosDescription: 'English' };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		const sidecar = {
			version: 1,
			batchId: BATCH,
			chaosLastUpdated: '2026-07-01T00:00:00Z',
			chaosDescription: '한국어',
		} as any;
		vi.mocked(readChaosSidecar).mockResolvedValue(sidecar);
		const overlaid = { ...upstreamBody, chaosDescription: '한국어' };
		vi.mocked(applyChaosTranslation).mockReturnValue(overlaid);

		const res = await chaosGET(event());

		expect(applyChaosTranslation).toHaveBeenCalledWith(upstreamBody, sidecar);
		expect(await res.json()).toEqual(overlaid);
	});

	it('freshness guard MISMATCH -> English body returned, applyChaosTranslation not called', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-02T00:00:00Z', chaosDescription: 'English' };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		const staleSidecar = {
			version: 1,
			batchId: BATCH,
			chaosLastUpdated: '2026-07-01T00:00:00Z', // stale vs. upstream's 07-02
			chaosDescription: '오래된 번역',
		} as any;
		vi.mocked(readChaosSidecar).mockResolvedValue(staleSidecar);

		const res = await chaosGET(event());

		expect(applyChaosTranslation).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});

	it('no sidecar -> English body returned unchanged', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-01T00:00:00Z', chaosDescription: 'English' };
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 200, body: upstreamBody, ok: true });
		vi.mocked(readChaosSidecar).mockResolvedValue(null);

		const res = await chaosGET(event());

		expect(applyChaosTranslation).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});
});

describe('GET /api/batches/latest/chaos', () => {
	const event = (lang = 'ko') => makeEvent(`/api/batches/latest/chaos?lang=${lang}`, {});

	// `resolveLatestBatchId` inside this route memoizes the resolved batchId at MODULE
	// scope for 60s (`latestMemo`), shared across every test in this describe block since
	// the route module is only evaluated once. We use fake timers and strictly advance
	// system time by >60s before each test so the memo from a prior test never leaks into
	// the next one — each test independently controls whether `/batches/latest` resolves.
	let fakeNow = 1_700_000_000_000;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(fakeNow);
		fakeNow += 120_000;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	function mockUpstream({
		main,
		latest,
	}: {
		main: { status: number; body: unknown; ok: boolean };
		latest?: { status: number; body: unknown; ok: boolean };
	}) {
		vi.mocked(fetchUpstreamJSON).mockImplementation(async (endpoint) => {
			if (endpoint === '/batches/latest') {
				return latest ?? { status: 200, body: { id: 'unused' }, ok: true };
			}
			return main;
		});
	}

	it('kill switch -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(false);
		const res = await latestChaosGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(wantsKorean).not.toHaveBeenCalled();
	});

	it('non-Korean lang -> passthrough, upstream never fetched', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(false);
		const res = await latestChaosGET(event('en'));
		expect(await isPassthrough(res)).toBe(true);
		expect(fetchUpstreamJSON).not.toHaveBeenCalled();
	});

	it('upstream not ok -> passthrough', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		vi.mocked(fetchUpstreamJSON).mockResolvedValue({ status: 500, body: null, ok: false });
		const res = await latestChaosGET(event());
		expect(await isPassthrough(res)).toBe(true);
		expect(readChaosSidecar).not.toHaveBeenCalled();
	});

	it('resolving latest batchId fails -> readChaosSidecar never called, English body returned', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-01T00:00:00Z', chaosDescription: 'English' };
		mockUpstream({
			main: { status: 200, body: upstreamBody, ok: true },
			latest: { status: 502, body: null, ok: false }, // /batches/latest lookup fails
		});

		const res = await latestChaosGET(event());

		expect(readChaosSidecar).not.toHaveBeenCalled();
		expect(applyChaosTranslation).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});

	it('overlay throws (readChaosSidecar) -> caught, passthrough (no 500)', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		mockUpstream({
			main: { status: 200, body: { chaosLastUpdated: '2026-07-01T00:00:00Z' }, ok: true },
			latest: { status: 200, body: { id: 'batch-x' }, ok: true },
		});
		vi.mocked(readChaosSidecar).mockRejectedValue(new Error('fs boom'));

		const res = await latestChaosGET(event());

		expect(res.status).not.toBe(500);
		expect(await isPassthrough(res)).toBe(true);
	});

	it('freshness guard MATCH (with batchId resolved via /batches/latest) -> overlay applied', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-01T00:00:00Z', chaosDescription: 'English' };
		mockUpstream({
			main: { status: 200, body: upstreamBody, ok: true },
			latest: { status: 200, body: { id: 'batch-y' }, ok: true },
		});
		const sidecar = {
			version: 1,
			batchId: 'batch-y',
			chaosLastUpdated: '2026-07-01T00:00:00Z',
			chaosDescription: '한국어',
		} as any;
		vi.mocked(readChaosSidecar).mockResolvedValue(sidecar);
		const overlaid = { ...upstreamBody, chaosDescription: '한국어' };
		vi.mocked(applyChaosTranslation).mockReturnValue(overlaid);

		const res = await latestChaosGET(event());

		expect(readChaosSidecar).toHaveBeenCalledWith('batch-y');
		expect(applyChaosTranslation).toHaveBeenCalledWith(upstreamBody, sidecar);
		expect(await res.json()).toEqual(overlaid);
	});

	it('freshness guard MISMATCH -> English body returned, applyChaosTranslation not called', async () => {
		vi.mocked(translationsEnabled).mockReturnValue(true);
		vi.mocked(wantsKorean).mockReturnValue(true);
		const upstreamBody = { chaosLastUpdated: '2026-07-02T00:00:00Z', chaosDescription: 'English' };
		mockUpstream({
			main: { status: 200, body: upstreamBody, ok: true },
			latest: { status: 200, body: { id: 'batch-z' }, ok: true },
		});
		const staleSidecar = {
			version: 1,
			batchId: 'batch-z',
			chaosLastUpdated: '2026-07-01T00:00:00Z',
			chaosDescription: '오래된 번역',
		} as any;
		vi.mocked(readChaosSidecar).mockResolvedValue(staleSidecar);

		const res = await latestChaosGET(event());

		expect(applyChaosTranslation).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(upstreamBody);
	});
});
