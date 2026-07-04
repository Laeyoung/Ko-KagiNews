import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '$env/dynamic/private';
import { applySegments } from '$lib/translation/translatable';
import type { BatchStoriesResponse, Story } from '$lib/types';

const BATCH_ID =
	/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$|^\d{4}-\d{2}-\d{2}(\.\d+)?$/i;
const CATEGORY_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type Sidecar = {
	version: number;
	batchId: string;
	categoryUuid: string;
	model: string;
	createdAt: string;
	stories: Record<string, Record<string, string>>;
};
export type ChaosSidecar = {
	version: number;
	batchId: string;
	model: string;
	createdAt: string;
	chaosLastUpdated: string;
	chaosDescription: string;
};

// Server reads env via $env/dynamic/private (§5.1). At runtime (`node build`) that
// module is dynamic — it reflects the process's real env. Under the unit test config
// the same module snapshots process.env at import time, so the Task 9 test mocks it to
// a live process.env view (see the `vi.mock('$env/dynamic/private', ...)` in the test)
// to make per-test env writes visible. (Scripts read process.env directly.)
function translationsDir(): string {
	return env.TRANSLATIONS_DIR ?? join(process.cwd(), 'data/translations');
}

// §8.2: on the first sidecar lookup, log the resolved absolute dir (and warn if it
// doesn't exist) so a cwd/TRANSLATIONS_DIR misconfig surfaces in logs instead of
// silently serving English forever.
let dirLogged = false;
async function logTranslationsDirOnce(): Promise<void> {
	if (dirLogged) return;
	dirLogged = true;
	const abs = resolve(translationsDir());
	try {
		await stat(abs);
		console.log(`[translations] TRANSLATIONS_DIR resolved to ${abs}`);
	} catch {
		console.warn(
			`[translations] TRANSLATIONS_DIR ${abs} does not exist — Korean will fall back to English`,
		);
	}
}

export function translationsEnabled(): boolean {
	return env.TRANSLATIONS_ENABLED !== 'false';
}

export function wantsKorean(langParam: string | null): boolean {
	if (!langParam) return false;
	return langParam.split(',')[0].trim() === 'ko';
}

type CacheEntry = { mtimeMs: number; size: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const MAX_CACHE = 64;

async function readJsonWithRevalidation<T>(absPath: string): Promise<T | null> {
	let st: Awaited<ReturnType<typeof stat>>;
	try {
		st = await stat(absPath);
	} catch {
		return null; // missing — do NOT negative-cache
	}
	const hit = cache.get(absPath);
	if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
		// LRU: refresh recency so a hot sidecar is never evicted ahead of a cold one.
		// (Map.get does not reorder; delete+set moves this key to the MRU end.)
		cache.delete(absPath);
		cache.set(absPath, hit);
		return hit.data as T;
	}
	try {
		const data = JSON.parse(await readFile(absPath, 'utf8'));
		// delete-then-set so a re-read of an existing (stale) key also lands at the MRU
		// end — plain Map.set on an existing key keeps its original insertion position.
		cache.delete(absPath);
		cache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size, data });
		// Evict the least-recently-used entry (Map iteration order = LRU→MRU).
		if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
		return data as T;
	} catch {
		return null;
	}
}

function safeSidecarPath(batchId: string, file: string): string | null {
	const dir = translationsDir();
	const abs = resolve(dir, batchId, file);
	if (!abs.startsWith(resolve(dir))) return null; // defense in depth
	return abs;
}

export async function readSidecar(batchId: string, categoryUuid: string): Promise<Sidecar | null> {
	await logTranslationsDirOnce();
	if (!BATCH_ID.test(batchId) || !CATEGORY_UUID.test(categoryUuid)) return null;
	const abs = safeSidecarPath(batchId, `${categoryUuid}.json`);
	if (!abs) return null;
	return readJsonWithRevalidation<Sidecar>(abs);
}

export async function readChaosSidecar(batchId: string): Promise<ChaosSidecar | null> {
	await logTranslationsDirOnce();
	if (!BATCH_ID.test(batchId)) return null;
	const abs = safeSidecarPath(batchId, 'chaos.json');
	if (!abs) return null;
	return readJsonWithRevalidation<ChaosSidecar>(abs);
}

export function applyTranslations(
	body: BatchStoriesResponse,
	sidecar: Sidecar,
): BatchStoriesResponse {
	if (!body?.stories) return body;
	const stories = body.stories.map((story) => {
		if (story.sourceLanguage === 'ko') return story; // native-Korean guard
		const entry = story.id ? sidecar.stories[story.id] : undefined;
		if (!entry) return story;
		const merged = applySegments(story, entry) as Story;
		merged.selectedLanguage = 'ko';
		merged.translationAvailable = true;
		merged.translationInfo = { model: sidecar.model, translatedAt: sidecar.createdAt };
		return merged;
	});
	return { ...body, stories };
}

type ChaosResponse = { chaosDescription?: string; chaosLastUpdated?: string; [k: string]: unknown };

export function applyChaosTranslation(body: ChaosResponse, sidecar: ChaosSidecar): ChaosResponse {
	return { ...body, chaosDescription: sidecar.chaosDescription };
}
