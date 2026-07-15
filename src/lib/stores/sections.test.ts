import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists via syncManager → dexie (indexedDB), which jsdom lacks.
vi.mock('$lib/client/sync-manager', () => ({ syncManager: null }));

import { sections } from './sections.svelte.js';

const STORAGE_KEY = 'kite-sections';

// localStorage is a vi.fn() mock (src/tests/setup.ts), so persistence is
// asserted via setItem calls and simulated via getItem return values.
function lastSavedSections(): Array<{ id: string; enabled: boolean }> {
	const calls = vi.mocked(localStorage.setItem).mock.calls.filter(([key]) => key === STORAGE_KEY);
	expect(calls.length).toBeGreaterThan(0);
	return JSON.parse(calls[calls.length - 1][1] as string);
}

beforeEach(() => {
	vi.mocked(localStorage.getItem).mockReset().mockReturnValue(null);
	vi.mocked(localStorage.setItem).mockReset();
	sections.reset();
});

describe('sections store — sources section is toggleable', () => {
	it('toggleSection("sources") disables the section and persists it', () => {
		expect(sections.settings.sources).toBe(true);

		sections.toggleSection('sources');
		expect(sections.settings.sources).toBe(false);
		expect(lastSavedSections().find((s) => s.id === 'sources')?.enabled).toBe(false);
	});

	it('a stored disabled sources section survives reload (no force-enable migration)', () => {
		sections.toggleSection('sources');
		const stored = JSON.stringify(lastSavedSections());

		vi.mocked(localStorage.getItem).mockReturnValue(stored);
		sections.init(); // reload from (mocked) localStorage
		expect(sections.settings.sources).toBe(false);
	});

	it('reset() restores sources to enabled', () => {
		sections.toggleSection('sources');
		sections.reset();
		expect(sections.settings.sources).toBe(true);
	});
});
