import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// translations.ts reads env via `$env/dynamic/private` (spec §5.1). The sveltekit()
// vite plugin makes that virtual module resolvable in the unit config, but it
// SNAPSHOTS process.env at module-load time — and since static `import`s are hoisted
// above beforeEach, the per-test `process.env.TRANSLATIONS_DIR = ...` write would not
// be reflected. Mock it to a LIVE view of process.env (vi.mock is hoisted above the
// static import) so late `env.TRANSLATIONS_DIR`/`env.TRANSLATIONS_ENABLED` reads in
// translations.ts pick up each test's mutation.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));

// The bundled glob map is build-time state (import.meta.glob over the repo's
// committed sidecars); mock it so the serverless fallback path is testable.
const BUNDLED_BATCH = '2026-07-13.1';
const BUNDLED_CAT = '11111111-2222-3333-4444-555555555555';
vi.mock('../bundledSidecars', () => ({
	bundledSidecars: {
		'/data/translations/2026-07-13.1/11111111-2222-3333-4444-555555555555.json': async () => ({
			version: 1,
			batchId: '2026-07-13.1',
			categoryUuid: '11111111-2222-3333-4444-555555555555',
			model: 'test-model',
			createdAt: '2026-07-13T14:00:00Z',
			stories: { s1: { title: '번들 제목' } },
		}),
		'/data/translations/2026-07-13.1/broken.json': async () => {
			throw new Error('chunk load failed');
		},
	},
}));

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'trans-'));
	process.env.TRANSLATIONS_DIR = dir;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Static import is hoisted; the vi.mock above (also hoisted) guarantees the module
// under test sees the live-process.env-backed env regardless of import position.
import {
	applyChaosTranslation,
	applyTranslations,
	readBundledSidecar,
	readChaosSidecar,
	readSidecar,
	translationsEnabled,
	wantsKorean,
} from '../translations';

describe('wantsKorean', () => {
	it('true for ko and ko-first comma list', () => {
		expect(wantsKorean('ko')).toBe(true);
		expect(wantsKorean('ko,en')).toBe(true);
	});
	it('false for default/source/null/en', () => {
		expect(wantsKorean('default')).toBe(false);
		expect(wantsKorean('source')).toBe(false);
		expect(wantsKorean(null)).toBe(false);
		expect(wantsKorean('en')).toBe(false);
	});
});

describe('translationsEnabled', () => {
	it('false only when env is exactly "false"', () => {
		process.env.TRANSLATIONS_ENABLED = 'false';
		expect(translationsEnabled()).toBe(false);
		process.env.TRANSLATIONS_ENABLED = 'true';
		expect(translationsEnabled()).toBe(true);
		delete process.env.TRANSLATIONS_ENABLED;
		expect(translationsEnabled()).toBe(true);
	});
});

const UUID = 'd97781a5-53b2-4d41-a1af-26145afa1170';
const CAT = '824b8d47-5c9c-4ac2-ab55-f8b85f777bcb';

function writeSidecar(stories: Record<string, Record<string, string>>) {
	mkdirSync(join(dir, UUID), { recursive: true });
	writeFileSync(
		join(dir, UUID, `${CAT}.json`),
		JSON.stringify({
			version: 1,
			batchId: UUID,
			categoryUuid: CAT,
			categorySlug: 'world',
			model: 'gemini-3.1-flash-lite',
			createdAt: '2026-07-01T14:03:11Z',
			stories,
			stats: {},
		}),
	);
}

describe('applyTranslations', () => {
	it('merges by id, sets flags only on merged stories', async () => {
		writeSidecar({ s1: { title: '번역' } });
		const sidecar = await readSidecar(UUID, CAT);
		const body = {
			stories: [
				{
					id: 's1',
					title: 'Original',
					short_summary: 'x',
					category: 'world',
					cluster_number: 1,
					articles: [],
				},
				{
					id: 's2',
					title: 'Other',
					short_summary: 'y',
					category: 'world',
					cluster_number: 2,
					articles: [],
				},
			],
		} as any;
		const out = applyTranslations(body, sidecar!);
		expect(out.stories[0].title).toBe('번역');
		expect(out.stories[0].translationAvailable).toBe(true);
		expect(out.stories[0].selectedLanguage).toBe('ko');
		expect(out.stories[1].title).toBe('Other');
		expect(out.stories[1].translationAvailable).toBeUndefined();
	});

	it('native-Korean guard: sourceLanguage ko is not overlaid even with a sidecar entry', async () => {
		writeSidecar({ s1: { title: '덮어쓰면안됨' } });
		const sidecar = await readSidecar(UUID, CAT);
		const body = {
			stories: [
				{
					id: 's1',
					title: '원본 한국어',
					sourceLanguage: 'ko',
					short_summary: 'x',
					category: 'world',
					cluster_number: 1,
					articles: [],
				},
			],
		} as any;
		const out = applyTranslations(body, sidecar!);
		expect(out.stories[0].title).toBe('원본 한국어');
	});
});

describe('readSidecar cache', () => {
	it('no negative cache: miss then create then hit', async () => {
		expect(await readSidecar(UUID, CAT)).toBeNull();
		writeSidecar({ s1: { title: '번역' } });
		expect((await readSidecar(UUID, CAT))?.stories.s1.title).toBe('번역');
	});
	it('rejects path-traversal params', async () => {
		expect(await readSidecar('../etc', CAT)).toBeNull();
		expect(await readSidecar(UUID, 'index')).toBeNull();
		expect(await readSidecar(UUID, '..%2Fescape')).toBeNull();
	});

	it('revalidates on cache hit: a rewritten file with new mtime+size is not served stale', async () => {
		writeSidecar({ s1: { title: '번역A' } });
		const first = await readSidecar(UUID, CAT);
		expect(first?.stories.s1.title).toBe('번역A');

		// Rewrite with different content — the new title string has a different length
		// than '번역A', so file size necessarily changes even if fs mtime granularity
		// happens to be coarse. Also bump mtime explicitly for extra robustness.
		writeSidecar({ s1: { title: '번역B-변경됨' } });
		const path = join(dir, UUID, `${CAT}.json`);
		const future = new Date(Date.now() + 2000);
		utimesSync(path, future, future);

		const second = await readSidecar(UUID, CAT);
		expect(second?.stories.s1.title).toBe('번역B-변경됨');
	});
});

function writeChaosSidecar(
	chaos: Partial<{
		chaosLastUpdated: string;
		chaosDescription: string;
	}>,
) {
	mkdirSync(join(dir, UUID), { recursive: true });
	writeFileSync(
		join(dir, UUID, 'chaos.json'),
		JSON.stringify({
			version: 1,
			batchId: UUID,
			model: 'gemini-3.1-flash-lite',
			createdAt: '2026-07-01T14:03:11Z',
			chaosLastUpdated: '2026-07-01T14:03:11Z',
			chaosDescription: '카오스',
			...chaos,
		}),
	);
}

describe('readChaosSidecar', () => {
	it('no negative cache: miss then create then hit', async () => {
		expect(await readChaosSidecar(UUID)).toBeNull();
		writeChaosSidecar({ chaosDescription: '카오스' });
		expect((await readChaosSidecar(UUID))?.chaosDescription).toBe('카오스');
	});
	it('rejects path-traversal params', async () => {
		expect(await readChaosSidecar('../etc')).toBeNull();
		expect(await readChaosSidecar('..%2Fescape')).toBeNull();
	});
});

describe('bundled sidecar fallback', () => {
	it('falls back to the bundled map when the file is not on disk', async () => {
		const sidecar = await readSidecar(BUNDLED_BATCH, BUNDLED_CAT);
		expect(sidecar?.stories.s1.title).toBe('번들 제목');
	});

	it('returns null when neither fs nor bundle has the sidecar', async () => {
		const sidecar = await readSidecar(BUNDLED_BATCH, '99999999-9999-9999-9999-999999999999');
		expect(sidecar).toBeNull();
	});

	it('prefers the fs copy over the bundled copy', async () => {
		mkdirSync(join(dir, BUNDLED_BATCH), { recursive: true });
		writeFileSync(
			join(dir, BUNDLED_BATCH, `${BUNDLED_CAT}.json`),
			JSON.stringify({
				version: 1,
				batchId: BUNDLED_BATCH,
				categoryUuid: BUNDLED_CAT,
				model: 'gemini-3.1-flash-lite',
				createdAt: '2026-07-13T14:00:00Z',
				stories: { s1: { title: 'fs 제목' } },
			}),
		);
		const sidecar = await readSidecar(BUNDLED_BATCH, BUNDLED_CAT);
		expect(sidecar?.stories.s1.title).toBe('fs 제목');
	});

	it('readBundledSidecar returns null when the loader throws', async () => {
		await expect(readBundledSidecar(BUNDLED_BATCH, 'broken.json')).resolves.toBeNull();
	});
});

describe('applyChaosTranslation', () => {
	it('replaces only chaosDescription, leaves other fields untouched', () => {
		const body = { chaosIndex: 5, chaosDescription: 'English', chaosLastUpdated: 'T' };
		const sidecar = {
			version: 1,
			batchId: UUID,
			model: 'gemini-3.1-flash-lite',
			createdAt: '2026-07-01T14:03:11Z',
			chaosLastUpdated: '2026-07-01T14:03:11Z',
			chaosDescription: '카오스',
		};
		const out = applyChaosTranslation(body, sidecar);
		expect(out.chaosDescription).toBe('카오스');
		expect(out.chaosIndex).toBe(5);
		expect(out.chaosLastUpdated).toBe('T');
	});
});
