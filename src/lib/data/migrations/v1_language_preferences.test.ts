import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../settings.svelte';
import { v1_language_preferences } from './v1_language_preferences';

/**
 * Regression tests for the v1_language_preferences migration guard.
 *
 * Background (see docs/korean-translation-spec.md §7 note 3): once
 * `dataLanguage` defaults to a specific language code (e.g. 'ko') instead of
 * the 'default' sentinel, a brand-new visitor who never touched their
 * settings would look identical — as far as `settings.dataLanguage.currentValue`
 * is concerned — to a legacy user who had explicitly picked that language.
 * The migration must only fire for the latter, so it keys off whether a
 * `dataLanguage` value was ever actually written to localStorage, not just
 * the in-memory current value.
 *
 * `localStorage` is replaced by a global `vi.fn()`-based stub in
 * src/tests/setup.ts, so we drive the guard by controlling what
 * `localStorage.getItem` returns for the `settings.dataLanguage.key`
 * ('dataLanguage') — exactly what `safeGetItem` reads from inside the
 * migration.
 */
describe('v1_language_preferences migration', () => {
	const originalDataLanguage = settings.dataLanguage.currentValue;
	const originalContentLanguages = settings.contentLanguages.currentValue;

	beforeEach(() => {
		vi.mocked(localStorage.getItem).mockReset();
		vi.mocked(localStorage.setItem).mockReset();
	});

	afterEach(() => {
		settings.dataLanguage.currentValue = originalDataLanguage;
		settings.contentLanguages.currentValue = originalContentLanguages;
	});

	it('does NOT migrate a fresh profile with no stored dataLanguage key', () => {
		// Simulates a brand-new visitor: in-memory dataLanguage already holds the
		// app default (e.g. 'ko' post Task 16), but nothing was ever persisted.
		settings.dataLanguage.currentValue = 'ko';
		settings.contentLanguages.currentValue = [];
		vi.mocked(localStorage.getItem).mockReturnValue(null);

		v1_language_preferences.run();

		expect(localStorage.getItem).toHaveBeenCalledWith(settings.dataLanguage.key);
		expect(settings.dataLanguage.currentValue).toBe('ko');
		expect(settings.contentLanguages.currentValue).toEqual([]);
	});

	it('still migrates a legacy user who had explicitly stored a specific dataLanguage', () => {
		settings.dataLanguage.currentValue = 'pt';
		settings.contentLanguages.currentValue = [];
		vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
			key === settings.dataLanguage.key ? 'pt' : null,
		);

		v1_language_preferences.run();

		expect(settings.dataLanguage.currentValue).toBe('custom');
		expect(settings.contentLanguages.currentValue).toEqual(['pt']);
	});

	it('does not migrate when contentLanguages is already populated (already migrated)', () => {
		settings.dataLanguage.currentValue = 'pt';
		settings.contentLanguages.currentValue = ['pt'];
		vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
			key === settings.dataLanguage.key ? 'pt' : null,
		);

		v1_language_preferences.run();

		// Unchanged: dataLanguage should stay 'pt' since the guard's second
		// condition (contentLangs.length === 0) is false.
		expect(settings.dataLanguage.currentValue).toBe('pt');
		expect(settings.contentLanguages.currentValue).toEqual(['pt']);
	});
});
