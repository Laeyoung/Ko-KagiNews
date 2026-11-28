import { isNewsSnapshotBody } from '$lib/translation/newsSnapshot.js';
import type { BatchStoriesResponse } from '$lib/types';

let manifest: Promise<Record<string, string>> | undefined;
let expires = 0;

/** Public, daily snapshot. Other languages/limits and any failure use the live API. */
export async function loadStaticStories(
	batchId: string,
	categoryId: string,
	limit: number,
	lang: string,
): Promise<BatchStoriesResponse | null> {
	if (lang !== 'ko' || limit !== 12) return null;
	try {
		if (!manifest || Date.now() >= expires) {
			expires = Date.now() + 300_000;
			manifest = fetch('/news/manifest.json', {
				credentials: 'same-origin',
				signal: AbortSignal.timeout(3000),
				cache: 'no-cache',
			})
				.then(async (response) => {
					if (!response.ok) throw new Error('Static manifest unavailable');
					return response.json();
				})
				.catch(() => ({}));
		}
		const url = (await manifest)[`${batchId}/${categoryId}`];
		if (typeof url !== 'string' || !/^\/news\/[a-f0-9]{64}\.json$/.test(url)) return null;
		const response = await fetch(url, {
			credentials: 'same-origin',
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) return null;
		const body = await response.json();
		return isNewsSnapshotBody(body, batchId, categoryId) ? body : null;
	} catch {
		return null;
	}
}
