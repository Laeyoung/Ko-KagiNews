import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLARITY_PROJECT_ID, initClarity } from './clarity';

// Under vitest `$app/environment` reports dev mode; Clarity only loads in prod.
vi.mock('$app/environment', () => ({ browser: true, dev: false }));

function clarityScripts(): HTMLScriptElement[] {
	return Array.from(document.querySelectorAll<HTMLScriptElement>('script#ms-clarity'));
}

describe('initClarity', () => {
	beforeEach(() => {
		for (const script of clarityScripts()) script.remove();
		window.clarity = undefined;
	});

	it('injects the Clarity tag for the project id', () => {
		initClarity();

		const scripts = clarityScripts();
		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toBe(`https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`);
		expect(scripts[0].async).toBe(true);
	});

	it('is idempotent', () => {
		initClarity();
		initClarity();

		expect(clarityScripts()).toHaveLength(1);
	});

	it('does nothing without a project id', () => {
		initClarity('');

		expect(clarityScripts()).toHaveLength(0);
		expect(window.clarity).toBeUndefined();
	});

	it('queues calls made before the tag loads', () => {
		initClarity();

		window.clarity?.('set', 'page', 'home');

		expect(window.clarity?.q).toHaveLength(1);
		expect(Array.from(window.clarity?.q?.[0] ?? [])).toEqual(['set', 'page', 'home']);
	});
});
