import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./staticStories', () => ({ loadStaticStories: vi.fn() }));
vi.mock('$lib/services/faviconService', () => ({ prefetchFavicons: vi.fn() }));

import { loadStaticStories } from './staticStories';
import { storiesService } from './storiesService';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});
const data = { stories: [], readCount: 3, timestamp: 123 };
it('does not invoke story API when a snapshot exists', async () => {
	vi.mocked(loadStaticStories).mockResolvedValue(data as any);
	const fetcher = vi.fn();
	vi.stubGlobal('fetch', fetcher);
	expect(await storiesService.loadStories('batch', 'category', 12, 'ko')).toEqual(data);
	expect(fetcher).not.toHaveBeenCalled();
});
it('falls back to the anonymous live API when snapshot is unavailable', async () => {
	vi.mocked(loadStaticStories).mockResolvedValue(null);
	const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(data)));
	vi.stubGlobal('fetch', fetcher);
	expect(await storiesService.loadStories('batch', 'category', 12, 'ko')).toEqual(data);
	expect(fetcher).toHaveBeenCalledWith(
		'/api/batches/batch/categories/category/stories?limit=12&lang=ko',
		{ credentials: 'omit' },
	);
});
