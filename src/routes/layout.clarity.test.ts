import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Guards the only wiring that actually turns Clarity on: the root layout's
// onMount must schedule `initClarity()` on idle. Deleting or reordering that
// call would otherwise leave every unit test green.

const { initClarity, syncInitialize } = vi.hoisted(() => ({
	initClarity: vi.fn(),
	syncInitialize: vi.fn(),
}));

vi.mock('$lib/client/clarity', () => ({ initClarity }));
vi.mock('$lib/client/sync-manager', () => ({ syncManager: { initialize: syncInitialize } }));
vi.mock('$lib/client/sync-settings-watcher.svelte', () => ({
	syncSettingsWatcher: { initialize: vi.fn() },
}));
vi.mock('$app/state', () => ({ page: { data: {} } }));
// App init is out of scope here; stub it so the test exercises only the wiring.
vi.mock('$lib/data/settings.svelte.js', () => {
	const init = { init: vi.fn() };
	return {
		categorySettings: init,
		displaySettings: {},
		experimentalSettings: {},
		languageSettings: { ui: 'ko' },
		loadAllSettings: vi.fn(),
		settings: {},
		themeSettings: {},
	};
});
vi.mock('$lib/stores/language.svelte.js', () => ({
	language: { init: vi.fn(), initStrings: vi.fn(), set: vi.fn(), current: 'ko' },
}));
vi.mock('$lib/stores/dataLanguage.svelte', () => ({ dataLanguage: { init: vi.fn() } }));
vi.mock('$lib/stores/experimental.svelte', () => ({ experimental: { init: vi.fn() } }));
vi.mock('overlayscrollbars-svelte', () => ({ useOverlayScrollbars: () => [vi.fn()] }));

import Layout from './+layout.svelte';

const children = createRawSnippet(() => ({ render: () => '<div>child</div>' }));

function renderLayout(session?: { loggedIn: boolean; id: string }) {
	return render(Layout, { props: { data: { session } as any, children } });
}

describe('root layout → Clarity wiring', () => {
	let idleCallbacks: Array<() => void>;
	const originalRic = globalThis.requestIdleCallback;

	beforeEach(() => {
		initClarity.mockReset();
		syncInitialize.mockReset();
		idleCallbacks = [];
		globalThis.requestIdleCallback = vi.fn((cb: IdleRequestCallback) => {
			idleCallbacks.push(() => cb({} as IdleDeadline));
			return idleCallbacks.length;
		}) as typeof requestIdleCallback;
	});

	afterEach(() => {
		globalThis.requestIdleCallback = originalRic;
		vi.useRealTimers();
	});

	it('defers initClarity to an idle callback with a timeout', async () => {
		renderLayout();
		await vi.waitFor(() => expect(requestIdleCallback).toHaveBeenCalledTimes(1));
		expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
		expect(initClarity).not.toHaveBeenCalled();

		for (const cb of idleCallbacks) cb();
		expect(initClarity).toHaveBeenCalledTimes(1);
	});

	it('falls back to setTimeout when requestIdleCallback is unavailable', async () => {
		vi.useFakeTimers();
		// @ts-expect-error — simulate Safari, which lacks requestIdleCallback
		delete globalThis.requestIdleCallback;
		renderLayout();
		await vi.advanceTimersByTimeAsync(999);
		expect(initClarity).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(initClarity).toHaveBeenCalledTimes(1);
	});

	it('still schedules analytics when sync init rejects for a logged-in user', async () => {
		const failure = new Error('sync down');
		// The layout lets this rejection escape onMount; capture it so it is an
		// asserted part of the scenario rather than a stray unhandled error.
		const escaped: unknown[] = [];
		const onUnhandled = (reason: unknown) => escaped.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			syncInitialize.mockRejectedValue(failure);
			renderLayout({ loggedIn: true, id: 'u1' });
			await vi.waitFor(() => expect(escaped).toContain(failure));
			expect(requestIdleCallback).toHaveBeenCalledTimes(1);
			for (const cb of idleCallbacks) cb();
			expect(initClarity).toHaveBeenCalledTimes(1);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});
