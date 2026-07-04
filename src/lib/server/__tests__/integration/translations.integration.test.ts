import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BASE = 'http://localhost:5173';
const DIR = join(process.cwd(), 'data/translations');
const written: string[] = [];
afterEach(() => {
	for (const p of written.splice(0)) rmSync(p, { recursive: true, force: true });
});

async function getJson(path: string) {
	const res = await fetch(`${BASE}${path}`);
	return { status: res.status, body: await res.json().catch(() => null) };
}

describe('locale ko', () => {
	it('serves Korean strings', async () => {
		const { body } = await getJson('/api/locale/ko');
		expect(body.locale).toBe('ko');
		// NOTE: relies on Task 15 (local ko.json serving) — the /api/locale/ko route serves
		// Korean only after Task 15; before that it proxies upstream English and this will
		// (correctly) fail.
		const strings = body.strings as Record<string, { text?: string } | string> | null;
		expect(strings && typeof strings === 'object').toBeTruthy();
		const values = Object.values(strings ?? {}).map((v) =>
			typeof v === 'string' ? v : (v?.text ?? ''),
		);
		expect(values.some((t) => /[가-힣]/.test(t))).toBe(true); // at least one real Korean string
	});
});

describe('story overlay', () => {
	it('merges sidecar for lang=ko and passes other categories through', async () => {
		const latest = await getJson('/api/batches/latest');
		const batchId = latest.body.id;
		const cats = await getJson(`/api/batches/${batchId}/categories`);
		const cat = cats.body.categories[0];
		const stories = await getJson(`/api/batches/${batchId}/categories/${cat.id}/stories?lang=en`);
		const first = stories.body.stories[0];
		const dir = join(DIR, batchId);
		mkdirSync(dir, { recursive: true });
		written.push(dir);
		const file = join(dir, `${cat.id}.json`);
		writeFileSync(
			file,
			JSON.stringify({
				version: 1,
				batchId,
				categoryUuid: cat.id,
				model: 'gemini-3.1-flash-lite',
				createdAt: '2026-07-01T00:00:00Z',
				stories: { [first.id]: { title: '테스트 번역' } },
				stats: {},
			}),
		);
		const ko = await getJson(`/api/batches/${batchId}/categories/${cat.id}/stories?lang=ko`);
		const merged = ko.body.stories.find((s: any) => s.id === first.id);
		expect(merged.title).toBe('테스트 번역');
		expect(merged.translationAvailable).toBe(true);

		// §11: a DIFFERENT category with NO sidecar must pass through unchanged for lang=ko.
		const other = cats.body.categories[1];
		const otherEn = await getJson(`/api/batches/${batchId}/categories/${other.id}/stories?lang=en`);
		const otherKo = await getJson(`/api/batches/${batchId}/categories/${other.id}/stories?lang=ko`);
		expect(otherKo.body.stories[0].title).toBe(otherEn.body.stories[0].title);
		// Upstream echoes translationAvailable:false (not our overlay's true) for an
		// English-source category under lang=ko with no sidecar (spec §5.1, live-verified).
		expect(otherKo.body.stories[0].translationAvailable).not.toBe(true);
	});
});

describe('chaos freshness guard', () => {
	it('matching chaosLastUpdated → Korean; mismatched → English', async () => {
		const latest = await getJson('/api/batches/latest');
		const batchId = latest.body.id;
		const chaosEn = await getJson(`/api/batches/${batchId}/chaos?lang=en`);
		const dir = join(DIR, batchId);
		mkdirSync(dir, { recursive: true });
		written.push(dir);
		// Matching timestamp → overlay applies.
		writeFileSync(
			join(dir, 'chaos.json'),
			JSON.stringify({
				version: 1,
				batchId,
				model: 'gemini-3.1-flash-lite',
				createdAt: '2026-07-01T00:00:00Z',
				chaosLastUpdated: chaosEn.body.chaosLastUpdated,
				chaosDescription: '카오스 설명 번역',
			}),
		);
		const koMatch = await getJson(`/api/batches/${batchId}/chaos?lang=ko`);
		expect(koMatch.body.chaosDescription).toBe('카오스 설명 번역');
		// Stale timestamp → English passthrough.
		writeFileSync(
			join(dir, 'chaos.json'),
			JSON.stringify({
				version: 1,
				batchId,
				model: 'gemini-3.1-flash-lite',
				createdAt: '2026-07-01T00:00:00Z',
				chaosLastUpdated: '1970-01-01T00:00:00.000Z',
				chaosDescription: '오래된 번역',
			}),
		);
		const koStale = await getJson(`/api/batches/${batchId}/chaos?lang=ko`);
		expect(koStale.body.chaosDescription).toBe(chaosEn.body.chaosDescription);
	});
});

describe('upstream error passthrough', () => {
	it('non-existent batch returns non-200 unchanged for lang=ko', async () => {
		const { status } = await getJson(
			'/api/batches/00000000-0000-4000-8000-000000000000/categories/00000000-0000-4000-8000-000000000000/stories?lang=ko',
		);
		expect(status).toBeGreaterThanOrEqual(400);
	});
});

describe('path traversal defense', () => {
	it('escape sequences in the URL keep the service safe (no crash/overlay leak) for lang=ko', async () => {
		// The route short-circuits on the upstream 404 before readSidecar; the ACTUAL fs-boundary
		// rejection (BATCH_ID/CATEGORY_UUID regex + safeSidecarPath separator check) is unit-tested
		// in src/lib/server/__tests__/translations.test.ts (readSidecar/readChaosSidecar
		// path-traversal cases). This block only asserts the service stays safe (no 500/crash) on
		// traversal input.
		const { status, body } = await getJson(
			'/api/batches/..%2F..%2Fetc/categories/index/stories?lang=ko',
		);
		expect(status).toBeGreaterThanOrEqual(400);
		expect(status).not.toBe(500);
		expect(body?.stories).toBeUndefined();
	});
});
