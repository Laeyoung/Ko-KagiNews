import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `initClarity` reads `$app/environment` and `import.meta.env` at call time, so
 * each environment variant is loaded through `vi.doMock` + `vi.resetModules()`
 * rather than a single file-wide `vi.mock` — otherwise the `browser` / `dev` /
 * `VITE_CLARITY_ENABLED` guards are never exercised and the module would still
 * pass with any of them deleted.
 */
type ClarityModule = typeof import('./clarity');

async function loadClarity({
	browser = true,
	dev = false,
	enabled = 'true',
	projectId,
}: {
	browser?: boolean;
	dev?: boolean;
	/** `null` means the build-time var is absent (`undefined` would hit the default). */
	enabled?: string | null;
	projectId?: string;
} = {}): Promise<ClarityModule> {
	vi.resetModules();
	vi.doMock('$app/environment', () => ({ browser, dev }));
	// Stubbing `undefined` removes the key, i.e. an unset build-time var.
	vi.stubEnv('VITE_CLARITY_ENABLED', enabled ?? undefined);
	vi.stubEnv('VITE_CLARITY_PROJECT_ID', projectId);
	return import('./clarity');
}

function clarityScripts(): HTMLScriptElement[] {
	return Array.from(document.querySelectorAll<HTMLScriptElement>('script#ms-clarity'));
}

function reset() {
	for (const script of clarityScripts()) script.remove();
	window.clarity = undefined;
	vi.doUnmock('$app/environment');
	vi.unstubAllEnvs();
	vi.resetModules();
}

beforeEach(reset);
afterEach(reset);

describe('initClarity', () => {
	it('injects the Clarity tag for the default project id', async () => {
		const { CLARITY_PROJECT_ID, initClarity } = await loadClarity();

		initClarity();

		const scripts = clarityScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toBe(`https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`);
		expect(scripts[0].async).toBe(true);
		expect(document.head.contains(scripts[0])).toBe(true);
	});

	it('uses an explicitly passed project id', async () => {
		const { initClarity } = await loadClarity({ projectId: 'fromEnv' });

		initClarity('explicit123');

		expect(clarityScripts()[0].src).toBe('https://www.clarity.ms/tag/explicit123');
	});

	it('prefers VITE_CLARITY_PROJECT_ID over the built-in default', async () => {
		const { initClarity } = await loadClarity({ projectId: 'override123' });

		initClarity();

		expect(clarityScripts()[0].src).toBe('https://www.clarity.ms/tag/override123');
	});

	it('is idempotent', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		initClarity();

		expect(clarityScripts()).toHaveLength(1);
	});

	it('keeps already-queued calls on a repeat call', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		window.clarity?.('set', 'page', 'home');
		initClarity();

		expect(window.clarity?.q).toHaveLength(1);
	});

	it('does not overwrite a clarity global installed by the real tag', async () => {
		const { initClarity } = await loadClarity();
		const vendor = vi.fn() as unknown as NonNullable<Window['clarity']>;
		window.clarity = vendor;

		// Tag node gone (e.g. removed) but the vendor global still owns `clarity`.
		initClarity();

		expect(clarityScripts()).toHaveLength(1);
		expect(window.clarity).toBe(vendor);
	});

	it('queues calls made before the tag loads', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		window.clarity?.('set', 'page', 'home');

		expect(window.clarity?.q).toHaveLength(1);
		expect(window.clarity?.q?.[0]).toEqual(['set', 'page', 'home']);
	});

	it('caps the pre-load queue by dropping new calls, not evicting old ones', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		for (let i = 0; i < 150; i++) window.clarity?.('event', i);

		expect(window.clarity?.q).toHaveLength(100);
		// FIFO eviction would leave calls 50..149 instead.
		expect(window.clarity?.q?.[0]).toEqual(['event', 0]);
		expect(window.clarity?.q?.[99]).toEqual(['event', 99]);
	});

	it('drops script and stub when the tag fails to load', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		clarityScripts()[0].dispatchEvent(new Event('error'));

		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});

	it('leaves the global alone when the tag took over before the error fired', async () => {
		const { initClarity } = await loadClarity();

		initClarity();
		// Real ordering: our stub is installed first, then the tag executes and
		// replaces `window.clarity` with its own implementation. A late error
		// event must not tear that down. (Setting the global *before*
		// `initClarity()` would leave `stub` undefined and short-circuit the
		// identity check instead of exercising it.)
		const vendor = vi.fn() as unknown as NonNullable<Window['clarity']>;
		window.clarity = vendor;
		clarityScripts()[0].dispatchEvent(new Event('error'));

		expect(window.clarity).toBe(vendor);
	});

	it('leaves a pre-existing vendor global alone when the tag fails to load', async () => {
		const { initClarity } = await loadClarity();
		const vendor = vi.fn() as unknown as NonNullable<Window['clarity']>;
		window.clarity = vendor;

		initClarity();
		clarityScripts()[0].dispatchEvent(new Event('error'));

		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBe(vendor);
	});

	it('falls back to the default id when VITE_CLARITY_PROJECT_ID is empty', async () => {
		const { CLARITY_PROJECT_ID, initClarity } = await loadClarity({ projectId: '' });

		initClarity();

		expect(clarityScripts()[0].src).toBe(`https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`);
	});

	it('does nothing in dev', async () => {
		const { initClarity, isClarityEnabled } = await loadClarity({ dev: true });

		initClarity();

		expect(isClarityEnabled()).toBe(false);
		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});

	it('does nothing on the server', async () => {
		const { initClarity, isClarityEnabled } = await loadClarity({ browser: false });

		initClarity();

		expect(isClarityEnabled()).toBe(false);
		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});

	it('does nothing when VITE_CLARITY_ENABLED is unset', async () => {
		const { initClarity, isClarityEnabled } = await loadClarity({ enabled: null });

		initClarity();

		expect(isClarityEnabled()).toBe(false);
		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});

	it('does nothing when VITE_CLARITY_ENABLED is not exactly "true"', async () => {
		const { initClarity } = await loadClarity({ enabled: '1' });

		initClarity();

		expect(clarityScripts()).toHaveLength(0);
	});

	it('does nothing without a project id', async () => {
		const { initClarity } = await loadClarity();

		initClarity('');

		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});
});
