import { afterEach, describe, expect, it } from 'vitest';
import { computeCategoryScrollTop } from './storyScroll.js';

function fakeStory(labelTop: number | null): HTMLElement {
	return {
		querySelector: (sel: string) =>
			sel === '.category-label' && labelTop !== null
				? { getBoundingClientRect: () => ({ top: labelTop }) }
				: null,
	} as unknown as HTMLElement;
}

afterEach(() => {
	Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
	for (const el of document.querySelectorAll('header')) el.remove();
});

describe('computeCategoryScrollTop', () => {
	it('returns null when there is no .category-label', () => {
		expect(computeCategoryScrollTop(fakeStory(null))).toBeNull();
	});

	it('computes pageYOffset + rect.top - 28 - headerHeight(60) - extraOffset(12)', () => {
		// jsdom: no <header>/<nav> → headerHeight 60; innerWidth 1024 → desktop → extraOffset 12
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 500 });
		// 500 + 300 - 28 - 60 - 12 = 700
		expect(computeCategoryScrollTop(fakeStory(300))).toBe(700);
	});

	it('clamps negative results to 0', () => {
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
		// 0 + 10 - 28 - 60 - 12 = -90 → 0
		expect(computeCategoryScrollTop(fakeStory(10))).toBe(0);
	});

	it('uses the mobile extraOffset (8) when innerWidth <= 768', () => {
		Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 500 });
		// 500 + 300 - 28 - 60(headerless) - 8(mobile) = 704
		expect(computeCategoryScrollTop(fakeStory(300))).toBe(704);
	});

	it('uses a present header/nav offsetHeight instead of the 60 fallback', () => {
		const header = document.createElement('header');
		Object.defineProperty(header, 'offsetHeight', { configurable: true, value: 100 });
		document.body.appendChild(header);
		Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
		// innerWidth 1024 → extraOffset 12; header 100: 0 + 300 - 28 - 100 - 12 = 160
		expect(computeCategoryScrollTop(fakeStory(300))).toBe(160);
	});
});
